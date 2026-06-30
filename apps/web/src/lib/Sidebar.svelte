<script lang="ts">
  /**
   * Barre latérale gauche : logo, recherche, navigation principale.
   */
  import type { IconName } from './Icon.svelte';
  import { view, search, favorites, historyIds, navigate, settingsOpen, type ViewName } from './player';
  import Icon from './Icon.svelte';

  const NAV: { id: ViewName; label: string; icon: IconName }[] = [
    { id: 'home', label: 'Accueil', icon: 'home' },
    { id: 'library', label: 'Bibliothèque', icon: 'library' },
    { id: 'composers', label: 'Compositeurs', icon: 'users' },
    { id: 'favorites', label: 'Favoris', icon: 'heart' },
    { id: 'history', label: 'Historique', icon: 'clock' },
  ];
</script>

<aside class="sidebar">
  <div class="brand">
    <div class="logo"><Icon name="gamepad" size={22} /></div>
    <div class="brand-text">
      <span class="b1">VIDEO GAME MUSIC</span>
      <span class="b2">PLAYER</span>
    </div>
  </div>

  <label class="search">
    <Icon name="search" size={16} />
    <input type="text" placeholder="Rechercher un jeu, une piste…" aria-label="Rechercher un jeu, une piste" bind:value={$search} />
    <kbd aria-hidden="true">⌘K</kbd>
  </label>

  <nav class="nav">
    {#each NAV as item}
      <button class="nav-item" class:active={$view === item.id} on:click={() => navigate(item.id)}>
        <Icon name={item.icon} size={18} />
        <span>{item.label}</span>
        {#if item.id === 'favorites' && $favorites.size}<span class="count">{$favorites.size}</span>{/if}
        {#if item.id === 'history' && $historyIds.length}<span class="count">{$historyIds.length}</span>{/if}
      </button>
    {/each}
  </nav>

  <div class="spacer"></div>

  <button class="nav-item settings" on:click={() => settingsOpen.set(true)}>
    <Icon name="settings" size={18} />
    <span>Paramètres</span>
  </button>
</aside>

<style>
  .sidebar {
    grid-area: sidebar;
    background: var(--bg-sidebar);
    border-right: 1px solid var(--border-soft);
    display: flex;
    flex-direction: column;
    padding: 16px 12px;
    gap: 14px;
    overflow-y: auto;
  }

  .brand {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 4px 6px;
  }
  .logo {
    width: 38px; height: 38px;
    border-radius: var(--r-md);
    background: var(--accent-grad);
    color: #fff;
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 4px 14px rgba(124,92,255,0.4);
  }
  .brand-text { display: flex; flex-direction: column; line-height: 1.05; }
  .b1 { font-weight: 800; font-size: 15px; letter-spacing: 0.02em; }
  .b2 { font-weight: 700; font-size: 11px; letter-spacing: 0.32em; color: var(--accent-strong); }

  .search {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 10px;
    height: 38px;
    border-radius: var(--r-md);
    background: var(--surface);
    border: 1px solid var(--border);
    color: var(--text-faint);
  }
  .search:focus-within { border-color: var(--accent-line); }
  .search input {
    flex: 1;
    min-width: 0;
    border: none;
    background: none;
    color: var(--text);
    font-size: 13px;
    outline: none;
  }
  .search input::placeholder { color: var(--text-faint); }
  .search kbd {
    font-size: 10px;
    font-family: var(--font);
    color: var(--text-faint);
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: 5px;
    padding: 1px 5px;
  }

  .nav { display: flex; flex-direction: column; gap: 2px; }
  .nav-item {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 9px 12px;
    border-radius: var(--r-md);
    color: var(--text-dim);
    font-size: 13.5px;
    font-weight: 500;
    text-align: left;
  }
  .nav-item:hover { background: var(--surface-hover); color: var(--text); }
  .nav-item.active {
    background: var(--accent-soft);
    color: var(--accent-strong);
    font-weight: 600;
  }
  .nav-item span { flex: 1; }
  .count {
    flex: none !important;
    font-size: 11px;
    background: var(--surface-2);
    color: var(--text-dim);
    border-radius: var(--r-pill);
    padding: 1px 7px;
    font-variant-numeric: tabular-nums;
  }

  .spacer { flex: 1; min-height: 8px; }
</style>
