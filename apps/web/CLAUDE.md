# @vdm/web

Front **Svelte 4 + Vite 5**. Navigateur de bibliothèque (regroupé par jeu) et lecteur
de musiques de jeu. Sert sur le port `5173`, avec un proxy `/api → http://localhost:8787`.

## Fichiers

- `src/App.svelte` — UI : liste par jeu, sélection d'un morceau, contrôles (comportement,
  nombre de boucles, durée de fondu), transport play/stop, état de lecture.
- `src/lib/LoopPlayer.ts` — **cœur du projet**. Lecteur Web Audio reproduisant les
  particularités d'une musique de jeu.
- `src/lib/api.ts` — `fetchLibrary()` (appel `/api/library`).
- `src/main.ts` — montage de l'app.

## LoopPlayer — modèle de lecture

Un morceau = un fichier + deux repères `loopStart` / `loopEnd` (secondes) :

```
[==== intro ====|==== boucle ====|== queue ==]
0           loopStart        loopEnd        durée
```

Comportements (`PlaybackMode` de `@vdm/shared`) : `once`, `loopInfinite`,
`loopCount` (N boucles puis queue), `loopCountFade` (N boucles puis fondu).

Règles importantes, **à préserver** en cas de modification :

- **Web Audio, pas `<audio>`** : seul Web Audio permet de boucler à l'échantillon près et
  d'enchaîner boucle→queue sans trou. C'est aussi ce qui rendra possible le mixage de
  stems (tranche 4).
- La **fin de lecture est pilotée par `onended`** du nœud terminal (horloge audio), JAMAIS
  par `setTimeout` : un timer mural se déclenche trop tôt après un `suspend()` (pause) et
  tronquerait la lecture.
- `loopCount` : `loopPart.stop(endOfLoops)` puis `tail.start(endOfLoops, loopEnd)` →
  l'intro est jouée 1 fois, la section de boucle exactement `repeats` fois, puis la queue.
- `loopCountFade` : si le fondu est plus long que la lecture, il est raccourci pour finir
  pile à `endOfLoops` (on conserve `repeats` boucles).
- `decodeAudioData` charge le **fichier entier** (les boucles d'OST font quelques Mo, c'est
  acceptable). La lecture Web Audio exige un **geste utilisateur** (le bouton lance/relance
  le contexte).

## Lancer

```bash
nx serve web         # = vite
nx run web:typecheck # = svelte-check
nx build web         # = vite build
```

## Conventions / points sensibles

- **Svelte 4** (pas 5) → `@sveltejs/vite-plugin-svelte` **v3** (v4+ exige Svelte 5).
  Ne pas monter ces versions sans intention.
- `vite.config.ts` est réglé pour Docker : `host: true`, `strictPort`, `hmr.clientPort`,
  `watch.usePolling`. Ne pas retirer ces options (sinon Vite injoignable depuis l'hôte / pas
  de hot-reload sur bind-mount).
- L'app déclare ses propres devDeps (svelte, vite, plugin) en plus de la racine, pour la
  portabilité (pnpm) — garder les versions alignées avec la racine.
