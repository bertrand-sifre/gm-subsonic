<script lang="ts">
  import { onMount } from 'svelte';
  import type { Library, PlaybackMode, Track } from '@vdm/shared';
  import { fetchLibrary } from './lib/api';
  import { LoopPlayer, type Progress } from './lib/LoopPlayer';

  let library: Library | null = null;
  let error = '';
  let current: Track | null = null;
  let status: 'stopped' | 'loading' | 'playing' = 'stopped';

  // Pistes à vrais points de boucle (lecture interactive Web Audio).
  let mode: PlaybackMode = 'loopCount';
  let loopCount = 3;
  let fadeSeconds = 4;

  // Pistes émulées (rendu serveur paramétrable).
  let renderSeconds = 120;
  let renderFade = 4;

  // Activation des voix (stems) de la piste courante : id de canal -> booléen.
  let channelOn: Record<string, boolean> = {};

  // Visualisation live (pilotée par l'horloge audio) : progression + scopes.
  let progress: Progress | null = null;
  let scopeCanvases: Record<string, HTMLCanvasElement> = {};
  let raf = 0;
  const scopeBuf = new Uint8Array(1024);

  // Durée par défaut de la piste émulée courante (0 si non émulée).
  $: defSeconds = current?.render?.defaultSeconds ?? 0;

  // Structure de lecture affichée quand on choisit une piste.
  $: segments = current ? structure(current) : [];

  function structure(t: Track): { label: string; value: string }[] {
    if (t.loop) {
      // Vrais points de boucle : intro / boucle / queue.
      const tail = t.duration - t.loop.loopEnd;
      const segs = [
        { label: 'Intro', value: fmt(t.loop.loopStart) },
        { label: 'Boucle', value: fmt(t.loop.loopEnd - t.loop.loopStart) },
      ];
      if (tail > 0.05) segs.push({ label: 'Queue', value: fmt(tail) });
      return segs;
    }
    if (t.render) {
      // Format émulé : durée voulue + fondu (pas de découpe intro/boucle).
      return [
        { label: 'Durée (jeu)', value: fmt(t.render.defaultSeconds) },
        { label: 'Fondu', value: `${t.render.defaultFade} s` },
      ];
    }
    return [{ label: 'Durée', value: fmt(t.duration) }];
  }

  const player = new LoopPlayer();
  player.onEnded = () => {
    status = 'stopped';
  };

  onMount(async () => {
    try {
      library = await fetchLibrary();
    } catch (e) {
      error = String(e);
    }
  });

  const MODES: { value: PlaybackMode; label: string }[] = [
    { value: 'once', label: 'Lecture normale' },
    { value: 'loopInfinite', label: 'Boucle infinie' },
    { value: 'loopCount', label: 'N boucles puis fin' },
    { value: 'loopCountFade', label: 'N boucles puis fondu' },
  ];

  async function selectAndPlay(track: Track) {
    current = track;
    if (track.render) {
      renderSeconds = track.render.defaultSeconds;
      renderFade = track.render.defaultFade;
    }
    if (track.channels) {
      channelOn = {};
      for (const v of track.channels.voices) channelOn[v.id] = v.enabledByDefault !== false;
    }
    await playCurrent();
  }

  async function playCurrent() {
    if (!current) return;
    try {
      status = 'loading';
      if (current.channels) {
        // Stems : une voix par canal, jouées en synchro + toggle en direct.
        await player.loadChannels(
          current,
          current.channels.voices.map((v) => ({ id: v.id, url: v.streamUrl, enabledByDefault: channelOn[v.id] }))
        );
        await player.play({ mode, loopCount, fadeSeconds });
      } else if (current.loop) {
        // Boucle détectée : artefact de boucle (sans param) + lecture interactive.
        await player.load(current);
        await player.play({ mode, loopCount, fadeSeconds });
      } else if (current.render) {
        // Rendu serveur : la durée + le fondu choisis sont passés en query.
        const url = `${current.streamUrl}?seconds=${Math.round(renderSeconds)}&fade=${renderFade}`;
        await player.load(current, url);
        await player.play({ mode: 'once', loopCount, fadeSeconds });
      } else {
        await player.load(current);
        await player.play({ mode, loopCount, fadeSeconds });
      }
      status = 'playing';
    } catch (e) {
      error = String(e);
      status = 'stopped';
    }
  }

  function preset(seconds: number) {
    renderSeconds = seconds;
    void playCurrent();
  }

  function toggleChannel(id: string) {
    channelOn = { ...channelOn, [id]: !channelOn[id] };
    player.setChannelEnabled(id, channelOn[id]); // en direct, sans relancer
  }

  function stop() {
    player.stop();
    status = 'stopped';
  }

  function fmt(seconds: number): string {
    const m = Math.floor(seconds / 60);
    const s = Math.round(seconds % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  // Temps précis (m:ss.mmm) pour le timer de diagnostic.
  function fmtMs(seconds: number): string {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 1000);
    return `${m}:${String(s).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
  }

  // --- Visualisation live -----------------------------------------------------

  // Couleur d'une voix d'après son type de canal APU (repère visuel).
  const KIND_COLOR: Record<string, string> = {
    pulse: '#6c5ce7',
    triangle: '#2ec5a0',
    noise: '#c77dff',
    dmc: '#ff9f43',
    pcm: '#ff9f43',
    saw: '#ff6b9d',
    wave: '#4dd0e1',
    fm: '#ffd166',
  };
  function voiceColor(id: string): string {
    if (id === '__main__') return '#8b7cf0';
    const v = current?.channels?.voices.find((x) => x.id === id);
    return (v?.kind && KIND_COLOR[v.kind]) || '#8b7cf0';
  }

  // Boucle d'animation : lue à chaque frame tant que ça joue.
  function startLoop() {
    if (raf) return;
    const frame = () => {
      const p = player.getProgress();
      if (p) progress = p; // fige le dernier état si la lecture s'arrête (getProgress -> null)
      const analysers = player.getAnalysers();
      for (const [id, an] of analysers) {
        const c = scopeCanvases[id];
        if (c) drawScope(c, an, id);
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
  }
  function stopLoop() {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    // On NE remet PAS `progress` à null : on fige le dernier état (temps/frame/boucle)
    // pour que le timer reste lisible après un stop / une fin de lecture.
  }
  $: if (status === 'playing') startLoop();
  else stopLoop();

  // Trace l'oscilloscope d'une voix (onde temporelle de son AnalyserNode).
  function drawScope(canvas: HTMLCanvasElement, analyser: AnalyserNode, id: string): void {
    const g = canvas.getContext('2d');
    if (!g) return;
    const dpr = window.devicePixelRatio || 1;
    const cssW = canvas.clientWidth || 1;
    const cssH = canvas.clientHeight || 1;
    if (canvas.width !== Math.round(cssW * dpr)) {
      canvas.width = Math.round(cssW * dpr);
      canvas.height = Math.round(cssH * dpr);
    }
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, cssW, cssH);

    analyser.getByteTimeDomainData(scopeBuf);
    const on = id === '__main__' ? true : channelOn[id] !== false;

    // Ligne médiane (zéro).
    g.strokeStyle = 'rgba(255,255,255,0.06)';
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(0, cssH / 2);
    g.lineTo(cssW, cssH / 2);
    g.stroke();

    // Onde.
    g.strokeStyle = on ? voiceColor(id) : 'rgba(155,150,184,0.4)';
    g.lineWidth = 1.5;
    g.globalAlpha = on ? 1 : 0.5;
    g.beginPath();
    const n = scopeBuf.length;
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * cssW;
      const y = (scopeBuf[i] / 255) * cssH;
      if (i === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.stroke();
    g.globalAlpha = 1;
  }

  // Position de la tête de lecture (% de la barre intro+boucle).
  function computePlayPct(p: Progress | null): number {
    if (!p) return 0;
    if (p.phase === 'linear') return p.frac * 100;
    const total = p.introDur + p.loopDur;
    if (total <= 0) return 0;
    const introW = (p.introDur / total) * 100;
    if (p.phase === 'intro') return introW * p.frac;
    if (p.phase === 'loop') return introW + (100 - introW) * p.frac;
    return 100; // queue : fin de la zone de boucle
  }

  // Libellé du compteur : « Intro », « Boucle 2/3 », « Boucle 4 » (infini), « Queue ».
  function progressLabel(p: Progress | null): string {
    if (!p || p.phase === 'linear') return '';
    if (p.phase === 'intro') return 'Intro';
    if (p.phase === 'tail') return 'Queue';
    return p.totalLoops != null ? `Boucle ${p.iteration}/${p.totalLoops}` : `Boucle ${p.iteration}`;
  }

  $: introPct =
    progress && progress.phase !== 'linear' && progress.introDur + progress.loopDur > 0
      ? (progress.introDur / (progress.introDur + progress.loopDur)) * 100
      : 0;
  $: playPct = computePlayPct(progress);
  $: counterLabel = progressLabel(progress);

  // Timer de diagnostic : frame-rate du moteur (si dispo) + bornes de boucle en frames.
  $: frameRate = current?.loop?.frameRate ?? 0;
  $: loopFrames =
    current?.loop && frameRate
      ? {
          start: Math.round(current.loop.loopStart * frameRate),
          end: Math.round(current.loop.loopEnd * frameRate),
          len: Math.round((current.loop.loopEnd - current.loop.loopStart) * frameRate),
        }
      : null;
</script>

<main>
  <header>
    <h1>🎮 VDM</h1>
    <p>Serveur musical pour bandes-son de jeux vidéo</p>
  </header>

  {#if error}
    <p class="error">{error}</p>
  {/if}

  <section class="controls">
    <div class="now">
      <div class="now-title">{current ? current.title : 'Aucun morceau sélectionné'}</div>
      {#if current}
        <div class="now-sub">
          {current.game}{#if current.composer} · {current.composer}{/if}{#if current.platform} · {current.platform}{/if}
        </div>
        <div class="chips">
          {#each segments as s}
            <span class="chip"><b>{s.label}</b> {s.value}</span>
          {/each}
          {#if current.channels}
            <span class="chip">🎚 {current.channels.voices.length} voix (stems)</span>
          {/if}
          {#if current.loop}
            <span class="chip">🔁 boucle détectée</span>
          {:else if current.render}
            <span class="chip muted">lecture paramétrable (pas de boucle)</span>
          {/if}
        </div>
      {/if}
    </div>

    {#if progress}
      <div class="progress" class:frozen={status !== 'playing'}>
        <div class="timer">
          <span class="t-elapsed">{status === 'playing' ? '⏱' : '⏸'} {fmtMs(progress.elapsed)}</span>
          <span class="t-sep">·</span>
          <span class="t-pos">pos {fmtMs(progress.sourceTime)}</span>
          {#if frameRate}
            <span class="t-frame">frame {Math.round(progress.sourceTime * frameRate)}</span>
          {/if}
          {#if loopFrames}
            <span class="t-loop">boucle [{loopFrames.start}–{loopFrames.end}] · {loopFrames.len} f @ {frameRate} Hz</span>
          {/if}
        </div>
        {#if status === 'playing' && !current?.channels}
          <!-- Pas de stems : oscilloscope du mix (live uniquement). -->
          <canvas class="scope mix" bind:this={scopeCanvases['__main__']}></canvas>
        {/if}
        <div class="bar-row">
          <div class="bar" class:linear={progress.phase === 'linear'}>
            {#if progress.phase !== 'linear'}
              <div class="seg intro" style="width:{introPct}%"><span>intro</span></div>
              <div class="seg loop" style="width:{100 - introPct}%"><span>boucle</span></div>
            {:else}
              <div class="seg loop" style="width:100%"></div>
            {/if}
            <div class="playhead" style="left:{playPct}%"></div>
          </div>
          {#if counterLabel}
            <div class="counter" class:active={progress.phase === 'loop'}>{counterLabel}</div>
          {/if}
        </div>
      </div>
    {/if}

    {#if current?.channels}
      <div class="channels">
        <span class="chan-label">Voix</span>
        {#each current.channels.voices as v}
          <div class="chan" class:off={!channelOn[v.id]}>
            <label class="chan-toggle">
              <input type="checkbox" checked={channelOn[v.id]} on:change={() => toggleChannel(v.id)} />
              <span>{v.label}</span>
            </label>
            <canvas class="scope" bind:this={scopeCanvases[v.id]}></canvas>
          </div>
        {/each}
      </div>
    {/if}

    {#if current?.loop}
      <!-- Piste à points de boucle (détectée) : modes de lecture interactifs. -->
      <label>
        Comportement
        <select bind:value={mode}>
          {#each MODES as m}
            <option value={m.value}>{m.label}</option>
          {/each}
        </select>
      </label>
      {#if mode === 'loopCount' || mode === 'loopCountFade'}
        <label>
          Boucles
          <input type="number" min="1" max="20" bind:value={loopCount} />
        </label>
      {/if}
      {#if mode === 'loopCountFade'}
        <label>
          Fondu (s)
          <input type="number" min="0.5" max="20" step="0.5" bind:value={fadeSeconds} />
        </label>
      {/if}
    {:else if current?.render}
      <!-- Format émulé sans boucle : durée + fondu (rendu serveur). -->
      <label>
        Durée (s)
        <input type="number" min="1" max="900" bind:value={renderSeconds} />
      </label>
      <label>
        Fondu (s)
        <input type="number" min="0" max="30" step="0.5" bind:value={renderFade} />
      </label>
      <div class="presets">
        {#if defSeconds}
          <button class="ghost" on:click={() => preset(defSeconds)}>
            Version du jeu ({fmt(defSeconds)})
          </button>
        {/if}
        <button class="ghost" on:click={() => preset(30)}>Court (30 s)</button>
        <button class="ghost" on:click={() => preset(defSeconds * 3)}>Long (×3)</button>
      </div>
    {/if}

    <div class="transport">
      <button on:click={playCurrent} disabled={!current}>▶ (Re)jouer</button>
      <button on:click={stop} disabled={status !== 'playing'}>⏹ Stop</button>
      <span class="status" data-state={status}>
        {#if status === 'playing'}▶ {current?.title}
        {:else if status === 'loading'}Rendu / chargement…
        {:else if current}⏸ {current.title}
        {:else}Choisis un morceau{/if}
      </span>
    </div>
  </section>

  {#if !library}
    <p>Chargement de la bibliothèque…</p>
  {:else}
    {#each library.games as group}
      <section class="game">
        <h2>{group.game}</h2>
        <ul>
          {#each group.tracks as track}
            <li class:active={current?.id === track.id}>
              <button class="track" on:click={() => selectAndPlay(track)}>
                <span class="title">{track.title}</span>
                <span class="meta">
                  {#if track.composer}{track.composer} · {/if}
                  {fmt(track.duration)}
                  {#if track.channels}<span class="badge stems">stems</span>
                  {:else if track.loop}<span class="badge">boucle</span>
                  {:else if track.render}<span class="badge alt">rendu serveur</span>{/if}
                </span>
              </button>
            </li>
          {/each}
        </ul>
      </section>
    {/each}
  {/if}
</main>

<style>
  :global(body) {
    margin: 0;
    background: #14121c;
    color: #e8e6f0;
    font-family: system-ui, sans-serif;
  }
  main {
    max-width: 760px;
    margin: 0 auto;
    padding: 1.5rem;
  }
  header h1 {
    margin: 0;
    font-size: 2rem;
  }
  header p {
    margin: 0.2rem 0 1.5rem;
    color: #9b96b8;
  }
  .error {
    background: #3a1320;
    color: #ff9aa9;
    padding: 0.6rem 0.9rem;
    border-radius: 8px;
  }
  .controls {
    display: flex;
    flex-wrap: wrap;
    gap: 1rem;
    align-items: flex-end;
    background: #1e1b2c;
    padding: 1rem;
    border-radius: 12px;
    margin-bottom: 1.5rem;
    /* Lecteur toujours visible : épinglé en haut pendant le défilement. */
    position: sticky;
    top: 0;
    z-index: 10;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
  }
  label {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    font-size: 0.85rem;
    color: #9b96b8;
  }
  select,
  input {
    background: #2a2640;
    color: #e8e6f0;
    border: 1px solid #3a3553;
    border-radius: 6px;
    padding: 0.4rem 0.5rem;
    font-size: 0.95rem;
  }
  input[type='number'] {
    width: 5rem;
  }
  .presets {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
    align-items: flex-end;
  }
  .now {
    flex: 1 1 100%;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }
  .now-title {
    font-size: 1.05rem;
    font-weight: 600;
  }
  .now-sub {
    font-size: 0.8rem;
    color: #9b96b8;
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
    margin-top: 0.15rem;
  }
  .chip {
    background: #2a2640;
    border: 1px solid #3a3553;
    border-radius: 999px;
    padding: 0.1rem 0.55rem;
    font-size: 0.78rem;
    color: #cfcae8;
  }
  .chip b {
    color: #b9b2e6;
    font-weight: 600;
  }
  .chip.muted {
    color: #7c769a;
    font-style: italic;
  }
  .transport {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    margin-left: auto;
  }
  button {
    cursor: pointer;
    border: none;
    border-radius: 8px;
    padding: 0.5rem 0.9rem;
    background: #6c5ce7;
    color: white;
    font-size: 0.95rem;
  }
  button.ghost {
    background: #2a2640;
    color: #cfcae8;
    border: 1px solid #3a3553;
    padding: 0.4rem 0.7rem;
    font-size: 0.85rem;
  }
  button:disabled {
    opacity: 0.4;
    cursor: default;
  }
  .status {
    font-size: 0.85rem;
    color: #9b96b8;
  }
  .game h2 {
    font-size: 1.1rem;
    border-bottom: 1px solid #2a2640;
    padding-bottom: 0.3rem;
  }
  ul {
    list-style: none;
    padding: 0;
    margin: 0 0 1.5rem;
  }
  li.active .track {
    background: #2a2640;
  }
  .track {
    display: flex;
    justify-content: space-between;
    align-items: center;
    width: 100%;
    background: transparent;
    color: inherit;
    text-align: left;
    padding: 0.6rem 0.8rem;
    border-radius: 8px;
  }
  .track:hover {
    background: #221f33;
  }
  .meta {
    font-size: 0.8rem;
    color: #9b96b8;
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  .badge {
    background: #6c5ce7;
    color: white;
    border-radius: 4px;
    padding: 0.05rem 0.35rem;
    font-size: 0.7rem;
  }
  .badge.alt {
    background: #3a3553;
    color: #cfcae8;
  }
  .badge.stems {
    background: #1f7a5a;
    color: #d6fff0;
  }
  .channels {
    flex: 1 1 100%;
    display: flex;
    flex-wrap: wrap;
    align-items: flex-start;
    gap: 0.6rem;
  }
  .chan-label {
    font-size: 0.85rem;
    color: #9b96b8;
    align-self: center;
  }
  .chan {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    flex: 1 1 120px;
    min-width: 110px;
    max-width: 180px;
    background: #15131f;
    border: 1px solid #2a2640;
    border-radius: 8px;
    padding: 0.4rem 0.5rem;
  }
  .chan.off {
    opacity: 0.55;
  }
  .chan-toggle {
    flex-direction: row;
    align-items: center;
    gap: 0.35rem;
    font-size: 0.82rem;
    color: #e8e6f0;
  }
  .chan input {
    width: auto;
  }

  /* Progression intro/boucle + compteur de boucles. */
  .progress {
    flex: 1 1 100%;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  /* Timer de diagnostic (temps joué / position source / frame moteur). */
  .timer {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.78rem;
    font-variant-numeric: tabular-nums;
    color: #9b96b8;
  }
  .timer .t-elapsed {
    color: #e8e6f0;
    font-weight: 600;
  }
  .timer .t-frame {
    color: #7fe9cf;
    font-weight: 600;
  }
  .timer .t-loop {
    color: #b9b2e6;
    margin-left: auto;
  }
  .timer .t-sep {
    opacity: 0.4;
  }
  /* État figé (après stop / fin) : on garde les infos lisibles, barre atténuée. */
  .progress.frozen .bar {
    opacity: 0.65;
  }
  .progress.frozen .playhead {
    box-shadow: none;
  }
  .bar-row {
    display: flex;
    align-items: center;
    gap: 0.8rem;
  }
  .bar {
    position: relative;
    flex: 1;
    height: 22px;
    display: flex;
    border-radius: 6px;
    overflow: hidden;
    background: #15131f;
    border: 1px solid #2a2640;
  }
  .seg {
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 0.6rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: rgba(255, 255, 255, 0.5);
    overflow: hidden;
    white-space: nowrap;
  }
  .seg.intro {
    background: rgba(108, 92, 231, 0.22);
    border-right: 1px solid #3a3553;
  }
  .seg.loop {
    background: rgba(46, 197, 160, 0.18);
  }
  .playhead {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 2px;
    margin-left: -1px;
    background: #fff;
    box-shadow: 0 0 6px rgba(255, 255, 255, 0.8);
  }
  .counter {
    font-size: 0.85rem;
    font-weight: 600;
    color: #cfcae8;
    white-space: nowrap;
    min-width: 5.5rem;
    text-align: right;
  }
  .counter.active {
    color: #7fe9cf;
  }

  /* Oscilloscopes (une voix = une onde). */
  .scope {
    display: block;
    width: 100%;
    height: 30px;
    border-radius: 6px;
    background: #15131f;
    border: 1px solid #2a2640;
  }
  .scope.mix {
    height: 48px;
  }
</style>
