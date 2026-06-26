/**
 * tools/gen-fixtures.mjs
 *
 * Génère des fixtures audio de DÉVELOPPEMENT pour vdm-subsonic.
 *
 * Deux étapes :
 *   (a) on SYNTHÉTISE en Node, sans aucune dépendance, 3 morceaux de test en
 *       WAV PCM 16 bits mono 44 100 Hz ;
 *   (b) on appelle ffmpeg (via child_process) pour transcoder chaque WAV en
 *       Ogg Vorbis (libvorbis), en injectant les tags LOOPSTART / LOOPLENGTH
 *       (exprimés en ÉCHANTILLONS) calculés depuis les points de boucle.
 *
 * Pourquoi des « bips » (fenêtres de Hann) ?
 *   La section de boucle contient une enveloppe d'amplitude périodique. Chaque
 *   bip est une fenêtre de Hann : 0.5 * (1 - cos(2π·n/L)), STRICTEMENT NULLE à
 *   ses deux bords. En faisant pile un nombre entier de bips par section, le
 *   premier échantillon de la boucle ET le dernier valent ~0 : la jointure
 *   loopEnd -> loopStart se fait donc sans clic, tout en restant audible
 *   (on entend nettement la pulsation se répéter à chaque tour de boucle).
 *
 * Sortie : les .ogg sont écrits dans media/ (à côté de meta.json). Les .wav
 * intermédiaires sont conservés (ils sont gitignorés) pour pouvoir les écouter.
 *
 * Usage :  node tools/gen-fixtures.mjs   (ou  npm run fixtures)
 */

import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
// tools/ -> racine du dépôt -> media/
const MEDIA_DIR = join(__dirname, '../media');

/** Fréquence d'échantillonnage commune à toutes les fixtures. */
export const SR = 44100;

/**
 * Table de fréquences (tempérament égal, La4 = 440 Hz). On reste sur des notes
 * franches et bien distinctes d'une section à l'autre pour « entendre » la
 * structure intro / boucle / queue.
 */
const N = {
  A3: 220.0,
  C4: 261.63,
  D4: 293.66,
  E4: 329.63,
  F4: 349.23,
  Fs4: 369.99,
  G4: 392.0,
  A4: 440.0,
  B4: 493.88,
  C5: 523.25,
  D5: 587.33,
  E5: 659.25,
};

/**
 * Description des 3 fixtures. Chaque section est rendue comme une suite de
 * bips (un par note) tuilés sur toute sa durée. Le rôle « loop » marque la
 * section dont on extraira LOOPSTART / LOOPLENGTH.
 */
export const TRACKS = [
  {
    // 1) Ocarina of Time / Gerudo Valley : intro 0-2s, boucle 2-6s, queue 6-8s.
    title: 'Gerudo Valley',
    wavFile: 'gerudo-valley.wav',
    oggFile: 'gerudo-valley.ogg',
    sections: [
      // Intro : motif montant façon flamenco, registre médium.
      { role: 'intro', durationSec: 2, amplitude: 0.7, notes: [N.E4, N.A4, N.B4, N.C5] },
      // Boucle : le motif accrocheur qui se répète (registre aigu, 8 bips).
      { role: 'loop', durationSec: 4, amplitude: 0.8, notes: [N.A4, N.C5, N.E5, N.C5, N.B4, N.D5, N.B4, N.A4] },
      // Queue : résolution descendante, registre grave.
      { role: 'tail', durationSec: 2, amplitude: 0.6, notes: [N.E4, N.C4, N.A3, N.A3] },
    ],
  },
  {
    // 2) Pièce « classique » SANS boucle, ~5s (une seule section, pas de tags).
    title: 'Prélude (sans boucle)',
    wavFile: 'prelude-no-loop.wav',
    oggFile: 'prelude-no-loop.ogg',
    sections: [
      { role: 'body', durationSec: 5, amplitude: 0.7, notes: [N.C4, N.E4, N.G4, N.C5, N.G4, N.E4, N.D4, N.F4, N.A4, N.C4] },
    ],
  },
  {
    // 3) Thème de combat : intro 0-1s, boucle 1-5s, SANS queue.
    title: 'Thème de combat',
    wavFile: 'battle-theme.wav',
    oggFile: 'battle-theme.ogg',
    sections: [
      // Intro : stinger tendu et bref (2 bips).
      { role: 'intro', durationSec: 1, amplitude: 0.7, notes: [N.D4, N.A4] },
      // Boucle : riff nerveux et répétitif (8 bips), registre médium-grave.
      { role: 'loop', durationSec: 4, amplitude: 0.85, notes: [N.E4, N.E4, N.G4, N.E4, N.A4, N.E4, N.G4, N.Fs4] },
    ],
  },
];

/**
 * Rend une section : `notes.length` bips tuilés sur `durationSec`. Chaque bip
 * est une porteuse sinusoïdale fenêtrée par une Hann -> 0 strict aux deux bords
 * du bip (donc 0 au tout début et ~0 à la toute fin de la section).
 *
 * @returns {Float32Array} échantillons dans [-1, 1].
 */
export function renderSection({ durationSec, notes, amplitude }) {
  const total = Math.round(durationSec * SR);
  const out = new Float32Array(total);
  const beats = notes.length;

  for (let b = 0; b < beats; b++) {
    // Bornes entières du bip : on tuile exactement, sans trou ni recouvrement.
    const start = Math.round((b / beats) * total);
    const end = Math.round(((b + 1) / beats) * total);
    const len = end - start;
    const freq = notes[b];

    for (let n = 0; n < len; n++) {
      // Fenêtre de Hann : nulle à n=0 et à n=len (jointure sans clic).
      const win = 0.5 * (1 - Math.cos((2 * Math.PI * n) / len));
      const idx = start + n;
      // Phase continue à l'intérieur de la section.
      const phase = (2 * Math.PI * freq * idx) / SR;
      out[idx] = amplitude * win * Math.sin(phase);
    }
  }
  return out;
}

/**
 * Assemble une piste depuis ses sections et calcule les points de boucle en
 * échantillons (à partir des longueurs réelles, pour rester exact).
 *
 * @returns {{ samples: Float32Array, loopStartSamples: number|null, loopLengthSamples: number|null }}
 */
export function buildTrack(track) {
  const rendered = track.sections.map((s) => ({ role: s.role, data: renderSection(s) }));
  const totalLen = rendered.reduce((acc, r) => acc + r.data.length, 0);
  const samples = new Float32Array(totalLen);

  let cursor = 0;
  let loopStartSamples = null;
  let loopLengthSamples = null;
  for (const r of rendered) {
    samples.set(r.data, cursor);
    if (r.role === 'loop') {
      loopStartSamples = cursor;
      loopLengthSamples = r.data.length;
    }
    cursor += r.data.length;
  }
  return { samples, loopStartSamples, loopLengthSamples };
}

/**
 * Encode des échantillons flottants [-1, 1] en WAV PCM 16 bits mono.
 * @returns {Buffer}
 */
export function encodeWavPCM16(samples, sampleRate = SR) {
  const numSamples = samples.length;
  const bytesPerSample = 2;
  const blockAlign = bytesPerSample * 1; // 1 canal (mono)
  const byteRate = sampleRate * blockAlign;
  const dataSize = numSamples * bytesPerSample;
  const buf = Buffer.alloc(44 + dataSize);

  let o = 0;
  buf.write('RIFF', o); o += 4;
  buf.writeUInt32LE(36 + dataSize, o); o += 4;
  buf.write('WAVE', o); o += 4;
  buf.write('fmt ', o); o += 4;
  buf.writeUInt32LE(16, o); o += 4; // taille du sous-chunk fmt (PCM)
  buf.writeUInt16LE(1, o); o += 2;  // format audio = 1 (PCM)
  buf.writeUInt16LE(1, o); o += 2;  // canaux = 1
  buf.writeUInt32LE(sampleRate, o); o += 4;
  buf.writeUInt32LE(byteRate, o); o += 4;
  buf.writeUInt16LE(blockAlign, o); o += 2;
  buf.writeUInt16LE(16, o); o += 2; // bits par échantillon
  buf.write('data', o); o += 4;
  buf.writeUInt32LE(dataSize, o); o += 4;

  for (let i = 0; i < numSamples; i++) {
    let s = Math.max(-1, Math.min(1, samples[i]));
    // -1 -> -32768, +1 -> +32767 (échelle asymétrique correcte du PCM signé).
    s = s < 0 ? s * 0x8000 : s * 0x7fff;
    buf.writeInt16LE(s | 0, o); o += 2;
  }
  return buf;
}

/**
 * Exécute une commande externe et résout avec sa sortie, ou rejette avec un
 * message clair (ffmpeg absent, ou code de sortie non nul + stderr).
 */
function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', (err) => {
      if (err.code === 'ENOENT') {
        reject(new Error(
          `Commande introuvable : « ${cmd} ». ffmpeg est-il installé ? ` +
          `Dans le conteneur de dev il l'est ; sur l'hôte, lancez plutôt :\n` +
          `  docker compose run --rm app npm run fixtures`,
        ));
      } else {
        reject(err);
      }
    });
    child.on('close', (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`« ${cmd} » a échoué (code ${code}) :\n${stderr.trim()}`));
    });
  });
}

/** Vérifie que ffmpeg est disponible avant de commencer le travail. */
async function assertFfmpeg() {
  try {
    await run('ffmpeg', ['-hide_banner', '-version']);
  } catch (err) {
    throw new Error(`ffmpeg indisponible.\n${err.message}`);
  }
}

/**
 * Transcode un WAV en Ogg Vorbis et injecte les tags de boucle si présents.
 * LOOPSTART / LOOPLENGTH sont en échantillons (convention reconnue par de
 * nombreux moteurs de jeu et lecteurs de musique en boucle).
 */
async function transcodeToOgg(wavPath, oggPath, { loopStartSamples, loopLengthSamples }) {
  const args = [
    '-hide_banner',
    '-loglevel', 'error',
    '-y',                 // écrase la sortie sans demander
    '-i', wavPath,
    '-ac', '1',           // force mono
    '-ar', String(SR),    // force 44 100 Hz (les échantillons des tags restent cohérents)
    '-c:a', 'libvorbis',
    '-qscale:a', '5',     // qualité Vorbis ~160 kbps, large dynamique
  ];
  if (loopStartSamples != null && loopLengthSamples != null) {
    args.push('-metadata', `LOOPSTART=${loopStartSamples}`);
    args.push('-metadata', `LOOPLENGTH=${loopLengthSamples}`);
  }
  args.push(oggPath);

  await run('ffmpeg', args);
}

/** Point d'entrée : synthèse -> WAV -> transcodage OGG pour les 3 fixtures. */
async function main() {
  await mkdir(MEDIA_DIR, { recursive: true });
  await assertFfmpeg();

  console.log(`[fixtures] dossier de sortie : ${MEDIA_DIR}`);

  for (const track of TRACKS) {
    const { samples, loopStartSamples, loopLengthSamples } = buildTrack(track);

    // (a) Synthèse WAV.
    const wavPath = join(MEDIA_DIR, track.wavFile);
    await writeFile(wavPath, encodeWavPCM16(samples, SR));

    // (b) Transcodage OGG + injection des tags de boucle.
    const oggPath = join(MEDIA_DIR, track.oggFile);
    await transcodeToOgg(wavPath, oggPath, { loopStartSamples, loopLengthSamples });

    if (loopStartSamples != null) {
      const startSec = (loopStartSamples / SR).toFixed(3);
      const endSec = ((loopStartSamples + loopLengthSamples) / SR).toFixed(3);
      console.log(
        `[fixtures] ${track.oggFile.padEnd(22)} OK  ` +
        `loop ${startSec}s -> ${endSec}s  ` +
        `(LOOPSTART=${loopStartSamples}, LOOPLENGTH=${loopLengthSamples})`,
      );
    } else {
      console.log(`[fixtures] ${track.oggFile.padEnd(22)} OK  (sans boucle)`);
    }
  }

  console.log('[fixtures] terminé. Pensez à garder media/meta.json cohérent.');
}

// On ne lance main() que si le script est exécuté directement (et pas importé).
const isEntry = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isEntry) {
  main().catch((err) => {
    console.error('[fixtures] échec :', err.message);
    process.exit(1);
  });
}
