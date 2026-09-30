/* 14_meta.js — BE.Meta : méta-progression (§9) et écrans méta (§10.2, §10.8).
   - Fragments ◇ (§9.1), Observatoire (8 salles, §9.2), 16 défis (§9.3), Grimoire (§9.4), Éclipses (§9.5),
     Ciel du Jour (§9.6), partage façon Wordle, statistiques et déblocages des Gardiens (§6.6).
   - Écrans (mode immédiat, routés par BE.UI.SCREENS / BE.Run.SCENES) : SELECT, OBSERVATORY, GRIMOIRE, DEFIS, DAILY,
     plus une surcouche (Grimoire ouvert depuis la pause, notifications « Défi accompli »).
   La simulation n'appelle jamais ce module : il écoute le bus d'événements et lit le run (lecture seule, sauf à la fin). */
(function (BE) {
  "use strict";

  const Meta = (BE.Meta = {});
  const D = BE.DATA, U = BE.util, P = D.PAL;
  const TAU = Math.PI * 2;
  let g = null; // contexte 2D courant (celui de BE.Render), fixé au début de chaque dessin

  // ================================================================ accès
  let fallbackMeta = null;
  function meta() {
    if (BE.state && BE.state.meta) return BE.state.meta;
    return fallbackMeta || (fallbackMeta = BE.Save.defaultMeta());
  }
  function curRun() { return BE.state ? BE.state.run : null; }
  const today = () => U.todayStr();
  let dirty = false;
  function touch() { dirty = true; }
  /** Écrit la méta si elle a changé (appelé aux moments calmes : fin de tir, changement de scène, masquage). */
  Meta.flush = function (force) {
    if ((dirty || force) && BE.state && BE.state.meta) { BE.Save.saveMeta(BE.state.meta); dirty = false; }
  };

  // ================================================================ contenu débloqué
  /** Ciel du Jour (et création d'un run du jour) : tout le contenu est ouvert (§9.6). */
  Meta.forceAll = false;
  function fullContent() { const r = curRun(); return Meta.forceAll || !!(r && r.daily && !r.result); }
  /** Salle réellement construite dans l'Observatoire. */
  Meta.built = (id) => meta().rooms.indexOf(id) >= 0;
  /** Contenu d'une salle disponible en jeu (salle construite, ou Ciel du Jour). */
  Meta.hasRoom = (id) => fullContent() || Meta.built(id);
  Meta.defiDone = (id) => !!(meta().defis[id] && meta().defis[id].done);
  /** Une source de contenu ({type:"depart"|"room"|"defi", id}) est-elle débloquée ? */
  Meta.isUnlocked = function (src) {
    if (!src || src.type === "depart") return true;
    if (fullContent()) return true;
    if (src.type === "room") return Meta.built(src.id);
    if (src.type === "defi") return Meta.defiDone(src.id);
    return false;
  };
  Meta.hasGardien = (id) => meta().gardiens.indexOf(id) >= 0;
  /** Les Éclipses s'ouvrent avec D12 (gagner un run). */
  Meta.eclipsesOpen = () => Meta.defiDone("D12");
  /** Niveau d'Éclipse maximal sélectionnable pour ce Gardien. */
  Meta.maxEclipse = (id) => (Meta.eclipsesOpen() ? Math.min(8, meta().eclipses[id] || 0) : 0);
  /** Source lisible d'un contenu verrouillé. */
  Meta.srcLabel = function (src) {
    if (!src || src.type === "depart") return "Disponible dès le départ";
    if (src.type === "room") { const r = D.ROOMS.find((x) => x.id === src.id); return "Salle : " + (r ? r.nom : src.id); }
    if (src.type === "defi") { const d = D.DEFIS.find((x) => x.id === src.id); return "Défi " + src.id + (d ? " : " + d.txt : ""); }
    return "";
  };

  // ================================================================ Observatoire (§9.2)
  const ROOM_INFO = {
    serre: { tint: "#6ee07a", flavor: "Sous le verre, une lumière verte attend de germer.",
      desc: "Famille Sève : elle rebondit plus et grossit au 3e clou. Ton Sac de départ passe à 4 couleurs, avec les réactions Cendre, Ronce et Photosynthèse." },
    atelier: { tint: "#c7a6ff", flavor: "L'établi résonne de petits coups de marteau.",
      desc: "Nouveaux clous à l'Aube : Prisme (divise l'étoile en deux) et Écho (+1 Éclat par clou voisin)." },
    bibliotheque: { tint: "#ffd166", flavor: "Des pages qui se souviennent des nuits passées.",
      desc: "Six reliques rejoignent le pool : Vitrail, Paratonnerre, Métronome, Le Comptable, Glaneur et Échangeur." },
    laboratoire: { tint: "#5ee7ff", flavor: "Les alambics distillent ce que les réactions laissent.",
      desc: "Les Évolutions s'éveillent : une relique évolue après 3 réactions assorties dans le run. Le Grimoire révèle leurs indices." },
    forge: { tint: "#ff6b3d", flavor: "Le feu y martèle le cristal et l'or.",
      desc: "Clou Cristal (+1 Mult par touche), gravures Dorée (+1 or en se posant) et Filante (lancer plus rapide)." },
    cartes: { tint: "#9aa4ff", flavor: "Les cartes du ciel révèlent d'autres maîtres de la nuit.",
      desc: "Deux boss rejoignent la rotation : La Marée (tout pèse plus lourd) et L'Étau (le bocal se resserre)." },
    crypte: { tint: "#b59cff", flavor: "Sous les voûtes, des reliques rares sommeillent.",
      desc: "Quatre reliques rares : Pression, Dernier Souffle, Verre soufflé et Couronne." },
    planetarium: { tint: "#ffd166", flavor: "Là-haut, les planètes tournent et le ciel danse.",
      desc: "Révèle le secret Aurore : 3 réactions distinctes en un tir donnent ×2 Mult final et un arc-en-ciel sur le bocal." },
  };
  Meta.ROOM_INFO = ROOM_INFO;
  /** Nuit Blanche (Lunes infinies) : proposée seulement si un module du run l'implémente. */
  const hasNuitBlanche = () => !!(BE.Run && (typeof BE.Run.nuitBlanche === "function" || typeof BE.Run.startNuitBlanche === "function"));
  /** Résumé court d'une salle (tuile). */
  function roomShort(room) { return room.id === "planetarium" && !hasNuitBlanche() ? "Secret Aurore" : room.txt; }
  function roomDesc(id) { return ROOM_INFO[id].desc + (id === "planetarium" && hasNuitBlanche() ? " Après une victoire, la Nuit Blanche (Lunes infinies) s'ouvre." : ""); }
  const roomById = (id) => D.ROOMS.find((r) => r.id === id);
  /** Contenu apporté par une salle (pour l'affichage). */
  Meta.roomContent = function (id) {
    const rel = (room) => D.RELICS.filter((r) => r.src && r.src.type === "room" && r.src.id === room).map((r) => ({ k: "relic", id: r.id }));
    switch (id) {
      case "serre": return [{ k: "star", color: "seve", size: 3 }, { k: "reaction", id: "cendre" }, { k: "reaction", id: "ronce" }, { k: "reaction", id: "photosynthese" }];
      case "atelier": return [{ k: "clou", id: "prisme" }, { k: "clou", id: "echo" }];
      case "bibliotheque": return rel("bibliotheque");
      case "laboratoire": return D.EVOLUTIONS.map((e) => ({ k: "evo", id: e.id }));
      case "forge": return [{ k: "clou", id: "cristal" }, { k: "grav", id: "doree" }, { k: "grav", id: "filante" }];
      case "cartes": return [{ k: "boss", id: "maree" }, { k: "boss", id: "etau" }];
      case "crypte": return rel("crypte");
      case "planetarium": return hasNuitBlanche() ? [{ k: "aurore" }, { k: "moon" }] : [{ k: "aurore" }];
    }
    return [];
  };
  /** Salle la moins chère restante : {room, need} ou null (tout est construit). */
  Meta.nextRoom = function () {
    const m = meta();
    const rest = D.ROOMS.filter((r) => m.rooms.indexOf(r.id) < 0).sort((a, b) => a.cost - b.cost);
    if (!rest.length) return null;
    return { room: rest[0], need: Math.max(0, rest[0].cost - m.fragments) };
  };
  const MASC = { atelier: 1, laboratoire: 1, planetarium: 1 };
  /** « peut être allumé(e) » accordé au nom de la salle. */
  Meta.canLightText = (room) => room.nom + " peut être allumé" + (MASC[room.id] ? "" : "e");
  /** Texte du bandeau « Encore N ◇ : Salle ». */
  Meta.nextRoomText = function (nr) {
    nr = nr || Meta.nextRoom();
    if (!nr) return "Observatoire complet ✦";
    return nr.need > 0 ? "Encore " + nr.need + " ◇ : " + nr.room.nom : Meta.canLightText(nr.room) + " !";
  };
  Meta.canBuildAny = function () { const nr = Meta.nextRoom(); return !!nr && nr.need === 0; };
  /** Construit une salle. Renvoie {ok, reason?, need?}. */
  Meta.build = function (id) {
    const m = meta(), room = roomById(id);
    if (!room) return { ok: false, reason: "unknown" };
    if (Meta.built(id)) return { ok: false, reason: "built" };
    if (m.fragments < room.cost) return { ok: false, reason: "frags", need: room.cost - m.fragments };
    m.fragments -= room.cost;
    m.rooms.push(id);
    Meta.flush(true);
    BE.emit("meta:room", { id });
    return { ok: true };
  };

  // ================================================================ découvertes (Grimoire)
  function runDiscKey(key) {
    const run = curRun(), m = meta();
    if (!run || run.result) return;
    if (m.runDisc.seed !== run.seed) m.runDisc = { seed: run.seed, keys: [] };
    if (m.runDisc.keys.indexOf(key) < 0) m.runDisc.keys.push(key);
    run.discoveries = m.runDisc.keys.length;
  }
  /** Découverte (Grimoire). kind : "relics" | "ombres" | "evolutions". Renvoie true si nouvelle. */
  Meta.discover = function (kind, id) {
    const m = meta();
    const list = m.grimoire[kind];
    if (!Array.isArray(list) || !id || list.indexOf(id) >= 0) return false;
    list.push(id);
    runDiscKey(kind + ":" + id);
    touch();
    BE.emit("meta:discover", { kind, id });
    return true;
  };
  /** Réaction déclenchée (compteur du Grimoire). Renvoie true si c'est la première. */
  Meta.discoverReaction = function (id) {
    const R = meta().grimoire.reactions;
    const isNew = !R[id];
    R[id] = (R[id] || 0) + 1;
    touch();
    if (isNew) { runDiscKey("reactions:" + id); BE.emit("meta:discover", { kind: "reactions", id }); }
    return isNew;
  };
  function countStar(k) { const S = meta().grimoire.stars; S[k] = (S[k] || 0) + 1; touch(); }

  // ================================================================ défis (§9.3)
  const DEFI_INFO = {
    D01: { max: 4, reward: { k: "relic", id: "R13" }, stat: () => meta().stats.maxSize },
    D02: { max: 1, reward: { k: "relic", id: "R14" } },
    D03: { max: 3, reward: { k: "relic", id: "R15" }, stat: () => meta().stats.bestPureShot },
    D04: { max: 3, reward: { k: "relic", id: "R18" }, stat: () => meta().stats.bestStonesShot },
    D05: { max: 1, reward: { k: "relic", id: "R21" } },
    D06: { max: 6, reward: { k: "relic", id: "R25" }, stat: () => Object.keys(D.REACTIONS).filter((k) => meta().grimoire.reactions[k]).length },
    D07: { max: 4, reward: { k: "relic", id: "R29" }, stat: () => meta().stats.bestMergesShot },
    D08: { max: 1, reward: { k: "relic", id: "R30" } },
    D09: { max: 3, reward: { k: "gardien", id: "astronome" }, stat: () => meta().stats.bestLune },
    D10: { max: 15, reward: { k: "gardien", id: "forgeronne" }, stat: () => meta().stats.bestPureRun },
    D11: { max: 150, reward: { k: "gardien", id: "glaneuse" }, stat: () => meta().stats.kills + liveKills() },
    D12: { max: 1, reward: { k: "gardien", id: "insomniaque" }, stat: () => meta().stats.wins },
    D13: { max: 1000, reward: { k: "grav", id: "prismatique" }, stat: () => meta().stats.bestShot },
    D14: { max: 1, reward: { k: "clou", id: "teint" } },
    D15: { max: 5, reward: { k: "frags", n: 10 }, stat: () => meta().stats.bestKillsShot },
    D16: { max: 1, reward: { k: "theme" } },
  };
  Meta.DEFI_INFO = DEFI_INFO;
  function liveKills() { const r = curRun(); return r && !r.result && r.runStats ? r.runStats.kills : 0; }
  /** Progression d'un défi : {cur, max, done, pct}. */
  Meta.defiProgress = function (id) {
    const inf = DEFI_INFO[id], rec = meta().defis[id] || {};
    const done = !!rec.done;
    let cur = Math.max(rec.progress || 0, inf.stat ? inf.stat() || 0 : 0);
    if (done) cur = Math.max(cur, inf.max);
    return { cur: Math.min(cur, inf.max), max: inf.max, done, pct: U.clamp(cur / inf.max, 0, 1) };
  };
  Meta.defisDoneCount = () => D.DEFIS.filter((d) => Meta.defiDone(d.id)).length;
  let runDefis = { seed: null, ids: [] };
  function unlockGardien(id) {
    const m = meta();
    if (m.gardiens.indexOf(id) >= 0) return false;
    m.gardiens.push(id);
    if (m.eclipses[id] === undefined) m.eclipses[id] = 0;
    return true;
  }
  /** Marque un défi comme accompli et applique sa récompense. Renvoie true si nouveau. */
  Meta.completeDefi = function (id, silent) {
    const inf = DEFI_INFO[id];
    if (!inf || Meta.defiDone(id)) return false;
    const m = meta();
    const prev = m.defis[id] || {};
    m.defis[id] = { done: true, progress: Math.max(prev.progress || 0, inf.max), date: today() };
    const r = inf.reward;
    if (r.k === "gardien") unlockGardien(r.id);
    if (r.k === "frags") { m.fragments += r.n; m.stats.fragmentsTotal += r.n; }
    if (r.k === "theme") m.flags.themeAurore = true;
    const run = curRun();
    if (run) {
      if (runDefis.seed !== run.seed) runDefis = { seed: run.seed, ids: [] };
      runDefis.ids.push(id);
    }
    touch(); Meta.flush();
    if (!silent) {
      const d = D.DEFIS.find((x) => x.id === id);
      Meta.notify({ kind: "defi", id, title: "DÉFI ACCOMPLI", name: d.txt, sub: "Récompense : " + d.reward, color: P.or });
    }
    BE.emit("meta:defi", { id });
    return true;
  };
  /** Met à jour la progression (meilleure valeur) ; accomplit le défi au seuil. */
  function bump(id, v) {
    if (!(v > 0) || Meta.defiDone(id)) return;
    const m = meta(), inf = DEFI_INFO[id];
    const rec = m.defis[id] || (m.defis[id] = { done: false, progress: 0 });
    if (v > (rec.progress || 0)) { rec.progress = Math.min(v, inf.max); touch(); }
    if (v >= inf.max) Meta.completeDefi(id);
  }
  /** Accomplit les défis dont le compteur a déjà atteint le seuil (données anciennes, cumuls). */
  Meta.checkStatDefis = function () {
    for (const id in DEFI_INFO) {
      const inf = DEFI_INFO[id];
      if (inf.stat && !Meta.defiDone(id)) { const v = inf.stat() || 0; if (v >= inf.max) Meta.completeDefi(id); }
    }
  };
  function best(key, v) { const S = meta().stats; if (v > (S[key] || 0)) { S[key] = v; touch(); } }
  Meta.bump = bump;

  // ================================================================ notifications (surcouche)
  const notes = [];
  /** File de notifications « carte » en haut de l'écran : {title, name, sub, color, kind}. */
  Meta.notify = function (o) {
    const key = o.key || (o.kind + ":" + (o.id || o.name));
    if (notes.some((n) => n.key === key) || notes.length >= 8) return;
    notes.push(Object.assign({ t0: null, key }, o));
  };
  /** Une carte de notification occupe-t-elle le haut de l'écran ? (les toasts de 13_ui se décalent alors) */
  Meta.notifying = () => notes.length > 0 && notes[0].t0 !== null && BE.state.scene !== "SHOP";
  function chime(notes2, gap, base) {
    if (!BE.Audio) return;
    const b = base || 523.25;
    (notes2 || [0, 4, 7, 12]).forEach((n, i) => setTimeout(() => BE.Audio.play("reaction", { f: b * Math.pow(2, n / 12) }), i * (gap || 90)));
  }
  Meta.chime = chime;

  // ================================================================ événements de jeu
  let shotBossFull = false;
  BE.on("merge", (e) => {
    const s = e.size | 0;
    if (s > 0) countStar(s);
    best("maxSize", s);
    if (s >= 2) bump("D01", s);
  });
  BE.on("bigbang", () => { countStar(8); Meta.completeDefi("D08"); });
  BE.on("reaction", (e) => {
    Meta.discoverReaction(e.id);
    bump("D06", DEFI_INFO.D06.stat());
  });
  BE.on("spawn", (e) => { if (e && e.target && e.target.type && e.target.type !== "boss") Meta.discover("ombres", e.target.type); });
  BE.on("launch", (e) => {
    const run = curRun();
    if (!run || e.copy) return;
    if (e.star && e.star.color) countStar(e.star.color);
    const b = run.firm && run.firm.boss;
    shotBossFull = !!(b && b.alive && b.hp >= b.maxhp);
  });
  BE.on("nightStart", () => {
    const run = curRun();
    if (!run) return;
    if (run.lune === 1 && run.nuit === 0 && run.shotIndex === 0 && !(run.runStats && run.runStats.shots)) onRunStart(run);
    best("bestLune", run.lune);
    bump("D09", run.lune);
    discoverField(run);
  });
  function discoverField(run) {
    try {
      for (const t of BE.Firm.targets(run)) {
        if (t.type === "boss") Meta.discover("ombres", "boss:" + t.bossId);
        else Meta.discover("ombres", t.type);
      }
    } catch (err) { /* lecture seule, jamais bloquante */ }
  }
  BE.on("shotScored", (e) => {
    const run = curRun();
    if (!run) return;
    const c = run.lastCtx || {};
    const merges = c.merges || [];
    const pure = merges.filter((x) => x.pure).length;
    best("bestPureShot", pure); bump("D03", pure);
    best("bestStonesShot", c.stonesBroken | 0); bump("D04", c.stonesBroken | 0);
    best("bestMergesShot", merges.length); bump("D07", merges.length);
    best("bestKillsShot", c.kills | 0); bump("D15", c.kills | 0);
    if (c.bigBang) Meta.completeDefi("D08");
    if (c.aurore) { Meta.discoverReaction("aurore"); Meta.completeDefi("D16"); }
    const lum = (e && e.res && e.res.lumiere) || 0;
    best("bestShot", lum); bump("D13", lum);
    if (c.bossKilled && shotBossFull) Meta.completeDefi("D14");
    if (run.runStats) {
      best("bestPureRun", run.runStats.pureMerges | 0); bump("D10", run.runStats.pureMerges | 0);
      bump("D11", meta().stats.kills + (run.runStats.kills | 0));
    }
    discoverField(run);
  });
  BE.on("kill", () => {
    const run = curRun();
    if (run && run.runStats && !Meta.defiDone("D11") && meta().stats.kills + run.runStats.kills >= DEFI_INFO.D11.max) bump("D11", meta().stats.kills + run.runStats.kills);
  });
  BE.on("quota", () => {
    const run = curRun();
    if (!run || run.shotIndex < 1) return; // victoire forcée (tests) : ne compte pas
    const S = meta().stats;
    if (!S.fewestShotsNight || run.shotIndex < S.fewestShotsNight) { S.fewestShotsNight = run.shotIndex; touch(); }
    if (run.shotIndex <= 2) Meta.completeDefi("D05");
    let fill = 1;
    try { fill = BE.Jar.fill(run); } catch (err) { /* */ }
    if (fill < 0.35) Meta.completeDefi("D02"); // jauge max(surface, hauteur), §4 : ≈ 8 % des nuits gagnées (bot greedy)
  });
  function scanEvolutions(run) {
    if (!run || !run.relics) return;
    for (const r of run.relics) {
      if (!r) continue;
      let evo = null;
      if (r.evo) evo = r.evo;
      else if (D.EVOLUTIONS.some((e) => e.id === r.id)) evo = r.id;
      else if (r.evolved) { const e = D.EVOLUTIONS.find((x) => x.base === r.id); evo = e ? e.id : null; }
      if (evo) Meta.discover("evolutions", evo);
    }
  }
  const onEvo = (e) => {
    const id = e && (e.to || e.evo || e.id || (e.relic && e.relic.id));
    if (id && D.EVOLUTIONS.some((x) => x.id === id)) Meta.discover("evolutions", id);
    else scanEvolutions(curRun());
  };
  BE.on("evolve", onEvo); BE.on("evolution", onEvo);
  const CALM = { AIM: 1, SHOP: 1, TITLE: 1, RUN_END: 1, NIGHT_WON: 1, SELECT: 1 };
  BE.on("scene", (e) => {
    const run = curRun();
    if (e.to === "SHOP") scanEvolutions(run);
    if (e.to === "TITLE") Meta.checkStatDefis();
    if (CALM[e.to]) Meta.flush(); // écritures regroupées aux moments calmes
  });

  // ---------------------------------------------------------------- début de run
  function onRunStart(run) {
    const s = BE.state, m = meta();
    // run précédent jamais terminé et remplacé par celui-ci : soldé comme abandonné (ses Fragments ne sont pas perdus)
    if (["SELECT", "TITLE", "DAILY", "RUN_END", "OBSERVATORY", "GRIMOIRE", "DEFIS"].indexOf(s.prevScene) >= 0) {
      const old = BE.Save.loadRun();
      if (old) {
        try { Meta.settleAbandoned(old); } catch (err) { console.error(err); }
      }
    }
    m.runDisc = { seed: run.seed, keys: [] };
    runDefis = { seed: run.seed, ids: [] };
    if (run.daily) {
      const date = dailyDate(run);
      if (date === today() && m.daily.attemptDate !== date && !m.daily.history.some((h) => h.date === date)) {
        m.daily.attemptDate = date;
        run.dailyOfficial = true;
      }
    } else {
      m.flags.lastGardien = run.gardien;
    }
    for (const r of run.relics) Meta.discover("relics", r.id);
    touch();
  }
  /** Solde un run sauvegardé jamais terminé (remplacé par un nouveau run) comme un abandon. */
  Meta.settleAbandoned = function (old) {
    if (!old || old.result) return null;
    old.result = { won: false, cause: "abandon", deficit: 0, lune: old.lune, nuit: old.nuit };
    while (old.nightBest.length < old.lune) old.nightBest.push([]);
    if (old.phase !== "SHOP" && old.nightBest[old.lune - 1][old.nuit] === undefined) old.nightBest[old.lune - 1][old.nuit] = 0;
    const res = Meta.endRun(old);
    BE.Save.clearRun();
    if (BE.state && BE.state.ui) BE.state.ui.savedRun = null;
    if (BE.UI && BE.UI.toast) BE.UI.toast("Partie précédente abandonnée · +" + res.total + " ◇");
    return res;
  };

  // ================================================================ fin de run : Fragments (§9.1)
  /** Fin de run : Fragments, statistiques, défis, Éclipses, Ciel du Jour. Renvoie {total, lines:[{txt,n}], defis, eclipse}. */
  Meta.endRun = function (run) {
    if (run._metaSummary) return run._metaSummary;
    if (run.nuitBlanche) return endNuitBlanche(run);
    const m = meta(), S = m.stats;
    const won = !!(run.result && run.result.won);
    const lunesDone = Math.max(0, run.lune - 1) + (won ? 1 : 0);
    let nights = 0;
    for (const L of run.nightBest || []) for (const v of L || []) if (v) nights++;
    const disc = m.runDisc.seed === run.seed ? m.runDisc.keys.length : (run.discoveries || 0);
    const lines = [];
    if (lunesDone) lines.push({ txt: "Lunes terminées (" + lunesDone + ")", n: 3 * lunesDone });
    if (nights) lines.push({ txt: "Nuits gagnées (" + nights + ")", n: nights });
    if (disc) lines.push({ txt: "Découvertes (" + disc + ")", n: 2 * disc });
    if (won) lines.push({ txt: "Victoire", n: 10 });
    const base = lines.reduce((s, l) => s + l.n, 0);
    const ecl = run.eclipse || 0;
    const F = Math.max(1, Math.round(base * (1 + 0.15 * ecl)));
    const nrBefore = Meta.nextRoom();
    if (!base) lines.push({ txt: "Consolation", n: 1 });
    else if (ecl && F > base) lines.push({ txt: "Éclipse " + ecl + " (+" + (15 * ecl) + " %)", n: F - base });
    m.fragments += F;
    S.fragmentsTotal += F;
    // statistiques
    const RS = run.runStats || {};
    S.runs++; if (won) S.wins++;
    S.kills += RS.kills | 0; S.merges += RS.merges | 0;
    if (RS.bestShot) S.bestShot = Math.max(S.bestShot, RS.bestShot.lumiere | 0);
    S.bestTotal = Math.max(S.bestTotal, RS.lightTotal | 0);
    S.bestLune = Math.max(S.bestLune, run.lune);
    S.bestPureRun = Math.max(S.bestPureRun, RS.pureMerges | 0);
    const bg = S.byGardien[run.gardien] || (S.byGardien[run.gardien] = { runs: 0, wins: 0, bestLune: 0, bestEclipse: -1 });
    if (!run.daily) {
      bg.runs++; bg.bestLune = Math.max(bg.bestLune, run.lune);
      if (won) { bg.wins++; bg.bestEclipse = Math.max(bg.bestEclipse, ecl); }
    }
    // défis de fin de run
    bump("D09", run.lune);
    bump("D10", RS.pureMerges | 0);
    bump("D11", S.kills);
    if (won) Meta.completeDefi("D12");
    // Éclipses : gagner au niveau N ouvre N+1 pour ce Gardien (§9.5)
    let eclipseUnlocked = 0;
    if (won && !run.daily && Meta.eclipsesOpen()) {
      const cur = m.eclipses[run.gardien] || 0;
      if (ecl >= cur && cur < 8) {
        m.eclipses[run.gardien] = ecl + 1;
        eclipseUnlocked = ecl + 1;
        Meta.notify({ kind: "eclipse", title: "ÉCLIPSE " + eclipseUnlocked + " DÉBLOQUÉE", name: D.GARDIEN_BY_ID[run.gardien].nom, sub: D.ECLIPSES[eclipseUnlocked].txt, color: P.frag });
      }
    }
    // Ciel du Jour : score officiel = premier essai du jour
    if (run.daily) recordDaily(run);
    const nr = Meta.nextRoom();
    if (nr && nr.need === 0 && nrBefore && nrBefore.need > 0) {
      Meta.notify({ kind: "room", id: nr.room.id, title: "OBSERVATOIRE", name: Meta.canLightText(nr.room), sub: "Dépense tes Fragments ◇ depuis l'écran titre", color: P.frag });
    }
    const summary = {
      total: F, lines, won, eclipseUnlocked,
      defis: runDefis.seed === run.seed ? runDefis.ids.slice() : [],
    };
    m.runDisc = { seed: "", keys: [] };
    runDefis = { seed: run.seed, ids: [] }; // une Nuit Blanche éventuelle ne relistera pas ces défis
    Object.defineProperty(run, "_metaSummary", { value: summary, enumerable: false, configurable: true });
    Meta.flush(true);
    return summary;
  };

  /** Fin d'une Nuit Blanche : la victoire a déjà été soldée ; seules les Lunes et nuits au-delà de la 5e rapportent. */
  function endNuitBlanche(run) {
    const m = meta(), S = m.stats, NB = run.nuitBlanche, RS = run.runStats || {};
    const lunesDone = Math.max(0, run.lune - 1 - NB.from);
    let nights = 0;
    (run.nightBest || []).forEach((L, i) => { if (i >= NB.from) for (const v of L || []) if (v) nights++; });
    const disc = m.runDisc.seed === run.seed ? m.runDisc.keys.length : 0;
    const lines = [];
    if (lunesDone) lines.push({ txt: "Nuit Blanche : Lunes (" + lunesDone + ")", n: 3 * lunesDone });
    if (nights) lines.push({ txt: "Nuits blanches gagnées (" + nights + ")", n: nights });
    if (disc) lines.push({ txt: "Découvertes (" + disc + ")", n: 2 * disc });
    const base = lines.reduce((a, l) => a + l.n, 0);
    const ecl = run.eclipse || 0;
    const F = base ? Math.round(base * (1 + 0.15 * ecl)) : 0;
    if (!base) lines.push({ txt: "Victoire déjà comptée", n: 0 });
    else if (ecl && F > base) lines.push({ txt: "Éclipse " + ecl + " (+" + (15 * ecl) + " %)", n: F - base });
    m.fragments += F; S.fragmentsTotal += F;
    S.kills += Math.max(0, (RS.kills | 0) - NB.kills); S.merges += Math.max(0, (RS.merges | 0) - NB.merges);
    if (RS.bestShot) S.bestShot = Math.max(S.bestShot, RS.bestShot.lumiere | 0);
    S.bestTotal = Math.max(S.bestTotal, RS.lightTotal | 0);
    S.bestLune = Math.max(S.bestLune, run.lune);
    S.bestPureRun = Math.max(S.bestPureRun, RS.pureMerges | 0);
    const bg = S.byGardien[run.gardien];
    if (bg) bg.bestLune = Math.max(bg.bestLune, run.lune);
    bump("D10", RS.pureMerges | 0); bump("D11", S.kills);
    const summary = { total: F, lines, won: false, nuitBlanche: true, eclipseUnlocked: 0, defis: runDefis.seed === run.seed ? runDefis.ids.slice() : [] };
    m.runDisc = { seed: "", keys: [] };
    Object.defineProperty(run, "_metaSummary", { value: summary, enumerable: false, configurable: true });
    Meta.flush(true);
    return summary;
  }

  // ================================================================ Ciel du Jour (§9.6)
  Meta.dailySeed = (date) => "BDE-" + (date || today());
  function dailyDate(run) { return String(run.seed || "").replace(/^BDE-/, ""); }
  Meta.dailyEntry = (date) => meta().daily.history.find((h) => h.date === (date || today())) || null;
  /** {done, started, best, official} pour aujourd'hui. */
  Meta.dailyInfo = function () {
    const e = Meta.dailyEntry();
    return { done: !!e, started: meta().daily.attemptDate === today(), best: e ? e.best || e.score : 0, official: e ? e.score : null };
  };
  /** Options du run du jour : graine FNV-1a("BDE-date") → Gardien (seed % 5) et 1 relique imposée. */
  Meta.dailyOpts = function (date) {
    const seed = Meta.dailySeed(date);
    const h = U.fnv1a(seed);
    const rnd = U.mulberry32(h);
    const gd = D.GARDIENS[h % D.GARDIENS.length];
    const relic = D.RELICS[Math.floor(rnd() * D.RELICS.length)];
    return { seed, gardien: gd.id, eclipse: 0, daily: true, relics: [relic.id] };
  };
  /** Lance (ou reprend) le Ciel du Jour. */
  Meta.startDaily = function () {
    const saved = BE.Save.loadRun();
    if (saved && saved.daily && saved.seed === Meta.dailySeed()) { BE.Run.resume(saved); return; }
    Meta.forceAll = true;
    try { BE.Run.startNewRun(Meta.dailyOpts()); } finally { Meta.forceAll = false; }
  };
  function recordDaily(run) {
    const m = meta(), date = dailyDate(run);
    const score = (run.runStats && run.runStats.lightTotal) | 0;
    let e = m.daily.history.find((h) => h.date === date);
    if (!e) {
      // premier résultat enregistré pour cette date = score officiel (run.dailyOfficial marque l'essai officiel)
      e = {
        date, score, best: score, lune: run.lune, nuit: run.nuit, won: !!(run.result && run.result.won), gardien: run.gardien,
        grid: (run.nightBest || []).map((L) => (L || []).slice()), shot: run.runStats.bestShot || null,
      };
      m.daily.history.push(e);
      m.daily.history.sort((a, b) => (a.date < b.date ? -1 : 1));
      while (m.daily.history.length > 30) m.daily.history.shift();
    } else e.best = Math.max(e.best || e.score, score);
    if (date === today()) { m.daily.date = date; m.daily.officialScore = e.score; m.daily.best = e.best; }
    touch();
  }
  /** Série de jours consécutifs joués (jusqu'à aujourd'hui ou hier). */
  Meta.dailyStreak = function () {
    const set = {};
    for (const h of meta().daily.history) set[h.date] = 1;
    let n = 0;
    const d = new Date();
    if (!set[U.todayStr()]) d.setDate(d.getDate() - 1);
    for (;;) {
      const k = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
      if (!set[k]) break;
      n++; d.setDate(d.getDate() - 1);
    }
    return n;
  };

  // ---------------------------------------------------------------- partage façon Wordle
  function nightEmoji(v) {
    if (v === 0) return "❌";
    if (v >= 8) return D.BIGBANG.emoji;
    return (D.SIZES[Math.max(1, Math.min(7, v | 0))] || D.SIZES[1]).emoji;
  }
  /** Texte de partage (§9.6) depuis un run ou une entrée d'historique du jour. */
  Meta.shareText = function (src) {
    const isRun = !!(src && src.runStats);
    const daily = isRun ? !!src.daily : true;
    const date = isRun ? (daily ? dailyDate(src) : null) : src.date;
    const grid = isRun ? src.nightBest || [] : src.grid || [];
    const shot = isRun ? src.runStats.bestShot : src.shot;
    const total = isRun ? src.runStats.lightTotal : src.score;
    const gid = src.gardien;
    let head = "BOCAL D'ÉTOILES ✦";
    if (daily && date) head += " Ciel du " + date.slice(8, 10) + "/" + date.slice(5, 7);
    else if (isRun && src.eclipse) head += " Éclipse " + src.eclipse;
    const lines = [head];
    grid.forEach((L, i) => {
      const cells = [];
      for (let k = 0; k < (L || []).length; k++) cells.push(L[k] === undefined || L[k] === null ? "▪️" : nightEmoji(L[k]));
      if (cells.length) lines.push("Lune " + (i + 1) + "  " + cells.join(""));
    });
    if (shot) lines.push("🟦" + U.fmt(Math.floor(shot.eclat)) + " × 🟥" + U.fmtMult(shot.mult) + " = " + U.fmt(shot.lumiere));
    const won = isRun ? !!(src.result && src.result.won) : !!src.won;
    lines.push("Total " + U.fmt(total || 0) + " · " + ((D.GARDIEN_BY_ID[gid] || D.GARDIENS[0]).nom) + (won ? " · Victoire ✦" : ""));
    return lines.join("\n").replace(/[  ]/g, " ");
  };
  function copyText(txt) {
    const legacy = () => {
      try {
        const ta = document.createElement("textarea");
        ta.value = txt; ta.setAttribute("readonly", "");
        ta.style.cssText = "position:fixed;left:-9999px;top:0;opacity:0";
        document.body.appendChild(ta); ta.select();
        const ok = document.execCommand && document.execCommand("copy");
        document.body.removeChild(ta);
        return !!ok;
      } catch (e) { return false; }
    };
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        return navigator.clipboard.writeText(txt).then(() => true, () => legacy());
      }
    } catch (e) { /* */ }
    return Promise.resolve(legacy());
  }
  Meta.lastShared = null;
  /** Partage : copie dans le presse-papiers (et feuille de partage native sur mobile). */
  Meta.share = function (src) {
    const txt = typeof src === "string" ? src : Meta.shareText(src);
    Meta.lastShared = txt;
    const toast = (m) => { if (BE.UI && BE.UI.toast) BE.UI.toast(m); };
    const touchDev = BE.Input && BE.Input.pointer && BE.Input.pointer.type === "touch";
    copyText(txt).then((ok) => {
      if (ok) { toast("Copié dans le presse-papiers ✓"); BE.emit("ui:ok", {}); }
      if (touchDev && navigator.share) { try { navigator.share({ text: txt }).catch(() => {}); } catch (e) { /* */ } }
      else if (!ok) toast("Copie impossible sur cet appareil");
    });
    return txt;
  };

  // ================================================================ Grimoire : contenu
  const RELIC_HINTS = {
    R01: "Qui regarde les ombres de près en tire plus d'éclat.", R02: "Les murs ne sont pas des limites, mais des tremplins.",
    R03: "Chaque clou chante ; six notes font un accord.", R04: "La flamme qui évite l'ombre brille davantage.",
    R05: "Chaque ombre éteinte attise le rouge.", R06: "Une fusion en appelle une autre.",
    R07: "L'or qui dort finit par fructifier.", R08: "Il se nourrit des ombres, mais les rend plus coriaces.",
    R09: "Voir un rebond plus loin que les autres.", R10: "Les grandes étoiles frappent plus fort.",
    R11: "Toutes les trois heures, le temps retient son souffle.", R12: "Les petites étoiles dansent mieux entre les clous.",
    R13: "Les soleils se voient de très loin.", R14: "Un bocal léger pèse lourd dans la balance.",
    R15: "La pureté transmute le Mult.", R16: "Chaque couleur du bocal teinte la lumière.",
    R17: "L'orage appelle l'orage.", R18: "Sous la pierre noire court un filon rouge.",
    R19: "Garder le rythme, fusion après fusion.", R20: "L'or bien compté se change en Mult.",
    R21: "La première étoile de la nuit a une jumelle.", R22: "Les tirs gardés ne sont jamais perdus.",
    R23: "Le Sac se laisse plus volontiers convaincre.", R24: "Plus le bocal est plein, plus il pousse.",
    R25: "Chaque réaction en nourrit une autre.", R26: "Le dernier souffle de la nuit est le plus lumineux.",
    R27: "Un verre plus fin, une lumière plus vive… et moins de place.", R28: "Rien que du pur, et la couronne s'allume.",
    R29: "La première fusion se reflète deux fois.", R30: "Plus l'astre est lourd, plus il courbe la lumière.",
  };
  const SHADOW_HINTS = {
    rampante: "Elle descend sans hâte, une rangée à chaque tir.", lourde: "Elle tombe rarement, mais elle tombe lourd.",
    lanterne: "Éteins-la, et la nuit t'accorde un souffle de plus.", blindee: "Les petites étoiles glissent sur sa carapace.",
    voleuse: "Si tu ne l'abats pas d'un coup, elle garde l'étoile.", nuee: "Une ombre qui en cache deux autres.",
    eteignoir: "Là où il passe, les clous se taisent.", mere: "Elle couve des ombres, et garde un trésor.",
  };
  const BOSS_HINTS = {
    faim: "Elle a faim de ce que tu as de plus grand.", voile: "Ce qui vient ensuite reste caché.",
    avare: "Les clous gris se taisent devant elle.", grele: "Le ciel lance ses propres pierres.",
    maree: "Tout pèse plus lourd quand elle monte.", etau: "Les murs du bocal se resserrent.",
    eclipse: "La dernière nuit, la lumière est coupée en deux.",
  };
  const STAR_HINTS = [null, "", "", "Deux étincelles font un astre.", "Deux astres rêvent d'un soleil.",
    "Un soleil qui grandit encore…", "Au-delà de la géante, l'éclat qui déchire.", "Là où la lumière se replie sur elle-même."];
  const STAR_COLORS = [null, "givre", "braise", "foudre", "givre", "braise", "foudre", "braise"];
  const TABS = [
    { id: "etoiles", nom: "Étoiles" }, { id: "reactions", nom: "Réactions" }, { id: "evolutions", nom: "Évol." },
    { id: "reliques", nom: "Reliques" }, { id: "ombres", nom: "Ombres" }, { id: "defis", nom: "Défis" },
  ];
  Meta.TABS = TABS;
  function starKnown(s) { const m = meta(); return s <= 2 || (m.grimoire.stars[s] | 0) > 0 || m.stats.maxSize >= s; }
  /** Entrées du Grimoire pour un onglet : [{key, known, name, sub, txt, hint, count, icon, accent, locked}]. */
  Meta.entries = function (tab) {
    const m = meta(), G = m.grimoire, out = [];
    if (tab === "etoiles") {
      for (const fid of D.FAMILY_ORDER) {
        const F = D.FAMILIES[fid];
        const known = !F.room || Meta.built(F.room) || (G.stars[fid] | 0) > 0;
        out.push({ key: "fam:" + fid, known, name: "Famille " + F.nom, sub: "FAMILLE", accent: F.color,
          txt: "En vol : " + F.flight + ". Au bocal : " + F.jar + ".", count: G.stars[fid] | 0, countLbl: "lancers",
          hint: "Une graine attend sous le verre de la Serre.", icon: { k: "star", color: fid, size: 3 } });
      }
      for (let s = 1; s <= 7; s++) {
        const Z = D.SIZES[s];
        out.push({ key: "size:" + s, known: starKnown(s), name: Z.nom, sub: "TAILLE " + s + " · RAYON " + Z.r, accent: P.text,
          txt: s === 1 ? "La plus petite lueur. Deux Poussières font une Étincelle." : "Fusionner deux étoiles de taille " + (s - 1) + " : +" + Z.mult + " Mult." +
            (Z.rBorn ? " Il s'effondre aussitôt : un disque dense et compact qui coule au fond." : ""),
          count: G.stars[s] | 0, countLbl: s === 1 ? "" : "fusions", hint: STAR_HINTS[s], icon: { k: "star", color: STAR_COLORS[s], size: s } });
      }
      out.push({ key: "size:8", known: (G.stars[8] | 0) > 0, name: "Big Bang", sub: D.BIGBANG.partner < D.MAX_SIZE ? "TROU NOIR + NOVA" : "TROU NOIR + TROU NOIR", accent: P.frag,
        txt: (D.BIGBANG.partner < D.MAX_SIZE ? "Un Trou Noir qui touche une Nova (ou un autre Trou Noir) l'avale et vide" : "Deux Trous Noirs qui fusionnent vident") +
          " le bocal : ×10 Mult final.", count: G.stars[8] | 0, countLbl: "",
        hint: "Quand l'abîme dévore l'éclat qui déchire, le monde recommence.", icon: { k: "bigbang" } });
    } else if (tab === "reactions") {
      for (const id in D.REACTIONS) {
        const R = D.REACTIONS[id];
        out.push({ key: "rea:" + id, known: (G.reactions[id] | 0) > 0, name: R.nom, sub: D.FAMILIES[R.pair[0]].nom.toUpperCase() + " + " + D.FAMILIES[R.pair[1]].nom.toUpperCase(),
          accent: R.color, txt: R.txt, hint: R.hint, count: G.reactions[id] | 0, countLbl: "fois", icon: { k: "reaction", id },
          locked: R.pair.indexOf("seve") >= 0 && !Meta.built("serre") ? "Demande la Sève (La Serre)" : null });
      }
      const A = D.AURORE;
      out.push({ key: "rea:aurore", known: (G.reactions.aurore | 0) > 0, name: A.nom, sub: "SECRET · 3 RÉACTIONS DISTINCTES", accent: P.frag,
        txt: "Trois réactions distinctes dans un même tir : ×2 Mult final et un arc-en-ciel sur le bocal.", count: G.reactions.aurore | 0, countLbl: "fois",
        hint: Meta.built("planetarium") ? A.hint : "Le Planétarium garde ce secret.", icon: { k: "aurore" }, secret: true });
    } else if (tab === "evolutions") {
      const lab = Meta.built("laboratoire");
      for (const E of D.EVOLUTIONS) {
        const base = D.RELIC_BY_ID[E.base], R = D.REACTIONS[E.reaction];
        out.push({ key: "evo:" + E.id, known: G.evolutions.indexOf(E.id) >= 0, name: E.nom, sub: "LÉGENDAIRE · " + base.nom.toUpperCase() + " + " + R.nom.toUpperCase(),
          accent: P.or, txt: E.txt, hint: lab ? E.hint : "Construis le Laboratoire pour lire cette page.", count: 0, icon: { k: "evo", id: E.id }, hideHint: !lab });
      }
    } else if (tab === "reliques") {
      for (const R of D.RELICS) {
        const rar = D.RARITY[R.rar];
        const unl = Meta.isUnlocked(R.src);
        out.push({ key: "rel:" + R.id, known: G.relics.indexOf(R.id) >= 0, name: R.nom, sub: rar.nom.toUpperCase() + " · " + R.tags.join(" "), accent: rar.color,
          txt: R.txt, hint: RELIC_HINTS[R.id] || "…", count: 0, icon: { k: "relic", id: R.id }, locked: unl ? null : Meta.srcLabel(R.src) });
      }
    } else if (tab === "ombres") {
      for (const id in D.SHADOWS) {
        const S = D.SHADOWS[id];
        out.push({ key: "omb:" + id, known: G.ombres.indexOf(id) >= 0, name: S.nom, sub: (S.elite ? "ÉLITE · " : "") + S.hp + " PV · DESCEND TOUS LES " + S.speed + " TIR" + (S.speed > 1 ? "S" : ""),
          accent: P.ombreLine, txt: S.txt + " Pierre de taille " + S.stone + ".", hint: SHADOW_HINTS[id], count: 0, icon: { k: "shadow", id } });
      }
      for (const id in D.BOSSES) {
        const B = D.BOSSES[id];
        out.push({ key: "boss:" + id, known: G.ombres.indexOf("boss:" + id) >= 0, name: B.nom, sub: B.final ? "BOSS FINAL · LUNE 5" : "BOSS" + (B.avail === "cartes" ? " · SALLE DES CARTES" : ""),
          accent: B.color, txt: B.rule, hint: BOSS_HINTS[id], count: 0, icon: { k: "boss", id }, locked: B.avail === "cartes" && !Meta.built("cartes") ? "Salle : La Salle des Cartes" : null });
      }
    } else if (tab === "defis") {
      for (const d of D.DEFIS) {
        const pr = Meta.defiProgress(d.id);
        out.push({ key: "def:" + d.id, known: pr.done, defi: d, pr, name: d.txt, sub: "RÉCOMPENSE : " + d.reward.toUpperCase(), accent: pr.done ? P.or : P.dim,
          icon: { k: "defi", id: d.id, done: pr.done } });
      }
    }
    return out;
  };
  const SEEN_TABS = ["etoiles", "reactions", "evolutions", "reliques", "ombres"];
  function seenSet() { const s = {}; for (const k of meta().grimoire.hintsSeen) s[k] = 1; return s; }
  /** Complétion globale du Grimoire : {n, total, pct}. */
  Meta.completion = function () {
    let n = 0, total = 0;
    for (const t of TABS) for (const e of Meta.entries(t.id)) { total++; if (e.known) n++; }
    return { n, total, pct: total ? n / total : 0 };
  };
  let unseenCache = { t: -9, n: 0, byTab: {} };
  /** Entrées découvertes pas encore vues dans le Grimoire (pastille « nouveau »). */
  Meta.unseen = function () {
    const now = BE.state ? BE.state.time : 0;
    if (now - unseenCache.t < 0.5) return unseenCache;
    const seen = seenSet(), byTab = {};
    let n = 0;
    for (const t of SEEN_TABS) {
      let k = 0;
      for (const e of Meta.entries(t)) if (e.known && !seen[e.key] && !isStartKnown(e.key)) k++;
      byTab[t] = k; n += k;
    }
    unseenCache = { t: now, n, byTab };
    return unseenCache;
  };
  function isStartKnown(key) { return key === "size:1" || key === "size:2" || key === "fam:braise" || key === "fam:givre" || key === "fam:foudre"; }
  function markSeen(keys) {
    const L = meta().grimoire.hintsSeen;
    let ch = false;
    for (const k of keys) if (L.indexOf(k) < 0) { L.push(k); ch = true; }
    if (ch) { touch(); unseenCache.t = -9; Meta.flush(); }
  }

  // ================================================================ primitives de dessin
  const rr = (x, y, w, h, r) => BE.FX.roundRect(g, x, y, w, h, r);
  function font(size, weight, italic) { return (italic ? "italic " : "") + (weight || 800) + " " + size + "px " + D.FONT; }
  function txt(t, x, y, size, color, align, weight, maxW, italic) {
    t = String(t);
    g.font = font(size, weight, italic);
    if (maxW) { let s = size; while (s > 5.5 && g.measureText(t).width > maxW) { s -= 0.5; g.font = font(s, weight, italic); } }
    g.fillStyle = color; g.textAlign = align || "center"; g.textBaseline = "middle";
    g.fillText(t, x, y);
  }
  function lines(t, maxW, size, weight, italic) {
    g.font = font(size, weight, italic);
    const words = String(t).split(" "), out = [];
    let line = "";
    for (const w of words) {
      const test = line ? line + " " + w : w;
      if (g.measureText(test).width > maxW && line) { out.push(line); line = w; } else line = test;
    }
    if (line) out.push(line);
    return out;
  }
  /** Texte sur plusieurs lignes (tronqué avec « … » au-delà de maxLines). Renvoie le y suivant. */
  function wrap(t, x, y, maxW, size, color, lh, align, weight, maxLines, italic) {
    let L = lines(t, maxW, size, weight || 600, italic);
    if (maxLines && L.length > maxLines) {
      L = L.slice(0, maxLines);
      let last = L[maxLines - 1];
      g.font = font(size, weight || 600, italic);
      while (last.length > 1 && g.measureText(last + "…").width > maxW) last = last.slice(0, -1);
      L[maxLines - 1] = last + "…";
    }
    L.forEach((l, i) => txt(l, x, y + i * lh, size, color, align || "center", weight || 600, 0, italic));
    return y + L.length * lh;
  }
  function glowAt(x, y, r, color, a) {
    const pa = g.globalAlpha;
    g.globalCompositeOperation = "lighter"; g.globalAlpha = pa * a;
    g.drawImage(BE.FX.glow(color), x - r, y - r, r * 2, r * 2);
    g.globalCompositeOperation = "source-over"; g.globalAlpha = pa;
  }
  /** Fragment ◇ (cristal facetté). */
  function fragIcon(x, y, r, color) {
    g.save(); g.translate(x, y);
    g.fillStyle = color || P.frag;
    g.beginPath(); g.moveTo(0, -r); g.lineTo(r * 0.82, -r * 0.2); g.lineTo(0, r); g.lineTo(-r * 0.82, -r * 0.2); g.closePath(); g.fill();
    g.fillStyle = "rgba(255,255,255,0.45)";
    g.beginPath(); g.moveTo(0, -r); g.lineTo(r * 0.82, -r * 0.2); g.lineTo(-r * 0.82, -r * 0.2); g.closePath(); g.fill();
    g.fillStyle = "rgba(0,0,0,0.18)";
    g.beginPath(); g.moveTo(0, r); g.lineTo(r * 0.82, -r * 0.2); g.lineTo(0, -r * 0.2); g.closePath(); g.fill();
    g.restore();
  }
  Meta.fragIcon = (gg, x, y, r, c) => { const o = g; g = gg; fragIcon(x, y, r, c); g = o; };
  let fragShown = null;
  /** Pastille « ◇ N » (compteur animé). */
  function fragChip(xr, y, value, dt) {
    if (fragShown === null || Math.abs(fragShown - value) > 500) fragShown = value;
    fragShown = U.approach(fragShown, value, 8, dt || 0.016);
    if (Math.abs(fragShown - value) < 0.5) fragShown = value;
    const s = String(Math.round(fragShown));
    g.font = font(15, 900);
    const w = g.measureText(s).width + 38;
    const x = xr - w;
    g.fillStyle = "rgba(18,24,50,0.92)"; rr(x, y - 14, w, 28, 14); g.fill();
    g.strokeStyle = U.rgba(P.frag, 0.6); g.lineWidth = 1; rr(x, y - 14, w, 28, 14); g.stroke();
    fragIcon(x + 15, y, 7);
    txt(s, x + 26, y + 0.5, 15, P.frag, "left", 900);
    return x;
  }
  function backButton(onTap) {
    BE.UI.button({ id: "back", x: 8, y: 4, w: 48, h: 48, label: "‹", style: "ghost", size: 22, onTap });
  }
  function header(title, color, t) {
    BE.UI.neon(title, 180, 28, 20, color || P.frag, t);
  }
  function starShape(x, y, r, color, a) {
    const pa = g.globalAlpha;
    g.fillStyle = color; g.globalAlpha = pa * (a === undefined ? 1 : a);
    g.beginPath();
    for (let i = 0; i < 8; i++) { const rad = i % 2 ? r * 0.38 : r; const an = -Math.PI / 2 + i * Math.PI / 4; g.lineTo(x + Math.cos(an) * rad, y + Math.sin(an) * rad); }
    g.closePath(); g.fill(); g.globalAlpha = pa;
  }
  function gray(hex, k) {
    const c = U.hexToRgb(hex);
    const l = (c[0] * 0.3 + c[1] * 0.59 + c[2] * 0.11) * (k || 0.45) + 20;
    const v = Math.round(U.clamp(l, 0, 255));
    return "rgb(" + v + "," + (v + 4) + "," + Math.min(255, v + 16) + ")";
  }
  function moonIcon(x, y, r, color) {
    g.fillStyle = color;
    g.beginPath(); g.arc(x, y, r, 0, TAU); g.moveTo(x + r * 1.3, y - r * 0.3); g.arc(x + r * 0.45, y - r * 0.3, r * 0.85, 0, TAU, true); g.fill("evenodd");
  }

  // ---------------------------------------------------------------- icônes de contenu
  function drawItem(it, x, y, s, known) {
    const R = BE.Render, t = BE.state.time;
    if (known === false) { silhouette(it, x, y, s); return; }
    switch (it.k) {
      case "star": R.drawStar(x, y, it.size, it.color, { scale: Math.min(1.2, s * 0.5 / D.SIZES[it.size].r), seed: it.size * 13 + x, lookX: x, lookY: y + 30 }); break;
      case "relic": R.drawRelicIcon(it.id, x, y, s); break;
      case "evo": {
        const E = D.EVOLUTIONS.find((e) => e.id === it.id);
        glowAt(x, y, s, P.or, 0.35 + 0.1 * Math.sin(t * 2));
        R.drawRelicIcon(D.RELIC_BY_ID[E.id] ? E.id : E.base, x, y, s);
        g.strokeStyle = P.or; g.lineWidth = 1.5;
        g.beginPath(); g.arc(x, y, s * 0.66, t * 1.2, t * 1.2 + 4.2); g.stroke();
        starShape(x + s * 0.45, y - s * 0.45, s * 0.2, P.or);
        break;
      }
      case "reaction": {
        const Rr = D.REACTIONS[it.id];
        glowAt(x, y, s * 0.9, Rr.color, 0.3);
        R.drawStar(x - s * 0.2, y + s * 0.05, 2, Rr.pair[0], { scale: s * 0.32 / 19, noFace: true });
        R.drawStar(x + s * 0.2, y + s * 0.05, 2, Rr.pair[1], { scale: s * 0.32 / 19, noFace: true });
        starShape(x, y - s * 0.12, s * 0.22 + Math.sin(t * 4 + x) * 1, Rr.color);
        break;
      }
      case "aurore": {
        const cols = ["#6ee07a", "#5ee7ff", "#c7a6ff", "#ff9ab0"];
        g.lineWidth = 3; g.lineCap = "round";
        cols.forEach((c, i) => { g.strokeStyle = c; g.globalAlpha = 0.85; g.beginPath(); g.arc(x, y + s * 0.25, s * (0.5 - i * 0.1), Math.PI * 1.08, Math.PI * 1.92); g.stroke(); });
        g.globalAlpha = 1; g.lineCap = "butt";
        starShape(x, y + s * 0.08, s * 0.14, "#ffffff");
        break;
      }
      case "bigbang": {
        glowAt(x, y, s, P.frag, 0.5);
        for (let i = 0; i < 3; i++) {
          g.strokeStyle = ["#c7a6ff", "#5ee7ff", "#ffd166"][i]; g.lineWidth = 2;
          g.beginPath(); g.arc(x, y, s * (0.2 + i * 0.12) + Math.sin(t * 3 + i) * 1.5, t * (1 + i * 0.4), t * (1 + i * 0.4) + 4); g.stroke();
        }
        g.fillStyle = "#ffffff"; g.beginPath(); g.arc(x, y, s * 0.1, 0, TAU); g.fill();
        break;
      }
      case "clou": {
        const C = D.CLOUS[it.id];
        glowAt(x, y, s * 0.8, C.color, 0.3);
        g.fillStyle = C.color; g.beginPath(); g.arc(x, y, s * 0.2, 0, TAU); g.fill();
        g.strokeStyle = U.rgba(C.color, 0.6); g.lineWidth = 1.5; g.beginPath(); g.arc(x, y, s * 0.32 + Math.sin(t * 3) * 1.2, 0, TAU); g.stroke();
        if (it.id === "prisme") { ["#ff6b3d", "#5ee7ff", "#6ee07a"].forEach((c, i) => { g.strokeStyle = c; g.beginPath(); g.arc(x, y, s * 0.42, t + i * 2.1, t + i * 2.1 + 1.2); g.stroke(); }); }
        g.fillStyle = "rgba(255,255,255,0.7)"; g.beginPath(); g.arc(x - s * 0.06, y - s * 0.06, s * 0.06, 0, TAU); g.fill();
        break;
      }
      case "grav": {
        R.drawStar(x, y, 2, it.id === "doree" ? "foudre" : it.id === "filante" ? "givre" : "braise", { scale: s * 0.42 / 19, noFace: true });
        g.strokeStyle = it.id === "doree" ? P.or : "#ffffff"; g.lineWidth = 1.6;
        g.beginPath(); g.moveTo(x - s * 0.18, y + s * 0.1); g.lineTo(x, y - s * 0.16); g.lineTo(x + s * 0.18, y + s * 0.1); g.stroke();
        if (it.id === "filante") { g.strokeStyle = U.rgba("#eef2ff", 0.6); for (let i = 0; i < 3; i++) { g.beginPath(); g.moveTo(x - s * 0.45, y - s * 0.1 + i * 5); g.lineTo(x - s * 0.25, y - s * 0.1 + i * 5); g.stroke(); } }
        if (it.id === "prismatique") { ["#ff6b3d", "#5ee7ff", "#6ee07a", "#ffe14d"].forEach((c, i) => { g.strokeStyle = c; g.beginPath(); g.arc(x, y, s * 0.46, i * 1.57 + t, i * 1.57 + t + 1.2); g.stroke(); }); }
        break;
      }
      case "shadow": {
        const d = D.SHADOWS[it.id];
        const sc = s * 0.5 / (d.r || 18);
        g.save(); g.translate(x, y); g.scale(sc, sc);
        R.drawShadow({ type: it.id, dispX: 0, dispY: 0, r: d.r || 18, id: it.id.length * 7 }, { x: 0, y: 30 });
        g.restore();
        break;
      }
      case "boss": {
        const sc = s * 0.5 / 40;
        g.save(); g.translate(x, y); g.scale(sc, sc);
        R.drawShadow({ type: "boss", bossId: it.id, dispX: 0, dispY: 0, r: 40, id: 3 }, { x: 0, y: 60 });
        g.restore();
        break;
      }
      case "gardien": drawPortrait(it.id, x, y + s * 0.15, s / 110, !Meta.hasGardien(it.id), t); break;
      case "defi": {
        const done = it.done;
        glowAt(x, y, s * 0.8, done ? P.or : P.line, done ? 0.35 : 0.1);
        g.fillStyle = done ? "#3a2c10" : "#141a38"; g.strokeStyle = done ? P.or : P.line; g.lineWidth = 2;
        g.beginPath(); g.arc(x, y, s * 0.42, 0, TAU); g.fill(); g.stroke();
        if (done) {
          moonIcon(x - 1, y - 1, s * 0.2, P.or);
        } else {
          txt(it.id.slice(1), x, y + 1, s * 0.3, P.dim, "center", 900);
        }
        break;
      }
      case "moon": glowAt(x, y, s * 0.8, P.frag, 0.3); moonIcon(x, y, s * 0.3, P.frag); break;
      default: txt("?", x, y, s * 0.5, P.dim, "center", 900);
    }
  }
  function silhouette(it, x, y, s) {
    const t = BE.state.time;
    const shimmer = 0.5 + 0.5 * Math.sin(t * 1.6 + x * 0.05 + y * 0.03);
    g.fillStyle = "#161c3c"; g.strokeStyle = U.rgba(P.dim, 0.35 + 0.15 * shimmer); g.lineWidth = 1.5;
    if (it.k === "shadow" || it.k === "boss") {
      const r = s * 0.42;
      g.beginPath();
      for (let i = 0; i < 10; i++) { const a = i / 10 * TAU; const rrr = r * (1 + 0.06 * Math.sin(a * 3 + t)); g.lineTo(x + Math.cos(a) * rrr, y + Math.sin(a) * rrr); }
      g.closePath(); g.fill(); g.stroke();
    } else if (it.k === "reaction") {
      g.beginPath(); g.arc(x - s * 0.18, y + 2, s * 0.24, 0, TAU); g.fill(); g.stroke();
      g.beginPath(); g.arc(x + s * 0.18, y + 2, s * 0.24, 0, TAU); g.fill(); g.stroke();
    } else if (it.k === "star" || it.k === "bigbang") {
      const r = it.size ? Math.min(s * 0.5, D.SIZES[it.size].r * s * 0.5 / 40 + 8) : s * 0.4;
      g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill(); g.stroke();
    } else {
      g.setLineDash([3, 3]);
      g.beginPath(); g.arc(x, y, s * 0.46, 0, TAU); g.fill(); g.stroke();
      g.setLineDash([]);
    }
    txt("?", x, y + 1, s * 0.36, U.rgba(P.dim, 0.5 + 0.3 * shimmer), "center", 900);
  }
  Meta.drawItem = (gg, it, x, y, s, known) => { const o = g; g = gg; drawItem(it, x, y, s, known); g = o; };

  // ================================================================ portraits des Gardiens (vectoriels)
  function drawPortrait(gid, x, y, s, locked, t) {
    const gd = D.GARDIEN_BY_ID[gid] || D.GARDIENS[0];
    const col = locked ? "#262e58" : gd.color;
    const body = locked ? "#12173a" : "#1c2350";
    const face = locked ? "#151b3e" : "#2a3170";
    const line = locked ? "#2b3560" : U.rgba(col, 0.8);
    const bob = locked ? 0 : Math.sin(t * 1.6 + gid.length) * 1.2;
    g.save(); g.translate(x, y + bob); g.scale(s, s);
    g.lineJoin = "round"; g.lineCap = "round";
    // accessoires arrière
    if (gid === "forgeronne") {
      g.strokeStyle = locked ? body : "#7a5238"; g.lineWidth = 5;
      g.beginPath(); g.moveTo(-6, 26); g.lineTo(-36, -36); g.stroke();
      g.save(); g.translate(-36, -36); g.rotate(-0.45);
      g.fillStyle = locked ? body : "#8a93b8"; g.strokeStyle = line; g.lineWidth = 1.5;
      rr(-13, -8, 26, 14, 3); g.fill(); g.stroke();
      g.restore();
    }
    // cape / corps
    g.fillStyle = body; g.strokeStyle = line; g.lineWidth = 2;
    g.beginPath(); g.moveTo(-36, 52); g.quadraticCurveTo(-32, -2, 0, -8); g.quadraticCurveTo(32, -2, 36, 52); g.closePath(); g.fill(); g.stroke();
    if (!locked) {
      g.strokeStyle = U.rgba(col, 0.35); g.lineWidth = 1.2;
      g.beginPath(); g.moveTo(-10, -4); g.quadraticCurveTo(-14, 24, -18, 50); g.moveTo(10, -4); g.quadraticCurveTo(14, 24, 18, 50); g.stroke();
      // fermoir
      starShape(0, 2, 4, col);
    }
    if (gid === "forgeronne") {
      g.fillStyle = locked ? body : "#4a3024"; g.strokeStyle = line; g.lineWidth = 1.2;
      g.beginPath(); g.moveTo(-15, 10); g.lineTo(15, 10); g.lineTo(18, 50); g.lineTo(-18, 50); g.closePath(); g.fill(); g.stroke();
    }
    // capuche de la Veilleuse (derrière la tête)
    if (gid === "veilleuse") {
      g.fillStyle = body; g.strokeStyle = line; g.lineWidth = 2;
      g.beginPath(); g.moveTo(-23, -14); g.bezierCurveTo(-28, -44, -10, -60, 6, -68); g.bezierCurveTo(2, -58, 26, -48, 23, -14); g.quadraticCurveTo(0, 0, -23, -14); g.closePath(); g.fill(); g.stroke();
    }
    // tête
    g.fillStyle = face; g.strokeStyle = line; g.lineWidth = 2;
    g.beginPath(); g.arc(0, -26, gid === "veilleuse" ? 15.5 : 18, 0, TAU); g.fill(); if (gid !== "veilleuse") g.stroke();
    // coiffes
    if (gid === "astronome") {
      g.fillStyle = locked ? body : "#1b2a5e"; g.strokeStyle = line; g.lineWidth = 2;
      g.beginPath(); g.moveTo(-19, -40); g.quadraticCurveTo(-6, -70, 16, -86); g.quadraticCurveTo(6, -66, 19, -40); g.closePath(); g.fill(); g.stroke();
      g.beginPath(); g.ellipse(0, -39, 31, 6.5, 0, 0, TAU); g.fill(); g.stroke();
      if (!locked) { starShape(-3, -56, 4, P.or); starShape(7, -70, 3, P.or); moonIcon(-8, -45, 2.6, P.or); }
    } else if (gid === "forgeronne") {
      if (!locked) {
        g.fillStyle = "#7a2e1c";
        g.beginPath(); g.moveTo(-14, -38); g.lineTo(-9, -50); g.lineTo(-4, -40); g.lineTo(1, -52); g.lineTo(5, -40); g.lineTo(11, -49); g.lineTo(14, -37); g.closePath(); g.fill();
      }
      g.fillStyle = locked ? body : col; g.strokeStyle = line; g.lineWidth = 1.5;
      g.beginPath(); g.moveTo(-18, -36); g.quadraticCurveTo(0, -42, 18, -36); g.lineTo(18, -30); g.quadraticCurveTo(0, -36, -18, -30); g.closePath(); g.fill(); g.stroke();
      g.beginPath(); g.moveTo(17, -34); g.lineTo(28, -40 + Math.sin(t * 3) * 1.5); g.lineTo(26, -30); g.closePath(); g.fill();
      g.beginPath(); g.moveTo(17, -32); g.lineTo(27, -24 + Math.sin(t * 3 + 1) * 1.5); g.lineTo(22, -28); g.closePath(); g.fill();
    } else if (gid === "glaneuse") {
      g.fillStyle = locked ? body : "#d8b25a"; g.strokeStyle = locked ? line : "#a8823a"; g.lineWidth = 1.5;
      g.beginPath(); g.ellipse(0, -44, 15, 11, 0, Math.PI, 0); g.fill(); g.stroke();
      g.beginPath(); g.ellipse(0, -40, 38, 8, 0, 0, TAU); g.fill(); g.stroke();
      if (!locked) {
        g.fillStyle = P.seve; g.fillRect(-15, -47, 30, 4);
        g.strokeStyle = "rgba(90,60,20,0.5)"; g.lineWidth = 0.8;
        for (let i = -3; i <= 3; i++) { g.beginPath(); g.moveTo(i * 10, -36); g.lineTo(i * 8, -43); g.stroke(); }
      }
    } else if (gid === "insomniaque") {
      const sway = locked ? 0 : Math.sin(t * 1.3) * 3;
      g.fillStyle = locked ? body : "#3a2c6e"; g.strokeStyle = line; g.lineWidth = 2;
      g.beginPath(); g.moveTo(-19, -34); g.bezierCurveTo(-14, -66, 18, -74, 34 + sway, -48); g.bezierCurveTo(22, -58, 10, -50, 19, -34); g.quadraticCurveTo(0, -42, -19, -34); g.closePath(); g.fill(); g.stroke();
      if (!locked) {
        g.strokeStyle = U.rgba(col, 0.6); g.lineWidth = 2;
        g.beginPath(); g.moveTo(-8, -44); g.quadraticCurveTo(0, -56, 12, -58); g.stroke();
        g.fillStyle = "#eef2ff"; g.beginPath(); g.arc(35 + sway, -47, 5, 0, TAU); g.fill();
      }
      g.fillStyle = locked ? body : "#eef2ff"; g.fillRect(-19, -37, 38, 5);
      if (!locked) { g.globalAlpha = 0.9; moonIcon(-40, -54 + Math.sin(t) * 2, 7, P.or); g.globalAlpha = 1; }
    }
    // visage
    if (locked) txt("?", 0, -25, 18, "#3a4570", "center", 900);
    else {
      const ey = gid === "glaneuse" ? -25 : -26;
      const blink = ((t + gid.length * 0.7) % 4.2) < 0.13;
      g.fillStyle = "#eef2ff";
      if (gid === "insomniaque") {
        for (const ex of [-6, 6]) {
          g.beginPath(); g.ellipse(ex, ey, 3, 2.6, 0, 0, Math.PI); g.fill();
          g.strokeStyle = "#7a64c0"; g.lineWidth = 1.2; g.beginPath(); g.arc(ex, ey + 4.5, 3, 0.2, Math.PI - 0.2); g.stroke();
          g.strokeStyle = "#eef2ff"; g.lineWidth = 1; g.beginPath(); g.moveTo(ex - 3.4, ey); g.lineTo(ex + 3.4, ey); g.stroke();
        }
      } else if (blink) { g.fillRect(-9, ey, 6, 1.5); g.fillRect(3, ey, 6, 1.5); }
      else { g.beginPath(); g.arc(-6, ey, 2.5, 0, TAU); g.arc(6, ey, 2.5, 0, TAU); g.fill(); }
      if (gid === "astronome") {
        g.strokeStyle = P.or; g.lineWidth = 1.2;
        g.beginPath(); g.arc(-6, ey, 5, 0, TAU); g.stroke(); g.beginPath(); g.arc(6, ey, 5, 0, TAU); g.stroke();
        g.beginPath(); g.moveTo(-1, ey); g.lineTo(1, ey); g.stroke();
      }
      if (gid !== "insomniaque") { g.strokeStyle = U.rgba("#eef2ff", 0.6); g.lineWidth = 1.2; g.beginPath(); g.arc(0, ey + 6, 3, 0.3, Math.PI - 0.3); g.stroke(); }
    }
    // accessoires avant
    if (gid === "veilleuse") {
      const sw = locked ? 0 : Math.sin(t * 2) * 0.12;
      g.strokeStyle = line; g.lineWidth = 1.8;
      g.beginPath(); g.moveTo(18, 12); g.lineTo(30, -2); g.stroke();
      g.save(); g.translate(30, -2); g.rotate(sw);
      g.beginPath(); g.moveTo(0, 0); g.lineTo(0, 8); g.stroke();
      if (!locked) glowAt(0, 20, 26, "#ffe14d", 0.45 + 0.1 * Math.sin(t * 5));
      g.fillStyle = locked ? body : "rgba(255,225,77,0.18)"; g.strokeStyle = locked ? line : P.or; g.lineWidth = 1.5;
      g.beginPath(); g.moveTo(-6, 10); g.lineTo(6, 10); g.lineTo(8, 28); g.lineTo(-8, 28); g.closePath(); g.fill(); g.stroke();
      g.beginPath(); g.moveTo(-7, 10); g.lineTo(0, 5); g.lineTo(7, 10); g.stroke();
      if (!locked) BE.Render.drawStar(0, 19, 2, "foudre", { scale: 0.34, noFace: true });
      g.restore();
    } else if (gid === "astronome") {
      g.save(); g.translate(20, 20); g.rotate(-0.75);
      const segs = [[0, 5, "#b58a3a"], [16, 4.2, "#ffd166"], [28, 3.4, "#b58a3a"]];
      for (const [ox, h, c] of segs) { g.fillStyle = locked ? body : c; g.strokeStyle = line; g.lineWidth = 1; g.fillRect(ox, -h, 14, h * 2); g.strokeRect(ox, -h, 14, h * 2); }
      if (!locked) { g.fillStyle = "#bfe8ff"; g.beginPath(); g.arc(42, 0, 3, 0, TAU); g.fill(); }
      g.restore();
    } else if (gid === "forgeronne") {
      if (!locked) {
        glowAt(28, 30, 18, P.braise, 0.4 + 0.15 * Math.sin(t * 7));
        BE.Render.drawStar(28, 30, 2, "braise", { scale: 0.42, noFace: true });
      }
    } else if (gid === "glaneuse") {
      if (!locked) {
        BE.Render.drawStar(22, 22, 1, "seve", { scale: 0.55, noFace: true });
        BE.Render.drawStar(34, 20, 1, "givre", { scale: 0.5, noFace: true });
      }
      g.fillStyle = locked ? body : "#a8823a"; g.strokeStyle = locked ? line : "#6a4a22"; g.lineWidth = 1.5;
      g.beginPath(); g.moveTo(14, 24); g.lineTo(42, 24); g.quadraticCurveTo(40, 42, 28, 42); g.quadraticCurveTo(16, 42, 14, 24); g.closePath(); g.fill(); g.stroke();
      if (!locked) { g.strokeStyle = "rgba(60,40,10,0.5)"; g.lineWidth = 0.8; for (let i = 0; i < 3; i++) { g.beginPath(); g.moveTo(16 + i, 29 + i * 4); g.lineTo(40 - i, 29 + i * 4); g.stroke(); } }
      g.strokeStyle = locked ? line : "#6a4a22"; g.lineWidth = 1.5; g.beginPath(); g.arc(28, 24, 11, Math.PI, 0); g.stroke();
    } else if (gid === "insomniaque") {
      g.fillStyle = locked ? body : "#eef2ff"; g.strokeStyle = line; g.lineWidth = 1.5;
      rr(18, 18, 14, 16, 3); g.fill(); g.stroke();
      g.beginPath(); g.arc(33, 26, 4.5, -1.3, 1.3); g.stroke();
      if (!locked) {
        g.strokeStyle = "rgba(238,242,255,0.5)"; g.lineWidth = 1.2;
        for (let i = 0; i < 2; i++) { const k = (t * 0.6 + i * 0.5) % 1; g.globalAlpha = 1 - k; g.beginPath(); g.moveTo(22 + i * 5, 16 - k * 12); g.quadraticCurveTo(25 + i * 5 + Math.sin(t * 3 + i) * 3, 12 - k * 12, 22 + i * 5, 8 - k * 12); g.stroke(); }
        g.globalAlpha = 1;
      }
    }
    g.restore();
    g.lineCap = "butt"; g.lineJoin = "miter";
  }
  Meta.drawPortrait = (gg, gid, x, y, s, locked) => { const o = g; g = gg; drawPortrait(gid, x, y, s, locked, BE.state.time); g = o; };

  // ================================================================ défilement (listes) et glisser
  const SCR = { y: 0, vy: 0, max: 0, drag: null, byTab: {}, view: null };
  const SEL = { idx: 0, pos: 0, dragX: 0, drag: null, ecl: {}, confirm: false, init: false };
  function scrollActive() { const sc = BE.state.scene; return !!Meta.overlay || sc === "GRIMOIRE" || sc === "DEFIS"; }
  function modal() { return BE.UI && BE.UI.modalOpen && BE.UI.modalOpen(); }
  BE.on("pdown", (e) => {
    const sc = BE.state.scene;
    if (scrollActive() && SCR.view && e.y >= SCR.view.y0 && e.y <= SCR.view.y1) {
      SCR.drag = { y0: e.y, s0: SCR.y, last: e.y, lt: performance.now(), v: 0 };
      SCR.vy = 0;
    } else if (sc === "SELECT" && !modal() && !BE.state.paused && e.y > 70 && e.y < 420) {
      SEL.drag = { x0: e.x, moved: false };
    }
  });
  BE.on("pmove", (e) => {
    if (SCR.drag) {
      const now = performance.now(), dt = Math.max(1, now - SCR.drag.lt) / 1000;
      const dy = e.y - SCR.drag.last;
      SCR.drag.v = U.lerp(SCR.drag.v, -dy / dt, 0.5);
      SCR.drag.last = e.y; SCR.drag.lt = now;
      let y = SCR.drag.s0 - (e.y - SCR.drag.y0);
      if (y < 0) y *= 0.4; else if (y > SCR.max) y = SCR.max + (y - SCR.max) * 0.4;
      SCR.y = y;
    }
    if (SEL.drag) { SEL.dragX = e.x - SEL.drag.x0; if (Math.abs(SEL.dragX) > 12) SEL.drag.moved = true; }
  });
  function endDrags(e) {
    if (SCR.drag) {
      if (performance.now() - SCR.drag.lt < 90) SCR.vy = U.clamp(SCR.drag.v, -2600, 2600);
      SCR.drag = null;
    }
    if (SEL.drag) {
      const dx = SEL.dragX;
      const n = D.GARDIENS.length;
      if (e && Math.abs(dx) > 44) { SEL.idx = (SEL.idx + (dx < 0 ? 1 : -1) + n) % n; SEL.pos -= dx / 272; SEL.confirm = false; BE.emit("ui:tap", {}); }
      else SEL.pos -= dx / 272;
      SEL.dragX = 0;
      SEL.drag = null;
    }
  }
  BE.on("pup", endDrags);
  BE.on("pcancel", () => endDrags(null));
  function updateScroll(dt) {
    if (SCR.drag) return;
    SCR.y += SCR.vy * dt;
    SCR.vy *= Math.exp(-4.5 * dt);
    if (Math.abs(SCR.vy) < 5) SCR.vy = 0;
    if (SCR.y < 0) { SCR.y = U.approach(SCR.y, 0, 14, dt); SCR.vy *= 0.5; if (SCR.y > -0.5) SCR.y = 0; }
    if (SCR.y > SCR.max) { SCR.y = U.approach(SCR.y, SCR.max, 14, dt); SCR.vy *= 0.5; if (SCR.y < SCR.max + 0.5) SCR.y = SCR.max; }
  }
  try {
    window.addEventListener("wheel", (e) => {
      if (!scrollActive() || !SCR.view) return;
      const k = (BE.view && BE.view.scale) || 1;
      SCR.y = U.clamp(SCR.y + e.deltaY / k * (e.deltaMode === 1 ? 16 : 1), 0, SCR.max);
      SCR.vy = 0;
    }, { passive: true });
    document.addEventListener("visibilitychange", () => { if (document.hidden) Meta.flush(); });
    window.addEventListener("pagehide", () => Meta.flush());
  } catch (e) { /* hors navigateur */ }

  // ================================================================ écran : Observatoire (§10.8)
  const OBS = { sel: null, confirm: false, anim: null, focus: -1 };
  const TOWER = [["planetarium", "cartes"], ["bibliotheque", "laboratoire"], ["atelier", "forge"], ["serre", "crypte"]];
  const TW = 150, TH = 110, TX = [24, 186], TY = [122, 238, 354, 470];
  function tilePos(id) {
    for (let r = 0; r < 4; r++) for (let c = 0; c < 2; c++) if (TOWER[r][c] === id) return { x: TX[c], y: TY[r], r, c };
    return null;
  }
  const ROOM_ORDER = TOWER[0].concat(TOWER[1], TOWER[2], TOWER[3]);

  /** Scènes animées des salles (coordonnées locales 150 × 88). c(hex, a) donne la couleur (grisée si éteinte). */
  const SCENES = {
    serre(t, c, lit) {
      g.strokeStyle = c("#9fb3d9", 0.35); g.lineWidth = 1.2;
      g.beginPath(); g.moveTo(4, 34); g.quadraticCurveTo(75, -8, 146, 34); g.stroke();
      for (let i = 1; i < 6; i++) { const x = i * 25; const top = 34 - Math.sin(i / 6 * Math.PI) * 21; g.beginPath(); g.moveTo(x, top); g.lineTo(x, 76); g.stroke(); }
      g.fillStyle = c("#2a2438"); g.fillRect(0, 76, 150, 12);
      const pots = [30, 75, 120];
      pots.forEach((px, i) => {
        const sway = lit ? Math.sin(t * 1.4 + i * 1.7) * 4 : 0;
        g.strokeStyle = c("#3f9a4e"); g.lineWidth = 2;
        g.beginPath(); g.moveTo(px, 66); g.quadraticCurveTo(px + sway * 0.5, 50, px + sway, 36 + i % 2 * 6); g.stroke();
        g.fillStyle = c("#6ee07a");
        for (let k = 0; k < 3; k++) {
          const ly = 58 - k * 9 + i % 2 * 3, lx = px + sway * (0.3 + k * 0.2);
          g.beginPath(); g.ellipse(lx + (k % 2 ? 6 : -6), ly, 6, 2.6, k % 2 ? 0.5 : -0.5, 0, TAU); g.fill();
        }
        g.fillStyle = c("#8a5a3a");
        g.beginPath(); g.moveTo(px - 10, 64); g.lineTo(px + 10, 64); g.lineTo(px + 7, 77); g.lineTo(px - 7, 77); g.closePath(); g.fill();
        g.fillStyle = c("#a8704a"); g.fillRect(px - 11, 62, 22, 3);
      });
      if (lit) {
        BE.Render.drawStar(75 + Math.sin(t * 1.4 + 1.7) * 4, 30, 1, "seve", { scale: 0.75, seed: 7, lookX: 75, lookY: 90 });
        for (let i = 0; i < 7; i++) {
          const k = (t * 0.18 + i / 7) % 1;
          g.fillStyle = "rgba(216,255,106," + (0.8 * (1 - k)).toFixed(2) + ")";
          g.beginPath(); g.arc(15 + i * 20 + Math.sin(t + i) * 5, 72 - k * 60, 1.3, 0, TAU); g.fill();
        }
      }
    },
    atelier(t, c, lit) {
      g.fillStyle = c("#1d2244"); g.fillRect(8, 8, 134, 34);
      for (let r = 0; r < 3; r++) for (let k = 0; k < 9; k++) {
        const x = 16 + k * 15, y = 15 + r * 10;
        const sp = r === 1 && (k === 2 || k === 6);
        g.fillStyle = sp ? c(k === 2 ? "#ffffff" : "#c7a6ff") : c("#6a7496");
        g.beginPath(); g.arc(x, y, sp ? 2.6 : 1.6, 0, TAU); g.fill();
        if (sp && lit) {
          const pk = (t * 1.2 + k * 0.3) % 1;
          g.strokeStyle = k === 2 ? "rgba(255,255,255," + (1 - pk).toFixed(2) + ")" : "rgba(199,166,255," + (1 - pk).toFixed(2) + ")";
          g.lineWidth = 1; g.beginPath(); g.arc(x, y, 3 + pk * 7, 0, TAU); g.stroke();
        }
      }
      g.fillStyle = c("#6a4a32"); g.fillRect(8, 64, 134, 7);
      g.fillRect(16, 71, 5, 17); g.fillRect(129, 71, 5, 17);
      // marteau
      const ph = lit ? (t * 1.6) % 1 : 0.3;
      const a = ph < 0.7 ? -1.1 + ph / 0.7 * 1.1 : -(ph - 0.7) / 0.3 * 1.1;
      g.save(); g.translate(112, 48); g.rotate(a);
      g.strokeStyle = c("#8a6a4a"); g.lineWidth = 3; g.beginPath(); g.moveTo(0, 0); g.lineTo(-26, 8); g.stroke();
      g.fillStyle = c("#a9b1cf"); rr(-34, 1, 11, 15, 2); g.fill();
      g.restore();
      g.fillStyle = c("#c9d2ea"); g.beginPath(); g.arc(80, 61, 3, 0, TAU); g.fill();
      if (lit && ph > 0.66 && ph < 0.86) {
        const k = (ph - 0.66) / 0.2;
        g.strokeStyle = "rgba(255,225,77," + (1 - k).toFixed(2) + ")"; g.lineWidth = 1.3;
        for (let i = 0; i < 6; i++) { const an = -Math.PI * (0.15 + i * 0.14); g.beginPath(); g.moveTo(80 + Math.cos(an) * (4 + k * 4), 60 + Math.sin(an) * (4 + k * 4)); g.lineTo(80 + Math.cos(an) * (8 + k * 12), 60 + Math.sin(an) * (8 + k * 12)); g.stroke(); }
      }
    },
    bibliotheque(t, c, lit) {
      const cols = ["#ff6b3d", "#5ee7ff", "#ffd166", "#6ee07a", "#c7a6ff", "#ff4d5e", "#4fb3ff"];
      for (const sy of [34, 70]) {
        g.fillStyle = c("#5a4030"); g.fillRect(6, sy, 138, 4);
        let x = 10, i = sy;
        while (x < 138) {
          const w = 5 + (i * 7) % 5, h = 16 + (i * 13) % 10;
          if (!(sy === 70 && x > 55 && x < 95)) { g.fillStyle = c(cols[i % cols.length], 0.85); g.fillRect(x, sy - h, w, h); g.fillStyle = c("#000000", 0.2); g.fillRect(x, sy - h + 3, w, 1.5); }
          x += w + 1; i += 3;
        }
      }
      // livre flottant
      const by = 50 + (lit ? Math.sin(t * 1.5) * 3 : 0);
      if (lit) glowAt(75, by, 30, P.or, 0.35);
      g.fillStyle = c("#eef2ff");
      g.beginPath(); g.moveTo(75, by); g.lineTo(58, by - 6); g.lineTo(58, by + 8); g.lineTo(75, by + 12); g.closePath(); g.fill();
      g.beginPath(); g.moveTo(75, by); g.lineTo(92, by - 6); g.lineTo(92, by + 8); g.lineTo(75, by + 12); g.closePath(); g.fill();
      if (lit) {
        const fw = Math.cos(t * 2.4) * 17;
        g.fillStyle = "rgba(220,228,255,0.9)";
        g.beginPath(); g.moveTo(75, by); g.lineTo(75 + fw, by - 7 - Math.abs(fw) * 0.1); g.lineTo(75 + fw, by + 7); g.lineTo(75, by + 12); g.closePath(); g.fill();
        g.strokeStyle = "rgba(90,100,140,0.5)"; g.lineWidth = 0.7;
        for (let k = 0; k < 3; k++) { g.beginPath(); g.moveTo(61, by - 1 + k * 3); g.lineTo(72, by + 2 + k * 3); g.stroke(); }
      }
      // bougie
      g.fillStyle = c("#eee0c0"); g.fillRect(126, 58, 6, 12);
      if (lit) {
        const fl = 1 + Math.sin(t * 13) * 0.12 + Math.sin(t * 7.3) * 0.08;
        glowAt(129, 52, 14, "#ffb347", 0.5);
        g.fillStyle = "#ffd166"; g.beginPath(); g.moveTo(129, 56 - 8 * fl); g.quadraticCurveTo(133, 54, 129, 58); g.quadraticCurveTo(125, 54, 129, 56 - 8 * fl); g.fill();
      }
    },
    laboratoire(t, c, lit) {
      g.fillStyle = c("#3a3050"); g.fillRect(4, 74, 142, 5);
      if (lit) glowAt(42, 56, 32, "#5ee7ff", 0.35 + 0.1 * Math.sin(t * 2));
      g.fillStyle = c("#9fb3d9", 0.25); g.strokeStyle = c("#cfe0ff", 0.8); g.lineWidth = 1.5;
      g.beginPath(); g.arc(42, 58, 15, 0, TAU); g.fill(); g.stroke();
      g.fillStyle = c("#5ee7ff", 0.85);
      g.beginPath(); g.arc(42, 58, 13.5, 0.15, Math.PI - 0.15); g.closePath(); g.fill();
      g.strokeStyle = c("#cfe0ff", 0.8); g.lineWidth = 1.5;
      g.beginPath(); g.moveTo(39, 44); g.lineTo(39, 28); g.moveTo(45, 44); g.lineTo(45, 28); g.stroke();
      g.beginPath(); g.moveTo(42, 28); g.quadraticCurveTo(60, 8, 92, 26); g.lineTo(104, 44); g.stroke();
      g.fillStyle = c("#9fb3d9", 0.2); g.beginPath(); g.moveTo(96, 50); g.lineTo(120, 50); g.lineTo(118, 74); g.lineTo(98, 74); g.closePath(); g.fill(); g.stroke();
      g.fillStyle = c("#6ee07a", 0.8); g.fillRect(99, 64, 18, 9);
      g.fillStyle = c("#ff6b3d"); g.fillRect(34, 74, 16, 3);
      if (lit) {
        for (let i = 0; i < 7; i++) {
          const k = (t * 0.7 + i / 7) % 1;
          const bx = 42 + Math.sin(k * 9 + i) * (k < 0.4 ? 7 : 2), by = 66 - k * 44;
          g.strokeStyle = "rgba(200,245,255," + (1 - k).toFixed(2) + ")"; g.lineWidth = 1;
          g.beginPath(); g.arc(bx, by, 1.2 + k * 2, 0, TAU); g.stroke();
        }
        const dk = (t * 1.1) % 1;
        g.fillStyle = "rgba(110,224,122," + (1 - dk).toFixed(2) + ")"; g.beginPath(); g.arc(108, 46 + dk * 16, 1.6, 0, TAU); g.fill();
        const fl = Math.sin(t * 15) * 1.5;
        g.fillStyle = "#ff9d3d"; g.beginPath(); g.moveTo(37, 74); g.quadraticCurveTo(42, 64 + fl, 47, 74); g.fill();
      }
    },
    forge(t, c, lit) {
      g.fillStyle = c("#2b2230"); g.fillRect(8, 60, 58, 20);
      g.fillStyle = c("#3a2a2a"); rr(12, 54, 50, 8, 3); g.fill();
      if (lit) {
        glowAt(37, 50, 36, P.braise, 0.5 + 0.12 * Math.sin(t * 9));
        for (let i = 0; i < 5; i++) {
          const h = 14 + Math.sin(t * (7 + i) + i * 2) * 5 + (i === 2 ? 6 : 0), x = 18 + i * 9.5;
          g.fillStyle = "#ff6b3d"; g.beginPath(); g.moveTo(x - 5, 55); g.quadraticCurveTo(x, 55 - h * 1.2, x + 5, 55); g.fill();
          g.fillStyle = "#ffd166"; g.beginPath(); g.moveTo(x - 2.5, 55); g.quadraticCurveTo(x, 55 - h * 0.6, x + 2.5, 55); g.fill();
        }
        for (let i = 0; i < 8; i++) {
          const k = (t * 0.5 + i / 8) % 1;
          g.fillStyle = "rgba(255,157,61," + (1 - k).toFixed(2) + ")";
          g.fillRect(24 + i * 4 + Math.sin(t * 2 + i) * 6, 48 - k * 44, 1.8, 1.8);
        }
      }
      g.fillStyle = c("#4a5068");
      g.beginPath(); g.moveTo(84, 50); g.lineTo(134, 50); g.lineTo(128, 58); g.lineTo(118, 58); g.lineTo(120, 70); g.lineTo(98, 70); g.lineTo(100, 58); g.lineTo(90, 58); g.closePath(); g.fill();
      g.fillRect(94, 70, 30, 8);
      const pul = lit ? 0.5 + 0.5 * Math.sin(t * 3) : 0;
      if (lit) glowAt(110, 44, 16, P.mult, 0.3 + 0.3 * pul);
      g.fillStyle = c("#ff4d5e"); g.beginPath(); g.moveTo(110, 36); g.lineTo(116, 44); g.lineTo(110, 50); g.lineTo(104, 44); g.closePath(); g.fill();
      g.fillStyle = "rgba(255,255,255,0.4)"; g.beginPath(); g.moveTo(110, 36); g.lineTo(116, 44); g.lineTo(110, 44); g.closePath(); g.fill();
    },
    cartes(t, c, lit) {
      const rot = lit ? t * 0.12 : 0;
      g.fillStyle = c("#16204a"); g.strokeStyle = c("#ffd166", 0.6); g.lineWidth = 1.5;
      g.beginPath(); g.arc(50, 42, 31, 0, TAU); g.fill(); g.stroke();
      g.save(); g.translate(50, 42); g.rotate(rot);
      const pts = [[-18, -8], [-6, -18], [8, -12], [16, 2], [4, 14], [-12, 10]];
      g.strokeStyle = c("#9fb3d9", 0.6); g.lineWidth = 0.8;
      g.beginPath(); pts.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]))); g.stroke();
      pts.forEach((p, i) => starShape(p[0], p[1], 2.4 + (i % 2), c("#eef2ff"), lit ? 0.6 + 0.4 * Math.sin(t * 3 + i) : 0.8));
      g.strokeStyle = c("#ffd166", 0.25); g.beginPath(); g.arc(0, 0, 22, 0, TAU); g.stroke();
      g.restore();
      // astrolabe
      g.strokeStyle = c("#ffd166", 0.9); g.lineWidth = 1.5;
      g.beginPath(); g.arc(112, 34, 14, 0, TAU); g.stroke();
      g.beginPath(); g.ellipse(112, 34, 14, 5, lit ? t * 0.8 : 0.4, 0, TAU); g.stroke();
      const na = lit ? Math.sin(t * 0.9) * 1.2 + t * 0.3 : 0.6;
      g.strokeStyle = c("#ff4d5e"); g.lineWidth = 2; g.beginPath(); g.moveTo(112, 34); g.lineTo(112 + Math.cos(na) * 11, 34 + Math.sin(na) * 11); g.stroke();
      // table et cartes
      g.fillStyle = c("#5a4030"); g.fillRect(84, 64, 60, 5);
      g.fillStyle = c("#e8dcc0"); g.fillRect(90, 58, 22, 7); g.fillRect(114, 56, 22, 9);
      g.strokeStyle = c("#5ee7ff"); g.lineWidth = 1.3;
      g.beginPath(); for (let i = 0; i < 18; i++) g.lineTo(116 + i, 60 + Math.sin(i * 0.8 + (lit ? t * 3 : 0)) * 1.5); g.stroke();
    },
    crypte(t, c, lit) {
      g.strokeStyle = c("#4a5068"); g.lineWidth = 3;
      for (const ax of [25, 75, 125]) { g.beginPath(); g.arc(ax, 36, 22, Math.PI, 0); g.stroke(); g.beginPath(); g.moveTo(ax - 22, 36); g.lineTo(ax - 22, 80); g.moveTo(ax + 22, 36); g.lineTo(ax + 22, 80); g.stroke(); }
      g.fillStyle = c("#262a38"); g.fillRect(0, 78, 150, 10);
      g.fillStyle = c("#3a4058"); g.fillRect(62, 60, 26, 18); g.fillRect(58, 58, 34, 4);
      const fy = 42 + (lit ? Math.sin(t * 1.6) * 3 : 0);
      if (lit) glowAt(75, fy, 30, "#b59cff", 0.5 + 0.12 * Math.sin(t * 2.3));
      g.save(); g.translate(75, fy); g.rotate(lit ? Math.sin(t) * 0.25 : 0);
      g.fillStyle = c("#c7a6ff");
      g.beginPath(); g.moveTo(0, -11); g.lineTo(8, -2); g.lineTo(0, 11); g.lineTo(-8, -2); g.closePath(); g.fill();
      g.fillStyle = "rgba(255,255,255,0.45)"; g.beginPath(); g.moveTo(0, -11); g.lineTo(8, -2); g.lineTo(-8, -2); g.closePath(); g.fill();
      g.restore();
      for (const cx of [24, 126]) {
        g.fillStyle = c("#eee0c0"); g.fillRect(cx - 2, 64, 4, 12);
        if (lit) { glowAt(cx, 60, 10, "#ffb347", 0.45); g.fillStyle = "#ffd166"; g.beginPath(); g.ellipse(cx, 60 + Math.sin(t * 11 + cx) * 0.6, 1.8, 3.5, 0, 0, TAU); g.fill(); }
      }
      if (lit) for (let i = 0; i < 3; i++) {
        const k = (t * 0.45 + i * 0.37) % 1;
        g.fillStyle = "rgba(159,179,217," + (0.8 * (1 - k)).toFixed(2) + ")";
        g.beginPath(); g.ellipse(45 + i * 30, 14 + k * 62, 1.2, 2.2, 0, 0, TAU); g.fill();
      }
    },
    planetarium(t, c, lit) {
      if (lit) {
        const cols = ["#6ee07a", "#5ee7ff", "#c7a6ff"];
        g.globalCompositeOperation = "lighter";
        cols.forEach((col, i) => {
          const gr = g.createLinearGradient(0, 4, 0, 34);
          gr.addColorStop(0, U.rgba(col, 0)); gr.addColorStop(0.5, U.rgba(col, 0.28)); gr.addColorStop(1, U.rgba(col, 0));
          g.fillStyle = gr; g.beginPath(); g.moveTo(0, 30);
          for (let x = 0; x <= 150; x += 10) g.lineTo(x, 14 + i * 5 + Math.sin(x * 0.05 + t * (0.7 + i * 0.2) + i) * 7);
          g.lineTo(150, 36); g.lineTo(0, 36); g.closePath(); g.fill();
        });
        g.globalCompositeOperation = "source-over";
      }
      const cx = 75, cy = 50;
      g.strokeStyle = c("#9fb3d9", 0.35); g.lineWidth = 1;
      const orb = [[20, 7, 1.3, "#ff6b3d", 3], [36, 12, 0.8, "#5ee7ff", 3.6], [54, 17, 0.5, "#6ee07a", 4.4]];
      for (const [rx, ry] of orb) { g.beginPath(); g.ellipse(cx, cy, rx, ry, 0, 0, TAU); g.stroke(); }
      if (lit) glowAt(cx, cy, 26, P.or, 0.55);
      g.fillStyle = c("#ffd166"); g.beginPath(); g.arc(cx, cy, 7, 0, TAU); g.fill();
      orb.forEach(([rx, ry, sp, col, r], i) => {
        const a = (lit ? t * sp : 0) + i * 2;
        g.fillStyle = c(col); g.beginPath(); g.arc(cx + Math.cos(a) * rx, cy + Math.sin(a) * ry, r, 0, TAU); g.fill();
      });
      g.fillStyle = c("#5a4a7a"); g.fillRect(cx - 2, cy + 8, 4, 18); g.fillRect(cx - 14, 76, 28, 4);
    },
  };

  function colorizer(lit) {
    return lit ? (hex, a) => (a === undefined ? hex : U.rgba(hex, a)) : (hex, a) => {
      const s = gray(hex, 0.5);
      return a === undefined ? s : s.replace("rgb(", "rgba(").replace(")", "," + a + ")");
    };
  }
  function drawTile(id, t, dt) {
    const p = tilePos(id), room = roomById(id), info = ROOM_INFO[id];
    const m = meta();
    const lit = Meta.built(id);
    const anim = OBS.anim && OBS.anim.id === id ? OBS.anim : null;
    const ak = anim ? U.clamp((t - anim.t0) / 2, 0, 1) : 1;
    const nr = Meta.nextRoom();
    const isNext = !lit && nr && nr.room.id === id;
    const afford = !lit && m.fragments >= room.cost;
    const x = p.x, y = p.y;
    const pressed = BE.UI.pressId === "room_" + id;
    const sel = OBS.sel === id || (OBS.focus >= 0 && ROOM_ORDER[OBS.focus] === id);
    g.save();
    if (pressed) { g.translate(x + TW / 2, y + TH / 2); g.scale(0.97, 0.97); g.translate(-x - TW / 2, -y - TH / 2); }
    // ombre portée + fond
    g.fillStyle = "rgba(0,0,0,0.45)"; rr(x, y + 3, TW, TH, 10); g.fill();
    g.save();
    rr(x, y, TW, TH, 10); g.clip();
    const bg = g.createLinearGradient(0, y, 0, y + TH);
    if (lit && !anim) { bg.addColorStop(0, U.shade(info.tint, -0.72)); bg.addColorStop(1, "#0d1024"); }
    else { bg.addColorStop(0, "#0e1230"); bg.addColorStop(1, "#090c1c"); }
    g.fillStyle = bg; g.fillRect(x, y, TW, TH);
    g.translate(x, y);
    if (anim) {
      // allumage : la scène éclairée monte depuis le sol (2 s)
      g.globalAlpha = 0.3; SCENES[id](t, colorizer(false), false); g.globalAlpha = 1;
      const hk = U.easeInOut(ak) * TH;
      g.save(); g.beginPath(); g.rect(0, TH - hk, TW, hk); g.clip();
      const bg2 = g.createLinearGradient(0, 0, 0, TH); bg2.addColorStop(0, U.shade(info.tint, -0.72)); bg2.addColorStop(1, "#0d1024");
      g.fillStyle = bg2; g.fillRect(0, 0, TW, TH);
      SCENES[id](t, colorizer(true), true);
      g.restore();
      if (ak < 1) {
        const ly = TH - hk;
        const lg = g.createLinearGradient(0, ly - 14, 0, ly + 4);
        lg.addColorStop(0, U.rgba(info.tint, 0)); lg.addColorStop(0.8, U.rgba(info.tint, 0.7)); lg.addColorStop(1, "rgba(255,255,255,0.9)");
        g.fillStyle = lg; g.fillRect(0, ly - 14, TW, 18);
      }
    } else if (lit) SCENES[id](t, colorizer(true), true);
    else { g.globalAlpha = 0.34; SCENES[id](0, colorizer(false), false); g.globalAlpha = 1; }
    // vitre / vignette
    const vg = g.createRadialGradient(TW / 2, TH / 2, 20, TW / 2, TH / 2, 95);
    vg.addColorStop(0, "rgba(0,0,0,0)"); vg.addColorStop(1, lit ? "rgba(0,0,0,0.35)" : "rgba(0,0,0,0.55)");
    g.fillStyle = vg; g.fillRect(0, 0, TW, TH);
    g.restore();
    // cadre
    if (isNext && !anim) {
      g.strokeStyle = U.rgba(P.frag, 0.55 + 0.35 * Math.sin(t * 3)); g.lineWidth = 2;
      g.setLineDash([6, 4]); g.lineDashOffset = -t * 14; rr(x, y, TW, TH, 10); g.stroke(); g.setLineDash([]); g.lineDashOffset = 0;
    } else {
      g.strokeStyle = lit || anim ? U.rgba(info.tint, 0.75) : P.line; g.lineWidth = lit ? 1.8 : 1.2; rr(x, y, TW, TH, 10); g.stroke();
    }
    if (sel) { g.strokeStyle = "#eef2ff"; g.lineWidth = 2; rr(x - 3, y - 3, TW + 6, TH + 6, 12); g.stroke(); }
    // plaque
    g.fillStyle = lit ? "rgba(5,7,16,0.65)" : "rgba(5,7,16,0.75)"; rr(x + 8, y + TH - 21, TW - 16, 16, 8); g.fill();
    txt(room.nom, x + TW / 2, y + TH - 12.5, 10, lit ? "#ffffff" : P.dim, "center", 900, TW - 24);
    if (!lit && !anim) {
      // coût
      const bw = 58, bx = x + TW / 2 - bw / 2, by = y + 34;
      if (afford) glowAt(x + TW / 2, by + 11, 44, P.frag, 0.3 + 0.15 * Math.sin(t * 4));
      g.fillStyle = afford ? "rgba(58,36,110,0.95)" : "rgba(18,24,50,0.92)"; rr(bx, by, bw, 22, 11); g.fill();
      g.strokeStyle = afford ? P.frag : U.rgba(P.frag, 0.35); g.lineWidth = 1.2; rr(bx, by, bw, 22, 11); g.stroke();
      fragIcon(bx + 14, by + 11, 6, afford ? P.frag : U.rgba(P.frag, 0.7));
      txt(String(room.cost), bx + 36, by + 11.5, 13, afford ? "#ffffff" : P.frag, "center", 900);
      const sub = afford ? "Touche pour allumer" : roomShort(room);
      const subC = afford ? P.frag : U.rgba(P.dim, 0.9);
      if (lines(sub, TW - 16, 8.5, 700).length > 1) wrap(sub, x + TW / 2, y + 64, TW - 16, 8.5, subC, 10, "center", 700, 2);
      else txt(sub, x + TW / 2, y + 68, 8.5, subC, "center", 700, TW - 16);
      if (isNext) {
        g.fillStyle = P.frag; rr(x + 6, y + 6, 62, 14, 7); g.fill();
        txt("PROCHAINE", x + 37, y + 13.5, 8, "#1a1036", "center", 900);
      }
    }
    g.restore();
    BE.UI.region("room_" + id, x, y, TW, TH, () => { OBS.sel = OBS.sel === id ? null : id; OBS.confirm = false; OBS.selT = BE.state.time; });
  }

  function drawDome(t) {
    const cx = 180, by = 116, R = 66;
    const lit = Meta.built("planetarium");
    // télescope
    const a = -Math.PI / 2 + Math.sin(t * 0.25) * 0.5 + 0.35;
    g.save(); g.translate(cx + 6, by - 30); g.rotate(a);
    g.fillStyle = lit ? "#3a4a8a" : "#1f2750"; g.strokeStyle = lit ? P.or : P.line; g.lineWidth = 1.5;
    g.fillRect(0, -7, 62, 14); g.strokeRect(0, -7, 62, 14);
    g.fillRect(56, -9, 10, 18); g.strokeRect(56, -9, 10, 18);
    if (lit) { g.fillStyle = "#bfe8ff"; g.beginPath(); g.arc(66, 0, 5, 0, TAU); g.fill(); }
    g.restore();
    // coupole
    const dg = g.createLinearGradient(0, by - R, 0, by);
    dg.addColorStop(0, lit ? "#2c3a78" : "#1a2148"); dg.addColorStop(1, lit ? "#141a40" : "#0f1430");
    g.fillStyle = dg; g.strokeStyle = lit ? U.rgba(P.or, 0.7) : P.line; g.lineWidth = 2;
    g.beginPath(); g.arc(cx, by, R, Math.PI, 0); g.closePath(); g.fill(); g.stroke();
    g.strokeStyle = lit ? U.rgba(P.or, 0.3) : U.rgba(P.line, 0.8); g.lineWidth = 1;
    for (let i = 1; i < 5; i++) { const k = i / 5; g.beginPath(); g.ellipse(cx, by, R * Math.cos(k * Math.PI / 2) * 0.999, R, 0, Math.PI, 0); g.stroke(); }
    // fente
    g.fillStyle = "#070a14"; g.beginPath(); g.moveTo(cx - 5, by - R + 1); g.lineTo(cx + 5, by - R + 1); g.lineTo(cx + 8, by - 18); g.lineTo(cx - 2, by - 18); g.closePath(); g.fill();
    if (lit) for (let i = 0; i < 3; i++) starShape(cx + 1 + i, by - R + 12 + i * 12, 1.8, "#ffffff", 0.5 + 0.5 * Math.sin(t * 3 + i));
    g.fillStyle = "#1c2350"; g.fillRect(cx - R - 8, by - 2, R * 2 + 16, 6);
  }

  function drawObservatory(st) {
    g = BE.Render.ctx;
    const t = st.time, dt = st.frameDt || 0.016, m = meta();
    // ciel et tour
    drawDome(t);
    g.fillStyle = "#0c1026"; g.fillRect(14, 118, 332, 468);
    g.strokeStyle = "rgba(43,53,96,0.55)"; g.lineWidth = 1;
    for (let y = 124; y < 584; y += 14) {
      const off = ((y / 14) | 0) % 2 ? 0 : 11;
      g.beginPath(); g.moveTo(14, y); g.lineTo(346, y); g.stroke();
      for (let x = 14 + off; x < 346; x += 22) { g.beginPath(); g.moveTo(x, y); g.lineTo(x, y + 14); g.stroke(); }
    }
    g.strokeStyle = P.line; g.lineWidth = 2; g.strokeRect(14, 118, 332, 468);
    g.fillStyle = "#2a2230"; g.fillRect(8, 584, 344, 6);
    for (const id of ROOM_ORDER) drawTile(id, t, dt);
    // animation d'allumage
    if (OBS.anim) {
      const k = (t - OBS.anim.t0) / 2;
      if (!OBS.anim.fx2 && k >= 1) {
        OBS.anim.fx2 = true;
        const p = tilePos(OBS.anim.id);
        BE.FX.burst(p.x + TW / 2, p.y + TH / 2, 26, { speed: 170, color: ROOM_INFO[OBS.anim.id].tint, glow: true, life: 0.9 });
        BE.FX.ring(p.x + TW / 2, p.y + TH / 2, 10, 120, P.frag, 0.7, 3);
        chime([0, 7, 12, 16], 110, 659.25);
        BE.UI.toast(roomById(OBS.anim.id).nom + " s'illumine ✦");
      }
      if (k > 2.6) OBS.anim = null;
    }
    BE.FX.drawRings(g); BE.FX.drawParticles(g); BE.FX.drawFloats(g);
    // en-tête
    backButton(() => BE.Run.go("TITLE"));
    txt("OBSERVATOIRE", 64, 70, 13, P.frag, "center", 900);
    txt(m.rooms.length + " / 8 salles", 64, 86, 9, P.dim, "center", 700);
    fragChip(350, 28, m.fragments, dt);
    const dd = Meta.defisDoneCount();
    BE.UI.button({ id: "defis", x: 250, y: 60, w: 96, h: 36, label: "Défis", sub: dd + " / 16", style: "ghost", size: 12, onTap: () => Meta.open("DEFIS") });
    // bandeau « prochaine salle »
    const nr = Meta.nextRoom();
    txt(Meta.nextRoomText(nr), 180, 604, 11, P.frag, "center", 800);
    if (nr) {
      const bw = 240, bx = 60;
      g.fillStyle = "rgba(199,166,255,0.15)"; rr(bx, 616, bw, 6, 3); g.fill();
      g.fillStyle = P.frag; rr(bx, 616, Math.max(4, bw * U.clamp(1 - nr.need / nr.room.cost, 0, 1)), 6, 3); g.fill();
    }
    if (OBS.sel) drawRoomSheet(st, OBS.sel);
  }

  function drawRoomSheet(st, id) {
    const t = st.time, m = meta();
    const room = roomById(id), info = ROOM_INFO[id], lit = Meta.built(id);
    const k = U.easeOutCubic(U.clamp((t - (OBS.selT || t)) / 0.22, 0, 1));
    const h = 262, y = 640 - h * k + 6;
    g.fillStyle = "rgba(5,7,16," + (0.55 * k).toFixed(2) + ")"; BE.Render.fillScreen(g);
    BE.UI.region("sheetBg", 0, 0, D.W, D.H, () => { OBS.sel = null; OBS.confirm = false; }, false);
    BE.UI.panelBox(8, y, 344, h + 10);
    BE.UI.region("sheet", 8, y, 344, h, () => {}, false);
    glowAt(52, y + 36, 40, info.tint, 0.3);
    starShape(52, y + 36, 12, lit ? info.tint : P.dim);
    txt(room.nom, 76, y + 28, 18, P.text, "left", 900, 180);
    txt(info.flavor, 76, y + 48, 9.5, U.rgba(P.frag, 0.9), "left", 600, 260, true);
    if (lit) { g.fillStyle = U.rgba(info.tint, 0.2); rr(262, y + 16, 78, 22, 11); g.fill(); txt("ALLUMÉE", 301, y + 27.5, 10, info.tint, "center", 900); }
    else {
      g.fillStyle = "rgba(18,24,50,0.9)"; rr(270, y + 16, 70, 24, 12); g.fill();
      fragIcon(286, y + 28, 6.5); txt(String(room.cost), 316, y + 28.5, 14, P.frag, "center", 900);
    }
    // contenu
    txt("ÉLARGIT LE POOL", 180, y + 72, 8.5, P.dim, "center", 800);
    const items = Meta.roomContent(id);
    const n = items.length, sp = Math.min(54, 320 / Math.max(1, n));
    items.forEach((it, i) => {
      const ix = 180 + (i - (n - 1) / 2) * sp, iy = y + 102;
      drawItem(it, ix, iy, 30, true);
      const lbl = it.k === "relic" ? D.RELIC_BY_ID[it.id].nom : it.k === "reaction" ? D.REACTIONS[it.id].nom : it.k === "clou" ? D.CLOUS[it.id].nom.replace("Clou ", "")
        : it.k === "grav" ? D.GRAVURES[it.id].nom : it.k === "boss" ? D.BOSSES[it.id].nom : it.k === "evo" ? D.EVOLUTIONS.find((e) => e.id === it.id).nom.split(" ")[0]
        : it.k === "star" ? "Sève" : it.k === "aurore" ? "Aurore" : it.k === "moon" ? "Nuit Blanche" : "";
      txt(lbl, ix, iy + 25, 7.5, P.dim, "center", 700, sp - 2);
    });
    wrap(roomDesc(id), 180, y + 150, 316, 10.5, P.text, 14, "center", 600, 3);
    if (lit) {
      BE.UI.button({ id: "closeRoom", x: 110, y: y + h - 64, w: 140, h: 48, label: "Fermer", style: "ghost", size: 14, onTap: () => { OBS.sel = null; } });
    } else {
      const need = room.cost - m.fragments;
      const can = need <= 0;
      BE.UI.button({ id: "build", x: 24, y: y + h - 70, w: 200, h: 56, label: can ? (OBS.confirm ? "Confirmer ?" : "Construire") : "Il manque " + need + " ◇",
        sub: can ? "−" + room.cost + " ◇" : "Joue des runs pour gagner des ◇", style: can ? "gold" : "primary", size: can ? 16 : 13, disabled: !can,
        whyDisabled: "Il te manque " + need + " Fragments ◇", onTap: () => buildRoom(id) });
      BE.UI.button({ id: "closeRoom", x: 234, y: y + h - 70, w: 102, h: 56, label: "Fermer", style: "ghost", size: 14, onTap: () => { OBS.sel = null; OBS.confirm = false; } });
    }
  }
  function buildRoom(id) {
    if (!OBS.confirm) { OBS.confirm = true; BE.emit("ui:tap", {}); return; }
    const r = Meta.build(id);
    OBS.confirm = false;
    if (!r.ok) { BE.emit("ui:no", {}); return; }
    OBS.sel = null;
    OBS.anim = { id, t0: BE.state.time };
    const p = tilePos(id);
    BE.FX.burst(p.x + TW / 2, p.y + TH, 18, { speed: 90, color: P.frag, glow: true, life: 0.8, angle: -Math.PI / 2 });
    BE.FX.flash(0.18, P.frag);
    chime([0, 4, 7], 140, 392);
    BE.emit("ui:ok", {});
  }

  // ================================================================ écran : Grimoire (§9.4, §10.8)
  const GR = { tab: 0, viewT: 0, viewKeys: {} };
  const CARD_H = 72, CARD_GAP = 8;
  function drawGrimoire(st, forceDefis) {
    g = BE.Render.ctx;
    const t = st.time, dt = st.frameDt || 0.016;
    if (forceDefis) GR.tab = 5;
    const tab = TABS[GR.tab];
    // en-tête
    backButton(() => Meta.close());
    header(GR.tab === 5 ? "DÉFIS" : "GRIMOIRE", P.frag, t);
    const comp = Meta.completion();
    const pc = Math.round(comp.pct * 100);
    g.strokeStyle = U.rgba(P.frag, 0.2); g.lineWidth = 3; g.beginPath(); g.arc(326, 28, 14, 0, TAU); g.stroke();
    g.strokeStyle = P.frag; g.beginPath(); g.arc(326, 28, 14, -Math.PI / 2, -Math.PI / 2 + TAU * comp.pct); g.stroke();
    txt(pc + "%", 326, 28.5, 9, P.text, "center", 900);
    // onglets
    const un = Meta.unseen();
    const tw = 56, tx0 = 12, ty = 52, th = 36;
    TABS.forEach((T, i) => {
      const x = tx0 + i * tw, act = i === GR.tab;
      const es = Meta.entries(T.id);
      const kn = es.filter((e) => e.known).length;
      g.fillStyle = act ? "rgba(40,48,100,0.95)" : "rgba(18,24,50,0.7)"; rr(x + 1, ty, tw - 2, th, 8); g.fill();
      if (act) { g.fillStyle = P.frag; rr(x + 10, ty + th - 3, tw - 20, 3, 1.5); g.fill(); }
      txt(T.nom, x + tw / 2, ty + 13, 9.5, act ? "#ffffff" : P.dim, "center", 900, tw - 6);
      txt(kn + "/" + es.length, x + tw / 2, ty + 26, 8, act ? P.frag : U.rgba(P.dim, 0.8), "center", 700);
      if (un.byTab[T.id]) { g.fillStyle = P.frag; g.beginPath(); g.arc(x + tw - 7, ty + 6, 3.5 + Math.sin(t * 5) * 0.6, 0, TAU); g.fill(); }
      BE.UI.region("tab" + i, x, ty, tw, th, () => setTab(i));
    });
    // liste
    const y0 = 96, y1 = 636;
    const es = Meta.entries(tab.id);
    const contentH = es.length * (CARD_H + CARD_GAP);
    SCR.view = { y0, y1 };
    SCR.max = Math.max(0, contentH - (y1 - y0) + 8);
    updateScroll(dt);
    const seen = seenSet();
    g.save(); g.beginPath(); g.rect(0, y0, D.W, y1 - y0); g.clip();
    es.forEach((e, i) => {
      const cy = y0 + 4 + i * (CARD_H + CARD_GAP) - SCR.y;
      if (cy + CARD_H < y0 || cy > y1) return;
      const isNew = e.known && !seen[e.key] && !isStartKnown(e.key) && tab.id !== "defis";
      if (e.known && cy > y0 - 20 && cy + CARD_H < y1 + 20) GR.viewKeys[e.key] = 1;
      if (tab.id === "defis") drawDefiCard(e, 12, cy, 336, t, y0, y1); else drawEntryCard(e, 12, cy, 336, t, isNew);
    });
    g.restore();
    // fondu haut/bas + barre de défilement
    const fg = g.createLinearGradient(0, y0, 0, y0 + 14); fg.addColorStop(0, "rgba(9,12,26,0.9)"); fg.addColorStop(1, "rgba(9,12,26,0)");
    if (SCR.y > 2) { g.fillStyle = fg; g.fillRect(0, y0, D.W, 14); }
    if (SCR.max > 0) {
      const vh = y1 - y0, bh = Math.max(30, vh * vh / (contentH + 8)), by = y0 + (vh - bh) * U.clamp(SCR.y / SCR.max, 0, 1);
      g.fillStyle = U.rgba(P.frag, 0.35); rr(352, by, 3, bh, 1.5); g.fill();
    }
  }
  function setTab(i) {
    commitSeen();
    SCR.byTab[GR.tab] = SCR.y;
    GR.tab = (i + TABS.length) % TABS.length;
    SCR.y = SCR.byTab[GR.tab] || 0; SCR.vy = 0;
    BE.emit("ui:tap", {});
  }
  function commitSeen() {
    const keys = Object.keys(GR.viewKeys);
    GR.viewKeys = {};
    if (keys.length) markSeen(keys);
  }
  function cardBg(x, y, w, h, known, accent) {
    g.fillStyle = "rgba(0,0,0,0.3)"; rr(x, y + 3, w, h, 12); g.fill();
    if (known) {
      const gr = g.createLinearGradient(0, y, 0, y + h); gr.addColorStop(0, "#1a2150"); gr.addColorStop(1, "#11173a");
      g.fillStyle = gr; rr(x, y, w, h, 12); g.fill();
      g.strokeStyle = U.rgba(accent || P.line, 0.55); g.lineWidth = 1.2; rr(x, y, w, h, 12); g.stroke();
      g.fillStyle = accent || P.line; rr(x, y + 12, 3, h - 24, 1.5); g.fill();
    } else {
      g.fillStyle = "rgba(12,15,36,0.92)"; rr(x, y, w, h, 12); g.fill();
      g.strokeStyle = U.rgba(P.line, 0.9); g.lineWidth = 1; g.setLineDash([4, 4]); rr(x, y, w, h, 12); g.stroke(); g.setLineDash([]);
    }
  }
  function drawEntryCard(e, x, y, w, t, isNew) {
    cardBg(x, y, w, CARD_H, e.known, e.accent);
    const ix = x + 38, iy = y + CARD_H / 2;
    drawItem(e.icon, ix, iy, 40, e.known);
    const tx = x + 70, tw = w - 82;
    if (e.known) {
      txt(e.name, tx, y + 17, 13, P.text, "left", 900, tw - 60);
      txt(e.sub, tx, y + 32, 8, e.accent, "left", 800, tw);
      const ew = isNew ? tw - 58 : tw;
      if (lines(e.txt, ew, 9.5, 600).length <= 2) wrap(e.txt, tx, y + 46, ew, 9.5, U.rgba(P.text, 0.85), 12, "left", 600, 2);
      else wrap(e.txt, tx, y + 42, ew, 8.5, U.rgba(P.text, 0.85), 10.5, "left", 600, 3); // règle longue : 3 lignes, jamais coupée
      if (e.count) {
        const s = "×" + U.fmt(e.count);
        txt(s, x + w - 12, y + 17, 11, P.frag, "right", 900);
        if (e.countLbl) txt(e.countLbl, x + w - 12, y + 29, 7.5, P.dim, "right", 700);
      }
      if (isNew) {
        const k = 0.75 + 0.25 * Math.sin(t * 5);
        g.fillStyle = U.rgba(P.frag, k); rr(x + w - 62, y + CARD_H - 20, 52, 13, 6.5); g.fill();
        txt("NOUVEAU", x + w - 36, y + CARD_H - 13, 7.5, "#1a1036", "center", 900);
      }
    } else {
      txt(e.secret ? "Secret" : "? ? ?", tx, y + 17, 13, P.dim, "left", 900);
      txt(e.locked ? "VERROUILLÉ · " + e.locked.toUpperCase() : "NON DÉCOUVERT", tx, y + 32, 8, e.locked ? U.rgba(P.danger, 0.8) : U.rgba(P.dim, 0.8), "left", 800, tw);
      if (e.hint) wrap(e.hideHint ? e.hint : "«\u00a0" + e.hint + "\u00a0»", tx, y + 47, tw, 9.5, U.rgba(P.frag, 0.85), 12, "left", 600, 2, true);
    }
  }
  function rewardItem(d) {
    const r = DEFI_INFO[d.id].reward;
    if (r.k === "relic") return { k: "relic", id: r.id };
    if (r.k === "gardien") return { k: "gardien", id: r.id };
    if (r.k === "grav") return { k: "grav", id: r.id };
    if (r.k === "clou") return { k: "clou", id: r.id };
    if (r.k === "theme") return { k: "aurore" };
    return null;
  }
  function drawDefiCard(e, x, y, w, t, vy0, vy1) {
    const d = e.defi, pr = e.pr;
    cardBg(x, y, w, CARD_H, true, pr.done ? P.or : P.line);
    if (pr.done) glowAt(x + 38, y + CARD_H / 2, 34, P.or, 0.15);
    drawItem(e.icon, x + 38, y + CARD_H / 2, 40, true);
    const tx = x + 70, tw = w - 130;
    txt(d.id, tx, y + 13, 8, pr.done ? P.or : P.dim, "left", 900);
    wrap(d.txt, tx, y + 27, tw, 11, pr.done ? P.text : U.rgba(P.text, 0.9), 13, "left", 800, 2);
    // récompense
    const ri = rewardItem(d);
    const rx = x + w - 32;
    if (ri) drawItem(ri, rx, y + 26, 30, true);
    else { fragIcon(rx - 6, y + 26, 7); txt("+10", rx + 8, y + 26.5, 11, P.frag, "center", 900); }
    txt(d.reward, rx, y + 48, 7, P.dim, "center", 700, 54);
    // progression
    const lbl = pr.done ? "ACCOMPLI" : (pr.max > 1 ? U.fmt(Math.floor(pr.cur)) + " / " + U.fmt(pr.max) : "à faire");
    g.font = font(8, 900);
    const lw = g.measureText(lbl).width + 8;
    const bx = tx, bw = tw - lw, by = y + CARD_H - 13;
    g.fillStyle = "rgba(138,147,184,0.15)"; rr(bx, by, bw, 5, 2.5); g.fill();
    g.fillStyle = pr.done ? P.or : P.frag; rr(bx, by, Math.max(pr.pct > 0 ? 4 : 0, bw * pr.pct), 5, 2.5); g.fill();
    txt(lbl, tx + tw, by + 2.5, 8, pr.done ? P.or : P.dim, "right", 900);
    if (d.id === "D16" && pr.done) {
      const on = !!meta().flags.themeAurore;
      const bx2 = x + w - 60, by2 = y + 54;
      g.fillStyle = on ? "rgba(110,224,122,0.25)" : "rgba(18,24,50,0.9)"; rr(bx2, by2, 50, 14, 7); g.fill();
      txt(on ? "THÈME OUI" : "THÈME NON", bx2 + 25, by2 + 7.5, 7, on ? P.seve : P.dim, "center", 900);
      if (y + 40 > vy0 && y + CARD_H < vy1) BE.UI.region("themeAurore", x + w - 70, y + 40, 70, 32, () => { const f = meta().flags; f.themeAurore = !f.themeAurore; Meta.flush(true); });
    }
  }

  // ================================================================ écran : Ciel du Jour
  const DS = { saved: null };
  function drawDaily(st) {
    g = BE.Render.ctx;
    const t = st.time, m = meta();
    backButton(() => BE.Run.go("TITLE"));
    header("CIEL DU JOUR", P.eclat, t);
    let dateTxt = today();
    try { dateTxt = new Date().toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" }); } catch (e) { /* */ }
    txt(dateTxt, 180, 54, 11, P.dim, "center", 700);
    const o = Meta.dailyOpts();
    const gd = D.GARDIEN_BY_ID[o.gardien], rel = D.RELIC_BY_ID[o.relics[0]];
    // carte du jour
    BE.UI.panelBox(20, 72, 320, 170);
    glowAt(80, 140, 70, gd.color, 0.3 + 0.06 * Math.sin(t * 2));
    drawPortrait(gd.id, 80, 150, 0.82, false, t);
    txt("GARDIEN DU JOUR", 148, 94, 8.5, P.dim, "left", 800);
    txt(gd.nom, 148, 112, 16, P.text, "left", 900, 180);
    txt(gd.txt[0], 148, 130, 8.5, U.rgba(P.text, 0.75), "left", 600, 180);
    txt("RELIQUE IMPOSÉE", 148, 152, 8.5, P.dim, "left", 800);
    BE.Render.drawRelicIcon(rel.id, 166, 178, 30);
    txt(rel.nom, 188, 172, 12, P.text, "left", 900, 140);
    wrap(rel.txt, 188, 188, 140, 8.5, U.rgba(P.text, 0.75), 10, "left", 600, 2);
    g.fillStyle = "rgba(79,179,255,0.12)"; rr(36, 214, 288, 18, 9); g.fill();
    txt("Contenu complet débloqué · Éclipse 0 · même ciel pour tous", 180, 223.5, 8.5, P.eclat, "center", 700, 280);
    // statut
    const info = Meta.dailyInfo(), entry = Meta.dailyEntry();
    if (entry) {
      txt("SCORE OFFICIEL", 180, 262, 9, P.dim, "center", 800);
      txt(U.fmt(entry.score), 180, 286, 26, P.or, "center", 900);
      drawGrid(entry.grid, 180, 314, 10);
      if (entry.best > entry.score) txt("Meilleur (hors classement) : " + U.fmt(entry.best), 180, 336, 9, P.dim, "center", 700);
    } else {
      txt(info.started ? "Essai officiel en cours" : "Un seul essai compte", 180, 268, 13, P.text, "center", 900);
      txt("Le premier run du jour est ton score officiel.", 180, 288, 9.5, P.dim, "center", 600);
      txt("Tu pourras rejouer, hors classement.", 180, 304, 9.5, P.dim, "center", 600);
    }
    // boutons
    const saved = DS.saved;
    const resumable = saved && saved.daily && saved.seed === Meta.dailySeed();
    const otherRun = saved && !resumable;
    const label = resumable ? "Continuer" : entry ? "Rejouer" : "Jouer";
    const sub = resumable ? "Lune " + saved.lune + " · " + D.NIGHT_NAMES[saved.nuit] : entry ? "hors classement" : otherRun ? "remplace la partie en cours" : "essai officiel";
    BE.UI.button({ id: "dailyPlay", x: 60, y: 350, w: 240, h: 56, label: DS.confirm ? "Confirmer ?" : label, sub, style: "gold",
      onTap: () => {
        if (otherRun && !DS.confirm) { DS.confirm = true; return; }
        DS.confirm = false; Meta.startDaily();
      } });
    if (entry) BE.UI.button({ id: "dailyShare", x: 60, y: 414, w: 240, h: 44, label: "Partager le score officiel", style: "eclat", size: 13, onTap: () => Meta.share(entry) });
    // historique (30 jours)
    const hy = 482;
    txt("30 DERNIERS JOURS", 180, hy, 9, P.dim, "center", 800);
    const map = {};
    let maxS = 1;
    for (const h of m.daily.history) { map[h.date] = h; maxS = Math.max(maxS, h.score || 0); }
    const cw = 18, gap = 2, x0 = 180 - (15 * (cw + gap) - gap) / 2;
    const d = new Date(); d.setDate(d.getDate() - 29);
    for (let i = 0; i < 30; i++) {
      const k = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
      const h = map[k];
      const x = x0 + (i % 15) * (cw + gap), y = hy + 12 + Math.floor(i / 15) * (cw + gap);
      if (h) {
        const a = 0.25 + 0.75 * U.clamp((h.score || 0) / maxS, 0, 1);
        g.fillStyle = U.rgba(h.won ? P.or : P.eclat, a); rr(x, y, cw, cw, 4); g.fill();
        if (h.won) starShape(x + cw / 2, y + cw / 2, 4, "#ffffff", 0.8);
      } else { g.fillStyle = "rgba(43,53,96,0.45)"; rr(x, y, cw, cw, 4); g.fill(); }
      if (i === 29) { g.strokeStyle = "#eef2ff"; g.lineWidth = 1.5; rr(x - 1, y - 1, cw + 2, cw + 2, 5); g.stroke(); }
      d.setDate(d.getDate() + 1);
    }
    const streak = Meta.dailyStreak();
    const recS = m.daily.history.reduce((s, h) => Math.max(s, h.score || 0), 0);
    txt("Série : " + streak + " jour" + (streak > 1 ? "s" : "") + " · Record : " + U.fmt(recS), 180, hy + 66, 10, P.text, "center", 700);
    // compte à rebours
    const now = new Date(), mid = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    const s = Math.max(0, Math.floor((mid - now) / 1000));
    const hh = String(Math.floor(s / 3600)).padStart(2, "0"), mm = String(Math.floor(s / 60) % 60).padStart(2, "0"), ss = String(s % 60).padStart(2, "0");
    txt("Prochain ciel dans " + hh + ":" + mm + ":" + ss, 180, 620, 9, P.dim, "center", 700);
  }
  /** Mini-grille façon Wordle (symboles dessinés, pas d'emoji dans le canvas). */
  function drawGrid(grid, cx, y, s) {
    const cells = [];
    (grid || []).forEach((L, li) => (L || []).forEach((v, ni) => cells.push({ v, li, ni })));
    if (!cells.length) return;
    const sp = s + 6, n = cells.length + (grid.length - 1) * 0.6;
    let x = cx - (n * sp) / 2 + sp / 2, lastL = cells[0].li;
    for (const c of cells) {
      if (c.li !== lastL) { x += sp * 0.6; lastL = c.li; }
      drawNightSym(c.v, x, y, s);
      x += sp;
    }
  }
  function drawNightSym(v, x, y, s) {
    if (v === undefined || v === null) { g.fillStyle = "rgba(43,53,96,0.6)"; rr(x - s / 2, y - s / 2, s, s, 2); g.fill(); return; }
    if (v === 0) {
      g.strokeStyle = P.danger; g.lineWidth = 2;
      g.beginPath(); g.moveTo(x - s * 0.35, y - s * 0.35); g.lineTo(x + s * 0.35, y + s * 0.35); g.moveTo(x + s * 0.35, y - s * 0.35); g.lineTo(x - s * 0.35, y + s * 0.35); g.stroke();
      return;
    }
    if (v >= 8) { glowAt(x, y, s, P.frag, 0.5); g.strokeStyle = P.frag; g.lineWidth = 1.5; g.beginPath(); g.arc(x, y, s * 0.4, 0, TAU); g.stroke(); g.fillStyle = "#fff"; g.beginPath(); g.arc(x, y, 1.5, 0, TAU); g.fill(); return; }
    const col = ["#8a93b8", "#8a93b8", "#8a93b8", "#ffe14d", "#ffd166", "#ff9d3d", "#ff4d5e", "#c7a6ff"][v] || P.dim;
    const r = s * (0.28 + 0.04 * v);
    if (v >= 3) starShape(x, y, r * 1.3, col); else { g.fillStyle = col; rr(x - r, y - r, r * 2, r * 2, 2); g.fill(); }
  }
  Meta.drawGrid = (gg, grid, cx, y, s) => { const o = g; g = gg; drawGrid(grid, cx, y, s); g = o; };

  // ================================================================ écran : Sélection du Gardien (§10.2)
  function selInit() {
    const m = meta();
    const i = D.GARDIENS.findIndex((x) => x.id === m.flags.lastGardien);
    SEL.idx = i >= 0 ? i : 0; SEL.pos = SEL.idx; SEL.dragX = 0; SEL.drag = null; SEL.confirm = false;
    SEL.saved = BE.Save.loadRun();
    SEL.init = true;
  }
  function selRel(i, n) { let d = (i - SEL.pos) % n; if (d > n / 2) d -= n; if (d < -n / 2) d += n; return d; }
  function drawSelect(st) {
    g = BE.Render.ctx;
    if (!SEL.init) selInit();
    const t = st.time, dt = st.frameDt || 0.016, n = D.GARDIENS.length;
    // animation du carrousel (chemin le plus court)
    let dpos = SEL.idx - SEL.pos; while (dpos > n / 2) dpos -= n; while (dpos < -n / 2) dpos += n;
    SEL.pos += dpos * (1 - Math.exp(-12 * dt));
    if (Math.abs(dpos) < 0.001) SEL.pos = SEL.idx;
    SEL.pos = ((SEL.pos % n) + n) % n;
    txt("QUI VEILLE CETTE NUIT ?", 180, 44, 14, P.dim, "center", 900);
    const order = D.GARDIENS.map((gd, i) => ({ gd, i, d: selRel(i, n) })).sort((a, b) => Math.abs(b.d) - Math.abs(a.d));
    for (const o of order) {
      const cx = 180 + o.d * 272 + SEL.dragX;
      if (Math.abs(cx - 180) > 330) continue;
      drawGardienCard(o.gd, cx, t, Math.abs(o.d) < 0.5);
    }
    const i = SEL.idx, gd = D.GARDIENS[i];
    const unlocked = Meta.hasGardien(gd.id);
    const goPrev = () => { SEL.idx = (i + n - 1) % n; SEL.confirm = false; }, goNext = () => { SEL.idx = (i + 1) % n; SEL.confirm = false; };
    BE.UI.button({ id: "prev", x: 4, y: 226, w: 34, h: 56, label: "‹", style: "ghost", size: 22, onTap: goPrev });
    BE.UI.button({ id: "next", x: 322, y: 226, w: 34, h: 56, label: "›", style: "ghost", size: 22, onTap: goNext });
    // cibles tactiles ≥ 48 × 48 (§3.1) : la zone dépasse la flèche dessinée
    BE.UI.region("prevHit", 0, 220, 50, 68, goPrev, false); BE.UI.region("nextHit", 310, 220, 50, 68, goNext, false);
    for (let k = 0; k < n; k++) {
      g.fillStyle = k === i ? P.text : Meta.hasGardien(D.GARDIENS[k].id) ? P.dim : P.line;
      g.beginPath(); g.arc(180 - (n - 1) * 8 + k * 16, 432, k === i ? 4 : 2.6, 0, TAU); g.fill();
    }
    // Éclipse
    const maxE = Meta.maxEclipse(gd.id);
    if (SEL.ecl[gd.id] === undefined) SEL.ecl[gd.id] = maxE;
    const e = SEL.ecl[gd.id] = U.clamp(SEL.ecl[gd.id], 0, maxE);
    st.ui.eclipse = e;
    drawEclipseSelector(gd, e, maxE, t, unlocked);
    // lancer
    const hasSaved = !!SEL.saved;
    const df = D.DEFIS.find((d) => gd.unlock && d.id === gd.unlock.defi);
    BE.UI.button({ id: "launch", x: 60, y: 526, w: 240, h: 54, label: SEL.confirm ? "Confirmer ?" : "Lancer", sub: hasSaved && unlocked ? "remplace la partie en cours" : e ? "Éclipse " + e : "",
      style: "gold", disabled: !unlocked, whyDisabled: df ? "Défi " + df.id + " : " + df.txt : "Verrouillé",
      onTap: () => {
        if (hasSaved && !SEL.confirm) { SEL.confirm = true; return; }
        SEL.confirm = false;
        meta().flags.lastGardien = gd.id; touch();
        BE.Run.startNewRun({ gardien: gd.id, eclipse: e });
      } });
    BE.UI.button({ id: "back", x: 110, y: 584, w: 140, h: 48, label: "Retour", style: "ghost", size: 13, onTap: () => BE.Run.go("TITLE") });
  }
  function drawGardienCard(gd, cx, t, center) {
    const unlocked = Meta.hasGardien(gd.id);
    const k = U.clamp(1 - Math.abs(cx - 180) / 272, 0, 1);
    const sc = 0.86 + 0.14 * k;
    g.save();
    g.translate(cx, 250); g.scale(sc, sc); g.translate(-cx, -250);
    const x = cx - 130, y = 64, w = 260, h = 350;
    g.fillStyle = "rgba(0,0,0,0.4)"; rr(x, y + 5, w, h, 18); g.fill();
    const gr = g.createLinearGradient(0, y, 0, y + h);
    gr.addColorStop(0, unlocked ? U.shade(gd.color, -0.78) : "#12173a"); gr.addColorStop(0.55, "#141a3e"); gr.addColorStop(1, P.panel);
    g.fillStyle = gr; rr(x, y, w, h, 18); g.fill();
    g.strokeStyle = unlocked ? U.rgba(gd.color, 0.6) : P.line; g.lineWidth = 1.6; rr(x, y, w, h, 18); g.stroke();
    // petites étoiles de fond
    for (let s = 0; s < 9; s++) starShape(x + 20 + ((s * 73) % 220), y + 16 + ((s * 37) % 110), 1.5 + (s % 3) * 0.6, "#ffffff", unlocked ? 0.25 + 0.25 * Math.sin(t * 2 + s) : 0.08);
    const px = cx, py = y + 112;
    if (unlocked) glowAt(px, py - 10, 80, gd.color, 0.38 + 0.08 * Math.sin(t * 2));
    drawPortrait(gd.id, px, py, 1.12, !unlocked, t);
    g.fillStyle = "rgba(0,0,0,0.25)"; g.beginPath(); g.ellipse(px, py + 62, 40, 6, 0, 0, TAU); g.fill();
    txt(unlocked ? gd.nom : "???", cx, y + 200, 22, unlocked ? P.text : P.dim, "center", 900, w - 30);
    const stats = meta().stats.byGardien[gd.id];
    const maxE = Meta.maxEclipse(gd.id);
    if (unlocked) {
      txt(gd.txt[0], cx, y + 226, 10.5, U.rgba(P.text, 0.8), "center", 600, w - 24);
      txt(gd.txt[1], cx, y + 242, 10.5, U.rgba(P.text, 0.8), "center", 600, w - 24);
      txt("SAC DE DÉPART", cx, y + 266, 8.5, P.dim, "center", 800);
      const bag = D.BAGS[gd.bag === "standard" && Meta.built("serre") ? "standardSeve" : gd.bag];
      const nb = bag.length, sp = 22;
      bag.forEach(([c, s], kk) => {
        const bx = cx - (nb - 1) * sp / 2 + kk * sp;
        BE.Render.drawStar(bx, y + 290, s, c, { scale: (s === 1 ? 7.5 : 10) / D.SIZES[s].r, seed: kk * 11 + gd.id.length, lookX: cx, lookY: y + 200 });
      });
      let line = "Jamais joué";
      if (stats && stats.runs) line = "Meilleure Lune " + stats.bestLune + " · " + stats.wins + " victoire" + (stats.wins > 1 ? "s" : "");
      txt(line, cx, y + 322, 9.5, P.frag, "center", 700);
      if (maxE > 0) {
        g.fillStyle = "rgba(199,166,255,0.16)"; rr(x + w - 58, y + 12, 46, 20, 10); g.fill();
        moonIcon(x + w - 44, y + 22, 5, P.frag);
        txt("É" + maxE, x + w - 26, y + 22.5, 10, P.frag, "center", 900);
      }
    } else {
      const df = D.DEFIS.find((d) => gd.unlock && d.id === gd.unlock.defi);
      txt("Verrouillé" + (gd.id === "astronome" || gd.id === "insomniaque" ? "" : "e"), cx, y + 226, 12, P.dim, "center", 800);
      if (df) {
        txt("DÉFI " + df.id, cx, y + 252, 8.5, P.frag, "center", 900);
        wrap(df.txt, cx, y + 270, w - 40, 11, P.text, 14, "center", 700, 2);
        const pr = Meta.defiProgress(df.id);
        const bw = 180, bx = cx - bw / 2, by = y + 304;
        g.fillStyle = "rgba(138,147,184,0.15)"; rr(bx, by, bw, 6, 3); g.fill();
        g.fillStyle = P.frag; rr(bx, by, Math.max(pr.pct > 0 ? 4 : 0, bw * pr.pct), 6, 3); g.fill();
        txt(pr.max > 1 ? U.fmt(Math.floor(pr.cur)) + " / " + U.fmt(pr.max) : "à accomplir", cx, by + 18, 9, P.dim, "center", 700);
      }
    }
    // cartes latérales : voile (Render.drawStar remet globalAlpha à 1, on n'utilise donc pas l'alpha global)
    if (k < 0.98) { g.fillStyle = "rgba(9,12,28," + (0.7 * (1 - k)).toFixed(3) + ")"; rr(x - 1, y - 1, w + 2, h + 2, 18); g.fill(); }
    g.restore();
    g.globalAlpha = 1;
  }
  function drawEclipseSelector(gd, e, maxE, t, unlocked) {
    const y = 452;
    if (!Meta.eclipsesOpen()) {
      moonIcon(98, y + 8, 7, P.line);
      txt("ÉCLIPSES", 114, y + 2, 10, P.dim, "left", 900);
      txt("Gagne un run pour ouvrir l'échelle", 114, y + 16, 9, U.rgba(P.dim, 0.8), "left", 600);
      return;
    }
    const can = unlocked;
    BE.UI.button({ id: "ecMinus", x: 30, y: y - 10, w: 44, h: 44, label: "−", style: "ghost", size: 20, disabled: !can || e <= 0, onTap: () => { SEL.ecl[gd.id] = Math.max(0, e - 1); } });
    BE.UI.button({ id: "ecPlus", x: 286, y: y - 10, w: 44, h: 44, label: "+", style: "ghost", size: 20, disabled: !can || e >= maxE,
      whyDisabled: e >= 8 ? "Éclipse maximale" : "Gagne à l'Éclipse " + e + " pour débloquer la suivante", onTap: () => { SEL.ecl[gd.id] = Math.min(maxE, e + 1); } });
    txt(e ? "ÉCLIPSE " + e : "SANS ÉCLIPSE", 180, y, 14, e ? P.frag : P.text, "center", 900);
    for (let k = 1; k <= 8; k++) {
      const px = 180 + (k - 4.5) * 17, py = y + 18;
      if (k <= e) { glowAt(px, py, 9, P.frag, 0.35); moonIcon(px, py, 5, P.frag); }
      else if (k <= maxE) moonIcon(px, py, 5, U.rgba(P.frag, 0.35));
      else { g.fillStyle = "rgba(43,53,96,0.8)"; g.beginPath(); g.arc(px, py, 3, 0, TAU); g.fill(); }
    }
    if (e > 0) {
      txt(e + " · " + D.ECLIPSES[e].txt + (e > 1 ? "  (+ niv. 1–" + (e - 1) + ")" : ""), 180, y + 38, 9.5, P.text, "center", 700, 300);
      txt("Fragments +" + (15 * e) + " %", 180, y + 53, 9, P.frag, "center", 800);
    } else txt(maxE > 0 ? "Choisis une Éclipse avec + pour corser la nuit" : "Gagne avec ce Gardien pour ouvrir l'Éclipse 1", 180, y + 42, 9, P.dim, "center", 600, 300);
  }

  // ================================================================ navigation, surcouche, clavier
  const MENU_SCENES = { OBSERVATORY: 1, GRIMOIRE: 1, DEFIS: 1, DAILY: 1, SELECT: 1 };
  Meta.isMenu = (sc) => !!MENU_SCENES[sc] || !!Meta.overlay;
  Meta.overlay = null;
  /** Ouvre un écran méta depuis le titre (ou le Grimoire en surcouche pendant la pause). */
  Meta.open = function (scene, opts) {
    if (scene === "DEFIS") { GR.tab = 5; GR.viaDefis = true; scene = "GRIMOIRE"; }
    else if (opts && typeof opts.tab === "number") { GR.tab = opts.tab; GR.viaDefis = false; }
    else if (scene === "GRIMOIRE" && GR.viaDefis) { GR.tab = 0; GR.viaDefis = false; } // le Grimoire ne rouvre pas sur l'onglet du raccourci « Défis »
    if (BE.state.paused || (BE.Run.IN_GAME[BE.state.scene] && scene === "GRIMOIRE")) { Meta.openOverlay(); return; }
    BE.Run.go(scene);
  };
  Meta.openOverlay = function () {
    if (GR.viaDefis) { GR.tab = 0; GR.viaDefis = false; }
    Meta.overlay = { type: "GRIMOIRE", t: BE.state.time };
    SCR.y = SCR.byTab[GR.tab] || 0; SCR.vy = 0;
    BE.emit("ui:tap", {});
  };
  Meta.close = function () {
    commitSeen();
    if (Meta.overlay) { Meta.overlay = null; SCR.view = null; BE.emit("ui:tap", {}); return; }
    BE.Run.go(BE.state.scene === "GRIMOIRE" && GR.from ? GR.from : "TITLE");
  };
  /** Surcouche : Grimoire de la pause + notifications. Appelée par BE.UI.draw (au-dessus de tout). */
  Meta.drawOverlay = function (gg, st) {
    g = gg || BE.Render.ctx;
    if (Meta.overlay && !st.paused) Meta.overlay = null;
    if (Meta.overlay) {
      const k = U.clamp((st.time - Meta.overlay.t) / 0.2, 0, 1);
      g.globalAlpha = k;
      g.fillStyle = P.bg0; BE.Render.fillScreen(g);
      BE.Render.drawBackground(st.time);
      g.fillStyle = "rgba(7,10,20,0.35)"; BE.Render.fillScreen(g);
      BE.UI.region("ovlBg", 0, 0, D.W, D.H, () => {}, false);
      drawGrimoire(st, false);
      g.globalAlpha = 1;
    }
    drawNotes(st);
  };
  /**
   * Les cartes n'interrompent jamais le jeu : pendant une nuit (tir, décompte, nuit gagnée…) elles attendent ; à l'Aube
   * elles arrivent 1,5 s après l'entrée, en bas (au-dessus de « Nuit suivante »), sans couvrir l'en-tête ni l'or.
   */
  function notePlace(st) {
    const sc = st.scene, since = st.time - ((BE.UI && BE.UI.sceneAt) || 0);
    if (BE.Run.IN_GAME[sc] || sc === "SETTLE_CANDLE") return null;
    if (sc === "SHOP") return since < 1.5 || (BE.UI && (BE.UI.panel || BE.UI.sel)) ? null : { y: 512 };
    if (sc === "RUN_END") return since < 1.0 ? null : { y: 6 };
    return { y: 6 };
  }
  function drawNotes(st) {
    if (!notes.length) return;
    const n = notes[0];
    const place = notePlace(st);
    if (!place && n.t0 === null) return;
    if (!place) { n.t0 = null; return; } // interrompue (retour en jeu) : elle repassera plus tard
    if (n.t0 === null) {
      if (n.kind === "room" && !(Meta.canBuildAny() && Meta.nextRoom().room.id === n.id)) { notes.shift(); return; }
      n.t0 = st.time; n.dur = notes.length > 2 ? 1.8 : 2.6;
      if (!n.chimed) n.chimed = true, chime(n.kind === "defi" ? [0, 4, 7, 12] : [0, 7, 12], 95, n.kind === "defi" ? 659.25 : 523.25);
    }
    const k = st.time - n.t0, dur = n.dur;
    if (k > dur) { notes.shift(); return; }
    const kin = U.easeOutBack(U.clamp(k / 0.35, 0, 1)), kout = U.clamp((dur - k) / 0.3, 0, 1);
    const h = 50;
    // toujours entièrement à l'écran : léger glissement + fondu (entrée et sortie)
    const y = place.y - (1 - kin) * 14 + (1 - kout) * (place.y > 300 ? 12 : -12);
    g.globalAlpha = Math.min(U.clamp(k / 0.2, 0, 1), kout);
    const x = 20, w = 320;
    g.fillStyle = "rgba(0,0,0,0.45)"; rr(x, y + 4, w, h, 16); g.fill();
    const gr = g.createLinearGradient(0, y, 0, y + h); gr.addColorStop(0, "#26306a"); gr.addColorStop(1, "#141a40");
    g.fillStyle = gr; rr(x, y, w, h, 16); g.fill();
    g.strokeStyle = U.rgba(n.color || P.or, 0.8); g.lineWidth = 1.6; rr(x, y, w, h, 16); g.stroke();
    // reflet qui balaie
    const sx = x + ((k * 1.2) % 1.6) * w - 40;
    g.save(); rr(x, y, w, h, 16); g.clip();
    const sg = g.createLinearGradient(sx, 0, sx + 60, 0); sg.addColorStop(0, "rgba(255,255,255,0)"); sg.addColorStop(0.5, "rgba(255,255,255,0.12)"); sg.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = sg; g.fillRect(sx, y, 60, h);
    g.restore();
    glowAt(x + 28, y + h / 2, 28, n.color || P.or, 0.4);
    if (n.kind === "defi") drawItem({ k: "defi", id: n.id, done: true }, x + 28, y + h / 2, 34, true);
    else if (n.kind === "eclipse") moonIcon(x + 28, y + h / 2, 10, n.color || P.frag);
    else fragIcon(x + 28, y + h / 2, 11, n.color || P.frag);
    txt(n.title, x + 54, y + 12, 8.5, n.color || P.or, "left", 900, w - 66);
    txt(n.name, x + 54, y + 26, 12, P.text, "left", 900, w - 66);
    if (n.sub) txt(n.sub, x + 54, y + 40, 8.5, P.dim, "left", 700, w - 66);
    g.globalAlpha = 1;
  }

  /** Clavier des écrans méta. Renvoie true si la touche est consommée (appelée en tête de BE.UI.key). */
  Meta.key = function (e) {
    const sc = BE.state.scene, c = e.code;
    if (Meta.overlay || sc === "GRIMOIRE" || sc === "DEFIS") {
      if (c === "Escape" || (c === "Backspace")) { Meta.close(); return true; }
      if (c === "ArrowLeft" || c === "KeyQ") { setTab(GR.tab - 1); return true; }
      if (c === "ArrowRight" || c === "KeyE") { setTab(GR.tab + 1); return true; }
      if (c === "ArrowUp") { SCR.vy = 0; SCR.y = U.clamp(SCR.y - 80, 0, SCR.max); return true; }
      if (c === "ArrowDown") { SCR.vy = 0; SCR.y = U.clamp(SCR.y + 80, 0, SCR.max); return true; }
      if (c === "PageUp") { SCR.y = U.clamp(SCR.y - 400, 0, SCR.max); return true; }
      if (c === "PageDown") { SCR.y = U.clamp(SCR.y + 400, 0, SCR.max); return true; }
      if (c === "Home") { SCR.y = 0; return true; }
      if (c === "End") { SCR.y = SCR.max; return true; }
      return !!Meta.overlay; // en surcouche, rien ne passe à la pause dessous
    }
    if (BE.UI.modalOpen && BE.UI.modalOpen()) return false;
    if (sc === "OBSERVATORY") {
      if (c === "Escape") { if (OBS.sel) { OBS.sel = null; OBS.confirm = false; } else BE.Run.go("TITLE"); return true; }
      const nav = { ArrowLeft: [0, -1], ArrowRight: [0, 1], ArrowUp: [-1, 0], ArrowDown: [1, 0] }[c];
      if (nav && !OBS.sel) {
        if (OBS.focus < 0) OBS.focus = ROOM_ORDER.indexOf((Meta.nextRoom() || { room: { id: "serre" } }).room.id);
        else {
          const r = U.clamp(Math.floor(OBS.focus / 2) + nav[0], 0, 3), cc = U.clamp(OBS.focus % 2 + nav[1], 0, 1);
          OBS.focus = r * 2 + cc;
        }
        BE.emit("ui:tap", {}); return true;
      }
      if ((c === "Enter" || c === "Space") && !e.repeat) {
        if (OBS.sel) { if (!Meta.built(OBS.sel)) buildRoom(OBS.sel); else OBS.sel = null; return true; }
        if (OBS.focus >= 0) { OBS.sel = ROOM_ORDER[OBS.focus]; OBS.confirm = false; OBS.selT = BE.state.time; BE.emit("ui:tap", {}); return true; }
      }
      if (c === "KeyD") { Meta.open("DEFIS"); return true; }
      return false;
    }
    if (sc === "DAILY") {
      if (c === "Escape") { BE.Run.go("TITLE"); return true; }
      if ((c === "Enter" || c === "Space") && BE.UI.focus < 0 && !e.repeat) { Meta.startDaily(); return true; }
      return false;
    }
    if (sc === "SELECT") {
      const n = D.GARDIENS.length;
      if (c === "Escape") { BE.Run.go("TITLE"); return true; }
      if (c === "ArrowLeft") { SEL.idx = (SEL.idx + n - 1) % n; SEL.confirm = false; BE.emit("ui:tap", {}); return true; }
      if (c === "ArrowRight") { SEL.idx = (SEL.idx + 1) % n; SEL.confirm = false; BE.emit("ui:tap", {}); return true; }
      const gd = D.GARDIENS[SEL.idx];
      if (c === "ArrowUp" || c === "ArrowDown") {
        const mx = Meta.maxEclipse(gd.id), cur = SEL.ecl[gd.id] || 0;
        SEL.ecl[gd.id] = U.clamp(cur + (c === "ArrowUp" ? 1 : -1), 0, mx);
        BE.emit("ui:tap", {}); return true;
      }
      if ((c === "Enter" || c === "Space") && BE.UI.focus < 0 && !e.repeat) {
        const r = BE.UI.regions().find((x) => x.id === "launch");
        if (r) BE.UI.click(r.x + r.w / 2, r.y + r.h / 2);
        return true;
      }
    }
    return false;
  };

  /** Extras du titre : compteur de Fragments, pastilles sur Observatoire / Grimoire. ry = y des boutons ronds. */
  Meta.drawTitleExtras = function (gg, st, ry) {
    g = gg || BE.Render.ctx;
    const t = st.time, m = meta();
    fragChip(350, 26, m.fragments, st.frameDt);
    // ry : ordonnée des boutons ronds (ancienne mise en page) ou {obs:{x,y}, grim:{x,y}} (pastilles des boutons)
    const P0 = typeof ry === "number" ? { obs: { x: 124, y: ry - 14 }, grim: { x: 194, y: ry - 14 } } : ry;
    if (P0) {
      if (Meta.canBuildAny()) {
        glowAt(P0.obs.x, P0.obs.y, 12, P.frag, 0.5);
        g.fillStyle = P.frag; g.beginPath(); g.arc(P0.obs.x, P0.obs.y, 4 + Math.sin(t * 5) * 0.8, 0, TAU); g.fill();
      }
      if (Meta.unseen().n) { g.fillStyle = P.frag; g.beginPath(); g.arc(P0.grim.x, P0.grim.y, 4 + Math.sin(t * 5 + 1) * 0.8, 0, TAU); g.fill(); }
    }
  };

  /** Thème cosmétique « Aurore » (D16) : voiles lumineux dans le bocal. Appelé par Render.drawJarGlass. */
  Meta.drawJarTheme = function (gg, run, l, r, top, bot) {
    const m = meta();
    if (!m.flags.themeAurore || !Meta.defiDone("D16")) return;
    const t = BE.state.time;
    gg.save();
    gg.beginPath(); gg.rect(l, top, r - l, bot - top); gg.clip();
    gg.globalCompositeOperation = "lighter";
    const cols = ["#6ee07a", "#5ee7ff", "#c7a6ff"];
    cols.forEach((col, i) => {
      const y0 = top + 26 + i * 22;
      const gr = gg.createLinearGradient(0, y0 - 20, 0, y0 + 40);
      gr.addColorStop(0, U.rgba(col, 0)); gr.addColorStop(0.4, U.rgba(col, 0.1)); gr.addColorStop(1, U.rgba(col, 0));
      gg.fillStyle = gr;
      gg.beginPath(); gg.moveTo(l, y0 + 40);
      for (let x = l; x <= r + 10; x += 12) gg.lineTo(x, y0 + Math.sin(x * 0.03 + t * (0.4 + i * 0.13) + i * 2) * 10);
      gg.lineTo(r, y0 + 40); gg.closePath(); gg.fill();
    });
    gg.restore();
  };

  // ================================================================ branchement (scènes + écrans)
  (function register() {
    const SC = BE.Run && BE.Run.SCENES;
    const duckOn = () => { if (BE.Audio) BE.Audio.music.duck(true); };
    const duckOff = () => { if (BE.Audio) BE.Audio.music.duck(false); };
    if (SC) {
      SC.SELECT = { enter() { selInit(); duckOn(); }, exit: duckOff };
      SC.OBSERVATORY = { enter() { OBS.sel = null; OBS.confirm = false; OBS.focus = -1; fragShown = null; duckOn(); }, exit() { OBS.anim = null; duckOff(); } };
      SC.GRIMOIRE = {
        enter() { GR.from = BE.state.prevScene === "OBSERVATORY" ? "OBSERVATORY" : "TITLE"; SCR.y = SCR.byTab[GR.tab] || 0; SCR.vy = 0; duckOn(); },
        exit() { commitSeen(); SCR.byTab[GR.tab] = SCR.y; SCR.view = null; duckOff(); },
      };
      SC.DAILY = { enter() { DS.saved = BE.Save.loadRun(); DS.confirm = false; duckOn(); }, exit: duckOff };
    }
    if (BE.UI && BE.UI.SCREENS) {
      Object.assign(BE.UI.SCREENS, {
        SELECT: drawSelect,
        OBSERVATORY: drawObservatory,
        GRIMOIRE: (st) => drawGrimoire(st, false),
        DEFIS: (st) => drawGrimoire(st, true),
        DAILY: drawDaily,
      });
    }
  })();
  Meta.SCREENS = { SELECT: drawSelect, OBSERVATORY: drawObservatory, GRIMOIRE: drawGrimoire, DAILY: drawDaily };

  // ================================================================ outils de développement / tests
  Meta.dev = {
    frags(n) { meta().fragments += n | 0; Meta.flush(true); return meta().fragments; },
    defi(id) { return Meta.completeDefi(id); },
    room(id) { if (!Meta.built(id)) meta().rooms.push(id); Meta.flush(true); },
    unlockAll() {
      const m = meta();
      for (const r of D.ROOMS) if (m.rooms.indexOf(r.id) < 0) m.rooms.push(r.id);
      for (const d of D.DEFIS) Meta.completeDefi(d.id, true);
      for (const gd of D.GARDIENS) { unlockGardien(gd.id); m.eclipses[gd.id] = 8; }
      Meta.flush(true);
    },
    discoverAll() {
      const G = meta().grimoire;
      for (const r of D.RELICS) if (G.relics.indexOf(r.id) < 0) G.relics.push(r.id);
      for (const k in D.REACTIONS) G.reactions[k] = (G.reactions[k] || 0) + 3;
      for (const k in D.SHADOWS) if (G.ombres.indexOf(k) < 0) G.ombres.push(k);
      for (const k in D.BOSSES) if (G.ombres.indexOf("boss:" + k) < 0) G.ombres.push("boss:" + k);
      for (const e of D.EVOLUTIONS) if (G.evolutions.indexOf(e.id) < 0) G.evolutions.push(e.id);
      for (let s = 3; s <= 8; s++) G.stars[s] = (G.stars[s] || 0) + 2;
      Meta.flush(true);
    },
    reset() { BE.Save.wipe(); if (BE.state) { BE.state.meta = BE.Save.loadMeta(); BE.settings = BE.state.meta.settings; } },
    notes: () => notes.length,
  };
})(window.BE = window.BE || {});
