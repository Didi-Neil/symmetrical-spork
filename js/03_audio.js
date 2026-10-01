/* 03_audio.js — BE.Audio : 100 % WebAudio synthétisé (§11.5).
   Graphe : voix → bus effets (panoramique, envoi de réverbération) ┐
            musique → passe-bas (LFO 0,1 Hz) → atténuation (ducking) → bus musique ┼→ compresseur (−18 dB, 4:1) → maître → sortie
            réverbération (réponse impulsionnelle générée) ┘
   Pool de 16 voix d'effets (la plus ancienne est coupée). AudioContext créé ou repris au premier geste, suspendu en pause.
   Musique générative par Lune : 2 voix à la Lune 1, +1 par Lune (max 5) : nappe, basse, boîte à musique, contre-chant, pulsation.
   Pur écouteur du bus d'événements (table MAP en fin de fichier). */
(function (BE) {
  "use strict";

  const A = (BE.Audio = {});
  let ctx = null, master = null, comp = null, sfxBus = null, musBus = null, musDuck = null, revIn = null, noiseBuf = null;
  const voices = []; // {out, srcs, end}
  const MAX_VOICES = 16;
  const EMPTY = {};
  let cur = null;    // voix en construction
  A.ready = false;
  A.muted = false;
  A.lastError = null; // dernier son en erreur (tests)

  function settings() { return BE.settings || { sfx: 0.8, music: 0.5 }; }
  function vol(v, def) { return typeof v === "number" ? Math.max(0, Math.min(1, v)) : v === false ? 0 : v === true ? def : def; }
  const MUSIC_K = 0.55;

  /** Crée ou reprend l'AudioContext. À appeler dans un geste utilisateur. */
  A.init = function () {
    try {
      if (!ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        ctx = new AC();
        comp = ctx.createDynamicsCompressor();
        comp.threshold.value = -18; comp.ratio.value = 4; comp.attack.value = 0.004; comp.release.value = 0.2;
        master = ctx.createGain(); master.gain.value = 1;
        sfxBus = ctx.createGain(); sfxBus.gain.value = vol(settings().sfx, 0.8);
        musBus = ctx.createGain(); musBus.gain.value = vol(settings().music, 0.5) * MUSIC_K;
        musDuck = ctx.createGain(); musDuck.gain.value = 1;
        musDuck.connect(musBus);
        sfxBus.connect(comp); musBus.connect(comp); comp.connect(master); master.connect(ctx.destination);
        // bruit blanc (1 s)
        const len = ctx.sampleRate;
        noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
        const d = noiseBuf.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
        // réverbération : bruit stéréo à décroissance exponentielle (1,8 s)
        try {
          const rl = Math.floor(ctx.sampleRate * 1.8);
          const ir = ctx.createBuffer(2, rl, ctx.sampleRate);
          for (let ch = 0; ch < 2; ch++) {
            const x = ir.getChannelData(ch);
            for (let i = 0; i < rl; i++) { const k = i / rl; x[i] = (Math.random() * 2 - 1) * Math.pow(1 - k, 2.6) * (i < 60 ? i / 60 : 1); }
          }
          const conv = ctx.createConvolver(); conv.buffer = ir;
          const rOut = ctx.createGain(); rOut.gain.value = 0.42;
          revIn = ctx.createGain(); revIn.gain.value = 1;
          const hp = ctx.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 240;
          revIn.connect(hp); hp.connect(conv); conv.connect(rOut); rOut.connect(comp);
        } catch (e) { revIn = null; }
        // déblocage iOS : un tampon silencieux
        const sb = ctx.createBufferSource(); sb.buffer = ctx.createBuffer(1, 1, ctx.sampleRate); sb.connect(ctx.destination); sb.start(0);
        A.ready = true;
        music.start();
      }
      if (ctx.state === "suspended" && !(BE.state && BE.state.paused)) ctx.resume();
    } catch (e) { A.ready = false; }
  };
  A.suspend = function () { try { if (ctx && ctx.state === "running") ctx.suspend(); } catch (e) { /* */ } };
  A.resume = function () { try { if (ctx && ctx.state === "suspended") ctx.resume(); } catch (e) { /* */ } };
  let appliedSfx = -1, appliedMus = -1;
  /** Applique les volumes des réglages (0–1, ou booléens). Appelé aussi à chaque image par update(). */
  A.applySettings = function () {
    if (!ctx) return;
    const s = settings(), fx = vol(s.sfx, 0.8), mu = vol(s.music, 0.5);
    const t = ctx.currentTime;
    if (fx !== appliedSfx) { appliedSfx = fx; sfxBus.gain.setTargetAtTime(fx, t, 0.03); }
    if (mu !== appliedMus) { appliedMus = mu; musBus.gain.setTargetAtTime(mu * MUSIC_K, t, 0.08); }
  };

  // ---------------------------------------------------------------- voix (pool de 16)
  function beginVoice(pan, wet) {
    const t = ctx.currentTime;
    for (let i = voices.length - 1; i >= 0; i--) if (voices[i].end < t) voices.splice(i, 1);
    while (voices.length >= MAX_VOICES) steal(voices.shift());
    const out = ctx.createGain(); out.gain.value = 1;
    let node = out;
    if (pan && ctx.createStereoPanner) { const p = ctx.createStereoPanner(); p.pan.value = Math.max(-1, Math.min(1, pan)); out.connect(p); node = p; }
    node.connect(sfxBus);
    if (wet && revIn) { const s = ctx.createGain(); s.gain.value = wet; node.connect(s); s.connect(revIn); }
    cur = { out, srcs: [], end: t };
    voices.push(cur);
  }
  function steal(v) {
    const t = ctx.currentTime;
    try { v.out.gain.cancelScheduledValues(t); v.out.gain.setValueAtTime(v.out.gain.value, t); v.out.gain.linearRampToValueAtTime(0, t + 0.012); } catch (e) { /* */ }
    for (let i = 0; i < v.srcs.length; i++) { try { v.srcs[i].stop(t + 0.015); } catch (e) { /* */ } }
  }
  function track(src, end) { cur.srcs.push(src); if (end > cur.end) cur.end = end; }

  /** Oscillateur enveloppé (attaque linéaire, décroissance exponentielle). */
  function tone(type, f0, f1, dur, gain, delay, attack, detune) {
    const t = ctx.currentTime + (delay || 0);
    const o = ctx.createOscillator(), gn = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(f0, t);
    if (f1 && f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    if (detune) o.detune.value = detune;
    const a = attack || 0.002;
    gn.gain.setValueAtTime(0.0001, t);
    gn.gain.linearRampToValueAtTime(gain, t + a);
    gn.gain.exponentialRampToValueAtTime(0.0001, t + a + dur);
    o.connect(gn); gn.connect(cur.out);
    o.start(t); o.stop(t + a + dur + 0.03);
    track(o, t + a + dur + 0.03);
    return o;
  }
  /** Oscillateur filtré (dent de scie « feutrée »…). */
  function toneF(type, f0, f1, dur, gain, delay, attack, ftype, ff, q) {
    const t = ctx.currentTime + (delay || 0);
    const o = ctx.createOscillator(), f = ctx.createBiquadFilter(), gn = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(f0, t);
    if (f1 && f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    f.type = ftype; f.frequency.value = ff; f.Q.value = q || 0.7;
    const a = attack || 0.004;
    gn.gain.setValueAtTime(0.0001, t);
    gn.gain.linearRampToValueAtTime(gain, t + a);
    gn.gain.exponentialRampToValueAtTime(0.0001, t + a + dur);
    o.connect(f); f.connect(gn); gn.connect(cur.out);
    o.start(t); o.stop(t + a + dur + 0.03);
    track(o, t + a + dur + 0.03);
    return o;
  }
  /** Bruit filtré (f0 → f1). */
  function noise(dur, ftype, f0, f1, q, gain, delay, attack) {
    const t = ctx.currentTime + (delay || 0);
    const s = ctx.createBufferSource(); s.buffer = noiseBuf;
    const f = ctx.createBiquadFilter(); f.type = ftype; f.frequency.setValueAtTime(f0, t);
    if (f1 && f1 !== f0) f.frequency.exponentialRampToValueAtTime(f1, t + dur);
    f.Q.value = q || 1;
    const gn = ctx.createGain();
    const a = attack || 0.001;
    gn.gain.setValueAtTime(0.0001, t); gn.gain.linearRampToValueAtTime(gain, t + a); gn.gain.exponentialRampToValueAtTime(0.0001, t + a + dur);
    s.connect(f); f.connect(gn); gn.connect(cur.out);
    s.start(t, Math.random() * 0.5); s.stop(t + a + dur + 0.03);
    track(s, t + a + dur + 0.03);
  }
  /** Cloche FM : porteuse f, modulante ratio·f, indice idx → 0 sur la durée. */
  function bell(f, dur, gain, delay, ratio, idx) {
    const t = ctx.currentTime + (delay || 0);
    const c = ctx.createOscillator(), m = ctx.createOscillator(), mg = ctx.createGain(), gn = ctx.createGain();
    c.frequency.value = f; m.frequency.value = f * (ratio || 1.4);
    mg.gain.setValueAtTime(f * (idx === undefined ? 3 : idx), t); mg.gain.exponentialRampToValueAtTime(Math.max(0.5, f * 0.01), t + dur);
    m.connect(mg); mg.connect(c.frequency);
    gn.gain.setValueAtTime(0.0001, t); gn.gain.linearRampToValueAtTime(gain, t + 0.004);
    gn.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    c.connect(gn); gn.connect(cur.out);
    c.start(t); m.start(t); c.stop(t + dur + 0.03); m.stop(t + dur + 0.03);
    track(c, t + dur + 0.03); track(m, t + dur + 0.03);
  }

  const PENTA = [0, 2, 4, 7, 9];
  const MAJOR = [0, 2, 4, 5, 7, 9, 11];
  const C5 = 523.25;
  const semi = (n) => Math.pow(2, n / 12);
  const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
  /** Note n°k du tir : pentatonique de do majeur depuis do5, +1 octave tous les 5 degrés, plafond 3 octaves. */
  function pentaNote(k) {
    k = Math.min(k, 14); // plafond : 3 octaves
    return C5 * semi(PENTA[k % 5] + 12 * Math.floor(k / 5));
  }

  // ---------------------------------------------------------------- sons (§11.5)
  const SOUNDS = {
    peg(p) {
      if (p.dark) { tone("sine", 220, 160, 0.06, 0.12); noise(0.02, "lowpass", 900, 900, 1, 0.08); return; }
      const f = pentaNote(p.k || 0);
      tone("sine", f, f, 0.18, 0.18);
      tone("triangle", f * 2, f * 2, 0.12, 0.054);
      if (p.special) bell(f * 2, 0.35, 0.05, 0.01, 2.01, 1.5);
    },
    wall() { noise(0.06, "bandpass", 420, 420, 4, 0.5); tone("sine", 180, 140, 0.04, 0.05); },
    hit() { tone("square", 110, 70, 0.09, 0.12); noise(0.04, "lowpass", 800, 800, 1, 0.25); },
    armor() { tone("square", 1400, 1200, 0.05, 0.05); bell(1800, 0.2, 0.06, 0, 2.7, 2); },
    kill(p) {
      noise(0.25, "lowpass", 2000, 200, 1, 0.45);
      tone("sine", 320, 90, 0.2, 0.1);
      if (p.boss) { tone("sine", 55, 40, 0.8, 0.4); [0, 4, 7, 12].forEach((n, i) => bell(C5 * semi(n), 0.9, 0.07, 0.15 + i * 0.07)); }
    },
    land() { tone("sine", 900, 600, 0.04, 0.16); noise(0.008, "highpass", 4000, 4000, 1, 0.2); },
    merge(p) {
      const s = p.size || 2, f = 660 * Math.pow(0.8, s - 2);
      tone("sine", f, f / 2, 0.12, 0.28); noise(0.01, "highpass", 3000, 3000, 1, 0.2);
      tone("triangle", f * 1.5, f * 0.75, 0.1, 0.05);
      if (s >= 5) tone("sine", 55, 50, 0.25, 0.35);
      if (s >= 7) { tone("sine", 41, 30, 0.9, 0.35, 0.02, 0.05); toneF("sawtooth", 110, 55, 0.8, 0.05, 0, 0.05, "lowpass", 400); }
      if (p.pure) bell(f * 4, 0.3, 0.04, 0.04, 3.01, 1);
    },
    reaction(p) { const f = p.f || 660; bell(f, 0.4, 0.2); bell(f * 1.5, 0.5, 0.07, 0.05, 1.4, 2); noise(0.2, "bandpass", 3000, 6000, 2, 0.06); },
    stone() { noise(0.12, "bandpass", 250, 250, 2, 0.6); tone("square", 60, 55, 0.06, 0.12); noise(0.05, "highpass", 2500, 2500, 1, 0.12, 0.02); },
    tick(p) { const f = C5 * semi(Math.min(24, p.step || 0)); tone("triangle", f, f, 0.03, 0.14); },
    relic(p) { const deg = MAJOR[(p.slot || 0) % 7] + 12 * Math.floor((p.slot || 0) / 7); bell(C5 * semi(deg), 0.22, 0.14); },
    total(p) {
      const base = C5 * (p.high ? 2 : 1);
      [0, 4, 7].forEach((n, i) => { tone("triangle", base * semi(n), base * semi(n), 0.3, 0.14, i * 0.04); tone("sine", base * semi(n) / 2, null, 0.35, 0.06, i * 0.04); });
      if (p.high) bell(base * 2, 0.6, 0.06, 0.14);
    },
    coin() { tone("sine", 1318.5, 1318.5, 0.12, 0.12); tone("sine", 1760, 1760, 0.12, 0.1, 0.05); noise(0.01, "highpass", 5000, 5000, 1, 0.15); },
    tic() { tone("sine", 2637, 2637, 0.018, 0.06); tone("triangle", 1318.5, 1318.5, 0.02, 0.03); },
    kaching(p) {
      const d = p.delay || 0;
      tone("sine", 1318.5, 1318.5, 0.12, 0.12, d); tone("sine", 1760, 1760, 0.14, 0.1, d + 0.05);
      noise(0.012, "highpass", 5000, 5000, 1, 0.15, d); noise(0.08, "highpass", 6000, 6000, 1, 0.12, d + 0.08);
      [0, 4, 7, 12].forEach((n, i) => bell(C5 * 2 * semi(n), 0.5, 0.06, d + 0.1 + i * 0.05, 3.01, 1));
    },
    quota() { [0, 4, 7, 12, 16].forEach((n, i) => { tone("triangle", C5 * semi(n), null, 0.25, 0.08, i * 0.05); }); tone("sine", 130.8, 130.8, 0.5, 0.12); },
    bigbang() {
      // 300 ms de silence (le maître tombe à 0 en 20 ms), puis accord do-mi-sol-do de 2 s
      const t = ctx.currentTime;
      master.gain.cancelScheduledValues(t); master.gain.setValueAtTime(master.gain.value, t);
      master.gain.linearRampToValueAtTime(0, t + 0.02); master.gain.setValueAtTime(0, t + 0.3); master.gain.linearRampToValueAtTime(1, t + 0.32);
      [0, 4, 7, 12].forEach((n) => {
        const f = 261.63 * semi(n);
        tone("sine", f, null, 2, 0.12, 0.32, 0.05);
        toneF("sawtooth", f, null, 2, 0.05, 0.32, 0.05, "lowpass", 1800);
      });
      tone("sine", 65.4, 60, 1.6, 0.35, 0.32, 0.02);
      noise(1.2, "lowpass", 6000, 300, 0.7, 0.25, 0.32, 0.01);
    },
    heart() { tone("sine", 60, 56, 0.08, 0.32); tone("sine", 60, 56, 0.08, 0.26, 0.18); },
    // alerte ambre (§4) : un seul battement sourd + un fil de verre qui vibre
    warn() { tone("sine", 62, 56, 0.09, 0.26); tone("triangle", 1244.5, 1175, 0.22, 0.03, 0.02); },
    overflow() { toneF("sawtooth", 400, 80, 0.6, 0.2, 0, 0.005, "lowpass", 1400, 2); tone("sine", 80, 40, 0.6, 0.2); },
    reel() { noise(0.01, "highpass", 3000, 3000, 1, 0.2); },
    ding() { tone("sine", 1568, 1568, 0.25, 0.15); },
    launch() { tone("sine", 300, 700, 0.08, 0.12); noise(0.12, "bandpass", 1200, 3200, 2, 0.15); },
    swap() { tone("sine", 880, 1320, 0.05, 0.08); tone("sine", 1320, 880, 0.05, 0.08, 0.06); },
    freeze() { tone("sine", 2400, 1800, 0.15, 0.06); tone("triangle", 3200, 2600, 0.12, 0.04, 0.03); bell(2093, 0.3, 0.03, 0.02, 3.5, 1); },
    burn() { noise(0.15, "bandpass", 900, 400, 1, 0.25); noise(0.05, "highpass", 3000, 3000, 1, 0.08, 0.05); },
    bolt() { noise(0.12, "highpass", 2500, 1200, 1, 0.35); tone("square", 880, 220, 0.08, 0.06); toneF("sawtooth", 60, 50, 0.15, 0.08, 0, 0.003, "lowpass", 600); },
    plasma() { toneF("sawtooth", 180, 90, 0.4, 0.14, 0, 0.005, "lowpass", 1800, 4); noise(0.3, "bandpass", 800, 3000, 1.5, 0.2); },
    explosion() { noise(0.3, "lowpass", 1200, 150, 0.8, 0.35); tone("sine", 90, 45, 0.25, 0.2); },
    absorb() { tone("sine", 500, 120, 0.3, 0.18); noise(0.25, "bandpass", 2000, 400, 2, 0.08); },
    candle() { noise(0.4, "bandpass", 1200, 300, 2, 0.4); bell(784, 0.8, 0.06, 0.2); },
    spawn() { toneF("sawtooth", 70, 90, 0.35, 0.05, 0, 0.1, "lowpass", 300); noise(0.3, "lowpass", 400, 200, 1, 0.1, 0, 0.08); },
    fall() { tone("sine", 140, 60, 0.18, 0.14); noise(0.08, "lowpass", 600, 300, 1, 0.15); },
    evaporate() { noise(0.35, "highpass", 3000, 7000, 0.8, 0.12, 0, 0.05); },
    grow() { tone("sine", 440, 880, 0.14, 0.1); tone("triangle", 660, 1320, 0.12, 0.04, 0.04); },
    bonusShot() { [0, 7, 12].forEach((n, i) => bell(C5 * semi(n), 0.3, 0.08, i * 0.06, 2.01, 1)); },
    devour() { tone("sine", 200, 60, 0.3, 0.2); noise(0.2, "lowpass", 800, 200, 1, 0.2); },
    clash() { noise(0.18, "lowpass", 3000, 400, 1, 0.25); tone("sine", 150, 70, 0.2, 0.18); },
    final(p) { bell(p.src === "bigbang" ? 523.25 : 784, 0.5, 0.12); tone("sine", 130.8, 130.8, 0.4, 0.1); },
    whoosh() { noise(0.25, "bandpass", 400, 1600, 1.5, 0.2, 0, 0.05); },
    victory() {
      const seq = [0, 4, 7, 12, 16, 19, 24];
      seq.forEach((n, i) => { tone("triangle", C5 * semi(n) / 2, null, 0.35, 0.1, i * 0.09); bell(C5 * semi(n), 0.6, 0.07, i * 0.09, 2.01, 1.5); });
      [0, 4, 7].forEach((n) => tone("sine", 261.63 * semi(n), null, 1.8, 0.07, 0.7, 0.05));
    },
    lose() { [7, 3, 0, -5].forEach((n, i) => toneF("triangle", C5 * semi(n) / 2, null, 0.5, 0.09, i * 0.22, 0.02, "lowpass", 1400)); tone("sine", 65, 55, 1.4, 0.15, 0.7, 0.1); },
    nightStart(p) { const b = p.boss ? 220 : 261.63; [0, p.boss ? 3 : 4, 7].forEach((n, i) => bell(b * 2 * semi(n), 0.9, 0.05, i * 0.12, 2.01, 1.2)); },
    ui() { tone("sine", 1200, 1200, 0.015, 0.12); },
    ok() { tone("sine", 784, 784, 0.09, 0.14); tone("sine", 1046.5, 1046.5, 0.14, 0.14, 0.08); },
    no() { tone("sine", 440, 440, 0.08, 0.12); tone("sine", 330, 330, 0.12, 0.12, 0.08); },
    buy() { SOUNDS.coin(); tone("triangle", 1046.5, 1046.5, 0.15, 0.1, 0.06); },
    sell() { tone("sine", 1760, 1318.5, 0.1, 0.1); tone("sine", 1318.5, 988, 0.1, 0.08, 0.06); },
    reroll() { for (let i = 0; i < 6; i++) noise(0.012, "highpass", 3000, 3000, 1, 0.16, i * (0.03 + i * 0.008)); tone("sine", 1568, 1568, 0.15, 0.08, 0.22); },
    lock() { tone("square", 1800, 1200, 0.03, 0.04); noise(0.02, "highpass", 4000, 4000, 1, 0.1); },
  };
  // durées minimales entre deux déclenchements (s) — évite la bouillie à ×4
  const LIMIT = { wall: 0.04, land: 0.035, hit: 0.03, tick: 0.02, coin: 0.05, tic: 0.035, burn: 0.08, freeze: 0.06, evaporate: 0.08,
    spawn: 0.12, fall: 0.06, heart: 0.5, warn: 1.5, stone: 0.04, bolt: 0.05, kill: 0.04, launch: 0.05, armor: 0.1, explosion: 0.06, ui: 0.03 };
  // envoi vers la réverbération
  const WET = { quota: 0.35, peg: 0.25, reaction: 0.45, relic: 0.3, total: 0.3, bigbang: 0.5, kaching: 0.35, bonusShot: 0.4, victory: 0.45, lose: 0.4,
    nightStart: 0.5, candle: 0.4, freeze: 0.3, merge: 0.15, final: 0.35, ding: 0.3, grow: 0.2 };
  const lastPlay = {};

  /** Joue un son par nom (voir SOUNDS). p.x (logique) → panoramique. Silencieux si l'audio n'est pas prêt. */
  A.play = function (name, p) {
    if (!A.ready || A.muted || !ctx || ctx.state !== "running") return;
    const f = SOUNDS[name];
    if (!f || appliedSfx === 0) return;
    const lim = LIMIT[name];
    if (lim) { const now = ctx.currentTime; if (now - (lastPlay[name] || -1) < lim) return; lastPlay[name] = now; }
    p = p || EMPTY;
    try {
      beginVoice(typeof p.x === "number" ? (p.x - 180) / 180 * 0.6 : 0, WET[name] || 0);
      f(p);
    } catch (e) { A.lastError = name + ": " + e.message; /* ne jamais casser le jeu pour un son */ }
    cur = null;
  };
  A.SOUNDS = SOUNDS;
  /** Abaisse momentanément la musique (depth 0–1) pendant dur s. */
  A.duck = function (depth, dur) {
    if (!ctx) return;
    const t = ctx.currentTime, gv = musDuck.gain;
    try {
      gv.cancelScheduledValues(t); gv.setValueAtTime(gv.value, t);
      gv.linearRampToValueAtTime(Math.max(0, 1 - depth), t + 0.03);
      gv.setValueAtTime(Math.max(0, 1 - depth), t + dur);
      gv.linearRampToValueAtTime(1, t + dur + 0.9);
    } catch (e) { /* */ }
  };

  // ================================================================ musique générative
  // Harmonies (MIDI) : [basse, notes de nappe…] ; gamme pentatonique pour les mélodies.
  const HARM = {
    normal: { chords: [[36, 48, 55, 59, 64], [33, 45, 52, 55, 60]], scale: [60, 62, 64, 67, 69], cutoff: 1200 },      // do maj7 ↔ la m7
    boss: { chords: [[33, 45, 52, 59, 60], [29, 41, 48, 52, 57]], scale: [57, 60, 62, 64, 67], cutoff: 1000 },        // la m(add9) ↔ fa maj7
    eclipse: { chords: [[29, 41, 48, 55, 56], [25, 37, 49, 53, 60]], scale: [53, 56, 58, 60, 63], cutoff: 900 },      // fa m(add9) ↔ ré♭ maj7
  };
  const STEP = 0.5;            // croche à 60 BPM
  const STEPS_PER_CHORD = 16;  // 8 s par accord
  const music = (A.music = {
    lune: 1, nuit: 0, ducked: false, running: false, filter: null, lfo: null, next: 0, step: 0, chord: 0, melody: 64, bb: 0,
    start() {
      if (!ctx || this.running) return;
      this.running = true;
      this.filter = ctx.createBiquadFilter(); this.filter.type = "lowpass"; this.filter.frequency.value = this.ducked ? 700 : 1200; this.filter.Q.value = 0.8;
      this.lfo = ctx.createOscillator(); const lg = ctx.createGain();
      this.lfo.frequency.value = 0.1; lg.gain.value = 300; this.lfo.connect(lg); lg.connect(this.filter.frequency); this.lfo.start();
      this.filter.connect(musDuck);
      if (revIn) { const s = ctx.createGain(); s.gain.value = 0.55; this.filter.connect(s); s.connect(revIn); }
      this.next = ctx.currentTime + 0.3; this.step = 0;
    },
    setLune(n) { this.lune = n || 1; },
    setNight(lune, nuit) { this.lune = lune || this.lune; this.nuit = nuit || 0; },
    harm() { return this.lune >= 5 && this.nuit === 2 ? HARM.eclipse : this.nuit === 2 ? HARM.boss : HARM.normal; },
    /** Aube / menus : passe-bas à 700 Hz (effet « feutré »). */
    duck(on) {
      this.ducked = !!on;
      if (this.filter && ctx) this.filter.frequency.setTargetAtTime(on ? 700 : this.harm().cutoff, ctx.currentTime, 0.4);
    },
    /** Coupe la musique (Big Bang) pendant dur s. */
    silence(dur) { A.duck(1, dur); },
    note(type, midi, t, att, hold, rel, gain, detune, dest) {
      const o = ctx.createOscillator(), gn = ctx.createGain();
      o.type = type; o.frequency.value = mtof(midi); if (detune) o.detune.value = detune;
      gn.gain.setValueAtTime(0.0001, t); gn.gain.linearRampToValueAtTime(gain, t + att);
      gn.gain.setValueAtTime(gain, t + att + hold); gn.gain.exponentialRampToValueAtTime(0.0001, t + att + hold + rel);
      o.connect(gn); gn.connect(dest || this.filter);
      o.start(t); o.stop(t + att + hold + rel + 0.05);
      return o;
    },
    pluck(midi, t, gain, dur, dest) { // boîte à musique : sinus + harmonique brillante
      this.note("sine", midi, t, 0.004, 0, dur, gain, 0, dest);
      this.note("triangle", midi + 12, t, 0.003, 0, dur * 0.4, gain * 0.25, 3, dest);
    },
    schedule(step, t) {
      const H = this.harm(), s = step % STEPS_PER_CHORD;
      if (s === 0) this.chord = (this.chord + 1) % H.chords.length;
      const ch = H.chords[this.chord];
      const layers = Math.min(5, 1 + this.lune);
      // 1. nappe : dents de scie filtrées, légèrement désaccordées
      if (s === 0) {
        for (let i = 1; i < ch.length; i++) this.note("sawtooth", ch[i], t, 2.2, 4.8, 2.4, 0.03, i % 2 ? 7 : -7);
        this.note("triangle", ch[1], t, 2.5, 4.5, 2.4, 0.05);
      }
      // 2. basse : fondamentale toutes les 4 s
      if (layers >= 2 && (s === 0 || s === 8)) {
        this.note("triangle", ch[0], t, 0.03, 0.6, 2.6, 0.13);
        this.note("sine", ch[0] - 12, t, 0.05, 0.4, 2.2, 0.1);
      }
      // 3. boîte à musique : arpège toutes les 2 mesures (sur l'accord, deux octaves au-dessus)
      if (layers >= 3 && s < 8 && (s !== 7 || Math.random() < 0.5)) {
        const pool = ch.slice(1);
        const up = s < 4 ? s : 7 - s;
        const m = pool[(up + (Math.random() < 0.25 ? 1 : 0)) % pool.length] + 24;
        this.pluck(m, t + (Math.random() - 0.5) * 0.02, 0.045, 1.3, musDuck);
      }
      // 4. contre-chant : marche aléatoire lente sur la pentatonique
      if (layers >= 4 && s % 4 === 2 && Math.random() < 0.7) {
        const sc = H.scale;
        let i = sc.indexOf(this.melody); if (i < 0) i = 2;
        i = Math.max(0, Math.min(sc.length - 1, i + (Math.random() < 0.5 ? -1 : 1) * (Math.random() < 0.3 ? 2 : 1)));
        this.melody = sc[i];
        const o = this.note("triangle", this.melody + 12, t, 0.12, 0.5, 1.4, 0.04);
        const v = ctx.createOscillator(), vg = ctx.createGain(); v.frequency.value = 5; vg.gain.value = 6;
        v.connect(vg); vg.connect(o.detune); v.start(t); v.stop(t + 2.2);
      }
      // 5. pulsation : battement grave et souffle doux
      if (layers >= 5) {
        if (s % 4 === 0) { this.note("sine", ch[0] - 12, t, 0.005, 0.02, 0.35, 0.12, 0, musDuck); }
        if (s % 2 === 1) {
          const src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), gn = ctx.createGain();
          src.buffer = noiseBuf; f.type = "highpass"; f.frequency.value = 7000;
          gn.gain.setValueAtTime(0.0001, t); gn.gain.linearRampToValueAtTime(0.018, t + 0.005); gn.gain.exponentialRampToValueAtTime(0.0001, t + 0.08);
          src.connect(f); f.connect(gn); gn.connect(musDuck); src.start(t, Math.random() * 0.5); src.stop(t + 0.1);
        }
      }
    },
    update() {
      if (!this.running || !ctx || ctx.state !== "running") return;
      const now = ctx.currentTime;
      if (this.next < now - 0.5) this.next = now + 0.05; // reprise après suspension
      while (this.next < now + 0.25) {
        this.schedule(this.step, this.next);
        this.step++; this.next += STEP;
      }
    },
  });

  A.update = function () {
    if (!ctx) return;
    try { A.applySettings(); music.update(); } catch (e) { A.lastError = "music: " + e.message; }
  };

  // ---------------------------------------------------------------- liaison au bus d'événements
  const MAP = {
    wall: "wall", land: "land", stone: "stone", bolt: "bolt", launch: "launch", freeze: "freeze", candle: "candle",
    overflow: "overflow", "count:tick": "tick", "count:relic": "relic", "count:total": "total", gold: "coin",
    "ui:tap": "ui", "ui:ok": "ok", "ui:no": "no", "shop:buy": "buy", heart: "heart", coinArrive: "tic", swap: "swap",
    plasma: "plasma", explosion: "explosion", spawn: "spawn", shadowFall: "fall", stoneDrop: "fall", evaporate: "evaporate",
    grow: "grow", bonusShot: "bonusShot", devour: "devour", "count:clash": "clash", "count:final": "final",
    "shop:sell": "sell", "shop:reroll": "reroll", "shop:lock": "lock", victory: "victory", split: "grow",
    "shop:purge": "evaporate",
  };
  for (const ev in MAP) BE.on(ev, (d) => A.play(MAP[ev], d));
  const PEG = { k: 0, x: 0, dark: false, special: false };
  BE.on("peg", (d) => { PEG.k = d.k; PEG.x = d.x; PEG.dark = !!d.dark; PEG.special = !!(d.peg && d.peg.kind === "special"); A.play("peg", PEG); });
  const HIT = { x: 0 };
  BE.on("hit", (d) => { HIT.x = d.x; A.play("hit", HIT); });
  BE.on("damage", (d) => { if (d.blocked) A.play("armor", d); });
  BE.on("kill", (d) => A.play("kill", { x: d.x, boss: d.type === "boss" }));
  BE.on("bossKill", () => A.duck(0.6, 1.2));
  BE.on("merge", (d) => { A.play("merge", d); if (d.size >= 5) A.duck(0.35, 0.5); });
  BE.on("reaction", (d) => { A.play("reaction", { x: d.x, f: (BE.DATA.REACTIONS[d.id] || EMPTY).freq || 660 }); A.duck(0.3, 0.4); });
  BE.on("alert", (d) => A.play(d.level >= 2 ? "heart" : "warn")); // montée d'alerte à la visée (12_fx)
  BE.on("burnTick", (d) => A.play("burn", d));
  BE.on("burn", (d) => A.play("burn", d));
  BE.on("absorb", (d) => A.play("absorb", d));
  BE.on("convert", () => A.play("tic"));
  // quota : accord immédiat, puis « ka-ching » au moment où les Ombres se changent en or (après le gel de 0,5 s, §11.3)
  BE.on("quota", () => { A.play("quota"); A.play("kaching", { delay: BE.DATA.FX.nightWonFreeze }); A.duck(0.45, 1.2); });
  BE.on("bigbang", () => { A.play("bigbang"); music.silence(2.6); });
  BE.on("collapse", (d) => { A.play("merge", { size: d.size, pure: false }); A.duck(0.35, 0.5); });
  BE.on("overflow", () => A.duck(0.8, 1.6));
  BE.on("victory", () => A.duck(0.7, 2.2));
  BE.on("count:start", () => A.play("whoosh"));
  BE.on("nuitBlanche", () => { A.play("nightStart", { boss: true }); A.duck(0.5, 1.2); }); // la nuit continue (09_run)
  BE.on("nightStart", (d) => { music.setNight(d.lune, d.nuit); if (!music.ducked) music.duck(false); A.play("nightStart", { boss: d.nuit === 2 }); });
  BE.on("scene", (e) => {
    if (e.to === "RUN_LOST") { const run = BE.state.run; if (!run || !run.result || run.result.cause !== "abandon") { A.play("lose"); A.duck(0.6, 2); } }
    if (e.to === "TITLE") music.setNight(1, 0);
  });
})(window.BE = window.BE || {});
