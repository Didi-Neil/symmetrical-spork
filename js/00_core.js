/* 00_core.js — BE.util : maths, format fr, FNV-1a, mulberry32 (flux sérialisables), Pool, bus d'événements. */
(function (BE) {
  "use strict";

  const U = (BE.util = {});

  // ---------------------------------------------------------------- maths
  U.clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  U.lerp = (a, b, t) => a + (b - a) * t;
  U.invLerp = (a, b, v) => (b === a ? 0 : (v - a) / (b - a));
  U.smooth = (t) => { t = U.clamp(t, 0, 1); return t * t * (3 - 2 * t); };
  U.easeOutCubic = (t) => { t = U.clamp(t, 0, 1); return 1 - Math.pow(1 - t, 3); };
  U.easeInCubic = (t) => { t = U.clamp(t, 0, 1); return t * t * t; };
  U.easeInOut = (t) => { t = U.clamp(t, 0, 1); return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; };
  U.easeOutBack = (t) => { t = U.clamp(t, 0, 1); const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); };
  U.easeOutElastic = (t) => {
    t = U.clamp(t, 0, 1); if (t === 0 || t === 1) return t;
    return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * (2 * Math.PI / 3)) + 1;
  };
  U.approach = (v, target, rate, dt) => v + (target - v) * (1 - Math.exp(-rate * dt));
  U.dist = (ax, ay, bx, by) => Math.hypot(bx - ax, by - ay);
  U.dist2 = (ax, ay, bx, by) => { const dx = bx - ax, dy = by - ay; return dx * dx + dy * dy; };
  U.deg = (rad) => rad * 180 / Math.PI;
  U.rad = (deg) => deg * Math.PI / 180;
  U.sum = (arr, f) => { let s = 0; for (let i = 0; i < arr.length; i++) s += f ? f(arr[i], i) : arr[i]; return s; };
  /** Arrondi au 0,5 supérieur (fusions pures, §5.5). */
  U.ceilHalf = (x) => Math.ceil(x * 2 - 1e-9) / 2;
  U.pingpong = (t) => { t = t % 2; return t < 1 ? t : 2 - t; };

  // ---------------------------------------------------------------- format fr
  const NNBSP = " "; // espace fine insécable
  function groupFr(intStr) {
    let out = "";
    for (let i = 0; i < intStr.length; i++) {
      const fromEnd = intStr.length - i;
      out += intStr[i];
      if (fromEnd > 1 && fromEnd % 3 === 1) out += NNBSP;
    }
    return out;
  }
  function oneDec(x) {
    const r = Math.round(x * 10) / 10;
    return (Number.isInteger(r) ? String(r) : r.toFixed(1)).replace(".", ",");
  }
  /** Nombre entier au format fr-FR (§10) : « 12 345 », « 1,2 M », « 3,4 Md », « 1,2e15 ». */
  U.fmt = function (n) {
    if (n === undefined || n === null || isNaN(n)) return "0";
    const neg = n < 0; n = Math.abs(n);
    let s;
    if (n >= 1e12) { const e = Math.floor(Math.log10(n)); s = oneDec(n / Math.pow(10, e)) + "e" + e; }
    else if (n >= 1e9) s = oneDec(n / 1e9) + NNBSP + "Md";
    else if (n >= 1e6) s = oneDec(n / 1e6) + NNBSP + "M";
    else s = groupFr(String(Math.floor(n)));
    return (neg ? "−" : "") + s;
  };
  /** Mult affiché avec une décimale : « 3,5 ». */
  U.fmtMult = function (m) {
    if (m >= 1e6) return U.fmt(m);
    if (m >= 1000) return groupFr(String(Math.floor(m)));
    return (Math.round(m * 10) / 10).toFixed(1).replace(".", ",");
  };
  /** Décimal court « 1,5 » (sans décimale si entier). */
  U.fmtDec = oneDec;
  U.pct = (f) => Math.round(f * 100) + NNBSP + "%";

  // ---------------------------------------------------------------- hash / RNG
  /** FNV-1a 32 bits sur une chaîne. */
  U.fnv1a = function (str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
  };
  /** Une étape mulberry32. Renvoie le nouvel état ; la valeur est dans U._mbv. */
  function mbStep(s) {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    U._mbv = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    return s;
  }
  U.STREAMS = ["bag", "shop", "waves", "pegs", "misc"];
  /** États initiaux des flux RNG séparés (§12.6) : { bag, shop, waves, pegs, misc } (entiers, sérialisables). */
  U.seedStreams = function (seed) {
    const o = {};
    for (const k of U.STREAMS) o[k] = U.fnv1a(String(seed) + k) | 0;
    return o;
  };
  /** Tirage [0,1) sur le flux `name` de l'objet `streams` (muté). */
  U.rand = function (streams, name) {
    streams[name] = mbStep(streams[name] | 0);
    return U._mbv;
  };
  U.rint = (streams, name, n) => Math.floor(U.rand(streams, name) * n);
  U.rpick = (streams, name, arr) => arr[U.rint(streams, name, arr.length)];
  /** Tirage pondéré : weights = {clé: poids}. Ordre des clés stable (insertion). */
  U.rweighted = function (streams, name, weights) {
    let tot = 0; for (const k in weights) tot += weights[k];
    let r = U.rand(streams, name) * tot;
    for (const k in weights) { r -= weights[k]; if (r < 0) return k; }
    return Object.keys(weights).pop();
  };
  /** Mélange Fisher-Yates en place, sur un flux. */
  U.rshuffle = function (streams, name, arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = U.rint(streams, name, i + 1);
      const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  };
  /** Générateur autonome (hors simulation) : mulberry32 fermé. */
  U.mulberry32 = function (seed) {
    let s = seed | 0;
    return function () { s = mbStep(s); return U._mbv; };
  };
  /** Graine lisible pour un nouveau run (Math.random autorisé ici : hors simulation). */
  U.newSeed = function () {
    const A = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let s = "";
    for (let i = 0; i < 8; i++) { s += A[Math.floor(Math.random() * A.length)]; if (i === 3) s += "-"; }
    return s;
  };

  // ---------------------------------------------------------------- Pool
  /**
   * Pool d'objets à taille fixe. spawn() recycle le plus ancien s'il est plein.
   * Les objets ont un champ `alive`. forEach ne visite que les vivants.
   */
  U.Pool = function (size, factory) {
    this.items = [];
    this.size = size;
    this.cursor = 0;
    for (let i = 0; i < size; i++) { const o = factory(); o.alive = false; o._born = 0; this.items.push(o); }
    this._tick = 0;
  };
  U.Pool.prototype.spawn = function () {
    // premier libre, sinon le plus ancien
    let best = null, bestBorn = Infinity;
    for (let k = 0; k < this.size; k++) {
      const i = (this.cursor + k) % this.size;
      const o = this.items[i];
      if (!o.alive) { best = o; this.cursor = (i + 1) % this.size; break; }
      if (o._born < bestBorn) { bestBorn = o._born; best = o; }
    }
    best.alive = true; best._born = ++this._tick;
    return best;
  };
  U.Pool.prototype.forEach = function (f) {
    for (let i = 0; i < this.size; i++) if (this.items[i].alive) f(this.items[i]);
  };
  U.Pool.prototype.count = function () {
    let n = 0; for (let i = 0; i < this.size; i++) if (this.items[i].alive) n++; return n;
  };
  U.Pool.prototype.clear = function () { for (let i = 0; i < this.size; i++) this.items[i].alive = false; };

  // ---------------------------------------------------------------- couleurs
  U.hexToRgb = function (hex) {
    const h = hex.replace("#", "");
    const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };
  U.rgba = function (hex, a) { const c = U.hexToRgb(hex); return "rgba(" + c[0] + "," + c[1] + "," + c[2] + "," + a + ")"; };
  /** Éclaircit (amt>0) ou assombrit (amt<0) une couleur hex, amt dans [-1,1]. */
  U.shade = function (hex, amt) {
    const c = U.hexToRgb(hex);
    const f = (v) => Math.round(amt >= 0 ? v + (255 - v) * amt : v * (1 + amt));
    return "rgb(" + f(c[0]) + "," + f(c[1]) + "," + f(c[2]) + ")";
  };

  // ---------------------------------------------------------------- divers
  U.deepCopy = (o) => (o === undefined ? undefined : JSON.parse(JSON.stringify(o)));
  U.removeWhere = function (arr, pred) {
    let w = 0;
    for (let i = 0; i < arr.length; i++) if (!pred(arr[i])) arr[w++] = arr[i];
    arr.length = w; return arr;
  };
  U.todayStr = function () {
    const d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  };

  // ---------------------------------------------------------------- bus d'événements
  // La simulation émet des événements « juice » (FX, audio, UI) ; elle ne dépend jamais de leurs écouteurs.
  const listeners = {};
  /** BE.on(type, fn) : s'abonner. type "*" reçoit (type, data). Renvoie une fonction de désabonnement. */
  BE.on = function (type, fn) {
    (listeners[type] = listeners[type] || []).push(fn);
    return () => { const l = listeners[type]; const i = l.indexOf(fn); if (i >= 0) l.splice(i, 1); };
  };
  /** BE.emit(type, data) : diffuse un événement. Les exceptions des écouteurs sont isolées. */
  BE.emit = function (type, data) {
    if (BE.muteEvents) return;
    const l = listeners[type];
    if (l) for (let i = 0; i < l.length; i++) { try { l[i](data); } catch (e) { console.error("[BE.emit " + type + "]", e); } }
    const a = listeners["*"];
    if (a) for (let i = 0; i < a.length; i++) { try { a[i](type, data); } catch (e) { console.error(e); } }
  };
})(window.BE = window.BE || {});
