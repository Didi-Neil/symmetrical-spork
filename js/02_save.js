/* 02_save.js — BE.Save : localStorage, chaque accès entouré de try/catch (§9.7), anti-save-scum (§12.6).
   Clés : bde.v1.meta (+ copie de secours bde.v1.meta.bak), bde.v1.run.
   - La méta est complétée champ par champ (migration douce) et assainie (types, ids inconnus).
   - Le run est validé structurellement au chargement ; un run corrompu est écarté, jamais « à moitié » repris.
   - Instantané PENDING_SHOT immuable : une fois l'état d'avant un tir écrit, il n'est plus réécrit pour ce même tir
     (la reprise rejoue toujours exactement le même état, quel que soit le nombre de rechargements). */
(function (BE) {
  "use strict";

  const KEY_META = "bde.v1.meta";
  const KEY_META_BAK = "bde.v1.meta.bak";
  const KEY_RUN = "bde.v1.run";
  const PHASES = { AIM: 1, SHOP: 1, PENDING_SHOT: 1 };

  const Save = (BE.Save = {});
  /** false dès qu'une lecture/écriture échoue (navigation privée, quota…) : icône « sauvegarde indisponible ». */
  Save.available = true;
  /** Dernière erreur (texte court, débogage). */
  Save.lastError = null;
  /** Compteurs (débogage / tests). */
  Save.stats = { metaWrites: 0, runWrites: 0, pendingKept: 0, rejected: 0, pendingRefused: 0 };

  /** Méta par défaut (§9.7, plus quelques champs de suivi ajoutés par 14_meta). */
  Save.defaultMeta = function () {
    return {
      v: 1,
      fragments: 0,
      rooms: [],
      gardiens: ["veilleuse"],
      eclipses: { veilleuse: 0 },
      defis: {},
      grimoire: { relics: [], reactions: {}, evolutions: [], ombres: [], hintsSeen: [], stars: {} },
      stats: {
        runs: 0, wins: 0, kills: 0, merges: 0, bestShot: 0, bestTotal: 0, fragmentsTotal: 0,
        maxSize: 0, bestLune: 0, bestPureShot: 0, bestStonesShot: 0, bestMergesShot: 0, bestKillsShot: 0,
        bestPureRun: 0, fewestShotsNight: 0, byGardien: {},
      },
      daily: { date: "", officialScore: null, best: 0, attemptDate: "", history: [] },
      runDisc: { seed: "", keys: [] },
      settings: { sfx: 0.8, music: 0.5, shake: true, flash: true, colorblind: false, textScale: 1, eco: false, aim: "abs", assistAim: false, vibrate: true },
      flags: { tutoAim: false, tutoMerge: false, tutoShadow: false, tutoQuota: false, lastGardien: "veilleuse", themeAurore: false, builtSeen: [] },
    };
  };

  // ---------------------------------------------------------------- accès brut
  function storage() {
    try { return window.localStorage || null; } catch (e) { return null; }
  }
  function readRaw(key) {
    try {
      const ls = storage();
      if (!ls) { Save.available = false; return null; }
      return ls.getItem(key);
    } catch (e) { Save.available = false; Save.lastError = "lecture " + key; return null; }
  }
  function read(key) {
    const s = readRaw(key);
    if (!s) return null;
    try { return JSON.parse(s); } catch (e) { Save.lastError = "JSON illisible : " + key; return null; }
  }
  /** Les clés commençant par « _ » sont des caches transitoires : jamais sérialisées. */
  function replacer(k, v) { return k && k.charCodeAt(0) === 95 ? undefined : v; }
  function write(key, val) {
    try {
      const ls = storage();
      if (!ls) { Save.available = false; return false; }
      if (val === null || val === undefined) ls.removeItem(key);
      else ls.setItem(key, typeof val === "string" ? val : JSON.stringify(val, replacer));
      return true;
    } catch (e) { Save.available = false; Save.lastError = "écriture " + key + " : " + (e && e.name); return false; }
  }

  /** Teste l'accès au stockage (navigation privée stricte, cookies bloqués…). */
  Save.probe = function () {
    const k = "bde.v1.probe";
    const ok = write(k, "1") && readRaw(k) === "1";
    write(k, null);
    Save.available = !!ok;
    return Save.available;
  };

  // ---------------------------------------------------------------- méta
  const isObj = (o) => !!o && typeof o === "object" && !Array.isArray(o);
  const num = (v, d) => (typeof v === "number" && isFinite(v) ? v : d);
  /** Complète récursivement les champs manquants (et remplace ceux dont le type ne correspond pas). */
  function fill(dst, def) {
    for (const k in def) {
      const dv = def[k];
      if (dst[k] === undefined || dst[k] === null && dv !== null) { dst[k] = dv; continue; }
      if (Array.isArray(dv)) { if (!Array.isArray(dst[k])) dst[k] = dv; continue; }
      if (isObj(dv)) { if (!isObj(dst[k])) dst[k] = dv; else fill(dst[k], dv); continue; }
      if (typeof dv === "number" && typeof dst[k] !== "number") dst[k] = dv;
      if (typeof dv === "boolean" && typeof dst[k] !== "boolean") dst[k] = dv;
    }
    return dst;
  }
  /** Assainit une méta (ids inconnus retirés, bornes). */
  function sanitizeMeta(m) {
    const D = BE.DATA;
    m.fragments = Math.max(0, Math.floor(num(m.fragments, 0)));
    if (D) {
      const roomIds = D.ROOMS.map((r) => r.id);
      m.rooms = m.rooms.filter((id, i, a) => roomIds.indexOf(id) >= 0 && a.indexOf(id) === i);
      m.gardiens = m.gardiens.filter((id, i, a) => !!D.GARDIEN_BY_ID[id] && a.indexOf(id) === i);
      for (const k in m.eclipses) {
        if (!D.GARDIEN_BY_ID[k]) delete m.eclipses[k];
        else m.eclipses[k] = Math.max(0, Math.min(8, Math.floor(num(m.eclipses[k], 0))));
      }
    }
    if (m.gardiens.indexOf("veilleuse") < 0) m.gardiens.unshift("veilleuse");
    for (const k in m.defis) if (!isObj(m.defis[k])) delete m.defis[k];
    if (!Array.isArray(m.daily.history)) m.daily.history = [];
    m.daily.history = m.daily.history.filter(isObj).slice(-30);
    if (!Array.isArray(m.runDisc.keys)) m.runDisc.keys = [];
    return m;
  }

  /** Charge la méta (secours → défaut). Ne lève jamais. */
  Save.loadMeta = function () {
    let m = read(KEY_META);
    if (!isObj(m) || m.v !== 1) {
      const bak = read(KEY_META_BAK);
      if (isObj(bak) && bak.v === 1) { m = bak; Save.lastError = "méta restaurée depuis la copie de secours"; }
      else m = null;
    }
    if (!m) return Save.defaultMeta();
    try { return sanitizeMeta(fill(m, Save.defaultMeta())); } catch (e) { Save.lastError = "méta invalide"; return Save.defaultMeta(); }
  };
  /** Écrit la méta (et sa copie de secours). */
  Save.saveMeta = function (meta) {
    if (!meta) return false;
    let s;
    try { s = JSON.stringify(meta, replacer); } catch (e) { Save.lastError = "méta non sérialisable"; return false; }
    const ok = write(KEY_META, s);
    if (ok) { write(KEY_META_BAK, s); Save.stats.metaWrites++; }
    return ok;
  };

  // ---------------------------------------------------------------- run
  /** Validation structurelle d'un run sérialisé (§3.2 d'ARCHITECTURE). Renvoie null si valide, sinon la raison. */
  Save.checkRun = function (r) {
    const D = BE.DATA;
    // v:2 depuis le bocal étroit (v1.1) ; v:1 (bocal large de la v1.0) : accepté puis migré par Run.migrate à la reprise
    if (!isObj(r)) return "format";
    if (r.v !== 1 && r.v !== 2) return "version";
    if (typeof r.seed !== "string" || !r.seed) return "seed";
    if (!isObj(r.streams)) return "streams";
    for (const k of (BE.util && BE.util.STREAMS) || ["bag", "shop", "waves", "pegs", "misc"]) if (typeof r.streams[k] !== "number") return "stream " + k;
    if (D && !D.GARDIEN_BY_ID[r.gardien]) return "gardien";
    if (!isObj(r.rules)) return "rules";
    if (!(r.lune >= 1 && r.lune < 1000) || !(r.nuit >= 0 && r.nuit <= 2)) return "lune/nuit";
    if (!PHASES[r.phase]) return "phase";
    if (r.phase === "PENDING_SHOT" && typeof r.pendingAngle !== "number") return "pendingAngle";
    if (!Array.isArray(r.bag) || !r.bag.length) return "bag";
    for (const b of r.bag) if (!isObj(b) || typeof b.id !== "number" || !(b.size >= 1 && b.size <= 7) || typeof b.color !== "string") return "bag item";
    if (!Array.isArray(r.draw)) return "draw";
    if (!Array.isArray(r.relics)) return "relics";
    for (const x of r.relics) if (!isObj(x) || typeof x.id !== "string") return "relic";
    if (!isObj(r.jar) || !Array.isArray(r.jar.bodies)) return "jar";
    for (const b of r.jar.bodies) if (!isObj(b) || typeof b.x !== "number" || typeof b.y !== "number" || !isFinite(b.x) || !isFinite(b.y)) return "body";
    if (!isObj(r.firm) || !Array.isArray(r.firm.shadows)) return "firm";
    if (!isObj(r.runStats) || !Array.isArray(r.nightBest)) return "stats";
    if (r.result) return "terminé";
    return null;
  };
  /** Run sauvegardé valide, ou null (un run invalide est effacé). */
  Save.loadRun = function () {
    const r = read(KEY_RUN);
    if (!r) return null;
    const why = Save.checkRun(r);
    if (why) {
      Save.lastError = "run écarté (" + why + ")";
      Save.stats.rejected++;
      try { console.warn("[Save] run sauvegardé écarté :", why); } catch (e) { /* */ }
      write(KEY_RUN, null);
      // prévenir le joueur (une seule fois : le run est effacé), sauf pour un run déjà terminé
      if (why !== "terminé" && !BE.muteEvents && BE.UI && BE.UI.toast)
        BE.UI.toast(why === "version" ? "Partie d'une version incompatible : elle a été écartée" : "Partie sauvegardée illisible : elle a été écartée");
      return null;
    }
    return r;
  };
  function sameShot(a, b) {
    return a.seed === b.seed && a.lune === b.lune && a.nuit === b.nuit && a.shotIndex === b.shotIndex &&
      (a.runStats && a.runStats.shots) === (b.runStats && b.runStats.shots);
  }
  /**
   * Écrit le run. Anti-save-scum (§12.6) : si l'instantané stocké est déjà l'état PENDING_SHOT de ce même tir,
   * il est conservé tel quel (la reprise rejoue l'état d'origine, pas un état re-stabilisé).
   * opts.pending : seul Run.fire (état d'avant le tir) peut écrire un run en phase PENDING_SHOT. Tout autre appel
   * pendant la résolution d'un tir (pause → « Menu principal », debug…) est refusé : l'état en cours de tir
   * (étoile déjà tirée, tirs déjà décomptés) ne doit jamais remplacer l'instantané d'avant le tir.
   */
  Save.saveRun = function (run, opts) {
    if (!run) return false;
    if (run.phase === "PENDING_SHOT" && !(opts && opts.pending)) { Save.stats.pendingRefused++; return false; }
    // Pendant une reprise, Run.resume passe par AIM (qui sauvegarde) puis rejoue le tir : ni l'un ni l'autre
    // ne doit remplacer l'instantané d'origine. Un état AIM/PENDING aux mêmes compteurs n'existe que dans ce cas.
    if (run.phase === "PENDING_SHOT" || run.phase === "AIM") {
      const cur = read(KEY_RUN);
      if (cur && cur.phase === "PENDING_SHOT" && sameShot(cur, run)) { Save.stats.pendingKept++; return true; }
    }
    const ok = write(KEY_RUN, run);
    if (ok) Save.stats.runWrites++;
    return ok;
  };
  Save.clearRun = function () { return write(KEY_RUN, null); };
  /** Présence d'un run reprenable (valide). */
  Save.hasRun = function () { return !!Save.loadRun(); };

  /** Efface toute la progression (méta + run). Irréversible. */
  Save.wipe = function () {
    const a = write(KEY_RUN, null), b = write(KEY_META, null), c = write(KEY_META_BAK, null);
    return a && b && c;
  };
  /** Taille approximative (octets) des données sauvegardées. */
  Save.size = function () {
    let n = 0;
    for (const k of [KEY_META, KEY_META_BAK, KEY_RUN]) { const s = readRaw(k); if (s) n += s.length * 2; }
    return n;
  };

  Save.probe();
})(window.BE = window.BE || {});
