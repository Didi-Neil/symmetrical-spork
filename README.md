# Bocal d'Étoiles

Jeu mobile (web, portrait) conçu à partir des qualités des jeux mobiles indé à succès de 2021 à 2026.

- `docs/JEUX_ETUDIES.md` : les 47 jeux étudiés
- `docs/PILIERS.md` : les piliers de design et les mécaniques qu'ils ont en commun
- `docs/GDD.md` : le document de design complet, qui fait référence

## Lancer le jeu

- **Le plus simple :** ouvre `index.html` dans un navigateur récent (Chrome, Firefox, Safari, Edge). Le jeu fonctionne
  directement depuis le disque (`file://`), hors ligne, sans installation ni dépendance.
- **Sur téléphone ou pour partager :** sers le dossier avec n'importe quel serveur statique, par exemple
  `python3 -m http.server 8000` (ou `npx serve .`), puis ouvre `http://<adresse-de-la-machine>:8000` sur le téléphone.
  Le jeu est pensé pour le mode portrait, joué d'un seul pouce.
- La progression (Fragments, salles, défis, run en cours) est enregistrée dans le navigateur (`localStorage`). En
  navigation privée stricte, le jeu reste jouable mais rien n'est sauvegardé.

## Comment jouer

1. **Vise et lance.** Pose le doigt (ou maintiens le clic), glisse pour orienter le Phare, relâche pour lancer
   l'étoile. Remonte le doigt vers la barre du haut pour annuler. Au clavier : ←/→ pour viser, Espace pour lancer.
2. **Rebondis.** Chaque clou touché donne de l'**Éclat** (bleu). Chaque Ombre touchée perd autant de PV que la taille de
   l'étoile et donne +3 Éclat.
3. **Fusionne.** L'étoile tombe dans le bocal. Deux étoiles de même taille fusionnent et rapportent du **Mult** (rouge) ;
   deux couleurs différentes déclenchent une réaction (Vapeur, Plasma, Tempête…). Deux Novas donnent un **Trou Noir**
   compact ; un Trou Noir qui touche une Géante, une Nova ou un autre Trou Noir déclenche le **Big Bang** (×10).
4. **Brille.** Au décompte, tes reliques s'activent de gauche à droite, puis Lumière = Éclat × Mult s'ajoute à la
   jauge. Atteins le **quota** de la nuit avant d'avoir épuisé tes 6 tirs (8 en Lune 1 : les 2 derniers,
   pastilles creuses bleutées, sont des tirs d'apprentissage, qui ne rapportent pas d'or s'ils restent inutilisés).
5. **Attention au bocal.** Il est étroit et reste plein pendant les 3 nuits d'une Lune. La jauge à droite du bocal
   monte avec la place occupée **et** avec la hauteur du tas : à 100 %, le tas touche la ligne d'horizon. La ligne
   passe à l'**ambre** quand l'étoile que tu tiens, posée sur le tas, la dépasserait, puis au **rouge** (battement de
   cœur) quand le tas la frôle. Si un objet au repos dépasse la ligne, c'est le **Débordement** (la Bougie te sauve
   une fois ; avant elle, la Nova la plus basse s'**effondre** en Trou Noir pour faire de la place) : fusionner,
   c'est aussi faire de la place. Gagner la nuit avant évapore le trop-plein. Les Ombres
   descendent quand leur compteur arrive à 0 ; en bas, elles tombent dans le bocal en Pierres Noires.
6. **À l'Aube** (après chaque nuit gagnée), dépense ton or : reliques, étoiles, clous spéciaux, gravures, paquet
   Constellation. Tape une relique pour voir son effet chiffré ; glisse-les pour changer leur ordre.
7. **Gagne** en passant la Nuit du Boss de la Lune 5 (L'Éclipse). Tes Fragments ◇ allument les salles de
   l'Observatoire, qui ajoutent du contenu aux runs suivants.

Astuces : les tirs longs accélèrent tout seuls (vol ×2, ×3 puis ×4 à partir de 3 s ; bocal ×2 puis ×3) ; maintiens le doigt pour aller encore plus vite, touche l'écran pendant le décompte pour le passer, touche
« SUIV. » pour échanger l'étoile courante avec la suivante (1 fois par nuit), et le Sac pour voir ce qu'il reste dans
la pioche.
