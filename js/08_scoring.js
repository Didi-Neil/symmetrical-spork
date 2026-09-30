/* 08_scoring.js — BE.Score : journal d'événements → ctx → steps (pur). §7 et §12.5.
 *
 * Principe : le ctx NE dépend PAS des reliques possédées. Tout ce qu'une relique change au score (y compris les
 * reliques « V » qui modifient la base : Alchimiste, Prisme de poche, Observatoire Ionique) est appliqué par
 * `compute(ctx, relics)` via `Score.effective`. Ainsi `compute(run.lastCtx, relicsAvecCandidate)` (aperçu de
 * l'Aube) est EXACT, et `compute` reste une fonction pure (même entrée → même sortie, aucune lecture d'état).
 */
(function (BE) {
  "use strict";

  const Score = (BE.Score = {});
  const D = BE.DATA;

  function relicDef(r) { return D.RELIC_BY_ID[typeof r === "string" ? r : r && r.id]; }

  /**
   * Construit le contexte de décompte à partir du journal du tir et de l'état du run (lecture seule).
   * Le ctx est un objet JSON pur (sérialisable) : il sert aussi d'aperçu de relique en boutique (run.lastCtx).
   */
  Score.buildCtx = function (log, run) {
    const c = {
      pegHits: 0,            // clous gris (+ doubles) touchés
      pegTouches: 0,         // TOUS les clous touchés (gris, doubles, spéciaux, éteints) — Diapason, Poids plume, Harpe
      doubleHits: 0,         // Clous doubles (Ronce) touchés — Harpe Céleste
      darkHits: 0,           // clous éteints (Éteignoir) touchés
      specialHits: { or: 0, ressort: 0, prisme: 0, echo: 0, cristal: 0, teint: 0 },
      wallBounces: 0, shadowHits: 0, kills: 0, killsByType: {}, merges: [], stonesBroken: 0, reactions: [],
      bigBang: false, launchedSize: 0, launchedColor: null, touchedShadow: false,
      jarFill: 0, jarCount: 0, jarStars: 0, jarColors: [], maxJarSize: 0,
      gold: run.gold, isLastShot: false, shotIndex: run.shotIndex, metronome: 0, reserve: run.reserve || 0,
      baseEclat: 0, baseMult: 1, absorbed: false, bossKilled: false, bolts: 0,
      // finaux
      aurore: false, finalX: (run.rules && run.rules.finalX) || 1, eclipseHalf: false,
    };
    let eclat = 0, mult = 0;
    for (const e of log) {
      if (e.eclat) eclat += e.eclat;
      switch (e.t) {
        case "launch": c.launchedSize = e.size; c.launchedColor = e.color || null; break;
        case "peg":
          c.pegTouches++;
          if (e.kind === "special") { if (e.clou && c.specialHits[e.clou] !== undefined) c.specialHits[e.clou]++; }
          else { c.pegHits++; if (e.kind === "double") c.doubleHits++; }
          if (e.dark) c.darkHits++;
          if (e.mult) mult += e.mult;
          break;
        case "wall": c.wallBounces++; break;
        case "hit": c.shadowHits++; c.touchedShadow = true; break;
        case "kill": c.kills++; c.killsByType[e.type] = (c.killsByType[e.type] || 0) + 1; break;
        case "bosskill": c.bossKilled = true; break;
        case "merge": {
          // m0 = Mult sans Alchimiste ; mA = Mult avec Alchimiste (les deux sont journalisés par Jar.merge)
          const m0 = e.m0 !== undefined ? e.m0 : e.mult;
          const mA = e.mA !== undefined ? e.mA : m0;
          c.merges.push({ size: e.size, pure: !!e.pure, colors: e.colors, reaction: e.reaction || null, mult: m0, alch: Math.max(0, mA - m0) });
          mult += m0;
          if (e.reaction) c.reactions.push(e.reaction);
          break;
        }
        case "stone": c.stonesBroken++; mult += e.mult || 2; break;
        case "mult": mult += e.n; break;
        case "eclat": eclat += e.n; break;
        case "bigbang": c.bigBang = true; break;
        case "absorb": c.absorbed = true; break;
        case "bolt": c.bolts++; break;
      }
    }
    c.baseEclat = eclat;
    c.baseMult = 1 + c.reserve + mult;
    // bocal (état au moment du décompte)
    const J = run.jar.bodies;
    let area = 0;
    for (const b of J) {
      area += Math.PI * b.r * b.r;
      if (b.stone) continue;
      c.jarStars++;
      if (c.jarColors.indexOf(b.color) < 0) c.jarColors.push(b.color);
      c.maxJarSize = Math.max(c.maxJarSize, b.size);
    }
    c.jarCount = J.length;
    // remplissage (§4) sous l'horizon SANS reliques ; Score.effective le recalcule si une relique déplace la ligne
    c.jarArea = area; c.jarTop = BE.Jar.pileTop(run); c.jarW = run.jar.wallR - run.jar.wallL; c.jarFloor = run.jar.floor;
    c.jarHz = BE.Run.horizonBase(run);
    c.jarFill = BE.Jar.fillOf(area, c.jarTop, c.jarW, c.jarFloor, c.jarHz);
    c.isLastShot = run.shotsLeft <= 0;
    c.metronome = c.merges.length ? (run.metronome || 0) + 1 : 0;
    // finaux
    const distinct = [];
    for (const r of c.reactions) if (distinct.indexOf(r) < 0) distinct.push(r);
    c.distinctReactions = distinct.length;
    c.aurore = distinct.length >= D.AURORE.distinct && !!(BE.Meta && BE.Meta.hasRoom(D.AURORE.room));
    const b = run.firm.boss;
    c.eclipseHalf = !!(b && b.bossId === "eclipse" && BE.Firm.ruleActive(run, "eclipse"));
    return c;
  };

  /** Passifs « de score » d'une liste de reliques (pur). */
  Score.mods = function (relics) {
    const m = { alchimiste: false, firstMergeTwice: false, plasmaMerge: false, horizon: 0 };
    for (const r of relics || []) {
      const d = relicDef(r);
      if (!d || !d.passive) continue;
      for (const k in m) if (k === "horizon") m.horizon += d.passive.horizon || 0; else if (d.passive[k]) m[k] = true;
    }
    return m;
  };

  /**
   * ctx effectif pour une liste de reliques (pur, ne modifie pas `ctx`) :
   *  1) Alchimiste : chaque fusion pure prend le Mult d'une taille au-dessus (écart `alch` ajouté à la base) ;
   *  2) Prisme de poche : la 1re fusion est dupliquée (Mult ajouté à la base, et compte pour les déclencheurs) ;
   *  3) Observatoire Ionique : chaque Plasma ajoute une fusion synthétique de taille 4 (déclencheurs seulement).
   */
  Score.effective = function (ctx, relics) {
    const m = Score.mods(relics);
    const hz = m.horizon && ctx.jarW ? Math.min(D.GEOM.horizonMax, ctx.jarHz + m.horizon) : 0;
    if (!m.alchimiste && !m.firstMergeTwice && !m.plasmaMerge && !hz) return ctx;
    const c = Object.assign({}, ctx);
    // 0) Verre soufflé : la ligne descend, le remplissage lu par Balance / Équilibre aussi (comme la jauge)
    if (hz) c.jarFill = BE.Jar.fillOf(ctx.jarArea, ctx.jarTop, ctx.jarW, ctx.jarFloor, hz);
    c.merges = ctx.merges.map((x) => Object.assign({}, x));
    if (m.alchimiste) {
      for (const x of c.merges) if (x.pure && x.alch) { c.baseMult += x.alch; x.mult += x.alch; x.alch = 0; }
    }
    if (m.firstMergeTwice && c.merges.length) {
      const first = c.merges[0];
      c.merges.unshift(Object.assign({}, first, { twin: true }));
      c.baseMult += first.mult;
    }
    if (m.plasmaMerge) {
      for (const r of ctx.reactions) if (r === "plasma") c.merges.push({ size: 4, pure: false, colors: [], reaction: null, mult: 0, synthetic: true });
    }
    return c;
  };

  /** Finaux dans l'ordre §7.1 : Aurore ×2 → Big Bang ×10 → Insomniaque ×2 → L'Éclipse ÷2. */
  Score.finals = function (ctx) {
    const f = [];
    if (ctx.aurore) f.push({ src: "aurore", xMult: D.AURORE.xMult });
    if (ctx.bigBang) f.push({ src: "bigbang", xMult: D.BIGBANG.xMult });
    if (ctx.finalX && ctx.finalX !== 1) f.push({ src: "insomniaque", xMult: ctx.finalX });
    if (ctx.eclipseHalf) f.push({ src: "eclipse", xMult: 0.5 });
    return f;
  };

  /**
   * Fonction pure. relics = [{id}] ou [id] dans l'ordre des emplacements (gauche → droite).
   * Renvoie { steps:[{src, slot?, eclat, mult, dEclat?, dMult?, xMult?}], eclat, mult, lumiere, ctx }.
   * steps[0] = base (déjà modifiée par les reliques « V » de score : Alchimiste, Prisme de poche).
   */
  Score.compute = function (ctx, relics, finals) {
    const c = Score.effective(ctx, relics);
    let eclat = c.baseEclat, mult = c.baseMult;
    const steps = [{ src: "base", eclat, mult }];
    (relics || []).forEach((r, slot) => {
      const def = relicDef(r);
      if (!def || !def.count) return;
      let out = null;
      try { out = def.count(c); } catch (e) { out = null; }
      if (!out) return;
      const dE = out.dEclat || 0, dM = out.dMult || 0;
      const xM = out.xMult !== undefined && out.xMult !== 1 ? out.xMult : undefined;
      if (!dE && !dM && xM === undefined) return;
      eclat += dE;
      mult += dM;
      if (xM !== undefined) mult *= xM;
      steps.push({ src: def.id, slot, dEclat: dE, dMult: dM, xMult: xM, eclat, mult });
    });
    for (const f of finals || Score.finals(c)) {
      mult *= f.xMult;
      steps.push({ src: f.src, final: true, xMult: f.xMult, eclat, mult });
    }
    const lumiere = Math.floor(eclat * mult + 1e-9);
    return { steps, eclat, mult, lumiere };
  };

  /** Somme live (sans reliques) pour le compteur « ✦ 24 × 3,5 » et la projection de la jauge. */
  Score.live = function (log, reserve) {
    let e = 0, m = 1 + (reserve || 0);
    for (const ev of log) {
      if (ev.eclat) e += ev.eclat;
      if (ev.t === "merge") m += ev.mult;
      else if (ev.t === "stone") m += ev.mult || 2;
      else if (ev.t === "mult") m += ev.n;
      else if (ev.t === "eclat") e += ev.n;
      else if (ev.t === "peg" && ev.mult) m += ev.mult;
    }
    return { eclat: e, mult: m };
  };

  /** Libellé court d'une étape de décompte (UI) : « +4 », « ×2 », « +10 » (Éclat). */
  Score.stepLabel = function (st) {
    const U = BE.util, parts = [];
    if (st.dEclat) parts.push({ txt: "+" + U.fmt(st.dEclat), kind: "eclat" });
    if (st.dMult) parts.push({ txt: "+" + U.fmtMult(st.dMult), kind: "mult" });
    if (st.xMult !== undefined && st.xMult !== 1) parts.push({ txt: "×" + U.fmtMult(st.xMult), kind: "xmult" });
    return parts;
  };
})(window.BE = window.BE || {});
