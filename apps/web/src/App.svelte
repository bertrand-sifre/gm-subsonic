<script lang="ts">
  import { onMount } from 'svelte';
  import type { Library, PlaybackMode, Track } from '@vdm/shared';
  import { fetchLibrary } from './lib/api';
  import { LoopPlayer } from './lib/LoopPlayer';

  let library: Library | null = null;
  let error = '';
  let current: Track | null = null;
  let status: 'stopped' | 'loading' | 'playing' = 'stopped';

  let mode: PlaybackMode = 'loopCount';
  let loopCount = 3;
  let fadeSeconds = 4;

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
    try {
      status = 'loading';
      current = track;
      await player.load(track);
      await player.play({ mode, loopCount, fadeSeconds });
      status = 'playing';
    } catch (e) {
      error = String(e);
      status = 'stopped';
    }
  }

  async function replay() {
    if (!current) return;
    try {
      status = 'loading';
      await player.play({ mode, loopCount, fadeSeconds });
      status = 'playing';
    } catch (e) {
      error = String(e);
      status = 'stopped';
    }
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

    <div class="transport">
      <button on:click={replay} disabled={!current}>▶ (Re)jouer</button>
      <button on:click={stop} disabled={status !== 'playing'}>⏹ Stop</button>
      <span class="status" data-state={status}>
        {#if status === 'playing'}En lecture : {current?.title}
        {:else if status === 'loading'}Chargement…
        {:else}Arrêté{/if}
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
                  {#if track.loop}<span class="badge">boucle</span>{/if}
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
</style>
