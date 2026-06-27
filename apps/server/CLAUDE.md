# @vdm/server

API du serveur (Hono + @hono/node-server). Deux responsabilités pour le MVP :
**scanner la bibliothèque** et **streamer les fichiers audio**. Écoute sur le port
`8787` (sur `0.0.0.0` par défaut, donc joignable depuis l'hôte dans Docker).

## Architecture (modules par responsabilité)

`src/main.ts` n'est qu'un **bootstrap** (~30 l.) : prépare le cache, scanne, monte l'app,
écoute. La logique vit dans des modules dédiés :

- `config.ts` — chemins, port, garde-fous de rendu, `SAMPLE_RATE`, binaire `nsftool`, types MIME.
- `http/routes.ts` — `createApp(scan)` + handlers Hono (fins : délèguent au rendu + au service).
- `http/serve-file.ts` — `serveFile` + parsing **Range** (RFC 7233).
- `library/` — scan des manifestes → `ScanResult` :
  - `scan.ts` (`scanLibrary`, **registry de builders**), `manifest.ts`, `slug.ts`,
  - `types.ts` (`MetaTrack`, refs de rendu, `ScanResult`, `BuildContext`/`TrackBuilder`),
  - `builders/static.ts` (`staticBuilder`) + `builders/emulated.ts` (`emulatedBuilder`).
- `render/` — rendu OGG **à la demande** (cache + dédoublonnage) :
  - `index.ts` (`ensureParametricRender`/`ensureLoopRender`/`ensureChannelRender`, `renderSeamless`),
  - `exec.ts` (spawn), `cache.ts` (`ensureCached` + map inflight), `encode.ts` (crossfade + tags),
  - `engines/` — **interface `PcmEngine`** (`types.ts`) + `libgme.ts` (mix + paramétrique) + `nsftool.ts` (voix solo).

**Points d'extension** : un nouveau moteur audio (USF/SPC…) = un fichier dans `engines/`
implémentant `PcmEngine` ; une nouvelle famille de source = un `TrackBuilder` dans
`library/builders/`. Boucle et stems partagent `renderSeamless` (le moteur est choisi par
`SeamlessRenderRef.channelIndex` : absent → mix libgme, présent → voix nsftool).

## Endpoints

| Méthode | Route | Rôle |
|---|---|---|
| GET | `/api/health` | `{ ok: true }` |
| GET | `/api/library` | bibliothèque regroupée par jeu (`Library` de `@vdm/shared`) |
| GET | `/api/stream/:id` | streaming audio, Range/206, `Accept-Ranges`, `Content-Range` |
| GET | `/api/stream/:id/channel/:chan` | stem d'une voix (rendu à la demande), 404 → repli mix |

## Lancer

```bash
nx serve server      # = tsx watch src/main.ts (hot reload)
nx run server:typecheck
```

Pas de build de prod : le serveur tourne via **tsx** (TypeScript exécuté directement).

## Conventions / points sensibles

- **ESM strict** : les imports relatifs portent l'extension `.js` (`./library/scan.js`),
  résolue par tsx et par TypeScript.
- `tsconfig.json` fixe `customConditions: ["node"]` — **nécessaire** : `music-metadata@10`
  n'expose `parseFile` que via la condition d'export `node` ; sans cela, `moduleResolution:
  "Bundler"` résout la branche `default` (sans `parseFile`) et le typecheck casse (TS2305).
- `types: ["node"]` (tsconfig) → dépend de `@types/node` (déclaré à la racine).
- `MEDIA_DIR` est résolu depuis `import.meta.url` (`../../../media`), donc **indépendant du
  cwd**. Ne pas le baser sur `process.cwd()`.
- **Streaming** : on utilise `Readable.toWeb(createReadStream(...))` pour bénéficier de la
  **backpressure** native (ne pas réintroduire un wrapper `ReadableStream` maison qui
  bufferise tout en mémoire).
- **Range** conforme RFC 7233 : borne de fin tronquée à `size-1` (pas de 416 superflu),
  suffix-range `bytes=-N` géré, 416 seulement si plage réellement invalide. Toute
  modification du parsing Range doit préserver ces cas (cf. tests `curl` dans l'historique).

## À venir

T3 ajoutera ici l'**API Subsonic** et le **rendu ffmpeg** (intro + N boucles + fondu →
flux unique) pour les clients classiques.
