<script lang="ts">
  /**
   * Modale « Importer » : formulaire de DÉPÔT de fichiers (glisser-déposer ou
   * sélection). Les fichiers sont téléversés dans `library/` côté serveur, qui les
   * catalogue puis renvoie la bibliothèque fraîche (mise à jour en place via le store).
   */
  import {
    importOpen,
    importing,
    importError,
    uploadResult,
    uploadLibraryFiles,
    importLibrary,
  } from './player';
  import Icon from './Icon.svelte';

  /** Extensions acceptées (miroir de SOURCE_EXTENSIONS côté serveur). */
  const ACCEPT = '.nsf,.nsfe,.spc,.vgm,.vgz,.gbs,.gym,.ay,.hes,.kss';
  const ACCEPT_EXT = new Set(ACCEPT.split(','));
  /** Garde-fou de taille par fichier (miroir de MAX_UPLOAD_BYTES côté serveur). */
  const MAX_FILE_BYTES = 64 * 1024 * 1024;

  let selected: File[] = [];
  /** Fichiers écartés côté client (format/taille) lors du dernier dépôt. */
  let skipped: { name: string; reason: string }[] = [];
  let dragOver = false;
  let fileInput: HTMLInputElement;

  const fkey = (f: File): string => `${f.name}:${f.size}`;
  function ext(name: string): string {
    const i = name.lastIndexOf('.');
    return i >= 0 ? name.slice(i).toLowerCase() : '';
  }

  /** Ajoute les fichiers VALIDES (extension + taille) à la sélection ; signale les autres. */
  function addFiles(list: FileList | null): void {
    if (!list) return;
    const have = new Set(selected.map(fkey));
    const toAdd: File[] = [];
    const next: { name: string; reason: string }[] = [];
    for (const f of Array.from(list)) {
      if (have.has(fkey(f)) || toAdd.some((x) => fkey(x) === fkey(f))) continue; // doublon
      if (!ACCEPT_EXT.has(ext(f.name))) {
        next.push({ name: f.name, reason: 'format non pris en charge' });
      } else if (f.size > MAX_FILE_BYTES) {
        next.push({ name: f.name, reason: `trop volumineux (> ${MAX_FILE_BYTES / 1024 / 1024} Mo)` });
      } else {
        toAdd.push(f);
      }
    }
    selected = [...selected, ...toAdd];
    skipped = next;
  }

  function pick(): void {
    fileInput?.click();
  }
  function onInput(e: Event): void {
    addFiles((e.currentTarget as HTMLInputElement).files);
    (e.currentTarget as HTMLInputElement).value = ''; // re-sélectionner le même fichier reste possible
  }
  function onDrop(e: DragEvent): void {
    e.preventDefault();
    dragOver = false;
    addFiles(e.dataTransfer?.files ?? null);
  }
  function onDragOver(e: DragEvent): void {
    e.preventDefault();
    dragOver = true;
  }
  function onDragLeave(): void {
    dragOver = false;
  }

  function remove(i: number): void {
    selected = selected.filter((_, idx) => idx !== i);
  }

  async function submit(): Promise<void> {
    await uploadLibraryFiles(selected);
    if ($uploadResult) {
      selected = []; // succès → on vide la sélection (le résultat s'affiche)
      skipped = [];
    }
  }

  function rescan(): void {
    void importLibrary();
  }

  function close(): void {
    importOpen.set(false);
    selected = [];
    skipped = [];
    uploadResult.set(null);
    importError.set('');
  }

  function onKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') close();
  }
  /**
   * Garde-fou GLOBAL : tant que la modale est ouverte, on empêche le navigateur
   * d'ouvrir un fichier relâché EN DEHORS de la zone de dépôt (ce qui déchargerait
   * la SPA). `<svelte:window>` ne pouvant vivre dans un bloc, on garde sur `$importOpen`.
   */
  function onWinDrag(e: DragEvent): void {
    if ($importOpen) e.preventDefault();
  }
  function onOverlayClick(e: MouseEvent): void {
    if (e.target === e.currentTarget) close();
  }

  function fmtSize(n: number): string {
    if (n < 1024) return `${n} o`;
    if (n < 1024 * 1024) return `${Math.round(n / 1024)} Ko`;
    return `${(n / 1024 / 1024).toFixed(1)} Mo`;
  }
</script>

<svelte:window on:keydown={onKey} on:dragover={onWinDrag} on:drop={onWinDrag} />

{#if $importOpen}
  <div class="overlay" role="presentation" on:click={onOverlayClick}>
    <div class="card" role="dialog" aria-modal="true" aria-labelledby="import-title">
      <header>
        <h2 id="import-title"><Icon name="upload" size={18} /> Importer des fichiers</h2>
        <button type="button" class="close" aria-label="Fermer" on:click={close}>
          <Icon name="x" size={18} />
        </button>
      </header>

      <div class="body">
        <!-- Zone de dépôt : glisser-déposer ou clic pour sélectionner. -->
        <button
          type="button"
          class="drop"
          class:over={dragOver}
          on:click={pick}
          on:drop={onDrop}
          on:dragover={onDragOver}
          on:dragenter={onDragOver}
          on:dragleave={onDragLeave}
        >
          <Icon name="upload" size={26} />
          <span class="d1">Glissez vos fichiers ici ou <b>cliquez</b></span>
          <span class="d2">Formats : NSF, NSFe, SPC, VGM, VGZ, GBS, GYM, AY, HES, KSS</span>
        </button>
        <input
          bind:this={fileInput}
          type="file"
          multiple
          accept={ACCEPT}
          on:change={onInput}
          hidden
        />

        {#if skipped.length}
          <div class="result">
            {#each skipped as s}
              <p class="ko"><Icon name="x" size={14} /> {s.name} — {s.reason}</p>
            {/each}
          </div>
        {/if}

        {#if selected.length}
          <ul class="files">
            {#each selected as f, i (fkey(f))}
              <li>
                <Icon name="music" size={15} />
                <span class="fn" title={f.name}>{f.name}</span>
                <span class="fs">{fmtSize(f.size)}</span>
                <button type="button" class="rm" aria-label={`Retirer ${f.name}`} on:click={() => remove(i)} disabled={$importing}>
                  <Icon name="x" size={14} />
                </button>
              </li>
            {/each}
          </ul>
        {/if}

        {#if $uploadResult}
          {@const r = $uploadResult}
          <div class="result">
            {#if r.accepted.length}
              <p class="ok"><Icon name="check" size={14} /> {r.accepted.length} fichier(s) importé(s) : {r.accepted.join(', ')}</p>
            {/if}
            {#each r.rejected as rej}
              <p class="ko"><Icon name="x" size={14} /> {rej.name} — {rej.reason}</p>
            {/each}
            {#if !r.accepted.length && !r.rejected.length}
              <p class="ko">Aucun fichier traité.</p>
            {/if}
          </div>
        {/if}

        {#if $importError}
          <p class="err"><Icon name="x" size={14} /> {$importError}</p>
        {/if}

        <div class="actions">
          <button type="button" class="ghost" on:click={rescan} disabled={$importing} title="Ré-importer les fichiers déjà présents dans library/">
            Ré-scanner le dossier
          </button>
          <button
            type="button"
            class="btn"
            disabled={$importing || !selected.length}
            on:click={submit}
          >
            <span class="ico" class:spin={$importing}><Icon name={$importing ? 'refresh' : 'upload'} size={15} /></span>
            {$importing ? 'Import…' : `Importer ${selected.length || ''} fichier(s)`}
          </button>
        </div>
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
    width: min(520px, 100%);
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
  .close:hover { background: var(--surface-hover); color: var(--text); }

  .body { padding: 18px; display: flex; flex-direction: column; gap: 14px; }

  .drop {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 7px;
    padding: 28px 18px;
    border: 1.5px dashed var(--border);
    border-radius: var(--r-md);
    background: var(--surface);
    color: var(--text-faint);
    text-align: center;
    transition: border-color 0.15s, background 0.15s, color 0.15s;
  }
  .drop:hover { border-color: var(--accent-line); color: var(--text-dim); }
  .drop.over {
    border-color: var(--accent-strong);
    background: var(--accent-soft);
    color: var(--accent-strong);
  }
  .d1 { font-size: 13.5px; color: var(--text); }
  .d1 b { color: var(--accent-strong); }
  .d2 { font-size: 11.5px; }

  .files {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
    max-height: 200px;
    overflow-y: auto;
  }
  .files li {
    display: flex;
    align-items: center;
    gap: 9px;
    padding: 7px 10px;
    border-radius: var(--r-md);
    background: var(--surface);
    border: 1px solid var(--border-soft);
    color: var(--text-dim);
  }
  .fn { flex: 1; min-width: 0; color: var(--text); font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .fs { font-size: 11.5px; color: var(--text-faint); font-variant-numeric: tabular-nums; }
  .rm { display: inline-flex; padding: 3px; border-radius: var(--r-pill); color: var(--text-faint); }
  .rm:hover { background: var(--surface-hover); color: var(--text); }
  .rm:disabled { opacity: 0.4; }

  .result { display: flex; flex-direction: column; gap: 4px; }
  .result p { margin: 0; display: flex; align-items: center; gap: 6px; font-size: 12.5px; }
  .ok { color: var(--good, #46d39a); }
  .ko { color: var(--warn, #ffb454); }
  .err { margin: 0; display: flex; align-items: center; gap: 6px; font-size: 12.5px; color: var(--danger, #ff6b81); }

  .actions { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-top: 2px; }
  .ghost {
    padding: 8px 12px;
    border-radius: var(--r-pill);
    color: var(--text-dim);
    font-size: 12.5px;
  }
  .ghost:hover { background: var(--surface-hover); color: var(--text); }
  .ghost:disabled { opacity: 0.5; }
  .btn {
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
  .btn:hover { filter: brightness(1.08); }
  .btn:disabled { opacity: 0.6; cursor: default; box-shadow: none; filter: none; }
  .ico { display: inline-flex; }
  .ico.spin { animation: spin 0.9s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
</style>
