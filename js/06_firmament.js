/* 06_firmament.js — BE.Firm : grille des Ombres, boss, clous, descente, apparitions, brûlure, gel, éteignoir (§4, §6). */
(function (BE) {
  "use strict";

  const Firm = (BE.Firm = {});
  const D = BE.DATA, G = D.GEOM, U = BE.util;

  // ---------------------------------------------------------------- état
  /** Crée l'état du Firmament stocké dans run.firm (sérialisable). */
  Firm.create = function () {
    return { shadows: [], boss: null, ghost: [], layout: 0, usedLayouts: [], usedBosses: [], bossId: null, ronce: [], nextId: 1, chest: false };
  };

  function def(t) { return D.SHADOWS[t.type]; }
  Firm.def = def;

  /** Multiplicateur de PV courant (§6.1) : Lune × Corbeau × Éclipse ≥ 2. */
  Firm.hpFactor = function (run) {
    const P = BE.Run.passives(run);
    return D.hpMult(run.lune) * (P.hpMult || 1) * (run.eclipse >= 2 ? 1.2 : 1);
  };
  Firm.hpFor = function (run, type) {
    return Math.max(1, Math.round(D.SHADOWS[type].hp * Firm.hpFactor(run)));
  };

  /** Ombre (sérialisable). x,y,r en espace logique ; dispX/dispY servent à l'animation. */
  Firm.makeShadow = function (run, type, col, row, hp) {
    const d = D.SHADOWS[type];
    const h = hp || Firm.hpFor(run, type);
    const s = {
      id: run.firm.nextId++, type, col, row, hp: h, maxhp: h, counter: d.speed, burns: [], frozen: false, alive: true,
      x: G.cols[col], y: G.rows[row], r: d.r, layT: 0, dispX: G.cols[col], dispY: G.rows[row] - 30, born: 0,
    };
    run.firm.shadows.push(s);
    return s;
  };

  /** Boss de la nuit (§6.4). */
  Firm.makeBoss = function (run, bossId) {
    const bd = D.BOSSES[bossId];
    // §6.4 : PV du boss = 30 × HPmult (L'Éclipse : 200 en Lune 5). Corbeau et Éclipse ≥ 2 ne touchent que les Ombres (§6.1).
    const hm = D.hpMult(run.lune);
    const hp = Math.max(1, Math.round(bd.hpFlat ? bd.hpFlat * hm : D.BOSS.hp * hm));
    const b = {
      id: run.firm.nextId++, type: "boss", bossId, col: D.BOSS.col, row: D.BOSS.row, hp, maxhp: hp, counter: D.BOSS.every,
      burns: [], frozen: false, alive: true, r: D.BOSS.r, x: 0, y: 0, dispX: 0, dispY: 0, ruleOff: false,
    };
    Firm.placeBoss(b);
    b.dispX = b.x; b.dispY = b.y - 40;
    run.firm.boss = b;
    return b;
  };
  Firm.placeBoss = function (b) {
    b.x = (G.cols[b.col] + G.cols[b.col + 1]) / 2;
    b.y = (G.rows[b.row] + G.rows[b.row + 1]) / 2;
  };

  /** Toutes les cibles vivantes pour le vol (Ombres + boss). */
  Firm.targets = function (run) {
    const out = [];
    for (const s of run.firm.shadows) if (s.alive) out.push(s);
    if (run.firm.boss && run.firm.boss.alive) out.push(run.firm.boss);
    return out;
  };

  /** Cellule occupée par une Ombre vivante ou par le boss ? */
  Firm.occupied = function (run, col, row) {
    if (col < 0 || col > 5 || row < 0 || row > 4) return true;
    for (const s of run.firm.shadows) if (s.alive && s.col === col && s.row === row) return true;
    const b = run.firm.boss;
    if (b && b.alive && (col === b.col || col === b.col + 1) && (row === b.row || row === b.row + 1)) return true;
    return false;
  };

  // ---------------------------------------------------------------- règles de boss
  /** Id de la règle de boss active ("faim", "voile", …) ou null. L'Éclipse ajoute "voile" sous 50 % PV. */
  Firm.ruleActive = function (run, ruleId) {
    const b = run.firm.boss;
    if (!b) return false;
    const persist = run.eclipse >= 8;
    const on = (b.alive || persist) && !b.ruleOff;
    if (!on) return false;
    if (b.bossId === ruleId) return true;
    if (ruleId === "voile" && b.bossId === "eclipse" && b.hp < b.maxhp * 0.5) return true;
    return false;
  };

  // ---------------------------------------------------------------- Lune / nuit
  /** Début de Lune : disposition de clous (flux pegs, sans répétition) et boss (flux waves, sans répétition). */
  Firm.setupLune = function (run) {
    const F = run.firm;
    let pool = D.LAYOUTS.map((l, i) => i).filter((i) => F.usedLayouts.indexOf(i) < 0);
    if (!pool.length) { F.usedLayouts = []; pool = D.LAYOUTS.map((l, i) => i); }
    F.layout = U.rpick(run.streams, "pegs", pool);
    F.usedLayouts.push(F.layout);
    F.ronce = [];
    if (run.lune >= 5 && run.lune === D.LUNES) F.bossId = "eclipse";
    else {
      let bp = D.BOSS_POOL_BASE.slice();
      if (BE.Meta && BE.Meta.hasRoom("cartes")) bp = bp.concat(D.BOSS_POOL_CARTES);
      bp = bp.filter((b) => F.usedBosses.indexOf(b) < 0);
      if (!bp.length) bp = D.BOSS_POOL_BASE.slice();
      F.bossId = U.rpick(run.streams, "waves", bp);
      F.usedBosses.push(F.bossId);
    }
  };

  /** Début de nuit : Ombres initiales (rangées 1–2), boss, Mère-Ombre, file fantôme (§6.2). */
  Firm.setupNight = function (run) {
    const F = run.firm;
    F.shadows = []; F.boss = null; F.ghost = []; F.chest = false;
    const sp = D.spawnsFor(run.lune);
    let n = sp.initial;
    if (run.nuit === 2) { Firm.makeBoss(run, F.bossId); n = Math.max(0, n - 2); }
    const cells = [];
    for (let row = 0; row < 2; row++) for (let col = 0; col < 6; col++) if (!Firm.occupied(run, col, row)) cells.push([col, row]);
    U.rshuffle(run.streams, "waves", cells);
    let placedMere = false;
    if (run.nuit === 1 && run.lune >= 2) {
      // la Mère-Ombre prend une cellule de la rangée 1
      const idx = cells.findIndex((c) => c[1] === 0);
      if (idx >= 0) { const c = cells.splice(idx, 1)[0]; Firm.makeShadow(run, "mere", c[0], c[1]); placedMere = true; }
    }
    const count = Math.min(cells.length, placedMere ? n - 1 : n);
    for (let i = 0; i < count; i++) {
      const type = U.rweighted(run.streams, "waves", sp.weights);
      Firm.makeShadow(run, type, cells[i][0], cells[i][1]);
    }
    Firm.genGhost(run, 0);
  };

  /** Tire la prochaine apparition (types + colonnes) dans la file fantôme. Indépendant de la boutique (flux waves). */
  Firm.genGhost = function (run, shotIdx) {
    const sp = D.spawnsFor(run.lune);
    let n = sp.perShot[shotIdx % sp.perShot.length] + (run.eclipse >= 7 ? 1 : 0);
    const cols = [0, 1, 2, 3, 4, 5];
    U.rshuffle(run.streams, "waves", cols);
    n = Math.min(n, 6);
    for (let i = 0; i < n; i++) {
      const type = U.rweighted(run.streams, "waves", sp.weights);
      run.firm.ghost.push({ type, col: cols[i] });
    }
  };

  // ---------------------------------------------------------------- clous
  /** Liste des clous du Firmament pour ce tir : [{idx,r,c,x,y,r,active,kind:"gray"|"double"|"special",slot,clou,dark,hidden}] */
  Firm.pegs = function (run) {
    const L = D.LAYOUTS[run.firm.layout] || D.LAYOUTS[0];
    const slotOf = {};
    for (const k in G.slots) slotOf[G.slots[k]] = k;
    const dark = Firm.dousedPegs(run);
    const b = run.firm.boss && run.firm.boss.alive ? run.firm.boss : null;
    const out = [];
    for (let idx = 0; idx < 20; idx++) {
      const r = Math.floor(idx / 5), c = idx % 5;
      const x = G.pegCols[c], y = G.pegRows[r];
      const slot = slotOf[idx] || null;
      const clou = slot && run.clous && run.clous[slot] ? run.clous[slot] : null;
      let active = clou ? true : L.rows[r][c] === "1";
      let kind = clou ? "special" : run.firm.ronce.indexOf(idx) >= 0 ? "double" : "gray";
      if (kind === "double") active = true;
      let hidden = false;
      if (b && Math.hypot(x - b.x, y - b.y) < b.r + D.BOSS.pegCover) { active = false; hidden = true; }
      out.push({ idx, row: r, col: c, x, y, r: G.pegR, active, kind, slot, clou, dark: !!dark[idx], hidden, flash: 0 });
    }
    return out;
  };
  /** Index des clous éteints par les Éteignoirs vivants (4 coins de leur cellule). */
  Firm.dousedPegs = function (run) {
    const out = {};
    for (const s of run.firm.shadows) {
      if (!s.alive || !D.SHADOWS[s.type].dousing) continue;
      for (const pr of [s.row - 1, s.row]) for (const pc of [s.col - 1, s.col]) {
        if (pr >= 0 && pr < 4 && pc >= 0 && pc < 5) out[pr * 5 + pc] = true;
      }
    }
    return out;
  };
  /** Clous voisins actifs dans le treillis (8 voisins) : Clou Écho. */
  Firm.pegNeighbours = function (pegs, idx) {
    const r = Math.floor(idx / 5), c = idx % 5;
    let n = 0;
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
      if (!dr && !dc) continue;
      const rr = r + dr, cc = c + dc;
      if (rr < 0 || rr > 3 || cc < 0 || cc > 4) continue;
      if (pegs[rr * 5 + cc].active) n++;
    }
    return Math.min(8, n);
  };

  // ---------------------------------------------------------------- dégâts
  /**
   * Contact d'une étoile en vol avec une cible (hook de vol). Journal + effets de famille.
   * Renvoie "absorb" si une Voleuse survit (§5.3).
   */
  Firm.hitByStar = function (run, tg, star, S) {
    const P = BE.Run.passives(run);
    let dmg = star.size + (star.color === "foudre" ? 1 : 0) + (star.grav === "lestee" ? 1 : 0) + (star.dmgBonus || 0);
    for (const f of P.dmgBonus) dmg += f(star) || 0;
    const eclat = D.SHADOW_CONTACT_ECLAT + (star.grav === "filante" ? 1 : 0);
    S.log.push({ t: "hit", shadow: tg.id, type: tg.type, dmg, eclat });
    tg.squash = 1;
    BE.emit("hit", { target: tg, star, dmg, x: tg.x, y: tg.y, eclat });
    // familles
    if (star.color === "braise") { tg.burns.push(D.BURN_TURNS); BE.emit("burn", { target: tg }); }
    if (star.color === "givre" && !tg.frozen) { tg.frozen = true; BE.emit("freeze", { target: tg, x: tg.x, y: tg.y }); }
    Firm.damage(run, tg, dmg, { armor: true }, S);
    if (tg.alive && tg.type === "voleuse") {
      S.log.push({ t: "absorb" });
      BE.emit("absorb", { target: tg, star, x: tg.x, y: tg.y });
      return "absorb";
    }
    return undefined;
  };

  /** Applique des dégâts. opts.armor : l'armure de la Blindée s'applique (pas pour brûlure / éclairs). */
  Firm.damage = function (run, tg, dmg, opts, S) {
    if (!tg.alive) return 0;
    const d = tg.type === "boss" ? null : D.SHADOWS[tg.type];
    if (opts && opts.armor && d && d.armor) dmg = Math.max(0, dmg - d.armor);
    tg.hp -= dmg;
    BE.emit("damage", { target: tg, dmg, x: tg.x, y: tg.y, blocked: dmg === 0 });
    if (tg.hp <= 0) { tg.hp = 0; Firm.kill(run, tg, S); }
    return dmg;
  };

  /** Mort d'une Ombre ou du boss : effets, or, journal. */
  Firm.kill = function (run, tg, S) {
    tg.alive = false;
    const P = BE.Run.passives(run);
    S.log.push({ t: "kill", type: tg.type, shadow: tg.id });
    run.runStats.kills++;
    BE.emit("kill", { target: tg, x: tg.x, y: tg.y, type: tg.type });
    let gold = (P.goldPerKill || 0) + (run.rules.goldPerKill || 0);
    if (tg.type === "boss") {
      gold += D.BOSS.gold;
      if (run.eclipse < 8) tg.ruleOff = true;
      S.log.push({ t: "bosskill" });
      BE.emit("bossKill", { target: tg });
      // règle levée pour le reste de la nuit : La Marée / L'Étau rendent gravité et murs
      if (BE.Jar && BE.Jar.applyRules) BE.Jar.applyRules(run);
      // les clous recouverts réapparaissent
      if (BE.Run.refreshPegs) BE.Run.refreshPegs();
    } else {
      const d = D.SHADOWS[tg.type];
      if (d.bonusShot) { run.shotsLeft += d.bonusShot; run.bonusShots = (run.bonusShots || 0) + d.bonusShot; BE.emit("bonusShot", { x: tg.x, y: tg.y }); }
      if (d.elite) { gold += d.gold; run.firm.chest = true; }
      if (d.split) {
        const hp = Math.max(1, Math.ceil(d.split * tg.maxhp));
        for (const dc of [-1, 1]) {
          const c = tg.col + dc;
          if (!Firm.occupied(run, c, tg.row)) {
            const n = Firm.makeShadow(run, "rampante", c, tg.row, hp);
            n.dispX = tg.x; n.dispY = tg.y;
          }
        }
      }
      if (d.dousing && BE.Run.refreshPegs) BE.Run.refreshPegs();
    }
    if (gold > 0) {
      run.gold += gold; run.runStats.gold += gold;
      S.log.push({ t: "gold", n: gold });
      BE.emit("gold", { n: gold, x: tg.x, y: tg.y });
    }
  };

  // ---------------------------------------------------------------- tourelles et réactions
  /** Cible d'une étoile Foudre : l'Ombre la plus basse, puis |x| minimal, puis id minimal. */
  Firm.turretTarget = function (run, x) {
    let best = null, bRow = -1, bDx = 0;
    for (const t of Firm.targets(run)) {
      const row = t.type === "boss" ? t.row + 1 : t.row;
      const dx = Math.abs(t.x - x);
      if (!best || row > bRow || (row === bRow && (dx < bDx || (dx === bDx && t.id < best.id)))) { best = t; bRow = row; bDx = dx; }
    }
    return best;
  };
  /**
   * Plasma : toute la colonne la plus proche de x subit 2 × taille dégâts.
   * L'armure de la Blindée s'applique (seules la Brûlure et les éclairs l'ignorent, §6.3).
   */
  Firm.plasma = function (run, x, size, S) {
    let col = 0, bd = 1e9;
    G.cols.forEach((cx, i) => { const d = Math.abs(cx - x); if (d < bd) { bd = d; col = i; } });
    BE.emit("plasma", { col, x: G.cols[col] });
    for (const t of Firm.targets(run)) {
      const inCol = t.type === "boss" ? col === t.col || col === t.col + 1 : t.col === col;
      if (inCol) Firm.damage(run, t, 2 * size, { armor: true }, S);
    }
  };
  /**
   * Éclair d'une étoile Foudre au repos (phase TOURELLES) : dégâts = taille, ignore l'armure.
   * Œil du Cyclone (évolution) : la cible survivante est gelée.
   */
  Firm.bolt = function (run, tg, body, S) {
    const dmg = Firm.damage(run, tg, body.size, { armor: false }, S);
    if (tg.alive && BE.Run.passives(run).boltFreeze && !tg.frozen) {
      tg.frozen = true;
      BE.emit("freeze", { target: tg, x: tg.x, y: tg.y });
    }
    return dmg;
  };
  /** Tempête : gèle toutes les Ombres de la rangée occupée la plus basse. */
  Firm.tempete = function (run) {
    let low = -1;
    for (const t of Firm.targets(run)) low = Math.max(low, t.type === "boss" ? t.row + 1 : t.row);
    if (low < 0) return;
    for (const t of Firm.targets(run)) {
      const rows = t.type === "boss" ? [t.row, t.row + 1] : [t.row];
      if (rows.indexOf(low) >= 0) { t.frozen = true; BE.emit("freeze", { target: t, x: t.x, y: t.y }); }
    }
  };
  /** Ronce : le clou gris de r3 le plus proche en x devient Clou double jusqu'à la fin de la Lune. */
  Firm.ronce = function (run, x) {
    const pegs = Firm.pegs(run);
    let best = null, bd = 1e9;
    for (let c = 0; c < 5; c++) {
      const p = pegs[15 + c];
      if (p.kind !== "gray" || !p.active) continue;
      const d = Math.abs(p.x - x);
      if (d < bd) { bd = d; best = p; }
    }
    if (best) { run.firm.ronce.push(best.idx); BE.emit("ronce", { idx: best.idx, x: best.x, y: best.y }); if (BE.Run.refreshPegs) BE.Run.refreshPegs(); }
  };

  // ---------------------------------------------------------------- fin de tir : brûlure, descente, apparitions
  /** Brûlure : 1 dégât par charge, à la fin de chaque tir (ignore l'armure). */
  Firm.burnTick = function (run, S) {
    for (const t of Firm.targets(run)) {
      if (!t.burns.length) continue;
      const dmg = t.burns.length;
      t.burns = t.burns.map((n) => n - 1).filter((n) => n > 0);
      BE.emit("burnTick", { target: t, dmg, x: t.x, y: t.y });
      Firm.damage(run, t, dmg, { armor: false }, S);
    }
  };

  /**
   * Descente (§2.1-6, §6.2). Renvoie la liste des Pierres à lâcher : [{size, x}].
   * Traitement de bas en haut, puis de gauche à droite. Une cellule cible occupée fait attendre (compteur 0).
   */
  Firm.descend = function (run) {
    const P = BE.Run.passives(run);
    const stones = [];
    // Horloge : tous les 3 tirs (3e, 6e, 9e avec les tirs bonus), les Ombres ne descendent pas
    if (P.horloge && run.shotIndex > 0 && run.shotIndex % 3 === 0) { BE.emit("horloge", {}); return stones; }
    const list = run.firm.shadows.filter((s) => s.alive).sort((a, b) => b.row - a.row || a.col - b.col);
    for (const s of list) {
      if (s.frozen) { s.frozen = false; BE.emit("thaw", { target: s }); continue; }
      s.counter = Math.max(0, s.counter - 1);
      if (s.counter > 0) continue;
      const d = D.SHADOWS[s.type];
      if (s.row === 4) {
        s.alive = false; s.fell = true;
        stones.push({ size: d.stone, x: s.x, type: s.type });
        BE.emit("shadowFall", { target: s, x: s.x, y: s.y });
      } else if (!Firm.occupied(run, s.col, s.row + 1)) {
        s.row++; s.y = G.rows[s.row]; s.counter = d.speed;
        BE.emit("shadowMove", { target: s });
      } else s.counter = 0;
    }
    // boss
    const b = run.firm.boss;
    if (b && b.alive) {
      if (b.frozen) b.frozen = false;
      else {
        b.counter = Math.max(0, b.counter - 1);
        if (b.counter === 0 && b.row + 2 <= 4 && !Firm.occupied(run, b.col, b.row + 2) && !Firm.occupied(run, b.col + 1, b.row + 2)) {
          b.row++; Firm.placeBoss(b); b.counter = D.BOSS.every;
          if (BE.Run.refreshPegs) BE.Run.refreshPegs();
        }
      }
    }
    // Mère-Ombre : ponte tous les 2 tirs
    for (const s of run.firm.shadows) {
      if (!s.alive || !D.SHADOWS[s.type].layEvery) continue;
      s.layT = (s.layT || 0) + 1;
      if (s.layT >= D.SHADOWS[s.type].layEvery) {
        s.layT = 0;
        const opts = [[s.col, s.row + 1], [s.col - 1, s.row], [s.col + 1, s.row]];
        for (const c of opts) {
          if (c[1] <= 4 && !Firm.occupied(run, c[0], c[1])) {
            const n = Firm.makeShadow(run, "rampante", c[0], c[1]);
            n.dispX = s.x; n.dispY = s.y;
            BE.emit("lay", { from: s, to: n });
            break;
          }
        }
      }
    }
    return stones;
  };

  /** Apparitions : la file fantôme entre dans la rangée 1 (si la cellule est libre), puis on tire la suivante. */
  Firm.spawn = function (run) {
    const keep = [];
    for (const g of run.firm.ghost) {
      if (!Firm.occupied(run, g.col, 0)) {
        const s = Firm.makeShadow(run, g.type, g.col, 0);
        s.dispY = D.GEOM.ghostY;
        BE.emit("spawn", { target: s });
      } else keep.push(g);
    }
    run.firm.ghost = keep;
    // ménage des Ombres mortes (garde le tableau court)
    run.firm.shadows = run.firm.shadows.filter((s) => s.alive);
    if (keep.length < 6) Firm.genGhost(run, run.shotIndex);
  };

  /** Ombres vivantes (hors boss). */
  Firm.alive = (run) => run.firm.shadows.filter((s) => s.alive);
})(window.BE = window.BE || {});
