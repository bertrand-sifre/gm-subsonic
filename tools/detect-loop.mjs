/**
 * tools/detect-loop.mjs
 *
 * Détection de point de boucle pour la musique de jeu émulée (NSF/NSFe via
 * libgme). Renvoie { introSamples, loopLengthSamples, loopStartSeconds,
 * loopLengthSeconds, sampleRate, confidence, repeats } ou null.
 *
 * MÉTHODE (éprouvée par spike sur de vrais NSFe) — et un anti-pattern à éviter :
 *  ⚠️ L'émulation NES n'est PAS bit-à-bit périodique : les oscillateurs de l'APU
 *  tournent en roue libre, donc une boucle redémarre la MUSIQUE mais pas la PHASE
 *  de l'onde. Une comparaison par égalité exacte / SSD échoue (50–120 % de RMS
 *  d'erreur à la vraie période). NE PAS « re-corriger » ce module vers le bit-exact.
 *
 *  On détecte donc sur une FEATURE INVARIANTE EN PHASE : l'enveloppe d'amplitude
 *  décimée, corrélée (NCC). Pipeline : rendre du PCM brut via libgme → enveloppe
 *  zéro-moyenne → fenêtre de queue glissée sur tous les lags (NCC max = longueur
 *  de boucle) → anti-harmonique (sous-multiples) → confirmation multi-ancres →
 *  loopStart = 1re occurrence stable du motif (sinon boucle pleine piste = 0).
 *
 * Usage CLI :  node tools/detect-loop.mjs <source> <trackIndex> [defaultSeconds]
 */

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ANALYSIS_SR = 11025; // taux de détection (décimé pour la vitesse)
const NATIVE_SR = 44100; // taux du rendu serveur (pour convertir s -> échantillons)
const D = 64; // décimation de l'enveloppe (~172 Hz)
const WREF_SEC = 25; // fenêtre de référence (queue)
const MIN_LAG_SEC = 4; // lag minimal cherché
const L_MIN_SEC = 1.0; // longueur de boucle minimale acceptée
const RENDER_MAX_SEC = 600; // plafond dur de rendu

/** Rend une sous-piste en PCM mono s16le @ ANALYSIS_SR via ffmpeg/libgme. */
function renderPCM(sourcePath, trackIndex, seconds) {
  return new Promise((resolve, reject) => {
    const child = spawn('ffmpeg', [
      '-hide_banner', '-loglevel', 'error',
      '-f', 'libgme', '-track_index', String(trackIndex), '-sample_rate', String(ANALYSIS_SR),
      '-i', sourcePath,
      '-t', String(seconds), '-ac', '1', '-f', 's16le', '-',
    ], { stdio: ['ignore', 'pipe', 'pipe'] });

    const chunks = [];
    let stderr = '';
    child.stdout.on('data', (d) => chunks.push(d));
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) return reject(new Error(`ffmpeg (code ${code}) : ${stderr.trim()}`));
      const buf = Buffer.concat(chunks);
      const n = Math.floor(buf.length / 2);
      const x = new Int16Array(n);
      for (let i = 0; i < n; i++) x[i] = buf.readInt16LE(i * 2);
      resolve({ x, actualSeconds: n / ANALYSIS_SR });
    });
  });
}

/** Enveloppe d'amplitude zéro-moyenne (feature invariante en phase). */
function envelope(x) {
  const n = x.length;
  const dN = Math.floor(n / D);
  const env = new Float64Array(dN);
  for (let i = 0; i < dN; i++) {
    let s = 0;
    for (let j = 0; j < D; j++) s += Math.abs(x[i * D + j]);
    env[i] = s / D;
  }
  let mean = 0;
  for (let i = 0; i < dN; i++) mean += env[i];
  mean /= dN || 1;
  for (let i = 0; i < dN; i++) env[i] -= mean;
  return env;
}

/** Corrélation croisée normalisée de deux fenêtres de l'enveloppe e. */
function ncc(e, a, b, W) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < W; i++) {
    const u = e[a + i];
    const v = e[b + i];
    dot += u * v;
    na += u * u;
    nb += v * v;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / Math.sqrt(na * nb);
}

/** Analyse une fenêtre de PCM et renvoie un verdict de boucle. */
function analyze(x) {
  const dSR = ANALYSIS_SR / D;
  const e = envelope(x);
  const dN = e.length;
  const Wref = Math.round(WREF_SEC * dSR);
  const ref = dN - Wref - 1;
  if (ref <= 0) return { looksLooping: false };

  // Fenêtre de référence silencieuse -> pas de boucle musicale en queue.
  let refEnergy = 0;
  for (let i = 0; i < Wref; i++) refEnergy += e[ref + i] * e[ref + i];
  if (Math.sqrt(refEnergy / Wref) < 1) return { looksLooping: false, reason: 'silent-tail' };

  // 1) Longueur de boucle : NCC max de la fenêtre de queue sur tous les lags.
  const minLag = Math.round(MIN_LAG_SEC * dSR);
  const maxLag = ref;
  const corr = new Float64Array(maxLag + 1);
  let bestLag = -1;
  let bestC = -2;
  for (let lag = minLag; lag <= maxLag; lag++) {
    const c = ncc(e, ref, ref - lag, Wref);
    corr[lag] = c;
    if (c > bestC) { bestC = c; bestLag = lag; }
  }
  if (bestLag < 0) return { looksLooping: false };

  // Base de bruit (p95 hors du pic) pour prouver que le pic est réel.
  const vals = [];
  for (let lag = minLag; lag <= maxLag; lag++) {
    if (Math.abs(lag - bestLag) < dSR * 2) continue;
    vals.push(corr[lag]);
  }
  vals.sort((a, b) => a - b);
  const p95 = vals.length ? vals[Math.floor(vals.length * 0.95)] : 0;

  // 2) Anti-harmonique : préférer un sous-multiple s'il corrèle aussi bien
  // (évite de prendre 2P pour la période). On garde la PLUS PETITE période
  // dont le NCC reste à ~0.04 du pic.
  let period = bestLag;
  for (const div of [4, 3, 2]) {
    const sub = Math.round(bestLag / div);
    if (sub < minLag) continue;
    const c = ncc(e, ref, ref - sub, Wref);
    if (c >= bestC - 0.04 && c > 0.9) { period = sub; break; }
  }
  const periodSec = period / dSR;
  if (periodSec < L_MIN_SEC) return { looksLooping: false };

  // 3) Confirmation à plusieurs ancres temporelles (jitter ±0.3 s).
  let good = 0;
  let tot = 0;
  const span = Math.round(0.3 * dSR);
  for (const rs of [40, 60, 90, 120, 150]) {
    const a = Math.round(rs * dSR);
    if (a + Wref > dN || a - period - span < 0) continue;
    tot++;
    let bv = -2;
    for (let L = period - span; L <= period + span; L++) {
      const c = ncc(e, a, a - L, Wref);
      if (c > bv) bv = c;
    }
    if (bv > 0.8) good++;
  }

  // 4) loopStart : 1re position où le motif se répète de façon stable.
  const W2 = Math.round(8 * dSR);
  const step = Math.max(1, Math.round(0.05 * dSR));
  const need = Math.round(period * 0.5);
  const maxT = dN - period - W2 - 1;
  let runStart = -1;
  let loopStart = -1;
  for (let t = 0; t <= maxT; t += step) {
    const c = ncc(e, t, t + period, W2);
    if (c >= 0.85) {
      if (runStart < 0) runStart = t;
      if (t - runStart >= need) { loopStart = runStart; break; }
    } else {
      runStart = -1;
    }
  }

  const looksLooping = bestC > 0.9 && bestC - p95 > 0.2 && good >= Math.max(2, tot - 1);
  return {
    looksLooping,
    loopLengthSeconds: periodSec,
    loopStartSeconds: loopStart >= 0 ? loopStart / dSR : 0,
    peakNCC: bestC,
    p95,
    confirm: `${good}/${tot}`,
  };
}

/** Durées de rendu successives (adaptatif) jusqu'au plafond. */
function renderSchedule(defaultSeconds) {
  let t = Math.min(300, Math.max(180, Math.round(2.2 * (defaultSeconds || 120))));
  const out = [];
  while (t <= RENDER_MAX_SEC) {
    out.push(t);
    if (t >= RENDER_MAX_SEC) break;
    t = Math.min(RENDER_MAX_SEC, Math.ceil(t * 1.6));
  }
  return out;
}

/**
 * Détecte la boucle d'une sous-piste émulée. Renvoie les repères (secondes
 * canoniques + échantillons au taux natif) ou null si non bouclée / incertain.
 */
export async function detectLoop(sourcePath, trackIndex, opts = {}) {
  const defaultSeconds = opts.defaultSeconds ?? 120;
  for (const T of renderSchedule(defaultSeconds)) {
    const { x, actualSeconds } = await renderPCM(sourcePath, trackIndex, T);
    const r = analyze(x);
    if (r.looksLooping) {
      return {
        introSamples: Math.round(r.loopStartSeconds * NATIVE_SR),
        loopLengthSamples: Math.round(r.loopLengthSeconds * NATIVE_SR),
        loopStartSeconds: +r.loopStartSeconds.toFixed(4),
        loopLengthSeconds: +r.loopLengthSeconds.toFixed(4),
        sampleRate: NATIVE_SR,
        confidence: +r.peakNCC.toFixed(4),
        repeats: +(actualSeconds / r.loopLengthSeconds).toFixed(2),
      };
    }
    // libgme a émis nettement moins que demandé => piste one-shot (jingle/non bouclée).
    if (actualSeconds < T * 0.9) return null;
  }
  return null;
}

// ---- CLI de test ----------------------------------------------------------
const isEntry = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isEntry) {
  const [, , source, trackIndex, defaultSeconds] = process.argv;
  if (!source || trackIndex == null) {
    console.error('Usage: node tools/detect-loop.mjs <source> <trackIndex> [defaultSeconds]');
    process.exit(1);
  }
  detectLoop(source, Number(trackIndex), { defaultSeconds: Number(defaultSeconds) || 120 })
    .then((r) => console.log(JSON.stringify(r, null, 2)))
    .catch((err) => { console.error('échec :', err.message); process.exit(1); });
}
