/* 04_input.js — BE.Input : pointer events unifiés (tactile + souris + stylet), clavier, tap vs glisser (§3),
   marges de sécurité (encoche, barre d'accueil) et petits services d'entrée pour l'UI. */
(function (BE) {
  "use strict";

  const I = (BE.Input = {});
  /** Pointeur principal, en coordonnées logiques 360×640. */
  I.pointer = { down: false, x: 180, y: 320, sx: 0, sy: 0, t0: 0, maxMove: 0, type: "mouse", id: -1, button: 0, inside: false };
  /** Touches maintenues, par `code` (KeyF, ArrowLeft…). */
  I.keys = {};
  /** Seuils §3.1 : un relâcher est un tir si l'appui a duré ≥ 150 ms OU si le doigt a bougé de ≥ 12 px. */
  I.TAP_MS = 150;
  I.TAP_PX = 12;
  /** Dernier type d'entrée utilisé : "touch" | "mouse" | "pen" | "key" (l'UI adapte ses indications). */
  /** Vrai si l'appareil a un écran tactile (indices « touche » plutôt que « clique »). */
  I.touchDevice = typeof window !== "undefined" && (("ontouchstart" in window) || (navigator.maxTouchPoints || 0) > 0);
  I.lastType = I.touchDevice ? "touch" : "mouse"; // avant le premier geste (reprise sans tap) : indices tactiles sur mobile
  let canvas = null;
  let safe = { top: 0, right: 0, bottom: 0, left: 0 };
  let probe = null;

  function toLogical(e) {
    // le canevas couvre toute la fenêtre ; la zone logique 360 × 640 y est placée en (view.left, view.top)
    const r = canvas.getBoundingClientRect(), V = BE.view;
    if (!V) { const s = r.width / BE.DATA.W || 1; return { x: (e.clientX - r.left) / s, y: (e.clientY - r.top) / s }; }
    return { x: (e.clientX - r.left - V.left) / V.scale, y: (e.clientY - r.top - V.top) / V.scale };
  }

  function firstGesture() {
    if (BE.Audio) { try { BE.Audio.init(); } catch (err) { /* */ } }
  }

  // ---------------------------------------------------------------- marges de sécurité (env(safe-area-inset-*))
  /** Lit les marges CSS de sécurité (px CSS). Sans encoche : 0 partout. */
  I.readSafeArea = function () {
    try {
      if (!probe) {
        probe = document.createElement("div");
        probe.setAttribute("aria-hidden", "true");
        probe.style.cssText = "position:fixed;left:0;top:0;width:0;height:0;visibility:hidden;pointer-events:none;" +
          "padding-top:env(safe-area-inset-top,0px);padding-right:env(safe-area-inset-right,0px);" +
          "padding-bottom:env(safe-area-inset-bottom,0px);padding-left:env(safe-area-inset-left,0px);";
        document.body.appendChild(probe);
      }
      const cs = getComputedStyle(probe);
      const px = (v) => Math.max(0, parseFloat(v) || 0);
      safe = { top: px(cs.paddingTop), right: px(cs.paddingRight), bottom: px(cs.paddingBottom), left: px(cs.paddingLeft) };
    } catch (err) { safe = { top: 0, right: 0, bottom: 0, left: 0 }; }
    return safe;
  };
  /** Marges de sécurité courantes (px CSS) : {top, right, bottom, left}. */
  I.safeInsets = () => safe;

  // ---------------------------------------------------------------- pointeurs
  I.init = function (cv) {
    canvas = cv;
    I.readSafeArea();
    const p = I.pointer;
    cv.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      firstGesture();
      try { cv.focus({ preventScroll: true }); } catch (err) { /* */ }
      I.lastType = e.pointerType || "mouse";
      if (e.button === 2) { // clic droit : annuler la visée (§3.2)
        if (p.down) { p.down = false; try { cv.releasePointerCapture(p.id); } catch (err) { /* */ } }
        BE.emit("pcancel", { reason: "right" });
        return;
      }
      if (e.button === 1) return; // clic molette : ignoré
      if (p.down && e.pointerId !== p.id) return; // un seul pointeur actif (un pouce)
      const q = toLogical(e);
      p.down = true; p.id = e.pointerId; p.type = e.pointerType || "mouse"; p.button = e.button;
      p.x = p.sx = q.x; p.y = p.sy = q.y; p.t0 = performance.now(); p.maxMove = 0; p.inside = true;
      try { cv.setPointerCapture(e.pointerId); } catch (err) { /* */ }
      BE.emit("pdown", { x: q.x, y: q.y, type: p.type });
    }, { passive: false });

    cv.addEventListener("pointermove", (e) => {
      if (p.down && e.pointerId !== p.id) return;
      const q = toLogical(e);
      p.x = q.x; p.y = q.y; p.type = e.pointerType || p.type; p.inside = true;
      if (p.down) {
        p.maxMove = Math.max(p.maxMove, Math.hypot(q.x - p.sx, q.y - p.sy));
        BE.emit("pmove", { x: q.x, y: q.y });
      } else if ((e.pointerType || "mouse") === "mouse") BE.emit("hover", { x: q.x, y: q.y });
    });
    cv.addEventListener("pointerleave", (e) => { if (!p.down && (e.pointerType || "mouse") === "mouse") { p.inside = false; BE.emit("hover", { x: -99, y: -99 }); } });

    const up = (e) => {
      if (!p.down || e.pointerId !== p.id) return;
      const q = toLogical(e);
      p.x = q.x; p.y = q.y; p.down = false;
      const dur = performance.now() - p.t0;
      const moved = Math.max(p.maxMove, Math.hypot(q.x - p.sx, q.y - p.sy));
      BE.emit("pup", {
        x: q.x, y: q.y, dur, moved,
        tap: dur < I.TAP_MS && moved < I.TAP_PX, // geste court : jamais un tir
        click: moved < I.TAP_PX,                  // clic de menu (durée libre)
      });
    };
    cv.addEventListener("pointerup", up);
    cv.addEventListener("pointercancel", (e) => {
      if (!p.down || e.pointerId !== p.id) return;
      p.down = false;
      BE.emit("pcancel", { reason: "cancel" });
    });
    cv.addEventListener("lostpointercapture", (e) => {
      // capture perdue sans pointerup (changement d'onglet, geste système) : on annule proprement
      if (p.down && e.pointerId === p.id) { p.down = false; BE.emit("pcancel", { reason: "lost" }); }
    });
    cv.addEventListener("contextmenu", (e) => e.preventDefault());
    cv.addEventListener("wheel", (e) => {
      const q = toLogical(e);
      BE.emit("wheel", { x: q.x, y: q.y, dy: e.deltaY, dx: e.deltaX });
    }, { passive: true });
    // iOS : empêche le zoom par double-tap / pincement sur la page
    document.addEventListener("gesturestart", (e) => e.preventDefault());
    document.addEventListener("dblclick", (e) => e.preventDefault());

    // ---------------------------------------------------------------- clavier
    window.addEventListener("keydown", (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return; // raccourcis du navigateur (Ctrl+R, Cmd+L…) : jamais détournés
      firstGesture();
      I.lastType = "key";
      const code = e.code || e.key;
      if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Space", "Tab", "Enter"].indexOf(code) >= 0) e.preventDefault();
      const wasDown = !!I.keys[code];
      I.keys[code] = true;
      BE.emit("key", { code, key: e.key, shift: e.shiftKey, repeat: wasDown || e.repeat });
    });
    window.addEventListener("keyup", (e) => {
      const code = e.code || e.key;
      I.keys[code] = false;
      BE.emit("keyup", { code, key: e.key });
    });
    window.addEventListener("blur", () => {
      I.keys = {};
      if (p.down) { p.down = false; BE.emit("pcancel", { reason: "blur" }); }
    });
    window.addEventListener("resize", () => I.readSafeArea());
    window.addEventListener("orientationchange", () => setTimeout(() => I.readSafeArea(), 250));
  };

  /** Doigt ou F maintenu : accélération (§5.8). */
  I.isHeld = () => I.pointer.down || !!I.keys.KeyF;
  I.key = (code) => !!I.keys[code];
  /** Durée (s) de l'appui en cours, 0 sinon. */
  I.holdTime = () => (I.pointer.down ? (performance.now() - I.pointer.t0) / 1000 : 0);
  /** Vrai si le dernier geste venait d'un écran tactile (indices « touche » / « glisse »). */
  I.isTouch = () => I.lastType === "touch" || I.lastType === "pen" || (I.lastType !== "mouse" && I.lastType !== "key" && I.touchDevice);
})(window.BE = window.BE || {});
