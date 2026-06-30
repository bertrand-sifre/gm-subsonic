<script lang="ts">
  /**
   * Frise de structure d'un morceau : intro / boucle / fin, avec tête de lecture
   * positionnée sur le matériau source (progress.sourceTime). Décrit la matière,
   * pas l'arrangement déroulé (la boucle est jouée plusieurs fois).
   */
  import { current, progress } from './player';
  import { fmt } from './format';

  interface Seg {
    label: string;
    cls: 'intro' | 'loop' | 'fade';
    dur: number;
    from: number;
    to: number;
  }

  $: track = $current;
  $: total = track?.duration || 1;

  // NB : on passe `track` en argument pour que Svelte voie la dépendance
  // ($current) — un `buildSegs()` sans argument ne serait jamais recalculé.
  $: segs = buildSegs(track);
  function buildSegs(t: typeof track): Seg[] {
    if (!t) return [];
    if (t.loop) {
      const out: Seg[] = [];
      if (t.loop.loopStart > 0.05)
        out.push({ label: 'Intro', cls: 'intro', dur: t.loop.loopStart, from: 0, to: t.loop.loopStart });
      out.push({ label: 'Boucle', cls: 'loop', dur: t.loop.loopEnd - t.loop.loopStart, from: t.loop.loopStart, to: t.loop.loopEnd });
      const tail = t.duration - t.loop.loopEnd;
      if (tail > 0.05) out.push({ label: 'Fin', cls: 'fade', dur: tail, from: t.loop.loopEnd, to: t.duration });
      return out;
    }
    return [{ label: 'Lecture', cls: 'loop', dur: t.duration, from: 0, to: t.duration }];
  }

  // Tête de lecture : position sur le matériau (sourceTime), en % de la largeur.
  $: headPct = $progress ? Math.min(100, Math.max(0, ($progress.sourceTime / total) * 100)) : null;
  $: width = (s: Seg) => (s.dur / total) * 100;
</script>

{#if track}
  <div class="structure">
    <div class="labels">
      {#each segs as s}
        <span class="lab {s.cls}" style="width:{width(s)}%">{width(s) >= 12 ? s.label : ''}</span>
      {/each}
    </div>

    <div class="bar">
      {#each segs as s}
        <span class="seg {s.cls}" style="width:{width(s)}%"></span>
      {/each}
      {#if headPct != null}
        <span class="head" style="left:{headPct}%"></span>
      {/if}
    </div>

    <div class="axis">
      {#each segs as s}
        <span class="tick" style="width:{width(s)}%">
          <span class="t-from">{fmt(s.from)}</span>
          {#if s === segs[segs.length - 1]}<span class="t-to">{fmt(s.to)}</span>{/if}
        </span>
      {/each}
    </div>
  </div>
{/if}

<style>
  .structure {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .labels {
    display: flex;
  }
  .lab {
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.03em;
    text-align: center;
    white-space: nowrap;
    overflow: hidden;
  }
  .lab.intro { color: var(--accent-strong); }
  .lab.loop { color: var(--good); }
  .lab.fade { color: var(--warn); }

  .bar {
    position: relative;
    display: flex;
    height: 8px;
    border-radius: var(--r-pill);
    overflow: hidden;
    background: var(--surface);
  }
  .seg {
    height: 100%;
  }
  .seg.intro { background: linear-gradient(90deg, var(--accent), var(--accent-strong)); }
  .seg.loop { background: linear-gradient(90deg, #27b793, var(--good)); }
  .seg.fade { background: linear-gradient(90deg, var(--warn), #ffb877); }

  .head {
    position: absolute;
    top: -3px;
    bottom: -3px;
    width: 3px;
    margin-left: -1.5px;
    background: #fff;
    border-radius: var(--r-pill);
    box-shadow: 0 0 8px rgba(255, 255, 255, 0.7);
  }

  .axis {
    display: flex;
    position: relative;
  }
  .tick {
    position: relative;
    font-size: 10px;
    color: var(--text-faint);
    font-variant-numeric: tabular-nums;
  }
  .t-from {
    position: absolute;
    left: 0;
    transform: translateX(-50%);
  }
  .tick:first-child .t-from {
    transform: none;
  }
  .t-to {
    position: absolute;
    right: 0;
  }
</style>
