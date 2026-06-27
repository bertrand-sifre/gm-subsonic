# @vdm/server

API du serveur (Hono + @hono/node-server). Deux responsabilités pour le MVP :
**scanner la bibliothèque** et **streamer les fichiers audio**. Écoute sur le port
`8787` (sur `0.0.0.0` par défaut, donc joignable depuis l'hôte dans Docker).

## Architecture (modules par responsabilité)

`src/main.ts` n'est qu'un **bootstrap** (~30 l.) : prépare le cache, scanne, monte l'app,
écoute. La logique vit dans des modules dédiés :

- `config.ts` — chemins, port, garde-fous de rendu, `SAMPLE_RATE`, binaire `nsftool`, types MIME.
- `http/routes.ts` — `createApp(scan)` : routes `/api/*` (fines) + montage de l'API Subsonic.
- `http/serve-file.ts` — `serveFile` + parsing **Range** (RFC 7233).
- `http/subsonic/` — API **Subsonic** minimale sur `/rest/*` (cf. section dédiée plus bas).
- `stream.ts` — `resolveStream(scan, id, …)` : résolution id → fichier servable, **partagée**
  par `/api/stream` et `/rest/stream` (les deux systèmes streament à l'identique).
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
| GET | `/rest/:verb(.view)` | API **Subsonic** (browse + play) — cf. section dédiée |

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

## API Subsonic (`/rest/*`) — registry de verbes

Le serveur parle aussi l'**API Subsonic/OpenSubsonic** (compat clients tiers : Symfonium,
Feishin, airsonic-refix…), montée sur `/rest/*` **à côté** de `/api/*` — les deux serveurs
coexistent dans le même process (`mountSubsonic(app, scan)` appelé depuis `createApp`).

Structure (`http/subsonic/`) :

- `index.ts` — `mountSubsonic` : agrège le registre `VERBS` et expose **un seul dispatcher**
  `/rest/:verb` (strip `.view`, contrôle des `requires`, délégation au handler).
- `types.ts` — `Verb` (`{ requires?, handle }`) / `VerbDeps` / `VerbMap`.
- `errors.ts` — codes d'erreur Subsonic (`ERR.GENERIC` 0 / `MISSING_PARAM` 10 / `NOT_FOUND` 70).
- `respond.ts` — enveloppe `subsonic-response` + sérialiseur `SNode` → **XML *et* JSON** (`?f=json`).
- `catalog.ts` — adaptateur jeu→album / compositeur→artiste / morceau→chanson (construit au mount).
- `nodes.ts` — constructeurs de nœuds (`artistNode`/`albumNode`/`songNode`/`artistsNode`).
- `verbs/` — **un fichier par ressource** : `system.ts`, `artists.ts`, `albums.ts`, `media.ts`,
  `favorites.ts` ; chacun exporte une `VerbMap`.

**Ajouter un verbe = une entrée déclarative** `{ requires?, handle }` dans le fichier de sa
ressource (puis un spread dans `index.ts` si c'est une ressource neuve). **Pas de `switch`.**

### Choix d'architecture (assumés)

- **On garde Hono, pas de migration NestJS.** Le « gros switch » était un dispatcher écrit à la
  main, pas une fatalité de Hono → remplacé par un **registry déclaratif**. NestJS aurait imposé
  une réécriture complète (DI/décorateurs/build) pour un petit serveur, **sans** résoudre le vrai
  morceau (la sérialisation Subsonic), qu'on garderait à la main de toute façon.
- **Subsonic = spec EXTERNE FIGÉE** : on n'améliore que l'intérieur (registry + validation des
  params + codes d'erreur), jamais la forme du wire. Pas d'OpenAPI dessus (verbe dynamique + XML).
- **Sérialiseur `SNode` maison conservé** : aucune lib ne produit À LA FOIS le XML Subsonic ET son
  JSON `?f=json` à plat (attributs→propriétés, listes→tableaux).
- **`/api/*` reste du REST** ; le streaming binaire (Range/206) reste hors de tout contrat typé.
- **Trajectoire** (si `/api` grossit en T2) : client `hc` natif de Hono (typé, zéro install) + `zod`
  pour la validation — délibérément différé tant que `/api` reste minimal (analyse d'archi 2026-06-27).

## À venir

Rendu ffmpeg « **intro + N boucles + fondu** » pour offrir aux clients Subsonic une chanson de
**durée normale** (aujourd'hui un morceau bouclé sert l'artefact de boucle, court). Verbes Subsonic
ajoutés réactivement au besoin (`search3`, `star`/`unstar`, `getGenres`…).
