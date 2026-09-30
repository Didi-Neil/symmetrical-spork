/* 05_physics.js — BE.Phys : physique déterministe à pas fixe (§5). Régime VOL et régime BOCAL. Aucun Math.random. */
(function (BE) {
  "use strict";

  const Phys = (BE.Phys = {});
  const D = BE.DATA;
  const PF = D.PHYS.flight, PJ = D.PHYS.jar;

  // ================================================================ VOL
  /**
   * Crée une étoile en vol.
   * spec: {id, size, color, grav?, bagId?}, angleDeg (0 = droite, croissant vers le bas), opts {speedMul, x, y}
   */
  Phys.makeFlightStar = function (spec, angleDeg, opts) {
    opts = opts || {};
    const a = angleDeg * Math.PI / 180;
    const v = PF.v0 * (opts.speedMul || 1);
    return {
      id: spec.id, size: spec.size, color: spec.color, grav: spec.grav || null, bagId: spec.bagId,
      r: D.SIZES[spec.size].r,
      x: opts.x !== undefined ? opts.x : D.GEOM.phare.x, y: opts.y !== undefined ? opts.y : D.GEOM.phare.y,
      vx: Math.cos(a) * v, vy: Math.sin(a) * v,
      alive: true, exited: false, absorbed: false,
      pegContacts: 0, seveGrown: false, prismUsed: false, dmgBonus: opts.dmgBonus || 0,
      cd: {}, t: 0, trail: [], lookX: 0, lookY: 0,
    };
  };

  /**
   * Collision cercle mobile contre obstacle statique (§5.3). Mute s.
   * Renvoie 0 : pas de contact ; 1 : chevauchement sans impact ; 2 : impact (vn < 0).
   */
  function collideStatic(s, cx, cy, rc, e) {
    let dx = s.x - cx, dy = s.y - cy;
    const rr = s.r + rc;
    const d2 = dx * dx + dy * dy;
    if (d2 >= rr * rr) return 0;
    let d = Math.sqrt(d2);
    if (d < 1e-6) { dx = 0; dy = -1; d = 1; }
    const nx = dx / d, ny = dy / d;
    s.x = cx + nx * (rr + 0.01); s.y = cy + ny * (rr + 0.01);
    const vn = s.vx * nx + s.vy * ny;
    if (vn >= 0) return 1;
    // v -= (1+e) vn n ; puis v_t *= 0,98
    const vtx = s.vx - vn * nx, vty = s.vy - vn * ny;
    s.vx = vtx * PF.tangent - e * vn * nx;
    s.vy = vty * PF.tangent - e * vn * ny;
    return 2;
  }
  Phys.collideStatic = collideStatic;

  function minSpeed(s) {
    const sp = Math.hypot(s.vx, s.vy);
    if (sp < PF.vminHit) {
      if (sp < 1e-6) { s.vx = 0; s.vy = PF.vminHit; }
      else { s.vx *= PF.vminHit / sp; s.vy *= PF.vminHit / sp; }
    }
  }
  function clampSpeed(s) {
    const sp = Math.hypot(s.vx, s.vy);
    if (sp > PF.vmax) { s.vx *= PF.vmax / sp; s.vy *= PF.vmax / sp; }
  }

  /**
   * Un pas de VOL. world = {
   *   stars:[], pegs:[{idx,x,y,r,active,...}], targets:[{id,x,y,r,alive}],
   *   g, t, wallL, wallR, ceil, exitY, ignoreObstacles:boolean,
   *   hooks:{ pegRest(star,peg)->e, peg(star,peg), target(star,tg)->"absorb"|undefined, wall(star,side), exit(star) }
   * }
   * Les étoiles ne se touchent pas entre elles. Ordre : id croissant.
   */
  Phys.stepFlight = function (world, dt) {
    world.t += dt;
    const H = world.hooks || {};
    const stars = world.stars;
    for (let i = 0; i < stars.length; i++) {
      const s = stars[i];
      if (!s.alive || s.exited) continue;
      s.t += dt;
      s.vy += world.g * dt;
      s.x += s.vx * dt; s.y += s.vy * dt;
      // murs
      if (s.x - s.r < world.wallL) {
        s.x = world.wallL + s.r;
        if (s.vx < 0) { s.vx = -s.vx * PF.eWall; s.vy *= PF.tangent; if (H.wall) H.wall(s, "L"); }
      } else if (s.x + s.r > world.wallR) {
        s.x = world.wallR - s.r;
        if (s.vx > 0) { s.vx = -s.vx * PF.eWall; s.vy *= PF.tangent; if (H.wall) H.wall(s, "R"); }
      }
      if (s.y - s.r < world.ceil) {
        s.y = world.ceil + s.r;
        if (s.vy < 0) { s.vy = -s.vy * PF.eWall; s.vx *= PF.tangent; if (H.wall) H.wall(s, "T"); }
      }
      const ignore = world.ignoreObstacles || s.t >= PF.ignoreAfter;
      if (!ignore) {
        // clous
        const pegs = world.pegs;
        for (let k = 0; k < pegs.length; k++) {
          const p = pegs[k];
          if (!p.active) continue;
          const e = H.pegRest ? H.pegRest(s, p) : PF.ePeg;
          const c = collideStatic(s, p.x, p.y, p.r, e);
          if (c === 2) {
            minSpeed(s);
            const key = "p" + p.idx;
            const last = s.cd[key];
            if (last === undefined || world.t - last >= PF.cooldown) {
              s.cd[key] = world.t;
              if (H.peg) H.peg(s, p);
            }
          }
        }
        // Ombres et boss
        const tg = world.targets;
        for (let k = 0; k < tg.length; k++) {
          const o = tg[k];
          if (!o.alive) continue;
          const c = collideStatic(s, o.x, o.y, o.r, PF.eShadow);
          if (c === 2) {
            minSpeed(s);
            const key = "t" + o.id;
            const last = s.cd[key];
            if (last === undefined || world.t - last >= PF.cooldown) {
              s.cd[key] = world.t;
              if (H.target && H.target(s, o) === "absorb") { s.alive = false; s.absorbed = true; break; }
            }
          }
        }
      }
      clampSpeed(s);
      if (s.alive && s.y > world.exitY) {
        s.exited = true;
        if (H.exit) H.exit(s);
      }
    }
  };

  /**
   * Aperçu de trajectoire (§2.1, §12.7) : simulation fantôme sans effets ni hooks.
   * Renvoie {pts:[x0,y0,x1,y1,…], contacts:[{x,y}], tailFrom:index de point où commence la « queue »}.
   */
  Phys.preview = function (world, spec, angleDeg, maxContacts, opts) {
    opts = opts || {};
    const s = Phys.makeFlightStar(spec, angleDeg, opts);
    const dt = D.PHYS.dt;
    const pts = [s.x, s.y];
    const contacts = [];
    const maxSteps = opts.maxSteps || D.PHYS.previewSteps;
    let tailFrom = -1, tailLeft = 22;
    const restFn = world.hooks && world.hooks.pegRest;
    for (let step = 0; step < maxSteps; step++) {
      s.vy += world.g * dt;
      s.x += s.vx * dt; s.y += s.vy * dt;
      if (s.x - s.r < world.wallL) { s.x = world.wallL + s.r; if (s.vx < 0) { s.vx = -s.vx * PF.eWall; s.vy *= PF.tangent; } }
      else if (s.x + s.r > world.wallR) { s.x = world.wallR - s.r; if (s.vx > 0) { s.vx = -s.vx * PF.eWall; s.vy *= PF.tangent; } }
      if (s.y - s.r < world.ceil) { s.y = world.ceil + s.r; if (s.vy < 0) { s.vy = -s.vy * PF.eWall; s.vx *= PF.tangent; } }
      let hit = false;
      for (let k = 0; k < world.pegs.length; k++) {
        const p = world.pegs[k]; if (!p.active) continue;
        if (collideStatic(s, p.x, p.y, p.r, restFn ? restFn(s, p) : PF.ePeg) === 2) { minSpeed(s); hit = true; }
      }
      for (let k = 0; k < world.targets.length; k++) {
        const o = world.targets[k]; if (!o.alive) continue;
        if (collideStatic(s, o.x, o.y, o.r, PF.eShadow) === 2) { minSpeed(s); hit = true; }
      }
      clampSpeed(s);
      if ((step & 1) === 0 || hit) pts.push(s.x, s.y);
      if (hit && tailFrom < 0) {
        contacts.push({ x: s.x, y: s.y });
        if (contacts.length >= maxContacts) tailFrom = pts.length / 2 - 1;
      }
      if (tailFrom >= 0 && --tailLeft <= 0) break;
      if (s.y > world.exitY) break;
    }
    return { pts, contacts, tailFrom };
  };

  // ================================================================ BOCAL
  /** Crée un corps du bocal. spec: {id,size,color,stone?,x,y,vx?,vy?} */
  Phys.makeBody = function (spec) {
    const r = spec.r || D.SIZES[spec.size].r;
    const m = r * r * (spec.stone ? PJ.stoneMass : 1);
    return {
      id: spec.id, size: spec.size, color: spec.color || null, stone: !!spec.stone, grav: spec.grav || null,
      x: spec.x, y: spec.y, vx: spec.vx || 0, vy: spec.vy || 0, r, m, im: 1 / m,
      sleep: false, slowT: 0, age: 0, mergedStep: -1, born: spec.born || 0, pure: !!spec.pure, bicolor: spec.bicolor || null,
      squash: 0, seed: (spec.id * 2654435761) >>> 0,
    };
  };

  function Contact() { this.key = 0; this.a = null; this.b = null; this.nx = 0; this.ny = 0; this.pen = 0; this.mn = 0; this.bias = 0; this.Pn = 0; this.Pt = 0; this.ia = 0; this.ib = 0; }
  const cpool = [];
  let ccount = 0;
  function newContact() {
    if (ccount >= cpool.length) cpool.push(new Contact());
    const c = cpool[ccount++];
    c.Pn = 0; c.Pt = 0; c.b = null;
    return c;
  }
  const CM = 0.75; // marge de contact (px)
  function wake(b) { if (b.sleep) { b.sleep = false; b.slowT = 0; } }
  Phys.wake = wake;
  Phys.wakeAll = function (jar) { for (const b of jar.bodies) wake(b); };

  /** Cache des impulsions accumulées (warm starting), non sérialisé. */
  function warmCache(jar) {
    if (!jar._wc) Object.defineProperty(jar, "_wc", { value: { cur: new Map(), prev: new Map() }, enumerable: false, writable: true });
    return jar._wc;
  }
  function pairKey(c, wall) { return c.b ? c.a.id * 1e6 + c.b.id : -(c.a.id * 4 + wall); }
  function setupContact(c, e) {
    const a = c.a, b = c.b;
    const ia = c.ia, ib = c.ib;
    const k = ia + ib;
    c.mn = k > 0 ? 1 / k : 0;
    const vbx = b ? b.vx : 0, vby = b ? b.vy : 0;
    const vn = (vbx - a.vx) * c.nx + (vby - a.vy) * c.ny;
    c.bias = vn < -60 ? -e * vn : 0;
  }

  /**
   * Un pas de BOCAL. jar = {bodies:[] (triés par id), wallL, wallR, floor, g, t, step}
   * Solveur d'impulsions séquentielles (6 itérations), frottement de Coulomb, correction de position β.
   */
  Phys.stepJar = function (jar, dt) {
    const B = jar.bodies;
    const n = B.length;
    jar.step = (jar.step || 0) + 1;
    // 1) forces
    for (let i = 0; i < n; i++) {
      const b = B[i];
      if (b.sleep) continue;
      b.vy += jar.g * dt;
      b.vx *= PJ.damp; b.vy *= PJ.damp;
    }
    // 2) contacts
    ccount = 0;
    for (let i = 0; i < n; i++) {
      const a = B[i];
      for (let j = i + 1; j < n; j++) {
        const b = B[j];
        if (a.sleep && b.sleep) continue;
        // contacts « au toucher » (marge CM) : un corps posé reste dans le solveur même à pénétration nulle
        const dx = b.x - a.x, dy = b.y - a.y, rr = a.r + b.r, rm = rr + CM;
        if (Math.abs(dx) >= rm || Math.abs(dy) >= rm) continue;
        const d2 = dx * dx + dy * dy;
        if (d2 >= rm * rm) continue;
        // réveil
        if (a.sleep && Math.hypot(b.vx, b.vy) > PJ.wakeV) wake(a);
        if (b.sleep && Math.hypot(a.vx, a.vy) > PJ.wakeV) wake(b);
        let d = Math.sqrt(d2);
        const c = newContact();
        c.a = a; c.b = b;
        if (d < 1e-6) { c.nx = a.id < b.id ? 1 : -1; c.ny = 0; d = 0; } else { c.nx = dx / d; c.ny = dy / d; }
        c.pen = rr - d;
        c.ia = a.sleep ? 0 : a.im; c.ib = b.sleep ? 0 : b.im;
        c.key = pairKey(c, 0);
        setupContact(c, a.stone || b.stone ? PJ.eStone : PJ.e);
      }
      if (a.sleep) continue;
      const ew = a.stone ? PJ.eStone : PJ.eWall;
      if (a.x - a.r < jar.wallL + CM) { const c = newContact(); c.a = a; c.nx = -1; c.ny = 0; c.pen = jar.wallL - (a.x - a.r); c.ia = a.im; c.ib = 0; c.key = pairKey(c, 1); setupContact(c, ew); }
      if (a.x + a.r > jar.wallR - CM) { const c = newContact(); c.a = a; c.nx = 1; c.ny = 0; c.pen = a.x + a.r - jar.wallR; c.ia = a.im; c.ib = 0; c.key = pairKey(c, 2); setupContact(c, ew); }
      if (a.y + a.r > jar.floor - CM) { const c = newContact(); c.a = a; c.nx = 0; c.ny = 1; c.pen = a.y + a.r - jar.floor; c.ia = a.im; c.ib = 0; c.key = pairKey(c, 3); setupContact(c, ew); }
    }
    // 3) solveur de vitesse (avec warm starting : impulsions du pas précédent réappliquées)
    const WC = warmCache(jar);
    for (let k = 0; k < ccount; k++) {
      const c = cpool[k];
      if (c.mn === 0) continue;
      const w = WC.prev.get(c.key);
      if (!w) continue;
      c.Pn = w.Pn * 0.95; c.Pt = w.Pt * 0.95;
      const tx = -c.ny, ty = c.nx;
      const px = c.Pn * c.nx + c.Pt * tx, py = c.Pn * c.ny + c.Pt * ty;
      c.a.vx -= px * c.ia; c.a.vy -= py * c.ia;
      if (c.b) { c.b.vx += px * c.ib; c.b.vy += py * c.ib; }
    }
    for (let it = 0; it < PJ.iters; it++) {
      for (let k = 0; k < ccount; k++) {
        const c = cpool[k];
        if (c.mn === 0) continue;
        const a = c.a, b = c.b;
        const vbx = b ? b.vx : 0, vby = b ? b.vy : 0;
        const dvx = vbx - a.vx, dvy = vby - a.vy;
        const vn = dvx * c.nx + dvy * c.ny;
        let dPn = c.mn * (-vn + c.bias);
        const P0 = c.Pn;
        c.Pn = Math.max(P0 + dPn, 0);
        dPn = c.Pn - P0;
        let px = dPn * c.nx, py = dPn * c.ny;
        a.vx -= px * c.ia; a.vy -= py * c.ia;
        if (b) { b.vx += px * c.ib; b.vy += py * c.ib; }
        // frottement
        const tx = -c.ny, ty = c.nx;
        const vbx2 = b ? b.vx : 0, vby2 = b ? b.vy : 0;
        const vt = (vbx2 - a.vx) * tx + (vby2 - a.vy) * ty;
        let dPt = c.mn * -vt;
        const maxPt = PJ.mu * c.Pn;
        const T0 = c.Pt;
        c.Pt = Math.max(-maxPt, Math.min(maxPt, T0 + dPt));
        dPt = c.Pt - T0;
        px = dPt * tx; py = dPt * ty;
        a.vx -= px * c.ia; a.vy -= py * c.ia;
        if (b) { b.vx += px * c.ib; b.vy += py * c.ib; }
      }
    }
    // mémorise les impulsions pour le pas suivant
    const tmp = WC.prev; WC.prev = WC.cur; WC.cur = tmp; WC.cur.clear();
    for (let k = 0; k < ccount; k++) {
      const c = cpool[k];
      if (c.Pn > 0 || c.Pt !== 0) WC.prev.set(c.key, { Pn: c.Pn, Pt: c.Pt });
    }
    // 4) intégration
    for (let i = 0; i < n; i++) {
      const b = B[i];
      if (b.sleep) continue;
      b.x += b.vx * dt; b.y += b.vy * dt;
    }
    // 5) correction de position (Baumgarte β, marge)
    for (let pass = 0; pass < 3; pass++) {
      for (let k = 0; k < ccount; k++) {
        const c = cpool[k];
        const a = c.a, b = c.b;
        const kk = c.ia + c.ib;
        if (kk === 0) continue;
        let pen;
        if (b) {
          const dx = b.x - a.x, dy = b.y - a.y;
          const d = Math.hypot(dx, dy);
          if (d > 1e-6) { c.nx = dx / d; c.ny = dy / d; }
          pen = a.r + b.r - d;
        } else if (c.nx === -1) pen = jar.wallL - (a.x - a.r);
        else if (c.nx === 1) pen = a.x + a.r - jar.wallR;
        else pen = a.y + a.r - jar.floor;
        if (pen <= PJ.slop) continue;
        const corr = PJ.beta * (pen - PJ.slop) / kk;
        a.x -= corr * c.ia * c.nx; a.y -= corr * c.ia * c.ny;
        if (b) { b.x += corr * c.ib * c.nx; b.y += corr * c.ib * c.ny; }
      }
    }
    // garde-fou murs
    for (let i = 0; i < n; i++) {
      const b = B[i];
      if (b.x - b.r < jar.wallL) { b.x = jar.wallL + b.r; if (b.vx < 0) b.vx = 0; }
      if (b.x + b.r > jar.wallR) { b.x = jar.wallR - b.r; if (b.vx > 0) b.vx = 0; }
      if (b.y + b.r > jar.floor) { b.y = jar.floor - b.r; if (b.vy > 0) b.vy = 0; }
    }
    // 6) sommeil
    for (let i = 0; i < n; i++) {
      const b = B[i];
      b.age++;
      if (b.sleep) continue;
      if (b.vx * b.vx + b.vy * b.vy < PJ.sleepV * PJ.sleepV) {
        b.slowT += dt;
        if (b.slowT >= PJ.sleepT) { b.sleep = true; b.vx = 0; b.vy = 0; }
      } else b.slowT = 0;
    }
    jar.t = (jar.t || 0) + dt;
  };

  /** Contacts du dernier pas du bocal (débogage). */
  Phys.contacts = function () {
    const out = [];
    for (let k = 0; k < ccount; k++) { const c = cpool[k]; out.push({ a: c.a.id, b: c.b ? c.b.id : "mur", nx: +c.nx.toFixed(2), ny: +c.ny.toFixed(2), pen: +c.pen.toFixed(2), Pn: +c.Pn.toFixed(1), Pt: +c.Pt.toFixed(1), ia: c.ia, ib: c.ib }); }
    return out;
  };
  /** Tous les corps endormis ? */
  Phys.allAsleep = function (jar) {
    for (const b of jar.bodies) if (!b.sleep) return false;
    return true;
  };
  /** Force le repos : vitesses à 0, tous endormis. */
  Phys.freeze = function (jar) {
    for (const b of jar.bodies) { b.vx = 0; b.vy = 0; b.sleep = true; b.slowT = 0; }
  };

  /** Hash d'état (tests de déterminisme §13.2-7d). */
  Phys.hashJar = function (jar) {
    let s = "";
    for (const b of jar.bodies) s += b.id + ":" + b.size + ":" + b.x.toFixed(3) + ":" + b.y.toFixed(3) + ";";
    return BE.util.fnv1a(s);
  };
})(window.BE = window.BE || {});
