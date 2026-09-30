/* 10_shop.js — BE.Shop : Aube (§7.3, §8, §10.5).
 *  - Logique : offres (reliques, étoiles, clous spéciaux, gravures), achat, vente, relance, verrouillage,
 *    réordonnancement, pose de clou (paires), gravure, Épurer le Sac, paquet Constellation (Coffre),
 *    évolutions automatiques (§8.2), aperçu chiffré exact (§7.1).
 *  - Vue (BE.Shop.View) : cartes des nouveaux articles, mini-carte de pose, choix d'étoile / de couleur,
 *    rouleaux de la Constellation, Sac avec Épurer, animation d'évolution. Branchée dans 13_ui.js par
 *    quelques appels (voir docs/ARCHITECTURE.md §Boutique).
 * Toute la génération passe par le flux RNG `shop` (jamais Math.random, sauf cosmétique dans la Vue).
 */
(function (BE) {
  "use strict";

  const Shop = (BE.Shop = {});
  const D = BE.DATA, U = BE.util, E = D.ECO;
  const SLOTS = ["A", "B", "C", "D", "E", "F"];

  function unlocked(src) { return !src || src.type === "depart" || !!(BE.Meta && BE.Meta.isUnlocked(src)); }
  Shop.unlocked = unlocked;
  function save() { if (BE.Run && BE.Run.save) BE.Run.save(); }

  // ================================================================ prix
  /** Prix d'une relique : rareté (+1 Éclipse ≥ 3, −1 Glaneuse, minimum 2). */
  Shop.relicPrice = function (run, id) {
    const d = D.RELIC_BY_ID[id];
    const p = (E.relicPrice[d.rar] || E.relicPrice.C) + (run.eclipse >= 3 ? 1 : 0) - (run.rules.relicDiscount || 0);
    return Math.max(E.relicMinPrice || 2, p);
  };
  /** Vente : moitié du prix, arrondi à l'inférieur, minimum 1. */
  Shop.sellPrice = (run, id) => Math.max(1, Math.floor(Shop.relicPrice(run, id) / 2));
  Shop.clouPrice = () => E.clou;
  Shop.clouRefund = () => Math.floor(E.clou * E.clouRefund);
  Shop.gravurePrice = () => E.gravure;
  Shop.purgePrice = () => E.purge;

  // ================================================================ pools (déblocages)
  /** Familles disponibles (Sève verrouillée sans La Serre). */
  Shop.families = function () {
    return D.FAMILY_ORDER.filter((f) => !D.FAMILIES[f].room || unlocked({ type: "room", id: D.FAMILIES[f].room }));
  };
  /** Ids de reliques « possédées » (y compris la base d'une évolution). */
  function ownedIds(run) {
    const out = [];
    for (const r of run.relics) {
      out.push(r.id);
      const d = D.RELIC_BY_ID[r.id];
      if (d && d.base) out.push(d.base);
    }
    return out;
  }
  function relicPool(run, exclude) {
    const owned = ownedIds(run);
    return D.RELICS.filter((r) => !r.evo && unlocked(r.src) && owned.indexOf(r.id) < 0 && exclude.indexOf(r.id) < 0);
  }
  Shop.relicPool = (run) => relicPool(run, []);
  Shop.clouPool = () => Object.keys(D.CLOUS).filter((k) => unlocked(D.CLOUS[k].src));
  Shop.gravurePool = () => Object.keys(D.GRAVURES).filter((k) => unlocked(D.GRAVURES[k].src));

  /** Clé d'unicité d'un article (pas deux fois le même article dans une rangée / un paquet). */
  function itemKey(o) {
    if (o.kind === "relic") return o.id;
    if (o.kind === "clou") return "clou:" + o.type;
    if (o.kind === "gravure") return "grav:" + o.id;
    return "star:" + o.color + o.size;
  }
  Shop.itemKey = itemKey;

  function kindAvailable(run, kind, exclude) {
    switch (kind) {
      case "relic": return relicPool(run, exclude).length > 0;
      case "star": return true;
      case "clou": return Shop.clouPool().some((k) => exclude.indexOf("clou:" + k) < 0);
      case "gravure": return run.bag.length > 0 && Shop.gravurePool().some((k) => exclude.indexOf("grav:" + k) < 0);
    }
    return false;
  }

  /** Crée un article d'un type donné. opts.rarUp : Coffre (rareté +1). */
  function makeItem(run, kind, exclude, opts) {
    const st = run.streams;
    opts = opts || {};
    if (kind === "relic") {
      const pool = relicPool(run, exclude);
      const w = {};
      for (const k in D.RARITY) if (D.RARITY[k].weight > 0 && pool.some((r) => r.rar === k)) w[k] = D.RARITY[k].weight;
      let rar = U.rweighted(st, "shop", w);
      if (opts.rarUp) { const up = D.RARITY_UP[rar]; if (up && pool.some((r) => r.rar === up)) rar = up; }
      const r = U.rpick(st, "shop", pool.filter((x) => x.rar === rar));
      return { kind: "relic", id: r.id, price: Shop.relicPrice(run, r.id), sold: false };
    }
    if (kind === "clou") {
      let pool = Shop.clouPool().filter((k) => exclude.indexOf("clou:" + k) < 0);
      if (!pool.length) pool = Shop.clouPool();
      return { kind: "clou", type: U.rpick(st, "shop", pool), price: Shop.clouPrice(run), sold: false };
    }
    if (kind === "gravure") {
      let pool = Shop.gravurePool().filter((k) => exclude.indexOf("grav:" + k) < 0);
      if (!pool.length) pool = Shop.gravurePool();
      return { kind: "gravure", id: U.rpick(st, "shop", pool), price: Shop.gravurePrice(run), sold: false };
    }
    // étoile
    let sizes = D.STAR_OFFERS.filter((s) => run.lune >= s.minLune);
    if (opts.rarUp) sizes = D.STAR_OFFERS.filter((s) => D.PACK.chestStarSizes.indexOf(s.size) >= 0);
    const so = U.rpick(st, "shop", sizes);
    const color = U.rpick(st, "shop", Shop.families());
    return { kind: "star", size: so.size, color, price: so.price, sold: false };
  }

  /** Génère une offre (flux `shop`). exclude : clés déjà présentes (itemKey). opts : {weights, rarUp}. */
  Shop.genOffer = function (run, exclude, opts) {
    exclude = exclude || [];
    opts = opts || {};
    const W = opts.weights || D.OFFER_WEIGHTS, w = {};
    for (const k in W) if (W[k] > 0 && kindAvailable(run, k, exclude)) w[k] = W[k];
    const kind = Object.keys(w).length ? U.rweighted(run.streams, "shop", w) : "star";
    return makeItem(run, kind, exclude, opts);
  };

  function fill(run, keepIdx) {
    const S = run.shop;
    const keys = S.offers.filter((o, i) => o && keepIdx.indexOf(i) >= 0).map(itemKey);
    for (let i = 0; i < E.offers; i++) {
      if (keepIdx.indexOf(i) >= 0 && S.offers[i]) continue;
      const o = Shop.genOffer(run, keys);
      keys.push(itemKey(o));
      S.offers[i] = o;
    }
  }

  // ================================================================ entrée / sortie de l'Aube
  function makePack(run) {
    const chest = !!(run.firm && run.firm.chest);
    if (run.firm) run.firm.chest = false; // le Coffre est consommé par cette Aube
    return { price: chest ? 0 : E.constellation, chest, state: "closed", cards: [], picks: 0, jackpot: false };
  }

  /**
   * Entrée dans l'Aube : évolutions (§8.2), offres (l'article verrouillé est conservé), paquet Constellation.
   * Idempotent pour une même nuit (reprise d'une sauvegarde).
   */
  Shop.enter = function (run) {
    const key = run.lune + "-" + run.nuit;
    if (run.shop && run.shop.key === key) {
      if (!run.shop.pack) run.shop.pack = makePack(run);
      return run.shop;
    }
    const prev = run.shop;
    const evolved = Shop.evolve(run);
    run.shop = { key, offers: [], locked: null, rerollCost: E.reroll, rerolls: 0, pack: makePack(run), evolved, evolvedSeen: !evolved.length };
    const keep = [];
    if (prev && prev.locked !== null && prev.locked !== undefined && prev.offers[prev.locked] && !prev.offers[prev.locked].sold) {
      const o = prev.offers[prev.locked];
      if (o.kind === "relic") o.price = Shop.relicPrice(run, o.id);
      run.shop.offers[prev.locked] = o;
      run.shop.locked = prev.locked;
      keep.push(prev.locked);
    }
    fill(run, keep);
    BE.emit("shop:enter", { shop: run.shop });
    return run.shop;
  };
  Shop.leave = function (run) { /* l'état est conservé pour l'article verrouillé */ };

  // ================================================================ évolutions (§8.2)
  /** L'évolution d'une relique possédée est-elle prête ? (Laboratoire + base + réaction ≥ 3 fois.) */
  Shop.evolutionReady = function (run, relicId) {
    const evo = D.EVOLUTION_BY_BASE[relicId];
    if (!evo || !unlocked(evo.src)) return null;
    return (run.reactionCounts[evo.reaction] || 0) >= D.EVOLUTION_THRESHOLD ? evo : null;
  };
  /** Progrès vers l'évolution d'une relique : {evo, n, need} ou null (Grimoire / fiche). */
  Shop.evolutionProgress = function (run, relicId) {
    const evo = D.EVOLUTION_BY_BASE[relicId];
    if (!evo || !unlocked(evo.src)) return null;
    return { evo, n: run.reactionCounts[evo.reaction] || 0, need: D.EVOLUTION_THRESHOLD };
  };
  /** Fait évoluer les reliques éligibles (même emplacement). Renvoie [{slot, from, to}]. */
  Shop.evolve = function (run) {
    const out = [];
    run.relics.forEach((r, slot) => {
      const evo = Shop.evolutionReady(run, r.id);
      if (!evo) return;
      run.relics[slot] = { id: evo.id, evolved: true, from: r.id };
      out.push({ slot, from: r.id, to: evo.id });
      if (BE.Meta && BE.Meta.discover) BE.Meta.discover("evolutions", evo.id);
    });
    if (out.length) {
      if (BE.Run && BE.Run.invalidatePassives) BE.Run.invalidatePassives();
      for (const e of out) BE.emit("evolve", e);
    }
    return out;
  };

  // ================================================================ application d'un article
  /** Choix par défaut (bots, confirmation en un geste) : {slot, color} pour un clou, {bagId} pour une gravure. */
  Shop.autoOpts = function (run, item) {
    if (item.kind === "clou") {
      const color = item.type === "teint" ? mainColor(run) : undefined;
      return { slot: Shop.bestSlot(run, item.type, color), color };
    }
    if (item.kind === "gravure") {
      let best = null;
      for (const b of run.bag) if (!b.grav && (!best || b.size > best.size)) best = b;
      return { bagId: best ? best.id : null };
    }
    return {};
  };
  function mainColor(run) {
    const n = {};
    for (const b of run.bag) n[b.color] = (n[b.color] || 0) + 1;
    let best = Shop.families()[0];
    for (const k of Shop.families()) if ((n[k] || 0) > (n[best] || 0)) best = k;
    return best;
  }
  /** Emplacements adjacents (paires) d'un emplacement. */
  Shop.slotNeighbours = function (slot) {
    const out = [];
    for (const [a, b] of D.GEOM.slotPairs) { if (a === slot) out.push(b); else if (b === slot) out.push(a); }
    return out;
  };
  /** Emplacements voisins qui formeraient une paire avec un clou `type` posé en `slot`. */
  Shop.pairsFor = function (run, slot, type) {
    return Shop.slotNeighbours(slot).filter((o) => run.clous[o] && run.clous[o].type === type);
  };
  /** Meilleur emplacement libre (formant une paire si possible), ou null si tout est occupé. */
  Shop.bestSlot = function (run, type) {
    const free = SLOTS.filter((s) => !run.clous[s]);
    if (!free.length) return null;
    const pairing = free.filter((s) => Shop.pairsFor(run, s, type).length);
    return (pairing.length ? pairing : free)[0];
  };

  /** Pose un clou (achat, Constellation). opts : {slot, color, replace}. */
  Shop.placeClou = function (run, type, opts) {
    opts = opts || {};
    const slot = opts.slot;
    if (!slot || SLOTS.indexOf(slot) < 0) return { ok: false, reason: "needSlot" };
    if (type === "teint" && (!opts.color || !D.FAMILIES[opts.color])) return { ok: false, reason: "needColor" };
    const old = run.clous[slot];
    let refund = 0;
    if (old) {
      if (!opts.replace) return { ok: false, reason: "occupied", refund: Shop.clouRefund(run), old };
      refund = Shop.clouRefund(run);
      run.gold += refund;
    }
    run.clous[slot] = type === "teint" ? { type, color: opts.color } : { type };
    const pairs = Shop.pairsFor(run, slot, type);
    if (BE.Run && BE.Run.refreshPegs) BE.Run.refreshPegs();
    BE.emit("shop:clou", { slot, type, color: opts.color || null, pairs, refund, replaced: old ? old.type : null });
    return { ok: true, slot, pairs, refund };
  };

  /** Grave une étoile du Sac. opts : {bagId, replace}. */
  Shop.engrave = function (run, gravId, opts) {
    opts = opts || {};
    const b = run.bag.find((x) => x.id === opts.bagId);
    if (!b) return { ok: false, reason: "needStar" };
    if (b.grav && b.grav !== gravId && !opts.replace) return { ok: false, reason: "engraved", old: b.grav };
    if (b.grav === gravId) return { ok: false, reason: "same" };
    const old = b.grav;
    b.grav = gravId;
    BE.emit("shop:engrave", { bagId: b.id, grav: gravId, replaced: old });
    return { ok: true, bagId: b.id };
  };

  /** Applique un article (sans le payer). Renvoie {ok, reason?}. */
  Shop.grant = function (run, item, opts) {
    if (opts === "auto" || (opts && opts.auto)) opts = Object.assign(Shop.autoOpts(run, item), opts && opts.auto ? opts : {});
    switch (item.kind) {
      case "relic":
        if (run.relics.length >= run.rules.relicSlots) return { ok: false, reason: "full" };
        run.relics.push({ id: item.id, evolved: false });
        if (BE.Meta && BE.Meta.discover) BE.Meta.discover("relics", item.id);
        if (BE.Run && BE.Run.invalidatePassives) BE.Run.invalidatePassives();
        return { ok: true };
      case "star":
        if (run.bag.length >= E.bagMax) return { ok: false, reason: "bagFull" };
        run.bag.push({ id: run.nextBagId++, size: item.size, color: item.color, grav: null });
        return { ok: true };
      case "clou": return Shop.placeClou(run, item.type, opts);
      case "gravure": return Shop.engrave(run, item.id, opts);
    }
    return { ok: false, reason: "sold" };
  };

  // ================================================================ actions de l'Aube
  /**
   * Achat de l'offre i. opts (clou : {slot, color?, replace?} ; gravure : {bagId, replace?} ; "auto" = choix par défaut).
   * Renvoie {ok, reason:"gold"|"full"|"bagFull"|"sold"|"needSlot"|"needColor"|"occupied"|"needStar"|"engraved"}.
   */
  Shop.buy = function (run, i, opts) {
    const o = run.shop && run.shop.offers[i];
    if (!o || o.sold) return { ok: false, reason: "sold" };
    if (run.gold < o.price) return { ok: false, reason: "gold" };
    const r = Shop.grant(run, o, opts);
    if (!r.ok) return r;
    run.gold -= o.price;
    o.sold = true;
    if (run.shop.locked === i) run.shop.locked = null;
    BE.emit("shop:buy", { offer: o, index: i });
    save();
    return Object.assign({ ok: true }, r);
  };

  /** Relance : 2 or, puis +1 à chaque relance de la même Aube (l'article verrouillé reste). */
  Shop.reroll = function (run) {
    const S = run.shop;
    if (run.gold < S.rerollCost) return { ok: false, reason: "gold" };
    run.gold -= S.rerollCost;
    S.rerollCost++; S.rerolls++;
    const keep = [];
    if (S.locked !== null && S.locked !== undefined) keep.push(S.locked);
    fill(run, keep);
    BE.emit("shop:reroll", {});
    save();
    return { ok: true };
  };

  /** Verrouille (ou déverrouille) une offre : un seul article, gratuit, conservé à l'Aube suivante. */
  Shop.lock = function (run, i) {
    const S = run.shop;
    if (!S.offers[i] || S.offers[i].sold) return false;
    S.locked = S.locked === i ? null : i;
    BE.emit("shop:lock", { index: i, locked: S.locked === i });
    save();
    return true;
  };

  /** Vente de la relique de l'emplacement `slot` (moitié du prix, minimum 1). */
  Shop.sell = function (run, slot) {
    const r = run.relics[slot];
    if (!r) return { ok: false };
    const g = Shop.sellPrice(run, r.id);
    run.relics.splice(slot, 1);
    run.gold += g;
    if (BE.Run && BE.Run.invalidatePassives) BE.Run.invalidatePassives();
    BE.emit("shop:sell", { id: r.id, gold: g });
    save();
    return { ok: true, gold: g };
  };

  /** Déplace une relique d'un emplacement (dir = −1 gauche, +1 droite). Renvoie le nouvel index. */
  Shop.move = function (run, slot, dir) {
    const j = slot + dir;
    if (j < 0 || j >= run.relics.length) return slot;
    const t = run.relics[slot]; run.relics[slot] = run.relics[j]; run.relics[j] = t;
    BE.emit("shop:move", { from: slot, to: j });
    save();
    return j;
  };
  /** Place la relique `from` à l'index `to` (glisser-déposer). */
  Shop.moveTo = function (run, from, to) {
    to = U.clamp(to, 0, run.relics.length - 1);
    if (from === to || !run.relics[from]) return from;
    const [r] = run.relics.splice(from, 1);
    run.relics.splice(to, 0, r);
    BE.emit("shop:move", { from, to });
    save();
    return to;
  };

  /** Épurer le Sac : retire l'étoile `bagId` pour 2 or (le Sac garde au moins 6 étoiles). */
  Shop.purge = function (run, bagId) {
    const i = run.bag.findIndex((b) => b.id === bagId);
    if (i < 0) return { ok: false, reason: "sold" };
    if (run.bag.length <= E.bagMin) return { ok: false, reason: "min" };
    if (run.gold < E.purge) return { ok: false, reason: "gold" };
    const b = run.bag.splice(i, 1)[0];
    run.gold -= E.purge;
    const cut = BE.Run.pileLeft(run);
    run.pileEnd = cut - (run.draw.slice(0, cut).indexOf(bagId) >= 0 ? 1 : 0);
    run.draw = run.draw.filter((id) => id !== bagId);
    BE.emit("shop:purge", { star: b });
    save();
    return { ok: true, star: b };
  };

  // ================================================================ paquet Constellation (§10.5)
  /** Ouvre le paquet (4 or, gratuit avec un Coffre) : 3 cartes (flux shop). JACKPOT si les 3 sont du même type. */
  Shop.openPack = function (run) {
    const S = run.shop;
    if (!S) return { ok: false, reason: "sold" };
    if (!S.pack) S.pack = makePack(run);
    const pk = S.pack;
    if (pk.state !== "closed") return { ok: false, reason: "sold" };
    if (run.gold < pk.price) return { ok: false, reason: "gold" };
    run.gold -= pk.price;
    const keys = S.offers.filter((o) => o && !o.sold).map(itemKey);
    pk.cards = [];
    for (let i = 0; i < D.PACK.cards; i++) {
      const c = Shop.genOffer(run, keys, { weights: D.PACK.weights, rarUp: pk.chest });
      c.price = 0;
      keys.push(itemKey(c));
      pk.cards.push(c);
    }
    pk.jackpot = pk.cards.every((c) => c.kind === pk.cards[0].kind);
    pk.picks = pk.jackpot ? D.PACK.jackpotPicks : D.PACK.picks;
    pk.state = "open";
    BE.emit("shop:pack", { cards: pk.cards, jackpot: pk.jackpot, chest: pk.chest });
    save();
    return { ok: true, cards: pk.cards, jackpot: pk.jackpot };
  };
  /** Prend la carte j du paquet (mêmes options que buy). */
  Shop.pickPack = function (run, j, opts) {
    const pk = run.shop && run.shop.pack;
    if (!pk || pk.state !== "open") return { ok: false, reason: "sold" };
    const c = pk.cards[j];
    if (!c || c.sold) return { ok: false, reason: "sold" };
    const r = Shop.grant(run, c, opts);
    if (!r.ok) return r;
    c.sold = true;
    pk.picks--;
    if (pk.picks <= 0) pk.state = "done";
    BE.emit("shop:pick", { card: c, index: j });
    save();
    return Object.assign({ ok: true }, r);
  };
  /** Referme le paquet (les choix restants sont perdus). */
  Shop.closePack = function (run) {
    const pk = run.shop && run.shop.pack;
    if (pk && pk.state === "open") { pk.state = "done"; save(); }
  };

  // ================================================================ aperçu chiffré (§7.1)
  /** « Sur ton dernier tir : 214 → 428 ». removeSlot : aperçu sans la relique de cet emplacement. null sans tir. */
  Shop.preview = function (run, relicId, removeSlot) {
    if (!run.lastCtx) return null;
    const before = BE.Score.compute(run.lastCtx, run.relics).lumiere;
    let list = run.relics.slice();
    if (removeSlot !== undefined) list.splice(removeSlot, 1);
    else list = list.concat([{ id: relicId }]);
    const after = BE.Score.compute(run.lastCtx, list).lumiere;
    return { before, after };
  };

  /** Texte d'un article pour les fiches : {title, sub, desc, color}. */
  Shop.describe = function (o, run) {
    if (o.kind === "relic") {
      const d = D.RELIC_BY_ID[o.id];
      return { title: d.nom, sub: D.RARITY[d.rar].nom + " · " + d.tags.join(" "), desc: d.txt, color: D.RARITY[d.rar].color };
    }
    if (o.kind === "clou") {
      const C = D.CLOUS[o.type];
      return { title: C.nom, sub: "Clou spécial · posé sur A–F, gardé tout le run", desc: C.txt + ". Paire adjacente : " + C.pair + ".", color: C.color };
    }
    if (o.kind === "gravure") {
      const Gv = D.GRAVURES[o.id];
      return { title: "Gravure " + Gv.nom, sub: "Grave une étoile du Sac (1 par étoile)", desc: Gv.txt + ".", color: Gv.color };
    }
    const F = D.FAMILIES[o.color];
    return { title: "Étoile " + F.nom + " — " + D.SIZES[o.size].nom, sub: "Ajoutée à ton Sac", desc: "En vol : " + F.flight + ". Au bocal : " + F.jar + ".", color: F.color };
  };

  // =====================================================================================================
  // VUE — dessin en mode immédiat avec les primitives de BE.UI (13_ui.js) et BE.Render (11_render.js).
  // =====================================================================================================
  const V = (Shop.View = {});
  const P = D.PAL, TAU = Math.PI * 2;
  let g = null;
  const rr = (x, y, w, h, r) => BE.FX.roundRect(g, x, y, w, h, r);
  const T = (...a) => BE.UI.text(...a);
  const now = () => BE.state.time;
  function sfx(name, p) { try { if (BE.Audio && BE.Audio.play) BE.Audio.play(name, p || {}); } catch (e) { /* */ } }
  function later(ms, fn) { try { setTimeout(fn, ms); } catch (e) { /* */ } }
  function famCol(c) { return D.FAMILIES[c] ? D.FAMILIES[c].color : P.dim; }

  /** Couleur de liseré d'un article. */
  V.itemColor = function (o) {
    if (o.kind === "relic") return D.RARITY[D.RELIC_BY_ID[o.id].rar].color;
    if (o.kind === "clou") return o.type === "teint" ? "#eef2ff" : D.CLOUS[o.type].color;
    if (o.kind === "gravure") return D.GRAVURES[o.id].color;
    return famCol(o.color);
  };

  // ---------------------------------------------------------------- icônes vectorielles
  function glowDisc(x, y, r, col, a) {
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, U.rgba(col, a)); gr.addColorStop(1, U.rgba(col, 0));
    g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
  }
  /** Clou spécial : couronne colorée + glyphe du type. */
  V.drawClou = function (gg, type, x, y, s, color) {
    const prev = g; g = gg || g;
    const C = D.CLOUS[type], col = type === "teint" && color ? famCol(color) : C.color;
    glowDisc(x, y, s * 1.3, col, 0.35);
    g.lineWidth = Math.max(1.5, s * 0.14); g.strokeStyle = col;
    g.beginPath(); g.arc(x, y, s * 0.62, 0, TAU); g.stroke();
    g.fillStyle = "#0b0f1e"; g.beginPath(); g.arc(x, y, s * 0.5, 0, TAU); g.fill();
    g.fillStyle = col; g.strokeStyle = col; g.lineCap = "round"; g.lineJoin = "round";
    g.lineWidth = Math.max(1.2, s * 0.1);
    const k = s * 0.3;
    switch (type) {
      case "or":
        g.beginPath(); g.arc(x, y, k, 0, TAU); g.fill();
        g.fillStyle = "#fff3c4"; g.beginPath(); g.arc(x - k * 0.3, y - k * 0.3, k * 0.35, 0, TAU); g.fill();
        break;
      case "ressort":
        g.beginPath(); g.moveTo(x - k, y + k);
        for (let i = 0; i < 5; i++) g.lineTo(x + (i % 2 ? k : -k), y + k - (i + 1) * (2 * k / 5));
        g.stroke();
        break;
      case "prisme": {
        g.beginPath(); g.moveTo(x, y - k * 1.1); g.lineTo(x + k, y + k * 0.8); g.lineTo(x - k, y + k * 0.8); g.closePath(); g.stroke();
        const cols = ["#ff4d5e", "#ffe14d", "#6ee07a", "#4fb3ff"];
        cols.forEach((c, i) => { g.strokeStyle = c; g.beginPath(); g.moveTo(x + k * 0.2, y); g.lineTo(x + k * 1.5, y - k * 0.4 + i * k * 0.3); g.stroke(); });
        break;
      }
      case "echo":
        g.beginPath(); g.arc(x, y, k * 0.3, 0, TAU); g.fill();
        for (const rr2 of [0.7, 1.15]) { g.beginPath(); g.arc(x, y, k * rr2, -0.9, 0.9); g.stroke(); g.beginPath(); g.arc(x, y, k * rr2, Math.PI - 0.9, Math.PI + 0.9); g.stroke(); }
        break;
      case "cristal":
        g.beginPath(); g.moveTo(x, y - k * 1.2); g.lineTo(x + k * 0.8, y); g.lineTo(x, y + k * 1.2); g.lineTo(x - k * 0.8, y); g.closePath(); g.fill();
        g.fillStyle = "rgba(255,255,255,0.55)"; g.beginPath(); g.moveTo(x, y - k * 1.2); g.lineTo(x + k * 0.3, y - k * 0.1); g.lineTo(x, y); g.closePath(); g.fill();
        break;
      case "teint": {
        if (color) g.fillStyle = famCol(color);
        else { const gr = g.createLinearGradient(x - k, y - k, x + k, y + k); ["#ff6b3d", "#5ee7ff", "#6ee07a", "#ffe14d"].forEach((c, i) => gr.addColorStop(i / 3, c)); g.fillStyle = gr; }
        g.beginPath(); g.moveTo(x, y - k * 1.3); g.quadraticCurveTo(x + k * 1.1, y + k * 0.2, x, y + k); g.quadraticCurveTo(x - k * 1.1, y + k * 0.2, x, y - k * 1.3); g.fill();
        break;
      }
    }
    g.lineCap = "butt"; g.lineJoin = "miter";
    g = prev;
  };
  /** Gravure : étoile-gemme à 5 branches + glyphe. */
  V.drawGravure = function (gg, id, x, y, s) {
    const prev = g; g = gg || g;
    const Gv = D.GRAVURES[id], col = Gv.color;
    glowDisc(x, y, s * 1.3, col, 0.3);
    const star = (R, r) => { g.beginPath(); for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, q = i % 2 ? r : R; g.lineTo(x + Math.cos(a) * q, y + Math.sin(a) * q); } g.closePath(); };
    if (id === "prismatique") {
      const gr = g.createLinearGradient(x - s, y - s, x + s, y + s);
      ["#ff6b3d", "#ffe14d", "#6ee07a", "#5ee7ff", "#c7a6ff"].forEach((c, i) => gr.addColorStop(i / 4, c));
      g.fillStyle = gr;
    } else g.fillStyle = id === "doree" ? "#ffd166" : "#1b2352";
    star(s * 0.72, s * 0.32); g.fill();
    g.strokeStyle = col; g.lineWidth = Math.max(1.2, s * 0.08); star(s * 0.72, s * 0.32); g.stroke();
    g.strokeStyle = id === "doree" ? "#5a3a06" : col; g.lineCap = "round"; g.lineWidth = Math.max(1, s * 0.07);
    const k = s * 0.2;
    if (id === "polie") { g.beginPath(); g.moveTo(x - k, y - k * 0.2); g.lineTo(x + k * 0.4, y - k); g.moveTo(x - k * 0.5, y + k * 0.5); g.lineTo(x + k, y - k * 0.2); g.stroke(); }
    else if (id === "lestee") { g.beginPath(); g.moveTo(x, y - k); g.lineTo(x, y + k); g.moveTo(x - k * 0.6, y + k * 0.4); g.lineTo(x, y + k); g.lineTo(x + k * 0.6, y + k * 0.4); g.stroke(); }
    else if (id === "filante") { for (let i = -1; i <= 1; i++) { g.beginPath(); g.moveTo(x - k * 1.2, y + i * k * 0.6); g.lineTo(x + k * 0.6, y + i * k * 0.6 - k * 0.3); g.stroke(); } }
    else if (id === "doree") { g.beginPath(); g.arc(x, y, k * 0.7, 0, TAU); g.stroke(); }
    g.lineCap = "butt";
    g = prev;
  };
  /** Icône de n'importe quel article, centrée en (x, y), taille s (~ diamètre). */
  V.drawItem = function (gg, o, x, y, s, seed) {
    const prev = g; g = gg || g;
    if (o.kind === "relic") BE.Render.drawRelicIcon(o.id, x, y, s);
    else if (o.kind === "clou") V.drawClou(g, o.type, x, y, s * 0.55, o.color);
    else if (o.kind === "gravure") V.drawGravure(g, o.id, x, y, s * 0.62);
    else BE.Render.drawStar(x, y, o.size, o.color, { scale: Math.min(1, (s * 0.62) / D.SIZES[o.size].r), seed: seed || o.size * 17, lookX: x, lookY: y + 60 });
    g = prev;
  };

  // ---------------------------------------------------------------- cartes de la rangée (hook 13_ui drawCard)
  /** Corps d'une carte d'offre pour les types clou / gravure. Renvoie true si dessiné. */
  V.cardBody = function (gg, o, x, y, w, h) {
    if (o.kind !== "clou" && o.kind !== "gravure") return false;
    g = gg;
    const col = V.itemColor(o), t = now();
    // liseré redessiné dans la couleur de l'article
    g.strokeStyle = U.rgba(col, 0.85); g.lineWidth = 1.8; rr(x, y, w, h, 12); g.stroke();
    if (o.kind === "clou") {
      V.drawClou(g, o.type, x + w / 2, y + 34, 15 + Math.sin(t * 3) * 0.6, o.color);
      T(D.CLOUS[o.type].nom, x + w / 2, y + 66, 10.5, P.text, "center", 800);
      T("CLOU SPÉCIAL", x + w / 2, y + 80, 7.5, col, "center", 800);
    } else {
      V.drawGravure(g, o.id, x + w / 2, y + 34, 20 + Math.sin(t * 2.4) * 0.6);
      T("Gravure " + D.GRAVURES[o.id].nom, x + w / 2, y + 66, 10.5, P.text, "center", 800);
      T("GRAVURE", x + w / 2, y + 80, 7.5, col, "center", 800);
    }
    return true;
  };
  /** Texte de fiche (hook 13_ui drawDetail) : {title, sub, desc, color} ou null pour les types natifs. */
  V.describe = function (o) {
    if (o.kind !== "clou" && o.kind !== "gravure") return null;
    return Shop.describe(o, BE.state.run);
  };

  // ---------------------------------------------------------------- achat avec choix (hook 13_ui tryBuy)
  /** L'achat de l'offre i demande un choix : ouvre le sélecteur. Renvoie true si la raison est gérée ici. */
  V.need = function (i, res) {
    const reasons = { needSlot: 1, needColor: 1, occupied: 1, needStar: 1, engraved: 1 };
    if (!res || !reasons[res.reason]) return false;
    const run = BE.state.run, o = run.shop.offers[i];
    BE.UI.sel = null;
    openPicker(run, o, { src: "offer", i });
    return true;
  };
  function openPicker(run, item, from) {
    const def = Shop.autoOpts(run, item);
    BE.UI.openPanel("shopPick", { item, from, slot: def.slot || null, color: def.color || null, bagId: def.bagId || null, confirm: false, dismiss: true });
  }
  function applyPick(run, p) {
    const opts = { slot: p.slot, color: p.color, bagId: p.bagId, replace: true };
    const r = p.from.src === "pack" ? Shop.pickPack(run, p.from.j, opts) : Shop.buy(run, p.from.i, opts);
    if (!r.ok) { BE.emit("ui:no", {}); BE.UI.toast(reasonText(r.reason)); return false; }
    BE.emit("ui:ok", {});
    BE.UI.sel = null;
    const item = p.item, col = V.itemColor(item);
    if (item.kind === "clou") {
      const q = mapPos(p.slot);
      BE.FX.burst(q.x, q.y, 22, { speed: 170, color: col, glow: true, life: 0.6 });
      BE.FX.ring(q.x, q.y, 8, 46, col, 0.35, 2);
      if (r.pairs && r.pairs.length) { BE.FX.banner("PAIRE !", 180, q.y - 50, col === "#eef2ff" ? P.text : col, 22, 1.2, "Effet doublé"); BE.FX.shake(2, 0.15); }
      if (r.refund) BE.FX.float(q.x, q.y - 26, "+" + r.refund + " or", P.or, 12);
    } else {
      BE.FX.burst(180, 300, 18, { speed: 150, color: col, glow: true, life: 0.55 });
      BE.FX.banner("GRAVÉE", 180, 250, col, 18, 0.9);
    }
    BE.UI.panel = p.from.src === "pack" && run.shop.pack.state === "open" ? packPanel() : null;
    return true;
  }
  function reasonText(r) {
    return { gold: "Pas assez d'or", full: "Emplacements pleins : vends une relique", bagFull: "Le Sac est plein (20)", min: "Le Sac garde au moins 6 étoiles",
      needSlot: "Choisis un emplacement", needColor: "Choisis une couleur", needStar: "Choisis une étoile", same: "Cette étoile porte déjà cette gravure", sold: "Indisponible" }[r] || "Impossible";
  }

  /** Cadre de panneau centré, hauteur h, avec glissement d'entrée. Renvoie le haut (y). */
  function frame(st, p, h, id) {
    const top = Math.max(52, Math.round((D.H - h) / 2) - 6);
    const k = U.easeOutCubic(U.clamp((st.time - p.t) / 0.2, 0, 1));
    g.save(); g.translate(0, (1 - k) * 36); g.globalAlpha = k;
    BE.UI.panelBox(16, top, 328, h);
    BE.UI.region(id, 16, top, 328, h, () => {}, false);
    return top;
  }
  function endFrame() { g.restore(); g.globalAlpha = 1; }
  function title(t, y, iconFn) {
    T(t, 180 + (iconFn ? 12 : 0), y, 16, P.text, "center", 900);
    if (iconFn) { g.font = "900 16px " + D.FONT; const w = g.measureText(t).width; iconFn(180 + 12 - w / 2 - 20, y); }
  }

  // ---------------------------------------------------------------- mini-carte du Firmament (pose de clou)
  const MAP = { k: 1.15, top: 0, h: 196 };
  /** Position d'un emplacement sur la mini-carte (dernier dessin). */
  function mapPos(slot) {
    const idx = D.GEOM.slots[slot], r = Math.floor(idx / 5), c = idx % 5;
    return { x: 180 + (D.GEOM.pegCols[c] - 180) * MAP.k, y: MAP.top + MAP.h / 2 - 6 + (D.GEOM.pegRows[r] - 212) * MAP.k };
  }
  function drawMiniMap(run, p, top) {
    const t = now();
    MAP.top = top;
    const L = D.LAYOUTS[run.firm.layout] || D.LAYOUTS[0];
    g.fillStyle = "rgba(8,11,24,0.92)"; rr(36, top, 288, MAP.h, 14); g.fill();
    g.strokeStyle = P.line; g.lineWidth = 1; rr(36, top, 288, MAP.h, 14); g.stroke();
    T("FIRMAMENT · " + L.nom.toUpperCase(), 48, top + MAP.h - 10, 7.5, U.rgba(P.dim, 0.7), "left", 800);
    const slotOf = {};
    for (const k in D.GEOM.slots) slotOf[D.GEOM.slots[k]] = k;
    for (let idx = 0; idx < 20; idx++) {
      if (slotOf[idx]) continue;
      const r = Math.floor(idx / 5), c = idx % 5;
      const x = 180 + (D.GEOM.pegCols[c] - 180) * MAP.k, y = top + MAP.h / 2 - 6 + (D.GEOM.pegRows[r] - 212) * MAP.k;
      g.fillStyle = L.rows[r][c] === "1" ? U.rgba(P.peg, 0.55) : U.rgba(P.pegOff, 0.5);
      g.beginPath(); g.arc(x, y, 3.5, 0, TAU); g.fill();
    }
    // paires possibles (pointillés) et paires formées (trait plein, ×2)
    for (const [a, b] of D.GEOM.slotPairs) {
      const A = mapPos(a), B = mapPos(b);
      const ta = slotType(run, p, a), tb = slotType(run, p, b);
      const formed = ta && tb && ta === tb;
      if (formed) {
        const c = D.CLOUS[ta].color === "#eef2ff" ? P.text : D.CLOUS[ta].color;
        g.setLineDash([]); g.lineWidth = 3; g.strokeStyle = U.rgba(c, 0.55 + 0.35 * Math.sin(t * 4));
      } else { g.setLineDash([3, 4]); g.lineWidth = 1.4; g.strokeStyle = U.rgba(P.dim, 0.35); }
      g.beginPath(); g.moveTo(A.x, A.y); g.lineTo(B.x, B.y); g.stroke();
      if (formed) {
        const mx = (A.x + B.x) / 2, my = (A.y + B.y) / 2;
        g.fillStyle = "#121832"; rr(mx - 11, my - 8, 22, 16, 8); g.fill();
        T("×2", mx, my + 0.5, 9, P.text, "center", 900);
      }
    }
    g.setLineDash([]);
    for (const s of SLOTS) {
      const q = mapPos(s), cur = run.clous[s], sel = p.slot === s;
      if (sel) {
        const pulse = 1 + Math.sin(t * 6) * 0.07;
        glowDisc(q.x, q.y, 30, "#eef2ff", 0.12);
        g.strokeStyle = "#eef2ff"; g.lineWidth = 2; g.beginPath(); g.arc(q.x, q.y, 20 * pulse, 0, TAU); g.stroke();
      }
      if (sel && p.item.kind === "clou") {
        V.drawClou(g, p.item.type, q.x, q.y, 13, p.color);
        if (cur) { g.globalAlpha *= 0.6; V.drawClou(g, cur.type, q.x + 15, q.y - 14, 6, cur.color); g.globalAlpha /= 0.6; }
      } else if (cur) V.drawClou(g, cur.type, q.x, q.y, 11, cur.color);
      else { g.strokeStyle = U.rgba(P.dim, 0.7); g.setLineDash([2, 3]); g.lineWidth = 1.4; g.beginPath(); g.arc(q.x, q.y, 11, 0, TAU); g.stroke(); g.setLineDash([]); }
      T(s, q.x + 22, q.y + 15, 8.5, sel ? P.text : P.dim, "center", 900);
      BE.UI.region("slot" + s, q.x - 24, q.y - 24, 48, 48, () => { p.slot = s; p.confirm = false; BE.emit("ui:tap", {}); });
    }
  }
  function slotType(run, p, s) {
    if (p && p.item && p.item.kind === "clou" && p.slot === s) return p.item.type;
    return run.clous[s] ? run.clous[s].type : null;
  }

  // ---------------------------------------------------------------- panneaux (hook 13_ui drawPanel)
  /** Dessine un panneau modal de la boutique. Renvoie true si `p.type` est géré ici. */
  V.panel = function (gg, st, run, p) {
    if (!run) return false;
    g = gg;
    switch (p.type) {
      case "shopPick": drawPick(st, run, p); return true;
      case "pack": drawPack(st, run, p); return true;
      case "shopBag": drawBag(st, run, p); return true;
      case "evolve": drawEvolve(st, run, p); return true;
    }
    return false;
  };

  function pickButtons(run, p, y, ready, needsConfirm, verb, why) {
    const price = p.from.src === "pack" ? "offert" : run.shop.offers[p.from.i].price + " or";
    const label = !ready ? "Choisis…" : needsConfirm && !p.confirm ? "Remplacer ?" : needsConfirm ? "Confirmer" : verb;
    BE.UI.button({ id: "pickOk", x: 28, y, w: 196, h: 56, label, sub: price, style: needsConfirm && p.confirm ? "danger" : "gold", size: 15, disabled: !ready, whyDisabled: why,
      onTap: () => { if (needsConfirm && !p.confirm) { p.confirm = true; BE.emit("ui:tap", {}); return; } applyPick(run, p); } });
    BE.UI.button({ id: "pickCancel", x: 232, y, w: 100, h: 56, label: "Annuler", style: "ghost", size: 13,
      onTap: () => { BE.UI.panel = p.from.src === "pack" ? packPanel() : null; } });
  }

  function drawPick(st, run, p) {
    const it = p.item;
    if (it.kind === "clou") {
      const C = D.CLOUS[it.type], teint = it.type === "teint";
      const h = 424 + (teint ? 78 : 0);
      const top = frame(st, p, h, "pickBox");
      title("Poser : " + C.nom, top + 26, (x, y) => V.drawClou(g, it.type, x, y, 9, p.color));
      BE.UI.wrap("Touche un emplacement. Deux clous identiques adjacents forment une paire : effet doublé (" + C.pair + ").", 180, top + 48, 296, 9.5, P.dim, 13, "center", 700);
      BE.UI.wrap(C.txt, 180, top + 82, 296, 9.5, C.color === "#eef2ff" ? P.text : C.color, 13, "center", 800);
      drawMiniMap(run, p, top + 108);
      let y = top + 108 + MAP.h + 14;
      if (teint) {
        T("COULEUR DU TEINTURIER", 180, y + 4, 8.5, P.dim, "center", 800);
        const fams = Shop.families();
        fams.forEach((f, i) => {
          const x = 180 + (i - (fams.length - 1) / 2) * 62, yy = y + 34, on = p.color === f;
          if (on) { glowDisc(x, yy, 30, famCol(f), 0.25); g.strokeStyle = "#eef2ff"; g.lineWidth = 2; g.beginPath(); g.arc(x, yy, 19, 0, TAU); g.stroke(); }
          BE.Render.drawStar(x, yy, 2, f, { scale: 0.78, seed: i * 7, noFace: !on });
          T(D.FAMILIES[f].nom, x, yy + 27, 8.5, on ? P.text : P.dim, "center", 800);
          BE.UI.region("color" + f, x - 26, yy - 24, 52, 52, () => { p.color = f; BE.emit("ui:tap", {}); });
        });
        y += 78;
      }
      let msg = "Choisis un emplacement", mc = P.dim;
      if (p.slot) {
        const cur = run.clous[p.slot], pairs = Shop.pairsFor(run, p.slot, it.type);
        msg = "Emplacement " + p.slot + (cur ? " : remplace le " + D.CLOUS[cur.type].nom + " (+" + Shop.clouRefund(run) + " or)" : " libre");
        mc = cur ? P.danger : P.text;
        if (pairs.length) { msg += " · PAIRE avec " + pairs.join(", ") + " !"; if (!cur) mc = P.or; }
      }
      T(msg, 180, y + 6, 10, mc, "center", 800);
      pickButtons(run, p, y + 24, !!p.slot && (!teint || !!p.color), !!(p.slot && run.clous[p.slot]), "Poser ici", "Choisis un emplacement");
      endFrame();
    } else {
      const Gv = D.GRAVURES[it.id];
      const rows = Math.max(1, Math.ceil(run.bag.length / 5));
      const h = 84 + rows * 64 + 106;
      const top = frame(st, p, h, "pickBox");
      title("Graver : " + Gv.nom, top + 26, (x, y) => V.drawGravure(g, it.id, x, y, 11));
      BE.UI.wrap(Gv.txt + ".", 180, top + 48, 296, 9.5, Gv.color, 13, "center", 800);
      const gy = top + 76;
      drawBagGrid(run, p, gy, (b) => { p.bagId = b.id; p.confirm = false; });
      const b = run.bag.find((x) => x.id === p.bagId);
      let msg = "Choisis une étoile de ton Sac", mc = P.dim;
      if (b) {
        msg = "Étoile " + D.FAMILIES[b.color].nom + " · " + D.SIZES[b.size].nom;
        if (b.grav === it.id) { msg = "Elle porte déjà cette gravure"; mc = P.danger; }
        else if (b.grav) { msg += " — remplace « " + D.GRAVURES[b.grav].nom + " »"; mc = P.danger; }
        else mc = P.text;
      }
      const y = gy + rows * 64 + 6;
      T(msg, 180, y + 6, 10, mc, "center", 800);
      pickButtons(run, p, y + 24, !!b && b.grav !== it.id, !!(b && b.grav), "Graver", "Choisis une étoile");
      endFrame();
    }
  }

  /** Grille des étoiles du Sac (≤ 20, 5 par rangée de 64 px). onPick(b). Sélection : p.bagId. */
  function drawBagGrid(run, p, y0, onPick) {
    const n = run.bag.length, per = 5, sp = 58;
    run.bag.forEach((b, i) => {
      const row = Math.floor(i / per), col = i % per, cnt = Math.min(per, n - row * per);
      const x = 180 - (cnt - 1) * sp / 2 + col * sp, y = y0 + 26 + row * 64;
      const sel = p.bagId === b.id;
      if (sel) { g.fillStyle = "rgba(238,242,255,0.10)"; rr(x - 26, y - 26, 52, 58, 10); g.fill(); g.strokeStyle = "#eef2ff"; g.lineWidth = 1.8; rr(x - 26, y - 26, 52, 58, 10); g.stroke(); }
      const sc = Math.min(1, 17 / D.SIZES[b.size].r);
      BE.Render.drawStar(x, y - 2, b.size, b.color, { scale: sc, seed: b.id * 3, noFace: b.size < 2 && !sel, lookX: x, lookY: y + 40 });
      if (b.grav) V.drawGravure(g, b.grav, x + 15, y - 16, 7);
      T(b.grav ? D.GRAVURES[b.grav].nom.toUpperCase() : "T" + b.size, x, y + 23, 7.5, b.grav ? D.GRAVURES[b.grav].color : P.dim, "center", 800);
      BE.UI.region("star" + b.id, x - 26, y - 26, 52, 58, () => { onPick(b); BE.emit("ui:tap", {}); });
    });
  }

  // ---------------------------------------------------------------- Sac de l'Aube (Épurer)
  function drawBag(st, run, p) {
    const rows = Math.max(1, Math.ceil(run.bag.length / 5));
    const h = 80 + rows * 64 + 150;
    const top = frame(st, p, h, "bagBox");
    title("SAC · " + run.bag.length + " ÉTOILES", top + 26);
    T("Épurer : retire 1 étoile pour " + E.purge + " or (minimum " + E.bagMin + ")", 180, top + 48, 9.5, P.dim, "center", 700);
    const gy = top + 64;
    drawBagGrid(run, p, gy, (b) => { p.bagId = p.bagId === b.id ? null : b.id; p.confirm = false; });
    let y = gy + rows * 64 + 12;
    // répartition par famille
    const fams = D.FAMILY_ORDER.filter((f) => run.bag.some((s) => s.color === f));
    fams.forEach((f, i) => {
      const x = 180 + (i - (fams.length - 1) / 2) * 66;
      BE.Render.drawStar(x - 9, y, 1, f, { scale: 0.45, noFace: true });
      T("×" + run.bag.filter((s) => s.color === f).length, x + 6, y + 0.5, 10, P.text, "left", 800);
    });
    y += 24;
    const b = run.bag.find((x) => x.id === p.bagId);
    if (b) {
      const F = D.FAMILIES[b.color];
      T("Étoile " + F.nom + " · " + D.SIZES[b.size].nom + (b.grav ? " · " + D.GRAVURES[b.grav].nom : ""), 180, y + 6, 11, F.color, "center", 800);
      T(b.grav ? D.GRAVURES[b.grav].txt : "En vol : " + F.flight, 180, y + 26, 9, P.dim, "center", 600);
    } else {
      T("Touche une étoile pour l'épurer", 180, y + 6, 10, P.dim, "center", 700);
      T("Un Sac plus court tire plus souvent tes meilleures étoiles.", 180, y + 26, 9, U.rgba(P.dim, 0.8), "center", 600);
    }
    const by = y + 48;
    const canMin = run.bag.length > E.bagMin, canGold = run.gold >= E.purge;
    BE.UI.button({ id: "purge", x: 28, y: by, w: 196, h: 56, label: !b ? "Épurer" : p.confirm ? "Confirmer" : "Épurer", sub: E.purge + " or", style: "danger", size: 15,
      disabled: !b || !canMin || !canGold, whyDisabled: !b ? "Choisis une étoile" : !canMin ? "Le Sac garde au moins " + E.bagMin + " étoiles" : "Pas assez d'or",
      onTap: () => {
        if (!p.confirm) { p.confirm = true; BE.emit("ui:tap", {}); return; }
        const r = Shop.purge(run, b.id);
        if (!r.ok) { BE.emit("ui:no", {}); BE.UI.toast(reasonText(r.reason)); return; }
        BE.emit("ui:ok", {});
        BE.FX.burst(180, gy + 40, 16, { speed: 110, color: "#dfe6ff", kind: 3, size: 5, life: 0.7, g: -40 });
        BE.UI.toast("Étoile retirée du Sac");
        p.bagId = null; p.confirm = false;
      } });
    BE.UI.button({ id: "bagClose", x: 232, y: by, w: 100, h: 56, label: "Fermer", style: "ghost", size: 13, onTap: () => { BE.UI.panel = null; } });
    endFrame();
  }

  // ---------------------------------------------------------------- Constellation (rouleaux)
  function packPanel() { return { type: "pack", t: BE.state.time, dismiss: true }; }
  V.openPack = function () { BE.UI.panel = packPanel(); BE.emit("ui:tap", {}); };
  const REEL = { w: 92, h: 124, gap: 104, spin0: 0.9 };
  function reelX(i) { return 180 + (i - 1) * REEL.gap - REEL.w / 2; }
  function decoys() {
    // cosmétique : faces qui défilent (Math.random autorisé, hors simulation)
    const out = [], rels = D.RELICS, fams = Shop.families(), cl = Shop.clouPool(), gv = Shop.gravurePool();
    const pick = (a) => a[Math.floor(Math.random() * a.length)];
    for (let i = 0; i < 9; i++) {
      const r = Math.random();
      if (r < 0.4) out.push({ kind: "relic", id: pick(rels).id });
      else if (r < 0.65) out.push({ kind: "star", size: 2 + Math.floor(Math.random() * 3), color: pick(fams) });
      else if (r < 0.85 && cl.length) out.push({ kind: "clou", type: pick(cl) });
      else if (gv.length) out.push({ kind: "gravure", id: pick(gv) });
      else out.push({ kind: "star", size: 2, color: fams[0] });
    }
    return out;
  }
  function itemName(o) {
    return o.kind === "relic" ? D.RELIC_BY_ID[o.id].nom : o.kind === "clou" ? D.CLOUS[o.type].nom : o.kind === "gravure" ? "Gravure " + D.GRAVURES[o.id].nom : "Étoile " + D.FAMILIES[o.color].nom;
  }
  function drawFace(o, x, y, w, h, opts) {
    opts = opts || {};
    const col = V.itemColor(o);
    const gr = g.createLinearGradient(0, y, 0, y + h);
    gr.addColorStop(0, "#1f2a60"); gr.addColorStop(1, "#121838");
    g.fillStyle = gr; rr(x, y, w, h, 10); g.fill();
    g.strokeStyle = opts.sel ? "#eef2ff" : U.rgba(col, 0.9); g.lineWidth = opts.sel ? 2.5 : 1.6; rr(x, y, w, h, 10); g.stroke();
    V.drawItem(g, o, x + w / 2, y + 42, 38, 11);
    const name = itemName(o);
    const kind = o.kind === "relic" ? D.RARITY[D.RELIC_BY_ID[o.id].rar].nom.toUpperCase() : o.kind === "clou" ? "CLOU SPÉCIAL" : o.kind === "gravure" ? "GRAVURE" : D.SIZES[o.size].nom.toUpperCase() + " · T" + o.size;
    let fs = 10; g.font = "800 10px " + D.FONT;
    while (g.measureText(name).width > w - 8 && fs > 7.5) { fs -= 0.5; g.font = "800 " + fs + "px " + D.FONT; }
    T(name, x + w / 2, y + 86, fs, P.text, "center", 800);
    T(kind, x + w / 2, y + 101, 7, col === "#eef2ff" ? P.dim : col, "center", 800);
  }
  function drawPack(st, run, p) {
    const pk = run.shop.pack;
    const t = st.time;
    const PH = 372; // hauteur ajustée au contenu (rouleaux + fiche de la carte + boutons)
    const top = frame(st, p, PH, "packBox");
    const ry = top + 88;
    BE.UI.neon("CONSTELLATION", 180, top + 32, 20, "#c7a6ff", t);
    const sub = pk.chest ? "Coffre de la Mère-Ombre : gratuit, rareté +1" : "1 carte au choix · 3 du même type : JACKPOT, 2 choix";
    BE.UI.fitText(sub, 180, top + 58, 296, 9.5, pk.chest ? P.or : P.dim, "center", 700, 8);
    if (pk.state !== "closed" && !p.spin) p.spin = { t0: t - 10, faces: [decoys(), decoys(), decoys()], stopped: [true, true, true], lastIdx: [0, 0, 0] }; // reprise : déjà arrêtés
    const S = p.spin;
    for (let i = 0; i < 3; i++) {
      const x = reelX(i), y = ry;
      g.fillStyle = "rgba(5,7,16,0.85)"; rr(x - 4, y - 4, REEL.w + 8, REEL.h + 8, 12); g.fill();
      g.strokeStyle = U.rgba("#c7a6ff", 0.35); g.lineWidth = 1; rr(x - 4, y - 4, REEL.w + 8, REEL.h + 8, 12); g.stroke();
      if (pk.state === "closed") {
        const gr = g.createLinearGradient(0, y, 0, y + REEL.h);
        gr.addColorStop(0, "#241d58"); gr.addColorStop(1, "#15123a");
        g.fillStyle = gr; rr(x, y, REEL.w, REEL.h, 10); g.fill();
        drawConstellationGlyph(x + REEL.w / 2, y + REEL.h / 2 - 6, 28, t + i * 1.3);
        T("?", x + REEL.w / 2, y + REEL.h - 20, 14, U.rgba("#c7a6ff", 0.7), "center", 900);
        continue;
      }
      const card = pk.cards[i];
      const stopAt = REEL.spin0 + i * D.PACK.reelStop, N = 10 + i * 4;
      const q = U.clamp((t - S.t0) / stopAt, 0, 1), pos = N * U.easeOutCubic(q);
      if (q >= 1 && !S.stopped[i]) {
        S.stopped[i] = true;
        if (card && card.kind === "relic" && BE.Meta && BE.Meta.discover) BE.Meta.discover("relics", card.id); // vue = découverte (§9.1)
        sfx("reaction", { f: 1568 });
        BE.FX.ring(x + REEL.w / 2, y + REEL.h / 2, 24, 74, V.itemColor(card), 0.35, 2);
        BE.FX.burst(x + REEL.w / 2, y + REEL.h / 2, 8, { speed: 120, color: V.itemColor(card), glow: true, life: 0.4 });
        if (i === 2 && pk.jackpot) {
          later(140, () => { BE.FX.banner("JACKPOT !", 180, ry - 16, P.or, 28, 1.6, "Choisis 2 cartes"); BE.FX.burst(180, ry + 60, 44, { speed: 260, color: P.or, glow: true, life: 0.9 }); BE.FX.flash(0.25, P.or); BE.FX.shake(4, 0.3); });
          sfx("buy");
        }
      }
      const idx = Math.floor(pos);
      if (idx !== S.lastIdx[i] && !S.stopped[i]) { S.lastIdx[i] = idx; if (i === 0 || idx % 2 === 0) sfx("reel", { step: Math.min(20, idx) }); }
      g.save(); rr(x, y, REEL.w, REEL.h, 10); g.clip();
      for (let j = Math.max(0, idx - 1); j <= Math.min(N, idx + 1); j++) {
        const face = j === N ? card : S.faces[i][j % S.faces[i].length];
        drawFace(face, x, y + (pos - j) * REEL.h, REEL.w, REEL.h, { sel: j === N && (card.sold || p.sel === i) });
      }
      g.restore();
      if (S.stopped[i]) {
        if (card.sold) {
          g.fillStyle = "rgba(255,209,102,0.16)"; rr(x, y, REEL.w, REEL.h, 10); g.fill();
          T("PRISE ✓", x + REEL.w / 2, y + REEL.h + 14, 9.5, P.or, "center", 900);
        } else if (pk.state === "done") { g.fillStyle = "rgba(5,7,16,0.55)"; rr(x, y, REEL.w, REEL.h, 10); g.fill(); }
        else {
          if (p.sel !== i) { const pulse = 0.5 + 0.5 * Math.sin(t * 5 + i); g.strokeStyle = U.rgba(P.or, 0.3 + 0.4 * pulse); g.lineWidth = 2; rr(x - 2, y - 2, REEL.w + 4, REEL.h + 4, 11); g.stroke(); }
          BE.UI.region("card" + i, x, y, REEL.w, REEL.h, () => { if (p.sel === i) takeCard(run, p, i); else { p.sel = i; BE.emit("ui:tap", {}); } });
        }
      }
    }
    const allStopped = pk.state !== "closed" && S && S.stopped.every(Boolean);
    const ty = ry + REEL.h + 34;
    if (pk.state === "closed") BE.UI.wrap("Les cartes sont gratuites une fois le paquet ouvert : relique, étoile, clou ou gravure.", 180, ty, 290, 10.5, P.dim, 14, "center", 600);
    else if (allStopped && pk.state === "open") {
      const c = pk.cards[p.sel];
      if (c && !c.sold) {
        const d = Shop.describe(c, run);
        T(d.title, 180, ty - 4, 13, P.text, "center", 900);
        BE.UI.wrap(d.desc, 180, ty + 15, 300, 10.5, P.text, 13.5, "center", 600);
      } else T(pk.jackpot ? "JACKPOT ! Encore " + pk.picks + " choix" : "Touche une carte", 180, ty + 8, 12, pk.jackpot ? P.or : P.text, "center", 900);
    } else if (pk.state === "done") T("Paquet ouvert", 180, ty + 8, 12, P.dim, "center", 900);
    // boutons
    const by = top + PH - 72;
    if (pk.state === "closed") {
      BE.UI.button({ id: "packOpen", x: 28, y: by, w: 196, h: 56, label: "Ouvrir", sub: pk.price ? pk.price + " or" : "gratuit", style: "gold", size: 16,
        disabled: run.gold < pk.price, whyDisabled: "Pas assez d'or",
        onTap: () => {
          const r = Shop.openPack(run);
          if (!r.ok) { BE.emit("ui:no", {}); BE.UI.toast(reasonText(r.reason)); return; }
          p.spin = { t0: BE.state.time, faces: [decoys(), decoys(), decoys()], stopped: [false, false, false], lastIdx: [0, 0, 0] };
          p.sel = undefined;
          BE.emit("ui:ok", {});
        } });
      BE.UI.button({ id: "packClose", x: 232, y: by, w: 100, h: 56, label: "Fermer", style: "ghost", size: 13, onTap: () => { BE.UI.panel = null; } });
    } else if (pk.state === "open" && allStopped) {
      const c = pk.cards[p.sel];
      BE.UI.button({ id: "packTake", x: 28, y: by, w: 196, h: 56, label: "Prendre", sub: c && !c.sold ? itemName(c) : "choisis une carte", style: "gold", size: 16,
        disabled: !c || c.sold, whyDisabled: "Touche une carte", onTap: () => takeCard(run, p, p.sel) });
      BE.UI.button({ id: "packSkip", x: 232, y: by, w: 100, h: 56, label: p.confirmSkip ? "Sûr ?" : "Laisser", style: "ghost", size: 13,
        onTap: () => { if (!p.confirmSkip) { p.confirmSkip = true; BE.emit("ui:tap", {}); return; } Shop.closePack(run); BE.UI.panel = null; } });
    } else if (pk.state === "done") BE.UI.button({ id: "packClose", x: 110, y: by, w: 140, h: 56, label: "Fermer", style: "ghost", size: 14, onTap: () => { BE.UI.panel = null; } });
    endFrame();
  }
  function takeCard(run, p, i) {
    const pk = run.shop.pack, c = pk.cards[i];
    if (!c || c.sold) return;
    if (c.kind === "clou" || c.kind === "gravure") { openPicker(run, c, { src: "pack", j: i }); return; }
    const r = Shop.pickPack(run, i);
    if (!r.ok) { BE.emit("ui:no", {}); BE.UI.toast(reasonText(r.reason)); return; }
    BE.emit("ui:ok", {});
    p.sel = undefined;
    const top = Math.max(52, Math.round((D.H - 404) / 2) - 6);
    BE.FX.burst(reelX(i) + REEL.w / 2, top + 88 + REEL.h / 2, 20, { speed: 170, color: V.itemColor(c), glow: true, life: 0.6 });
  }
  function drawConstellationGlyph(x, y, s, t) {
    const pts = [[-0.8, 0.4], [-0.35, -0.2], [0.1, 0.15], [0.5, -0.5], [0.85, -0.1]];
    g.strokeStyle = U.rgba("#c7a6ff", 0.55); g.lineWidth = 1.2;
    g.beginPath(); pts.forEach(([a, b], i) => (i ? g.lineTo(x + a * s, y + b * s) : g.moveTo(x + a * s, y + b * s))); g.stroke();
    pts.forEach(([a, b], i) => {
      const tw = 0.6 + 0.4 * Math.sin(t * 3 + i * 1.7);
      glowDisc(x + a * s, y + b * s, Math.max(4, s * 0.22), "#eef2ff", 0.5 * tw);
      g.fillStyle = "#eef2ff"; g.beginPath(); g.arc(x + a * s, y + b * s, Math.max(1.4, s * 0.065), 0, TAU); g.fill();
    });
  }

  // ---------------------------------------------------------------- animation d'évolution (1,5 s)
  function drawEvolve(st, run, p) {
    const list = run.shop.evolved || [];
    const e = list[p.idx || 0];
    if (!e) { BE.UI.panel = null; return; }
    const t = st.time - p.t, from = D.RELIC_BY_ID[e.from], to = D.RELIC_BY_ID[e.to];
    g.fillStyle = "rgba(5,7,16,0.55)"; BE.Render.fillScreen(g);
    BE.UI.region("evoBox", 0, 0, D.W, D.H, () => { if (t > 1.5) nextEvo(run, p); }, false);
    const cx = 180, cy = 250;
    const after = t >= 0.9;
    if (after) {
      const k = U.clamp((t - 0.9) / 0.6, 0, 1);
      g.save(); g.translate(cx, cy); g.rotate(st.time * 0.4);
      for (let i = 0; i < 12; i++) {
        g.rotate(TAU / 12);
        const gr = g.createLinearGradient(0, 0, 0, -150);
        gr.addColorStop(0, U.rgba(P.or, 0.35 * k)); gr.addColorStop(1, U.rgba(P.or, 0));
        g.fillStyle = gr; g.beginPath(); g.moveTo(-9, 0); g.lineTo(9, 0); g.lineTo(0, -150); g.closePath(); g.fill();
      }
      g.restore();
      glowDisc(cx, cy, 90, P.or, 0.35 * k);
    }
    if (!after) {
      const k = t / 0.9, sh = k * 3;
      glowDisc(cx, cy, 40 + k * 50, "#c7a6ff", 0.25 + 0.35 * k);
      g.strokeStyle = U.rgba("#eef2ff", 0.6 * k); g.lineWidth = 2; g.beginPath(); g.arc(cx, cy, 70 - k * 40, 0, TAU); g.stroke();
      BE.Render.drawRelicIcon(e.from, cx + (Math.random() - 0.5) * sh, cy + (Math.random() - 0.5) * sh, 56 + k * 10);
      if (!p.fx0) { p.fx0 = true; [0, 1, 2].forEach((i) => later(i * 280, () => sfx("relic", { slot: i * 2 }))); }
    } else {
      if (!p.fx1) {
        p.fx1 = true;
        BE.FX.flash(0.35, "#fff3c4"); BE.FX.shake(5, 0.35);
        BE.FX.burst(cx, cy, 44, { speed: 280, color: P.or, glow: true, life: 0.9 });
        BE.FX.ring(cx, cy, 20, 140, P.or, 0.5, 3);
        sfx("buy"); later(60, () => sfx("relic", { slot: 7 })); later(140, () => sfx("reaction", { f: 1046.5 }));
      }
      const k = U.easeOutBack(U.clamp((t - 0.9) / 0.45, 0, 1));
      BE.Render.drawRelicIcon(e.to, cx, cy, 72, { scale: Math.max(0.01, k) });
    }
    g.globalAlpha = U.clamp((t - 0.2) / 0.3, 0, 1);
    BE.UI.neon("ÉVOLUTION", 180, 118, 30, P.or, st.time);
    const R = D.REACTIONS[to.reaction];
    T(from.nom + "  +  " + R.nom + " ×" + D.EVOLUTION_THRESHOLD, 180, 150, 11, P.dim, "center", 800);
    const ka = U.clamp((t - 1.0) / 0.35, 0, 1);
    g.globalAlpha = ka;
    if (ka > 0) {
      BE.UI.panelBox(24, 340, 312, 150);
      T(to.nom, 180, 368, 19, P.text, "center", 900);
      T("LÉGENDAIRE · emplacement " + (e.slot + 1), 180, 390, 9, P.or, "center", 800);
      BE.UI.wrap(to.txt, 180, 414, 288, 11, P.text, 15, "center", 600);
      BE.UI.wrap("« " + to.hint + " »", 180, 464, 300, 9, U.rgba("#c7a6ff", 0.9), 12, "center", 600);
    }
    g.globalAlpha = 1;
    if (t > 1.5) BE.UI.button({ id: "evoOk", x: 80, y: 508, w: 200, h: 56, label: (p.idx || 0) < list.length - 1 ? "Suivante" : "Magnifique !", style: "gold", size: 16, onTap: () => nextEvo(run, p) });
  }
  function nextEvo(run, p) {
    const list = run.shop.evolved || [];
    if ((p.idx || 0) < list.length - 1) { p.idx = (p.idx || 0) + 1; p.t = BE.state.time; p.fx0 = p.fx1 = false; }
    else { BE.UI.panel = null; run.shop.evolvedSeen = true; save(); }
  }

  // ---------------------------------------------------------------- éléments de l'écran de l'Aube (hook 13_ui SCREENS.SHOP)
  /** Carte Constellation (en-tête gauche) + ouverture automatique de l'évolution. */
  /** Carte Constellation de l'Aube (rangée des boutons, à gauche de Relancer et Sac — 13_ui SCREENS.SHOP). */
  V.PACK_BOX = { x: 12, y: 254, w: 108, h: 48 };
  V.extras = function (gg, st, run) {
    g = gg;
    const S = run.shop;
    if (!S) return;
    if (S.evolved && S.evolved.length && !S.evolvedSeen && !BE.UI.panel && st.sceneT > 0.25) {
      BE.UI.panel = { type: "evolve", t: st.time, idx: 0, dismiss: false };
    }
    if (!S.pack) return;
    // §10.5 : la Constellation est une carte à part entière de la rangée d'achats (à gauche de Relancer / Sac),
    // avec un état « GRATUIT » bien visible après une Mère-Ombre (Coffre)
    const pk = S.pack, t = st.time;
    const x = V.PACK_BOX.x, y = V.PACK_BOX.y, w = V.PACK_BOX.w, h = V.PACK_BOX.h;
    const hot = pk.state === "closed" && (pk.chest || run.gold >= pk.price) || pk.state === "open";
    const pressed = BE.UI.pressId === "pack";
    const free = pk.chest && pk.state !== "done";
    g.save();
    if (pressed) { g.translate(x + w / 2, y + h / 2); g.scale(0.96, 0.96); g.translate(-x - w / 2, -y - h / 2); }
    if (hot) glowDisc(x + w / 2, y + h / 2, w * 0.7, free ? P.or : "#c7a6ff", (free ? 0.35 : 0.2) + 0.15 * Math.sin(t * 3));
    g.fillStyle = "rgba(0,0,0,0.38)"; rr(x, y + 4, w, h, 12); g.fill();
    const gr = g.createLinearGradient(0, y, 0, y + h);
    gr.addColorStop(0, pk.state === "done" ? "#1a1f44" : free ? "#4a3a18" : "#2e2470"); gr.addColorStop(1, pk.state === "done" ? "#121832" : free ? "#2a2010" : "#1a1646");
    g.fillStyle = gr; rr(x, y, w, h, 12); g.fill();
    g.strokeStyle = free ? P.or : U.rgba("#c7a6ff", pk.state === "done" ? 0.3 : 0.85); g.lineWidth = free ? 2 : 1.5; rr(x, y, w, h, 12); g.stroke();
    g.fillStyle = "rgba(255,255,255,0.06)"; rr(x + 3, y + 3, w - 6, h * 0.4, 9); g.fill();
    g.globalAlpha = pk.state === "done" ? 0.5 : 1;
    drawConstellationGlyph(x + 17, y + h / 2, 10, t);
    BE.UI.fitText("Constellation", x + 31, y + 17, w - 36, 10.5, "#e6d6ff", "left", 900, 8);
    let sub, sc = P.or;
    if (pk.state === "done") { sub = "ouverte ✓"; sc = P.dim; }
    else if (pk.state === "open") sub = "à choisir !";
    else if (pk.chest) sub = "GRATUIT";
    else sub = pk.price + " or";
    T(sub, x + 31, y + 33, free ? 11 : 10, sc, "left", 900);
    g.globalAlpha = 1;
    g.restore();
    if (free && pk.state === "closed") { // ruban « Coffre »
      g.fillStyle = P.or; rr(x + w - 44, y - 7, 46, 14, 7); g.fill();
      T("COFFRE", x + w - 21, y + 0.5, 7.5, "#1a1206", "center", 900);
    }
    BE.UI.region("pack", x, y - 2, w, Math.max(48, h + 4), () => V.openPack());
  };

})(window.BE = window.BE || {});
