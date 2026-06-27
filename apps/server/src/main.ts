/**
 * Point d'entrée du serveur : prépare le cache, scanne la bibliothèque, monte
 * l'app Hono et écoute. Toute la logique vit dans les modules dédiés :
 *  - `config.ts`   chemins, port, garde-fous, types MIME ;
 *  - `library/`    scan des manifestes -> ScanResult (registry de builders) ;
 *  - `render/`     rendu à la demande (moteurs PCM + encode + cache) ;
 *  - `http/`       routes Hono + service de fichier avec Range.
 */

import { mkdir } from 'node:fs/promises';
import { serve } from '@hono/node-server';
import { CACHE_DIR, LIBRARY_DIR, MEDIA_DIR, PORT } from './config.js';
import { createApp } from './http/routes.js';
import { scanLibrary } from './library/scan.js';

async function main() {
  await mkdir(CACHE_DIR, { recursive: true });
  const scan = await scanLibrary(MEDIA_DIR, LIBRARY_DIR);
  const count = scan.files.size + scan.renders.size;
  console.log(`[vdm] bibliothèque chargée : ${count} morceau(x), ${scan.library.games.length} jeu(x)`);

  const app = createApp(scan);
  serve({ fetch: app.fetch, port: PORT }, ({ port }) => {
    console.log(`[vdm] serveur en écoute sur http://localhost:${port}`);
  });
}

main().catch((err) => {
  console.error('[vdm] échec du démarrage :', err);
  process.exit(1);
});
