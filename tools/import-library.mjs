/**
 * tools/import-library.mjs
 *
 * Catalogue les vrais fichiers de musique de jeu déposés dans `library/`
 * (NSF, NSFe, SPC, VGM, GBS, trackers…) via ffprobe + libgme.
 *
 * On NE décode PLUS l'audio ici : ces formats sont émulés et infinis, et le
 * rendu en OGG se fait À LA DEMANDE côté serveur. L'import lit les métadonnées
 * par sous-piste (nom via tag `song`, durée voulue via chunk `time`) et détecte
 * les POINTS DE BOUCLE des pistes NES (NSF/NSFe) par AUTOCORRÉLATION du log de
 * registres APU de nsftool (tools/nsf-loop.mjs) — déterministe, rate-indépendant.
 *
 * La détection est AUTOMATIQUE et INCRÉMENTALE : un cache par mtime/size
 * (media/loops.cache.json, schéma versionné) évite de re-détecter à chaque boot ;
 * seul le 1er run froid d'une nouvelle piste coûte (~0.5-1 s à r=8000). Les
 * formats non-NES (SPC/VGM/GBS…) ne sont pas détectés -> repli paramétrique.
 *
 * Sortie : media/library.generated.json (manifeste lu par le serveur).
 *
 * Réglages (env) :
 *   VDM_FALLBACK_SECONDS    (défaut 120)  durée par défaut si la source n'en donne pas
 *   VDM_DETECT_MIN_SECONDS  (défaut 20)   pistes plus courtes = jingles, non détectées
 *   VDM_DETECT_ONLY         (défaut '')   ne détecte que les fichiers dont le nom contient cette sous-chaîne
 *
 * Usage :  node tools/import-library.mjs   (ou  npm run library:import)
 */

import { spawn } from 'node:child_process';
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { detectLoop } from './nsf-loop.mjs';
import { catalogStems } from './nsf-stems.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const LIBRARY_DIR = join(ROOT, 'library');
const MEDIA_DIR = join(ROOT, 'media');
const MANIFEST = join(MEDIA_DIR, 'library.generated.json');
const CACHE_FILE = join(MEDIA_DIR, 'loops.cache.json');
const STEMS_CACHE_FILE = join(MEDIA_DIR, 'stems.cache.json');

// Schéma du cache de boucles. Le détecteur a changé (autocorrélation register-log
// nsftool, plus l'ancienne heuristique audio NCC) : les valeurs sous les MÊMES
// clés `fichier#piste@mtime:size` ne sont plus comparables. Un cache de schéma
// inférieur est traité comme vide (re-détection propre).
const LOOP_CACHE_SCHEMA = 2;

const FALLBACK_SECONDS = Number(process.env.VDM_FALLBACK_SECONDS ?? 120);
const CONCURRENCY = 6;

// Détection de boucle : TOUJOURS active, incrémentale (cache mtime/size). Pas de
// porte on/off. DETECT_ONLY = filtre dev ciblé ; DETECT_MIN_SECONDS écarte les jingles.
const DETECT_MIN_SECONDS = Number(process.env.VDM_DETECT_MIN_SECONDS ?? 20);
const DETECT_ONLY = process.env.VDM_DETECT_ONLY ?? '';
const DETECT_CONCURRENCY = 4; // nsftool CPU-bound mais rapide à r=8000

const NSFPLAY = process.env.VDM_NSFPLAY ?? 'nsftool';

/** Formats émulés/séquencés gérés par le demuxer libgme de ffmpeg. */
const VGM_EXT = new Set([
  '.nsf', '.nsfe', '.spc', '.vgm', '.vgz', '.gbs', '.gym', '.ay', '.hes', '.kss',
]);

function slugify(value) {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

/** Exécute une commande externe ; rejette avec stderr si code non nul. */
function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', (err) =>
      reject(err.code === 'ENOENT' ? new Error(`Commande introuvable : ${cmd}`) : err)
    );
    child.on('close', (code) =>
      code === 0
        ? resolve({ stdout, stderr })
        : reject(new Error(`${cmd} a échoué (code ${code}) : ${stderr.trim()}`))
    );
  });
}

/** Tags globaux (jeu, auteur, système, nombre de pistes). */
async function probeGlobal(file) {
  const { stdout } = await run('ffprobe', [
    '-hide_banner', '-loglevel', 'error',
    '-f', 'libgme', '-i', file,
    '-show_entries', 'format_tags', '-of', 'json',
  ]);
  const tags = (JSON.parse(stdout).format ?? {}).tags ?? {};
  const trackCount = Number(tags.tracks);
  return {
    game: tags.game,
    composer: tags.author,
    platform: tags.system,
    trackCount: Number.isFinite(trackCount) && trackCount > 0 ? trackCount : 1,
  };
}

/** Métadonnées d'une sous-piste : durée voulue + nom. */
async function probeTrack(file, index) {
  const { stdout } = await run('ffprobe', [
    '-hide_banner', '-loglevel', 'error',
    '-f', 'libgme', '-track_index', String(index), '-i', file,
    '-show_entries', 'format=duration:format_tags=song', '-of', 'json',
  ]);
  const fmt = JSON.parse(stdout).format ?? {};
  const dur = Number(fmt.duration);
  return {
    seconds: Number.isFinite(dur) && dur > 0 ? dur : FALLBACK_SECONDS,
    name: fmt.tags?.song,
  };
}

/** Petit pool de concurrence. */
async function pool(items, size, worker) {
  const out = new Array(items.length);
  let i = 0;
  async function next() {
    const cur = i++;
    if (cur >= items.length) return;
    out[cur] = await worker(items[cur], cur);
    return next();
  }
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, next));
  return out;
}

async function loadJson(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return {};
  }
}

/**
 * Charge le cache de boucles en validant son schéma. Un cache de schéma inférieur
 * (anciennes valeurs audio NCC sous les mêmes clés) est traité comme VIDE pour
 * forcer une re-détection propre. `__schema` est toujours (ré)injecté : il ne
 * collisionne jamais avec une clé `fichier#piste@mtime:size` et n'est jamais lu
 * comme une entrée de boucle.
 */
async function loadLoopCache(path) {
  const raw = await loadJson(path);
  const cache = raw && raw.__schema === LOOP_CACHE_SCHEMA ? raw : {};
  cache.__schema = LOOP_CACHE_SCHEMA;
  return cache;
}

/**
 * Attache les boucles aux pistes NES (NSF/NSFe). Détection AUTOMATIQUE et
 * INCRÉMENTALE : le cache (par mtime/size) est d'abord réappliqué (persistance,
 * survit aux redémarrages), puis les pistes en cache-miss sont détectées par
 * autocorrélation du log de registres nsftool (tools/nsf-loop.mjs). Les formats
 * non-NES sont ignorés -> repli paramétrique côté serveur.
 */
async function detectLoops(fileName, fileStat, entries, cache) {
  // NES uniquement : la détection register-log ne concerne que le 6502/APU.
  if (!/\.nsfe?$/i.test(fileName)) return;

  const sourcePath = join(LIBRARY_DIR, fileName);
  const keyFor = (e) => `${fileName}#${e.trackIndex}@${fileStat.mtimeMs}:${fileStat.size}`;

  // 1) Réappliquer les boucles connues (persistance).
  for (const e of entries) {
    const cached = cache[keyFor(e)];
    if (cached) e.loop = cached;
  }

  // 2) Détection neuve (cache miss). DETECT_ONLY = filtre dev ; jingles écartés.
  if (DETECT_ONLY && !fileName.includes(DETECT_ONLY)) return;
  const todo = entries.filter(
    (e) => e.defaultSeconds >= DETECT_MIN_SECONDS && cache[keyFor(e)] === undefined
  );

  await pool(todo, DETECT_CONCURRENCY, async (entry) => {
    const key = keyFor(entry);
    try {
      // nsf-loop renvoie déjà les noms de champs finaux (aucune transformation).
      const loop = await detectLoop({
        sourcePath,
        trackIndex: entry.trackIndex,
        nsftool: NSFPLAY,
        mediaDir: MEDIA_DIR,
        defaultSeconds: entry.defaultSeconds,
      });
      cache[key] = loop ?? null;
      if (loop) {
        entry.loop = loop;
        process.stdout.write(
          `  ⟳ boucle ${entry.id} : ${loop.lengthSeconds}s (intro ${loop.startSeconds}s)\n`
        );
      }
    } catch (err) {
      process.stdout.write(`  ! détection KO ${entry.id} : ${err.message}\n`);
      cache[key] = null;
    }
  });
}

/**
 * Catalogue les voix (stems) des pistes NES qui bouclent. AUTOMATIQUE et
 * INCRÉMENTAL : cache d'abord réappliqué (persistance), puis pistes en cache-miss
 * cataloguées — INSTANTANÉ (pas de rendu, juste la liste des voix d'après la
 * puce). Le rendu de chaque voix se fait À LA DEMANDE côté serveur.
 */
async function catalogAllStems(fileName, fileStat, entries, cache) {
  if (!/\.nsfe?$/i.test(fileName)) return; // NES uniquement
  const sourcePath = join(LIBRARY_DIR, fileName);
  const keyFor = (e) => `${fileName}#${e.trackIndex}@${fileStat.mtimeMs}:${fileStat.size}`;

  // 1) Réappliquer le cache (persistance) — seulement si la piste a une boucle.
  for (const e of entries) {
    const cached = cache[keyFor(e)];
    if (cached && e.loop) e.channels = { sampleRate: cached.sampleRate, voices: cached.voices };
  }

  // 2) Cataloguer (instantané) les pistes bouclées non encore en cache.
  const todo = entries.filter((e) => e.loop && cache[keyFor(e)] === undefined);
  await pool(todo, CONCURRENCY, async (entry) => {
    const key = keyFor(entry);
    try {
      const res = await catalogStems({
        sourcePath, trackIndex: entry.trackIndex, loop: entry.loop, nsftool: NSFPLAY,
      });
      cache[key] = res ?? null;
      if (res) entry.channels = { sampleRate: res.sampleRate, voices: res.voices };
    } catch (err) {
      process.stdout.write(`  ! catalogue voix KO ${entry.id} : ${err.message}\n`);
      cache[key] = null;
    }
  });
}

async function catalogFile(fileName, caches) {
  const filePath = join(LIBRARY_DIR, fileName);
  const fileStat = await stat(filePath);
  const meta = await probeGlobal(filePath);
  const game = meta.game ?? fileName.replace(/\.[^.]+$/, '');
  const base = slugify(fileName); // inclut l'extension -> id unique .nsf vs .nsfe

  console.log(
    `[catalogue] ${fileName} → ${meta.trackCount} piste(s) | jeu="${game}" ` +
    `auteur="${meta.composer ?? '?'}" système="${meta.platform ?? '?'}"`
  );

  const indices = Array.from({ length: meta.trackCount }, (_, i) => i);
  const entries = await pool(indices, CONCURRENCY, async (index) => {
    const nn = String(index + 1).padStart(2, '0');
    const { seconds, name } = await probeTrack(filePath, index);
    const defaultSeconds = Math.round(seconds);
    const defaultFade = defaultSeconds >= 20 ? 4 : 0;
    return {
      id: `${base}-${nn}`,
      source: fileName,
      trackIndex: index,
      title: name || `Piste ${nn}`,
      game,
      composer: meta.composer,
      platform: meta.platform,
      defaultSeconds,
      defaultFade,
    };
  });

  await detectLoops(fileName, fileStat, entries, caches.loops);
  await catalogAllStems(fileName, fileStat, entries, caches.stems);
  return entries;
}

async function main() {
  await mkdir(MEDIA_DIR, { recursive: true });

  let files;
  try {
    files = (await readdir(LIBRARY_DIR)).filter((f) => VGM_EXT.has(extname(f).toLowerCase()));
  } catch {
    console.error(`[catalogue] dossier introuvable : ${LIBRARY_DIR}`);
    process.exit(1);
  }
  if (files.length === 0) {
    console.log(`[catalogue] aucun fichier VGM dans ${LIBRARY_DIR}.`);
    await writeFile(MANIFEST, JSON.stringify({ tracks: [] }, null, 2));
    return;
  }

  console.log('[catalogue] boucles + voix NES via nsftool (auto, incrémental)');
  const caches = { loops: await loadLoopCache(CACHE_FILE), stems: await loadJson(STEMS_CACHE_FILE) };

  const allTracks = [];
  for (const fileName of files) {
    try {
      allTracks.push(...(await catalogFile(fileName, caches)));
    } catch (err) {
      console.error(`[catalogue] ${fileName} ignoré : ${err.message}`);
    }
  }

  await writeFile(MANIFEST, JSON.stringify({ tracks: allTracks }, null, 2));
  // Détection + catalogue toujours actifs -> on persiste toujours les caches.
  await writeFile(CACHE_FILE, JSON.stringify(caches.loops, null, 1));
  await writeFile(STEMS_CACHE_FILE, JSON.stringify(caches.stems, null, 1));
  const looped = allTracks.filter((t) => t.loop).length;
  const stemmed = allTracks.filter((t) => t.channels).length;
  console.log(`[catalogue] terminé : ${allTracks.length} morceau(x), ${looped} boucle(s), ${stemmed} avec stems → ${MANIFEST}`);
}

main().catch((err) => {
  console.error('[catalogue] échec :', err.message);
  process.exit(1);
});
