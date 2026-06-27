/**
 * Routes HTTP (Hono). Les handlers restent FINS : ils résolvent l'id dans le
 * `ScanResult`, délèguent le rendu à `render/` (cache + dédoublonnage) et le
 * service du fichier à `serve-file.ts`.
 *
 * Précédence du streaming d'un id émulé : artefact de boucle (si boucle détectée
 * et aucun paramètre) → rendu paramétrique (durée/fondu). Repli en cascade.
 */

import { Hono, type Context } from 'hono';
import { cors } from 'hono/cors';
import { MAX_FADE, MAX_SECONDS } from '../config.js';
import type { ScanResult } from '../library/types.js';
import { ensureChannelRender, ensureLoopRender, ensureParametricRender } from '../render/index.js';
import { serveFile } from './serve-file.js';

export function createApp(scan: ScanResult): Hono {
  const app = new Hono();
  app.use('*', cors());

  app.get('/api/health', (c) => c.json({ ok: true }));

  app.get('/api/library', (c) => c.json(scan.library));

  /**
   * Streaming d'un morceau.
   *  - statique : on sert le fichier tel quel (Range/206) ;
   *  - émulé bouclé + aucun paramètre : artefact de boucle (lecture interactive) ;
   *  - émulé : OGG rendu à la demande via libgme (durée + fondu demandés).
   */
  app.get('/api/stream/:id', async (c) => {
    const id = c.req.param('id');

    const staticPath = scan.files.get(id);
    if (staticPath) return serveFile(c, staticPath);

    // Boucle détectée + aucun paramètre explicite -> artefact de boucle.
    // Échec -> repli paramétrique ci-dessous.
    const loopRef = scan.loops.get(id);
    if (loopRef && c.req.query('seconds') == null && c.req.query('fade') == null) {
      try {
        return serveFile(c, await ensureLoopRender(id, loopRef));
      } catch (err) {
        console.error(`[vdm] rendu boucle échoué (${id}), repli paramétrique :`, err);
      }
    }

    const ref = scan.renders.get(id);
    if (ref) {
      const seconds = clamp(numParam(c, 'seconds', ref.defaultSeconds), 1, MAX_SECONDS);
      const fade = clamp(numParam(c, 'fade', ref.defaultFade), 0, MAX_FADE);
      try {
        const rendered = await ensureParametricRender(id, ref, Math.round(seconds), round1(fade));
        return serveFile(c, rendered);
      } catch (err) {
        console.error(`[vdm] rendu échoué (${id}):`, err);
        return c.text('render failed', 500);
      }
    }

    return c.notFound();
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

  return app;
}

function numParam(c: Context, name: string, fallback: number): number {
  const raw = c.req.query(name);
  const n = raw == null ? NaN : Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}
