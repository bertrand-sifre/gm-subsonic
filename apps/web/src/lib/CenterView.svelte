<script lang="ts">
  /**
   * Colonne centrale : aiguille selon la vue active (et la recherche). Les vues
   * pilotées par des données réelles (bibliothèque, consoles, compositeurs,
   * favoris, historique, recherche) sont fonctionnelles ; Découvrir / Genres
   * sont des placeholders « bientôt » faute de données.
   */
  import type { Track } from '@vdm/shared';
  import {
    view, search, selectedGame, selectedConsole, library, favorites, historyIds,
    openGame, openConsole, navigate, gamesOfPlatform, composerCounts, searchTracks, trackById,
  } from './player';
  import { coverGradient, initials } from './cover';
  import Icon from './Icon.svelte';
  import GameDetail from './GameDetail.svelte';
  import TrackList from './TrackList.svelte';

  $: games = $library?.games ?? [];
  $: searching = $search.trim().length > 0;
  $: results = searching ? searchTracks($search) : [];
  $: favTracks = games.flatMap((g) => g.tracks).filter((t) => $favorites.has(t.id));
  $: histTracks = $historyIds.map((id) => trackById(id)).filter((t): t is Track => !!t);
  $: composers = $library ? composerCounts() : [];

  // Cartes « consoles » : agrégat plateforme -> nb jeux + nb pistes.
  $: consoleCards = aggregateConsoles(games);
  function aggregateConsoles(gs: typeof games): { p: string; games: number; tracks: number }[] {
    const acc: { p: string; games: number; tracks: number }[] = [];
    for (const g of gs) {
      const p = g.tracks[0]?.platform ?? 'Autre';
      const e = acc.find((x) => x.p === p);
      if (e) { e.games++; e.tracks += g.tracks.length; }
      else acc.push({ p, games: 1, tracks: g.tracks.length });
    }
    return acc;
  }

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
    {:else}
      <section class="view-pad">
        <h2 class="vh">Bibliothèque</h2>
        <div class="grid">
          {#each games as g}
            <button class="card" on:click={() => openGame(g.game)}>
              <div class="cc" style="background:{coverGradient(g.game)}"><span>{initials(g.game)}</span></div>
              <div class="cn">{g.game}</div>
              <div class="cm">{gameMeta(g).platform ?? ''} · {gameMeta(g).count} pistes</div>
            </button>
          {/each}
        </div>
      </section>
    {/if}

  {:else if $view === 'home'}
    <section class="view-pad">
      <h2 class="vh">Bonjour 👋</h2>
      <h3 class="sh">Votre bibliothèque</h3>
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

  {:else if $view === 'consoles'}
    <section class="view-pad">
      {#if $selectedConsole}
        <button class="back" on:click={() => navigate('consoles')}><span class="flip"><Icon name="chevron-right" size={14} /></span> Toutes les consoles</button>
        <h2 class="vh">{$selectedConsole}</h2>
        <div class="grid">
          {#each gamesOfPlatform($selectedConsole) as g}
            <button class="card" on:click={() => openGame(g.game)}>
              <div class="cc" style="background:{coverGradient(g.game)}"><span>{initials(g.game)}</span></div>
              <div class="cn">{g.game}</div>
              <div class="cm">{g.tracks.length} pistes</div>
            </button>
          {/each}
        </div>
      {:else}
        <h2 class="vh">Consoles</h2>
        <div class="grid">
          {#each consoleCards as c}
            <button class="card console-card" on:click={() => openConsole(c.p)}>
              <div class="cc" style="background:{coverGradient(c.p)}"><Icon name="gamepad" size={34} /></div>
              <div class="cn">{c.p}</div>
              <div class="cm">{c.games} jeux · {c.tracks} pistes</div>
            </button>
          {/each}
        </div>
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

  {:else}
    <!-- Découvrir / Genres : placeholders -->
    <section class="view-pad placeholder-view">
      <div class="ph-card">
        <Icon name={$view === 'genres' ? 'sliders' : 'compass'} size={40} />
        <h2>{$view === 'genres' ? 'Genres / Ambiances' : 'Découvrir'}</h2>
        <p class="ph">Bientôt disponible. Cette section s'enrichira avec de nouvelles métadonnées.</p>
      </div>
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

  .back {
    align-self: flex-start;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    color: var(--text-dim);
    font-size: 13px;
  }
  .back .flip { display: inline-flex; transform: scaleX(-1); }
  .back:hover { color: var(--text); }

  .ph { color: var(--text-faint); font-style: italic; }
  .placeholder-view { align-items: center; justify-content: center; min-height: 60%; }
  .ph-card {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
    color: var(--text-faint);
    text-align: center;
    margin-top: 60px;
  }
  .ph-card h2 { margin: 4px 0 0; color: var(--text-dim); }
</style>
