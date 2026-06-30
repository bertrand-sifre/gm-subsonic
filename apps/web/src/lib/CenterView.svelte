<script lang="ts">
  /**
   * Colonne centrale : aiguille selon la vue active (et la recherche). Toutes les
   * vues (bibliothèque, compositeurs, favoris, historique, recherche) sont pilotées
   * par des données réelles.
   */
  import type { Track } from '@vdm/shared';
  import {
    view, search, selectedGame, selectedConsole, library, favorites, historyIds,
    openGame, openConsole, navigate, platformList, gamesOfPlatform,
    composerCounts, searchTracks, trackById,
    libraryStatus, importError, importOpen,
  } from './player';
  import { coverGradient, initials } from './cover';
  import Icon from './Icon.svelte';
  import GameDetail from './GameDetail.svelte';
  import TrackList from './TrackList.svelte';

  $: games = $library?.games ?? [];
  $: searching = $search.trim().length > 0;
  // `$library ?` rend ces vues réactives au rechargement live (poll/import) : sans cette
  // dépendance, `searchTracks`/`trackById` lisent `get(library)` (NON réactif) et les
  // résultats/l'historique resteraient périmés (piège réactivité Svelte 4, cf. apps/web/CLAUDE.md).
  $: results = $library && searching ? searchTracks($search) : [];
  $: favTracks = games.flatMap((g) => g.tracks).filter((t) => $favorites.has(t.id));
  $: histTracks = $library ? $historyIds.map((id) => trackById(id)).filter((t): t is Track => !!t) : [];
  $: composers = $library ? composerCounts() : [];
  $: consoles = $library ? platformList() : [];
  $: consoleGames = $selectedConsole ? gamesOfPlatform($selectedConsole) : [];

  function gameMeta(g: { tracks: Track[] }): { platform: string | null; count: number } {
    return { platform: g.tracks[0]?.platform ?? null, count: g.tracks.length };
  }
</script>

<main class="center">
  {#if searching}
    <!-- Résultats de recherche (prioritaire sur la vue) -->
    <section class="view-pad">
      <h2 class="vh">Résultats pour « {$search.trim()} »</h2>
      <TrackList tracks={results} showGame emptyLabel="Aucun résultat." />
    </section>

  {:else if $view === 'library'}
    {#if $selectedGame}
      <GameDetail game={$selectedGame} />
    {:else if $selectedConsole}
      <!-- Jeux d'une console -->
      <section class="view-pad">
        <nav class="crumbs">
          <button on:click={() => navigate('library')}>Bibliothèque</button>
          <Icon name="chevron-right" size={13} />
          <span class="cur">{$selectedConsole}</span>
        </nav>
        <h2 class="vh">{$selectedConsole}</h2>
        <div class="grid">
          {#each consoleGames as g}
            <button class="card" on:click={() => openGame(g.game)}>
              <div class="cc" style="background:{coverGradient(g.game)}"><span>{initials(g.game)}</span></div>
              <div class="cn">{g.game}</div>
              <div class="cm">{g.tracks.length} pistes</div>
            </button>
          {/each}
        </div>
      </section>
    {:else}
      <!-- Liste des consoles (vue par défaut de la Bibliothèque) -->
      <section class="view-pad">
        <div class="vhead">
          <h2 class="vh">Bibliothèque</h2>
          <div class="lib-actions">
            {#if $libraryStatus?.watching}
              <span class="watch-pill" title="Surveillance du dossier library/ active">
                <Icon name="eye" size={13} /> Surveillé
              </span>
            {/if}
            <button
              type="button"
              class="import-btn"
              title="Déposer des fichiers à importer"
              on:click={() => importOpen.set(true)}
            >
              <span class="ico"><Icon name="upload" size={15} /></span>
              Importer
            </button>
          </div>
        </div>
        {#if $importError}<p class="import-err">{$importError}</p>{/if}
        <div class="grid">
          {#each consoles as c}
            <button class="card console-card" on:click={() => openConsole(c.platform)}>
              <div class="cc" style="background:{coverGradient(c.platform)}"><Icon name="gamepad" size={34} /></div>
              <div class="cn">{c.platform}</div>
              <div class="cm">{c.games} jeux · {c.tracks} pistes</div>
            </button>
          {/each}
        </div>
      </section>
    {/if}

  {:else if $view === 'home'}
    <section class="view-pad">
      <h2 class="vh">Votre bibliothèque</h2>
      <div class="grid">
        {#each games as g}
          <button class="card" on:click={() => openGame(g.game)}>
            <div class="cc" style="background:{coverGradient(g.game)}"><span>{initials(g.game)}</span></div>
            <div class="cn">{g.game}</div>
            <div class="cm">{gameMeta(g).platform ?? ''} · {gameMeta(g).count} pistes</div>
          </button>
        {/each}
      </div>
      {#if histTracks.length}
        <h3 class="sh">Écoutés récemment</h3>
        <TrackList tracks={histTracks.slice(0, 8)} showGame />
      {/if}
    </section>

  {:else if $view === 'composers'}
    <section class="view-pad">
      <h2 class="vh">Compositeurs</h2>
      {#if composers.length}
        <div class="grid">
          {#each composers as c}
            <button class="card" on:click={() => search.set(c.composer)}>
              <div class="cc round" style="background:{coverGradient(c.composer)}"><span>{initials(c.composer)}</span></div>
              <div class="cn">{c.composer}</div>
              <div class="cm">{c.count} pistes</div>
            </button>
          {/each}
        </div>
      {:else}
        <p class="ph">Aucun compositeur renseigné.</p>
      {/if}
    </section>

  {:else if $view === 'favorites'}
    <section class="view-pad">
      <h2 class="vh">Favoris</h2>
      <TrackList tracks={favTracks} showGame emptyLabel="Aucun favori pour l'instant — cliquez sur ♥ sur une piste." />
    </section>

  {:else if $view === 'history'}
    <section class="view-pad">
      <h2 class="vh">Historique</h2>
      <TrackList tracks={histTracks} showGame emptyLabel="Aucune écoute récente." />
    </section>
  {/if}
</main>

<style>
  .center {
    grid-area: main;
    background: var(--bg-main);
    overflow-y: auto;
  }
  .view-pad { padding: 24px; display: flex; flex-direction: column; gap: 16px; }

  .vh { margin: 0; font-size: 24px; font-weight: 800; }
  .sh { margin: 8px 0 0; font-size: 16px; font-weight: 700; color: var(--text); }

  .vhead {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    flex-wrap: wrap;
  }
  .lib-actions { display: flex; align-items: center; gap: 10px; }
  .watch-pill {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 5px 10px;
    border-radius: var(--r-pill);
    background: var(--accent-soft);
    color: var(--accent-strong);
    font-size: 12px;
    font-weight: 600;
  }
  .import-btn {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    padding: 9px 16px;
    border-radius: var(--r-pill);
    background: var(--accent-grad);
    color: #fff;
    font-weight: 600;
    font-size: 13px;
    box-shadow: 0 4px 14px rgba(124, 92, 255, 0.35);
  }
  .import-btn:hover { filter: brightness(1.08); }
  .ico { display: inline-flex; }
  .import-err { margin: 0; color: var(--danger, #ff6b6b); font-size: 13px; }

  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
    gap: 16px;
  }
  .card {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 14px;
    border-radius: var(--r-lg);
    background: var(--surface);
    border: 1px solid var(--border-soft);
    text-align: left;
  }
  .card:hover { background: var(--surface-hover); border-color: var(--border); transform: translateY(-2px); }
  .cc {
    aspect-ratio: 1;
    border-radius: var(--r-md);
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: var(--shadow-sm);
    color: rgba(255,255,255,0.92);
  }
  .cc.round { border-radius: 50%; width: 70%; margin: 0 auto; aspect-ratio: 1; }
  .cc span { font-size: 34px; font-weight: 800; text-shadow: 0 2px 8px rgba(0,0,0,0.4); }
  .cn { font-weight: 700; font-size: 14px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .cm { font-size: 12px; color: var(--text-faint); }
  .console-card .cc { color: #fff; }

  .crumbs {
    display: flex;
    align-items: center;
    gap: 7px;
    font-size: 13px;
    color: var(--text-faint);
    margin-bottom: 2px;
  }
  .crumbs button { color: var(--text-dim); }
  .crumbs button:hover { color: var(--text); }
  .crumbs .cur { color: var(--text); font-weight: 500; }

  .ph { color: var(--text-faint); font-style: italic; }
</style>
