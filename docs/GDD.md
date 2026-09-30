# BOCAL D'ÉTOILES — Document de design final (GDD v1.1b)

> Seul document de référence du projet. Tout ce qui n'y figure pas n'est pas dans la v1. Les valeurs chiffrées sont des valeurs de départ, à ajuster uniquement dans `data.js`.

> **Journal des amendements — v1.1 « Bocal étroit »** (la tension Suika manquait : bocal rempli à ≈ 11 % en fin de Nuit du Boss, aucun Débordement).
> - **Bocal plus étroit que le ciel, avec entonnoir** (§4, §5.3) : bocal de 200 × 164 px sous l'horizon (murs x = 80 / 280, horizon y = 452), épaules de verre de (16, 330) → (80, 385). L'Étau : 96 / 264.
> - **Deux rayons par taille** (§5.2) : le rayon en vol reste 14…62 (treillis inchangé) ; au bocal, 20 / 25 / 31 / 38 / 46 / 55 / 66 (courbe aplatie, chaque fusion libère 20–30 % de place).
> - **Remplissage = Σ aires / capacité** (capacité = surface utile × 0,6), jauge verticale à côté du bocal : 100 % ≈ Débordement (§4, §13.3).
> - **Quotas redistribués** vers les Lunes 1–2 (§6.1) et **accélération automatique** plus précoce, ×2 dès 2 s et ×3 dès 3,5 s (§5.8).
> - **Tirs d'apprentissage** : +2 tirs par nuit en Lune 1, sans or s'ils restent inutilisés (§2.2, §7.3), pour garder l'accueil aussi doux qu'en v1.0 malgré des quotas de Lune 1 plus hauts.
> - **Gardiens** (§6.6) : L'Insomniaque ne perd à la Vidange que ses étoiles de taille < 4 et rallume sa Bougie à chaque Lune ; La Forgeronne a 2 Bougies. Cible Big Bang de l'Insomniaque suspendue (§13.3).
> - Mesure (500 runs greedy) : 9/9 cibles §13.3, remplissage fin de Nuit du Boss ≈ 59 % (v1.1), Débordement ≈ 25 % des défaites (détail : `docs/ARCHITECTURE.md` §16.3).
>
> **v1.1b — lisibilité de la tension et cas limites** (revue de jeu de la v1.1) :
> - **Jauge = max(Σ aires / capacité, hauteur du tas)** (§4) : elle ne contredit plus la ligne ; capacité calculée sous l'horizon **courant** (Verre soufflé, Éclipse 4). **Alerte à deux niveaux** : ambre quand l'étoile tenue, posée sur le tas, dépasserait la ligne ; rouge (< 16 px) inchangé.
> - **Rayons au bocal** Nova 50 / Trou Noir 58 (au lieu de 55 / 66, §5.2) : le Trou Noir redevient atteignable ; horizon jamais sous y = 492 (§4).
> - **« Le quota éteint le trop-plein »** (§2 étape 7) : une nuit gagnée bocal débordant évapore ce qui dépasse, sans Bougie ; la Vidange partielle de L'Insomniaque fait de même. Une nuit ne commence jamais en Débordement.
> - L'Insomniaque : or de Vidange seulement pour les étoiles qui partent ; Mult final ×1,3 (§6.6). Balance / Équilibre / D02 recalés sur la nouvelle jauge (§8.1, §9.3). Lune 2 : quota 900 → 800, reporté sur les Lunes 4–5 (§6.1). Sauvegarde `v:2`, runs `v:1` migrés (§9.7). Tirs d'apprentissage annoncés (intro, Aube, Lune 2).
> - Mesure finale (500 runs greedy) : 9/9 ; remplissage fin de Nuit du Boss **65,8 %** (Nuits du Boss gagnées seules 62,7 % ; 34,8 % de la surface brute), Débordement **25,9 %** des défaites, victoire 18,0 %, durée d'un run gagné 13,5 min.

---

## 0. Choix du concept et greffes

### 0.1 Classement agrégé (3 juges × 6 critères)

| Concept | Juge 1 | Juge 2 | Juge 3 | **Total** |
|---|---|---|---|---|
| **BOCAL D'ÉTOILES** | 47 | 53 | 50 | **150** |
| MISE À MORT | 48 | 47 | 49 | 144 |
| RICOCHIMIE | 46 | 47 | 49 | 142 |
| Serre Lunaire | 42 | 43 | 45 | 130 |

On retient **BOCAL D'ÉTOILES**. C'est le concept le plus original (9/9/9), celui qui couvre le mieux les piliers (7/10/10) et le meilleur « fun en 30 s » (8/10/9). Les juges lui font deux reproches : trop de systèmes à la fois, et une physique Suika risquée. Ce document y répond ainsi :

- **Réduction du périmètre.** La 5e famille (Néant), le Funambule (gravité inversée), le Somnambule et les Étiquettes sont retirés. Le premier run n'utilise que 3 couleurs et 12 reliques.
- **Tour par tour strict.** La physique se résout jusqu'au repos. Il n'y a jamais de simulation pendant la visée. Le débordement est vérifié **au repos seulement**, de façon déterministe.
- **Un run plus court.** 5 Lunes au lieu de 6, 6 tirs maximum par nuit, et la nuit s'arrête dès que le quota est atteint.

### 0.2 Greffes intégrées

| Greffe | Source | Où elle se trouve dans ce GDD |
|---|---|---|
| Quota atteint = fin de nuit, or pour les tirs restants | MISE À MORT | §2.2, §8.4 |
| Gel de 0,5 s, puis « ka-ching » de fin de nuit | MISE À MORT | §11.4 |
| Gardiens à compromis fort (L'Insomniaque) | MISE À MORT (La Veuve) | §6.6 |
| Partage : une ligne par Lune, plus l'équation du meilleur tir | MISE À MORT / RICOCHIMIE | §9.5 |
| Maintenir pour accélérer ×3, accélération auto, lâcher forcé | RICOCHIMIE | §3.1, §5.8 |
| Une mécanique nouvelle par Lune, sans tutoriel écrit | RICOCHIMIE (Railbound) | §6.3, §10.9 |
| Rangée fantôme de la prochaine apparition | RICOCHIMIE (Thronefall) | §5.4 |
| Ombres Blindées et Éteignoirs contre les builds dominants | RICOCHIMIE | §6.3 |
| Chiffres de dégâts agrégés (250 ms) | RICOCHIMIE | §11.3 |
| Mode debug qui simule des tirs (bots) | RICOCHIMIE | §13 |
| Journal d'événements pur, puis décompte rejoué | Serre Lunaire | §7, §12.5 |
| Jauge de quota avec projection en direct | Serre Lunaire | §10.3 |
| Indices poétiques dans le Grimoire | Serre Lunaire | §9.4 |
| Hauteur du son qui baisse avec la taille, Big Bang (flash, silence, accord) | BOCAL (conservés) | §11.5 |
| Ennemi Lanterne (+1 tir), échange Suivante | BOCAL (conservés) | §6.3, §3.1 |
| Reprise d'un tir interrompu rejouée avec le même angle (anti-save-scum) | Nouveau | §12.6 |

---

## 1. Identité

**Nom :** BOCAL D'ÉTOILES

**Pitch (une phrase) :** Lance des étoiles à travers un firmament hanté d'Ombres comme dans Peglin, regarde-les tomber et fusionner dans un bocal comme dans Suika, et fais exploser un score Éclat × Mult digne de Balatro avant que le bocal ne déborde.

**Règle mnémotechnique affichée au premier run :** *« Le haut remplit le bleu, le bas remplit le rouge. »* L'Éclat (bleu) vient des rebonds dans le Firmament. Le Mult (rouge) vient des fusions dans le Bocal.

**Format :** portrait, jeu web hors ligne en HTML, canvas 2D et JS vanilla. Runs de 10 à 14 min. Modèle visé : premium sans publicité ni achat intégré, et la version web est complète.

### 1.1 Piliers hérités

| Jeu source | Qualité ou mécanique reprise | Application dans Bocal d'Étoiles |
|---|---|---|
| **Suika Game** | Fusion physique, la taille donne la valeur, étoile suivante visible, ligne de débordement | 7 tailles d'étoiles. Deux étoiles de même taille fusionnent en une étoile de taille +1 et rapportent du Mult. La ligne d'horizon est la seule menace de fond. |
| **Peglin** | Tir visé à travers des clous, aperçu de trajectoire, sac d'orbes, notes qui montent | Le Phare vise à travers 20 clous. Chaque touche joue une note pentatonique plus aiguë. Le Sac d'étoiles se construit comme un deck. |
| **Balatro** | Score base × mult (bleu/rouge), antes de 3 blinds dont un boss, 5 jokers ordonnés, intérêts, relance, verrouillage, stakes, seeds | Éclat × Mult. 5 Lunes de 3 nuits (Mince, Pleine, Boss). 5 reliques déclenchées de gauche à droite. Intérêts de 1 pour 5, plafonnés à 5. Éclipses 1 à 8. Ciel du Jour. |
| **Vampire Survivors** | Auto-attaque, évolutions cachées (objet + condition), coffres-roulette, grille de succès | Les étoiles Foudre du bocal tirent seules. 6 évolutions (relique + réaction). Paquet Constellation à rouleaux. 16 défis qui débloquent des objets précis. |
| **BALL x PIT** | Lance-pierre en portrait contre des ennemis qui descendent, base entre les runs | Les Ombres descendent vers le bocal. L'Observatoire se construit pièce par pièce. |
| **Puyo Puyo / Tetris** | Déchets qui encombrent | Une Ombre qui atteint le bocal devient une Pierre Noire, qui ne fusionne pas et qu'on ne peut briser que par une fusion adjacente. |
| **Luck be a Landlord** | Adjacence, loyer croissant | 6 emplacements de clous spéciaux, et deux clous identiques adjacents ont un effet doublé. Quota croissant ×3,2 par Lune. |
| **Slay the Spire / Wildfrost / Into the Breach** | Intentions visibles, hasard au tirage et résolution déterministe | Chaque Ombre affiche ses PV et son compteur de descente. La prochaine apparition est montrée. La physique est déterministe. |
| **Brotato / Balatro (decks)** | Personnages qui changent les règles | 5 Gardiens, chacun avec une règle modifiée et un compromis. |
| **Hades / Wildfrost / Loop Hero** | L'échec fait progresser, base « cozy » | Des Fragments sont gagnés à chaque run. On allume les salles de l'Observatoire et la prochaine est toujours affichée. |
| **Railbound** | Une mécanique introduite par monde | Chaque Lune introduit un nouveau type d'Ombre. |
| **Thronefall** | Vague suivante annoncée | Rangée fantôme au-dessus du Firmament. |
| **Wordle** | Rituel du jour et grille d'emojis sans spoiler | Ciel du Jour avec une seed commune et le partage d'une ligne par Lune. |
| **Poinpy** | Un seul geste plein écran, sans bouton virtuel | On pose le doigt, on vise, on relâche. Aucun bouton pendant le jeu. |
| **Townscaper / Unpacking** | Son propre à chaque matière | Plop de verre, pop de fusion dont la hauteur dépend de la taille, bois pour les murs, fumée pour les Ombres. |
| **20 Minutes Till Dawn** | Identité forte et peu coûteuse | Fond nuit presque noir, 4 couleurs saturées, rendu 100 % vectoriel. |

### 1.2 Vérification des 12 piliers du brief

1. **Un geste, beaucoup de choix :** viser et relâcher. La profondeur vient du Sac, des clous, des reliques et de leur ordre.
2. **Familier avec un twist :** « Suika + Peggle, mais roguelike façon Balatro ».
3. **Nombres qui explosent :** Éclat × Mult, Pression, Catalyseur, Big Bang ×10.
4. **Juice :** notes qui montent, pop, hitstop, décompte en rubans.
5. **Lisibilité :** PV et compteurs toujours dessinés au-dessus de tout, taille = valeur, code bleu/rouge fixe.
6. **Session :** 10 à 14 min, point d'arrêt toutes les 1 à 2 min (l'Aube), sauvegarde à chaque état stable.
7. **L'échec fait progresser :** Fragments et prochaine salle affichée.
8. **Synergies à découvrir :** 6 réactions, 6 évolutions, 1 secret (Aurore), Grimoire avec indices.
9. **Rareté :** 5 reliques, 6 clous, Sac de 6 à 20 étoiles, place limitée dans le bocal.
10. **Identité peu coûteuse :** planétarium de poche vectoriel.
11. **Monétisation honnête :** premium, aucune publicité.
12. **Action / calme :** tir et résolution, puis Aube au tour par tour.

---

## 2. Boucles de jeu

### 2.1 Boucle de 30 secondes : un tir (6 à 9 s)

1. **VISÉE** (sans limite de temps, le monde est figé). On pose le doigt. Une ligne pointillée part du Phare jusqu'au premier contact, et un fantôme montre la taille de l'étoile.
2. **VOL** (2 à 4 s). L'étoile rebondit dans le Firmament. Chaque clou donne **+1 Éclat** avec une note plus aiguë. Chaque Ombre touchée prend des dégâts égaux à la **taille** de l'étoile et donne **+3 Éclat**.
3. **CHUTE ET FUSIONS** (1 à 3 s). L'étoile entre dans le Bocal. Deux étoiles de même taille fusionnent et rapportent du **Mult**. Les fusions en cascade s'enchaînent.
4. **TOURELLES** (0 à 1,5 s). Chaque étoile Foudre du bocal tire un éclair sur l'Ombre la plus basse.
5. **DÉCOMPTE** (1 à 2,5 s, accélérable). On affiche l'Éclat de base et le Mult de base, puis les reliques de gauche à droite, puis la **Lumière = ⌊Éclat × Mult⌋**, qui s'ajoute au total de la nuit.
6. **DESCENTE** (0,6 s). Les compteurs des Ombres baissent. Celles qui arrivent à 0 descendent d'une rangée, celles de la rangée 5 tombent dans le bocal comme Pierres Noires, et la rangée fantôme apparaît en haut.
7. **VÉRIFICATION.** Si le quota est atteint, la nuit est gagnée : ce qui dépasse alors la ligne d'horizon s'évapore (« le quota éteint le trop-plein », sans Bougie ni or), si bien qu'une nuit ne commence jamais en Débordement. Sinon, si un objet au repos dépasse la ligne d'horizon, c'est le Débordement. Sinon, si les tirs sont épuisés, la nuit est perdue. Sinon, on passe au tir suivant.

### 2.2 Boucle de run (10 à 14 min)

- **5 Lunes × 3 nuits** : Nuit Mince, Nuit Pleine, Nuit du Boss, soit 15 nuits.
- **Au plus 6 tirs par nuit.** La nuit **s'arrête dès que la Lumière cumulée atteint le quota**. Chaque tir non utilisé rapporte +1 or.
- **Tirs d'apprentissage (Lune 1, v1.1)** : chaque nuit de la Lune 1 accorde **+2 tirs** (pastilles bleutées au bout de la rangée, hors Éclipse 5). Ils sont joués en dernier et ne rapportent pas d'or s'ils restent inutilisés : un joueur qui boucle ses nuits en 6 tirs n'y gagne rien, un débutant qui vise au hasard a de quoi finir sa première Lune.
- **Le Bocal reste plein pendant les 3 nuits d'une Lune** (la tension monte, mais le Mult potentiel aussi, et c'est pour cela que la Nuit Mince a le plus petit quota). Il est **vidé** à la fin de la Lune (Vidange ; L'Insomniaque ne perd que ses petites étoiles, §6.6).
- **Aube** (boutique) après chaque nuit gagnée : reliques, étoiles, clous, gravures, paquet Constellation, relance, verrouillage, vente, épuration du Sac.
- **La règle du boss** de la Lune est annoncée dès l'Aube qui précède la Nuit du Boss, et aussi sur la carte d'introduction de la Lune.
- **Défaite :** fin de nuit sous le quota, ou Débordement sans Bougie de secours.
- **Victoire :** Boss de la Lune 5 (L'Éclipse) passé. On peut ensuite continuer en **Nuit Blanche** (Lunes infinies) si le Planétarium est construit.

### 2.3 Boucle méta

À la fin d'un run, gagné ou perdu, on reçoit des **Fragments ◇**. On les dépense pour allumer une salle de l'**Observatoire**, qui élargit le pool de contenu. Les **défis** réussis débloquent des objets et des Gardiens précis. On remonte l'échelle des **Éclipses** avec chaque Gardien. Le **Ciel du Jour** propose une seed commune et un partage. L'écran de fin et l'écran titre affichent toujours : « Encore N ◇ : [Salle] ».

---

## 3. Contrôles

### 3.1 Tactile (portrait, un pouce)

| Contexte | Geste | Effet |
|---|---|---|
| Visée (mode **Absolu**, par défaut) | Poser le doigt n'importe où, puis glisser | Angle = direction du Phare (180, 62) vers le doigt, limité à **[12°, 168°]** (0° = droite, angles croissants vers le bas). La ligne d'aperçu suit le doigt. |
| Visée (mode **Relatif**, réglage) | Glisser horizontalement | Angle += Δx × 0,35 °/px, en partant du dernier angle utilisé. Pour la précision. |
| Tirer | Relâcher | Tir si l'appui a duré **≥ 150 ms OU** si le doigt s'est déplacé de **≥ 12 px**. Sinon, c'est un tap (voir plus bas), jamais un tir. |
| Annuler un tir | Ramener le doigt dans la bande **y < 44** (le HUD s'affiche « ✕ ANNULÉ » en rouge), puis relâcher | Aucun tir. Même chose sur `pointercancel`. |
| Échanger l'étoile courante et la suivante | Tap sur l'aperçu « SUIV. » (cible 48×48 centrée en (300, 62)) | 1 échange par nuit (Échangeur +2, Astronome 2). Impossible sous « Le Voile ». |
| Voir le Sac | Tap sur l'icône Sac (cible 48×48 centrée en (60, 62)) | Ouvre le panneau Sac (lecture seule en jeu). |
| Voir les reliques | Tap dans la bande basse (y ≥ 618) | Ouvre le panneau Reliques (fiches). |
| Pause | Tap sur l'icône ⏸ (cible 48×48 en haut à droite, zone x ≥ 312, y < 44) | Menu pause. Pause automatique sur `visibilitychange` (masqué) et `blur`. |
| Pendant la résolution | Garder le doigt appuyé n'importe où | Simulation ×3 (voir §5.8). |
| Pendant le décompte | Maintenir / tap | Maintenir : ×4. Tap : saut direct au total. |
| Menus et boutique | Tap sur une carte | Premier tap : la fiche détaillée s'ouvre en bas (hauteur 200). Deuxième tap sur « Acheter / Vendre / Confirmer » (bouton 56 px de haut). **Aucun survol.** |
| Reliques (Aube) | Glisser-déposer horizontal | Réordonnancement sur 5 emplacements, avec aimantation au centre du plus proche. |
| Clous (Aube) | Tap sur un clou acheté, puis tap sur un emplacement de la mini-carte | Pose. Un emplacement occupé demande une confirmation (l'ancien clou est vendu à 50 %). |

Toutes les cibles tactiles font **au moins 48×48 px logiques**. Les boutons de validation font 56 px de haut.

### 3.2 Souris et clavier (desktop)

| Entrée | Effet |
|---|---|
| Souris : bouton gauche maintenu | Visée (absolue vers le curseur). Relâcher pour tirer. |
| Clic droit ou Échap pendant la visée | Annuler |
| ← / → | Angle ±60 °/s (Maj : ±15 °/s) |
| Espace / Entrée | Tirer (clavier), valider (menus) |
| Tab ou S | Échanger |
| F (maintenu) | Accélérer ×3 la résolution et ×4 le décompte |
| Échap | Pause, ou retour dans les menus |
| Boutique : flèches | Déplacer le focus entre les cartes |
| Boutique : Entrée | Ouvrir la fiche puis confirmer |
| Boutique : R / L / Espace | Relancer, verrouiller, passer à la nuit suivante |
| Boutique : Q / E | Déplacer la relique sélectionnée vers la gauche ou la droite |

Le focus clavier est dessiné par un contour de 2 px `#eef2ff`.

---

## 4. Écran de jeu : géométrie (espace logique 360 × 640)

```
y=0    ┌──────────────── HUD : Lune·Nuit | jauge quota | or | ⏸ ────────┐
y=44   │ Sac(60,62)        PHARE (180,62)           SUIV.(300,62)       │
y=90   │   rangée fantôme (icônes r=8, alpha .55)                       │
y=97   │ ┌ plafond de vol : y = 44 ─────────────────────────────────┐   │
y=120  │ │ rangée 1 d'Ombres  (centres y=120)                        │   │
y=143  │ │   clous r0                                                │   │
y=166  │ │ rangée 2                                                  │   │
y=189  │ │   clous r1                                                │   │
y=212  │ │ rangée 3                                                  │   │
y=235  │ │   clous r2                                                │   │
y=258  │ │ rangée 4                                                  │   │
y=281  │ │   clous r3                                                │   │
y=304  │ │ rangée 5 (dernière)                                       │   │
y=330  │ │╲  épaules de l'entonnoir (x=16 → 80 · x=344 → 280)       ╱│   │
y=340  │ │ ╲ — seuil vol → bocal (dans le col seulement) —        ╱ │   │
y=352  │ │  ╲  compteur live  ✦ 24 × 3,5  (bleu × rouge)         ╱  │   │
y=385  │ │   └─┐ col du bocal : murs x = 80 et x = 280     ┌─────┘   │   │
y=452  │ │     ├─ ─ LIGNE D'HORIZON (pointillés) ─ ─ ─ ─ ┤  jauge  │   │
       │ │     │              BOCAL (200 × 164)           │   %     │   │
y=616  │ │     └──────────── fond du bocal ───────────────┘         │   │
y=618  │ bande reliques : 5 icônes 22 px, centres x = 84,132,180,228,276 │
y=640  └────────────────────────────────────────────────────────────────┘
```

- **Murs latéraux du Firmament** : x = 16 et x = 344 (vol).
- **Bocal plus étroit que le ciel** (amendement « géométrie du bocal ») : murs du bocal x = **80** et x = **280** (200 px). Entre les deux, un **entonnoir** : deux épaules de verre rectilignes de (16, 330) à (80, 385) et de (344, 330) à (280, 385), prolongées par les murs verticaux du bocal. En vol, les épaules sont des murs (restitution **0,3**, conservation tangentielle 0,98, ne comptent pas comme rebonds sur un mur) : une étoile tombée hors du col glisse jusqu'au bocal. Sous « L'Étau », les murs du bocal passent à x = 96 et x = 264 (les épaules suivent).
- **Grille des Ombres :** 6 colonnes, centres x = **45, 99, 153, 207, 261, 315** (pas de 54). 5 rangées, centres y = **120, 166, 212, 258, 304** (pas de 46). Rayon d'une Ombre : **18**.
- **Treillis de clous :** coins entre les cellules, x = **72, 126, 180, 234, 288** (colonnes c0 à c4) et y = **143, 189, 235, 281** (rangées r0 à r3), soit 20 positions. Rayon d'un clou : **5**. La distance entre un centre d'Ombre et un coin est de 35,5 : il n'y a jamais de chevauchement.
- **Emplacements de clous spéciaux** (6, fixes, en losange) : A(r0,c1), B(r0,c3), C(r1,c2), D(r2,c1), E(r2,c3), F(r3,c2). Paires adjacentes : A–C, B–C, C–D, C–E, D–F, E–F.
- **Plafond :** y = 44 (restitution 0,85).
- **Ligne d'horizon :** y = 452. Elle vaut 476 avec « Verre soufflé » et 468 à l'Éclipse 4 (les deux se cumulent : 492). Elle ne descend **jamais sous y = 492** (= 616 − Ø 116 d'un Trou Noir − 8 px) : un Trou Noir seul au fond reste toujours sous la ligne.
- **Surface utile du bocal :** 200 × 164 = **32 800 px²**. **Capacité** = surface utile (murs courants, horizon courant) × **0,6** (compacité mesurée d'un tas d'étoiles au repos : le bocal déborde vers 55–65 % de sa surface).
- **Remplissage (jauge)** = **max(Σ aires / capacité, hauteur du tas)**, où hauteur du tas = (fond − haut du plus haut corps posé) / (fond − horizon). Le terme « hauteur » vaut exactement 100 % quand le tas touche la ligne : la jauge ne peut plus afficher 71 % pour un tas de grosses étoiles déjà au ras de l'horizon, ni 77 % pour deux grosses étoiles posées au fond d'un bocal à moitié vide sans que la hauteur le confirme (v1.1b). Une étoile qui tombe encore (> 60 px/s) ne compte pas dans la hauteur. Affichage : jauge verticale à droite du bocal (du fond à l'horizon), animée en douceur ; or ≥ 60 %, rouge ≥ 85 % ou en danger ; pendant la Vidange elle descend vers ce qui reste au bocal. C'est **cette** valeur que lisent Balance, Équilibre et le défi D02.
- **Alerte à deux niveaux (visée) :** **ambre** (ligne et lueur ambrées, jauge au moins or, sans son) dès que l'étoile courante, posée sur le haut du tas, dépasserait la ligne, soit un corps au repos à moins de max(40 px, diamètre au bocal de l'étoile courante) de l'horizon ; **rouge** (ligne rouge qui pulse, verre rosé, battement de cœur, vignette) à moins de 16 px, comme en v1.0.

### 4.1 Dispositions de clous (masques 4 rangées × 5 colonnes, 1 = clou gris)

On en tire une par Lune avec le flux `pegs`, sans répétition.

| Nom | r0 | r1 | r2 | r3 | Nb |
|---|---|---|---|---|---|
| Grille | 11111 | 11111 | 11111 | 11111 | 20 |
| Entonnoir | 11111 | 11111 | 01110 | 01110 | 16 |
| Diamant | 01110 | 11111 | 11111 | 01110 | 16 |
| Colonnes | 10101 | 11111 | 10101 | 11111 | 16 |
| Arche | 11011 | 10001 | 11111 | 11011 | 15 |
| Pluie | 11111 | 01010 | 11111 | 01010 | 14 |

Un emplacement spécial qui contient un clou spécial est toujours présent, quelle que soit la disposition. Un emplacement vide suit la disposition. Les clous recouverts par un boss (voir §6.4) sont désactivés et ne sont pas dessinés tant que le boss les couvre.

---

## 5. Physique (déterministe, pas fixe)

### 5.1 Généralités

- **Pas fixe : dt = 1/120 s.** Intégration Euler semi-implicite (`v += g·dt ; p += v·dt`).
- Nombres flottants en Float64. **Aucun `Math.random` dans la simulation.** Les corps sont parcourus dans l'ordre croissant de leur `id` (entier incrémental).
- Deux régimes : **VOL** (étoile lancée dans le Firmament) et **BOCAL** (corps empilés).

### 5.2 Étoiles : tailles

| Taille | Nom | Rayon en vol (px) | Rayon au bocal (px) | Aire au bocal | Mult gagné en y fusionnant | Emoji (partage) |
|---|---|---|---|---|---|---|
| 1 | Poussière | 14 | 20 | 1 257 | — | ▫️ |
| 2 | Étincelle | 19 | 25 | 1 963 | +1 | ▫️ |
| 3 | Astre | 25 | 31 | 3 019 | +2 | ⭐ |
| 4 | Soleil | 32 | 38 | 4 536 | +3 | 🌟 |
| 5 | Géante | 40 | 46 | 6 648 | +5 | 🟠 |
| 6 | Nova | 50 | 50 | 7 854 | +8 | 💥 |
| 7 | Trou Noir | 58 | 58 | 10 568 | +13 | 🕳️ |
| 7+7 | **Big Bang** | — | — | — | **×10 final** | 🌌 |

- **Deux rayons** (amendement « géométrie du bocal ») : le Firmament est loin, le verre du bocal grossit. En vol, l'étoile garde son petit rayon (le treillis de clous, écart 44 px, reste traversable) ; en entrant dans le bocal elle prend son **rayon au bocal** (animation de 0,16 s). La courbe du bocal est aplatie (×1,2 par taille au lieu de ×1,3) : une fusion libère **20 à 30 %** de place, et les petites étoiles pèsent vraiment dans le bocal. **v1.1b** : le haut de la courbe est encore aplati (Nova 50, Trou Noir 58 au lieu de 55 / 66) ; avec 55 / 66, une Nova et une Géante ou un Trou Noir et un Astre ne tenaient pas côte à côte sous l'horizon, et le Trou Noir n'apparaissait dans aucun des 1 900 runs mesurés (Big Bang, D08, Singularité et l'archétype Tour de Babel devenaient du contenu mort). Désormais Nova + Géante (192 px) et Trou Noir + Astre (178 px) tiennent sur le fond, et un Trou Noir seul reste sous l'horizon le plus bas (§4).

- Taille maximale **lancée** : 5 (au-delà, les bonus de taille sont perdus).
- Dégâts aux Ombres = **taille** (+ modificateurs).
- Masse = r² au bocal (les Pierres Noires ont une masse de r² × 1,5 ; elles prennent aussi le rayon au bocal).

### 5.3 Régime VOL

| Paramètre | Valeur |
|---|---|
| Vitesse de lancer v₀ | 560 px/s (Filante : ×1,35) |
| Gravité de vol | 650 px/s² (La Marée : ×1,3) |
| Vitesse max | 900 px/s (norme bornée après chaque pas) |
| Restitution sur clou | 0,78 (Sève 0,95 ; Lestée 0,35 ; Ressort 1,25) |
| Restitution sur Ombre | 0,70 |
| Restitution sur mur et plafond | 0,85 |
| Conservation tangentielle au contact | 0,98 |
| Vitesse minimale après contact clou/Ombre | 140 px/s (si elle est plus faible, on renormalise dans la direction réfléchie) |
| Délai avant de retoucher le même clou ou la même Ombre | 0,12 s par paire étoile–cible |
| Épaules de l'entonnoir (§4) | restitution 0,3, pas de rebond compté |
| Passage au régime BOCAL | Centre y > 340 **et** étoile entièrement dans le col (80 ≤ x − r, x + r ≤ 280) ; x ramené entre les murs avec le rayon au bocal |

**Collision cercle contre obstacle statique :** `d = |p − c|`. Si `d < r + rc` : `n = (p − c)/d`, `p = c + n·(r + rc + 0,01)`, `vn = v·n`. Si `vn < 0` : `v -= (1 + e)·vn·n`, puis `v_t *= 0,98`. Pas de tunneling : le déplacement maximal par pas est de 900/120 = 7,5 px, bien moins que le diamètre minimal combiné de 2 × (14 + 5) = 38 px.

**Plusieurs étoiles en vol** (Sablier, Prisme) : elles ne se touchent pas entre elles.

**Voleuse :** si une Voleuse survit au coup (PV > 0 après dégâts), l'étoile est **absorbée**. Elle disparaît sans entrer dans le bocal, mais l'Éclat déjà gagné est conservé.

### 5.4 Régime BOCAL

| Paramètre | Valeur |
|---|---|
| Gravité | 980 px/s² (La Marée : ×1,5) |
| Restitution entre corps | 0,10 |
| Restitution sur murs et fond | 0,15 |
| Frottement de Coulomb μ | 0,25 (sur la vitesse tangentielle relative, pas de rotation simulée) |
| Amortissement | v ×= 0,998 à chaque pas |
| Itérations du solveur de vitesse | 6 par pas |
| Correction de position (Baumgarte) | β = 0,6, marge 0,3 px |
| Sommeil | vitesse < 6 px/s pendant 0,4 s. Un contact avec un corps éveillé à plus de 30 px/s réveille le corps. |
| Repos du système | tous les corps endormis, **ou** 6 s écoulées (on met alors toutes les vitesses à 0) |
| Vitesse d'entrée | celle du vol, bornée à 600 px/s |

Broadphase : O(n²), suffisant jusqu'à 60 corps. Le plafond de sécurité est de 60 corps : au-delà, la Poussière la plus haute s'évapore, sans effet de jeu, uniquement comme garde-fou.

### 5.5 Fusion

- **Condition :** deux étoiles (pas des Pierres), de même taille s < 7, avec `dist ≤ r1 + r2 + 1`, toutes deux âgées de ≥ 2 pas depuis leur création, et aucune des deux n'ayant fusionné dans ce pas.
- **Ordre de résolution :** paires triées par (min id, max id), et une seule fusion par corps et par pas.
- **Résultat :** nouvelle étoile de taille s+1 placée au barycentre pondéré par la masse. `v = (v1 + v2)/2 × 0,5`. Elle reçoit un nouvel `id`. Les chevauchements sont résolus par le solveur de position.
- **Couleur :** si les deux étoiles ont la même couleur, la fusion est **pure** (Mult de la fusion ×1,5, arrondi au 0,5 supérieur). Si les couleurs diffèrent, la **réaction** de la paire se déclenche et l'étoile obtenue prend la couleur principale de l'étoile au plus petit `id` (la plus ancienne), avec un anneau bicolore visuel pendant 1 s.
- **Trou Noir + Trou Noir = Big Bang :** tous les corps du bocal (étoiles et Pierres) disparaissent. On ajoute **+Éclat = somme des tailles disparues** et on applique un **×10 final** au tir.
- **Pierre Noire brisée :** à chaque fusion, toute Pierre dont `dist(centre nouvelle étoile, pierre) ≤ r_new + r_pierre + 4` est détruite, ce qui donne **+2 Mult** par Pierre (en plus des reliques).
- **Fusions orphelines :** une fusion qui se produit pendant la DESCENTE (Pierre qui tombe, rétrécissement de L'Étau) produit son Mult dans la **réserve**, ajoutée au Mult de base du tir suivant (affichée « +2 en réserve » en rouge sous le Phare).

### 5.6 Effets de famille (couleur)

| Famille | Couleur | En vol | Dans le bocal (quand elle fusionne ou au repos) |
|---|---|---|---|
| **Braise** | `#ff6b3d` | Une Ombre touchée reçoit **Brûlure** : 1 dégât à la fin de chacun des 3 tirs suivants (les charges s'additionnent) | Fusion impliquant une Braise : **explosion** de rayon r_new + 30. Les Pierres dans le rayon sont brisées, et une impulsion radiale de 250 px/s (dégressive linéairement) s'applique aux corps. |
| **Givre** | `#5ee7ff` | Une Ombre touchée est **gelée** : elle saute sa prochaine descente (icône ❄ sur son compteur) | Fusion impliquant une Givre : **+2 Éclat par étoile Givre** présente dans le bocal |
| **Sève** | `#6ee07a` | Restitution sur clou 0,95. **Grossit de +1 taille au 3e contact avec un clou** (une fois par tir, taille max 5) | Fusion impliquant une Sève : **+1 Mult** supplémentaire |
| **Foudre** | `#ffe14d` | +1 dégât aux Ombres | **Rayonnante :** à la phase TOURELLES, chaque étoile Foudre au repos tire 1 éclair sur l'Ombre la plus basse (rangée la plus haute, puis |x − étoile| minimal, puis id minimal). Dégâts = sa taille. |

La Sève est **verrouillée au départ** (salle La Serre).

### 5.7 Réactions (fusion de deux couleurs différentes)

| Réaction | Paire | Effet (immédiat, au moment de la fusion) | Indice du Grimoire |
|---|---|---|---|
| **Vapeur** | Braise + Givre | +3 Mult. Tous les corps du bocal reçoivent +300 px/s vers le bas (le bocal se tasse). | « Le feu qui embrasse le froid pèse sur toute chose. » |
| **Plasma** | Braise + Foudre | Toutes les Ombres de la colonne du Firmament la plus proche du x de la fusion subissent 2 × taille dégâts | « Quand la braise épouse l'orage, le ciel se fend en droite ligne. » |
| **Cendre** | Braise + Sève | Brise la Pierre Noire la plus proche (n'importe où dans le bocal) et donne +2 or | « Ce que la forêt brûle devient trésor. » |
| **Ronce** | Givre + Sève | Le clou gris de la rangée r3 le plus proche en x du point de fusion devient **Clou double** (+2 Éclat) jusqu'à la fin de la Lune | « La sève gelée pousse des épines d'argent. » |
| **Tempête** | Givre + Foudre | Gèle toutes les Ombres de la rangée occupée la plus basse | « Le froid et l'orage s'évitent… sauf dans la tempête. » |
| **Photosynthèse** | Sève + Foudre | La prochaine étoile lancée gagne +1 taille (max 5). L'aperçu la montre agrandie. | « La lumière nourrit ce qui pousse. » |
| **Aurore** (secret) | ≥ 3 réactions **distinctes** dans le même tir | **×2 Mult final** et arc-en-ciel sur le bocal. Actif seulement si le Planétarium est construit. | « Trois lueurs dans une même nuit, et le ciel danse. » |

La Forgeronne ne peut pas faire de fusion mixte : deux étoiles de couleurs différentes et de même taille se repoussent comme des corps normaux.

### 5.8 Durée d'un tir, accélérations, garde-fous

- **Temps de simulation écoulé depuis le lâcher (T) :**
  - T ≥ 2 s : vitesse ×2 (automatique).
  - T ≥ 3,5 s : vitesse ×3.
  - T ≥ 14 s : les étoiles en vol ignorent clous et Ombres et tombent directement.
- **Doigt ou F maintenu :** ×3. Le cumul avec l'accélération automatique est plafonné à ×4.
- **Accélération :** exécuter k pas de 1/120 par tick logique (k = 2, 3 ou 4). Maximum de 8 pas par frame de rendu, et le surplus est reporté.

---

## 6. Entités et valeurs

### 6.1 Courbes globales

**Multiplicateur de PV par Lune** (HPmult) : L1 **1,0** · L2 **1,6** · L3 **2,4** · L4 **3,4** · L5 **4,6** · Nuit Blanche L>5 : 4,6 × 1,35^(L−5).
PV d'une Ombre = `round(PV_base × HPmult × (Corbeau ? 1,2 : 1) × (Éclipse ≥ 2 ? 1,2 : 1))`, minimum 1.

**Quotas de Lumière** (Éclipse 0)

| Lune | Nuit Mince | Nuit Pleine (×1,5) | Nuit du Boss (×2) |
|---|---|---|---|
| 1 | 80 | 120 | 160 |
| 2 | 260 | 390 | 520 |
| 3 | 850 | 1 275 | 1 700 |
| 4 | 2 800 | 4 200 | 5 600 |
| 5 | 9 000 | 13 500 | 18 000 |
| Nuit Blanche L | 9 000 × 3,5^(L−5) | ×1,5 | ×2 |

Les valeurs sont arrondies à 10 près. Éclipse ≥ 1 : ×1,25.

**Valeurs en jeu** (réglage mesuré, `DATA.QUOTA_BASE`, voir `docs/ARCHITECTURE.md` §16.3) : Nuit Mince L1 **200** · L2 **800** · L3 **1 300** · L4 **2 500** · L5 **2 550** (Pleine ×1,5, Boss ×2) ; Nuit Blanche `2 550 × 3,5^(L−5)`. Avec le bocal étroit, les Lunes 1–2 demandent plus de tirs (le bocal s'y remplit vraiment) et les Lunes 4–5 un peu moins (le Débordement y fait déjà le tri). v1.1b : Lune 2 ramenée de 900 à 800 (le mur de quota de la Lune 2 est ce que les joueurs réels rencontrent d'abord ; un bot à visée imprécise, σ = 1,5°, n'y passe que ≈ 4 fois sur 10), une partie reportée sur les Lunes 4–5.

**Puissance joueur visée** (Lumière moyenne par tir, sert de référence pour l'équilibrage) : L1 ≈ 30 · L2 ≈ 95 · L3 ≈ 320 · L4 ≈ 1 050 · L5 ≈ 3 400. Cible : une nuit se termine en **4,2 ± 1 tirs** en moyenne.

### 6.2 Apparitions (par Lune)

| Lune | Ombres initiales (rangées 1–2) | Apparitions après chaque tir | Pondérations (%) | Nouveauté (onboarding) |
|---|---|---|---|---|
| 1 | 4 | 1 | Rampante 90, Lanterne 10 | Rampante, Lanterne, 1res Pierres |
| 2 | 5 | 1, 2, 1, 2, 1, 2 | Rampante 50, Lourde 25, Lanterne 15, Blindée 10 | Lourde, Blindée, Élite (Nuit Pleine) |
| 3 | 6 | 2 | Rampante 35, Lourde 20, Lanterne 10, Blindée 15, Voleuse 20 | Voleuse |
| 4 | 7 | 2 | Rampante 25, Lourde 20, Lanterne 10, Blindée 15, Voleuse 15, Nuée 10, Éteignoir 5 | Nuée, Éteignoir |
| 5+ | 8 | 2, 3, 2, 3, 2, 3 | Rampante 20, Lourde 20, Lanterne 8, Blindée 15, Voleuse 15, Nuée 12, Éteignoir 10 | — |

- **Nuit du Boss :** le boss, plus (initiales − 2) Ombres.
- **Nuit Pleine à partir de la Lune 2 :** 1 Mère-Ombre dans la rangée 1 au début de la nuit (elle remplace 1 Ombre initiale).
- **Éclipse 7 :** +1 apparition par tir.
- **Placement :** cellules libres de la rangée 1, choisies par le flux `waves`. La **rangée fantôme** (y = 90) montre exactement les types et les colonnes de la prochaine apparition. Ce tirage est fait à l'avance et ne dépend pas des actions en boutique.
- **Cellule cible occupée :** une Ombre qui doit descendre vers une cellule occupée attend (son compteur reste à 0). Traitement de bas en haut, puis de gauche à droite. Une apparition dont la cellule est occupée reste dans la file fantôme.

### 6.3 Ombres (rayon 18, sauf mention contraire)

| Type | PV de base | Vitesse (tirs entre deux descentes) | Pierre au bocal (taille) | Particularité | Visuel |
|---|---|---|---|---|---|
| **Rampante** | 3 | 1 | 1 | — | tache ronde, 1 œil |
| **Lourde** | 8 | 2 | 4 | — | tache aplatie, 2 yeux mi-clos, flèche double sur le badge |
| **Lanterne** | 4 | 2 | 1 | **Tuée : +1 tir cette nuit** (+1 pip doré). Donne toujours +3 Éclat au contact. | halo jaune pâle, œil-flamme |
| **Blindée** | 5 | 2 | 3 | **Armure 2** : dégâts subis = max(0, dégâts − 2). Brûlure et éclairs ignorent l'armure. | contour épais en hexagone, icône bouclier |
| **Voleuse** | 5 | 1 | 2 | Si elle survit à un coup, **absorbe l'étoile** | main griffue, icône main |
| **Nuée** | 6 | 2 | 2 | À sa mort, se divise en 2 Rampantes de PV = ⌈0,4 × PV max⌉ dans les cellules libres à gauche et à droite (même rangée) | 3 petites taches |
| **Éteignoir** | 6 | 2 | 2 | Tant qu'il vit, les 4 clous aux coins de sa cellule donnent **0 Éclat** (ils sont dessinés éteints) | éteignoir de bougie |
| **Mère-Ombre** (élite) | 20 | 3 | 5 | Rayon 22. Tous les 2 tirs, pond une Rampante dans une cellule libre adjacente (priorité : dessous, gauche, droite). **Tuée : +3 or et Coffre** (la Constellation de la prochaine Aube est gratuite, avec une rareté +1). | grande tache avec couronne d'yeux |

**Toutes les Ombres :** contact = +3 Éclat, dégâts = taille de l'étoile (+ modificateurs). Elles affichent un **badge de PV** (en bas à droite) et un **badge de compteur** (en haut à gauche, avec le nombre de tirs avant la descente), toujours dessinés au-dessus de tout le reste.

**Descente depuis la rangée 5 :** l'Ombre devient une **Pierre Noire** de la taille indiquée, lâchée à (x de la colonne, y = 340) avec une vitesse nulle, puis on laisse le bocal se stabiliser.

**Ombre tuée :** dissolution en fumée (8 particules) et 2 pièces d'or décoratives aspirées vers le compteur d'or. Elle ne donne pas d'or de base (sauf Corbeau et Glaneuse).

### 6.4 Boss (Nuit du Boss)

Un boss est un cercle de **rayon 40** qui occupe **2 × 2 cellules** (colonnes 3–4, soit un centre x = 180 ; au départ rangées 1–2, soit un centre y = 143). Il désactive les clous qu'il recouvre (dans le rayon + 5). Il descend d'une rangée **tous les 3 tirs**. Ses PV valent `30 × HPmult` (L'Éclipse : 200 × HPmult ÷ 4,6, donc 200 en Lune 5). **Tuer le boss lève sa règle pour le reste de la nuit** et rapporte +5 or (sauf à l'Éclipse 8, où la règle persiste). Les contacts avec le boss donnent +3 Éclat, comme une Ombre.

| Boss | Disponibilité | Règle |
|---|---|---|
| **La Faim** | base | Après le décompte des tirs 3 et 6, dévore l'étoile la plus grosse du bocal (égalité : la plus haute, puis l'id le plus petit). Les Pierres ne sont pas concernées. |
| **Le Voile** | base | L'étoile suivante est cachée (« ? ») et l'échange est impossible |
| **L'Avare** | base | Les clous gris donnent 0 Éclat (les clous spéciaux, les Ombres et les murs comptent) |
| **La Grêle** | base | Après chaque tir, une Pierre Noire de taille 1 tombe à x = centre du boss |
| **La Marée** | Salle des Cartes | Gravité du bocal ×1,5, gravité de vol ×1,3 |
| **L'Étau** | Salle des Cartes | Les murs du bocal passent à x = 96 et 264 pendant la nuit (les corps en dehors sont repoussés au début de la nuit, et les fusions qui en résultent vont dans la réserve) |
| **L'Éclipse** (final, Lune 5, fixe) | toujours | Tant qu'elle vit, **le Mult final de chaque tir est divisé par 2**. Sous 50 % de PV, la règle « Le Voile » s'ajoute. |

Les boss des Lunes 1 à 4 sont tirés parmi les boss disponibles (flux `waves`), sans répétition dans un run.

### 6.5 Pierre Noire

Corps du bocal : masse ×1,5, restitution 0,05, ne fusionne jamais. Elle est brisée par une fusion adjacente (§5.5), une explosion de Braise ou la réaction Cendre. Chaque Pierre brisée donne **+2 Mult** au tir en cours. Visuel : polygone irrégulier à 7 sommets `#262a38` avec un contour `#4a5068` et de petites fissures.

### 6.6 Gardiens (personnages de départ)

| Gardien | Règles | Sac de départ | Déblocage |
|---|---|---|---|
| **La Veilleuse** | Standard : 5 reliques, 6 tirs par nuit, 1 échange par nuit, 1 Bougie de secours, intérêts plafonnés à 5 | Voir ci-dessous | Départ |
| **L'Astronome** | Voit les 3 étoiles suivantes. 2 échanges par nuit (il peut échanger avec n'importe laquelle des 3). **4 emplacements de relique.** | Standard | Défi D09 : atteindre la Lune 3 |
| **La Forgeronne** | Pas de fusion mixte (donc pas de réactions). **Fusions pures : Mult ×2** (au lieu de ×1,5). **2 Bougies de secours** (v1.1 : dans le bocal étroit, les étoiles de couleurs différentes qui ne fusionnent pas l'encombrent vite). | 10 étoiles de 2 couleurs : Braise 1,1,1,2,2 et Givre 1,1,1,2,2 | D10 : 15 fusions pures en un run |
| **La Glaneuse** | **Pas d'intérêts.** +1 or par Ombre tuée. Reliques −1 or (minimum 2). | Standard | D11 : 150 Ombres tuées (cumulé) |
| **L'Insomniaque** | **Le bocal n'est jamais vraiment vidé** : à la Vidange, seules les étoiles de taille < 4 s'évaporent ; les Soleils et plus et les Pierres Noires restent, le bocal se tasse en silence (fusions → réserve), puis ce qui dépasse encore l'horizon s'évapore (une Lune ne commence jamais en Débordement). Les étoiles gardées **ne rapportent pas l'or de la Vidange** (seules celles qui quittent le bocal paient ; une même Géante ne paie donc jamais deux fois). **Sa Bougie se rallume à chaque Vidange.** Mult final ×1,3 à chaque tir (×1,5 jusqu'à la v1.1 ; v1.1b : ×1,5 rendait les Lunes 1–3 triviales, Lune 3 réussie à 83 %). Le run commence avec 2 Pierres Noires de taille 2 dans le bocal. (v1.1 : avec le bocal étroit, garder tout le bocal rendait le Gardien quasi injouable, ≈ 4 % de victoires.) | Standard | D12 : gagner un run |

**Sac standard (3 couleurs, 10 étoiles) :** Braise 1,1,2 · Givre 1,1,2 · Foudre 1,1,2 · Braise 2.
**Sac standard avec la Sève débloquée (10 étoiles) :** Braise 1,1,2 · Givre 1,1,2 · Foudre 1,2 · Sève 1,2.

**Bougie de secours :** 1 par run, affichée comme une petite flamme sous le Sac. Au premier Débordement, la bougie s'éteint et **tous les corps dont le haut dépasse la ligne d'horizon s'évaporent**, puis le run continue. Supprimée à l'Éclipse 6.

---

## 7. Score, combo et multiplicateur

### 7.1 Formule

```
Éclat_base = Σ clous gris (+1, Clou double +2, Éteignoir 0, L'Avare 0)
           + Σ contacts Ombre/boss (+3)
           + Σ effets de clous spéciaux (Éclat)
           + Σ bonus de famille ou de réaction en Éclat (Givre, Big Bang)
Mult_base  = 1 + réserve
           + Σ fusions (table §5.2, ×1,5 si pure, ×2 si pure avec la Forgeronne ; arrondi au 0,5 sup.)
           + 2 × Pierres brisées
           + Σ bonus de réaction en Mult (Vapeur +3, Sève +1, Clou Cristal)
Puis, pour chaque relique de GAUCHE à DROITE (hook « count ») :
    Éclat += r.dÉclat ; Mult += r.dMult ; Mult ×= r.xMult
Puis les finaux, dans cet ordre : Aurore ×2 → Big Bang ×10 → Insomniaque ×2 → L'Éclipse ÷2
Lumière = ⌊Éclat × Mult⌋   (Mult affiché avec 1 décimale, par ex. « 3,5 »)
```

La règle à la Balatro est enseignée par l'aperçu : les « + Mult » doivent être placés **à gauche** des « × Mult ». Dans la fiche d'une relique en boutique, on voit **l'effet chiffré rejoué sur le dernier tir** (par exemple « Sur ton dernier tir : 214 → 428 »).

### 7.2 Contexte de décompte (produit par le journal d'événements, §12.5)

`ctx = { pegHits, specialHits:{or,ressort,prisme,echo,cristal,teint}, wallBounces, shadowHits, kills, killsByType, merges:[{size,pure,colors,reaction}], stonesBroken, reactions:[], bigBang, launchedSize, touchedShadow, jarFill (0–1), jarCount, jarColors (Set), maxJarSize, gold, isLastShot, shotIndex, metronome, reserve }`

### 7.3 Or et économie

| Source | Montant |
|---|---|
| Or de départ | 4 |
| Nuit gagnée | Mince +3, Pleine +4, Boss +5 |
| Chaque tir non utilisé | +1 (Glaneur : +2) ; les 2 tirs d'apprentissage de la Lune 1 ne comptent pas |
| Intérêts (calculés **avant** d'ajouter la récompense) | +1 par tranche de 5 or détenus, plafond 5 (Tirelire 8, Éclipse 6 plafond 3, Glaneuse 0) |
| Boss tué | +5 |
| Élite tuée | +3 et Coffre |
| Vidange (fin de Lune) | +1 par étoile de taille ≥ 4 qui quitte le bocal (max +5) ; celles que garde L'Insomniaque ne paient pas |
| Clou d'or, Cendre, Dorée, Corbeau, Glaneuse | voir les fiches |

---

## 8. Contenu v1 complet

Tags de synergie : `ÉCLAT` `MULT` `xMULT` `OR` `BOCAL` `OMBRE` `REBOND` `CLOU` `FUSION` `PURE` `RÉACTION` `DÉCHET` `SAC` `FOUDRE` `DÉFENSE` `RISQUE` `UTIL`.
Hooks : **C** = décompte (ordre gauche→droite), **V** = modifie le vol ou le bocal, **P** = passif.

### 8.1 Reliques (30)

Prix : Commune 4 · Peu commune 6 · Rare 8 (+1 à l'Éclipse ≥ 3, −1 pour la Glaneuse).

| # | Nom | Rareté | Hook | Effet chiffré | Tags | Source |
|---|---|---|---|---|---|---|
| R01 | Loupe | C | C | +2 Éclat par contact d'Ombre ce tir | ÉCLAT OMBRE | Départ |
| R02 | Comète | C | C | +3 Éclat par rebond sur un mur ce tir | ÉCLAT REBOND | Départ |
| R03 | Diapason | C | C | +1 Mult par tranche de 5 clous touchés ce tir | MULT CLOU | Départ |
| R04 | Chandelle | C | C | +10 Éclat si l'étoile n'a touché aucune Ombre | ÉCLAT | Départ |
| R05 | Chasseur | C | C | +2 Mult par Ombre tuée ce tir (tourelles comprises) | MULT OMBRE | Départ |
| R06 | Cascade | C | C | +2 Mult par fusion au-delà de la 1re ce tir | MULT FUSION | Départ |
| R07 | Tirelire | C | P | Plafond d'intérêts 5 → 8 | OR | Départ |
| R08 | Corbeau | C | V | +1 or par Ombre tuée. Les Ombres ont +20 % PV. | OR OMBRE RISQUE | Départ |
| R09 | Boussole | C | P | L'aperçu de trajectoire affiche +1 contact | UTIL | Départ |
| R10 | Géante rouge | C | V | Les étoiles de taille ≥ 3 infligent +2 dégâts | OMBRE | Départ |
| R11 | Horloge | C | P | Tous les 3 tirs (3e, 6e), les Ombres ne descendent pas | DÉFENSE | Départ |
| R12 | Poids plume | C | C | +1 Éclat par clou touché si l'étoile lancée est de taille 1 ou 2 | ÉCLAT SAC | Départ |
| R13 | Télescope | PC | C | +4 Mult par fusion de taille ≥ 4 ce tir | MULT FUSION | Défi D01 |
| R14 | Balance | PC | C | ×2 Mult si le bocal est rempli à moins de 50 % (jauge §4). v1.1b : le seuil passe de 40 à 50 % car la jauge lit désormais la capacité et la hauteur ; à 40 % il n'était vrai que sur ≈ 44 % des tirs du bot greedy (≈ 100 % en v1.0, où le bocal restait presque vide) ; à 50 %, ≈ 57 %. C'est une vraie contrainte « bocal bas » | xMULT BOCAL | Défi D02 |
| R15 | Alchimiste | PC | V | Les fusions pures donnent le Mult d'une taille au-dessus (Trou Noir : +21) | PURE MULT | Défi D03 |
| R16 | Vitrail | PC | C | +2 Mult par couleur différente présente dans le bocal (max +8) | MULT RÉACTION | Bibliothèque |
| R17 | Paratonnerre | PC | V | Les étoiles Foudre du bocal tirent 2 éclairs | FOUDRE OMBRE | Bibliothèque |
| R18 | Carrière | PC | C | +3 Mult par Pierre Noire brisée ce tir | DÉCHET MULT | Défi D04 |
| R19 | Métronome | PC | C | +1 Mult cumulé par tir consécutif avec au moins 1 fusion (remis à 0 sur un tir sans fusion et à chaque nouvelle nuit) | MULT FUSION | Bibliothèque |
| R20 | Le Comptable | PC | C | +1 Mult par tranche de 5 or détenus | OR MULT | Bibliothèque |
| R21 | Sablier | PC | V | La 1re étoile de chaque nuit est lancée deux fois (une copie part 0,4 s après, même angle, sans consommer de tir) | SAC | Défi D05 |
| R22 | Glaneur | PC | P | +1 or supplémentaire par tir non utilisé | OR | Bibliothèque |
| R23 | Échangeur | PC | P | +2 échanges par nuit | SAC UTIL | Bibliothèque |
| R24 | Pression | R | C | ×(1 + 0,1 × nombre d'étoiles dans le bocal) Mult (Pierres exclues) | xMULT BOCAL | Crypte |
| R25 | Catalyseur | R | C | ×1,5 Mult par réaction déclenchée ce tir (se multiplie : 2 réactions = ×2,25) | xMULT RÉACTION | Défi D06 |
| R26 | Dernier Souffle | R | C | ×3 Mult sur le dernier tir disponible de la nuit | xMULT | Crypte |
| R27 | Verre soufflé | R | C+P | ×2,5 Mult. La ligne d'horizon descend de 24 px. | xMULT RISQUE BOCAL | Crypte |
| R28 | Couronne | R | C | ×2 Mult si toutes les fusions du tir sont pures (au moins 1) | xMULT PURE | Crypte |
| R29 | Prisme de poche | R | V | La 1re fusion de chaque tir compte deux fois (Mult et déclencheurs de reliques) | FUSION | Défi D07 |
| R30 | Singularité | R | C | ×(1 + 0,25 × taille de la plus grosse étoile du bocal) Mult | xMULT BOCAL | Défi D08 |

**Emplacements pleins :** le bouton Acheter devient « Pleins : vendre une relique ? » et ouvre la sélection de vente.

### 8.2 Évolutions (légendaires)

**Condition :** posséder la relique de base **et** avoir déclenché la réaction indiquée **au moins 3 fois dans le run**, avec le Laboratoire construit. L'évolution se fait automatiquement au début de l'Aube suivante (animation de 1,5 s, accord montant) et prend l'emplacement de la relique de base.

| Évolution | Recette | Effet | Indice du Grimoire |
|---|---|---|---|
| Observatoire Ionique | Télescope + Plasma | +4 Mult par fusion de taille ≥ 4. Chaque Plasma compte comme une fusion de taille 4 pour tous les déclencheurs. | « L'œil qui regarde loin voudrait voir l'éclair de près. » |
| Équilibre | Balance + Vapeur | ×3 Mult si le bocal est rempli à moins de 60 % (jauge §4 : ≈ 69 % des tirs ; 50 % avant la v1.1b) | « La vapeur allège les plateaux. » |
| Queue d'Aurore | Comète + Photosynthèse | +3 Éclat par rebond sur un mur et ×1,1 Mult par rebond sur un mur (max ×3) | « La comète rêve de faire pousser la lumière. » |
| Œil du Cyclone | Paratonnerre + Tempête | Les Foudre tirent 3 éclairs et gèlent leur cible | « Au cœur de la tempête, la foudre voit clair. » |
| Fonderie | Carrière + Cendre | +5 Mult par Pierre brisée, et +1 or par Pierre brisée | « La pierre noire fond en or dans les bonnes braises. » |
| Harpe Céleste | Diapason + Ronce | +1 Mult toutes les 3 touches de clou. Les Clous doubles donnent +4. | « Les épines d'argent chantent quand on les pince. » |

### 8.3 Clous spéciaux (6 types, posés sur les emplacements A à F, conservés tout le run)

Prix : 5 or. **Paire** = deux clous du même type sur des emplacements adjacents, ce qui double l'effet chiffré des deux clous (pas de cumul au-delà de ×2).

| Clou | Couleur | Effet par touche | Effet de paire | Source |
|---|---|---|---|---|
| Clou d'or | `#ffd166` | +1 or (max 3 par clou et par tir), +1 Éclat | +2 or | Départ |
| Clou Ressort | `#7dffb0` | Restitution 1,25, +2 Éclat | +4 Éclat | Départ |
| Clou Prisme | `#ffffff` irisé | 1 fois par tir : une étoile de taille ≥ 2 se divise en 2 étoiles de taille −1 (angles ±25° autour de la vitesse réfléchie), +1 Éclat | Les moitiés ont +1 dégât | Atelier |
| Clou Écho | `#c7a6ff` | +1 Éclat par clou (gris ou spécial) voisin dans le treillis (8 voisins, max 8) | ×2 | Atelier |
| Clou Cristal | `#ff4d5e` | **+1 Mult** (max 3 par tir), +0 Éclat | +2 Mult | Forge |
| Clou Teinturier (couleur choisie à l'achat) | couleur de la famille | Teint l'étoile qui le touche dans sa couleur, +1 Éclat | +3 Éclat | Défi D14 |

### 8.4 Étoiles vendues et gravures

**Étoiles :** couleur tirée parmi les familles débloquées (flux `shop`).

| Article | Prix | Disponibilité |
|---|---|---|
| Étoile taille 2 | 3 | toujours |
| Étoile taille 3 | 4 | toujours |
| Étoile taille 4 | 6 | Lune ≥ 3 |

**Gravures** (3 or). À l'achat, on choisit une étoile du Sac à graver (1 gravure par étoile ; une nouvelle gravure remplace l'ancienne après confirmation).

| Gravure | Effet | Source |
|---|---|---|
| Polie | +1 Éclat par clou touché par cette étoile | Départ |
| Lestée | Restitution sur clou 0,35 (tombe presque droit), +1 dégât | Départ |
| Dorée | +1 or quand elle se pose dans le bocal | Forge |
| Filante | Vitesse de lancer ×1,35, +1 Éclat par contact d'Ombre | Forge |
| Prismatique | Fusion toujours pure, quelle que soit la couleur de l'autre étoile (y compris avec la Forgeronne) | Défi D13 |

**Services de l'Aube :**
- **Épurer le Sac :** retirer 1 étoile pour 2 or (le Sac garde au minimum 6 étoiles).
- Sac : maximum 20 étoiles.

**Total du contenu v1 :** 30 reliques, 6 évolutions, 6 clous, 3 tailles d'étoiles en vente, 5 gravures, 4 familles, 6 réactions et 1 secret, 7 Ombres et 1 élite, 7 boss, 5 Gardiens.

### 8.5 Tirage du Sac

Au début de chaque nuit, le Sac entier est mélangé (flux `bag`) dans une **pioche**. Le tirage se fait sans remise. L'étoile courante et la suivante sont toujours visibles (les 3 suivantes pour l'Astronome). Si la pioche est vide et qu'il reste des tirs, on remélange tout le Sac.

---

## 9. Méta-progression

### 9.1 Fragments ◇

```
F = 3 × Lunes terminées + nuits gagnées + 2 × nouvelles découvertes (relique vue pour la 1re fois,
    réaction, évolution, type d'Ombre) + (victoire ? 10 : 0)
F = max(1, round(F × (1 + 0,15 × niveau d'Éclipse)))
```

Ordre de grandeur : ~6 ◇ pour un run qui meurt en Lune 2, ~15 ◇ en Lune 3, ~35 ◇ pour une victoire.

### 9.2 L'Observatoire (base « cozy », vue en coupe, 8 salles)

Les salles se construisent dans n'importe quel ordre. Le coût affiché est ×1,0 pour la salle la moins chère restante. Chaque salle allumée devient une tuile qui s'illumine, avec une animation de 2 s et un carillon.

| Salle | Coût ◇ | Élargit le pool |
|---|---|---|
| La Serre | 12 | Famille **Sève** (Sac de départ à 4 couleurs, réactions Cendre, Ronce, Photosynthèse) |
| L'Atelier | 18 | Clous **Prisme** et **Écho** |
| La Bibliothèque | 25 | 6 reliques : Vitrail, Paratonnerre, Métronome, Le Comptable, Glaneur, Échangeur |
| Le Laboratoire | 30 | **Évolutions** actives. Le Grimoire affiche les indices d'évolution. |
| La Forge | 40 | Clou **Cristal**, gravures **Dorée** et **Filante** |
| La Salle des Cartes | 50 | Boss **La Marée** et **L'Étau** |
| La Crypte | 60 | 4 reliques rares : Pression, Dernier Souffle, Verre soufflé, Couronne |
| Le Planétarium | 80 | Mode **Nuit Blanche** (sans fin) et secret **Aurore** |

Total : 315 ◇, soit environ 20 à 25 runs. Il n'y a **aucun bonus de statistique plat**.

### 9.3 Défis (16)

| # | Défi | Récompense |
|---|---|---|
| D01 | Fusionner un Soleil (taille 4) | Télescope |
| D02 | Gagner une nuit avec la jauge du bocal sous 35 % (v1.1b : jauge = max surface / hauteur, §4 ; ≈ 8 % des nuits gagnées au bot greedy, l'ancien « < 25 % de 77 408 px² » était toujours vrai) | Balance |
| D03 | 3 fusions pures dans un même tir | Alchimiste |
| D04 | Briser 3 Pierres Noires dans un même tir | Carrière |
| D05 | Gagner une nuit en 2 tirs ou moins | Sablier |
| D06 | Déclencher les 6 réactions (cumulé) | Catalyseur |
| D07 | Une cascade de 4 fusions dans un même tir | Prisme de poche |
| D08 | Déclencher un Big Bang | Singularité |
| D09 | Atteindre la Lune 3 | Gardien L'Astronome |
| D10 | 15 fusions pures dans un même run | Gardienne La Forgeronne |
| D11 | Tuer 150 Ombres (cumulé) | Gardienne La Glaneuse |
| D12 | Gagner un run | Gardien L'Insomniaque et échelle des Éclipses |
| D13 | Un tir ≥ 1 000 Lumière | Gravure Prismatique |
| D14 | Tuer un boss en un seul tir | Clou Teinturier |
| D15 | Tuer 5 Ombres dans un même tir | +10 ◇ |
| D16 | Déclencher une Aurore | Thème visuel « Aurore » du bocal (option cosmétique) |

### 9.4 Grimoire

Onglets : **Étoiles et familles · Réactions · Évolutions · Reliques · Ombres · Défis**.
- Une entrée non découverte apparaît comme une silhouette grise avec son indice en une ligne (voir §5.7 et §8.2).
- Les indices d'évolution n'apparaissent qu'une fois le Laboratoire construit.
- Une entrée découverte montre la fiche complète et le nombre de déclenchements.
- La complétion est affichée en pourcentage.

### 9.5 Éclipses (difficulté empilable, 8 niveaux par Gardien, débloquées par D12)

Un niveau N se débloque en gagnant au niveau N−1 avec ce Gardien. Chaque niveau inclut tous les précédents et donne +15 % de Fragments.

| Niv. | Modificateur |
|---|---|
| 1 | Quotas ×1,25 |
| 2 | Ombres +20 % PV |
| 3 | Reliques +1 or |
| 4 | Ligne d'horizon −16 px (y = 468 ; 492 avec Verre soufflé, borne basse de §4) |
| 5 | 5 tirs par nuit |
| 6 | Pas de Bougie de secours, intérêts plafonnés à 3 |
| 7 | +1 apparition d'Ombre par tir |
| 8 | La règle du boss persiste même s'il est tué |

### 9.6 Ciel du Jour

- **Seed :** `FNV-1a("BDE-" + AAAA-MM-JJ)` en date locale, puis mulberry32. Gardien imposé (index seed % 5) et 1 relique de départ imposée (parmi les 30). Il utilise **le contenu complet**, déblocages compris, ce qui sert de vitrine. Éclipse 0.
- Un seul essai compté par jour (on peut rejouer, mais seul le 1er score est « officiel »). Le meilleur score local et l'historique des 30 derniers jours sont conservés.
- **Partage** (`navigator.share`, avec repli sur `navigator.clipboard.writeText`) :

```
BOCAL D'ÉTOILES ✦ Ciel du 30/09
Lune 1  ⭐🌟⭐
Lune 2  🌟🟠🌟
Lune 3  🟠💥❌
🟦412 × 🟥38 = 15 656
Total 48 210 · L'Astronome
```

Chaque symbole représente une nuit et donne sa plus grosse fusion (table §5.2). 🌌 = Big Bang, ❌ = nuit perdue. La dernière ligne montre l'équation du meilleur tir du run. Le même format est proposé à la fin de n'importe quel run (sans la date).

### 9.7 Sauvegarde (localStorage, chaque accès entouré de try/catch)

- `bde.v1.meta` :
  `{v:1, fragments, rooms:[ids], gardiens:[ids], eclipses:{gardienId:niveauMaxDébloqué}, defis:{id:{done,progress}}, grimoire:{relics:[], reactions:{id:count}, evolutions:[], ombres:[], hintsSeen:[]}, stats:{runs, wins, kills, merges, bestShot, bestTotal}, daily:{date, officialScore, best, history:[{date,score,grid}]}, settings:{sfx:0.8, music:0.5, shake:true, flash:true, colorblind:false, textScale:1, eco:false, aim:"abs", assistAim:false, vibrate:true}, flags:{tutoAim, tutoMerge, tutoShadow, tutoQuota}}`
- `bde.v1.run` (null s'il n'y a pas de run en cours) :
  `{v:2, seed, streams:{bag,shop,waves,pegs,misc}, daily:false, gardien, eclipse, lune, nuit, shotIndex, shotsLeft, total, quota, gold, candle, swapsLeft, reserve, metronome, bag:[{id,size,color,grav}], draw:[ids], nextSizeBonus, relics:[{id,evolved}], reactionCounts:{}, clous:{A..F}, pegLayout, ronce:[pegIdx], jar:[{id,size,color,stone,x,y}], shadows:[{type,col,row,hp,maxhp,counter,burn,frozen}], boss:{...}|null, ghostQueue:[...], phase:"AIM"|"SHOP"|"PENDING_SHOT", pendingAngle, shop:{offers,locked,rerollCost,pack}, runStats:{...}, nightBest:[[]]}`
- **Version du run** : `v:2` depuis le bocal étroit (v1.1). Un run `v:1` (bocal large de la v1.0 : murs 16 / 344, rayons 14…62) reste accepté et est **migré** à la reprise : murs du bocal courants (L'Étau compris), rayon et masse de chaque corps selon §5.2, tassement silencieux (fusions → réserve), puis le trop-plein s'évapore. La même migration corrige un corps dont le rayon ne correspond plus à la table §5.2.
- **Moments d'écriture :** entrée en phase AIM, lâcher d'un tir (`phase:"PENDING_SHOT"` avec `pendingAngle`), chaque action de boutique, fin de run (on écrit la méta, puis on met le run à `null`).
- En cas d'échec d'écriture (quota, navigation privée), le jeu continue normalement et affiche une petite icône « sauvegarde indisponible » dans la pause.

---

## 10. Écrans et UI

Police : `system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`, en gras pour les chiffres. Taille de base 14 px logique, minimum 11 px (×1,25 avec le réglage de texte). Nombres en format fr-FR avec espace fine insécable. À partir de 1 000 000, format compact : « 1,2 M », puis « 3,4 Md », puis « 1,2e15 ».

### 10.1 Écran titre

Un bocal animé (5 étoiles au repos qui clignent des yeux) et le titre en néon doux. Boutons (largeur 240, hauteur 56, empilés) : **Continuer** (s'il y a un run en cours), **Nouvelle partie**, **Ciel du Jour** (avec le badge « fait » ou « à jouer »), **Observatoire**, **Grimoire**, **Réglages**. Bandeau du bas : « Encore 7 ◇ : La Serre » avec une barre de progression.

### 10.2 Sélection

Carrousel horizontal des Gardiens (glisser ou flèches). Chaque carte montre le portrait vectoriel, 2 lignes de règles et son Sac. Les Gardiens verrouillés apparaissent en silhouette, avec leur défi. En dessous, le sélecteur d'Éclipse (0 à niveau max débloqué, − / +). Bouton **Lancer**.

### 10.3 Jeu (HUD)

- **Barre haute (0–44) :** à gauche « LUNE 2 · PLEINE » (12 px, `--dim`). Au centre, la **jauge de quota** (largeur 170, hauteur 10) : remplissage `--or` pour la Lumière acquise, et remplissage fantôme hachuré `--eclat` pour la **projection en direct** (total + Éclat live × Mult live, sans les reliques). Au-dessus, le texte « 312 / 520 ». À droite, l'or avec l'icône ● `--or`, puis ⏸.
- **Zone du Phare (44–97) :** Sac (icône et nombre restant), le Phare (anneau `#eef2ff` de rayon 22 contenant l'étoile courante dessinée à un rayon max de 18), les **pips de tirs** (6 cercles de 5 px sous le Phare, pleins = restants, dorés = tir bonus Lanterne), la Bougie, la case SUIV., et la mention « +2 en réserve » s'il y a lieu.
- **Rangée fantôme** à y = 90.
- **Compteur live** à y = 352 : « ✦ 24 × 3,5 » (✦ et le nombre en `--eclat`, × et le nombre en `--mult`). Pendant le décompte, c'est là que les rubans se percutent.
- **Ligne d'horizon :** pointillés `--dim` 1 px. Elle devient `--danger` et pulse (0,8 Hz) dès qu'un corps au repos a son haut à moins de 16 px de la ligne. Elle passe à l'ambre (sans son) quand l'étoile courante posée sur le tas dépasserait la ligne (§4). Jauge verticale de remplissage à droite du bocal, du fond à l'horizon, surmontée du pourcentage (« 58 % » : max surface / hauteur, §4).
- **Bande des reliques (618–640) :** icônes 22 px. Pendant le décompte, la relique active saute (échelle 1,4) et affiche sa contribution au-dessus (« +4 » rouge, « ×2 » rouge sur fond clair, « +10 » bleu).

### 10.4 Carte d'introduction de nuit (1,2 s, un tap la saute)

Voile semi-transparent. « LUNE 2 — NUIT DU BOSS ». Pour un boss, son nom, sa règle en une ligne et son icône. « Quota 520 ».

### 10.5 Aube (boutique), en plein écran

- **En-tête :** « AUBE — Lune 2, après la Nuit Pleine ». La récompense détaillée tombe en pièces : « Nuit +4 · Tirs restants +2 · Intérêts +3 ». Puis « Prochaine : Nuit du Boss — La Faim ».
- **Rangée des offres :** 3 cartes de 96 × 128, avec prix, rareté (liseré gris, bleu ou violet) et icône cadenas pour verrouiller (1 seul article verrouillé, gratuit). Plus une carte **Constellation** (4 or, gratuite après une élite).
- **Constellation :** 3 rouleaux verticaux défilent, puis s'arrêtent à 0,4 s d'écart (clics de rouleau et « ding »). On choisit 1 carte parmi les 3. Si les 3 cartes sont du même type : « JACKPOT », on en choisit 2.
- **Boutons :** Relancer (2 or, puis +1 à chaque relance dans la même Aube), Sac (panneau avec Épurer et les gravures), **Nuit suivante** (56 px, `--or`).
- **Reliques :** 5 emplacements réordonnables, en bas. Un tap ouvre la fiche avec l'aperçu chiffré sur le dernier tir, et le bouton Vendre (moitié du prix, arrondi à l'inférieur, minimum 1) avec confirmation.
- **Mini-carte du Firmament** (apparaît après l'achat d'un clou) : les 6 emplacements A à F, en treillis. Les paires possibles sont dessinées en pointillé.
- **À la fin de la Lune :** l'écran « Vidange » (1,5 s) s'insère avant l'Aube. Le bocal se renverse doucement, les étoiles de taille ≥ 4 deviennent de l'or. Avec L'Insomniaque, seules les étoiles qui partent tombent (« les petites étoiles s'évaporent »).

### 10.6 Pause

Reprendre · Sac · Reliques · Réglages · Grimoire · Abandonner (confirmation) · Menu principal (le run reste sauvegardé).

### 10.7 Fin de run

« VICTOIRE » ou « LA NUIT T'A EMPORTÉ(E) — Lune 3, Nuit Pleine », avec la cause (« Quota manqué de 212 » ou « Débordement »). Meilleur tir en grand : « 🟦412 × 🟥38,0 = 15 656 ». Statistiques : fusions, plus grosse étoile, Ombres tuées, réactions, or total. Liste des ◇ gagnés, ligne par ligne, qui tombent un par un. Barre « Encore N ◇ : [Salle] ». Défis réussis. Boutons : **Rejouer** (même Gardien et même Éclipse), **Partager**, **Menu**.

### 10.8 Observatoire et Grimoire

- **Observatoire :** coupe verticale de 8 tuiles (2 × 4) de 150 × 110. Une salle construite est éclairée et animée (télescope qui tourne, alambic qui bulle, etc., en boucles vectorielles simples). Une salle non construite est grise, avec son coût et ce qu'elle apporte. Tap, puis Construire (confirmation).
- **Grimoire :** voir §9.4. Liste verticale défilante, avec des cartes de 72 px de haut.

### 10.9 Onboarding (premier run, sans mur de texte)

Il y a 4 bulles d'une ligne, chacune montrée une seule fois (drapeaux dans la méta) :
1. Première phase AIM : main animée et « Glisse pour viser, relâche pour lancer. »
2. Premier atterrissage à côté d'une étoile de même taille : « Deux étoiles identiques fusionnent : c'est ton Mult. »
3. Première descente d'Ombre : flèche vers le badge et « Ce nombre = tirs avant sa descente. »
4. Premier décompte : flèche vers la jauge et « Atteins le quota avant la fin des tirs. »

Les nouvelles Ombres de chaque Lune apparaissent avec une mini-carte « Nouvelle Ombre : Lourde — tombe en grosse pierre » (1 s) la première fois.

### 10.10 Réglages

Volume des effets (0 à 100) · Volume de la musique · Secousses (oui/non) · Flashs réduits · **Mode daltonien** (motifs dans les étoiles, voir §11.1) · Contraste renforcé · Taille du texte ×1 / ×1,25 · **Mode Éco 30 fps** · Visée Absolue / Relative · Visée assistée (+1 contact dans l'aperçu) · Vibrations · Réinitialiser la progression (double confirmation).

---

## 11. Direction artistique, juice et audio

### 11.1 Palette (CSS / canvas)

| Jeton | Hex | Usage |
|---|---|---|
| `--bg0` | `#070a14` | letterbox, vignette |
| `--bg` | `#0b0f1e` | fond de jeu |
| `--panel` | `#121832` | panneaux et cartes |
| `--line` | `#2b3560` | bordures |
| `--text` | `#eef2ff` | texte |
| `--dim` | `#8a93b8` | texte secondaire, horizon au repos |
| `--eclat` | `#4fb3ff` | **Éclat (uniquement pour lui)** |
| `--mult` | `#ff4d5e` | **Mult (uniquement pour lui)** |
| `--or` | `#ffd166` | or, quota |
| `--frag` | `#c7a6ff` | Fragments |
| `--braise` | `#ff6b3d` | famille |
| `--givre` | `#5ee7ff` | famille |
| `--seve` | `#6ee07a` | famille |
| `--foudre` | `#ffe14d` | famille |
| `--ombre` | `#05060c` | corps des Ombres |
| `--ombre-line` | `#b59cff` | contour des Ombres |
| `--pierre` / `--pierre-line` | `#262a38` / `#4a5068` | Pierres Noires |
| `--peg` / `--peg-off` | `#c9d2ea` / `#3a4262` | clous |
| `--glass` | `#9fb3d9` (alpha 0,35) | verre du bocal |
| `--danger` | `#ff4d6d` | horizon en alerte |

**Contraste renforcé :** `--bg` `#000000`, familles plus claires (+15 % de luminosité), contours des étoiles de 2 px en `#ffffff`.
**Mode daltonien :** chaque famille reçoit un motif blanc à 40 % dans l'étoile. Braise = 3 flammes (triangles), Givre = flocon à 6 branches, Sève = feuille (ellipse et nervure), Foudre = zigzag. Il est aussi appliqué aux icônes de réaction.

### 11.2 Rendu procédural

- **Fond :** dégradé vertical `#0b0f1e` → `#070a14`. 2 couches de 60 et 30 étoiles lointaines (points de 1 à 2 px) en parallaxe lente (3 et 6 px/s), pré-rendues dans un canvas hors écran de 360 × 1280 qui défile.
- **Étoiles :** sprites pré-rendus par (taille × couleur) = 28 canvas hors écran, plus des variantes daltoniennes. Chaque sprite contient un halo en dégradé radial (rayon × 1,8, alpha 0,35), un disque en dégradé radial (centre éclairci de +30 %) et un liseré 1,5 px (blanc si l'étoile vient d'une fusion pure dans ce tir). Les **deux yeux** sont dessinés à la volée : ellipses blanches de r × 0,16, pupilles noires décalées de max 2 px vers l'étoile en vol, clignement toutes les 3 à 6 s (cosmétique, `Math.random` autorisé hors simulation). Le Trou Noir a un disque `#05060c` et un halo inversé `--frag`.
- **Ombres :** tache noire à 10 sommets déformés par un sinus lent (deux harmoniques, amplitude 1,5 px), contour 1,5 px `--ombre-line`, œil blanc qui suit l'étoile, badges ronds de 9 px (PV sur fond `--panel`, compteur sur fond `--ombre-line`).
- **Bocal :** trait 2 px `--glass`, reflet vertical dessiné en blanc à alpha 0,08 le long du mur gauche, fond intérieur légèrement éclairci (`#0f1428`).
- **Clous :** disques de 5 px. Les clous spéciaux ont une couronne colorée de 8 px. Un clou touché flashe en blanc 80 ms. Un Clou double est dessiné comme deux cercles emboîtés.
- **Aucun `shadowBlur` par frame.** La lueur se fait uniquement par sprites pré-rendus composés en `globalCompositeOperation = "lighter"` (particules et halos seulement).
- **Ordre de rendu :** fond → verre → clous → Ombres (corps) → étoiles et Pierres → étoiles en vol → ligne d'aperçu → particules → nombres flottants → **badges des Ombres et rangée fantôme** → HUD → surcouches.

### 11.3 Juice

| Événement | Visuel | Hitstop | Secousse | Haptique |
|---|---|---|---|---|
| Clou touché | flash blanc 80 ms, « +1 » bleu 10 px qui monte de 14 px en 400 ms | — | — | — |
| Contact d'Ombre | Ombre écrasée (1,15 × 0,85 pendant 100 ms), éclats violets ×4 | 20 ms | — | — |
| Ombre tuée | fumée ×8 et 2 pièces aspirées | 30 ms | 1 px | — |
| Atterrissage dans le bocal | 3 étincelles, anneau de 0,2 s | — | — | — |
| Fusion taille ≤ 4 | squash et stretch 1,25 → 0,9 → 1 en 180 ms, anneau d'onde (r → r × 2, 250 ms), « +3 » rouge de 12 à 16 px | — | — | — |
| Fusion taille ≥ 5 | idem avec 12 particules de la couleur | 60 ms | min(6, 1,5 × (s − 3)) px pendant 200 ms | 15 ms |
| Réaction | icône de la réaction et son nom (« PLASMA ») au point de fusion, trait coloré | 40 ms | 2 px | 10 ms |
| Pierre brisée | 6 éclats gris, « +2 » rouge | 30 ms | 2 px | — |
| Big Bang | flash blanc plein écran 120 ms (réduit à 30 % avec « Flashs réduits »), 300 ms de silence, onde blanche, « BIG BANG ×10 » | 300 ms | 8 px pendant 400 ms | 40-30-40 ms |
| Quota atteint | **gel de 0,5 s**, puis les Ombres restantes se changent en fumée dorée aspirée vers la jauge avec un « ka-ching », pluie de 30 paillettes `--or` | — | — | 20 ms |
| Débordement | horizon rouge vif, l'étoile fautive tremble, « DÉBORDEMENT » | 200 ms | 4 px | 60 ms |

**Chiffres agrégés :** les dégâts subis par une Ombre sont cumulés et affichés au plus toutes les 250 ms. Au plus 40 nombres flottants à la fois (pool), les plus anciens sont recyclés.

**Décompte :** un ruban bleu (Éclat) monte depuis la gauche et un ruban rouge (Mult) depuis la droite. Chaque relique fait sauter son icône et modifie un ruban. À la fin, les rubans se percutent au centre et produisent un grand nombre blanc (24 à 32 px selon sa taille), qui vole ensuite vers la jauge.
Durées : 0,4 s pour la base, 0,22 s par relique active, 0,5 s pour le final. ×4 si maintenu, sauté sur un tap.

**Particules :** pool de 300. Taille 1 à 3 px, durée de vie de 0,3 à 0,8 s. Alpha maximal 0,8 au-dessus des badges des Ombres (qui restent lisibles).

### 11.4 Séquence de fin de nuit

Gel de 0,5 s, puis conversion des Ombres (1 s), puis décompte de l'or (« Tirs restants +2 ») avec une pièce par or et un « tic », puis transition en fondu (0,3 s) vers l'Aube.

### 11.5 Audio (100 % WebAudio synthétisé)

**Graphe :** voix → gain effets / gain musique → `DynamicsCompressor` (seuil −18 dB, ratio 4) → destination. Pool de **16 voix** maximum (la plus ancienne est coupée). L'`AudioContext` est créé ou repris au premier `pointerdown` et suspendu en pause.

| Son | Synthèse |
|---|---|
| Note de clou | Gamme pentatonique de do majeur (do, ré, mi, sol, la) à partir de do5 (523,25 Hz). La note n°k du tir = degré k, avec +1 octave tous les 5 degrés et un plafond de 3 octaves. Sinus + triangle (×2, gain 0,3), attaque 2 ms, décroissance exponentielle 180 ms, gain 0,18. |
| Rebond sur mur | Bruit blanc, passe-bande 420 Hz Q = 4, 60 ms (bois) |
| Contact d'Ombre | Carré 110 → 70 Hz sur 90 ms, gain 0,12, avec un bruit passe-bas 800 Hz de 40 ms |
| Ombre tuée | Bruit dont le passe-bas descend de 2 000 à 200 Hz en 250 ms (fumée) |
| Atterrissage | « Plop » de verre : sinus 900 → 600 Hz en 40 ms, plus un clic de bruit passe-haut 4 kHz de 8 ms |
| Fusion | **Hauteur qui baisse avec la taille :** f = 660 × 0,8^(s−2). Sinus avec glissement f → f/2 en 120 ms et clic. Taille ≥ 5 : sous-grave sinus 55 Hz de 250 ms en plus. |
| Réaction | Cloche FM (porteuse f, modulante 1,4 f, indice 3 → 0 en 400 ms), f selon la réaction |
| Pierre brisée | Bruit passe-bande 250 Hz de 120 ms et carré 60 Hz de 60 ms |
| Tic du décompte | Triangle court (30 ms). La hauteur monte d'un demi-ton à chaque étape à partir de do5 (plafond +24). |
| Relique déclenchée | Cloche FM brève, en do majeur, un degré par emplacement |
| Total du tir | Accord majeur arpégé (3 notes, 40 ms d'écart), avec une octave de plus si Lumière ≥ quota / 2 |
| Or / « ka-ching » | Deux sinus (1 318 et 1 760 Hz, 120 ms), plus un clic de bruit |
| Big Bang | Silence de 300 ms (le master tombe à 0 en 20 ms), puis un accord do-mi-sol-do (sinus et dent de scie filtrée à 1 800 Hz) de 2 s |
| Horizon en danger | « Battement de cœur » : sinus 60 Hz, 2 impulsions de 80 ms toutes les 1,2 s |
| Débordement | Glissando de dent de scie 400 → 80 Hz en 600 ms, filtré |
| Rouleaux de la Constellation | Clics de bruit à 25 Hz qui ralentissent, puis « ding » (sinus 1 568 Hz) à chaque arrêt |
| UI | Tap : sinus 1 200 Hz 15 ms. Confirmation : deux notes (sol, do). Refus : 2 notes descendantes. |

**Musique :** pad génératif de deux accords (do maj7 ↔ la m7, 8 s chacun). Chaque voix est une dent de scie filtrée en passe-bas à 1 200 Hz, avec un LFO de 0,1 Hz sur la coupure. La Lune 1 a 2 voix, et chaque Lune suivante en ajoute une (maximum 5 : basse, pad, arpège de boîte à musique toutes les 2 mesures, etc.). Pendant l'Aube, le passe-bas descend à 700 Hz (effet « feutré »). Aucune musique pendant le Big Bang.

**Vibration :** `navigator.vibrate` si le réglage est actif et que l'API existe.

---

## 12. Architecture technique

### 12.1 Contraintes

HTML, CSS et **JS vanilla**. **Scripts classiques** (pas d'ES modules, pas de `fetch`) pour fonctionner en **`file://`**. Aucun asset externe, aucune dépendance. Tout le contenu est dans des tables JS. Cible : environ 4 000 à 4 500 lignes.

### 12.2 Arborescence et ordre de chargement

```
index.html          (canvas unique, <style> inline, <script src> dans l'ordre ci-dessous)
js/00_core.js       BE.util : maths, clamp, lerp, format fr, FNV-1a, mulberry32, Pool
js/01_data.js       BE.DATA : tailles, familles, réactions, Ombres, boss, reliques, évolutions,
                    clous, gravures, Gardiens, Lunes, quotas, spawns, layouts, salles, défis, éclipses
js/02_save.js       BE.Save : loadMeta/saveMeta/loadRun/saveRun/clearRun (try/catch)
js/03_audio.js      BE.Audio : init(), play(name, params), music.setLune(n), music.duck()
js/04_input.js      BE.Input : pointer events unifiés, clavier, tap vs drag, captures
js/05_physics.js    BE.Phys : stepFlight(world, dt, log), stepJar(jar, dt, log), preview(angle, n)
js/06_firmament.js  BE.Firm : grille, Ombres, boss, descente, spawns, brûlure, gel, éteignoir
js/07_jar.js        BE.Jar : fusions, réactions, pierres, repos, débordement, vidange
js/08_scoring.js    BE.Score : buildCtx(log, state) → ctx ; compute(ctx, relics, finals) → {steps, eclat, mult, lumiere}
js/09_run.js        BE.Run : machine à états du run, nuits, tirs, économie, évolutions
js/10_shop.js       BE.Shop : génération des offres, achat, vente, relance, verrouillage, Constellation
js/11_render.js     BE.Render : sprites pré-rendus, scène, HUD
js/12_fx.js         BE.FX : particules (pool 300), nombres flottants (40), secousse, hitstop, flash
js/13_ui.js         BE.UI : écrans, widgets (Button, Card, Slots drag/aimant), panneaux
js/14_meta.js       BE.Meta : Fragments, Observatoire, défis, Grimoire, Ciel du Jour, partage
js/15_debug.js      BE.Debug : overlay, bots, tests (actif si location.hash contient "debug")
js/99_main.js       bootstrap, redimensionnement, boucle principale
```

Chaque fichier suit ce modèle : `(function (BE) { "use strict"; … })(window.BE = window.BE || {});`

### 12.3 Affichage

- Canvas logique de 360 × 640, mis à l'échelle par `scale = min(innerWidth/360, innerHeight/640)` avec letterbox `--bg0`. Taille du backbuffer : `360 × scale × dpr`, avec `dpr = min(devicePixelRatio, 2)`, et `ctx.setTransform(scale × dpr, …)`.
- Conversion des coordonnées pointeur vers l'espace logique : `(clientX − offsetX) / scale`.
- CSS : `touch-action: none; user-select: none; overscroll-behavior: none;` sur le canvas, ainsi que `<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,viewport-fit=cover">`.

### 12.4 Boucle principale

```js
const DT = 1/120; let acc = 0, last = performance.now(), frame = 0;
function tick(now){
  requestAnimationFrame(tick);
  let el = Math.min(0.1, (now - last)/1000); last = now;
  if (BE.state.paused) { render(); return; }
  if (BE.FX.hitstop > 0) { BE.FX.hitstop -= el; el = 0; }
  acc += el * BE.Run.timeScale();          // 1, 2, 3 ou 4
  let steps = 0;
  while (acc >= DT && steps < 8) { BE.Run.update(DT); acc -= DT; steps++; }
  if (steps === 8) acc = 0;                // on abandonne le retard plutôt que de spiraler
  BE.FX.update(el);
  if (!BE.settings.eco || (frame++ & 1) === 0) BE.Render.draw();
}
```

- En phases statiques (AIM, SHOP, menus), seules les animations ambiantes tournent. En mode Éco, le rendu passe à 30 fps et la logique reste à 120 Hz.
- Sur `visibilitychange` (masqué) et `blur` : `paused = true`, `Audio.suspend()`, puis sauvegarde si l'état est stable.

### 12.5 Machine à états et journal d'événements

```
TITLE → SELECT → NIGHT_INTRO → AIM ⇄ (PAUSE)
AIM --lâcher--> FLIGHT → SETTLE → TURRETS → COUNT → DESCENT → CHECK
CHECK → AIM | NIGHT_WON → (LUNE_END/VIDANGE) → SHOP → NIGHT_INTRO
CHECK → RUN_LOST | RUN_WON → RUN_END → TITLE
```

- **Journal pur :** FLIGHT, SETTLE et TURRETS **ajoutent** des événements dans `log[]` : `{t:"peg",idx,kind}`, `{t:"wall"}`, `{t:"hit",shadow,dmg}`, `{t:"kill",type}`, `{t:"land"}`, `{t:"merge",size,pure,colors,reaction}`, `{t:"stone"}`, `{t:"bigbang",sizes}`, `{t:"gold",n}`, `{t:"absorb"}`.
- `BE.Score.compute(BE.Score.buildCtx(log, state), relics, finals)` est une **fonction pure** qui renvoie `steps[]` (par exemple `{src:"base",eclat:24,mult:3.5}`, `{src:"R13",dMult:4}`, `{src:"R14",xMult:2}`…) et le total. COUNT **rejoue** `steps` pour l'animation.
- **Aperçu de relique en boutique :** on garde `lastCtx` et on recalcule `compute(lastCtx, relicsAvecCandidate)`. L'aperçu est exact.
- **Reliques :** objets déclaratifs, par exemple

```js
{id:"R14", nom:"Balance", rar:"PC", tags:["xMULT","BOCAL"], hook:"count",
 txt:"×2 Mult si le bocal est rempli à moins de 50 %",
 count: c => c.jarFill < 0.50 ? {xMult:2} : null}
```

  Hooks possibles : `count(ctx)`, `flight:{restPeg, dmgBonus, onLaunch}`, `passive:{interestCap, swaps, horizon, previewContacts}`. `BE.Run` agrège les passifs à chaque changement de reliques.

### 12.6 Reprise, déterminisme et anti-save-scum

- Au lâcher, on écrit `phase:"PENDING_SHOT", pendingAngle`. Au chargement, si `PENDING_SHOT` est trouvé, le jeu restaure l'état d'avant le tir et **rejoue automatiquement le tir avec le même angle** (même étoile, même physique, donc même résultat sur le même appareil).
- **Flux RNG séparés** (mulberry32 initialisé par `FNV(seed + nom)`) : `bag`, `shop`, `waves`, `pegs`, `misc`. Relancer la boutique ne modifie jamais les vagues.
- Le bocal n'est sérialisé **qu'au repos** (positions, vitesses nulles). Au rechargement, on lance 30 pas de stabilisation silencieux, sans fusions ni journal.

### 12.7 Performance mobile

- Budget par frame : ≤ 8 ms de logique et ≤ 6 ms de rendu sur un appareil Android d'entrée de gamme (2021). Au pire : 60 corps dans le bocal, 4 étoiles en vol, 300 particules.
- Pools : particules 300, nombres 40, segments d'éclair 64, étoiles en vol 8. **Aucune allocation dans la boucle chaude** (vecteurs en variables scalaires).
- Texte : les libellés statiques du HUD sont mis en cache dans des canvas hors écran et régénérés seulement quand leur valeur change.
- Aperçu de trajectoire : simulation fantôme limitée à 240 pas, recalculée seulement quand l'angle change de plus de 0,2°.

---

## 13. Plan de test et d'équilibrage

### 13.1 Outils de debug (`index.html#debug`)

- Overlay : FPS, ms logique/rendu, nombre de corps, particules, phase, graine, flux RNG.
- Raccourcis : `G` +50 or, `N` gagner la nuit, `J` remplir le bocal d'étoiles aléatoires, `B` ajouter une relique au choix, `K` tuer toutes les Ombres, `1..7` lâcher une étoile de cette taille à la souris, `T` lancer les tests unitaires.
- **Bots headless** (`BE.Debug.simulate({runs, policy, gardien, eclipse})`), sans rendu, à environ 200× le temps réel :
  - `random` : angle uniforme dans [12°, 168°].
  - `greedy` : 24 angles testés sur une copie de l'état, on garde la Lumière maximale.
  - `safe` : score = Lumière − 500 × (remplissage > 0,7).
  - Politique de boutique : acheter la relique la plus chère abordable si un emplacement est libre, sinon une étoile de taille 3, et épargner jusqu'à 10 or à partir de la Lune 2.
  - Sortie (tableau en console et CSV copiable) : taux de réussite par nuit, tirs moyens par nuit, remplissage moyen en fin de nuit, or moyen, cause des défaites, Lumière/tir par Lune, fréquence des réactions et des tailles de fusion.

### 13.2 Tests unitaires (`BE.Debug.tests`)

1. `Score.compute` : 12 cas fixes (base seule ; +Mult puis ×Mult comparé à l'ordre inverse ; Catalyseur à 2 réactions = ×2,25 ; Big Bang ; Insomniaque ; L'Éclipse ÷2 ; Aurore).
2. Pureté et Mult de fusion (tableau §5.2, ×1,5 arrondi au 0,5 supérieur, Forgeronne ×2, Alchimiste).
3. Évolutions : condition « 3 réactions et Laboratoire construit », remplacement dans le même emplacement.
4. Économie : intérêts calculés avant la récompense, plafonds 5/8/3/0, vente à ⌊prix/2⌋ minimum 1, relance +1.
5. RNG : même seed donne les mêmes 1 000 tirages par flux ; relancer la boutique ne change pas `waves`.
6. Sauvegarde : aller-retour de `run` (sérialiser, désérialiser, comparer profondément) ; reprise d'un `PENDING_SHOT` avec un hash de résultat identique.
7. Physique : (a) 40 étoiles aléatoires lâchées donnent un repos en moins de 6 s dans 99 % des cas et aucun corps hors des murs ; (b) aucun tunneling contre les clous à 900 px/s (10 000 lancers) ; (c) nombre de fusions conservé (masse d'aire croissante non attendue, mais le nombre de corps diminue exactement de 1 par fusion) ; (d) déterminisme : 100 tirs identiques donnent 100 hash d'état identiques.
8. Débordement : détection au repos seulement. La Bougie fait évaporer exactement les corps qui dépassent.
9. Ombres : descente bloquée si la cellule est occupée, Nuée qui se divise, Voleuse qui absorbe, armure de la Blindée, Éteignoir qui éteint 4 clous, gel qui saute une descente.

### 13.3 Cibles d'équilibrage (Éclipse 0, bot `greedy`, 500 runs)

| Mesure | Cible |
|---|---|
| Réussite Lune 1 (les 3 nuits) | ≥ 97 % |
| Réussite Lune 3 | 55 à 70 % |
| Victoire (Lune 5) | 15 à 25 % |
| Tirs moyens par nuit gagnée | 4,2 ± 1 |
| Défaites par Débordement | 15 à 35 % du total |
| Remplissage moyen en fin de Nuit du Boss (Σ aires / capacité, §4) | 55 à 75 % |
| Or moyen dépensé par run | 90 à 130 |
| Durée simulée d'un run gagné (temps réel estimé) | 10 à 14 min |
| Big Bang | < 3 % des runs (Insomniaque : cible 10 à 20 % **suspendue** depuis la v1.1 ; mesurée, affichée N/A — voir la note ci-dessous) |

**Échelle du remplissage (v1.1b).** La cible 55–75 % se lit sur la **jauge** (§4 : max(Σ aires / capacité, hauteur du tas), capacité = surface utile × 0,6), pas sur la surface brute comme en v1.0 : 58 % de jauge ≈ 35 % de la surface brute sous l'horizon. `tools/balance.js` affiche les trois lectures (jauge toutes nuits, jauge des seules Nuits du Boss gagnées, part surfacique brute) ; la moyenne « toutes nuits » est tirée vers le haut par les Nuits du Boss perdues (souvent par Débordement, donc à 100 %), la valeur « nuits gagnées seules » doit rester ≥ 50 %.

**Big Bang (v1.1b).** Deux Trous Noirs qui se touchent fusionnent (les fusions se font au contact, le Débordement n'est vérifié qu'au repos) : ce n'est donc pas « deux Trous Noirs ne tiennent pas sous l'horizon » qui bloque le Big Bang, mais le chemin pour y arriver — un Trou Noir (Ø 116) doit cohabiter avec les deux Novas (Ø 100) qui en feront un second. Avec les rayons v1.1b (Nova 50, Trou Noir 58), le Trou Noir redevient atteignable (≈ 3 % des runs de L'Insomniaque, quelques runs Forgeronne / Alchimiste) mais le Big Bang reste un exploit : le défi D08 et la Singularité sont des récompenses rares, c'est voulu. La cible Insomniaque 10–20 % reste suspendue.

**Viabilité des archétypes (§13.5, v1.1b).** À chaque changement de géométrie du bocal on vérifie, dans un bac à sable (`BE.Debug.withRun`), que les tailles dont dépend un archétype tiennent sous l'horizon le plus bas (492) : Trou Noir seul, Trou Noir + Astre, Nova + Géante côte à côte (tests « Débordement » de `tools/test.js`). Un archétype dont la pièce maîtresse ne peut pas exister dans le bocal est du contenu mort.

**Accueil (v1.1)** : le bot `random` (visée uniforme) doit réussir la Lune 1 dans **≥ 60 %** des runs (400 runs). Chaque Gardien doit rester gagnable et non trivial au bot `greedy` (200 runs, victoire entre ≈ 5 et 40 %).

**Leviers à ajuster, dans cet ordre :** quotas (§6.1) → rayons des tailles (pression du bocal) → HPmult → apparitions par tir → valeurs de Mult des fusions → prix. On ne modifie qu'un seul levier par itération, puis on relance les 500 runs.

**Détection des builds dominants :** si une relique apparaît dans plus de 60 % des runs gagnés (bot avec achat aléatoire pondéré), on baisse sa valeur de 20 % ou on monte sa rareté d'un cran.

### 13.4 Tests de jeu humains (checklist)

1. **Test des 30 s :** 5 personnes qui n'ont jamais joué, sans explication. Elles doivent tirer, voir une fusion et comprendre « bleu × rouge » en moins de 30 s (observé en silence).
2. **Lisibilité :** sur un vrai téléphone de 360 × 640 dp, lire les badges de PV et les compteurs à bout de bras. Aucun badge masqué par des particules.
3. **Occlusion du pouce :** la ligne d'aperçu reste visible avec le doigt dans le bocal, avec les deux modes de visée.
4. **Interruption :** tuer l'application pendant le vol, la résolution, le décompte et la boutique. La reprise doit se faire au bon état et le tir doit être rejoué à l'identique.
5. **Hors ligne :** mode avion, ouverture en `file://` sur desktop, et en navigation privée (la sauvegarde indisponible ne doit pas faire planter le jeu).
6. **Performance et batterie :** 30 min de jeu sur un appareil Android d'entrée de gamme : pas de saccade de plus de 50 ms, batterie consommée ≤ 10 %, température correcte. En mode Éco, la consommation doit baisser nettement.
7. **Accessibilité :** mode daltonien testé avec un simulateur deutéranope/protanope (les 4 familles restent distinguables par le motif). Sans secousse ni flash, aucun effet violent ne reste.
8. **Ciel du Jour :** deux appareils le même jour donnent la même vague, le même Gardien, la même relique et les mêmes offres de boutique.
9. **Ressenti :** après 10 runs, chaque testeur doit citer au moins 2 archétypes qu'il veut essayer, ce qui valide la découverte.

### 13.5 Archétypes attendus (vérifier qu'ils sont viables)

- **FLIPPER :** Sève, Comète, Clous Ressort en paire, Écho, Balance. Beaucoup de rebonds et un bocal peu rempli.
- **TOUR DE BABEL :** Sac monocolore, Alchimiste, Couronne, Forgeronne. Fusions pures et Trou Noir.
- **TOURELLE :** Foudre, Paratonnerre, Plasma, Chasseur. Le bocal nettoie le Firmament.
- **DÉCHETS :** Corbeau, Carrière, Braise, Cendre, puis Fonderie. On laisse passer les Lourdes pour les briser.
- **VAPEUR / PRESSION :** Braise et Givre, Pression, Vapeur, Catalyseur. On joue avec un bocal plein et tassé.
- **ÉCONOMIE :** Le Comptable, Tirelire, Glaneur, Clou d'or. Beaucoup d'épargne et des nuits courtes.

Contre-menaces lisibles : Blindée contre les petites étoiles (Flipper, Poids plume), Éteignoir contre les builds de clous, Voleuse contre les petites étoiles, L'Étau et La Grêle contre Pression, La Faim contre Babel.

---

## 14. Hors périmètre v1 (volontairement retiré)

Famille Néant, Gardiens Funambule et Somnambule, Étiquettes (passer une nuit contre un bonus), classement en ligne, synchronisation cloud, orientation paysage dédiée (en paysage, le jeu reste en portrait avec letterbox), localisation (tout est en français en v1), cosmétiques au-delà de D16.