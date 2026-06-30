<script lang="ts">
  /**
   * Coquille de l'application : grille 3 colonnes (sidebar / centre / lecture en
   * cours) + barre de lecture en pied de page. Toute la logique vit dans le store
   * `lib/player.ts` ; ce fichier ne fait qu'assembler les régions.
   */
  import { onMount } from 'svelte';
  import { initLibrary, loadError, library } from './lib/player';
  import Sidebar from './lib/Sidebar.svelte';
  import CenterView from './lib/CenterView.svelte';
  import NowPlaying from './lib/NowPlaying.svelte';
  import PlayerBar from './lib/PlayerBar.svelte';

  onMount(() => {
    void initLibrary();
  });
</script>

<div class="app">
  <Sidebar />

  {#if $loadError}
    <main class="center fallback">
      <div class="err">
        <h2>Bibliothèque indisponible</h2>
        <p>{$loadError}</p>
      </div>
    </main>
    <aside class="now-empty"></aside>
  {:else if !$library}
    <main class="center fallback">
      <div class="loading">Chargement de la bibliothèque…</div>
    </main>
    <aside class="now-empty"></aside>
  {:else}
    <CenterView />
    <NowPlaying />
  {/if}

  <PlayerBar />
</div>

<style>
  .app {
    display: grid;
    grid-template-columns: var(--sidebar-w) minmax(0, 1fr) var(--now-w);
    grid-template-rows: minmax(0, 1fr) var(--player-h);
    grid-template-areas:
      'sidebar main now'
      'player player player';
    height: 100vh;
    overflow: hidden;
  }

  .center.fallback {
    grid-area: main;
    background: var(--bg-main);
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .now-empty {
    grid-area: now;
    background: var(--bg-panel);
    border-left: 1px solid var(--border-soft);
  }
  .loading { color: var(--text-faint); }
  .err { text-align: center; color: var(--text-dim); }
  .err h2 { color: var(--text); }
  .err p { color: var(--danger); font-family: var(--mono); font-size: 13px; }

  /* Responsive : on replie le panneau de droite puis la sidebar. */
  @media (max-width: 1180px) {
    .app {
      grid-template-columns: var(--sidebar-w) minmax(0, 1fr);
      grid-template-areas:
        'sidebar main'
        'player player';
    }
    .app :global(.now) { display: none; }
    .now-empty { display: none; }
  }
  @media (max-width: 760px) {
    .app {
      grid-template-columns: minmax(0, 1fr);
      grid-template-areas:
        'main'
        'player';
    }
    .app :global(.sidebar) { display: none; }
  }
</style>
