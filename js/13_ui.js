/* 13_ui.js — BE.UI : écrans (§10) — titre, sélection (repli), intro de nuit, HUD complémentaire, nuit gagnée, Vidange,
   Aube (cartes, relance, verrou, vente, glisser-déposer aimanté des reliques, aperçu chiffré), pause, réglages,
   fin de run ; widgets (bouton, interrupteur, curseur, segments), panneaux, bulles d'onboarding (§10.9), focus clavier.
   Mode immédiat : chaque image dessine et ENREGISTRE ses régions cliquables ; les clics utilisent l'image précédente. */
(function (BE) {
  "use strict";

  const UI = (BE.UI = {});
  const D = BE.DATA, G = D.GEOM, P = D.PAL, U = BE.util;
  const TAU = Math.PI * 2;
  let g = null;

  /** Régions cliquables de la dernière image : {id,x,y,w,h,onTap,focus,adjust?,slider?} */
  let regions = [], building = [];
  UI.focus = -1;      // index de focus clavier (parmi les régions focusables)
  UI.panel = null;    // panneau modal : {type:"bag"|"relics"|"settings"|…, t, dismiss?}
  UI.toastMsg = null;
  UI.pressId = null;  // région sous le doigt (retour visuel « enfoncé »)
  UI.hoverId = null;  // région sous la souris (desktop)
  UI.sel = null;      // sélection en boutique : {kind:"offer"|"relic", i, t}
  UI.gardienIdx = 0;
  UI.confirm = null;  // id de bouton en attente de confirmation
  UI.drag = null;     // glisser-déposer d'une relique (Aube)
  UI.slide = null;    // curseur de réglage en cours de glissement
  UI.sceneAt = 0;     // temps réel d'entrée dans la scène courante
  UI.fadeAt = -9;     // fondu d'entrée (écrans de menu)
  UI.shopT = -9; UI.cardsT = -9; UI.rewardSeen = 0;
  UI.settingsTab = 0;
  UI.introCards = [];
  const relicX = new WeakMap(); // position affichée de chaque relique (animation du réordonnancement)

  const now = () => BE.state.time;
  const settings = () => BE.settings || {};
  const ts = () => (settings().textScale > 1 ? 1.25 : 1); // taille du texte ×1,25 (§10.10)

  // ================================================================ régions
  function region(id, x, y, w, h, onTap, focusable, extra) {
    const r = { id, x, y, w, h, onTap, focus: focusable !== false };
    if (extra) Object.assign(r, extra);
    building.push(r);
    return r;
  }
  UI.region = region;
  function hit(x, y, list) {
    for (let i = list.length - 1; i >= 0; i--) {
      const r = list[i];
      if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return r;
    }
    return null;
  }
  /** Clic logique (x,y). Renvoie true si une région l'a traité. */
  UI.click = function (x, y) {
    const r = hit(x, y, regions);
    if (!r) {
      if (UI.panel && UI.panel.dismiss !== false) { UI.panel = null; BE.emit("ui:tap", {}); return true; }
      return false;
    }
    if (r.slider) return true; // géré au glisser
    BE.emit("ui:tap", {});
    try { r.onTap(x, y); } catch (e) { console.error(e); }
    return true;
  };
  UI.modalOpen = () => !!UI.panel;
  /** Régions de la dernière image (tests automatisés). */
  UI.regions = () => regions.map((r) => ({ id: r.id, x: r.x, y: r.y, w: r.w, h: r.h }));
  UI.setPaused = function (v) {
    const st = BE.state;
    if (v && !BE.Run.IN_GAME[st.scene]) return;
    if (!!v === !!st.paused) return;
    st.paused = !!v; UI.confirm = null;
    if (v) {
      UI.panel = null; UI.pauseAt = now();
      if (BE.Audio) BE.Audio.suspend();
      if (BE.Run.canSave()) BE.Run.save();
      const S = st.play;
      if (S && S.aim && S.aim.active) { S.aim.active = false; S.aim.cancel = false; }
    } else if (BE.Audio) BE.Audio.resume();
  };
  UI.openPanel = function (type, data) { UI.panel = Object.assign({ type, t: now() }, data || {}); UI.confirm = null; BE.emit("ui:tap", {}); };
  UI.toast = function (msg) { UI.toastMsg = { msg, t: now() }; };

  // ================================================================ entrées (retours visuels, glisser-déposer, curseurs)
  function canvasEl() { return document.getElementById("game"); }
  BE.on("pdown", (e) => {
    const r = hit(e.x, e.y, regions);
    UI.pressId = r ? r.id : null;
    UI.hoverId = null;
    if (r && r.slider) { UI.slide = r.slider; slideTo(e.x); return; }
    const st = BE.state;
    if (st.scene === "SHOP" && !UI.panel && !st.paused && r && /^relic\d$/.test(r.id)) {
      const k = +r.id.slice(5);
      if (st.run && st.run.relics[k]) UI.drag = { from: k, sx: e.x, sy: e.y, x: e.x, y: e.y, active: false, t: now() };
    }
  });
  BE.on("pmove", (e) => {
    if (UI.slide) { slideTo(e.x); return; }
    const d = UI.drag;
    if (!d) return;
    d.x = e.x; d.y = e.y;
    if (!d.active && Math.hypot(e.x - d.sx, e.y - d.sy) >= BE.Input.TAP_PX) {
      d.active = true; d.t = now(); UI.pressId = null; UI.sel = null;
      BE.emit("ui:tap", {});
    }
  });
  BE.on("pup", () => {
    UI.pressId = null;
    if (UI.slide) { UI.slide = null; saveSettings(); if (BE.Audio) BE.Audio.play("ui"); }
    const d = UI.drag;
    UI.drag = null;
    if (d && d.active) dropRelic(d);
  });
  BE.on("pcancel", () => { UI.pressId = null; UI.drag = null; UI.slide = null; });
  BE.on("hover", (e) => {
    const r = hit(e.x, e.y, regions);
    const id = r && !r.noHover ? r.id : null;
    if (id !== UI.hoverId) {
      UI.hoverId = id;
      const cv = canvasEl();
      if (cv) cv.style.cursor = id ? "pointer" : "default";
    }
  });

  /** Clavier des menus : flèches = focus, Entrée = valider, Échap = retour. Renvoie true si consommé. */
  UI.key = function (e) {
    const st = BE.state;
    if (BE.Meta && BE.Meta.key && BE.Meta.key(e)) return true; // écrans méta (14_meta.js)
    const foc = regions.filter((r) => r.focus);
    const menuScene = st.paused || UI.panel || ["TITLE", "SELECT", "SHOP", "RUN_END"].indexOf(st.scene) >= 0 || (BE.Meta && BE.Meta.isMenu && BE.Meta.isMenu(st.scene));
    if (e.code === "Escape") {
      if (UI.panel) { UI.panel = null; UI.confirm = null; BE.emit("ui:tap", {}); return true; }
      if (st.paused) { UI.setPaused(false); return true; }
      if (st.scene === "SELECT") { BE.Run.go("TITLE"); return true; }
      if (st.scene === "SHOP" && UI.sel) { UI.sel = null; return true; }
      if (UI.confirm) { UI.confirm = null; return true; }
      return false;
    }
    if (UI.panel && UI.panel.type === "swapPick" && /^(Digit|Numpad)[123]$/.test(e.code) && !e.repeat) {
      const j = +e.code.slice(-1);
      if (st.run && j <= BE.Run.nextStars(st.run).length) { UI.panel = null; BE.Run.swap(j); }
      return true;
    }
    if (!menuScene) return false;
    if (st.scene === "SHOP" && !st.paused && !UI.panel) {
      const run = st.run;
      if (e.code === "KeyR") { shopReroll(); return true; }
      if (e.code === "KeyL" && UI.sel && UI.sel.kind === "offer") { BE.Shop.lock(run, UI.sel.i); BE.emit("ui:tap", {}); return true; }
      if (e.code === "Space") { if (!e.repeat) { UI.sel = null; BE.Run.leaveShop(); } return true; }
      if ((e.code === "KeyQ" || e.code === "KeyE") && UI.sel && UI.sel.kind === "relic") {
        UI.sel.i = BE.Shop.move(run, UI.sel.i, e.code === "KeyQ" ? -1 : 1); return true;
      }
    }
    const cur = foc[UI.focus];
    if (cur && cur.adjust && (e.code === "ArrowLeft" || e.code === "ArrowRight")) {
      cur.adjust(e.code === "ArrowRight" ? 1 : -1); BE.emit("ui:tap", {}); return true;
    }
    if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Tab"].indexOf(e.code) >= 0) {
      if (!foc.length) return true;
      const fwd = e.code === "ArrowRight" || e.code === "ArrowDown" || (e.code === "Tab" && !e.shift);
      UI.focus = UI.focus < 0 ? 0 : (UI.focus + (fwd ? 1 : -1) + foc.length) % foc.length;
      BE.emit("ui:tap", {});
      return true;
    }
    if ((e.code === "Enter" || e.code === "Space" || e.code === "NumpadEnter") && !e.repeat) {
      if (cur) { BE.emit("ui:tap", {}); cur.onTap(cur.x + cur.w / 2, cur.y + cur.h / 2); return true; }
    }
    return false;
  };

  // ================================================================ primitives
  const rr = (x, y, w, h, r) => BE.FX.roundRect(g, x, y, w, h, r);
  function text(t, x, y, size, color, align, weight, base) {
    g.font = (weight || 800) + " " + size + "px " + D.FONT;
    g.fillStyle = color; g.textAlign = align || "center"; g.textBaseline = base || "middle";
    g.fillText(t, x, y);
  }
  /** Texte réduit si besoin pour tenir dans maxW. */
  function fitText(t, x, y, maxW, size, color, align, weight, minSize) {
    let s = size;
    g.font = (weight || 800) + " " + s + "px " + D.FONT;
    while (g.measureText(t).width > maxW && s > (minSize || 8)) { s -= 0.5; g.font = (weight || 800) + " " + s + "px " + D.FONT; }
    text(t, x, y, s, color, align, weight);
    return s;
  }
  function wrap(t, x, y, maxW, size, color, lh, align, weight) {
    g.font = (weight || 600) + " " + size + "px " + D.FONT;
    const words = String(t).split(" ");
    let line = "", yy = y;
    for (const w of words) {
      const test = line ? line + " " + w : w;
      if (g.measureText(test).width > maxW && line) { text(line, x, yy, size, color, align || "center", weight || 600); line = w; yy += lh; }
      else line = test;
    }
    if (line) text(line, x, yy, size, color, align || "center", weight || 600);
    return yy + lh;
  }
  /** Nombre de lignes qu'occuperait wrap(). */
  function lineCount(t, maxW, size, weight) {
    g.font = (weight || 600) + " " + size + "px " + D.FONT;
    let n = 1, line = "";
    for (const w of String(t).split(" ")) {
      const test = line ? line + " " + w : w;
      if (g.measureText(test).width > maxW && line) { n++; line = w; } else line = test;
    }
    return n;
  }
  UI.text = text; UI.wrap = wrap; UI.fitText = fitText;
  function isFocused(id) { const foc = regions.filter((r) => r.focus); return !!(foc[UI.focus] && foc[UI.focus].id === id); }
  UI.isFocused = isFocused;
  function focusRing(x, y, w, h, r) { g.strokeStyle = "#eef2ff"; g.lineWidth = 2; rr(x - 3, y - 3, w + 6, h + 6, (r || 12) + 2); g.stroke(); }
  function glowAt(x, y, r, color, a) {
    g.globalCompositeOperation = "lighter"; const ga = g.globalAlpha; g.globalAlpha = ga * a;
    g.drawImage(BE.FX.glow(color), x - r, y - r, r * 2, r * 2);
    g.globalCompositeOperation = "source-over"; g.globalAlpha = ga;
  }
  UI.glowAt = glowAt;

  const STYLES = {
    primary: { bg: "#2a3a8a", bg2: "#1d2a6a", line: "#5a78ff", fg: "#eef2ff" },
    gold: { bg: "#ffd166", bg2: "#e8a93a", line: "#fff0c0", fg: "#1a1206" },
    ghost: { bg: "rgba(24,31,66,0.92)", bg2: "rgba(16,21,46,0.92)", line: "#34407a", fg: "#eef2ff" },
    danger: { bg: "#5a1a2a", bg2: "#40121e", line: "#ff4d6d", fg: "#ffdbe2" },
    eclat: { bg: "#123a5a", bg2: "#0d2a44", line: "#4fb3ff", fg: "#eef2ff" },
    frag: { bg: "#3a2a6a", bg2: "#281c50", line: "#c7a6ff", fg: "#f3ecff" },
  };
  /** Bouton : o = {id,x,y,w,h,label,sub,style,disabled,whyDisabled,onTap,icon(g,cx,cy),size,alpha,dy} (x,y = coin haut-gauche). */
  UI.button = function (o) {
    const s = STYLES[o.style || "primary"];
    const pressed = UI.pressId === o.id && !o.disabled;
    const hover = UI.hoverId === o.id && !o.disabled;
    const sc = pressed ? 0.95 : hover ? 1.02 : 1;
    const oy = o.dy || 0;
    const cx = o.x + o.w / 2, cy = o.y + o.h / 2 + oy;
    const a0 = o.alpha === undefined ? 1 : o.alpha;
    if (a0 <= 0.01) { regionFor(o); return; }
    g.save(); g.translate(cx, cy); g.scale(sc, sc);
    g.globalAlpha = a0 * (o.disabled ? 0.45 : 1);
    const hw = o.w / 2, hh = o.h / 2, rad = Math.min(14, o.h * 0.28);
    g.fillStyle = "rgba(0,0,0,0.38)"; rr(-hw, -hh + (pressed ? 1 : 4), o.w, o.h, rad); g.fill();
    const gr = g.createLinearGradient(0, -hh, 0, hh);
    gr.addColorStop(0, hover ? U.shade(s.bg.charAt(0) === "#" ? s.bg : "#2a3160", 0.08) : s.bg); gr.addColorStop(1, s.bg2);
    g.fillStyle = gr; rr(-hw, -hh + (pressed ? 2 : 0), o.w, o.h, rad); g.fill();
    g.strokeStyle = s.line; g.lineWidth = 1.5; rr(-hw, -hh + (pressed ? 2 : 0), o.w, o.h, rad); g.stroke();
    g.fillStyle = "rgba(255,255,255," + (o.style === "gold" ? 0.22 : 0.07) + ")"; rr(-hw + 3, -hh + 3 + (pressed ? 2 : 0), o.w - 6, o.h * 0.4, rad - 2); g.fill();
    const py = pressed ? 2 : 0;
    const hasSub = !!o.sub;
    let lx = 0;
    if (o.icon) {
      const lw = Math.min(o.w - 40, measure(o.label, o.size || 16, 900));
      lx = 10;
      o.icon(g, lx - lw / 2 - 14, py + (hasSub ? -7 : 1));
    }
    fitText(o.label, lx, (hasSub ? -7 : 1) + py, o.w - 16, o.size || 16, s.fg, "center", 900);
    if (hasSub) fitText(o.sub, lx, 12 + py, o.w - 16, 10, o.style === "gold" ? "#6a4508" : o.style === "danger" ? "#ff9fb2" : P.dim, "center", 700);
    g.restore();
    g.globalAlpha = 1;
    if (isFocused(o.id)) focusRing(o.x, o.y + oy, o.w, o.h, rad);
    regionFor(o);
  };
  function regionFor(o) {
    region(o.id, o.x, o.y + (o.dy || 0), o.w, o.h, o.disabled ? () => { BE.emit("ui:no", {}); if (o.whyDisabled) UI.toast(o.whyDisabled); } : o.onTap);
  }
  function measure(t, size, weight) { g.font = (weight || 800) + " " + size + "px " + D.FONT; return g.measureText(t).width; }
  function roundBtn(id, x, y, r, drawIcon, onTap, label, alpha) {
    const pressed = UI.pressId === id, hover = UI.hoverId === id;
    g.save(); g.globalAlpha = alpha === undefined ? 1 : alpha;
    g.translate(x, y); if (pressed) g.scale(0.92, 0.92); else if (hover) g.scale(1.06, 1.06);
    const gr = g.createLinearGradient(0, -r, 0, r);
    gr.addColorStop(0, "#1f2858"); gr.addColorStop(1, "#121832");
    g.fillStyle = gr; g.strokeStyle = hover ? "#5a6ab0" : P.line; g.lineWidth = 1.5;
    g.beginPath(); g.arc(0, 0, r, 0, TAU); g.fill(); g.stroke();
    drawIcon();
    g.restore();
    g.save(); g.globalAlpha = alpha === undefined ? 1 : alpha;
    if (label) text(label, x, y + r + 11, 10, P.dim, "center", 700);
    g.restore();
    if (isFocused(id)) { g.strokeStyle = "#eef2ff"; g.lineWidth = 2; g.beginPath(); g.arc(x, y, r + 3, 0, TAU); g.stroke(); }
    const half = Math.max(24, r + 4);
    region(id, x - half, y - half, half * 2, half * 2 + (label ? 14 : 0), onTap);
  }
  function veil(a) { g.fillStyle = "rgba(5,7,16," + a + ")"; BE.Render.fillScreen(g); }
  function panelBox(x, y, w, h, accent) {
    g.fillStyle = "rgba(0,0,0,0.42)"; rr(x, y + 5, w, h, 16); g.fill();
    const gr = g.createLinearGradient(0, y, 0, y + h);
    gr.addColorStop(0, "#1a2350"); gr.addColorStop(1, P.panel);
    g.fillStyle = gr; rr(x, y, w, h, 16); g.fill();
    g.strokeStyle = accent || P.line; g.lineWidth = 1.5; rr(x, y, w, h, 16); g.stroke();
    g.fillStyle = "rgba(255,255,255,0.04)"; rr(x + 3, y + 3, w - 6, 26, 13); g.fill();
  }
  UI.panelBox = panelBox;
  function sheetIn(t0, dur) { return U.easeOutCubic(U.clamp((now() - t0) / (dur || 0.2), 0, 1)); }
  /** Interrupteur oui/non (dessin seul). */
  function toggle(x, y, on, t0) {
    const w = 46, h = 26;
    const k = U.clamp((now() - (t0 || -9)) / 0.15, 0, 1);
    const pos = on ? U.easeOutBack(k) : 1 - U.easeOutCubic(k);
    g.fillStyle = on ? "#3a6a3f" : "#232a52"; rr(x - w / 2, y - h / 2, w, h, h / 2); g.fill();
    g.strokeStyle = on ? P.seve : P.line; g.lineWidth = 1.5; rr(x - w / 2, y - h / 2, w, h, h / 2); g.stroke();
    const kx = x - w / 2 + h / 2 + (w - h) * U.clamp(pos, -0.1, 1.1);
    g.fillStyle = on ? "#eef2ff" : "#8a93b8"; g.beginPath(); g.arc(kx, y, h / 2 - 3, 0, TAU); g.fill();
  }

  // ================================================================ dessin principal
  UI.draw = function (ctx) {
    g = ctx;
    building = [];
    const st = BE.state, sc = st.scene;
    const run = st.run;
    const f = SCREENS[sc];
    if (f) { try { f(st, run); } catch (e) { console.error(e); } }
    if (BE.Run.IN_GAME[sc] || sc === "SETTLE_CANDLE") {
      // bouton pause (zone x ≥ 312, y < 44)
      region("pause", 312, 0, 48, 44, () => UI.setPaused(true), false);
      if (run && st.play) { drawHudExtras(st, run); drawBubbles(st, run); }
    }
    if (UI.panel) drawPanel(st, run);
    if (st.paused && !UI.panel) drawPause(st, run);
    if (BE.Meta && BE.Meta.drawOverlay) BE.Meta.drawOverlay(g, st); // Grimoire de la pause + notifications (14_meta.js)
    drawToast(st);
    // fondu d'entrée des écrans de menu
    const fk = (now() - UI.fadeAt) / 0.3;
    if (fk < 1) { g.globalAlpha = 1 - U.easeOutCubic(U.clamp(fk, 0, 1)); g.fillStyle = P.bg0; BE.Render.fillScreen(g); g.globalAlpha = 1; }
    regions = building;
    const foc = regions.filter((r) => r.focus);
    if (UI.focus >= foc.length) UI.focus = foc.length - 1;
  };

  // ================================================================ écrans
  const SCREENS = {};
  UI.SCREENS = SCREENS;
  const MENU_FADE = { TITLE: 1, SELECT: 1, SHOP: 1, RUN_END: 1, OBSERVATORY: 1, GRIMOIRE: 1, DAILY: 1, DEFIS: 1 };

  // ---------------------------------------------------------------- titre (§10.1)
  const titleStars = [
    { x: 126, y: 569, s: 3, c: "braise" }, { x: 182, y: 564, s: 4, c: "givre" }, { x: 235, y: 575, s: 2, c: "foudre" },
    { x: 118, y: 528, s: 1, c: "givre" }, { x: 160, y: 519, s: 2, c: "braise" },
  ];
  const motes = [];
  SCREENS.TITLE = function (st) {
    const t = st.time, k0 = t - UI.sceneAt;
    const hasRun = st.ui.savedRun !== undefined ? !!st.ui.savedRun : BE.Save.hasRun();
    // --- bocal animé
    const jx = 180, jTop = 470, jBot = 598, jw = 176;
    glowAt(jx, 536, 170, "#4f6bff", 0.16 + 0.04 * Math.sin(t));
    g.fillStyle = P.jarIn; rr(jx - jw / 2, jTop, jw, jBot - jTop, 24); g.fill();
    // poussière d'étoiles qui monte du bocal
    if (motes.length < 14 && Math.random() < 0.08) motes.push({ x: jx + (Math.random() - 0.5) * 140, y: jTop + 30, v: 8 + Math.random() * 14, a: 0, s: 0.8 + Math.random() * 1.4, c: ["#ffd166", "#5ee7ff", "#ff6b3d", "#c7a6ff"][Math.floor(Math.random() * 4)] });
    for (let i = motes.length - 1; i >= 0; i--) {
      const m = motes[i];
      m.y -= m.v * (st.frameDt || 0.016); m.x += Math.sin(t * 2 + i) * 0.15; m.a = Math.min(1, m.a + 0.03);
      const life = (jTop + 30 - m.y) / 150;
      if (life > 1) { motes.splice(i, 1); continue; }
      g.globalAlpha = m.a * (1 - life) * 0.8; g.fillStyle = m.c; g.beginPath(); g.arc(m.x, m.y, m.s, 0, TAU); g.fill();
    }
    g.globalAlpha = 1;
    for (let i = 0; i < titleStars.length; i++) {
      const s = titleStars[i];
      const drop = U.clamp((k0 - 0.35 - i * 0.09) / 0.45, 0, 1);
      const bob = Math.sin(t * 1.3 + s.x) * 1.5;
      const yy = s.y + bob - (1 - U.easeOutBack(drop)) * 60;
      g.globalAlpha = drop;
      BE.Render.drawStar(s.x, yy, s.s, s.c, { seed: s.x * 3, lookX: 180 + Math.sin(t * 0.5) * 80, lookY: 380 });
    }
    g.globalAlpha = 1;
    g.strokeStyle = U.rgba(P.glass, 0.6); g.lineWidth = 2.5; rr(jx - jw / 2, jTop, jw, jBot - jTop, 24); g.stroke();
    g.fillStyle = "#2b3560"; rr(jx - jw / 2 - 8, jTop - 12, jw + 16, 14, 6); g.fill();
    g.strokeStyle = U.rgba(P.glass, 0.6); g.lineWidth = 1.5; rr(jx - jw / 2 - 8, jTop - 12, jw + 16, 14, 6); g.stroke();
    g.fillStyle = "rgba(255,255,255,0.07)"; rr(jx - jw / 2 + 8, jTop + 10, 12, jBot - jTop - 28, 6); g.fill();
    // étoile filante décorative
    const fk = (t * 0.22) % 1;
    if (fk < 0.25) {
      const q = fk / 0.25, x = U.lerp(-20, 390, q), y = U.lerp(30, 190, q);
      const gr = g.createLinearGradient(x - 50, y - 20, x, y);
      gr.addColorStop(0, "rgba(238,242,255,0)"); gr.addColorStop(1, "rgba(238,242,255,0.7)");
      g.strokeStyle = gr; g.lineWidth = 1.8; g.beginPath(); g.moveTo(x - 50, y - 20); g.lineTo(x, y); g.stroke();
    }
    // --- titre néon (entrée : descente douce)
    const tk = U.easeOutCubic(U.clamp(k0 / 0.6, 0, 1));
    g.globalAlpha = tk;
    neon("BOCAL", 180, 82 - (1 - tk) * 16, 50, "#ffd166", t);
    neon("D'ÉTOILES", 180, 130 - (1 - tk) * 10, 34, "#c7a6ff", t + 1.3);
    text("Lance. Rebondis. Fusionne. Brille.", 180, 164, 12, P.dim, "center", 600);
    g.globalAlpha = 1;
    // --- boutons (entrée en cascade)
    const btnIn = (i) => U.clamp((k0 - 0.15 - i * 0.07) / 0.35, 0, 1);
    let y = hasRun ? 188 : 204, i = 0;
    const mk = (o) => { const k = btnIn(i++); o.alpha = k; o.dy = (1 - U.easeOutBack(k)) * 24; UI.button(o); };
    if (hasRun) {
      mk({ id: "continue", x: 60, y, w: 240, h: 56, label: "Continuer", sub: savedSub(st), style: "gold",
        onTap: () => { const d = BE.Save.loadRun(); if (d) BE.Run.resume(d); else { st.ui.savedRun = null; UI.toast("Sauvegarde introuvable"); } } });
      y += 64;
    }
    mk({ id: "new", x: 60, y, w: 240, h: 56, label: "Nouvelle partie", style: hasRun ? "primary" : "gold", onTap: () => BE.Run.go("SELECT") });
    y += 64;
    const daily = BE.Meta && BE.Meta.dailyInfo ? BE.Meta.dailyInfo() : { done: false };
    mk({ id: "daily", x: 60, y, w: 240, h: 56, label: "Ciel du Jour", sub: daily.done ? "fait · meilleur " + U.fmt(daily.best || 0) : "à jouer aujourd'hui", style: "eclat", size: 15,
      onTap: () => BE.Run.go("DAILY") });
    if (!daily.done) { // pastille « à jouer »
      const k = btnIn(i - 1);
      g.globalAlpha = k; g.fillStyle = P.eclat; g.beginPath(); g.arc(292, y + 8, 4 + Math.sin(t * 4) * 0.8, 0, TAU); g.fill(); g.globalAlpha = 1;
    }
    // Observatoire · Grimoire · Réglages : trois vrais boutons de 56 px de haut (icône + libellé) sur une rangée,
    // pour laisser le bocal animé visible sur un écran de 640 (§10.1, mise en page compacte assumée)
    y += 64;
    const sw = 76, sg = 6;
    const small = [["obs", "Observatoire", iconObservatory, () => BE.Meta.open("OBSERVATORY")], ["grim", "Grimoire", iconBook, () => BE.Meta.open("GRIMOIRE")],
      ["set", "Réglages", iconGear, () => UI.openPanel("settings")]];
    small.forEach(([id, label, ico, fn], j) => {
      const bx = 60 + j * (sw + sg), k = btnIn(i);
      UI.button({ id, x: bx, y, w: sw, h: 56, label: "", style: "ghost", alpha: k, dy: (1 - U.easeOutBack(k)) * 24, onTap: fn });
      g.save(); g.globalAlpha = k; g.translate(bx + sw / 2, y + 20 + (1 - U.easeOutBack(k)) * 24); ico(); g.restore();
      g.globalAlpha = k; fitText(label, bx + sw / 2, y + 42 + (1 - U.easeOutBack(k)) * 24, sw - 8, 10.5, P.text, "center", 800); g.globalAlpha = 1;
    });
    i++;
    if (BE.Meta && BE.Meta.drawTitleExtras) BE.Meta.drawTitleExtras(g, st, { obs: { x: 60 + sw - 10, y: y + 10 }, grim: { x: 60 + sw + sg + sw - 10, y: y + 10 } }); // ◇ et pastilles (14_meta.js)
    // bandeau méta : « Encore N ◇ : [Salle] »
    const nr = BE.Meta ? BE.Meta.nextRoom() : null;
    if (nr) {
      const bw = 240, bx = 60, byy = 624;
      text(BE.Meta.nextRoomText ? BE.Meta.nextRoomText(nr) : "Encore " + nr.need + " ◇ : " + nr.room.nom, 180, 612, 11, P.frag, "center", 800);
      g.fillStyle = "rgba(199,166,255,0.15)"; rr(bx, byy, bw, 6, 3); g.fill();
      const pk = U.clamp(1 - nr.need / nr.room.cost, 0, 1) * U.easeOutCubic(U.clamp((k0 - 0.5) / 0.8, 0, 1));
      g.fillStyle = P.frag; rr(bx, byy, Math.max(6, bw * pk), 6, 3); g.fill();
    }
  };
  function savedSub(st) {
    const d = st.ui.savedRun;
    if (!d) return "run en cours";
    return "Lune " + d.lune + " · " + D.NIGHT_NAMES[d.nuit] + (d.phase === "SHOP" ? " · Aube" : "") + (d.gold !== undefined ? " · " + d.gold + " or" : "");
  }
  function neon(t, x, y, size, color, time) {
    const flick = 0.85 + 0.15 * Math.sin(time * 3.1) * Math.sin(time * 1.7);
    g.font = "900 " + size + "px " + D.FONT; g.textAlign = "center"; g.textBaseline = "middle";
    const ga = g.globalAlpha;
    g.globalCompositeOperation = "lighter";
    g.globalAlpha = ga * 0.35 * flick;
    const w = g.measureText(t).width;
    g.drawImage(BE.FX.glow(color), x - w * 0.7, y - size, w * 1.4, size * 2);
    g.globalCompositeOperation = "source-over"; g.globalAlpha = ga;
    g.lineWidth = 6; g.strokeStyle = U.rgba(color, 0.25 * flick); g.strokeText(t, x, y);
    g.lineWidth = 2; g.strokeStyle = U.rgba(color, 0.9); g.strokeText(t, x, y);
    g.fillStyle = U.shade(color, 0.6); g.fillText(t, x, y);
  }
  UI.neon = (t, x, y, s, c, tm) => neon(t, x, y, s, c, tm);
  function iconGear() {
    g.strokeStyle = P.text; g.lineWidth = 2;
    g.beginPath(); g.arc(0, 0, 5, 0, TAU); g.stroke();
    for (let i = 0; i < 8; i++) { const a = i * TAU / 8; g.beginPath(); g.moveTo(Math.cos(a) * 7, Math.sin(a) * 7); g.lineTo(Math.cos(a) * 10, Math.sin(a) * 10); g.stroke(); }
  }
  function iconBook() {
    g.strokeStyle = P.frag; g.lineWidth = 1.8;
    g.beginPath(); g.moveTo(0, -6); g.quadraticCurveTo(-6, -9, -10, -6); g.lineTo(-10, 7); g.quadraticCurveTo(-6, 4, 0, 7); g.quadraticCurveTo(6, 4, 10, 7); g.lineTo(10, -6); g.quadraticCurveTo(6, -9, 0, -6); g.lineTo(0, 7); g.stroke();
  }
  function iconObservatory() {
    g.fillStyle = P.eclat;
    g.beginPath(); g.arc(0, 2, 9, Math.PI, 0); g.fill(); g.fillRect(-9, 2, 18, 6);
    g.fillStyle = "#0b0f1e"; g.fillRect(-1.5, -7, 3, 9);
  }

  // ---------------------------------------------------------------- sélection (repli ; 14_meta.js fournit l'écran complet)
  SCREENS.SELECT = function (st) {
    const t = st.time;
    text("CHOISIS TA GARDIENNE", 180, 56, 14, P.dim, "center", 800);
    const list = D.GARDIENS;
    const i = U.clamp(UI.gardienIdx, 0, list.length - 1);
    const gd = list[i];
    const unlocked = BE.Meta ? BE.Meta.hasGardien(gd.id) : gd.id === "veilleuse";
    panelBox(40, 84, 280, 360);
    glowAt(180, 176, 80, gd.color, unlocked ? 0.45 + 0.1 * Math.sin(t * 2) : 0.1);
    text(unlocked ? gd.nom : "???", 180, 262, 22, unlocked ? P.text : P.dim, "center", 900);
    if (unlocked) {
      text(gd.txt[0], 180, 290, 11, P.dim, "center", 600);
      text(gd.txt[1], 180, 306, 11, P.dim, "center", 600);
      const bag = D.BAGS[gd.bag], n = bag.length, sp = 24;
      bag.forEach(([c, s], k) => BE.Render.drawStar(180 - (n - 1) * sp / 2 + k * sp, 364, s, c, { scale: (s === 1 ? 8 : 10.5) / D.SIZES[s].r, seed: k * 11 }));
    } else text("Verrouillée", 180, 294, 12, P.dim, "center", 700);
    roundBtn("prev", 22, 264, 18, () => text("‹", 0, -1, 22, P.text, "center", 900), () => { UI.gardienIdx = (i + list.length - 1) % list.length; });
    roundBtn("next", 338, 264, 18, () => text("›", 0, -1, 22, P.text, "center", 900), () => { UI.gardienIdx = (i + 1) % list.length; });
    UI.button({ id: "launch", x: 60, y: 510, w: 240, h: 56, label: "Lancer", style: "gold", disabled: !unlocked, whyDisabled: "Gardienne verrouillée",
      onTap: () => BE.Run.startNewRun({ gardien: gd.id, eclipse: st.ui.eclipse || 0 }) });
    UI.button({ id: "back", x: 110, y: 578, w: 140, h: 48, label: "Retour", style: "ghost", size: 14, onTap: () => BE.Run.go("TITLE") });
  };

  // ---------------------------------------------------------------- carte d'introduction de nuit (§10.4, §10.9)
  /** Types d'Ombres nouveaux à présenter en mini-carte (première rencontre seulement). */
  function computeIntroCards(run) {
    const m = BE.state.meta;
    if (!run || run.nuit !== 0 || !m) return [];
    const seen = (m.flags && m.flags.shadowCards) || [];
    const present = {};
    for (const s of run.firm.shadows) if (s.alive) present[s.type] = 1;
    return (D.NEW_SHADOWS[run.lune] || []).filter((ty) => D.SHADOWS[ty] && seen.indexOf(ty) < 0 && (ty !== "mere" || present[ty])).slice(0, 3);
  }
  /** Temps d'affichage supplémentaire de la carte d'intro (mini-cartes « Nouvelle Ombre ») — lu par 09_run. */
  UI.introExtra = () => (UI.introCards.length ? 0.6 + 0.45 * UI.introCards.length : 0);
  /** Carte d'intro qui présente de nouvelles Ombres : elle attend un tap (lue par SC.NIGHT_INTRO, 09_run). */
  UI.introHold = () => UI.introCards.length > 0 && !BE.state.sandbox;
  function markIntroSeen() {
    const m = BE.state.meta;
    if (!m || !UI.introCards.length) return;
    m.flags.shadowCards = (m.flags.shadowCards || []).concat(UI.introCards.filter((x) => (m.flags.shadowCards || []).indexOf(x) < 0));
    try { BE.Save.saveMeta(m); } catch (e) { /* */ }
  }
  function fakeShadow(type, x, y, r, bossId) { return { type, id: 7 + x, r, dispX: x, dispY: y, bossId, hp: 1, counter: 1 }; }

  /** Première nuit de la Lune 2 d'un run qui a eu des tirs d'apprentissage : on dit pourquoi il y a 2 tirs de moins. */
  function introGraceEnd(run) { return run.lune === 2 && run.nuit === 0 && run.eclipse < 5 && !run.nuitBlanche && (D.ECO.lune1Grace || 0) > 0; }
  SCREENS.NIGHT_INTRO = function (st, run) {
    const k = st.sceneT;
    const total = D.FX.introCard + (run.nuit === 2 ? 0.6 : 0) + UI.introExtra();
    const a = U.clamp(k / 0.18, 0, 1) * (UI.introHold() ? 1 : U.clamp((total - k) / 0.22, 0, 1));
    const isBoss = run.nuit === 2 && run.firm.boss;
    const cards = UI.introCards;
    // hauteur du panneau selon le contenu : en-tête (piste + titre + quota) 170, bloc, mini-cartes, pied 54
    const bossLines = isBoss ? lineCount(D.BOSSES[run.firm.boss.bossId].rule, 270, 12 * ts()) : 0;
    // §2.2 : la règle du boss de la Lune est annoncée dès la carte de la Nuit Mince
    const lb = run.nuit === 0 && run.firm.bossId ? D.BOSSES[run.firm.bossId] : null;
    const lbLines = lb ? lineCount(lb.rule, 230, 10.5 * ts()) : 0;
    const hold = UI.introHold();
    let h = 170 + (isBoss ? 104 + bossLines * 15 * ts() : 26 + (introGraceEnd(run) ? 16 : 0)) + (lb ? 30 + lbLines * 13 * ts() : 0) + (cards.length ? 18 + cards.length * 50 : 0) + 50;
    h = Math.min(h, 600);
    const top = Math.round(320 - h / 2);
    g.globalAlpha = a;
    veil(0.74);
    const pk = U.easeOutBack(U.clamp(k / 0.32, 0, 1));
    g.save(); g.translate(180, top + h / 2); g.scale(0.9 + 0.1 * pk, 0.9 + 0.1 * pk); g.translate(-180, -(top + h / 2));
    panelBox(24, top, 312, h, isBoss ? U.rgba(D.BOSSES[run.firm.boss.bossId].color, 0.7) : null);
    BE.Render.drawLuneTrack(run, 180, top + 38, { sp: 56 });
    let y = top + 104;
    const line = (i) => U.clamp((k - 0.08 - i * 0.07) / 0.2, 0, 1);
    g.globalAlpha = a * line(0);
    fitText("LUNE " + run.lune + " — " + D.NIGHT_NAMES[run.nuit].toUpperCase(), 180, y, 280, 19, isBoss ? "#ff9ab0" : P.text, "center", 900);
    g.fillStyle = U.rgba(P.or, 0.8); g.fillRect(180 - 60 * line(1), y + 16, 120 * line(1), 1.5);
    g.globalAlpha = a * line(1);
    // quota qui « compte » jusqu'à sa valeur
    const qv = Math.round(run.quota * U.easeOutCubic(U.clamp((k - 0.1) / 0.5, 0, 1)));
    text("Quota " + U.fmt(qv), 180, y + 38, 17, P.or, "center", 900);
    y += 66;
    g.globalAlpha = a * line(2);
    if (isBoss) {
      const bd = D.BOSSES[run.firm.boss.bossId];
      glowAt(180, y + 26, 60, bd.color, 0.35 + 0.1 * Math.sin(st.time * 3));
      BE.Render.drawShadow(fakeShadow("boss", 180, y + 26, 26, bd.id), { x: 180, y: y + 90 });
      text(bd.nom, 180, y + 72, 18, bd.color, "center", 900);
      wrap(bd.rule, 180, y + 94, 270, 12 * ts(), P.text, 15 * ts());
      y += 104 + bossLines * 15 * ts();
    } else {
      const gr = run.graceShots || 0;
      fitText("Disposition : " + D.LAYOUTS[run.firm.layout].nom + " · " + run.shotsLeft + " tirs" + (gr ? " (dont " + gr + " d'apprentissage)" : ""), 180, y, 290, 11, P.dim, "center", 700);
      y += 26;
      if (introGraceEnd(run)) { text("Fin des tirs d'apprentissage : " + run.shotsLeft + " tirs par nuit", 180, y - 8, 10, P.glass, "center", 800); y += 16; }
    }
    if (lb) {
      g.fillStyle = U.rgba(lb.color, 0.1); rr(40, y - 10, 280, 22 + lbLines * 13 * ts(), 10); g.fill();
      g.strokeStyle = U.rgba(lb.color, 0.35); g.lineWidth = 1; rr(40, y - 10, 280, 22 + lbLines * 13 * ts(), 10); g.stroke();
      BE.Render.drawShadow(fakeShadow("boss", 62, y + 1 + lbLines * 6.5 * ts(), 9, lb.id), { x: 62, y: y + 30 });
      fitText("Boss de la Lune : " + lb.nom, 190, y + 1, 240, 11, lb.color, "center", 900);
      wrap(lb.rule, 190, y + 15, 230, 10.5 * ts(), U.rgba(P.text, 0.85), 13 * ts());
      y += 30 + lbLines * 13 * ts();
    }
    if (cards.length) {
      g.globalAlpha = a * line(3);
      text(cards.length > 1 ? "NOUVELLES OMBRES" : "NOUVELLE OMBRE", 180, y, 9, P.ombreLine, "center", 900);
      y += 14;
      cards.forEach((ty, i) => {
        const ck = U.clamp((k - 0.35 - i * 0.18) / 0.3, 0, 1);
        g.globalAlpha = a * ck;
        const cx = 40 + (1 - U.easeOutCubic(ck)) * 30, cy = y + i * 50;
        g.fillStyle = "rgba(181,156,255,0.08)"; rr(cx, cy, 280, 44, 10); g.fill();
        g.strokeStyle = U.rgba(P.ombreLine, 0.4); g.lineWidth = 1; rr(cx, cy, 280, 44, 10); g.stroke();
        BE.Render.drawShadow(fakeShadow(ty, cx + 24, cy + 22, 15), { x: cx + 80, y: cy + 22 });
        text(D.SHADOWS[ty].nom, cx + 50, cy + 14, 12, P.text, "left", 900);
        fitText(D.SHADOWS[ty].txt, cx + 50, cy + 30, 222, 10 * ts(), P.dim, "left", 700, 8);
      });
    }
    g.restore();
    // barre de temps (la carte passe seule) + indice
    g.globalAlpha = a;
    if (!hold) {
      const bw = 120 * U.clamp(1 - k / total, 0, 1);
      g.fillStyle = U.rgba(P.dim, 0.35); rr(180 - 60, top + h - 18, 120, 3, 1.5); g.fill();
      g.fillStyle = P.dim; rr(180 - 60, top + h - 18, bw, 3, 1.5); g.fill();
      text(BE.Input.isTouch() ? "Touche pour commencer" : "Clic ou Espace pour commencer", 180, top + h - 32, 10, P.dim, "center", 600);
    } else { // nouvelles Ombres : la carte attend le joueur
      g.globalAlpha = a * (0.65 + 0.35 * Math.sin(st.time * 4));
      text(BE.Input.isTouch() ? "Touche pour commencer" : "Clic ou Espace pour commencer", 180, top + h - 26, 12 * ts(), P.text, "center", 800);
    }
    g.globalAlpha = 1;
  };

  // ---------------------------------------------------------------- HUD complémentaire (§10.3, §3.1)
  function drawHudExtras(st, run) {
    const S = st.play, t = st.time, sc = st.scene;
    // zone d'annulation : apparaît quand le doigt remonte vers le HUD pendant la visée
    if (sc === "AIM" && S.aim && S.aim.active && !st.paused && !S.aim.kbd) {
      const py = BE.Input.pointer.y;
      const near = U.clamp(1 - (py - G.hudH) / 110, 0, 1);
      if (near > 0 && !S.aim.cancel) {
        const gr = g.createLinearGradient(0, G.hudH, 0, G.hudH + 40);
        gr.addColorStop(0, U.rgba(P.danger, 0.22 * near)); gr.addColorStop(1, U.rgba(P.danger, 0));
        g.fillStyle = gr; g.fillRect(0, G.hudH, D.W, 40);
        g.globalAlpha = near;
        g.strokeStyle = U.rgba(P.danger, 0.8); g.setLineDash([5, 4]); g.lineWidth = 1.2;
        g.beginPath(); g.moveTo(0, G.hudH + 0.5); g.lineTo(D.W, G.hudH + 0.5); g.stroke(); g.setLineDash([]);
        // pastille près du doigt (jamais sous le Phare)
        g.globalAlpha = 0.55 + 0.45 * near;
        g.font = "800 10px " + D.FONT;
        const w = g.measureText("↑ glisse en haut pour annuler").width + 20;
        const px = U.clamp(BE.Input.pointer.x, w / 2 + 8, D.W - w / 2 - 8), cy = Math.max(G.hudH + 70, py + 34);
        g.fillStyle = "rgba(40,10,20,0.88)"; rr(px - w / 2, cy - 11, w, 22, 11); g.fill();
        g.strokeStyle = U.rgba(P.danger, 0.7); g.lineWidth = 1; rr(px - w / 2, cy - 11, w, 22, 11); g.stroke();
        text("↑ glisse en haut pour annuler", px, cy + 0.5, 10, "#ffb3c1", "center", 800);
        g.globalAlpha = 1;
      }
    }
    // accélération (§5.8) : pastille « ×3 » quand la simulation va plus vite
    const RES = BE.Run.RESOLVING[sc] || sc === "COUNT";
    const subBanner = BE.FX.bannerWithSub && BE.FX.bannerWithSub(); // « LA BOUGIE S'ÉTEINT » & co. : rien par-dessus
    if (RES && !st.paused && !subBanner) {
      const k = BE.Run.timeScale() / (st.turbo || 1);
      UI.speedShown = U.approach(UI.speedShown || 1, k, 12, st.frameDt || 0.016);
      if (k > 1.01 || UI.speedShown > 1.05) {
        const a = U.clamp((UI.speedShown - 1) / 0.5, 0, 1);
        // avance rapide assumée : traits de vitesse discrets sur les bords (hors du Firmament et du bocal)
        if (sc !== "COUNT") {
          const sp = 380 * UI.speedShown;
          g.strokeStyle = "rgba(238,242,255,1)"; g.lineWidth = 1; g.lineCap = "round";
          for (let i = 0; i < 10; i++) {
            const side = i & 1, len = 26 + (i * 37) % 30;
            const x = side ? D.W - 6 - (i * 13) % 12 : 6 + (i * 17) % 12;
            const y = G.hudH + ((t * sp + i * 97) % (G.floor - G.hudH));
            g.globalAlpha = a * 0.12 * (0.5 + ((i * 7) % 5) / 8);
            g.beginPath(); g.moveTo(x, y - len); g.lineTo(x, y); g.stroke();
          }
          g.lineCap = "butt";
        }
        g.globalAlpha = a;
        const x = 180, y = G.liveY + 24;
        g.fillStyle = "rgba(10,14,32,0.85)"; rr(x - 26, y - 9, 52, 18, 9); g.fill();
        g.strokeStyle = U.rgba("#eef2ff", 0.35); g.lineWidth = 1; rr(x - 26, y - 9, 52, 18, 9); g.stroke();
        const off = (t * 6) % 1;
        g.fillStyle = "#eef2ff";
        for (let i = 0; i < 2; i++) {
          const ax = x - 18 + i * 6 + off * 2;
          g.globalAlpha = a * (0.5 + 0.5 * i);
          g.beginPath(); g.moveTo(ax, y - 4); g.lineTo(ax + 5, y); g.lineTo(ax, y + 4); g.closePath(); g.fill();
        }
        g.globalAlpha = a;
        text("×" + U.fmtDec(Math.round(k * 10) / 10), x + 8, y + 0.5, 10, "#eef2ff", "center", 900);
        g.globalAlpha = 1;
      }
    } else UI.speedShown = 1;
    // indices discrets des premiers tirs : « maintiens pour accélérer », « touche pour passer »
    if (BE.Run.RESOLVING[sc] && BE.Input.isHeld() && st.meta && st.meta.flags && !st.meta.flags.usedHold) st.meta.flags.usedHold = true; // appris : l'indice ne revient plus
    if (run.runStats && run.runStats.shots <= 3 && !st.paused && !subBanner && st.meta && st.meta.stats && (st.meta.stats.runs || 0) === 0) {
      let hint = null;
      // l'indice (y = liveY + 46 ≈ 398) gênerait une étoile qui entre dans le col du bocal, au-dessus de l'horizon
      const top = BE.Jar.topY && BE.Jar.topY(run);
      const high = top !== null && top !== undefined && top < BE.Run.horizon(run) + 12;
      // indice calé sur l'accélération automatique (§5.8, D.PHYS.speed) : juste avant qu'elle ne prenne le relais
      // (« pour accélérer »), puis pour un tir encore long après le ×3 automatique (maintenir passe alors à ×4)
      const SP = D.PHYS.speed, T = st.play.shot ? st.play.shot.t : 0, fl = sc === "FLIGHT";
      const a2 = fl ? SP.auto2 : SP.jar2, a3 = fl ? SP.auto3 : SP.jar3; // seuils du vol ou du bocal (BE.Run.autoSpeed)
      const early = T > Math.max(1, a2 - 1.5) && T < a2, late = T > a3 + 0.8;
      if (BE.Run.RESOLVING[sc] && st.play.shot && (early || late) && !BE.Input.isHeld() && !st.meta.flags.usedHold && !high) {
        hint = (BE.Input.isTouch() ? "Maintiens le doigt" : "Maintiens F") + (late ? " : encore plus vite" : " pour accélérer");
      }
      else if (sc === "COUNT" && run.runStats.shots <= 2 && !high) hint = BE.Input.isTouch() ? "Touche pour passer" : "Espace pour passer";
      if (hint) {
        const fs = 11 * ts();
        g.font = "800 " + fs + "px " + D.FONT;
        const w = g.measureText(hint).width + 22;
        g.globalAlpha = 0.78 + 0.2 * Math.sin(t * 4);
        g.fillStyle = "rgba(10,14,32,0.88)"; rr(180 - w / 2, G.liveY + 46 - 11, w, 22, 11); g.fill();
        g.strokeStyle = U.rgba(P.eclat, 0.5); g.lineWidth = 1; rr(180 - w / 2, G.liveY + 46 - 11, w, 22, 11); g.stroke();
        text(hint, 180, G.liveY + 46.5, fs, P.text, "center", 800);
        g.globalAlpha = 1;
      }
    }
  }

  // ---------------------------------------------------------------- nuit gagnée / Vidange / défaite / victoire
  SCREENS.NIGHT_WON = function (st, run) {
    const W = st.play.won;
    if (!W) return;
    const F = D.FX;
    const t0 = F.nightWonFreeze;
    // titre dès le gel (plaque sombre douce derrière : lisible au-dessus des Ombres et des badges)
    const k = U.clamp((W.t - 0.15) / 0.35, 0, 1);
    if (k > 0) {
      g.globalAlpha = k * 0.55; g.fillStyle = "#05070f"; rr(50, 382, 260, 44, 22); g.fill();
      g.globalAlpha = k;
      const s = 0.7 + 0.3 * U.easeOutBack(k);
      g.save(); g.translate(180, 404); g.scale(s, s);
      neon("NUIT GAGNÉE", 0, 0, 28, P.or, st.time);
      g.restore();
      g.globalAlpha = 1;
    }
    if (W.t > t0 + F.nightWonConvert && run.lastReward) {
      const R = run.lastReward;
      const lines = [["Nuit", R.night], ["Tirs restants (" + R.shotsLeft + ")", R.shots], ["Intérêts", R.interest]];
      if (R.grace) lines.splice(2, 0, ["Tirs d'apprentissage (" + R.grace + ")", 0]); // Lune 1 : restés inutilisés, ils ne paient pas
      if (R.chest) lines.push(["Coffre de la Mère-Ombre", "✦"]);
      const base = W.t - t0 - F.nightWonConvert;
      const pk = U.clamp(base / 0.25, 0, 1);
      const h = 44 + lines.length * 24 + 28;
      g.globalAlpha = pk;
      panelBox(50, 432, 260, h, U.rgba(P.or, 0.5));
      let sum = 0;
      lines.forEach(([l, n], i) => {
        const kk = U.clamp((base - 0.12 - 0.16 * i) / 0.22, 0, 1);
        if (kk <= 0) return;
        const yy = 456 + i * 24;
        g.globalAlpha = pk * kk;
        text(l, 72, yy, 12, P.text, "left", 700);
        const drop = (1 - U.easeOutBack(kk)) * -14;
        text(typeof n === "number" ? "+" + n : n, 272, yy + drop, 14, P.or, "right", 900);
        BE.Render.coinIcon(284, yy + drop, 5);
        if (typeof n === "number") sum += n;
      });
      const tk = U.clamp((base - 0.2 - 0.16 * lines.length) / 0.25, 0, 1);
      g.globalAlpha = pk * tk;
      g.fillStyle = U.rgba(P.or, 0.3); g.fillRect(72, 432 + h - 38, 216, 1);
      text("Total", 72, 432 + h - 20, 12, P.dim, "left", 800);
      text("+" + sum + " or", 288, 432 + h - 20, 15, P.or, "right", 900);
      g.globalAlpha = 1;
    }
  };
  SCREENS.VIDANGE = function (st, run) {
    const V = st.play.vid;
    const k = U.clamp(st.sceneT / 0.3, 0, 1);
    g.globalAlpha = k;
    neon("VIDANGE", 180, 240, 30, P.givre, st.time);
    text("Fin de la Lune " + run.lune + (V && V.kept ? " : les petites étoiles s'évaporent" : " : le bocal se renverse"), 180, 272, 12, P.dim, "center", 700);
    if (V && V.kept && !V.n) text("Soleils et plus restent au bocal (sans or)", 180, 292, 10, P.dim, "center", 700);
    if (V && V.n) {
      const kk = U.clamp((st.sceneT - 0.5) / 0.3, 0, 1);
      g.globalAlpha = kk;
      text("+" + V.n + " or", 172, 304, 18, P.or, "center", 900);
      BE.Render.coinIcon(172 + measure("+" + V.n + " or", 18, 900) / 2 + 12, 304, 7);
      text("étoiles Soleil et plus", 180, 326, 10, P.dim, "center", 700);
    }
    g.globalAlpha = 1;
  };
  SCREENS.RUN_LOST = function (st, run) {
    const k = U.clamp((st.sceneT - 0.6) / 0.6, 0, 1);
    if (k <= 0) return;
    g.globalAlpha = k * 0.65; veil(1); g.globalAlpha = k;
    const R = run.result || {};
    text("LA NUIT T'A EMPORTÉ(E)", 180, 292 - (1 - k) * 10, 20, P.text, "center", 900);
    text(R.cause === "overflow" ? "Débordement" : R.cause === "abandon" ? "Run abandonné" : "Quota manqué de " + U.fmt(R.deficit || 0), 180, 322, 13, P.danger, "center", 800);
    g.globalAlpha = 1;
  };
  SCREENS.RUN_WON = function (st) {
    const k = U.clamp(st.sceneT / 0.5, 0, 1);
    g.globalAlpha = k * 0.5; veil(1); g.globalAlpha = k;
    const s = 0.6 + 0.4 * U.easeOutBack(k);
    g.save(); g.translate(180, 290); g.scale(s, s); neon("VICTOIRE", 0, 0, 44, P.or, st.time); g.restore();
    text("L'Éclipse s'est dissipée", 180, 330, 13, P.text, "center", 700);
    g.globalAlpha = 1;
  };

  // ---------------------------------------------------------------- fin de run (§10.7)
  SCREENS.RUN_END = function (st, run) {
    const t = st.time, T = st.sceneT, k = U.clamp(T / 0.4, 0, 1);
    const R = run.result || {};
    const E = st.ui.endSummary || { total: 0, lines: [], defis: [] };
    g.globalAlpha = k;
    const y0 = 84;
    if (R.won) {
      glowAt(180, y0, 120, P.or, 0.25);
      neon("VICTOIRE", 180, y0 - 4, 38, P.or, t);
    } else {
      if (run.nuitBlanche) fitText("FIN DE LA NUIT BLANCHE", 180, y0 - 8, 320, 20, P.frag, "center", 900);
      else fitText("LA NUIT T'A EMPORTÉ(E)", 180, y0 - 8, 320, 20, P.text, "center", 900);
      text("Lune " + R.lune + ", " + D.NIGHT_NAMES[R.nuit || 0], 180, y0 + 14, 12, P.dim, "center", 700);
    }
    const cause = R.won ? "L'Éclipse s'est dissipée." : R.cause === "overflow" ? "Débordement" : R.cause === "abandon" ? "Run abandonné" : "Quota manqué de " + U.fmt(R.deficit || 0);
    text(cause, 180, y0 + 34, 13, R.won ? P.text : P.danger, "center", 800);
    const gd = D.GARDIEN_BY_ID && D.GARDIEN_BY_ID[run.gardien];
    text((gd ? gd.nom : "") + (run.eclipse ? " · Éclipse " + run.eclipse : "") + (run.daily ? " · Ciel du Jour" : "") + (run.nuitBlanche ? " · Nuit Blanche" : "") + " · " + run.seed, 180, y0 + 52, 9, U.rgba(P.dim, 0.8), "center", 700);
    // --- meilleur tir
    const b = run.runStats.bestShot;
    const by = y0 + 66;
    panelBox(24, by, 312, 66);
    text("MEILLEUR TIR", 180, by + 14, 9, P.dim, "center", 800);
    if (b) {
      const bk = U.easeOutCubic(U.clamp((T - 0.2) / 0.6, 0, 1));
      const parts = [[U.fmt(Math.floor(b.eclat)), P.eclat], [" × ", P.text], [U.fmtMult(b.mult), P.mult], [" = ", P.text], [U.fmt(Math.round(b.lumiere * bk)), "#ffffff"]];
      let fs = 22;
      const widthAt = (s) => { g.font = "900 " + s + "px " + D.FONT; return parts.reduce((a, p) => a + g.measureText(p[0]).width, 0) + 26; };
      while (widthAt(fs) > 296 && fs > 12) fs -= 1;
      const w = widthAt(fs);
      let x = 180 - w / 2;
      const yy = by + 42;
      g.fillStyle = P.eclat; rr(x, yy - 5, 10, 10, 2); g.fill(); x += 13;
      parts.forEach(([s, c], i) => {
        if (i === 2) { g.fillStyle = P.mult; rr(x, yy - 5, 10, 10, 2); g.fill(); x += 13; }
        g.font = "900 " + fs + "px " + D.FONT; g.fillStyle = c; g.textAlign = "left"; g.textBaseline = "middle"; g.fillText(s, x, yy); x += g.measureText(s).width;
      });
    } else text("—", 180, by + 42, 20, P.dim, "center", 900);
    // --- statistiques (3 × 2)
    const S = run.runStats;
    const stats = [
      ["Fusions", S.merges, P.mult], ["Plus grosse", S.maxSize ? D.SIZES[S.maxSize].nom : "—", P.givre], ["Ombres tuées", S.kills, P.ombreLine],
      ["Réactions", S.reactions, P.seve], ["Or gagné", S.gold, P.or], ["Lumière", U.fmt(S.lightTotal), "#ffffff"],
    ];
    const sy = by + 80;
    stats.forEach(([l, v, c], i) => {
      const col = i % 3, row = Math.floor(i / 3);
      const x = 30 + col * 102, y = sy + row * 40;
      const sk = U.clamp((T - 0.3 - i * 0.05) / 0.3, 0, 1);
      g.globalAlpha = k * sk;
      g.fillStyle = "rgba(18,24,50,0.7)"; rr(x, y, 96, 34, 8); g.fill();
      g.fillStyle = c; rr(x, y + 6, 2.5, 22, 1.2); g.fill();
      text(l, x + 10, y + 11, 9, P.dim, "left", 700);
      fitText(String(v), x + 10, y + 25, 82, 13, P.text, "left", 900);
    });
    g.globalAlpha = k;
    // --- Fragments : lignes qui tombent une à une (mise en page adaptée pour ne jamais passer sous les boutons)
    const fy = sy + 86;
    const lines = E.lines.slice(0, 5);
    const allDefis = (E.defis || []).map((id) => (D.DEFIS.find((d) => d.id === id) || { nom: id }));
    const nr = BE.Meta ? BE.Meta.nextRoom() : null;
    const avail = (nr ? 482 : 508) - fy;
    let lh = 18, dh = 15, nd = Math.min(3, allDefis.length);
    const fhOf = () => (nd ? 88 + lines.length * lh + (nd - 1) * dh : 58 + lines.length * lh);
    for (const [a, b] of [[18, 15], [16, 13], [15, 12]]) { lh = a; dh = b; if (fhOf() <= avail) break; }
    while (fhOf() > avail && nd > 1) nd--;
    const defis = allDefis.slice(0, nd);
    const fh = fhOf();
    panelBox(24, fy, 312, fh, U.rgba(P.frag, 0.45));
    text("FRAGMENTS ◇", 180, fy + 16, 10, P.frag, "center", 900);
    let landed = 0;
    lines.forEach((ln, i) => {
      const kk = U.clamp((T - 0.6 - i * 0.28) / 0.25, 0, 1);
      if (kk >= 1) landed++;
      g.globalAlpha = kk * k;
      const drop = (1 - U.easeOutBack(kk)) * -12;
      text(ln.txt, 44, fy + 36 + i * lh + drop, 11, P.text, "left", 600);
      text("+" + ln.n + " ◇", 316, fy + 36 + i * lh + drop, 11, P.frag, "right", 900);
    });
    if (landed > (UI.fragTicks || 0)) { UI.fragTicks = landed; if (BE.Audio) BE.Audio.play("tick", { step: landed * 2 }); }
    const tk = U.clamp((T - 0.6 - lines.length * 0.28) / 0.5, 0, 1);
    g.globalAlpha = k;
    const ty = fy + 36 + lines.length * lh + 4;
    g.fillStyle = U.rgba(P.frag, 0.25); g.fillRect(44, ty - 10, 272, 1);
    text("Total", 44, ty + 4, 12, P.dim, "left", 800);
    const shownTot = Math.round(E.total * U.easeOutCubic(tk));
    const pop = tk >= 1 ? 1 + 0.15 * Math.max(0, 1 - (T - 0.6 - lines.length * 0.28 - 0.5) / 0.25) : 1;
    g.save(); g.translate(316, ty + 4); g.scale(pop, pop); text("+" + shownTot + " ◇", 0, 0, 15, P.frag, "right", 900); g.restore();
    if (defis.length) {
      const dk = U.clamp((T - 0.9 - lines.length * 0.28) / 0.35, 0, 1);
      g.globalAlpha = k * dk;
      text(allDefis.length > 1 ? "DÉFIS RÉUSSIS" : "DÉFI RÉUSSI", 180, ty + 22, 8.5, P.or, "center", 900);
      defis.forEach((d, i) => {
        const more = i === defis.length - 1 && allDefis.length > defis.length ? "  (+" + (allDefis.length - defis.length) + ")" : "";
        fitText("✓ " + (d.nom || d.txt || d.id) + more, 180, ty + 36 + i * dh, 280, 10, P.text, "center", 700);
      });
      g.globalAlpha = k;
    }
    // --- prochaine salle
    const ny = fy + fh + 16;
    if (nr) {
      text(BE.Meta.nextRoomText ? BE.Meta.nextRoomText(nr) : "Encore " + nr.need + " ◇ : " + nr.room.nom, 180, ny, 11, P.frag, "center", 800);
      g.fillStyle = "rgba(199,166,255,0.15)"; rr(70, ny + 10, 220, 5, 2.5); g.fill();
      g.fillStyle = P.frag; rr(70, ny + 10, Math.max(5, 220 * U.clamp(1 - nr.need / nr.room.cost, 0, 1)), 5, 2.5); g.fill();
    }
    g.globalAlpha = 1;
    // --- boutons (ancrés en bas)
    const bk = U.clamp((T - 0.5) / 0.3, 0, 1);
    if (BE.Run.nuitBlanche && BE.Run.nuitBlanche(run)) {
      // victoire + Planétarium : on peut continuer en Nuit Blanche (Lunes infinies)
      UI.button({ id: "nuitBlanche", x: 24, y: 520, w: 152, h: 56, label: "Nuit Blanche", sub: "continuer · Lune " + (run.lune + 1), style: "frag", alpha: bk, size: 15,
        icon: (gg, x, y) => { gg.fillStyle = "#f3ecff"; gg.beginPath(); gg.arc(x, y, 6, 0, TAU); gg.fill(); gg.fillStyle = "#3a2a6a"; gg.beginPath(); gg.arc(x + 3, y - 2, 5, 0, TAU); gg.fill(); },
        onTap: () => BE.Run.startNuitBlanche() });
      UI.button({ id: "replay", x: 184, y: 520, w: 152, h: 56, label: "Rejouer", sub: "même Gardien" + (run.gardien === "astronome" || run.gardien === "insomniaque" ? "" : "ne"), style: "gold", alpha: bk,
        onTap: () => BE.Run.startNewRun({ gardien: run.gardien, eclipse: run.eclipse }) });
      UI.button({ id: "share", x: 24, y: 584, w: 152, h: 48, label: "Partager", style: "eclat", size: 14, alpha: bk, onTap: () => share(run) });
      UI.button({ id: "menu", x: 184, y: 584, w: 152, h: 48, label: "Menu", style: "ghost", size: 14, alpha: bk, onTap: () => BE.Run.toTitle() });
      return;
    }
    UI.button({ id: "replay", x: 24, y: 520, w: 152, h: 56, label: "Rejouer", sub: run.daily ? "Ciel du Jour" : (run.gardien === "astronome" || run.gardien === "insomniaque" ? "même Gardien" : "même Gardienne"), style: "gold", alpha: bk,
      onTap: () => (run.daily && BE.Meta.startDaily ? BE.Meta.startDaily() : BE.Run.startNewRun({ gardien: run.gardien, eclipse: run.eclipse })) });
    UI.button({ id: "share", x: 184, y: 520, w: 152, h: 56, label: "Partager", sub: "grille du run", style: "eclat", alpha: bk, onTap: () => share(run) });
    UI.button({ id: "menu", x: 100, y: 584, w: 160, h: 48, label: "Menu", style: "ghost", size: 14, alpha: bk, onTap: () => BE.Run.toTitle() });
  };
  function share(run) {
    if (BE.Meta && BE.Meta.share) { BE.Meta.share(run); return; } // presse-papiers + partage natif (14_meta.js)
    const txt = BE.Meta ? BE.Meta.shareText(run) : "BOCAL D'ÉTOILES";
    try {
      if (navigator.share) { navigator.share({ text: txt }).catch(() => {}); return; }
      if (navigator.clipboard) { navigator.clipboard.writeText(txt).then(() => UI.toast("Copié dans le presse-papiers"), () => UI.toast("Partage indisponible")); return; }
    } catch (e) { /* */ }
    UI.toast("Partage indisponible");
  }

  // ================================================================ Aube (boutique, §10.5)
  function shopReroll() {
    const run = BE.state.run;
    const r = BE.Shop.reroll(run);
    if (!r || !r.ok) { BE.emit("ui:no", {}); UI.toast("Pas assez d'or"); }
    else { UI.sel = null; BE.emit("ui:ok", {}); }
  }
  function tryBuy(i) {
    const run = BE.state.run;
    const o = run.shop.offers[i];
    const r = BE.Shop.buy(run, i);
    if (r.ok) {
      UI.sel = null; BE.emit("ui:ok", {});
      const c = cardPos(i);
      BE.FX.burst(c.x + c.w / 2, c.y + c.h / 2, 16, { speed: 150, color: o && o.kind === "relic" ? D.RARITY[D.RELIC_BY_ID[o.id].rar].color : P.or, glow: true, life: 0.55 });
      if (o && o.kind === "relic") UI.newRelicAt = now();
      return;
    }
    if (BE.Shop.View && BE.Shop.View.need(i, r)) return; // clou / gravure : sélecteur (10_shop.js)
    BE.emit("ui:no", {});
    if (r.reason === "gold") UI.toast("Pas assez d'or");
    else if (r.reason === "full") { UI.toast("Emplacements pleins : vends une relique"); UI.sel = { kind: "relic", i: 0, t: now() }; }
    else if (r.reason === "bagFull") UI.toast("Le Sac est plein (" + D.ECO.bagMax + ")");
  }
  UI.shopBuy = tryBuy; UI.shopReroll = shopReroll;

  const CARD = { w: 96, h: 128, gap: 12, y: 114 };
  function cardPos(i) {
    const x0 = (D.W - (CARD.w * 3 + CARD.gap * 2)) / 2;
    return { x: x0 + i * (CARD.w + CARD.gap), y: CARD.y, w: CARD.w, h: CARD.h };
  }
  function slotLayout(run) {
    const n = run.rules.relicSlots;
    const sp = Math.min(60, 320 / n);
    const xs = [];
    for (let k = 0; k < n; k++) xs.push(180 + (k - (n - 1) / 2) * sp);
    return { n, sp, xs, y: 368 };
  }
  /** Ordre des reliques tel qu'il serait si on lâchait la relique glissée maintenant. */
  function dragTarget(run) {
    const d = UI.drag, L = slotLayout(run);
    let best = 0, bd = 1e9;
    for (let k = 0; k < run.relics.length; k++) { const dd = Math.abs(L.xs[k] - d.x); if (dd < bd) { bd = dd; best = k; } }
    return best;
  }
  function dragOrder(run) {
    const d = UI.drag;
    if (!d || !d.active) return run.relics.slice();
    const list = run.relics.slice();
    const [r] = list.splice(d.from, 1);
    list.splice(dragTarget(run), 0, r);
    return list;
  }
  function dropRelic(d) {
    const run = BE.state.run;
    if (!run || BE.state.scene !== "SHOP") return;
    UI.drag = d; // pour dragTarget
    const to = dragTarget(run);
    UI.drag = null;
    const r = run.relics[d.from];
    if (r) relicX.set(r, d.x);
    if (to !== d.from) { BE.Shop.moveTo(run, d.from, to); BE.emit("ui:ok", {}); }
    else BE.emit("ui:tap", {});
    UI.snapAt = now();
  }
  function lastScore(run, relics) {
    if (!run.lastCtx || !BE.Score) return null;
    try { return BE.Score.compute(run.lastCtx, relics); } catch (e) { return null; }
  }

  SCREENS.SHOP = function (st, run) {
    const t = st.time;
    const S = run.shop;
    if (!S) return;
    const R = run.lastReward;
    const since = t - UI.shopT;
    // --- aube : dégradé chaud et soleil levant
    const dg = g.createLinearGradient(0, 0, 0, 300);
    dg.addColorStop(0, "rgba(255,150,110,0.20)"); dg.addColorStop(0.5, "rgba(255,120,150,0.06)"); dg.addColorStop(1, "rgba(255,160,120,0)");
    const E = BE.Render.ext; // l'aube colore aussi le haut de l'écran (au-delà de la zone 360 × 640)
    g.fillStyle = dg; g.fillRect(E.x0, Math.min(0, E.y0), E.w, 300 - Math.min(0, E.y0));
    glowAt(180, -30 + 8 * Math.sin(t * 0.4), 150, "#ff9a6a", 0.22);
    // --- en-tête
    text("AUBE", 180, 26, 22, "#ffd6b0", "center", 900);
    goldChip(run, t);
    if (BE.Shop.View) BE.Shop.View.extras(g, st, run); // Constellation + évolutions (10_shop.js)
    if (R) text("Lune " + R.lune + ", après la " + D.NIGHT_NAMES[R.nuit], 180, 50, 11 * ts(), P.dim, "center", 700);
    if (R) rewardLine(R, since);
    const nextN = run.nuit < 2 ? run.nuit + 1 : 0, nextL = run.nuit < 2 ? run.lune : run.lune + 1;
    let nextTxt = "Prochaine : " + D.NIGHT_NAMES[nextN] + (nextL !== run.lune ? " (Lune " + nextL + ")" : "");
    const boss = nextN === 2 && run.firm.bossId ? D.BOSSES[run.firm.bossId] : null;
    if (boss) nextTxt += " — " + boss.nom;
    fitText(nextTxt, 180, 86, 330, 10.5 * ts(), boss ? boss.color : P.dim, "center", 800);
    if (boss) fitText(boss.rule, 180, 100, 330, 9.5 * ts(), U.rgba(boss.color, 0.8), "center", 600, 8);
    // --- offres
    S.offers.forEach((o, i) => {
      const c = cardPos(i);
      const ck = U.clamp((t - UI.cardsT - i * 0.08) / 0.34, 0, 1);
      const selected = !!(UI.sel && UI.sel.kind === "offer" && UI.sel.i === i);
      const lift = selected ? -6 : 0;
      const y = c.y + Math.sin(t * 1.5 + i) * 1.2 + lift;
      g.save();
      const fx = Math.max(0.02, U.easeOutBack(ck));
      g.translate(c.x + c.w / 2, y + c.h / 2); g.scale(fx, 1); g.translate(-c.x - c.w / 2, -y - c.h / 2);
      g.globalAlpha = U.clamp(ck * 2, 0, 1);
      drawCard(o, c.x, y, c.w, c.h, run, selected, S.locked === i, "offer" + i, t);
      // §9.1 : une relique compte comme découverte dès qu'elle est VUE (carte retournée), pas seulement achetée
      if (o.kind === "relic" && ck > 0.6 && BE.Meta && BE.Meta.discover) BE.Meta.discover("relics", o.id);
      g.restore();
      g.globalAlpha = 1;
      if (isFocused("offer" + i)) focusRing(c.x, y, c.w, c.h, 12);
      if (!o.sold) {
        region("offer" + i, c.x, c.y - 6, c.w, c.h + 6, () => { UI.sel = selected ? null : { kind: "offer", i, t: now() }; });
        // cadenas (cible 48×48, en bas à droite de la carte)
        region("lock" + i, c.x + c.w - 44, c.y + c.h - 44, 48, 48, () => { BE.Shop.lock(run, i); UI.lockAt = now(); UI.lockI = i; }, false);
      }
    });
    // --- boutons
    // rangée d'achats : Constellation (dessinée par Shop.View.extras) · Relancer · Sac
    const packW = S.pack ? 114 : 0;
    const bw3 = S.pack ? 108 : 150, bx3 = S.pack ? 12 + packW : 24;
    UI.button({ id: "reroll", x: bx3, y: 254, w: bw3, h: 48, label: "Relancer", sub: S.rerollCost + " or", style: "primary", size: 14,
      disabled: run.gold < S.rerollCost, whyDisabled: "Pas assez d'or", onTap: shopReroll, icon: iconReroll });
    UI.button({ id: "bag", x: S.pack ? bx3 + bw3 + 6 : 186, y: 254, w: bw3, h: 48, label: "Sac", sub: run.bag.length + " étoiles", style: "ghost", size: 14,
      onTap: () => UI.openPanel(BE.Shop.View ? "shopBag" : "bag") });
    // --- reliques possédées (glisser-déposer aimanté)
    drawRelicSlots(st, run, t);
    // --- Sac et progression
    if (!UI.sel) {
      drawMiniBag(run, 180, 436);
      const nb = run.bag.length > 10 ? 1 : 0;
      BE.Render.drawLuneTrack(run, 180, 506 + nb * 8, { afterWin: true, sp: 60 });
      const nq = D.quota(nextL, nextN, run.eclipse);
      text("Prochain quota : " + U.fmt(nq), 180, 548 + nb * 4, 10 * ts(), P.or, "center", 800);
      UI.button({ id: "nextNight", x: 40, y: 570, w: 280, h: 56, label: "Nuit suivante", sub: D.NIGHT_NAMES[nextN] + (boss ? " — " + boss.nom : ""), style: "gold",
        onTap: () => { UI.sel = null; BE.Run.leaveShop(); } });
      if (!BE.Input.isTouch()) text("R relancer · L garder · Q/E déplacer · Espace : nuit suivante", 180, 633, 8, U.rgba(P.dim, 0.7), "center", 700);
    } else drawDetail(st, run);
  };

  function goldChip(run, t) {
    if (UI.lastGold === undefined) UI.lastGold = run.gold;
    if (run.gold !== UI.lastGold) { UI.goldDelta = run.gold - UI.lastGold; UI.goldAt = t; UI.lastGold = run.gold; }
    const bk = U.clamp((t - (UI.goldAt || -9)) / 0.35, 0, 1);
    const pop = 1 + 0.18 * Math.sin(bk * Math.PI) * (bk < 1 ? 1 : 0);
    g.save(); g.translate(312, 24); g.scale(pop, pop);
    g.fillStyle = "rgba(18,24,50,0.92)"; rr(-38, -14, 76, 28, 14); g.fill();
    g.strokeStyle = U.rgba(P.or, 0.6); g.lineWidth = 1; rr(-38, -14, 76, 28, 14); g.stroke();
    BE.Render.coinIcon(-20, 0, 7);
    text(String(run.gold), 12, 0.5, 15, P.or, "center", 900);
    g.restore();
    if (bk < 1 && UI.goldDelta) {
      g.globalAlpha = 1 - bk;
      text((UI.goldDelta > 0 ? "+" : "") + UI.goldDelta, 312, 48 + bk * 10, 11, UI.goldDelta > 0 ? P.or : P.danger, "center", 900);
      g.globalAlpha = 1;
    }
  }
  /** « Nuit +4 · Tirs restants +2 · Intérêts +3 » : chaque part tombe en pièce, l'une après l'autre. */
  function rewardLine(R, since) {
    const parts = [["Nuit", R.night], ["Tirs restants", R.shots], ["Intérêts", R.interest]];
    if (R.grace) parts.splice(2, 0, ["Apprentissage", 0]); // tirs d'apprentissage inutilisés : non payés
    if (R.vidange) parts.push(["Vidange", R.vidange]);
    const fs = (parts.length > 3 ? 9.5 : 10.5) * ts();
    g.font = "800 " + fs + "px " + D.FONT;
    const sep = "  ·  ";
    const ws = parts.map(([l, n]) => g.measureText(l + " +" + n).width + 10);
    const sw = g.measureText(sep).width;
    let total = ws.reduce((a, b) => a + b, 0) + sw * (parts.length - 1);
    const sc = total > 340 ? 340 / total : 1;
    g.save(); g.translate(180, 68); g.scale(sc, sc);
    let x = -total / 2;
    let landed = 0;
    parts.forEach(([l, n], i) => {
      const k = U.clamp((since - 0.15 - i * 0.22) / 0.3, 0, 1);
      if (k >= 1) landed++;
      g.globalAlpha = U.clamp(k * 3, 0, 1);
      g.font = "800 " + fs + "px " + D.FONT; g.textAlign = "left"; g.textBaseline = "middle";
      g.fillStyle = "#e9dcc8"; g.fillText(l + " ", x, 0);
      const lw = g.measureText(l + " ").width;
      g.fillStyle = P.or; g.font = "900 " + fs + "px " + D.FONT; g.fillText("+" + n, x + lw, 0);
      const cw = g.measureText("+" + n).width;
      const drop = (1 - U.easeOutBack(k)) * -18;
      BE.Render.coinIcon(x + lw + cw + 6, drop, 3.8);
      x += ws[i];
      if (i < parts.length - 1) { g.globalAlpha = 0.6; g.fillStyle = P.dim; g.fillText(sep, x, 0); x += sw; }
    });
    g.restore(); g.globalAlpha = 1;
    if (landed > UI.rewardSeen) { UI.rewardSeen = landed; if (BE.Audio && since < 3) BE.Audio.play("coin"); }
  }
  function iconReroll(gg, x, y) {
    gg.save(); gg.translate(x, y); gg.rotate(now() * 0 + (now() - (UI.cardsT || 0) < 0.4 ? (now() - UI.cardsT) * 15 : 0));
    gg.strokeStyle = "#eef2ff"; gg.lineWidth = 2; gg.beginPath(); gg.arc(0, 0, 6, 0.4, Math.PI * 1.7); gg.stroke();
    gg.fillStyle = "#eef2ff"; gg.beginPath(); gg.moveTo(6, -5); gg.lineTo(8, 1); gg.lineTo(2, 0); gg.closePath(); gg.fill();
    gg.restore();
  }

  function drawCard(o, x, y, w, h, run, sel, locked, id, t) {
    const pressed = UI.pressId === id, hover = UI.hoverId === id;
    g.save();
    if (pressed || hover) { const s = pressed ? 0.97 : 1.03; g.translate(x + w / 2, y + h / 2); g.scale(s, s); g.translate(-x - w / 2, -y - h / 2); }
    const rar = o.kind === "relic" ? D.RELIC_BY_ID[o.id].rar : "C";
    const border = o.kind === "relic" ? D.RARITY[rar].color : (BE.Shop.View && BE.Shop.View.itemColor ? BE.Shop.View.itemColor(o) : starColor(o));
    const ga = g.globalAlpha;
    if (o.sold) g.globalAlpha = ga * 0.38;
    // halo de rareté
    if (!o.sold && (rar === "PC" || rar === "R" || rar === "L" || sel)) glowAt(x + w / 2, y + h / 2, w * 0.9, sel ? "#eef2ff" : border, (rar === "R" || rar === "L" ? 0.28 : 0.16) + 0.06 * Math.sin(t * 2.5));
    g.fillStyle = "rgba(0,0,0,0.38)"; rr(x, y + 5, w, h, 12); g.fill();
    const gr = g.createLinearGradient(0, y, 0, y + h);
    gr.addColorStop(0, "#1d2656"); gr.addColorStop(1, "#11173a");
    g.fillStyle = gr; rr(x, y, w, h, 12); g.fill();
    // reflet qui balaie les cartes rares
    if ((rar === "R" || rar === "L") && !o.sold) {
      const sw = ((t * 0.5) % 2) - 0.5;
      g.save(); rr(x, y, w, h, 12); g.clip();
      const sx = x + sw * w * 1.6;
      const lg = g.createLinearGradient(sx - 20, y, sx + 20, y + h);
      lg.addColorStop(0, "rgba(255,255,255,0)"); lg.addColorStop(0.5, "rgba(255,255,255,0.10)"); lg.addColorStop(1, "rgba(255,255,255,0)");
      g.fillStyle = lg; g.fillRect(x, y, w, h);
      g.restore();
    }
    g.strokeStyle = sel ? "#eef2ff" : locked ? P.or : border; g.lineWidth = sel ? 2.5 : 1.8; rr(x, y, w, h, 12); g.stroke();
    if (o.sold) {
      // article acheté : icône seule (le tampon dit le reste)
      if (o.kind === "relic") BE.Render.drawRelicIcon(o.id, x + w / 2, y + 40, 36);
      else if (o.kind === "star") BE.Render.drawStar(x + w / 2, y + 40, o.size, o.color, { scale: Math.min(1, 22 / D.SIZES[o.size].r), noFace: true });
      else if (BE.Shop.View && BE.Shop.View.drawItem) BE.Shop.View.drawItem(g, o, x + w / 2, y + 40, 30); // clou, gravure
    } else if (o.kind === "relic") {
      const d = D.RELIC_BY_ID[o.id];
      BE.Render.drawRelicIcon(o.id, x + w / 2, y + 34, 36);
      fitText(d.nom, x + w / 2, y + 66, w - 10, 11, P.text, "center", 800);
      text(D.RARITY[rar].nom.toUpperCase(), x + w / 2, y + 79, 7.5, border, "center", 800);
      const tag = (d.tags || [])[0];
      if (tag) {
        const tc = /xMULT|×/.test(tag) ? P.mult : /MULT/.test(tag) ? P.mult : /ÉCLAT/.test(tag) ? P.eclat : P.dim;
        g.font = "900 7px " + D.FONT; const tw = g.measureText(tag).width + 8;
        g.fillStyle = U.rgba(tc, 0.16); rr(x + w / 2 - tw / 2, y + 86, tw, 11, 5.5); g.fill();
        text(tag, x + w / 2, y + 91.5, 7, tc, "center", 900);
      }
    } else if (BE.Shop.View && BE.Shop.View.cardBody(g, o, x, y, w, h)) { /* clou, gravure (10_shop.js) */
    } else {
      BE.Render.drawStar(x + w / 2, y + 36, o.size, o.color, { scale: Math.min(1, 22 / D.SIZES[o.size].r), seed: 9 + o.size * 17 + Math.round(x), lookX: x + w / 2, lookY: y + 90 });
      fitText("Étoile " + D.FAMILIES[o.color].nom, x + w / 2, y + 68, w - 10, 10.5, P.text, "center", 800);
      text(D.SIZES[o.size].nom.toUpperCase() + " · T" + o.size, x + w / 2, y + 82, 7.5, starColor(o), "center", 800);
    }
    // prix + cadenas
    if (!o.sold) {
      const afford = run.gold >= o.price;
      g.fillStyle = afford ? "rgba(255,209,102,0.16)" : "rgba(255,77,109,0.14)"; rr(x + 8, y + h - 30, 52, 20, 10); g.fill();
      BE.Render.coinIcon(x + 19, y + h - 20, 4.5);
      text(String(o.price), x + 40, y + h - 19.5, 12, afford ? P.or : P.danger, "center", 900);
      const lk = UI.lockI === Array.prototype.indexOf.call(run.shop.offers, o) ? U.clamp((now() - (UI.lockAt || -9)) / 0.3, 0, 1) : 1;
      drawLock(x + w - 20, y + h - 20 - Math.sin(lk * Math.PI) * 4, locked, UI.pressId === id.replace("offer", "lock"));
    } else {
      g.globalAlpha = ga;
      g.save(); g.translate(x + w / 2, y + h / 2 + 6); g.rotate(-0.2);
      g.strokeStyle = U.rgba(P.seve, 0.9); g.lineWidth = 2; rr(-36, -12, 72, 24, 5); g.stroke();
      text("ACHETÉ", 0, 0.5, 12, P.seve, "center", 900);
      g.restore();
    }
    if (locked && !o.sold) {
      g.globalAlpha = ga;
      g.fillStyle = P.or; rr(x + w / 2 - 24, y - 8, 48, 14, 7); g.fill();
      text("GARDÉE", x + w / 2, y - 0.5, 7.5, "#1a1206", "center", 900);
    }
    g.restore();
    g.globalAlpha = ga;
  }
  function starColor(o) { return D.FAMILIES[o.color] ? D.FAMILIES[o.color].color : P.dim; }
  function drawLock(x, y, locked, pressed) {
    const s = pressed ? 0.9 : 1;
    g.save(); g.translate(x, y); g.scale(s, s);
    g.fillStyle = locked ? "rgba(255,209,102,0.18)" : "rgba(138,147,184,0.10)"; g.beginPath(); g.arc(0, 0, 13, 0, TAU); g.fill();
    g.strokeStyle = locked ? P.or : P.dim; g.fillStyle = locked ? P.or : "rgba(138,147,184,0.25)"; g.lineWidth = 1.8;
    g.beginPath();
    if (locked) g.arc(0, -3, 4, Math.PI, 0); else g.arc(0, -5, 4, Math.PI, -0.3);
    g.stroke();
    rr(-6, -2, 12, 9, 2); g.fill();
    if (!locked) { g.strokeStyle = P.dim; g.lineWidth = 1.2; rr(-6, -2, 12, 9, 2); g.stroke(); }
    g.restore();
  }
  function drawMiniBag(run, cx, y) {
    text("SAC · " + run.bag.length + " ÉTOILES", cx, y - 6, 9, P.dim, "center", 800);
    const list = run.bag.slice().sort((a, b) => D.FAMILY_ORDER.indexOf(a.color) - D.FAMILY_ORDER.indexOf(b.color) || a.size - b.size);
    const n = list.length, per = Math.min(n, 10), sp = 26;
    list.forEach((b, k) => {
      const row = Math.floor(k / per), col = k % per;
      const cnt = Math.min(per, n - row * per);
      const x = cx - (cnt - 1) * sp / 2 + col * sp, yy = y + 18 + row * 26;
      BE.Render.drawStar(x, yy, b.size, b.color, { scale: (6 + b.size * 2.4) / D.SIZES[b.size].r, noFace: b.size < 2, seed: b.id * 3, lookX: cx, lookY: y - 40 });
      if (b.grav) { g.fillStyle = P.or; g.beginPath(); g.arc(x + 7, yy - 7, 2.5, 0, TAU); g.fill(); }
    });
  }

  function drawRelicSlots(st, run, t) {
    const L = slotLayout(run);
    const dragging = UI.drag && UI.drag.active;
    text("TES RELIQUES", 180, 318, 9, P.dim, "center", 800);
    text(run.relics.length > 1 ? "glisse pour réordonner · de gauche à droite" : "déclenchées de gauche à droite", 180, 331, 8.5, U.rgba(P.dim, 0.8), "center", 600);
    const order = dragOrder(run);
    const tgt = dragging ? dragTarget(run) : -1;
    // emplacements
    for (let k = 0; k < L.n; k++) {
      const x = L.xs[k], y = L.y;
      const has = k < run.relics.length;
      const sel = !dragging && UI.sel && UI.sel.kind === "relic" && UI.sel.i === k;
      const hot = dragging && k === tgt;
      g.fillStyle = hot ? "rgba(79,139,255,0.18)" : "rgba(18,24,50,0.8)";
      g.strokeStyle = sel ? "#eef2ff" : hot ? "#5a78ff" : P.line; g.lineWidth = sel || hot ? 2 : 1;
      if (!has) g.setLineDash([3, 3]);
      rr(x - 26, y - 26, 52, 52, 12); g.fill(); g.stroke(); g.setLineDash([]);
      if (!has) text(String(k + 1), x, y, 12, P.line, "center", 800);
      if (isFocused("relic" + k)) focusRing(x - 26, y - 26, 52, 52, 12);
    }
    // icônes (position animée : les voisines glissent pour laisser la place, aimant au centre)
    const dt = st.frameDt || 0.016;
    let dragged = null;
    order.forEach((r, k) => {
      const isDragged = dragging && r === run.relics[UI.drag.from];
      let tx = L.xs[k];
      if (isDragged) {
        let x = U.clamp(UI.drag.x, L.xs[0] - 20, L.xs[run.relics.length - 1] + 20);
        const c = L.xs[tgt];
        if (Math.abs(x - c) < 16) x = U.lerp(x, c, 0.6); // aimantation
        tx = x;
        relicX.set(r, tx);
        dragged = { r, x: tx };
        return;
      }
      const cur = relicX.has(r) ? relicX.get(r) : tx;
      const nx = U.approach(cur, tx, 16, dt);
      relicX.set(r, Math.abs(nx - tx) < 0.3 ? tx : nx);
    });
    order.forEach((r, k) => {
      if (dragged && r === dragged.r) return;
      const x = relicX.get(r), y = L.y;
      const idx = run.relics.indexOf(r);
      const pressed = UI.pressId === "relic" + idx;
      const fresh = UI.newRelicAt && idx === run.relics.length - 1 ? U.clamp((t - UI.newRelicAt) / 0.4, 0, 1) : 1;
      const s = (pressed ? 0.92 : 1) * (0.4 + 0.6 * U.easeOutBack(fresh));
      const d = D.RELIC_BY_ID[r.id];
      if (r.evolved || (d && d.rar === "L")) glowAt(x, y - 4, 34, P.or, 0.3);
      BE.Render.drawRelicIcon(r.id, x, y - 4, 30, { scale: s });
      if (d) fitText(d.nom, x, y + 20, L.sp - 6, 7.5, P.dim, "center", 700, 6);
      void k;
    });
    // régions (une par emplacement occupé)
    if (!dragging) {
      for (let k = 0; k < run.relics.length; k++) {
        const x = L.xs[k];
        const sel = UI.sel && UI.sel.kind === "relic" && UI.sel.i === k;
        region("relic" + k, x - Math.max(24, L.sp / 2), L.y - 28, Math.max(48, L.sp), 56, () => { UI.sel = sel ? null : { kind: "relic", i: k, t: now() }; });
      }
    }
    // relique en main
    if (dragged) {
      const y = L.y - 10 + Math.sin(t * 8) * 1;
      g.fillStyle = "rgba(0,0,0,0.35)"; g.beginPath(); g.ellipse(dragged.x, L.y + 22, 20, 5, 0, 0, TAU); g.fill();
      glowAt(dragged.x, y, 40, "#5a78ff", 0.35);
      BE.Render.drawRelicIcon(dragged.r.id, dragged.x, y, 30, { scale: 1.18 });
    }
    // aperçu chiffré sur le dernier tir
    const cur = lastScore(run, run.relics);
    if (cur) {
      if (dragging) {
        const nw = lastScore(run, order);
        const diff = nw.lumiere - cur.lumiere;
        const col = diff > 0 ? P.seve : diff < 0 ? P.danger : P.dim;
        g.fillStyle = "rgba(10,14,32,0.85)"; rr(60, 398, 240, 20, 10); g.fill();
        fitText("Nouvel ordre : " + U.fmt(cur.lumiere) + " → " + U.fmt(nw.lumiere) + (diff ? (diff > 0 ? "  ▲" : "  ▼") : "  ="), 180, 408.5, 228, 10.5, col, "center", 900);
      } else if (run.relics.length) {
        text("Dernier tir avec ces reliques : " + U.fmt(cur.lumiere), 180, 408, 9.5, U.rgba(P.text, 0.75), "center", 700);
      }
    }
  }

  function drawDetail(st, run) {
    const sel = UI.sel;
    const y0 = 440, h = 200;
    const k = sheetIn(sel.t || (sel.t = st.time), 0.2);
    const y = y0 + (1 - k) * 70;
    g.globalAlpha = k;
    region("sheet", 8, y, 344, h + 10, () => {}, false);
    panelBox(8, y, 344, h + 10);
    g.fillStyle = U.rgba(P.dim, 0.5); rr(160, y + 6, 40, 4, 2); g.fill();
    if (sel.kind === "offer") {
      const o = run.shop.offers[sel.i];
      if (!o || o.sold) { UI.sel = null; g.globalAlpha = 1; return; }
      let title, desc, sub, col = P.text;
      if (o.kind === "relic") {
        const d = D.RELIC_BY_ID[o.id];
        title = d.nom; desc = d.txt; sub = D.RARITY[d.rar].nom + " · " + (d.tags || []).join(" "); col = D.RARITY[d.rar].color;
      } else if (BE.Shop.View && BE.Shop.View.describe(o)) {
        const dd = BE.Shop.View.describe(o); title = dd.title; desc = dd.desc; sub = dd.sub; col = dd.color;
      } else {
        const F = D.FAMILIES[o.color];
        title = "Étoile " + F.nom + " — " + D.SIZES[o.size].nom; desc = "En vol : " + F.flight + ". Au bocal : " + F.jar + "."; sub = "Ajoutée à ton Sac"; col = F.color;
      }
      fitText(title, 180, y + 26, 320, 16, P.text, "center", 900);
      fitText(sub, 180, y + 45, 320, 9, col, "center", 800);
      const fs = 12 * ts(), lh = 15 * ts();
      let yy = wrap(desc, 180, y + 66, 316, fs, P.text, lh);
      if (o.kind === "relic") previewLine(run, o.id, undefined, yy - 2, "Sur ton dernier tir");
      const full = o.kind === "relic" && run.relics.length >= run.rules.relicSlots;
      UI.button({ id: "buy", x: 22, y: y + h - 66, w: 200, h: 56, label: full ? "Pleins : vendre une relique ?" : "Acheter", sub: o.price + " or", style: "gold", size: full ? 12.5 : 17,
        disabled: run.gold < o.price && !full, whyDisabled: "Pas assez d'or",
        onTap: () => (full ? (UI.sel = { kind: "relic", i: 0, t: st.time }) : tryBuy(sel.i)) });
      UI.button({ id: "close", x: 230, y: y + h - 66, w: 108, h: 56, label: "Fermer", style: "ghost", size: 14, onTap: () => { UI.sel = null; } });
    } else {
      const r = run.relics[sel.i];
      if (!r) { UI.sel = null; g.globalAlpha = 1; return; }
      const d = D.RELIC_BY_ID[r.id];
      BE.Render.drawRelicIcon(r.id, 40, y + 34, 26);
      fitText(d.nom, 180, y + 26, 220, 16, P.text, "center", 900);
      text(D.RARITY[d.rar].nom + " · emplacement " + (sel.i + 1), 180, y + 45, 9, D.RARITY[d.rar].color, "center", 800);
      const fs = 12 * ts(), lh = 15 * ts();
      let yy = wrap(d.txt, 180, y + 66, 316, fs, P.text, lh);
      if (d.count) yy = previewLine(run, r.id, sel.i, yy - 2, "Son apport sur ton dernier tir");
      const ev = BE.Shop.evolutionProgress ? BE.Shop.evolutionProgress(run, r.id) : null;
      if (ev && !r.evolved && yy < y + 124) text("Évolution : " + ev.n + " / " + ev.need + " " + (D.REACTIONS[ev.evo.reaction] ? D.REACTIONS[ev.evo.reaction].nom : ""), 180, yy + 8, 9.5, P.or, "center", 800);
      const sp = BE.Shop.sellPrice(run, r.id);
      const confirming = UI.confirm === "sell" + sel.i;
      UI.button({ id: "left", x: 22, y: y + h - 66, w: 56, h: 56, label: "◀", style: "ghost", disabled: sel.i === 0, onTap: () => { sel.i = BE.Shop.move(run, sel.i, -1); UI.confirm = null; } });
      UI.button({ id: "right", x: 84, y: y + h - 66, w: 56, h: 56, label: "▶", style: "ghost", disabled: sel.i >= run.relics.length - 1, onTap: () => { sel.i = BE.Shop.move(run, sel.i, 1); UI.confirm = null; } });
      UI.button({ id: "sell", x: 148, y: y + h - 66, w: 190, h: 56, label: confirming ? "Confirmer la vente" : "Vendre", sub: "+" + sp + " or", style: "danger", size: confirming ? 14 : 16,
        onTap: () => {
          if (!confirming) { UI.confirm = "sell" + sel.i; return; }
          UI.confirm = null; BE.Shop.sell(run, sel.i); UI.sel = null; BE.emit("ui:ok", {});
          BE.FX.burst(180, 368, 12, { speed: 120, color: P.or, glow: true, life: 0.5 });
        } });
    }
    g.globalAlpha = 1;
  }
  /** Ligne d'aperçu chiffré (score du dernier tir avant → après). Renvoie le y suivant. */
  function previewLine(run, relicId, removeSlot, y, label) {
    const d = D.RELIC_BY_ID[relicId];
    if (!run.lastCtx) { text("Joue un tir pour voir son effet chiffré", 180, y + 8, 9.5, P.dim, "center", 700); return y + 20; }
    if (!d.count) { text("Effet en vol ou passif : pas d'aperçu chiffré", 180, y + 8, 9.5, P.dim, "center", 700); return y + 20; }
    const pv = BE.Shop.preview(run, relicId, removeSlot);
    if (!pv) return y;
    let a = pv.before, b = pv.after;
    if (removeSlot !== undefined) { a = pv.after; b = pv.before; } // « sans elle → avec elle »
    const diff = b - a;
    const pct = a > 0 ? Math.round(diff / a * 100) : 0;
    const good = diff > 0;
    g.fillStyle = good ? "rgba(110,224,122,0.10)" : "rgba(138,147,184,0.10)"; rr(30, y, 300, 22, 11); g.fill();
    fitText(label + " : " + U.fmt(a) + " → " + U.fmt(b) + (diff ? "  (" + (good ? "+" : "") + pct + " %)" : "  (aucun effet)"), 180, y + 11.5, 290, 10.5, good ? P.seve : P.dim, "center", 900);
    return y + 28;
  }

  // ================================================================ panneaux
  function drawPanel(st, run) {
    const p = UI.panel;
    const k = sheetIn(p.t || 0, 0.18);
    g.globalAlpha = k;
    veil(0.62);
    g.globalAlpha = 1;
    region("panelBg", 0, 0, D.W, D.H, () => { UI.panel = null; UI.confirm = null; }, false);
    if (BE.Shop.View && BE.Shop.View.panel(g, st, run, p)) return; // panneaux de l'Aube (10_shop.js)
    g.save();
    const s = 0.94 + 0.06 * U.easeOutBack(k);
    g.translate(180, 320); g.scale(s, s); g.translate(-180, -320);
    g.globalAlpha = k;
    if (p.type === "bag" && run) drawBagPanel(run);
    else if (p.type === "relics" && run) drawRelicsPanel(run);
    else if (p.type === "settings") drawSettings(st, run);
    else if (p.type === "swapPick" && run) drawSwapPick(st, run);
    g.restore();
    g.globalAlpha = 1;
  }
  function closeBtn(id, x, y) {
    const pressed = UI.pressId === id;
    g.save(); g.translate(x, y); if (pressed) g.scale(0.9, 0.9);
    g.fillStyle = "rgba(18,24,50,0.9)"; g.beginPath(); g.arc(0, 0, 15, 0, TAU); g.fill();
    g.strokeStyle = P.line; g.lineWidth = 1.2; g.stroke();
    g.strokeStyle = P.text; g.lineWidth = 2; g.beginPath(); g.moveTo(-5, -5); g.lineTo(5, 5); g.moveTo(5, -5); g.lineTo(-5, 5); g.stroke();
    g.restore();
    region(id, x - 24, y - 24, 48, 48, () => { UI.panel = null; UI.confirm = null; });
  }
  function drawBagPanel(run) {
    const groups = {};
    const inDraw = {};
    for (const id of (run.draw || []).slice(0, BE.Run.pileLeft(run))) inDraw[id] = 1; // pioche courante seulement (§8.5)
    for (const b of run.bag) {
      const key = b.color + b.size;
      const gr = groups[key] || (groups[key] = { b, n: 0, left: 0, grav: 0 });
      gr.n++; if (inDraw[b.id]) gr.left++; if (b.grav) gr.grav++;
    }
    const list = Object.values(groups).sort((a, b) => D.FAMILY_ORDER.indexOf(a.b.color) - D.FAMILY_ORDER.indexOf(b.b.color) || a.b.size - b.b.size);
    const rows = Math.ceil(list.length / 3);
    const h = Math.min(540, 150 + (rows - 1) * 80);
    const y0 = Math.round(320 - h / 2);
    panelBox(20, y0, 320, h);
    region("panel", 20, y0, 320, h, () => {}, false);
    text("SAC", 180, y0 + 24, 16, P.text, "center", 900);
    const left = BE.Run.pileLeft(run);
    text(run.bag.length + " étoiles · encore " + left + " dans la pioche", 180, y0 + 44, 10, P.dim, "center", 700);
    list.forEach((c, i) => {
      const x = 70 + (i % 3) * 104, y = y0 + 88 + Math.floor(i / 3) * 80;
      const dim = c.left === 0;
      g.globalAlpha = dim ? 0.45 : 1;
      BE.Render.drawStar(x, y, c.b.size, c.b.color, { scale: Math.min(1, 20 / D.SIZES[c.b.size].r), seed: i * 5, lookX: 180, lookY: y0 });
      text("×" + c.n, x + 24, y, 14, P.text, "left", 900);
      g.globalAlpha = 1;
      fitText(D.FAMILIES[c.b.color].nom + " · " + D.SIZES[c.b.size].nom, x + 10, y + 30, 98, 8.5, D.FAMILIES[c.b.color].color, "center", 800, 7);
      if (c.left !== c.n) text(c.left ? c.left + " dans la pioche" : "toutes tirées", x + 10, y + 42, 8, P.dim, "center", 700);
      if (c.grav) { g.fillStyle = P.or; g.beginPath(); g.arc(x + 12, y - 14, 3, 0, TAU); g.fill(); }
    });
    closeBtn("closeP", 318, y0 + 22);
  }
  /** L'Astronome (§6.6) : échange avec n'importe laquelle des 3 étoiles suivantes (1 cible de 64 × 72 chacune). */
  function drawSwapPick(st, run) {
    if (st.scene !== "AIM") { UI.panel = null; return; }
    const nx = BE.Run.nextStars(run), cur = BE.Run.current(run);
    const x0 = 30, w = 300, y0 = 96, h = 196;
    panelBox(x0, y0, w, h, U.rgba(P.eclat, 0.6));
    region("panel", x0, y0, w, h, () => {}, false);
    text("ÉCHANGER AVEC…", 180, y0 + 22, 14, P.text, "center", 900);
    text(run.swapsLeft + " échange" + (run.swapsLeft > 1 ? "s" : "") + " cette nuit", 180, y0 + 40, 10, P.dim, "center", 700);
    const n = nx.length, sw = 76, gap = 12, sx0 = 180 - (n * sw + (n - 1) * gap) / 2;
    nx.forEach((it, i) => {
      const x = sx0 + i * (sw + gap), y = y0 + 58, id = "swapPick" + (i + 1);
      const pressed = UI.pressId === id;
      g.fillStyle = pressed ? "rgba(79,179,255,0.22)" : "rgba(18,24,50,0.85)"; rr(x, y, sw, 84, 12); g.fill();
      g.strokeStyle = isFocused(id) ? "#eef2ff" : U.rgba(P.eclat, 0.55); g.lineWidth = 1.5; rr(x, y, sw, 84, 12); g.stroke();
      BE.Render.drawStar(x + sw / 2, y + 36, it.size, it.color, { scale: Math.min(1, 22 / D.SIZES[it.size].r), seed: it.id * 7, lookX: 180, lookY: 60 });
      text((i + 1) + (i === 0 ? "re" : "e") + " suivante", x + sw / 2, y + 72, 9, P.dim, "center", 800);
      region(id, x, y, sw, 84, () => { UI.panel = null; BE.Run.swap(i + 1); });
    });
    if (cur) text("Étoile courante : " + D.FAMILIES[cur.color].nom + " · " + D.SIZES[cur.size].nom, 180, y0 + 160, 10, P.dim, "center", 700);
    text(BE.Input.isTouch() ? "Touche une étoile" : "Touche 1, 2 ou 3", 180, y0 + 178, 9, U.rgba(P.dim, 0.8), "center", 700);
  }
  function drawRelicsPanel(run) {
    const n = Math.max(1, run.relics.length);
    const h = 96 + n * 64;
    const y0 = Math.max(56, Math.round(320 - h / 2));
    panelBox(16, y0, 328, h);
    region("panel", 16, y0, 328, h, () => {}, false);
    text("RELIQUES", 180, y0 + 24, 16, P.text, "center", 900);
    text("déclenchées de gauche à droite au décompte", 180, y0 + 43, 9.5, P.dim, "center", 700);
    run.relics.forEach((r, i) => {
      const d = D.RELIC_BY_ID[r.id], y = y0 + 84 + i * 64;
      g.fillStyle = "rgba(18,24,50,0.6)"; rr(26, y - 28, 308, 58, 10); g.fill();
      BE.Render.drawRelicIcon(r.id, 52, y, 30);
      text((i + 1) + ". " + d.nom, 78, y - 13, 12, P.text, "left", 900);
      text(D.RARITY[d.rar].nom, 322, y - 13, 8, D.RARITY[d.rar].color, "right", 800);
      wrap(d.txt, 78, y + 5, 246, 10 * ts(), P.dim, 12.5 * ts(), "left", 600);
    });
    if (!run.relics.length) text("Aucune relique pour l'instant : l'Aube en propose.", 180, y0 + 82, 11, P.dim, "center", 600);
    closeBtn("closeP", 322, y0 + 22);
  }

  // ---------------------------------------------------------------- réglages (§10.10)
  function saveSettings() {
    try {
      if (BE.Audio && BE.Audio.applySettings) BE.Audio.applySettings();
      if (BE.state.meta) BE.Save.saveMeta(BE.state.meta);
      if (BE.Run.invalidatePassives) BE.Run.invalidatePassives();
      const S = BE.state.play;
      if (S && S.aim) S.aim.dirty = true;
    } catch (e) { console.error(e); }
  }
  let slideRow = null;
  function slideTo(x) {
    const s = UI.slide;
    if (!s) return;
    const v = U.clamp((x - s.x) / s.w, 0, 1);
    settings()[s.key] = Math.round(v * 20) / 20;
    if (BE.Audio && BE.Audio.applySettings) BE.Audio.applySettings();
  }
  function sliderRow(key, label, y, max) {
    const s = settings();
    const v = U.clamp((s[key] || 0) / (max || 1), 0, 1);
    text(label, 40, y, 13, P.text, "left", 700);
    const tx = 176, tw = 124;
    g.fillStyle = "#232a52"; rr(tx, y - 3, tw, 6, 3); g.fill();
    const gr = g.createLinearGradient(tx, 0, tx + tw, 0);
    gr.addColorStop(0, P.eclat); gr.addColorStop(1, P.frag);
    g.fillStyle = gr; rr(tx, y - 3, Math.max(6, tw * v), 6, 3); g.fill();
    const act = UI.slide && UI.slide.key === key;
    g.fillStyle = "#eef2ff"; g.beginPath(); g.arc(tx + tw * v, y, act ? 11 : 9, 0, TAU); g.fill();
    g.strokeStyle = P.eclat; g.lineWidth = 2; g.stroke();
    text(v === 0 ? "coupé" : Math.round(v * 100) + " %", 322, y, 10, v === 0 ? P.danger : P.dim, "right", 800);
    const id = "sl_" + key;
    if (isFocused(id)) focusRing(tx - 12, y - 16, tw + 24, 32, 10);
    region(id, tx - 16, y - 22, tw + 32, 44, () => {}, true, {
      slider: { key, x: tx, w: tw },
      adjust: (dir) => { s[key] = U.clamp(Math.round(((s[key] || 0) + dir * 0.1) * 10) / 10, 0, max || 1); saveSettings(); },
    });
  }
  function toggleRow(key, label, y, sub, invert) {
    const s = settings();
    const on = invert ? !s[key] : !!s[key];
    const id = "tg_" + key;
    const pressed = UI.pressId === id;
    if (pressed || UI.hoverId === id) { g.fillStyle = "rgba(255,255,255,0.04)"; rr(28, y - 21, 304, 42, 10); g.fill(); }
    text(label, 40, sub ? y - 6 : y, 13, P.text, "left", 700);
    if (sub) text(sub, 40, y + 10, 9, P.dim, "left", 600);
    toggle(300, y, on, UI["tgAt_" + key]);
    if (isFocused(id)) focusRing(28, y - 20, 304, 40, 10);
    region(id, 28, y - 22, 304, 44, () => { s[key] = invert ? !!on : !on; UI["tgAt_" + key] = now(); saveSettings(); });
  }
  function segRow(key, label, y, opts) {
    const s = settings();
    text(label, 40, y, 13, P.text, "left", 700);
    const w = 150, x0 = 322 - w, sw = w / opts.length;
    g.fillStyle = "#1a2046"; rr(x0, y - 16, w, 32, 10); g.fill();
    g.strokeStyle = P.line; g.lineWidth = 1; rr(x0, y - 16, w, 32, 10); g.stroke();
    opts.forEach(([val, lbl], i) => {
      const x = x0 + i * sw;
      const on = (s[key] === undefined ? opts[0][0] : s[key]) === val;
      if (on) { g.fillStyle = "#3a4aa0"; rr(x + 2, y - 14, sw - 4, 28, 8); g.fill(); g.strokeStyle = "#7a8cff"; g.lineWidth = 1; rr(x + 2, y - 14, sw - 4, 28, 8); g.stroke(); }
      fitText(lbl, x + sw / 2, y + 0.5, sw - 6, 11, on ? "#eef2ff" : P.dim, "center", 800);
      const id = "sg_" + key + i;
      if (isFocused(id)) focusRing(x + 2, y - 14, sw - 4, 28, 8);
      region(id, x, y - 22, sw, 44, () => { s[key] = val; saveSettings(); });
    });
  }
  function drawSettings(st, run) {
    // hauteur adaptée à l'onglet (3, 6 ou 5 lignes), animée pour éviter les sauts
    const rowsN = [3, 6, 5][UI.settingsTab] || 6;
    const hT = 124 + rowsN * 52 + 76 + (BE.Save.available ? 0 : 18);
    UI.setH = UI.setH ? U.approach(UI.setH, hT, 18, st.frameDt || 0.016) : hT;
    if (Math.abs(UI.setH - hT) < 0.5) UI.setH = hT;
    const x0 = 16, w = 328, h = Math.round(UI.setH), y0 = Math.round(320 - h / 2);
    panelBox(x0, y0, w, h);
    region("panel", x0, y0, w, h, () => {}, false);
    text("RÉGLAGES", 180, y0 + 26, 17, P.text, "center", 900);
    closeBtn("closeX", x0 + w - 24, y0 + 24);
    // onglets
    const tabs = ["Son", "Affichage", "Jeu"];
    const tw = (w - 32) / 3;
    tabs.forEach((lbl, i) => {
      const x = x0 + 16 + i * tw, y = y0 + 50;
      const on = UI.settingsTab === i;
      g.fillStyle = on ? "#2a3a8a" : "rgba(18,24,50,0.7)"; rr(x + 2, y, tw - 4, 36, 10); g.fill();
      g.strokeStyle = on ? "#5a78ff" : P.line; g.lineWidth = 1.2; rr(x + 2, y, tw - 4, 36, 10); g.stroke();
      text(lbl, x + tw / 2, y + 18.5, 12.5, on ? "#eef2ff" : P.dim, "center", 900);
      if (isFocused("setTab" + i)) focusRing(x + 2, y, tw - 4, 36, 10);
      region("setTab" + i, x, y - 4, tw, 44, () => { UI.settingsTab = i; UI.confirm = null; });
    });
    let y = y0 + 124;
    const row = 52;
    const s = settings();
    if (UI.settingsTab === 0) {
      sliderRow("sfx", "Effets sonores", y, 1); y += row;
      sliderRow("music", "Musique", y, 1); y += row;
      toggleRow("vibrate", "Vibrations", y, "retour haptique sur mobile"); y += row;
    } else if (UI.settingsTab === 1) {
      toggleRow("shake", "Secousses", y, "tremblements de l'écran"); y += row;
      toggleRow("flash", "Flashs réduits", y, "éclairs plein écran atténués", true); y += row;
      toggleRow("colorblind", "Mode daltonien", y, "motifs dans les étoiles"); y += row;
      toggleRow("contrast", "Contraste renforcé", y, "fond noir, contours blancs"); y += row;
      segRow("textScale", "Taille du texte", y, [[1, "×1"], [1.25, "×1,25"]]); y += row;
      toggleRow("eco", "Mode Éco 30 i/s", y, "économise la batterie"); y += row;
    } else {
      segRow("speed", "Vitesse", y, [[1, "×1"], [1.5, "×1,5"], [2, "×2"]]); y += row;
      segRow("aim", "Visée", y, [["abs", "Absolue"], ["rel", "Relative"]]); y += row;
      toggleRow("assistAim", "Visée assistée", y, "+1 contact dans l'aperçu"); y += row;
      // langue (fixe)
      text("Langue", 40, y, 13, P.text, "left", 700);
      g.fillStyle = "#1a2046"; rr(172, y - 16, 150, 32, 10); g.fill();
      text("Français", 247, y + 0.5, 12, P.dim, "center", 800);
      y += row;
      // réinitialiser (double confirmation)
      const inRun = !!(run && BE.Run.IN_GAME[st.scene]);
      const c = UI.confirm === "reset2" ? 2 : UI.confirm === "reset1" ? 1 : 0;
      UI.button({ id: "reset", x: 40, y: y - 20, w: 280, h: 48, style: "danger", size: 13,
        label: c === 2 ? "Dernière chance : tout effacer" : c === 1 ? "Sûr ? Fragments, salles, défis…" : "Réinitialiser la progression",
        sub: c ? "touche encore pour confirmer" : null,
        disabled: inRun, whyDisabled: "Depuis l'écran titre seulement",
        onTap: () => {
          if (c < 2) { UI.confirm = c === 0 ? "reset1" : "reset2"; BE.emit("ui:no", {}); return; }
          UI.confirm = null;
          if (BE.Meta && BE.Meta.dev && BE.Meta.dev.reset) BE.Meta.dev.reset();
          else { BE.Save.wipe(); BE.state.meta = BE.Save.loadMeta(); BE.settings = BE.state.meta.settings; }
          BE.state.ui.savedRun = null;
          UI.panel = null;
          UI.toast("Progression réinitialisée");
        } });
      y += row;
    }
    void s;
    if (!BE.Save.available) text("⚠ Sauvegarde indisponible (navigation privée ?)", 180, y0 + h - 84, 10, P.danger, "center", 700);
    UI.button({ id: "closeS", x: 110, y: y0 + h - 68, w: 140, h: 56, label: "Fermer", style: "ghost", size: 14, onTap: () => { UI.panel = null; UI.confirm = null; } });
  }

  // ---------------------------------------------------------------- pause (§10.6)
  function drawPause(st, run) {
    const k = sheetIn(UI.pauseAt || 0, 0.2);
    g.globalAlpha = k;
    veil(0.82);
    region("pauseBg", 0, 0, D.W, D.H, () => {}, false);
    const y0 = 96 + (1 - k) * 20;
    panelBox(36, y0, 288, 452);
    text("PAUSE", 180, y0 + 30, 24, P.text, "center", 900);
    if (run) {
      text("Lune " + run.lune + " · " + D.NIGHT_NAMES[run.nuit], 180, y0 + 56, 11, P.dim, "center", 700);
      // mini-jauge
      const gx = 90, gw = 180, gy = y0 + 70;
      g.fillStyle = "rgba(5,6,12,0.7)"; rr(gx, gy, gw, 8, 4); g.fill();
      g.fillStyle = P.or; rr(gx, gy, Math.max(6, gw * U.clamp(run.total / run.quota, 0, 1)), 8, 4); g.fill();
      text(U.fmt(run.total) + " / " + U.fmt(run.quota) + " · " + run.shotsLeft + " tir" + (run.shotsLeft > 1 ? "s" : "") + " · " + run.gold + " or", 180, gy + 20, 10, P.text, "center", 700);
    }
    const bx = 56, bw = 248;
    UI.button({ id: "resume", x: bx, y: y0 + 112, w: bw, h: 56, label: "Reprendre", style: "gold", onTap: () => UI.setPaused(false) });
    UI.button({ id: "pbag", x: bx, y: y0 + 178, w: 120, h: 48, label: "Sac", style: "ghost", size: 14, onTap: () => UI.openPanel("bag") });
    UI.button({ id: "prel", x: bx + 128, y: y0 + 178, w: 120, h: 48, label: "Reliques", style: "ghost", size: 14, onTap: () => UI.openPanel("relics") });
    UI.button({ id: "pset", x: bx, y: y0 + 234, w: 120, h: 48, label: "Réglages", style: "ghost", size: 14, onTap: () => UI.openPanel("settings") });
    UI.button({ id: "pgrim", x: bx + 128, y: y0 + 234, w: 120, h: 48, label: "Grimoire", style: "ghost", size: 14, onTap: () => { if (BE.Meta && BE.Meta.openOverlay) BE.Meta.openOverlay(); } });
    const conf = UI.confirm === "abandon";
    // nuit déjà gagnée / run terminé : on n'abandonne pas une victoire (§10.6)
    const settled = !!(run && (run.result || BE.Run.SETTLED[st.scene] || run.total >= run.quota));
    UI.button({ id: "abandon", x: bx, y: y0 + 300, w: bw, h: 48, label: conf ? "Vraiment abandonner ?" : "Abandonner", sub: conf ? "les Fragments gagnés sont gardés" : settled ? "nuit déjà gagnée" : null, style: "danger", size: 14,
      disabled: settled, whyDisabled: "La nuit est déjà gagnée",
      onTap: () => { if (!conf) { UI.confirm = "abandon"; BE.emit("ui:no", {}); return; } UI.confirm = null; BE.Run.abandon(); } });
    // pendant la résolution d'un tir, l'instantané d'avant le tir (PENDING_SHOT) reste la sauvegarde : « Continuer »
    // rejouera le tir à l'identique. On ne sauvegarde que dans un état stable (visée, Aube).
    UI.button({ id: "pmenu", x: bx, y: y0 + 356, w: bw, h: 48, label: "Menu principal", sub: "le run reste sauvegardé", style: "ghost", size: 14,
      onTap: () => { if (BE.Run.canSave()) BE.Run.save(); BE.Run.toTitle(); } });
    if (run) text("Graine " + run.seed, 180, y0 + 428, 9, U.rgba(P.dim, 0.7), "center", 700);
    if (!BE.Save.available) {
      g.fillStyle = P.danger; g.beginPath(); g.arc(64, y0 + 428, 6, 0, TAU); g.fill();
      text("!", 64, y0 + 428.5, 9, "#1a0508", "center", 900);
      text("Sauvegarde indisponible", 76, y0 + 428, 9, P.danger, "left", 700);
    }
    g.globalAlpha = 1;
  }

  // ================================================================ bulles d'onboarding (§10.9)
  function bubble(x, y, txt, ax, ay) {
    let fs = 12.5 * ts();
    g.font = "800 " + fs + "px " + D.FONT;
    while (g.measureText(txt).width > D.W - 48 && fs > 9) { fs -= 0.5; g.font = "800 " + fs + "px " + D.FONT; }
    const w = g.measureText(txt).width + 28, h = 32;
    const bx = U.clamp(x - w / 2, 10, D.W - 10 - w);
    g.fillStyle = "rgba(0,0,0,0.3)"; rr(bx, y - h / 2 + 3, w, h, 16); g.fill();
    g.fillStyle = "rgba(238,242,255,0.97)"; rr(bx, y - h / 2, w, h, 16); g.fill();
    if (ax !== undefined) {
      const up = ay < y;
      const ex = U.clamp(ax, bx + 18, bx + w - 18);
      const baseY = y + (up ? -h / 2 + 1 : h / 2 - 1);
      const tipY = ay + (up ? 4 : -4);
      if (Math.abs(tipY - baseY) > 34) { // cible lointaine : fil pointillé + petite flèche (pas de long triangle)
        const dir = up ? -1 : 1, hy = tipY - dir * 9;
        g.beginPath(); g.moveTo(ex - 6, baseY); g.lineTo(ex, baseY + dir * 8); g.lineTo(ex + 6, baseY); g.closePath(); g.fill();
        g.strokeStyle = "rgba(238,242,255,0.85)"; g.lineWidth = 2; g.setLineDash([4, 4]);
        g.beginPath(); g.moveTo(ex, baseY + dir * 8); g.lineTo(ax, hy); g.stroke(); g.setLineDash([]);
        g.beginPath(); g.moveTo(ax - 6, hy); g.lineTo(ax, tipY); g.lineTo(ax + 6, hy); g.closePath(); g.fill();
      } else {
        g.beginPath(); g.moveTo(ex - 7, baseY); g.lineTo(ax, tipY); g.lineTo(ex + 7, baseY); g.closePath(); g.fill();
      }
    }
    text(txt, bx + w / 2, y + 0.5, fs, "#121832", "center", 800);
  }
  function drawHand(x, y, press) {
    g.save(); g.translate(x, y);
    // cercle de contact
    g.strokeStyle = "rgba(238,242,255," + (0.5 * press) + ")"; g.lineWidth = 2;
    g.beginPath(); g.arc(0, 0, 10 + (1 - press) * 8, 0, TAU); g.stroke();
    g.fillStyle = "rgba(238,242,255,0.95)"; g.strokeStyle = "#121832"; g.lineWidth = 1.5;
    // index
    g.beginPath(); g.moveTo(-4, 2); g.lineTo(-4, -16); g.arc(0, -16, 4, Math.PI, 0); g.lineTo(4, 2); g.closePath(); g.fill(); g.stroke();
    // paume
    g.beginPath(); g.moveTo(-4, -4); g.quadraticCurveTo(-14, -4, -12, 8); g.quadraticCurveTo(-10, 22, 2, 24); g.quadraticCurveTo(14, 24, 14, 10); g.lineTo(14, 0);
    g.quadraticCurveTo(14, -6, 9, -5); g.quadraticCurveTo(4, -6, 4, -2); g.closePath(); g.fill(); g.stroke();
    g.restore();
  }
  function drawBubbles(st, run) {
    const m = st.meta;
    if (!m || st.paused || UI.panel) return;
    const t = st.time;
    if (st.scene === "AIM" && !m.flags.tutoAim) {
      const S = st.play;
      const aiming = S && S.aim && S.aim.active;
      if (!aiming) {
        // main animée : pose, glisse, relâche
        const cyc = 2.4, k = (t % cyc) / cyc;
        const press = k < 0.12 ? k / 0.12 : k < 0.72 ? 1 : Math.max(0, 1 - (k - 0.72) / 0.1);
        const mv = U.easeInOut(U.clamp((k - 0.12) / 0.6, 0, 1));
        const hx = U.lerp(236, 104, mv), hy = U.lerp(500, 462, mv) + Math.sin(mv * Math.PI) * -10;
        g.globalAlpha = k > 0.9 ? (1 - k) / 0.1 : k < 0.05 ? k / 0.05 : 1;
        // traînée pointillée de la direction
        if (press > 0.5) {
          g.strokeStyle = "rgba(238,242,255,0.35)"; g.setLineDash([3, 5]); g.lineWidth = 2;
          g.beginPath(); g.moveTo(G.phare.x, G.phare.y + 26); g.lineTo(hx, hy); g.stroke(); g.setLineDash([]);
        }
        drawHand(hx, hy + 14, press);
        g.globalAlpha = 1;
      }
      g.globalAlpha = aiming ? 0.5 : 1;
      bubble(180, 570, BE.Input.isTouch() ? "Glisse pour viser, relâche pour lancer." : "Maintiens le clic pour viser, relâche pour lancer.");
      g.globalAlpha = 1;
    }
    let b = st.ui.bubble;
    // les bulles ne s'affichent que pendant le jeu ; coupée trop tôt (fin de nuit…), une bulle sera remontrée plus tard
    if (b && !BUBBLE_SCENES[st.scene]) {
      if (t - b.t < 1.5 && BUBBLE_FLAG[b.id]) m.flags[BUBBLE_FLAG[b.id]] = false;
      st.ui.bubble = b = null; st.ui.bubbleNext = null;
    }
    if (b && t - b.t >= 3.8 && st.ui.bubbleNext) { b = st.ui.bubble = Object.assign(st.ui.bubbleNext, { t }); st.ui.bubbleNext = null; }
    if (b && t - b.t < 3.8) {
      const a = U.clamp((3.8 - (t - b.t)) / 0.3, 0, 1) * U.clamp((t - b.t) / 0.15, 0, 1);
      const pop = 0.85 + 0.15 * U.easeOutBack(U.clamp((t - b.t) / 0.25, 0, 1));
      g.globalAlpha = a;
      g.save();
      if (b.id === "quota") {
        // sous la moitié droite de la jauge (le Phare et le Sac restent visibles), flèche vers la barre
        const ax = 238, ay = 37 + Math.sin(t * 6) * 2, by = 116;
        g.translate(180, by); g.scale(pop, pop); g.translate(-180, -by);
        g.strokeStyle = "rgba(238,242,255," + (0.55 + 0.35 * Math.sin(t * 8)) + ")"; g.lineWidth = 2;
        rr(93, 24, 174, 14, 7); g.stroke();
        bubble(200, by, "Atteins le quota avant la fin des tirs.", ax, ay);
      } else if (b.id === "shadow") {
        const tg = b.target;
        const sx = tg && tg.alive ? tg.dispX || tg.x : b.x || 180, sy = tg && tg.alive ? tg.dispY || tg.y : b.y || 166;
        const r = (tg && tg.r) || 18;
        const ax = sx - r * 0.78, ay = sy - r * 0.78 - 10 + Math.sin(t * 6) * 2;
        const by = U.clamp(ay - 34, 70, 330);
        g.translate(180, by); g.scale(pop, pop); g.translate(-180, -by);
        bubble(U.clamp(sx, 120, 240), by, "Ce nombre = tirs avant sa descente.", ax, ay);
        // anneau autour du badge
        g.strokeStyle = "rgba(238,242,255," + (0.6 + 0.3 * Math.sin(t * 8)) + ")"; g.lineWidth = 2;
        g.beginPath(); g.arc(sx - r * 0.78, sy - r * 0.78, 13, 0, TAU); g.stroke();
      } else if (b.id === "merge") {
        // au-dessus de l'horizon, fil vers le point de fusion : la cascade reste visible
        const mx = b.x || 180, my = b.y || 520;
        const by = 318;
        g.translate(180, by); g.scale(pop, pop); g.translate(-180, -by);
        bubble(U.clamp(mx, 120, 240), by, "Deux étoiles identiques fusionnent : c'est ton Mult.", mx, my - 16);
      }
      g.restore();
      g.globalAlpha = 1;
    }
  }
  const BUBBLE_SCENES = { AIM: 1, FLIGHT: 1, SETTLE: 1, TURRETS: 1, COUNT: 1, DESCENT: 1, CHECK: 1, SETTLE_CANDLE: 1 };
  const BUBBLE_FLAG = { merge: "tutoMerge", shadow: "tutoShadow", quota: "tutoQuota" };
  /** Montre une bulle d'onboarding ; si une autre est encore lisible, la nouvelle attend son tour. */
  function showBubble(o) {
    const st = BE.state, cur = st.ui.bubble;
    o.t = st.time;
    if (cur && st.time - cur.t < 2.2) st.ui.bubbleNext = o; else st.ui.bubble = o;
  }
  BE.on("launch", (e) => {
    const m = BE.state.meta;
    if (m && !m.flags.tutoAim && !e.copy) { m.flags.tutoAim = true; BE.Save.saveMeta(m); }
  });
  BE.on("merge", (e) => {
    const m = BE.state.meta;
    // montrée une fois la cascade retombée (tourelles / décompte), pas au milieu des fusions
    if (m && !m.flags.tutoMerge && !e.orphan && !BE.state.ui.mergeWait) BE.state.ui.mergeWait = { x: e.x, y: e.y };
  });
  BE.on("scene", (e) => {
    const st = BE.state, w = st.ui.mergeWait, m = st.meta;
    if (!w || !m) return;
    if (e.to === "TURRETS" || e.to === "COUNT" || e.to === "AIM") {
      st.ui.mergeWait = null;
      if (!m.flags.tutoMerge) {
        m.flags.tutoMerge = true;
        const b = st.run && st.run.jar.bodies.reduce((a, o) => (!o.stone && (!a || o.size > a.size) ? o : a), null);
        showBubble({ id: "merge", x: b ? b.x : w.x, y: b ? b.y : w.y }); BE.Save.saveMeta(m);
      }
    } else if (!BUBBLE_SCENES[e.to]) st.ui.mergeWait = null;
  });
  BE.on("shadowMove", (e) => {
    const m = BE.state.meta;
    if (m && !m.flags.tutoShadow && e && e.target) {
      m.flags.tutoShadow = true; showBubble({ id: "shadow", target: e.target, x: e.target.x, y: e.target.y }); BE.Save.saveMeta(m);
    }
  });
  BE.on("count:start", () => {
    const m = BE.state.meta;
    if (m && !m.flags.tutoQuota) { m.flags.tutoQuota = true; showBubble({ id: "quota" }); BE.Save.saveMeta(m); }
  });

  function drawToast(st) {
    const tm = UI.toastMsg;
    if (!tm) return;
    const dt = st.time - tm.t;
    if (dt > 2.2) { UI.toastMsg = null; return; }
    const a = U.clamp((2.2 - dt) / 0.3, 0, 1) * U.clamp(dt / 0.12, 0, 1);
    g.globalAlpha = a;
    const fs = 12 * ts();
    g.font = "800 " + fs + "px " + D.FONT;
    const w = Math.min(D.W - 24, g.measureText(tm.msg).width + 32);
    // en jeu et à l'Aube : au-dessus du bocal ; dans les menus : en haut (les boutons principaux sont en bas)
    const top = !BE.Run.IN_GAME[st.scene] && st.scene !== "SHOP" && st.scene !== "SETTLE_CANDLE" && !st.paused;
    const yTop = st.scene === "RUN_END" ? 494 // fin de run : juste au-dessus des boutons (le titre reste lisible)
      : BE.Meta && BE.Meta.notifying && BE.Meta.notifying() ? 90 : 36; // sous une carte « Défi accompli »
    const y = (top ? yTop : 540) - (1 - U.easeOutCubic(U.clamp(dt / 0.2, 0, 1))) * (top ? -12 : 12);
    g.fillStyle = "rgba(0,0,0,0.35)"; rr(180 - w / 2, y - 17 + 3, w, 34, 17); g.fill();
    g.fillStyle = "rgba(18,24,50,0.97)"; rr(180 - w / 2, y - 17, w, 34, 17); g.fill();
    g.strokeStyle = "#4a5498"; g.lineWidth = 1; rr(180 - w / 2, y - 17, w, 34, 17); g.stroke();
    fitText(tm.msg, 180, y + 0.5, w - 20, fs, P.text, "center", 800);
    g.globalAlpha = 1;
  }

  // ================================================================ transitions
  BE.on("scene", (e) => {
    UI.sel = null; UI.focus = -1; UI.confirm = null; UI.drag = null; UI.slide = null;
    if (e.to !== "SHOP") UI.panel = null;
    if (UI.toastMsg && now() - UI.toastMsg.t > 0.3) UI.toastMsg = null; // pas de message périmé sur l'écran suivant
    UI.sceneAt = now();
    if (MENU_FADE[e.to] && e.from !== e.to) UI.fadeAt = now();
    if (e.to === "SHOP" && e.from !== "SHOP") {
      UI.shopT = now(); UI.cardsT = now() + 0.15; UI.rewardSeen = 0; UI.newRelicAt = 0;
      if (BE.state.run) UI.lastGold = BE.state.run.gold;
    }
    if (e.to === "RUN_END") UI.fragTicks = 0;
    if (e.to === "NIGHT_INTRO") UI.introCards = computeIntroCards(BE.state.run);
    if (e.from === "NIGHT_INTRO" && e.to !== "NIGHT_INTRO") { markIntroSeen(); UI.introCards = []; }
  });
  BE.on("shop:reroll", () => { UI.cardsT = now(); UI.sel = null; });
})(window.BE = window.BE || {});
