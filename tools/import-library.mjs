/**
 * tools/import-library.mjs
 *
 * Catalogue les vrais fichiers de musique de jeu déposés dans `library/`
 * (NSF, NSFe, SPC, VGM, GBS, trackers…) via ffprobe + libgme.
 *
 * On NE décode PLUS ici : ces formats sont émulés et infinis, et le rendu en
 * OGG se fait désormais À LA DEMANDE côté serveur, avec la durée + le fondu
 * choisis par l'utilisateur (`/api/stream/:id?seconds=&fade=`). L'import se
 * contente donc de lire les métadonnées par sous-piste :
 *   - nom de piste (tag `song`, présent dans les NSFe via le chunk tlbl) ;
 *   - durée voulue par le ripper (chunk `time` du NSFe) -> défaut de lecture ;
 *   - jeu / auteur / système (tags globaux).
 *
 * Sortie : media/library.generated.json (manifeste lu par le serveur), avec
 * pour chaque entrée une référence à la SOURCE + l'index de sous-piste.
 *
 * Réglages (env) :
 *   VDM_FALLBACK_SECONDS (défaut 120)  durée par défaut si la source n'en donne pas
 *
 * Usage :  node tools/import-library.mjs   (ou  npm run library:import)
 */

import { spawn } from 'node:child_process';
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const LIBRARY_DIR = join(ROOT, 'library');
const MEDIA_DIR = join(ROOT, 'media');
const MANIFEST = join(MEDIA_DIR, 'library.generated.json');

const FALLBACK_SECONDS = Number(process.env.VDM_FALLBACK_SECONDS ?? 120);
const CONCURRENCY = 6;

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

/** Petit pool de concurrence pour les ffprobe par piste. */
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

async function catalogFile(fileName) {
  const filePath = join(LIBRARY_DIR, fileName);
  const meta = await probeGlobal(filePath);
  const game = meta.game ?? fileName.replace(/\.[^.]+$/, '');
  const base = slugify(fileName); // inclut l'extension -> id unique .nsf vs .nsfe

  console.log(
    `[catalogue] ${fileName} → ${meta.trackCount} piste(s) | jeu="${game}" ` +
    `auteur="${meta.composer ?? '?'}" système="${meta.platform ?? '?'}"`
  );

  const indices = Array.from({ length: meta.trackCount }, (_, i) => i);
  return pool(indices, CONCURRENCY, async (index) => {
    const nn = String(index + 1).padStart(2, '0');
    const { seconds, name } = await probeTrack(filePath, index);
    const defaultSeconds = Math.round(seconds);
    // Fondu par défaut seulement pour les pistes longues (les jingles courts
    // finissent d'eux-mêmes). L'utilisateur peut le changer dans l'UI.
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

  const allTracks = [];
  for (const fileName of files) {
    try {
      allTracks.push(...(await catalogFile(fileName)));
    } catch (err) {
      console.error(`[catalogue] ${fileName} ignoré : ${err.message}`);
    }
  }

  await writeFile(MANIFEST, JSON.stringify({ tracks: allTracks }, null, 2));
  console.log(`[catalogue] terminé : ${allTracks.length} morceau(x) → ${MANIFEST}`);
}

main().catch((err) => {
  console.error('[catalogue] échec :', err.message);
  process.exit(1);
});
