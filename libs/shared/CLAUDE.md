# @vdm/shared

Types TypeScript partagés entre le serveur et le client web. Un seul fichier source :
`src/index.ts`. Importé via l'alias **`@vdm/shared`** (paths TS + workspace npm).

## Contenu

- `LoopInfo` — `{ loopStart, loopEnd }` en **secondes**.
- `Track` — morceau jouable : `id`, `title`, `game`, `composer?`, `platform?`, `duration`,
  `loop?`, `streamUrl`.
- `GameGroup` / `Library` — morceaux regroupés par jeu (organisation produit centrale).
- `PlaybackMode` — `'once' | 'loopInfinite' | 'loopCount' | 'loopCountFade'`.
- `PlaybackOptions` — `{ mode, loopCount, fadeSeconds }`.

## Convention : paquet « source only »

Pas de build : `main`/`types`/`exports` pointent directement vers `src/index.ts`. Les
consommateurs (tsx côté serveur, Vite côté web) lisent le TypeScript tel quel.

## Règles

- **Agnostique de l'environnement** : ces types sont consommés à la fois par le navigateur
  (`web`) et par Node (`server`). Ne pas y importer de types Node/DOM ni de runtime.
- **Périmètre MVP** : on ne décrit ici que ce qui sert à la lecture intro/boucle/fin. Les
  champs `variants`, `stems`, `layers` arriveront avec les tranches 4-5 — les ajouter ici
  quand on s'y attaque, pas avant.
