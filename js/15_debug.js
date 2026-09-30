/* 15_debug.js — BE.Debug : outils de debug, bots headless et tests unitaires (GDD §13.1, §13.2).
 *
 *  - Overlay (index.html#debug) : FPS, ms logique / rendu, corps, particules, scène, graine, flux RNG.
 *  - Raccourcis (#debug) : G +50 or · N gagner la nuit · J remplir le bocal · B ajouter une relique au choix ·
 *    K tuer les Ombres · 1..7 lâcher une étoile à la souris · T tests unitaires · M simuler 10 runs ·
 *    H aide · ² (Backquote) masquer l'overlay.
 *  - Bots : BE.Debug.simulate({runs, policy, gardien, eclipse, shop, seed, all}) → Promise<résultat>
 *    (simulateSync pour la version synchrone). La logique du jeu tourne dans un BAC À SABLE : BE.state est
 *    remplacé par un état jetable, le bus d'événements est coupé (BE.muteEvents), l'audio est débranché et
 *    les écritures BE.Save sont neutralisées. Rien ne fuit vers la partie en cours ni vers localStorage.
 *  - Tests : BE.Debug.tests() → {passed, failed, total, ms, results:[{group, name, ok, msg, ms}]}.
 */
(function (BE) {
  "use strict";

  const Dbg = (BE.Debug = {});
  const D = BE.DATA, U = BE.util;
  const DT = D.PHYS.dt;
  const NIGHT = ["Mince", "Pleine", "Boss"];

  Dbg.enabled = /debug/.test((typeof location !== "undefined" && location.hash) || "");
  Dbg.visible = true;

  // Fonctions de sauvegarde d'origine (les tests de sauvegarde les utilisent même dans le bac à sable).
  const SaveOrig = { saveRun: BE.Save.saveRun, loadRun: BE.Save.loadRun, clearRun: BE.Save.clearRun, saveMeta: BE.Save.saveMeta };

  // =====================================================================================================
  // BAC À SABLE
  // =====================================================================================================
  const stack = [];
  /** État jetable (même forme que BE.state). */
  function makeState(meta) {
    return {
      scene: "BOOT", prevScene: null, sceneT: 0, time: BE.state ? BE.state.time : 0, frameDt: 0, paused: false,
      run: null, meta: meta || BE.Save.defaultMeta(), play: null, turbo: 1, ui: {}, sandbox: true,
    };
  }
  Dbg.makeState = makeState;

  /** Méta pour une simulation : neuve (contenu de départ), ou copie de la méta du joueur, + salles demandées. */
  function simMeta(opts) {
    opts = opts || {};
    let m;
    if (opts.meta) m = U.deepCopy(opts.meta);
    else if (opts.playerMeta && BE.state && BE.state.meta) m = U.deepCopy(BE.state.meta);
    else m = BE.Save.defaultMeta();
    if (opts.rooms) for (const r of opts.rooms) if (m.rooms.indexOf(r) < 0) m.rooms.push(r);
    return m;
  }
  Dbg.simMeta = simMeta;

  function enter(st, all) {
    const fr = { state: BE.state, mute: BE.muteEvents, audio: BE.Audio, forceAll: BE.Meta ? BE.Meta.forceAll : false, save: null };
    if (!stack.length) {
      fr.save = { saveRun: BE.Save.saveRun, saveMeta: BE.Save.saveMeta, clearRun: BE.Save.clearRun };
      BE.Save.saveRun = () => true;
      BE.Save.saveMeta = () => true;
      BE.Save.clearRun = () => true;
    }
    stack.push(fr);
    BE.state = st;
    BE.muteEvents = true;
    BE.Audio = null;
    if (BE.Meta && all !== undefined) BE.Meta.forceAll = !!all;
    BE.Run.invalidatePassives();
  }
  function leave() {
    const fr = stack.pop();
    BE.state = fr.state;
    BE.muteEvents = fr.mute;
    BE.Audio = fr.audio;
    if (BE.Meta) BE.Meta.forceAll = fr.forceAll;
    if (fr.save) Object.assign(BE.Save, fr.save);
    BE.Run.invalidatePassives();
  }
  /** Exécute fn(st) avec BE.state = st (événements coupés, sauvegarde neutralisée). all : tout le contenu débloqué. */
  Dbg.inSandbox = function (st, fn, all) {
    enter(st, all);
    try { return fn(st); } finally { leave(); }
  };
  Dbg.sandboxDepth = () => stack.length;

  /** État transitoire vierge (même forme que celui créé par BE.Run). */
  function freshPlay() {
    return {
      pegs: [], log: [], orphanLog: [], flight: null, shot: null,
      aim: { active: false, angle: 90, cancel: false, prev: null, prevAngle: -999, dirty: true, kbd: false },
      count: null, turret: null, descent: null, won: null, lost: null, settleT: 0, world: null,
      live: { eclat: 0, mult: 1 }, reserveShown: 0,
    };
  }
  Dbg.freshPlay = freshPlay;

  /**
   * Nouveau run dans un bac à sable, positionné en AIM. fn(run, st) est appelée dans le bac à sable.
   * opts : {gardien, seed, eclipse, relics, meta, rooms, all}
   */
  function withRun(opts, fn) {
    opts = opts || {};
    const st = makeState(simMeta(opts));
    return Dbg.inSandbox(st, () => {
      BE.Run.startNewRun({ gardien: opts.gardien || "veilleuse", seed: opts.seed || "TEST-0000", eclipse: opts.eclipse || 0, relics: opts.relics });
      BE.Run.go("AIM");
      return fn(st.run, st);
    }, opts.all);
  }
  Dbg.withRun = withRun;

  // =====================================================================================================
  // AVANCE DE LA LOGIQUE (sans rendu)
  // =====================================================================================================
  const STABLE = { AIM: 1, SHOP: 1, RUN_LOST: 1, RUN_WON: 1, RUN_END: 1, NIGHT_INTRO: 1 };
  Dbg.STABLE = STABLE;
  const RES = { FLIGHT: 1, SETTLE: 1, TURRETS: 1, DESCENT: 1, SETTLE_CANDLE: 1 };

  /**
   * Fait tourner la logique jusqu'à until(st) (ou maxSteps). Le décompte (COUNT) est avancé d'un coup.
   * hook(from, to, st) est appelé à chaque changement de scène ; tick(st, dt) à chaque pas.
   */
  function advance(st, until, maxSteps, hook, tick) {
    let n = 0, last = st.scene;
    const lim = maxSteps || 200000;
    while (n < lim) {
      if (until(st)) break;
      if (st.scene === "COUNT" && st.play && st.play.count && !st.play.count.done) st.play.count.t = Math.max(st.play.count.t, st.play.count.endAt);
      if (tick) tick(st, DT);
      BE.Run.update(DT);
      n++;
      if (st.scene !== last) { const f = last; last = st.scene; if (hook) hook(f, last, st); }
    }
    return n;
  }
  Dbg.advance = advance;

  /** Tire à `angle` dans l'état courant (AIM) et avance jusqu'à une scène stable. Renvoie le nombre de pas. */
  function shootSync(st, angle, hook, tick) {
    if (st.scene === "NIGHT_INTRO") BE.Run.go("AIM");
    if (st.scene !== "AIM" || !BE.Run.fire(angle)) return -1;
    if (hook) hook("AIM", st.scene, st);
    return advance(st, (s) => !!STABLE[s.scene], 400000, hook, tick);
  }
  Dbg.shootSync = shootSync;

  /** Empreinte de l'état d'un run (bocal, score, Firmament, or) : entier FNV-1a. */
  function runHash(run) {
    const f = run.firm;
    const sh = f.shadows.filter((s) => s.alive).map((s) => s.id + ":" + s.type + ":" + s.col + ":" + s.row + ":" + s.hp + ":" + s.counter + ":" + (s.frozen ? 1 : 0)).join(",");
    const b = f.boss ? f.boss.hp + ":" + f.boss.row + ":" + f.boss.alive : "-";
    return U.fnv1a([BE.Phys.hashJar(run.jar), run.total, run.gold, run.reserve, run.shotsLeft, sh, b, f.ghost.map((g) => g.type + g.col).join(","),
      JSON.stringify(run.streams), run.lastShot ? run.lastShot.lumiere : -1].join("|"));
  }
  Dbg.runHash = runHash;

  // =====================================================================================================
  // POLITIQUES DE TIR ET DE BOUTIQUE (§13.1)
  // =====================================================================================================
  /** Évalue un tir sur une COPIE de l'état : {lumiere, fill, total}. Ne modifie pas le run réel. */
  function trial(run, angle) {
    const outer = BE.state;
    const st = makeState(outer.meta);
    st.run = U.deepCopy(run);
    st.play = freshPlay();
    st.scene = "AIM";
    return Dbg.inSandbox(st, () => {
      BE.Run.ensureDraw(st.run);
      BE.Run.refreshPegs();
      if (!BE.Run.fire(angle)) return { lumiere: 0, fill: 1, total: 0 };
      let res = null;
      advance(st, (s) => {
        if (s.scene === "COUNT" && s.play.count) { res = s.play.count.res; return true; }
        return !!STABLE[s.scene];
      }, 60000);
      return { lumiere: res ? res.lumiere : 0, fill: BE.Jar.fill(st.run), total: st.run.total + (res ? res.lumiere : 0) };
    }, BE.Meta ? BE.Meta.forceAll : undefined);
  }
  Dbg.trial = trial;

  function candidates(rng, n) {
    const a0 = D.GEOM.aimMin, a1 = D.GEOM.aimMax, step = (a1 - a0) / (n - 1);
    const out = [];
    const jit = (rng() - 0.5) * step * 0.9;
    for (let i = 0; i < n; i++) out.push(U.clamp(a0 + i * step + (i > 0 && i < n - 1 ? jit : 0), a0, a1));
    return out;
  }
  function bestOf(run, rng, scoreFn, withScore, n) {
    let best = null, bestS = -Infinity;
    for (const a of candidates(rng, n || 24)) {
      const r = trial(run, a);
      const s = scoreFn(r);
      if (s > bestS) { bestS = s; best = a; }
    }
    return withScore ? { angle: best, score: bestS } : best;
  }
  const SCORE_FN = {
    greedy: (r) => r.lumiere,
    safe: (r) => r.lumiere - 500 * (r.fill > 0.7 ? 1 : 0),
  };
  /** Politiques de visée : (run, rng) → angle en degrés. */
  Dbg.POLICIES = {
    random: (run, rng) => D.GEOM.aimMin + rng() * (D.GEOM.aimMax - D.GEOM.aimMin),
    greedy: (run, rng) => bestOf(run, rng, SCORE_FN.greedy),
    safe: (run, rng) => bestOf(run, rng, SCORE_FN.safe),
    /** « Doigt humain » : meilleur de 12 angles, tiré avec une erreur gaussienne σ = 1,5°, sans échange (§13.3). */
    noisy: (run, rng) => {
      const a = bestOf(run, rng, SCORE_FN.greedy, false, 12);
      const u = Math.max(1e-9, rng()), v = rng();
      return U.clamp(a + 1.5 * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v), D.GEOM.aimMin, D.GEOM.aimMax);
    },
  };
  /**
   * Échange (§3.1, §6.6) pour les bots greedy / safe : s'il reste un échange (et pas de Voile), on évalue aussi
   * chaque étoile visible échangeable (24 angles chacune, sur une copie) ; renvoie {swap: j, angle} ou null.
   */
  Dbg.swapChoice = function (run, rng, policy) {
    const fn = SCORE_FN[policy];
    if (!fn || run.swapsLeft <= 0 || BE.Firm.ruleActive(run, "voile")) return null;
    const n = Math.min(Math.max(1, run.rules.previewNext || 1), run.draw.length - 1);
    const here = bestOf(run, rng, fn, true);
    let best = { swap: 0, angle: here.angle, score: here.score };
    const cur = run.draw[0];
    for (let j = 1; j <= n; j++) {
      const o = run.draw[j];
      if (o === cur) continue;
      const it = BE.Run.bagItem(run, o), c = BE.Run.bagItem(run, cur);
      if (it && c && it.size === c.size && it.color === c.color && it.grav === c.grav) continue; // même étoile : inutile
      const cp = U.deepCopy(run);
      cp.draw[0] = o; cp.draw[j] = cur;
      const r = bestOf(cp, rng, fn, true);
      if (r.score > best.score) best = { swap: j, angle: r.angle, score: r.score };
    }
    return best;
  };

  function buyIdx(run, i, rec) {
    const o = run.shop.offers[i];
    const price = o.price;
    const r = BE.Shop.buy(run, i, "auto");
    if (r.ok && rec) rec.spent += price;
    return r.ok;
  }
  /** Politiques de boutique : (run, rec, rng). rec.spent est tenu à jour. */
  Dbg.SHOP_POLICIES = {
    /** §13.1 : relique la plus chère abordable si un emplacement est libre, sinon une étoile de taille 3 ;
        à partir de la Lune 2, on garde 10 or de côté (intérêts). Étendue pour dépenser l'or comme un joueur :
        emplacements pleins → on revend la relique la moins chère pour une plus chère ; clous et gravures quand
        l'or le permet ; relance (au plus 2 par Aube) tant qu'il reste de quoi acheter derrière. */
    default(run, rec) {
      const keep = run.lune >= 2 ? 10 : 0;
      const relicP = (id) => BE.Shop.relicPrice(run, id);
      for (let guard = 0; guard < 14; guard++) {
        const offers = run.shop.offers, budget = run.gold - keep;
        let best = -1;
        const free = run.relics.length < run.rules.relicSlots;
        offers.forEach((o, i) => { if (!o.sold && o.kind === "relic" && o.price <= budget && (best < 0 || o.price > offers[best].price)) best = i; });
        if (best >= 0 && !free) {
          // emplacements pleins : on remplace la relique la moins chère si l'offre est strictement plus chère
          let w = -1;
          run.relics.forEach((r, k) => { if (!r.evolved && (w < 0 || relicP(r.id) < relicP(run.relics[w].id))) w = k; });
          if (w >= 0 && relicP(run.relics[w].id) < offers[best].price && offers[best].price <= budget + BE.Shop.sellPrice(run, run.relics[w].id)) BE.Shop.sell(run, w);
          else best = -1;
        }
        if (best < 0) offers.forEach((o, i) => { if (best < 0 && !o.sold && o.kind === "clou" && o.price <= budget) best = i; });
        if (best < 0) offers.forEach((o, i) => { if (best < 0 && !o.sold && o.kind === "star" && o.size >= 3 && o.price <= budget && run.bag.length < D.ECO.bagMax) best = i; });
        if (best < 0) offers.forEach((o, i) => { if (best < 0 && !o.sold && o.kind === "gravure" && o.price <= budget) best = i; });
        if (best >= 0 && buyIdx(run, best, rec)) continue;
        // rien d'intéressant : relance si l'or restant permet encore un achat derrière
        const S = run.shop;
        if (S.rerolls < 2 && budget >= S.rerollCost + 4) {
          const c = S.rerollCost;
          if (BE.Shop.reroll(run).ok) { if (rec) rec.spent += c; continue; }
        }
        break;
      }
    },
    /** Achat aléatoire (détection des builds dominants, §13.3) : une relique abordable au hasard tant qu'il reste de la place. */
    random(run, rec, rng) {
      for (let guard = 0; guard < 8; guard++) {
        if (run.relics.length >= run.rules.relicSlots) break;
        const c = [];
        run.shop.offers.forEach((o, i) => { if (!o.sold && o.kind === "relic" && o.price <= run.gold) c.push(i); });
        if (!c.length || !buyIdx(run, c[Math.floor(rng() * c.length)], rec)) break;
      }
    },
    none() { /* n'achète rien */ },
  };

  // =====================================================================================================
  // UN RUN COMPLET (sans rendu)
  // =====================================================================================================
  const HUMAN = { aim: 3.5, intro: 2.2, shop: 15, nightWon: 2.6, vidange: 1.5 }; // secondes réelles estimées

  /**
   * Bot pas à pas : chaque step() entre dans le bac à sable, joue UNE action (un tir, une Aube, une transition),
   * puis en ressort. Le run peut donc être étalé sur plusieurs images (simulate asynchrone) sans bloquer la page.
   */
  function Bot(opts, i) {
    opts = opts || {};
    this.opts = opts;
    this.policy = Dbg.POLICIES[opts.policy || "greedy"] || Dbg.POLICIES.random;
    this.shopPol = Dbg.SHOP_POLICIES[opts.shop || "default"] || Dbg.SHOP_POLICIES.default;
    const seed = (opts.seed || "SIM") + "-" + (i || 0);
    this.rng = U.mulberry32(U.fnv1a(seed + "|bot|" + (opts.policy || "greedy")));
    this.rec = {
      seed, gardien: opts.gardien || "veilleuse", eclipse: opts.eclipse || 0, policy: opts.policy || "greedy", shopPolicy: opts.shop || "default",
      won: false, cause: null, lune: 1, nuit: 0, nightsWon: 0, shots: 0, nights: [], light: {}, reactions: {}, mergeSizes: {},
      bigBang: false, bigBangs: 0, goldEarned: 0, goldSpent: 0, goldEnd: 0, spent: 0, relics: [], relicsEver: [],
      simTime: 0, estTime: 0, steps: 0, error: null, kills: 0, stones: 0, maxSize: 0, wallMs: 0,
    };
    this.st = makeState(simMeta(opts));
    this.night = null; this.started = false; this.done = false; this.guard = 0;
    const rec = this.rec, self = this;
    this.hook = (from, to, s) => {
      const run = s.run, night = self.night;
      if (to === "COUNT" && s.play.count) {
        const res = s.play.count.res, L = run.lune;
        const b = rec.light[L] || (rec.light[L] = { sum: 0, shots: 0 });
        b.sum += res.lumiere; b.shots++;
        for (const m of s.play.count.ctx.merges) rec.mergeSizes[m.size] = (rec.mergeSizes[m.size] || 0) + 1;
        if (s.play.count.ctx.bigBang) rec.mergeSizes[8] = (rec.mergeSizes[8] || 0) + 1;
        rec.estTime += s.play.count.endAt;
      }
      // remplissage au moment où la nuit est gagnée (avant l'évaporation du trop-plein) : jauge + part surfacique
      if (to === "NIGHT_WON" && night) { night.won = true; night.shots = run.shotIndex; night.fill = s.play.won && s.play.won.fill !== undefined ? s.play.won.fill : BE.Jar.fill(run); night.area = s.play.won && s.play.won.area !== undefined ? s.play.won.area : BE.Jar.areaFill(run); night.total = run.total; rec.nightsWon++; rec.estTime += HUMAN.nightWon; }
      if (to === "VIDANGE") rec.estTime += HUMAN.vidange;
      if (to === "RUN_LOST" && night) { night.won = false; night.shots = run.shotIndex; night.fill = BE.Jar.fill(run); night.area = BE.Jar.areaFill(run); night.total = run.total; }
    };
    this.tick = (s, dt) => {
      rec.simTime += dt;
      if (RES[s.scene]) {
        const T = s.play && s.play.shot ? s.play.shot.t : 0;
        rec.estTime += dt / (T >= D.PHYS.speed.auto3 ? 3 : T >= D.PHYS.speed.auto2 ? 2 : 1);
      }
    };
  }
  /** Une action. Renvoie true quand le run est terminé. */
  Bot.prototype.step = function () {
    if (this.done) return true;
    const t0 = now(), self = this, rec = this.rec, st = this.st, opts = this.opts;
    try {
      Dbg.inSandbox(st, () => {
        if (!self.started) {
          self.started = true;
          BE.Run.startNewRun({ gardien: rec.gardien, seed: rec.seed, eclipse: rec.eclipse, relics: opts.relics });
          return;
        }
        const run = st.run;
        if (run.result || self.guard++ > 5000) { self.done = true; return; }
        const sc = st.scene;
        if (sc === "NIGHT_INTRO") { BE.Run.go("AIM"); rec.estTime += HUMAN.intro; return; }
        if (sc === "AIM") {
          if (!self.night || self.night.lune !== run.lune || self.night.nuit !== run.nuit) {
            self.night = { lune: run.lune, nuit: run.nuit, quota: run.quota, won: false, shots: 0, fill: 0, total: 0 };
            rec.nights.push(self.night);
          }
          if (opts.maxLune && run.lune > opts.maxLune) { rec.cause = "arrêt"; self.done = true; return; }
          let a;
          const sw = opts.swap === false ? null : Dbg.swapChoice(run, self.rng, rec.policy);
          if (sw) { if (sw.swap > 0) { BE.Run.swap(sw.swap); rec.swaps = (rec.swaps || 0) + 1; } a = sw.angle; }
          else a = self.policy(run, self.rng);
          rec.shots++; rec.estTime += HUMAN.aim;
          const n = shootSync(st, a, self.hook, self.tick);
          if (n < 0) throw new Error("tir impossible en " + st.scene);
          rec.steps += n;
          return;
        }
        if (sc === "SHOP") {
          self.shopPol(run, rec, self.rng);
          for (const r of run.relics) if (rec.relicsEver.indexOf(r.id) < 0) rec.relicsEver.push(r.id);
          rec.estTime += HUMAN.shop;
          BE.Run.leaveShop();
          return;
        }
        rec.steps += advance(st, (s) => !!STABLE[s.scene] || !!s.run.result, 400000, self.hook, self.tick);
      }, opts.all);
    } finally { rec.wallMs += now() - t0; }
    if (this.done) this.finish();
    return this.done;
  };
  Bot.prototype.finish = function () {
    const rec = this.rec, run = this.st.run;
    rec.won = !!(run.result && run.result.won);
    rec.cause = run.result ? (run.result.won ? null : run.result.cause) : rec.cause || "timeout";
    rec.lune = run.lune; rec.nuit = run.nuit;
    rec.goldEarned = run.runStats.gold; rec.goldSpent = rec.spent; rec.goldEnd = run.gold;
    rec.relics = run.relics.map((r) => r.id);
    for (const r of run.relics) if (rec.relicsEver.indexOf(r.id) < 0) rec.relicsEver.push(r.id);
    rec.reactions = Object.assign({}, run.reactionCounts);
    rec.bigBangs = run.runStats.bigBangs; rec.bigBang = run.runStats.bigBangs > 0;
    rec.kills = run.runStats.kills; rec.stones = run.runStats.stones; rec.maxSize = run.runStats.maxSize;
    delete rec.spent;
    return rec;
  };
  Dbg.Bot = Bot;
  /** Joue un run complet (synchrone) dans un bac à sable. Renvoie un enregistrement (docs/ARCHITECTURE.md §15). */
  Dbg.playRun = function (opts, i) {
    const b = new Bot(opts, i);
    while (!b.step());
    return b.rec;
  };

  function now() { return typeof performance !== "undefined" ? performance.now() : Date.now(); }

  function normOpts(opts) {
    opts = Object.assign({ runs: 20, policy: "greedy", gardien: "veilleuse", eclipse: 0, shop: "default", seed: "SIM" }, opts || {});
    if (!Dbg.POLICIES[opts.policy]) throw new Error("politique inconnue : " + opts.policy + " (random, greedy, safe, noisy)");
    if (!Dbg.SHOP_POLICIES[opts.shop]) throw new Error("politique de boutique inconnue : " + opts.shop);
    if (!D.GARDIEN_BY_ID[opts.gardien]) throw new Error("Gardien inconnu : " + opts.gardien);
    return opts;
  }
  function errRec(opts, i, e) {
    console.error("[BE.Debug] run " + i + " :", e);
    return { seed: (opts.seed || "SIM") + "-" + i, error: String(e && e.stack || e), won: false, cause: "erreur", nights: [], light: {}, reactions: {}, mergeSizes: {}, relicsEver: [], relics: [] };
  }
  function playSafe(opts, i) {
    try { return Dbg.playRun(opts, i); } catch (e) { return errRec(opts, i, e); }
  }
  function finish(opts, recs, t0) {
    const summary = Dbg.summarize(recs, opts);
    summary.wallMs = now() - t0;
    summary.speed = summary.wallMs > 0 ? U.sum(recs, (r) => r.estTime || 0) / (summary.wallMs / 1000) : 0;
    const out = { opts, runs: recs, summary, report: Dbg.report(summary), csv: Dbg.csv(recs) };
    Dbg.last = out; Dbg.lastReport = out.report; Dbg.lastCSV = out.csv;
    if (opts.log !== false) {
      console.log(out.report);
      try { if (console.table) console.table(summary.targets.map((t) => ({ mesure: t.label, valeur: t.txt, cible: t.target, ok: t.ok ? "oui" : "non" }))); } catch (e) { /* */ }
    }
    return out;
  }

  /** Version synchrone de simulate (bloque la page). */
  Dbg.simulateSync = function (opts) {
    opts = normOpts(opts);
    const t0 = now(), recs = [];
    for (let i = 0; i < opts.runs; i++) { recs.push(playSafe(opts, (opts.offset || 0) + i)); if (opts.onProgress) opts.onProgress(i + 1, opts.runs); }
    return finish(opts, recs, t0);
  };
  /**
   * Bots headless (§13.1). opts : {runs, policy:"random"|"greedy"|"safe", gardien, eclipse, shop:"default"|"random"|"none",
   * seed (préfixe, run i = seed-i), offset, all (tout le contenu), rooms:[…], maxLune, onProgress(i, n), log, slice (ms)}.
   * Rend la main toutes les `slice` ms (30 par défaut, au plus un tir de retard) : la page reste fluide.
   * Résultat : {opts, runs, summary, report, csv}.
   */
  Dbg.simulate = function (opts) {
    try { opts = normOpts(opts); } catch (e) { return Promise.reject(e); }
    const t0 = now(), recs = [], slice = opts.slice || 30;
    return new Promise((resolve) => {
      let i = 0, bot = null;
      function chunk() {
        const tc = now();
        while (i < opts.runs && now() - tc < slice) {
          const idx = (opts.offset || 0) + i;
          try {
            if (!bot) bot = new Bot(opts, idx);
            if (!bot.step()) continue;
            recs.push(bot.rec);
          } catch (e) { recs.push(errRec(opts, idx, e)); }
          bot = null; i++;
          if (opts.onProgress) { try { opts.onProgress(i, opts.runs); } catch (e) { /* */ } }
        }
        if (i < opts.runs) setTimeout(chunk, 0);
        else resolve(finish(opts, recs, t0));
      }
      setTimeout(chunk, 0);
    });
  };

  // =====================================================================================================
  // MESURES (§13.1 sortie, §13.3 cibles)
  // =====================================================================================================
  const pctTxt = (x) => (isFinite(x) ? (Math.round(x * 1000) / 10).toFixed(1).replace(".", ",") + " %" : "—");
  const decTxt = (x, k) => (isFinite(x) ? x.toFixed(k === undefined ? 1 : k).replace(".", ",") : "—");
  const avg = (a) => (a.length ? U.sum(a) / a.length : NaN);

  /** Agrège des enregistrements de runs (ceux de playRun, éventuellement fusionnés depuis plusieurs pages). */
  Dbg.summarize = function (recs, opts) {
    opts = opts || {};
    const n = recs.length;
    const ok = recs.filter((r) => !r.error);
    const won = ok.filter((r) => r.won);
    const lost = ok.filter((r) => !r.won && r.cause !== "arrêt");
    const nights = {};
    const order = [];
    for (const r of ok) for (const nt of r.nights) {
      const k = "L" + nt.lune + " " + NIGHT[nt.nuit];
      if (!nights[k]) { nights[k] = { key: k, lune: nt.lune, nuit: nt.nuit, reached: 0, won: 0, shots: [], fills: [], quota: nt.quota }; order.push(k); }
      const e = nights[k];
      e.reached++; e.fills.push(nt.fill || 0);
      if (nt.won) { e.won++; e.shots.push(nt.shots); }
    }
    order.sort((a, b) => nights[a].lune - nights[b].lune || nights[a].nuit - nights[b].nuit);
    const byNight = order.map((k) => {
      const e = nights[k];
      return { key: k, lune: e.lune, nuit: e.nuit, quota: e.quota, reached: e.reached, won: e.won, rate: e.reached ? e.won / e.reached : NaN, shots: avg(e.shots), fill: avg(e.fills) };
    });
    const cleared = (L) => (ok.length ? ok.filter((r) => r.won || r.lune > L).length / ok.length : NaN);
    const allShotsWon = [];
    for (const r of ok) for (const nt of r.nights) if (nt.won) allShotsWon.push(nt.shots);
    const bossFills = [], bossFillsWon = [], bossArea = [];
    for (const r of ok) for (const nt of r.nights) if (nt.nuit === 2) {
      bossFills.push(nt.fill || 0);
      if (nt.won) bossFillsWon.push(nt.fill || 0);
      if (nt.area !== undefined) bossArea.push(nt.area);
    }
    const causes = {};
    for (const r of lost) causes[r.cause] = (causes[r.cause] || 0) + 1;
    const light = {};
    for (const r of ok) for (const L in r.light) { const b = light[L] || (light[L] = { sum: 0, shots: 0 }); b.sum += r.light[L].sum; b.shots += r.light[L].shots; }
    const reactions = {}, sizes = {};
    for (const r of ok) {
      for (const k in r.reactions) reactions[k] = (reactions[k] || 0) + r.reactions[k];
      for (const k in r.mergeSizes) sizes[k] = (sizes[k] || 0) + r.mergeSizes[k];
    }
    const relicWin = {};
    for (const r of won) for (const id of r.relicsEver) relicWin[id] = (relicWin[id] || 0) + 1;
    const dominant = Object.keys(relicWin).map((id) => ({ id, nom: D.RELIC_BY_ID[id] ? D.RELIC_BY_ID[id].nom : id, share: relicWin[id] / won.length }))
      .sort((a, b) => b.share - a.share);
    const insomniaque = (opts.gardien || (ok[0] && ok[0].gardien)) === "insomniaque";
    const S = {
      n, errors: n - ok.length, wins: won.length, winRate: ok.length ? won.length / ok.length : NaN,
      lune1: cleared(1), lune2: cleared(2), lune3: cleared(3), lune4: cleared(4),
      shotsPerWonNight: avg(allShotsWon), causes, overflowShare: lost.length ? (causes.overflow || 0) / lost.length : NaN,
      bossFill: avg(bossFills), bossFillWon: avg(bossFillsWon), bossAreaFill: avg(bossArea), goldSpent: avg(ok.map((r) => r.goldSpent || 0)), goldEarned: avg(ok.map((r) => r.goldEarned || 0)),
      goldEnd: avg(ok.map((r) => r.goldEnd || 0)), wonMinutes: avg(won.map((r) => r.estTime / 60)), allMinutes: avg(ok.map((r) => r.estTime / 60)),
      bigBangRate: ok.length ? ok.filter((r) => r.bigBang).length / ok.length : NaN, byNight,
      lightPerShot: Object.keys(light).sort((a, b) => a - b).map((L) => ({ lune: +L, avg: light[L].sum / light[L].shots, shots: light[L].shots })),
      reactions, mergeSizes: sizes, dominant, shotsPerRun: avg(ok.map((r) => r.shots)),
    };
    const T = (label, v, txt, target, lo, hi, na) => ({ label, value: v, txt, target, ok: isFinite(v) && v >= lo && v <= hi, na: !!na });
    // Les cibles du bocal comptent depuis la géométrie « entonnoir » (bocal 200 px, rayons du bocal, capacité = surface × 0,6).
    const JAR_NA = false;
    S.targets = [
      T("Réussite Lune 1 (3 nuits)", S.lune1, pctTxt(S.lune1), "≥ 97 %", 0.97, 1),
      T("Réussite Lune 3", S.lune3, pctTxt(S.lune3), "55 à 70 %", 0.55, 0.70),
      T("Victoire (Lune 5)", S.winRate, pctTxt(S.winRate), "15 à 25 %", 0.15, 0.25),
      T("Tirs moyens par nuit gagnée", S.shotsPerWonNight, decTxt(S.shotsPerWonNight, 2), "4,2 ± 1", 3.2, 5.2),
      T("Défaites par Débordement", S.overflowShare, pctTxt(S.overflowShare), "15 à 35 %", 0.15, 0.35, JAR_NA),
      T("Remplissage fin de Nuit du Boss", S.bossFill, pctTxt(S.bossFill), "55 à 75 %", 0.55, 0.75, JAR_NA),
      T("Or moyen dépensé par run", S.goldSpent, decTxt(S.goldSpent, 1), "90 à 130", 90, 130),
      T("Durée d'un run gagné (min, estim.)", S.wonMinutes, decTxt(S.wonMinutes, 1), "10 à 14", 10, 14),
      // Big Bang de l'Insomniaque : suspendu en v1.1 (le bocal de 200 px ne loge pas deux Trous Noirs), mesuré mais N/A
      insomniaque ? T("Big Bang (Insomniaque)", S.bigBangRate, pctTxt(S.bigBangRate), "10 à 20 %", 0.10, 0.20, true)
        : T("Big Bang", S.bigBangRate, pctTxt(S.bigBangRate), "< 3 %", 0, 0.0299),
    ];
    return S;
  };

  function pad(s, w, right) { s = String(s); if (s.length >= w) return s.slice(0, w); return right ? " ".repeat(w - s.length) + s : s + " ".repeat(w - s.length); }
  /** Rapport texte (tableaux à largeur fixe) d'un résumé. */
  Dbg.report = function (S) {
    const L = [];
    const o = (S && S.opts) || {};
    L.push("══ Bocal d'Étoiles — simulation : " + S.n + " runs" + (S.errors ? " (" + S.errors + " en erreur)" : "") + " ══");
    L.push("");
    L.push(pad("Mesure (§13.3)", 36) + pad("Valeur", 10, true) + "   " + pad("Cible", 12) + " ");
    L.push("─".repeat(64));
    for (const t of S.targets) L.push(pad(t.label, 36) + pad(t.txt, 10, true) + "   " + pad(t.target, 12) + (t.ok ? " ✓" : t.na ? " N/A" : " ✗"));
    L.push("");
    L.push(pad("Nuit", 12) + pad("quota", 8, true) + pad("atteinte", 10, true) + pad("réussie", 9, true) + pad("taux", 9, true) + pad("tirs", 7, true) + pad("rempl.", 9, true));
    L.push("─".repeat(64));
    for (const b of S.byNight) {
      L.push(pad(b.key, 12) + pad(U.fmt(b.quota).replace(/ /g, " "), 8, true) + pad(b.reached, 10, true) + pad(b.won, 9, true) + pad(pctTxt(b.rate), 9, true) +
        pad(decTxt(b.shots, 2), 7, true) + pad(pctTxt(b.fill), 9, true));
    }
    L.push("");
    const causes = Object.keys(S.causes).map((k) => k + " " + S.causes[k]).join(", ") || "aucune";
    L.push("Défaites : " + causes + " · victoires " + S.wins + "/" + S.n);
    L.push("Remplissage Nuit du Boss : jauge " + pctTxt(S.bossFill) + " (nuits gagnées seules " + pctTxt(S.bossFillWon) + ") · part surfacique " +
      pctTxt(S.bossAreaFill) + " de la capacité = " + pctTxt(S.bossAreaFill * D.GEOM.packing) + " de la surface brute");
    L.push("Or : gagné " + decTxt(S.goldEarned) + " · dépensé " + decTxt(S.goldSpent) + " · restant " + decTxt(S.goldEnd) + " (moyennes par run)");
    L.push("Lumière / tir par Lune : " + S.lightPerShot.map((x) => "L" + x.lune + " " + U.fmt(Math.round(x.avg)).replace(/ /g, " ")).join(" · "));
    const rs = Object.keys(S.reactions).sort((a, b) => S.reactions[b] - S.reactions[a]);
    L.push("Réactions (par run) : " + (rs.length ? rs.map((k) => (D.REACTIONS[k] ? D.REACTIONS[k].nom : k) + " " + decTxt(S.reactions[k] / S.n, 2)).join(" · ") : "aucune"));
    const ms = Object.keys(S.mergeSizes).sort((a, b) => a - b);
    L.push("Fusions par taille (par run) : " + (ms.length ? ms.map((k) => (k === "8" ? "Big Bang" : "→" + k) + " " + decTxt(S.mergeSizes[k] / S.n, 2)).join(" · ") : "aucune"));
    if (S.dominant.length) L.push("Reliques des runs gagnés : " + S.dominant.slice(0, 6).map((d) => d.nom + " " + pctTxt(d.share)).join(" · ") +
      (S.dominant[0].share > 0.6 ? "  ⚠ build dominant ?" : ""));
    L.push("Tirs par run " + decTxt(S.shotsPerRun) + " · durée estimée moyenne " + decTxt(S.allMinutes) + " min" +
      (S.wallMs ? " · calcul " + decTxt(S.wallMs / 1000, 1) + " s (≈ ×" + Math.round(S.speed || 0) + " le temps réel)" : ""));
    return L.join("\n");
  };

  /** CSV (séparateur « ; », une ligne par run) — copiable dans un tableur. */
  Dbg.csv = function (recs) {
    const H = ["seed", "gardien", "eclipse", "politique", "boutique", "gagne", "cause", "lune", "nuit", "nuits_gagnees", "tirs", "or_gagne", "or_depense",
      "or_final", "big_bang", "tues", "pierres", "taille_max", "duree_estimee_s", "reliques", "reactions", "tirs_par_nuit"];
    const rows = [H.join(";")];
    for (const r of recs) {
      rows.push([r.seed, r.gardien, r.eclipse, r.policy, r.shopPolicy, r.won ? 1 : 0, r.cause || "", r.lune, r.nuit, r.nightsWon, r.shots, r.goldEarned, r.goldSpent,
        r.goldEnd, r.bigBangs || 0, r.kills, r.stones, r.maxSize, Math.round(r.estTime || 0), (r.relicsEver || []).join(" "),
        Object.keys(r.reactions || {}).map((k) => k + ":" + r.reactions[k]).join(" "), (r.nights || []).map((x) => (x.won ? x.shots : "x")).join(" ")].join(";"));
    }
    return rows.join("\n");
  };
  /** Copie le dernier CSV dans le presse-papiers (si disponible). */
  Dbg.copyCSV = function () {
    const t = Dbg.lastCSV || "";
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        const pr = navigator.clipboard.writeText(t);
        if (pr && pr.catch) pr.catch(() => { if (Dbg.panel && Dbg.panel.kind === "sim") Dbg.panel.copied = false; });
        return true;
      }
    } catch (e) { /* presse-papiers indisponible */ }
    return false;
  };

  // =====================================================================================================
  // TESTS UNITAIRES (§13.2)
  // =====================================================================================================
  const REG = [];
  function test(group, name, fn) { REG.push({ group, name, fn }); }
  function Fail(msg) { this.message = msg; }
  function assert(c, msg) { if (!c) throw new Fail(msg || "assertion"); }
  function eq(a, b, msg) { if (a !== b) throw new Fail((msg ? msg + " : " : "") + "attendu " + fmtV(b) + ", obtenu " + fmtV(a)); }
  function near(a, b, eps, msg) { if (!(Math.abs(a - b) <= (eps || 1e-9))) throw new Fail((msg ? msg + " : " : "") + "attendu ≈ " + b + ", obtenu " + a); }
  function fmtV(v) { try { return typeof v === "string" ? '"' + v + '"' : JSON.stringify(v); } catch (e) { return String(v); } }
  function deepEqual(a, b, path) {
    path = path || "run";
    if (a === b) return null;
    if (typeof a !== typeof b) return path + " : type " + typeof a + " ≠ " + typeof b;
    if (typeof a === "number") return Number.isNaN(a) && Number.isNaN(b) ? null : path + " : " + a + " ≠ " + b;
    if (!a || !b || typeof a !== "object") return path + " : " + fmtV(a) + " ≠ " + fmtV(b);
    if (Array.isArray(a) !== Array.isArray(b)) return path + " : tableau ≠ objet";
    const ka = Object.keys(a), kb = Object.keys(b);
    if (ka.length !== kb.length) return path + " : " + ka.length + " clés ≠ " + kb.length;
    for (const k of ka) { const d = deepEqual(a[k], b[k], path + "." + k); if (d) return d; }
    return null;
  }
  Dbg.deepEqual = deepEqual;

  /** Contexte de décompte minimal (tous les compteurs à zéro) + surcharges. */
  function ctxOf(o) {
    return Object.assign({
      pegHits: 0, pegTouches: 0, doubleHits: 0, darkHits: 0, specialHits: { or: 0, ressort: 0, prisme: 0, echo: 0, cristal: 0, teint: 0 },
      wallBounces: 0, shadowHits: 0, kills: 0, killsByType: {}, merges: [], stonesBroken: 0, reactions: [], bigBang: false,
      launchedSize: 1, launchedColor: "braise", touchedShadow: false, jarFill: 0.5, jarCount: 0, jarStars: 0, jarColors: [], maxJarSize: 0,
      gold: 0, isLastShot: false, shotIndex: 1, metronome: 0, reserve: 0, baseEclat: 10, baseMult: 1, absorbed: false, bossKilled: false,
      bolts: 0, aurore: false, finalX: 1, eclipseHalf: false, distinctReactions: 0,
    }, o || {});
  }
  const L = (ctx, relics) => BE.Score.compute(ctx, relics || []).lumiere;

  // ---------------------------------------------------------------- 1. Score.compute (12 cas fixes)
  test("Score", "base seule : 10 × 3 = 30", () => { const r = BE.Score.compute(ctxOf({ baseEclat: 10, baseMult: 3 }), []); eq(r.lumiere, 30); eq(r.steps.length, 1); eq(r.steps[0].src, "base"); });
  test("Score", "+Mult puis ×Mult (Chasseur → Verre soufflé) = 125", () => eq(L(ctxOf({ kills: 2 }), ["R05", "R27"]), 125));
  test("Score", "ordre inverse (Verre soufflé → Chasseur) = 65 < 125", () => { eq(L(ctxOf({ kills: 2 }), ["R27", "R05"]), 65); assert(L(ctxOf({ kills: 2 }), ["R27", "R05"]) < L(ctxOf({ kills: 2 }), ["R05", "R27"]), "l'ordre doit compter"); });
  test("Score", "Catalyseur à 2 réactions = ×2,25", () => { const r = BE.Score.compute(ctxOf({ baseMult: 4, reactions: ["vapeur", "plasma"] }), ["R25"]); near(r.mult, 9); eq(r.steps[1].xMult, 2.25); eq(r.lumiere, 90); });
  test("Score", "Big Bang : ×10 final", () => { const r = BE.Score.compute(ctxOf({ baseEclat: 12, baseMult: 2, bigBang: true }), []); eq(r.lumiere, 240); eq(r.steps[r.steps.length - 1].src, "bigbang"); assert(r.steps[r.steps.length - 1].final, "étape finale"); });
  test("Score", "Insomniaque : ×2 final", () => { const r = BE.Score.compute(ctxOf({ baseEclat: 10, baseMult: 3, finalX: 2 }), []); eq(r.lumiere, 60); eq(r.steps[1].src, "insomniaque"); });
  test("Score", "L'Éclipse : ÷2 final", () => { const r = BE.Score.compute(ctxOf({ baseEclat: 10, baseMult: 3, eclipseHalf: true }), []); eq(r.lumiere, 15); near(r.mult, 1.5); });
  test("Score", "Aurore : ×2 final", () => eq(L(ctxOf({ baseEclat: 10, baseMult: 3, aurore: true })), 60));
  test("Score", "finaux dans l'ordre Aurore → Big Bang → Insomniaque → Éclipse (×20)", () => {
    const r = BE.Score.compute(ctxOf({ baseEclat: 10, baseMult: 1, aurore: true, bigBang: true, finalX: 2, eclipseHalf: true }), []);
    eq(r.steps.slice(1).map((s) => s.src).join(","), "aurore,bigbang,insomniaque,eclipse"); eq(r.lumiere, 200);
  });
  test("Score", "reliques avant les finaux (Chasseur puis ×10 Big Bang)", () => {
    const r = BE.Score.compute(ctxOf({ baseEclat: 10, baseMult: 1, kills: 1, bigBang: true }), ["R05"]);
    eq(r.steps.map((s) => s.src).join(","), "base,R05,bigbang"); eq(r.lumiere, 300);
  });
  test("Score", "Lumière = ⌊Éclat × Mult⌋ (7 × 1,5 = 10)", () => eq(L(ctxOf({ baseEclat: 7, baseMult: 1.5 })), 10));
  test("Score", "relique sans effet : pas d'étape (Chandelle après contact, Balance à 50 %)", () => {
    const r = BE.Score.compute(ctxOf({ touchedShadow: true, jarFill: 0.5 }), ["R04", "R14"]);
    eq(r.steps.length, 1); eq(L(ctxOf({ jarFill: 0.49 }), ["R14"]), 20);
  });
  test("Score", "+Éclat (Loupe : 3 contacts → +6) et compute pur (ctx inchangé, même sortie)", () => {
    const c = ctxOf({ shadowHits: 3, merges: [{ size: 3, pure: true, colors: ["braise", "braise"], reaction: null, mult: 3, alch: 1.5 }] });
    const before = JSON.stringify(c);
    const a = BE.Score.compute(c, ["R01", "R15", "R29"]), b = BE.Score.compute(c, ["R01", "R15", "R29"]);
    eq(a.eclat, 16); eq(JSON.stringify(c), before, "ctx muté"); eq(JSON.stringify(a), JSON.stringify(b), "sorties différentes");
  });

  // ---------------------------------------------------------------- 2. pureté et Mult de fusion
  const fakeRun = (pureMult) => ({ rules: { pureMult: pureMult || 1.5 }, relics: [], gardien: "veilleuse", eclipse: 0 });
  test("Fusion", "table §5.2 (fusions mixtes) : 1, 2, 3, 5, 8, 13", () => {
    eq([2, 3, 4, 5, 6, 7].map((s) => BE.Jar.mergeMult(fakeRun(), s, false, false)).join(","), "1,2,3,5,8,13");
  });
  test("Fusion", "pure ×1,5 arrondi au 0,5 sup. : 1,5 · 3 · 4,5 · 7,5 · 12 · 19,5", () => {
    eq([2, 3, 4, 5, 6, 7].map((s) => BE.Jar.mergeMult(fakeRun(), s, true, false)).join(","), "1.5,3,4.5,7.5,12,19.5");
    eq(U.ceilHalf(1.2), 1.5); eq(U.ceilHalf(1.5), 1.5); eq(U.ceilHalf(4.51), 5);
  });
  test("Fusion", "Forgeronne : pures ×2 (2 · 4 · 6 · 10 · 16 · 26)", () => {
    eq([2, 3, 4, 5, 6, 7].map((s) => BE.Jar.mergeMult(fakeRun(2), s, true, false)).join(","), "2,4,6,10,16,26");
  });
  test("Fusion", "Alchimiste : pure = Mult d'une taille au-dessus (Trou Noir 21), mixte inchangée", () => {
    eq([2, 3, 4, 5, 6, 7].map((s) => BE.Jar.mergeMult(fakeRun(), s, true, true)).join(","), "3,4.5,7.5,12,19.5,31.5");
    eq(BE.Jar.mergeMult(fakeRun(), 4, false, true), 3);
  });
  test("Fusion", "bocal réel : 2 Braise taille 2 → 1 Astre pur, Mult 3 ; Braise + Givre → Vapeur", () => {
    withRun({ seed: "FUS-1" }, (run, st) => {
      run.jar.bodies = [];
      const S = { log: [] };
      BE.Jar.add(run, { size: 2, color: "braise", x: 150, y: 590 });
      BE.Jar.add(run, { size: 2, color: "braise", x: 188, y: 590 });
      for (let i = 0; i < 20; i++) BE.Jar.step(run, DT, S);
      const m = S.log.filter((e) => e.t === "merge");
      eq(m.length, 1, "fusions"); eq(m[0].size, 3); eq(m[0].pure, true); eq(m[0].mult, 3); eq(run.jar.bodies.filter((b) => !b.stone).length, 1);
      run.jar.bodies = [];
      const S2 = { log: [] };
      BE.Jar.add(run, { size: 2, color: "braise", x: 150, y: 590 });
      BE.Jar.add(run, { size: 2, color: "givre", x: 188, y: 590 });
      for (let i = 0; i < 20; i++) BE.Jar.step(run, DT, S2);
      const m2 = S2.log.filter((e) => e.t === "merge");
      eq(m2.length, 1); eq(m2[0].pure, false); eq(m2[0].reaction, "vapeur"); eq(m2[0].mult, 2);
      assert(S2.log.some((e) => e.t === "mult" && e.src === "vapeur"), "Vapeur +3 Mult");
      eq(run.jar.bodies[0].color, "braise", "couleur du plus petit id");
    });
  });

  // ---------------------------------------------------------------- 3. évolutions
  test("Évolutions", "3 réactions + Laboratoire → évolution dans le même emplacement", () => {
    const evo = D.EVOLUTION_BY_BASE.R13;
    assert(evo, "évolution du Télescope");
    withRun({ seed: "EVO-1", relics: ["R01", "R13", "R02"], rooms: ["laboratoire"] }, (run) => {
      run.reactionCounts[evo.reaction] = 2;
      eq(BE.Shop.evolve(run).length, 0, "2 réactions suffisent");
      run.reactionCounts[evo.reaction] = 3;
      const out = BE.Shop.evolve(run);
      eq(out.length, 1); eq(run.relics[1].id, evo.id); eq(run.relics[1].evolved, true); eq(run.relics[1].from, "R13");
      eq(run.relics.map((r) => r.id).join(","), "R01," + evo.id + ",R02");
      eq(BE.Shop.evolve(run).length, 0, "pas de double évolution");
    });
  });
  test("Évolutions", "sans Laboratoire : pas d'évolution", () => {
    withRun({ seed: "EVO-2", relics: ["R13"] }, (run) => {
      run.reactionCounts[D.EVOLUTION_BY_BASE.R13.reaction] = 5;
      eq(BE.Shop.evolve(run).length, 0); eq(run.relics[0].id, "R13");
    });
  });
  test("Évolutions", "à l'entrée de l'Aube (Shop.enter)", () => {
    withRun({ seed: "EVO-3", relics: ["R14"], rooms: ["laboratoire"] }, (run, st) => {
      run.reactionCounts[D.EVOLUTION_BY_BASE.R14.reaction] = 3;
      run.total = run.quota; BE.Run.go("CHECK");
      advance(st, (s) => s.scene === "SHOP", 5000);
      eq(st.scene, "SHOP"); eq(run.relics[0].id, D.EVOLUTION_BY_BASE.R14.id);
    });
  });

  // ---------------------------------------------------------------- 4. économie
  function nightReward(opts, gold, shotsLeft, grace) {
    return withRun(opts, (run, st) => {
      run.gold = gold; run.shotsLeft = shotsLeft; run.graceShots = grace || 0; run.total = run.quota;
      BE.Run.go("NIGHT_WON");
      advance(st, (s) => s.play.won && s.play.won.rewarded, 2000);
      return { r: run.lastReward, gold: run.gold };
    });
  }
  test("Économie", "intérêts calculés AVANT la récompense (24 or → +4, pas +5)", () => {
    const o = nightReward({ seed: "ECO-1" }, 24, 2);
    eq(o.r.interest, 4); eq(o.r.night, 3); eq(o.r.shots, 2); eq(o.gold, 24 + 4 + 3 + 2);
  });
  test("Économie", "Lune 1 : +2 tirs d'apprentissage, inutilisés ils ne rapportent pas d'or", () => {
    withRun({ seed: "ECO-G" }, (run) => {
      eq(run.lune, 1); eq(run.graceShots, D.ECO.lune1Grace); eq(run.shotsLeft, run.rules.shots + D.ECO.lune1Grace);
      run.lune = 2; BE.Run.startNight(run);
      eq(run.graceShots, 0); eq(run.shotsLeft, run.rules.shots, "Lune 2 : tirs normaux");
    });
    eq(nightReward({ seed: "ECO-G2" }, 0, 5, 2).r.shots, 3, "5 tirs restants dont 2 d'apprentissage → +3 or");
    eq(nightReward({ seed: "ECO-G3" }, 0, 1, 2).r.shots, 0, "tirs d'apprentissage seuls → 0 or");
  });
  test("Économie", "plafonds d'intérêts : 5 · Tirelire 8 · Éclipse 6 → 3 · Glaneuse 0", () => {
    eq(nightReward({ seed: "ECO-2" }, 100, 0).r.interest, 5, "base");
    eq(nightReward({ seed: "ECO-3", relics: ["R07"] }, 100, 0).r.interest, 8, "Tirelire");
    eq(nightReward({ seed: "ECO-4", relics: ["R07"], eclipse: 6 }, 100, 0).r.interest, 3, "Éclipse 6");
    eq(nightReward({ seed: "ECO-5", gardien: "glaneuse" }, 100, 0).r.interest, 0, "Glaneuse");
  });
  test("Économie", "vente ⌊prix/2⌋ minimum 1", () => {
    withRun({ seed: "ECO-6", relics: ["R01", "R13", "R24"] }, (run) => {
      eq(BE.Shop.sellPrice(run, "R01"), 2); eq(BE.Shop.sellPrice(run, "R13"), 3); eq(BE.Shop.sellPrice(run, "R24"), 4);
      run.gold = 0;
      const r = BE.Shop.sell(run, 1);
      eq(r.gold, 3); eq(run.gold, 3); eq(run.relics.map((x) => x.id).join(","), "R01,R24");
      run.rules.relicDiscount = 99;
      eq(BE.Shop.relicPrice(run, "R01"), 2, "prix minimum"); eq(BE.Shop.sellPrice(run, "R01"), 1, "vente minimum");
    });
    withRun({ seed: "ECO-7", gardien: "glaneuse" }, (run) => { eq(BE.Shop.relicPrice(run, "R01"), 3); eq(BE.Shop.sellPrice(run, "R01"), 1); });
  });
  test("Économie", "relance 2 puis +1 à chaque fois, l'article verrouillé reste", () => {
    withRun({ seed: "ECO-8" }, (run) => {
      BE.Shop.enter(run);
      run.gold = 10;
      const keep = BE.Shop.itemKey(run.shop.offers[1]);
      BE.Shop.lock(run, 1);
      assert(BE.Shop.reroll(run).ok); eq(run.gold, 8); eq(run.shop.rerollCost, 3);
      assert(BE.Shop.reroll(run).ok); eq(run.gold, 5); eq(run.shop.rerollCost, 4);
      eq(BE.Shop.itemKey(run.shop.offers[1]), keep, "verrou");
      run.gold = 3;
      assert(!BE.Shop.reroll(run).ok, "relance sans assez d'or"); eq(run.gold, 3);
    });
  });

  // ---------------------------------------------------------------- 5. RNG
  test("RNG", "même graine → mêmes 1 000 tirages par flux ; flux indépendants", () => {
    const a = U.seedStreams("ABCD-EFGH"), b = U.seedStreams("ABCD-EFGH"), c = U.seedStreams("ABCD-EFGI");
    for (const k of U.STREAMS) {
      const xa = [], xb = [];
      for (let i = 0; i < 1000; i++) { xa.push(U.rand(a, k)); xb.push(U.rand(b, k)); }
      eq(xa.join(","), xb.join(","), "flux " + k);
      assert(xa.every((v) => v >= 0 && v < 1), "tirages dans [0,1)");
      assert(U.rand(c, k) !== U.rand(U.seedStreams("ABCD-EFGH"), k), "graines différentes");
    }
    const s = U.seedStreams("X"), w0 = s.waves;
    for (let i = 0; i < 50; i++) U.rand(s, "shop");
    eq(s.waves, w0, "tirer sur shop ne touche pas waves");
  });
  test("RNG", "relancer la boutique ne change pas les vagues (waves)", () => {
    const play = (rerolls) => withRun({ seed: "RNG-SHOP" }, (run, st) => {
      run.total = run.quota; BE.Run.go("CHECK");
      advance(st, (s) => s.scene === "SHOP", 5000);
      run.gold = 50;
      for (let i = 0; i < rerolls; i++) BE.Shop.reroll(run);
      const w = run.streams.waves;
      BE.Run.leaveShop();
      return { w, shop: run.streams.shop, firm: JSON.stringify(run.firm.shadows.map((x) => [x.type, x.col, x.row, x.hp])) + JSON.stringify(run.firm.ghost) };
    });
    const a = play(0), b = play(4);
    eq(b.w, a.w, "flux waves"); eq(b.firm, a.firm, "Ombres de la nuit suivante"); assert(a.shop !== b.shop, "la relance consomme bien le flux shop");
  });

  // ---------------------------------------------------------------- 6. sauvegarde
  /** n tirs aléatoires puis retour en AIM (l'Aube est quittée sans achat, l'intro passée). */
  function botShots(st, n, seedTxt) {
    const rng = U.mulberry32(U.fnv1a(seedTxt || "bot"));
    for (let i = 0; i < n; i++) {
      toAim(st);
      if (st.scene !== "AIM") return;
      shootSync(st, 20 + rng() * 140);
    }
    toAim(st);
  }
  function toAim(st) {
    for (let k = 0; k < 4 && st.scene !== "AIM" && !st.run.result; k++) {
      if (st.scene === "SHOP") BE.Run.leaveShop();
      else if (st.scene === "NIGHT_INTRO") BE.Run.go("AIM");
      else advance(st, (s) => !!STABLE[s.scene], 100000);
    }
  }
  test("Sauvegarde", "aller-retour du run (saveRun → loadRun, comparaison profonde)", () => {
    withRun({ seed: "SAV-1" }, (run, st) => {
      botShots(st, 3, "sav");
      assert(st.scene === "AIM", "le run doit être en AIM (scène " + st.scene + ")");
      const ref = JSON.parse(JSON.stringify(run, (k, v) => (k && k.charCodeAt(0) === 95 ? undefined : v)));
      eq(BE.Save.checkRun(ref), null, "checkRun");
      let ls = null, backup = null;
      try { ls = window.localStorage; backup = ls.getItem("bde.v1.run"); } catch (e) { ls = null; }
      if (!ls) { eq(deepEqual(JSON.parse(JSON.stringify(ref)), ref), null); return; }
      try {
        ls.removeItem("bde.v1.run");
        assert(SaveOrig.saveRun(run), "saveRun");
        const back = SaveOrig.loadRun();
        assert(back, "loadRun");
        eq(deepEqual(back, ref), null);
      } finally {
        try { if (backup === null) ls.removeItem("bde.v1.run"); else ls.setItem("bde.v1.run", backup); } catch (e) { /* */ }
      }
    });
  });
  test("Sauvegarde", "reprise d'un PENDING_SHOT : même résultat que le tir d'origine", () => {
    const meta = simMeta({});
    const angle = 71.3;
    let snap = null, h0 = null;
    const st0 = makeState(meta);
    Dbg.inSandbox(st0, () => {
      BE.Run.startNewRun({ seed: "SAV-2" }); BE.Run.go("AIM");
      botShots(st0, 2, "pend");
      assert(st0.scene === "AIM", "AIM attendu");
      snap = JSON.parse(JSON.stringify(st0.run, (k, v) => (k && k.charCodeAt(0) === 95 ? undefined : v)));
      snap.phase = "PENDING_SHOT"; snap.pendingAngle = angle;
      shootSync(st0, angle);
      h0 = runHash(st0.run);
    });
    const replay = () => {
      const st = makeState(meta);
      return Dbg.inSandbox(st, () => {
        BE.Run.resume(U.deepCopy(snap));
        advance(st, (s) => !!STABLE[s.scene] && s.scene !== "AIM" || (s.scene === "AIM" && s.run.shotIndex !== snap.shotIndex), 400000);
        return runHash(st.run);
      });
    };
    const h1 = replay(), h2 = replay();
    eq(h2, h1, "deux reprises");
    eq(h1, h0, "reprise ≠ tir d'origine");
  });

  test("Sauvegarde", "reprise PENDING_SHOT : même empreinte sur 8 graines × 6 tirs (bocal au repos, jamais re-stabilisé)", () => {
    const meta = simMeta({});
    let bad = 0, n = 0;
    for (let k = 0; k < 8; k++) {
      const st0 = makeState(meta);
      const snaps = [];
      Dbg.inSandbox(st0, () => {
        BE.Run.startNewRun({ seed: "DET-" + k }); BE.Run.go("AIM");
        const rng = U.mulberry32(U.fnv1a("det" + k));
        for (let i = 0; i < 6 && !st0.run.result; i++) {
          toAim(st0);
          if (st0.scene !== "AIM") break;
          const a = 20 + rng() * 140;
          const snap = JSON.parse(JSON.stringify(st0.run, (kk, v) => (kk && kk.charCodeAt(0) === 95 ? undefined : v)));
          snap.phase = "PENDING_SHOT"; snap.pendingAngle = BE.util.clamp(a, D.GEOM.aimMin, D.GEOM.aimMax);
          shootSync(st0, a);
          snaps.push({ snap, h: runHash(st0.run) });
        }
      });
      for (const o of snaps) {
        const st = makeState(meta);
        const h = Dbg.inSandbox(st, () => {
          BE.Run.resume(U.deepCopy(o.snap));
          advance(st, (s) => !!STABLE[s.scene] && s.scene !== "AIM" || (s.scene === "AIM" && s.run.shotIndex !== o.snap.shotIndex), 400000);
          return runHash(st.run);
        });
        n++; if (h !== o.h) bad++;
      }
    }
    assert(n >= 30, "trop peu de tirs rejoués (" + n + ")");
    eq(bad, 0, bad + " reprises sur " + n + " divergent");
  });
  test("Sauvegarde", "un état en cours de tir (PENDING_SHOT) n'est jamais écrit hors de Run.fire ; pas de tir sans tir restant", () => {
    let ls = null, backup = null;
    try { ls = window.localStorage; backup = ls.getItem("bde.v1.run"); } catch (e) { ls = null; }
    withRun({ seed: "SAV-3" }, (run, st) => {
      if (ls) {
        try {
          ls.removeItem("bde.v1.run");
          const pre = U.deepCopy(run); pre.phase = "PENDING_SHOT"; pre.pendingAngle = 80;
          assert(SaveOrig.saveRun(pre, { pending: true }), "instantané d'avant le tir écrit");
          const mid = U.deepCopy(pre); mid.shotIndex++; mid.shotsLeft--; mid.runStats.shots++; // état « en vol »
          eq(SaveOrig.saveRun(mid), false, "état en vol refusé");
          const back = SaveOrig.loadRun();
          eq(back && back.shotsLeft, pre.shotsLeft, "l'instantané d'avant le tir est conservé");
        } finally { try { if (backup === null) ls.removeItem("bde.v1.run"); else ls.setItem("bde.v1.run", backup); } catch (e) { /* */ } }
      }
      run.shotsLeft = 0;
      eq(BE.Run.fire(90), false, "fire sans tir restant");
      eq(st.scene, "AIM");
    });
  });
  test("Sauvegarde", "abandon impossible une fois la nuit gagnée (NIGHT_WON)", () => {
    withRun({ seed: "SAV-4" }, (run, st) => {
      run.total = run.quota; BE.Run.go("CHECK"); BE.Run.update(DT);
      eq(st.scene, "NIGHT_WON");
      eq(BE.Run.abandon(), false);
      eq(run.result, null);
    });
  });
  test("RNG", "pioche : jamais deux fois la même étoile dans la file visible (Astronome, 30 graines)", () => {
    let dup = 0;
    for (let k = 0; k < 30; k++) {
      withRun({ seed: "PIO-" + k, gardien: "astronome" }, (run, st) => {
        const rng = U.mulberry32(k + 7);
        for (let i = 0; i < 14 && !run.result; i++) {
          toAim(st);
          if (st.scene !== "AIM") break;
          const vis = st.run.draw.slice(0, 1 + st.run.rules.previewNext);
          if (new Set(vis).size !== vis.length) dup++;
          shootSync(st, 20 + rng() * 140);
        }
      });
    }
    eq(dup, 0, dup + " files visibles avec doublon");
  });

  // ---------------------------------------------------------------- 7. physique
  function dropTrial(seed, count) {
    const rnd = U.mulberry32(seed);
    const jar = BE.Jar.create();
    let id = 1;
    for (let i = 0; i < count; i++) {
      const size = 1 + Math.floor(rnd() * 3), r = D.SIZES[size].r;
      jar.bodies.push(BE.Phys.makeBody({ id: id++, size, color: "givre", x: jar.wallL + r + rnd() * (jar.wallR - jar.wallL - 2 * r), y: 330 - i * 26 - rnd() * 10, vx: (rnd() - 0.5) * 100, vy: rnd() * 200 }));
    }
    const limit = Math.round(D.PHYS.jar.restMax / DT);
    let n = 0;
    while (n < limit && !BE.Phys.allAsleep(jar)) { BE.Phys.stepJar(jar, DT); n++; }
    let out = 0;
    for (const b of jar.bodies) if (b.x - b.r < jar.wallL - 1 || b.x + b.r > jar.wallR + 1 || b.y + b.r > jar.floor + 1 || !isFinite(b.x) || !isFinite(b.y)) out++;
    return { rest: BE.Phys.allAsleep(jar), t: n * DT, out };
  }
  test("Physique", "40 étoiles lâchées : repos < 6 s dans ≥ 99 % des cas, aucun corps hors des murs (100 essais)", () => {
    let fails = 0, out = 0, worst = 0;
    for (let k = 0; k < 100; k++) { const r = dropTrial(1000 + k, 40); if (!r.rest) fails++; out += r.out; worst = Math.max(worst, r.t); }
    assert(fails <= 1, fails + " essais sans repos en 6 s");
    eq(out, 0, "corps hors des murs");
  });
  test("Physique", "aucun tunneling contre clous et Ombres à 900 px/s (10 000 lancers)", () => {
    // Tunneling = une trajectoire qui recouvre l'obstacle d'au moins 2 px sans aucun contact enregistré.
    // (Un effleurement < 2 px peut tomber entre deux pas : ce n'est pas une traversée.)
    const rnd = U.mulberry32(77);
    const FL = D.PHYS.flight;
    let miss = 0, inside = 0;
    for (let k = 0; k < 10000; k++) {
      const size = 1 + Math.floor(rnd() * 5);
      const s = BE.Phys.makeFlightStar({ id: 1, size, color: "givre" }, 0, { x: 0, y: 0 });
      const shadow = k % 4 === 3;
      const ob = shadow ? { id: 7, x: 0, y: 0, r: D.SHADOWS.rampante.r, alive: true } : { idx: 0, x: 0, y: 0, r: D.GEOM.pegR, active: true, kind: "gray" };
      const R = s.r + ob.r;
      const a = rnd() * Math.PI * 2, off = (rnd() * 2 - 1) * (R - 2);
      const dist = R + 8 + rnd() * 60;
      s.x = -Math.cos(a) * dist - Math.sin(a) * off; s.y = -Math.sin(a) * dist + Math.cos(a) * off;
      s.vx = Math.cos(a) * FL.vmax; s.vy = Math.sin(a) * FL.vmax;
      let hit = false;
      const world = { stars: [s], pegs: shadow ? [] : [ob], targets: shadow ? [ob] : [], g: 0, t: 0, wallL: -1e5, wallR: 1e5, ceil: -1e5, exitY: 1e5,
        ignoreObstacles: false, hooks: { peg() { hit = true; }, target() { hit = true; } } };
      for (let i = 0; i < 60; i++) {
        BE.Phys.stepFlight(world, DT);
        if (Math.hypot(s.x - ob.x, s.y - ob.y) < R - 0.05) inside++;
      }
      if (!hit) miss++;
    }
    eq(miss, 0, "lancers passés à travers");
    eq(inside, 0, "pas terminés à l'intérieur d'un obstacle");
  });
  test("Physique", "fusions : le nombre de corps diminue exactement de 1 par fusion", () => {
    withRun({ seed: "PHY-C" }, (run) => {
      const rnd = U.mulberry32(5);
      for (let t = 0; t < 12; t++) {
        run.jar.bodies = [];
        const n = 26 + Math.floor(rnd() * 20);
        for (let i = 0; i < n; i++) {
          const size = 1 + Math.floor(rnd() * 3);
          BE.Jar.add(run, { size, color: rnd() < 0.5 ? "givre" : "foudre", x: 40 + rnd() * 280, y: 330 - i * 22 });
        }
        const S = { log: [], orphan: true };
        const before = run.jar.bodies.length;
        for (let i = 0; i < 720; i++) BE.Jar.step(run, DT, S);
        const merges = S.log.filter((e) => e.t === "merge").length;
        assert(!S.log.some((e) => e.t === "bigbang" || e.t === "stone"), "Big Bang / Pierre inattendu");
        eq(before - run.jar.bodies.length, merges, "essai " + t);
      }
    });
  });
  test("Physique", "déterminisme : 100 tirs identiques → 100 empreintes identiques", () => {
    const meta = simMeta({});
    let snap = null;
    const st0 = makeState(meta);
    Dbg.inSandbox(st0, () => { BE.Run.startNewRun({ seed: "DET-1" }); BE.Run.go("AIM"); botShots(st0, 3, "det"); snap = U.deepCopy(st0.run); });
    const hashes = {};
    for (let k = 0; k < 100; k++) {
      const st = makeState(meta);
      st.run = U.deepCopy(snap); st.play = freshPlay(); st.scene = "AIM";
      const h = Dbg.inSandbox(st, () => { BE.Run.refreshPegs(); shootSync(st, 64.5); return runHash(st.run); });
      hashes[h] = (hashes[h] || 0) + 1;
    }
    eq(Object.keys(hashes).length, 1, "empreintes distinctes");
  });

  // ---------------------------------------------------------------- 8. débordement
  function overfill(run) {
    // Pierres de taille 3 empilées dans les murs courants : deux rangées de plus que ce qui tient sous l'horizon
    const J = run.jar, r = D.SIZES[3].r, per = Math.max(1, Math.floor((J.wallR - J.wallL) / (2 * r)));
    const rows = Math.floor((J.floor - BE.Run.horizon(run)) / (2 * r)) + 2;
    let k = 0;
    for (let row = 0; row < rows; row++) for (let c = 0; c < per; c++) BE.Jar.add(run, { size: 3, stone: true, x: J.wallL + r + c * 2 * r + (row % 2) * 3, y: J.floor - r - row * 2 * r - (k++ % 3) });
    BE.Jar.stabilize(run, 720);
  }
  test("Débordement", "détection au repos seulement (une étoile qui entre au-dessus de l'horizon ne fait pas perdre)", () => {
    withRun({ seed: "OVF-1" }, (run, st) => {
      let seenAbove = false;
      shootSync(st, 90, null, (s) => { if ((s.scene === "FLIGHT" || s.scene === "SETTLE") && BE.Jar.overflowing(s.run).length) seenAbove = true; });
      assert(seenAbove, "l'étoile doit passer au-dessus de l'horizon pendant la résolution");
      eq(run.result, null, "défaite");
      assert(st.scene === "AIM" || st.scene === "SHOP", "scène " + st.scene);
    });
  });
  test("Débordement", "la Bougie évapore exactement les corps qui dépassent, puis Débordement", () => {
    withRun({ seed: "OVF-2" }, (run, st) => {
      run.jar.bodies = []; overfill(run);
      const over = BE.Jar.overflowing(run).map((b) => b.id);
      assert(over.length > 0, "le bocal doit déborder");
      const before = run.jar.bodies.map((b) => b.id);
      run.candle = 1; run.total = 0; run.shotsLeft = 3;
      BE.Run.go("CHECK"); BE.Run.update(DT);
      eq(st.scene, "SETTLE_CANDLE"); eq(run.candle, 0);
      const after = run.jar.bodies.map((b) => b.id);
      eq(after.join(","), before.filter((id) => over.indexOf(id) < 0).join(","), "corps évaporés");
      advance(st, (s) => s.scene !== "SETTLE_CANDLE" && s.scene !== "CHECK", 5000);
      eq(st.scene, "AIM");
      overfill(run);
      assert(BE.Jar.overflowing(run).length > 0, "second débordement");
      BE.Run.go("CHECK"); BE.Run.update(DT);
      eq(st.scene, "RUN_LOST"); eq(run.result.cause, "overflow");
    });
  });

  // ---------------------------------------------------------------- 9. Ombres
  function emptyFirm(run) { run.firm.shadows = []; run.firm.boss = null; run.firm.ghost = []; }
  test("Ombres", "descente bloquée si la cellule est occupée (le compteur reste à 0)", () => {
    withRun({ seed: "OMB-1" }, (run) => {
      emptyFirm(run);
      const a = BE.Firm.makeShadow(run, "rampante", 2, 2), b = BE.Firm.makeShadow(run, "lourde", 2, 3);
      a.counter = 1; b.counter = 2;
      BE.Firm.descend(run);
      eq(a.row, 2, "bloquée"); eq(a.counter, 0); eq(b.row, 3); eq(b.counter, 1);
      BE.Firm.descend(run);
      eq(b.row, 4, "la Lourde descend"); eq(a.row, 3, "la cellule libérée est prise (bas → haut)");
    });
  });
  test("Ombres", "Nuée : se divise en 2 Rampantes de PV ⌈0,4 × PV max⌉", () => {
    withRun({ seed: "OMB-2" }, (run) => {
      emptyFirm(run);
      const n = BE.Firm.makeShadow(run, "nuee", 2, 1);
      BE.Firm.damage(run, n, 99, {}, { log: [] });
      const kids = BE.Firm.alive(run);
      eq(kids.length, 2); eq(kids.map((k) => k.type + "@" + k.col + "," + k.row).sort().join(" "), "rampante@1,1 rampante@3,1");
      eq(kids[0].hp, Math.ceil(0.4 * n.maxhp));
    });
  });
  test("Ombres", "Voleuse : absorbe l'étoile si elle survit, pas si elle meurt", () => {
    withRun({ seed: "OMB-3" }, (run) => {
      emptyFirm(run);
      const v = BE.Firm.makeShadow(run, "voleuse", 2, 1);
      const S = { log: [] };
      eq(BE.Firm.hitByStar(run, v, BE.Phys.makeFlightStar({ id: 900, size: 1, color: "givre" }, 90), S), "absorb");
      assert(S.log.some((e) => e.t === "absorb") && v.alive, "absorption journalisée");
      eq(BE.Firm.hitByStar(run, v, BE.Phys.makeFlightStar({ id: 901, size: 5, color: "givre" }, 90), S), undefined);
      assert(!v.alive, "tuée");
    });
  });
  test("Ombres", "Blindée : armure 2 contre les étoiles, ignorée par éclairs et Brûlure", () => {
    withRun({ seed: "OMB-4" }, (run) => {
      emptyFirm(run);
      const b = BE.Firm.makeShadow(run, "blindee", 2, 1);
      const hp = b.hp, S = { log: [] };
      BE.Firm.hitByStar(run, b, BE.Phys.makeFlightStar({ id: 902, size: 2, color: "givre" }, 90), S);
      eq(b.hp, hp, "taille 2 : 0 dégât");
      BE.Firm.hitByStar(run, b, BE.Phys.makeFlightStar({ id: 903, size: 3, color: "braise" }, 90), S);
      eq(b.hp, hp - 1, "taille 3 : 1 dégât");
      BE.Firm.bolt(run, b, { size: 2 }, S);
      eq(b.hp, hp - 3, "éclair : ignore l'armure");
      BE.Firm.burnTick(run, S);
      eq(b.hp, hp - 4, "Brûlure : ignore l'armure");
    });
  });
  test("Ombres", "Éteignoir : éteint les 4 clous de sa cellule, rallumés à sa mort", () => {
    withRun({ seed: "OMB-5" }, (run) => {
      emptyFirm(run);
      const e = BE.Firm.makeShadow(run, "eteignoir", 2, 1);
      eq(Object.keys(BE.Firm.dousedPegs(run)).sort((a, b) => a - b).join(","), "1,2,6,7");
      eq(BE.Firm.pegs(run).filter((p) => p.dark).length, 4);
      BE.Firm.damage(run, e, 99, {}, { log: [] });
      eq(BE.Firm.pegs(run).filter((p) => p.dark).length, 0);
    });
  });
  test("Ombres", "gel : l'Ombre saute exactement une descente", () => {
    withRun({ seed: "OMB-6" }, (run) => {
      emptyFirm(run);
      const s = BE.Firm.makeShadow(run, "rampante", 1, 1);
      s.frozen = true;
      BE.Firm.descend(run);
      eq(s.row, 1, "gelée"); eq(s.frozen, false);
      BE.Firm.descend(run);
      eq(s.row, 2, "dégelée");
    });
  });

  // ---------------------------------------------------------------- Nuit Blanche (intégration, GDD §2.2 / §9.2)
  test("Débordement", "Vidange : bocal vidé (Veilleuse) ; Insomniaque : Soleils et + et Pierres restent, Bougie rallumée", () => {
    withRun({ seed: "VID-1" }, (run) => {
      for (let s = 1; s <= 5; s++) BE.Jar.add(run, { size: s, color: "braise", x: 100 + s * 30, y: 560 - s * 60 });
      eq(BE.Jar.vidange(run), 2, "or : Soleil + Géante"); eq(run.jar.bodies.length, 0);
    });
    withRun({ seed: "VID-2", gardien: "insomniaque" }, (run) => {
      for (let s = 1; s <= 5; s++) BE.Jar.add(run, { size: s, color: s % 2 ? "braise" : "givre", x: 100 + s * 30, y: 560 - s * 60 });
      run.candle = 0;
      eq(BE.Jar.vidange(run), 0, "or : seules les étoiles qui partent paient (Soleil et Géante restent)");
      const left = run.jar.bodies.map((b) => (b.stone ? "P" : "") + b.size).sort().join(",");
      // Soleil + Géante + 2 Pierres (268 px) ne tiennent pas côte à côte dans 200 px : ce qui dépasse encore s'évapore
      assert(left === "4,5,P2,P2" || left === "4,P2,P2" || left === "5,P2,P2", "Pierres de départ + grosses étoiles : " + left);
      eq(BE.Jar.overflowing(run).length, 0, "rien au-dessus de l'horizon");
      eq(run.candle, 1, "Bougie rallumée");
      assert(BE.Jar.isRest(run), "bocal tassé au repos");
    });
  });
  test("Débordement", "Vidange partielle (Insomniaque) : une Nova sous une Géante ne laisse jamais un bocal débordant", () => {
    withRun({ seed: "VID-3", gardien: "insomniaque" }, (run) => {
      run.jar.bodies = [];
      const cx = (run.jar.wallL + run.jar.wallR) / 2;
      BE.Jar.add(run, { size: 6, color: "braise", x: cx, y: D.GEOM.floor - D.SIZES[6].r });
      BE.Jar.add(run, { size: 5, color: "givre", x: cx + 2, y: D.GEOM.floor - 2 * D.SIZES[6].r - D.SIZES[5].r });
      BE.Jar.add(run, { size: 4, color: "seve", x: cx - 4, y: D.GEOM.floor - 2 * D.SIZES[6].r - 2 * D.SIZES[5].r - D.SIZES[4].r });
      BE.Jar.add(run, { size: 2, color: "braise", x: run.jar.wallL + 30, y: D.GEOM.floor - 30 });
      BE.Jar.stabilize(run, 720);
      BE.Jar.vidange(run);
      eq(BE.Jar.overflowing(run).length, 0, "aucun corps au-dessus de l'horizon après la Vidange");
      assert(BE.Jar.isRest(run), "bocal au repos");
    });
  });
  test("Débordement", "nuit gagnée bocal débordant : le trop-plein s'évapore sans Bougie ; la nuit suivante ne commence pas en Débordement", () => {
    withRun({ seed: "TRIM-1" }, (run, st) => {
      run.jar.bodies = []; overfill(run);
      assert(BE.Jar.overflowing(run).length > 0, "le bocal doit déborder");
      run.candle = 1; run.total = run.quota;
      BE.Run.go("CHECK"); BE.Run.update(DT);
      eq(st.scene, "NIGHT_WON");
      eq(BE.Jar.overflowing(run).length, 0, "trop-plein évaporé");
      eq(run.candle, 1, "Bougie intacte");
      assert(st.play.won.fill >= 0.99, "remplissage mesuré avant l'évaporation");
    });
  });
  test("Débordement", "Trou Noir seul au fond : jamais en Débordement, même Éclipse 4 + Verre soufflé (horizon ≤ 492)", () => {
    withRun({ seed: "TN-1", eclipse: 4, relics: ["R27"] }, (run) => {
      run.jar.bodies = [];
      BE.Jar.add(run, { size: 7, color: "braise", x: 180, y: D.GEOM.floor - D.SIZES[7].r });
      BE.Jar.stabilize(run, 240);
      assert(BE.Run.horizon(run) <= D.GEOM.horizonMax, "horizon borné");
      eq(BE.Jar.overflowing(run).length, 0, "Trou Noir sous la ligne");
      assert(BE.Jar.fill(run) < 1, "jauge < 100 %");
    });
  });
  test("Débordement", "jauge = max(surface / capacité, hauteur du tas) ; 100 % quand le tas touche l'horizon", () => {
    withRun({ seed: "GAU-1" }, (run) => {
      run.jar.bodies = [];
      eq(BE.Jar.fill(run), 0, "bocal vide");
      BE.Jar.add(run, { size: 6, color: "braise", x: 180, y: D.GEOM.floor - D.SIZES[6].r });
      BE.Jar.stabilize(run, 240);
      const h = BE.Run.horizon(run), hh = D.GEOM.floor - h;
      near(BE.Jar.fill(run), (2 * D.SIZES[6].r) / hh, 0.02, "une Nova seule : terme hauteur");
      assert(BE.Jar.fill(run) > BE.Jar.areaFill(run), "hauteur > surface");
      eq(BE.Jar.fillOf(0, h, 200, D.GEOM.floor, h), 1, "haut du tas sur la ligne → 100 %");
      // Verre soufflé : le ctx (sans reliques) et le remplissage effectif (avec) diffèrent comme la jauge
      const ctx = BE.Score.buildCtx([], run);
      const eff = BE.Score.effective(ctx, ["R27"]);
      assert(eff.jarFill > ctx.jarFill, "Verre soufflé : la ligne descend, le remplissage monte");
    });
  });
  test("Sauvegarde", "reprise d'une sauvegarde v1.0 (bocal large, anciens rayons) : migrée vers le bocal courant", () => {
    const meta = simMeta({});
    const st = makeState(meta);
    Dbg.inSandbox(st, () => {
      BE.Run.startNewRun({ seed: "MIG-1" }); BE.Run.go("AIM");
      botShots(st, 3, "mig");
      const old = JSON.parse(JSON.stringify(st.run, (k, v) => (k && k.charCodeAt(0) === 95 ? undefined : v)));
      // forme v1.0 : murs 16/344, rayons 14…62, corps répartis sur toute la largeur
      const R1 = [0, 14, 19, 25, 32, 40, 50, 62];
      old.v = 1; old.jar.wallL = 16; old.jar.wallR = 344;
      old.jar.bodies = [];
      for (let i = 0; i < 9; i++) {
        const size = 1 + (i % 5), r = R1[size], m = r * r;
        old.jar.bodies.push(Object.assign(BE.Phys.makeBody({ id: 500 + i, size, color: "braise", x: 30 + i * 36, y: D.GEOM.floor - r }), { r, m, im: 1 / m, sleep: true }));
      }
      eq(BE.Save.checkRun(old), null, "une sauvegarde v1 reste acceptée");
      BE.Run.resume(old);
      const run = st.run;
      eq(run.v, 2, "version");
      eq(run.jar.wallL, D.GEOM.jarL, "mur gauche"); eq(run.jar.wallR, D.GEOM.jarR, "mur droit");
      for (const b of run.jar.bodies) {
        eq(b.r, D.SIZES[b.size].r, "rayon du corps " + b.id);
        assert(b.x - b.r >= D.GEOM.jarL - 1 && b.x + b.r <= D.GEOM.jarR + 1, "corps " + b.id + " dans le bocal");
      }
      eq(BE.Jar.overflowing(run).length, 0, "pas de Débordement hérité");
      eq(st.scene, "AIM");
      const f = BE.Run.funnel(run);
      eq(f.L, D.GEOM.jarL, "entonnoir");
    });
  });
  test("Nuit Blanche", "victoire + Planétarium : Vidange → Aube → Lune 6, jamais de RUN_WON, Fragments au-delà de la Lune 5 seulement", () => {
    withRun({ seed: "NB-1", rooms: ["planetarium"] }, (run, st) => {
      assert(!BE.Run.nuitBlanche(run), "pas proposée hors victoire");
      run.lune = 5; run.nuit = 2; run.nightBest = [[1, 1, 1], [1, 1, 1], [1, 1, 1], [1, 1, 1], [1, 1, 1]];
      run.result = { won: true, cause: null, lune: 5, nuit: 2 };
      st.scene = "RUN_END"; // (sans RUN_END.enter : la victoire est déjà soldée)
      Object.defineProperty(run, "_metaSummary", { value: { total: 80 }, configurable: true });
      assert(BE.Run.nuitBlanche(run), "proposée après une victoire");
      assert(BE.Run.startNuitBlanche(), "démarrée");
      eq(st.scene, "VIDANGE"); eq(run.result, null); eq(run.nuitBlanche.frags, 80); eq(run.nuitBlanche.from, 5);
      advance(st, (s) => s.scene === "SHOP", 5000);
      eq(st.scene, "SHOP");
      BE.Run.leaveShop();
      eq(run.lune, 6); eq(run.nuit, 0); eq(run.quota, D.quota(6, 0, 0));
      run.nuit = 2; run.total = run.quota; BE.Run.go("NIGHT_WON");
      advance(st, (s) => s.scene !== "NIGHT_WON", 5000);
      eq(st.scene, "VIDANGE", "Nuit du Boss de la Lune 6 → Vidange (pas de 2e victoire)");
      run.lune = 8; run.nightBest[5] = [3, 2, 1]; run.nightBest[6] = [2, 2, 2]; run.nightBest[7] = [1, 0];
      run.result = { won: false, cause: "quota", lune: 8, nuit: 1 };
      const f0 = st.meta.fragments;
      const sum = BE.Meta.endRun(run);
      eq(sum.total, 3 * 2 + 7, "2 Lunes au-delà de la 5e + 7 nuits");
      eq(st.meta.fragments - f0, sum.total);
      eq(BE.Meta.endRun(run), sum, "idempotent");
    });
  });
  test("Nuit Blanche", "refusée en Ciel du Jour et sans Planétarium", () => {
    withRun({ seed: "NB-2" }, (run) => {
      run.result = { won: true, cause: null, lune: 5, nuit: 2 };
      assert(!BE.Run.nuitBlanche(run), "sans Planétarium");
    });
    withRun({ seed: "NB-3", rooms: ["planetarium"] }, (run) => {
      run.result = { won: true, cause: null, lune: 5, nuit: 2 }; run.daily = true;
      assert(!BE.Run.nuitBlanche(run), "Ciel du Jour");
    });
  });

  // ---------------------------------------------------------------- 10. outils (bac à sable, bots)
  test("Bots", "un run random complet dans le bac à sable ne touche ni l'état réel ni la sauvegarde", () => {
    const st0 = BE.state, run0 = st0.run, scene0 = st0.scene, mute0 = BE.muteEvents;
    let ls = null, snapLS = null;
    try { ls = window.localStorage; snapLS = ls.getItem("bde.v1.run") + "|" + ls.getItem("bde.v1.meta"); } catch (e) { ls = null; }
    let emitted = 0;
    const off = BE.on("*", () => { emitted++; });
    let rec;
    try { rec = Dbg.playRun({ policy: "random", seed: "BOT-T" }, 0); } finally { off(); }
    assert(!rec.error, rec.error);
    assert(rec.cause || rec.won, "le run doit se terminer");
    assert(BE.state === st0 && st0.run === run0 && st0.scene === scene0 && BE.muteEvents === mute0, "état réel modifié");
    eq(emitted, 0, "événements émis hors du bac à sable");
    if (ls) eq(ls.getItem("bde.v1.run") + "|" + ls.getItem("bde.v1.meta"), snapLS, "localStorage modifié");
    eq(Dbg.sandboxDepth(), 0);
  });
  test("Bots", "greedy ≥ random en Lumière sur un même tir (copie d'état)", () => {
    withRun({ seed: "BOT-G" }, (run) => {
      const rng = U.mulberry32(3);
      const g = trial(run, Dbg.POLICIES.greedy(run, rng)).lumiere;
      let sum = 0, k = 0;
      for (let a = 12; a <= 168; a += 26) { sum += trial(run, a).lumiere; k++; }
      assert(g >= sum / k, "greedy " + g + " < moyenne " + (sum / k).toFixed(1));
      assert(trial(run, 90).lumiere === trial(run, 90).lumiere, "essai non déterministe");
      eq(run.shotIndex, 0, "le run réel n'a pas tiré");
    });
  });

  /**
   * Lance les tests unitaires (§13.2). filter : sous-chaîne du groupe ou du nom.
   * Renvoie {passed, failed, total, ms, results:[{group, name, ok, msg, ms}]}.
   */
  Dbg.tests = function (filter) {
    const t0 = now();
    const results = [];
    for (const t of REG) {
      if (filter && (t.group + " " + t.name).toLowerCase().indexOf(String(filter).toLowerCase()) < 0) continue;
      const t1 = now();
      let ok = true, msg = "";
      try { t.fn(); } catch (e) { ok = false; msg = e instanceof Fail ? e.message : "exception : " + (e && e.stack ? e.stack.split("\n").slice(0, 3).join(" | ") : e); }
      while (stack.length) leave(); // sécurité : un test interrompu ne laisse jamais le bac à sable ouvert
      results.push({ group: t.group, name: t.name, ok, msg, ms: Math.round(now() - t1) });
    }
    const out = { passed: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length, total: results.length, ms: Math.round(now() - t0), results };
    Dbg.lastTests = out;
    return out;
  };
  Dbg.tests.list = REG;
  /** Affiche les résultats en console (tableau) et renvoie un texte. */
  Dbg.testReport = function (out) {
    out = out || Dbg.lastTests;
    const lines = ["Tests unitaires : " + out.passed + "/" + out.total + " OK (" + out.ms + " ms)"];
    for (const r of out.results) lines.push((r.ok ? "  ✓ " : "  ✗ ") + "[" + r.group + "] " + r.name + (r.ok ? "" : " — " + r.msg) + "  (" + r.ms + " ms)");
    return lines.join("\n");
  };

  // =====================================================================================================
  // OVERLAY, RACCOURCIS ET PANNEAUX (#debug)
  // =====================================================================================================
  let fps = 60, acc = 0, frames = 0;
  let logicAcc = 0, renderMs = 0, logicMs = 0, lastLogic = 0;
  const mouse = { x: 180, y: 380 };
  Dbg.panel = null;   // {kind:"tests"|"sim"|"help", …}
  let settling = null; // {t} : bocal animé après un lâcher de debug (hors résolution)

  Dbg.frame = function (el) {
    acc += el; frames++;
    if (acc >= 0.5) { fps = frames / acc; acc = 0; frames = 0; }
    logicMs = logicMs * 0.9 + logicAcc * 0.1; lastLogic = logicAcc; logicAcc = 0;
    if (settling) stepSettle(el);
  };

  // chronométrage de la logique et du rendu (#debug seulement)
  let wrapped = false;
  function wrapTimers() {
    if (wrapped || !BE.Run || !BE.Render) return;
    wrapped = true;
    const up = BE.Run.update, dr = BE.Render.draw;
    BE.Run.update = function (dt) {
      if (!Dbg.enabled || stack.length) return up.call(this, dt);
      const t = now(); try { return up.call(this, dt); } finally { logicAcc += now() - t; }
    };
    BE.Render.draw = function () {
      if (!Dbg.enabled) return dr.apply(this, arguments);
      const t = now(); try { return dr.apply(this, arguments); } finally { renderMs = renderMs * 0.9 + (now() - t) * 0.1; }
    };
  }
  if (Dbg.enabled) wrapTimers();
  if (typeof window !== "undefined") window.addEventListener("hashchange", () => { Dbg.enabled = /debug/.test(location.hash || ""); if (Dbg.enabled) wrapTimers(); });

  function hex8(n) { return ("0000000" + ((n >>> 0).toString(16))).slice(-8); }

  // ---------------------------------------------------------------- lâchers et bocal animé
  /**
   * Quarantaine des triches : pendant fn(), la méta du joueur est remplacée par une copie jetable (réglages partagés),
   * saveMeta est neutralisé et Meta.completeDefi désactivé. Les FX et l'audio réagissent normalement, mais aucune
   * triche de debug ne fait progresser les défis, statistiques ou le Grimoire du joueur.
   */
  function quarantine(fn) {
    const st = BE.state, real = st.meta;
    if (!real || stack.length) return fn();
    const copy = U.deepCopy(real);
    copy.settings = real.settings;
    const sm = BE.Save.saveMeta, cd = BE.Meta && BE.Meta.completeDefi;
    st.meta = copy; BE.Save.saveMeta = () => true;
    if (cd) BE.Meta.completeDefi = () => false;
    try { return fn(); } finally { st.meta = real; BE.Save.saveMeta = sm; if (cd) BE.Meta.completeDefi = cd; }
  }
  Dbg.quarantine = quarantine;
  function jarVisible(st) { return st.run && (BE.Run.IN_GAME[st.scene] || st.scene === "SETTLE_CANDLE"); }
  const STEPS_BY_GAME = { FLIGHT: 1, SETTLE: 1, DESCENT: 1, SETTLE_CANDLE: 1 };
  function startSettle() {
    if (!settling) settling = { t: 0, S: { log: [], orphan: true } };
    else settling.t = 0;
    BE.Phys.wakeAll(BE.state.run.jar);
  }
  function stepSettle(el) {
    const st = BE.state, run = st.run;
    if (!run || !jarVisible(st)) { settling = null; return; }
    if (st.paused) return;
    if (STEPS_BY_GAME[st.scene]) { settling = null; return; } // la scène fait déjà avancer le bocal
    const n = Math.min(16, Math.max(1, Math.round(el / DT)));
    quarantine(() => { for (let i = 0; i < n; i++) { BE.Jar.step(run, DT, settling.S); settling.t += DT; } });
    if (BE.Jar.isRest(run) || settling.t >= D.PHYS.jar.restMax) {
      BE.Phys.freeze(run.jar);
      const add = BE.Score.live(settling.S.log, 0).mult - 1;
      if (add > 0) { run.reserve = (run.reserve || 0) + add; BE.emit("reserve", { n: add, total: run.reserve }); }
      settling = null;
    }
  }
  function dropStar(size, x, y) {
    const run = BE.state.run;
    const fams = BE.Shop.families();
    const color = fams[Math.floor(Math.random() * fams.length)];
    const r = D.SIZES[size].r;
    const b = BE.Jar.add(run, { size, color, x: U.clamp(x, run.jar.wallL + r, run.jar.wallR - r), y: y === undefined ? D.GEOM.flightToJar : y, vx: 0, vy: 60 });
    BE.emit("land", { body: b, x: b.x, y: b.y });
    return b;
  }
  function fillJar() {
    for (let i = 0; i < 10; i++) dropStar(1 + Math.floor(Math.random() * 3), 40 + Math.random() * 280, D.GEOM.flightToJar - i * 34);
    startSettle();
    BE.UI.toast("Debug : 10 étoiles lâchées");
  }
  function killAll() {
    const run = BE.state.run, S = { log: [], orphan: true };
    let n = 0;
    for (let pass = 0; pass < 5; pass++) {
      const list = BE.Firm.targets(run);
      if (!list.length) break;
      for (const t of list) { BE.Firm.damage(run, t, 1e6, {}, S); n++; }
    }
    BE.Run.refreshPegs();
    BE.UI.toast("Debug : " + n + " Ombre" + (n > 1 ? "s" : "") + " éteinte" + (n > 1 ? "s" : ""));
  }
  function addRelic(id) {
    const run = BE.state.run;
    if (!run) return;
    const d = D.RELIC_BY_ID[id];
    if (run.relics.some((r) => r.id === id)) { BE.UI.toast(d.nom + " : déjà possédée"); BE.emit("ui:no", {}); return; }
    if (run.relics.length >= run.rules.relicSlots) { run.relics[run.relics.length - 1] = { id, evolved: !!d.evo }; BE.UI.toast("Emplacements pleins : " + d.nom + " remplace la dernière"); }
    else { run.relics.push({ id, evolved: !!d.evo }); BE.UI.toast("Relique ajoutée : " + d.nom); }
    BE.Run.invalidatePassives();
    BE.Run.refreshPegs();
    BE.emit("ui:ok", {});
    if (BE.Run.save) BE.Run.save();
  }

  // ---------------------------------------------------------------- actions longues
  function runTestsUI() {
    Dbg.panel = { kind: "tests", busy: true, t: BE.state.time };
    setTimeout(() => {
      const out = Dbg.tests();
      console.log(Dbg.testReport(out));
      try { if (console.table) console.table(out.results.map((r) => ({ groupe: r.group, test: r.name, ok: r.ok ? "oui" : "NON", ms: r.ms, message: r.msg }))); } catch (e) { /* */ }
      Dbg.panel = { kind: "tests", out, t: BE.state.time, scroll: 0 };
      BE.emit(out.failed ? "ui:no" : "ui:ok", {});
    }, 40);
  }
  function runSimUI() {
    if (Dbg.panel && Dbg.panel.kind === "sim" && Dbg.panel.busy) return;
    const P = { kind: "sim", busy: true, i: 0, n: 10, t: BE.state.time };
    Dbg.panel = P;
    Dbg.simulate({ runs: 10, policy: "greedy", seed: "DBG" + Math.floor(Math.random() * 1e4), onProgress: (i, n) => { P.i = i; P.n = n; } }).then((res) => {
      P.busy = false; P.res = res; P.copied = Dbg.copyCSV();
      BE.emit("ui:ok", {});
    });
  }

  // ---------------------------------------------------------------- raccourcis
  BE.on("hover", (e) => { if (e.x > -50) { mouse.x = e.x; mouse.y = e.y; } });
  BE.on("pmove", (e) => { mouse.x = e.x; mouse.y = e.y; });
  BE.on("pdown", (e) => { mouse.x = e.x; mouse.y = e.y; });
  BE.on("key", (e) => {
    if (!Dbg.enabled || e.repeat) return;
    const st = BE.state, run = st.run, c = e.code;
    const myPanel = BE.UI.panel && BE.UI.panel.type === "debugRelic";
    if (c === "Backquote") { Dbg.visible = !Dbg.visible; return; }
    if (c === "KeyH") { Dbg.panel = Dbg.panel && Dbg.panel.kind === "help" ? null : { kind: "help", t: st.time }; return; }
    if (c === "KeyT") { if (Dbg.panel && Dbg.panel.kind === "tests" && !Dbg.panel.busy) Dbg.panel = null; else runTestsUI(); return; }
    if (c === "KeyM") { if (Dbg.panel && Dbg.panel.kind === "sim" && !Dbg.panel.busy) Dbg.panel = null; else runSimUI(); return; }
    if (!run || (BE.UI.panel && !myPanel)) return;
    if (c === "KeyB") { BE.UI.panel = myPanel ? null : { type: "debugRelic", t: st.time, dismiss: true }; BE.UI.focus = -1; return; }
    if (myPanel) return;
    if (c === "KeyG") { run.gold += 50; run.runStats.gold += 50; BE.emit("gold", { n: 50, x: 180, y: 300 }); BE.UI.toast("Debug : +50 or"); if (st.scene === "SHOP") BE.Run.save(); }
    else if (c === "KeyN" && BE.Test) {
      // CHECK → NIGHT_WON (événement « quota ») est joué tout de suite, en quarantaine
      quarantine(() => { if (!BE.Test.winNight()) BE.emit("ui:no", {}); else if (st.scene === "CHECK") BE.Run.update(DT); });
    }
    else if (c === "KeyK" && jarVisible(st)) quarantine(killAll);
    else if (c === "KeyJ" && jarVisible(st)) fillJar();
    else if (/^Digit[1-7]$/.test(c) && jarVisible(st)) {
      const size = +c.slice(5);
      dropStar(size, mouse.x);
      startSettle();
    }
  });

  // ---------------------------------------------------------------- dessin
  function box(g, x, y, w, h, a, col) {
    g.fillStyle = "rgba(5,7,16," + (a === undefined ? 0.8 : a) + ")";
    BE.FX.roundRect(g, x, y, w, h, 8); g.fill();
    g.strokeStyle = col || "rgba(125,255,176,0.45)"; g.lineWidth = 1; BE.FX.roundRect(g, x + 0.5, y + 0.5, w - 1, h - 1, 8); g.stroke();
  }
  function txt(g, t, x, y, col, size, align, weight) {
    g.font = (weight || 600) + " " + (size || 9) + "px " + (size >= 11 ? D.FONT : "ui-monospace, Menlo, Consolas, monospace");
    g.textAlign = align || "left"; g.textBaseline = "top"; g.fillStyle = col || "#7dffb0";
    g.fillText(t, x, y);
  }
  function fit(g, t, maxW) {
    if (g.measureText(t).width <= maxW) return t;
    while (t.length > 3 && g.measureText(t + "…").width > maxW) t = t.slice(0, -1);
    return t + "…";
  }

  Dbg.draw = function (g) {
    if (!Dbg.enabled) return;
    const st = BE.state;
    try {
      if (Dbg.visible) drawOverlay(g, st);
      if (BE.UI.panel && BE.UI.panel.type === "debugRelic") drawRelicPicker(g, st);
      if (Dbg.panel) drawPanel(g, st);
    } catch (e) { console.error("[BE.Debug]", e); }
  };

  function drawOverlay(g, st) {
    const run = st.run;
    const lines = [];
    lines.push(["FPS " + fps.toFixed(0) + " · logique " + logicMs.toFixed(2) + " · rendu " + renderMs.toFixed(2) + " ms", fps < 50 ? "#ffd166" : "#7dffb0"]);
    lines.push([st.scene + (st.paused ? " (pause)" : "") + " · " + st.sceneT.toFixed(1) + " s · ×" + BE.Run.timeScale().toFixed(1), "#eef2ff"]);
    lines.push(["corps " + (run ? run.jar.bodies.length : 0) + " · particules " + (BE.FX.pools && BE.FX.pools.parts ? BE.FX.pools.parts.count() : 0) +
      (run ? " · rempl. " + Math.round(BE.Jar.fill(run) * 100) + " %" : ""), "#7dffb0"]);
    if (run) {
      lines.push(["graine " + run.seed + " · L" + run.lune + " " + NIGHT[run.nuit] + " · tir " + run.shotIndex + " (" + run.shotsLeft + " restants)", "#7dffb0"]);
      lines.push(["Lumière " + run.total + "/" + run.quota + " · or " + run.gold + " · réserve " + U.fmtMult(run.reserve || 0), "#7dffb0"]);
      const s = run.streams;
      lines.push(["bag " + hex8(s.bag) + " shop " + hex8(s.shop) + " waves " + hex8(s.waves), "#8a93b8"]);
      lines.push(["pegs " + hex8(s.pegs) + " misc " + hex8(s.misc), "#8a93b8"]);
    }
    lines.push(["H aide · T tests · M simulation · ² masquer", "#8a93b8"]);
    const w = 214, h = 8 + lines.length * 11;
    box(g, 2, 46, w, h, 0.66);
    lines.forEach((l, i) => { g.font = "600 9px ui-monospace, Menlo, Consolas, monospace"; txt(g, fit(g, l[0], w - 10), 7, 50 + i * 11, l[1], 9); });
    if (settling) txt(g, "bocal : repos…", 7, 50 + h, "#ffd166", 9);
  }

  // Relique au choix (B) : grille des 30 reliques + évolutions ; tap ou flèches + Entrée.
  function drawRelicPicker(g, st) {
    const list = D.RELICS.concat(D.EVOLUTIONS || []);
    const cols = 6, cell = 54, x0 = 180 - (cols * cell) / 2, y0 = 118;
    const rows = Math.ceil(list.length / cols);
    box(g, x0 - 10, y0 - 50, cols * cell + 20, rows * cell + 110, 0.94, "rgba(125,255,176,0.6)");
    txt(g, "DEBUG · Ajouter une relique", 180, y0 - 40, "#7dffb0", 13, "center", 800);
    txt(g, "Touche une relique (Échap pour fermer)", 180, y0 - 22, "#8a93b8", 10, "center", 600);
    let hov = null;
    const run = st.run;
    list.forEach((d, i) => {
      const cx = x0 + (i % cols) * cell + cell / 2, cy = y0 + Math.floor(i / cols) * cell + cell / 2;
      const id = "dbg_" + d.id;
      const owned = run && run.relics.some((r) => r.id === d.id);
      const over = Math.abs(mouse.x - cx) < cell / 2 && Math.abs(mouse.y - cy) < cell / 2;
      const foc = BE.UI.isFocused ? BE.UI.isFocused(id) : false;
      if (over || foc) hov = d;
      const rar = D.RARITY[d.rar] || D.RARITY.C;
      g.fillStyle = over || foc ? "rgba(125,255,176,0.16)" : "rgba(18,24,50,0.9)";
      BE.FX.roundRect(g, cx - 24, cy - 24, 48, 48, 9); g.fill();
      g.strokeStyle = rar.color; g.lineWidth = over || foc ? 2 : 1; BE.FX.roundRect(g, cx - 24, cy - 24, 48, 48, 9); g.stroke();
      g.globalAlpha = owned ? 0.35 : 1;
      BE.Render.drawRelicIcon(d.id, cx, cy, 30);
      g.globalAlpha = 1;
      if (owned) txt(g, "✓", cx + 14, cy - 22, "#7dffb0", 11, "left", 800);
      BE.UI.region(id, cx - cell / 2, cy - cell / 2, cell, cell, () => { addRelic(d.id); BE.UI.panel = null; }, true);
    });
    const yb = y0 + rows * cell + 6;
    if (hov) {
      const rar = D.RARITY[hov.rar] || D.RARITY.C;
      txt(g, hov.nom + " · " + rar.nom + " · " + hov.id, 180, yb, rar.color, 12, "center", 800);
      g.font = "600 10px " + D.FONT;
      txt(g, fit(g, hov.txt || "", cols * cell), 180, yb + 17, "#eef2ff", 10, "center", 600);
    } else txt(g, "Survole une relique pour voir son effet", 180, yb + 6, "#8a93b8", 10, "center", 600);
  }

  function drawPanel(g, st) {
    const P = Dbg.panel;
    if (P.kind === "help") {
      const L = [
        ["G", "+50 or"], ["N", "gagner la nuit"], ["J", "remplir le bocal (10 étoiles)"], ["B", "ajouter une relique au choix"],
        ["K", "tuer toutes les Ombres"], ["1 … 7", "lâcher une étoile de cette taille à la souris"], ["T", "tests unitaires (§13.2)"],
        ["M", "simuler 10 runs (bot greedy)"], ["²", "masquer / afficher l'overlay"], ["H", "fermer cette aide"],
      ];
      const x = 30, y = 150, w = 300, h = 44 + L.length * 20;
      box(g, x, y, w, h, 0.93);
      txt(g, "DEBUG · Raccourcis", 180, y + 12, "#7dffb0", 13, "center", 800);
      L.forEach((l, i) => { txt(g, l[0], x + 16, y + 38 + i * 20, "#ffd166", 11, "left", 800); txt(g, l[1], x + 80, y + 38 + i * 20, "#eef2ff", 11, "left", 600); });
      BE.UI.region("dbgClose", x, y, w, h, () => { Dbg.panel = null; }, false);
      return;
    }
    if (P.kind === "tests") {
      const x = 14, y = 96, w = 332;
      if (P.busy) { box(g, x, y, w, 60, 0.94); txt(g, "Tests unitaires en cours…", 180, y + 22, "#7dffb0", 13, "center", 800); return; }
      const out = P.out, bad = out.results.filter((r) => !r.ok);
      const groups = [];
      for (const r of out.results) { let gr = groups.find((q) => q.name === r.group); if (!gr) groups.push(gr = { name: r.group, ok: 0, n: 0 }); gr.n++; if (r.ok) gr.ok++; }
      const h = 70 + Math.ceil(groups.length / 2) * 17 + (bad.length ? 18 + Math.min(10, bad.length) * 26 : 22);
      const okCol = out.failed ? "#ff4d6d" : "#7dffb0";
      box(g, x, y, w, h, 0.95, okCol);
      txt(g, (out.failed ? "✗ " : "✓ ") + "Tests : " + out.passed + " / " + out.total + " réussis", 180, y + 12, okCol, 14, "center", 800);
      txt(g, out.ms + " ms · détails dans la console · T pour fermer", 180, y + 32, "#8a93b8", 10, "center", 600);
      groups.forEach((gr, i) => {
        const gx = x + 16 + (i % 2) * 158, gy = y + 54 + Math.floor(i / 2) * 17;
        txt(g, (gr.ok === gr.n ? "✓ " : "✗ ") + gr.name + " " + gr.ok + "/" + gr.n, gx, gy, gr.ok === gr.n ? "#7dffb0" : "#ff4d6d", 11, "left", 700);
      });
      let yy = y + 60 + Math.ceil(groups.length / 2) * 17;
      if (!bad.length) txt(g, "Tout est vert.", 180, yy, "#eef2ff", 11, "center", 600);
      bad.slice(0, 10).forEach((r) => {
        g.font = "700 10px " + D.FONT; txt(g, fit(g, "✗ [" + r.group + "] " + r.name, w - 24), x + 12, yy, "#ff4d6d", 10, "left", 700);
        g.font = "600 9px " + D.FONT; txt(g, fit(g, r.msg, w - 30), x + 20, yy + 12, "#eef2ff", 9, "left", 600);
        yy += 26;
      });
      BE.UI.region("dbgClose", x, y, w, h, () => { Dbg.panel = null; }, false);
      return;
    }
    if (P.kind === "sim") {
      const x = 14, y = 96, w = 332;
      if (P.busy) {
        box(g, x, y, w, 70, 0.94);
        txt(g, "Simulation (bot greedy) : " + P.i + " / " + P.n + " runs", 180, y + 16, "#7dffb0", 13, "center", 800);
        g.fillStyle = "rgba(125,255,176,0.2)"; g.fillRect(x + 20, y + 44, w - 40, 8);
        g.fillStyle = "#7dffb0"; g.fillRect(x + 20, y + 44, (w - 40) * (P.i / Math.max(1, P.n)), 8);
        return;
      }
      const S = P.res.summary;
      const h = 74 + S.targets.length * 17 + 36;
      box(g, x, y, w, h, 0.95);
      txt(g, "Simulation : " + S.n + " runs · " + S.wins + " victoire" + (S.wins > 1 ? "s" : ""), 180, y + 12, "#7dffb0", 13, "center", 800);
      txt(g, "Rapport complet : console (BE.Debug.lastReport)", 180, y + 32, "#8a93b8", 10, "center", 600);
      S.targets.forEach((t, i) => {
        const yy = y + 54 + i * 17;
        g.font = "600 10px " + D.FONT;
        txt(g, fit(g, t.label, 170), x + 12, yy, "#eef2ff", 10, "left", 600);
        txt(g, t.txt, x + 236, yy, t.ok ? "#7dffb0" : "#ffd166", 10, "right", 800);
        txt(g, t.target, x + 246, yy, "#8a93b8", 10, "left", 600);
      });
      txt(g, P.copied ? "CSV copié dans le presse-papiers · M pour fermer" : "CSV : BE.Debug.lastCSV · M pour fermer", 180, y + h - 24, "#8a93b8", 10, "center", 600);
      BE.UI.region("dbgClose", x, y, w, h, () => { Dbg.panel = null; }, false);
    }
  }
})(window.BE = window.BE || {});
