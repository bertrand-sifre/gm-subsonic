# @vdm/web

Front **Svelte 4 + Vite 5**. Navigateur de bibliothèque (regroupé par jeu) et lecteur
de musiques de jeu. Sert sur le port `5173`, avec un proxy `/api → http://localhost:8787`.

## Fichiers

UI inspirée des lecteurs de streaming (Spotify/SoundCloud) : coquille 3 colonnes
(sidebar / centre / lecture en cours) + barre de lecture en pied de page.

- `src/App.svelte` — **coquille** : grille 3 colonnes + barre du bas, init de la
  bibliothèque, responsive. Toute la logique est déléguée au store.
- `src/lib/player.ts` — **store central** (stores Svelte) : pilote le `LoopPlayer`,
  file de lecture (next/prev/shuffle/repeat), favoris + historique (localStorage),
  navigation, état des canaux (volume/mute/solo), volume master, recherche. Boucle
  rAF UNIQUE mettant à jour `progress` + `frame` (déclencheur de redraw des canvas).
- `src/lib/LoopPlayer.ts` — **cœur audio**. Lecteur Web Audio : intro/boucle/queue,
  fondu, **mixage de stems** (gain par voix), **volume master** (indépendant du fondu),
  **seek** (re-planif à offset arbitraire) et `getPeaks()` (forme d'onde réelle).
- Composants : `Sidebar` (nav : Accueil/Bibliothèque/Compositeurs/Favoris/Historique),
  `CenterView` (routeur de vues), `GameDetail`, `TrackList`, `NowPlaying` (transport,
  modes, structure, mixer, infos), `ChannelMixer`, `StructureBar`, `Waveform`,
  `PlayerBar`, `Icon` (SVG inline).
- `src/lib/cover.ts` — placeholders déterministes (dégradé + initiales) pour les
  métadonnées absentes du backend (pas de jaquette). `src/lib/format.ts` — fmt temps.
- `src/theme.css` — **tokens de design globaux** (couleurs/rayons/dimensions) ; tout
  composant s'y réfère via `var(--…)`, pas de couleurs en dur.
- `src/lib/api.ts` — `fetchLibrary()` + gestion : `fetchLibraryStatus()`, `triggerImport()`,
  `uploadFiles()`, `setWatch()` (endpoints `/api/library/status|import|upload|watch`).
- **Gestion de bibliothèque** : `Settings.svelte` expose le toggle « Surveiller le dossier ». Le
  bouton **Importer** de l'en-tête Bibliothèque (`CenterView`) ouvre `ImportDialog.svelte`, une
  modale de DÉPÔT de fichiers (glisser-déposer ou sélection) qui les téléverse dans `library/` ;
  le serveur les catalogue puis renvoie la bibliothèque fraîche (acceptés / rejetés affichés). Le
  store (`libraryStatus`/`importing`/`importError`/`importOpen`/`uploadResult` + actions
  `uploadLibraryFiles`, `importLibrary`, `setWatchLibrary`, `refreshLibraryStatus`) scrute
  `/api/library/status` (5 s, en pause si onglet masqué) et recharge la bibliothèque quand un
  import (dépôt, manuel ou surveillance) survient.
- `src/main.ts` — montage de l'app (importe `theme.css`).

> ⚠️ **Pièges réactivité Svelte 4** : un `$: x = f()` où `f` lit des stores/vars NON
> passés en argument n'est JAMAIS recalculé (dépendance invisible). Toujours passer les
> dépendances en argument (`f($store, …)`). Mode de lecture par défaut : `loopCount` à
> 2 boucles → lecture FINIE → `onEnded` enchaîne la file ; `loopInfinite` épingle une piste.

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
