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
import { bodyLimit } from 'hono/body-limit';
import { cors } from 'hono/cors';
import { MAX_UPLOAD_TOTAL_BYTES, WEB_DIR } from '../config.js';
import type { LibraryManager } from '../library/manager.js';
import { saveUploads } from '../library/upload.js';
import { ensureChannelRender } from '../render/index.js';
import { resolveStream } from '../stream.js';
import { serveFile } from './serve-file.js';
import { mountSubsonic } from './subsonic/index.js';

export function createApp(manager: LibraryManager): Hono {
  const app = new Hono();
  app.use('*', cors());

  app.get('/api/health', (c) => c.json({ ok: true }));

  // Bibliothèque + gestion (le scan est LU À CHAUD via `manager.current` : un import
  // met donc à jour ces réponses sans redémarrage).
  app.get('/api/library', (c) => c.json(manager.current.library));

  /** État de gestion : surveillance, import en cours, dernier import, volumétrie. */
  app.get('/api/library/status', (c) => c.json(manager.status()));

  /** Déclenche un import + re-scan ; renvoie le compte rendu et la bibliothèque fraîche. */
  app.post('/api/library/import', async (c) => {
    const lastImport = await manager.rescan('manual');
    return c.json({ status: manager.status(), library: manager.current.library, lastImport });
  });

  /** Dépôt de fichiers (multipart, champ `files`) → écrits dans `library/` puis importés. */
  app.post(
    '/api/library/upload',
    // Plafond du corps AVANT le parsing multipart : `formData()` bufferise tout en RAM,
    // donc le contrôle par fichier de `saveUploads` arriverait trop tard contre un OOM.
    bodyLimit({
      maxSize: MAX_UPLOAD_TOTAL_BYTES,
      onError: (c) => c.json({ error: 'dépôt trop volumineux' }, 413),
    }),
    async (c) => {
      let form: FormData;
      try {
        form = await c.req.formData();
      } catch {
        return c.json({ error: 'corps multipart invalide' }, 400);
      }
      const files = form.getAll('files').filter((e): e is File => typeof e !== 'string');
      if (!files.length) return c.json({ error: 'aucun fichier reçu (champ "files")' }, 400);

      const { accepted, rejected } = await saveUploads(files);
      // On n'importe que si au moins un fichier a été écrit (évite un re-scan inutile).
      const lastImport = accepted.length ? await manager.rescan('manual') : null;
      return c.json({
        status: manager.status(),
        library: manager.current.library,
        lastImport,
        accepted,
        rejected,
      });
    }
  );

  /** Active/désactive (et persiste) la surveillance du dossier `library/`. */
  app.put('/api/library/watch', async (c) => {
    // `c.req.json()` ne rejette PAS sur le littéral `null` (JSON valide) : on borne
    // donc le type avant de lire `.enabled` (sinon `null.enabled` lèverait → 500).
    const body = (await c.req.json().catch(() => null)) as { enabled?: unknown } | null;
    if (typeof body?.enabled !== 'boolean') {
      return c.json({ error: 'champ "enabled" (booléen) requis' }, 400);
    }
    await manager.setWatching(body.enabled);
    return c.json({ status: manager.status() });
  });

  /** Streaming d'un morceau (statique, artefact de boucle, ou OGG paramétrique). */
  app.get('/api/stream/:id', async (c) => {
    const id = c.req.param('id');
    try {
      const path = await resolveStream(manager.current, id, c.req.query('seconds'), c.req.query('fade'));
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
    const ref = manager.current.channelRenders.get(`${id}::${chan}`);
    if (!ref) return c.notFound();
    try {
      return serveFile(c, await ensureChannelRender(id, chan, ref));
    } catch (err) {
      console.error(`[vdm] rendu canal échoué (${id}/${chan}) :`, err);
      return c.text('render failed', 500);
    }
  });

  // API Subsonic minimale (browse + play), montée sur /rest/*.
  mountSubsonic(app, manager);

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
