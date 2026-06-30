<script lang="ts">
  /**
   * Mixer de stems : une ligne par voix (canal APU) avec oscilloscope live,
   * volume, Solo et Mute. Les ondes sont redessinées à chaque frame d'animation
   * (compteur `frame` du store) à partir des `AnalyserNode` du lecteur.
   */
  import { current, channelStates, soloActive, frame, status, player, setChannelVolume, toggleMute, toggleSolo, type ChannelState } from './player';
  import { voiceColor } from './cover';

  $: voices = $current?.channels?.voices ?? [];

  let canvases: Record<string, HTMLCanvasElement> = {};
  const buf = new Uint8Array(1024);

  // Redessine toutes les ondes à chaque frame (dépend de $frame).
  $: if ($frame >= 0 && $status === 'playing') redraw();
  $: if ($status !== 'playing') redraw(); // fige l'état (efface si arrêté)

  function redraw(): void {
    const analysers = player.getAnalysers();
    for (const v of voices) {
      const canvas = canvases[v.id];
      if (!canvas) continue;
      const an = analysers.get(v.id);
      drawScope(canvas, an, v.id, v.kind);
    }
  }

  // NB : on passe les stores en ARGUMENTS pour que Svelte trace la dépendance
  // dans le template (`class:off`) — un `effectiveOn(id)` qui lirait les stores
  // en interne ne serait pas réévalué au clic Mute/Solo (piège réactivité Svelte 4).
  function effectiveOn(
    id: string,
    states: Record<string, ChannelState>,
    solo: boolean
  ): boolean {
    const s = states[id];
    if (!s || s.muted) return false;
    if (solo && !s.solo) return false;
    return true;
  }

  function drawScope(canvas: HTMLCanvasElement, an: AnalyserNode | undefined, id: string, kind?: string): void {
    const g = canvas.getContext('2d');
    if (!g) return;
    const dpr = window.devicePixelRatio || 1;
    const cssW = canvas.clientWidth || 1;
    const cssH = canvas.clientHeight || 1;
    if (canvas.width !== Math.round(cssW * dpr)) {
      canvas.width = Math.round(cssW * dpr);
      canvas.height = Math.round(cssH * dpr);
    }
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, cssW, cssH);

    const on = effectiveOn(id, $channelStates, $soloActive);
    // Ligne médiane.
    g.strokeStyle = 'rgba(255,255,255,0.05)';
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(0, cssH / 2);
    g.lineTo(cssW, cssH / 2);
    g.stroke();

    if (!an) return;
    an.getByteTimeDomainData(buf);
    g.strokeStyle = on ? voiceColor(kind, id) : 'rgba(140,135,170,0.35)';
    g.lineWidth = 1.5;
    g.globalAlpha = on ? 1 : 0.5;
    g.beginPath();
    const n = buf.length;
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * cssW;
      const y = (buf[i] / 255) * cssH;
      if (i === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.stroke();
    g.globalAlpha = 1;
  }
</script>

{#if voices.length}
  <div class="mixer">
    {#each voices as v, i (v.id)}
      {@const s = $channelStates[v.id]}
      {@const on = effectiveOn(v.id, $channelStates, $soloActive)}
      <div class="ch" class:off={!on}>
        <span class="idx">{i + 1}</span>
        <span class="lab">
          <span class="dot" style="background:{voiceColor(v.kind, v.id)}"></span>
          {v.label}
        </span>

        <span class="scope-wrap">
          <canvas bind:this={canvases[v.id]} class="scope"></canvas>
        </span>

        <span class="vol">
          <input
            type="range" min="0" max="100" step="1"
            value={Math.round((s?.volume ?? 1) * 100)}
            on:input={(e) => setChannelVolume(v.id, +e.currentTarget.value / 100)}
            style="--c:{voiceColor(v.kind, v.id)}"
            aria-label={`Volume ${v.label}`}
          />
          <span class="pct">{Math.round((s?.volume ?? 1) * 100)}%</span>
        </span>

        <button type="button" class="sm s" class:active={s?.solo} aria-pressed={!!s?.solo} on:click={() => toggleSolo(v.id)} aria-label={`Solo ${v.label}`} title="Solo">S</button>
        <button type="button" class="sm m" class:active={s?.muted} aria-pressed={!!s?.muted} on:click={() => toggleMute(v.id)} aria-label={`Mute ${v.label}`} title="Mute">M</button>
      </div>
    {/each}
  </div>
{:else}
  <p class="none">Cette piste n'expose pas de canaux séparés.</p>
{/if}

<style>
  .mixer {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .ch {
    display: grid;
    grid-template-columns: 18px 96px minmax(0, 1fr) 88px 26px 26px;
    align-items: center;
    gap: 8px;
    padding: 5px 6px;
    border-radius: var(--r-sm);
  }
  .ch:hover {
    background: var(--surface);
  }
  .ch.off {
    opacity: 0.55;
  }
  .idx {
    font-size: 12px;
    color: var(--text-faint);
    text-align: center;
    font-variant-numeric: tabular-nums;
  }
  .lab {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12.5px;
    color: var(--text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    flex: none;
  }
  .scope-wrap {
    height: 26px;
    border-radius: var(--r-sm);
    background: var(--bg-app);
    border: 1px solid var(--border-soft);
    overflow: hidden;
  }
  .scope {
    display: block;
    width: 100%;
    height: 100%;
  }

  .vol {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .pct {
    font-size: 11px;
    color: var(--text-dim);
    font-variant-numeric: tabular-nums;
    width: 30px;
    text-align: right;
  }
  input[type='range'] {
    -webkit-appearance: none;
    appearance: none;
    width: 52px;
    height: 4px;
    border-radius: var(--r-pill);
    background: var(--surface-3);
    cursor: pointer;
  }
  input[type='range']::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 11px;
    height: 11px;
    border-radius: 50%;
    background: var(--c, var(--accent));
    border: 2px solid var(--bg-panel);
  }
  input[type='range']::-moz-range-thumb {
    width: 11px;
    height: 11px;
    border: 2px solid var(--bg-panel);
    border-radius: 50%;
    background: var(--c, var(--accent));
  }

  .sm {
    width: 24px;
    height: 24px;
    border-radius: var(--r-sm);
    font-size: 12px;
    font-weight: 700;
    color: var(--text-faint);
    background: var(--surface);
    border: 1px solid var(--border);
  }
  .sm:hover {
    color: var(--text);
  }
  .sm.s.active {
    background: rgba(46, 197, 160, 0.18);
    color: var(--good);
    border-color: rgba(46, 197, 160, 0.5);
  }
  .sm.m.active {
    background: rgba(255, 107, 129, 0.16);
    color: var(--danger);
    border-color: rgba(255, 107, 129, 0.5);
  }
  .none {
    color: var(--text-faint);
    font-style: italic;
    font-size: 13px;
  }
</style>
