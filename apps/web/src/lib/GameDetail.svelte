<script lang="ts">
  /**
   * Vue détail d'un jeu (colonne centrale) : fil d'Ariane, en-tête (pochette +
   * actions), onglets Pistes / Infos / Fichiers / Artwork, et liste de pistes.
   * Les métadonnées absentes du backend (année, genre, description) sont masquées
   * ou affichées en « — » (placeholder).
   */
  import { tracksOfGame, playGame, favorites, navigate, openConsole, current, status, togglePlay, toggleFavorite } from './player';
  import { coverGradient, initials } from './cover';
  import { fmt } from './format';
  import Icon from './Icon.svelte';
  import TrackList from './TrackList.svelte';

  export let game: string;

  type Tab = 'tracks' | 'infos' | 'files' | 'screenshot';
  let tab: Tab = 'tracks';

  $: tracks = tracksOfGame(game);
  $: platform = tracks[0]?.platform ?? null;
  $: composer = topComposer(tracks);
  $: totalDur = tracks.reduce((s, t) => s + t.duration, 0);
  $: voicesMax = tracks.reduce((m, t) => Math.max(m, t.channels?.voices.length ?? 0), 0);
  $: allFav = tracks.length > 0 && tracks.every((t) => $favorites.has(t.id));
  $: playingThisGame = $current && tracks.some((t) => t.id === $current?.id) && $status === 'playing';

  function topComposer(ts: typeof tracks): string | null {
    const by = new Map<string, number>();
    for (const t of ts) if (t.composer) by.set(t.composer, (by.get(t.composer) ?? 0) + 1);
    let best: string | null = null;
    let n = 0;
    for (const [c, k] of by) if (k > n) { best = c; n = k; }
    return best;
  }

  function onPlayAll(): void {
    if (playingThisGame) void togglePlay();
    else void playGame(game);
  }

  function onFavGame(): void {
    // Bascule tout le jeu : si tout est déjà favori -> on enlève, sinon on ajoute.
    favorites.update((s) => {
      const next = new Set(s);
      if (allFav) for (const t of tracks) next.delete(t.id);
      else for (const t of tracks) next.add(t.id);
      return next;
    });
  }
</script>

<div class="detail">
  <!-- Fil d'Ariane -->
  <nav class="crumbs">
    <button on:click={() => navigate('library')}>Bibliothèque</button>
    {#if platform}
      <Icon name="chevron-right" size={13} />
      <button on:click={() => openConsole(platform)}>{platform}</button>
    {/if}
    <Icon name="chevron-right" size={13} />
    <span class="cur">{game}</span>
  </nav>

  <!-- En-tête -->
  <header class="hero">
    <div class="cover" style="background:{coverGradient(game)}">
      <span class="ini">{initials(game)}</span>
      {#if platform}<span class="badge">{platform}</span>{/if}
    </div>

    <div class="hero-info">
      <h1>{game}</h1>
      <div class="sub">
        {#if platform}{platform}{/if}
        <span class="dot">·</span>{tracks.length} piste{tracks.length > 1 ? 's' : ''}
        <span class="dot">·</span>{fmt(totalDur)}
      </div>
      {#if composer}<div class="composer">Compositeur : <b>{composer}</b></div>{/if}

      <div class="tags">
        {#if platform}<span class="tag">{platform}</span>{/if}
        {#if voicesMax}<span class="tag">{voicesMax} voix</span>{/if}
        <span class="tag ghost">Musique de jeu</span>
      </div>

      <div class="actions">
        <button class="play-all" on:click={onPlayAll}>
          <Icon name={playingThisGame ? 'pause' : 'play'} size={16} />
          {playingThisGame ? 'Pause' : 'Tout lire'}
        </button>
        <button
          class="ghost-btn"
          class:on={allFav}
          aria-pressed={allFav}
          on:click={onFavGame}
          title={allFav ? 'Retirer le jeu des favoris' : 'Ajouter le jeu aux favoris'}
        >
          <Icon name={allFav ? 'heart-filled' : 'heart'} size={16} />
          {allFav ? 'Dans les favoris' : 'Favori'}
        </button>
      </div>
    </div>
  </header>

  <!-- Onglets -->
  <nav class="tabs">
    <button class:active={tab === 'tracks'} on:click={() => (tab = 'tracks')}>Pistes ({tracks.length})</button>
    <button class:active={tab === 'infos'} on:click={() => (tab = 'infos')}>Infos</button>
    <button class:active={tab === 'files'} on:click={() => (tab = 'files')}>Fichiers</button>
    <button class:active={tab === 'screenshot'} on:click={() => (tab = 'screenshot')}>Screenshot</button>
  </nav>

  <div class="tab-body">
    {#if tab === 'tracks'}
      <TrackList {tracks} context={tracks} />
    {:else if tab === 'infos'}
      <dl class="infos">
        <dt>Jeu</dt><dd>{game}</dd>
        <dt>Plateforme</dt><dd>{platform ?? '—'}</dd>
        <dt>Compositeur</dt><dd>{composer ?? '—'}</dd>
        <dt>Pistes</dt><dd>{tracks.length}</dd>
        <dt>Durée totale</dt><dd>{fmt(totalDur)}</dd>
        <dt>Voix max</dt><dd>{voicesMax || '—'}</dd>
        <dt>Année</dt><dd class="faint">—</dd>
        <dt>Genre</dt><dd class="faint">—</dd>
      </dl>
    {:else if tab === 'files'}
      <ul class="files">
        {#each tracks as t}
          <li>
            <Icon name="music" size={15} />
            <span class="f-title">{t.title}</span>
            <code>{t.streamUrl}</code>
            {#if t.channels}<span class="f-tag">{t.channels.voices.length} stems</span>{/if}
          </li>
        {/each}
      </ul>
    {:else}
      <div class="artwork">
        <div class="art-cover" style="background:{coverGradient(game)}"><span>{initials(game)}</span></div>
        <p class="faint">Pas de screenshot importé pour ce jeu.</p>
      </div>
    {/if}
  </div>
</div>

<style>
  .detail { display: flex; flex-direction: column; gap: 18px; padding: 20px 24px; }

  .crumbs {
    display: flex;
    align-items: center;
    gap: 7px;
    font-size: 13px;
    color: var(--text-faint);
  }
  .crumbs button { color: var(--text-dim); }
  .crumbs button:hover { color: var(--text); }
  .crumbs .cur { color: var(--text); font-weight: 500; }

  .hero { display: flex; gap: 22px; }
  .cover {
    position: relative;
    width: 168px; height: 168px;
    border-radius: var(--r-lg);
    flex: none;
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: var(--shadow-lg);
  }
  .ini {
    font-size: 46px;
    font-weight: 800;
    color: rgba(255,255,255,0.92);
    text-shadow: 0 2px 10px rgba(0,0,0,0.45);
  }
  .badge {
    position: absolute;
    left: 10px; bottom: 10px;
    font-size: 11px;
    font-weight: 700;
    padding: 3px 8px;
    border-radius: var(--r-sm);
    background: rgba(0,0,0,0.5);
    color: #fff;
    backdrop-filter: blur(4px);
  }

  .hero-info { display: flex; flex-direction: column; gap: 8px; min-width: 0; justify-content: center; }
  h1 { margin: 0; font-size: 30px; font-weight: 800; line-height: 1.1; }
  .sub { font-size: 14px; color: var(--text-dim); }
  .sub .dot { margin: 0 7px; opacity: 0.5; }
  .composer { font-size: 13px; color: var(--text-dim); }
  .composer b { color: var(--text); }

  .tags { display: flex; flex-wrap: wrap; gap: 7px; margin-top: 2px; }
  .tag {
    font-size: 12px;
    padding: 3px 10px;
    border-radius: var(--r-pill);
    background: var(--surface);
    border: 1px solid var(--border);
    color: var(--text-dim);
  }
  .tag.ghost { color: var(--text-faint); }

  .actions { display: flex; align-items: center; gap: 10px; margin-top: 8px; }
  .play-all {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 10px 20px;
    border-radius: var(--r-pill);
    background: var(--accent-grad);
    color: #fff;
    font-weight: 700;
    font-size: 14px;
    box-shadow: 0 6px 18px rgba(124,92,255,0.4);
  }
  .play-all:hover { filter: brightness(1.07); transform: translateY(-1px); }
  .ghost-btn {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 9px 16px;
    border-radius: var(--r-pill);
    background: var(--surface);
    border: 1px solid var(--border);
    color: var(--text);
    font-weight: 600;
    font-size: 13px;
  }
  .ghost-btn:hover { border-color: var(--border-strong); }
  .ghost-btn.on { color: var(--pink); border-color: rgba(255,107,157,0.4); }

  .tabs {
    display: flex;
    gap: 22px;
    border-bottom: 1px solid var(--border-soft);
  }
  .tabs button {
    padding: 10px 0;
    font-size: 13.5px;
    font-weight: 600;
    color: var(--text-faint);
    border-bottom: 2px solid transparent;
    margin-bottom: -1px;
  }
  .tabs button:hover { color: var(--text-dim); }
  .tabs button.active { color: var(--accent-strong); border-bottom-color: var(--accent-strong); }

  .infos {
    display: grid;
    grid-template-columns: 160px 1fr;
    gap: 10px 16px;
    max-width: 520px;
    font-size: 14px;
  }
  .infos dt { color: var(--text-faint); }
  .infos dd { margin: 0; color: var(--text); }
  .infos dd.faint { color: var(--text-faint); }

  .files { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; }
  .files li {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 10px;
    border-radius: var(--r-sm);
    color: var(--text-dim);
    font-size: 13px;
  }
  .files li:hover { background: var(--surface-hover); }
  .f-title { color: var(--text); min-width: 120px; }
  .files code { font-family: var(--mono); font-size: 11.5px; color: var(--text-faint); flex: 1; }
  .f-tag {
    font-size: 11px;
    padding: 1px 8px;
    border-radius: var(--r-pill);
    background: var(--surface);
    color: var(--text-dim);
  }

  .artwork { display: flex; flex-direction: column; align-items: center; gap: 14px; padding: 30px; }
  .art-cover {
    width: 240px; height: 240px;
    border-radius: var(--r-lg);
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: var(--shadow-lg);
  }
  .art-cover span { font-size: 64px; font-weight: 800; color: rgba(255,255,255,0.92); }
  .faint { color: var(--text-faint); font-style: italic; }
</style>
