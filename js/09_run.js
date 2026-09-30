/* 09_run.js — BE.Run : machine à états du run (§12.5), nuits, tirs, économie, visée, sauvegarde. */
(function (BE) {
  "use strict";

  const Run = (BE.Run = {});
  const D = BE.DATA, G = D.GEOM, U = BE.util, Phys = BE.Phys, Firm = BE.Firm, Jar = BE.Jar, Score = BE.Score;

  /** État global partagé (voir docs/ARCHITECTURE.md). */
  BE.state = BE.state || {
    scene: "BOOT", prevScene: null, sceneT: 0, time: 0, paused: false,
    run: null, meta: null, play: null, turbo: 1, ui: {},
  };

  /** Scènes : TITLE SELECT NIGHT_INTRO AIM FLIGHT SETTLE TURRETS COUNT DESCENT CHECK NIGHT_WON VIDANGE SHOP RUN_LOST RUN_WON RUN_END */
  Run.RESOLVING = { FLIGHT: 1, SETTLE: 1, TURRETS: 1, DESCENT: 1, SETTLE_CANDLE: 1 };
  Run.IN_GAME = { NIGHT_INTRO: 1, AIM: 1, FLIGHT: 1, SETTLE: 1, TURRETS: 1, COUNT: 1, DESCENT: 1, CHECK: 1, SETTLE_CANDLE: 1, NIGHT_WON: 1, VIDANGE: 1, RUN_LOST: 1, RUN_WON: 1 };
  /** Scènes où la nuit (ou le run) est déjà jouée : « Abandonner » n'y a pas de sens (§10.6). */
  Run.SETTLED = { NIGHT_WON: 1, VIDANGE: 1, RUN_LOST: 1, RUN_WON: 1, RUN_END: 1 };

  // ================================================================ passifs agrégés
  let pCache = { key: null, val: null };
  /** Agrège les passifs et hooks de vol des reliques (et du Gardien). Mis en cache par composition de reliques. */
  Run.passives = function (run) {
    const key = run.gardien + "|" + run.eclipse + "|" + run.relics.map((r) => r.id).join(",");
    if (pCache.key === key) return pCache.val;
    const P = {
      interestCap: D.ECO.interestCap, swaps: 0, horizon: 0, previewContacts: 1, hpMult: 1, unusedShotBonus: 0,
      bolts: 1, horloge: false, goldPerKill: 0, alchimiste: false, firstMergeTwice: false, sablier: false,
      dmgBonus: [], restPeg: [], onLaunch: [],
    };
    for (const r of run.relics) {
      const d = D.RELIC_BY_ID[r.id];
      if (!d) continue;
      const p = d.passive;
      if (p) {
        if (p.interestCap) P.interestCap = Math.max(P.interestCap, p.interestCap);
        if (p.swaps) P.swaps += p.swaps;
        if (p.horizon) P.horizon += p.horizon;
        if (p.previewContacts) P.previewContacts += p.previewContacts;
        if (p.hpMult) P.hpMult *= p.hpMult;
        if (p.unusedShotBonus) P.unusedShotBonus += p.unusedShotBonus;
        if (p.bolts) P.bolts = Math.max(P.bolts, p.bolts);
        if (p.goldPerKill) P.goldPerKill += p.goldPerKill;
        ["horloge", "alchimiste", "firstMergeTwice", "sablier", "boltFreeze", "plasmaMerge"].forEach((k) => { if (p[k]) P[k] = true; });
        if (p.goldPerStone) P.goldPerStone = (P.goldPerStone || 0) + p.goldPerStone;
      }
      const f = d.flight;
      if (f) {
        if (f.dmgBonus) P.dmgBonus.push(f.dmgBonus);
        if (f.restPeg) P.restPeg.push(f.restPeg);
        if (f.onLaunch) P.onLaunch.push(f.onLaunch);
      }
    }
    if (run.eclipse >= 6) P.interestCap = Math.min(P.interestCap, 3);
    if (!run.rules.interest) P.interestCap = 0;
    pCache = { key, val: P };
    return P;
  };
  Run.invalidatePassives = () => { pCache.key = null; };

  /** Ligne d'horizon sans les reliques (§4) : 452, +16 à l'Éclipse 4. */
  Run.horizonBase = function (run) { return G.horizon + (run.eclipse >= 4 ? 16 : 0); };
  /**
   * Ligne d'horizon courante (§4) : 452, +24 Verre soufflé, +16 Éclipse 4 (492 au plus). Bornée à G.horizonMax : un
   * Trou Noir seul au fond (haut à 616 − 116 = 500) reste toujours sous la ligne.
   */
  Run.horizon = function (run) {
    return Math.min(G.horizonMax, Run.horizonBase(run) + Run.passives(run).horizon);
  };

  // ================================================================ création
  function makeBag(run, list) {
    run.bag = list.map(([color, size]) => ({ id: run.nextBagId++, size, color, grav: null }));
  }

  /** Nouveau run. opts: {gardien, seed, eclipse, daily} */
  Run.newRun = function (opts) {
    opts = opts || {};
    const g = D.GARDIEN_BY_ID[opts.gardien || "veilleuse"] || D.GARDIENS[0];
    const seed = opts.seed || U.newSeed();
    const eclipse = opts.eclipse || 0;
    const run = {
      v: 2, seed, streams: U.seedStreams(seed), daily: !!opts.daily, gardien: g.id, eclipse,
      rules: U.deepCopy(g.rules),
      lune: 1, nuit: 0, shotIndex: 0, shotsLeft: 0, bonusShots: 0, graceShots: 0, total: 0, quota: 0,
      gold: D.ECO.startGold, candle: eclipse >= 6 ? 0 : g.rules.candle, swapsLeft: 0, reserve: 0, metronome: 0,
      bag: [], draw: [], nextSizeBonus: 0, relics: [], reactionCounts: {},
      clous: { A: null, B: null, C: null, D: null, E: null, F: null },
      firm: Firm.create(), jar: Jar.create(), nextId: 1, nextBagId: 1,
      phase: "AIM", pendingAngle: null, shop: null, lastCtx: null, lastShot: null, lastReward: null,
      runStats: { shots: 0, merges: 0, pureMerges: 0, kills: 0, reactions: 0, stones: 0, maxSize: 0, gold: 0, bigBangs: 0, lightTotal: 0, bestShot: null },
      nightBest: [], nightMax: 0, result: null, aimAngle: 90,
    };
    const bagKey = g.bag === "standard" && BE.Meta && BE.Meta.hasRoom("serre") ? "standardSeve" : g.bag;
    makeBag(run, D.BAGS[bagKey]);
    // Pierres de départ (L'Insomniaque) : réparties sur la largeur du bocal
    const ss = g.rules.startStones || [], jw = run.jar.wallR - run.jar.wallL;
    ss.forEach((s, i) => Jar.add(run, { size: s, stone: true, x: run.jar.wallL + (jw * (i + 1)) / (ss.length + 1), y: G.floor - D.SIZES[s].r }));
    if (opts.relics) for (const id of opts.relics) run.relics.push({ id, evolved: false });
    Firm.setupLune(run);
    Run.startNight(run);
    return run;
  };

  /** Prépare une nuit (quota, tirs, pioche, Ombres). */
  Run.startNight = function (run) {
    const P = Run.passives(run);
    run.quota = D.quota(run.lune, run.nuit, run.eclipse);
    run.total = 0; run.shotIndex = 0; run.bonusShots = 0;
    // Lune 1 : tirs d'apprentissage (accueil ; le bot greedy finit ses nuits de Lune 1 en ≤ 6 tirs, l'équilibrage n'en dépend pas)
    run.graceShots = run.lune === 1 && run.eclipse < 5 ? D.ECO.lune1Grace : 0;
    run.shotsLeft = (run.eclipse >= 5 ? 5 : run.rules.shots) + run.graceShots;
    run.swapsLeft = run.rules.swaps + P.swaps;
    run.metronome = 0;
    run.nightMax = 0;
    run.draw = []; run.pileEnd = 0;
    Run.ensureDraw(run);
    Firm.setupNight(run);
    Jar.applyRules(run);
    run.phase = "AIM";
  };

  /**
   * Garantit assez d'étoiles dans la pioche (courante + aperçus), §8.5. La pioche courante est `draw[0 .. pileEnd-1]` ;
   * quand il n'en reste plus assez pour les aperçus, le mélange SUIVANT du Sac entier est préparé à l'avance et
   * ajouté après `pileEnd` (il ne sera pioché qu'une fois la pioche courante vide). Les étoiles encore visibles
   * de la pioche courante sont placées en fin de ce mélange : jamais deux fois la même étoile dans la file visible.
   */
  Run.ensureDraw = function (run) {
    const need = 1 + Math.max(1, run.rules.previewNext || 1);
    if (typeof run.pileEnd !== "number" || run.pileEnd > run.draw.length || run.pileEnd < 0) run.pileEnd = run.draw.length;
    let guard = 0;
    while (run.draw.length < need && guard++ < 8) {
      const ids = run.bag.map((b) => b.id);
      U.rshuffle(run.streams, "bag", ids);
      const seen = {};
      for (const id of run.draw) seen[id] = 1;
      const next = ids.filter((id) => !seen[id]).concat(ids.filter((id) => seen[id]));
      if (!run.draw.length) run.pileEnd = next.length; // début de nuit : ce mélange EST la pioche
      run.draw = run.draw.concat(next);
    }
  };
  /** Étoiles restant à piocher dans la pioche courante (étoile courante comprise) — compteur du Sac (§10.3). */
  Run.pileLeft = function (run) {
    return typeof run.pileEnd === "number" ? Math.max(0, Math.min(run.pileEnd, run.draw.length)) : run.draw.length;
  };
  Run.bagItem = (run, id) => run.bag.find((b) => b.id === id) || null;
  /** Étoile courante {id,size,color,grav} avec bonus Photosynthèse appliqué. */
  Run.current = function (run) {
    const it = Run.bagItem(run, run.draw[0]);
    if (!it) return null;
    return { id: it.id, size: Math.min(D.MAX_LAUNCH_SIZE, it.size + (run.nextSizeBonus || 0)), color: it.color, grav: it.grav, bonus: run.nextSizeBonus || 0 };
  };
  Run.nextStars = function (run) {
    const n = Math.max(1, run.rules.previewNext || 1);
    return run.draw.slice(1, 1 + n).map((id) => Run.bagItem(run, id)).filter(Boolean);
  };

  // ================================================================ scènes
  const SC = {};
  Run.SCENES = SC;
  function play() { return BE.state.play; }

  /** Change de scène (exit → enter). */
  Run.go = function (scene) {
    const st = BE.state;
    const from = st.scene;
    if (SC[from] && SC[from].exit) SC[from].exit();
    st.prevScene = from; st.scene = scene; st.sceneT = 0;
    if (SC[scene] && SC[scene].enter) SC[scene].enter();
    BE.emit("scene", { from, to: scene });
  };

  function newPlay() {
    return {
      pegs: [], log: [], orphanLog: [], flight: null, shot: null,
      aim: { active: false, angle: 90, cancel: false, prev: null, prevAngle: -999, dirty: true, kbd: false },
      count: null, turret: null, descent: null, won: null, lost: null, settleT: 0, world: null,
      live: { eclat: 0, mult: 1 }, reserveShown: 0,
    };
  }

  /** Lance un nouveau run et passe à l'intro de la première nuit. */
  Run.startNewRun = function (opts) {
    const st = BE.state;
    st.run = Run.newRun(opts);
    st.play = newPlay();
    st.paused = false;
    Run.invalidatePassives();
    Run.refreshPegs();
    if (BE.Audio) BE.Audio.music.setLune(1);
    Run.go("NIGHT_INTRO");
  };
  /** Reprend un run sauvegardé (§12.6). */
  Run.resume = function (data) {
    const st = BE.state;
    st.run = data; st.play = newPlay(); st.paused = false;
    Run.invalidatePassives();
    Run.migrate(data);
    // §12.6 : le bocal n'est sérialisé qu'au repos (gelé par SETTLE / DESCENT / SETTLE_CANDLE avant AIM). Un tir en
    // attente est rejoué depuis cet état EXACT : re-stabiliser ici déplacerait les corps et changerait l'issue du tir
    // rejoué (30 % des reprises divergeaient). On ne stabilise que si un corps n'est pas au repos (sauvegarde ancienne).
    if (!Phys.allAsleep(data.jar)) Jar.stabilize(data, 30);
    Run.refreshPegs();
    if (BE.Audio) BE.Audio.music.setLune(data.lune);
    if (data.phase === "SHOP") Run.go("SHOP");
    else if (data.phase === "PENDING_SHOT" && typeof data.pendingAngle === "number") {
      const a = data.pendingAngle;
      Run.go("AIM");
      Run.fire(a, true);
    } else Run.go("AIM");
  };
  /**
   * Sauvegarde v1 (bocal large de la v1.0 : murs 16/344, rayons 14…62) → v2 (§12.6) : murs du bocal courants, rayon et
   * masse de chaque corps selon DATA.SIZES, tassement silencieux (fusions → réserve), puis le trop-plein s'évapore.
   * Aussi appliqué si un rayon ne correspond plus aux données (sauvegarde d'une version intermédiaire).
   */
  Run.migrate = function (run) {
    const J = run.jar, PJ = D.PHYS.jar;
    let changed = run.v !== 2;
    for (const b of J.bodies) {
      const r = D.SIZES[b.size] ? D.SIZES[b.size].r : b.r;
      if (b.r !== r) { b.r = r; b.m = r * r * (b.stone ? PJ.stoneMass : 1); b.im = 1 / b.m; changed = true; }
    }
    const okL = J.wallL === G.jarL || J.wallL === G.etauL, okR = J.wallR === G.jarR || J.wallR === G.etauR;
    if (!okL || !okR) changed = true;
    run.v = 2;
    if (!changed) return false;
    // murs : on part des murs sauvegardés (plus larges) pour que Jar.applyRules resserre et repousse les corps
    J.wallL = Math.min(J.wallL, G.jarL); J.wallR = Math.max(J.wallR, G.jarR);
    for (const b of J.bodies) b.sleep = false;
    Jar.applyRules(run);
    Jar.settle(run);
    Jar.trim(run);
    return true;
  };
  Run.toTitle = function () { BE.state.paused = false; Run.go("TITLE"); };
  Run.abandon = function () {
    const st = BE.state, run = st.run;
    if (!run) return Run.toTitle();
    // nuit déjà gagnée / run déjà terminé : jamais transformé en défaite
    if (run.result || Run.SETTLED[st.scene] || run.total >= run.quota) { st.paused = false; return false; }
    st.paused = false;
    Run.lose("abandon");
    return true;
  };

  /** Reconstruit la liste des clous (préserve les flashs). */
  Run.refreshPegs = function () {
    const S = play(), run = BE.state.run;
    if (!S || !run) return;
    const old = S.pegs;
    S.pegs = Firm.pegs(run);
    if (old && old.length) for (let i = 0; i < S.pegs.length; i++) S.pegs[i].flash = old[i] ? old[i].flash : 0;
    if (S.flight) S.flight.pegs = S.pegs;
    if (S.world) S.world.pegs = S.pegs;
    S.aim.dirty = true;
  };

  /** Monde de vol pour ce tir (et pour l'aperçu). */
  function makeWorld(run) {
    const S = play();
    return {
      stars: [], pegs: S.pegs, targets: Firm.targets(run),
      g: D.PHYS.flight.g * (Firm.ruleActive(run, "maree") ? D.BOSSES.maree.flightG : 1),
      t: 0, wallL: G.wallL, wallR: G.wallR, ceil: G.ceil, exitY: G.flightToJar, ignoreObstacles: false,
      funnel: Run.funnel(run),
      hooks: makeHooks(run),
    };
  }
  Run.makeWorld = makeWorld;
  /** Entonnoir du vol (§4) : épaules du mur du ciel au col du bocal (murs courants, L'Étau compris). */
  Run.funnel = function (run) {
    return { wl: G.wallL, wr: G.wallR, L: run.jar.wallL, R: run.jar.wallR, y0: G.funnelY, y1: G.rimY, bot: G.floor, e: D.PHYS.flight.eFunnel };
  };

  // ---------------------------------------------------------------- hooks de vol
  function clouPaired(run, slot) {
    const me = run.clous[slot];
    if (!me) return false;
    for (const [a, b] of G.slotPairs) {
      const other = a === slot ? b : b === slot ? a : null;
      if (other && run.clous[other] && run.clous[other].type === me.type) return true;
    }
    return false;
  }
  Run.clouPaired = clouPaired;

  function makeHooks(run) {
    const FL = D.PHYS.flight;
    return {
      pegRest(star, peg) {
        if (peg.kind === "special" && peg.clou && peg.clou.type === "ressort") return FL.eRessort;
        const P = Run.passives(run);
        for (const f of P.restPeg) { const e = f(star, peg); if (e !== undefined) return e; }
        if (star.grav === "lestee") return FL.eLestee;
        if (star.color === "seve") return FL.eSeve;
        return FL.ePeg;
      },
      peg(star, peg) {
        const S = play();
        let eclat = 0, mult = 0;
        const clouType = peg.kind === "special" && peg.clou ? peg.clou.type : null;
        if (clouType) {
          const C = D.CLOUS[clouType], pair = clouPaired(run, peg.slot);
          const per = S.shot.perClou;
          const k = peg.slot;
          switch (clouType) {
            case "or": {
              eclat = 1;
              per[k] = per[k] || 0;
              if (per[k] < C.goldMax) {
                per[k]++;
                const g = pair ? 2 : 1;
                run.gold += g; run.runStats.gold += g;
                S.log.push({ t: "gold", n: g });
                BE.emit("gold", { n: g, x: peg.x, y: peg.y });
              }
              break;
            }
            case "ressort": eclat = pair ? 4 : 2; break;
            case "echo": eclat = Firm.pegNeighbours(S.pegs, peg.idx) * (pair ? 2 : 1); break;
            case "cristal":
              per[k] = per[k] || 0;
              if (per[k] < C.multMax) { per[k]++; mult = pair ? 2 : 1; }
              break;
            case "teint":
              eclat = pair ? 3 : 1;
              if (peg.clou.color) star.color = peg.clou.color;
              break;
            case "prisme":
              eclat = 1;
              if (!S.shot.prismUsed && star.size >= 2) { S.shot.prismUsed = true; splitStar(run, star, pair); }
              break;
          }
        } else if (!peg.dark && !Firm.ruleActive(run, "avare")) eclat = peg.kind === "double" ? 2 : 1;
        if (star.grav === "polie") eclat += 1;
        if (peg.dark) eclat = 0; // Éteignoir : les 4 clous de sa cellule (spéciaux compris) ne donnent aucun Éclat
        // Sève : grossit au 3e contact avec un clou
        star.pegContacts++;
        if (star.color === "seve" && !star.seveGrown && star.pegContacts >= D.SEVE_GROW_AT && star.size < D.MAX_LAUNCH_SIZE) {
          star.seveGrown = true; star.size++; star.r = D.SIZES[star.size].rf;
          BE.emit("grow", { star, x: star.x, y: star.y });
        }
        const k = S.shot.noteK++;
        S.log.push({ t: "peg", idx: peg.idx, kind: peg.kind, clou: clouType, eclat, mult, dark: !!peg.dark });
        peg.flash = BE.state.time;
        BE.emit("peg", { x: peg.x, y: peg.y, k, eclat, mult, peg, star, dark: peg.dark });
      },
      target(star, tg) { return Firm.hitByStar(run, tg, star, play()); },
      wall(star, side) {
        play().log.push({ t: "wall", side });
        BE.emit("wall", { x: star.x, y: star.y, side, star });
      },
      exit(star) { Jar.addFromFlight(run, star, play()); },
    };
  }

  /** Clou Prisme : l'étoile se divise en deux de taille −1 (±25° autour de la vitesse réfléchie). */
  function splitStar(run, star, pair) {
    const S = play();
    star.size--; star.r = D.SIZES[star.size].rf;
    const sp = Math.hypot(star.vx, star.vy), a = Math.atan2(star.vy, star.vx);
    const a1 = a + U.rad(25), a2 = a - U.rad(25);
    star.vx = Math.cos(a1) * sp; star.vy = Math.sin(a1) * sp;
    if (pair) star.dmgBonus = (star.dmgBonus || 0) + 1;
    const twin = Phys.makeFlightStar({ id: run.nextId++, size: star.size, color: star.color, grav: star.grav }, 0, { x: star.x, y: star.y });
    twin.vx = Math.cos(a2) * sp; twin.vy = Math.sin(a2) * sp; twin.t = star.t; twin.dmgBonus = pair ? 1 : 0;
    twin.pegContacts = star.pegContacts; twin.seveGrown = star.seveGrown;
    S.flight.stars.push(twin);
    BE.emit("split", { x: star.x, y: star.y });
  }

  // ---------------------------------------------------------------- tir
  /** Tire l'étoile courante à l'angle donné (degrés, [12,168]). replay=true lors d'une reprise PENDING_SHOT. */
  Run.fire = function (angle, replay) {
    const st = BE.state, run = st.run, S = play();
    if (st.scene !== "AIM" || !run || run.shotsLeft <= 0 || run.result) return false;
    angle = U.clamp(angle, G.aimMin, G.aimMax);
    // anti-save-scum : on écrit l'état d'avant le tir + l'angle (seul appel autorisé à écrire un PENDING_SHOT)
    run.phase = "PENDING_SHOT"; run.pendingAngle = angle; run.aimAngle = angle;
    Run.save(true); // même lors d'une reprise : l'état d'avant le tir reste la référence
    const cur = Run.current(run);
    run.draw.shift();
    if (typeof run.pileEnd === "number") { run.pileEnd--; if (run.pileEnd <= 0) run.pileEnd = run.draw.length; } // pioche vide : le mélange suivant prend le relais
    run.nextSizeBonus = 0;
    run.shotsLeft--; run.shotIndex++; run.runStats.shots++;
    S.log = [{ t: "launch", size: cur.size, color: cur.color, angle }];
    S.shot = { t: 0, angle, noteK: 0, perClou: {}, prismUsed: false, sablier: null, cur };
    const P = Run.passives(run);
    if (P.sablier && run.shotIndex === 1) S.shot.sablier = { at: 0.4, spec: cur };
    S.flight = makeWorld(run);
    const star = Phys.makeFlightStar({ id: run.nextId++, size: cur.size, color: cur.color, grav: cur.grav, bagId: cur.id }, angle,
      { speedMul: cur.grav === "filante" ? D.PHYS.flight.filante : 1 });
    S.flight.stars.push(star);
    for (const f of P.onLaunch) f(S, star);
    S.aim.active = false; S.aim.cancel = false;
    S.live = { eclat: 0, mult: 1 + (run.reserve || 0) };
    BE.emit("launch", { star, angle, x: star.x, y: star.y });
    Run.go("FLIGHT");
    return true;
  };

  /** Échange courante ↔ suivante (§3.1). */
  Run.swap = function (which) {
    const run = BE.state.run;
    if (!run || BE.state.scene !== "AIM") return false;
    if (run.swapsLeft <= 0 || Firm.ruleActive(run, "voile")) { BE.emit("ui:no", {}); return false; }
    const j = Math.max(1, Math.min(which || 1, run.draw.length - 1));
    const t = run.draw[0]; run.draw[0] = run.draw[j]; run.draw[j] = t;
    run.swapsLeft--;
    play().aim.dirty = true;
    BE.emit("swap", {});
    BE.emit("ui:ok", {});
    return true;
  };

  // ---------------------------------------------------------------- visée
  /** Angle (degrés) depuis le Phare vers un point, borné à [12°,168°]. */
  Run.angleTo = function (x, y) {
    let a = U.deg(Math.atan2(y - G.phare.y, x - G.phare.x));
    if (a < 0) a = a < -90 ? G.aimMax : G.aimMin;
    return U.clamp(a, G.aimMin, G.aimMax);
  };
  function aimTo(x, y, start) {
    const S = play(), run = BE.state.run;
    const s = BE.settings || {};
    if (s.aim === "rel") {
      if (start) { S.aim.lastX = x; return; }
      S.aim.angle = U.clamp(S.aim.angle - (x - S.aim.lastX) * 0.35, G.aimMin, G.aimMax);
      S.aim.lastX = x;
    } else S.aim.angle = Run.angleTo(x, y);
    S.aim.cancel = y < G.hudH;
    S.aim.kbd = false;
    if (run) run.aimAngle = S.aim.angle;
  }
  /** Recalcule l'aperçu de trajectoire si l'angle a bougé de plus de 0,2°. */
  Run.updatePreview = function (force) {
    const S = play(), run = BE.state.run;
    if (!S || !run) return;
    if (!force && !S.aim.dirty && Math.abs(S.aim.angle - S.aim.prevAngle) <= 0.2) return;
    const cur = Run.current(run);
    if (!cur) return;
    S.world = makeWorld(run);
    const P = Run.passives(run);
    const contacts = P.previewContacts + ((BE.settings && BE.settings.assistAim) ? 1 : 0);
    S.aim.prev = Phys.preview(S.world, { id: 0, size: cur.size, color: cur.color, grav: cur.grav }, S.aim.angle, contacts,
      { speedMul: cur.grav === "filante" ? D.PHYS.flight.filante : 1 });
    S.aim.prevAngle = S.aim.angle; S.aim.dirty = false;
  };

  // ================================================================ définitions des scènes
  SC.TITLE = {
    enter() {
      BE.state.run = null;
      BE.state.ui.savedRun = BE.Save.loadRun(); // lu une fois (bouton « Continuer »)
      if (BE.Audio) BE.Audio.music.duck(true);
    },
    exit() { if (BE.Audio) BE.Audio.music.duck(false); },
  };
  SC.SELECT = {};

  SC.NIGHT_INTRO = {
    enter() {
      const run = BE.state.run;
      Run.refreshPegs();
      if (BE.Audio) BE.Audio.music.setLune(run.lune);
      BE.emit("nightStart", { lune: run.lune, nuit: run.nuit });
    },
    update() {
      // nouvelles Ombres présentées (1re rencontre) : la carte attend un tap au lieu de se fermer seule (§10.9)
      if (BE.UI && BE.UI.introHold && BE.UI.introHold()) return;
      if (BE.state.sceneT >= D.FX.introCard + (BE.state.run.nuit === 2 ? 0.6 : 0) + (BE.UI && BE.UI.introExtra ? BE.UI.introExtra() : 0)) Run.go("AIM");
    },
  };

  SC.AIM = {
    enter() {
      const run = BE.state.run, S = play();
      run.phase = "AIM"; run.pendingAngle = null;
      // le bocal est sauvegardé (et rejoué) tel quel : s'il reste un corps éveillé (L'Étau, Pierres de départ),
      // on le stabilise ICI, pour que l'état en jeu soit exactement l'état sauvegardé (§12.6)
      if (!Phys.allAsleep(run.jar)) Jar.stabilize(run, 30);
      if (run.jar._wc) run.jar._wc = null; // cache de warm start (non sérialisé) : la reprise repart du même point
      Run.ensureDraw(run);
      Run.refreshPegs();
      S.aim.angle = run.aimAngle || 90; S.aim.dirty = true; S.aim.active = false; S.aim.cancel = false;
      S.log = []; S.flight = null;
      S.live = { eclat: 0, mult: 1 + (run.reserve || 0) };
      Run.updatePreview(true);
      Run.save();
    },
    update(dt) {
      const S = play(), I = BE.Input;
      // clavier : ←/→ ±60°/s (Maj ±15°/s)
      const sp = (I.key("ShiftLeft") || I.key("ShiftRight")) ? 15 : 60;
      if (I.key("ArrowLeft")) { S.aim.angle = U.clamp(S.aim.angle + sp * dt, G.aimMin, G.aimMax); S.aim.kbd = true; }
      if (I.key("ArrowRight")) { S.aim.angle = U.clamp(S.aim.angle - sp * dt, G.aimMin, G.aimMax); S.aim.kbd = true; }
      Run.updatePreview();
      // battement de cœur quand le bocal frôle l'horizon
      S.heartT = (S.heartT || 0) + dt;
      if (S.heartT >= 1.2) { S.heartT = 0; if (Jar.danger(BE.state.run)) BE.emit("heart", {}); }
    },
  };

  SC.FLIGHT = {
    update(dt) {
      const run = BE.state.run, S = play(), W = S.flight;
      S.shot.t += dt;
      if (S.shot.sablier && S.shot.t >= S.shot.sablier.at) {
        const c = S.shot.sablier.spec; S.shot.sablier = null;
        const twin = Phys.makeFlightStar({ id: run.nextId++, size: c.size, color: c.color, grav: c.grav }, S.shot.angle,
          { speedMul: c.grav === "filante" ? D.PHYS.flight.filante : 1 });
        W.stars.push(twin);
        BE.emit("launch", { star: twin, angle: S.shot.angle, x: twin.x, y: twin.y, copy: true });
      }
      W.targets = Firm.targets(run);
      W.ignoreObstacles = S.shot.t >= D.PHYS.flight.ignoreAfter;
      Phys.stepFlight(W, dt);
      for (const s of W.stars) {
        s._tc = (s._tc || 0) + 1;
        if (s._tc % 2 === 0) { s.trail.push(s.x, s.y); if (s.trail.length > 28) s.trail.splice(0, 2); }
      }
      Jar.step(run, dt, S);
      if (W.stars.some((s) => !s.alive || s.exited)) W.stars = W.stars.filter((s) => s.alive && !s.exited);
      S.live = Score.live(S.log, run.reserve);
      if (!W.stars.length && !S.shot.sablier) { S.settleT = 0; Run.go("SETTLE"); }
    },
  };

  SC.SETTLE = {
    update(dt) {
      const run = BE.state.run, S = play();
      S.shot.t += dt; S.settleT += dt;
      Jar.step(run, dt, S);
      S.live = Score.live(S.log, run.reserve);
      if (Jar.isRest(run) || S.settleT >= D.PHYS.jar.restMax) { Phys.freeze(run.jar); Run.go("TURRETS"); }
    },
  };

  SC.TURRETS = {
    enter() {
      const run = BE.state.run, S = play();
      const P = Run.passives(run);
      const queue = [];
      for (const b of run.jar.bodies) if (!b.stone && b.color === "foudre") for (let k = 0; k < P.bolts; k++) queue.push(b.id);
      S.turret = { queue, t: D.FX.turretBolt * 0.6 };
    },
    update(dt) {
      const run = BE.state.run, S = play(), T = S.turret;
      S.shot.t += dt;
      T.t += dt;
      if (!T.queue.length) { if (T.t >= 0.15) Run.go("COUNT"); return; }
      if (T.t < D.FX.turretBolt) return;
      T.t = 0;
      const id = T.queue.shift();
      const b = run.jar.bodies.find((o) => o.id === id);
      if (!b) return;
      const tg = Firm.turretTarget(run, b.x);
      if (!tg) { T.queue.length = 0; return; }
      S.log.push({ t: "bolt", dmg: b.size });
      BE.emit("bolt", { x1: b.x, y1: b.y, x2: tg.x, y2: tg.y, body: b, target: tg });
      Firm.bolt(run, tg, b, S); // dégâts = taille, ignore l'armure ; Œil du Cyclone gèle
      S.live = Score.live(S.log, run.reserve);
    },
  };

  SC.COUNT = {
    enter() {
      const run = BE.state.run, S = play();
      const ctx = Score.buildCtx(S.log, run);
      const res = Score.compute(ctx, run.relics);
      const F = D.FX.count;
      const sched = [];
      let at = F.base;
      for (let i = 1; i < res.steps.length; i++) { sched.push({ at, i }); at += F.relic; }
      S.count = {
        ctx, res, t: 0, sched, next: 0, clashAt: at, totalAt: at + F.final, endAt: at + F.final + F.fly,
        eclat: 0, mult: 0, stepIdx: 0, activeSlot: -1, activeT: 0, activeLabel: null, clashed: false, totaled: false, done: false,
        base: res.steps[0],
      };
      BE.emit("count:start", { res });
      BE.emit("count:tick", { step: 0 });
    },
    update(dt) {
      const run = BE.state.run, S = play(), C = S.count;
      C.t += dt;
      const F = D.FX.count;
      // base : les rubans montent
      const bt = U.clamp(C.t / F.base, 0, 1);
      if (C.stepIdx === 0) { C.eclat = C.base.eclat * U.easeOutCubic(bt); C.mult = 1 + (C.base.mult - 1) * U.easeOutCubic(bt); }
      while (C.next < C.sched.length && C.t >= C.sched[C.next].at) {
        const st = C.res.steps[C.sched[C.next].i];
        C.stepIdx = C.sched[C.next].i; C.eclat = st.eclat; C.mult = st.mult;
        C.activeSlot = st.slot !== undefined ? st.slot : -1; C.activeT = C.t; C.activeStep = st;
        BE.emit(st.final ? "count:final" : "count:relic", { step: C.stepIdx, slot: st.slot, st });
        BE.emit("count:tick", { step: C.stepIdx + 1 });
        C.next++;
      }
      if (!C.clashed && C.t >= C.clashAt) {
        C.clashed = true; C.eclat = C.res.eclat; C.mult = C.res.mult; C.stepIdx = C.res.steps.length;
        BE.emit("count:clash", { res: C.res });
      }
      if (!C.totaled && C.t >= C.totalAt) {
        C.totaled = true;
        BE.emit("count:total", { lumiere: C.res.lumiere, high: C.res.lumiere >= run.quota / 2, quota: run.quota });
      }
      if (C.t >= C.endAt && !C.done) { C.done = true; finishCount(); }
    },
  };
  /** Saut direct au total (tap pendant le décompte). */
  Run.skipCount = function () {
    const S = play();
    if (BE.state.scene !== "COUNT" || !S.count) return;
    const C = S.count;
    if (C.t < C.totalAt) { C.next = C.sched.length; C.t = C.totalAt - 0.001; C.stepIdx = C.res.steps.length; C.eclat = C.res.eclat; C.mult = C.res.mult; C.clashed = true; }
  };
  function finishCount() {
    const st = BE.state, run = st.run, S = play(), C = S.count;
    const res = C.res;
    run.total += res.lumiere;
    run.runStats.lightTotal += res.lumiere;
    run.reserve = 0;
    run.metronome = C.ctx.metronome;
    run.lastCtx = C.ctx;
    run.lastShot = { eclat: res.eclat, mult: res.mult, lumiere: res.lumiere };
    if (!run.runStats.bestShot || res.lumiere > run.runStats.bestShot.lumiere) run.runStats.bestShot = { eclat: res.eclat, mult: res.mult, lumiere: res.lumiere };
    for (const m of C.ctx.merges) run.nightMax = Math.max(run.nightMax, m.size);
    if (C.ctx.bigBang) run.nightMax = 8;
    BE.emit("shotScored", { res, total: run.total, quota: run.quota });
    Run.go(run.total >= run.quota ? "CHECK" : "DESCENT");
  }

  SC.DESCENT = {
    enter() {
      const run = BE.state.run, S = play();
      S.orphanLog = [];
      const OS = { log: S.orphanLog, orphan: true };
      Firm.burnTick(run, OS);
      if (Firm.ruleActive(run, "faim") && (run.shotIndex === 3 || run.shotIndex === 6)) Jar.eatBiggest(run);
      const stones = Firm.descend(run);
      const b = run.firm.boss;
      if (Firm.ruleActive(run, "grele") && b) stones.push({ size: 1, x: b.x, grele: true });
      Firm.spawn(run);
      Run.refreshPegs();
      S.descent = { t: 0, stones, dropped: false, OS, settle: 0 };
    },
    update(dt) {
      const run = BE.state.run, S = play(), Dd = S.descent;
      Dd.t += dt;
      if (!Dd.dropped && Dd.t >= 0.28) {
        Dd.dropped = true;
        for (const s of Dd.stones) Jar.dropStone(run, s.size, s.x);
      }
      if (Dd.dropped) { Jar.step(run, dt, Dd.OS); Dd.settle += dt; }
      if (Dd.t >= D.FX.descent && Dd.dropped && (Jar.isRest(run) || Dd.settle >= D.PHYS.jar.restMax)) {
        Phys.freeze(run.jar);
        // fusions orphelines → réserve (§5.5)
        const add = Score.live(S.orphanLog, 0).mult - 1;
        if (add > 0) { run.reserve = (run.reserve || 0) + add; BE.emit("reserve", { n: add, total: run.reserve }); }
        Run.go("CHECK");
      }
    },
  };

  SC.CHECK = {
    update() {
      const run = BE.state.run;
      if (run.total >= run.quota) return Run.go("NIGHT_WON");
      const over = Jar.overflowing(run);
      if (over.length) {
        if (run.candle > 0) {
          run.candle--;
          BE.emit("candle", { bodies: over });
          Jar.evaporate(run, over);
          // on laisse le bocal se reposer avant de continuer (fusions orphelines → réserve, comme en DESCENTE)
          play().settleT = 0; play().candleLog = [];
          Run.go("SETTLE_CANDLE");
          return;
        }
        BE.emit("overflow", { bodies: over });
        return Run.lose("overflow", 0, over);
      }
      if (run.shotsLeft <= 0) return Run.lose("quota", run.quota - run.total);
      Run.go("AIM");
    },
  };
  SC.SETTLE_CANDLE = {
    update(dt) {
      const run = BE.state.run, S = play();
      S.settleT += dt;
      if (!S.candleLog) S.candleLog = [];
      if (!S.candleOS) S.candleOS = { log: S.candleLog, orphan: true };
      S.candleOS.log = S.candleLog;
      Jar.step(run, dt, S.candleOS);
      if (S.settleT > 0.5 && (Jar.isRest(run) || S.settleT >= D.PHYS.jar.restMax)) {
        Phys.freeze(run.jar);
        // §5.5 : les fusions du bocal qui s'affaisse après la Bougie sont orphelines → réserve du tir suivant
        const add = Score.live(S.candleLog, 0).mult - 1;
        if (add > 0) { run.reserve = (run.reserve || 0) + add; BE.emit("reserve", { n: add, total: run.reserve }); }
        S.candleLog = []; S.candleOS = null;
        Run.go("CHECK");
      }
    },
  };

  SC.NIGHT_WON = {
    enter() {
      const run = BE.state.run, S = play();
      S.won = { t: 0, rewarded: false, converted: false, fill: Jar.fill(run), area: Jar.areaFill(run) };
      BE.emit("quota", { total: run.total, quota: run.quota });
      recordNight(run, run.nightMax || 1);
      // §2.1 étape 7 : le quota passe avant le Débordement ; « le quota éteint le trop-plein » — ce qui dépasse
      // l'horizon s'évapore (sans Bougie) pour que la nuit suivante ne commence jamais en Débordement
      const over = Jar.overflowing(run);
      if (over.length) { BE.emit("trim", { n: over.length, y: Run.horizon(run) }); S.won.trimmed = Jar.trim(run); }
    },
    update(dt) {
      const run = BE.state.run, S = play(), W = S.won;
      W.t += dt;
      if (!W.converted && W.t >= D.FX.nightWonFreeze) {
        W.converted = true;
        for (const t of Firm.targets(run)) { t.alive = false; t.converted = true; BE.emit("convert", { target: t, x: t.x, y: t.y }); }
      }
      if (!W.rewarded && W.t >= D.FX.nightWonFreeze + D.FX.nightWonConvert) {
        W.rewarded = true;
        const P = Run.passives(run);
        const interest = Math.min(P.interestCap, Math.floor(run.gold / D.ECO.interestPer)); // avant la récompense
        const night = D.ECO.nightReward[run.nuit];
        // les tirs d'apprentissage (Lune 1) sont les derniers de la rangée : inutilisés, ils ne rapportent rien
        const paid = Math.max(0, run.shotsLeft - (run.graceShots || 0));
        const shots = paid * (D.ECO.unusedShot + P.unusedShotBonus);
        run.gold += interest + night + shots;
        run.runStats.gold += interest + night + shots;
        const grace = Math.min(run.shotsLeft, run.graceShots || 0); // tirs d'apprentissage restés inutilisés (affichés, sans or)
        run.lastReward = { lune: run.lune, nuit: run.nuit, night, shots, shotsLeft: paid, grace, interest, vidange: 0, chest: run.firm.chest };
        BE.emit("reward", run.lastReward);
      }
      if (W.t >= D.FX.nightWonFreeze + D.FX.nightWonConvert + 1.1) {
        if (run.nuit === 2) Run.go(run.lune >= D.LUNES && !run.nuitBlanche ? "RUN_WON" : "VIDANGE");
        else Run.go("SHOP");
      }
    },
  };

  SC.VIDANGE = {
    enter() {
      const run = BE.state.run;
      const leave = Jar.vidangeLeaving(run), keep = run.jar.bodies.filter((b) => leave.indexOf(b) < 0);
      let a = 0;
      for (const b of keep) a += Math.PI * b.r * b.r;
      play().vid = { n: Jar.vidangeGold(run), done: false, leave: leave.map((b) => b.id), kept: leave.length < run.jar.bodies.length,
        fill0: Jar.fill(run), fill1: Math.min(1, a / Jar.capacity(run)) }; // jauge : du remplissage courant vers ce qui reste
      BE.emit("vidange", { n: play().vid.n });
    },
    update() {
      const run = BE.state.run, V = play().vid;
      if (!V.done && BE.state.sceneT >= D.FX.vidange) {
        V.done = true;
        const n = Jar.vidange(run);
        run.gold += n; run.runStats.gold += n;
        if (run.lastReward) run.lastReward.vidange = n;
        Run.go("SHOP");
      }
    },
  };

  SC.SHOP = {
    enter() {
      const run = BE.state.run;
      run.phase = "SHOP";
      BE.Shop.enter(run);
      if (BE.Audio) BE.Audio.music.duck(true);
      Run.save();
    },
    exit() { if (BE.Audio) BE.Audio.music.duck(false); },
  };
  /** Quitte l'Aube : nuit suivante. */
  Run.leaveShop = function () {
    const run = BE.state.run;
    if (!run || BE.state.scene !== "SHOP") return;
    BE.Shop.leave(run);
    if (run.nuit < 2) run.nuit++;
    else { run.lune++; run.nuit = 0; Firm.setupLune(run); }
    Run.startNight(run);
    Run.refreshPegs();
    Run.go("NIGHT_INTRO");
  };

  function recordNight(run, v) {
    while (run.nightBest.length < run.lune) run.nightBest.push([]);
    run.nightBest[run.lune - 1][run.nuit] = v;
  }

  /** Défaite : cause "quota" | "overflow" | "abandon". */
  Run.lose = function (cause, deficit, bodies) {
    const run = BE.state.run;
    recordNight(run, 0);
    run.result = { won: false, cause, deficit: deficit || 0, lune: run.lune, nuit: run.nuit };
    play().lost = { bodies: (bodies || []).map((b) => b.id) };
    Run.go("RUN_LOST");
  };
  SC.RUN_LOST = { update() { if (BE.state.sceneT >= (BE.state.run.result.cause === "abandon" ? 0.05 : 2.0)) Run.go("RUN_END"); } };
  SC.RUN_WON = {
    enter() { const run = BE.state.run; run.result = { won: true, cause: null, lune: run.lune, nuit: run.nuit }; BE.emit("victory", {}); },
    update() { if (BE.state.sceneT >= 1.6) Run.go("RUN_END"); },
  };
  // ---------------------------------------------------------------- Nuit Blanche (Lunes infinies, GDD §2.2 / §9.2)
  /** Nuit Blanche proposable ? (run gagné, hors Ciel du Jour, Planétarium construit, pas déjà en Nuit Blanche) */
  Run.nuitBlanche = function (run) {
    run = run || BE.state.run;
    return !!(run && run.result && run.result.won && !run.daily && !run.nuitBlanche && BE.Meta && BE.Meta.hasRoom("planetarium"));
  };
  /** Depuis la fin de run d'une victoire : on continue le même run au-delà de la Lune 5 (Vidange → Aube → Lune 6…). */
  Run.startNuitBlanche = function () {
    const st = BE.state, run = st.run;
    if (st.scene !== "RUN_END" || !Run.nuitBlanche(run)) return false;
    const prev = run._metaSummary; // Fragments déjà versés pour la victoire (14_meta)
    run.nuitBlanche = { from: run.lune, frags: prev ? prev.total : 0, kills: run.runStats.kills | 0, merges: run.runStats.merges | 0, pure: run.runStats.pureMerges | 0 };
    run.result = null;
    delete run._metaSummary;
    st.ui.endSummary = null; st.paused = false;
    if (!st.play) st.play = newPlay();
    BE.emit("nuitBlanche", { lune: run.lune });
    Run.go("VIDANGE"); // fin de la Lune 5 : vidange puis Aube, puis Lune 6 (quotas ×3,5 par Lune, PV ×1,35)
    return true;
  };

  SC.RUN_END = {
    enter() {
      const st = BE.state, run = st.run;
      st.ui.endSummary = BE.Meta ? BE.Meta.endRun(run) : { total: 0, lines: [] };
      BE.Save.clearRun();
      if (st.meta) BE.Save.saveMeta(st.meta);
    },
  };

  // ================================================================ boucle
  /** Un pas logique (dt = 1/120 s). */
  Run.update = function (dt) {
    const st = BE.state;
    st.sceneT += dt;
    const sc = SC[st.scene];
    if (sc && sc.update) sc.update(dt);
  };

  /** Facteur de vitesse de simulation (§5.8) : 1–4, × turbo (tests). */
  Run.timeScale = function () {
    const st = BE.state, S = st.play;
    let k = 1;
    if (Run.RESOLVING[st.scene] && S && S.shot) {
      const T = S.shot.t;
      const auto = T >= D.PHYS.speed.auto3 ? 3 : T >= D.PHYS.speed.auto2 ? 2 : 1;
      k = BE.Input.isHeld() ? (auto > 1 ? D.PHYS.speed.cap : D.PHYS.speed.hold) : auto;
    } else if (st.scene === "COUNT" && BE.Input.isHeld()) k = D.PHYS.speed.countHold;
    const spd = (BE.settings && BE.settings.speed) || 1; // réglage « Vitesse » (13_ui)
    if (spd > 1 && (Run.RESOLVING[st.scene] || st.scene === "COUNT")) k = Math.min(D.PHYS.speed.cap, k * spd);
    return k * (st.turbo || 1);
  };

  // ================================================================ sauvegarde
  /** Sauvegarde le run. pending = true seulement depuis Run.fire (instantané d'avant le tir, §12.6). */
  Run.save = function (pending) {
    const run = BE.state.run;
    if (!run || run.result) return false;
    return BE.Save.saveRun(run, pending === true ? { pending: true } : undefined);
  };
  /** Le run peut-il être sauvegardé maintenant (état stable : visée, Aube, carte d'intro) ? */
  Run.canSave = function () {
    const run = BE.state.run;
    return !!(run && !run.result && (run.phase === "AIM" || run.phase === "SHOP"));
  };

  // ================================================================ entrées
  function modalOpen() { return BE.state.paused || (BE.UI && BE.UI.modalOpen && BE.UI.modalOpen()); }
  function hitCircleBox(x, y, c, half) { return Math.abs(x - c.x) <= half && Math.abs(y - c.y) <= half; }

  /**
   * Boutons de la scène de visée (§3.1) : un appui qui COMMENCE sur l'un d'eux est un bouton, quelle que soit sa
   * durée (un pouce qui tape lentement ne tire jamais par erreur). Il ne devient une visée que si le doigt s'en
   * éloigne de ≥ 12 px. Renvoie "pause" | "swap" | "bag" | "relics" | "hud" | null.
   */
  function hotspotAt(x, y) {
    const run = BE.state.run;
    if (y < G.hudH) return x >= 312 ? "pause" : "hud";
    if (hitCircleBox(x, y, G.swapBtn, 26)) return "swap";
    if (hitCircleBox(x, y, G.bagBtn, 26)) return "bag";
    if (y >= G.relicBandY - 4 && run && run.relics.length) return "relics";
    return null;
  }
  Run.hotspotAt = hotspotAt;
  /** Action d'un bouton de la visée (tap sur SUIV. : échange ; Astronome : choix parmi les 3 suivantes). */
  function hotAction(h) {
    const run = BE.state.run;
    if (h === "pause") BE.UI.setPaused(true);
    else if (h === "swap") Run.askSwap();
    else if (h === "bag") BE.UI.openPanel("bag");
    else if (h === "relics") BE.UI.openPanel("relics");
    void run;
  }
  /** Échange demandé par le joueur : direct (1 étoile visible), ou sélecteur des 3 suivantes (L'Astronome, §6.6). */
  Run.askSwap = function () {
    const run = BE.state.run;
    if (!run || BE.state.scene !== "AIM") return false;
    if (run.swapsLeft <= 0 || Firm.ruleActive(run, "voile")) {
      BE.emit("ui:no", {});
      if (BE.UI) BE.UI.toast(Firm.ruleActive(run, "voile") ? "Le Voile : échange impossible" : "Plus d'échange cette nuit");
      return false;
    }
    if ((run.rules.previewNext || 1) > 1 && BE.UI) { BE.UI.openPanel("swapPick"); return true; }
    return Run.swap(1);
  };

  BE.on("pdown", (e) => {
    const st = BE.state;
    if (modalOpen() || st.scene !== "AIM") return;
    const S = play();
    const h = hotspotAt(e.x, e.y);
    S.aim.hot = h; S.aim.hotX = e.x; S.aim.hotY = e.y;
    if (h) { S.aim.active = false; return; } // bouton : pas de visée (ni d'aperçu) tant que le doigt y reste
    S.aim.active = true;
    aimTo(e.x, e.y, true);
    S.aim.downT = st.time;
  });
  BE.on("pmove", (e) => {
    const S = play();
    if (!S || BE.state.scene !== "AIM" || modalOpen()) return;
    if (S.aim.hot) {
      if (Math.hypot(e.x - S.aim.hotX, e.y - S.aim.hotY) < BE.Input.TAP_PX) return;
      S.aim.hot = null; S.aim.active = true; // le doigt a quitté le bouton : c'est une visée
      aimTo(e.x, e.y, true); S.aim.downT = BE.state.time;
    }
    if (!S.aim.active) return;
    aimTo(e.x, e.y, false);
  });
  BE.on("pcancel", () => {
    const S = play();
    if (S && S.aim) S.aim.hot = null;
    if (S && S.aim.active) { S.aim.active = false; S.aim.cancel = false; BE.emit("aim:cancel", {}); }
  });
  BE.on("pup", (e) => {
    const st = BE.state, S = play();
    // 0) appui commencé sur un bouton de la visée : action si on relâche dessus, jamais un tir
    if (S && S.aim && S.aim.hot) {
      const h = S.aim.hot; S.aim.hot = null;
      if (!modalOpen() && st.scene === "AIM" && hotspotAt(e.x, e.y) === h) hotAction(h);
      return;
    }
    // 1) UI (boutons, panneaux)
    if (modalOpen() || st.scene !== "AIM" || !S || !S.aim.active) {
      if (S && S.aim) S.aim.active = false;
      if (e.click && BE.UI && BE.UI.click(e.x, e.y)) return;
      if (e.click) {
        if (st.scene === "COUNT") { if (e.dur < 350) Run.skipCount(); } // maintenir = ×4, seul un tap saute
        else if (st.scene === "NIGHT_INTRO" && st.sceneT > 0.15) Run.go("AIM");
      }
      return;
    }
    // 2) visée
    S.aim.active = false;
    if (e.tap) {
      S.aim.cancel = false;
      if (BE.UI && BE.UI.click(e.x, e.y)) return;
      const h = hotspotAt(e.x, e.y);
      if (h) hotAction(h);
      return;
    }
    if (S.aim.cancel || e.y < G.hudH) { S.aim.cancel = false; BE.emit("aim:cancel", {}); return; }
    Run.fire(S.aim.angle);
  });
  BE.on("key", (e) => {
    const st = BE.state;
    if (BE.UI && BE.UI.key(e)) return;
    if (modalOpen()) return;
    const S = play();
    if (st.scene === "AIM") {
      if ((e.code === "Space" || e.code === "Enter") && !e.repeat) Run.fire(S.aim.angle);
      else if ((e.code === "Tab" || e.code === "KeyS") && !e.repeat) Run.askSwap();
      else if (/^(Digit|Numpad)[123]$/.test(e.code) && !e.repeat && (st.run.rules.previewNext || 1) > 1) { // Astronome : 1/2/3 = échanger avec la n-ième suivante
        const j = +e.code.slice(-1);
        if (st.run.swapsLeft <= 0 || Firm.ruleActive(st.run, "voile")) Run.askSwap(); else Run.swap(j);
      }
      else if (e.code === "Escape") { if (S.aim.active) { S.aim.active = false; BE.emit("aim:cancel", {}); } else BE.UI.setPaused(true); }
    } else if (st.scene === "COUNT" && (e.code === "Space" || e.code === "Enter") && !e.repeat) Run.skipCount();
    else if (st.scene === "NIGHT_INTRO" && (e.code === "Space" || e.code === "Enter") && !e.repeat && st.sceneT > 0.15) Run.go("AIM");
    else if (st.scene === "NIGHT_INTRO" && e.code === "Escape") BE.UI.setPaused(true);
    else if (Run.IN_GAME[st.scene] && e.code === "Escape") BE.UI.setPaused(true);
  });
})(window.BE = window.BE || {});
