import { spawn } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { mkdir, rm, stat } from 'node:fs/promises';
import { dirname, extname, join } from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import { Hono, type Context } from 'hono';
import { cors } from 'hono/cors';
import { scanLibrary, type ChannelRenderRef, type LoopRenderRef, type RenderRef, type ScanResult } from './library.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
// apps/server/src -> racine du dépôt
const ROOT = join(__dirname, '../../..');
const MEDIA_DIR = join(ROOT, 'media');
const LIBRARY_DIR = join(ROOT, 'library');
const CACHE_DIR = join(MEDIA_DIR, '_cache'); // OGG rendus à la demande
const PORT = Number(process.env.PORT ?? 8787);

// Garde-fous du rendu paramétrable.
const MAX_SECONDS = 900;
const MAX_FADE = 30;

const NSFTOOL = process.env.VDM_NSFPLAY ?? 'nsftool';

const CONTENT_TYPES: Record<string, string> = {
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.flac': 'audio/flac',
  '.mp3': 'audio/mpeg',
};

let scan: ScanResult;

const app = new Hono();
app.use('*', cors());

app.get('/api/health', (c) => c.json({ ok: true }));

app.get('/api/library', (c) => c.json(scan.library));

/**
 * Streaming d'un morceau.
 *  - statique : on sert le fichier tel quel (Range/206) ;
 *  - émulé : on rend l'OGG à la demande via libgme avec la durée + le fondu
 *    demandés (`?seconds=&fade=`), puis on sert depuis le cache.
 */
app.get('/api/stream/:id', async (c) => {
  const id = c.req.param('id');

  const staticPath = scan.files.get(id);
  if (staticPath) return serveFile(c, staticPath);

  // Boucle détectée + aucun paramètre explicite -> artefact de boucle
  // (lecture interactive côté client). Échec -> repli paramétrique ci-dessous.
  const loopRef = scan.loops.get(id);
  if (loopRef && c.req.query('seconds') == null && c.req.query('fade') == null) {
    try {
      return serveFile(c, await ensureLoopRendered(id, loopRef));
    } catch (err) {
      console.error(`[vdm] rendu boucle échoué (${id}), repli paramétrique :`, err);
    }
  }

  const ref = scan.renders.get(id);
  if (ref) {
    const seconds = clamp(numParam(c, 'seconds', ref.defaultSeconds), 1, MAX_SECONDS);
    const fade = clamp(numParam(c, 'fade', ref.defaultFade), 0, MAX_FADE);
    try {
      const rendered = await ensureRendered(id, ref, Math.round(seconds), round1(fade));
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
    return serveFile(c, await ensureChannelRendered(id, chan, ref));
  } catch (err) {
    console.error(`[vdm] rendu canal échoué (${id}/${chan}) :`, err);
    return c.text('render failed', 500);
  }
});

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

// ---- Rendu à la demande (formats émulés) -----------------------------------

const inflight = new Map<string, Promise<void>>();

/** Garantit l'existence de l'OGG rendu (cache) et renvoie son chemin. */
async function ensureRendered(
  id: string,
  ref: RenderRef,
  seconds: number,
  fade: number
): Promise<string> {
  const outPath = join(CACHE_DIR, `${id}__s${seconds}__f${String(fade).replace('.', 'p')}.ogg`);

  const existing = await stat(outPath).catch(() => null);
  if (existing && existing.size > 0) return outPath;

  // Dédoublonne les rendus identiques concurrents.
  let pending = inflight.get(outPath);
  if (!pending) {
    pending = renderTrack(ref, seconds, fade, outPath).finally(() => inflight.delete(outPath));
    inflight.set(outPath, pending);
  }
  await pending;
  return outPath;
}

/** Rend une sous-piste émulée en OGG (durée bornée + fondu) via ffmpeg/libgme. */
function renderTrack(ref: RenderRef, seconds: number, fade: number, outPath: string): Promise<void> {
  const args = [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'libgme', '-track_index', String(ref.trackIndex), '-sample_rate', '44100',
    '-i', ref.sourcePath,
    '-t', String(seconds),
  ];
  if (fade > 0) {
    args.push('-af', `afade=t=out:st=${Math.max(0, seconds - fade)}:d=${fade}`);
  }
  args.push('-c:a', 'libvorbis', '-qscale:a', '5', outPath);
  return runFfmpeg(args);
}

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`ffmpeg (code ${code}) : ${stderr.trim()}`))
    );
  });
}

// ---- Rendu de l'artefact de boucle [intro + 1 boucle + ε] ------------------

const LOOP_EPSILON_SAMPLES = Math.round(0.05 * 44100); // queue rendue après loopEnd (sert au crossfade)
const XFADE_SAMPLES = Math.round(0.025 * 44100); // durée du crossfade de jointure (~25 ms)

/** Garantit l'artefact de boucle en cache (clé stable, sans paramètre). */
async function ensureLoopRendered(id: string, ref: LoopRenderRef): Promise<string> {
  const outPath = join(CACHE_DIR, `${id}__loop.ogg`);
  const existing = await stat(outPath).catch(() => null);
  if (existing && existing.size > 0) return outPath;

  let pending = inflight.get(outPath);
  if (!pending) {
    pending = renderLoop(ref, outPath).finally(() => inflight.delete(outPath));
    inflight.set(outPath, pending);
  }
  await pending;
  return outPath;
}

/** Artefact de boucle = [intro + 1 boucle] à jointure CROSSFADÉE (sans clic). */
async function renderLoop(ref: LoopRenderRef, outPath: string): Promise<void> {
  const wav = `${outPath}.tmp.wav`;
  const endSample = ref.introSamples + ref.loopLengthSamples + LOOP_EPSILON_SAMPLES;
  try {
    await runCmd('ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'libgme', '-track_index', String(ref.trackIndex), '-sample_rate', '44100',
      '-i', ref.sourcePath,
      '-af', `atrim=end_sample=${endSample}`, wav,
    ]);
    await encodeSeamlessOgg(wav, outPath, ref.introSamples, ref.loopLengthSamples);
  } finally {
    await rm(wav, { force: true }).catch(() => {});
  }
}

// ---- Rendu d'un stem (une voix) à la demande via nsftool -------------------

function runCmd(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`${cmd} (code ${code}) : ${stderr.trim()}`))
    );
  });
}

/**
 * Filtre ffmpeg : transforme [intro + boucle + ε] en [intro + corps bouclable].
 * La queue ε (début de boucle rejoué, continu en phase avec la fin) est
 * crossfadée (équiénergie qsin) sur le début de la boucle -> le corps boucle
 * sans clic en lecture native. La fin du corps == fin de boucle, et le début du
 * corps reprend exactement la queue -> jointure parfaitement continue.
 */
function seamlessFilter(introSamples: number, loopLengthSamples: number, xfade: number): string {
  const I = introSamples;
  const L = loopLengthSamples;
  const X = xfade;
  const hasIntro = I > 0;
  const splitN = hasIntro ? 4 : 3;
  const parts: string[] = [
    `[0:a]asplit=${splitN}` + Array.from({ length: splitN }, (_, i) => `[s${i}]`).join(''),
  ];
  let si = 0;
  let concat = '';
  let nConcat = 0;
  if (hasIntro) {
    parts.push(`[s${si++}]atrim=start_sample=0:end_sample=${I},asetpts=PTS-STARTPTS[intro]`);
    concat += '[intro]';
    nConcat++;
  }
  parts.push(`[s${si++}]atrim=start_sample=${I}:end_sample=${I + X},asetpts=PTS-STARTPTS[head]`);
  parts.push(`[s${si++}]atrim=start_sample=${I + L}:end_sample=${I + L + X},asetpts=PTS-STARTPTS[tail]`);
  parts.push(`[s${si++}]atrim=start_sample=${I + X}:end_sample=${I + L},asetpts=PTS-STARTPTS[mid]`);
  parts.push(`[tail][head]acrossfade=ns=${X}:c1=qsin:c2=qsin[seam]`);
  concat += '[seam][mid]';
  nConcat += 2;
  parts.push(`${concat}concat=n=${nConcat}:v=0:a=1[out]`);
  return parts.join(';');
}

/** Encode un WAV [intro+boucle+ε] en OGG bouclable (crossfade) + tags de boucle. */
function encodeSeamlessOgg(
  wav: string,
  outPath: string,
  introSamples: number,
  loopLengthSamples: number
): Promise<void> {
  const X = Math.min(XFADE_SAMPLES, Math.floor(loopLengthSamples / 4));
  const args = ['-hide_banner', '-loglevel', 'error', '-y', '-i', wav];
  if (X >= 64) {
    args.push('-filter_complex', seamlessFilter(introSamples, loopLengthSamples, X), '-map', '[out]');
  } else {
    // Boucle trop courte pour un crossfade -> simple coupe à loopEnd.
    args.push('-af', `atrim=end_sample=${introSamples + loopLengthSamples}`);
  }
  args.push(
    '-metadata', `LOOPSTART=${introSamples}`,
    '-metadata', `LOOPLENGTH=${loopLengthSamples}`,
    '-c:a', 'libvorbis', '-qscale:a', '4', outPath
  );
  return runCmd('ffmpeg', args);
}

/** Garantit le stem d'une voix en cache (clé stable par piste+canal). */
async function ensureChannelRendered(id: string, chan: string, ref: ChannelRenderRef): Promise<string> {
  const outPath = join(CACHE_DIR, `${id}__ch_${chan}.ogg`);
  const existing = await stat(outPath).catch(() => null);
  if (existing && existing.size > 0) return outPath;

  let pending = inflight.get(outPath);
  if (!pending) {
    pending = renderChannelStem(ref, outPath).finally(() => inflight.delete(outPath));
    inflight.set(outPath, pending);
  }
  await pending;
  return outPath;
}

/**
 * Rend une voix isolée (nsftool --solo) sur les MÊMES bornes que l'artefact de
 * boucle -> WAV, puis encode en OGG taggé LOOPSTART/LOOPLENGTH. Toutes les voix
 * d'une piste ont donc la même longueur -> alignées à l'échantillon.
 */
async function renderChannelStem(ref: ChannelRenderRef, outPath: string): Promise<void> {
  const endSample = ref.introSamples + ref.loopLengthSamples + LOOP_EPSILON_SAMPLES;
  const lengthMs = Math.round((endSample / 44100) * 1000);
  const wav = `${outPath}.tmp.wav`;
  try {
    await runCmd(NSFTOOL, [
      '-t', String(ref.trackIndex + 1), '-l', String(lengthMs), '-r', '44100', '-c', '1',
      '--solo', String(ref.channelIndex), '-o', wav, ref.sourcePath,
    ]);
    await encodeSeamlessOgg(wav, outPath, ref.introSamples, ref.loopLengthSamples);
  } finally {
    await rm(wav, { force: true }).catch(() => {});
  }
}

// ---- Service de fichier avec Range (RFC 7233) ------------------------------

async function serveFile(c: Context, filePath: string): Promise<Response> {
  const { size } = await stat(filePath);
  const contentType = CONTENT_TYPES[extname(filePath).toLowerCase()] ?? 'application/octet-stream';
  const range = c.req.header('range');

  if (range) {
    const match = /bytes=(\d*)-(\d*)/.exec(range);
    if (!match || (!match[1] && !match[2])) {
      return c.body(null, 416, { 'Content-Range': `bytes */${size}` });
    }

    let start: number;
    let end: number;
    if (!match[1]) {
      const suffix = Number(match[2]);
      if (suffix === 0) return c.body(null, 416, { 'Content-Range': `bytes */${size}` });
      start = Math.max(0, size - suffix);
      end = size - 1;
    } else {
      start = Number(match[1]);
      end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
    }

    if (start >= size || start > end) {
      return c.body(null, 416, { 'Content-Range': `bytes */${size}` });
    }

    const stream = createReadStream(filePath, { start, end });
    return c.body(Readable.toWeb(stream) as ReadableStream, 206, {
      'Content-Type': contentType,
      'Content-Range': `bytes ${start}-${end}/${size}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': String(end - start + 1),
    });
  }

  return c.body(Readable.toWeb(createReadStream(filePath)) as ReadableStream, 200, {
    'Content-Type': contentType,
    'Accept-Ranges': 'bytes',
    'Content-Length': String(size),
  });
}

async function main() {
  await mkdir(CACHE_DIR, { recursive: true });
  scan = await scanLibrary(MEDIA_DIR, LIBRARY_DIR);
  const count = scan.files.size + scan.renders.size;
  console.log(`[vdm] bibliothèque chargée : ${count} morceau(x), ${scan.library.games.length} jeu(x)`);
  serve({ fetch: app.fetch, port: PORT }, ({ port }) => {
    console.log(`[vdm] serveur en écoute sur http://localhost:${port}`);
  });
}

main().catch((err) => {
  console.error('[vdm] échec du démarrage :', err);
  process.exit(1);
});
