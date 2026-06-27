/**
 * tools/nsf-stems.mjs
 *
 * CATALOGUE des voix (stems) d'un morceau NES, à l'import. Léger et instantané :
 * on lit juste la puce (en-tête NSF) pour savoir quelles voix existent — AUCUN
 * rendu audio ici. Le rendu de chaque voix se fait À LA DEMANDE côté serveur
 * (apps/server/src/main.ts), comme l'artefact de boucle, puis est mis en cache.
 *
 * Une voix = un canal de l'APU (Pulse 1/2, Triangle, Noise, DMC) ou d'une
 * extension (VRC6/VRC7/FDS/MMC5/N163/5B). Le client les mixe et permet de les
 * activer/désactiver en direct (les « couches » de la vision).
 *
 * On ne catalogue des voix que pour les pistes qui BOUCLENT : les bornes de
 * rendu des stems viennent de la boucle (détectée par tools/nsf-loop.mjs).
 *
 * Repli : nsftool indisponible / échec -> renvoie null, la piste reste servie
 * par le chemin libgme (rendu paramétrique / artefact de boucle).
 */

import { spawn } from 'node:child_process';

const SR = 44100;

/** Voix de base 2A03 (toujours présentes sur NES). channelIndex = canal nsftool. */
const BASE = [
  { idx: 0, id: 'pulse1', label: 'Pulse 1', chip: '2A03', kind: 'pulse' },
  { idx: 1, id: 'pulse2', label: 'Pulse 2', chip: '2A03', kind: 'pulse' },
  { idx: 2, id: 'triangle', label: 'Triangle', chip: '2A03', kind: 'triangle' },
  { idx: 3, id: 'noise', label: 'Noise', chip: '2A03', kind: 'noise' },
  { idx: 4, id: 'dmc', label: 'DMC', chip: '2A03', kind: 'dmc' },
];

/** Voix d'extension, incluses selon le bit de puce de l'en-tête NSF. */
const EXP = [
  { bit: 0x04, voices: [{ idx: 5, id: 'fds', label: 'FDS', chip: 'FDS', kind: 'wave' }] },
  { bit: 0x08, voices: [
    { idx: 6, id: 'mmc5-pulse1', label: 'MMC5 Pulse 1', chip: 'MMC5', kind: 'pulse' },
    { idx: 7, id: 'mmc5-pulse2', label: 'MMC5 Pulse 2', chip: 'MMC5', kind: 'pulse' },
    { idx: 8, id: 'mmc5-pcm', label: 'MMC5 PCM', chip: 'MMC5', kind: 'pcm' },
  ] },
  { bit: 0x20, voices: [
    { idx: 9, id: '5b-1', label: '5B Square 1', chip: '5B', kind: 'pulse' },
    { idx: 10, id: '5b-2', label: '5B Square 2', chip: '5B', kind: 'pulse' },
    { idx: 11, id: '5b-3', label: '5B Square 3', chip: '5B', kind: 'pulse' },
  ] },
  { bit: 0x01, voices: [
    { idx: 12, id: 'vrc6-pulse1', label: 'VRC6 Pulse 1', chip: 'VRC6', kind: 'pulse' },
    { idx: 13, id: 'vrc6-pulse2', label: 'VRC6 Pulse 2', chip: 'VRC6', kind: 'pulse' },
    { idx: 14, id: 'vrc6-saw', label: 'VRC6 Saw', chip: 'VRC6', kind: 'saw' },
  ] },
  { bit: 0x02, voices: Array.from({ length: 6 }, (_, i) => ({ idx: 15 + i, id: `vrc7-${i + 1}`, label: `VRC7 FM ${i + 1}`, chip: 'VRC7', kind: 'fm' })) },
  { bit: 0x10, voices: Array.from({ length: 8 }, (_, i) => ({ idx: 21 + i, id: `n163-${i + 1}`, label: `N163 Wave ${i + 1}`, chip: 'N163', kind: 'wave' })) },
];

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
 * Liste les voix d'une piste NES (instantané : une lecture de la puce, pas de
 * rendu). Le rendu de chaque voix est fait à la demande par le serveur.
 *
 * @param {object} o
 * @param {string} o.sourcePath  source NSF/NSFe
 * @param {number} o.trackIndex  index de sous-piste 0-based
 * @param {object|null} o.loop   boucle détectée en amont (nsf-loop) ; null -> pas de voix
 * @param {string} [o.nsftool]
 * @returns {{ sampleRate, voices:[{id,label,chip,kind,channelIndex,enabledByDefault}] }|null}
 */
export async function catalogStems({ sourcePath, trackIndex, loop, nsftool = 'nsftool' }) {
  if (!loop) return null; // voix seulement pour les pistes qui bouclent
  const t = String(trackIndex + 1); // nsftool : piste 1-based

  const info = await run(nsftool, ['-t', t, '-l', '300', sourcePath]);
  if (info.code !== 0) return null; // nsftool indispo/échec -> repli libgme
  const chip = parseInt((/chip=0x([0-9a-f]+)/i.exec(info.stdout) || [])[1] || '0', 16);

  const candidates = [...BASE];
  for (const e of EXP) if (chip & e.bit) candidates.push(...e.voices);

  const voices = candidates.map((ch) => ({
    id: ch.id,
    label: ch.label,
    chip: ch.chip,
    kind: ch.kind,
    channelIndex: ch.idx,
    enabledByDefault: true,
  }));
  return { sampleRate: SR, voices };
}
