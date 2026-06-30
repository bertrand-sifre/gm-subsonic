<script lang="ts">
  /**
   * Barre latérale gauche : logo, recherche, navigation principale, liste des
   * consoles (comptées depuis la bibliothèque réelle) et profil. Les sections
   * sans données réelles restent présentes (façade) mais inertes/placeholder.
   */
  import type { IconName } from './Icon.svelte';
  import {
    library, view, search, favorites, historyIds, selectedConsole,
    navigate, openConsole, consoleCounts, type ViewName,
  } from './player';
  import Icon from './Icon.svelte';

  const NAV: { id: ViewName; label: string; icon: IconName }[] = [
    { id: 'home', label: 'Accueil', icon: 'home' },
    { id: 'library', label: 'Bibliothèque', icon: 'library' },
    { id: 'discover', label: 'Découvrir', icon: 'compass' },
    { id: 'genres', label: 'Genres / Ambiances', icon: 'sliders' },
    { id: 'consoles', label: 'Consoles', icon: 'gamepad' },
    { id: 'composers', label: 'Compositeurs', icon: 'users' },
    { id: 'favorites', label: 'Favoris', icon: 'heart' },
    { id: 'history', label: 'Historique', icon: 'clock' },
  ];

  $: consoles = $library ? consoleCounts() : [];
</script>

<aside class="sidebar">
  <div class="brand">
    <div class="logo"><Icon name="gamepad" size={22} /></div>
    <div class="brand-text">
      <span class="b1">GAME MUSIC</span>
      <span class="b2">ARCHIVE</span>
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

  <div class="section-title">Consoles</div>
  <div class="consoles">
    {#each consoles as c}
      <button
        class="console"
        class:active={$view === 'consoles' && $selectedConsole === c.platform}
        on:click={() => openConsole(c.platform)}
      >
        <span class="c-name">{c.platform}</span>
        <span class="c-count">{c.count}</span>
      </button>
    {/each}
    {#if !consoles.length}
      <span class="placeholder">—</span>
    {/if}
  </div>

  <div class="spacer"></div>

  <div class="profile">
    <div class="avatar">P1</div>
    <div class="who">
      <span class="name">player1</span>
      <span class="role">Collectionneur</span>
    </div>
    <div class="actions">
      <button title="Importer"><Icon name="download" size={16} /></button>
      <button title="Réglages"><Icon name="settings" size={16} /></button>
    </div>
  </div>
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

  .section-title {
    font-size: 11px;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--text-faint);
    font-weight: 700;
    padding: 4px 12px 0;
  }
  .consoles { display: flex; flex-direction: column; gap: 1px; }
  .console {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 7px 12px;
    border-radius: var(--r-sm);
    color: var(--text-dim);
    font-size: 13px;
    text-align: left;
  }
  .console:hover { background: var(--surface-hover); color: var(--text); }
  .console.active { color: var(--accent-strong); }
  .c-count { font-size: 11px; color: var(--text-faint); font-variant-numeric: tabular-nums; }
  .placeholder { padding: 7px 12px; color: var(--text-faint); }

  .spacer { flex: 1; min-height: 8px; }

  .profile {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px;
    border-radius: var(--r-md);
    background: var(--surface);
    border: 1px solid var(--border-soft);
  }
  .avatar {
    width: 36px; height: 36px;
    border-radius: 50%;
    background: linear-gradient(135deg, #4dd0e1, #7c5cff);
    color: #fff;
    font-weight: 800;
    font-size: 12px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex: none;
  }
  .who { display: flex; flex-direction: column; flex: 1; min-width: 0; }
  .name { font-size: 13px; font-weight: 600; }
  .role { font-size: 11px; color: var(--text-faint); }
  .actions { display: flex; gap: 2px; }
  .actions button {
    color: var(--text-faint);
    padding: 6px;
    border-radius: var(--r-sm);
  }
  .actions button:hover { color: var(--text); background: var(--surface-2); }
</style>
