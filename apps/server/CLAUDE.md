# @vdm/server

API du serveur (Hono + @hono/node-server). Deux responsabilités pour le MVP :
**scanner la bibliothèque** et **streamer les fichiers audio**. Écoute sur le port
`8787` (sur `0.0.0.0` par défaut, donc joignable depuis l'hôte dans Docker).

## Fichiers

- `src/main.ts` — app Hono, routes, démarrage, résolution du dossier `media/`, streaming
  avec support des requêtes **Range** (HTTP 206).
- `src/library.ts` — `scanLibrary(mediaDir)` : lit `media/meta.json`, lit la durée réelle
  via `music-metadata`, construit la `Library` (regroupée par jeu) + l'index `id → chemin`.

## Endpoints

| Méthode | Route | Rôle |
|---|---|---|
| GET | `/api/health` | `{ ok: true }` |
| GET | `/api/library` | bibliothèque regroupée par jeu (`Library` de `@vdm/shared`) |
| GET | `/api/stream/:id` | streaming audio, Range/206, `Accept-Ranges`, `Content-Range` |

## Lancer

```bash
nx serve server      # = tsx watch src/main.ts (hot reload)
nx run server:typecheck
```

Pas de build de prod : le serveur tourne via **tsx** (TypeScript exécuté directement).

## Conventions / points sensibles

- **ESM strict** : les imports relatifs portent l'extension `.js` (`./library.js`), résolue
  par tsx et par TypeScript.
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
