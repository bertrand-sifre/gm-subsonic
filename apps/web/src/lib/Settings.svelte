<script lang="ts">
  /**
   * Panneau « Paramètres » (modal). Section Bibliothèque : surveillance du dossier
   * `library/` (auto-import à chaque changement) + import manuel + état du dernier
   * import. Le reste (réglages de lecture, thème…) viendra plus tard.
   */
  import {
    settingsOpen,
    libraryStatus,
    watchError,
    setWatchLibrary,
    refreshLibraryStatus,
  } from './player';
  import Icon from './Icon.svelte';

  function close(): void {
    settingsOpen.set(false);
  }

  // À l'ouverture, on rafraîchit l'état serveur (surveillance, dernier import).
  $: if ($settingsOpen) void refreshLibraryStatus();

  function onToggleWatch(e: Event): void {
    void setWatchLibrary((e.currentTarget as HTMLInputElement).checked);
  }

  // Fermeture au clavier (Échap).
  function onKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') close();
  }

  // Fermeture en cliquant l'overlay lui-même (pas un de ses enfants = la carte).
  function onOverlayClick(e: MouseEvent): void {
    if (e.target === e.currentTarget) close();
  }

  function importTime(at: number): string {
    try {
      return new Date(at).toLocaleTimeString();
    } catch {
      return '';
    }
  }
</script>

<svelte:window on:keydown={onKey} />

{#if $settingsOpen}
  <!-- Overlay cliquable : fermeture en cliquant en dehors de la carte. -->
  <div
    class="overlay"
    role="presentation"
    on:click={onOverlayClick}
  >
    <div
      class="card"
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-title"
    >
      <header>
        <h2 id="settings-title"><Icon name="settings" size={18} /> Paramètres</h2>
        <button type="button" class="close" aria-label="Fermer" on:click={close}>
          <Icon name="x" size={18} />
        </button>
      </header>

      <div class="body">
        <section class="group">
          <h3 class="g-title"><Icon name="folder" size={15} /> Bibliothèque</h3>

          <!-- Toggle : surveillance du dossier library/ -->
          <div class="row">
            <div class="row-text">
              <span class="r-label">Surveiller le dossier</span>
              <span class="r-sub">Importe automatiquement les fichiers déposés dans <code>library/</code>.</span>
            </div>
            <label class="switch">
              <input
                type="checkbox"
                checked={$libraryStatus?.watching ?? false}
                on:change={onToggleWatch}
                aria-label="Surveiller le dossier de la bibliothèque"
              />
              <span class="track"><span class="thumb"></span></span>
            </label>
          </div>

          {#if $watchError}
            <p class="msg err">{$watchError}</p>
          {:else if $libraryStatus?.lastImport}
            {@const li = $libraryStatus.lastImport}
            <p class="msg" class:err={!li.ok}>
              {#if li.ok}
                <Icon name="check" size={13} /> Dernier import à {importTime(li.at)} — {li.summary ?? 'OK'}
              {:else}
                <Icon name="x" size={13} /> Échec à {importTime(li.at)} — {li.error ?? 'erreur'}
              {/if}
            </p>
          {:else if $libraryStatus}
            <p class="msg">{$libraryStatus.games} jeu(x) · {$libraryStatus.tracks} morceau(x) en bibliothèque.</p>
          {/if}
        </section>
      </div>
    </div>
  </div>
{/if}

<style>
  .overlay {
    position: fixed;
    inset: 0;
    z-index: 50;
    background: rgba(0, 0, 0, 0.55);
    backdrop-filter: blur(2px);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
  }

  .card {
    width: min(480px, 100%);
    background: var(--bg-panel);
    border: 1px solid var(--border);
    border-radius: var(--r-lg, 14px);
    box-shadow: 0 24px 64px rgba(0, 0, 0, 0.5);
    overflow: hidden;
  }

  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 18px;
    border-bottom: 1px solid var(--border-soft);
  }
  header h2 {
    display: flex;
    align-items: center;
    gap: 9px;
    font-size: 15px;
    font-weight: 700;
    color: var(--text);
  }
  .close {
    display: inline-flex;
    padding: 6px;
    border-radius: var(--r-pill);
    color: var(--text-faint);
  }
  .close:hover {
    background: var(--surface-hover);
    color: var(--text);
  }

  .body {
    padding: 18px;
  }
  .group { display: flex; flex-direction: column; gap: 10px; }
  .g-title {
    display: flex;
    align-items: center;
    gap: 7px;
    margin: 0 0 2px;
    font-size: 12px;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--text-faint);
  }

  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding: 12px;
    border-radius: var(--r-md);
    background: var(--surface);
    border: 1px solid var(--border-soft);
  }
  .row-text { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
  .r-label { color: var(--text); font-weight: 600; font-size: 13.5px; }
  .r-sub { color: var(--text-faint); font-size: 12px; }
  code {
    font-family: var(--mono);
    font-size: 11.5px;
    background: var(--surface-2);
    padding: 0 4px;
    border-radius: 4px;
  }

  /* Interrupteur (toggle). */
  .switch { position: relative; flex: none; cursor: pointer; }
  .switch input {
    position: absolute;
    opacity: 0;
    width: 100%;
    height: 100%;
    margin: 0;
    cursor: pointer;
  }
  .track {
    display: block;
    width: 40px;
    height: 23px;
    border-radius: var(--r-pill);
    background: var(--surface-2);
    border: 1px solid var(--border);
    transition: background 0.15s;
  }
  .thumb {
    display: block;
    width: 17px;
    height: 17px;
    margin: 2px;
    border-radius: 50%;
    background: var(--text-faint);
    transition: transform 0.15s, background 0.15s;
  }
  .switch input:checked + .track {
    background: var(--accent-soft);
    border-color: var(--accent-line);
  }
  .switch input:checked + .track .thumb {
    transform: translateX(17px);
    background: var(--accent-strong);
  }
  .switch input:focus-visible + .track {
    box-shadow: 0 0 0 2px var(--accent-line);
  }

  .msg {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 2px 0 0;
    font-size: 12px;
    color: var(--text-dim);
  }
  .msg.err { color: var(--danger, #ff6b6b); }
</style>
