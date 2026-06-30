<script lang="ts">
  /**
   * Barre de lecture du bas (pleine largeur) : pochette + infos, transport,
   * forme d'onde-scrubber + temps, volume master et bouton de file.
   */
  import {
    current, status, progress, shuffle, repeat, favorites,
    masterVolume, masterMuted, queueOpen,
    togglePlay, next, prev, toggleShuffle, cycleRepeat, toggleFavorite,
    setMasterVolume, toggleMasterMute,
  } from './player';
  import { fmt } from './format';
  import { coverGradient, initials } from './cover';
  import Icon, { type IconName } from './Icon.svelte';
  import Waveform from './Waveform.svelte';

  $: t = $current;
  $: playing = $status === 'playing';
  $: totalLabel = $progress?.arrangementDur != null ? fmt($progress.arrangementDur) : '∞';
  $: volIcon = ($masterMuted || $masterVolume === 0 ? 'volume-mute' : $masterVolume < 0.5 ? 'volume-low' : 'volume') as IconName;
</script>

<footer class="player">
  <!-- Piste -->
  <div class="left">
    {#if t}
      <div class="thumb" style="background:{coverGradient(t.game)}"><span>{initials(t.game)}</span></div>
      <div class="meta">
        <div class="title" title={t.title}>{t.title}</div>
        <div class="sub" title={t.game}>{t.game}</div>
      </div>
      <button
        class="heart"
        class:on={$favorites.has(t.id)}
        aria-pressed={$favorites.has(t.id)}
        on:click={() => toggleFavorite(t.id)}
        title={$favorites.has(t.id) ? 'Retirer des favoris' : 'Ajouter aux favoris'}
        aria-label={$favorites.has(t.id) ? 'Retirer des favoris' : 'Ajouter aux favoris'}
      >
        <Icon name={$favorites.has(t.id) ? 'heart-filled' : 'heart'} size={17} />
      </button>
    {:else}
      <div class="thumb empty"><Icon name="music" size={20} /></div>
      <div class="meta"><div class="title dim">Aucune lecture</div></div>
    {/if}
  </div>

  <!-- Transport + waveform -->
  <div class="center">
    <div class="controls">
      <button class="ic" class:on={$shuffle} aria-pressed={$shuffle} on:click={toggleShuffle} title="Aléatoire" aria-label="Lecture aléatoire"><Icon name="shuffle" size={17} /></button>
      <button class="ic" on:click={() => prev()} title="Précédent" aria-label="Piste précédente"><Icon name="skip-back" size={19} /></button>
      <button class="play" on:click={() => togglePlay()} disabled={!t} title={playing ? 'Pause' : 'Lecture'} aria-label={playing ? 'Pause' : 'Lecture'}>
        <Icon name={playing ? 'pause' : 'play'} size={20} />
      </button>
      <button class="ic" on:click={() => next()} title="Suivant" aria-label="Piste suivante"><Icon name="skip-forward" size={19} /></button>
      <button class="ic" class:on={$repeat !== 'off'} on:click={cycleRepeat} title={`Répéter : ${$repeat}`} aria-label={`Répéter : ${$repeat}`}>
        <Icon name={$repeat === 'one' ? 'repeat-1' : 'repeat'} size={17} />
      </button>
    </div>
    <div class="scrub">
      <span class="t">{fmt($progress?.elapsed ?? 0)}</span>
      <div class="wave"><Waveform height={36} /></div>
      <span class="t">{totalLabel}</span>
    </div>
  </div>

  <!-- Volume + file -->
  <div class="right">
    <button
      class="ic"
      aria-pressed={$masterMuted}
      on:click={toggleMasterMute}
      title={$masterMuted ? 'Activer le son' : 'Couper le son'}
      aria-label={$masterMuted ? 'Activer le son' : 'Couper le son'}
    >
      <Icon name={volIcon} size={18} />
    </button>
    <input
      class="vol" type="range" min="0" max="100" step="1"
      value={Math.round(($masterMuted ? 0 : $masterVolume) * 100)}
      on:input={(e) => setMasterVolume(+e.currentTarget.value / 100)}
      aria-label="Volume"
    />
    <button class="ic" class:on={$queueOpen} aria-pressed={$queueOpen} on:click={() => queueOpen.update((q) => !q)} title="File de lecture" aria-label="File de lecture">
      <Icon name="queue" size={19} />
    </button>
  </div>
</footer>

<style>
  .player {
    grid-area: player;
    height: var(--player-h);
    background: var(--bg-panel);
    border-top: 1px solid var(--border);
    display: grid;
    grid-template-columns: minmax(180px, 1fr) minmax(0, 2.2fr) minmax(180px, 1fr);
    align-items: center;
    gap: 16px;
    padding: 0 18px;
  }

  /* Gauche */
  .left {
    display: flex;
    align-items: center;
    gap: 12px;
    min-width: 0;
  }
  .thumb {
    width: 52px; height: 52px;
    border-radius: var(--r-sm);
    flex: none;
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: var(--shadow-sm);
  }
  .thumb span {
    font-weight: 800;
    font-size: 16px;
    color: rgba(255,255,255,0.92);
    text-shadow: 0 1px 3px rgba(0,0,0,0.4);
  }
  .thumb.empty { background: var(--surface); color: var(--text-faint); box-shadow: none; }
  .meta { min-width: 0; }
  .title {
    font-size: 13px;
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .title.dim { color: var(--text-faint); }
  .sub {
    font-size: 12px;
    color: var(--text-faint);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .heart {
    color: var(--text-faint);
    padding: 6px;
    flex: none;
  }
  .heart:hover { color: var(--text); }
  .heart.on { color: var(--pink); }

  /* Centre */
  .center {
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 0;
  }
  .controls {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 14px;
  }
  .ic {
    color: var(--text-dim);
    padding: 5px;
    border-radius: var(--r-pill);
  }
  .ic:hover { color: var(--text); }
  .ic.on { color: var(--accent-strong); }
  .play {
    width: 38px; height: 38px;
    border-radius: 50%;
    background: var(--accent-grad);
    color: #fff;
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 4px 12px rgba(124,92,255,0.4);
  }
  .play:hover:not(:disabled) { filter: brightness(1.08); transform: scale(1.05); }
  .play:disabled { opacity: 0.45; cursor: default; box-shadow: none; }

  .scrub {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .scrub .t {
    font-size: 11px;
    color: var(--text-faint);
    font-variant-numeric: tabular-nums;
    width: 30px;
    flex: none;
  }
  .scrub .t:last-child { text-align: right; }
  .wave { flex: 1; min-width: 0; }

  /* Droite */
  .right {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 10px;
  }
  .vol {
    -webkit-appearance: none;
    appearance: none;
    width: 96px;
    height: 4px;
    border-radius: var(--r-pill);
    background: var(--surface-3);
    cursor: pointer;
  }
  .vol::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 12px; height: 12px;
    border-radius: 50%;
    background: #fff;
  }
  .vol::-moz-range-thumb {
    width: 12px; height: 12px;
    border: none;
    border-radius: 50%;
    background: #fff;
  }
</style>
