<script lang="ts">
  /**
   * Tableau de pistes (façon liste de titres Spotify). Réutilisé par la vue
   * détail d'un jeu, les favoris et l'historique. Clic sur une ligne -> lecture
   * dans le contexte fourni.
   */
  import type { Track } from '@vdm/shared';
  import { current, status, favorites, playTrack, togglePlay, toggleFavorite } from './player';
  import { fmt, pad2 } from './format';
  import Icon from './Icon.svelte';

  export let tracks: Track[] = [];
  /** Contexte de file de lecture (par défaut = la liste affichée). */
  export let context: Track[] | null = null;
  /** Afficher la colonne « jeu » (favoris / historique multi-jeux). */
  export let showGame = false;
  export let emptyLabel = 'Aucune piste.';

  $: queueCtx = context ?? tracks;

  function rowClick(track: Track): void {
    if ($current?.id === track.id) {
      void togglePlay();
    } else {
      void playTrack(track, queueCtx);
    }
  }

  // La ligne est un `div role="button"` (pour pouvoir contenir le bouton favori
  // sans imbriquer deux <button>) : on gère donc Entrée/Espace à la main. On
  // ignore les évènements remontés depuis un enfant focusable (le cœur favori).
  function onRowKey(e: KeyboardEvent, track: Track): void {
    if (e.target !== e.currentTarget) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      rowClick(track);
    }
  }

  function loopPoint(t: Track): string {
    return t.loop ? fmt(t.loop.loopStart) : '—';
  }
  function loopLen(t: Track): string {
    return t.loop ? fmt(t.loop.loopEnd - t.loop.loopStart) : '—';
  }
  function tailLen(t: Track): string {
    if (t.loop) {
      const tail = t.duration - t.loop.loopEnd;
      return tail > 0.05 ? fmt(tail) : '—';
    }
    return t.render ? `${t.render.defaultFade}s` : '—';
  }
</script>

<div class="tracklist">
  <div class="head" class:with-game={showGame}>
    <span class="c-idx">#</span>
    <span class="c-title">Titre</span>
    {#if showGame}<span class="c-game">Jeu</span>{/if}
    <span class="c-dur">Durée</span>
    <span class="c-loop">Boucle</span>
    <span class="c-chan">Canaux</span>
    <span class="c-fav"></span>
  </div>

  {#if !tracks.length}
    <p class="empty">{emptyLabel}</p>
  {/if}

  {#each tracks as track, i (track.id)}
    {@const isCur = $current?.id === track.id}
    {@const playing = isCur && $status === 'playing'}
    <div
      class="row"
      class:active={isCur}
      class:with-game={showGame}
      role="button"
      tabindex="0"
      aria-label={`Lire ${track.title} — ${track.game}`}
      on:click={() => rowClick(track)}
      on:keydown={(e) => onRowKey(e, track)}
    >
      <span class="c-idx">
        {#if playing}
          <span class="eq" aria-label="en lecture"><i></i><i></i><i></i></span>
        {:else if isCur}
          <Icon name="play" size={14} />
        {:else}
          <span class="num">{pad2(i + 1)}</span>
          <span class="hover-play"><Icon name="play" size={14} /></span>
        {/if}
      </span>

      <span class="c-title">
        <span class="t-name" class:cur={isCur}>{track.title}</span>
        {#if track.composer}<span class="t-sub">{track.composer}</span>{/if}
      </span>

      {#if showGame}
        <span class="c-game">{track.game}</span>
      {/if}

      <span class="c-dur">{fmt(track.duration)}</span>

      <span class="c-loop">
        {#if track.loop}
          <span class="loop-cell">
            <span class="seg-tag intro">Intro <b>{loopPoint(track)}</b></span>
            <span class="seg-tag loop">Loop <b>{loopLen(track)}</b></span>
            <span class="seg-tag fade">Fin <b>{tailLen(track)}</b></span>
          </span>
        {:else}
          <span class="muted">piste finie</span>
        {/if}
      </span>

      <span class="c-chan">
        {#if track.channels}
          <span class="chan-badge"><Icon name="sliders" size={13} /> {track.channels.voices.length}</span>
        {:else}
          —
        {/if}
      </span>

      <span class="c-fav">
        <button
          type="button"
          class="fav"
          class:on={$favorites.has(track.id)}
          aria-pressed={$favorites.has(track.id)}
          aria-label={$favorites.has(track.id) ? 'Retirer des favoris' : 'Ajouter aux favoris'}
          title={$favorites.has(track.id) ? 'Retirer des favoris' : 'Ajouter aux favoris'}
          on:click|stopPropagation={() => toggleFavorite(track.id)}
          on:keydown|stopPropagation
        >
          <Icon name={$favorites.has(track.id) ? 'heart-filled' : 'heart'} size={16} />
        </button>
      </span>
    </div>
  {/each}
</div>

<style>
  .tracklist {
    display: flex;
    flex-direction: column;
  }

  .head,
  .row {
    display: grid;
    grid-template-columns: 36px minmax(0, 1fr) 64px 230px 78px 40px;
    align-items: center;
    gap: 12px;
    padding: 0 12px;
  }
  .head.with-game,
  .row.with-game {
    grid-template-columns: 36px minmax(0, 1.4fr) minmax(0, 0.9fr) 64px 230px 78px 40px;
  }

  .head {
    height: 34px;
    font-size: 11px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--text-faint);
    border-bottom: 1px solid var(--border-soft);
    position: sticky;
    top: 0;
    background: var(--bg-main);
    z-index: 1;
  }

  .row {
    height: 50px;
    border: none;
    background: transparent;
    text-align: left;
    color: var(--text-dim);
    border-radius: var(--r-md);
    cursor: pointer;
  }
  .row:hover {
    background: var(--surface-hover);
    color: var(--text);
  }
  .row.active {
    background: var(--accent-soft);
  }

  .c-idx {
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-faint);
  }
  .num {
    font-variant-numeric: tabular-nums;
  }
  .hover-play {
    display: none;
    color: var(--text);
  }
  .row:hover .num {
    display: none;
  }
  .row:hover .hover-play {
    display: inline-flex;
  }
  .row.active .c-idx {
    color: var(--accent-strong);
  }

  .c-title {
    display: flex;
    flex-direction: column;
    min-width: 0;
    gap: 1px;
  }
  .t-name {
    color: var(--text);
    font-weight: 500;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .t-name.cur {
    color: var(--accent-strong);
  }
  .t-sub {
    font-size: 12px;
    color: var(--text-faint);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .c-game {
    font-size: 13px;
    color: var(--text-dim);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .c-dur {
    font-variant-numeric: tabular-nums;
    font-size: 13px;
  }

  .loop-cell {
    display: flex;
    gap: 6px;
  }
  .seg-tag {
    font-size: 11px;
    color: var(--text-faint);
    white-space: nowrap;
  }
  .seg-tag b {
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }
  .seg-tag.intro b {
    color: var(--accent-strong);
  }
  .seg-tag.loop b {
    color: var(--good);
  }
  .seg-tag.fade b {
    color: var(--warn);
  }
  .muted {
    font-size: 12px;
    color: var(--text-faint);
    font-style: italic;
  }

  .c-chan {
    font-size: 13px;
  }
  .chan-badge {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 2px 8px;
    border-radius: var(--r-pill);
    background: var(--surface);
    color: var(--text-dim);
    font-variant-numeric: tabular-nums;
  }

  .c-fav {
    display: flex;
    justify-content: center;
  }
  .fav {
    display: inline-flex;
    padding: 5px;
    border-radius: var(--r-pill);
    color: var(--text-faint);
    opacity: 0;
    transition: color 0.12s, opacity 0.12s;
  }
  .row:hover .fav,
  .fav.on {
    opacity: 1;
  }
  .fav:hover {
    color: var(--text);
  }
  .fav.on {
    color: var(--pink);
  }

  .empty {
    padding: 28px 12px;
    color: var(--text-faint);
    font-style: italic;
  }

  /* Égaliseur animé (piste en lecture). */
  .eq {
    display: inline-flex;
    align-items: flex-end;
    gap: 2px;
    height: 14px;
  }
  .eq i {
    width: 2.5px;
    background: var(--accent-strong);
    border-radius: 1px;
    animation: eq 0.9s ease-in-out infinite;
  }
  .eq i:nth-child(1) { height: 40%; animation-delay: -0.2s; }
  .eq i:nth-child(2) { height: 90%; animation-delay: -0.5s; }
  .eq i:nth-child(3) { height: 60%; animation-delay: -0.1s; }
  @keyframes eq {
    0%, 100% { transform: scaleY(0.35); }
    50% { transform: scaleY(1); }
  }
</style>
