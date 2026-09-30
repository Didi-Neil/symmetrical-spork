# Bocal d'Étoiles — Architecture du code (tranche verticale)

Ce document décrit le code **tel qu'il existe**. Le GDD (`docs/GDD.md`) reste la référence de design ; ce fichier dit
*où* et *comment* brancher ce que le GDD décrit. Toute modification d'API publique doit être répercutée ici.

---

## 1. Contraintes et conventions

- JS vanilla, **scripts classiques** (pas de modules, pas de `fetch`) : `index.html` fonctionne en `file://`.
- Un seul espace de noms : `window.BE`. Chaque fichier est enveloppé ainsi :
  ```js
  (function (BE) { "use strict"; /* … */ })(window.BE = window.BE || {});
  ```
- Ordre de chargement (fixe, dans `index.html`) :
  `00_core → 01_data → 02_save → 03_audio → 04_input → 05_physics → 06_firmament → 07_jar → 08_scoring → 09_run → 10_shop → 11_render → 12_fx → 13_ui → 14_meta → 15_debug → 99_main`.
  Un module peut **référencer** un module chargé après lui, mais seulement à l'exécution (dans une fonction), jamais au chargement du fichier.
- Espace logique **360 × 640** (portrait). Tout le code de jeu travaille en unités logiques ; seul `99_main` connaît les pixels.
- **Aucun `Math.random` dans la simulation** (physique, Ombres, bocal, décompte, boutique). Utiliser les flux RNG `U.rand(run.streams, "<flux>")`. `Math.random` est permis pour le cosmétique (particules, clignements, graine d'un nouveau run).
- Textes joueur en **français**. Nombres via `U.fmt` / `U.fmtMult` / `U.fmtDec`.
- Toutes les valeurs d'équilibrage vivent dans `01_data.js` (`BE.DATA`).
- La simulation **n'appelle jamais** l'audio, les FX ou l'UI directement : elle **émet** des événements sur le bus (`BE.emit`), que FX/Audio/UI écoutent (§6).

---

## 2. Boucle, affichage, temps

`99_main.js` :
- `resize()` : zones sûres (`BE.Input.readSafeArea()`, encoche / barre d'accueil) retirées, puis `scale = min(vw/360, vh/640)`, `dpr = min(devicePixelRatio, 2)`. **Le canevas couvre toute la fenêtre** (backbuffer `innerWidth·dpr × innerHeight·dpr`) : la zone logique 360 × 640 y est placée en `(left, top)` (centrée horizontalement ; en hauteur, le haut reçoit au plus 24 unités de marge, le reste va au bas). Écrit `BE.view = {scale, dpr, cssW, cssH, left, top, safe, fullW, fullH, ext}` où `ext = {x0, y0, x1, y1, bottom}` est l'étendue logique visible (x0/y0 ≤ 0, x1 ≥ 360, y1 ≥ 640 ; `bottom` = marge utile sous 640, hors barre d'accueil), puis `BE.Render.setExtents(ext)` et `BE.Render.setResolution(scale·dpr)`. Pas de bandes noires : le ciel (fond, nébuleuses, parallaxe, scintillements), la barre haute et la bande des reliques se prolongent jusqu'aux bords ; voiles, fondus et flashs passent par `BE.Render.fillScreen(g)`.
- Pointeur → logique : `((clientX − rect.left − view.left) / scale, (clientY − rect.top − view.top) / scale)` (`04_input`, `BE.Test.toClient` fait l'inverse). Un point hors de 360 × 640 donne des coordonnées < 0 ou > 640 (la bande des reliques agrandie en profite).
- Boucle (§12.4 du GDD) : pas fixe `DT = 1/120`. `acc += el × BE.Run.timeScale()` ; au plus `8 × turbo` pas par image, **le surplus est reporté** (borné à une image de retard : `acc = min(acc, 8·DT)`, §5.8) ; `BE.FX.hitstop` gèle l'accumulation ; `BE.FX.update(el)` et `BE.Audio.update()` en temps réel ; `BE.Render.draw()` (1 image sur 2 en mode Éco). Dans les phases calmes (titre, sélection, intro, visée, Aube, écrans méta) : `BE.Render.prewarmStep(2)` construit les sprites d'étoiles et de visages à l'avance (≤ 2 ms par image).
- `BE.state.time` : temps réel cumulé (secondes, animations). `BE.state.sceneT` : temps **simulé** depuis l'entrée dans la scène (avance dans `Run.update`, donc accéléré par `timeScale`).
- Pause auto sur `visibilitychange` (masqué) et `blur` : `BE.UI.setPaused(true)` + sauvegarde si l'état est stable (`BE.Run.canSave()`).

---

## 3. État partagé

### 3.1 `BE.state` (créé dans `09_run.js`)

```js
BE.state = {
  scene: "TITLE",      // scène courante (voir §4)
  prevScene, sceneT,   // scène précédente, temps simulé dans la scène
  time, frameDt,       // temps réel cumulé, durée de la dernière image
  paused: false,       // pause (menu pause affiché par l'UI)
  run: Run | null,     // run en cours (sérialisable, §3.2)
  meta: Meta,          // méta-progression (sérialisable, format GDD §9.7 → BE.Save.defaultMeta())
  play: Play | null,   // état transitoire du run (non sauvegardé, §3.3)
  turbo: 1,            // multiplicateur de vitesse (tests)
  ui: { bubble, bubbleNext, endSummary, savedRun, eclipse, shownTotal? },   // bubbleNext : bulle d'onboarding en attente (13_ui)
};
BE.settings === BE.state.meta.settings   // réglages (sfx, music, shake, flash, colorblind, eco, aim "abs"|"rel", assistAim, vibrate…)
BE.view = { scale, dpr, cssW, cssH, left, top }
```

### 3.2 Objet `run` (sérialisé tel quel dans `localStorage["bde.v1.run"]`)

JSON pur : ni fonction, ni référence cyclique. Tout champ ajouté doit rester sérialisable.

```js
run = {
  v: 2, seed: "ABCD-EFGH",   // v:1 (bocal large v1.0) accepté par Save.checkRun et migré par Run.migrate à la reprise
  streams: { bag, shop, waves, pegs, misc },  // états int32 des flux mulberry32
  daily: false, gardien: "veilleuse", eclipse: 0,
  rules: { relicSlots, shots, swaps, candle, interest, previewNext, noMixed, pureMult, goldPerKill,
           relicDiscount, keepJar, finalX, startStones },               // copie de DATA.GARDIENS[i].rules
  lune: 1, nuit: 0 /* 0 Mince, 1 Pleine, 2 Boss */,
  shotIndex,          // tirs déjà joués cette nuit (1 après le premier lâcher)
  shotsLeft, bonusShots /* Lanterne */, total /* Lumière de la nuit */, quota,
  gold, candle, swapsLeft, reserve /* Mult en réserve */, metronome,
  bag: [{ id, size, color, grav }],  // le Sac (grav = id de gravure ou null)
  draw: [bagId…],                     // pioche ; draw[0] = étoile courante, draw[1..] = suivantes
  pileEnd,                            // draw[0..pileEnd-1] = pioche courante ; au-delà : le mélange suivant, préparé pour l'aperçu (§8.5)
  nextSizeBonus,                      // Photosynthèse
  relics: [{ id: "R05", evolved: false }],   // ordre = emplacements gauche → droite
  reactionCounts: { vapeur: 2, … },
  clous: { A: null | { type: "or"|"ressort"|"prisme"|"echo"|"cristal"|"teint", color? }, B…F },
  firm: {                             // Firmament (06_firmament)
    shadows: [{ id, type, col, row, hp, maxhp, counter, burns: [toursRestants…], frozen, alive,
                x, y, r, layT, dispX, dispY }],
    boss: null | { id, type: "boss", bossId, col, row, hp, maxhp, counter, burns, frozen, alive, r, x, y, ruleOff },
    ghost: [{ type, col }],           // file fantôme (prochaine apparition)
    layout, usedLayouts, usedBosses, bossId /* boss de la Lune */, ronce: [pegIdx], nextId, chest,
  },
  jar: { bodies: [Body], wallL, wallR, floor, g, t, step },   // bocal (07_jar)
  nextId, nextBagId,
  phase: "AIM" | "SHOP" | "PENDING_SHOT", pendingAngle,       // reprise (GDD §12.6)
  shop: null | { key: "L-N", offers: [Offer], locked: index|null, rerollCost, rerolls },
  lastCtx,            // ctx du dernier tir (aperçu de relique en boutique)
  lastShot: { eclat, mult, lumiere }, lastReward: { lune, nuit, night, shots, shotsLeft, interest, vidange, chest },
  runStats: { shots, merges, pureMerges, kills, reactions, stones, maxSize, gold, bigBangs, lightTotal, bestShot },
  nightBest: [[maxFusionParNuit…] par Lune],   // 8 = Big Bang, 0 = nuit perdue (grille de partage)
  nightMax, result: null | { won, cause: "quota"|"overflow"|"abandon", deficit, lune, nuit },
  aimAngle, discoveries,
  nuitBlanche: null | { from /* Lune de la victoire (5) */, frags /* ◇ déjà versés */, kills, merges, pure },  // §4.1
  dailyOfficial?,     // Ciel du Jour : premier essai du jour (14_meta)
}
```

`Body` (corps du bocal, `Phys.makeBody`) :
`{ id, size, color|null, stone, grav, x, y, vx, vy, r, m, im, sleep, slowT, age, mergedStep, pure, bicolor, bornT, shotNo, squashT?, seed }`.
Le tableau `jar.bodies` est **toujours trié par id croissant** (nouveaux corps ajoutés en fin, suppressions par `splice`).

`Offer` : `{ kind: "relic", id }`, `{ kind: "star", size, color }`, `{ kind: "clou", type }` ou `{ kind: "gravure", id }`, toujours avec `price, sold` (§11.4). `run.shop` porte aussi `pack` (Constellation), `evolved`, `evolvedSeen`.

### 3.3 `BE.state.play` (transitoire, recréé à chaque (re)prise de run)

```js
play = {
  pegs: [Peg],          // clous du tir courant (Firm.pegs), avec .flash (temps du dernier contact)
  log: [Event],         // journal du tir en cours (§5)
  orphanLog: [Event],   // journal de la DESCENTE (fusions orphelines → réserve)
  flight: World|null,   // monde de vol (Phys.stepFlight)
  world: World|null,    // monde utilisé pour l'aperçu de visée
  shot: { t /* temps simulé depuis le lâcher */, angle, noteK, perClou, prismUsed, sablier, cur },
  aim: { active, angle, cancel, prev: {pts, contacts, tailFrom}, prevAngle, dirty, kbd },
  count: { ctx, res, t, sched, clashAt, totalAt, endAt, eclat, mult, stepIdx, activeSlot, activeT, activeStep, … },
  turret, descent, won, vid, lost, settleT, live: { eclat, mult }, heartT,
}
```

`Peg` : `{ idx /* r*5+c */, row, col, x, y, r, active, kind: "gray"|"double"|"special", slot /* "A".."F"|null */, clou, dark, hidden, flash }`.

---

## 4. Machine à états (`BE.Run`, `09_run.js`)

Scènes (`BE.state.scene`) et transitions :

```
TITLE → SELECT → NIGHT_INTRO → AIM
AIM --lâcher--> FLIGHT → SETTLE → TURRETS → COUNT → DESCENT → CHECK
COUNT (quota atteint) ─────────────────────────────────────→ CHECK
CHECK → AIM | NIGHT_WON | SETTLE_CANDLE (Bougie) → CHECK | RUN_LOST
NIGHT_WON → SHOP | VIDANGE → SHOP | RUN_WON (Lune 5, boss, hors Nuit Blanche)
SHOP --« Nuit suivante »--> NIGHT_INTRO
RUN_LOST | RUN_WON → RUN_END → TITLE
RUN_END (victoire + Planétarium) --« Nuit Blanche »--> VIDANGE → SHOP → Lune 6, 7… (plus jamais RUN_WON)
TITLE → OBSERVATORY | GRIMOIRE (onglet Défis = DEFIS) | DAILY | SELECT      (scènes de 14_meta.js)
```

- Chaque scène est un objet `BE.Run.SCENES[name] = { enter?(), update?(dt), exit?() }`. `BE.Run.go(name)` appelle `exit` puis `enter` et émet `scene {from, to}`. **Ajouter une scène** = ajouter une entrée dans `Run.SCENES` (+ un écran dans `BE.UI.SCREENS[name]` si besoin, + l'inscrire dans `Run.IN_GAME` si le jeu doit être dessiné derrière).
- `Run.RESOLVING` = `{FLIGHT, SETTLE, TURRETS, DESCENT, SETTLE_CANDLE}` (accélération §5.8). `Run.IN_GAME` = scènes où la scène de jeu est dessinée et la pause possible (SETTLE_CANDLE comprise). `Run.SETTLED` = `{NIGHT_WON, VIDANGE, RUN_LOST, RUN_WON, RUN_END}` : nuit / run déjà joué (« Abandonner » désactivé).
- SETTLE_CANDLE (après la Bougie) : le bocal s'affaisse ; ses fusions sont orphelines → `run.reserve` (comme en DESCENTE, événement `reserve`).
- Pendant FLIGHT le bocal est simulé en même temps (`Jar.step`). SETTLE attend `Jar.isRest` ou 6 s. TURRETS tire un éclair toutes les 0,2 s. COUNT rejoue `res.steps` (0,4 s base, 0,22 s par étape, 0,5 s final, 0,35 s vol vers la jauge). DESCENT : brûlure → La Faim → descente → Pierres (lâchées à 0,28 s) → La Grêle → apparitions, puis repos du bocal ; le Mult des fusions orphelines va dans `run.reserve`.
- NIGHT_WON : gel 0,5 s, conversion des Ombres 1 s, puis récompense (intérêts calculés **avant** la récompense), puis SHOP / VIDANGE / RUN_WON.

### API `BE.Run`

| Fonction | Rôle |
|---|---|
| `newRun(opts)` → `run` | `opts = {gardien, seed, eclipse, daily, relics:[ids]}` ; crée le run, `Firm.setupLune`, `startNight`. |
| `startNewRun(opts)` | `newRun` + `BE.state.play` neuf + `go("NIGHT_INTRO")`. |
| `resume(data)` | Reprise d'un run sauvegardé (`SHOP` → Aube ; `PENDING_SHOT` → rejoue le tir avec `pendingAngle`). Le bocal sauvegardé est déjà au repos (gelé) : il n'est **pas** re-stabilisé (sauf sauvegarde ancienne avec un corps éveillé), sinon le tir rejoué divergeait. C'est l'entrée en AIM qui stabilise un corps encore éveillé (L'Étau, Pierres de départ) et vide le cache de warm start, pour que l'état en jeu soit exactement l'état sauvegardé. |
| `startNight(run)` | Quota, tirs, échanges, pioche mélangée (flux `bag`), `Firm.setupNight`, `Jar.applyRules`, puis **trop-plein du début de nuit** : si un corps dépasse l'horizon (Verre soufflé acheté à l'Aube, L'Étau qui resserre les murs), `Jar.trim(run)` l'évapore sans Bougie ; émet `trim {reason:"night"}` et annonce un toast (NIGHT_INTRO efface les bannières du ciel). |
| `fire(angleDeg, replay?)` → bool | Lâcher en AIM (refusé si `shotsLeft ≤ 0` ou run terminé) : sauvegarde `PENDING_SHOT` (`save(true)`, seul appel autorisé), tire `draw[0]`, crée le monde de vol, `go("FLIGHT")`. |
| `swap(j=1)` | Échange `draw[0]` ↔ `draw[j]` (1 par nuit + passifs ; interdit sous Le Voile). |
| `askSwap()` | Échange demandé par le joueur (tap SUIV., Tab/S) : direct, ou sélecteur des 3 suivantes pour L'Astronome (`UI.panel = {type:"swapPick"}`, touches 1/2/3) ; toast si Voile / plus d'échange. |
| `hotspotAt(x, y)` | Bouton de la visée sous un point : `"pause" | "swap" | "bag" | "relics" | "hud" | null`. |
| `leaveShop()` | Quitte l'Aube → nuit suivante (ou Lune suivante + `Firm.setupLune`) → `NIGHT_INTRO`. |
| `lose(cause, deficit, bodies?)`, `abandon()`, `toTitle()` | Fin de run / retour titre. |
| `update(dt)` | Un pas logique (appelle `SCENES[scene].update`). |
| `timeScale()` | 1–4 selon §5.8 (`autoSpeed`, doigt/F ×3, plafond ×4 ; COUNT maintenu ×4) × `turbo`. |
| `autoSpeed(scene, T)` → 1/2/3 | Accélération automatique (§5.8) : en FLIGHT ×2 dès `PHYS.speed.auto2` (4 s) et ×3 dès `auto3` (7 s) ; dans les autres scènes de résolution ×2 dès `jar2` (2 s) et ×3 dès `jar3` (3,5 s). Lue aussi par l'indice « Maintiens le doigt » (13_ui) et par `estTime` des bots (15_debug). |
| `passives(run)` | Agrégat des passifs de reliques (mis en cache par composition). Voir §7. |
| `invalidatePassives()` | À appeler après toute modification de `run.relics` (la boutique le fait). |
| `horizon(run)` | 452 + Verre soufflé (+24) + Éclipse ≥ 4 (+16), borné à `GEOM.horizonMax` = 492 (la plus grosse étoile seule au fond, une Nova, reste sous la ligne). `horizonBase(run)` : sans les reliques (lu par le ctx du décompte). |
| `migrate(run)` → `false` \| `{trimmed}` | Appelée par `resume` : run `v:1`, rayon ≠ `SIZES[s].r` ou masse ≠ `DATA.massOf` (p. ex. Trou Noir de 58 px d'une v1.1b) → murs du bocal courants (via `Jar.applyRules`, qui resserre et repousse), rayon/masse de chaque corps, `Jar.settle` puis `Jar.trim` ; `run.v = 2`. Renvoie `false` si rien n'a changé, sinon `{trimmed: corps évaporés}` ; `resume` l'annonce par un toast (`migrateMessage(mig)`). |
| `current(run)` / `nextStars(run)` / `bagItem(run, id)` / `ensureDraw(run)` / `pileLeft(run)` | Pioche. `current` inclut le bonus Photosynthèse. `ensureDraw` prépare le mélange suivant après `pileEnd` quand la pioche ne suffit plus aux aperçus ; les étoiles encore visibles y sont placées en fin (jamais de doublon visible). `pileLeft` = étoiles restant dans la pioche courante (compteur du Sac, §10.3). |
| `refreshPegs()` | Reconstruit `play.pegs` (après mort d'un Éteignoir, mouvement du boss, Ronce…). |
| `updatePreview(force?)` | Recalcule l'aperçu si l'angle a changé de > 0,2°. |
| `angleTo(x, y)` | Angle Phare → point, borné [12°, 168°] (0° = droite, croissant vers le bas). |
| `makeWorld(run)` | Monde de vol (`Phys.stepFlight`) avec les hooks du run et l'entonnoir (`Run.funnel(run)`, murs courants du bocal). |
| `clouPaired(run, slot)` | Le clou spécial de `slot` forme-t-il une paire (même type, emplacement adjacent) ? |
| `save(pending?)` | `BE.Save.saveRun(run, pending ? {pending:true} : undefined)` (sauf run terminé). Moments : entrée en AIM, lâcher (`pending`), entrée en SHOP, chaque action de boutique, pause. |
| `canSave()` | État stable (`phase` AIM ou SHOP, run non terminé) : la pause, « Menu principal » et la pause automatique ne sauvegardent que dans ce cas ; pendant un tir, l'instantané d'avant le tir reste la sauvegarde. |
| `abandon()` → bool | Défaite « abandon » ; refusé (false) si la nuit est déjà gagnée (`SETTLED`, `total ≥ quota`) ou le run terminé. |
| `skipCount()` | Saut direct au total pendant COUNT. |
| `nuitBlanche(run?)` → bool | Nuit Blanche proposable : run gagné, hors Ciel du Jour, Planétarium construit, pas déjà en Nuit Blanche. |
| `startNuitBlanche()` → bool | Depuis RUN_END : `run.nuitBlanche = {…}`, `result = null`, émet `nuitBlanche`, `go("VIDANGE")`. |

### 4.1 Nuit Blanche (Lunes infinies, GDD §2.2 / §9.2)
Le **même run** continue après la victoire si le Planétarium est construit (bouton `nuitBlanche` de la fin de run). La victoire est soldée normalement par `Meta.endRun` (Fragments, D12, Éclipse suivante) ; `startNuitBlanche` mémorise ce qui a été versé puis relance VIDANGE → Aube → Lune 6. `DATA.quota` (×3,5 par Lune au-delà de 5) et `DATA.hpMult` (×1,35) gèrent L > 5 ; `Firm.setupLune` tire les boss dans le pool (L'Éclipse reste propre à la Lune 5) ; `NIGHT_WON` ne va plus vers `RUN_WON`. À la défaite suivante, `Meta.endRun` passe par `endNuitBlanche` : seules les Lunes / nuits au-delà de la 5e et les nouvelles découvertes rapportent (pas de 2e victoire ni de 2e décompte des statistiques). La frise des Lunes se resserre (`Render.drawLuneTrack`), la fin de run affiche « FIN DE LA NUIT BLANCHE ». Tests : groupe « Nuit Blanche » de `BE.Debug.tests`.

Entrées : `Run` écoute `pdown/pmove/pup/pcancel/key` (§6). En AIM : un appui qui **commence** sur un bouton (`hotspotAt` : ⏸, SUIV., Sac, bande des reliques, barre haute) est un bouton quelle que soit sa durée — action au relâcher dessus, jamais un tir, pas d'aperçu tant que le doigt y reste ; il ne devient une visée que si le doigt s'en éloigne de ≥ 12 px. Ailleurs : glisser = viser ; relâcher = tirer si appui ≥ 150 ms **ou** déplacement ≥ 12 px ; sinon tap. Relâcher avec `y < 44` annule. Clavier : ←/→ (Maj = fin), Espace/Entrée tirer, Tab/S échanger (Astronome : sélecteur, ou 1/2/3 directement), Échap pause/annuler, F accélérer. Les répétitions de touche (`repeat`) ne passent ni l'Aube, ni la carte d'intro, ni le décompte.

---

## 5. Journal d'événements (entrée du score)

FLIGHT, SETTLE et TURRETS **ajoutent** des objets à `play.log`. Le score est une fonction pure de ce journal et de l'état du run. Chaque événement porte déjà sa contribution de base (`eclat` / `mult` / `n`) : `buildCtx` n'a qu'à sommer.

| `t` | Champs | Produit par | Contribution |
|---|---|---|---|
| `"launch"` | `size, color, angle` | `Run.fire` | `ctx.launchedSize` |
| `"peg"` | `idx, kind:"gray"|"double"|"special", clou:type|null, eclat, mult` | hook de vol `peg` | `eclat` (gris 1, double 2, éteint/L'Avare 0, clous spéciaux, Polie +1), `mult` (Cristal) |
| `"wall"` | `side:"L"|"R"|"T"` | hook `wall` | `ctx.wallBounces` |
| `"hit"` | `shadow:id, type, dmg, eclat` | `Firm.hitByStar` | `eclat` = 3 (+1 Filante) |
| `"kill"` | `type, shadow` | `Firm.kill` | `ctx.kills`, `killsByType` |
| `"bosskill"` | — | `Firm.kill` | `ctx.bossKilled` |
| `"absorb"` | — | Voleuse | `ctx.absorbed` |
| `"land"` | `size` | `Jar.addFromFlight` | — |
| `"merge"` | `size /* taille obtenue */, pure, colors:[a,b], reaction:id|null, mult, x, y` | `Jar.merge` | `mult` (table §5.2, pureté, Alchimiste) |
| `"stone"` | `mult:2, size` | `Jar.breakStone` | `mult` |
| `"mult"` | `n, src:"vapeur"|"seve"|…` | familles/réactions | `n` au Mult |
| `"eclat"` | `n, src:"givre"|"bigbang"|…` | familles | `n` à l'Éclat |
| `"bigbang"` | `sizes` | `Jar.bigBang` | `ctx.bigBang` (×10 final) |
| `"gold"` | `n` | or gagné pendant le tir | — |
| `"bolt"` | `dmg` | TURRETS | — |

**Ajouter une source de score** : pousser un événement avec `eclat` (sommé automatiquement) ou `{t:"mult", n}` / `{t:"eclat", n}` ; pour un nouveau compteur de `ctx`, ajouter un `case` dans `Score.buildCtx`.

### 5.1 `BE.Score` (`08_scoring.js`)

- `buildCtx(log, run)` → `ctx` (JSON pur, lecture seule du run) :
  ```
  { pegHits, specialHits:{or,ressort,prisme,echo,cristal,teint}, wallBounces, shadowHits, kills, killsByType,
    merges:[{size,pure,colors,reaction,mult}], stonesBroken, reactions:[ids], bigBang, launchedSize, touchedShadow,
    jarFill (0–1), jarCount, jarStars, jarColors:[couleurs] /* tableau, pas Set */, maxJarSize, gold, isLastShot,
    shotIndex, metronome, reserve, baseEclat, baseMult, absorbed, bossKilled,
    aurore, finalX, eclipseHalf }
  ```
  Prisme de poche (`passive.firstMergeTwice`) duplique la 1re fusion ici.
- `finals(ctx)` → `[{src:"aurore"|"bigbang"|"insomniaque"|"eclipse", xMult}]` dans l'ordre §7.1.
- `compute(ctx, relics, finals?)` → `{ steps, eclat, mult, lumiere }` — **pure**.
  `steps[0] = {src:"base", eclat, mult}` ; puis une étape par relique qui renvoie quelque chose :
  `{src:"R14", slot, dEclat, dMult, xMult, eclat, mult}` (valeurs cumulées après l'étape) ; puis les finaux `{src, final:true, xMult, eclat, mult}`. `lumiere = ⌊eclat × mult⌋`.
- `live(log, reserve)` → `{eclat, mult}` sans reliques (compteur « ✦ 24 × 3,5 » et projection de la jauge).
- Aperçu boutique : `BE.Shop.preview(run, relicId)` = `compute(run.lastCtx, relics + candidate)`.

---

## 6. Bus d'événements (`BE.on` / `BE.emit`, `00_core.js`)

`BE.on(type, fn)` renvoie une fonction de désabonnement ; `type "*"` reçoit `(type, data)`. Les exceptions des écouteurs sont isolées (loguées). `BE.muteEvents = true` coupe tout (bots headless).

| Famille | Événements (données) |
|---|---|
| Entrées (`04_input`) | `pdown {x,y,type}`, `pmove {x,y}`, `pup {x,y,dur,moved,tap,click}`, `pcancel {reason}`, `hover`, `key {code,key,shift,repeat}`, `keyup` |
| Scènes / run | `scene {from,to}`, `nightStart {lune,nuit}`, `launch {star,angle,x,y,copy?}`, `aim:cancel`, `swap`, `shotScored {res,total,quota}`, `quota`, `reward (lastReward)`, `vidange {n}`, `victory`, `overflow {bodies}`, `candle {bodies}`, `reserve {n,total}` |
| Vol / Firmament | `peg {x,y,k,eclat,mult,peg,star,dark}`, `wall {x,y,side,star}`, `hit {target,star,dmg,x,y,eclat}`, `damage {target,dmg,x,y,blocked}`, `kill {target,x,y,type}`, `bossKill`, `bonusShot`, `absorb`, `burn`, `burnTick`, `freeze`, `thaw`, `grow`, `split`, `plasma {col,x}`, `ronce {idx,x,y}`, `spawn {target}`, `shadowMove`, `shadowFall`, `lay`, `horloge`, `convert` |
| Bocal | `land {body,x,y}`, `merge {body,size,pure,reaction,mult,x,y,color,colors,orphan}`, `reaction {id,x,y,color,nom}`, `explosion {x,y,r}`, `stone {x,y,size,r}`, `stoneDrop`, `bigbang {x,y,sizes}`, `evaporate`, `trim {n,y,reason}` (trop-plein évaporé sans Bougie : `"quota"` nuit gagnée → bannière FX, `"night"` début de nuit et `"vidange"` Vidange de L'Insomniaque → toast de 09_run), `devour`, `bonus`, `gold {n,x,y}`, `bolt {x1,y1,x2,y2,body,target}`, `heart` |
| Décompte | `count:start {res}`, `count:tick {step}`, `count:relic {step,slot,st}`, `count:final`, `count:clash`, `count:total {lumiere,high,quota}` |
| Boutique | `shop:enter`, `shop:buy {offer,index}`, `shop:reroll`, `shop:lock`, `shop:sell`, `shop:move {from,to}`, `shop:clou {slot,type,pairs,refund}`, `shop:engrave`, `shop:purge {star}`, `shop:pack`, `shop:pick`, `evolve {slot,from,to}` |
| Méta / run | `meta:room {id}`, `meta:defi {id}`, `meta:discover {kind,id}`, `nuitBlanche {lune}`, `squeeze` (L'Étau) |
| UI | `ui:tap`, `ui:ok`, `ui:no`, `coinArrive` |

`12_fx.js` (juice) et `03_audio.js` (table `MAP` événement → son) sont de purs écouteurs : **pour ajouter du juice, s'abonner, ne pas modifier la simulation**.

---

## 7. Reliques : format et hooks

Déclarées dans `BE.DATA.RELICS` (`01_data.js`), indexées par `BE.DATA.RELIC_BY_ID`.

```js
{
  id: "R14", nom: "Balance", rar: "C"|"PC"|"R", hook: "C"|"V"|"P"|"C+P",
  tags: ["xMULT","BOCAL"], txt: "×2 Mult si le bocal est rempli à moins de 40 %",
  src: { type: "depart" } | { type: "room", id: "crypte" } | { type: "defi", id: "D02" },
  icon: "balance",            // clé de dessin dans BE.Render (ICONS) ; sinon lettre générique
  color: "#ff4d5e",           // couleur du glyphe

  // décompte (ordre gauche → droite) — fonction PURE de ctx
  count: (c) => (c.jarFill < 0.4 ? { xMult: 2 } : null),   // {dEclat?, dMult?, xMult?} | null

  // modifie le vol (fonctions appelées pendant la simulation, déterministes)
  flight: {
    dmgBonus: (star) => number,             // dégâts en plus sur les Ombres
    restPeg: (star, peg) => e | undefined,  // restitution sur clou (sinon règle par défaut)
    onLaunch: (play, star) => void,         // au lâcher
  },

  // passifs agrégés par Run.passives(run)
  passive: { interestCap, swaps, horizon, previewContacts, hpMult, unusedShotBonus, bolts,
             horloge, goldPerKill, alchimiste, firstMergeTwice, sablier },
}
```

Agrégation (`Run.passives`) : `interestCap` = max (plafonné à 3 à l'Éclipse ≥ 6, 0 sans intérêts) ; `swaps`, `horizon`, `previewContacts` (base 1), `unusedShotBonus`, `goldPerKill` = somme ; `hpMult` = produit ; `bolts` = max (base 1) ; booléens = OU ; `dmgBonus/restPeg/onLaunch` = listes de fonctions. **Ajouter un passif** : l'ajouter dans `Run.passives` puis le lire là où il agit.

Implémentés : R01–R30 (tous) et les 6 **évolutions** E1–E6 (`DATA.EVOLUTIONS`, même format, indexées dans `RELIC_BY_ID`, voir §11).

Sources débloquées : `BE.Shop.unlocked(src)` → `BE.Meta.isUnlocked(src)` (départ toujours ; salles via `meta.rooms` ; défis via `meta.defis[id].done` ; tout est débloqué en Ciel du Jour).

---

## 8. Modules : API publiques

### `BE.util` (`00_core.js`)
Maths : `clamp, lerp, invLerp, smooth, easeOutCubic, easeInCubic, easeInOut, easeOutBack, easeOutElastic, approach(v,target,rate,dt), dist, dist2, deg, rad, sum, ceilHalf (arrondi au 0,5 sup.), pingpong`.
Format fr : `fmt(n)` (« 12 345 », « 1,2 M », « 3,4 Md », « 1,2e15 », espace fine insécable), `fmtMult(m)` (« 3,5 »), `fmtDec(x)`, `pct(f)`.
Hash/RNG : `fnv1a(str)`, `STREAMS`, `seedStreams(seed)`, `rand(streams, name)`, `rint`, `rpick`, `rweighted(streams, name, {k:poids})`, `rshuffle`, `mulberry32(seed)` (générateur fermé, hors run), `newSeed()`.
Divers : `Pool(size, factory)` (`spawn/forEach/count/clear`, recycle le plus ancien), `hexToRgb, rgba, shade(hex, ±amt)`, `deepCopy, removeWhere, todayStr`.

### `BE.DATA` (`01_data.js`)
`W, H, GEOM` (toute la géométrie §4 : `phare, bagBtn, swapBtn, wallL/R (vol), jarL/R (bocal), etauL/R, funnelY, rimY, ceil, flightToJar, liveY, horizon, floor, relicBandY, relicX, ghostY, cols, rows, shadowR, pegCols, pegRows, pegR, slots, slotPairs, packing, jarArea (calculée), aimMin/Max, bossR`), `PHYS` (`dt, flight{…}, jar{…}, speed{auto2, auto3, jar2, jar3, hold, cap, countHold}, previewSteps`), `SIZES[1..7]` (`r, rf`, Trou Noir `rBorn, mk`), `massOf(size, r, stone)`, `BIGBANG {xMult, emoji, partner}`, `FAMILIES`, `FAMILY_ORDER`, `REACTIONS`, `reactionFor(a,b)`, `AURORE`, `SHADOWS`, `BOSS`, `BOSSES`, `BOSS_POOL_BASE/CARTES`, `HP_MULT`, `hpMult(L)`, `QUOTA_BASE`, `quota(L, nuit, eclipse)`, `NIGHT_NAMES/SHORT`, `SPAWNS`, `spawnsFor(L)`, `NEW_SHADOWS`, `LAYOUTS`, `ECO`, `STAR_OFFERS`, `RARITY`, `RELICS`, `RELIC_BY_ID`, `EVOLUTIONS`, `CLOUS`, `GRAVURES`, `GARDIENS`, `GARDIEN_BY_ID`, `BAGS`, `ROOMS`, `DEFIS`, `ECLIPSES`, `PAL` (palette §11.1), `FONT`, `FX` (durées de juice).

### `BE.Save` (`02_save.js`)
`defaultMeta()`, `loadMeta()` (complète les champs manquants), `saveMeta(meta)`, `loadRun()`, `saveRun(run, opts?)` (un run en phase `PENDING_SHOT` n'est écrit qu'avec `opts.pending`, c.-à-d. depuis `Run.fire`), `clearRun()`, `hasRun()`, `available` (false après un échec d'accès). Clés : `bde.v1.meta`, `bde.v1.run`. Tout est en try/catch. Détails (validation, copie de secours, instantané PENDING_SHOT immuable) : §12.

### `BE.Audio` (`03_audio.js`)
`init()` (au premier geste, via `BE.Input`), `play(name, params)` (`params.x` logique → panoramique), `duck(depth, dur)` (atténuation momentanée de la musique), `suspend()`, `resume()`, `applySettings()`, `update()` (chaque image : volumes + ordonnanceur musical), `music.setLune(n)`, `music.setNight(lune, nuit)`, `music.duck(bool)` (passe-bas 700 Hz), `music.silence(dur)`, `SOUNDS` (table extensible : `SOUNDS.monSon = (p) => {…}`), `ready`, `muted`, `lastError`. Branchement : table `MAP` événement → son en fin de fichier. Détails : §14.3.

### `BE.Input` (`04_input.js`)
`init(canvas)`, `pointer {down,x,y,sx,sy,t0,maxMove,type}` (logique), `keys{code:bool}`, `key(code)`, `isHeld()` (doigt ou F), `TAP_MS = 150`, `TAP_PX = 12`. Émet les événements d'entrée (§6).

### `BE.Phys` (`05_physics.js`) — déterministe, pas fixe 1/120
- VOL : `makeFlightStar(spec{id,size,color,grav,bagId}, angleDeg, opts{speedMul,x,y,dmgBonus})`, `stepFlight(world, dt)`, `preview(world, spec, angleDeg, maxContacts, opts)` → `{pts:[x,y,…], contacts:[{x,y}], tailFrom}`, `collideStatic(star, cx, cy, rc, e)` → 0/1/2.
  `world = { stars, pegs, targets, g, t, wallL, wallR, ceil, exitY, ignoreObstacles, funnel?, hooks:{pegRest, peg, target → "absorb"?, wall, exit} }`.
  `funnel = {wl, wr, L, R, y0, y1, bot, e}` (`Run.funnel(run)`) : épaules de l'entonnoir (segments (wl, y0)→(L, y1) et (wr, y0)→(R, y1)) puis murs verticaux du bocal ; collision segment = point le plus proche + `collideStatic(…, 0, e)`, jamais ignorée (même après `ignoreAfter`), pas de hook `wall`. `canExit(world, star)` : sortie du vol si `y > exitY` **et** étoile entièrement dans le col `[L, R]` (aussi utilisé par `preview`). Une étoile en vol a le rayon `SIZES[s].rf` ; un corps du bocal `SIZES[s].r`.
- BOCAL : `makeBody(spec)`, `stepJar(jar, dt)`, `allAsleep(jar)`, `freeze(jar)`, `wake(b)`, `wakeAll(jar)`, `hashJar(jar)`, `contacts()` (débogage : contacts du dernier pas).
  Solveur : impulsions séquentielles (6 itérations) avec **warm starting** (impulsions du pas précédent, cache non sérialisé `jar._wc`), contacts créés dès le toucher (marge 0,75 px, y compris murs et fond), frottement de Coulomb μ = 0,25, correction de position β = 0,6 / marge 0,3 px (3 passes), sommeil < 6 px/s pendant 0,4 s ; un corps endormi est statique (masse infinie) tant qu'un voisin à > 30 px/s ne le réveille pas. Mesures : 40 étoiles lâchées → repos en < 2,5 s, pénétration ≤ 0,3 px ; 55 Pierres (remplissage 80–99 %) → repos < 1,1 s.

### `BE.Firm` (`06_firmament.js`)
`create()`, `setupLune(run)`, `setupNight(run)`, `genGhost(run, shotIdx)`, `spawn(run)`, `descend(run)` → `[{size,x,type}]` (Pierres), `burnTick(run, S)`, `hitByStar(run, target, star, S)` → `"absorb"|undefined`, `damage(run, target, dmg, {armor}, S)`, `kill(run, target, S)`, `turretTarget(run, x)`, `plasma(run, x, size, S)`, `tempete(run)`, `ronce(run, x)`, `pegs(run)` → `[Peg]`, `dousedPegs(run)`, `pegNeighbours(pegs, idx)`, `targets(run)`, `alive(run)`, `occupied(run, col, row)`, `ruleActive(run, ruleId)`, `makeShadow(run, type, col, row, hp?)`, `makeBoss(run, bossId)`, `placeBoss(b)`, `hpFor(run, type)`, `hpFactor(run)`, `def(shadow)`.
`S` désigne un contexte de journal `{ log: [], orphan?: bool }` (en pratique `BE.state.play` ou `{log: play.orphanLog, orphan: true}`).

### `BE.Jar` (`07_jar.js`)
`create()` (murs `GEOM.jarL/jarR`), `add(run, spec)`, `remove(run, body)`, `cap(run)`, `addFromFlight(run, star, S)` (rayon au bocal, x ramené entre les murs), `dropStone(run, size, x)`, `applyRules(run)` (La Marée, L'Étau), `step(run, dt, S)` (physique + fusions), `merge(run, a, b, S)`, `mergeMult(run, size, pure)`, `react(run, id, body, S)`, `breakStone(run, stone, S)`, `isBigBangPair(a, b)` (un Trou Noir + une étoile de taille ≥ `DATA.BIGBANG.partner`, 6 : Trou Noir + Nova ou Trou Noir ; permis sous `rules.noMixed`), `bigBang(run, at, S)`, `isRest(run)`, `capacity(run, h?)` (surface utile entre les murs courants sous l'horizon `h`, par défaut `Run.horizon`, × `GEOM.packing` 0,6), `fillOf(area, top, w, floor, h)` (pur : max(Σ aires / capacité, (fond − haut) / (fond − h)), ≤ 1), `area(run)`, `pileTop(run)` (haut des corps au repos ou < 60 px/s), `fill(run, h?)` (jauge affichée, Balance / Équilibre / D02), `areaFill(run)` (part surfacique seule, mesures), `overflowing(run)`, `danger(run)` (< 16 px), `near(run, marge)`, `alertLevel(run)` (2 rouge, 1 ambre si l'étoile courante posée sur le tas dépasserait la ligne, 0), `trim(run, margin?)` → nombre de corps évaporés (évapore ce dont le haut dépasse `horizon + margin`, puis `settle`, jusqu'à ce que rien ne dépasse ; filet de sécurité après 12 passes : évaporation sans tassement. Nuit gagnée, début de nuit, migration : marge 0 ; Vidange partielle : `PHYS.jar.carryMargin` = 16 px, la zone rouge), `vidangeGold(run)` (+1 par étoile ≥ 4 qui part, max 5), `topY(run)`, `stars(run)`, `colors(run)`, `maxSize(run)`, `evaporate(run, bodies)`, `eatBiggest(run)`, `vidangeLeaving(run)` (corps qui partent : tous, ou pour `rules.keepJar` les étoiles de taille < `rules.keepJarMin`), `vidange(run, out?)` → or (retire ces corps puis `settle` et `trim(run, 16)` ; `out.trimmed` = corps évaporés, événement `trim {reason:"vidange"}` ; `rules.candleRelit` rallume la Bougie), `settle(run)` (résolution silencieuse jusqu'au repos, fusions → réserve ; utilisée par `squeeze` et la Vidange), `stabilize(run, steps)`.

### `BE.Shop` (`10_shop.js`)
`enter(run)` (idempotent pour une même nuit ; conserve l'article verrouillé ; déclenche `evolve`), `leave(run)`, `genOffer(run, excludeIds)`, `buy(run, i, opts|"auto")` → `{ok, reason}` (raisons et sélecteurs clou / gravure : §11.4), `reroll(run)`, `lock(run, i)`, `sell(run, slot)`, `move(run, slot, dir)`, `moveTo(run, from, to)`, `preview(run, relicId, removeSlot?)` → `{before, after}` (exact), `relicPrice`, `sellPrice`, `families()`, `unlocked(src)`, Constellation `openPack/pickPack/closePack`, `purge`, `engrave`, `placeClou`. Vue : `BE.Shop.View` (§11.5).

### `BE.Render` (`11_render.js`)
`init(canvas)`, `setResolution(k)`, `setExtents(ext)` (étendue visible, reconstruit le fond), `ext`, `fillScreen(g)` (remplit tout l'écran visible), `bandExtra()` (0–30 : hauteur ajoutée à la bande des reliques), `relicY()`, `prewarmStep(budgetMs)` → bool (préchauffage des sprites), `draw()` (image complète), `drawGame()`, `drawBackground(t, opts{moon:false}?)`, `drawMoon(t, x, y, scale, alpha)`, `drawStar(x, y, size, color, opts{pure,lookX,lookY,seed,squash,sx,sy,stretch,dir,scale,alpha,bicolor,bicolorA,sleepy,excited,noFace})`, `drawStone(body{x,y,r,size?,id,seed}, alpha?, sx?, sy?)`, `drawShadow(shadow, look)`, `drawBadges(shadow)`, `drawPegs(pegs)`, `drawJarGlass(run)` (fond du verre + `Meta.drawJarTheme`), `drawJarFront(run, danger)`, `drawHorizon(run, level)` (0 / 1 ambre / 2 rouge ; jauge lissée, descend pendant la Vidange), `drawAim(play, run)`, `drawHUD(run, play)`, `drawRelicBand(run, play)`, `drawCounter(run, play)`, `drawGhostRow(run)`, `drawLuneTrack(run, cx, y, opts)`, `drawRelicIcon(id, x, y, size, opts{scale})`, `drawReactionIcon(id, x, y, size)`, `coinIcon(x, y, r)`, `famColor(color)`, `text(...)`, `Label` (libellé en cache), `jarDanger(run)`, `K()`, `ctx`.
Ordre de rendu (§11.2) : fond → verre (fond) → clous → Ombres → Ombres mourantes → bocal → étoiles en vol → verre (face avant) → horizon → aperçu → faisceaux/anneaux/éclairs/particules → nombres → **badges + rangée fantôme** → vignette d'alerte → compteur → HUD → bande des reliques → bannières → voile de fin de nuit → UI → (hors jeu : FX par-dessus l'UI) → flash/fondu. Détails : §14.1.

### `BE.FX` (`12_fx.js`)
`particle(x,y,opts)`, `burst(x,y,n,opts)` (opts : `angle, spread, speed, vx, vy, life, size, color, drag, g, glow, alpha, kind 0 point|1 éclat|2 pièce aspirée (tx,ty, émet coinArrive)|3 fumée|4 paillette|5 trait|6 braise aspirée|7 note ♪`), `sparkle(x,y,n,color,speed,life)`, `suck(x,y,n,tx,ty,color,coin,life)`, `float(x,y,text,color,size,opts{life,rise,bg,vx,weight})` (pool 40), `ring(x,y,r0,r1,color,dur,w,glow)`, `bolt(x1,y1,x2,y2,color)`, `beam(x1,y1,x2,y2,color,w,dur)`, `banner(text,x,y,color,size,dur,sub,icon)`, `shake(amp,dur)`, `kick(dx,dy)`, `stop(sec)` (hitstop), `flash(a,color,hold?,decay?)`, `fade(dur,color)`, `after(sec,fn,arg)`, `vibrate(pattern)`, `glow(color)`, `font(weight,px)`, `roundRect(g,x,y,w,h,r)`, `clear()`, `update(el)`, `draw*` ; `hitstop, ox, oy, pools, GOLD_POS, GAUGE_POS, drawn`. Respecte `settings.shake/flash/vibrate`. Détails : §14.2.

### `BE.UI` (`13_ui.js`)
Mode immédiat : chaque image, les écrans dessinent et **enregistrent** leurs régions cliquables ; les clics utilisent les régions de l'image précédente.
`draw(g)`, `SCREENS[scene](state, run)` (écrans : TITLE, SELECT, NIGHT_INTRO, NIGHT_WON, VIDANGE, SHOP, RUN_LOST, RUN_WON, RUN_END), `button({id,x,y,w,h,label,sub,style:"primary"|"gold"|"ghost"|"danger"|"eclat",size,disabled,whyDisabled,onTap})`, `region(id,x,y,w,h,onTap,focusable)`, `click(x,y)` → bool, `key(e)` → bool (flèches = focus, Entrée = valider, Échap = retour ; raccourcis de l'Aube R/L/Espace/Q/E), `regions()`, `openPanel("bag"|"relics"|"settings")`, `panel`, `modalOpen()`, `setPaused(bool)`, `toast(msg)`, `sel` (sélection en boutique `{kind:"offer"|"relic", i}`), `panelBox, text, wrap, neon`.
Bulles d'onboarding (§10.9) : `meta.flags.tutoAim/tutoMerge/tutoShadow/tutoQuota`, `state.ui.bubble = {id, t}`.

### `BE.Meta` (`14_meta.js`)
`hasRoom(id)`, `defiDone(id)`, `isUnlocked(src)`, `hasGardien(id)`, `maxEclipse(id)`, `nextRoom()` → `{room, need}`, `discover(kind, id)`, `discoverReaction(id)`, `endRun(run)` → `{total, lines:[{txt,n}], defis, won, eclipseUnlocked}`, `dailySeed()`, `dailyInfo()`, `dailyOpts()`, `shareText(run)`. API complète, écrans et branchements : §12.

### `BE.Debug` (`15_debug.js`)
Overlay et raccourcis (`#debug`), bac à sable, bots headless `simulate`, tests unitaires `tests()`, mesures §13.3. Détails : §15.

### `BE.Test` (`99_main.js`) — API d'automatisation (à conserver)
`state()` (instantané : scène, Lune, nuit, tirs, total, quota, or, bocal, reliques, offres `{kind,id,type,size,color,price,sold}`, `result`, `nuitBlanche`, `eclipse`, `daily`…), `toClient(x,y)`, `regions()`, `region(id)`, `newRun(opts)`, `shoot(angle)`, `shotSync(angle)` (tir résolu synchroniquement, sans rendu → bots), `step(n)`, `setTurbo(n)`, `winNight()` / `skipToShop()`, `lose(cause)`, `buy(i)`, `reroll()`, `nextNight()`, `giveGold(n)`, `addJar([{size,color,x,y,stone}])`, `tapLogical(x,y)`.
Ids de régions utiles : `new`, `continue`, `daily`, `set`, `obs`, `grim`, `launch`, `back`, `prev`, `next`, `ecMinus`, `ecPlus`, `pause`, `resume`, `pbag`, `prel`, `pset`, `pgrim`, `abandon`, `pmenu`, `offer0..2`, `lock0..2`, `buy`, `close`, `reroll`, `bag`, `pack`, `relic0..4`, `left`, `right`, `sell`, `nextNight`, `replay`, `share`, `menu`, `nuitBlanche` ; méta et Aube : §11.5, §12.4, §13.3.

---

## 9. Tests

- `NODE_PATH=$(npm root -g) node tools/smoke.js` : Playwright (Chromium de `/opt/pw-browsers`), `file://`, 390 × 844, tactile, DPR 2, ≈ 3 min. Parcours **de bout en bout** (voir §16.2) : titre → réglages (3 onglets) → Observatoire (construction) → Grimoire (onglets) → Défis → Ciel du Jour → sélection → pause et ses panneaux → **Lunes 1 et 2 jouées réellement** (bot greedy `BE.Debug.trial`, tirs tactile CDP / souris / API ; une nuit n'est forcée que si le bot ne peut plus l'atteindre) avec une Aube complète à chaque nuit (achats par l'interface, sélecteurs clou / gravure, relance, verrou, Constellation, Sac + Épurer, glisser-déposer) → Vidange → rechargement pendant un tir (PENDING_SHOT rejoué) et pendant l'Aube (état identique) → Lunes 3–5 accélérées → victoire → partage → **Nuit Blanche** jusqu'à la Lune 6 → 2e run (Éclipse 1) abandonné → Ciel du Jour perdu par Débordement → titre. ≈ 68 captures numérotées dans `tools/shots/` (le dossier est vidé à chaque lancement). Code de sortie ≠ 0 à la moindre erreur console / page / étape.
- Bots rapides : `BE.Test.newRun({seed}); BE.Test.shotSync(angle)` en boucle dans `page.evaluate` (≈ 0,1 s par run complet).
- `NODE_PATH=$(npm root -g) node tools/test.js` : tests unitaires §13.2 (`BE.Debug.tests`) + courte simulation de bots, code ≠ 0 au moindre échec. `node tools/balance.js --runs 500` : tableau des mesures §13.3. Voir §15.

---

## 10. Points d'extension (ce qui n'est pas encore fait, et où le brancher)

| Fonctionnalité (GDD) | Où l'ajouter |
|---|---|
| ~~Clous spéciaux, gravures, Constellation, Épurer, évolutions~~ | **Faits** : voir §11 (`10_shop.js`). |
| ~~Glisser-déposer des reliques (§3.1)~~ | **Fait** : voir §13 (`13_ui.js`). |
| ~~Observatoire, Grimoire, défis complets, Éclipses, Ciel du Jour (§9)~~ | **Faits** : voir §12 (`14_meta.js`). |
| ~~Nuit Blanche (Lunes infinies)~~ | **Faite** : §4.1 (`09_run.js`, `14_meta.js endNuitBlanche`, bouton de fin de run). |
| Équilibrage §13.3 | Réglé pour la méta neuve (6/7 cibles, 2 N/A) : voir §16.3. Leviers dans `01_data.js`. |
| ~~Bots, tests unitaires, CSV (§13)~~ | **Faits** : voir §15 (`15_debug.js`, `tools/test.js`, `tools/balance.js`). |
| Contraste renforcé, taille du texte ×1,25 (§10.10) | **Réglages faits** (§13). Reste : familles +15 % de luminosité dans `starSprite` (`11_render.js`). |
| ~~Musique plus riche~~ | **Faite** : 5 couches génératives par Lune, harmonies de boss et d'Éclipse (§14.3). |
| ~~Mini-carte « Nouvelle Ombre »~~ | **Fait** : mini-cartes dans la carte d'intro (§13). |

---

## 11. Contenu v1 et règles (`01_data`, `06_firmament`, `07_jar`, `08_scoring`, `10_shop`)

### 11.1 Score : pur et aperçus exacts (`08_scoring.js`)
- `buildCtx(log, run)` ne dépend **pas** des reliques possédées. Champs ajoutés : `pegTouches` (tous les clous touchés, spéciaux et éteints compris : Diapason, Poids plume, Harpe), `doubleHits` (Clous doubles), `darkHits`, `bolts`, `launchedColor`, `distinctReactions` ; chaque `merges[i]` porte `mult` (sans Alchimiste) et `alch` (écart si Alchimiste).
- `Jar.merge` journalise `m0` / `mA` (Mult sans / avec Alchimiste) en plus de `mult` (valeur réelle, pour le compteur live et la réserve).
- `Score.effective(ctx, relics)` (pur) applique les reliques « V » qui touchent le score : Alchimiste (`passive.alchimiste`), Prisme de poche (`firstMergeTwice` : 1re fusion dupliquée, Mult et déclencheurs), Observatoire Ionique (`plasmaMerge` : fusion synthétique de taille 4 par Plasma, `synthetic:true`, ignorée par Couronne). `compute` l'appelle : `steps[0]` = base effective.
- Conséquence : `Shop.preview` = `compute(run.lastCtx, reliques ± candidate)` est **exact** (vérifié : 420 couples relique × tir rejoués réellement, 0 écart). Une étape de relique sans effet n'est plus émise. `Score.stepLabel(step)` → libellés « +4 », « ×2 ».

### 11.2 Évolutions (§8.2)
`DATA.EVOLUTIONS` = reliques légendaires (`rar:"L"`, `evo:true`, `base`, `reaction`, `hint`), dans `RELIC_BY_ID` mais **pas** dans `RELICS` (jamais vendues). `DATA.EVOLUTION_BY_BASE[baseId]`. `Shop.evolve(run)` (appelé par `Shop.enter` à chaque nouvelle Aube) remplace `run.relics[slot]` par `{id, evolved:true, from}` si Laboratoire (ou Ciel du Jour) + base possédée + `reactionCounts[reaction] ≥ 3` ; émet `evolve {slot, from, to}` ; `run.shop.evolved` / `evolvedSeen` pilotent l'animation (1,5 s). Nouveaux passifs agrégés par `Run.passives` : `boltFreeze` (E4, lu par `Firm.bolt`), `goldPerStone` (E5, lu par `Jar.breakStone`), `plasmaMerge` (E1). `Shop.evolutionProgress(run, relicId)` → `{evo, n, need}` (fiches, Grimoire).

### 11.3 Firmament et bocal
- `Firm.bolt(run, target, body, S)` : éclair de tourelle (taille, ignore l'armure ; E4 gèle). Appelé par la scène TURRETS.
- Plasma respecte l'armure de la Blindée (seules Brûlure et éclairs l'ignorent). Horloge : `shotIndex % 3 === 0` (3e, 6e, 9e…).
- Boss tué → `Jar.applyRules(run)` : La Marée / L'Étau sont levées pour le reste de la nuit.
- `Jar.applyRules` : si L'Étau **resserre** les murs, `Jar.squeeze(run)` émet `squeeze` puis `Jar.settle(run)` simule jusqu'au repos (≤ 6 s) ; fusions orphelines → `run.reserve` (événement `reserve`).
- **Tirs d'apprentissage** (GDD §2.2) : `Run.startNight` pose `run.graceShots = ECO.lune1Grace` (2) en Lune 1 (hors Éclipse 5) et les ajoute à `shotsLeft` ; l'or des tirs inutilisés porte sur `max(0, shotsLeft − graceShots)` ; pastilles bleutées (`P.glass`) en fin de rangée sous le Phare.
- **Vidange partielle** (L'Insomniaque) : `play.vid = {n, done, leave: [ids], kept}` ; le rendu ne fait tomber que `leave`, l'écran dit « les petites étoiles s'évaporent ».
- Éteignoir : un clou (spécial compris) éteint donne 0 Éclat ; l'événement `peg` du journal porte `dark`.
- `DATA.STONE_MULT` (2), `DATA.STONE_BREAK_GAP` (4).
- **Géométrie du bocal** (amendement GDD §4, §5.2) : bocal 200 × 164 sous l'horizon (`GEOM.jarL/jarR` 80/280, `horizon` 452, `jarArea` calculée), entonnoir `GEOM.funnelY/rimY` (330/385), `PHYS.flight.eFunnel` 0,3. Deux rayons par taille : `SIZES[s].rf` (vol, valeurs d'origine 14…62) et `SIZES[s].r` (bocal, 20/25/31/38/46/50/40 : sprites, physique, Pierres ; Nova aplatie en v1.1b ; Trou Noir **effondré** en v1.1c : `r` 40, `rBorn` 58 pour l'animation d'effondrement de 0,3 s dans `drawJar` et l'anneau de `FX` sur `merge` taille 7, `mk` 2,1). Masse d'un corps : `DATA.massOf(size, r, stone)` = r² × (`SIZES[s].mk` ou 1), × `PHYS.jar.stoneMass` pour une Pierre (`Phys.makeBody`, `Run.migrate`). Rendu : l'étoile en vol est dessinée à l'échelle `rf/r`, un corps qui vient d'entrer grossit de `rf` à `r` en 0,16 s (`landT`) ; verre avec épaules et pénombre hors du col (`buildJar`), jauge de remplissage verticale à droite du bocal (`drawHorizon`).

### 11.4 Aube (`10_shop.js`) — logique
Articles : `{kind:"relic", id}`, `{kind:"star", size, color}`, `{kind:"clou", type}`, `{kind:"gravure", id}` (+ `price`, `sold`). Tirage par `DATA.OFFER_WEIGHTS` (relique 50 · étoile 22 · clou 15 · gravure 13), types sans contenu débloqué ignorés, pas de doublon dans une rangée (`Shop.itemKey`).

| Fonction | Rôle |
|---|---|
| `buy(run, i, opts?)` | `opts` clou `{slot, color?, replace?}`, gravure `{bagId, replace?}`, ou `"auto"` (choix par défaut : emplacement formant une paire, sinon le 1er libre ; couleur dominante du Sac ; plus grosse étoile non gravée). Raisons : `gold, full, bagFull, sold, needSlot, needColor, occupied, needStar, engraved, same`. |
| `grant(run, item, opts)` | Applique un article sans le payer (achat, Constellation). |
| `placeClou(run, type, {slot, color, replace})` | Pose (clou remplacé revendu 50 % → +2 or), `Run.refreshPegs()`, `shop:clou {slot, type, pairs, refund}`. `pairsFor(run, slot, type)`, `bestSlot`, `slotNeighbours`. |
| `engrave(run, gravId, {bagId, replace})` | 1 gravure par étoile ; `shop:engrave`. |
| `purge(run, bagId)` | Épurer : 2 or, Sac ≥ 6 ; `shop:purge`. |
| `openPack(run)` / `pickPack(run, j, opts)` / `closePack(run)` | Constellation : 4 or (gratuit + rareté +1 avec le Coffre de la Mère-Ombre, consommé à l'entrée de l'Aube). 3 cartes (`DATA.PACK`), JACKPOT si 3 du même type → 2 choix. État dans `run.shop.pack = {price, chest, state:"closed"|"open"|"done", cards, picks, jackpot}` ; `shop:pack`, `shop:pick`. |
| `reroll`, `lock`, `sell`, `move`, `moveTo(run, from, to)` | Relance 2 (+1), verrou unique conservé d'une Aube à l'autre, vente ⌊prix/2⌋ min 1, réordonnancement (glisser-déposer : `moveTo`). |
| `describe(item)` | `{title, sub, desc, color}` pour les fiches. |

### 11.5 Aube — vue (`BE.Shop.View`)
Dessin en mode immédiat avec `BE.UI` (`text`, `wrap`, `button`, `region`, `panelBox`, `neon`) et `BE.Render`. Branchée dans `13_ui.js` par six appels d'une ligne (à conserver lors d'une réécriture de l'écran) :
`View.extras(g, st, run)` (fin de l'en-tête de `SCREENS.SHOP` : pastille Constellation en haut à gauche, ouverture auto de l'évolution), `View.cardBody(g, o, x, y, w, h)` (`drawCard`), `View.describe(o)` (`drawDetail`), `View.need(i, res)` (`tryBuy` : ouvre le sélecteur), `View.panel(g, st, run, p)` (`drawPanel`), bouton « Sac » de l'Aube → panneau `shopBag`.
Panneaux (`UI.panel.type`) : `shopPick` (mini-carte A–F avec paires en pointillés / ×2, couleur du Teinturier, grille du Sac pour graver ; confirmation en 2 temps pour remplacer), `pack` (rouleaux qui s'arrêtent à 0,4 s d'écart, JACKPOT, 1er tap = fiche, « Prendre »), `shopBag` (Sac détaillé + Épurer), `evolve` (animation 1,5 s + fiche légendaire). Icônes : `View.drawClou(g, type, x, y, s, color)`, `View.drawGravure(g, id, x, y, s)`, `View.drawItem(g, item, x, y, s)`. Régions de test : `pack`, `packOpen`, `card0..2`, `packTake`, `packSkip`, `pickOk`, `pickCancel`, `slotA..F`, `color<famille>`, `star<bagId>`, `purge`, `bagClose`, `evoOk`.

## 12. Méta-progression et sauvegarde (`02_save.js`, `14_meta.js`)

### 12.1 Sauvegarde (`BE.Save`)
- Clés : `bde.v1.meta` (+ copie de secours `bde.v1.meta.bak`, réécrite à chaque `saveMeta`), `bde.v1.run`. Toute clé d'objet commençant par `_` est un cache transitoire : **jamais sérialisée** (replacer JSON).
- `loadMeta()` : JSON illisible ou version ≠ 1 → copie de secours → défaut. Puis complétion champ par champ (types vérifiés) et assainissement (salles / Gardiens inconnus retirés, Éclipses bornées 0–8, `veilleuse` toujours présente, historique du jour ≤ 30).
- `checkRun(r)` → `null` ou la raison ; `loadRun()` écarte (et efface) un run invalide ou terminé — jamais de reprise « à moitié ».
- **Anti-save-scum (§12.6 du GDD)** : `saveRun` ne remplace **pas** un instantané `PENDING_SHOT` par un état `AIM`/`PENDING_SHOT` du même tir (mêmes `seed, lune, nuit, shotIndex, runStats.shots`). Or `Run.resume` passe par AIM (qui sauvegarde) puis rejoue le tir. De plus, un run `PENDING_SHOT` n'est écrit que par `Run.fire` (`opts.pending`) : l'état **en cours** de tir (étoile déjà piochée, tir déjà décompté, bocal en mouvement) est refusé (`stats.pendingRefused`) — « Menu principal » pendant un vol laissait sinon partir un 2e tir tout seul à la reprise et permettait de toucher plusieurs fois la récompense d'une nuit. Vérifié par test : 8 graines × 6 tirs rejoués depuis leur instantané → même empreinte (`runHash`) à chaque fois.
- `probe()` (au chargement), `wipe()`, `size()`, `lastError`, `stats {metaWrites, runWrites, pendingKept, rejected, pendingRefused}`.

### 12.2 Méta (format ajouté au §9.7 du GDD)
Champs en plus : `grimoire.stars {taille|famille: compteur}` (8 = Big Bang), `stats.{fragmentsTotal, maxSize, bestLune, bestPureShot, bestStonesShot, bestMergesShot, bestKillsShot, bestPureRun, fewestShotsNight, byGardien{id:{runs,wins,bestLune,bestEclipse}}}`, `daily.attemptDate`, `daily.history[{date, score, best, lune, nuit, won, gardien, grid, shot}]`, `runDisc {seed, keys}` (découvertes du run en cours, persistées → Fragments justes même après rechargement), `flags.{lastGardien, themeAurore}`. Découvertes d'Ombres : types (`"rampante"`…) et boss (`"boss:faim"`…) dans `grimoire.ombres`.
Écritures regroupées : `Meta.flush()` aux scènes calmes (AIM, SHOP, TITLE, RUN_END, NIGHT_WON, SELECT), à `visibilitychange`/`pagehide`, et immédiatement pour une salle construite ou un défi accompli.

### 12.3 `BE.Meta` — API
| Fonction | Rôle |
|---|---|
| `built(id)` / `hasRoom(id)` | Salle réellement construite / contenu disponible (Ciel du Jour ou `Meta.forceAll` : tout). **Le contenu en jeu doit lire `hasRoom` / `isUnlocked`.** |
| `isUnlocked(src)`, `srcLabel(src)` | Source `{type:"depart"|"room"|"defi", id}` ; libellé lisible. |
| `hasGardien(id)`, `eclipsesOpen()`, `maxEclipse(id)` | Déblocages §6.6 / §9.5 (gagner à l'Éclipse N ouvre N+1 pour ce Gardien, si D12). |
| `nextRoom()`, `nextRoomText(nr?)`, `canBuildAny()`, `build(id)` → `{ok, reason, need}`, `roomContent(id)`, `ROOM_INFO` | Observatoire. |
| `discover(kind, id)`, `discoverReaction(id)`, `entries(tab)`, `completion()`, `unseen()` | Grimoire (onglets `etoiles, reactions, evolutions, reliques, ombres, defis`). |
| `defiProgress(id)` → `{cur,max,done,pct}`, `completeDefi(id, silent?)`, `bump(id, v)`, `checkStatDefis()`, `DEFI_INFO` | Défis : progression = meilleure valeur, récompense appliquée à l'accomplissement (Gardien, +10 ◇, thème). Les reliques / clou / gravure débloqués passent par `isUnlocked`. |
| `endRun(run)`, `settleAbandoned(savedRun)` | Fin de run (idempotent par run). Un run sauvegardé **remplacé** par un nouveau run (depuis titre / sélection / Ciel du Jour) est soldé comme abandon : ses Fragments ne sont pas perdus. |
| `dailySeed(date?)`, `dailyOpts(date?)`, `startDaily()`, `dailyInfo()`, `dailyEntry(date?)`, `dailyStreak()` | Ciel du Jour : premier run du jour = score officiel (`run.dailyOfficial`), historique 30 jours. `startDaily` reprend le run du jour s'il est sauvegardé. |
| `shareText(runOuEntrée)`, `share(src)` | Texte façon Wordle (§9.6) ; `share` copie dans le presse-papiers (repli `execCommand`) et ouvre la feuille native sur mobile tactile. |
| `notify({kind, id, title, name, sub, color})` | Carte « DÉFI ACCOMPLI » / « ÉCLIPSE N DÉBLOQUÉE » / salle abordable (dédoublonnée, les périmées sont ignorées). |
| `drawPortrait(g, gid, x, y, s, locked)`, `drawItem(g, item, x, y, s, known)`, `drawGrid(g, grid, cx, y, s)`, `fragIcon(g, x, y, r)` | Dessins réutilisables (portraits vectoriels des 5 Gardiens, icônes de contenu, mini-grille). |
| `dev.{frags(n), defi(id), room(id), unlockAll(), discoverAll(), reset()}` | Outils de test / debug. |

Événements écoutés : `merge, bigbang, reaction, spawn, launch, nightStart, shotScored` (lit `run.lastCtx`), `kill, quota, evolve, scene`. Émis : `meta:room {id}`, `meta:defi {id}`, `meta:discover {kind,id}`.

### 12.4 Écrans et branchements
Scènes enregistrées par `14_meta.js` au chargement (`Run.SCENES` + `Object.assign(UI.SCREENS, …)`) : `SELECT` (remplace l'écran de la tranche : carrousel glissable, portraits, défi et progression des verrouillés, sélecteur d'Éclipse, confirmation si un run sauvegardé serait remplacé), `OBSERVATORY` (tour en coupe 2 × 4, salles animées, prochaine salle en pointillés, fiche + construction en 2 temps, allumage 2 s), `GRIMOIRE` (6 onglets, liste défilante au doigt / molette / flèches, silhouettes + indices poétiques, pastilles « NOUVEAU »), `DAILY` (Gardien et relique du jour, score officiel, historique 30 jours, compte à rebours).
Appels d'une ligne dans d'autres fichiers (à conserver lors d'une réécriture) :
- `13_ui.js` : `UI.key` → `BE.Meta.key(e)` en tête et `BE.Meta.isMenu(scene)` pour le focus ; `UI.draw` → `BE.Meta.drawOverlay(g, st)` avant les toasts (Grimoire de la pause + notifications) ; titre → boutons `obs` / `grim` = `BE.Meta.open(...)`, `daily` = `Run.go("DAILY")`, `BE.Meta.drawTitleExtras(g, st, ry)` (compteur ◇, pastilles), bandeau `BE.Meta.nextRoomText(nr)` (titre et fin de run) ; fin de run → `share()` délègue à `BE.Meta.share`, « Rejouer » d'un Ciel du Jour → `BE.Meta.startDaily()` ; pause → bouton `pgrim` = `BE.Meta.openOverlay()`.
- `11_render.js` : `drawJarGlass` → `BE.Meta.drawJarTheme(g, run, l, r, top, bot)` (thème « Aurore », D16).
Régions de test : `obs`, `grim`, `daily`, `back`, `defis`, `room_<id>`, `build`, `closeRoom`, `tab0..5`, `themeAurore`, `dailyPlay`, `dailyShare`, `ecMinus`, `ecPlus`, `pgrim`.

## 13. Écrans, UI et contrôles (`04_input.js`, `13_ui.js`)

### 13.1 `BE.Input` (`04_input.js`)
- Pointeur unique (un pouce) : `pdown / pmove / pup {dur, moved, tap, click} / pcancel {reason:"right"|"cancel"|"lost"|"blur"}`, `hover` (souris seulement, `{x:-99}` en sortie du canevas), `wheel {x,y,dx,dy}`. `tap` = < 150 ms **et** < 12 px (jamais un tir), `click` = < 12 px (menus).
- Clavier : `key {code,key,shift,repeat}` / `keyup`. Les combinaisons Ctrl / Cmd / Alt ne sont **jamais** détournées (Ctrl+R reste le rechargement).
- `readSafeArea()` / `safeInsets()` → `{top,right,bottom,left}` (px CSS, via une sonde `env(safe-area-inset-*)`). `99_main.resize` soustrait ces marges avant de calculer l'échelle (encoche, barre d'accueil) ; `BE.view.safe` les expose.
- `lastType` (`"touch"|"mouse"|"pen"|"key"`), `isTouch()` (indices « Touche… » vs « Clic… »), `touchDevice`, `holdTime()`, `isHeld()` (doigt ou F), `key(code)`.

### 13.2 `BE.UI` (`13_ui.js`) — compléments
- **Widgets** : `UI.button(o)` accepte en plus `icon(g, x, y)`, `alpha`, `dy` (entrées animées), survol souris (`UI.hoverId`, curseur main) ; styles `primary | gold | ghost | danger | eclat | frag`. `UI.fitText(t, x, y, maxW, size, color, align, weight, minSize)`, `UI.glowAt(x, y, r, color, a)`, `UI.isFocused(id)`. Réglages : interrupteurs (`tg_<clé>`), curseurs glissables (`sl_<clé>`, flèches ←/→ au clavier via `region.adjust`), segments (`sg_<clé><i>`). `region(id, x, y, w, h, onTap, focusable, extra)` : `extra` = `{slider, adjust, noHover}` ; `onTap(x, y)` reçoit le point du clic.
- **Transitions** : fondu 0,3 s à l'entrée des écrans de menu (`TITLE, SELECT, SHOP, RUN_END`, écrans méta) ; titre en cascade ; carte d'intro qui « compte » le quota ; cartes de l'Aube qui se retournent à l'entrée et à chaque relance (`shop:reroll`).
- **Carte d'intro (§10.4, §10.9)** : boss dessiné (`Render.drawShadow` d'une Ombre factice), règle, et **mini-cartes « Nouvelle Ombre »** pour chaque type de `DATA.NEW_SHADOWS[lune]` jamais présenté (`meta.flags.shadowCards`, marqué à la sortie de l'intro). `UI.introExtra()` → secondes ajoutées à la durée de la carte ; **lu par `SC.NIGHT_INTRO.update` (`09_run.js`)**.
- **HUD complémentaire** (dessiné par l'UI au-dessus du HUD de `11_render`) : zone d'annulation qui s'allume quand le doigt remonte vers y < 44 (§3.1), pastille « ▸▸ ×3 » quand la simulation est accélérée (§5.8), indices discrets pendant le tout premier run (« Maintiens le doigt pour accélérer », « Touche pour passer »).
- **Aube (§10.5)** : en-tête (récompense qui tombe en pièces, prochaine nuit + **règle du boss**), 3 cartes 96 × 128 (liseré et halo de rareté, reflet des rares, étiquette de tag, prix rouge si trop cher, cadenas 48 × 48 `lock<i>` + ruban « GARDÉE », tampon « ACHETÉ »), `reroll`, `bag`, puis les emplacements de reliques : **glisser-déposer horizontal** (seuil 12 px, les voisines glissent, aimant au centre du plus proche, `Shop.moveTo` au lâcher) avec **aperçu chiffré en direct** « Nouvel ordre : A → B ▲/▼ » (`Score.compute(run.lastCtx, ordre)`), et « Dernier tir avec ces reliques : N ». Fiche (200 px) : aperçu « Sur ton dernier tir : A → B (+x %) » (achat) / « Son apport… » (relique possédée), progression d'évolution, ◀ ▶, Vendre → Confirmer. Les six appels `BE.Shop.View.*` du §11.5 sont conservés.
- **Pause (§10.6)** : mini-jauge, tirs, or, graine, icône « sauvegarde indisponible ». **Réglages (§10.10)** en 3 onglets (`setTab0..2`) : Son (effets, musique 0–100 %, vibrations), Affichage (secousses, flashs réduits, daltonien, contraste renforcé, texte ×1 / ×1,25, Éco), Jeu (**vitesse ×1 / ×1,5 / ×2**, visée absolue / relative, visée assistée, langue fixée « Français », réinitialisation en double confirmation, désactivée pendant un run).
- **Fin de run (§10.7)** : meilleur tir qui compte, 6 statistiques, lignes de Fragments qui tombent une à une (tic sonore), total qui compte, défis réussis, barre de la prochaine salle.
- **Onboarding (§10.9)** : main animée (poser, glisser, relâcher) + bulle ; bulles fléchées au point de la 1re fusion, sur le badge-compteur de la 1re Ombre qui descend (`shadowMove`), et vers la jauge au 1er décompte (`count:start`). Drapeaux `meta.flags.tuto*` (inchangés).
- Toutes les cibles tactiles ≥ 48 × 48 logiques ; boutons de validation 56 px (flèches de la sélection : zone de 50 × 68 au-delà du dessin, `prevHit` / `nextHit`).
- **Titre** : Continuer · Nouvelle partie · Ciel du Jour empilés (240 × 56), puis Observatoire · Grimoire · Réglages en une rangée de trois boutons de 76 × 56 (icône + libellé) : mise en page compacte assumée pour garder le bocal animé visible sur 360 × 640.
- **Carte d'intro** : en Nuit Mince, la règle du boss de la Lune est annoncée (« Boss de la Lune : … »). Quand elle présente de nouvelles Ombres, la carte **attend un tap** (`UI.introHold()`, lu par `SC.NIGHT_INTRO`, jamais dans le bac à sable).
- **Astronome** : `UI.panel = {type:"swapPick"}` (régions `swapPick1..3`, touches 1/2/3) ; ouvert par `Run.askSwap`.
- **Pause** : « Abandonner » désactivé quand la nuit est déjà gagnée ; « Menu principal » ne sauvegarde que si `Run.canSave()`.
- **Aube** : la Constellation est une carte de la rangée d'achats (`Shop.View.PACK_BOX`, à gauche de Relancer et Sac), état « GRATUIT » + ruban « COFFRE » après une Mère-Ombre ; une relique compte comme **découverte** dès que sa carte est retournée (offres, relances, rouleaux de la Constellation — §9.1) ; bouton « Pleins : vendre une relique ? ».
- **Notifications** (`Meta.notify`) : jamais pendant une nuit (tir, décompte, nuit gagnée) ; à l'Aube 1,5 s après l'entrée, en bas au-dessus de « Nuit suivante » ; ailleurs en haut, toujours entièrement à l'écran (glissement court + fondu).
- **Bulles** : quota → sous la moitié droite de la jauge, qui est entourée ; fusion → au-dessus de l'horizon (y = 318), montrée une fois la cascade retombée (TURRETS / COUNT), fil pointillé vers la plus grosse étoile ; première bulle adaptée à la souris ; indice « Maintiens le doigt : encore plus vite » sur une plaque contrastée, seulement pour un tir encore en vol 0,8 s après le ×3 automatique, jamais plus une fois l'accélération utilisée (`meta.flags.usedHold`), ni quand le tas atteint l'horizon, ni sous une bannière à sous-titre (`FX.bannerWithSub()`, qui masque aussi la pastille ×3). Bannières de réaction empilées (une ligne de 24 px par bannière encore lisible) et bornées aux murs du bocal ; nombres flottants « +N » empilés (`FX.float(…, {stack:true})`). « LA BOUGIE S'ÉTEINT » et « TROP-PLEIN ÉVAPORÉ » dans le ciel (y = 300). Traits de vitesse discrets sur les bords pendant l'accélération. Bannières (QUOTA ATTEINT…) et « NUIT GAGNÉE » sur une plaque sombre douce.

### 13.3 Réglages ajoutés et branchements
- `settings.speed` (1 | 1,5 | 2) : multiplie `Run.timeScale()` pendant la résolution et le décompte, plafonné à ×4 (`09_run.js`, une ligne). `settings.contrast` : fond noir (`Render.drawBackground`) et contour blanc 2 px + familles +15 % des étoiles (variante de sprite, bit 4, §14.1). `settings.textScale` (1 | 1,25) : descriptions, bulles, toasts.
- `09_run.js` : un tap (< 350 ms) saute le décompte ; maintenir ne le saute plus au relâcher (×4 seulement).
- Régions de test ajoutées : `sheet`, `closeX`, `setTab0..2`, `sl_sfx`, `sl_music`, `tg_<clé>`, `sg_<clé><i>`, `reset`, `lock0..2` (toujours), `relic0..4` (glisser ou taper).

## 14. Rendu, juice et audio (`11_render.js`, `12_fx.js`, `03_audio.js`)

Les trois modules sont de **purs consommateurs** : ils lisent `BE.state` et écoutent le bus (§6). Les seules écritures dans des objets du jeu sont des horodatages d'animation non sérialisés (`shadow.squashT/hurtT/spawnT/dispX/dispY`, `body.squashT/landT`), jamais lus par la simulation.

### 14.1 `BE.Render` — sprites et couches
- **Caches** (vidés par `setResolution(k)`, `K = ⌈2k⌉/2` borné à [1, 4]) : étoiles `[variante × famille][taille]` avec variante = bits `1 pure | 2 daltonien | 4 contraste renforcé | 8 halo resserré` ; visages cadrés sur les traits (`[taille × mode(ouvert, cligne, « o »)] × Trou Noir`) + pupilles (dessinées à la volée, décalées de ≤ 2 px vers la cible) ; Pierres (7 tailles × 4 variantes, choisies par `seed`/`id`) ; clous (normal, éteint, flash) ; verre du bocal (fond + face avant, clé = murs, reconstruit sous L'Étau) ; Phare, faisceau de visée, pièce, points d'aperçu ; lune (5 phases : croissant → pleine → éclipse, partie sombre **découpée** pour laisser voir le ciel) ; icônes de reliques par `id × taille` (≤ 44 px, au-delà dessin vectoriel direct) ; disque d'accrétion du Trou Noir (tourne à la volée).
- **Fond** : dégradé + nébuleuses + voie lactée + vignette cuits dans un canevas ; deux couches de 60 et 30 étoiles en parallaxe 3 et 6 px/s dessinées comme **petits sprites** (tableaux `Float32Array`) — deux calques plein écran transparents coûtaient deux écrans de remplissage par image ; 14 scintillements, une étoile filante toutes les 6–15 s ; lune en fond (en jeu : discrète, phase = Lune du run ; titre/sélection : plus visible). `settings.contrast` → fond noir uni.
- **LOD** : halo des étoiles du bocal resserré (1,32 r au lieu de 1,8 r) quand le bocal est très plein (hystérésis : > 30 corps active, < 24 désactive, et **seulement entre les tirs**, jamais en pleine cascade) ou en mode Éco ; la face avant du verre n'est composée que sur trois bandes (murs, fond).
- **Préchauffage** : `prewarmStep` construit les 112 sprites d'étoiles (7 tailles × 4 familles × pure / halo resserré, pour les réglages daltonien / contraste courants) et les 42 visages, quelques-uns par image pendant les phases calmes (appelé par `99_main`) ; recommence si le réglage daltonien / contraste change. Plus aucun sprite n'est construit pendant les premières grosses fusions.
- **Plein écran** : fond cuit à l'étendue `ext` (2 px par unité au plus), étoiles de parallaxe et scintillements répartis sur toute l'étendue ; barre haute prolongée jusqu'au haut et aux bords ; bande des reliques agrandie de `bandExtra()` (icônes jusqu'à 28 px) et, si la marge du bas ≥ 40, noms des reliques sous les icônes, puis fondu vers le ciel.
- **HUD** : jauge relevée à y = 22 (l'anneau du Phare, rayon 30, passe dessous), or aligné à droite contre ⏸, libellé « SUIV. » sous la case, compteur du Sac = `Run.pileLeft`, compteur live sur une plaque sombre, lune de fond discrète (alpha 0,2). Motif daltonien des étoiles sur le « front » (jamais sur la bouche) et, en mode daltonien, motifs en creux sur les deux moitiés des icônes de réaction. Libellés ≤ 13 px ×1,15 avec « Taille du texte ×1,25 ».
- **Libellés en cache** (`R.Label(px, weight, color, stroke)`, `set(k1, k2, build, color?)` régénère seulement si les clés numériques ou la couleur changent, `draw(x, y, align, scale)`) : Lune, nuit/boss, quota « a / b », or, Sac, échanges, réserve, remplissage, compteur live, total du décompte.
- **Animations lues sur `BE.FX`** : `launchT` (recul du Phare), `swapT` (pop des étoiles échangées), `gaugeT` (pulsation de la jauge), `goldT` (pop du compteur d'or), `dangerT` (pouls rouge synchronisé avec le battement de cœur), `bigBangT` (rémanence dans le bocal), `auroraT` (arc-en-ciel sur le bocal quand le final Aurore sonne).
- **Compteur d'or du HUD** : monte d'une unité à chaque pièce arrivée (`coinArrive`), rattrapage après 1,3 s sans pièce, recalé si le HUD n'a pas été dessiné (Aube…).
- **Visages** : pupilles qui suivent l'étoile en vol (ou le premier contact de l'aperçu), clignement 3–6 s ; étoiles en vol étirées dans le sens de la vitesse, bouche « o » ; étoiles au-dessus de l'horizon en alerte : bouche « o » inquiète.
- **Ombres** : tache lissée (10 sommets, 2 harmoniques, ±1,5 px), aura violette additive (lisibilité), reflet intérieur, clignement, flash blanc au coup, surcouche de givre facettée ; attributs par boss (gueule de La Faim, voile, monocle de L'Avare, couronne de glace, vagues, mâchoires de L'Étau, couronne de l'Éclipse). Ombres tuées / converties : silhouette qui s'efface (blanche / dorée). Badge compteur qui pulse à 1.
- **Fin de nuit (§11.4)** : les 0,22 dernières secondes de `NIGHT_WON` (hors Nuit du Boss) et de `VIDANGE` tirent un voile `--bg0` ; l'entrée dans l'Aube est fondue par `13_ui`.
- **Hors jeu** (Aube, titre, sélection…) : après `UI.draw`, `Render.draw` compose les FX par-dessus l'interface (bouffées d'achat, JACKPOT, PAIRE !) — sauf si l'écran les a déjà dessinés lui-même (drapeaux `FX.drawn`, cas de l'Observatoire).

### 14.2 `BE.FX` — juice (§11.3)
- Pools fixes parcourus sans fermeture : particules 300, nombres 40, anneaux 32, éclairs 16 (points en `Float32Array`, re-crépités toutes les 50 ms), faisceaux 8, bannières 6, minuteries 64 (`after`). Polices mises en cache (`FX.font(weight, px)`).
- **Deux horloges** : particules, nombres et anneaux avancent en temps « jeu » (figés pendant le hitstop — effet d'arrêt sur image) ; secousse, flash, fondus, bannières et minuteries en temps réel (`performance.now`).
- Secousse : bruit sinusoïdal amorti (quadratique) + impulsion à ressort (`kick`, ex. débordement vers le bas). Flash : maintien + décroissance (Big Bang 120 ms), 30 % avec « Flashs réduits ».
- Dégâts agrégés par cible (12 emplacements, affichés au plus toutes les 250 ms, taille croissante avec le cumul).
- Tableau §11.3 appliqué tel quel (clou, contact, mort, atterrissage, fusion ≤ 4 / ≥ 5, réaction avec icône + nom + trait coloré, Pierre, Big Bang flash → silence 300 ms → onde blanche + bannière, quota, débordement). En plus : notes ♪ qui montent avec le rang du contact (la gamme pentatonique grimpe), aspiration du Trou Noir, colonne de Plasma, ronces, givre, brûlure, pièces aspirées vers l'or, braises dorées vers la jauge (conversion), une pièce par or à la récompense (`reward`) puis à la Vidange, feu d'artifice de victoire.
- **Ajouter du juice** : `BE.on("monEvenement", (e) => { FX.burst(…); FX.ring(…); FX.stop(0.03); })` en fin de `12_fx.js` ; ne jamais modifier la simulation.

### 14.3 `BE.Audio` — son (§11.5)
- Graphe : voix → gain de voix → panoramique (`x` logique → ±0,6) → bus effets (+ envoi réverbération) ; musique → passe-bas (LFO 0,1 Hz ±300 Hz) → gain d'atténuation → bus musique ; réverbération à réponse impulsionnelle générée (1,8 s, passe-haut 240 Hz) ; tout → compresseur (−18 dB, 4:1) → maître. 16 voix d'effets (la plus ancienne est coupée en 12 ms). Intervalle minimal par son (`LIMIT`) pour éviter la bouillie à ×4.
- Volumes : `settings.sfx` / `settings.music` (0–1 ; booléens tolérés) appliqués en douceur à chaque `update()`. Atténuation (« ducking ») de la musique sur fusion ≥ 5, réaction, quota, boss vaincu, débordement, défaite, victoire ; `music.duck(true)` = passe-bas 700 Hz (Aube, menus) ; Big Bang : maître à 0 en 20 ms pendant 300 ms, musique coupée 2,6 s.
- Musique (croche = 0,5 s, accord = 8 s) : Lune 1 = nappe + basse ; Lune 2 + boîte à musique (arpège toutes les 2 mesures) ; Lune 3 + contre-chant (marche aléatoire pentatonique, vibrato) ; Lune 4–5 + pulsation (battement grave, souffle). Harmonies : do maj7 ↔ la m7 ; Nuit du Boss la m(add9) ↔ fa maj7 ; Éclipse (Lune 5, boss) fa m(add9) ↔ ré♭ maj7. `nightStart` règle nuit/Lune et joue un carillon.
- Sons ajoutés au tableau §11.5 : `armor, tic (pièce qui arrive), kaching (conversion en or, 0,5 s après le quota), quota, swap, plasma, explosion, spawn, fall, evaporate, grow, bonusShot, devour, clash, final, whoosh, victory, lose, nightStart, sell, reroll, lock`. **Ajouter un son** : `SOUNDS.nom = (p) => { tone(…); noise(…); bell(…); }` puis une entrée dans `MAP` (ou un `BE.on`). `A.lastError` garde le dernier son en échec (les erreurs ne remontent jamais au jeu).

### 14.4 Budget mesuré
Chromium sans GPU (SwiftShader), 390 × 844, DPR 2, 60 corps + 300 particules + 40 nombres : ≈ 1,3 ms de JavaScript par image côté thread principal (hors rastérisation). Tous les sons et les 5 Lunes de musique ont été joués en test sans erreur.

## 15. Debug, bots et tests (`15_debug.js`, `tools/test.js`, `tools/balance.js`)

### 15.1 Overlay et raccourcis (`index.html#debug`, GDD §13.1)
- Overlay (haut gauche, `²`/Backquote pour masquer) : FPS, ms **logique** (somme des `Run.update` de l'image) et **rendu** (`Render.draw`), scène + `sceneT` + `timeScale`, corps, particules, remplissage, graine, Lune/nuit/tir, Lumière/quota/or/réserve, les 5 flux RNG (hex). Le chronométrage enveloppe `BE.Run.update` / `BE.Render.draw` **seulement** si `#debug` (aucun coût sinon).
- Touches : `G` +50 or · `N` gagner la nuit · `J` lâcher 10 étoiles aléatoires · `B` relique au choix (grille des 30 + 6 évolutions ; tap, ou flèches + Entrée ; emplacements pleins → remplace la dernière) · `K` tuer toutes les Ombres (via `Firm.damage` : Nuée, or, clous rallumés) · `1..7` lâcher une étoile de cette taille sous la souris · `T` tests unitaires (panneau + console) · `M` 10 runs greedy (panneau + rapport en console, CSV copié) · `H` aide.
- Les lâchers hors résolution sont animés par `Debug.frame` (le bocal avance jusqu'au repos ; fusions orphelines → réserve, comme en DESCENTE). Le sélecteur de relique est un `UI.panel` `{type:"debugRelic"}` (voile + fermeture au tap extérieur fournis par `13_ui`) dont les régions (`dbg_<id>`) sont ajoutées après `UI.draw`.
- **Quarantaine des triches** (`Debug.quarantine(fn)`) : pendant `K`, `N` et chaque pas d'un lâcher de debug, `BE.state.meta` est remplacée par une copie jetable (réglages partagés), `Save.saveMeta` neutralisé et `Meta.completeDefi` désactivé → les FX et l'audio réagissent, mais **aucune triche ne fait progresser défis, statistiques ou Grimoire**. (`G`, `B`, `1..7` pendant un tir restent visibles par la méta : ils ne déclenchent pas de défi à eux seuls.)

### 15.2 Bac à sable (headless)
`Debug.inSandbox(st, fn, all?)` : `BE.state = st` (`Debug.makeState(meta)` : même forme que `BE.state`), `BE.muteEvents = true`, `BE.Audio = null`, `Save.saveRun/saveMeta/clearRun` neutralisés (au 1er niveau), `Meta.forceAll = all` ; tout est restauré dans un `finally` (réentrant : pile). Les modules lisent `BE.state` à l'appel, donc toute la logique (`Run`, `Firm`, `Jar`, `Shop`, `Score`) tourne telle quelle, sans rendu. `Debug.withRun(opts, fn(run, st))` crée un run en AIM dans un bac à sable (`opts : {gardien, seed, eclipse, relics, rooms, meta, all}`) ; `Debug.freshPlay()` = `BE.state.play` vierge ; `Debug.advance(st, until, maxSteps, hook(from,to,st), tick(st,dt))` fait tourner `Run.update` (le décompte COUNT est avancé d'un coup) ; `Debug.shootSync(st, angle, hook, tick)` ; `Debug.runHash(run)` (bocal + score + Firmament + flux RNG). **Règle** : le code de simulation ne doit lire `BE.state` / `BE.Audio` qu'à l'exécution (jamais en cache au chargement) et ne jamais dépendre d'un écouteur d'événement — sinon les bots divergent du jeu.

### 15.3 Bots (`BE.Debug.simulate`)
- `simulate(opts)` → `Promise<{opts, runs, summary, report, csv}>` (rend la main toutes les 30 ms, au plus un tir de retard) ; `simulateSync(opts)` ; `playRun(opts, i)` → enregistrement ; `new Debug.Bot(opts, i).step()` (une action par appel). `opts : {runs, policy: "random"|"greedy"|"safe", gardien, eclipse, shop: "default"|"random"|"none", seed (run i = « seed-i », reproductible), offset, all, rooms, maxLune, onProgress(i, n), log, slice}`. Méta de simulation : **neuve** (contenu de départ) sauf `all`, `rooms`, `meta` ou `playerMeta`.
- Visée (`Debug.POLICIES`) : `random` (uniforme [12°, 168°], RNG du bot = mulberry32(graine)) ; `greedy` (24 angles répartis + décalage aléatoire, chacun joué par `Debug.trial(run, angle)` sur une **copie JSON** du run jusqu'au décompte → Lumière max) ; `safe` (Lumière − 500 si remplissage > 0,7) ; `noisy` (« doigt humain » : meilleur de 12 angles, tiré avec une erreur gaussienne σ = 1,5°, sans échange). Boutique (`Debug.SHOP_POLICIES`) : `default` = §13.1 étendue pour dépenser comme un joueur (relique la plus chère abordable si emplacement libre ; emplacements pleins → revend la moins chère pour une plus chère ; puis clou, étoile de taille ≥ 3, gravure ; au plus 2 relances par Aube s'il reste de quoi acheter ; 10 or gardés dès la Lune 2), `random` (relique abordable au hasard : détection des builds dominants), `none`. **Échanges** : `Debug.swapChoice(run, rng, policy)` — greedy / safe évaluent aussi chaque étoile échangeable (24 angles chacune) quand il reste un échange (`opts.swap: false` pour désactiver) ; nombre d'échanges dans `rec.swaps`.
- Enregistrement par run : `{seed, gardien, eclipse, policy, shopPolicy, won, cause, lune, nuit, nightsWon, shots, nights:[{lune, nuit, quota, won, shots, fill (jauge, avant l'évaporation du trop-plein), area (part surfacique), total}], light:{L:{sum, shots}}, reactions, mergeSizes (8 = Big Bang), bigBang(s), goldEarned, goldSpent, goldEnd, relics, relicsEver, kills, stones, maxSize, simTime, estTime, steps, wallMs, error}`. `estTime` (s réelles estimées) = résolution simulée ÷ accélération auto (`Run.autoSpeed`, §5.8) + décompte complet + visée 3,5 s/tir + intro 2,2 s + Aube 15 s + fin de nuit 2,6 s + Vidange 1,5 s.
- `Debug.summarize(recs, opts)` (fusionnable : `balance.js` agrège plusieurs pages) → réussite par nuit, Lune 1/3 franchies, victoire, tirs par nuit gagnée, part des Débordements, remplissage de fin de Nuit du Boss, or gagné/dépensé, durée d'un run gagné, Big Bang, Lumière/tir par Lune, réactions, tailles de fusion, reliques des runs gagnés (> 60 % → « build dominant ? ») et `targets` (§13.3, ✓/✗). `Debug.report(S)` (texte à largeur fixe), `Debug.csv(recs)` (« ; »), `Debug.copyCSV()`, `Debug.last / lastReport / lastCSV`.
- Vitesse mesurée (Chromium headless) : `random` ≈ 0,1 s/run, `greedy`/`safe` ≈ 3 s/run (≈ ×230 le temps réel estimé) ; résultats identiques en synchrone et asynchrone.

### 15.4 Tests unitaires (`BE.Debug.tests(filtre?)`, GDD §13.2)
Renvoie `{passed, failed, total, ms, results:[{group, name, ok, msg, ms}]}` ; `Debug.testReport()` ; registre `Debug.tests.list`. 56 tests en ≈ 6 s, tous dans le bac à sable (la partie en cours n'est pas touchée ; le test de sauvegarde écrit la vraie clé `bde.v1.run` puis la restaure). Groupes : **Score** (13 cas fixes : base, +Mult/×Mult et ordre inverse, Catalyseur ×2,25, Big Bang, Insomniaque, Éclipse ÷2, Aurore, ordre des finaux, reliques avant finaux, arrondi, relique muette, pureté de `compute`) · **Fusion** (table §5.2, ×1,5 au 0,5 sup., Forgeronne ×2, Alchimiste, fusion réelle pure / Vapeur) · **Évolutions** (3 réactions + Laboratoire, même emplacement, sans Laboratoire, à l'entrée de l'Aube) · **Économie** (intérêts avant récompense, tirs d'apprentissage de la Lune 1 sans or, plafonds 5/8/3/0, vente ⌊prix/2⌋ min 1, relance +1 et verrou) · **RNG** (1 000 tirages par flux, indépendance, relance sans effet sur `waves` ; jamais de doublon dans la file visible de la pioche, Astronome, 30 graines) · **Sauvegarde** (aller-retour `saveRun`/`loadRun` en comparaison profonde ; reprise `PENDING_SHOT` = même empreinte que le tir d'origine, sur 8 graines × 6 tirs ; un état en cours de tir n'est jamais écrit hors de `Run.fire` ; pas de tir sans tir restant ; abandon refusé en NIGHT_WON ; reprise d'une sauvegarde v1.0 → murs, rayons et entonnoir courants, pas de Débordement hérité) · **Physique** (40 étoiles → repos < 6 s dans ≥ 99 % de 100 essais, aucun corps hors des murs ; 10 000 lancers à 900 px/s sans traversée de clou ni d'Ombre — un effleurement < 2 px entre deux pas n'est pas une traversée ; −1 corps par fusion ; 100 tirs identiques → 1 empreinte) · **Débordement** (au repos seulement ; Bougie = exactement les corps qui dépassent, puis Débordement ; nuit gagnée bocal débordant → trop-plein évaporé sans Bougie ; Vidange partielle Nova sous Géante → rien au-dessus de l'horizon ; Trou Noir seul à l'Éclipse 4 + Verre soufflé → sous la ligne, de même que Trou Noir + Astre et Nova + Géante côte à côte (viabilité des archétypes) ; jauge = max(surface, hauteur) et Verre soufflé dans `Score.effective`) · **Ombres** (descente bloquée, Nuée, Voleuse, armure de la Blindée vs éclair/Brûlure, Éteignoir 4 clous, gel) · **Nuit Blanche** (victoire + Planétarium → Vidange → Lune 6 sans 2e RUN_WON, Fragments au-delà de la Lune 5 seulement ; refusée en Ciel du Jour / sans Planétarium) · **Bots** (bac à sable étanche : aucun événement, état et localStorage intacts ; greedy ≥ moyenne des angles fixes). **Ajouter un test** : `test("Groupe", "nom", () => { … eq(a, b, "msg"); assert(c); })` dans `15_debug.js`.

### 15.5 Outils Node
- `NODE_PATH=$(npm root -g) node tools/test.js [--filter txt] [--runs 4] [--policy greedy] [--no-sim] [--verbose]` : ouvre `index.html#debug` (file://), lance les tests puis une courte simulation ; échoue sur un test rouge, un run en erreur, une fin de run inattendue, une erreur console/page ou un état réel modifié.
- `NODE_PATH=$(npm root -g) node tools/balance.js [--runs 100] [--policy greedy] [--gardien veilleuse] [--eclipse 0] [--shop default] [--seed BAL] [--workers 4] [--all] [--rooms a,b] [--csv f.csv] [--json f.json]` : répartit les runs sur N contextes Chromium (graines identiques quel que soit N), affiche le tableau §13.3 + le détail par nuit. Code ≠ 0 seulement si un run plante (les cibles ne font pas échouer l'outil).

## 16. Intégration (état de bout en bout)

### 16.1 Branchements et corrections transverses
- **API** : toutes les références `BE.<Module>.<membre>` du code existent à l'exécution (vérifié par balayage du source contre la page chargée ; seules `Debug.lastReport/lastCSV` naissent après une simulation). Les six crochets `BE.Shop.View.*` de `13_ui`, les crochets `BE.Meta.*` et `Meta.drawJarTheme` de `11_render` sont en place.
- **Bulles d'onboarding** (`13_ui`) : une seule source — les écouteurs de `13_ui` (`merge`, `shadowMove`, `count:start`) ; les doublons qui écrivaient `state.ui.bubble` depuis la simulation (`09_run` : fin de décompte, DESCENT) sont retirés (la simulation n'écrit plus dans l'UI). Une bulle arrivée pendant qu'une autre est encore lisible attend son tour (`state.ui.bubbleNext`) ; hors des scènes de jeu (fin de nuit, Vidange, défaite…) la bulle est retirée, et si elle n'a pas été lisible 1,5 s son drapeau `tuto*` est remis à faux pour qu'elle revienne plus tard.
- **Toasts** : en jeu et à l'Aube au-dessus du bocal (y = 540) ; en fin de run juste au-dessus des boutons (y = 494) ; dans les autres menus en haut (y = 36, ou 90 sous une carte de notification : `Meta.notifying()`), pour ne jamais couvrir « Lancer » / « Rejouer ». Un toast de plus de 0,3 s est effacé au changement de scène.
- **Grimoire** : le raccourci « Défis » (Observatoire) ouvre l'onglet Défis sans que le Grimoire (titre ou pause) rouvre ensuite sur cet onglet.
- **Rendu** : l'anneau de PV du boss passe sous les badges (le badge PV restait coupé) ; la gravure de l'étoile courante s'affiche à gauche du Phare (elle chevauchait les pips de tirs) ; la frise des Lunes se resserre au-delà de 5 Lunes.
- **Mise en page** : réglages à hauteur adaptée à l'onglet (animée) ; Sac de la pause sans vide en bas ; fin de run à mise en page adaptative (Fragments + défis ne passent jamais sous les boutons : interligne resserré puis « (+N) ») ; sous-titres longs des salles de l'Observatoire sur deux lignes (ils tombaient à 6 px) ; sous-titre de la Constellation ajusté à la largeur ; « NOUVELLES OMBRES » au pluriel ; « même Gardien / Gardienne » selon le personnage ; tutoiement partout (« Touche pour allumer »).
- **Son / juice** : rouleaux de la Constellation sur le son `reel` (clics) ; `shop:purge` → `evaporate` ; `nuitBlanche` → carillon + bannière « NUIT BLANCHE ». Les cartes d'offre achetées gardent l'icône du clou / de la gravure sous le tampon.

### 16.2 Parcours vérifié (`tools/smoke.js`)
Le test de fumée joue un run complet par l'interface tactile (voir §9) et capture chaque écran : titre, réglages ×3, Observatoire (avant / fiche / après construction), Grimoire (4 onglets), Défis, Ciel du Jour, sélection (libre / verrouillée / Éclipse), intro de nuit (Lune 1, boss, Lune 2 avec « Nouvelles Ombres », Lune 6), visée, vol, décompte, pause + Sac + Reliques + Réglages + Grimoire, nuit gagnée, Vidange, Aube (fiche, sélecteur de clou, relance, verrou, Constellation fermée / rouleaux / choix, Sac + Épurer, glisser-déposer, fiche de relique), victoire, fins de run (victoire, Nuit Blanche, abandon, Ciel du Jour). Vérifications : achat débité, relance payée, Épurer retire 1 étoile, ordre des reliques changé, tir en attente rejoué (même `shotIndex`), Aube reprise à l'identique après rechargement, Lune 3 atteinte en jeu réel, victoire, texte de partage, Lune 6 atteinte en Nuit Blanche, Ciel du Jour marqué joué. Un contrôle desktop (1280 × 800, souris) a été fait à part (titre, visée, Aube).

### 16.3 Équilibrage (état mesuré après réglage)
**Référence choisie : méta neuve** (contenu de départ, défaut de `tools/balance.js`), Veilleuse, Éclipse 0, bot greedy (avec
échanges) et boutique `default` étendue. Avec tout débloqué (`--all`), le joueur est nettement plus fort (reliques ×Mult
de la Crypte) : les Lunes 1–3 y sont faciles — c'est voulu, la méta doit se sentir.

Leviers changés (un à la fois, `tools/balance.js` relancé à chaque fois) :
1. **Quotas** `DATA.QUOTA_BASE = [0, 120, 700, 1300, 2700, 3000]` (GDD §6.1 : 80, 260, 850, 2 800, 9 000). La courbe de puissance
   réelle ne suit pas ×3,2 par Lune (Lumière / tir ≈ 145 · 434 · 576 · 944 · 1 020), d'où une marche L4 → L5 plate : le boss final
   L'Éclipse (Mult ÷2, 200 PV) rend déjà la Nuit du Boss de la Lune 5 deux fois plus dure. Lune 1 à 120 (compromis
   d'accueil) : le bot `random` gagne encore 76 % des Nuits Minces L1 (400 runs). Nuit Blanche rebasée sur `QUOTA_BASE[5] × 3,5^(L−5)`.
2. **Reliques dominantes** : Diapason plafonné (+1 Mult par tranche de **6** clous, **max +4**), Le Comptable plafonné (**max +8**)
   et passé **Rare** ; Insomniaque : Mult final **×1,5** (son inconvénient, le bocal jamais vidé, ne joue pas tant que le bocal
   reste peu rempli).
3. **PV des boss** : `30 × HPmult` seulement (§6.4) — Corbeau et Éclipse ≥ 2 ne s'appliquent qu'aux Ombres.
4. **Rythme** (sans effet sur l'issue, la simulation est déterministe) : accélération auto ×2 dès 3,5 s et ×3 dès 5,5 s
   (`PHYS.speed`), estimation humaine de l'Aube 15 s.

Mesure avant l'amendement du bocal (`--runs 500`) : Lune 1 100 % · Lune 3 67,4 % · victoire 19,0 % · tirs 3,32 · or 120,7 ·
Big Bang 0 % · durée 14,6 min ✗ ; remplissage de fin de Nuit du Boss ≈ 11 % et 0 % de Débordements (cibles alors marquées N/A :
une Lune n'apportait que 10–14 étoiles dans un bocal de 77 408 px², qui déborde vers 51–62 % de sa surface).

**Amendement v1.1 « Bocal étroit »** (GDD §2.2, §4, §5.2, §5.3, §5.8, §6.1, §6.6, §13.3). Trois pistes ont été explorées en
parallèle : *géométrie* (bocal étroit, 9/9 à 500 runs), *apport* (Averse de Pierres sur la Nuit du Boss, Pierres fêlées :
9/9 à 200 runs mais Nuits Minces vides, beaucoup de nouvelles règles) et *persistance* (Vidange partielle pour tous : cible
de remplissage à amender vers 25–35 %, tension seulement en Lunes 4–5). Retenue : la géométrie, qui atteint la cible
de remplissage avec le moins de règles nouvelles — **sur une échelle redéfinie** (point 6 : Σ aires / capacité, soit ≈ 1,67 × l'ancienne mesure brute) ; la Vidange partielle de la piste *persistance* est reprise pour L'Insomniaque.
Leviers, un à la fois (200 runs chacun, puis 500) :
5. **Bocal plus étroit que le ciel + rayons du bocal** : murs du bocal 80/280 (entonnoir depuis 16/344, y 330 → 385), horizon
   460 puis **452** (200 × 164 = 32 800 px²) ; rayons au bocal 20/25/31/38/46/55/66 (courbe ×1,2 par taille ; le vol garde
   14…62, le treillis reste traversable). Remplissage brut ≈ 34 % de la surface, 36 % de Débordements, victoire 9 %.
6. **Remplissage = Σ aires / capacité** (surface utile × 0,6, compacité mesurée : médiane du remplissage brut au Débordement
   ≈ 0,61) : la jauge atteint ≈ 100 % au Débordement. Aucun effet sur la simulation sauf Balance / Équilibre (seuils 40 / 50 %
   désormais significatifs) et le défi D02.
7. **Quotas** redistribués (`QUOTA_BASE = [0, 200, 900, 1300, 2450, 2500]`) : plus de tirs en Lunes 1–2 (le bocal s'y remplit),
   un peu moins en Lunes 4–5 (le Débordement y fait déjà le tri).
8. **Rythme** (sans effet sur l'issue) : accélération auto ×2 dès **2 s** et ×3 dès **3,5 s**.
9. **Accueil : tirs d'apprentissage** (`ECO.lune1Grace` = 2). Avec le quota L1 à 200, le bot `random` ne passait plus la Lune 1
   que dans **36 %** des runs (v1.0 : 63 %, 400 runs). +2 tirs par nuit en Lune 1, sans or s'ils restent inutilisés : le bot
   greedy finit ses nuits de Lune 1 en ≤ 6 tirs, ses mesures ne bougent pas (une défaite L1 sur 500 sauvée) ; `random` → **69 %**.
10. **Gardiens** (200 runs chacun, greedy). Avec le bocal étroit, L'Insomniaque (bocal jamais vidé) tombait de 47,5 % de
    victoires (v1.0, inconvénient inopérant) à **4,5 %** (93 % de Débordements) ; retirer ses Pierres de départ : 3,5 % ; Bougie
    rallumée à chaque Lune : 7,5 % ; + Vidange partielle (taille < 3 part) : 8 % ; taille < 5 part : 34,5 % (trivial) ;
    **taille < 4 part + Bougie rallumée : 16 %** (retenu, `rules.keepJarMin` 4, `rules.candleRelit`). La Forgeronne (pas de
    fusion mixte : les étoiles de couleurs différentes encombrent le bocal) tombait de 11 % à 6,5 % ; Mult pur ×2,5 : 6,5 % ;
    **2 Bougies : 9 %** (retenu, `rules.candle` 2). Cible Big Bang de l'Insomniaque (10–20 %) suspendue et marquée N/A (raison
    corrigée en v1.1b, point 13).

Mesure finale (`--runs 500 --policy greedy`, Veilleuse) : Lune 1 **100 %** ✓ · Lune 3 **63,0 %** ✓ · victoire **21,8 %** ✓ ·
tirs par nuit gagnée **3,38** ✓ · Débordements **24,6 %** des défaites ✓ · remplissage fin de Nuit du Boss **58,7 %** ✓ (brut :
35 % de la surface ; L1 43 % → L2 55 % → L3 61 % → L4 77 % → L5 83 %) · or dépensé **118,9** ✓ · durée d'un run gagné
**13,5 min** ✓ · Big Bang **0 %** ✓ → **9/9**. Débordements par Lune : L2 3 · L3 18 · L4 47 · L5 28 (sur 500).

Gardiens (200 runs, greedy, méta neuve ; victoire · Lune 3 · Débordements / défaites · remplissage Boss) :

| Gardien | Victoire | Lune 3 | Débordements | Remplissage Boss |
|---|---|---|---|---|
| La Veilleuse (500 runs) | 21,8 % | 63,0 % | 24,6 % | 58,7 % |
| L'Astronome | 14,0 % | 59,0 % | 27,9 % | 57,0 % |
| La Glaneuse | 20,0 % | 66,5 % | 31,9 % | 59,0 % |
| La Forgeronne | 9,0 % | 51,5 % | 32,4 % | 70,5 % |
| L'Insomniaque | 16,0 % | 83,0 % | 74,4 % | 60,9 % |

Bot `random` (400 runs, Veilleuse) : Lune 1 réussie dans **69,3 %** des runs (cible d'accueil ≥ 60 %).

Reste à surveiller : avec la boutique `default`, Diapason et Chasseur apparaissent dans ~70 % des runs gagnés — surtout
parce qu'avec la méta neuve le pool ne compte que 12 Communes (5 emplacements) ; le bot `--shop random` (détection du §13.3)
ne gagne que 2 % de ses runs en méta neuve (il n'achète que des reliques), trop peu pour conclure. Les bots utilisent
désormais les échanges (`Debug.swapChoice`, jusqu'aux 3 étoiles visibles de l'Astronome) ; les Gardiens autres que la
Veilleuse sont re-mesurés au point 10 ci-dessus.
