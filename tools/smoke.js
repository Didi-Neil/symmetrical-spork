#!/usr/bin/env node
/* tools/smoke.js — test de fumée de bout en bout (Playwright, file://, mobile 390×844, tactile, DPR 2).
   Parcourt TOUS les écrans et joue un run COMPLET :
     titre → réglages (3 onglets) → Observatoire (construction d'une salle) → Grimoire (onglets) → Défis → Ciel du Jour
     → sélection (carrousel) → Lune 1 et Lune 2 jouées pour de vrai (bot greedy de BE.Debug, tirs tactile / souris / API)
     → pause, Sac, Reliques, réglages et Grimoire en pause → Aube à chaque nuit (achats par l'interface, clous / gravures,
     Constellation, Sac + Épurer, glisser-déposer de reliques) → Vidange → rechargement pendant un tir (PENDING_SHOT
     rejoué) et pendant l'Aube (reprise identique) → Lunes 3 à 5 en accéléré → VICTOIRE → fin de run
     → 2e run à l'Éclipse 1 abandonné depuis la pause → Ciel du Jour perdu par Débordement → titre.
   Le bot ne touche jamais à la Bougie ni au bocal : s'il perd par Débordement pendant les Lunes 1–2, l'écran de fin est
   vérifié et un nouveau run est lancé (graine suivante, 3 essais). --reckless : le 1er run remplit le bocal exprès,
   pour exercer ce chemin.
   Captures dans tools/shots/, code de sortie ≠ 0 à la moindre erreur console / page / script.
   Usage : NODE_PATH=$(npm root -g) node tools/smoke.js [--quick] [--reckless] */
"use strict";
process.env.PLAYWRIGHT_BROWSERS_PATH = process.env.PLAYWRIGHT_BROWSERS_PATH || "/opt/pw-browsers";
const path = require("path");
const fs = require("fs");
const { chromium } = require("playwright");

const ROOT = path.resolve(__dirname, "..");
const SHOTS = path.join(__dirname, "shots");
const URL = "file://" + path.join(ROOT, "index.html");

const errors = [];
const visited = new Set();
let page, cdp;
const SMOKE_SEED = process.env.SMOKE_SEED || "SMOK-0001"; // graine du run joué (surchargeable : SMOKE_SEED=XXXX-XXXX)

function log(...a) { console.log("[smoke]", ...a); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function state() { return page.evaluate(() => window.BE.Test.state()); }
async function waitFor(pred, what, timeout = 20000) {
  const t0 = Date.now();
  let s;
  while (Date.now() - t0 < timeout) {
    s = await state();
    if (pred(s)) return s;
    await sleep(50);
  }
  throw new Error("timeout en attendant : " + what + " (scène = " + (s && s.scene) + ")");
}
let shotNo = 0;
async function shot(name) {
  shotNo++;
  const file = String(shotNo).padStart(2, "0") + "_" + name + ".png";
  await page.screenshot({ path: path.join(SHOTS, file) });
  log("capture", file);
}
async function client(x, y) { return page.evaluate(([x, y]) => window.BE.Test.toClient(x, y), [x, y]); }
async function hasRegion(id) { return page.evaluate((id) => !!window.BE.Test.region(id), id); }
async function tapRegion(id, opt) {
  const r = await page.evaluate((id) => window.BE.Test.region(id), id);
  if (!r) { if (opt) return false; throw new Error("région introuvable : " + id); }
  const c = await client(r.x + r.w / 2, r.y + r.h / 2);
  await page.touchscreen.tap(c.x, c.y);
  await sleep(140);
  return true;
}
async function tapLogical(x, y) {
  const c = await client(x, y);
  await page.touchscreen.tap(c.x, c.y);
  await sleep(140);
}
/** Glisser tactile (CDP) : pose le doigt, glisse, relâche. */
async function touchDrag(points, holdScreenshot) {
  const pts = [];
  for (const [x, y] of points) pts.push(await client(x, y));
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: pts[0].x, y: pts[0].y, id: 1 }] });
  for (let i = 1; i < pts.length; i++) {
    await sleep(40);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: pts[i].x, y: pts[i].y, id: 1 }] });
  }
  await sleep(220);
  if (holdScreenshot) await shot(holdScreenshot);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await sleep(60);
}
async function mouseDrag(points) {
  const pts = [];
  for (const [x, y] of points) pts.push(await client(x, y));
  await page.mouse.move(pts[0].x, pts[0].y);
  await page.mouse.down();
  for (let i = 1; i < pts.length; i++) { await sleep(30); await page.mouse.move(pts[i].x, pts[i].y, { steps: 3 }); }
  await sleep(200);
  await page.mouse.up();
}
async function scene() { return page.evaluate(() => window.BE.state.scene); }
async function panelType() { return page.evaluate(() => (window.BE.UI.panel ? window.BE.UI.panel.type : null)); }
function see(name) { visited.add(name); }

const RESOLVING = ["FLIGHT", "SETTLE", "TURRETS", "COUNT", "DESCENT", "CHECK", "SETTLE_CANDLE"];
async function waitShotResolved() {
  return waitFor((s) => !RESOLVING.includes(s.scene), "résolution du tir", 60000);
}
async function ensureAim() {
  let s = await state();
  if (s.scene === "NIGHT_INTRO") { await tapLogical(180, 500); s = await waitFor((x) => x.scene !== "NIGHT_INTRO", "fin de l'intro"); }
  return s;
}
async function reloadToTitle() {
  await page.reload();
  await page.waitForFunction(() => window.BE && window.BE.state && window.BE.state.scene === "TITLE");
  await sleep(700);
}
/** Meilleur angle (bot greedy, joué sur une copie de l'état : le run réel n'est pas touché). */
/** Meilleur des 16 angles en Lumière ; un tir qui laisserait le bocal plein à ras (jauge ≥ 97 %) est évité
    si un autre existe — comme un joueur qui regarde la ligne (le test ne touche jamais à la Bougie ni à l'état). */
let reckless = false; // --reckless : le 1er run vise à remplir le bocal (exerce le chemin « défaite par Débordement »)
async function greedy() {
  return page.evaluate((reckless) => {
    const run = window.BE.state.run;
    let best = { a: 90, l: -1, s: -Infinity };
    for (let i = 0; i < 16; i++) {
      const a = 14 + i * (152 / 15);
      const r = window.BE.Debug.trial(run, a);
      const sc = reckless ? r.fill * 1e6 - r.lumiere : r.lumiere - (r.fill >= 0.97 && r.total < run.quota ? 1e9 : 0);
      if (sc > best.s) best = { a, l: r.lumiere, fill: r.fill, s: sc };
    }
    return best;
  }, reckless);
}

// ---------------------------------------------------------------- Aube
let shopNo = 0;
async function closePanels() {
  for (let k = 0; k < 4; k++) {
    const p = await panelType();
    if (!p) return;
    if (!(await tapRegion("pickCancel", true)) && !(await tapRegion("bagClose", true)) && !(await tapRegion("packClose", true)) && !(await tapRegion("closeP", true)) && !(await tapRegion("evoOk", true)))
      await page.evaluate(() => { window.BE.UI.panel = null; });
    await sleep(150);
  }
}
/** Achète l'offre i par l'interface (fiche → Acheter → sélecteur éventuel). */
async function buyOffer(i, capture) {
  await tapRegion("offer" + i);
  await sleep(250);
  if (capture) { await shot(capture + "_detail"); }
  if (!(await tapRegion("buy", true))) { await tapRegion("close", true); return false; }
  await sleep(250);
  const p = await panelType();
  if (p === "shopPick") {
    // Teinturier : choisir une couleur si demandé ; gravure : une étoile est présélectionnée
    if (await hasRegion("colorbraise")) await tapRegion("colorbraise");
    if (capture) await shot(capture + "_picker");
    await tapRegion("pickOk", true);
    await sleep(200);
    if (await panelType()) { await tapRegion("pickOk", true); await sleep(200); } // confirmation (remplacement)
    if (await panelType()) await tapRegion("pickCancel", true);
  }
  await sleep(150);
  if (await hasRegion("close")) await tapRegion("close", true);
  return true;
}
async function shopVisit(opts) {
  opts = opts || {};
  shopNo++;
  let s = await waitFor((x) => x.scene === "SHOP", "Aube", 30000);
  await sleep(900); // cartes qui se retournent, récompense qui tombe
  // animation d'évolution éventuelle
  if ((await panelType()) === "evolve") { await sleep(1700); if (opts.capture) await shot("shop_evolution"); await closePanels(); }
  if (opts.capture) { await shot(opts.capture); see("shop"); }
  if (opts.gold) await page.evaluate((n) => window.BE.Test.giveGold(n), opts.gold);
  if (opts.lock) {
    s = await state();
    const li = s.offers.findIndex((o) => !o.sold);
    if (li >= 0) { await tapRegion("lock" + li); await sleep(300); if (opts.capture) await shot(opts.capture + "_lock"); }
  }
  s = await state();
  const slots = await page.evaluate(() => window.BE.state.run.rules.relicSlots);
  const g0 = s.gold;
  let bought = 0;
  for (let i = 0; i < 3; i++) {
    s = await state();
    const o = s.offers[i];
    if (!o || o.sold || o.price > s.gold) continue;
    if (o.kind === "relic" && s.relics.length >= slots) continue;
    if (await buyOffer(i, opts.capture && bought === 0 ? opts.capture : null)) bought++;
  }
  s = await state();
  log("Aube " + shopNo + " (L" + s.lune + " N" + s.nuit + ") : or " + g0 + " → " + s.gold + ", reliques [" + s.relics.join(",") + "], sac " + s.bag);
  if (opts.expectBuy && bought && s.gold >= g0) throw new Error("aucun achat n'a été débité");
  await closePanels();
  if (opts.reroll) {
    const g1 = (await state()).gold;
    await tapRegion("reroll");
    await sleep(700);
    if ((await state()).gold >= g1 && g1 >= 2) throw new Error("la relance n'a pas été payée");
    if (opts.capture) await shot("shop_reroll");
  }
  if (opts.pack) {
    await page.evaluate(() => window.BE.Test.giveGold(6));
    await tapRegion("pack");
    await sleep(400);
    await shot("constellation_closed"); see("constellation");
    await tapRegion("packOpen");
    await sleep(500);
    await shot("constellation_spin");
    await sleep(1600);
    await tapRegion("card0", true); await sleep(300);
    await shot("constellation_pick");
    await tapRegion("packTake", true); await sleep(400);
    if ((await panelType()) === "shopPick") { if (await hasRegion("colorbraise")) await tapRegion("colorbraise"); await tapRegion("pickOk", true); await sleep(300); }
    if ((await panelType()) === "pack" && (await hasRegion("card1"))) { await tapRegion("card1", true); await sleep(200); await tapRegion("packTake", true); await sleep(300); } // JACKPOT : 2e choix
    await closePanels();
  }
  if (opts.bag) {
    await page.evaluate(() => window.BE.Test.giveGold(4));
    await tapRegion("bag");
    await sleep(400);
    await shot("shop_bag"); see("shopBag");
    const star = await page.evaluate(() => { const r = window.BE.UI.regions().find((q) => /^star\d+$/.test(q.id)); return r ? r.id : null; });
    const n0 = (await state()).bag;
    if (star) {
      await tapRegion(star); await tapRegion("purge"); await sleep(150);
      if (await panelType()) await tapRegion("purge", true);
      await sleep(250);
      await shot("shop_bag_purged");
      const n1 = (await state()).bag;
      if (n0 > 6 && n1 !== n0 - 1) throw new Error("Épurer n'a pas retiré d'étoile (" + n0 + " → " + n1 + ")");
    }
    await closePanels();
  }
  if (opts.drag) {
    s = await state();
    if (s.relics.length >= 2) {
      const r0 = await page.evaluate(() => window.BE.Test.region("relic0"));
      const r1 = await page.evaluate(() => window.BE.Test.region("relic1"));
      const before = s.relics.join(",");
      const y = r0.y + r0.h / 2;
      await touchDrag([[r0.x + r0.w / 2, y], [r0.x + r0.w / 2 + 20, y], [r1.x + r1.w / 2, y], [r1.x + r1.w / 2 + 6, y]], "shop_relic_drag");
      await sleep(300);
      const after = (await state()).relics.join(",");
      log("glisser-déposer :", before, "→", after);
      if (after === before) throw new Error("le glisser-déposer des reliques n'a rien changé");
    }
    // fiche d'une relique possédée (aperçu chiffré + Vendre)
    if (s.relics.length) { await tapRegion("relic0"); await sleep(300); await shot("shop_relic_sheet"); await tapRegion("relic0"); await sleep(150); }
  }
  if (opts.capture) await shot(opts.capture + "_after");
  await page.evaluate(() => window.BE.Test.setTurbo(1)); // l'intro de nuit se lit à vitesse normale
  await tapRegion("nextNight");
  await waitFor((x) => x.scene === "NIGHT_INTRO" || x.scene === "AIM", "nuit suivante");
}

// ---------------------------------------------------------------- une nuit jouée par le bot
/** Défaite réelle du bot (Débordement) : un chemin de jeu valide, pas une erreur du jeu (voir la boucle des Lunes 1–2). */
class RunLost extends Error {
  constructor(s) { super("run perdu (" + (s.result && s.result.cause) + ") en L" + s.lune + " N" + (s.nuit + 1)); this.state = s; }
}
async function checkLost(s) {
  if (s.result && !s.result.won) throw new RunLost(s);
  return s;
}
async function playNight(opts) {
  opts = opts || {};
  let s = await state();
  if (s.scene === "NIGHT_INTRO") {
    if (opts.introShot) { await sleep(500); await shot(opts.introShot); }
    s = await ensureAim();
  }
  await page.evaluate(() => window.BE.Test.setTurbo(4));
  if (opts.pending && s.scene === "AIM") {
    // reprise d'un tir en attente (anti-save-scum, GDD §12.6) : on recharge pendant le vol, « Continuer » rejoue le tir
    const before = s;
    const b = await greedy();
    await page.evaluate(() => window.BE.Test.setTurbo(1));
    await page.evaluate((a) => window.BE.Test.shoot(a), b.a);
    await sleep(150);
    await reloadToTitle();
    await shot("title_continuer");
    await tapRegion("continue");
    s = await waitFor((x) => x.scene !== "TITLE", "reprise du run");
    log("  reprise :", s.scene, "tir", s.shotIndex, "(avant :", before.shotIndex + ")");
    if (s.shotIndex !== before.shotIndex + 1) throw new Error("le tir en attente n'a pas été rejoué");
    await page.evaluate(() => window.BE.Test.setTurbo(4));
    s = await checkLost(await waitShotResolved());
  }
  let guard = 0;
  while (s.scene === "AIM" && guard++ < 12) {
    const b = await greedy();
    if (!reckless && s.shotsLeft <= 1 && s.total + b.l < s.quota) {
      // le bot ne peut plus gagner : on force la nuit (le test vise le parcours, pas l'équilibrage)
      log("  nuit forcée (L" + s.lune + " N" + s.nuit + " : " + s.total + " + " + b.l + " < " + s.quota + ")");
      await page.evaluate(() => window.BE.Test.winNight());
      break;
    }
    await page.evaluate((a) => window.BE.Test.shoot(a), b.a);
    s = await waitShotResolved();
    log("  tir " + b.a.toFixed(1) + "° :", s.scene, s.total + "/" + s.quota, "bocal", s.jar, "or", s.gold);
  }
  s = await checkLost(await state());
  if (opts.wonShots) {
    await page.evaluate(() => window.BE.Test.setTurbo(1));
    s = await waitFor((x) => x.scene === "NIGHT_WON" || x.scene === "SHOP" || x.scene === "RUN_END", "NIGHT_WON", 20000);
    await checkLost(s);
    if (s.scene === "NIGHT_WON") { await sleep(1300); await shot(opts.wonShots); see("nightWon"); }
    if (opts.vidange) {
      s = await waitFor((x) => x.scene === "VIDANGE" || x.scene === "SHOP", "VIDANGE", 20000);
      if (s.scene === "VIDANGE") { await sleep(700); await shot("vidange"); see("vidange"); }
    }
    await page.evaluate(() => window.BE.Test.setTurbo(4));
  }
  return checkLost(await waitFor((x) => x.scene === "SHOP" || x.scene === "RUN_END" || x.scene === "RUN_WON", "fin de nuit", 30000));
}

// ================================================================================================
(async () => {
  const quick = process.argv.includes("--quick");
  reckless = process.argv.includes("--reckless");
  fs.mkdirSync(SHOTS, { recursive: true });
  for (const f of fs.readdirSync(SHOTS)) if (f.endsWith(".png")) fs.unlinkSync(path.join(SHOTS, f));
  const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  await ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: "file://" }).catch(() => {});
  page = await ctx.newPage();
  page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });
  page.on("pageerror", (e) => errors.push("pageerror: " + (e.stack || e.message)));
  page.on("requestfailed", (r) => errors.push("requestfailed: " + r.url()));
  cdp = await ctx.newCDPSession(page);
  const t0 = Date.now();

  try {
    await page.goto(URL);
    await page.waitForFunction(() => window.BE && window.BE.Test && window.BE.state && window.BE.state.scene === "TITLE");
    await page.evaluate(() => { try { localStorage.clear(); } catch (e) { /* */ } });
    await reloadToTitle();
    await shot("title"); see("title");

    // ------------------------------------------------------------ réglages depuis le titre
    await tapRegion("set");
    await sleep(300);
    await shot("settings_son"); see("settings");
    await tapRegion("setTab1"); await sleep(200);
    await shot("settings_affichage");
    await tapRegion("setTab2"); await sleep(200);
    await shot("settings_jeu");
    await tapRegion("closeS");
    if (await panelType()) throw new Error("les réglages ne se ferment pas");

    // ------------------------------------------------------------ Observatoire
    await tapRegion("obs");
    await waitFor((s) => s.scene === "OBSERVATORY", "OBSERVATORY");
    await sleep(500);
    await shot("observatoire"); see("observatoire");
    await page.evaluate(() => window.BE.Meta.dev.frags(40));
    await tapRegion("room_serre"); await sleep(400);
    await shot("observatoire_salle");
    await tapRegion("build"); await sleep(150);
    await tapRegion("build"); await sleep(2400);
    await shot("observatoire_construite");
    await tapRegion("defis"); await sleep(400); // bouton « Défis » de l'Observatoire
    if ((await scene()) !== "GRIMOIRE") throw new Error("le bouton Défis de l'Observatoire n'ouvre pas le Grimoire");
    await tapRegion("back");
    await waitFor((s) => s.scene === "OBSERVATORY", "retour à l'Observatoire");
    await sleep(350);
    if (!(await page.evaluate(() => window.BE.Meta.built("serre")))) throw new Error("la Serre n'a pas été construite");
    await tapRegion("back");
    await waitFor((s) => s.scene === "TITLE", "TITLE");

    // ------------------------------------------------------------ Grimoire + Défis
    await tapRegion("grim");
    await waitFor((s) => s.scene === "GRIMOIRE", "GRIMOIRE");
    await sleep(500);
    await shot("grimoire_etoiles"); see("grimoire");
    for (const [i, n] of [[1, "reactions"], [3, "reliques"], [4, "ombres"]]) { await tapRegion("tab" + i); await sleep(300); await shot("grimoire_" + n); }
    await tapRegion("tab5"); await sleep(400);
    await shot("defis"); see("defis");
    await tapRegion("back");
    await waitFor((s) => s.scene === "TITLE", "TITLE");

    // ------------------------------------------------------------ Ciel du Jour (écran)
    await tapRegion("daily");
    await waitFor((s) => s.scene === "DAILY", "DAILY");
    await sleep(500);
    await shot("ciel_du_jour"); see("daily");
    await tapRegion("back");
    await waitFor((s) => s.scene === "TITLE", "TITLE");

    // ------------------------------------------------------------ Sélection
    await tapRegion("new");
    await waitFor((s) => s.scene === "SELECT", "SELECT");
    await sleep(500);
    await shot("select"); see("select");
    await tapRegion("next"); await sleep(600);
    await shot("select_verrouille");
    await tapRegion("prev"); await sleep(600);
    // graine fixe : le parcours joué par le bot est reproductible (Lunes 1–2 sans Débordement avec cette graine)
    await page.evaluate((seed) => { const U = window.BE.util; U._newSeed = U.newSeed; U.newSeed = () => { U.newSeed = U._newSeed; return seed; }; }, SMOKE_SEED);
    await tapRegion("launch");
    await waitFor((s) => s.scene === "NIGHT_INTRO", "NIGHT_INTRO");
    await sleep(500);
    await shot("intro_L1"); see("intro");
    await ensureAim();
    await sleep(400);
    await shot("aim"); see("game");
    let s;

    // ------------------------------------------------------------ pause et ses panneaux
    {
      await tapLogical(336, 22);
      await waitFor((x) => x.paused, "pause");
      await sleep(300);
      await shot("pause"); see("pause");
      await tapRegion("pbag"); await sleep(300); await shot("pause_sac"); await tapRegion("closeP");
      await tapRegion("prel"); await sleep(300); await shot("pause_reliques"); await tapRegion("closeP");
      await tapRegion("pset"); await sleep(300); await tapRegion("setTab2"); await sleep(150); await shot("pause_reglages"); await tapRegion("closeS");
      await tapRegion("pgrim"); await sleep(500); await shot("pause_grimoire");
      await page.keyboard.press("Escape"); await sleep(200);
      if (await page.evaluate(() => !!(window.BE.Meta && window.BE.Meta.overlay))) throw new Error("Échap ne ferme pas le Grimoire de la pause");
      await tapRegion("resume");
      await waitFor((x) => !x.paused, "reprise");
    }

    // ------------------------------------------------------------ Lune 1, nuit 1 : tirs tactile + souris
    await touchDrag([[200, 480], [150, 470], [110, 450]], "aim_touch");
    await waitFor((s) => s.scene !== "AIM", "départ du tir 1");
    await sleep(250);
    await shot("flight");
    s = await waitFor((x) => x.scene === "COUNT" || !RESOLVING.includes(x.scene), "décompte", 30000);
    if (s.scene === "COUNT") { await sleep(400); await shot("count"); }
    s = await waitShotResolved();
    log("après tir 1 :", s.scene, s.total + "/" + s.quota);
    if (s.scene === "AIM") {
      await mouseDrag([[180, 500], [230, 480], [260, 440]]);
      await waitFor((x) => x.scene !== "AIM", "départ du tir 2");
      s = await waitShotResolved();
      log("après tir 2 (souris) :", s.scene, s.total + "/" + s.quota);
    }

    // ------------------------------------------------------------ Lunes 1 et 2 jouées par le bot, Aube à chaque nuit
    // Le bot joue pour de vrai, sans jamais toucher à la Bougie ni au bocal : un Débordement est une issue normale du
    // jeu. Il est alors vérifié (écran de fin, cause « Débordement »), puis un nouveau run est lancé avec une autre graine.
    let lostOverflow = 0;
    for (let attempt = 0; ; attempt++) {
      try {
        await page.evaluate(() => window.BE.Test.setTurbo(4));
        // L1 N1
        s = await playNight({ wonShots: "nuit_gagnee" });
        await shopVisit({ capture: "shop_L1N1", gold: 20, reroll: true, expectBuy: true });
        // L1 N2 (avec rechargement pendant un tir)
        s = await playNight({ pending: true });
        await shopVisit({ gold: 20, pack: true });
        // L1 Boss → Vidange
        s = await playNight({ introShot: "intro_boss_L1", wonShots: "nuit_gagnee_boss", vidange: true });
        await shopVisit({ capture: "shop_apres_vidange", gold: 25, bag: true, drag: true });
        if ((await state()).lune !== 2) throw new Error("pas de Lune 2 après la Vidange");
        // L2 N1 (intro avec « Nouvelle Ombre »)
        s = await playNight({ introShot: "intro_L2" });
        // reprise pendant l'Aube : l'état de l'Aube doit être identique
        await waitFor((x) => x.scene === "SHOP", "Aube L2");
        await sleep(600);
        const shopBefore = await page.evaluate(() => JSON.stringify(window.BE.state.run.shop.offers) + "|" + window.BE.state.run.gold);
        await reloadToTitle();
        await tapRegion("continue");
        await waitFor((x) => x.scene === "SHOP", "reprise dans l'Aube");
        const shopAfter = await page.evaluate(() => JSON.stringify(window.BE.state.run.shop.offers) + "|" + window.BE.state.run.gold);
        if (shopAfter !== shopBefore) throw new Error("l'Aube reprise diffère de l'Aube sauvegardée");
        log("reprise dans l'Aube : identique");
        await page.evaluate(() => window.BE.Test.setTurbo(4));
        await shopVisit({ gold: 15, lock: true, capture: "shop_L2N1" });
        // L2 N2
        s = await playNight();
        await shopVisit({ gold: 15 });
        // L2 Boss
        s = await playNight({ introShot: "intro_boss_L2" });
        await shopVisit({ gold: 10, capture: quick ? null : "shop_L3" });
        s = await state();
        if (s.lune !== 3) throw new Error("Lune 3 non atteinte (L" + s.lune + ")");
        log("Lunes 1 et 2 terminées — " + ((Date.now() - t0) / 1000).toFixed(0) + " s");
        break;
      } catch (e) {
        if (!(e instanceof RunLost) || attempt >= 3) throw e;
        const ls = e.state, wasReckless = reckless;
        reckless = false;
        // le bot normal force la nuit plutôt que de manquer le quota ; le bot --reckless peut perdre des deux façons
        if (ls.result.cause !== "overflow" && !wasReckless) throw new Error("défaite inattendue du bot : " + e.message);
        lostOverflow++;
        log("  " + e.message + " — chemin de défaite valide, nouveau run");
        s = await waitFor((x) => x.scene === "RUN_END", "écran de fin après Débordement", 20000);
        await sleep(2200);
        await shot("fin_de_run_defaite_bot"); see("runLost_" + ls.result.cause);
        await tapRegion("menu");
        await waitFor((x) => x.scene === "TITLE", "TITLE");
        if (await page.evaluate(() => window.BE.Save.hasRun())) throw new Error("run perdu encore reprenable");
        await tapRegion("new");
        await waitFor((x) => x.scene === "SELECT", "SELECT");
        await sleep(400);
        const seed = SMOKE_SEED + "-R" + (attempt + 1);
        await page.evaluate((seed) => { const U = window.BE.util; U._newSeed = U.newSeed; U.newSeed = () => { U.newSeed = U._newSeed; return seed; }; }, seed);
        await tapRegion("launch");
        await waitFor((x) => x.scene === "NIGHT_INTRO", "NIGHT_INTRO");
        await ensureAim();
        s = await state();
      }
    }
    if (lostOverflow) log("Débordements du bot pendant les Lunes 1–2 : " + lostOverflow);

    // ------------------------------------------------------------ Lunes 3 à 5 en accéléré → victoire
    for (let k = 0; k < 12; k++) {
      s = await ensureAim();
      if (s.scene === "RUN_WON" || s.scene === "RUN_END") break;
      if (s.lune === 5 && s.nuit === 2 && k < 12) {
        await sleep(300); await shot("boss_eclipse"); // L'Éclipse (dernier boss)
      }
      await page.evaluate(() => window.BE.Test.winNight());
      s = await waitFor((x) => ["SHOP", "RUN_WON", "RUN_END"].includes(x.scene), "Aube / victoire", 30000);
      if (s.scene !== "SHOP") break;
      await sleep(300);
      await tapRegion("nextNight");
      await waitFor((x) => x.scene === "NIGHT_INTRO" || x.scene === "AIM", "nuit suivante");
    }
    await page.evaluate(() => window.BE.Test.setTurbo(1));
    s = await waitFor((x) => x.scene === "RUN_WON" || x.scene === "RUN_END", "victoire", 20000);
    if (s.scene === "RUN_WON") { await sleep(900); await shot("victoire"); see("runWon"); }
    s = await waitFor((x) => x.scene === "RUN_END", "RUN_END", 20000);
    if (!s.result || !s.result.won) throw new Error("le run n'est pas gagné");
    await sleep(2600);
    await shot("fin_de_run_victoire"); see("runEnd");
    await tapRegion("share"); await sleep(300);
    const shared = await page.evaluate(() => window.BE.Meta.lastShared || "");
    if (!/BOCAL D'ÉTOILES/.test(shared)) throw new Error("partage vide : " + shared);
    log("partage :", JSON.stringify(shared));

    // ------------------------------------------------------------ Nuit Blanche (Planétarium) : Lune 6 puis défaite
    await page.evaluate(() => window.BE.Meta.dev.room("planetarium"));
    await sleep(400);
    await shot("fin_de_run_victoire_nuit_blanche");
    await tapRegion("nuitBlanche");
    s = await waitFor((x) => x.scene === "SHOP", "Aube de la Nuit Blanche", 20000);
    await sleep(900);
    await shot("nuit_blanche_aube"); see("nuitBlanche");
    await tapRegion("nextNight");
    s = await waitFor((x) => x.scene === "NIGHT_INTRO" || x.scene === "AIM", "Lune 6");
    if (s.lune !== 6) throw new Error("la Nuit Blanche n'est pas passée en Lune 6 (L" + s.lune + ")");
    await sleep(500);
    await shot("intro_L6_nuit_blanche");
    await ensureAim();
    await page.evaluate(() => window.BE.Test.lose("quota"));
    await waitFor((x) => x.scene === "RUN_END", "fin de la Nuit Blanche", 10000);
    await sleep(2400);
    await shot("fin_de_run_nuit_blanche");
    await tapRegion("menu");
    await waitFor((x) => x.scene === "TITLE", "TITLE");
    await sleep(900);
    await shot("title_apres_victoire");

    // ------------------------------------------------------------ 2e run : Éclipse 1, abandon depuis la pause
    await tapRegion("new");
    await waitFor((x) => x.scene === "SELECT", "SELECT");
    await sleep(400);
    if (await hasRegion("ecPlus")) await tapRegion("ecPlus");
    await sleep(300);
    await shot("select_eclipse");
    await tapRegion("launch");
    await waitFor((x) => x.scene === "NIGHT_INTRO", "NIGHT_INTRO");
    const ecl = await page.evaluate(() => window.BE.state.run.eclipse);
    log("2e run, Éclipse", ecl);
    await ensureAim();
    await sleep(200);
    await tapLogical(336, 22);
    await waitFor((x) => x.paused, "pause");
    await tapRegion("abandon"); await sleep(200);
    await shot("pause_abandon");
    await tapRegion("abandon");
    await waitFor((x) => x.scene === "RUN_END", "RUN_END abandon", 10000);
    await sleep(1800);
    await shot("fin_de_run_abandon");
    await tapRegion("menu");
    await waitFor((x) => x.scene === "TITLE", "TITLE");

    // ------------------------------------------------------------ Ciel du Jour joué → Débordement
    await tapRegion("daily");
    await waitFor((x) => x.scene === "DAILY", "DAILY");
    await sleep(300);
    await tapRegion("dailyPlay");
    s = await waitFor((x) => x.scene === "NIGHT_INTRO" || x.scene === "AIM" || x.paused === undefined, "run du jour");
    await ensureAim();
    await sleep(300);
    await shot("ciel_du_jour_jeu");
    await page.evaluate(() => window.BE.Test.lose("overflow"));
    await waitFor((x) => x.scene === "RUN_END", "RUN_END daily", 10000);
    await sleep(2200);
    await shot("fin_de_run_ciel_du_jour");
    await tapRegion("menu");
    await waitFor((x) => x.scene === "TITLE", "TITLE");
    await sleep(800);
    await shot("title_fin");
    const daily = await page.evaluate(() => window.BE.Meta.dailyInfo());
    if (!daily.done) throw new Error("le Ciel du Jour n'est pas marqué comme joué");
  } catch (e) {
    errors.push("script: " + (e.stack || e.message));
    try { await shot("ECHEC"); } catch (e2) { /* */ }
  }

  await browser.close();
  log("écrans visités : " + [...visited].join(", ") + " — " + ((Date.now() - t0) / 1000).toFixed(0) + " s");
  if (errors.length) {
    console.error("\n[smoke] ÉCHEC — " + errors.length + " erreur(s) :");
    for (const e of errors) console.error("  - " + e);
    process.exit(1);
  }
  log("OK — aucune erreur.");
})();
