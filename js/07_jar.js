/* 07_jar.js — BE.Jar : bocal, fusions, familles, réactions, Pierres, Big Bang, repos, débordement, vidange (§5.4–5.7, §6.5). */
(function (BE) {
  "use strict";

  const Jar = (BE.Jar = {});
  const D = BE.DATA, G = D.GEOM, PJ = D.PHYS.jar, U = BE.util, Phys = BE.Phys;

  /** État du bocal stocké dans run.jar (sérialisable). */
  Jar.create = function () {
    return { bodies: [], wallL: G.jarL, wallR: G.jarR, floor: G.floor, g: PJ.g, t: 0, step: 0 };
  };

  /** Ajoute un corps (id = run.nextId++). spec: {size,color,stone,x,y,vx,vy,grav,pure} */
  Jar.add = function (run, spec) {
    spec.id = run.nextId++;
    const b = Phys.makeBody(spec);
    run.jar.bodies.push(b); // ids croissants → le tableau reste trié
    Jar.cap(run);
    return b;
  };

  /** Garde-fou 60 corps : la Poussière la plus haute s'évapore (§5.4). */
  Jar.cap = function (run) {
    const B = run.jar.bodies;
    while (B.length > PJ.maxBodies) {
      let hi = null;
      for (const b of B) if (!b.stone && b.size === 1 && (!hi || b.y < hi.y)) hi = b;
      if (!hi) hi = B.reduce((a, b) => (b.y < a.y ? b : a));
      Jar.remove(run, hi);
      BE.emit("evaporate", { body: hi, x: hi.x, y: hi.y });
    }
  };
  Jar.remove = function (run, body) {
    const B = run.jar.bodies;
    const i = B.indexOf(body);
    if (i >= 0) B.splice(i, 1);
  };

  /** Une étoile en vol passe au régime BOCAL (§5.3 : centre y > 340). Vitesse bornée à 600. */
  Jar.addFromFlight = function (run, star, S) {
    let vx = star.vx, vy = star.vy;
    const sp = Math.hypot(vx, vy);
    if (sp > PJ.vEnter) { vx *= PJ.vEnter / sp; vy *= PJ.vEnter / sp; }
    // le verre grossit l'étoile (rayon de vol → rayon du bocal) : on la garde entre les murs du bocal
    const r = D.SIZES[star.size].r, x = U.clamp(star.x, run.jar.wallL + r, run.jar.wallR - r);
    const b = Jar.add(run, { size: star.size, color: star.color, grav: star.grav, x, y: star.y, vx, vy });
    b.fromShot = true;
    S.log.push({ t: "land", size: star.size });
    BE.emit("land", { body: b, x: b.x, y: b.y });
    if (star.grav === "doree") {
      run.gold += 1; run.runStats.gold += 1;
      S.log.push({ t: "gold", n: 1 });
      BE.emit("gold", { n: 1, x: b.x, y: b.y });
    }
    return b;
  };

  /** Lâche une Pierre Noire à (x, 340), vitesse nulle (§6.3). */
  Jar.dropStone = function (run, size, x) {
    const r = D.SIZES[size].r;
    x = U.clamp(x, run.jar.wallL + r, run.jar.wallR - r);
    const b = Jar.add(run, { size, stone: true, x, y: G.flightToJar, vx: 0, vy: 0 });
    BE.emit("stoneDrop", { body: b, x: b.x, y: b.y });
    return b;
  };

  /**
   * Gravité et murs courants (La Marée, L'Étau). Appelée au début de chaque nuit et quand un boss meurt
   * (sa règle est levée pour le reste de la nuit). Si L'Étau resserre les murs, les corps en dehors sont
   * repoussés tout de suite (Jar.squeeze) et les fusions qui en résultent vont dans la réserve (§6.4).
   */
  Jar.applyRules = function (run) {
    const J = run.jar;
    J.g = PJ.g * (BE.Firm.ruleActive(run, "maree") ? D.BOSSES.maree.jarG : 1);
    const etau = BE.Firm.ruleActive(run, "etau");
    const L = etau ? G.etauL : G.jarL, R = etau ? G.etauR : G.jarR;
    const narrowed = L > J.wallL || R < J.wallR;
    J.wallL = L; J.wallR = R;
    if (narrowed) {
      Phys.wakeAll(J);
      if (J.bodies.some((b) => b.x - b.r < L - 0.5 || b.x + b.r > R + 0.5)) Jar.squeeze(run);
    }
  };

  /**
   * L'Étau : simulation silencieuse jusqu'au repos (≤ 6 s simulées) après le resserrement des murs.
   * Fusions orphelines → réserve (Mult ajouté au tir suivant, §5.5). Renvoie le Mult mis en réserve.
   */
  Jar.squeeze = function (run) {
    BE.emit("squeeze", { wallL: run.jar.wallL, wallR: run.jar.wallR });
    return Jar.settle(run);
  };
  /** Résolution silencieuse jusqu'au repos (≤ 6 s) ; les fusions qui en résultent vont dans la réserve (L'Étau, Vidange). */
  Jar.settle = function (run) {
    const J = run.jar, OS = { log: [], orphan: true };
    Phys.wakeAll(J);
    const n = Math.round(PJ.restMax / D.PHYS.dt);
    for (let i = 0; i < n; i++) {
      Jar.step(run, D.PHYS.dt, OS);
      if (i > 12 && Phys.allAsleep(J)) break;
    }
    Phys.freeze(J);
    const add = BE.Score.live(OS.log, 0).mult - 1;
    if (add > 0) { run.reserve = (run.reserve || 0) + add; BE.emit("reserve", { n: add, total: run.reserve }); }
    return add;
  };

  /**
   * Un pas de simulation du bocal + fusions. S = contexte de tir {log:[], orphan?:bool}.
   * Les fusions sont résolues par paires triées (min id, max id), une seule par corps et par pas.
   */
  Jar.step = function (run, dt, S) {
    const J = run.jar;
    Phys.stepJar(J, dt);
    const B = J.bodies;
    let merged = false;
    const noMixed = run.rules.noMixed;
    for (let i = 0; i < B.length; i++) {
      const a = B[i];
      if (a.stone || a.mergedStep === J.step || a.age < PJ.mergeMinAge) continue;
      for (let j = i + 1; j < B.length; j++) {
        const b = B[j];
        if (b.stone || b.size !== a.size || b.mergedStep === J.step || b.age < PJ.mergeMinAge) continue;
        const dx = b.x - a.x, dy = b.y - a.y, rr = a.r + b.r + 1;
        if (dx * dx + dy * dy > rr * rr) continue;
        if (noMixed && a.color !== b.color && a.grav !== "prismatique" && b.grav !== "prismatique") continue;
        Jar.merge(run, a, b, S);
        merged = true;
        break; // a a fusionné : on passe au suivant (les indices ont changé, on recommence prudemment)
      }
      if (merged) { merged = false; i = -1; } // reparcours déterministe : a et b ont mergedStep = step
    }
  };

  /**
   * Mult d'une fusion vers `size` (§5.2, §5.5) : table, pureté (×1,5 ou ×2 Forgeronne, arrondi au 0,5 sup.), Alchimiste.
   * alch : true/false force l'Alchimiste (aperçus) ; undefined = selon les reliques du run.
   */
  Jar.mergeMult = function (run, size, pure, alch) {
    if (alch === undefined) alch = BE.Run.passives(run).alchimiste;
    let m = D.SIZES[size].mult;
    if (pure && alch) m = size >= D.MAX_SIZE ? D.ALCHIMISTE_TN : D.SIZES[size + 1].mult;
    if (pure) m = U.ceilHalf(m * (run.rules.pureMult || 1.5));
    return m;
  };

  /** Fusion de deux étoiles (a.id < b.id). */
  Jar.merge = function (run, a, b, S) {
    const J = run.jar;
    if (a.size >= D.MAX_SIZE && b.size >= D.MAX_SIZE) return Jar.bigBang(run, a, S);
    const size = a.size + 1;
    const pure = a.color === b.color || a.grav === "prismatique" || b.grav === "prismatique";
    const color = a.color; // plus petit id = plus ancienne
    const reaction = pure || run.rules.noMixed ? null : D.reactionFor(a.color, b.color);
    const x = (a.x * a.m + b.x * b.m) / (a.m + b.m);
    const y = (a.y * a.m + b.y * b.m) / (a.m + b.m);
    const vx = (a.vx + b.vx) / 2 * 0.5, vy = (a.vy + b.vy) / 2 * 0.5;
    Jar.remove(run, a); Jar.remove(run, b);
    const nb = Jar.add(run, { size, color, x, y, vx, vy, pure });
    nb.mergedStep = J.step; nb.age = 0;
    if (!pure) nb.bicolor = a.color === color ? b.color : a.color;
    nb.bornT = BE.state ? BE.state.time : 0;
    nb.shotNo = run.runStats.shots;
    // m0 / mA : Mult sans / avec Alchimiste (le score applique la bonne valeur selon les reliques → aperçus exacts)
    const m0 = Jar.mergeMult(run, size, pure, false), mA = Jar.mergeMult(run, size, pure, true);
    const mult = BE.Run.passives(run).alchimiste ? mA : m0;
    const ev = { t: "merge", size, pure, colors: [a.color, b.color], reaction, mult, m0, mA, x, y };
    S.log.push(ev);
    run.runStats.merges++;
    if (pure) run.runStats.pureMerges++;
    run.runStats.maxSize = Math.max(run.runStats.maxSize, size);
    BE.emit("merge", { body: nb, size, pure, reaction, mult, x, y, color, colors: ev.colors, orphan: !!S.orphan });
    Phys.wakeAll(J);

    const fam = (f) => a.color === f || b.color === f;
    // Braise : explosion (Pierres brisées + souffle radial dégressif)
    if (fam("braise")) {
      const R = nb.r + D.BRAISE_EXPLOSION.extraR;
      BE.emit("explosion", { x, y, r: R });
      for (const o of J.bodies.slice()) {
        if (o === nb) continue;
        const d = Math.hypot(o.x - x, o.y - y);
        if (d > R + o.r) continue;
        if (o.stone) { Jar.breakStone(run, o, S); continue; }
        const k = D.BRAISE_EXPLOSION.impulse * Math.max(0, 1 - d / (R + o.r));
        const nx = d > 1e-6 ? (o.x - x) / d : 0, ny = d > 1e-6 ? (o.y - y) / d : -1;
        o.vx += nx * k; o.vy += ny * k;
      }
    }
    // Givre : +2 Éclat par Givre dans le bocal
    if (fam("givre")) {
      const n = J.bodies.filter((o) => !o.stone && o.color === "givre").length;
      if (n) { S.log.push({ t: "eclat", n: D.GIVRE_ECLAT * n, src: "givre" }); BE.emit("bonus", { kind: "eclat", n: D.GIVRE_ECLAT * n, x, y: y - nb.r }); }
    }
    // Sève : +1 Mult
    if (fam("seve")) { S.log.push({ t: "mult", n: D.SEVE_MULT, src: "seve" }); }
    // Réaction
    if (reaction) Jar.react(run, reaction, nb, S);
    // Pierres adjacentes brisées
    for (const o of J.bodies.slice()) {
      if (!o.stone) continue;
      if (Math.hypot(o.x - nb.x, o.y - nb.y) <= nb.r + o.r + D.STONE_BREAK_GAP) Jar.breakStone(run, o, S);
    }
    return nb;
  };

  /** Réaction de deux familles (§5.7). */
  Jar.react = function (run, id, nb, S) {
    const R = D.REACTIONS[id];
    const J = run.jar;
    run.reactionCounts[id] = (run.reactionCounts[id] || 0) + 1;
    run.runStats.reactions++;
    BE.emit("reaction", { id, x: nb.x, y: nb.y, color: R.color, nom: R.nom });
    switch (id) {
      case "vapeur":
        S.log.push({ t: "mult", n: R.mult, src: "vapeur" });
        for (const o of J.bodies) o.vy += R.push;
        Phys.wakeAll(J);
        break;
      case "plasma":
        BE.Firm.plasma(run, nb.x, nb.size, S);
        break;
      case "cendre": {
        let best = null, bd = 1e9;
        for (const o of J.bodies) if (o.stone) { const d = Math.hypot(o.x - nb.x, o.y - nb.y); if (d < bd) { bd = d; best = o; } }
        if (best) Jar.breakStone(run, best, S);
        run.gold += R.gold; run.runStats.gold += R.gold;
        S.log.push({ t: "gold", n: R.gold });
        BE.emit("gold", { n: R.gold, x: nb.x, y: nb.y });
        break;
      }
      case "ronce":
        BE.Firm.ronce(run, nb.x);
        break;
      case "tempete":
        BE.Firm.tempete(run);
        break;
      case "photosynthese":
        run.nextSizeBonus = 1;
        break;
    }
  };

  /** Pierre Noire brisée : +2 Mult (§6.5). */
  Jar.breakStone = function (run, stone, S) {
    if (run.jar.bodies.indexOf(stone) < 0) return;
    Jar.remove(run, stone);
    S.log.push({ t: "stone", mult: D.STONE_MULT, size: stone.size });
    run.runStats.stones++;
    BE.emit("stone", { x: stone.x, y: stone.y, size: stone.size, r: stone.r });
    // Fonderie (évolution de Carrière) : +1 or par Pierre brisée
    const gp = BE.Run.passives(run).goldPerStone || 0;
    if (gp > 0) {
      run.gold += gp; run.runStats.gold += gp;
      S.log.push({ t: "gold", n: gp });
      BE.emit("gold", { n: gp, x: stone.x, y: stone.y });
    }
    Phys.wakeAll(run.jar);
  };

  /** Trou Noir + Trou Noir : tout disparaît, +Éclat = Σ tailles, ×10 final. */
  Jar.bigBang = function (run, at, S) {
    const J = run.jar;
    let sum = 0;
    for (const o of J.bodies) sum += o.size;
    const x = at.x, y = at.y;
    J.bodies.length = 0;
    S.log.push({ t: "bigbang", sizes: sum });
    S.log.push({ t: "eclat", n: sum, src: "bigbang" });
    run.runStats.bigBangs++;
    BE.emit("bigbang", { x, y, sizes: sum });
  };

  // ---------------------------------------------------------------- requêtes
  Jar.isRest = (run) => Phys.allAsleep(run.jar);
  /**
   * Remplissage (§4) — fonction pure : max(Σ aires / capacité (≤ 99 %), hauteur du tas / hauteur utile), borné à 1.
   *  - capacité = largeur × (fond − horizon) × compacité 0,6 d'un tas d'étoiles au repos ;
   *  - hauteur = (fond − haut du tas) / (fond − horizon) : 100 % quand le tas touche la ligne (Débordement).
   * Le terme « hauteur » rend la jauge honnête quand quelques grosses étoiles s'empilent sans remplir la surface.
   */
  Jar.fillOf = function (area, top, w, floor, h) {
    const hh = Math.max(1, floor - h);
    // le terme surface plafonne à 99 % : seul le terme hauteur (tas qui touche la ligne) affiche 100 %, qui reste
    // ainsi exactement le point de Débordement (un tas très compact peut dépasser la compacité 0,6 sans toucher la ligne)
    const fa = Math.min(0.99, area / (Math.max(1, w) * hh * G.packing));
    const fh = top === null || top === undefined ? 0 : (floor - top) / hh;
    return Math.max(0, Math.min(1, Math.max(fa, fh)));
  };
  /** Σ aires des corps du bocal (px²). */
  Jar.area = function (run) {
    let a = 0;
    for (const b of run.jar.bodies) a += Math.PI * b.r * b.r;
    return a;
  };
  /** Haut du tas pour la jauge : corps au repos ou presque (< 60 px/s) — une étoile qui tombe ne compte pas encore. */
  Jar.pileTop = function (run) {
    let t = null;
    for (const b of run.jar.bodies) {
      if (!b.sleep && b.vx * b.vx + b.vy * b.vy > 3600) continue;
      const y = b.y - b.r;
      if (t === null || y < t) t = y;
    }
    return t;
  };
  /** Capacité (px²) sous l'horizon h (défaut : horizon courant, Verre soufflé et Éclipse 4 compris), murs courants. */
  Jar.capacity = function (run, h) {
    const J = run && run.jar;
    if (!J) return G.jarArea * G.packing;
    if (h === undefined) h = BE.Run.horizon(run);
    return Math.max(1, (J.wallR - J.wallL) * (J.floor - h)) * G.packing;
  };
  /** Remplissage 0–1 affiché par la jauge (et lu par Balance, Équilibre, D02) : 100 % = le tas touche l'horizon. */
  Jar.fill = function (run, h) {
    const J = run.jar;
    if (h === undefined) h = BE.Run.horizon(run);
    return Jar.fillOf(Jar.area(run), Jar.pileTop(run), J.wallR - J.wallL, J.floor, h);
  };
  /** Part surfacique seule (Σ aires / capacité), pour les mesures d'équilibrage. */
  Jar.areaFill = function (run) { return Math.min(1, Jar.area(run) / Jar.capacity(run)); };
  /** Corps dont le haut dépasse la ligne d'horizon (à n'utiliser qu'au repos). */
  Jar.overflowing = function (run) {
    const h = BE.Run.horizon(run);
    return run.jar.bodies.filter((b) => b.y - b.r < h);
  };
  /** Plus haut sommet (y minimal du haut des corps) ou null. */
  Jar.topY = function (run) {
    let t = null;
    for (const b of run.jar.bodies) { const y = b.y - b.r; if (t === null || y < t) t = y; }
    return t;
  };
  /** Danger : un corps au repos a son haut à moins de 16 px de l'horizon (ligne rouge, pouls, battement de cœur). */
  Jar.danger = function (run) { return Jar.near(run, 16); };
  /** Un corps au repos a son haut à moins de `margin` px de l'horizon. */
  Jar.near = function (run, margin) {
    const h = BE.Run.horizon(run) + margin;
    for (const b of run.jar.bodies) if (b.sleep && b.y - b.r < h) return true;
    return false;
  };
  /**
   * Niveau d'alerte à la visée (§4) : 2 = danger (rouge, < 16 px), 1 = « presque » (ambre) quand l'étoile courante,
   * posée sur le haut du tas, dépasserait la ligne (marge = son diamètre au bocal, au moins 40 px), 0 sinon.
   */
  Jar.alertLevel = function (run) {
    if (Jar.danger(run)) return 2;
    const cur = BE.Run.current && BE.Run.current(run);
    const m = Math.max(40, cur ? 2 * D.SIZES[cur.size].r : 40);
    return Jar.near(run, m) ? 1 : 0;
  };
  Jar.stars = (run) => run.jar.bodies.filter((b) => !b.stone);
  Jar.colors = function (run) {
    const s = [];
    for (const b of run.jar.bodies) if (!b.stone && s.indexOf(b.color) < 0) s.push(b.color);
    return s;
  };
  Jar.maxSize = function (run) { let m = 0; for (const b of run.jar.bodies) if (!b.stone) m = Math.max(m, b.size); return m; };

  /** Bougie : évapore les corps qui dépassent. */
  Jar.evaporate = function (run, bodies) {
    for (const b of bodies) { Jar.remove(run, b); BE.emit("evaporate", { body: b, x: b.x, y: b.y }); }
    Phys.wakeAll(run.jar);
  };
  /** La Faim : dévore l'étoile la plus grosse (égalité : la plus haute, puis id minimal). */
  Jar.eatBiggest = function (run) {
    let best = null;
    for (const b of run.jar.bodies) {
      if (b.stone) continue;
      if (!best || b.size > best.size || (b.size === best.size && (b.y < best.y || (b.y === best.y && b.id < best.id)))) best = b;
    }
    if (best) { Jar.remove(run, best); Phys.wakeAll(run.jar); BE.emit("devour", { body: best, x: best.x, y: best.y }); }
    return best;
  };
  /**
   * Corps qui quittent le bocal à la Vidange : tous, sauf keepJar (L'Insomniaque) où seules les étoiles de taille
   * < keepJarMin s'évaporent (les Pierres Noires restent).
   */
  Jar.vidangeLeaving = function (run) {
    const R = run.rules;
    if (!R.keepJar) return run.jar.bodies.slice();
    return R.keepJarMin ? run.jar.bodies.filter((b) => !b.stone && b.size < R.keepJarMin) : [];
  };
  /**
   * Trop-plein (§2.1 étape 7, §6.6) : les corps dont le haut dépasse l'horizon (ou s'en approche à moins de `margin` px)
   * s'évaporent, sans Bougie ni or, puis le bocal se tasse (fusions → réserve). Utilisé quand une nuit est gagnée bocal
   * débordant, au début de chaque nuit (Verre soufflé acheté à l'Aube, L'Étau qui resserre les murs), après la Vidange
   * partielle de L'Insomniaque (marge = zone rouge, §6.6) et à la reprise d'une ancienne sauvegarde.
   * Garanti : au retour, aucun corps n'a son haut au-dessus de horizon + margin. Renvoie le nombre de corps évaporés.
   */
  Jar.trim = function (run, margin) {
    const lim = () => BE.Run.horizon(run) + (margin || 0);
    const above = () => { const h = lim(); return run.jar.bodies.filter((b) => b.y - b.r < h); };
    let n = 0;
    for (let pass = 0; pass < 12; pass++) {
      const over = above();
      if (!over.length) return n;
      n += over.length;
      Jar.evaporate(run, over);
      Jar.settle(run);
    }
    // filet de sécurité : le tassement a encore fait remonter un corps (fusion en cascade) → évaporation sans tassement
    // (retirer un corps ne fait jamais monter les autres : le bocal ne peut que retomber)
    const over = above();
    if (over.length) { n += over.length; Jar.evaporate(run, over); Phys.freeze(run.jar); }
    return n;
  };
  /** Or de la Vidange : +1 par étoile de taille ≥ 4 QUI QUITTE le bocal (max 5). */
  Jar.vidangeGold = function (run) {
    let n = 0;
    for (const b of Jar.vidangeLeaving(run)) if (!b.stone && b.size >= D.ECO.vidangeMinSize) n++;
    return Math.min(D.ECO.vidangeMax, n);
  };
  /**
   * Vidange de fin de Lune : or (Jar.vidangeGold), puis le bocal est vidé ; keepJar : seules les petites étoiles
   * partent, le reste se tasse en silence (fusions → réserve) et ce qui dépasse encore l'horizon ou entre dans la zone
   * rouge (16 px) s'évapore (Jar.trim).
   * candleRelit : la Bougie se rallume.
   */
  Jar.vidange = function (run) {
    const n = Jar.vidangeGold(run);
    const gone = Jar.vidangeLeaving(run);
    if (gone.length === run.jar.bodies.length) run.jar.bodies.length = 0;
    else {
      if (gone.length) { run.jar.bodies = run.jar.bodies.filter((b) => gone.indexOf(b) < 0); Jar.settle(run); }
      // la Lune suivante ne commence ni en Débordement ni en zone rouge (§6.6) : sinon, sans Bougie (Éclipse 6),
      // le premier tir perdrait le run sans que le joueur y puisse rien
      Jar.trim(run, D.PHYS.jar.carryMargin);
    }
    if (run.rules.candleRelit && run.eclipse < 6) run.candle = Math.max(run.candle, run.rules.candle);
    return n;
  };
  /** Stabilisation silencieuse après chargement (§12.6) : 30 pas sans fusions ni journal. */
  Jar.stabilize = function (run, steps) {
    const J = run.jar;
    Phys.wakeAll(J);
    for (let i = 0; i < (steps || 30); i++) Phys.stepJar(J, D.PHYS.dt);
    Phys.freeze(J);
  };
})(window.BE = window.BE || {});
