/**
 * tools/gdm-probe.mjs
 *
 * CATALOGUE des voix (stems) d'un morceau GBS, à l'import. Léger et instantané :
 * `gdm probe` lit l'en-tête GBS et interroge libgme (`gme_voice_count` /
 * `gme_voice_name`) — AUCUN rendu audio ici. Le rendu de chaque voix se fait À
 * LA DEMANDE côté serveur (engine gdm), comme l'artefact de boucle, puis est mis
 * en cache. C'est l'équivalent GBS de tools/nsf-stems.mjs.
 *
 * Une voix = un oscillateur du DMG-APU (Square 1, Square 2, Wave, Noise). Le
 * client les mixe et permet de les activer/désactiver en direct (les « couches »
 * de la vision).
 *
 * Différence avec le NES : les voix GBS sont STATIQUES (toujours les 4 mêmes,
 * indépendantes de la sous-piste) — on appelle donc `gdm probe` UNE fois par
 * FICHIER, pas par piste, et la signature ne prend ni trackIndex ni loop.
 *
 * On ne consomme QUE `probe.devices[]` (le contrat JSON expose aussi
 * `tracks[]`/`trackCount` mais ils sont FORWARD-LOOKING : les métadonnées de
 * piste viennent déjà de ffprobe côté import-library). La contrainte « voix
 * seulement pour les pistes qui bouclent » (cf. emulated.ts) n'est PAS gérée ici
 * (probe est indépendant de la boucle) : c'est l'importeur qui ne pose
 * `entry.channels` que sur les entrées ayant `entry.loop`.
 *
 * Repli : gdm indisponible / échec / JSON invalide -> renvoie null, la piste
 * reste servie par le chemin libgme (rendu paramétrique / artefact de boucle).
 */

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SR = 44100;

/** Exécute une commande ; ne rejette jamais (renvoie code/stdout/stderr). */
function run(cmd, args) {
  return new Promise((resolve) => {
    const c = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    c.stdout.on('data', (d) => { stdout += d; });
    c.stderr.on('data', (d) => { stderr += d; });
    c.on('error', (err) => resolve({ code: -1, stdout, stderr: String(err) }));
    c.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

/**
 * Identifiant stable d'une voix à partir de son nom libgme.
 * 'Square 1' -> 'square1', 'Square 2' -> 'square2', 'Wave' -> 'wave',
 * 'Noise' -> 'noise' (uniques pour le DMG-APU).
 */
function slug(name) {
  return String(name).toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Liste les voix d'un fichier GBS (instantané : lecture d'en-tête, pas de rendu).
 * Aplatit `devices[] -> voices[]` du contrat `gdm probe` vers la forme attendue
 * par `MetaTrack.channels` (mêmes noms de champs que nsf-stems.catalogStems, donc
 * @vdm/shared reste intact). Le rendu de chaque voix est fait à la demande par le
 * serveur (engine gdm, mute des autres canaux).
 *
 * @param {object} o
 * @param {string} o.sourcePath  source GBS
 * @param {string} [o.gdm]       binaire gdm (défaut 'gdm')
 * @returns {{ sampleRate, voices:[{id,label,chip,kind,channelIndex,enabledByDefault}] }|null}
 */
export async function catalogStems({ sourcePath, gdm = 'gdm' }) {
  const probe = await run(gdm, ['probe', sourcePath]);
  if (probe.code !== 0) return null; // gdm indispo / échec -> repli libgme

  let data;
  try {
    data = JSON.parse(probe.stdout);
  } catch {
    return null; // JSON invalide -> repli
  }
  if (!data || data.schemaVersion !== 1) return null; // schéma incompatible -> repli
  if (!Array.isArray(data.devices)) return null;

  // Aplatissement devices[] -> voices[] (un seul device DMG-APU pour le GBS,
  // mais le contrat en prévoit plusieurs pour les futurs formats multi-puces).
  const voices = data.devices.flatMap((d) =>
    (Array.isArray(d.voices) ? d.voices : []).map((v) => ({
      id: slug(v.name),
      label: v.name,
      chip: d.chip,
      kind: v.kind,
      channelIndex: v.index,
      enabledByDefault: true,
    }))
  );
  if (voices.length === 0) return null;

  return { sampleRate: SR, voices };
}

// ---- CLI de test ----------------------------------------------------------
const isEntry = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isEntry) {
  const [, , source] = process.argv;
  if (!source) {
    console.error('Usage: node tools/gdm-probe.mjs <source.gbs>');
    process.exit(1);
  }
  catalogStems({ sourcePath: source, gdm: process.env.VDM_GDM ?? 'gdm' })
    .then((r) => console.log(JSON.stringify(r, null, 2)))
    .catch((err) => { console.error('échec :', err.message); process.exit(1); });
}
