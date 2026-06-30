/**
 * tools/nsf-loop.mjs
 *
 * Détecteur de boucle UNIQUE pour la musique NES (NSF/NSFe), déterministe et
 * indépendant du taux de rendu. Source de vérité : l'AUTOCORRÉLATION du log de
 * registres APU produit par nsftool (`--log 1`).
 *
 * Pourquoi le log et pas `--detect` : le log de registres est ce que le CPU
 * 6502 écrit dans l'APU à chaque frame ; il est strictement périodique quand la
 * musique boucle (la séquence d'écritures se répète à l'identique), peu importe
 * la phase des oscillateurs ou le taux de rendu. On cherche donc la plus petite
 * période de frames qui « pave » exactement la queue du log. La valeur de
 * `--detect` (fausse / sensible au rate) n'est PAS utilisée : son rôle de
 * « oui/non » est couvert par l'autocorrélation, qui renvoie null si la piste
 * n'est pas périodique (→ repli paramétrique côté serveur).
 *
 * Logique portée trait pour trait de l'analyseur de référence empirique
 * (scratchpad/loopexact.py), validé sur SMB1/SMB3.
 *
 * Export : detectLoop({ sourcePath, trackIndex, nsftool, mediaDir, defaultSeconds })
 *   -> { startSeconds, lengthSeconds, startSamples, lengthSamples, sampleRate } | null
 *
 * Usage CLI :  node tools/nsf-loop.mjs <source> <trackIndex> [defaultSeconds]
 */

import { spawn } from 'node:child_process';
import { rm } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const FPS = 60.0988; // fps NTSC NSF (1789772.7 / 29780.5) — fps autoritaire NES du wrapper
const LOG_RATE = 8000; // rendu rapide ; le log de registres est rate-indépendant
const LOG_LEN_MS = 200000; // 200 s : couvre toute boucle <= ~100 s avec marge >= 1 période
const SPAWN_TIMEOUT_MS = 30000; // garde-fou : tue nsftool si un fichier bloque
// Les seuils d'analyse (sampleRate 44100, pmin 1 s, pmax 100 s, garde de queue 2 s,
// minDistinctFrames 8) vivent désormais comme défauts d'`opts` d'analyzeStates.

/**
 * Exécute une commande ; ne rejette jamais. Tue le process après un timeout
 * (protège le boot d'un fichier pathologique). Renvoie { code, stdout, stderr }.
 */
function run(cmd, args, timeoutMs) {
  return new Promise((resolve) => {
    const c = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = timeoutMs
      ? setTimeout(() => { timedOut = true; c.kill('SIGKILL'); }, timeoutMs)
      : null;
    c.stdout.on('data', (d) => { stdout += d; });
    c.stderr.on('data', (d) => { stderr += d; });
    c.on('error', (err) => { if (timer) clearTimeout(timer); resolve({ code: -1, stdout, stderr: String(err) }); });
    c.on('close', (code) => {
      if (timer) clearTimeout(timer);
      resolve({ code: timedOut ? -1 : code, stdout, stderr });
    });
  });
}

/**
 * Parse un log de registres (miroir exact de loadFrames de loopexact.py) :
 * ignore BEGIN/INIT ; chaque PLAY(...) ouvre une frame ; les WRITE(...) qui
 * suivent sont accumulés ; la collecte démarre à la 1re PLAY. Chaque frame est
 * internée (join des WRITE -> entier) pour des comparaisons entières rapides.
 *
 * @returns {{ H: Int32Array, N: number }}
 */
function parseLog(text) {
  const frames = [];
  let cur = [];
  let started = false;
  for (const raw of text.split('\n')) {
    if (raw.startsWith('PLAY')) {
      if (started) frames.push(cur.join('\n'));
      cur = [];
      started = true;
    } else if (raw.startsWith('WRITE')) {
      cur.push(raw.trim());
    }
    // BEGIN / INIT / lignes vides : ignorés.
  }
  if (started) frames.push(cur.join('\n'));

  // Internement : chaque contenu de frame -> id entier via une Map.
  const ids = new Map();
  const N = frames.length;
  const H = new Int32Array(N);
  for (let i = 0; i < N; i++) {
    const key = frames[i];
    let id = ids.get(key);
    if (id === undefined) { id = ids.size; ids.set(key, id); }
    H[i] = id;
  }
  return { H, N };
}

/**
 * Autocorrélation exacte d'une suite d'états de frame INTERNÉS (port direct de
 * analyze + detectLoopFromLog de loopexact.py), PARTAGÉE entre le NES (nsftool) et
 * le GBS (tools/gdm-loop.mjs via `gdm loop`). `states` = un id entier par frame de
 * jeu (frames égales <=> mêmes écritures de registres dans le même ordre) ; `fps` =
 * le frame-rate AUTORITAIRE du log (60.0988 Hz NTSC pour le NES ; 4194304/play_period
 * émis par l'émulateur pour le GBS). Les seuils vivent dans `opts` (défauts = les
 * constantes historiques NES -> wrapper NES inchangé bit pour bit).
 *
 *  - garde courte : log trop court pour intro + >= 1 période + garde de queue -> null.
 *  - tailrun(p) : nb de frames contiguës states[i]==states[i+p] depuis i=N-p-1.
 *  - candidats : p in [round(pminSec·fps), min(N-round(tailGuardSec·fps),
 *    round(pmaxSec·fps))) avec tailrun(p) >= p (au moins une période parfaite répétée).
 *  - fondamentaux : candidats non multiples d'un candidat plus petit ; p_star = plus
 *    petit fondamental. Aucun candidat -> null (non périodique).
 *  - loop_start : (dernier mismatch descendant depuis N-p_star-1) + 1.
 *  - rejet des boucles triviales : période avec < minDistinctFrames états distincts
 *    (flux constant : SFX, note tenue, silence) -> null.
 *
 * @param {Int32Array|number[]} states  un id de frame par frame de jeu
 * @param {number} fps                  frame-rate autoritaire (Hz)
 * @param {object} [opts]               sampleRate/pminSec/pmaxSec/tailGuardSec/minDistinctFrames
 * @returns {{ startSeconds, lengthSeconds, startSamples, lengthSamples, sampleRate } | null}
 */
export function analyzeStates(states, fps, opts = {}) {
  const {
    sampleRate = 44100,
    pminSec = 1,
    pmaxSec = 100,
    tailGuardSec = 2,
    minDistinctFrames = 8,
    // GBS : la 1re frame de jeu porte le one-shot d'init (upload wave RAM, config)
    // jamais rejoué à la boucle -> mismatch BÉNIN. Quand activé, on exclut la frame 0
    // du scan loopStart (=> boucle dès la frame 0 si le reste est périodique).
    ignoreFirstFrameMismatch = false,
    // GBS : le log d'ÉCRITURES (delta) est aveugle à la NOTE TENUE. refineStates (un
    // id d'ÉTAT complet des registres par frame) avance loopStart vers la 1re frame
    // dont l'état coïncide une période plus loin -> raccord sans note résiduelle.
    refineStates = null,
  } = opts;

  const H = states;
  const N = H.length;

  const pminFrames = Math.round(pminSec * fps);
  const tailGuardFrames = Math.round(tailGuardSec * fps);
  if (N < pminFrames + tailGuardFrames) return null; // log trop court

  // tailrun : la longueur de queue exactement répétée à la période p.
  const tailrun = (p) => {
    let i = N - p - 1;
    let r = 0;
    while (i >= 0 && H[i] === H[i + p]) { r++; i--; }
    return r;
  };

  const pmin = pminFrames;
  const pmax = Math.min(N - tailGuardFrames, Math.round(pmaxSec * fps));
  const cands = [];
  for (let p = pmin; p < pmax; p++) {
    if (tailrun(p) >= p) cands.push(p); // au moins une période entière se répète parfaitement
  }
  if (cands.length === 0) return null; // non proprement périodique -> repli paramétrique

  // Fondamentaux = candidats non multiples d'un candidat strictement plus petit.
  // (cands est déjà trié croissant ; on prend le plus petit fondamental.)
  let pStar = -1;
  for (const p of cands) {
    let isFundamental = true;
    for (const q of cands) {
      if (q < p && p % q === 0) { isFundamental = false; break; }
    }
    if (isFundamental) { pStar = p; break; }
  }
  if (pStar < 0) pStar = cands[0];

  // loop_start : 1re frame à partir de laquelle la queue est exactement périodique.
  // scanFloor=1 (ignoreFirstFrameMismatch) saute la frame 0 (artefact d'init GBS).
  const scanFloor = ignoreFirstFrameMismatch ? 1 : 0;
  let i = N - pStar - 1;
  let lastMismatch = -1;
  while (i >= scanFloor) {
    if (H[i] !== H[i + pStar]) { lastMismatch = i; break; }
    i--;
  }
  let loopStartFrames = lastMismatch + 1; // les frames avant peuvent différer (intro)
  const periodFrames = pStar;

  // Raffinement seamless : si une vraie intro précède la boucle, avancer loopStart
  // vers la 1re frame dont l'ÉTAT complet (refineStates) coïncide une période plus
  // loin -> la note tenue à la frontière provient de l'intérieur de la boucle, donc
  // pas de raccord sur une note résiduelle de l'intro. (Sans refineStates : no-op.)
  if (refineStates && loopStartFrames > 0) {
    for (let L = loopStartFrames; L < loopStartFrames + periodFrames && L + periodFrames < N; L++) {
      if (refineStates[L] === refineStates[L + periodFrames]) { loopStartFrames = L; break; }
    }
  }

  // Rejet des « boucles » triviales (flux constant : SFX, note tenue, silence).
  const seen = new Set();
  for (let j = loopStartFrames; j < loopStartFrames + periodFrames && j < N; j++) {
    seen.add(H[j]);
    if (seen.size >= minDistinctFrames) break;
  }
  if (seen.size < minDistinctFrames) return null;

  return {
    startSeconds: +(loopStartFrames / fps).toFixed(4),
    lengthSeconds: +(periodFrames / fps).toFixed(4),
    startSamples: Math.round((loopStartFrames * sampleRate) / fps),
    lengthSamples: Math.round((periodFrames * sampleRate) / fps),
    sampleRate,
    frameRate: +fps.toFixed(4), // repère « frame » côté lecteur (diagnostic)
  };
}

/**
 * Détecte la FIN d'une piste FINIE (non-bouclante) à partir de la suite des ÉTATS
 * COMPLETS de registres par frame (un id par frame, frames d'état égal <=> même id).
 *
 * Pourquoi pas « la dernière écriture » : beaucoup de drivers ne RENDENT PAS LA MAIN
 * en fin de morceau — ils continuent d'ÉCRIRE chaque frame les mêmes valeurs idle
 * (silence : volume maître 0, canaux coupés) indéfiniment. La dernière écriture est
 * alors la fin de fenêtre (fausse durée « 2:00 »), alors que la musique s'est tue
 * bien avant. Ex. mesuré : Tetris Game Boy piste 1 écrit `…15ff` à CHAQUE frame
 * jusqu'à 200 s, mais son ÉTAT ne change plus après ~38.6 s (≈ 0:40).
 *
 * On prend donc le DERNIER instant où l'état change réellement, à condition qu'il
 * soit suivi d'une QUEUE CONSTANTE assez longue (>= tailGuard) — sinon la piste
 * évolue encore en fin de fenêtre (bouclante/longue) : pas de fin franche -> null,
 * on garde le repli paramétrique côté importeur.
 *
 * Hypothèse : la queue constante EST un silence (les drivers terminent par volumes à
 * 0). Une piste figée sur une NOTE TENUE serait coupée à l'attaque de la tenue ; cas
 * non observé sur le corpus GBS (terminaisons en silence franc).
 *
 * @param {Int32Array|number[]} fullStates  un id d'ÉTAT complet des registres par frame
 * @param {number} fps                      frame-rate autoritaire (Hz)
 * @param {object} [opts]                   tailGuardSec (défaut 2)
 * @returns {number|null}  durée naturelle en secondes (à 1e-4), ou null (pas de fin franche)
 */
export function analyzeFiniteEnd(fullStates, fps, opts = {}) {
  const { tailGuardSec = 2 } = opts;
  const S = fullStates;
  const N = S.length;
  if (N === 0) return null;
  const tailGuardFrames = Math.round(tailGuardSec * fps);

  // Dernier instant où l'ÉTAT complet change (les frames d'après ne font que
  // ré-écrire les mêmes valeurs -> même id -> pas de changement).
  let lastChange = 0;
  for (let f = 1; f < N; f++) if (S[f] !== S[f - 1]) lastChange = f;

  // Queue constante trop courte : la piste change encore en fin de fenêtre
  // (boucle/continue) -> pas de fin franche détectable.
  if (lastChange >= N - tailGuardFrames) return null;

  // Frames de contenu = 0..lastChange inclus (la frame lastChange porte l'écriture
  // qui fige le silence) -> (lastChange + 1) frames.
  return +(((lastChange + 1) / fps).toFixed(4));
}

/**
 * Détection de boucle TOLÉRANTE pour les drivers à MODULATION CONTINUE (GBS).
 *
 * Pourquoi : analyzeStates exige une répétition BIT-EXACTE et CONTIGUË du log
 * (`tailrun(p) >= p`). Cette parité stricte tient pour le NES et pour les drivers
 * GBS qui rebouclent à l'identique, mais ÉCHOUE quand le driver applique un vibrato
 * (pitch), une enveloppe ou un panning dont la PHASE de LFO N'EST PAS réinitialisée
 * au point de boucle : le SQUELETTE musical (déclenchements, durées, duty, on/off,
 * wave RAM, bruit) se répète bit-pour-bit à période ENTIÈRE exacte, mais les
 * registres de fréquence/enveloppe/panning portent une phase libre — une SEULE frame
 * modulée différente casse le run contigu -> aucune période -> repli 120 s (« 2:00 »).
 * Mesuré sur Gargoyle's Quest (Capcom) : en masquant fréquence+enveloppe+panning,
 * l'égalité d'état remonte à EXACTEMENT 100 % à la période vraie (cf. analyse gdm).
 *
 * Principe : autocorrélation FRACTIONNAIRE sur l'ÉTAT COMPLET des 48 registres (le
 * `full` de gdm-loop), pas sur le delta. Pour chaque période p, on mesure la FRACTION
 * de frames de la queue où full[i] == full[i+p] ; on retient le PLUS PETIT pic dont la
 * fraction dépasse `matchThreshold`. La mélodie (registres de fréquence) reste NON
 * masquée : c'est elle qui fait chuter la fraction d'une SOUS-PÉRIODE (demi-boucle :
 * notes différentes), si bien que le fondamental n'est jamais confondu avec sa moitié.
 *
 * ⚠ À n'employer qu'en DERNIER RECOURS (après analyzeStates EXACT et après
 * analyzeFiniteEnd) : une piste FINIE se fige en SILENCE constant, lequel coïncide
 * avec lui-même à TOUTE période (fausse micro-boucle à 100 %). La garde anti-silence
 * ci-dessous (queue appariée >= minDistinctFrames états distincts) est une défense en
 * profondeur, mais l'ORDRE du pipeline (fini AVANT tolérant) reste la garde primaire.
 *
 * loopStart : laissé à 0 (la période EST la durée). Détecter une vraie intro sous
 * modulation est non fiable ; pour une piste sans intro (cas dominant) c'est exact, et
 * la DURÉE de boucle — l'enjeu du « 2:00 » — est juste dans tous les cas.
 *
 * @param {Int32Array|number[]} fullStates  un id d'ÉTAT complet des registres par frame
 * @param {number} fps                      frame-rate autoritaire (Hz)
 * @param {object} [opts]                   sampleRate/pminSec/pmaxSec/tailGuardSec/matchWinSec/matchThreshold/minDistinctFrames
 * @returns {{ startSeconds, lengthSeconds, startSamples, lengthSamples, sampleRate, frameRate } | null}
 */
export function analyzeStatesTolerant(fullStates, fps, opts = {}) {
  const {
    sampleRate = 44100,
    pminSec = 1,
    pmaxSec = 100,
    tailGuardSec = 2,
    matchWinSec = 60, // fenêtre de queue sur laquelle on mesure la fraction de match
    matchThreshold = 0.6, // seuil validé : vraies boucles >= 65 %, sous-périodes <= 52 %
    minDistinctFrames = 8,
  } = opts;

  const H = fullStates;
  const N = H.length;
  const pmin = Math.round(pminSec * fps);
  const tailGuardFrames = Math.round(tailGuardSec * fps);
  const pmax = Math.min(N - tailGuardFrames, Math.round(pmaxSec * fps));
  if (N < pmin + tailGuardFrames || pmax <= pmin) return null;

  // matchFrac(p) : fraction des dernières matchWinSec où full[i] == full[i+p].
  const winFrames = Math.round(matchWinSec * fps);
  const fracs = new Float64Array(pmax);
  let bestFrac = -1;
  for (let p = pmin; p < pmax; p++) {
    const W = Math.min(N - p, winFrames);
    const start = N - p - 1;
    let matches = 0;
    for (let k = 0; k < W; k++) if (H[start - k] === H[start - k + p]) matches++;
    const f = matches / W;
    fracs[p] = f;
    if (f > bestFrac) bestFrac = f;
  }
  if (bestFrac < matchThreshold) return null; // pas de période franche -> repli paramétrique

  // Pics = maxima locaux >= seuil (séparés de > 0.5 s, pour ne pas éclater un pic en
  // plusieurs candidats voisins) ; le FONDAMENTAL est le pic de plus PETITE période.
  const minSep = Math.round(0.5 * fps);
  const peaks = [];
  for (let p = pmin; p < pmax; p++) {
    if (fracs[p] < matchThreshold) continue;
    let isMax = true;
    for (let q = Math.max(pmin, p - minSep); q < Math.min(pmax, p + minSep + 1); q++) {
      if (fracs[q] > fracs[p]) { isMax = false; break; }
    }
    if (isMax) peaks.push(p);
  }
  if (peaks.length === 0) return null;
  peaks.sort((a, b) => a - b);
  let pStar = peaks[0];
  for (let q = Math.max(pmin, pStar - minSep); q < Math.min(pmax, pStar + minSep + 1); q++) {
    if (fracs[q] > fracs[pStar]) pStar = q; // affine sur l'argmax exact du cluster
  }

  // Garde anti-silence : la QUEUE APPARIÉE [N-pStar, N) doit porter >= minDistinctFrames
  // états distincts (sinon = silence figé d'une piste finie -> rejet).
  const seen = new Set();
  for (let j = N - pStar; j < N; j++) {
    seen.add(H[j]);
    if (seen.size >= minDistinctFrames) break;
  }
  if (seen.size < minDistinctFrames) return null;

  const loopStartFrames = 0; // pas de détection d'intro sous modulation : période = durée
  return {
    startSeconds: +(loopStartFrames / fps).toFixed(4),
    lengthSeconds: +(pStar / fps).toFixed(4),
    startSamples: Math.round((loopStartFrames * sampleRate) / fps),
    lengthSamples: Math.round((pStar * sampleRate) / fps),
    sampleRate,
    frameRate: +fps.toFixed(4),
  };
}

/**
 * Détecte la boucle à partir du TEXTE d'un log de registres NES déjà rendu.
 * Exporté pour test/CLI hors nsftool. Wrapper mince autour d'analyzeStates au fps
 * NTSC NES (défauts d'opts = constantes historiques) -> comportement bit pour bit
 * identique à la version pré-refactor.
 *
 * @returns {{ startSeconds, lengthSeconds, startSamples, lengthSamples, sampleRate } | null}
 */
export function detectLoopFromLog(text) {
  const { H } = parseLog(text);
  return analyzeStates(H, FPS);
}

/**
 * Détecte la boucle d'une sous-piste NES : rend un log de registres via nsftool
 * (rapide, r=8000, rate-indépendant) puis l'autocorrèle. Renvoie les repères de
 * boucle (secondes canoniques + échantillons natifs) ou null si non bouclée /
 * non convergente / nsftool indisponible.
 *
 * @param {object} o
 * @param {string} o.sourcePath        chemin de la source NSF/NSFe
 * @param {number} o.trackIndex        index de sous-piste 0-based
 * @param {string} [o.nsftool]         binaire nsftool (défaut 'nsftool')
 * @param {string} [o.mediaDir]        (réservé ; le log temporaire vit dans os.tmpdir())
 * @param {number} [o.defaultSeconds]  (réservé ; le log couvre toujours LOG_LEN_MS)
 */
export async function detectLoop({ sourcePath, trackIndex, nsftool = 'nsftool' }) {
  const logfile = join(tmpdir(), `vdm-loop-${trackIndex}-${process.pid}-${Date.now()}.log`);
  try {
    const r = await run(
      nsftool,
      ['-t', String(trackIndex + 1), '-l', String(LOG_LEN_MS), '-r', String(LOG_RATE),
        '-c', '1', '--log', '1', '--logfile', logfile, sourcePath],
      SPAWN_TIMEOUT_MS
    );
    if (r.code !== 0) return null; // nsftool indispo / échec / timeout -> repli

    let text;
    try {
      text = readFileSync(logfile, 'utf8');
    } catch {
      return null; // log absent
    }
    return detectLoopFromLog(text);
  } finally {
    await rm(logfile, { force: true }).catch(() => {});
  }
}

// ---- CLI de test ----------------------------------------------------------
const isEntry = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isEntry) {
  const [, , source, trackIndex, defaultSeconds] = process.argv;
  if (!source || trackIndex == null) {
    console.error('Usage: node tools/nsf-loop.mjs <source> <trackIndex> [defaultSeconds]');
    process.exit(1);
  }
  detectLoop({
    sourcePath: source,
    trackIndex: Number(trackIndex),
    nsftool: process.env.VDM_NSFPLAY ?? 'nsftool',
    defaultSeconds: Number(defaultSeconds) || 120,
  })
    .then((r) => console.log(JSON.stringify(r, null, 2)))
    .catch((err) => { console.error('échec :', err.message); process.exit(1); });
}
