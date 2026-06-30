<script lang="ts">
  /**
   * Panneau « Lecture en cours » (colonne droite) : en-tête de piste, transport,
   * sélecteur de comportement (modes de boucle), puis onglets Analyse / Métadonnées
   * / Notes — structure du morceau, mixer de stems et informations techniques.
   */
  import type { PlaybackMode } from '@vdm/shared';
  import {
    current, status, progress, mode, loopCount, fadeSeconds,
    shuffle, repeat, favorites,
    togglePlay, next, prev, toggleShuffle, cycleRepeat, setMode, setLoopCount, setFade,
    seekFraction, toggleFavorite,
  } from './player';
  import { fmt, fmtMs } from './format';
  import { coverGradient, initials } from './cover';
  import type { Progress } from './LoopPlayer';
  import Icon from './Icon.svelte';
  import StructureBar from './StructureBar.svelte';
  import ChannelMixer from './ChannelMixer.svelte';

  type Tab = 'analyse' | 'meta';
  let tab: Tab = 'analyse';

  $: t = $current;
  $: hasLoop = !!t?.loop;
  $: playing = $status === 'playing';

  // Modes proposés (faithful aux libellés de la maquette, fonctionnels).
  const MODES: { value: PlaybackMode; label: string; icon: 'play' | 'infinity' | 'repeat' | 'repeat-1' }[] = [
    { value: 'once', label: 'Normal', icon: 'play' },
    { value: 'loopInfinite', label: 'Boucle infinie', icon: 'infinity' },
    { value: 'loopCount', label: 'N boucles', icon: 'repeat' },
    { value: 'loopCountFade', label: 'N + fondu', icon: 'repeat-1' },
  ];
  $: isCount = $mode === 'loopCount' || $mode === 'loopCountFade';

  // Progression : fraction + libellé de total.
  $: frac = computeFrac($progress);
  function computeFrac(p: Progress | null): number {
    if (!p) return 0;
    if (p.arrangementDur && p.arrangementDur > 0) return Math.min(1, p.elapsed / p.arrangementDur);
    // Boucle infinie : position dans le cycle intro+boucle.
    const cyc = p.introDur + p.loopDur;
    return cyc > 0 ? Math.min(1, p.sourceTime / cyc) : 0;
  }
  $: totalLabel = $progress?.arrangementDur != null ? fmt($progress.arrangementDur) : '∞';
  $: loopBadge = loopCounter($progress);
  function loopCounter(p: Progress | null): string {
    if (!p || p.phase === 'linear') return '';
    if (p.phase === 'intro') return 'Intro';
    if (p.phase === 'tail') return 'Fin';
    return p.totalLoops != null ? `Boucle ${p.iteration}/${p.totalLoops}` : `Boucle ${p.iteration}`;
  }

  function onSeekClick(e: MouseEvent): void {
    // Un clic synthétisé au clavier (Entrée/Espace) a detail=0 et clientX=0 :
    // l'ignorer évite un saut au début (la navigation se fait aux flèches).
    if (e.detail === 0) return;
    if (!$progress || $progress.arrangementDur == null) return;
    const el = e.currentTarget as HTMLElement;
    const r = el.getBoundingClientRect();
    void seekFraction((e.clientX - r.left) / r.width);
  }

  function onSeekKey(e: KeyboardEvent): void {
    if (!$progress || $progress.arrangementDur == null) return;
    if (e.key === 'ArrowRight') void seekFraction(frac + 0.03);
    else if (e.key === 'ArrowLeft') void seekFraction(frac - 0.03);
    else if (e.key === 'Home') void seekFraction(0);
    else if (e.key === 'End') void seekFraction(0.99);
    else return;
    e.preventDefault();
  }

  // Infos techniques (données réelles ; placeholders pour l'absent).
  $: chip = t?.channels?.voices[0]?.chip ?? '—';
  $: sampleRate = t?.channels?.sampleRate;
  $: frameRate = t?.loop?.frameRate ?? 0;
  $: loopFrames =
    t?.loop && frameRate
      ? {
          start: Math.round(t.loop.loopStart * frameRate),
          end: Math.round(t.loop.loopEnd * frameRate),
          len: Math.round((t.loop.loopEnd - t.loop.loopStart) * frameRate),
        }
      : null;
</script>

<aside class="now">
  {#if !t}
    <div class="empty">
      <Icon name="music" size={40} />
      <p>Aucune lecture en cours</p>
      <span>Choisis une piste pour commencer.</span>
    </div>
  {:else}
    <header class="np-head">
      <span class="kicker">Lecture en cours</span>
      <span class="viz"><i></i><i></i><i></i><i></i><i></i></span>
    </header>

    <div class="track-head">
      <div class="cover" style="background:{coverGradient(t.game)}">
        <span>{initials(t.game)}</span>
      </div>
      <div class="info">
        <div class="title" title={t.title}>{t.title}</div>
        <div class="game" title={t.game}>{t.game}</div>
        {#if t.composer}<div class="composer">{t.composer}</div>{/if}
      </div>
      <button
        class="fav"
        class:on={$favorites.has(t.id)}
        aria-pressed={$favorites.has(t.id)}
        on:click={() => toggleFavorite(t.id)}
        title={$favorites.has(t.id) ? 'Retirer des favoris' : 'Ajouter aux favoris'}
      >
        <Icon name={$favorites.has(t.id) ? 'heart-filled' : 'heart'} size={18} />
      </button>
    </div>

    <!-- Progression -->
    <div class="seek">
      <button
        type="button"
        class="bar"
        class:seekable={$progress?.arrangementDur != null}
        role="slider"
        on:click={onSeekClick}
        on:keydown={onSeekKey}
        aria-label="Position de lecture"
        aria-valuemin="0"
        aria-valuemax="100"
        aria-valuenow={Math.round(frac * 100)}
      >
        <div class="fill" style="width:{frac * 100}%"></div>
        <div class="knob" style="left:{frac * 100}%"></div>
      </button>
      <div class="times">
        <span>{fmt($progress?.elapsed ?? 0)}</span>
        {#if loopBadge}<span class="loopbadge" class:active={$progress?.phase === 'loop'}>{loopBadge}</span>{/if}
        <span>{totalLabel}</span>
      </div>
    </div>

    <!-- Transport -->
    <div class="transport">
      <button class="t-btn" class:on={$shuffle} aria-pressed={$shuffle} on:click={toggleShuffle} title="Lecture aléatoire" aria-label="Lecture aléatoire"><Icon name="shuffle" size={18} /></button>
      <button class="t-btn" on:click={() => prev()} title="Précédent" aria-label="Piste précédente"><Icon name="skip-back" size={20} /></button>
      <button class="play" on:click={() => togglePlay()} title={playing ? 'Pause' : 'Lecture'} aria-label={playing ? 'Pause' : 'Lecture'}>
        <Icon name={playing ? 'pause' : 'play'} size={22} />
      </button>
      <button class="t-btn" on:click={() => next()} title="Suivant" aria-label="Piste suivante"><Icon name="skip-forward" size={20} /></button>
      <button class="t-btn" class:on={$repeat !== 'off'} on:click={cycleRepeat} title={`Répéter : ${$repeat}`} aria-label={`Répéter : ${$repeat}`}>
        <Icon name={$repeat === 'one' ? 'repeat-1' : 'repeat'} size={18} />
      </button>
    </div>

    <!-- Modes de lecture -->
    <div class="modes" class:disabled={!hasLoop}>
      {#each MODES as m}
        <button
          class="mode-chip"
          class:active={$mode === m.value}
          disabled={!hasLoop && m.value !== 'once'}
          on:click={() => setMode(m.value)}
        >
          <Icon name={m.icon} size={14} />
          {m.label === 'N boucles' ? `${$loopCount} boucles` : m.label === 'N + fondu' ? `${$loopCount} + fondu` : m.label}
        </button>
      {/each}
    </div>
    {#if isCount && hasLoop}
      <div class="count-ctl">
        <span>Boucles</span>
        <button on:click={() => setLoopCount($loopCount - 1)} disabled={$loopCount <= 1} aria-label="Diminuer le nombre de boucles">−</button>
        <b aria-live="polite">{$loopCount}</b>
        <button on:click={() => setLoopCount($loopCount + 1)} disabled={$loopCount >= 20} aria-label="Augmenter le nombre de boucles">+</button>
        {#if $mode === 'loopCountFade'}
          <span class="fade-l">Fondu</span>
          <button on:click={() => setFade($fadeSeconds - 1)} disabled={$fadeSeconds <= 0.5} aria-label="Diminuer le fondu">−</button>
          <b aria-live="polite">{$fadeSeconds}s</b>
          <button on:click={() => setFade($fadeSeconds + 1)} disabled={$fadeSeconds >= 30} aria-label="Augmenter le fondu">+</button>
        {/if}
      </div>
    {/if}

    <!-- Onglets -->
    <nav class="tabs">
      <button class:active={tab === 'analyse'} on:click={() => (tab = 'analyse')}>Analyse</button>
      <button class:active={tab === 'meta'} on:click={() => (tab = 'meta')}>Métadonnées</button>
    </nav>

    <div class="tab-body">
      {#if tab === 'analyse'}
        <section class="block">
          <h4>Structure</h4>
          <StructureBar />
        </section>

        {#if t.channels}
          <section class="block">
            <h4>Canaux <span class="muted">({chip} · {t.channels.voices.length} voix)</span></h4>
            <ChannelMixer />
          </section>
        {/if}

        <section class="block">
          <h4>Information technique</h4>
          <dl class="tech">
            <dt>Plateforme</dt><dd>{t.platform ?? '—'}</dd>
            <dt>Puce</dt><dd>{chip}</dd>
            <dt>Échantillonnage</dt><dd>{sampleRate ? `${sampleRate} Hz` : '—'}</dd>
            <dt>Voix</dt><dd>{t.channels?.voices.length ?? '—'}</dd>
            {#if frameRate}<dt>Frame-rate</dt><dd>{frameRate} Hz</dd>{/if}
            <dt>Durée</dt><dd>{fmt(t.duration)}</dd>
            <dt>CRC32</dt><dd class="faint">—</dd>
          </dl>
        </section>
      {:else if tab === 'meta'}
        <section class="block">
          <h4>Diagnostic moteur</h4>
          {#if $progress}
            <dl class="tech">
              <dt>Position (jouée)</dt><dd>{fmtMs($progress.elapsed)}</dd>
              <dt>Position (source)</dt><dd>{fmtMs($progress.sourceTime)}</dd>
              {#if frameRate}<dt>Frame moteur</dt><dd>{Math.round($progress.sourceTime * frameRate)}</dd>{/if}
              {#if loopFrames}<dt>Boucle (frames)</dt><dd>[{loopFrames.start}–{loopFrames.end}] · {loopFrames.len} f</dd>{/if}
            </dl>
          {:else}
            <p class="muted">Lance la lecture pour voir le diagnostic moteur.</p>
          {/if}
        </section>
        <section class="block">
          <h4>Source</h4>
          <dl class="tech">
            <dt>Identifiant</dt><dd class="mono">{t.id}</dd>
            <dt>Jeu</dt><dd>{t.game}</dd>
            <dt>Compositeur</dt><dd>{t.composer ?? '—'}</dd>
          </dl>
        </section>
      {/if}
    </div>
  {/if}
</aside>

<style>
  .now {
    background: var(--bg-panel);
    border-left: 1px solid var(--border-soft);
    display: flex;
    flex-direction: column;
    overflow-y: auto;
    padding: 18px;
    gap: 14px;
  }

  .empty {
    margin: auto;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    color: var(--text-faint);
    text-align: center;
  }
  .empty p { margin: 4px 0 0; color: var(--text-dim); font-weight: 600; }
  .empty span { font-size: 12px; }

  .np-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .kicker {
    font-size: 11px;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--text-dim);
    font-weight: 700;
  }
  .viz {
    display: inline-flex;
    align-items: flex-end;
    gap: 2px;
    height: 14px;
  }
  .viz i {
    width: 2.5px;
    background: var(--accent-strong);
    border-radius: 1px;
    animation: viz 1s ease-in-out infinite;
  }
  .viz i:nth-child(1){height:30%;animation-delay:-0.1s}
  .viz i:nth-child(2){height:70%;animation-delay:-0.4s}
  .viz i:nth-child(3){height:45%;animation-delay:-0.2s}
  .viz i:nth-child(4){height:90%;animation-delay:-0.5s}
  .viz i:nth-child(5){height:55%;animation-delay:-0.3s}
  @keyframes viz { 0%,100%{transform:scaleY(0.3)} 50%{transform:scaleY(1)} }

  .track-head {
    display: grid;
    grid-template-columns: 72px minmax(0, 1fr) auto;
    gap: 12px;
    align-items: center;
  }
  .cover {
    width: 72px;
    height: 72px;
    border-radius: var(--r-md);
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: var(--shadow-sm);
  }
  .cover span {
    font-weight: 800;
    font-size: 22px;
    color: rgba(255, 255, 255, 0.92);
    letter-spacing: 0.02em;
    text-shadow: 0 1px 4px rgba(0,0,0,0.4);
  }
  .info { min-width: 0; }
  .title {
    font-size: 16px;
    font-weight: 700;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .game {
    font-size: 13px;
    color: var(--text-dim);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .composer { font-size: 12px; color: var(--text-faint); }
  .fav {
    color: var(--text-faint);
    padding: 6px;
    align-self: flex-start;
  }
  .fav:hover { color: var(--text); }
  .fav.on { color: var(--pink); }

  .seek { display: flex; flex-direction: column; gap: 6px; }
  .bar {
    position: relative;
    display: block;
    width: 100%;
    height: 6px;
    padding: 0;
    border-radius: var(--r-pill);
    background: var(--surface-2);
  }
  .bar.seekable { cursor: pointer; }
  .fill {
    position: absolute;
    left: 0; top: 0; bottom: 0;
    border-radius: var(--r-pill);
    background: var(--accent-grad);
  }
  .knob {
    position: absolute;
    top: 50%;
    width: 11px; height: 11px;
    margin: -5.5px 0 0 -5.5px;
    border-radius: 50%;
    background: #fff;
    box-shadow: 0 1px 4px rgba(0,0,0,0.5);
    opacity: 0;
    transition: opacity 0.12s;
  }
  .bar.seekable:hover .knob { opacity: 1; }
  .times {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 11.5px;
    color: var(--text-faint);
    font-variant-numeric: tabular-nums;
  }
  .loopbadge {
    color: var(--text-dim);
    font-weight: 600;
  }
  .loopbadge.active { color: var(--good); }

  .transport {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
  }
  .t-btn {
    color: var(--text-dim);
    padding: 6px;
    border-radius: var(--r-pill);
  }
  .t-btn:hover { color: var(--text); }
  .t-btn.on { color: var(--accent-strong); }
  .play {
    width: 48px; height: 48px;
    border-radius: 50%;
    background: var(--accent-grad);
    color: #fff;
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 6px 18px rgba(124,92,255,0.45);
  }
  .play:hover { filter: brightness(1.08); transform: scale(1.04); }

  .modes {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 6px;
  }
  .mode-chip {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 7px 8px;
    font-size: 12px;
    font-weight: 600;
    color: var(--text-dim);
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--r-md);
  }
  .mode-chip:hover:not(:disabled) { color: var(--text); border-color: var(--border-strong); }
  .mode-chip.active {
    color: #fff;
    background: var(--accent-soft);
    border-color: var(--accent-line);
    color: var(--accent-strong);
  }
  .mode-chip:disabled { opacity: 0.4; cursor: default; }

  .count-ctl {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 12px;
    color: var(--text-dim);
  }
  .count-ctl button {
    width: 22px; height: 22px;
    border-radius: var(--r-sm);
    background: var(--surface);
    border: 1px solid var(--border);
    color: var(--text);
    font-weight: 700;
  }
  .count-ctl button:hover:not(:disabled) { border-color: var(--border-strong); }
  .count-ctl button:disabled { opacity: 0.4; cursor: default; }
  .count-ctl b { color: var(--text); font-variant-numeric: tabular-nums; min-width: 24px; text-align: center; }
  .count-ctl .fade-l { margin-left: 8px; }

  .tabs {
    display: flex;
    gap: 18px;
    border-bottom: 1px solid var(--border-soft);
    margin-top: 2px;
  }
  .tabs button {
    padding: 8px 0;
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--text-faint);
    border-bottom: 2px solid transparent;
    margin-bottom: -1px;
  }
  .tabs button:hover { color: var(--text-dim); }
  .tabs button.active {
    color: var(--accent-strong);
    border-bottom-color: var(--accent-strong);
  }

  .tab-body {
    display: flex;
    flex-direction: column;
    gap: 18px;
  }
  .block { display: flex; flex-direction: column; gap: 10px; }
  .block h4 {
    margin: 0;
    font-size: 11px;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--text-dim);
    font-weight: 700;
  }
  .block h4 .muted { color: var(--text-faint); font-weight: 600; letter-spacing: 0; text-transform: none; }

  .tech {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 6px 14px;
    margin: 0;
    font-size: 12.5px;
  }
  .tech dt { color: var(--text-faint); }
  .tech dd { margin: 0; color: var(--text); text-align: right; font-variant-numeric: tabular-nums; }
  .tech dd.faint { color: var(--text-faint); }
  .tech dd.mono { font-family: var(--mono); font-size: 11.5px; }

  .muted { color: var(--text-faint); font-style: italic; font-size: 13px; }
</style>
