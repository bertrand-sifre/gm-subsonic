/**
 * tools/nsf-stems.mjs
 *
 * Extrait les STEMS par voix d'un morceau NES via nsftool (cœur nsfplay) :
 * une piste audio isolée par canal APU (Pulse 1/2, Triangle, Noise, DMC, +
 * voix d'extension). Le client les mixe et permet de les activer/désactiver
 * en direct (les « couches » de la vision).
 *
 * Synchro : tous les canaux sont rendus par nsftool (émulation DÉTERMINISTE,
 * APU2_OPTION5/7=0) sur les MÊMES bornes -> OGG de longueur identique, alignés
 * à l'échantillon. La boucle vient du détecteur MOTEUR de nsftool (le plus
 * précis), avec repli sur la boucle audio (detect-loop.mjs) si non-convergence.
 * On n'extrait des stems que pour les pistes qui BOUCLENT (cas utile).
 *
 * Repli : si nsftool est indisponible ou échoue -> renvoie null, la piste reste
 * servie par le chemin libgme (rendu paramétrique / artefact de boucle).
 */

import { spawn } from 'node:child_process';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';

const SR = 44100;
const EPS_MS = 50; // marge de queue (futur crossfade)
const SILENCE_RMS = 8; // RMS 16-bit en dessous = voix muette sur cette piste
const DETECT_MS = 120000; // budget de détection moteur

/** Voix de base 2A03 (toujours présentes sur NES). Index = canal nsftool. */
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

function mkLoop(startSeconds, lengthSeconds) {
  return {
    startSeconds: +startSeconds.toFixed(4),
    lengthSeconds: +lengthSeconds.toFixed(4),
    startSamples: Math.round(startSeconds * SR),
    lengthSamples: Math.round(lengthSeconds * SR),
    sampleRate: SR,
  };
}

/**
 * @returns {{ sampleRate, voices:[{id,label,chip,kind,file,enabledByDefault}], loop }|null}
 */
export async function extractStems({ sourcePath, trackIndex, id, audioLoop, mediaDir, nsftool = 'nsftool' }) {
  const t = String(trackIndex + 1); // nsftool : piste 1-based

  // 1) Puce d'extension -> liste des voix candidates.
  const info = await run(nsftool, ['-t', t, '-l', '300', sourcePath]);
  if (info.code !== 0) return null; // nsftool indispo/échec -> repli libgme
  const chip = parseInt((/chip=0x([0-9a-f]+)/i.exec(info.stdout) || [])[1] || '0', 16);
  const candidates = [...BASE];
  for (const e of EXP) if (chip & e.bit) candidates.push(...e.voices);

  // 2) Boucle : détecteur moteur d'abord (plus précis), sinon boucle audio.
  let loop = null;
  const det = await run(nsftool, ['-t', t, '-l', String(DETECT_MS), '--detect', sourcePath]);
  const lm = /LOOP_DETECTED start=(\d+)ms end=(\d+)ms period=(\d+)ms/.exec(det.stdout);
  if (lm) loop = mkLoop(Number(lm[1]) / 1000, Number(lm[3]) / 1000);
  else if (audioLoop) loop = mkLoop(audioLoop.startSeconds, audioLoop.lengthSeconds);

  // On ne fait des stems que pour les pistes qui bouclent (cas utile + borné).
  if (!loop) return null;

  // 3) Bornes IDENTIQUES pour tous les canaux (clé de la synchro).
  const lengthMs = Math.round((loop.startSeconds + loop.lengthSeconds) * 1000 + EPS_MS);
  const outDir = join(mediaDir, '_stems', id);
  await mkdir(outDir, { recursive: true });

  // 4) Un stem par voix : nsftool --solo -> WAV -> OGG taggé.
  const voices = [];
  for (const ch of candidates) {
    const wav = join(outDir, `${ch.id}.wav`);
    const ogg = join(outDir, `${ch.id}.ogg`);
    const r = await run(nsftool, ['-t', t, '-l', String(lengthMs), '-r', String(SR), '-c', '1', '--solo', String(ch.idx), '-o', wav, sourcePath]);
    if (r.code !== 0) { await rm(wav, { force: true }); continue; }
    const rms = Number((/RMS=([\d.]+)/.exec(r.stdout) || [])[1] || 0);

    const enc = ['-hide_banner', '-loglevel', 'error', '-y', '-i', wav, '-c:a', 'libvorbis', '-qscale:a', '4',
      '-metadata', `LOOPSTART=${loop.startSamples}`, '-metadata', `LOOPLENGTH=${loop.lengthSamples}`, ogg];
    const e2 = await run('ffmpeg', enc);
    await rm(wav, { force: true });
    if (e2.code !== 0) continue;

    voices.push({
      id: ch.id, label: ch.label, chip: ch.chip, kind: ch.kind,
      file: `_stems/${id}/${ch.id}.ogg`,
      enabledByDefault: rms >= SILENCE_RMS,
    });
  }

  if (voices.length === 0) { await rm(outDir, { recursive: true, force: true }); return null; }
  return { sampleRate: SR, voices, loop };
}
