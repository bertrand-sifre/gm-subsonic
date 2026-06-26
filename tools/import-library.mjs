/**
 * tools/import-library.mjs
 *
 * Catalogue les vrais fichiers de musique de jeu déposés dans `library/`
 * (NSF, NSFe, SPC, VGM, GBS, trackers…) via ffprobe + libgme.
 *
 * On NE décode PLUS l'audio ici : ces formats sont émulés et infinis, et le
 * rendu en OGG se fait À LA DEMANDE côté serveur. L'import lit les métadonnées
 * par sous-piste (nom via tag `song`, durée voulue via chunk `time`) et,
 * optionnellement (flag VDM_DETECT), détecte les POINTS DE BOUCLE
 * (tools/detect-loop.mjs) pour activer la lecture interactive côté client.
 *
 * Sortie : media/library.generated.json (manifeste lu par le serveur).
 *
 * Réglages (env) :
 *   VDM_FALLBACK_SECONDS    (défaut 120)  durée par défaut si la source n'en donne pas
 *   VDM_DETECT              (défaut off)  active la détection de boucle ('1'/'true')
 *   VDM_DETECT_MIN_SECONDS  (défaut 20)   pistes plus courtes = jingles, non détectées
 *   VDM_DETECT_ONLY         (défaut '')   ne détecte que les fichiers dont le nom contient cette sous-chaîne
 *
 * Usage :  node tools/import-library.mjs   (ou  npm run library:import)
 */

import { spawn } from 'node:child_process';
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { detectLoop } from './detect-loop.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const LIBRARY_DIR = join(ROOT, 'library');
const MEDIA_DIR = join(ROOT, 'media');
const MANIFEST = join(MEDIA_DIR, 'library.generated.json');
const CACHE_FILE = join(MEDIA_DIR, 'loops.cache.json');

const FALLBACK_SECONDS = Number(process.env.VDM_FALLBACK_SECONDS ?? 120);
const CONCURRENCY = 6;

const DETECT = process.env.VDM_DETECT === '1' || process.env.VDM_DETECT === 'true';
const DETECT_MIN_SECONDS = Number(process.env.VDM_DETECT_MIN_SECONDS ?? 20);
const DETECT_ONLY = process.env.VDM_DETECT_ONLY ?? '';
const DETECT_CONCURRENCY = 2; // CPU/IO-bound : plus bas que les ffprobe

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

async function loadCache() {
  try {
    return JSON.parse(await readFile(CACHE_FILE, 'utf8'));
  } catch {
    return {};
  }
}

/**
 * Attache les boucles aux pistes. Le cache (par mtime/size) est TOUJOURS
 * appliqué — les boucles déjà détectées survivent à un import sans VDM_DETECT
 * (donc à un redémarrage). Le flag VDM_DETECT ne contrôle que la détection
 * NEUVE (cache miss) ; sans lui, on se contente de réappliquer le cache.
 */
async function detectLoops(fileName, fileStat, entries, cache) {
  const sourcePath = join(LIBRARY_DIR, fileName);
  const keyFor = (e) => `${fileName}#${e.trackIndex}@${fileStat.mtimeMs}:${fileStat.size}`;

  // 1) Réappliquer les boucles connues (persistance).
  for (const e of entries) {
    const cached = cache[keyFor(e)];
    if (cached) e.loop = cached;
  }

  // 2) Détection neuve uniquement si activée et fichier non filtré.
  if (!DETECT) return;
  if (DETECT_ONLY && !fileName.includes(DETECT_ONLY)) return;
  const todo = entries.filter(
    (e) => e.defaultSeconds >= DETECT_MIN_SECONDS && cache[keyFor(e)] === undefined
  );

  await pool(todo, DETECT_CONCURRENCY, async (entry) => {
    const key = keyFor(entry);
    try {
      const d = await detectLoop(sourcePath, entry.trackIndex, { defaultSeconds: entry.defaultSeconds });
      const loop = d
        ? {
            startSeconds: d.loopStartSeconds,
            lengthSeconds: d.loopLengthSeconds,
            startSamples: d.introSamples,
            lengthSamples: d.loopLengthSamples,
            sampleRate: d.sampleRate,
            confidence: d.confidence,
          }
        : null;
      cache[key] = loop;
      if (loop) {
        entry.loop = loop;
        process.stdout.write(
          `  ⟳ boucle ${entry.id} : ${loop.lengthSeconds}s (intro ${loop.startSeconds}s, conf ${loop.confidence})\n`
        );
      }
    } catch (err) {
      process.stdout.write(`  ! détection KO ${entry.id} : ${err.message}\n`);
      cache[key] = null;
    }
  });
}

async function catalogFile(fileName, cache) {
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

  await detectLoops(fileName, fileStat, entries, cache);
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

  if (DETECT) console.log('[catalogue] détection de boucle ACTIVE (VDM_DETECT)');
  const cache = await loadCache();

  const allTracks = [];
  for (const fileName of files) {
    try {
      allTracks.push(...(await catalogFile(fileName, cache)));
    } catch (err) {
      console.error(`[catalogue] ${fileName} ignoré : ${err.message}`);
    }
  }

  await writeFile(MANIFEST, JSON.stringify({ tracks: allTracks }, null, 2));
  if (DETECT) await writeFile(CACHE_FILE, JSON.stringify(cache, null, 1));
  const looped = allTracks.filter((t) => t.loop).length;
  console.log(`[catalogue] terminé : ${allTracks.length} morceau(x), ${looped} avec boucle détectée → ${MANIFEST}`);
}

main().catch((err) => {
  console.error('[catalogue] échec :', err.message);
  process.exit(1);
});
