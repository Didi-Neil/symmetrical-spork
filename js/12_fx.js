/* 12_fx.js — BE.FX : juice (§11.3). Particules (pool 300), nombres flottants (40), anneaux, éclairs, faisceaux,
   bannières, secousse, hitstop, flash, fondus, minuteries cosmétiques. Pur écouteur du bus d'événements :
   aucune donnée de simulation n'est modifiée ici (seulement des horodatages d'animation : squashT, hurtT…).
   Boucles chaudes sans allocation : les pools sont parcourus à la main, les polices sont mises en cache. */
(function (BE) {
  "use strict";

  const FX = (BE.FX = {});
  const U = BE.util, D = BE.DATA, P = D.PAL, G = D.GEOM;
  const TAU = Math.PI * 2;
  const rnd = Math.random; // cosmétique uniquement (autorisé hors simulation)

  FX.hitstop = 0;
  FX.ox = 0; FX.oy = 0;
  FX.time = 0;          // temps « jeu » (gelé pendant le hitstop)
  FX.rt = 0;            // temps réel
  FX.flashA = 0; FX.flashColor = "#ffffff";
  FX.fadeA = 0; FX.fadeColor = P.bg0;
  // horodatages (temps réel, BE.state.time) lus par le rendu
  FX.launchT = -9; FX.gaugeT = -9; FX.goldT = -9; FX.swapT = -9; FX.dangerT = -9; FX.bigBangT = -9; FX.auroraT = -9;
  FX.coinArrivals = 0;  // nombre de pièces arrivées (le compteur d'or du HUD « compte » les pièces)

  let flashHold = 0, flashDecay = 6;
  let shakeAmp = 0, shakeT = 0, shakeDur = 0, shakePh = 0;
  let kickX = 0, kickY = 0, kickVX = 0, kickVY = 0;
  let fadeDur = 0.3;
  let lastNow = 0;

  function settings() { return BE.settings || {}; }
  function now() { return BE.state ? BE.state.time : 0; }

  // ---------------------------------------------------------------- polices mises en cache
  const F800 = [], F900 = [], F700 = [];
  /** Police en cache (aucune concaténation par image). w = 700 | 800 | 900, px entier. */
  FX.font = function (w, px) {
    px = px | 0;
    const T = w === 900 ? F900 : w === 700 ? F700 : F800;
    return T[px] || (T[px] = w + " " + px + "px " + D.FONT);
  };
  const font = FX.font;

  // ---------------------------------------------------------------- pools
  const parts = new U.Pool(D.FX.particles, () => ({ x: 0, y: 0, vx: 0, vy: 0, life: 0, max: 1, size: 2, color: "#fff", drag: 0, g: 0,
    glow: false, kind: 0, tx: 0, ty: 0, rot: 0, vr: 0, a: 0.8, coin: false }));
  const floats = new U.Pool(D.FX.floats, () => ({ x: 0, y: 0, text: "", color: "#fff", size: 12, life: 0, max: 0.4, rise: 14, bg: null,
    w: -1, vx: 0, weight: 800 }));
  const rings = new U.Pool(32, () => ({ x: 0, y: 0, r0: 0, r1: 0, life: 0, max: 0.25, color: "#fff", w: 2, glow: false }));
  const bolts = new U.Pool(16, () => ({ pts: new Float32Array(18), x1: 0, y1: 0, x2: 0, y2: 0, life: 0, max: 0.25, color: "#ffe14d", jt: 0 }));
  const beams = new U.Pool(8, () => ({ x1: 0, y1: 0, x2: 0, y2: 0, life: 0, max: 0.4, color: "#fff", w: 8 }));
  const banners = new U.Pool(6, () => ({ x: 0, y: 0, text: "", color: "#fff", size: 20, life: 0, max: 1, sub: "", icon: null, w: -1 }));
  const timers = new U.Pool(64, () => ({ t: 0, fn: null, a: null }));
  FX.pools = { parts, floats, rings, bolts, banners, beams, timers };

  // ---------------------------------------------------------------- sprites de lueur
  const glowCache = {};
  /** Sprite de lueur (dégradé radial) pour une couleur, composé en "lighter". */
  FX.glow = function (color) {
    const c0 = glowCache[color];
    if (c0) return c0;
    const c = document.createElement("canvas");
    c.width = c.height = 64;
    const x = c.getContext("2d");
    const gr = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, U.rgba(color, 1));
    gr.addColorStop(0.25, U.rgba(color, 0.55));
    gr.addColorStop(0.6, U.rgba(color, 0.14));
    gr.addColorStop(1, U.rgba(color, 0));
    x.fillStyle = gr; x.fillRect(0, 0, 64, 64);
    glowCache[color] = c;
    return c;
  };
  const ringCache = {};
  /** Anneau lumineux pré-rendu (onde de choc). */
  function ringSprite(color) {
    const c0 = ringCache[color];
    if (c0) return c0;
    const c = document.createElement("canvas");
    c.width = c.height = 128;
    const x = c.getContext("2d");
    const gr = x.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, U.rgba(color, 0));
    gr.addColorStop(0.62, U.rgba(color, 0));
    gr.addColorStop(0.82, U.rgba(color, 0.7));
    gr.addColorStop(0.9, U.rgba(color, 0.25));
    gr.addColorStop(1, U.rgba(color, 0));
    x.fillStyle = gr; x.fillRect(0, 0, 128, 128);
    ringCache[color] = c;
    return c;
  }

  // ---------------------------------------------------------------- API
  /**
   * Particule. o : {angle, spread, speed, vx, vy, life, size, color, drag, g, glow, alpha,
   * kind 0 point | 1 éclat | 2 pièce aspirée (tx,ty) | 3 fumée | 4 paillette | 5 trait | 6 braise aspirée (tx,ty) | 7 note ♪}
   */
  FX.particle = function (x, y, o) {
    const p = parts.spawn();
    p.x = x; p.y = y;
    let a = o.angle !== undefined ? o.angle : rnd() * TAU;
    if (o.spread) a += (rnd() - 0.5) * o.spread;
    const sp = o.speed !== undefined ? o.speed * (0.5 + rnd() * 0.8) : 60;
    p.vx = Math.cos(a) * sp + (o.vx || 0); p.vy = Math.sin(a) * sp + (o.vy || 0);
    p.max = p.life = o.life !== undefined ? o.life * (0.7 + rnd() * 0.6) : 0.3 + rnd() * 0.5;
    p.size = o.size ? o.size * (0.7 + rnd() * 0.6) : 1 + rnd() * 2;
    p.color = o.color || "#ffffff";
    p.drag = o.drag !== undefined ? o.drag : 2;
    p.g = o.g || 0;
    p.glow = !!o.glow;
    p.kind = o.kind || 0;
    p.tx = o.tx || 0; p.ty = o.ty || 0;
    p.rot = rnd() * TAU; p.vr = (rnd() - 0.5) * 14;
    p.a = o.alpha !== undefined ? o.alpha : 0.8;
    p.coin = p.kind === 2;
    return p;
  };
  FX.burst = function (x, y, n, o) { for (let i = 0; i < n; i++) FX.particle(x, y, o); };
  /** Nombre flottant (« +1 » bleu 10 px qui monte de 14 px en 400 ms…). o : {life, rise, bg, vx, weight} */
  FX.float = function (x, y, text, color, size, o) {
    o = o || {};
    if (o.stack) {
      // empilement : un nombre récent (< 0,45 s) au même endroit pousse le nouveau au-dessus (« +1+1 », « +5 +2 »)
      const step = Math.round(size || 12) + 3;
      for (let guard = 0; guard < 6; guard++) {
        let hit = false;
        for (const q of floats.items) {
          if (!q.alive || !q.stack || q.max - q.life > 0.45) continue;
          if (Math.abs(q.x - x) < 26 && Math.abs(q.y - y) < step - 1) { y = q.y - step; hit = true; }
        }
        if (!hit) break;
      }
    }
    const f = floats.spawn();
    f.stack = !!o.stack;
    f.x = x; f.y = y; f.text = text; f.color = color || "#fff"; f.size = Math.round(size || 12);
    f.max = f.life = o.life || 0.4 + (f.size > 12 ? 0.35 : 0);
    f.rise = o.rise !== undefined ? o.rise : 14; f.bg = o.bg || null; f.w = -1;
    f.vx = o.vx || 0; f.weight = o.weight || 800;
    return f;
  };
  FX.ring = function (x, y, r0, r1, color, dur, w, glow) {
    const r = rings.spawn();
    r.x = x; r.y = y; r.r0 = r0; r.r1 = r1; r.color = color || "#fff"; r.max = r.life = dur || 0.25; r.w = w || 2; r.glow = !!glow;
  };
  function jitterBolt(b) {
    const x1 = b.x1, y1 = b.y1, x2 = b.x2, y2 = b.y2;
    const nx = -(y2 - y1), ny = x2 - x1, l = Math.hypot(nx, ny) || 1;
    const amp = Math.min(22, l * 0.12);
    b.pts[0] = x1; b.pts[1] = y1;
    for (let i = 1; i < 8; i++) {
      const t = i / 8, off = (rnd() - 0.5) * amp * (1 - Math.abs(t - 0.5));
      b.pts[i * 2] = x1 + (x2 - x1) * t + nx / l * off;
      b.pts[i * 2 + 1] = y1 + (y2 - y1) * t + ny / l * off;
    }
    b.pts[16] = x2; b.pts[17] = y2;
  }
  FX.bolt = function (x1, y1, x2, y2, color) {
    const b = bolts.spawn();
    b.x1 = x1; b.y1 = y1; b.x2 = x2; b.y2 = y2; b.jt = 0.05;
    jitterBolt(b);
    b.max = b.life = 0.3; b.color = color || P.foudre;
  };
  /** Faisceau lumineux (colonne de Plasma, « trait coloré » d'une réaction). */
  FX.beam = function (x1, y1, x2, y2, color, w, dur) {
    const b = beams.spawn();
    b.x1 = x1; b.y1 = y1; b.x2 = x2; b.y2 = y2; b.color = color || "#fff"; b.w = w || 8; b.max = b.life = dur || 0.4;
  };
  /** Bannière. icon : id de réaction (dessinée par BE.Render.drawReactionIcon). */
  FX.banner = function (text, x, y, color, size, dur, sub, icon, o) {
    const b = banners.spawn();
    b.text = text; b.x = x; b.y = y; b.color = color || "#fff"; b.size = Math.round(size || 20); b.max = b.life = dur || 1;
    b.sub = sub || ""; b.icon = icon || null; b.w = -1;
    b.minX = o && o.minX !== undefined ? o.minX : 0; b.maxX = o && o.maxX !== undefined ? o.maxX : D.W; b.kind = (o && o.kind) || "";
    return b;
  };
  /** Bannière avec sous-titre encore lisible (la pastille ×3 et les indices s'effacent devant elle). */
  FX.bannerWithSub = function () {
    for (const b of banners.items) if (b.alive && b.sub && b.life > 0.15) return true;
    return false;
  };
  /** Secousse (amplitude px, durée s). La plus forte l'emporte. */
  FX.shake = function (amp, dur) {
    if (settings().shake === false) return;
    const cur = shakeDur > 0 ? shakeAmp * Math.max(0, shakeT / shakeDur) : 0;
    if (amp >= cur) { shakeAmp = amp; shakeT = shakeDur = dur || 0.2; shakePh = rnd() * 100; }
  };
  /** Impulsion directionnelle (ressort amorti), ex. débordement vers le bas. */
  FX.kick = function (dx, dy) {
    if (settings().shake === false) return;
    kickVX += dx * 40; kickVY += dy * 40;
  };
  FX.stop = function (sec) { FX.hitstop = Math.max(FX.hitstop, sec); };
  /** Flash plein écran : alpha a, maintenu `hold` s puis décroissance. Réduit à 30 % avec « Flashs réduits ». */
  FX.flash = function (a, color, hold, decay) {
    const k = settings().flash === false ? a * 0.3 : a;
    if (k >= FX.flashA) { FX.flashA = k; FX.flashColor = color || "#fff"; flashHold = hold || 0; flashDecay = decay || 6; }
  };
  FX.vibrate = function (pattern) {
    if (settings().vibrate === false) return;
    try { if (navigator.vibrate) navigator.vibrate(pattern); } catch (e) { /* */ }
  };
  /** Fondu d'entrée : un voile opaque qui s'efface en `dur` s. */
  FX.fade = function (dur, color) { FX.fadeA = 1; fadeDur = dur || 0.3; FX.fadeColor = color || P.bg0; };
  /** Minuterie cosmétique en temps réel (n'avance pas en pause). */
  FX.after = function (sec, fn, a) { const t = timers.spawn(); t.t = sec; t.fn = fn; t.a = a; };
  FX.clear = function () {
    parts.clear(); floats.clear(); rings.clear(); bolts.clear(); banners.clear(); beams.clear(); timers.clear();
    FX.flashA = 0; shakeT = 0; FX.hitstop = 0; kickX = kickY = kickVX = kickVY = 0;
    for (let i = 0; i < agg.length; i++) agg[i].id = null;
  };
  /** Paillettes (étoiles à 4 branches). */
  FX.sparkle = function (x, y, n, color, speed, life) {
    for (let i = 0; i < n; i++) FX.particle(x, y, { kind: 4, color: color || "#ffffff", speed: speed || 80, life: life || 0.6, size: 1.6, glow: true, drag: 3 });
  };
  /** n particules aspirées vers (tx, ty). coin = pièces (émettent coinArrive). */
  FX.suck = function (x, y, n, tx, ty, color, coin, life) {
    for (let i = 0; i < n; i++) {
      FX.particle(x + (rnd() - 0.5) * 10, y + (rnd() - 0.5) * 10, { kind: coin ? 2 : 6, color: color || P.or, tx, ty, speed: 110 + rnd() * 60,
        life: (life || 1.1) + i * 0.04, drag: 0, glow: true, size: coin ? 2.6 : 1.8, alpha: 1 });
    }
  };

  // ---------------------------------------------------------------- agrégation des dégâts (≤ toutes les 250 ms, §11.3)
  const agg = [];
  for (let i = 0; i < 12; i++) agg.push({ id: null, n: 0, t: 0, x: 0, y: 0, r: 18 });
  function aggDamage(tg, dmg) {
    let slot = null, oldest = null;
    for (let i = 0; i < agg.length; i++) {
      const a = agg[i];
      if (a.id === tg.id) { slot = a; break; }
      if (a.id === null && !slot) slot = a;
      if (!oldest || a.t < oldest.t) oldest = a;
    }
    if (!slot) { flushAgg(oldest); slot = oldest; }
    if (slot.id !== tg.id) { slot.id = tg.id; slot.n = 0; slot.t = D.FX.aggregateDmg; }
    slot.n += dmg; slot.x = tg.dispX !== undefined ? tg.dispX : tg.x; slot.y = tg.dispY !== undefined ? tg.dispY : tg.y; slot.r = tg.r || 18;
  }
  function flushAgg(a) {
    if (a.id !== null && a.n > 0) {
      const s = Math.min(20, 12 + a.n * 0.8);
      FX.float(a.x + a.r * 0.35, a.y - a.r - 6, "−" + a.n, "#ffffff", s, { life: 0.6, rise: 12, weight: 900 });
    }
    a.id = null; a.n = 0;
  }

  // ---------------------------------------------------------------- mise à jour
  FX.update = function (el) {
    // temps réel (la boucle passe el = 0 pendant le hitstop : particules figées, secousse et flash continuent)
    const tnow = typeof performance !== "undefined" ? performance.now() : 0;
    let rel = lastNow ? (tnow - lastNow) / 1000 : el;
    lastNow = tnow;
    if (!(rel >= 0) || rel > 0.1) rel = Math.min(0.1, el || 0.016);
    FX.time += el; FX.rt += rel;

    let items = parts.items;
    for (let i = 0; i < items.length; i++) {
      const p = items[i];
      if (!p.alive) continue;
      p.life -= el;
      if (p.kind === 2 || p.kind === 6) {
        const k = 1 - p.life / p.max;
        const dx = p.tx - p.x, dy = p.ty - p.y;
        const pull = 5 + 30 * k * k;
        p.vx += dx * pull * el; p.vy += dy * pull * el;
        const damp = 1 - Math.min(1, 3.2 * el);
        p.vx *= damp; p.vy *= damp;
        if ((dx * dx + dy * dy < 64 && k > 0.25) || p.life <= 0) {
          p.alive = false;
          if (p.coin) { FX.coinArrivals++; FX.goldT = now(); COIN_EV.x = p.tx; COIN_EV.y = p.ty; BE.emit("coinArrive", COIN_EV); }
          else if (p.ty < 40) FX.gaugeT = now();
          continue;
        }
      } else {
        if (p.life <= 0) { p.alive = false; continue; }
        const d = Math.max(0, 1 - p.drag * el);
        p.vx *= d; p.vy *= d; p.vy += p.g * el;
      }
      p.x += p.vx * el; p.y += p.vy * el; p.rot += p.vr * el;
    }
    items = floats.items;
    for (let i = 0; i < items.length; i++) { const f = items[i]; if (!f.alive) continue; f.life -= el; f.x += f.vx * el; if (f.life <= 0) f.alive = false; }
    items = rings.items;
    for (let i = 0; i < items.length; i++) { const r = items[i]; if (!r.alive) continue; r.life -= el; if (r.life <= 0) r.alive = false; }
    items = bolts.items;
    for (let i = 0; i < items.length; i++) {
      const b = items[i]; if (!b.alive) continue;
      b.life -= el; b.jt -= el;
      if (b.jt <= 0) { b.jt = 0.05; jitterBolt(b); }
      if (b.life <= 0) b.alive = false;
    }
    items = beams.items;
    for (let i = 0; i < items.length; i++) { const b = items[i]; if (!b.alive) continue; b.life -= el; if (b.life <= 0) b.alive = false; }
    items = banners.items;
    for (let i = 0; i < items.length; i++) { const b = items[i]; if (!b.alive) continue; b.life -= rel; if (b.life <= 0) b.alive = false; }
    items = timers.items;
    for (let i = 0; i < items.length; i++) {
      const t = items[i]; if (!t.alive) continue;
      t.t -= rel;
      if (t.t <= 0) { t.alive = false; const fn = t.fn; t.fn = null; try { fn(t.a); } catch (e) { console.error(e); } }
    }
    // secousse (bruit sinusoïdal amorti) + impulsion à ressort
    if (shakeT > 0) {
      shakeT -= rel;
      const k = Math.max(0, shakeT / shakeDur), a = shakeAmp * k * k;
      shakePh += rel * 52;
      FX.ox = a * (Math.sin(shakePh * 1.13) * 0.6 + Math.sin(shakePh * 2.71 + 1.3) * 0.4);
      FX.oy = a * (Math.sin(shakePh * 1.37 + 2.1) * 0.6 + Math.sin(shakePh * 2.29 + 0.4) * 0.4);
    } else { FX.ox = 0; FX.oy = 0; }
    if (kickVX || kickVY || kickX || kickY) {
      const kk = 180, damp = 14;
      kickVX += (-kk * kickX - damp * kickVX) * rel; kickVY += (-kk * kickY - damp * kickVY) * rel;
      kickX += kickVX * rel; kickY += kickVY * rel;
      if (Math.abs(kickX) + Math.abs(kickY) + Math.abs(kickVX) + Math.abs(kickVY) < 0.02) kickX = kickY = kickVX = kickVY = 0;
      FX.ox += kickX; FX.oy += kickY;
    }
    if (flashHold > 0) flashHold -= rel; else FX.flashA = Math.max(0, FX.flashA - rel * flashDecay);
    if (FX.fadeA > 0) FX.fadeA = Math.max(0, FX.fadeA - rel / fadeDur);
    for (let i = 0; i < agg.length; i++) {
      const a = agg[i];
      if (a.id === null) continue;
      a.t -= el;
      if (a.t <= 0) flushAgg(a);
    }
  };
  const COIN_EV = { x: 0, y: 0 };

  // ---------------------------------------------------------------- dessin
  FX.drawRings = function (g) {
    const items = rings.items;
    for (let i = 0; i < items.length; i++) {
      const r = items[i];
      if (!r.alive) continue;
      const k = 1 - r.life / r.max;
      const rad = r.r0 + (r.r1 - r.r0) * U.easeOutCubic(k);
      if (r.glow) {
        g.globalCompositeOperation = "lighter"; g.globalAlpha = (1 - k) * 0.9;
        const s = rad / 0.82;
        g.drawImage(ringSprite(r.color), r.x - s, r.y - s, s * 2, s * 2);
        g.globalCompositeOperation = "source-over";
      }
      g.globalAlpha = (1 - k) * 0.9;
      g.strokeStyle = r.color; g.lineWidth = Math.max(0.5, r.w * (1 - k * 0.7));
      g.beginPath(); g.arc(r.x, r.y, Math.max(0.1, rad), 0, TAU); g.stroke();
    }
    g.globalAlpha = 1;
  };
  FX.drawn = 0; // bits : 1 particules, 2 bannières — posés quand un écran dessine lui-même les FX (voir Render.draw)
  FX.drawParticles = function (g) {
    FX.drawn |= 1;
    const items = parts.items, n = items.length;
    // passe 1 : halos additifs
    g.globalCompositeOperation = "lighter";
    for (let i = 0; i < n; i++) {
      const p = items[i];
      if (!p.alive || !p.glow) continue;
      const k = p.life / p.max;
      g.globalAlpha = Math.min(p.a, k * 1.3) * 0.55;
      const s = p.size * (p.kind === 2 ? 3.2 : 4.5);
      g.drawImage(FX.glow(p.color), p.x - s, p.y - s, s * 2, s * 2);
    }
    g.globalCompositeOperation = "source-over";
    // passe 2 : formes
    for (let i = 0; i < n; i++) {
      const p = items[i];
      if (!p.alive) continue;
      const k = p.life / p.max;
      const a = Math.min(p.a, k * 1.3);
      g.globalAlpha = a;
      g.fillStyle = p.color;
      const x = p.x, y = p.y;
      switch (p.kind) {
        case 1: { // éclat : triangle tournant
          const c = Math.cos(p.rot), s = Math.sin(p.rot), z = p.size * 1.3;
          g.beginPath();
          g.moveTo(x + c * z, y + s * z);
          g.lineTo(x - c * z * 0.6 - s * z * 0.7, y - s * z * 0.6 + c * z * 0.7);
          g.lineTo(x - c * z * 0.6 + s * z * 0.7, y - s * z * 0.6 - c * z * 0.7);
          g.closePath(); g.fill();
          break;
        }
        case 2: { // pièce
          g.globalAlpha = 1;
          const w = Math.abs(Math.cos(p.rot * 0.5)) * 0.7 + 0.3; // rotation de la pièce
          g.beginPath(); g.ellipse(x, y, 2.8 * w, 2.8, 0, 0, TAU); g.fill();
          g.fillStyle = "#fff3c4"; g.beginPath(); g.arc(x - 0.7 * w, y - 0.8, 0.9, 0, TAU); g.fill();
          break;
        }
        case 3: // fumée
          g.globalAlpha = a * 0.55;
          g.beginPath(); g.arc(x, y, p.size * (1.7 - k * 0.9), 0, TAU); g.fill();
          break;
        case 4: { // paillette à 4 branches
          const s = p.size * (1.2 + 0.8 * Math.sin(p.rot * 2)) * (0.4 + 0.6 * k);
          g.beginPath();
          g.moveTo(x, y - s * 2); g.quadraticCurveTo(x, y, x + s * 2, y); g.quadraticCurveTo(x, y, x, y + s * 2);
          g.quadraticCurveTo(x, y, x - s * 2, y); g.quadraticCurveTo(x, y, x, y - s * 2);
          g.fill();
          break;
        }
        case 5: { // trait de vitesse
          const sp = Math.hypot(p.vx, p.vy) || 1, l = Math.min(14, sp * 0.035);
          g.strokeStyle = p.color; g.lineWidth = p.size * k;
          g.beginPath(); g.moveTo(x, y); g.lineTo(x - p.vx / sp * l, y - p.vy / sp * l); g.stroke();
          break;
        }
        case 7: // note ♪
          g.font = font(800, p.size); g.textAlign = "center"; g.textBaseline = "middle";
          g.fillText("♪", x, y);
          break;
        default:
          g.beginPath(); g.arc(x, y, p.size * (0.45 + 0.55 * k), 0, TAU); g.fill();
      }
    }
    g.globalAlpha = 1;
  };
  FX.drawBolts = function (g) {
    const items = bolts.items;
    g.lineJoin = "round"; g.lineCap = "round";
    for (let i = 0; i < items.length; i++) {
      const b = items[i];
      if (!b.alive) continue;
      const k = b.life / b.max;
      for (let pass = 0; pass < 3; pass++) {
        g.globalAlpha = (pass === 0 ? 0.28 : pass === 1 ? 0.9 : 1) * k;
        g.strokeStyle = pass === 2 ? "#ffffff" : b.color;
        g.lineWidth = pass === 0 ? 7 : pass === 1 ? 2.6 : 1;
        if (pass === 0) g.globalCompositeOperation = "lighter";
        g.beginPath(); g.moveTo(b.pts[0], b.pts[1]);
        for (let j = 2; j < 18; j += 2) g.lineTo(b.pts[j], b.pts[j + 1]);
        g.stroke();
        if (pass === 0) g.globalCompositeOperation = "source-over";
      }
      // impact
      g.globalCompositeOperation = "lighter"; g.globalAlpha = k * 0.8;
      g.drawImage(FX.glow(b.color), b.x2 - 16, b.y2 - 16, 32, 32);
      g.globalCompositeOperation = "source-over";
    }
    g.globalAlpha = 1; g.lineJoin = "miter"; g.lineCap = "butt";
  };
  FX.drawBeams = function (g) {
    const items = beams.items;
    for (let i = 0; i < items.length; i++) {
      const b = items[i];
      if (!b.alive) continue;
      const k = b.life / b.max, e = k * k * (3 - 2 * k);
      const dx = b.x2 - b.x1, dy = b.y2 - b.y1, L = Math.sqrt(dx * dx + dy * dy) || 1;
      const w = b.w * (1 + 0.8 * (1 - k));
      g.save(); g.translate(b.x1, b.y1); g.rotate(Math.atan2(dy, dx));
      g.globalCompositeOperation = "lighter";
      g.globalAlpha = 0.9 * e;
      g.drawImage(FX.glow(b.color), -w, -w * 1.6, L + w * 2, w * 3.2);
      g.globalAlpha = 0.8 * e;
      g.drawImage(FX.glow(b.color), -w * 0.5, -w * 0.6, L + w, w * 1.2);
      g.globalCompositeOperation = "source-over";
      g.globalAlpha = e; g.fillStyle = "#ffffff";
      g.fillRect(0, -Math.max(0.6, b.w * 0.09), L, Math.max(1.2, b.w * 0.18));
      g.restore();
    }
    g.globalAlpha = 1;
  };
  FX.drawFloats = function (g) {
    const items = floats.items;
    g.textAlign = "center"; g.textBaseline = "middle"; g.lineJoin = "round";
    for (let i = 0; i < items.length; i++) {
      const f = items[i];
      if (!f.alive) continue;
      const age = f.max - f.life, k = age / f.max;
      const y = f.y - f.rise * U.easeOutCubic(Math.min(1, k * 1.25));
      const pk = Math.max(0, 1 - age / 0.12);
      const s = 1 + 0.55 * pk * pk;
      g.globalAlpha = k > 0.7 ? (1 - k) / 0.3 : 1;
      g.font = font(f.weight, f.size);
      g.save(); g.translate(f.x, y); g.scale(s, s);
      if (f.bg) {
        if (f.w < 0) f.w = g.measureText(f.text).width + 8;
        g.fillStyle = f.bg; roundRect(g, -f.w / 2, -f.size * 0.62, f.w, f.size * 1.24, 4); g.fill();
      } else {
        g.lineWidth = 3.2; g.strokeStyle = "rgba(5,6,12,0.88)"; g.strokeText(f.text, 0, 0);
      }
      g.fillStyle = f.color; g.fillText(f.text, 0, 0);
      g.restore();
    }
    g.globalAlpha = 1; g.lineJoin = "miter";
  };
  FX.drawBanners = function (g) {
    FX.drawn |= 2;
    const items = banners.items;
    g.textAlign = "center"; g.textBaseline = "middle"; g.lineJoin = "round";
    for (let i = 0; i < items.length; i++) {
      const b = items[i];
      if (!b.alive) continue;
      const age = b.max - b.life, k = age / b.max;
      const inK = U.clamp(age / 0.2, 0, 1);
      const s = 0.4 + 0.6 * U.easeOutBack(inK);
      const alpha = k > 0.75 ? (1 - k) / 0.25 : 1;
      g.font = font(900, b.size);
      if (b.w < 0) b.w = g.measureText(b.text).width + (b.icon ? b.size * 1.3 : 0);
      const half = b.w / 2 + 8;
      // bornes : l'écran, et pour les réactions les murs du bocal (jamais sur la jauge de remplissage)
      const lo = Math.max(half, b.minX + b.w / 2), hi = Math.min(D.W - half, b.maxX - b.w / 2);
      const x = lo <= hi ? U.clamp(b.x, lo, hi) : (lo + hi) / 2;
      const y = b.y - k * 10;
      // plaque sombre douce : la bannière reste lisible au-dessus des Ombres, badges et étoiles
      {
        const pw = (b.w + 40) * s, ph = (b.size * 1.55 + (b.sub ? 14 : 0)) * s, py = y + (b.sub ? 6 : 0) * s;
        g.globalAlpha = alpha * 0.42; g.fillStyle = "#05070f"; FX.roundRect(g, x - pw / 2 - 6, py - ph / 2 - 4, pw + 12, ph + 8, (ph + 8) / 2); g.fill();
        g.globalAlpha = alpha * 0.5; FX.roundRect(g, x - pw / 2, py - ph / 2, pw, ph, ph / 2); g.fill();
      }
      g.globalAlpha = alpha;
      // lueur derrière le texte
      g.globalCompositeOperation = "lighter"; g.globalAlpha = alpha * 0.4 * (1 + 0.6 * (1 - inK));
      g.drawImage(FX.glow(b.color), x - b.w * 0.75, y - b.size * 1.1, b.w * 1.5, b.size * 2.2);
      g.globalCompositeOperation = "source-over"; g.globalAlpha = alpha;
      g.save(); g.translate(x, y); g.scale(s, s);
      let tx = 0;
      if (b.icon && BE.Render && BE.Render.drawReactionIcon) {
        tx = b.size * 0.65;
        BE.Render.drawReactionIcon(b.icon, -b.w / 2 + b.size * 0.5, 0, b.size * 1.05);
        g.font = font(900, b.size); g.textAlign = "center"; g.textBaseline = "middle";
      }
      g.lineWidth = Math.max(4, b.size * 0.22); g.strokeStyle = "rgba(5,6,12,0.92)"; g.strokeText(b.text, tx, 0);
      g.fillStyle = b.color; g.fillText(b.text, tx, 0);
      g.fillStyle = "rgba(255,255,255,0.35)"; g.fillText(b.text, tx, -1);
      if (b.sub) {
        g.font = font(700, 11);
        g.lineWidth = 3; g.strokeText(b.sub, 0, b.size * 0.78);
        g.fillStyle = "#eef2ff"; g.fillText(b.sub, 0, b.size * 0.78);
      }
      g.restore();
    }
    g.globalAlpha = 1; g.lineJoin = "miter";
  };
  FX.drawFlash = function (g) {
    if (FX.flashA > 0.001) {
      g.globalAlpha = Math.min(1, FX.flashA);
      g.fillStyle = FX.flashColor; BE.Render.fillScreen(g);
      g.globalAlpha = 1;
    }
    if (FX.fadeA > 0.001) {
      g.globalAlpha = Math.min(1, FX.fadeA * FX.fadeA * (3 - 2 * FX.fadeA));
      g.fillStyle = FX.fadeColor; BE.Render.fillScreen(g);
      g.globalAlpha = 1;
    }
  };

  function roundRect(g, x, y, w, h, r) {
    r = Math.max(0, Math.min(r, w / 2, h / 2));
    g.beginPath();
    g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
  }
  FX.roundRect = roundRect;

  // ================================================================ réactions aux événements (juice, §11.3)
  const GOLD_POS = { x: 284, y: 22 };
  const GAUGE_POS = { x: 180, y: 27 };
  FX.GOLD_POS = GOLD_POS; FX.GAUGE_POS = GAUGE_POS;
  function fam(c) { return (D.FAMILIES[c] && D.FAMILIES[c].color) || "#eef2ff"; }
  function inGame() { const st = BE.state; return st && st.run && BE.Run && BE.Run.IN_GAME[st.scene]; }

  const STACK = { stack: true };
  BE.on("peg", (e) => {
    const special = e.peg && e.peg.kind === "special" && e.peg.clou;
    if (e.eclat > 0) FX.float(e.x, e.y - 9, "+" + e.eclat, P.eclat, e.eclat > 1 ? 11 : 10, STACK);
    if (e.mult > 0) FX.float(e.x + 8, e.y - 20, "+" + e.mult, P.mult, 11, STACK);
    if (e.dark) { FX.burst(e.x, e.y, 3, { speed: 40, color: P.pegOff, kind: 3, size: 3, life: 0.4, g: -20 }); return; }
    FX.burst(e.x, e.y, 3, { speed: 80, color: "#e6ecff", life: 0.25, size: 1.2, glow: true, kind: 5 });
    if (special) {
      const col = (e.peg.clou.type === "teint" && e.peg.clou.color) ? fam(e.peg.clou.color) : (D.CLOUS[e.peg.clou.type] || {}).color || "#fff";
      FX.ring(e.x, e.y, 6, 20, col, 0.3, 2, true);
      FX.sparkle(e.x, e.y, 4, col, 90, 0.45);
    }
    // notes montantes : la gamme grimpe avec le rang du contact
    const k = e.k || 0;
    if (k >= 2) {
      const hue = k >= 10 ? P.or : k >= 5 ? P.frag : "#cfe0ff";
      FX.particle(e.x + (rnd() - 0.5) * 8, e.y - 6, { kind: 7, color: hue, angle: -Math.PI / 2, spread: 0.6, speed: 26 + k * 2, drag: 1.4,
        life: 0.7, size: Math.min(15, 8 + k * 0.5), alpha: 0.75 });
    }
  });
  BE.on("wall", (e) => {
    const r = e.star ? e.star.r : 14;
    const x = e.x + (e.side === "L" ? -r : e.side === "R" ? r : 0), y = e.y - (e.side === "T" ? r : 0);
    const a = e.side === "L" ? 0 : e.side === "R" ? Math.PI : Math.PI / 2;
    FX.burst(x, y, 5, { angle: a, spread: 1.8, speed: 90, color: "#cdb8ff", life: 0.3, size: 1.3, kind: 5 });
  });
  BE.on("hit", (e) => {
    const x = e.target.dispX !== undefined ? e.target.dispX : e.x, y = e.target.dispY !== undefined ? e.target.dispY : e.y;
    FX.burst(x, y, 4, { speed: 120, color: P.ombreLine, kind: 1, size: 2, life: 0.4, drag: 3, glow: true });
    if (e.eclat) FX.float(x - 14, y - 22, "+" + e.eclat, P.eclat, 11);
    FX.ring(x, y, e.target.r * 0.8, e.target.r * 1.5, P.ombreLine, 0.2, 2);
    FX.stop(0.02);
    e.target.squashT = now();
  });
  BE.on("damage", (e) => {
    aggDamage(e.target, e.dmg);
    if (e.blocked) {
      FX.float(e.x, e.y - 26, "ARMURE", P.dim, 9, { life: 0.55, weight: 900 });
      FX.ring(e.x, e.y, 20, 26, "#8f86c8", 0.25, 3);
      FX.burst(e.x, e.y, 5, { speed: 110, color: "#cfd3ff", kind: 5, life: 0.25, size: 1.2 });
    }
    e.target.hurtT = now();
  });
  BE.on("kill", (e) => {
    const x = e.x, y = e.y, boss = e.type === "boss";
    FX.burst(x, y, boss ? 20 : 8, { speed: boss ? 70 : 40, color: "#2a2144", kind: 3, size: boss ? 10 : 6, life: 0.8, drag: 1.5, g: -30, alpha: 0.9 });
    FX.burst(x, y, boss ? 24 : 7, { speed: boss ? 220 : 130, color: P.ombreLine, size: 1.6, life: 0.45, glow: true });
    FX.ring(x, y, 6, boss ? 90 : 34, P.ombreLine, boss ? 0.5 : 0.3, 2.5, true);
    FX.suck(x, y, 2, GOLD_POS.x, GOLD_POS.y, P.or, true, 1.0);
    FX.stop(0.03); FX.shake(1, 0.12);
    if (boss) {
      FX.stop(0.14); FX.shake(5, 0.45); FX.flash(0.45, "#ffffff", 0.05); FX.vibrate([30, 20, 30]);
      const bd = e.target.bossId && D.BOSSES[e.target.bossId];
      FX.after(0.12, () => {
        FX.banner("BOSS VAINCU", 180, 200, P.or, 24, 1.6, "+" + D.BOSS.gold + " or · règle levée");
        FX.sparkle(x, y, 18, P.or, 220, 0.9);
        FX.ring(x, y, 20, 160, bd ? bd.color : P.or, 0.7, 4, true);
      });
    }
  });
  BE.on("land", (e) => {
    const r = e.body.r;
    FX.burst(e.x, e.y + r * 0.5, 3, { speed: 85, color: "#dfe6ff", life: 0.3, size: 1.4, glow: true, angle: -Math.PI / 2, spread: 1.6 });
    FX.ring(e.x, e.y, r * 0.8, r * 1.4, "#dfe6ff", 0.2, 1.5);
  });
  BE.on("merge", (e) => {
    const col = fam(e.color);
    const r = D.SIZES[e.size].r;
    FX.ring(e.x, e.y, r, r * 2, e.pure ? "#ffffff" : col, 0.25, 2.5, e.size >= 4);
    if (e.mult > 0) {
      FX.float(e.x, e.y - r - 6, "+" + U.fmtDec(e.mult) + (e.orphan ? " réserve" : ""), P.mult, Math.min(16, 11 + e.size * 0.8),
        { life: 0.85, rise: 18, weight: 900, stack: true });
    }
    if (e.body) e.body.squashT = now();
    const big = e.size >= 5;
    FX.burst(e.x, e.y, big ? 12 : 5, { speed: 90 + e.size * 18, color: col, life: 0.5, size: 2, glow: true });
    FX.sparkle(e.x, e.y, big ? 5 : 2, e.pure ? "#ffffff" : col, 70 + e.size * 12, 0.55);
    if (big) {
      FX.stop(0.06); FX.shake(Math.min(6, 1.5 * (e.size - 3)), 0.2); FX.vibrate(15);
      FX.ring(e.x, e.y, r * 0.5, r * 3, col, 0.4, 3, true);
    }
    if (e.size >= 7) { // Trou Noir : aspiration
      for (let i = 0; i < 18; i++) {
        const a = rnd() * TAU, d = 50 + rnd() * 40;
        FX.particle(e.x + Math.cos(a) * d, e.y + Math.sin(a) * d, { kind: 6, color: P.frag, tx: e.x, ty: e.y, speed: 60, life: 0.6, drag: 0, glow: true, size: 1.6 });
      }
    }
    if (e.pure) FX.float(e.x, e.y + 8, "PURE", "#ffffff", 9, { life: 0.65, rise: 6, weight: 900 });
  });
  BE.on("reaction", (e) => {
    const R = D.REACTIONS[e.id];
    // réactions en chaîne : chaque bannière encore lisible repousse la nouvelle d'une ligne vers le haut
    let y = Math.max(372, e.y - 34);
    for (let guard = 0; guard < 6; guard++) {
      let hit = false;
      for (const q of banners.items) if (q.alive && q.kind === "reaction" && q.life > 0.2 && Math.abs(q.y - y) < 23) { y = q.y - 24; hit = true; }
      if (!hit) break;
    }
    const J = BE.state && BE.state.run && BE.state.run.jar;
    FX.banner(e.nom.toUpperCase(), e.x, y, e.color, 17, 1.2, "", e.id, { kind: "reaction", minX: J ? J.wallL - 8 : 0, maxX: J ? J.wallR - 4 : D.W });
    FX.beam(e.x, e.y, e.x, y + 10, e.color, 6, 0.45);
    FX.ring(e.x, e.y, 10, 72, e.color, 0.45, 3, true);
    FX.burst(e.x, e.y, 14, { speed: 170, color: e.color, life: 0.6, size: 2, glow: true });
    if (R && R.pair) { FX.burst(e.x, e.y, 6, { speed: 120, color: fam(R.pair[0]), life: 0.5, glow: true }); FX.burst(e.x, e.y, 6, { speed: 120, color: fam(R.pair[1]), life: 0.5, glow: true }); }
    FX.stop(0.04); FX.shake(2, 0.18); FX.vibrate(10);
    if (e.id === "vapeur") {
      FX.burst(e.x, e.y, 10, { speed: 60, color: "#dfe8ff", kind: 3, size: 7, life: 0.9, g: -50, drag: 1.2, alpha: 0.5 });
      FX.kick(0, 3);
    } else if (e.id === "tempete") FX.sparkle(180, 200, 16, "#b6f0ff", 160, 0.8);
    else if (e.id === "photosynthese") FX.suck(e.x, e.y, 6, G.phare.x, G.phare.y, "#d8ff6a", false, 0.9);
  });
  BE.on("plasma", (e) => {
    FX.beam(e.x, 336, e.x, 92, "#ff9d3d", 12, 0.55);
    FX.bolt(e.x, 336, e.x, 96, "#ffcf6a");
    for (let y = 100; y < 330; y += 18) FX.particle(e.x + (rnd() - 0.5) * 12, y, { speed: 40, color: "#ff9d3d", life: 0.5, size: 2, glow: true });
    FX.shake(2.5, 0.2);
  });
  BE.on("explosion", (e) => {
    FX.ring(e.x, e.y, 6, e.r, P.braise, 0.32, 3, true);
    FX.burst(e.x, e.y, 12, { speed: 170, color: P.braise, life: 0.45, glow: true });
    FX.burst(e.x, e.y, 5, { speed: 50, color: "#5a2a1a", kind: 3, size: 6, life: 0.7, g: -30, alpha: 0.6 });
    FX.shake(1.5, 0.15);
  });
  BE.on("stone", (e) => {
    FX.burst(e.x, e.y, 6, { speed: 140, color: "#6a7090", kind: 1, size: 3, life: 0.6, g: 380, drag: 1 });
    FX.burst(e.x, e.y, 4, { speed: 40, color: "#3a4058", kind: 3, size: 5, life: 0.5, g: -20, alpha: 0.6 });
    FX.float(e.x, e.y - 10, "+" + D.STONE_MULT, P.mult, 13, { life: 0.75, weight: 900 });
    FX.ring(e.x, e.y, e.r * 0.6, e.r * 1.6, "#9aa0c0", 0.25, 2);
    FX.stop(0.03); FX.shake(2, 0.15);
  });
  BE.on("stoneDrop", (e) => { FX.burst(e.x, e.y, 5, { speed: 50, color: "#4a5068", kind: 3, size: 4, life: 0.5, alpha: 0.6 }); });
  BE.on("shadowFall", (e) => {
    FX.burst(e.x, e.y, 6, { speed: 50, color: "#2a2144", kind: 3, size: 6, life: 0.6, g: 40, alpha: 0.8 });
    FX.beam(e.x, e.y, e.x, D.GEOM.flightToJar, P.ombreLine, 4, 0.35);
  });
  BE.on("spawn", (e) => {
    const t = e.target;
    if (!t) return;
    FX.burst(t.x, t.y, 7, { speed: 45, color: "#2a2144", kind: 3, size: 6, life: 0.55, alpha: 0.7 });
    FX.ring(t.x, t.y, 28, 10, P.ombreLine, 0.35, 1.5);
  });
  BE.on("bigbang", (e) => {
    FX.bigBangT = now();
    FX.flash(1, "#ffffff", 0.12, 7); FX.stop(0.3); FX.shake(8, 0.4); FX.vibrate([40, 30, 40]);
    FX.after(0.3, () => { // après le silence : onde blanche
      FX.ring(e.x, e.y, 10, 460, "#ffffff", 1.0, 6, true);
      FX.ring(e.x, e.y, 4, 300, P.frag, 0.8, 3, true);
      FX.banner("BIG BANG ×10", 180, 300, "#ffffff", 32, 2.4, "L'univers recommence");
      FX.burst(e.x, e.y, 50, { speed: 360, color: "#ffffff", life: 1, glow: true, size: 2 });
      const cols = D.FAMILY_ORDER;
      for (let i = 0; i < 4; i++) FX.burst(e.x, e.y, 10, { speed: 260, color: fam(cols[i]), life: 1.1, glow: true, size: 2 });
      FX.sparkle(e.x, e.y, 20, P.frag, 280, 1.2);
    });
  });
  BE.on("gold", (e) => {
    FX.float(e.x, e.y - 14, "+" + e.n + " or", P.or, 11, { life: 0.85, weight: 900 });
    FX.suck(e.x, e.y, Math.min(6, e.n), GOLD_POS.x, GOLD_POS.y, P.or, true, 1.1);
  });
  BE.on("bonus", (e) => { if (e.n) FX.float(e.x, e.y - 8, "+" + e.n, e.kind === "eclat" ? P.eclat : P.mult, 12, { life: 0.7, weight: 900 }); });
  BE.on("bolt", (e) => {
    FX.bolt(e.x1, e.y1, e.x2, e.y2, P.foudre);
    FX.burst(e.x2, e.y2, 6, { speed: 130, color: P.foudre, glow: true, life: 0.3, kind: 5 });
    FX.burst(e.x1, e.y1, 3, { speed: 60, color: P.foudre, glow: true, life: 0.25 });
    FX.shake(1, 0.08);
  });
  BE.on("freeze", (e) => {
    FX.burst(e.x, e.y, 6, { speed: 80, color: P.givre, kind: 1, size: 1.6, life: 0.5, glow: true });
    FX.sparkle(e.x, e.y, 3, "#e8fbff", 50, 0.6);
    FX.ring(e.x, e.y, 26, 18, P.givre, 0.3, 2);
  });
  BE.on("thaw", (e) => { const t = e.target; if (t) FX.burst(t.x, t.y + 10, 4, { speed: 20, angle: Math.PI / 2, spread: 1, color: P.givre, life: 0.5, g: 120, size: 1.4 }); });
  BE.on("burn", (e) => { FX.burst(e.target.x, e.target.y, 6, { speed: 60, color: P.braise, life: 0.45, glow: true, g: -90 }); });
  BE.on("burnTick", (e) => {
    FX.burst(e.x, e.y, 7, { speed: 50, color: P.braise, life: 0.55, glow: true, g: -110 });
    FX.burst(e.x, e.y, 3, { speed: 30, color: "#ffd08a", life: 0.4, glow: true, g: -60, size: 1.2 });
  });
  BE.on("absorb", (e) => {
    FX.ring(e.x, e.y, 34, 4, P.ombreLine, 0.35, 3, true);
    FX.banner("VOLÉE !", e.x, e.y - 30, P.ombreLine, 14, 0.9);
    if (e.star) for (let i = 0; i < 10; i++) {
      const a = rnd() * TAU;
      FX.particle(e.x + Math.cos(a) * 30, e.y + Math.sin(a) * 30, { kind: 6, color: fam(e.star.color), tx: e.x, ty: e.y, speed: 40, life: 0.45, drag: 0, glow: true });
    }
  });
  BE.on("bonusShot", (e) => { FX.banner("+1 TIR", e.x, e.y - 20, P.or, 16, 1); FX.sparkle(e.x, e.y, 8, "#fff3a0", 120, 0.7); });
  BE.on("launch", (e) => {
    FX.launchT = now();
    const col = e.star ? fam(e.star.color) : "#eef2ff";
    FX.ring(e.x, e.y, 18, 40, "#eef2ff", 0.28, 2, true);
    FX.burst(e.x, e.y, 8, { speed: 110, color: col, life: 0.32, glow: true, kind: 5, angle: e.angle !== undefined ? e.angle * Math.PI / 180 : Math.PI / 2, spread: 1.2 });
    FX.shake(1, 0.08);
  });
  BE.on("swap", () => { FX.swapT = now(); FX.sparkle(G.swapBtn.x, G.swapBtn.y, 4, "#eef2ff", 60, 0.4); FX.sparkle(G.phare.x, G.phare.y, 4, "#eef2ff", 60, 0.4); });
  BE.on("split", (e) => {
    const cols = ["#ff6b3d", "#ffe14d", "#6ee07a", "#5ee7ff", "#c7a6ff"];
    for (let i = 0; i < cols.length; i++) FX.burst(e.x, e.y, 3, { speed: 120, color: cols[i], life: 0.45, glow: true, kind: 5 });
    FX.ring(e.x, e.y, 8, 30, "#ffffff", 0.25, 2);
  });
  BE.on("grow", (e) => { FX.ring(e.x, e.y, 10, 42, P.seve, 0.32, 2, true); FX.float(e.x, e.y - 22, "GROSSIT", P.seve, 10, { weight: 900 }); FX.sparkle(e.x, e.y, 5, P.seve, 90, 0.5); });
  BE.on("ronce", (e) => { FX.burst(e.x, e.y, 8, { speed: 70, color: "#a0ffd0", kind: 1, size: 1.6, life: 0.5, glow: true }); FX.ring(e.x, e.y, 4, 18, "#a0ffd0", 0.3, 2); });
  BE.on("reserve", (e) => { FX.float(180, 104, "+" + U.fmtDec(e.n) + " en réserve", P.mult, 11, { life: 1.2, rise: 8, weight: 900 }); });
  BE.on("evaporate", (e) => {
    FX.burst(e.x, e.y, 10, { speed: 60, color: "#dfe6ff", kind: 3, size: 5, life: 0.8, g: -50, alpha: 0.55 });
    FX.sparkle(e.x, e.y, 3, "#ffffff", 40, 0.6);
  });
  BE.on("devour", (e) => { FX.banner("DÉVORÉE", e.x, e.y - 20, "#ff7a9a", 16, 1); FX.ring(e.x, e.y, 44, 2, "#ff7a9a", 0.4, 3, true); FX.shake(2, 0.2); });
  // dans le ciel (comme « BOSS VAINCU ») : ni la pastille ×3 ni l'indice « Maintiens » ne la recouvrent
  BE.on("candle", () => { FX.banner("LA BOUGIE S'ÉTEINT", 180, 300, P.or, 18, 1.8, "Les étoiles au-dessus de l'horizon s'évaporent"); FX.flash(0.3, P.or); });
  BE.on("trim", (e) => { FX.banner("TROP-PLEIN ÉVAPORÉ", 180, 300, "#dfe6ff", 16, 1.6, "Le quota éteint ce qui dépasse l'horizon"); });
  BE.on("squeeze", () => { FX.shake(2, 0.3); });
  BE.on("horloge", () => { FX.banner("L'HORLOGE RETIENT LES OMBRES", 180, 150, P.frag, 13, 1.3); });
  BE.on("lay", (e) => { if (e.from && e.to) FX.beam(e.from.x, e.from.y, e.to.x, e.to.y, P.ombreLine, 3, 0.3); });
  BE.on("heart", () => { FX.dangerT = now(); });
  BE.on("overflow", (e) => {
    FX.stop(0.2); FX.shake(4, 0.45); FX.kick(0, 5); FX.vibrate(60);
    FX.flash(0.25, P.danger, 0.05, 3);
    FX.banner("DÉBORDEMENT", 180, 214, P.danger, 28, 2.2); // au-dessus de la légende de défaite de 13_ui (y ≈ 300)
    if (e.bodies) for (let i = 0; i < e.bodies.length; i++) FX.ring(e.bodies[i].x, e.bodies[i].y, e.bodies[i].r, e.bodies[i].r * 1.8, P.danger, 0.5, 2.5, true);
  });
  BE.on("quota", () => {
    FX.vibrate(20);
    FX.gaugeT = now();
    for (let i = 0; i < 30; i++) {
      FX.particle(180 + (rnd() - 0.5) * 320, 30 + rnd() * 40, { speed: 30, angle: Math.PI / 2, spread: 0.6, color: P.or, life: 1.5, g: 110, size: 1.8,
        glow: true, kind: i % 2 ? 4 : 1, drag: 1 });
    }
    FX.ring(GAUGE_POS.x, GAUGE_POS.y, 8, 110, P.or, 0.6, 3, true);
    FX.banner("QUOTA ATTEINT", 180, 250, P.or, 26, 1.7);
  });
  BE.on("convert", (e) => {
    FX.burst(e.x, e.y, 8, { speed: 45, color: "#ffcf6a", size: 2.4, life: 0.7, g: -30, glow: true, alpha: 0.7 });
    FX.ring(e.x, e.y, 6, 26, P.or, 0.35, 2, true);
    FX.suck(e.x, e.y, 5, GAUGE_POS.x, GAUGE_POS.y, P.or, false, 0.9);
    FX.sparkle(e.x, e.y, 3, "#fff3c4", 60, 0.5);
  });
  // §11.4 : décompte de l'or, une pièce par or (et un « tic » à l'arrivée, voir 03_audio)
  BE.on("reward", (R) => {
    if (!R) return;
    const lines = [R.night || 0, R.shots || 0, R.interest || 0];
    let d = 0.12;
    for (let li = 0; li < 3; li++) {
      const n = Math.min(12, lines[li]);
      for (let i = 0; i < n; i++) {
        FX.after(d + 0.15 * li, (yy) => { if (inGame()) FX.suck(270, yy, 1, GOLD_POS.x, GOLD_POS.y, P.or, true, 0.7); }, 462 + li * 20);
        d += 0.05;
      }
    }
  });
  BE.on("vidange", (e) => {
    const run = BE.state.run;
    if (!run || !e.n) return;
    let k = 0;
    for (const b of run.jar.bodies) {
      if (b.stone || b.size < D.ECO.vidangeMinSize || k >= e.n) continue;
      const bx = b.x, by = b.y;
      FX.after(0.25 + k * 0.12, () => { FX.suck(bx, by, 1, GOLD_POS.x, GOLD_POS.y, P.or, true, 0.8); FX.sparkle(bx, by, 3, P.or, 80, 0.5); });
      k++;
    }
  });
  BE.on("victory", () => {
    const cols = [P.or, P.frag, P.braise, P.givre, P.seve, P.foudre];
    for (let i = 0; i < 9; i++) {
      FX.after(0.1 + i * 0.22, (j) => {
        const x = 50 + rnd() * 260, y = 120 + rnd() * 260, c = cols[j % cols.length];
        FX.burst(x, y, 24, { speed: 200, color: c, life: 0.9, glow: true, g: 120, size: 1.8 });
        FX.sparkle(x, y, 6, "#ffffff", 150, 0.8);
        FX.ring(x, y, 4, 60, c, 0.5, 2, true);
      }, i);
    }
    FX.flash(0.3, P.or);
  });
  BE.on("count:relic", (e) => {
    const x = D.GEOM.relicX[e.slot] || 180;
    const col = e.st && e.st.xMult ? P.mult : e.st && e.st.dEclat ? P.eclat : P.mult;
    FX.burst(x, 628, 7, { speed: 90, color: col, life: 0.35, glow: true, angle: -Math.PI / 2, spread: 2.2 });
    FX.ring(x, BE.Render.relicY ? BE.Render.relicY() : 627, 10, 22, col, 0.25, 2);
  });
  BE.on("count:final", (e) => {
    if (e.st && e.st.src === "aurore") FX.auroraT = now();
    FX.shake(1.5, 0.12);
  });
  BE.on("count:clash", () => {
    FX.burst(180, G.liveY, 18, { speed: 220, color: "#ffffff", life: 0.4, glow: true, kind: 5 });
    FX.burst(180, G.liveY, 6, { speed: 120, color: P.eclat, life: 0.35, glow: true });
    FX.burst(180, G.liveY, 6, { speed: 120, color: P.mult, life: 0.35, glow: true });
    FX.ring(180, G.liveY, 6, 60, "#ffffff", 0.3, 2.5, true);
    FX.shake(2, 0.15);
  });
  BE.on("count:total", (e) => { if (e.high) { FX.flash(0.15, "#ffffff"); FX.sparkle(180, G.liveY, 10, P.or, 160, 0.7); } });
  BE.on("shotScored", () => {
    FX.gaugeT = now();
    FX.ring(GAUGE_POS.x, GAUGE_POS.y, 6, 60, P.or, 0.35, 2, true);
  });
  // Nuit Blanche (09_run.startNuitBlanche) : la nuit reprend après la victoire
  BE.on("nuitBlanche", () => {
    FX.banner("NUIT BLANCHE", 180, 250, P.frag, 26, 1.8, "Les Lunes ne s'arrêtent plus");
    FX.ring(180, 250, 20, 180, P.frag, 0.7, 3, true);
    FX.sparkle(180, 250, 26, P.frag, 200, 1.1);
    FX.flash(0.2, P.frag);
  });
  BE.on("scene", (e) => {
    if (e.to === "TITLE" || e.to === "NIGHT_INTRO") FX.clear();
    // fondu de l'Aube vers la nuit (les écrans de menu ont leur propre fondu d'entrée dans 13_ui ; la sortie de
    // NIGHT_WON / VIDANGE vers l'Aube est un voile dessiné par Render.drawGame, §11.4)
    if (e.from === "SHOP" && e.to === "NIGHT_INTRO") FX.fade(0.3);
  });
})(window.BE = window.BE || {});
