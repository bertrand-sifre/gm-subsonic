/**
 * tools/import-library.mjs
 *
 * Importe les vrais fichiers de musique de jeu déposés dans `library/` en les
 * décodant côté serveur via ffmpeg + libgme (NSF, SPC, VGM, GBS, trackers…).
 *
 * Ces formats sont émulés/séquencés et INFINIS : le navigateur ne sait pas les
 * lire. On les « rend » donc en OGG fini côté serveur — borné par une durée +
 * un fondu de sortie (exactement le pilier « rendu serveur » de la tranche 3).
 * Un même fichier (ex. un NSF) contient plusieurs SOUS-PISTES : chacune devient
 * un morceau, sélectionnée via l'option `track_index` du demuxer libgme.
 *
 * Sortie :
 *   - media/_decoded/<jeu>-<NN>.ogg          (audio rendu)
 *   - media/library.generated.json           (manifeste lu par le serveur)
 *
 * Réglages (env) :
 *   VDM_RENDER_SECONDS (défaut 75)  durée rendue par sous-piste
 *   VDM_FADE_SECONDS   (défaut 3)   fondu de sortie
 *   VDM_MAX_TRACKS     (défaut 0)   limite de sous-pistes par fichier (0 = toutes)
 *
 * Usage :  node tools/import-library.mjs   (ou  npm run library:import)
 */

import { spawn } from 'node:child_process';
import { mkdir, readdir, stat, writeFile } from 'node:fs/promises';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const LIBRARY_DIR = join(ROOT, 'library');
const MEDIA_DIR = join(ROOT, 'media');
const OUT_DIR = join(MEDIA_DIR, '_decoded');
const MANIFEST = join(MEDIA_DIR, 'library.generated.json');

const SR = 44100;
const RENDER_SECONDS = Number(process.env.VDM_RENDER_SECONDS ?? 75);
const FADE_SECONDS = Number(process.env.VDM_FADE_SECONDS ?? 3);
const MAX_TRACKS = Number(process.env.VDM_MAX_TRACKS ?? 0);
const CONCURRENCY = 4;

/** Formats émulés/séquencés gérés par le demuxer libgme de ffmpeg. */
const VGM_EXT = new Set([
  '.nsf', '.nsfe', '.spc', '.vgm', '.vgz', '.gbs', '.gym', '.ay', '.hes', '.kss',
]);

function slugify(value) {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // retire les diacritiques
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

/** Lit les tags de format (jeu, auteur, système, nombre de pistes) via ffprobe. */
async function probe(file) {
  const { stdout } = await run('ffprobe', [
    '-hide_banner', '-loglevel', 'error',
    '-f', 'libgme', '-i', file,
    '-show_entries', 'format=format_name:format_tags',
    '-of', 'json',
  ]);
  const fmt = JSON.parse(stdout).format ?? {};
  const tags = fmt.tags ?? {};
  const trackCount = Number(tags.tracks);
  return {
    game: tags.game,
    composer: tags.author,
    platform: tags.system,
    trackCount: Number.isFinite(trackCount) && trackCount > 0 ? trackCount : 1,
  };
}

/** Rend une sous-piste en OGG (durée bornée + fondu de sortie). */
async function decodeTrack(file, index, outPath) {
  const fadeStart = Math.max(0, RENDER_SECONDS - FADE_SECONDS);
  await run('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'libgme', '-track_index', String(index), '-sample_rate', String(SR),
    '-i', file,
    '-t', String(RENDER_SECONDS),
    '-af', `afade=t=out:st=${fadeStart}:d=${FADE_SECONDS}`,
    '-c:a', 'libvorbis', '-qscale:a', '5',
    outPath,
  ]);
  const { size } = await stat(outPath);
  if (size === 0) throw new Error(`OGG vide pour ${file} #${index}`);
  return size;
}

/** Petit pool de concurrence (évite de lancer 60 ffmpeg d'un coup). */
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

async function importFile(file, fileName) {
  const meta = await probe(file);
  const game = meta.game ?? fileName.replace(/\.[^.]+$/, '');
  const base = slugify(game);
  const total = MAX_TRACKS > 0 ? Math.min(MAX_TRACKS, meta.trackCount) : meta.trackCount;

  console.log(
    `[import] ${fileName} → ${total}/${meta.trackCount} piste(s) | jeu="${game}" ` +
    `auteur="${meta.composer ?? '?'}" système="${meta.platform ?? '?'}"`
  );

  const indices = Array.from({ length: total }, (_, i) => i);
  const entries = await pool(indices, CONCURRENCY, async (index) => {
    const nn = String(index + 1).padStart(2, '0');
    const outName = `${base}-${nn}.ogg`;
    const outPath = join(OUT_DIR, outName);
    try {
      const size = await decodeTrack(file, index, outPath);
      process.stdout.write(`  ✓ ${outName} (${(size / 1024).toFixed(0)} Ko)\n`);
      return {
        file: `_decoded/${outName}`,
        title: `Piste ${nn}`,
        game,
        composer: meta.composer,
        platform: meta.platform,
      };
    } catch (err) {
      process.stdout.write(`  ✗ piste ${nn} : ${err.message}\n`);
      return null;
    }
  });
  return entries.filter(Boolean);
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });

  let files;
  try {
    files = (await readdir(LIBRARY_DIR)).filter((f) => VGM_EXT.has(extname(f).toLowerCase()));
  } catch {
    console.error(`[import] dossier introuvable : ${LIBRARY_DIR}`);
    process.exit(1);
  }
  if (files.length === 0) {
    console.log(`[import] aucun fichier VGM dans ${LIBRARY_DIR}. Rien à faire.`);
    await writeFile(MANIFEST, JSON.stringify({ tracks: [] }, null, 2));
    return;
  }

  const allTracks = [];
  for (const fileName of files) {
    const tracks = await importFile(join(LIBRARY_DIR, fileName), fileName);
    allTracks.push(...tracks);
  }

  await writeFile(MANIFEST, JSON.stringify({ tracks: allTracks }, null, 2));
  console.log(`[import] terminé : ${allTracks.length} morceau(x) → ${MANIFEST}`);
  console.log('[import] redémarre le serveur pour recharger : docker compose restart app');
}

main().catch((err) => {
  console.error('[import] échec :', err.message);
  process.exit(1);
});
