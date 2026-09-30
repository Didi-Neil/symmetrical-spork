/* 01_data.js — BE.DATA : toutes les tables de contenu et de réglage (GDD). Les valeurs chiffrées s'ajustent ICI uniquement. */
(function (BE) {
  "use strict";

  const D = (BE.DATA = {});

  // ================================================================ Géométrie (§4)
  D.W = 360; D.H = 640;
  D.GEOM = {
    hudH: 44,
    phare: { x: 180, y: 62, r: 22 },
    bagBtn: { x: 60, y: 62 },
    swapBtn: { x: 300, y: 62 },
    pauseBtn: { x: 336, y: 22 },
    wallL: 16, wallR: 344,
    etauL: 36, etauR: 324,
    ceil: 44,
    flightToJar: 340,
    liveY: 352,
    horizon: 380,
    floor: 616,
    relicBandY: 618,
    relicX: [84, 132, 180, 228, 276],
    ghostY: 90,
    cols: [45, 99, 153, 207, 261, 315],
    rows: [120, 166, 212, 258, 304],
    shadowR: 18,
    pegCols: [72, 126, 180, 234, 288],
    pegRows: [143, 189, 235, 281],
    pegR: 5,
    /** Emplacements spéciaux → index de clou (r*5+c). */
    slots: { A: 1, B: 3, C: 7, D: 11, E: 13, F: 17 },
    slotPairs: [["A", "C"], ["B", "C"], ["C", "D"], ["C", "E"], ["D", "F"], ["E", "F"]],
    jarArea: 77408,
    aimMin: 12, aimMax: 168,
    bossR: 40,
  };

  // ================================================================ Physique (§5)
  D.PHYS = {
    dt: 1 / 120,
    maxStepsPerFrame: 8,
    flight: {
      v0: 560, filante: 1.35, g: 650, vmax: 900,
      ePeg: 0.78, eSeve: 0.95, eLestee: 0.35, eRessort: 1.25,
      eShadow: 0.7, eWall: 0.85, tangent: 0.98, vminHit: 140, cooldown: 0.12,
      ignoreAfter: 14,
    },
    jar: {
      g: 980, e: 0.1, eWall: 0.15, eStone: 0.05, mu: 0.25, damp: 0.998, iters: 6,
      beta: 0.6, slop: 0.3, sleepV: 6, sleepT: 0.4, wakeV: 30, restMax: 6, vEnter: 600, maxBodies: 60,
      stoneMass: 1.5, mergeMinAge: 2,
    },
    speed: { auto2: 3.5, auto3: 5.5, hold: 3, cap: 4, countHold: 4 },
    previewSteps: 240,
  };

  // ================================================================ Étoiles (§5.2)
  D.SIZES = [
    null,
    { size: 1, nom: "Poussière", r: 14, mult: 0, emoji: "▫️" },
    { size: 2, nom: "Étincelle", r: 19, mult: 1, emoji: "▫️" },
    { size: 3, nom: "Astre", r: 25, mult: 2, emoji: "⭐" },
    { size: 4, nom: "Soleil", r: 32, mult: 3, emoji: "🌟" },
    { size: 5, nom: "Géante", r: 40, mult: 5, emoji: "🟠" },
    { size: 6, nom: "Nova", r: 50, mult: 8, emoji: "💥" },
    { size: 7, nom: "Trou Noir", r: 62, mult: 13, emoji: "🕳️" },
  ];
  D.MAX_LAUNCH_SIZE = 5;
  D.MAX_SIZE = 7;
  D.BIGBANG = { xMult: 10, emoji: "🌌" };
  D.ALCHIMISTE_TN = 21;

  // ================================================================ Familles (§5.6)
  D.FAMILIES = {
    braise: { id: "braise", nom: "Braise", color: "#ff6b3d", room: null,
      flight: "Brûlure : 1 dégât à la fin des 3 tirs suivants", jar: "Fusion : explosion (brise les Pierres, souffle)" },
    givre: { id: "givre", nom: "Givre", color: "#5ee7ff", room: null,
      flight: "Gèle l'Ombre touchée (saute sa descente)", jar: "Fusion : +2 Éclat par Givre dans le bocal" },
    seve: { id: "seve", nom: "Sève", color: "#6ee07a", room: "serre",
      flight: "Rebondit plus. Grossit au 3e clou", jar: "Fusion : +1 Mult" },
    foudre: { id: "foudre", nom: "Foudre", color: "#ffe14d", room: null,
      flight: "+1 dégât aux Ombres", jar: "Au repos : tire un éclair (dégâts = taille)" },
  };
  D.FAMILY_ORDER = ["braise", "givre", "seve", "foudre"];
  D.BURN_TURNS = 3;
  D.BRAISE_EXPLOSION = { extraR: 30, impulse: 250 };
  D.GIVRE_ECLAT = 2;
  D.SEVE_MULT = 1;
  D.SEVE_GROW_AT = 3;

  // ================================================================ Réactions (§5.7)
  D.REACTIONS = {
    vapeur: { id: "vapeur", nom: "Vapeur", pair: ["braise", "givre"], color: "#dfe8ff", freq: 523.25, mult: 3, push: 300,
      txt: "+3 Mult. Tout le bocal se tasse.", hint: "Le feu qui embrasse le froid pèse sur toute chose." },
    plasma: { id: "plasma", nom: "Plasma", pair: ["braise", "foudre"], color: "#ff9d3d", freq: 587.33,
      txt: "La colonne d'Ombres la plus proche subit 2 × taille dégâts.", hint: "Quand la braise épouse l'orage, le ciel se fend en droite ligne." },
    cendre: { id: "cendre", nom: "Cendre", pair: ["braise", "seve"], color: "#b0a080", freq: 659.25, gold: 2,
      txt: "Brise la Pierre Noire la plus proche, +2 or.", hint: "Ce que la forêt brûle devient trésor." },
    ronce: { id: "ronce", nom: "Ronce", pair: ["givre", "seve"], color: "#a0ffd0", freq: 783.99,
      txt: "Un clou de la dernière rangée devient Clou double jusqu'à la fin de la Lune.", hint: "La sève gelée pousse des épines d'argent." },
    tempete: { id: "tempete", nom: "Tempête", pair: ["givre", "foudre"], color: "#b6f0ff", freq: 880,
      txt: "Gèle toute la rangée d'Ombres la plus basse.", hint: "Le froid et l'orage s'évitent… sauf dans la tempête." },
    photosynthese: { id: "photosynthese", nom: "Photosynthèse", pair: ["seve", "foudre"], color: "#d8ff6a", freq: 1046.5,
      txt: "La prochaine étoile lancée gagne +1 taille.", hint: "La lumière nourrit ce qui pousse." },
  };
  D.AURORE = { id: "aurore", nom: "Aurore", distinct: 3, xMult: 2, room: "planetarium",
    hint: "Trois lueurs dans une même nuit, et le ciel danse." };
  /** Réaction d'une paire de familles (ordre indifférent), ou null. */
  D.reactionFor = function (a, b) {
    for (const k in D.REACTIONS) {
      const p = D.REACTIONS[k].pair;
      if ((p[0] === a && p[1] === b) || (p[0] === b && p[1] === a)) return k;
    }
    return null;
  };

  // ================================================================ Ombres (§6.3)
  D.SHADOWS = {
    rampante: { id: "rampante", nom: "Rampante", hp: 3, speed: 1, stone: 1, r: 18, txt: "Descend à chaque tir." },
    lourde: { id: "lourde", nom: "Lourde", hp: 8, speed: 2, stone: 4, r: 18, txt: "Tombe en grosse Pierre." },
    lanterne: { id: "lanterne", nom: "Lanterne", hp: 4, speed: 2, stone: 1, r: 18, bonusShot: 1, txt: "Tuée : +1 tir cette nuit." },
    blindee: { id: "blindee", nom: "Blindée", hp: 5, speed: 2, stone: 3, r: 18, armor: 2, txt: "Armure 2 : les petites étoiles glissent." },
    voleuse: { id: "voleuse", nom: "Voleuse", hp: 5, speed: 1, stone: 2, r: 18, absorb: true, txt: "Si elle survit au coup, elle vole l'étoile." },
    nuee: { id: "nuee", nom: "Nuée", hp: 6, speed: 2, stone: 2, r: 18, split: 0.4, txt: "Se divise en 2 Rampantes." },
    eteignoir: { id: "eteignoir", nom: "Éteignoir", hp: 6, speed: 2, stone: 2, r: 18, dousing: true, txt: "Éteint les 4 clous qui l'entourent." },
    mere: { id: "mere", nom: "Mère-Ombre", hp: 20, speed: 3, stone: 5, r: 22, elite: true, layEvery: 2, gold: 3,
      txt: "Élite : pond des Rampantes. Tuée : +3 or et Coffre." },
  };
  D.SHADOW_CONTACT_ECLAT = 3;
  D.STONE_MULT = 2;          // Pierre Noire brisée : +2 Mult (§6.5)
  D.STONE_BREAK_GAP = 4;     // brisée si dist ≤ r_new + r_pierre + 4 (§5.5)

  // ================================================================ Boss (§6.4)
  D.BOSS = { r: 40, hp: 30, every: 3, gold: 5, col: 2, row: 0, pegCover: 5 };
  D.BOSSES = {
    faim: { id: "faim", nom: "La Faim", avail: "base", rule: "Après les tirs 3 et 6, dévore la plus grosse étoile du bocal.", color: "#ff7a9a" },
    voile: { id: "voile", nom: "Le Voile", avail: "base", rule: "L'étoile suivante est cachée. Pas d'échange.", color: "#9aa4ff" },
    avare: { id: "avare", nom: "L'Avare", avail: "base", rule: "Les clous gris ne donnent aucun Éclat.", color: "#ffd166" },
    grele: { id: "grele", nom: "La Grêle", avail: "base", rule: "Après chaque tir, une Pierre Noire tombe.", color: "#9fb3d9" },
    maree: { id: "maree", nom: "La Marée", avail: "cartes", rule: "Gravité du bocal ×1,5, du vol ×1,3.", color: "#5ee7ff", jarG: 1.5, flightG: 1.3 },
    etau: { id: "etau", nom: "L'Étau", avail: "cartes", rule: "Les murs du bocal se resserrent.", color: "#ff9d3d" },
    eclipse: { id: "eclipse", nom: "L'Éclipse", avail: "final", rule: "Mult final ÷2 tant qu'elle vit. Sous 50 % : Le Voile.", color: "#c7a6ff",
      hpFlat: 200 / 4.6, final: true },
  };
  D.BOSS_POOL_BASE = ["faim", "voile", "avare", "grele"];
  D.BOSS_POOL_CARTES = ["maree", "etau"];

  // ================================================================ Courbes (§6.1)
  D.HP_MULT = [1, 1.0, 1.6, 2.4, 3.4, 4.6];
  D.hpMult = (L) => (L <= 5 ? D.HP_MULT[L] : 4.6 * Math.pow(1.35, L - 5));
  // Quotas réglés au bot greedy (§13.3, méta neuve) — voir docs/ARCHITECTURE.md §16.3. Référence GDD §6.1 : 80, 260, 850, 2 800, 9 000.
  D.QUOTA_BASE = [0, 120, 700, 1300, 2700, 3000];
  D.NIGHT_FACTOR = [1, 1.5, 2];
  D.NIGHT_NAMES = ["Nuit Mince", "Nuit Pleine", "Nuit du Boss"];
  D.NIGHT_SHORT = ["MINCE", "PLEINE", "BOSS"];
  D.LUNES = 5;
  D.quota = function (L, nuit, eclipse) {
    const base = L <= 5 ? D.QUOTA_BASE[L] : D.QUOTA_BASE[5] * Math.pow(3.5, L - 5); // Nuit Blanche : ×3,5 par Lune
    let q = base * D.NIGHT_FACTOR[nuit] * ((eclipse || 0) >= 1 ? 1.25 : 1);
    return Math.max(10, Math.round(q / 10) * 10);
  };

  // ================================================================ Apparitions (§6.2)
  D.SPAWNS = [
    null,
    { initial: 4, perShot: [1], weights: { rampante: 90, lanterne: 10 } },
    { initial: 5, perShot: [1, 2, 1, 2, 1, 2], weights: { rampante: 50, lourde: 25, lanterne: 15, blindee: 10 } },
    { initial: 6, perShot: [2], weights: { rampante: 35, lourde: 20, lanterne: 10, blindee: 15, voleuse: 20 } },
    { initial: 7, perShot: [2], weights: { rampante: 25, lourde: 20, lanterne: 10, blindee: 15, voleuse: 15, nuee: 10, eteignoir: 5 } },
    { initial: 8, perShot: [2, 3, 2, 3, 2, 3], weights: { rampante: 20, lourde: 20, lanterne: 8, blindee: 15, voleuse: 15, nuee: 12, eteignoir: 10 } },
  ];
  D.spawnsFor = (L) => D.SPAWNS[Math.min(L, 5)];
  /** Nouveauté présentée par Lune (mini-carte « Nouvelle Ombre »). */
  D.NEW_SHADOWS = [null, ["rampante", "lanterne"], ["lourde", "blindee", "mere"], ["voleuse"], ["nuee", "eteignoir"], []];

  // ================================================================ Dispositions de clous (§4.1)
  D.LAYOUTS = [
    { id: "grille", nom: "Grille", rows: ["11111", "11111", "11111", "11111"] },
    { id: "entonnoir", nom: "Entonnoir", rows: ["11111", "11111", "01110", "01110"] },
    { id: "diamant", nom: "Diamant", rows: ["01110", "11111", "11111", "01110"] },
    { id: "colonnes", nom: "Colonnes", rows: ["10101", "11111", "10101", "11111"] },
    { id: "arche", nom: "Arche", rows: ["11011", "10001", "11111", "11011"] },
    { id: "pluie", nom: "Pluie", rows: ["11111", "01010", "11111", "01010"] },
  ];

  // ================================================================ Économie (§7.3, §8)
  D.ECO = {
    startGold: 4,
    nightReward: [3, 4, 5],
    unusedShot: 1,
    interestPer: 5, interestCap: 5,
    bossGold: 5,
    vidangeMinSize: 4, vidangeMax: 5,
    relicPrice: { C: 4, PC: 6, R: 8, L: 10 },
    reroll: 2,
    shotsPerNight: 6,
    swaps: 1,
    relicSlots: 5,
    bagMax: 20, bagMin: 6, purge: 2,
    offers: 3,
    constellation: 4,
    gravure: 3,
    clou: 5,
    clouRefund: 0.5,          // clou remplacé : revendu à 50 % (arrondi inférieur)
    relicMinPrice: 2,
  };
  /** Poids des types d'offre de l'Aube (flux shop). Un type sans contenu débloqué est ignoré. */
  D.OFFER_WEIGHTS = { relic: 50, star: 22, clou: 15, gravure: 13 };
  /** Paquet Constellation (§10.5) : 3 rouleaux, 1 carte au choix ; 3 cartes du même type = JACKPOT (2 choix). */
  D.PACK = { cards: 3, picks: 1, jackpotPicks: 2, weights: { relic: 40, star: 25, clou: 20, gravure: 15 },
    chestStarSizes: [3, 4], reelStop: 0.4 };
  /** Rareté +1 (Coffre de la Mère-Ombre). */
  D.RARITY_UP = { C: "PC", PC: "R", R: "R" };
  D.STAR_OFFERS = [
    { size: 2, price: 3, minLune: 1 },
    { size: 3, price: 4, minLune: 1 },
    { size: 4, price: 6, minLune: 3 },
  ];
  D.RARITY = {
    C: { nom: "Commune", color: "#8a93b8", weight: 70 },
    PC: { nom: "Peu commune", color: "#4f8bff", weight: 25 },
    R: { nom: "Rare", color: "#b07cff", weight: 5 },
    L: { nom: "Légendaire", color: "#ffd166", weight: 0 },
  };

  // ================================================================ Reliques (§8.1)
  // Format d'une relique (voir docs/ARCHITECTURE.md §Reliques) :
  //  { id, nom, rar, hook:"C"|"V"|"P"|"C+P", tags, txt, src:{type:"depart"|"defi"|"room", id}, icon, color,
  //    count?(ctx) -> {dEclat?, dMult?, xMult?} | null,
  //    flight?: { dmgBonus?(star)->n, restPeg?(star,peg)->e|undefined, onLaunch?(S), onKill?(S,target) },
  //    passive?: { interestCap, swaps, horizon, previewContacts, hpMult, unusedShotBonus, bolts, horloge, goldPerKill, alchimiste, firstMergeTwice, sablier } }
  const R = (o) => o;
  D.RELICS = [
    R({ id: "R01", nom: "Loupe", rar: "C", hook: "C", tags: ["ÉCLAT", "OMBRE"], icon: "loupe", color: "#4fb3ff",
      txt: "+2 Éclat par contact d'Ombre ce tir", src: { type: "depart" },
      count: (c) => (c.shadowHits > 0 ? { dEclat: 2 * c.shadowHits } : null) }),
    R({ id: "R02", nom: "Comète", rar: "C", hook: "C", tags: ["ÉCLAT", "REBOND"], icon: "comete", color: "#4fb3ff",
      txt: "+3 Éclat par rebond sur un mur ce tir", src: { type: "depart" },
      count: (c) => (c.wallBounces > 0 ? { dEclat: 3 * c.wallBounces } : null) }),
    R({ id: "R03", nom: "Diapason", rar: "C", hook: "C", tags: ["MULT", "CLOU"], icon: "diapason", color: "#ff4d5e",
      txt: "+1 Mult par tranche de 6 clous touchés ce tir (max +4)", src: { type: "depart" },
      count: (c) => (c.pegTouches >= 6 ? { dMult: Math.min(4, Math.floor(c.pegTouches / 6)) } : null) }),
    R({ id: "R04", nom: "Chandelle", rar: "C", hook: "C", tags: ["ÉCLAT"], icon: "chandelle", color: "#4fb3ff",
      txt: "+10 Éclat si l'étoile n'a touché aucune Ombre", src: { type: "depart" },
      count: (c) => (!c.touchedShadow ? { dEclat: 10 } : null) }),
    R({ id: "R05", nom: "Chasseur", rar: "C", hook: "C", tags: ["MULT", "OMBRE"], icon: "chasseur", color: "#ff4d5e",
      txt: "+2 Mult par Ombre tuée ce tir (tourelles comprises)", src: { type: "depart" },
      count: (c) => (c.kills > 0 ? { dMult: 2 * c.kills } : null) }),
    R({ id: "R06", nom: "Cascade", rar: "C", hook: "C", tags: ["MULT", "FUSION"], icon: "cascade", color: "#ff4d5e",
      txt: "+2 Mult par fusion au-delà de la 1re ce tir", src: { type: "depart" },
      count: (c) => (c.merges.length > 1 ? { dMult: 2 * (c.merges.length - 1) } : null) }),
    R({ id: "R07", nom: "Tirelire", rar: "C", hook: "P", tags: ["OR"], icon: "tirelire", color: "#ffd166",
      txt: "Plafond d'intérêts 5 → 8", src: { type: "depart" }, passive: { interestCap: 8 } }),
    R({ id: "R08", nom: "Corbeau", rar: "C", hook: "V", tags: ["OR", "OMBRE", "RISQUE"], icon: "corbeau", color: "#ffd166",
      txt: "+1 or par Ombre tuée. Les Ombres ont +20 % PV.", src: { type: "depart" }, passive: { hpMult: 1.2, goldPerKill: 1 } }),
    R({ id: "R09", nom: "Boussole", rar: "C", hook: "P", tags: ["UTIL"], icon: "boussole", color: "#eef2ff",
      txt: "L'aperçu de trajectoire affiche +1 contact", src: { type: "depart" }, passive: { previewContacts: 1 } }),
    R({ id: "R10", nom: "Géante rouge", rar: "C", hook: "V", tags: ["OMBRE"], icon: "geante", color: "#ff6b3d",
      txt: "Les étoiles de taille ≥ 3 infligent +2 dégâts", src: { type: "depart" },
      flight: { dmgBonus: (star) => (star.size >= 3 ? 2 : 0) } }),
    R({ id: "R11", nom: "Horloge", rar: "C", hook: "P", tags: ["DÉFENSE"], icon: "horloge", color: "#eef2ff",
      txt: "Aux 3e et 6e tirs, les Ombres ne descendent pas", src: { type: "depart" }, passive: { horloge: true } }),
    R({ id: "R12", nom: "Poids plume", rar: "C", hook: "C", tags: ["ÉCLAT", "SAC"], icon: "plume", color: "#4fb3ff",
      txt: "+1 Éclat par clou touché si l'étoile lancée est de taille 1 ou 2", src: { type: "depart" },
      count: (c) => (c.launchedSize <= 2 && c.pegTouches > 0 ? { dEclat: c.pegTouches } : null) }),
    R({ id: "R13", nom: "Télescope", rar: "PC", hook: "C", tags: ["MULT", "FUSION"], icon: "telescope", color: "#ff4d5e",
      txt: "+4 Mult par fusion de taille ≥ 4 ce tir", src: { type: "defi", id: "D01" },
      count: (c) => { const n = c.merges.filter((m) => m.size >= 4).length; return n ? { dMult: 4 * n } : null; } }),
    R({ id: "R14", nom: "Balance", rar: "PC", hook: "C", tags: ["xMULT", "BOCAL"], icon: "balance", color: "#ff4d5e",
      txt: "×2 Mult si le bocal est rempli à moins de 40 %", src: { type: "defi", id: "D02" },
      count: (c) => (c.jarFill < 0.4 ? { xMult: 2 } : null) }),
    R({ id: "R15", nom: "Alchimiste", rar: "PC", hook: "V", tags: ["PURE", "MULT"], icon: "alchimiste", color: "#ff4d5e",
      txt: "Les fusions pures donnent le Mult d'une taille au-dessus (Trou Noir : +21)", src: { type: "defi", id: "D03" }, passive: { alchimiste: true } }),
    R({ id: "R16", nom: "Vitrail", rar: "PC", hook: "C", tags: ["MULT", "RÉACTION"], icon: "vitrail", color: "#ff4d5e",
      txt: "+2 Mult par couleur présente dans le bocal (max +8)", src: { type: "room", id: "bibliotheque" },
      count: (c) => (c.jarColors.length ? { dMult: Math.min(8, 2 * c.jarColors.length) } : null) }),
    R({ id: "R17", nom: "Paratonnerre", rar: "PC", hook: "V", tags: ["FOUDRE", "OMBRE"], icon: "paratonnerre", color: "#ffe14d",
      txt: "Les étoiles Foudre du bocal tirent 2 éclairs", src: { type: "room", id: "bibliotheque" }, passive: { bolts: 2 } }),
    R({ id: "R18", nom: "Carrière", rar: "PC", hook: "C", tags: ["DÉCHET", "MULT"], icon: "carriere", color: "#ff4d5e",
      txt: "+3 Mult par Pierre Noire brisée ce tir", src: { type: "defi", id: "D04" },
      count: (c) => (c.stonesBroken ? { dMult: 3 * c.stonesBroken } : null) }),
    R({ id: "R19", nom: "Métronome", rar: "PC", hook: "C", tags: ["MULT", "FUSION"], icon: "metronome", color: "#ff4d5e",
      txt: "+1 Mult cumulé par tir consécutif avec au moins 1 fusion (remis à 0 sans fusion et à chaque nuit)", src: { type: "room", id: "bibliotheque" },
      count: (c) => (c.metronome > 0 ? { dMult: c.metronome } : null) }),
    R({ id: "R20", nom: "Le Comptable", rar: "R", hook: "C", tags: ["OR", "MULT"], icon: "comptable", color: "#ffd166",
      txt: "+1 Mult par tranche de 5 or détenus (max +8)", src: { type: "room", id: "bibliotheque" },
      count: (c) => (c.gold >= 5 ? { dMult: Math.min(8, Math.floor(c.gold / 5)) } : null) }),
    R({ id: "R21", nom: "Sablier", rar: "PC", hook: "V", tags: ["SAC"], icon: "sablier", color: "#eef2ff",
      txt: "La 1re étoile de chaque nuit est lancée deux fois (copie 0,4 s après, sans consommer de tir)", src: { type: "defi", id: "D05" }, passive: { sablier: true } }),
    R({ id: "R22", nom: "Glaneur", rar: "PC", hook: "P", tags: ["OR"], icon: "glaneur", color: "#ffd166",
      txt: "+1 or supplémentaire par tir non utilisé", src: { type: "room", id: "bibliotheque" }, passive: { unusedShotBonus: 1 } }),
    R({ id: "R23", nom: "Échangeur", rar: "PC", hook: "P", tags: ["SAC", "UTIL"], icon: "echangeur", color: "#eef2ff",
      txt: "+2 échanges par nuit", src: { type: "room", id: "bibliotheque" }, passive: { swaps: 2 } }),
    R({ id: "R24", nom: "Pression", rar: "R", hook: "C", tags: ["xMULT", "BOCAL"], icon: "pression", color: "#ff4d5e",
      txt: "×(1 + 0,1 × étoiles dans le bocal) Mult (Pierres exclues)", src: { type: "room", id: "crypte" },
      count: (c) => (c.jarStars > 0 ? { xMult: 1 + 0.1 * c.jarStars } : null) }),
    R({ id: "R25", nom: "Catalyseur", rar: "R", hook: "C", tags: ["xMULT", "RÉACTION"], icon: "catalyseur", color: "#ff4d5e",
      txt: "×1,5 Mult par réaction déclenchée ce tir", src: { type: "defi", id: "D06" },
      count: (c) => (c.reactions.length ? { xMult: Math.pow(1.5, c.reactions.length) } : null) }),
    R({ id: "R26", nom: "Dernier Souffle", rar: "R", hook: "C", tags: ["xMULT"], icon: "souffle", color: "#ff4d5e",
      txt: "×3 Mult sur le dernier tir disponible de la nuit", src: { type: "room", id: "crypte" },
      count: (c) => (c.isLastShot ? { xMult: 3 } : null) }),
    R({ id: "R27", nom: "Verre soufflé", rar: "R", hook: "C+P", tags: ["xMULT", "RISQUE", "BOCAL"], icon: "verre", color: "#9fb3d9",
      txt: "×2,5 Mult. La ligne d'horizon descend de 24 px.", src: { type: "room", id: "crypte" },
      passive: { horizon: 24 }, count: () => ({ xMult: 2.5 }) }),
    R({ id: "R28", nom: "Couronne", rar: "R", hook: "C", tags: ["xMULT", "PURE"], icon: "couronne", color: "#ffd166",
      txt: "×2 Mult si toutes les fusions du tir sont pures", src: { type: "room", id: "crypte" },
      count: (c) => { const m = c.merges.filter((x) => !x.synthetic); return m.length && m.every((x) => x.pure) ? { xMult: 2 } : null; } }),
    R({ id: "R29", nom: "Prisme de poche", rar: "R", hook: "V", tags: ["FUSION"], icon: "prisme", color: "#eef2ff",
      txt: "La 1re fusion de chaque tir compte deux fois (Mult et déclencheurs)", src: { type: "defi", id: "D07" }, passive: { firstMergeTwice: true } }),
    R({ id: "R30", nom: "Singularité", rar: "R", hook: "C", tags: ["xMULT", "BOCAL"], icon: "singularite", color: "#c7a6ff",
      txt: "×(1 + 0,25 × taille de la plus grosse étoile du bocal) Mult", src: { type: "defi", id: "D08" },
      count: (c) => (c.maxJarSize > 0 ? { xMult: 1 + 0.25 * c.maxJarSize } : null) }),
  ];
  D.RELIC_BY_ID = {};
  D.RELICS.forEach((r) => (D.RELIC_BY_ID[r.id] = r));

  // ================================================================ Évolutions (§8.2) — reliques légendaires
  // Même format que les reliques (+ base, reaction, hint). Elles ne sont jamais vendues : l'évolution se fait
  // automatiquement à l'entrée de l'Aube (BE.Shop.evolve) si le Laboratoire est construit, la relique de base
  // possédée et la réaction déclenchée ≥ 3 fois dans le run. Elles sont indexées dans RELIC_BY_ID (pas dans RELICS).
  D.EVOLUTIONS = [
    R({ id: "E1", nom: "Observatoire Ionique", rar: "L", hook: "C+V", tags: ["MULT", "FUSION", "RÉACTION"], icon: "telescope", color: "#ffe14d",
      base: "R13", reaction: "plasma", src: { type: "room", id: "laboratoire" }, evo: true,
      txt: "+4 Mult par fusion de taille ≥ 4. Chaque Plasma compte comme une fusion de taille 4 pour tous les déclencheurs.",
      hint: "L'œil qui regarde loin voudrait voir l'éclair de près.", passive: { plasmaMerge: true },
      count: (c) => { const n = c.merges.filter((m) => m.size >= 4).length; return n ? { dMult: 4 * n } : null; } }),
    R({ id: "E2", nom: "Équilibre", rar: "L", hook: "C", tags: ["xMULT", "BOCAL"], icon: "balance", color: "#dfe8ff",
      base: "R14", reaction: "vapeur", src: { type: "room", id: "laboratoire" }, evo: true,
      txt: "×3 Mult si le bocal est rempli à moins de 50 %", hint: "La vapeur allège les plateaux.",
      count: (c) => (c.jarFill < 0.5 ? { xMult: 3 } : null) }),
    R({ id: "E3", nom: "Queue d'Aurore", rar: "L", hook: "C", tags: ["ÉCLAT", "xMULT", "REBOND"], icon: "comete", color: "#d8ff6a",
      base: "R02", reaction: "photosynthese", src: { type: "room", id: "laboratoire" }, evo: true,
      txt: "+3 Éclat et ×1,1 Mult par rebond sur un mur (max ×3)", hint: "La comète rêve de faire pousser la lumière.",
      count: (c) => (c.wallBounces > 0 ? { dEclat: 3 * c.wallBounces, xMult: Math.min(3, Math.pow(1.1, c.wallBounces)) } : null) }),
    R({ id: "E4", nom: "Œil du Cyclone", rar: "L", hook: "V", tags: ["FOUDRE", "OMBRE", "DÉFENSE"], icon: "paratonnerre", color: "#b6f0ff",
      base: "R17", reaction: "tempete", src: { type: "room", id: "laboratoire" }, evo: true,
      txt: "Les étoiles Foudre du bocal tirent 3 éclairs et gèlent leur cible", hint: "Au cœur de la tempête, la foudre voit clair.",
      passive: { bolts: 3, boltFreeze: true } }),
    R({ id: "E5", nom: "Fonderie", rar: "L", hook: "C+V", tags: ["DÉCHET", "MULT", "OR"], icon: "carriere", color: "#ffb35e",
      base: "R18", reaction: "cendre", src: { type: "room", id: "laboratoire" }, evo: true,
      txt: "+5 Mult et +1 or par Pierre Noire brisée", hint: "La pierre noire fond en or dans les bonnes braises.",
      passive: { goldPerStone: 1 },
      count: (c) => (c.stonesBroken ? { dMult: 5 * c.stonesBroken } : null) }),
    R({ id: "E6", nom: "Harpe Céleste", rar: "L", hook: "C", tags: ["MULT", "CLOU", "ÉCLAT"], icon: "diapason", color: "#a0ffd0",
      base: "R03", reaction: "ronce", src: { type: "room", id: "laboratoire" }, evo: true,
      txt: "+1 Mult toutes les 3 touches de clou. Les Clous doubles donnent +4 Éclat.", hint: "Les épines d'argent chantent quand on les pince.",
      count: (c) => {
        const dm = Math.floor(c.pegTouches / 3), de = 2 * (c.doubleHits || 0);
        return dm || de ? { dMult: dm, dEclat: de } : null;
      } }),
  ];
  D.EVOLUTIONS.forEach((r) => (D.RELIC_BY_ID[r.id] = r));
  D.EVOLUTION_BY_BASE = {};
  D.EVOLUTIONS.forEach((r) => (D.EVOLUTION_BY_BASE[r.base] = r));
  D.EVOLUTION_THRESHOLD = 3;

  // ================================================================ Clous spéciaux (§8.3)
  D.CLOUS = {
    or: { id: "or", nom: "Clou d'or", color: "#ffd166", eclat: 1, gold: 1, goldMax: 3, txt: "+1 or par touche (max 3 par tir), +1 Éclat", pair: "+2 or", src: { type: "depart" } },
    ressort: { id: "ressort", nom: "Clou Ressort", color: "#7dffb0", eclat: 2, rest: 1.25, txt: "Rebond puissant (restitution 1,25), +2 Éclat", pair: "+4 Éclat", src: { type: "depart" } },
    prisme: { id: "prisme", nom: "Clou Prisme", color: "#ffffff", eclat: 1, txt: "1 fois par tir : une étoile de taille ≥ 2 se divise en 2 étoiles plus petites, +1 Éclat", pair: "Moitiés +1 dégât", src: { type: "room", id: "atelier" } },
    echo: { id: "echo", nom: "Clou Écho", color: "#c7a6ff", eclat: 0, txt: "+1 Éclat par clou voisin dans le treillis (max 8)", pair: "Éclat ×2", src: { type: "room", id: "atelier" } },
    cristal: { id: "cristal", nom: "Clou Cristal", color: "#ff4d5e", eclat: 0, mult: 1, multMax: 3, txt: "+1 Mult (max 3 par tir)", pair: "+2 Mult", src: { type: "room", id: "forge" } },
    teint: { id: "teint", nom: "Clou Teinturier", color: "#eef2ff", eclat: 1, txt: "Teint l'étoile qui le touche dans sa couleur (choisie à l'achat), +1 Éclat", pair: "+3 Éclat", src: { type: "defi", id: "D14" } },
  };

  // ================================================================ Gravures (§8.4)
  D.GRAVURES = {
    polie: { id: "polie", nom: "Polie", color: "#bfe6ff", txt: "+1 Éclat par clou touché par cette étoile", src: { type: "depart" } },
    lestee: { id: "lestee", nom: "Lestée", color: "#9aa4c8", txt: "Rebond sur clou 0,35 (tombe presque droit), +1 dégât", src: { type: "depart" } },
    doree: { id: "doree", nom: "Dorée", color: "#ffd166", txt: "+1 or quand elle se pose dans le bocal", src: { type: "room", id: "forge" } },
    filante: { id: "filante", nom: "Filante", color: "#4fb3ff", txt: "Vitesse de lancer ×1,35, +1 Éclat par contact d'Ombre", src: { type: "room", id: "forge" } },
    prismatique: { id: "prismatique", nom: "Prismatique", color: "#e6d6ff", txt: "Fusion toujours pure, quelle que soit l'autre étoile (même avec la Forgeronne)", src: { type: "defi", id: "D13" } },
  };

  // ================================================================ Gardiens (§6.6)
  const BASE_RULES = { relicSlots: 5, shots: 6, swaps: 1, candle: 1, interest: true, previewNext: 1,
    noMixed: false, pureMult: 1.5, goldPerKill: 0, relicDiscount: 0, keepJar: false, finalX: 1, startStones: [] };
  D.GARDIENS = [
    { id: "veilleuse", nom: "La Veilleuse", color: "#ffd166", bag: "standard", unlock: null,
      txt: ["Standard : 5 reliques, 6 tirs par nuit.", "1 échange par nuit, 1 Bougie de secours."], rules: Object.assign({}, BASE_RULES) },
    { id: "astronome", nom: "L'Astronome", color: "#4fb3ff", bag: "standard", unlock: { defi: "D09" },
      txt: ["Voit les 3 étoiles suivantes, 2 échanges.", "Seulement 4 emplacements de relique."], rules: Object.assign({}, BASE_RULES, { relicSlots: 4, swaps: 2, previewNext: 3 }) },
    { id: "forgeronne", nom: "La Forgeronne", color: "#ff6b3d", bag: "forgeronne", unlock: { defi: "D10" },
      txt: ["Pas de fusion mixte ni de réaction.", "Fusions pures : Mult ×2."], rules: Object.assign({}, BASE_RULES, { noMixed: true, pureMult: 2 }) },
    { id: "glaneuse", nom: "La Glaneuse", color: "#6ee07a", bag: "standard", unlock: { defi: "D11" },
      txt: ["Pas d'intérêts. +1 or par Ombre tuée.", "Reliques −1 or."], rules: Object.assign({}, BASE_RULES, { interest: false, goldPerKill: 1, relicDiscount: 1 }) },
    { id: "insomniaque", nom: "L'Insomniaque", color: "#c7a6ff", bag: "standard", unlock: { defi: "D12" },
      txt: ["Le bocal n'est jamais vidé. Mult final ×1,5.", "Commence avec 2 Pierres Noires."], rules: Object.assign({}, BASE_RULES, { keepJar: true, finalX: 1.5, startStones: [2, 2] }) },
  ];
  D.GARDIEN_BY_ID = {};
  D.GARDIENS.forEach((g) => (D.GARDIEN_BY_ID[g.id] = g));

  /** Sacs de départ : listes [couleur, taille]. */
  D.BAGS = {
    standard: [["braise", 1], ["braise", 1], ["braise", 2], ["givre", 1], ["givre", 1], ["givre", 2], ["foudre", 1], ["foudre", 1], ["foudre", 2], ["braise", 2]],
    standardSeve: [["braise", 1], ["braise", 1], ["braise", 2], ["givre", 1], ["givre", 1], ["givre", 2], ["foudre", 1], ["foudre", 2], ["seve", 1], ["seve", 2]],
    forgeronne: [["braise", 1], ["braise", 1], ["braise", 1], ["braise", 2], ["braise", 2], ["givre", 1], ["givre", 1], ["givre", 1], ["givre", 2], ["givre", 2]],
  };

  // ================================================================ Méta (§9)
  D.ROOMS = [
    { id: "serre", nom: "La Serre", cost: 12, txt: "Famille Sève et ses réactions" },
    { id: "atelier", nom: "L'Atelier", cost: 18, txt: "Clous Prisme et Écho" },
    { id: "bibliotheque", nom: "La Bibliothèque", cost: 25, txt: "6 nouvelles reliques" },
    { id: "laboratoire", nom: "Le Laboratoire", cost: 30, txt: "Évolutions actives" },
    { id: "forge", nom: "La Forge", cost: 40, txt: "Clou Cristal, gravures Dorée et Filante" },
    { id: "cartes", nom: "La Salle des Cartes", cost: 50, txt: "Boss La Marée et L'Étau" },
    { id: "crypte", nom: "La Crypte", cost: 60, txt: "4 reliques rares" },
    { id: "planetarium", nom: "Le Planétarium", cost: 80, txt: "Nuit Blanche et secret Aurore" },
  ];
  D.DEFIS = [
    { id: "D01", txt: "Fusionner un Soleil (taille 4)", reward: "Télescope" },
    { id: "D02", txt: "Gagner une nuit avec le bocal rempli à moins de 25 %", reward: "Balance" },
    { id: "D03", txt: "3 fusions pures dans un même tir", reward: "Alchimiste" },
    { id: "D04", txt: "Briser 3 Pierres Noires dans un même tir", reward: "Carrière" },
    { id: "D05", txt: "Gagner une nuit en 2 tirs ou moins", reward: "Sablier" },
    { id: "D06", txt: "Déclencher les 6 réactions (cumulé)", reward: "Catalyseur" },
    { id: "D07", txt: "Une cascade de 4 fusions dans un même tir", reward: "Prisme de poche" },
    { id: "D08", txt: "Déclencher un Big Bang", reward: "Singularité" },
    { id: "D09", txt: "Atteindre la Lune 3", reward: "L'Astronome" },
    { id: "D10", txt: "15 fusions pures dans un même run", reward: "La Forgeronne" },
    { id: "D11", txt: "Tuer 150 Ombres (cumulé)", reward: "La Glaneuse" },
    { id: "D12", txt: "Gagner un run", reward: "L'Insomniaque et les Éclipses" },
    { id: "D13", txt: "Un tir ≥ 1 000 Lumière", reward: "Gravure Prismatique" },
    { id: "D14", txt: "Tuer un boss en un seul tir", reward: "Clou Teinturier" },
    { id: "D15", txt: "Tuer 5 Ombres dans un même tir", reward: "+10 ◇" },
    { id: "D16", txt: "Déclencher une Aurore", reward: "Thème « Aurore »" },
  ];
  D.ECLIPSES = [
    null,
    { lvl: 1, txt: "Quotas ×1,25" },
    { lvl: 2, txt: "Ombres +20 % PV" },
    { lvl: 3, txt: "Reliques +1 or" },
    { lvl: 4, txt: "Ligne d'horizon −16 px" },
    { lvl: 5, txt: "5 tirs par nuit" },
    { lvl: 6, txt: "Pas de Bougie, intérêts plafonnés à 3" },
    { lvl: 7, txt: "+1 apparition d'Ombre par tir" },
    { lvl: 8, txt: "La règle du boss persiste" },
  ];

  // ================================================================ Palette (§11.1)
  D.PAL = {
    bg0: "#070a14", bg: "#0b0f1e", panel: "#121832", line: "#2b3560", text: "#eef2ff", dim: "#8a93b8",
    eclat: "#4fb3ff", mult: "#ff4d5e", or: "#ffd166", frag: "#c7a6ff",
    braise: "#ff6b3d", givre: "#5ee7ff", seve: "#6ee07a", foudre: "#ffe14d",
    ombre: "#05060c", ombreLine: "#b59cff", pierre: "#262a38", pierreLine: "#4a5068",
    peg: "#c9d2ea", pegOff: "#3a4262", glass: "#9fb3d9", danger: "#ff4d6d", jarIn: "#0f1428",
  };
  D.FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

  // ================================================================ Juice (§11.3) — durées et intensités
  D.FX = {
    pegFlash: 0.08, particles: 300, floats: 40, aggregateDmg: 0.25,
    count: { base: 0.4, relic: 0.22, final: 0.5, fly: 0.35 },
    nightWonFreeze: 0.5, nightWonConvert: 1.0, vidange: 1.5, introCard: 1.2, descent: 0.6,
    turretBolt: 0.2,
  };
})(window.BE = window.BE || {});
