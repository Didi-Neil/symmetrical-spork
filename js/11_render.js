/* 11_render.js — BE.Render : rendu procédural (§11.2). Sprites pré-rendus (étoiles 7 tailles × 4 familles × variantes,
   visages, Pierres, clous, verre du bocal, Phare, lune, champ d'étoiles en parallaxe, icônes de reliques), scène de jeu,
   HUD et libellés mis en cache (§12.7). Aucune ombre portée (shadowBlur) par image : les lueurs sont des sprites
   composés en "lighter". Les boucles de dessin n'allouent rien (pas de filter/map, objets de travail réutilisés). */
(function (BE) {
  "use strict";

  const R = (BE.Render = {});
  const D = BE.DATA, G = D.GEOM, P = D.PAL, U = BE.util;
  const TAU = Math.PI * 2;
  const EMPTY = {};
  let cv = null, g = null;
  let K = 2;      // résolution des sprites (pixels par unité logique)
  let gen = 0;    // génération des caches (incrémentée à chaque changement de résolution)

  R.init = function (canvas) {
    cv = canvas; g = canvas.getContext("2d");
    R.ctx = g;
    grads = null;
  };
  /** Appelé par main au redimensionnement : k = scale × dpr. Régénère les sprites. */
  R.setResolution = function (k) {
    const nk = Math.max(1, Math.min(4, Math.ceil(k * 2) / 2));
    if (nk === K && bgBase) return;
    K = nk; gen++;
    resetCaches();
    buildBackground();
    prewarm.i = 0; // les sprites d'étoiles sont reconstruits petit à petit (R.prewarmStep)
  };
  R.K = () => K;
  /**
   * Étendue logique visible (au-delà de 360 × 640 quand l'écran n'a pas le même format) : le ciel, la barre haute et la
   * bande des reliques s'y prolongent (pas de bandes noires). {x0, y0, x1, y1, w, h, bottom} — bottom = marge utile
   * sous 640 (hors zone de sécurité), dont la bande des reliques profite.
   */
  const EXT = { x0: 0, y0: 0, x1: 360, y1: 640, w: 360, h: 640, bottom: 0 };
  R.ext = EXT;
  R.setExtents = function (e) {
    const q = (v) => Math.round(v * 4) / 4;
    const n = { x0: q(Math.max(-700, e.x0)), y0: q(Math.max(-400, e.y0)), x1: q(Math.min(D.W + 700, e.x1)), y1: q(Math.min(D.H + 400, e.y1)) };
    const changed = n.x0 !== EXT.x0 || n.y0 !== EXT.y0 || n.x1 !== EXT.x1 || n.y1 !== EXT.y1;
    Object.assign(EXT, n, { w: n.x1 - n.x0, h: n.y1 - n.y0, bottom: Math.max(0, e.bottom || 0) });
    if (changed && bgBase) buildBackground();
  };
  /** Remplit tout l'écran visible (voiles, fondus, flashs). */
  R.fillScreen = function (gg) { (gg || g).fillRect(EXT.x0 - 2, EXT.y0 - 2, EXT.w + 4, EXT.h + 4); };
  /** Hauteur ajoutée à la bande des reliques (0 à 30) quand l'écran est plus haut que 640. */
  R.bandExtra = () => Math.max(0, Math.min(30, EXT.bottom));
  /** Ordonnée des icônes de la bande des reliques. */
  R.relicY = () => 627 + R.bandExtra() / 2;

  function off(w, h, k) {
    k = k || K;
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.ceil(w * k)); c.height = Math.max(1, Math.ceil(h * k));
    const x = c.getContext("2d");
    x.setTransform(k, 0, 0, k, 0, 0);
    c.lw = w; c.lh = h; // taille logique
    return [c, x];
  }
  function font(w, px) { return BE.FX.font(w, px); }

  // ---------------------------------------------------------------- couleurs
  const FAM_IDX = { braise: 0, givre: 1, seve: 2, foudre: 3 };
  const FAM_COL = [P.braise, P.givre, P.seve, P.foudre, "#eef2ff"];
  function famIdx(c) { const i = FAM_IDX[c]; return i === undefined ? 4 : i; }
  function famColor(c) { return FAM_COL[famIdx(c)]; }
  R.famColor = famColor;
  function lighten(hex, a) {
    const c = U.hexToRgb(hex);
    const f = (v) => Math.round(v + (255 - v) * a).toString(16).padStart(2, "0");
    return "#" + f(c[0]) + f(c[1]) + f(c[2]);
  }
  const C_DIM60 = U.rgba(P.dim, 0.6), C_DIM70 = U.rgba(P.dim, 0.7), C_LINE80 = U.rgba(P.line, 0.8), C_LINE = P.line;
  const C_GLASS35 = U.rgba("#8fd8ff", 0.3);
  const C_TEXT85 = U.rgba(P.text, 0.85), C_DANGER25 = U.rgba(P.danger, 0.25), C_OR60 = U.rgba(P.or, 0.6);
  const DASH_H = [5, 5], DASH_S = [3, 3], DASH_R = [2, 3], DASH_P = [2, 4], NO_DASH = [];

  // ---------------------------------------------------------------- caches
  let starSprites, faceSprites, pupilSprites, stoneSprites, pegSprites, iconCache, moonSprites, misc;
  let bgBase = null, starLayers = null, twinkles = null;
  let jarKey = -1, jarBack = null, jarFront = null;
  let grads = null;
  const HUD_O = { scale: 1, lookX: 0, lookY: 0, seed: 0, alpha: 1, noFace: false };
  function resetCaches() {
    starSprites = []; faceSprites = []; pupilSprites = []; stoneSprites = []; pegSprites = []; iconCache = {}; moonSprites = [];
    misc = {}; jarKey = -1; grads = null;
  }
  resetCaches();

  // ================================================================ fond (§11.2)
  function buildBackground() {
    const E = EXT, BW = E.w, BH = E.h;
    // résolution du fond plafonnée (écrans très larges) : c'est un dégradé flou, 2 px par unité suffisent
    let [c, x] = off(BW, BH, Math.min(K, 2));
    x.translate(-E.x0, -E.y0);
    const gr = x.createLinearGradient(0, E.y0, 0, E.y1);
    const at = (y) => U.clamp((y - E.y0) / BH, 0, 1);
    gr.addColorStop(0, "#0d1226"); gr.addColorStop(at(0), "#0d1226"); gr.addColorStop(at(288), "#0b0f1e"); gr.addColorStop(at(D.H), "#070a14"); gr.addColorStop(1, "#060812");
    x.fillStyle = gr; x.fillRect(E.x0, E.y0, BW, BH);
    // nébuleuses en plus sur les côtés (écrans larges) et sous le bocal (écrans hauts)
    if (E.x0 < -40) for (const [nx, ny, nr, col, a] of [[-120, 200, 260, "#2a1d5a", 0.14], [-180, 520, 240, "#12385a", 0.12]]) {
      for (const sx of [nx, D.W - nx]) { const rg = x.createRadialGradient(sx, ny, 0, sx, ny, nr); rg.addColorStop(0, U.rgba(col, a)); rg.addColorStop(1, U.rgba(col, 0)); x.fillStyle = rg; x.fillRect(sx - nr, ny - nr, nr * 2, nr * 2); }
    }
    const neb = [[60, 170, 170, "#4a2d8a", 0.2], [320, 300, 190, "#1d4a7a", 0.17], [150, 480, 230, "#2a1d5a", 0.15],
      [320, 40, 150, "#3a1d5a", 0.14], [30, 610, 170, "#12385a", 0.13], [200, 250, 120, "#2b2260", 0.1]];
    for (const [nx, ny, nr, col, a] of neb) {
      const rg = x.createRadialGradient(nx, ny, 0, nx, ny, nr);
      rg.addColorStop(0, U.rgba(col, a)); rg.addColorStop(0.55, U.rgba(col, a * 0.4)); rg.addColorStop(1, U.rgba(col, 0));
      x.fillStyle = rg; x.fillRect(nx - nr, ny - nr, nr * 2, nr * 2);
    }
    // voie lactée : traînée diagonale de poussière
    const rnd = U.mulberry32(987);
    for (let i = 0; i < 26; i++) {
      const t = i / 25, px = -20 + t * 400, py = 520 - t * 470 + (rnd() - 0.5) * 40, pr = 30 + rnd() * 40;
      const rg = x.createRadialGradient(px, py, 0, px, py, pr);
      rg.addColorStop(0, "rgba(160,170,255,0.035)"); rg.addColorStop(1, "rgba(160,170,255,0)");
      x.fillStyle = rg; x.fillRect(px - pr, py - pr, pr * 2, pr * 2);
    }
    for (let i = 0; i < 260; i++) {
      const t = rnd(), px = -20 + t * 400 + (rnd() - 0.5) * 70, py = 520 - t * 470 + (rnd() - 0.5) * 70;
      x.fillStyle = "rgba(210,220,255," + (0.08 + rnd() * 0.18).toFixed(2) + ")";
      x.fillRect(px, py, 0.6, 0.6);
    }
    bgBase = c;
    bgBase.ox = E.x0; bgBase.oy = E.y0;
    // deux couches d'étoiles lointaines (60 et 30), parallaxe 3 et 6 px/s. Chaque étoile est un petit sprite
    // pré-rendu : on évite deux calques plein écran transparents (coût de remplissage sur mobile, §12.7).
    const r2 = U.mulberry32(1234);
    const SC = ["255,220,190", "190,220,255", "228,234,255"];
    misc.dots = [];
    for (let v = 0; v < 6; v++) {
      const big = v >= 3, col = SC[v % 3], R0 = big ? 4 : 1.5;
      [c, x] = off(R0 * 2, R0 * 2);
      const dg = x.createRadialGradient(R0, R0, 0, R0, R0, R0);
      if (big) { dg.addColorStop(0, "rgba(" + col + ",1)"); dg.addColorStop(0.3, "rgba(" + col + ",0.85)"); dg.addColorStop(0.42, "rgba(" + col + ",0.2)"); dg.addColorStop(1, "rgba(" + col + ",0)"); }
      else { dg.addColorStop(0, "rgba(" + col + ",1)"); dg.addColorStop(0.55, "rgba(" + col + ",0.8)"); dg.addColorStop(1, "rgba(" + col + ",0)"); }
      x.fillStyle = dg; x.fillRect(0, 0, R0 * 2, R0 * 2);
      c.R0 = R0;
      misc.dots.push(c);
    }
    starLayers = [];
    const areaK = U.clamp((BW * BH) / (D.W * D.H), 1, 3.5);
    for (let L = 0; L < 2; L++) {
      const n = Math.round((L ? 30 : 60) * areaK), arr = new Float32Array(n * 5);
      for (let i = 0; i < n; i++) {
        const warm = r2(), ci = warm < 0.15 ? 0 : warm < 0.3 ? 1 : 2;
        const s = L ? 0.7 + r2() * 1.0 : 0.45 + r2() * 0.55;
        const big = L && s > 1.2;
        arr[i * 5] = E.x0 + r2() * BW; arr[i * 5 + 1] = E.y0 + r2() * BH;
        arr[i * 5 + 2] = ci + (big ? 3 : 0);
        arr[i * 5 + 3] = big ? s * 2.4 : s * 1.5; // demi-taille du sprite
        arr[i * 5 + 4] = (L ? 0.55 : 0.28) + r2() * (L ? 0.4 : 0.3);
      }
      starLayers.push(arr);
    }
    twinkles = [];
    for (let i = 0; i < Math.round(14 * areaK); i++) twinkles.push({ x: E.x0 + 10 + r2() * (BW - 20), y: r2() * BH, s: 2 + r2() * 2.5, ph: r2() * TAU, sp: 0.6 + r2() * 1.4 });
    // étincelle à 4 branches
    [c, x] = off(24, 24);
    const sg = x.createRadialGradient(12, 12, 0, 12, 12, 12);
    sg.addColorStop(0, "rgba(255,255,255,0.8)"); sg.addColorStop(0.3, "rgba(200,215,255,0.25)"); sg.addColorStop(1, "rgba(200,215,255,0)");
    x.fillStyle = sg; x.fillRect(0, 0, 24, 24);
    x.fillStyle = "#ffffff";
    x.beginPath(); x.moveTo(12, 1); x.quadraticCurveTo(12, 12, 23, 12); x.quadraticCurveTo(12, 12, 12, 23); x.quadraticCurveTo(12, 12, 1, 12); x.quadraticCurveTo(12, 12, 12, 1); x.fill();
    misc.spark = c;
    // vignette cuite dans le fond ; la vignette rouge (alerte) est un sprite basse résolution
    {
      const bx = bgBase.getContext("2d");
      const R1 = Math.max(420, Math.hypot(Math.max(180 - E.x0, E.x1 - 180), Math.max(330 - E.y0, E.y1 - 330)));
      const vg = bx.createRadialGradient(180, 330, 150, 180, 330, R1);
      const o = (d) => U.clamp((d - 150) / (R1 - 150), 0, 1);
      vg.addColorStop(0, "rgba(7,10,20,0)"); vg.addColorStop(o(312), "rgba(7,10,20,0.2)"); vg.addColorStop(o(420), "rgba(7,10,20,0.6)"); vg.addColorStop(1, "rgba(7,10,20,0.66)");
      bx.fillStyle = vg; bx.fillRect(E.x0, E.y0, BW, BH);
    }
    [c, x] = off(D.W, D.H, 0.5);
    const rv = x.createRadialGradient(180, 330, 150, 180, 330, 420);
    rv.addColorStop(0, "rgba(255,77,109,0)"); rv.addColorStop(0.6, "rgba(255,77,109,0.14)"); rv.addColorStop(1, "rgba(255,77,109,0.4)");
    x.fillStyle = rv; x.fillRect(0, 0, D.W, D.H);
    misc.vigRed = c;
  }

  // ---------------------------------------------------------------- lune (phase selon la Lune du run)
  const MOON_R = 52;
  function moonSprite(ph) {
    if (moonSprites[ph]) return moonSprites[ph];
    const r = MOON_R, H = r * 2.1;
    const [c, x] = off(H * 2, H * 2);
    const cx = H, cy = H;
    const eclipse = ph >= 4;
    // halo
    const hg = x.createRadialGradient(cx, cy, r * 0.8, cx, cy, H);
    if (eclipse) { hg.addColorStop(0, "rgba(199,166,255,0.55)"); hg.addColorStop(0.18, "rgba(255,120,150,0.22)"); hg.addColorStop(1, "rgba(199,166,255,0)"); }
    else { hg.addColorStop(0, "rgba(210,222,255,0.22)"); hg.addColorStop(1, "rgba(210,222,255,0)"); }
    x.fillStyle = hg; x.beginPath(); x.arc(cx, cy, H, 0, TAU); x.fill();
    // disque
    x.save(); x.beginPath(); x.arc(cx, cy, r, 0, TAU); x.clip();
    const dg = x.createRadialGradient(cx - r * 0.35, cy - r * 0.35, r * 0.1, cx, cy, r);
    dg.addColorStop(0, "#f4f6ff"); dg.addColorStop(0.7, "#c9d0ea"); dg.addColorStop(1, "#98a2c8");
    x.fillStyle = dg; x.fillRect(cx - r, cy - r, r * 2, r * 2);
    const rnd = U.mulberry32(77);
    for (let i = 0; i < 9; i++) {
      const a = rnd() * TAU, d = rnd() * r * 0.75, cr = r * (0.06 + rnd() * 0.16);
      x.fillStyle = "rgba(120,130,170," + (0.15 + rnd() * 0.15).toFixed(2) + ")";
      x.beginPath(); x.arc(cx + Math.cos(a) * d, cy + Math.sin(a) * d, cr, 0, TAU); x.fill();
      x.strokeStyle = "rgba(255,255,255,0.15)"; x.lineWidth = 0.8;
      x.beginPath(); x.arc(cx + Math.cos(a) * d + cr * 0.15, cy + Math.sin(a) * d + cr * 0.15, cr, Math.PI * 0.1, Math.PI * 0.9); x.stroke();
    }
    // terminateur : la partie sombre est découpée (le ciel reste visible), avec un léger clair de terre
    if (eclipse) {
      x.fillStyle = "rgba(8,6,18,0.94)"; x.fillRect(cx - r, cy - r, r * 2, r * 2);
      x.strokeStyle = "rgba(255,140,170,0.5)"; x.lineWidth = 2; x.beginPath(); x.arc(cx, cy, r - 1, 0, TAU); x.stroke();
    } else if (ph < 3) {
      const offs = [0.42, 0.95, 1.5][ph];
      x.globalCompositeOperation = "destination-out";
      x.shadowColor = "rgba(0,0,0,1)"; x.shadowBlur = r * 0.18 * K; // pré-rendu uniquement
      x.fillStyle = "rgba(0,0,0,0.9)";
      x.beginPath(); x.arc(cx - r * offs, cy - r * 0.08, r * 1.02, 0, TAU); x.fill();
      x.shadowBlur = 0;
      x.globalCompositeOperation = "source-over";
    }
    x.restore();
    c.H = H;
    return (moonSprites[ph] = c);
  }
  function moonPhase() {
    const run = BE.state.run;
    if (!run) return 2;
    return Math.max(0, Math.min(4, run.lune - 1));
  }
  function drawMoon(t, x, y, scale, alpha) {
    const m = moonSprite(moonPhase());
    const s = m.H * scale;
    g.globalAlpha = alpha;
    g.drawImage(m, x - s + Math.sin(t * 0.07) * 3, y - s + Math.cos(t * 0.05) * 2, s * 2, s * 2);
    g.globalAlpha = 1;
  }
  R.drawMoon = drawMoon;

  // étoiles filantes décoratives
  const shoot = { t0: -99, next: 4, x: 0, y: 0, vx: 0, vy: 0 };
  R.drawBackground = function (t, opts) {
    if (!bgBase) return;
    // Contraste renforcé (§11.1, réglage de 13_ui) : fond noir uni
    if (BE.settings && BE.settings.contrast) { g.fillStyle = "#000000"; R.fillScreen(g); }
    else g.drawImage(bgBase, bgBase.ox, bgBase.oy, bgBase.lw, bgBase.lh);
    const sc = BE.state.scene;
    const inGame = !!(BE.state.run && BE.Run && BE.Run.IN_GAME[sc]);
    if (!opts || opts.moon !== false) {
      if (inGame) drawMoon(t, 334, 250, 0.6, 0.2); // discrète : ne doit pas éteindre les Ombres de la colonne de droite
      else if (sc === "TITLE" || sc === "SELECT") drawMoon(t, 326, 104, 0.58, 0.75);
    }
    const dots = misc.dots;
    for (let L = 0; L < 2; L++) {
      const arr = starLayers[L], o = (t * (L ? 6 : 3)) % EXT.h, yEnd = EXT.y1;
      for (let i = 0; i < arr.length; i += 5) {
        let y = arr[i + 1] + o; if (y > yEnd) y -= EXT.h;
        const h = arr[i + 3];
        g.globalAlpha = arr[i + 4];
        g.drawImage(dots[arr[i + 2]], arr[i] - h, y - h, h * 2, h * 2);
      }
    }
    g.globalAlpha = 1;
    // scintillements
    g.globalCompositeOperation = "lighter";
    for (let i = 0; i < twinkles.length; i++) {
      const w = twinkles[i];
      const a = 0.5 + 0.5 * Math.sin(t * w.sp + w.ph);
      if (a < 0.15) continue;
      const s = w.s * (0.6 + 0.6 * a);
      const yy = EXT.y0 + (w.y + t * 6) % EXT.h;
      g.globalAlpha = a * 0.75;
      g.drawImage(misc.spark, w.x - s, yy - s, s * 2, s * 2);
    }
    // étoile filante
    if (t > shoot.next) {
      shoot.t0 = t; shoot.next = t + 6 + Math.random() * 9;
      shoot.x = 30 + Math.random() * 300; shoot.y = 40 + Math.random() * 200;
      const a = 0.35 + Math.random() * 0.5, sp = 380 + Math.random() * 180, dir = Math.random() < 0.5 ? -1 : 1;
      shoot.vx = Math.cos(a) * sp * dir; shoot.vy = Math.sin(a) * sp;
    }
    const st = t - shoot.t0;
    if (st < 0.7) {
      const k = st / 0.7, al = Math.sin(k * Math.PI);
      const hx = shoot.x + shoot.vx * st, hy = shoot.y + shoot.vy * st;
      g.lineCap = "round";
      for (let i = 0; i < 4; i++) {
        const f0 = i * 0.035, f1 = (i + 1) * 0.035;
        g.globalAlpha = al * (0.55 - i * 0.12);
        g.strokeStyle = "#dfe8ff"; g.lineWidth = 1.6 - i * 0.3;
        g.beginPath(); g.moveTo(hx - shoot.vx * f0, hy - shoot.vy * f0); g.lineTo(hx - shoot.vx * f1, hy - shoot.vy * f1); g.stroke();
      }
      g.globalAlpha = al * 0.8;
      g.drawImage(misc.spark, hx - 5, hy - 5, 10, 10);
      g.lineCap = "butt";
    }
    g.globalCompositeOperation = "source-over"; g.globalAlpha = 1;
  };

  // ================================================================ sprites d'étoiles
  let tightHalo = false; // LOD : halo resserré quand le bocal est très plein (ou en mode Éco)
  let lodTight = false;  // état du LOD, changé seulement ENTRE les tirs (hystérésis 30 / 24 corps) : pas de saut en pleine cascade
  function updateLod(run) {
    const sc = BE.state.scene, n = run.jar.bodies.length;
    if (BE.settings && BE.settings.eco) lodTight = true;
    else if (!BE.Run.RESOLVING[sc] && sc !== "COUNT") { if (n > 30) lodTight = true; else if (n < 24) lodTight = false; }
    return lodTight;
  }
  /**
   * Préchauffage des sprites (§12.7) : chaque sprite d'étoile (7 tailles × 4 familles × pure / halo resserré, pour les
   * réglages daltonien / contraste courants) et chaque visage est construit à l'avance, quelques-uns par image,
   * pendant les phases calmes (titre, intro, visée, Aube) — jamais au milieu d'une cascade de fusions.
   */
  const prewarm = { i: 0, key: -1 };
  R.prewarmStep = function (budgetMs) {
    const s = BE.settings || EMPTY;
    const key = (s.colorblind ? 2 : 0) | (s.contrast ? 4 : 0);
    if (key !== prewarm.key) { prewarm.key = key; prewarm.i = 0; }
    const N = 7 * 4 * 4, NF = 7 * 3 * 2, t0 = performance.now();
    while (prewarm.i < N + NF && performance.now() - t0 < (budgetMs || 2)) {
      const i = prewarm.i++;
      if (i < N) {
        const size = 1 + (i % 7), ci = Math.floor(i / 7) % 4, vv = Math.floor(i / 28);
        starSprite(size, ci, key | (vv & 1) | (vv & 2 ? 8 : 0));
      } else {
        const j = i - N;
        faceSprite(1 + (j % 7), Math.floor(j / 7) % 3, Math.floor(j / 21));
      }
    }
    return prewarm.i >= N + NF;
  };
  function variantOf(pure) {
    const s = BE.settings || EMPTY;
    return (pure ? 1 : 0) | (s.colorblind ? 2 : 0) | (s.contrast ? 4 : 0) | (tightHalo ? 8 : 0);
  }
  function starSprite(size, ci, v) {
    const row = starSprites[v * 5 + ci] || (starSprites[v * 5 + ci] = []);
    return row[size] || (row[size] = buildStar(size, ci, v));
  }
  function buildStar(size, ci, v) {
    const pure = v & 1, cb = v & 2, hc = v & 4, tight = v & 8;
    const r = D.SIZES[size].r, HR = tight ? 1.32 : 1.8, H = Math.ceil(r * HR) + 2;
    const [c, x] = off(H * 2, H * 2);
    const cx = H, cy = H;
    const base = hc ? lighten(FAM_COL[ci], 0.15) : FAM_COL[ci];
    const hole = size >= 7;
    // halo (r × 1,8, alpha 0,35)
    const hcol = hole ? P.frag : base;
    const hg = x.createRadialGradient(cx, cy, r * 0.6, cx, cy, r * HR);
    hg.addColorStop(0, U.rgba(hcol, 0.38)); hg.addColorStop(0.45, U.rgba(hcol, 0.13)); hg.addColorStop(1, U.rgba(hcol, 0));
    x.fillStyle = hg; x.beginPath(); x.arc(cx, cy, H, 0, TAU); x.fill();
    // couronne de rayons (Géante, Nova)
    if (!hole && size >= 5) {
      x.globalCompositeOperation = "lighter";
      const n = size === 6 ? 14 : 10;
      for (let i = 0; i < n; i++) {
        const a = i / n * TAU + (i % 2) * 0.12, l = r * (i % 2 ? 1.45 : 1.7) * (tight ? 0.78 : 1), w = 0.09;
        x.fillStyle = U.rgba(base, i % 2 ? 0.08 : 0.13);
        x.beginPath(); x.moveTo(cx + Math.cos(a - w) * r * 0.8, cy + Math.sin(a - w) * r * 0.8);
        x.lineTo(cx + Math.cos(a) * l, cy + Math.sin(a) * l); x.lineTo(cx + Math.cos(a + w) * r * 0.8, cy + Math.sin(a + w) * r * 0.8); x.fill();
      }
      x.globalCompositeOperation = "source-over";
    }
    // disque
    if (hole) {
      const dg = x.createRadialGradient(cx, cy, r * 0.15, cx, cy, r);
      dg.addColorStop(0, "#000000"); dg.addColorStop(0.72, "#05060c"); dg.addColorStop(0.9, "#1a1030"); dg.addColorStop(1, U.rgba(P.frag, 0.95));
      x.fillStyle = dg;
    } else {
      const dg = x.createRadialGradient(cx - r * 0.32, cy - r * 0.38, r * 0.05, cx, cy, r);
      dg.addColorStop(0, U.shade(base, 0.6)); dg.addColorStop(0.45, U.shade(base, 0.16)); dg.addColorStop(1, U.shade(base, -0.3));
      x.fillStyle = dg;
    }
    x.beginPath(); x.arc(cx, cy, r, 0, TAU); x.fill();
    if (!hole) {
      // ombre basse douce + lumière de rebord
      x.save(); x.beginPath(); x.arc(cx, cy, r, 0, TAU); x.clip();
      const sg = x.createRadialGradient(cx - r * 0.2, cy - r * 0.3, r * 0.7, cx - r * 0.2, cy - r * 0.3, r * 1.45);
      sg.addColorStop(0, "rgba(0,0,20,0)"); sg.addColorStop(1, "rgba(0,0,20,0.28)");
      x.fillStyle = sg; x.fillRect(cx - r, cy - r, r * 2, r * 2);
      x.restore();
      x.strokeStyle = U.rgba(lighten(base, 0.6), 0.55); x.lineWidth = Math.max(1, r * 0.08);
      x.beginPath(); x.arc(cx, cy, r - r * 0.1, Math.PI * 0.05, Math.PI * 0.55); x.stroke();
    }
    // motif daltonien (§11.1)
    if (cb && !hole) drawPattern(x, ci, cx, cy, r);
    // reflet spéculaire
    x.fillStyle = hole ? "rgba(199,166,255,0.25)" : "rgba(255,255,255,0.42)";
    x.beginPath(); x.ellipse(cx - r * 0.38, cy - r * 0.46, r * 0.27, r * 0.14, -0.6, 0, TAU); x.fill();
    if (!hole) { x.fillStyle = "rgba(255,255,255,0.7)"; x.beginPath(); x.arc(cx - r * 0.12, cy - r * 0.6, r * 0.05, 0, TAU); x.fill(); }
    // liseré (blanc si fusion pure ; 2 px blanc en contraste renforcé)
    x.lineWidth = hc ? 2 : 1.5;
    x.strokeStyle = hc || pure ? "#ffffff" : hole ? U.rgba(P.frag, 0.9) : "rgba(255,255,255,0.32)";
    x.beginPath(); x.arc(cx, cy, r - x.lineWidth / 2, 0, TAU); x.stroke();
    if (pure && !hc) { x.strokeStyle = "rgba(255,255,255,0.3)"; x.lineWidth = 3; x.beginPath(); x.arc(cx, cy, r + 1.5, 0, TAU); x.stroke(); }
    c.H = H;
    return c;
  }
  function drawPattern(x, ci, cx, cy, r) {
    x.save();
    x.strokeStyle = "rgba(255,255,255,0.4)"; x.fillStyle = "rgba(255,255,255,0.4)"; x.lineWidth = Math.max(1, r * 0.08); x.lineCap = "round";
    // motif sur le « front » de l'étoile (au-dessus des yeux) : il ne recouvre jamais la bouche (§11.1)
    const s = r * 0.38;
    cy -= r * 0.78; cx += r * 0.1;
    if (ci === 0) { // 3 flammes
      for (let i = 0; i < 3; i++) { const px = cx + (i - 1) * s * 0.55, py = cy + s * 0.55; x.beginPath(); x.moveTo(px, py - s * 0.5); x.lineTo(px + s * 0.2, py + s * 0.15); x.lineTo(px - s * 0.2, py + s * 0.15); x.fill(); }
    } else if (ci === 1) { // flocon à 6 branches
      for (let i = 0; i < 3; i++) { const a = i * Math.PI / 3; x.beginPath(); x.moveTo(cx - Math.cos(a) * s * 0.6, cy + s * 0.35 - Math.sin(a) * s * 0.6); x.lineTo(cx + Math.cos(a) * s * 0.6, cy + s * 0.35 + Math.sin(a) * s * 0.6); x.stroke(); }
    } else if (ci === 2) { // feuille
      x.beginPath(); x.ellipse(cx, cy + s * 0.4, s * 0.75, s * 0.36, -0.5, 0, TAU); x.stroke();
      x.beginPath(); x.moveTo(cx - s * 0.6, cy + s * 0.75); x.lineTo(cx + s * 0.55, cy + s * 0.05); x.stroke();
    } else if (ci === 3) { // zigzag
      x.beginPath(); x.moveTo(cx - s * 0.6, cy); x.lineTo(cx - s * 0.1, cy + s * 0.5); x.lineTo(cx - s * 0.05, cy + s * 0.15); x.lineTo(cx + s * 0.6, cy + s * 0.75); x.stroke();
    }
    x.restore();
  }
  /** Petit motif de famille (daltonien) centré en (x, y), demi-taille s, en creux sombre (icônes de réaction). */
  function stamp(x, ci, px, py, s) {
    x.save();
    x.fillStyle = "rgba(5,6,12,0.82)"; x.strokeStyle = "rgba(5,6,12,0.82)"; x.lineWidth = Math.max(0.9, s * 0.45); x.lineCap = "round";
    x.beginPath();
    if (ci === 0) { x.moveTo(px, py - s); x.lineTo(px + s * 0.7, py + s * 0.8); x.lineTo(px - s * 0.7, py + s * 0.8); x.closePath(); x.fill(); }
    else if (ci === 1) { for (let i = 0; i < 3; i++) { const a = i * Math.PI / 3; x.moveTo(px - Math.cos(a) * s, py - Math.sin(a) * s); x.lineTo(px + Math.cos(a) * s, py + Math.sin(a) * s); } x.stroke(); }
    else if (ci === 2) { x.ellipse(px, py, s, s * 0.5, -0.6, 0, TAU); x.fill(); }
    else if (ci === 3) { x.moveTo(px - s, py - s * 0.6); x.lineTo(px + s * 0.2, py - s * 0.1); x.lineTo(px - s * 0.2, py + s * 0.1); x.lineTo(px + s, py + s * 0.7); x.stroke(); }
    x.restore();
  }
  /** Disque d'accrétion du Trou Noir (tourne à la volée). */
  function accretion() {
    if (misc.acc) return misc.acc;
    const r = D.SIZES[7].r, H = r * 1.7;
    const [c, x] = off(H * 2, H * 2);
    x.translate(H, H);
    x.globalCompositeOperation = "lighter";
    const ring = x.createRadialGradient(0, 0, r * 0.9, 0, 0, H);
    ring.addColorStop(0, "rgba(199,166,255,0.28)"); ring.addColorStop(0.35, "rgba(199,166,255,0.1)"); ring.addColorStop(1, "rgba(199,166,255,0)");
    x.fillStyle = ring; x.beginPath(); x.arc(0, 0, H, 0, TAU); x.fill();
    for (let arm = 0; arm < 3; arm++) {
      for (let i = 0; i < 110; i++) {
        const k = i / 110, a = arm * TAU / 3 + k * 2.8, d = r * (0.94 + k * 0.66);
        x.fillStyle = arm === 1 ? "rgba(255,209,102," + (0.16 * (1 - k)).toFixed(3) + ")" : "rgba(199,166,255," + (0.2 * (1 - k)).toFixed(3) + ")";
        x.beginPath(); x.arc(Math.cos(a) * d, Math.sin(a) * d, 3.4 * (1 - k * 0.7), 0, TAU); x.fill();
      }
    }
    c.H = H;
    return (misc.acc = c);
  }

  // ---------------------------------------------------------------- visages : sprites par taille (yeux, joues, bouche)
  function faceSprite(size, mode, hole) {
    const i = (size * 3 + mode) * 2 + hole;
    return faceSprites[i] || (faceSprites[i] = buildFace(size, mode, hole));
  }
  function buildFace(size, mode, hole) {
    const r = D.SIZES[size].r;
    // cadré sur les traits (yeux, joues, bouche) : ~4× moins de pixels à composer qu'un disque entier
    const [c, x] = off(r * 1.4, r * 0.74);
    const cx = r * 0.7, cy = r * 0.34;
    const ex = r * 0.32, ey = -r * 0.08, ew = r * 0.16, eh = r * 0.2;
    if (!hole && size >= 2) {
      x.fillStyle = "rgba(255,105,150,0.26)";
      for (const s of [-1, 1]) { x.beginPath(); x.ellipse(cx + s * r * 0.52, cy + r * 0.16, r * 0.13, r * 0.075, 0, 0, TAU); x.fill(); }
    }
    for (const s of [-1, 1]) {
      const ecx = cx + s * ex, ecy = cy + ey;
      if (mode === 1) {
        x.strokeStyle = hole ? P.frag : "rgba(10,12,24,0.8)"; x.lineWidth = Math.max(1, r * 0.06); x.lineCap = "round";
        x.beginPath(); x.moveTo(ecx - ew, ecy); x.quadraticCurveTo(ecx, ecy + eh * 0.7, ecx + ew, ecy); x.stroke();
      } else {
        x.fillStyle = hole ? P.frag : "#ffffff";
        x.beginPath(); x.ellipse(ecx, ecy, ew, eh, 0, 0, TAU); x.fill();
        x.strokeStyle = "rgba(10,12,24,0.25)"; x.lineWidth = Math.max(0.5, r * 0.02); x.stroke();
      }
    }
    if (size >= 2 && !hole) {
      x.strokeStyle = "rgba(10,12,24,0.6)"; x.fillStyle = "rgba(40,10,30,0.75)"; x.lineWidth = Math.max(1, r * 0.05); x.lineCap = "round";
      if (mode === 2) { x.beginPath(); x.ellipse(cx, cy + r * 0.24, r * 0.075, r * 0.095, 0, 0, TAU); x.fill(); }
      else { x.beginPath(); x.arc(cx, cy + r * 0.18, r * 0.12, 0.15 * Math.PI, 0.85 * Math.PI); x.stroke(); }
    }
    return c;
  }
  function pupilSprite(size, hole) {
    const i = size * 2 + hole;
    if (pupilSprites[i]) return pupilSprites[i];
    const r = D.SIZES[size].r, ew = r * 0.16, pr = ew * 0.58, H = pr + 1;
    const [c, x] = off(H * 2, H * 2);
    x.fillStyle = hole ? "#ffffff" : "#0a0c18";
    x.beginPath(); x.arc(H, H, pr, 0, TAU); x.fill();
    x.fillStyle = hole ? P.frag : "#ffffff";
    x.beginPath(); x.arc(H - ew * 0.2, H - ew * 0.24, ew * 0.2, 0, TAU); x.fill();
    c.H = H;
    return (pupilSprites[i] = c);
  }

  /**
   * Dessine une étoile (sprite + visage).
   * o: {pure, lookX, lookY, seed, squash (0–1, horizontal), sx, sy (étirement explicite), stretch + dir (étirement
   *     orienté, rad), scale, alpha, bicolor, bicolorA, sleepy, excited, noFace}
   */
  R.drawStar = function (x, y, size, color, o) {
    o = o || EMPTY;
    if (!D.SIZES[size]) return;
    const ci = famIdx(color);
    const sp = starSprite(size, ci, variantOf(o.pure));
    const r = D.SIZES[size].r;
    const sc = o.scale || 1;
    let sx = sc, sy = sc;
    if (o.squash) { const k = o.squash; sx *= 1 + 0.25 * k; sy *= 1 - 0.18 * k; }
    if (o.sx) { sx *= o.sx; sy *= o.sy; }
    const alpha = o.alpha !== undefined ? o.alpha : 1;
    g.globalAlpha = alpha;
    if (size >= 7) { // disque d'accrétion tournant
      const ac = accretion(), t = BE.state.time;
      g.save(); g.translate(x, y); g.rotate(t * 0.8); g.scale(sx, sy * 0.92);
      g.globalCompositeOperation = "lighter";
      g.drawImage(ac, -ac.H, -ac.H, ac.H * 2, ac.H * 2);
      g.restore();
      g.globalAlpha = alpha;
    }
    const H = sp.H;
    if (o.stretch) {
      g.save(); g.translate(x, y); g.rotate(o.dir || 0); g.scale(1 + o.stretch, 1 - o.stretch * 0.45); g.rotate(-(o.dir || 0));
      g.drawImage(sp, -H * sx, -H * sy, H * 2 * sx, H * 2 * sy);
      g.restore();
    } else g.drawImage(sp, x - H * sx, y - H * sy, H * 2 * sx, H * 2 * sy);
    if (o.bicolor) {
      g.strokeStyle = famColor(o.bicolor); g.lineWidth = 2.5; g.globalAlpha = alpha * (o.bicolorA || 1);
      g.beginPath(); g.arc(x, y, r * sc + 2, 0, TAU); g.stroke();
      g.globalAlpha = alpha;
    }
    // Contraste renforcé : le contour blanc de 2 px et les familles +15 % sont dans la variante de sprite (bit 4)
    if (!o.noFace && r * sc >= 7) drawFace(x, y, size, sc, sx, sy, o);
    g.globalAlpha = 1;
  };
  function drawFace(x, y, size, sc, sx, sy, o) {
    const t = BE.state.time;
    const seed = o.seed || 0;
    const period = 3 + (seed % 300) / 100;
    const blink = o.sleepy || ((t + seed * 0.37) % period) < 0.13;
    const hole = size >= 7 ? 1 : 0;
    const r = D.SIZES[size].r;
    const fs = faceSprite(size, blink ? 1 : o.excited ? 2 : 0, hole);
    g.drawImage(fs, x - r * 0.7 * sx, y - r * 0.34 * sy, r * 1.4 * sx, r * 0.74 * sy);
    if (blink) return;
    let lx = 0, ly = 0;
    if (o.lookX !== undefined) {
      const dx = o.lookX - x, dy = o.lookY - y, d = Math.sqrt(dx * dx + dy * dy) || 1;
      const m = Math.min(2, r * sc * 0.07) / sc;
      lx = dx / d * m; ly = dy / d * m;
    }
    const ps = pupilSprite(size, hole), ph = ps.H;
    const ex = r * 0.32, ey = -r * 0.08 + r * 0.2 * 0.12;
    for (let s = -1; s <= 1; s += 2) {
      const px = x + (s * ex + lx) * sx, py = y + (ey + ly) * sy;
      g.drawImage(ps, px - ph * sx, py - ph * sy, ph * 2 * sx, ph * 2 * sy);
    }
  }

  // ================================================================ Pierres Noires (sprites par taille × 4 variantes)
  function stoneSprite(size, v) {
    const i = size * 4 + v;
    return stoneSprites[i] || (stoneSprites[i] = buildStone(size, v));
  }
  function buildStone(size, v) {
    const r = D.SIZES[size].r, H = r + 4;
    const [c, x] = off(H * 2, H * 2);
    const rnd = U.mulberry32(size * 31 + v * 7 + 1);
    const pts = [];
    for (let i = 0; i < 7; i++) {
      const a = i / 7 * TAU + rnd() * 0.4, rr = r * (0.86 + rnd() * 0.16);
      pts.push(H + Math.cos(a) * rr, H + Math.sin(a) * rr);
    }
    const path = () => { x.beginPath(); x.moveTo(pts[0], pts[1]); for (let i = 2; i < pts.length; i += 2) x.lineTo(pts[i], pts[i + 1]); x.closePath(); };
    // halo violet sourd (les Pierres viennent des Ombres)
    const hg = x.createRadialGradient(H, H, r * 0.7, H, H, H);
    hg.addColorStop(0, "rgba(181,156,255,0.12)"); hg.addColorStop(1, "rgba(181,156,255,0)");
    x.fillStyle = hg; x.fillRect(0, 0, H * 2, H * 2);
    path();
    const gr = x.createLinearGradient(H - r, H - r, H + r, H + r);
    gr.addColorStop(0, "#40465e"); gr.addColorStop(0.5, P.pierre); gr.addColorStop(1, "#171a24");
    x.fillStyle = gr; x.fill();
    x.save(); path(); x.clip();
    // facettes
    x.fillStyle = "rgba(255,255,255,0.06)";
    x.beginPath(); x.moveTo(pts[8], pts[9]); x.lineTo(H - r * 0.1, H - r * 0.15); x.lineTo(pts[10], pts[11]); x.lineTo(pts[12], pts[13]); x.closePath(); x.fill();
    x.fillStyle = "rgba(0,0,0,0.18)";
    x.beginPath(); x.moveTo(pts[2], pts[3]); x.lineTo(H - r * 0.1, H - r * 0.15); x.lineTo(pts[4], pts[5]); x.lineTo(pts[6], pts[7]); x.closePath(); x.fill();
    x.restore();
    path(); x.strokeStyle = P.pierreLine; x.lineWidth = 1.5; x.stroke();
    x.strokeStyle = "rgba(160,170,210,0.35)"; x.lineWidth = 1;
    x.beginPath(); x.moveTo(pts[8], pts[9]); x.lineTo(pts[10], pts[11]); x.lineTo(pts[12], pts[13]); x.stroke();
    // fissures (une lueur violette dans la plus grande)
    x.lineCap = "round";
    x.strokeStyle = "rgba(181,156,255,0.35)"; x.lineWidth = 2.2;
    x.beginPath(); x.moveTo(H - r * 0.3, H - r * 0.5); x.lineTo(H - r * 0.05, H - r * 0.1); x.lineTo(H - r * 0.25, H + r * 0.3); x.stroke();
    x.strokeStyle = "rgba(8,9,16,0.9)"; x.lineWidth = 1;
    x.beginPath(); x.moveTo(H - r * 0.3, H - r * 0.5); x.lineTo(H - r * 0.05, H - r * 0.1); x.lineTo(H - r * 0.25, H + r * 0.3);
    x.moveTo(H + r * 0.2, H + r * 0.1); x.lineTo(H + r * 0.5, H + r * 0.35); x.moveTo(H + r * 0.05, H - r * 0.55); x.lineTo(H + r * 0.25, H - r * 0.3); x.stroke();
    c.H = H;
    return c;
  }
  function sizeOfR(r) { for (let s = 1; s <= 7; s++) if (D.SIZES[s].r >= r - 0.5) return s; return 7; }
  /** Pierre Noire : polygone irrégulier à 7 sommets avec fissures (sprite). b : {x, y, r, size?, id, seed} */
  R.drawStone = function (b, alpha, sx, sy) {
    const size = b.size || sizeOfR(b.r);
    const v = ((b.seed || b.id * 2654435761) >>> 0) & 3;
    const sp = stoneSprite(size, v);
    const k = b.r / D.SIZES[size].r;
    const H = sp.H * k, fx = sx || 1, fy = sy || 1;
    g.globalAlpha = alpha === undefined ? 1 : alpha;
    g.drawImage(sp, b.x - H * fx, b.y - H * fy, H * 2 * fx, H * 2 * fy);
    g.globalAlpha = 1;
  };

  // ================================================================ Ombres
  const BX = new Float64Array(12), BY = new Float64Array(12);
  /** Tache à 10 sommets déformés par un sinus lent (2 harmoniques, ±1,5 px), lissée. */
  function blobPath(x, y, r, t, seed, flat) {
    const n = 10, f = flat || 1;
    for (let i = 0; i < n; i++) {
      const a = i / n * TAU;
      const w = 1.5 * (Math.sin(t * 2.1 + i * 1.7 + seed) + 0.6 * Math.sin(t * 3.3 + i * 2.9 + seed * 0.5)) / 1.6;
      const rr = r + 1.2 + w;
      BX[i] = x + Math.cos(a) * rr; BY[i] = y + Math.sin(a) * rr * f + (f < 1 ? r * (1 - f) * 0.5 : 0);
    }
    g.beginPath();
    g.moveTo((BX[n - 1] + BX[0]) / 2, (BY[n - 1] + BY[0]) / 2);
    for (let i = 0; i < n; i++) {
      const j = i + 1 < n ? i + 1 : 0;
      g.quadraticCurveTo(BX[i], BY[i], (BX[i] + BX[j]) / 2, (BY[i] + BY[j]) / 2);
    }
    g.closePath();
  }
  function eye(x, y, r, lx, ly, kind, blink) {
    if (blink && kind !== "flame") {
      g.strokeStyle = "#ffffff"; g.lineWidth = Math.max(1, r * 0.35); g.lineCap = "round";
      g.beginPath(); g.moveTo(x - r * 0.8, y); g.lineTo(x + r * 0.8, y); g.stroke(); g.lineCap = "butt";
      return;
    }
    g.fillStyle = "#ffffff";
    g.beginPath(); g.ellipse(x, y, r, r * (kind === "half" ? 0.55 : 1), 0, 0, TAU); g.fill();
    if (kind === "flame") {
      g.fillStyle = "#ffb347";
      g.beginPath(); g.moveTo(x + lx, y + ly - r * 0.9); g.quadraticCurveTo(x + lx + r * 0.6, y + ly + r * 0.3, x + lx, y + ly + r * 0.6);
      g.quadraticCurveTo(x + lx - r * 0.6, y + ly + r * 0.3, x + lx, y + ly - r * 0.9); g.fill();
      return;
    }
    g.fillStyle = "#05060c";
    g.beginPath(); g.arc(x + lx, y + ly + (kind === "half" ? r * 0.1 : 0), r * 0.5, 0, TAU); g.fill();
    if (kind === "half") { g.fillStyle = P.ombre; g.fillRect(x - r - 1, y - r - 1, r * 2 + 2, r * 0.75); }
    else if (r >= 3) { g.fillStyle = "rgba(255,255,255,0.9)"; g.beginPath(); g.arc(x + lx - r * 0.18, y + ly - r * 0.2, r * 0.14, 0, TAU); g.fill(); }
  }

  /** Corps d'une Ombre (sans badges). look : {x, y} (point regardé). */
  R.drawShadow = function (s, look) {
    const t = BE.state.time;
    const x = s.dispX, y = s.dispY;
    const r = s.r;
    const since = t - (s.squashT || -9);
    let sx = 1, sy = 1;
    if (since < 0.1) { const k = 1 - since / 0.1; sx = 1 + 0.15 * k; sy = 1 - 0.15 * k; }
    const spawnK = s.spawnT !== undefined ? U.clamp((t - s.spawnT) / 0.35, 0, 1) : 1;
    const sk = 0.3 + 0.7 * U.easeOutBack(spawnK);
    const boss = s.type === "boss";
    const bd = boss ? D.BOSSES[s.bossId] : null;
    const seed = (typeof s.id === "number" ? s.id : 3) * 1.37;
    const lx0 = look ? look.x - x : 0, ly0 = look ? look.y - y : 20;
    const ld = Math.sqrt(lx0 * lx0 + ly0 * ly0) || 1;
    const blink = ((t * 0.9 + seed * 0.53) % (4 + (seed % 3))) < 0.12;
    const hurtK = Math.max(0, 1 - (t - (s.hurtT || -9)) / 0.18);
    g.save();
    g.translate(x, y); g.scale(sx * sk, sy * sk);
    // aura (lisibilité sur fond sombre)
    g.globalCompositeOperation = "lighter";
    g.globalAlpha = spawnK * (boss ? 0.3 + 0.08 * Math.sin(t * 2) : 0.16 + 0.35 * hurtK);
    const auraCol = boss ? bd.color : s.type === "lanterne" ? "#fff3a0" : P.ombreLine;
    const ar = r * (boss ? 1.9 : s.type === "lanterne" ? 2.3 : 1.7);
    g.drawImage(BE.FX.glow(auraCol), -ar, -ar, ar * 2, ar * 2);
    g.globalCompositeOperation = "source-over"; g.globalAlpha = spawnK;
    if (boss && s.bossId === "eclipse") { // couronne solaire
      g.strokeStyle = "rgba(255,160,190,0.5)"; g.lineWidth = 3;
      g.beginPath(); g.arc(0, 0, r + 5 + Math.sin(t * 3) * 1.5, 0, TAU); g.stroke();
    }
    const fillCol = hurtK > 0.4 ? "#5a4690" : hurtK > 0 ? "#2a2148" : P.ombre;
    if (s.type === "nuee") {
      for (let i = 0; i < 3; i++) {
        const ox = i === 0 ? -7 : i === 1 ? 7 : 0, oy = i === 2 ? -6 : 4, rr = i === 2 ? 10 : 9;
        blobPath(ox, oy, rr, t, seed + ox, 1);
        g.fillStyle = fillCol; g.fill(); g.strokeStyle = P.ombreLine; g.lineWidth = 1.5; g.stroke();
      }
      eye(-7, 4, 2.6, lx0 / ld, ly0 / ld, null, blink); eye(7, 4, 2.6, lx0 / ld, ly0 / ld, null, blink); eye(0, -6, 3, lx0 / ld, ly0 / ld, null, blink);
    } else if (s.type === "blindee") {
      g.beginPath();
      for (let i = 0; i < 6; i++) { const a = i / 6 * TAU + Math.PI / 6; const px = Math.cos(a) * r, py = Math.sin(a) * r; if (i) g.lineTo(px, py); else g.moveTo(px, py); }
      g.closePath(); g.fillStyle = fillCol; g.fill();
      g.strokeStyle = "#8f86c8"; g.lineWidth = 3.5; g.stroke();
      g.strokeStyle = P.ombreLine; g.lineWidth = 1; g.stroke();
      // rivets
      g.fillStyle = "#b8b0ee";
      for (let i = 0; i < 6; i++) { const a = i / 6 * TAU + Math.PI / 6; g.beginPath(); g.arc(Math.cos(a) * (r - 3.5), Math.sin(a) * (r - 3.5), 1, 0, TAU); g.fill(); }
      eye(0, -1, 5, lx0 / ld * 2, ly0 / ld * 2, null, blink);
      g.fillStyle = "#8f86c8";
      g.beginPath(); g.moveTo(-5, 8); g.lineTo(5, 8); g.lineTo(5, 11); g.quadraticCurveTo(0, 16, -5, 11); g.closePath(); g.fill();
    } else {
      const flat = s.type === "lourde" ? 0.78 : 1;
      blobPath(0, 0, r, t, seed, flat);
      g.fillStyle = fillCol; g.fill();
      g.strokeStyle = boss ? bd.color : P.ombreLine; g.lineWidth = boss ? 2.5 : 1.5; g.stroke();
      // reflet intérieur
      g.strokeStyle = "rgba(181,156,255,0.28)"; g.lineWidth = 1.5;
      g.beginPath(); g.arc(-r * 0.12, -r * 0.12 + (flat < 1 ? r * 0.1 : 0), r * 0.62, Math.PI * 1.08, Math.PI * 1.45); g.stroke();
      const lx = lx0 / ld * 2, ly = ly0 / ld * 2;
      if (s.type === "lourde") { eye(-6, 2, 4.5, lx, ly, "half", blink); eye(6, 2, 4.5, lx, ly, "half", blink); }
      else if (s.type === "lanterne") eye(0, 0, 6, lx * 0.6, ly * 0.6, "flame");
      else if (s.type === "voleuse") {
        eye(0, 0, 5.5, lx, ly, null, blink);
        g.strokeStyle = P.ombreLine; g.lineWidth = 1.5;
        for (let i = -1; i <= 1; i++) { const ox = i * 6; g.beginPath(); g.moveTo(ox - 2, -r + 2); g.quadraticCurveTo(ox + 2, -r - 5, ox + 4, -r - 2); g.stroke(); }
        // masque de voleuse
        g.fillStyle = "rgba(181,156,255,0.35)"; g.fillRect(-9, -2.5, 18, 3);
      } else if (s.type === "eteignoir") {
        eye(0, 3, 5, lx, ly, null, blink);
        g.fillStyle = "#6a6390"; g.strokeStyle = P.ombreLine; g.lineWidth = 1;
        g.beginPath(); g.moveTo(-8, -r + 6); g.lineTo(8, -r + 6); g.lineTo(0, -r - 10); g.closePath(); g.fill(); g.stroke();
        g.beginPath(); g.moveTo(8, -r + 2); g.lineTo(15, -r - 2); g.stroke();
      } else if (s.type === "mere") {
        eye(0, 3, 6.5, lx, ly, null, blink);
        for (let i = 0; i < 5; i++) { const a = -Math.PI / 2 + (i - 2) * 0.55; eye(Math.cos(a) * (r - 6), Math.sin(a) * (r - 6), 2.8, lx * 0.5, ly * 0.5, null, blink && i % 2 === 0); }
      } else if (boss) drawBossFace(s, r, t, lx, ly, blink, bd);
      else eye(0, 0, 5.5, lx, ly, null, blink);
    }
    if (s.frozen) {
      g.globalAlpha = 0.32 * spawnK; g.fillStyle = P.givre;
      g.beginPath(); g.arc(0, 0, r + 1.5, 0, TAU); g.fill();
      g.globalAlpha = 0.65 * spawnK; g.strokeStyle = "#e8fbff"; g.lineWidth = 1;
      g.beginPath();
      g.moveTo(-r * 0.7, -r * 0.2); g.lineTo(-r * 0.2, -r * 0.55); g.lineTo(r * 0.35, -r * 0.6);
      g.moveTo(-r * 0.2, -r * 0.55); g.lineTo(-r * 0.05, r * 0.1); g.lineTo(r * 0.6, r * 0.25);
      g.stroke();
      g.globalAlpha = spawnK * (0.5 + 0.5 * Math.sin(t * 4 + seed));
      g.drawImage(misc.spark, r * 0.3, -r * 0.8, 8, 8);
      g.globalAlpha = spawnK;
    }
    if (hurtK > 0.5) { g.globalAlpha = (hurtK - 0.5) * 1.2; g.strokeStyle = "#ffffff"; g.lineWidth = 2; g.beginPath(); g.arc(0, 0, r + 1, 0, TAU); g.stroke(); }
    g.restore();
  };
  /** Visages et attributs des 7 boss (§6.4). */
  function drawBossFace(s, r, t, lx, ly, blink, bd) {
    const col = bd.color, id = s.bossId;
    if (id === "voile") {
      eye(-12, -2, 8, lx * 1.5, ly * 1.5, null, blink); eye(12, -2, 8, lx * 1.5, ly * 1.5, null, blink);
      g.fillStyle = "rgba(154,164,255,0.55)";
      g.beginPath(); g.moveTo(-r - 2, -6);
      for (let i = 0; i <= 8; i++) g.lineTo(-r + i * (r * 2 / 8), -2 + Math.sin(t * 3 + i) * 2 + (i % 2) * 5);
      g.lineTo(r + 2, -6); g.quadraticCurveTo(0, -r * 1.35, -r - 2, -6); g.fill();
      return;
    }
    eye(-12, -4, 8, lx * 1.5, ly * 1.5, null, blink); eye(12, -4, 8, lx * 1.5, ly * 1.5, null, blink);
    g.strokeStyle = col; g.fillStyle = col; g.lineWidth = 2;
    if (id === "faim") { // gueule dentée
      g.fillStyle = "#2a0812"; g.beginPath(); g.ellipse(0, 16, 15, 8 + Math.sin(t * 5) * 2, 0, 0, TAU); g.fill();
      g.fillStyle = "#ffffff";
      for (let i = -3; i <= 3; i++) { g.beginPath(); g.moveTo(i * 4 - 2, 9); g.lineTo(i * 4, 14); g.lineTo(i * 4 + 2, 9); g.fill(); }
      g.strokeStyle = col; g.stroke();
    } else if (id === "avare") { // monocle et sourire pincé
      g.lineWidth = 1.5; g.beginPath(); g.arc(12, -4, 10, 0, TAU); g.stroke();
      g.beginPath(); g.moveTo(20, 2); g.quadraticCurveTo(26, 14, 22, 24); g.stroke();
      g.beginPath(); g.moveTo(-8, 16); g.quadraticCurveTo(0, 12, 8, 16); g.stroke();
      g.fillStyle = col; g.beginPath(); g.arc(-r * 0.62, r * 0.55, 4, 0, TAU); g.fill();
    } else if (id === "grele") { // couronne de glace
      g.fillStyle = "#dff4ff";
      for (let i = -2; i <= 2; i++) { const a = -Math.PI / 2 + i * 0.35; const bx = Math.cos(a) * r, by = Math.sin(a) * r; g.beginPath(); g.moveTo(bx - 4, by + 3); g.lineTo(bx + Math.cos(a) * 12, by + Math.sin(a) * 12); g.lineTo(bx + 4, by + 3); g.fill(); }
      zig(-12, 14, 6, 4);
    } else if (id === "maree") { // vagues
      g.lineWidth = 2;
      for (let k = 0; k < 2; k++) { g.beginPath(); for (let i = 0; i <= 12; i++) { const px = -18 + i * 3; const py = 14 + k * 6 + Math.sin(t * 4 + i * 0.8 + k) * 2; if (i) g.lineTo(px, py); else g.moveTo(px, py); } g.stroke(); }
    } else if (id === "etau") { // mâchoires d'étau
      g.fillStyle = col;
      for (let sgn = -1; sgn <= 1; sgn += 2) { g.fillRect(sgn * (r + 2) - (sgn < 0 ? 8 : 0), -10, 8, 20); g.fillRect(sgn * (r + 6) - (sgn < 0 ? 4 : 0), -3, 4, 6); }
      zig(-12, 14, 6, 4);
    } else if (id === "eclipse") {
      g.strokeStyle = "#ffb0c8"; g.beginPath(); g.arc(0, 12, 10, 0.1 * Math.PI, 0.9 * Math.PI); g.stroke();
    } else zig(-12, 14, 6, 4);
  }
  function zig(x0, y0, n, h) { g.beginPath(); g.moveTo(x0, y0); for (let i = 0; i <= n; i++) g.lineTo(x0 + i * 4, y0 + (i % 2 ? h : 0)); g.stroke(); }

  // Ombres mourantes (silhouette qui s'efface) — cosmétique, alimenté par le bus
  const dying = [];
  for (let i = 0; i < 12; i++) dying.push({ alive: false, x: 0, y: 0, r: 18, t0: 0, gold: false });
  function addDying(tg, gold) {
    if (!tg) return;
    let d = null;
    for (let i = 0; i < dying.length; i++) if (!dying[i].alive) { d = dying[i]; break; }
    if (!d) d = dying[0];
    d.alive = true; d.x = tg.dispX !== undefined ? tg.dispX : tg.x; d.y = tg.dispY !== undefined ? tg.dispY : tg.y;
    d.r = tg.r || 18; d.t0 = BE.state.time; d.gold = gold;
  }
  BE.on("kill", (e) => addDying(e.target, false));
  BE.on("convert", (e) => addDying(e.target, true));
  BE.on("scene", (e) => { if (e.to === "TITLE" || e.to === "NIGHT_INTRO") for (let i = 0; i < dying.length; i++) dying[i].alive = false; });
  BE.on("land", (e) => { if (e.body) e.body.landT = BE.state.time; });
  function drawDying(t) {
    for (let i = 0; i < dying.length; i++) {
      const d = dying[i];
      if (!d.alive) continue;
      const dur = d.gold ? 0.6 : 0.3, k = (t - d.t0) / dur;
      if (k >= 1 || k < 0) { d.alive = false; continue; }
      g.globalAlpha = (1 - k) * 0.9;
      const col = d.gold ? P.or : k < 0.25 ? "#ffffff" : P.ombreLine;
      g.globalCompositeOperation = "lighter";
      g.drawImage(BE.FX.glow(col), d.x - d.r * 2, d.y - d.r * 2, d.r * 4, d.r * 4);
      g.globalCompositeOperation = "source-over";
      g.fillStyle = d.gold ? "#3a2a08" : P.ombre;
      g.beginPath(); g.arc(d.x, d.y, d.r * (1 + 0.35 * k) * (1 - k * 0.6), 0, TAU); g.fill();
      g.strokeStyle = col; g.lineWidth = 2 * (1 - k); g.stroke();
    }
    g.globalAlpha = 1;
  }

  function snowflake(x, y, s, col) {
    g.strokeStyle = col; g.lineWidth = 1.2;
    for (let i = 0; i < 3; i++) { const a = i * Math.PI / 3; g.beginPath(); g.moveTo(x - Math.cos(a) * s, y - Math.sin(a) * s); g.lineTo(x + Math.cos(a) * s, y + Math.sin(a) * s); g.stroke(); }
  }
  /** Badges PV (bas-droite) et compteur (haut-gauche), toujours au-dessus (§6.3). */
  R.drawBadges = function (s) {
    const x = s.dispX, y = s.dispY, r = s.r;
    const t = BE.state.time;
    const k = s.spawnT !== undefined ? U.clamp((t - s.spawnT) / 0.35, 0, 1) : 1;
    if (k <= 0) return;
    g.globalAlpha = k;
    g.textAlign = "center"; g.textBaseline = "middle";
    // PV
    const hx = x + r * 0.78, hy = y + r * 0.78;
    const hk = Math.max(0, 1 - (t - (s.hurtT || -9)) / 0.25);
    const hs = 9 + 2.5 * hk;
    g.fillStyle = P.panel; g.strokeStyle = hk > 0 ? "#ffffff" : "#4a5498"; g.lineWidth = 1.2;
    g.beginPath(); g.arc(hx, hy, hs, 0, TAU); g.fill(); g.stroke();
    g.fillStyle = hk > 0.5 ? "#ffd0d6" : "#ffffff"; g.font = font(800, s.hp >= 100 ? 8 : 10);
    g.fillText(String(s.hp), hx, hy + 0.5);
    // compteur
    const cx = x - r * 0.78, cy = y - r * 0.78;
    const warn = !s.frozen && s.counter <= 1;
    const pulse = warn ? 1 + 0.12 * Math.max(0, Math.sin(t * 7)) : 1;
    g.fillStyle = s.frozen ? P.givre : warn ? "#d7c2ff" : P.ombreLine;
    g.beginPath(); g.arc(cx, cy, 9 * pulse, 0, TAU); g.fill();
    if (warn) { g.strokeStyle = "rgba(255,255,255,0.7)"; g.lineWidth = 1; g.stroke(); }
    if (s.frozen) snowflake(cx, cy, 5, "#0b1830");
    else {
      g.fillStyle = "#0b0f1e"; g.font = font(900, 10);
      g.fillText(String(s.counter), cx, cy + 0.5);
    }
    if (s.type === "lourde") { g.fillStyle = P.ombreLine; g.font = font(900, 7); g.fillText("▼▼", cx, cy + 12); }
    if (s.burns && s.burns.length) {
      const fx = x + r * 0.78, fy = y - r, fl = 1 + 0.15 * Math.sin(t * 14 + x);
      g.globalCompositeOperation = "lighter"; g.globalAlpha = k * 0.6;
      g.drawImage(BE.FX.glow(P.braise), fx - 9, fy - 12, 18, 18);
      g.globalCompositeOperation = "source-over"; g.globalAlpha = k;
      g.fillStyle = P.braise;
      g.beginPath(); g.moveTo(fx, fy - 6 * fl); g.quadraticCurveTo(fx + 5, fy + 1, fx, fy + 3);
      g.quadraticCurveTo(fx - 5, fy + 1, fx, fy - 6 * fl); g.fill();
      g.fillStyle = "#ffe0a0"; g.beginPath(); g.arc(fx, fy + 0.5, 1.5, 0, TAU); g.fill();
      if (s.burns.length > 1) { g.fillStyle = "#fff"; g.font = font(800, 8); g.fillText(String(s.burns.length), fx + 7, fy - 2); }
    }
    g.globalAlpha = 1;
  };
  /** Anneau de PV du boss. */
  function drawBossBar(b) {
    if (!b.alive) return;
    const bd = D.BOSSES[b.bossId];
    const k = U.clamp(b.hp / b.maxhp, 0, 1);
    g.lineCap = "round";
    g.strokeStyle = "rgba(5,6,12,0.75)"; g.lineWidth = 5;
    g.beginPath(); g.arc(b.dispX, b.dispY, b.r + 6, 0, TAU); g.stroke();
    g.strokeStyle = bd.color; g.lineWidth = 3;
    g.beginPath(); g.arc(b.dispX, b.dispY, b.r + 6, -Math.PI / 2, -Math.PI / 2 + TAU * k); g.stroke();
    // tête de l'anneau
    const a = -Math.PI / 2 + TAU * k;
    g.globalCompositeOperation = "lighter"; g.globalAlpha = 0.8;
    g.drawImage(BE.FX.glow(bd.color), b.dispX + Math.cos(a) * (b.r + 6) - 7, b.dispY + Math.sin(a) * (b.r + 6) - 7, 14, 14);
    g.globalCompositeOperation = "source-over"; g.globalAlpha = 1;
    g.lineCap = "butt";
  }

  // ================================================================ clous
  function pegSprite(kind) {
    if (pegSprites[kind]) return pegSprites[kind];
    const H = 14;
    const [c, x] = off(H * 2, H * 2);
    const pr = G.pegR;
    if (kind === 0) { // normal
      const hg = x.createRadialGradient(H, H, pr * 0.8, H, H, pr * 2.4);
      hg.addColorStop(0, "rgba(201,210,234,0.22)"); hg.addColorStop(1, "rgba(201,210,234,0)");
      x.fillStyle = hg; x.fillRect(0, 0, H * 2, H * 2);
      const dg = x.createRadialGradient(H - 1.5, H - 1.5, 0.3, H, H, pr);
      dg.addColorStop(0, "#ffffff"); dg.addColorStop(0.5, P.peg); dg.addColorStop(1, "#8e98b8");
      x.fillStyle = dg; x.beginPath(); x.arc(H, H, pr, 0, TAU); x.fill();
      x.fillStyle = "rgba(255,255,255,0.8)"; x.beginPath(); x.arc(H - 1.6, H - 1.6, 1.3, 0, TAU); x.fill();
    } else if (kind === 1) { // éteint
      x.fillStyle = P.pegOff; x.beginPath(); x.arc(H, H, pr, 0, TAU); x.fill();
      x.strokeStyle = "rgba(10,12,24,0.8)"; x.lineWidth = 1; x.beginPath(); x.arc(H, H, pr - 1.5, 0, TAU); x.stroke();
    } else { // flash blanc
      const hg = x.createRadialGradient(H, H, 0, H, H, H);
      hg.addColorStop(0, "rgba(255,255,255,0.9)"); hg.addColorStop(0.35, "rgba(220,230,255,0.45)"); hg.addColorStop(1, "rgba(220,230,255,0)");
      x.fillStyle = hg; x.fillRect(0, 0, H * 2, H * 2);
      x.fillStyle = "#ffffff"; x.beginPath(); x.arc(H, H, pr + 0.5, 0, TAU); x.fill();
    }
    c.H = H;
    return (pegSprites[kind] = c);
  }
  R.drawPegs = function (pegs) {
    if (!pegs) return;
    const t = BE.state.time, fl0 = D.FX.pegFlash;
    for (let i = 0; i < pegs.length; i++) {
      const p = pegs[i];
      if (p.hidden || !p.active) continue;
      const since = t - (p.flash || -9);
      const pop = since < 0.3 ? 1 + 0.6 * (1 - since / 0.3) * (1 - since / 0.3) : 1;
      if (p.kind === "special" && p.clou) {
        const col = p.clou.type === "teint" && p.clou.color ? famColor(p.clou.color) : (D.CLOUS[p.clou.type] || EMPTY).color || "#fff";
        g.globalCompositeOperation = "lighter"; g.globalAlpha = 0.35 + 0.12 * Math.sin(t * 2.4 + i) + (since < 0.3 ? 0.4 * (1 - since / 0.3) : 0);
        g.drawImage(BE.FX.glow(col), p.x - 15, p.y - 15, 30, 30);
        g.globalCompositeOperation = "source-over"; g.globalAlpha = 1;
        g.strokeStyle = col; g.lineWidth = 2.5; g.beginPath(); g.arc(p.x, p.y, 8 * pop, 0, TAU); g.stroke();
        g.setLineDash(DASH_P); g.lineDashOffset = -t * 6; g.lineWidth = 1; g.globalAlpha = 0.6;
        g.beginPath(); g.arc(p.x, p.y, 11, 0, TAU); g.stroke();
        g.setLineDash(NO_DASH); g.globalAlpha = 1;
      }
      if (since < 0.35 && !p.dark) {
        g.globalCompositeOperation = "lighter"; g.globalAlpha = 0.9 * (1 - since / 0.35);
        g.drawImage(BE.FX.glow("#ffffff"), p.x - 16, p.y - 16, 32, 32);
        g.globalCompositeOperation = "source-over"; g.globalAlpha = 1;
      }
      const sp = pegSprite(since < fl0 ? 2 : p.dark ? 1 : 0);
      const H = sp.H * pop;
      g.drawImage(sp, p.x - H, p.y - H, H * 2, H * 2);
      if (p.kind === "double") {
        g.strokeStyle = p.dark ? P.pegOff : "#dfe8ff"; g.lineWidth = 1.2;
        g.beginPath(); g.arc(p.x, p.y, (p.r + 3) * pop, 0, TAU); g.stroke();
      }
    }
  };

  // ================================================================ bocal (verre pré-rendu)
  // Silhouette : épaules de l'entonnoir (mur du ciel, y = funnelY → col du bocal, y = rimY), murs verticaux, fond arrondi.
  function jarPath(x, l, r) {
    const bot = G.floor;
    x.beginPath();
    x.moveTo(G.wallL, G.funnelY); x.lineTo(l, G.rimY);
    x.lineTo(l, bot - 16); x.quadraticCurveTo(l, bot, l + 16, bot); x.lineTo(r - 16, bot); x.quadraticCurveTo(r, bot, r, bot - 16);
    x.lineTo(r, G.rimY); x.lineTo(G.wallR, G.funnelY);
  }
  function buildJar(l, r) {
    const top = G.funnelY, rim = G.rimY, bot = G.floor;
    const ox = G.wallL - 12, oy = top - 10, w = G.wallR - G.wallL + 24, h = bot - top + 16;
    let [c, x] = off(w, h);
    x.translate(-ox, -oy);
    // intérieur légèrement éclairci (#0f1428), à peine transparent pour laisser deviner le ciel
    jarPath(x, l, r); x.closePath();
    const ig = x.createLinearGradient(0, top, 0, bot);
    ig.addColorStop(0, "rgba(15,20,40,0.0)"); ig.addColorStop(0.2, "rgba(15,20,40,0.6)"); ig.addColorStop(0.5, "rgba(15,20,40,0.88)"); ig.addColorStop(1, "rgba(18,24,52,0.95)");
    x.fillStyle = ig; x.fill();
    x.save(); x.clip();
    const bg = x.createRadialGradient((l + r) / 2, bot + 20, 10, (l + r) / 2, bot + 20, 200);
    bg.addColorStop(0, "rgba(79,107,255,0.14)"); bg.addColorStop(1, "rgba(79,107,255,0)");
    x.fillStyle = bg; x.fillRect(l, top, r - l, bot - top);
    // reflet vertical le long du mur gauche (blanc 0,08)
    const rg = x.createLinearGradient(l, 0, l + 26, 0);
    rg.addColorStop(0, "rgba(255,255,255,0.08)"); rg.addColorStop(1, "rgba(255,255,255,0)");
    x.fillStyle = rg; x.fillRect(l + 2, rim + 6, 26, bot - rim - 20);
    x.restore();
    // hors du verre, sous les épaules : pénombre (le bocal est plus étroit que le ciel)
    x.fillStyle = "rgba(5,7,16,0.55)";
    x.beginPath(); x.moveTo(ox, top); x.lineTo(G.wallL, top); x.lineTo(l, rim); x.lineTo(l, bot + 16); x.lineTo(ox, bot + 16); x.closePath(); x.fill();
    x.beginPath(); x.moveTo(ox + w, top); x.lineTo(G.wallR, top); x.lineTo(r, rim); x.lineTo(r, bot + 16); x.lineTo(ox + w, bot + 16); x.closePath(); x.fill();
    jarBack = c;
    // face avant : contour, lèvres, reflets
    [c, x] = off(w, h);
    x.translate(-ox, -oy);
    x.lineCap = "round"; x.lineJoin = "round";
    x.strokeStyle = U.rgba(P.glass, 0.18); x.lineWidth = 6;
    jarPath(x, l, r); x.stroke();
    x.strokeStyle = U.rgba(P.glass, 0.6); x.lineWidth = 2;
    jarPath(x, l, r); x.stroke();
    // col du bocal : petite lèvre de verre
    x.strokeStyle = U.rgba(P.glass, 0.45); x.lineWidth = 1.5;
    x.beginPath(); x.moveTo(l - 6, rim + 2); x.lineTo(l + 1, rim + 2); x.moveTo(r + 6, rim + 2); x.lineTo(r - 1, rim + 2); x.stroke();
    x.strokeStyle = "rgba(255,255,255,0.22)"; x.lineWidth = 1;
    x.beginPath(); x.moveTo(l + 4, rim + 20); x.lineTo(l + 4, bot - 40); x.stroke();
    x.beginPath(); x.moveTo(G.wallL + 10, top + 5); x.lineTo(l - 6, rim - 8); x.stroke();
    x.strokeStyle = "rgba(255,255,255,0.12)"; x.lineWidth = 2;
    x.beginPath(); x.moveTo(r - 5, rim + 30); x.lineTo(r - 5, rim + 110); x.stroke();
    x.beginPath(); x.moveTo(l + 30, bot - 4); x.quadraticCurveTo((l + r) / 2, bot - 1, r - 40, bot - 4); x.stroke();
    x.fillStyle = "rgba(255,255,255,0.18)";
    x.beginPath(); x.ellipse(l + 12, rim + 22, 3, 9, 0.1, 0, TAU); x.fill();
    x.beginPath(); x.arc(l + 12, rim + 38, 1.5, 0, TAU); x.fill();
    jarFront = c;
    jarBack.ox = jarFront.ox = ox; jarBack.oy = jarFront.oy = oy;
  }
  function ensureJar(J) {
    const key = Math.round(J.wallL) * 1000 + Math.round(J.wallR);
    if (key !== jarKey || !jarBack) { jarKey = key; buildJar(J.wallL, J.wallR); }
  }
  /** Fond du bocal + thème éventuel (14_meta). */
  R.drawJarGlass = function (run) {
    const J = run.jar;
    ensureJar(J);
    g.drawImage(jarBack, jarBack.ox, jarBack.oy, jarBack.lw, jarBack.lh);
    if (BE.Meta && BE.Meta.drawJarTheme) BE.Meta.drawJarTheme(g, run, J.wallL, J.wallR, G.rimY, G.floor); // thème « Aurore » (D16)
  };
  /** Face avant du verre (reflets par-dessus les étoiles), alerte, aurore, rémanence du Big Bang. */
  R.drawJarFront = function (run, danger) {
    const J = run.jar, t = BE.state.time;
    ensureJar(J);
    const FX = BE.FX;
    const bb = t - FX.bigBangT;
    if (bb >= 0 && bb < 2.2) {
      g.globalCompositeOperation = "lighter"; g.globalAlpha = (1 - bb / 2.2) * 0.7;
      g.drawImage(FX.glow("#ffffff"), 20, 380, 320, 260);
      g.drawImage(FX.glow(P.frag), -40, 300, 440, 360);
      g.globalCompositeOperation = "source-over"; g.globalAlpha = 1;
    }
    const au = t - FX.auroraT;
    if (au >= 0 && au < 2.6) drawAurora(J, t, Math.sin(Math.min(1, au / 2.6) * Math.PI));
    // face avant : trois bandes (murs et fond) — le centre est transparent, inutile de le composer
    const F = jarFront, ox = F.ox, oy = F.oy, lw = J.wallL + 22 - ox, rx = J.wallR - 22, bt = G.floor - 24;
    g.drawImage(F, 0, 0, lw * K, F.lh * K, ox, oy, lw, F.lh);
    g.drawImage(F, (rx - ox) * K, 0, (F.lw - (rx - ox)) * K, F.lh * K, rx, oy, F.lw - (rx - ox), F.lh);
    g.drawImage(F, lw * K, (bt - oy) * K, (rx - ox - lw) * K, (F.lh - (bt - oy)) * K, ox + lw, bt, rx - ox - lw, F.lh - (bt - oy));
    if (danger) {
      const hb = t - FX.dangerT, pk = hb >= 0 && hb < 0.5 ? 1 - hb / 0.5 : 0;
      g.strokeStyle = P.danger; g.lineWidth = 2; g.globalAlpha = 0.25 + 0.35 * pk + 0.15 * Math.sin(t * 5);
      jarPath(g, J.wallL, J.wallR); g.stroke();
      g.globalAlpha = 1;
    }
  };
  function drawAurora(J, t, a) {
    const cols = ["#6ee07a", "#5ee7ff", "#c7a6ff", "#ff9ab0"];
    g.globalCompositeOperation = "lighter";
    for (let i = 0; i < cols.length; i++) {
      const y = 400 + i * 40 + Math.sin(t * 1.5 + i) * 12;
      g.globalAlpha = a * 0.35;
      g.drawImage(BE.FX.glow(cols[i]), J.wallL - 40 + Math.sin(t + i * 2) * 30, y - 40, J.wallR - J.wallL + 80, 90);
    }
    g.globalCompositeOperation = "source-over"; g.globalAlpha = 1;
  }

  /**
   * Ligne d'horizon + jauge de remplissage. level : 2 = danger (rouge, pouls), 1 = « presque » (ambre : l'étoile courante
   * posée sur le tas dépasserait la ligne), 0 = calme. La jauge suit Jar.fill (max surface / hauteur, §4) en douceur ;
   * pendant la Vidange elle descend vers ce qui reste au bocal.
   */
  let gaugeShown = -1, gaugeRun = null;
  R.drawHorizon = function (run, level) {
    const danger = level === 2, near = level === 1;
    const h = BE.Run.horizon(run);
    const t = BE.state.time, st = BE.state;
    const pulse = danger ? 0.55 + 0.45 * Math.sin(t * TAU * 0.8) : near ? 0.5 + 0.5 * Math.sin(t * TAU * 0.5) : 0;
    if (danger || near) {
      g.globalCompositeOperation = "lighter"; g.globalAlpha = danger ? 0.25 + 0.25 * pulse : 0.12 + 0.1 * pulse;
      g.drawImage(BE.FX.glow(danger ? P.danger : P.or), run.jar.wallL - 20, h - 16, run.jar.wallR - run.jar.wallL + 40, 32);
      g.globalCompositeOperation = "source-over"; g.globalAlpha = 1;
    }
    g.strokeStyle = danger ? P.danger : near ? P.or : C_DIM70;
    g.globalAlpha = danger ? 0.55 + 0.45 * pulse : near ? 0.6 + 0.25 * pulse : 1;
    g.lineWidth = danger ? 1.6 : near ? 1.3 : 1;
    g.setLineDash(DASH_H); g.lineDashOffset = -t * 8;
    g.beginPath(); g.moveTo(run.jar.wallL + 2, h); g.lineTo(run.jar.wallR - 2, h); g.stroke();
    g.setLineDash(NO_DASH); g.globalAlpha = 1;
    // remplissage : jauge verticale à droite du bocal (du fond à l'horizon : 100 % = le tas touche la ligne)
    let target = BE.Jar.fill(run);
    const S = st.play;
    if (st.scene === "VIDANGE" && S && S.vid && S.vid.fill0 !== undefined) {
      const k = U.easeInCubic(U.clamp(st.sceneT / D.FX.vidange, 0, 1));
      target = S.vid.fill0 + (S.vid.fill1 - S.vid.fill0) * k;
      gaugeShown = target;
    }
    if (gaugeShown < 0 || gaugeRun !== run) { gaugeShown = target; gaugeRun = run; }
    gaugeShown = U.approach(gaugeShown, target, 4, st.frameDt || 0.016);
    const f = gaugeShown;
    const gx = G.jarR + 16, gw = 7, gb = G.floor - 6, gt = h + 2, gh = gb - gt;
    const tier = danger || f >= 0.85 ? 1 : near || f >= 0.6 ? 2 : 0;
    const col = tier === 1 ? P.danger : tier === 2 ? P.or : P.glass;
    g.fillStyle = "rgba(159,179,217,0.12)"; BE.FX.roundRect(g, gx, gt, gw, gh, 3.5); g.fill();
    const fh = Math.max(0, Math.min(1, f)) * gh;
    if (fh > 1) {
      g.globalAlpha = danger ? 0.7 + 0.3 * pulse : 0.9;
      g.fillStyle = col; BE.FX.roundRect(g, gx, gb - fh, gw, fh, 3.5); g.fill();
      g.globalAlpha = 1;
    }
    g.strokeStyle = U.rgba(P.glass, 0.35); g.lineWidth = 1; BE.FX.roundRect(g, gx, gt, gw, gh, 3.5); g.stroke();
    lbl.fill.set(Math.round(f * 100), tier, fmtPct, col === P.glass ? P.dim : col).draw(gx + gw / 2, gt - 8, 0.5);
  }
  const fmtPct = (n) => n + " %";

  // ================================================================ visée
  function dotSprite(red) {
    const key = red ? "dotR" : "dot";
    if (misc[key]) return misc[key];
    const [c, x] = off(12, 12);
    const col = red ? "255,77,109" : "230,236,255";
    const gr = x.createRadialGradient(6, 6, 0, 6, 6, 6);
    gr.addColorStop(0, "rgba(" + col + ",1)"); gr.addColorStop(0.38, "rgba(" + col + ",0.95)"); gr.addColorStop(0.5, "rgba(" + col + ",0.25)"); gr.addColorStop(1, "rgba(" + col + ",0)");
    x.fillStyle = gr; x.fillRect(0, 0, 12, 12);
    return (misc[key] = c);
  }
  R.drawAim = function (S, run) {
    const pv = S.aim.prev;
    if (!pv || !pv.pts.length) return;
    const pts = pv.pts;
    const t = BE.state.time;
    const n = pts.length / 2;
    const cancel = S.aim.cancel;
    const dot = dotSprite(cancel);
    let acc = 3 - ((t * 30) % 9);
    for (let i = 1; i < n; i++) {
      const x0 = pts[(i - 1) * 2], y0 = pts[(i - 1) * 2 + 1], x1 = pts[i * 2], y1 = pts[i * 2 + 1];
      const seg = Math.sqrt((x1 - x0) * (x1 - x0) + (y1 - y0) * (y1 - y0));
      const tail = pv.tailFrom >= 0 && i > pv.tailFrom;
      while (acc <= seg) {
        const k = seg ? acc / seg : 0;
        const x = x0 + (x1 - x0) * k, y = y0 + (y1 - y0) * k;
        const fade = tail ? 0.4 * (1 - (i - pv.tailFrom) / 18) : 0.95;
        if (fade > 0) {
          g.globalAlpha = fade * (cancel ? 0.35 : 1);
          const s = tail ? 3.6 : 5.4;
          g.drawImage(dot, x - s, y - s, s * 2, s * 2);
        }
        acc += 8;
      }
      acc -= seg;
    }
    g.globalAlpha = 1;
    // fantôme de taille à la première touche
    const cur = BE.Run.current(run);
    if (cur && pv.contacts.length && !cancel) {
      const c = pv.contacts[0], col = famColor(cur.color), rr = D.SIZES[cur.size].rf;
      g.globalCompositeOperation = "lighter"; g.globalAlpha = 0.25 + 0.1 * Math.sin(t * 6);
      g.drawImage(BE.FX.glow(col), c.x - rr * 1.4, c.y - rr * 1.4, rr * 2.8, rr * 2.8);
      g.globalCompositeOperation = "source-over"; g.globalAlpha = 0.85;
      g.strokeStyle = col; g.lineWidth = 1.5; g.setLineDash(DASH_S); g.lineDashOffset = t * 10;
      g.beginPath(); g.arc(c.x, c.y, rr, 0, TAU); g.stroke(); g.setLineDash(NO_DASH);
      for (let i = 1; i < pv.contacts.length; i++) {
        const cc = pv.contacts[i];
        g.globalAlpha = 0.5; g.strokeStyle = "#eef2ff"; g.lineWidth = 1; g.beginPath(); g.arc(cc.x, cc.y, 4, 0, TAU); g.stroke();
      }
      g.globalAlpha = 1;
    }
  };

  // ================================================================ icônes de reliques (vectorielles, mises en cache)
  const ICONS = {
    loupe(c, s) { c.lineWidth = s * 0.12; c.beginPath(); c.arc(-s * 0.12, -s * 0.12, s * 0.3, 0, TAU); c.stroke(); c.beginPath(); c.moveTo(s * 0.1, s * 0.1); c.lineTo(s * 0.38, s * 0.38); c.stroke(); },
    comete(c, s) { c.beginPath(); c.arc(s * 0.2, -s * 0.2, s * 0.17, 0, TAU); c.fill(); c.lineWidth = s * 0.08; for (let i = -1; i <= 1; i++) { const o = i * 0.12; c.beginPath(); c.moveTo(s * (0.08 + o), -s * (0.08 - o)); c.lineTo(-s * (0.38 - o), s * (0.38 + o)); c.stroke(); } },
    diapason(c, s) { c.lineWidth = s * 0.1; c.beginPath(); c.moveTo(-s * 0.18, -s * 0.38); c.lineTo(-s * 0.18, 0); c.quadraticCurveTo(0, s * 0.22, s * 0.18, 0); c.lineTo(s * 0.18, -s * 0.38); c.moveTo(0, s * 0.12); c.lineTo(0, s * 0.4); c.stroke(); },
    chandelle(c, s) { c.fillRect(-s * 0.13, -s * 0.05, s * 0.26, s * 0.42); c.beginPath(); c.moveTo(0, -s * 0.42); c.quadraticCurveTo(s * 0.15, -s * 0.2, 0, -s * 0.1); c.quadraticCurveTo(-s * 0.15, -s * 0.2, 0, -s * 0.42); c.fill(); },
    chasseur(c, s) { c.lineWidth = s * 0.09; c.beginPath(); c.arc(0, 0, s * 0.3, 0, TAU); c.stroke(); c.beginPath(); c.moveTo(0, -s * 0.42); c.lineTo(0, s * 0.42); c.moveTo(-s * 0.42, 0); c.lineTo(s * 0.42, 0); c.stroke(); },
    cascade(c, s) { for (let i = 0; i < 3; i++) { c.beginPath(); c.arc(-s * 0.22 + i * s * 0.22, -s * 0.2 + i * s * 0.2, s * (0.1 + i * 0.04), 0, TAU); c.fill(); } },
    tirelire(c, s) { c.beginPath(); c.ellipse(0, s * 0.05, s * 0.36, s * 0.26, 0, 0, TAU); c.fill(); c.fillRect(-s * 0.26, s * 0.22, s * 0.1, s * 0.14); c.fillRect(s * 0.16, s * 0.22, s * 0.1, s * 0.14); c.fillStyle = P.panel; c.fillRect(-s * 0.1, -s * 0.16, s * 0.2, s * 0.05); },
    corbeau(c, s) { c.beginPath(); c.moveTo(-s * 0.4, 0); c.quadraticCurveTo(-s * 0.1, -s * 0.35, s * 0.2, -s * 0.12); c.lineTo(s * 0.42, -s * 0.08); c.lineTo(s * 0.2, 0); c.quadraticCurveTo(0, s * 0.35, -s * 0.4, 0); c.fill(); },
    boussole(c, s) { c.lineWidth = s * 0.07; c.beginPath(); c.arc(0, 0, s * 0.38, 0, TAU); c.stroke(); c.beginPath(); c.moveTo(0, -s * 0.3); c.lineTo(s * 0.1, 0); c.lineTo(0, s * 0.3); c.lineTo(-s * 0.1, 0); c.closePath(); c.fill(); },
    geante(c, s) { c.beginPath(); c.arc(0, 0, s * 0.34, 0, TAU); c.fill(); c.fillStyle = P.panel; c.beginPath(); c.arc(-s * 0.1, -s * 0.05, s * 0.05, 0, TAU); c.arc(s * 0.1, -s * 0.05, s * 0.05, 0, TAU); c.fill(); },
    horloge(c, s) { c.lineWidth = s * 0.08; c.beginPath(); c.arc(0, 0, s * 0.36, 0, TAU); c.stroke(); c.beginPath(); c.moveTo(0, 0); c.lineTo(0, -s * 0.24); c.moveTo(0, 0); c.lineTo(s * 0.16, s * 0.08); c.stroke(); },
    plume(c, s) { c.beginPath(); c.moveTo(-s * 0.35, s * 0.38); c.quadraticCurveTo(-s * 0.3, -s * 0.2, s * 0.35, -s * 0.38); c.quadraticCurveTo(s * 0.2, s * 0.2, -s * 0.35, s * 0.38); c.fill(); },
    telescope(c, s) { c.save(); c.rotate(-0.5); c.fillRect(-s * 0.36, -s * 0.1, s * 0.62, s * 0.2); c.fillRect(s * 0.22, -s * 0.14, s * 0.12, s * 0.28); c.restore(); c.lineWidth = s * 0.07; c.beginPath(); c.moveTo(0, s * 0.05); c.lineTo(-s * 0.2, s * 0.4); c.moveTo(0, s * 0.05); c.lineTo(s * 0.2, s * 0.4); c.stroke(); },
    balance(c, s) { c.lineWidth = s * 0.07; c.beginPath(); c.moveTo(0, -s * 0.36); c.lineTo(0, s * 0.36); c.moveTo(-s * 0.36, -s * 0.2); c.lineTo(s * 0.36, -s * 0.2); c.moveTo(-s * 0.2, s * 0.36); c.lineTo(s * 0.2, s * 0.36); c.stroke(); c.beginPath(); c.arc(-s * 0.3, 0, s * 0.12, 0, Math.PI); c.arc(s * 0.3, 0, s * 0.12, 0, Math.PI); c.fill(); },
    alchimiste(c, s) { c.beginPath(); c.arc(0, s * 0.12, s * 0.26, 0, TAU); c.fill(); c.fillRect(-s * 0.08, -s * 0.34, s * 0.16, s * 0.3); c.fillRect(-s * 0.14, -s * 0.4, s * 0.28, s * 0.07); c.fillStyle = P.panel; c.beginPath(); c.arc(-s * 0.08, s * 0.14, s * 0.05, 0, TAU); c.arc(s * 0.09, s * 0.04, s * 0.035, 0, TAU); c.fill(); },
    vitrail(c, s) {
      const cols = ["#ff6b3d", "#5ee7ff", "#6ee07a", "#ffe14d"];
      for (let i = 0; i < 4; i++) { c.fillStyle = cols[i]; c.fillRect(-s * 0.26 + (i % 2) * s * 0.26, -s * 0.12 + (i >> 1) * s * 0.26, s * 0.26, s * 0.26); }
      c.fillStyle = cols[3]; c.beginPath(); c.arc(0, -s * 0.12, s * 0.26, Math.PI, 0); c.fill();
      c.strokeStyle = P.panel; c.lineWidth = s * 0.06; c.beginPath(); c.moveTo(0, -s * 0.38); c.lineTo(0, s * 0.4); c.moveTo(-s * 0.26, s * 0.14); c.lineTo(s * 0.26, s * 0.14); c.stroke();
    },
    paratonnerre(c, s) { c.lineWidth = s * 0.08; c.beginPath(); c.moveTo(-s * 0.18, -s * 0.4); c.lineTo(-s * 0.18, s * 0.4); c.moveTo(-s * 0.32, s * 0.4); c.lineTo(-s * 0.04, s * 0.4); c.stroke(); c.beginPath(); c.moveTo(s * 0.2, -s * 0.4); c.lineTo(s * 0.02, -s * 0.02); c.lineTo(s * 0.16, -s * 0.02); c.lineTo(s * 0.02, s * 0.36); c.lineTo(s * 0.34, -s * 0.1); c.lineTo(s * 0.2, -s * 0.1); c.lineTo(s * 0.34, -s * 0.4); c.closePath(); c.fill(); },
    carriere(c, s) { c.lineWidth = s * 0.09; c.lineCap = "round"; c.beginPath(); c.moveTo(-s * 0.3, s * 0.36); c.lineTo(s * 0.14, -s * 0.12); c.stroke(); c.lineWidth = s * 0.12; c.beginPath(); c.moveTo(-s * 0.22, -s * 0.3); c.quadraticCurveTo(s * 0.18, -s * 0.36, s * 0.38, -s * 0.02); c.stroke(); },
    metronome(c, s) { c.lineWidth = s * 0.08; c.beginPath(); c.moveTo(-s * 0.3, s * 0.38); c.lineTo(-s * 0.12, -s * 0.36); c.lineTo(s * 0.12, -s * 0.36); c.lineTo(s * 0.3, s * 0.38); c.closePath(); c.stroke(); c.beginPath(); c.moveTo(0, s * 0.26); c.lineTo(s * 0.2, -s * 0.24); c.stroke(); c.beginPath(); c.arc(s * 0.1, 0, s * 0.07, 0, TAU); c.fill(); },
    comptable(c, s) { c.lineWidth = s * 0.07; c.strokeRect(-s * 0.36, -s * 0.32, s * 0.72, s * 0.64); for (let i = 0; i < 3; i++) { const y = -s * 0.16 + i * s * 0.16; c.beginPath(); c.moveTo(-s * 0.36, y); c.lineTo(s * 0.36, y); c.stroke(); for (let j = 0; j < 2; j++) { c.beginPath(); c.arc(-s * 0.18 + j * s * 0.12 + i * s * 0.08, y, s * 0.06, 0, TAU); c.fill(); } } },
    sablier(c, s) { c.lineWidth = s * 0.07; c.beginPath(); c.moveTo(-s * 0.26, -s * 0.38); c.lineTo(s * 0.26, -s * 0.38); c.lineTo(-s * 0.26, s * 0.38); c.lineTo(s * 0.26, s * 0.38); c.closePath(); c.stroke(); c.beginPath(); c.moveTo(-s * 0.14, s * 0.3); c.lineTo(s * 0.14, s * 0.3); c.lineTo(0, s * 0.1); c.closePath(); c.fill(); c.beginPath(); c.moveTo(-s * 0.16, -s * 0.28); c.lineTo(s * 0.16, -s * 0.28); c.lineTo(0, -s * 0.1); c.closePath(); c.fill(); },
    glaneur(c, s) { c.lineWidth = s * 0.09; c.lineCap = "round"; c.beginPath(); c.arc(s * 0.02, -s * 0.04, s * 0.28, Math.PI * 0.95, Math.PI * 2.05); c.stroke(); c.beginPath(); c.moveTo(s * 0.26, s * 0.02); c.lineTo(s * 0.12, s * 0.4); c.stroke(); for (let i = 0; i < 3; i++) { c.beginPath(); c.ellipse(-s * 0.2 + i * s * 0.08, s * 0.24 - i * s * 0.02, s * 0.04, s * 0.09, 0.3, 0, TAU); c.fill(); } },
    echangeur(c, s) { c.lineWidth = s * 0.08; c.beginPath(); c.arc(0, 0, s * 0.28, Math.PI * 1.1, Math.PI * 1.85); c.stroke(); c.beginPath(); c.arc(0, 0, s * 0.28, Math.PI * 0.1, Math.PI * 0.85); c.stroke(); c.beginPath(); c.moveTo(s * 0.26, -s * 0.28); c.lineTo(s * 0.3, -s * 0.06); c.lineTo(s * 0.08, -s * 0.12); c.closePath(); c.fill(); c.beginPath(); c.moveTo(-s * 0.26, s * 0.28); c.lineTo(-s * 0.3, s * 0.06); c.lineTo(-s * 0.08, s * 0.12); c.closePath(); c.fill(); },
    pression(c, s) { c.lineWidth = s * 0.08; c.beginPath(); c.arc(0, s * 0.1, s * 0.34, Math.PI, 0); c.stroke(); c.beginPath(); c.moveTo(-s * 0.34, s * 0.1); c.lineTo(s * 0.34, s * 0.1); c.stroke(); c.beginPath(); c.moveTo(0, s * 0.1); c.lineTo(s * 0.2, -s * 0.14); c.stroke(); c.beginPath(); c.arc(0, s * 0.1, s * 0.06, 0, TAU); c.fill(); },
    catalyseur(c, s) { c.lineWidth = s * 0.08; c.beginPath(); c.arc(-s * 0.13, 0, s * 0.2, 0, TAU); c.stroke(); c.beginPath(); c.arc(s * 0.13, 0, s * 0.2, 0, TAU); c.stroke(); c.beginPath(); c.moveTo(0, -s * 0.16); c.quadraticCurveTo(0, 0, s * 0.1, 0); c.quadraticCurveTo(0, 0, 0, s * 0.16); c.quadraticCurveTo(0, 0, -s * 0.1, 0); c.quadraticCurveTo(0, 0, 0, -s * 0.16); c.fill(); },
    souffle(c, s) { c.lineWidth = s * 0.08; c.lineCap = "round"; for (let i = 0; i < 3; i++) { const y = -s * 0.2 + i * s * 0.2, l = s * (0.3 - (i === 1 ? 0 : 0.1)); c.beginPath(); c.moveTo(-s * 0.36, y); c.lineTo(l - s * 0.06, y); c.arc(l - s * 0.06, y - s * 0.08, s * 0.08, Math.PI / 2, -Math.PI * 0.9, true); c.stroke(); } },
    verre(c, s) { c.lineWidth = s * 0.08; c.beginPath(); c.moveTo(-s * 0.3, -s * 0.36); c.lineTo(-s * 0.26, s * 0.26); c.quadraticCurveTo(-s * 0.26, s * 0.38, -s * 0.12, s * 0.38); c.lineTo(s * 0.12, s * 0.38); c.quadraticCurveTo(s * 0.26, s * 0.38, s * 0.26, s * 0.26); c.lineTo(s * 0.3, -s * 0.36); c.stroke(); c.beginPath(); c.arc(-s * 0.08, s * 0.22, s * 0.09, 0, TAU); c.arc(s * 0.1, s * 0.2, s * 0.07, 0, TAU); c.fill(); },
    couronne(c, s) { c.beginPath(); c.moveTo(-s * 0.36, s * 0.26); c.lineTo(-s * 0.38, -s * 0.18); c.lineTo(-s * 0.18, s * 0.02); c.lineTo(0, -s * 0.32); c.lineTo(s * 0.18, s * 0.02); c.lineTo(s * 0.38, -s * 0.18); c.lineTo(s * 0.36, s * 0.26); c.closePath(); c.fill(); c.fillStyle = P.panel; c.beginPath(); c.arc(0, s * 0.12, s * 0.05, 0, TAU); c.fill(); },
    prisme(c, s) { c.lineWidth = s * 0.08; c.beginPath(); c.moveTo(-s * 0.08, -s * 0.34); c.lineTo(s * 0.24, s * 0.26); c.lineTo(-s * 0.38, s * 0.26); c.closePath(); c.stroke(); const cols = ["#ff6b3d", "#ffe14d", "#6ee07a", "#5ee7ff"]; for (let i = 0; i < 4; i++) { c.strokeStyle = cols[i]; c.lineWidth = s * 0.05; c.beginPath(); c.moveTo(s * 0.08, -s * 0.02 + i * s * 0.04); c.lineTo(s * 0.42, -s * 0.12 + i * s * 0.1); c.stroke(); } },
    singularite(c, s) { c.lineWidth = s * 0.07; c.beginPath(); for (let i = 0; i <= 40; i++) { const a = i / 40 * TAU * 1.6, d = s * 0.04 + i / 40 * s * 0.34; const px = Math.cos(a) * d, py = Math.sin(a) * d; if (i) c.lineTo(px, py); else c.moveTo(px, py); } c.stroke(); c.fillStyle = "#05060c"; c.beginPath(); c.arc(0, 0, s * 0.09, 0, TAU); c.fill(); },
  };
  function genericIcon(c, s, d) { c.font = "900 " + (s * 0.5).toFixed(1) + "px " + D.FONT; c.textAlign = "center"; c.textBaseline = "middle"; c.fillText(d.nom.replace(/^(Le |La |L')/, "")[0], 0, s * 0.03); }
  function paintRelic(c, d, s) {
    const rar = (D.RARITY[d.rar] || D.RARITY.C).color;
    const pg = c.createRadialGradient(-s * 0.2, -s * 0.25, s * 0.05, 0, 0, s * 0.56);
    pg.addColorStop(0, "#1f2856"); pg.addColorStop(1, P.panel);
    c.fillStyle = pg; c.strokeStyle = rar; c.lineWidth = 1.6;
    c.beginPath(); c.arc(0, 0, s * 0.56, 0, TAU); c.fill(); c.stroke();
    if (d.evo || d.rar === "L") {
      c.strokeStyle = U.rgba(P.or, 0.5); c.lineWidth = 1; c.beginPath(); c.arc(0, 0, s * 0.56 + 2.5, 0, TAU); c.stroke();
    }
    c.fillStyle = d.color || P.text; c.strokeStyle = d.color || P.text; c.lineCap = "round"; c.lineJoin = "round";
    const f = ICONS[d.icon];
    if (f) f(c, s * 0.9); else genericIcon(c, s * 0.9, d);
    c.fillStyle = "rgba(255,255,255,0.1)"; c.beginPath(); c.ellipse(-s * 0.14, -s * 0.3, s * 0.3, s * 0.12, -0.3, 0, TAU); c.fill();
    c.lineCap = "butt"; c.lineJoin = "miter";
  }
  /** Icône de relique : pastille à liseré de rareté + glyphe vectoriel (sprite en cache jusqu'à 44 px). */
  R.drawRelicIcon = function (id, x, y, size, o) {
    const d = D.RELIC_BY_ID[id];
    if (!d) return;
    const sc = (o && o.scale) || 1;
    if (size > 44) { g.save(); g.translate(x, y); if (sc !== 1) g.scale(sc, sc); paintRelic(g, d, size); g.restore(); return; }
    const s = Math.round(size);
    const row = iconCache[id] || (iconCache[id] = []);
    let c = row[s];
    if (!c) {
      const H = s * 0.56 + 4;
      const res = off(H * 2, H * 2);
      c = res[0]; res[1].translate(H, H); paintRelic(res[1], d, s); c.H = H;
      row[s] = c;
    }
    const H = c.H * sc;
    g.drawImage(c, x - H, y - H, H * 2, H * 2);
  };
  /** Icône de réaction : pastille bicolore + glyphe (bannières, Grimoire). */
  R.drawReactionIcon = function (id, x, y, s) {
    const Rr = D.REACTIONS[id];
    const cA = Rr ? famColor(Rr.pair[0]) : P.frag, cB = Rr ? famColor(Rr.pair[1]) : P.or;
    const r = s * 0.5;
    g.save(); g.translate(x, y);
    g.fillStyle = cA; g.beginPath(); g.arc(0, 0, r, Math.PI / 2, Math.PI * 1.5); g.fill();
    g.fillStyle = cB; g.beginPath(); g.arc(0, 0, r, -Math.PI / 2, Math.PI / 2); g.fill();
    g.strokeStyle = "rgba(5,6,12,0.9)"; g.lineWidth = 2; g.beginPath(); g.arc(0, 0, r, 0, TAU); g.stroke();
    const cbm = !!(BE.settings && BE.settings.colorblind) && Rr;
    g.fillStyle = "rgba(5,6,12,0.55)"; g.beginPath(); g.arc(0, 0, r * (cbm ? 0.6 : 0.72), 0, TAU); g.fill();
    if (cbm) { // mode daltonien : le motif de chaque famille, en creux sur sa moitié (§11.1)
      for (let k = 0; k < 2; k++) {
        const ci = FAM_IDX[Rr.pair[k]], side = k ? 1 : -1;
        for (let j = -1; j <= 1; j++) {
          const a = (k ? 0 : Math.PI) + j * 0.62;
          stamp(g, ci, Math.cos(a) * r * 0.8, Math.sin(a) * r * 0.8 * side * (k ? 1 : -1), r * 0.15);
        }
      }
    }
    g.strokeStyle = "#ffffff"; g.fillStyle = "#ffffff"; g.lineWidth = Math.max(1.2, s * 0.08); g.lineCap = "round"; g.lineJoin = "round";
    const q = r * 0.5;
    g.beginPath();
    switch (id) {
      case "vapeur": for (let i = -1; i <= 1; i++) { g.moveTo(i * q * 0.8, q); g.bezierCurveTo(i * q * 0.8 - q * 0.4, q * 0.3, i * q * 0.8 + q * 0.4, -q * 0.3, i * q * 0.8, -q); } g.stroke(); break;
      case "plasma": g.moveTo(q * 0.3, -q * 1.1); g.lineTo(-q * 0.4, q * 0.1); g.lineTo(q * 0.2, q * 0.1); g.lineTo(-q * 0.3, q * 1.1); g.stroke(); break;
      case "cendre": g.moveTo(0, -q); g.quadraticCurveTo(q, 0, 0, q); g.quadraticCurveTo(-q, 0, 0, -q); g.fill(); break;
      case "ronce": g.moveTo(-q, q); g.lineTo(q, -q); g.moveTo(-q * 0.3, q * 0.3); g.lineTo(-q * 0.7, -q * 0.1); g.moveTo(q * 0.3, -q * 0.3); g.lineTo(q * 0.7, q * 0.1); g.stroke(); break;
      case "tempete": for (let i = 0; i < 3; i++) { const a = i * Math.PI / 3; g.moveTo(-Math.cos(a) * q, -Math.sin(a) * q); g.lineTo(Math.cos(a) * q, Math.sin(a) * q); } g.stroke(); break;
      case "photosynthese": g.arc(0, 0, q * 0.45, 0, TAU); g.fill(); g.beginPath(); for (let i = 0; i < 8; i++) { const a = i * TAU / 8; g.moveTo(Math.cos(a) * q * 0.7, Math.sin(a) * q * 0.7); g.lineTo(Math.cos(a) * q, Math.sin(a) * q); } g.stroke(); break;
      default: g.arc(0, q * 0.4, q, Math.PI, 0); g.stroke();
    }
    g.restore();
    g.lineCap = "butt"; g.lineJoin = "miter";
  };

  // ================================================================ libellés mis en cache (§12.7)
  /** Libellé pré-rendu : régénéré seulement quand ses clés (nombres) changent. */
  function Label(px, weight, color, stroke) {
    this.px = px; this.weight = weight; this.color = color; this.stroke = stroke || 0;
    this.k1 = NaN; this.k2 = NaN; this.c = null; this.w = 0; this.h = 0; this.gen = -1; this.text = "";
  }
  Label.prototype.set = function (k1, k2, build, color) {
    // réglage « Taille du texte ×1,25 » (§10.10) : les petits libellés du HUD grossissent de 15 % (place comptée)
    const tk = BE.settings && BE.settings.textScale > 1 && this.px <= 13 ? 1.15 : 1;
    if (this.c && k1 === this.k1 && k2 === this.k2 && this.gen === gen && this.tk === tk && (color === undefined || color === this.color)) return this;
    this.k1 = k1; this.k2 = k2; this.gen = gen; this.tk = tk;
    if (color !== undefined) this.color = color;
    const str = build(k1, k2);
    this.text = str;
    const px = this.px * tk;
    const f = font(this.weight, px);
    g.font = f;
    const pad = 2 + this.stroke;
    const w = Math.ceil(g.measureText(str).width) + pad * 2, h = Math.ceil(px * 1.45) + pad * 2;
    if (!this.c) this.c = document.createElement("canvas");
    const c = this.c;
    c.width = Math.max(1, Math.ceil(w * K)); c.height = Math.max(1, Math.ceil(h * K));
    const x = c.getContext("2d");
    x.setTransform(K, 0, 0, K, 0, 0);
    x.font = f; x.textAlign = "left"; x.textBaseline = "middle";
    if (this.stroke) { x.lineJoin = "round"; x.lineWidth = this.stroke * 2; x.strokeStyle = "rgba(5,6,12,0.9)"; x.strokeText(str, pad, h / 2); }
    x.fillStyle = this.color; x.fillText(str, pad, h / 2);
    this.w = w; this.h = h; this.pad = pad;
    return this;
  };
  /** align : 0 gauche, 0,5 centre, 1 droite (x = bord du texte). */
  Label.prototype.draw = function (x, y, align, scale) {
    const s = scale || 1, w = this.w * s, h = this.h * s;
    g.drawImage(this.c, x - (this.w - this.pad * 2) * s * (align || 0) - this.pad * s, y - h / 2, w, h);
    return this;
  };
  Label.prototype.width = function () { return this.w - this.pad * 2; };
  R.Label = Label;
  const lbl = {
    lune: new Label(11, 800, P.text), night: new Label(10, 700, P.dim), quota: new Label(11, 800, P.text), gold: new Label(13, 800, P.or),
    bag: new Label(11, 800, P.text), swaps: new Label(8, 900, P.eclat), reserve: new Label(9, 800, P.mult, 1.5), fill: new Label(9, 700, P.dim),
    liveE: new Label(13, 900, "#ffffff"), liveM: new Label(13, 900, "#ffffff"), total: new Label(32, 900, "#ffffff", 2.5),
    suiv: new Label(8, 700, P.dim), grav: new Label(7, 700, P.dim), cancel: new Label(16, 900, P.danger), plus1: new Label(10, 900, P.seve, 1),
  };
  const fmtLune = (n) => "LUNE " + n;
  let BOSS_IDX = null;
  function bossIndex(id) {
    if (!BOSS_IDX) { BOSS_IDX = {}; let i = 0; for (const k in D.BOSSES) BOSS_IDX[k] = i++; }
    const v = BOSS_IDX[id]; return v === undefined ? 99 : v;
  }
  const fmtNight = (k) => { const run = BE.state.run; const b = run && run.firm.boss; return k >= 10 && b ? D.BOSSES[b.bossId].nom.toUpperCase() : D.NIGHT_SHORT[k % 10]; };
  const fmtQuota = (a, b) => U.fmt(a) + " / " + U.fmt(b);
  const fmtGold = (a) => (a >= 10000 ? U.fmt(a) : String(a));
  const fmtInt = (n) => String(n);
  const fmtFmt = (n) => U.fmt(n);
  const fmtLiveE = (n, c) => (c ? "" : "✦ ") + U.fmt(n);
  const fmtMultK = (n) => U.fmtMult(n);
  const fmtReserve = (n) => "+" + U.fmtDec(n) + " en réserve";
  const fmtConst = (k) => CONSTS[k];
  const CONSTS = ["SUIV.", "✕ ANNULÉ", "+1"];

  // ================================================================ HUD
  function text(t, x, y, f, color, align, base) {
    g.font = f; g.fillStyle = color; g.textAlign = align || "left"; g.textBaseline = base || "middle"; g.fillText(t, x, y);
  }
  R.text = text;

  function coinSprite() {
    if (misc.coin) return misc.coin;
    const [c, x] = off(20, 20);
    const gr = x.createRadialGradient(8, 7, 1, 10, 10, 9);
    gr.addColorStop(0, "#fff3c4"); gr.addColorStop(0.45, P.or); gr.addColorStop(1, "#c98f1e");
    x.fillStyle = gr; x.beginPath(); x.arc(10, 10, 9, 0, TAU); x.fill();
    x.strokeStyle = "rgba(120,80,10,0.6)"; x.lineWidth = 1; x.beginPath(); x.arc(10, 10, 6.5, 0, TAU); x.stroke();
    x.fillStyle = "rgba(255,255,255,0.8)"; x.beginPath(); x.arc(7, 6.5, 2, 0, TAU); x.fill();
    return (misc.coin = c);
  }
  function coinIcon(x, y, r) { g.drawImage(coinSprite(), x - r * 1.11, y - r * 1.11, r * 2.22, r * 2.22); }
  R.coinIcon = coinIcon;

  function ensureGrads() {
    if (grads) return grads;
    grads = {};
    let gr = g.createLinearGradient(0, 0, 0, G.hudH);
    gr.addColorStop(0, "rgba(18,24,50,0.97)"); gr.addColorStop(1, "rgba(14,19,40,0.82)");
    grads.hud = gr;
    gr = g.createLinearGradient(0, 26, 0, 36);
    gr.addColorStop(0, "#fff0b8"); gr.addColorStop(0.45, "#ffd166"); gr.addColorStop(1, "#e89a2a");
    grads.gauge = gr;
    const [tc, tx] = off(8, 8, 2);
    tx.fillStyle = "rgba(79,179,255,0.3)"; tx.fillRect(0, 0, 8, 8);
    tx.strokeStyle = "rgba(79,179,255,0.9)"; tx.lineWidth = 2;
    tx.beginPath(); tx.moveTo(-2, 10); tx.lineTo(10, -2); tx.moveTo(-2, 2); tx.lineTo(2, -2); tx.moveTo(6, 10); tx.lineTo(10, 6); tx.stroke();
    grads.hatch = g.createPattern(tc, "repeat");
    if (grads.hatch && grads.hatch.setTransform && typeof DOMMatrix !== "undefined") grads.hatch.setTransform(new DOMMatrix([0.5, 0, 0, 0.5, 0, 0]));
    gr = g.createLinearGradient(0, G.relicBandY, 0, D.H);
    gr.addColorStop(0, "rgba(16,21,44,0.96)"); gr.addColorStop(1, "rgba(8,10,22,0.98)");
    grads.band = gr;
    return grads;
  }

  // or affiché : monte d'une unité à chaque pièce arrivée (rattrapage après 1,2 s)
  let goldShown = -1, goldRiseT = 0, goldRun = null, goldDrawT = -9;
  BE.on("coinArrive", () => { const run = BE.state.run; if (run && goldShown >= 0 && goldShown < run.gold) { goldShown++; goldRiseT = BE.state.time; } });
  function shownGold(run, t) {
    const stale = t - goldDrawT > 0.25;
    goldDrawT = t;
    if (goldRun !== run || goldShown < 0 || run.gold < goldShown || stale) { goldRun = run; goldShown = run.gold; goldRiseT = t; }
    if (run.gold > goldShown) { if (goldRiseT === 0) goldRiseT = t; if (t - goldRiseT > 1.3) goldShown = run.gold; }
    else goldRiseT = 0;
    return goldShown;
  }

  /** Le Phare (§4) : anneau, faisceau de visée, étoile courante. */
  function phareSprite() {
    if (misc.phare) return misc.phare;
    const H = 34;
    const [c, x] = off(H * 2, H * 2);
    const r = G.phare.r;
    const ig = x.createRadialGradient(H, H, 0, H, H, r);
    ig.addColorStop(0, "rgba(30,38,80,0.2)"); ig.addColorStop(1, "rgba(5,6,12,0.55)");
    x.fillStyle = ig; x.beginPath(); x.arc(H, H, r, 0, TAU); x.fill();
    x.strokeStyle = "rgba(159,179,217,0.35)"; x.lineWidth = 5; x.beginPath(); x.arc(H, H, r + 1, 0, TAU); x.stroke();
    x.strokeStyle = "#eef2ff"; x.lineWidth = 2; x.beginPath(); x.arc(H, H, r, 0, TAU); x.stroke();
    for (let i = 0; i < 12; i++) {
      const a = i / 12 * TAU;
      x.strokeStyle = i % 3 ? "rgba(238,242,255,0.35)" : "rgba(238,242,255,0.8)"; x.lineWidth = i % 3 ? 1 : 1.6;
      x.beginPath(); x.moveTo(H + Math.cos(a) * (r + 3), H + Math.sin(a) * (r + 3)); x.lineTo(H + Math.cos(a) * (r + (i % 3 ? 5.5 : 7.5)), H + Math.sin(a) * (r + (i % 3 ? 5.5 : 7.5))); x.stroke();
    }
    x.strokeStyle = "rgba(255,255,255,0.5)"; x.lineWidth = 1.2; x.beginPath(); x.arc(H, H, r - 2.5, Math.PI * 1.1, Math.PI * 1.45); x.stroke();
    c.H = H;
    return (misc.phare = c);
  }
  function beamSprite() {
    if (misc.beam) return misc.beam;
    const L = 150, W = 40;
    const [c, x] = off(L, W);
    const gr = x.createLinearGradient(0, 0, L, 0);
    gr.addColorStop(0, "rgba(255,255,255,0.5)"); gr.addColorStop(0.35, "rgba(220,230,255,0.16)"); gr.addColorStop(1, "rgba(220,230,255,0)");
    x.fillStyle = gr;
    x.beginPath(); x.moveTo(0, W / 2 - 3); x.lineTo(L, 0); x.lineTo(L, W); x.lineTo(0, W / 2 + 3); x.closePath(); x.fill();
    return (misc.beam = c);
  }
  function drawPhare(run, S, t, st) {
    const px = G.phare.x, py = G.phare.y;
    const cur = BE.Run.current(run);
    const col = cur ? famColor(cur.color) : "#eef2ff";
    const aiming = st.scene === "AIM" || st.scene === "NIGHT_INTRO";
    g.globalCompositeOperation = "lighter"; g.globalAlpha = 0.28 + 0.08 * Math.sin(t * 2);
    g.drawImage(BE.FX.glow(col), px - 42, py - 42, 84, 84);
    if (st.scene === "AIM" && !S.aim.cancel) {
      const bm = beamSprite();
      g.globalAlpha = S.aim.active ? 0.5 : 0.28;
      g.save(); g.translate(px, py); g.rotate(S.aim.angle * Math.PI / 180);
      g.drawImage(bm, 16, -bm.lh / 2, bm.lw, bm.lh);
      g.restore();
    }
    g.globalCompositeOperation = "source-over"; g.globalAlpha = 1;
    const lk = t - BE.FX.launchT;
    const recoil = lk >= 0 && lk < 0.3 ? 1 + 0.16 * Math.sin((lk / 0.3) * Math.PI) * (1 - lk / 0.3) : 1;
    // anneau tournant
    g.strokeStyle = "rgba(238,242,255,0.3)"; g.lineWidth = 1; g.setLineDash(DASH_R); g.lineDashOffset = -t * 5;
    g.beginPath(); g.arc(px, py, (G.phare.r + 8) * recoil, 0, TAU); g.stroke(); g.setLineDash(NO_DASH);
    const ph = phareSprite(), H = ph.H * recoil;
    g.drawImage(ph, px - H, py - H, H * 2, H * 2);
    if (cur) {
      const r = D.SIZES[cur.size].r;
      const sc = Math.min(1, 18 / r) * (aiming ? 1 : 0.8);
      const pulse = cur.bonus ? 1 + 0.06 * Math.sin(t * 8) : 1;
      let lx = px, ly = py + 50;
      if (S.aim.prev && S.aim.prev.pts.length > 8) { lx = S.aim.prev.pts[8]; ly = S.aim.prev.pts[9]; }
      const sw = t - BE.FX.swapT, swk = sw >= 0 && sw < 0.25 ? U.easeOutBack(sw / 0.25) : 1;
      const O = HUD_O; O.scale = sc * pulse * (0.4 + 0.6 * swk); O.lookX = lx; O.lookY = ly; O.seed = cur.id * 7; O.alpha = aiming ? 1 : 0.45; O.noFace = false;
      R.drawStar(px, py, cur.size, cur.color, O);
      if (cur.bonus) lbl.plus1.set(2, 0, fmtConst).draw(px + 18, py - 16, 0.5);
      if (cur.grav && D.GRAVURES[cur.grav]) { // gravure de l'étoile courante : à gauche du Phare (les pips de tirs occupent le dessous)
        text("GRAVURE", px - 38, py + 6, font(700, 6.5), P.dim, "right");
        text(D.GRAVURES[cur.grav].nom.toUpperCase(), px - 38, py + 15, font(900, 7.5), P.or, "right");
      }
    }
  }

  R.drawHUD = function (run, S) {
    const st = BE.state, t = st.time;
    const gr = ensureGrads();
    // la barre haute se prolonge jusqu'aux bords de l'écran (encoche, écrans larges)
    g.fillStyle = gr.hud; g.fillRect(EXT.x0, Math.min(0, EXT.y0), EXT.w, G.hudH - Math.min(0, EXT.y0));
    g.fillStyle = C_LINE80; g.fillRect(EXT.x0, G.hudH - 1, EXT.w, 1);
    if (S.aim.cancel && S.aim.active) {
      g.fillStyle = C_DANGER25; g.fillRect(EXT.x0, Math.min(0, EXT.y0), EXT.w, G.hudH - Math.min(0, EXT.y0));
      lbl.cancel.set(1, 0, fmtConst).draw(180, 22, 0.5);
    } else {
      lbl.lune.set(run.lune, 0, fmtLune).draw(10, 15, 0);
      const lw = lbl.lune.width();
      for (let n = 0; n < 3; n++) {
        const x = 18 + lw + n * 8, y = 14.5;
        g.beginPath(); g.arc(x, y, 2.6, 0, TAU);
        if (n < run.nuit) { g.fillStyle = P.or; g.fill(); }
        else if (n === run.nuit) { g.fillStyle = n === 2 ? "#ff9ab0" : "#eef2ff"; g.fill(); }
        else { g.strokeStyle = C_DIM70; g.lineWidth = 1; g.stroke(); }
      }
      const boss = run.firm.boss;
      const nk = run.nuit + (run.nuit === 2 && boss ? 10 : 0);
      const ncol = run.nuit === 2 ? (boss && !boss.alive ? P.dim : "#ff9ab0") : P.dim;
      lbl.night.set(nk, boss ? bossIndex(boss.bossId) : -1, fmtNight, ncol);
      lbl.night.draw(10, 29, 0, lbl.night.width() > 76 ? 76 / lbl.night.width() : 1);
      // jauge de quota (projection en direct hachurée)
      const gx = 95, gy = 22, gw = 170, gh = 10; // relevée de 4 px : l'anneau du Phare passe dessous
      const q = run.quota;
      const liveProj = (st.scene === "FLIGHT" || st.scene === "SETTLE" || st.scene === "TURRETS") ? Math.floor(S.live.eclat * S.live.mult) : 0;
      if (st.ui.shownTotal === undefined || run.total < st.ui.shownTotal) st.ui.shownTotal = run.total;
      else st.ui.shownTotal = U.approach(st.ui.shownTotal, run.total, 7, st.frameDt || 0.016);
      if (run.total - st.ui.shownTotal < 0.5) st.ui.shownTotal = run.total;
      const shown = Math.round(st.ui.shownTotal);
      const gk = t - BE.FX.gaugeT, gp = gk >= 0 && gk < 0.4 ? 1 - gk / 0.4 : 0;
      g.fillStyle = "rgba(5,6,12,0.75)"; BE.FX.roundRect(g, gx - 1, gy - 1, gw + 2, gh + 2, 6); g.fill();
      const fw = gw * U.clamp(shown / q, 0, 1);
      const pw = gw * U.clamp((shown + liveProj) / q, 0, 1);
      if (pw > fw + 0.5) {
        g.save(); BE.FX.roundRect(g, gx, gy, pw, gh, 5); g.clip();
        g.translate((t * 12) % 8, 0);
        g.fillStyle = gr.hatch || "rgba(79,179,255,0.4)"; g.fillRect(gx - 8, gy, pw + 8, gh);
        g.restore();
      }
      if (fw > 0) {
        g.fillStyle = gr.gauge; BE.FX.roundRect(g, gx, gy, Math.max(fw, 6), gh, 5); g.fill();
        g.fillStyle = "rgba(255,255,255,0.35)"; g.fillRect(gx + 3, gy + 1.5, Math.max(0, fw - 6), 1.5);
        // tête scintillante
        g.globalCompositeOperation = "lighter"; g.globalAlpha = 0.5 + 0.3 * Math.sin(t * 6) + gp * 0.5;
        g.drawImage(BE.FX.glow(P.or), gx + fw - 10, gy + gh / 2 - 10, 20, 20);
        g.globalCompositeOperation = "source-over"; g.globalAlpha = 1;
      }
      if (gp > 0) {
        g.globalCompositeOperation = "lighter"; g.globalAlpha = gp * 0.6;
        g.drawImage(BE.FX.glow(P.or), gx - 10, gy - 14, gw + 20, gh + 28);
        g.globalCompositeOperation = "source-over"; g.globalAlpha = 1;
      }
      g.strokeStyle = C_OR60; g.lineWidth = 1; BE.FX.roundRect(g, gx - 1, gy - 1, gw + 2, gh + 2, 6); g.stroke();
      lbl.quota.set(shown, q, fmtQuota, (shown + liveProj) >= q ? P.or : P.text).draw(180, 11, 0.5);
      // or : aligné à droite contre ⏸ (4 chiffres ne le touchent plus), pièce à gauche du nombre
      const gs = shownGold(run, t);
      const gb = t - BE.FX.goldT, bump = gb >= 0 && gb < 0.2 ? 1 + 0.3 * (1 - gb / 0.2) : 1;
      lbl.gold.set(gs, 0, fmtGold);
      const gw2 = Math.min(40, lbl.gold.width());
      const gsc = lbl.gold.width() > 40 ? 40 / lbl.gold.width() : 1;
      coinIcon(318 - gw2 * bump - 9, 22, 6.5 * bump);
      lbl.gold.draw(318, 22.5, 1, bump * gsc);
    }
    // pause
    g.fillStyle = C_TEXT85;
    BE.FX.roundRect(g, 329, 15, 4, 14, 1.5); g.fill(); BE.FX.roundRect(g, 337, 15, 4, 14, 1.5); g.fill();

    // ---- zone du Phare : Sac
    const bx = G.bagBtn.x, by = G.bagBtn.y;
    g.fillStyle = "#1a2146"; g.strokeStyle = C_LINE; g.lineWidth = 1.5;
    g.beginPath(); g.moveTo(bx - 13, by - 6); g.quadraticCurveTo(bx - 16, by + 14, bx, by + 14); g.quadraticCurveTo(bx + 16, by + 14, bx + 13, by - 6); g.closePath(); g.fill(); g.stroke();
    g.beginPath(); g.moveTo(bx - 9, by - 7); g.quadraticCurveTo(bx, by - 15, bx + 9, by - 7); g.stroke();
    g.fillStyle = "rgba(255,255,255,0.08)"; g.beginPath(); g.ellipse(bx - 6, by, 3, 6, 0.3, 0, TAU); g.fill();
    lbl.bag.set(BE.Run.pileLeft(run), 0, fmtInt).draw(bx, by + 4, 0.5); // §10.3 : étoiles restant dans la pioche
    // Bougie
    if (run.candle > 0) {
      const cx = bx - 26, cy = by + 6;
      g.fillStyle = "#e8e2d0"; g.fillRect(cx - 2.5, cy - 2, 5, 10);
      g.fillStyle = "rgba(0,0,0,0.15)"; g.fillRect(cx + 0.5, cy - 2, 2, 10);
      const fl = 1 + 0.15 * Math.sin(t * 13) + 0.08 * Math.sin(t * 29);
      g.globalCompositeOperation = "lighter"; g.globalAlpha = 0.6; g.drawImage(BE.FX.glow(P.or), cx - 9, cy - 16, 18, 18); g.globalCompositeOperation = "source-over"; g.globalAlpha = 1;
      g.fillStyle = "#ffb347"; g.beginPath(); g.moveTo(cx, cy - 9 * fl); g.quadraticCurveTo(cx + 3.5, cy - 4, cx, cy - 2.5); g.quadraticCurveTo(cx - 3.5, cy - 4, cx, cy - 9 * fl); g.fill();
      g.fillStyle = "#fff3c4"; g.beginPath(); g.arc(cx, cy - 4.2, 1.2, 0, TAU); g.fill();
    }
    drawPhare(run, S, t, st);
    const px = G.phare.x, py = G.phare.y;
    // pips de tirs (arc sous le Phare)
    const total = Math.max(run.shotsLeft + run.shotIndex, 6);
    const shownN = Math.min(10, total);
    for (let i = 0; i < shownN; i++) {
      const a = Math.PI * (0.84 - 0.68 * (shownN === 1 ? 0.5 : i / (shownN - 1)));
      const x = px + Math.cos(a) * 29, y = py + Math.sin(a) * 29;
      const used = i < run.shotIndex;
      const bonus = i >= total - run.bonusShots && !used;
      const grace = !used && !bonus && i >= total - run.bonusShots - (run.graceShots || 0); // tirs d'apprentissage (Lune 1)
      const last = !used && i === run.shotIndex && run.shotsLeft === 1;
      g.beginPath(); g.arc(x, y, last ? 2.6 + 0.8 * Math.max(0, Math.sin(t * 6)) : 2.6, 0, TAU);
      if (used) { g.strokeStyle = C_DIM60; g.lineWidth = 1; g.stroke(); }
      else if (grace && !last) { g.fillStyle = C_GLASS35; g.fill(); g.strokeStyle = "#8fd8ff"; g.lineWidth = 1.3; g.stroke(); } // apprentissage : pastille creuse
      else { g.fillStyle = bonus ? P.or : last ? "#ff9ab0" : "#eef2ff"; g.fill(); }
    }
    if (run.reserve > 0) lbl.reserve.set(run.reserve, 0, fmtReserve).draw(px - 38, py + 20, 1);
    // SUIV.
    const sx = G.swapBtn.x, sy = G.swapBtn.y;
    const voile = BE.Firm.ruleActive(run, "voile");
    g.fillStyle = "rgba(18,24,50,0.85)"; g.strokeStyle = C_LINE; g.lineWidth = 1.5;
    BE.FX.roundRect(g, sx - 22, sy - 20, 44, 40, 8); g.fill(); g.stroke();
    lbl.suiv.set(0, 0, fmtConst).draw(sx, sy + 26, 0.5); // sous la case (et non dans la barre haute, sous l'or)
    const nx = BE.Run.nextStars(run);
    if (voile) text("?", sx, sy + 1, font(900, 22), P.dim, "center");
    else if (nx[0]) {
      const r = D.SIZES[nx[0].size].r;
      const sw = t - BE.FX.swapT, swk = sw >= 0 && sw < 0.25 ? U.easeOutBack(sw / 0.25) : 1;
      const O = HUD_O; O.scale = Math.min(1, 14 / r) * (0.4 + 0.6 * swk); O.seed = nx[0].id * 7; O.lookX = px; O.lookY = py; O.alpha = 1; O.noFace = false;
      R.drawStar(sx, sy, nx[0].size, nx[0].color, O);
      for (let i = 1; i < nx.length; i++) { O.scale = 7 / D.SIZES[nx[i].size].r; O.noFace = true; R.drawStar(sx - 36, sy + 12 * (i - 1) - 6, nx[i].size, nx[i].color, O); }
    }
    if (run.swapsLeft > 0 && !voile) {
      g.fillStyle = P.panel; g.beginPath(); g.arc(sx - 21, sy + 17, 7, 0, TAU); g.fill();
      g.strokeStyle = P.eclat; g.lineWidth = 1; g.stroke();
      lbl.swaps.set(run.swapsLeft, 0, fmtInt).draw(sx - 21, sy + 17.5, 0.5);
    }
  };

  /** Bande des reliques (y ≥ 618). Pendant le décompte, la relique active saute. */
  R.drawRelicBand = function (run, S) {
    const gr = ensureGrads();
    // la bande s'agrandit dans la marge du bas (écrans hauts) : icônes plus grandes, cible plus haute ; sous elle,
    // un fondu vers le fond de l'écran (jamais de coupure nette)
    const ex = R.bandExtra(), names = EXT.bottom >= 40, bandB = D.H + (names ? Math.min(EXT.bottom, 42) : ex);
    g.fillStyle = gr.band; g.fillRect(EXT.x0, G.relicBandY, EXT.w, bandB - G.relicBandY);
    if (EXT.y1 > bandB) { // sous la bande : fondu vers le ciel (pas de bloc noir)
      if (!misc.bandFade) { const fg = g.createLinearGradient(0, 0, 0, 36); fg.addColorStop(0, "rgba(8,10,22,0.98)"); fg.addColorStop(1, "rgba(8,10,22,0)"); misc.bandFade = fg; }
      g.save(); g.translate(0, bandB); g.fillStyle = misc.bandFade; g.fillRect(EXT.x0, 0, EXT.w, 36); g.restore();
    }
    g.fillStyle = C_LINE80; g.fillRect(EXT.x0, G.relicBandY, EXT.w, 1);
    const slots = run.rules.relicSlots;
    const C = BE.state.scene === "COUNT" ? S.count : null;
    const isz = 18 + ex * 0.35;
    for (let i = 0; i < slots; i++) {
      const x = G.relicX[i], y = R.relicY();
      const r = run.relics[i];
      if (!r) { g.strokeStyle = C_LINE; g.setLineDash(DASH_R); g.lineWidth = 1; g.beginPath(); g.arc(x, y, isz * 0.45, 0, TAU); g.stroke(); g.setLineDash(NO_DASH); continue; }
      let sc = 1;
      const active = C && C.activeSlot === i;
      if (active) {
        const k = (C.t - C.activeT) / 0.22; sc = 1 + 0.45 * Math.sin(Math.min(1, k) * Math.PI);
        g.globalCompositeOperation = "lighter"; g.globalAlpha = 0.7 * Math.max(0, 1 - k * 0.6);
        g.drawImage(BE.FX.glow(C.activeStep && C.activeStep.dEclat ? P.eclat : P.mult), x - 20, y - 20 - (sc - 1) * 10, 40, 40);
        g.globalCompositeOperation = "source-over"; g.globalAlpha = 1;
      }
      R.drawRelicIcon(r.id, x, y - (sc - 1) * 12, isz, sc !== 1 ? { scale: sc } : null);
      if (names) { // écran haut : le nom de chaque relique sous son icône
        const d = D.RELIC_BY_ID[r.id];
        if (d) { g.font = font(700, 8); let nm = d.nom; while (nm.length > 4 && g.measureText(nm).width > 46) nm = nm.slice(0, -2) + "…"; text(nm, x, y + isz * 0.5 + 9, font(700, 8), active ? P.text : C_DIM70, "center"); }
      }
      if (active && C.activeStep && C.t - C.activeT < 0.6) {
        const st = C.activeStep;
        let lblT = "", col = P.mult, bg = null;
        if (st.xMult) { lblT = "×" + U.fmtDec(st.xMult); bg = "#ffe0e4"; }
        else if (st.dMult) lblT = "+" + U.fmtDec(st.dMult);
        else if (st.dEclat) { lblT = "+" + st.dEclat; col = P.eclat; }
        const yy = y - 28 - (C.t - C.activeT) * 12;
        g.font = font(900, 12); g.textAlign = "center"; g.textBaseline = "middle";
        if (bg) { const w = g.measureText(lblT).width + 8; g.fillStyle = bg; BE.FX.roundRect(g, x - w / 2, yy - 8, w, 16, 4); g.fill(); }
        else { g.lineWidth = 3; g.strokeStyle = "rgba(5,6,12,0.9)"; g.strokeText(lblT, x, yy); }
        g.fillStyle = col; g.fillText(lblT, x, yy);
      }
    }
  };

  // ================================================================ compteur live et rubans du décompte (y = 352)
  function ribbonTail(blue) {
    const key = blue ? "ribB" : "ribR";
    if (misc[key]) return misc[key];
    const [c, x] = off(180, 24);
    const col = blue ? P.eclat : P.mult;
    const gr = x.createLinearGradient(blue ? 0 : 180, 0, blue ? 180 : 0, 0);
    gr.addColorStop(0, U.rgba(col, 0)); gr.addColorStop(0.7, U.rgba(col, 0.28)); gr.addColorStop(1, U.rgba(col, 0.55));
    x.fillStyle = gr;
    x.beginPath();
    if (blue) { x.moveTo(0, 8); x.lineTo(180, 3); x.lineTo(180, 21); x.lineTo(0, 16); }
    else { x.moveTo(180, 8); x.lineTo(0, 3); x.lineTo(0, 21); x.lineTo(180, 16); }
    x.closePath(); x.fill();
    return (misc[key] = c);
  }
  const live = { e: -1, m: -1, eT: -9, mT: -9 };
  function pill(x, y, L, col, alpha, bump, flash) {
    const w = Math.max(44, L.width() + 16);
    const s = 1 + (bump || 0) * 0.28;
    g.globalAlpha = alpha;
    g.save(); g.translate(x, y); g.scale(s, s);
    if (bump > 0) {
      g.globalCompositeOperation = "lighter"; g.globalAlpha = alpha * bump * 0.6;
      g.drawImage(BE.FX.glow(col), -w * 0.8, -22, w * 1.6, 44);
      g.globalCompositeOperation = "source-over"; g.globalAlpha = alpha;
    }
    g.fillStyle = "rgba(5,6,12,0.7)"; BE.FX.roundRect(g, -w / 2, -11, w, 22, 11); g.fill();
    g.fillStyle = col === P.eclat ? "rgba(79,179,255,0.25)" : "rgba(255,77,94,0.25)"; g.fill();
    g.strokeStyle = col; g.lineWidth = 1.5; g.stroke();
    if (flash > 0) { g.globalAlpha = alpha * flash; g.fillStyle = "#ffffff"; g.fill(); g.globalAlpha = alpha; }
    L.draw(0, 0.5, 0.5);
    g.restore();
    g.globalAlpha = 1;
    return w;
  }
  R.drawCounter = function (run, S) {
    const st = BE.state, t = st.time;
    const y = G.liveY;
    const C = st.scene === "COUNT" ? S.count : null;
    let e, m;
    if (C) { e = C.eclat; m = C.mult; }
    else if (st.scene === "FLIGHT" || st.scene === "SETTLE" || st.scene === "TURRETS") { e = S.live.eclat; m = S.live.mult; }
    else return;
    const E = Math.floor(e);
    if (E !== live.e) { if (live.e >= 0 && E > live.e) live.eT = t; live.e = E; }
    if (m !== live.m) { if (live.m >= 0 && m > live.m) live.mT = t; live.m = m; }
    if (C && C.clashed) {
      const k = U.clamp((C.t - C.clashAt) / 0.18, 0, 1);
      const fly = U.clamp((C.t - C.totalAt) / D.FX.count.fly, 0, 1);
      const L = C.res.lumiere;
      const size = U.clamp(24 + Math.log10(Math.max(1, L)) * 2, 24, 32) * (0.6 + 0.4 * U.easeOutBack(k));
      const x = U.lerp(180, BE.FX.GAUGE_POS.x, U.easeInCubic(fly)), yy = U.lerp(y, BE.FX.GAUGE_POS.y, U.easeInCubic(fly));
      if (k < 1) {
        const offx = 60 * (1 - k);
        lbl.liveE.set(Math.floor(C.res.eclat), 1, fmtLiveE); lbl.liveM.set(C.res.mult, 0, fmtMultK);
        pill(180 - 12 - Math.max(44, lbl.liveE.width() + 16) / 2 - offx, y, lbl.liveE, P.eclat, 1 - k, 0, k);
        pill(180 + 12 + Math.max(44, lbl.liveM.width() + 16) / 2 + offx, y, lbl.liveM, P.mult, 1 - k, 0, k);
      }
      g.globalCompositeOperation = "lighter"; g.globalAlpha = 0.65 * (1 - fly);
      g.drawImage(BE.FX.glow("#ffffff"), x - 70, yy - 34, 140, 68);
      g.globalAlpha = 0.35 * (1 - fly) * (1 - k * 0.5);
      g.drawImage(BE.FX.glow(P.or), x - 110, yy - 40, 220, 80);
      g.globalCompositeOperation = "source-over"; g.globalAlpha = 1 - fly * 0.4;
      lbl.total.set(L, 0, fmtFmt).draw(x, yy, 0.5, (size / 32) * (1 - fly * 0.5));
      g.globalAlpha = 1;
      return;
    }
    // rubans : entrée depuis les bords pendant la base
    let slide = 0, flashM = 0;
    if (C) {
      const bk = U.clamp(C.t / D.FX.count.base, 0, 1);
      slide = 1 - U.easeOutCubic(bk);
      if (C.activeStep && C.activeStep.xMult) flashM = Math.max(0, 1 - (C.t - C.activeT) / 0.2);
    }
    lbl.liveE.set(E, C ? 1 : 0, fmtLiveE); lbl.liveM.set(m, 0, fmtMultK);
    const bumpE = Math.max(0, 1 - (t - live.eT) / 0.2), bumpM = Math.max(0, 1 - (t - live.mT) / 0.2);
    const wE = Math.max(44, lbl.liveE.width() + 16), wM = Math.max(44, lbl.liveM.width() + 16);
    const xE = 180 - 12 - wE / 2 - slide * 200, xM = 180 + 12 + wM / 2 + slide * 200;
    if (C) {
      const tb = ribbonTail(true), tr = ribbonTail(false);
      g.globalAlpha = 0.9;
      g.drawImage(tb, 0, y - 12, Math.max(1, xE - wE / 2 + 4), 24);
      g.drawImage(tr, xM + wM / 2 - 4, y - 12, Math.max(1, D.W - (xM + wM / 2 - 4)), 24);
      g.globalAlpha = 1;
    }
    // plaque sombre sous le compteur : lisible même quand le bocal monte jusqu'à lui
    if (!C || slide < 0.5) {
      const bx0 = xE - wE / 2 - 7, bx1 = xM + wM / 2 + 7;
      g.globalAlpha = 0.62 * (1 - slide); g.fillStyle = "#05070f"; BE.FX.roundRect(g, bx0, y - 15, bx1 - bx0, 30, 15); g.fill(); g.globalAlpha = 1;
    }
    const arrive = C ? Math.max(0, 1 - Math.abs(C.t - D.FX.count.base) / 0.12) : 0; // petit « pop » à l'arrivée des rubans
    pill(xE, y, lbl.liveE, P.eclat, 1, Math.max(bumpE, arrive * 0.6), 0);
    pill(xM, y, lbl.liveM, P.mult, 1, Math.max(bumpM, flashM, arrive * 0.6), flashM * 0.6);
    text("×", 180, y + 0.5, font(900, 14), P.text, "center");
  };

  /** Rangée fantôme (y = 90) : prochaine apparition. */
  R.drawGhostRow = function (run) {
    const t = BE.state.time;
    const ghost = run.firm.ghost;
    let seen = 0;
    for (let i = 0; i < ghost.length; i++) {
      const gh = ghost[i];
      const bit = 1 << gh.col;
      if (seen & bit) continue;
      seen |= bit;
      const x = G.cols[gh.col], y = G.ghostY + Math.sin(t * 2 + gh.col) * 1;
      g.globalAlpha = 0.5 + 0.1 * Math.sin(t * 3 + gh.col);
      g.fillStyle = P.ombre; g.strokeStyle = P.ombreLine; g.lineWidth = 1;
      g.setLineDash(DASH_R); g.beginPath(); g.arc(x, y, 8, 0, TAU); g.fill(); g.stroke(); g.setLineDash(NO_DASH);
      g.fillStyle = gh.type === "lanterne" ? "#ffb347" : "#ffffff";
      g.beginPath(); g.arc(x, y, 2.2, 0, TAU); g.fill();
      if (gh.type === "lourde") { g.fillStyle = P.ombreLine; g.fillRect(x - 5, y + 5, 10, 1.5); }
      if (gh.type === "blindee") { g.strokeStyle = "#8f86c8"; g.lineWidth = 2; g.beginPath(); g.arc(x, y, 8, 0, TAU); g.stroke(); }
      if (gh.type === "mere") { g.strokeStyle = P.or; g.lineWidth = 1; g.beginPath(); g.arc(x, y, 10.5, 0, TAU); g.stroke(); }
      g.globalAlpha = 1;
    }
  };

  /** Progression du run : 5 Lunes × 3 nuits (lunes dessinées selon leur phase). */
  R.drawLuneTrack = function (run, cx, y, opts) {
    opts = opts || EMPTY;
    const n = Math.max(D.LUNES, run.lune), sp = Math.min(opts.sp || 58, (opts.sp || 58) * (D.LUNES - 1) / (n - 1)); // Nuit Blanche : la frise se resserre
    const t = BE.state.time;
    const doneNight = opts.afterWin ? 1 : 0;
    g.strokeStyle = C_LINE; g.lineWidth = 1.5;
    g.beginPath(); g.moveTo(cx - (n - 1) * sp / 2, y); g.lineTo(cx + (n - 1) * sp / 2, y); g.stroke();
    for (let L = 1; L <= n; L++) {
      const x = cx + (L - 1 - (n - 1) / 2) * sp;
      const past = L < run.lune, cur = L === run.lune;
      const r = cur ? 11 : 9;
      g.fillStyle = P.bg; g.beginPath(); g.arc(x, y, r + 2, 0, TAU); g.fill();
      const m = moonSprite(Math.min(4, L - 1)), s = m.H * (r / MOON_R);
      g.globalAlpha = past || cur ? 1 : 0.35;
      g.drawImage(m, x - s, y - s, s * 2, s * 2);
      g.globalAlpha = 1;
      if (past) { g.strokeStyle = P.or; g.lineWidth = 1.5; g.beginPath(); g.arc(x, y, r + 1, 0, TAU); g.stroke(); }
      if (cur) { g.strokeStyle = "rgba(238,242,255," + (0.5 + 0.3 * Math.sin(t * 3)).toFixed(2) + ")"; g.lineWidth = 1.5; g.beginPath(); g.arc(x, y, r + 4, 0, TAU); g.stroke(); }
      if (L === D.LUNES) text("ÉCLIPSE", x, y + 30, font(800, 7), D.BOSSES.eclipse.color, "center");
      for (let k = 0; k < 3; k++) {
        const px = x - 10 + k * 10, py = y + 19;
        const done = past || (cur && (k < run.nuit || (k === run.nuit && doneNight)));
        const now = cur && k === run.nuit && !doneNight;
        g.beginPath();
        if (k === 2) { g.moveTo(px, py - 3.5); g.lineTo(px + 3.5, py); g.lineTo(px, py + 3.5); g.lineTo(px - 3.5, py); g.closePath(); }
        else g.arc(px, py, 2.8, 0, TAU);
        if (done) { g.fillStyle = P.or; g.fill(); }
        else if (now) { g.fillStyle = k === 2 ? "#ff9ab0" : "#eef2ff"; g.fill(); }
        else { g.strokeStyle = C_DIM60; g.lineWidth = 1; g.stroke(); }
      }
    }
  };

  // ================================================================ scène de jeu
  const LOOK = { x: 0, y: 0 };
  function lookTarget(S) {
    if (S.flight && S.flight.stars.length) { const s = S.flight.stars[0]; LOOK.x = s.x; LOOK.y = s.y; return LOOK; }
    if (S.aim && S.aim.prev && S.aim.prev.contacts.length) { const c = S.aim.prev.contacts[0]; LOOK.x = c.x; LOOK.y = c.y; return LOOK; }
    return null;
  }
  const STAR_O = { pure: false, lookX: 0, lookY: 0, seed: 0, sx: 1, sy: 1, bicolor: null, bicolorA: 0, sleepy: undefined, excited: false,
    stretch: 0, dir: 0, scale: 1, alpha: undefined, squash: 0, noFace: false };
  const STONE_O = { x: 0, y: 0, r: 0, size: 0, id: 0, seed: 0 };
  const TRAIL_P = { kind: 0, speed: 20, life: 0.35, size: 1.2, color: "#fff", glow: true, drag: 3 };

  function drawShadowSet(run, look, dt, t, pass) {
    const list = run.firm.shadows;
    for (let i = 0; i <= list.length; i++) {
      const s = i < list.length ? list[i] : run.firm.boss;
      if (!s || !s.alive) continue;
      if (pass === 0) {
        if (s.spawnT === undefined) s.spawnT = t;
        if (s.dispX === undefined) { s.dispX = s.x; s.dispY = s.y; }
        s.dispX = U.approach(s.dispX, s.x, 12, dt);
        s.dispY = U.approach(s.dispY, s.y, 10, dt);
        R.drawShadow(s, look);
      } else R.drawBadges(s);
    }
  }

  R.drawGame = function () {
    const st = BE.state, run = st.run, S = st.play;
    if (!run || !S) return;
    const t = st.time, dt = st.frameDt || 0.016;
    const FX = BE.FX;
    R.drawBackground(t);
    R.drawJarGlass(run);
    R.drawPegs(S.pegs);
    const look = lookTarget(S);
    drawShadowSet(run, look, dt, t, 0);
    drawDying(t);
    // bocal
    const alert = st.scene === "AIM" || st.scene === "NIGHT_INTRO" ? BE.Jar.alertLevel(run) : BE.Jar.danger(run) ? 2 : 0;
    const danger = alert === 2;
    const lostIds = st.scene === "RUN_LOST" && S.lost ? S.lost.bodies : null;
    const vid = st.scene === "VIDANGE" ? U.easeInCubic(U.clamp(st.sceneT / D.FX.vidange, 0, 1)) : 0;
    const vidLeave = vid && S.vid && S.vid.kept ? S.vid.leave : null; // Insomniaque : seules les petites étoiles tombent
    const bodies = run.jar.bodies;
    const O = STAR_O;
    tightHalo = updateLod(run);
    const hz = danger ? BE.Run.horizon(run) : -1;
    for (let i = 0; i < bodies.length; i++) {
      const b = bodies[i];
      let bx = b.x, by = b.y;
      if (lostIds && lostIds.indexOf(b.id) >= 0) { bx += Math.sin(t * 60) * 2; by += Math.cos(t * 47) * 1; }
      if (vid && (!vidLeave || vidLeave.indexOf(b.id) >= 0)) { by += vid * 360 + (b.id % 5) * vid * 20; bx += Math.sin(b.id) * vid * 40; }
      // squash & stretch : fusion 1,25 → 0,9 → 1 en 180 ms ; atterrissage plus doux
      let sx = 1, sy = 1;
      const ms = t - (b.squashT || -9);
      if (ms >= 0 && ms < 0.18) {
        const s = ms < 0.06 ? 1.25 - 0.35 * (ms / 0.06) : 0.9 + 0.1 * U.easeOutBack((ms - 0.06) / 0.12);
        sx = s; sy = 2 - s;
      } else {
        const ls = t - (b.landT || -9);
        if (ls >= 0 && ls < 0.2) { const k = Math.sin(ls / 0.2 * Math.PI) * (1 - ls / 0.2); sx = 1 + 0.16 * k; sy = 1 - 0.14 * k; }
      }
      if (b.stone) { STONE_O.x = bx; STONE_O.y = by; STONE_O.r = b.r; STONE_O.size = b.size; STONE_O.id = b.id; STONE_O.seed = b.seed; R.drawStone(STONE_O, 1, sx, sy); continue; }
      const bic = b.bicolor && b.bornT !== undefined && t - b.bornT < 1 ? 1 - (t - b.bornT) : 0;
      O.pure = b.pure && b.shotNo === run.runStats.shots;
      O.lookX = look ? look.x : bx + Math.sin(t * 0.3 + b.id) * 30; O.lookY = look ? look.y : by - 30;
      O.seed = b.id * 13; O.sx = sx; O.sy = sy; O.bicolor = bic > 0 ? b.bicolor : null; O.bicolorA = bic;
      O.excited = danger && by - b.r < hz; O.stretch = 0; // inquiète au-dessus de l'horizon
      // le verre grossit l'étoile qui entre : rayon de vol → rayon du bocal en 0,16 s
      const gk = b.fromShot ? (t - (b.landT === undefined ? -9 : b.landT)) / 0.16 : 1;
      O.scale = gk >= 0 && gk < 1 ? (D.SIZES[b.size].rf + (D.SIZES[b.size].r - D.SIZES[b.size].rf) * U.easeOutBack(gk)) / D.SIZES[b.size].r : 1;
      R.drawStar(bx, by, b.size, b.color, O);
    }
    O.scale = 1;
    tightHalo = false;
    // étoiles en vol : traînée lumineuse + étirement dans le sens de la vitesse
    if (S.flight) {
      const stars = S.flight.stars;
      for (let i = 0; i < stars.length; i++) {
        const s = stars[i];
        const col = famColor(s.color);
        const tr = s.trail, n = tr.length;
        if (n >= 4) {
          const glow = FX.glow(col);
          g.globalCompositeOperation = "lighter";
          for (let j = 0; j < n; j += 2) {
            const k = (j + 2) / n;
            const rr = s.r * (0.35 + 0.75 * k);
            g.globalAlpha = 0.32 * k;
            g.drawImage(glow, tr[j] - rr, tr[j + 1] - rr, rr * 2, rr * 2);
          }
          g.globalCompositeOperation = "source-over"; g.globalAlpha = 1;
        }
        if (Math.random() < 0.5) {
          TRAIL_P.color = col; TRAIL_P.angle = Math.atan2(-s.vy, -s.vx); TRAIL_P.spread = 1.2;
          FX.particle(s.x + (Math.random() - 0.5) * s.r, s.y + (Math.random() - 0.5) * s.r, TRAIL_P);
        }
        const sp = Math.sqrt(s.vx * s.vx + s.vy * s.vy);
        O.pure = false; O.lookX = s.x + s.vx; O.lookY = s.y + s.vy; O.seed = s.id * 13; O.sx = 1; O.sy = 1; O.bicolor = null; O.bicolorA = 0;
        O.excited = true; O.stretch = Math.min(0.3, sp / 2600); O.dir = Math.atan2(s.vy, s.vx);
        O.scale = s.r / D.SIZES[s.size].r; // rayon de vol (plus petit que dans le bocal)
        R.drawStar(s.x, s.y, s.size, s.color, O);
        O.stretch = 0; O.excited = false; O.scale = 1;
      }
    }
    R.drawJarFront(run, danger);
    R.drawHorizon(run, alert);
    if (st.scene === "AIM" && !st.paused) R.drawAim(S, run);
    FX.drawBeams(g);
    FX.drawRings(g);
    FX.drawBolts(g);
    FX.drawParticles(g);
    FX.drawFloats(g);
    // badges et rangée fantôme au-dessus
    if (run.firm.boss) drawBossBar(run.firm.boss); // l'anneau de PV passe SOUS les badges (lisibilité)
    drawShadowSet(run, look, dt, t, 1);
    R.drawGhostRow(run);
    // vignette (et pouls rouge quand le bocal frôle l'horizon)
    if (danger) {
      const hb = t - FX.dangerT, pk = hb >= 0 && hb < 0.6 ? Math.sin(Math.min(1, hb / 0.6) * Math.PI) : 0;
      g.globalAlpha = 0.3 + 0.5 * pk;
      g.drawImage(misc.vigRed, EXT.x0, EXT.y0, EXT.w, EXT.h);
      g.globalAlpha = 1;
    }
    R.drawCounter(run, S);
    R.drawHUD(run, S);
    R.drawRelicBand(run, S);
    FX.drawBanners(g);
    // fondu de fin de nuit vers l'Aube (§11.4)
    let veil = 0;
    if (st.scene === "NIGHT_WON" && S.won && run.nuit !== 2) {
      const end = D.FX.nightWonFreeze + D.FX.nightWonConvert + 1.1;
      veil = U.clamp((S.won.t - (end - 0.22)) / 0.22, 0, 1);
    } else if (st.scene === "VIDANGE") veil = U.clamp((st.sceneT - (D.FX.vidange - 0.22)) / 0.22, 0, 1);
    if (veil > 0) { g.globalAlpha = veil; g.fillStyle = P.bg0; g.fillRect(-20, -20, D.W + 40, D.H + 40); g.globalAlpha = 1; }
  };
  R.jarDanger = function (run) { return BE.Jar.danger(run); };

  // ================================================================ image
  /** Dessine une image complète. Appelé par la boucle principale. */
  R.draw = function () {
    const st = BE.state, V = BE.view;
    if (!g || !V || !bgBase) return;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalAlpha = 1; g.globalCompositeOperation = "source-over";
    g.fillStyle = P.bg0; g.fillRect(0, 0, cv.width, cv.height);
    const s = V.scale * V.dpr;
    g.setTransform(s, 0, 0, s, (V.left || 0) * V.dpr + BE.FX.ox * s, (V.top || 0) * V.dpr + BE.FX.oy * s);
    g.save();
    g.beginPath(); g.rect(EXT.x0, EXT.y0, EXT.w, EXT.h); g.clip();
    const sc = st.scene;
    const FX = BE.FX;
    FX.drawn = 0;
    const game = st.run && (BE.Run.IN_GAME[sc] || sc === "SETTLE_CANDLE");
    if (game) R.drawGame();
    else R.drawBackground(st.time);
    if (BE.UI) BE.UI.draw(g);
    // hors jeu (Aube, titre…) : les FX passent par-dessus l'interface, sauf si l'écran les a déjà dessinés
    if (!game) {
      if (!(FX.drawn & 1)) { FX.drawBeams(g); FX.drawRings(g); FX.drawBolts(g); FX.drawParticles(g); FX.drawFloats(g); }
      if (!(FX.drawn & 2)) FX.drawBanners(g);
    }
    FX.drawFlash(g);
    g.restore();
  };
})(window.BE = window.BE || {});
