/* 99_main.js — bootstrap, redimensionnement / DPR, boucle principale à pas fixe (§12.3, §12.4), pause auto, API de test. */
(function (BE) {
  "use strict";

  const D = BE.DATA;
  const DT = D.PHYS.dt;
  let cv = null;

  /**
   * §12.3 : espace logique 360 × 640 mis à l'échelle (scale = min(vw/360, vh/640)), zones sûres retirées. Le canevas
   * couvre TOUTE la fenêtre : le ciel, la barre haute et la bande des reliques se prolongent au-delà de la zone
   * 360 × 640 (Render.setExtents) au lieu de bandes noires. La marge verticale est surtout donnée au bas (bande des
   * reliques plus haute, zone du pouce) ; le haut en reçoit au plus 24 unités (sous l'encoche).
   */
  function resize() {
    const sa = BE.Input && BE.Input.readSafeArea ? BE.Input.readSafeArea() : { top: 0, right: 0, bottom: 0, left: 0 }; // encoche / barre d'accueil
    const W = window.innerWidth, H = window.innerHeight;
    const vw = Math.max(1, W - sa.left - sa.right), vh = Math.max(1, H - sa.top - sa.bottom);
    const scale = Math.min(vw / D.W, vh / D.H);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cssW = D.W * scale, cssH = D.H * scale;
    const extraY = vh - cssH;
    const topPad = Math.min(extraY * 0.3, 24 * scale);
    const left = Math.round(sa.left + (vw - cssW) / 2), top = Math.round(sa.top + topPad);
    cv.style.width = W + "px"; cv.style.height = H + "px";
    cv.style.left = "0px"; cv.style.top = "0px";
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    const bottom = (sa.top + vh - (top + cssH)) / scale; // marge utile sous 640 (hors barre d'accueil)
    BE.view = { scale, dpr, cssW, cssH, left, top, safe: sa, fullW: W, fullH: H,
      ext: { x0: -left / scale, y0: -top / scale, x1: (W - left) / scale, y1: (H - top) / scale, bottom } };
    BE.Render.setExtents(BE.view.ext);
    BE.Render.setResolution(scale * dpr);
  }

  function autoPause() {
    const st = BE.state;
    if (BE.Run.IN_GAME[st.scene] && !st.paused) BE.UI.setPaused(true);
    else if (BE.Audio) BE.Audio.suspend();
    if (BE.Run.canSave()) BE.Run.save();
  }

  let acc = 0, last = 0, frame = 0;
  const CALM = { TITLE: 1, SELECT: 1, NIGHT_INTRO: 1, AIM: 1, SHOP: 1, DAILY: 1, OBSERVATORY: 1, GRIMOIRE: 1 };
  function tick(now) {
    requestAnimationFrame(tick);
    const st = BE.state;
    let el = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (el < 0) el = 0;
    st.time += el; st.frameDt = el;
    if (BE.Debug) BE.Debug.frame(el);
    try {
      if (!st.paused) {
        if (BE.FX.hitstop > 0) { BE.FX.hitstop -= el; el = 0; }
        acc += el * BE.Run.timeScale();
        let steps = 0;
        const maxSteps = D.PHYS.maxStepsPerFrame * Math.max(1, st.turbo || 1);
        while (acc >= DT && steps < maxSteps) { BE.Run.update(DT); acc -= DT; steps++; }
        // §5.8 : au plus 8 pas par image, le surplus est REPORTÉ (borné à une image de retard pour ne pas spiraler)
        if (steps === maxSteps) acc = Math.min(acc, DT * maxSteps);
        BE.FX.update(el);
        if (BE.Audio) BE.Audio.update();
      }
      // phases calmes : préchauffage des sprites (quelques-uns par image), pour qu'aucun ne soit construit en pleine cascade
      if (CALM[st.scene] && BE.Render.prewarmStep) BE.Render.prewarmStep(2);
      if (!(BE.settings && BE.settings.eco) || (frame++ & 1) === 0) {
        BE.Render.draw();
        if (BE.Debug && BE.Debug.enabled) BE.Debug.draw(BE.Render.ctx);
      }
    } catch (e) {
      console.error(e);
    }
  }

  function boot() {
    cv = document.getElementById("game");
    const st = BE.state;
    st.meta = BE.Save.loadMeta();
    BE.settings = st.meta.settings;
    BE.Render.init(cv);
    BE.Input.init(cv);
    resize();
    window.addEventListener("resize", resize);
    if (window.visualViewport) window.visualViewport.addEventListener("resize", resize);
    document.addEventListener("visibilitychange", () => { if (document.hidden) autoPause(); });
    window.addEventListener("blur", autoPause);
    BE.Run.go("TITLE");
    const b = document.getElementById("boot");
    if (b) b.remove();
    last = performance.now();
    requestAnimationFrame(tick);
  }

  // ================================================================ API de test (automatisation, voir tools/smoke.js)
  const T = (BE.Test = {});
  /** Instantané lisible de l'état. */
  T.state = function () {
    const st = BE.state, run = st.run;
    const o = { scene: st.scene, paused: st.paused, time: st.time };
    if (run) {
      Object.assign(o, {
        lune: run.lune, nuit: run.nuit, shotsLeft: run.shotsLeft, shotIndex: run.shotIndex, total: run.total, quota: run.quota,
        gold: run.gold, jar: run.jar.bodies.length, shadows: BE.Firm.targets(run).length, relics: run.relics.map((r) => r.id),
        bag: run.bag.length, reserve: run.reserve, result: run.result, lastShot: run.lastShot,
        offers: run.shop ? run.shop.offers.map((x) => ({ kind: x.kind, id: x.id, type: x.type, size: x.size, color: x.color, price: x.price, sold: x.sold })) : null,
        nuitBlanche: !!run.nuitBlanche, eclipse: run.eclipse, daily: !!run.daily,
      });
    }
    return o;
  };
  /** Coordonnées client (CSS px) d'un point logique. */
  T.toClient = function (x, y) {
    const r = cv.getBoundingClientRect(), V = BE.view;
    return { x: r.left + V.left + x * V.scale, y: r.top + V.top + y * V.scale };
  };
  /** Régions cliquables de la dernière image (ids : "new", "launch", "nextNight", "offer0", "reroll"…). */
  T.regions = () => BE.UI.regions();
  T.region = (id) => BE.UI.regions().find((r) => r.id === id) || null;
  T.newRun = (opts) => BE.Run.startNewRun(opts || {});
  /** Tire à l'angle donné (degrés). Passe l'intro si besoin. */
  T.shoot = function (angle) {
    if (BE.state.scene === "NIGHT_INTRO") BE.Run.go("AIM");
    return BE.Run.fire(angle);
  };
  T.setTurbo = (n) => { BE.state.turbo = n; };
  /** Force la victoire de la nuit en cours (→ NIGHT_WON → SHOP / VIDANGE). */
  T.winNight = function () {
    const st = BE.state, run = st.run;
    if (!run || !BE.Run.IN_GAME[st.scene]) return false;
    run.total = Math.max(run.total, run.quota);
    st.paused = false;
    BE.Run.go("CHECK");
    return true;
  };
  T.skipToShop = T.winNight;
  T.lose = function (cause) { if (BE.state.run) BE.Run.lose(cause || "quota", 42); };
  T.buy = (i) => BE.Shop.buy(BE.state.run, i);
  T.reroll = () => BE.Shop.reroll(BE.state.run);
  T.nextNight = () => BE.Run.leaveShop();
  T.giveGold = (n) => { BE.state.run.gold += n; };
  T.tapLogical = (x, y) => BE.UI.click(x, y);
  /**
   * Joue un tir de façon synchrone (sans rendu) : tire puis exécute la logique jusqu'à une scène stable
   * (AIM, SHOP, RUN_END, NIGHT_INTRO). Renvoie l'état. Utile pour les bots et tests rapides.
   */
  T.shotSync = function (angle, maxSteps) {
    const st = BE.state;
    if (st.scene === "NIGHT_INTRO") BE.Run.go("AIM");
    if (st.scene !== "AIM" || !BE.Run.fire(angle)) return T.state();
    const stable = { AIM: 1, SHOP: 1, RUN_END: 1, NIGHT_INTRO: 1 };
    let n = 0;
    const lim = maxSteps || 200000;
    while (!stable[st.scene] && n < lim) { BE.Run.update(D.PHYS.dt); n++; }
    const o = T.state(); o.steps = n;
    return o;
  };
  /** Ajoute des corps au bocal : [{size, color, x, y, stone}] (tests visuels). */
  T.addJar = function (list) {
    const run = BE.state.run;
    for (const b of list) BE.Jar.add(run, Object.assign({ y: 560, x: 180 }, b));
    BE.Jar.stabilize(run, 240);
  };
  /** Avance la logique de n pas (sans rendu). */
  T.step = function (n) { for (let i = 0; i < n; i++) BE.Run.update(D.PHYS.dt); return T.state(); };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})(window.BE = window.BE || {});
