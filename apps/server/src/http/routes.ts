/**
 * Routes HTTP (Hono). Les handlers restent FINS : ils résolvent l'id via
 * `resolveStream` (partagé avec l'API Subsonic), délèguent le rendu à `render/`
 * (cache + dédoublonnage) et le service du fichier à `serve-file.ts`.
 *
 * L'API maison vit sous `/api/*` ; l'API Subsonic (montée par `mountSubsonic`)
 * vit sous `/rest/*` — les deux systèmes coexistent sur le même serveur.
 */

import { existsSync } from 'node:fs';
import { relative } from 'node:path';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { WEB_DIR } from '../config.js';
import type { ScanResult } from '../library/types.js';
import { ensureChannelRender } from '../render/index.js';
import { resolveStream } from '../stream.js';
import { serveFile } from './serve-file.js';
import { mountSubsonic } from './subsonic/index.js';

export function createApp(scan: ScanResult): Hono {
  const app = new Hono();
  app.use('*', cors());

  app.get('/api/health', (c) => c.json({ ok: true }));

  app.get('/api/library', (c) => c.json(scan.library));

  /** Streaming d'un morceau (statique, artefact de boucle, ou OGG paramétrique). */
  app.get('/api/stream/:id', async (c) => {
    const id = c.req.param('id');
    try {
      const path = await resolveStream(scan, id, c.req.query('seconds'), c.req.query('fade'));
      if (!path) return c.notFound();
      return serveFile(c, path);
    } catch (err) {
      console.error(`[vdm] rendu échoué (${id}):`, err);
      return c.text('render failed', 500);
    }
  });

  /** Streaming d'un stem (une voix), rendu à la demande. 404 -> repli sur le mix. */
  app.get('/api/stream/:id/channel/:chan', async (c) => {
    const id = c.req.param('id');
    const chan = c.req.param('chan');
    const ref = scan.channelRenders.get(`${id}::${chan}`);
    if (!ref) return c.notFound();
    try {
      return serveFile(c, await ensureChannelRender(id, chan, ref));
    } catch (err) {
      console.error(`[vdm] rendu canal échoué (${id}/${chan}) :`, err);
      return c.text('render failed', 500);
    }
  });

  // API Subsonic minimale (browse + play), montée sur /rest/*.
  mountSubsonic(app, scan);

  // Production « tout-en-un » : si le SPA buildé est présent, on le sert à la
  // racine (assets + index.html) avec fallback SPA pour les deep-links. Les
  // routes /api et /rest sont déclarées AVANT, donc prioritaires. En dev,
  // `apps/web/dist` n'existe pas → bloc ignoré (Vite sert le front, proxy /api).
  if (existsSync(WEB_DIR)) {
    // serveStatic résout `root` relativement au cwd : on dérive le chemin depuis
    // le cwd courant pour rester indépendant du répertoire de lancement.
    const webRoot = relative(process.cwd(), WEB_DIR) || '.';
    app.use('/*', serveStatic({ root: webRoot }));
    app.get('/*', serveStatic({ root: webRoot, path: 'index.html' }));
  }

  return app;
}
