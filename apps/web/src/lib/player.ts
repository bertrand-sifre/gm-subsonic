/**
 * Store central de l'application : orchestre le `LoopPlayer` (Web Audio) et tout
 * l'état UI (file de lecture, navigation, favoris/historique, état des canaux).
 *
 * Un seul `LoopPlayer` vit ici ; les composants lisent des stores Svelte et
 * appellent des actions. Une UNIQUE boucle d'animation (rAF) met à jour la
 * progression et un compteur `frame` (déclencheur de redraw des oscilloscopes).
 */

import { derived, get, writable } from 'svelte/store';
import type { Library, PlaybackMode, PlaybackOptions, Track } from '@vdm/shared';
import { fetchLibrary } from './api';
import { LoopPlayer, type Progress } from './LoopPlayer';

export type Status = 'stopped' | 'loading' | 'playing' | 'paused';
export type RepeatMode = 'off' | 'all' | 'one';
export type ViewName = 'home' | 'library' | 'composers' | 'favorites' | 'history';

/** État de mixage d'un canal (stem). */
export interface ChannelState {
  /** Volume de mixage (0..1). */
  volume: number;
  muted: boolean;
  solo: boolean;
}

// --- Stores : bibliothèque & navigation -------------------------------------

export const library = writable<Library | null>(null);
export const loadError = writable<string>('');
export const view = writable<ViewName>('library');
export const selectedGame = writable<string | null>(null);
/** Console (plateforme) sélectionnée dans la vue Bibliothèque (console → jeux → détail). */
export const selectedConsole = writable<string | null>(null);
export const search = writable<string>('');

// --- Stores : lecture --------------------------------------------------------

export const current = writable<Track | null>(null);
export const status = writable<Status>('stopped');
export const progress = writable<Progress | null>(null);
/** Incrémenté à chaque frame d'animation : déclencheur réactif des canvas. */
export const frame = writable<number>(0);

// Défaut : 2 boucles max puis fin → la lecture est FINIE, donc `onEnded` se
// déclenche et la file (« Tout lire », suivant auto, répétition) s'enchaîne.
// « Boucle infinie » reste disponible en un clic pour épingler une piste.
export const mode = writable<PlaybackMode>('loopCount');
export const loopCount = writable<number>(2);
export const fadeSeconds = writable<number>(4);

export const masterVolume = writable<number>(0.9);
export const masterMuted = writable<boolean>(false);

/** id de voix -> état de mixage de la piste courante. */
export const channelStates = writable<Record<string, ChannelState>>({});
/** Au moins une voix est en solo ? (les autres sont alors coupées) */
export const soloActive = derived(channelStates, ($c) => Object.values($c).some((s) => s.solo));

// --- Stores : file de lecture -----------------------------------------------

export const queue = writable<Track[]>([]);
export const queueIndex = writable<number>(0);
export const shuffle = writable<boolean>(false);
export const repeat = writable<RepeatMode>('off');

// --- Stores : favoris & historique (persistés en localStorage) --------------

const FAV_KEY = 'vdm.favorites';
const HIST_KEY = 'vdm.history';

function loadSet(key: string): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(key) || '[]') as string[]);
  } catch {
    return new Set();
  }
}
function loadHistory(): string[] {
  try {
    return JSON.parse(localStorage.getItem(HIST_KEY) || '[]') as string[];
  } catch {
    return [];
  }
}

export const favorites = writable<Set<string>>(loadSet(FAV_KEY));
/** Historique : ids des dernières pistes jouées (plus récent en tête). */
export const historyIds = writable<string[]>(loadHistory());

favorites.subscribe((s) => {
  try {
    localStorage.setItem(FAV_KEY, JSON.stringify([...s]));
  } catch { /* quota / mode privé */ }
});
historyIds.subscribe((ids) => {
  try {
    localStorage.setItem(HIST_KEY, JSON.stringify(ids.slice(0, 100)));
  } catch { /* idem */ }
});

// --- Lecteur & boucle d'animation -------------------------------------------

export const player = new LoopPlayer();

let raf = 0;
function startRaf(): void {
  if (raf) return;
  const tick = () => {
    const p = player.getProgress();
    if (p) progress.set(p);
    frame.update((n) => n + 1);
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
}
function stopRaf(): void {
  if (raf) cancelAnimationFrame(raf);
  raf = 0;
}

player.onEnded = () => {
  // Fin naturelle d'un arrangement fini -> avance dans la file selon repeat/shuffle.
  advanceAuto();
};

// --- Sélecteurs utilitaires --------------------------------------------------

/** Tous les morceaux, à plat (ordre de la bibliothèque). */
export function allTracks(): Track[] {
  const lib = get(library);
  return lib ? lib.games.flatMap((g) => g.tracks) : [];
}

/** Morceaux d'un jeu donné. */
export function tracksOfGame(game: string): Track[] {
  const lib = get(library);
  return lib?.games.find((g) => g.game === game)?.tracks ?? [];
}

export function trackById(id: string): Track | undefined {
  return allTracks().find((t) => t.id === id);
}

// --- Actions : initialisation & navigation ----------------------------------

export async function initLibrary(): Promise<void> {
  try {
    const lib = await fetchLibrary();
    library.set(lib);
    // Sélection initiale : premier jeu.
    // Vue Bibliothèque par défaut = liste des consoles (pas de jeu présélectionné).
  } catch (e) {
    loadError.set(String(e));
  }
}

export function navigate(v: ViewName): void {
  // Aller à la Bibliothèque = revenir à la racine (liste des consoles) : on
  // réinitialise la sélection console/jeu (sinon on resterait sur le détail).
  if (v === 'library') {
    selectedGame.set(null);
    selectedConsole.set(null);
  }
  view.set(v);
}

/** Ouvre une console (plateforme) → liste de ses jeux. */
export function openConsole(platform: string): void {
  selectedConsole.set(platform);
  selectedGame.set(null);
  view.set('library');
}

export function openGame(game: string): void {
  selectedGame.set(game);
  view.set('library');
}

/** Liste des consoles (plateformes) avec nb de jeux + nb de pistes. */
export function platformList(): { platform: string; games: number; tracks: number }[] {
  const lib = get(library);
  if (!lib) return [];
  const by = new Map<string, { games: number; tracks: number }>();
  for (const g of lib.games) {
    const p = g.tracks[0]?.platform ?? 'Autre';
    const e = by.get(p) ?? { games: 0, tracks: 0 };
    e.games += 1;
    e.tracks += g.tracks.length;
    by.set(p, e);
  }
  return [...by.entries()]
    .map(([platform, v]) => ({ platform, ...v }))
    .sort((a, b) => b.tracks - a.tracks);
}

/** Jeux d'une plateforme donnée. */
export function gamesOfPlatform(platform: string): { game: string; tracks: Track[] }[] {
  const lib = get(library);
  if (!lib) return [];
  return lib.games.filter((g) => (g.tracks[0]?.platform ?? 'Autre') === platform);
}

/** Compositeurs distincts avec leur nombre de pistes. */
export function composerCounts(): { composer: string; count: number }[] {
  const by = new Map<string, number>();
  for (const t of allTracks()) {
    if (!t.composer) continue;
    by.set(t.composer, (by.get(t.composer) ?? 0) + 1);
  }
  return [...by.entries()].map(([composer, count]) => ({ composer, count })).sort((a, b) => b.count - a.count);
}

/** Recherche simple sur titre / jeu / compositeur. */
export function searchTracks(q: string): Track[] {
  const needle = q.trim().toLowerCase();
  if (!needle) return [];
  return allTracks().filter(
    (t) =>
      t.title.toLowerCase().includes(needle) ||
      t.game.toLowerCase().includes(needle) ||
      (t.composer?.toLowerCase().includes(needle) ?? false)
  );
}

// --- Actions : lecture -------------------------------------------------------

/** Options de lecture courantes (figées depuis les stores). */
function currentOptions(): PlaybackOptions {
  return { mode: get(mode), loopCount: get(loopCount), fadeSeconds: get(fadeSeconds) };
}

/** Gain effectif d'une voix (mute/solo/volume + mute master). */
function effectiveGain(id: string, states: Record<string, ChannelState>, solo: boolean): number {
  const s = states[id];
  if (!s) return 1;
  if (s.muted) return 0;
  if (solo && !s.solo) return 0;
  return s.volume;
}

/**
 * Ordre original (non mélangé) de la file courante — snapshot conservé pour
 * pouvoir rétablir l'ordre exact quand on désactive le shuffle (la file peut
 * être multi-jeux : favoris, historique, recherche).
 */
let originalQueue: Track[] = [];

/** Lance une piste, en définissant la file de lecture (contexte = jeu par défaut). */
export async function playTrack(track: Track, context?: Track[]): Promise<void> {
  const ctx = context && context.length ? context : tracksOfGame(track.game);
  const list = ctx.length ? ctx : [track];
  originalQueue = list.slice();
  queue.set(list);
  queueIndex.set(Math.max(0, list.findIndex((t) => t.id === track.id)));
  await loadAndPlay(track);
}

/** Lance tous les morceaux d'un jeu (« Tout lire »). */
export async function playGame(game: string): Promise<void> {
  const list = tracksOfGame(game);
  if (!list.length) return;
  originalQueue = list.slice();
  const order = get(shuffle) ? shuffled(list) : list;
  queue.set(order);
  queueIndex.set(0);
  await loadAndPlay(order[0]);
}

async function loadAndPlay(track: Track): Promise<void> {
  current.set(track);
  selectedGame.set(track.game);
  status.set('loading');
  pushHistory(track.id);

  // Réinitialise l'état des canaux pour la piste courante.
  const states: Record<string, ChannelState> = {};
  if (track.channels) {
    for (const v of track.channels.voices) {
      states[v.id] = { volume: 1, muted: v.enabledByDefault === false, solo: false };
    }
  }
  channelStates.set(states);
  const solo = Object.values(states).some((s) => s.solo);

  try {
    if (track.channels) {
      await player.loadChannels(
        track,
        track.channels.voices.map((v) => ({
          id: v.id,
          url: v.streamUrl,
          gain: effectiveGain(v.id, states, solo),
        }))
      );
      await player.play(currentOptions());
    } else if (track.loop) {
      await player.load(track);
      await player.play(currentOptions());
    } else if (track.render) {
      const url = `${track.streamUrl}?seconds=${Math.round(track.render.defaultSeconds)}&fade=${track.render.defaultFade}`;
      await player.load(track, url);
      await player.play({ mode: 'once', loopCount: 1, fadeSeconds: 0 });
    } else {
      await player.load(track);
      await player.play({ mode: 'once', loopCount: 1, fadeSeconds: 0 });
    }
    player.setMasterVolume(get(masterMuted) ? 0 : get(masterVolume));
    status.set('playing');
    startRaf();
  } catch (e) {
    loadError.set(String(e));
    status.set('stopped');
    stopRaf();
  }
}

/** Pause / reprise (suspend le contexte audio). */
export async function togglePlay(): Promise<void> {
  const st = get(status);
  if (st === 'playing') {
    await player.suspend();
    status.set('paused');
    stopRaf();
  } else if (st === 'paused') {
    await player.resume();
    status.set('playing');
    startRaf();
  } else if (get(current)) {
    // Arrêté mais une piste est sélectionnée -> relance.
    await loadAndPlay(get(current)!);
  }
}

export function stop(): void {
  player.stop();
  status.set('stopped');
  stopRaf();
  progress.set(player.getProgress());
}

/** Saute à une position (secondes d'arrangement). */
export async function seek(elapsed: number): Promise<void> {
  if (get(status) === 'stopped' || !player.loaded) return;
  await player.seek(elapsed);
  status.set('playing');
  startRaf();
}

/** Saute à une fraction (0..1) de l'arrangement (pour les barres cliquables). */
export async function seekFraction(frac: number): Promise<void> {
  const p = get(progress);
  const dur = p?.arrangementDur;
  if (dur == null) return; // boucle infinie : pas de position absolue
  await seek(Math.max(0, Math.min(1, frac)) * dur);
}

// --- Actions : file (next/prev/shuffle/repeat) ------------------------------

function shuffled<T>(arr: T[]): T[] {
  // Mélange Fisher-Yates sans Math.random interdit ? Math.random est OK côté navigateur.
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export async function next(auto = false): Promise<void> {
  const q = get(queue);
  if (!q.length) return;
  let i = get(queueIndex);
  if (get(repeat) === 'one' && auto) {
    await loadAndPlay(q[i]);
    return;
  }
  i += 1;
  if (i >= q.length) {
    if (get(repeat) === 'all' || !auto) i = 0;
    else {
      // Fin de file sans répétition.
      stop();
      return;
    }
  }
  queueIndex.set(i);
  await loadAndPlay(q[i]);
}

export async function prev(): Promise<void> {
  const q = get(queue);
  if (!q.length) return;
  // Si on a dépassé ~3 s, « précédent » redémarre la piste (comportement Spotify).
  const p = get(progress);
  if (p && p.elapsed > 3) {
    await loadAndPlay(q[get(queueIndex)]);
    return;
  }
  let i = get(queueIndex) - 1;
  if (i < 0) i = get(repeat) === 'all' ? q.length - 1 : 0;
  queueIndex.set(i);
  await loadAndPlay(q[i]);
}

function advanceAuto(): void {
  void next(true);
}

export function toggleShuffle(): void {
  shuffle.update((s) => !s);
  const q = get(queue);
  const cur = get(current);
  if (!q.length || !cur) return;
  if (get(shuffle)) {
    // Mélange la file restante en gardant la piste courante en tête.
    const rest = shuffled(q.filter((t) => t.id !== cur.id));
    queue.set([cur, ...rest]);
    queueIndex.set(0);
  } else {
    // Rétablit l'ORDRE ORIGINAL exact de la file (snapshot), pas seulement le jeu
    // courant — préserve les files multi-jeux (favoris/historique/recherche).
    const restored = originalQueue.length ? originalQueue : q;
    queue.set(restored);
    queueIndex.set(Math.max(0, restored.findIndex((t) => t.id === cur.id)));
  }
}

export function cycleRepeat(): void {
  repeat.update((r) => (r === 'off' ? 'all' : r === 'all' ? 'one' : 'off'));
}

// --- Actions : comportement de lecture (mode / boucles / fondu) -------------

export async function setMode(m: PlaybackMode): Promise<void> {
  mode.set(m);
  if (get(status) === 'playing' || get(status) === 'paused') {
    await player.setMode(currentOptions());
    resyncAfterReplan();
  }
}

export async function setLoopCount(n: number): Promise<void> {
  loopCount.set(Math.max(1, Math.min(20, Math.round(n))));
  if ((get(mode) === 'loopCount' || get(mode) === 'loopCountFade') && get(status) !== 'stopped') {
    await player.setMode(currentOptions());
    resyncAfterReplan();
  }
}

export async function setFade(s: number): Promise<void> {
  fadeSeconds.set(Math.max(0.5, Math.min(30, s)));
  if (get(mode) === 'loopCountFade' && get(status) !== 'stopped') {
    await player.setMode(currentOptions());
    resyncAfterReplan();
  }
}

/**
 * `player.setMode()` réveille le contexte audio (resume) : après une re-planif
 * sur une piste en PAUSE, l'audio rejoue → on resynchronise le statut + la rAF
 * (sinon UI figée en « pause » alors que le son tourne).
 */
function resyncAfterReplan(): void {
  if (get(status) === 'paused') status.set('playing');
  startRaf();
}

// --- Actions : canaux (volume / mute / solo) --------------------------------

function applyChannelGains(): void {
  const states = get(channelStates);
  const solo = Object.values(states).some((s) => s.solo);
  for (const id of Object.keys(states)) {
    player.setChannelGain(id, effectiveGain(id, states, solo));
  }
}

export function setChannelVolume(id: string, volume: number): void {
  channelStates.update((c) => ({ ...c, [id]: { ...c[id], volume: Math.max(0, Math.min(1, volume)) } }));
  applyChannelGains();
}

export function toggleMute(id: string): void {
  channelStates.update((c) => ({ ...c, [id]: { ...c[id], muted: !c[id]?.muted } }));
  applyChannelGains();
}

export function toggleSolo(id: string): void {
  channelStates.update((c) => ({ ...c, [id]: { ...c[id], solo: !c[id]?.solo } }));
  applyChannelGains();
}

// --- Actions : volume master -------------------------------------------------

export function setMasterVolume(v: number): void {
  const vol = Math.max(0, Math.min(1, v));
  masterVolume.set(vol);
  if (vol > 0) masterMuted.set(false);
  player.setMasterVolume(get(masterMuted) ? 0 : vol);
}

export function toggleMasterMute(): void {
  masterMuted.update((m) => !m);
  player.setMasterVolume(get(masterMuted) ? 0 : get(masterVolume));
}

// --- Actions : favoris & historique -----------------------------------------

export function toggleFavorite(id: string): void {
  favorites.update((s) => {
    const next = new Set(s);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });
}

function pushHistory(id: string): void {
  historyIds.update((ids) => [id, ...ids.filter((x) => x !== id)].slice(0, 100));
}
