<script lang="ts">
  import { onMount } from 'svelte';
  import type { Library, PlaybackMode, Track } from '@vdm/shared';
  import { fetchLibrary } from './lib/api';
  import { LoopPlayer } from './lib/LoopPlayer';

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
    await playCurrent();
  }

  async function playCurrent() {
    if (!current) return;
    try {
      status = 'loading';
      if (current.loop) {
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

  function stop() {
    player.stop();
    status = 'stopped';
  }

  function fmt(seconds: number): string {
    const m = Math.floor(seconds / 60);
    const s = Math.round(seconds % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
  }
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
          {#if current.loop}
            <span class="chip">🔁 boucle détectée</span>
          {:else if current.render}
            <span class="chip muted">lecture paramétrable (pas de boucle)</span>
          {/if}
        </div>
      {/if}
    </div>

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
                  {#if track.loop}<span class="badge">boucle</span>
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
</style>
