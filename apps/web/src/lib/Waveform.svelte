<script lang="ts">
  /**
   * Forme d'onde-scrubber (style SoundCloud) : barres tracées depuis les VRAIS
   * peaks du matériau décodé (LoopPlayer.getPeaks), portion jouée surlignée,
   * clic pour sauter. Les peaks sont calculés une fois par piste (résolution
   * fixe) puis ré-échantillonnés à la largeur du canvas — pas de recalcul O(n)
   * par frame.
   */
  import { current, progress, frame, status, player, seek } from './player';
  import type { Progress } from './LoopPlayer';

  export let height = 40;

  const RES = 1024; // résolution de cache des peaks
  let peaks: Float32Array | null = null;
  let peaksFor = '';
  let canvas: HTMLCanvasElement;

  // Fraction jouée (arrangement fini -> elapsed/total ; infini -> cycle source).
  $: frac = computeFrac($progress);
  function computeFrac(p: Progress | null): number {
    if (!p) return 0;
    if (p.arrangementDur && p.arrangementDur > 0) return Math.min(1, p.elapsed / p.arrangementDur);
    const cyc = p.introDur + p.loopDur;
    return cyc > 0 ? Math.min(1, p.sourceTime / cyc) : 0;
  }

  // Redessine à chaque frame ; (re)calcule les peaks quand la piste change.
  $: if ($frame >= 0 || $status) draw();

  function ensurePeaks(): void {
    const id = $current?.id ?? '';
    // IMPORTANT : pendant 'loading', `current` pointe déjà la NOUVELLE piste mais
    // le LoopPlayer détient encore les buffers de l'ANCIENNE (setTrack ne les
    // remplace qu'après décodage). Calculer ici figerait les peaks de l'ancienne
    // piste sous le nouvel id. On attend donc que la piste soit réellement chargée.
    if (id && peaksFor !== id && $status !== 'loading') {
      const p = player.getPeaks(RES);
      if (p) {
        peaks = p;
        peaksFor = id;
      }
    }
    if (!id) {
      peaks = null;
      peaksFor = '';
    }
  }

  function draw(): void {
    if (!canvas) return;
    ensurePeaks();
    const g = canvas.getContext('2d');
    if (!g) return;
    const dpr = window.devicePixelRatio || 1;
    const cssW = canvas.clientWidth || 1;
    const cssH = canvas.clientHeight || 1;
    if (canvas.width !== Math.round(cssW * dpr) || canvas.height !== Math.round(cssH * dpr)) {
      canvas.width = Math.round(cssW * dpr);
      canvas.height = Math.round(cssH * dpr);
    }
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, cssW, cssH);

    const barW = 3;
    const gap = 2;
    const n = Math.max(1, Math.floor((cssW + gap) / (barW + gap)));
    const mid = cssH / 2;
    const playedX = frac * cssW;

    for (let i = 0; i < n; i++) {
      // Échantillon de peak (max sur la tranche correspondante du cache).
      let amp = 0.05;
      if (peaks) {
        const a = Math.floor((i / n) * peaks.length);
        const b = Math.max(a + 1, Math.floor(((i + 1) / n) * peaks.length));
        let m = 0;
        for (let k = a; k < b && k < peaks.length; k++) if (peaks[k] > m) m = peaks[k];
        amp = m;
      } else {
        // Pas encore de peaks : barres pseudo-statiques discrètes.
        amp = 0.25 + 0.2 * Math.abs(Math.sin(i * 0.7));
      }
      const x = i * (barW + gap);
      const h = Math.max(2, amp * (cssH - 4));
      const played = x + barW <= playedX;
      g.fillStyle = played ? 'rgba(124,92,255,0.95)' : 'rgba(150,144,180,0.32)';
      g.fillRect(x, mid - h / 2, barW, h);
    }
  }

  function seekToFraction(f: number): void {
    const p = $progress;
    if (!p) return;
    f = Math.max(0, Math.min(1, f));
    if (p.arrangementDur != null) {
      void seek(f * p.arrangementDur);
    } else {
      // Boucle infinie : saute dans le premier cycle (la boucle se poursuit).
      const cyc = p.introDur + p.loopDur;
      void seek(Math.min(f * cyc, cyc - 0.05));
    }
  }

  function onClick(e: MouseEvent): void {
    const r = canvas.getBoundingClientRect();
    seekToFraction((e.clientX - r.left) / r.width);
  }

  function onKey(e: KeyboardEvent): void {
    if (!$progress) return;
    if (e.key === 'ArrowRight') seekToFraction(frac + 0.03);
    else if (e.key === 'ArrowLeft') seekToFraction(frac - 0.03);
    else return;
    e.preventDefault();
  }
</script>

<canvas
  bind:this={canvas}
  class="wave"
  style="height:{height}px"
  role="slider"
  tabindex="0"
  aria-label="Forme d'onde — position de lecture"
  aria-valuenow={Math.round(frac * 100)}
  aria-valuemin="0"
  aria-valuemax="100"
  on:click={onClick}
  on:keydown={onKey}
></canvas>

<style>
  .wave {
    display: block;
    width: 100%;
    cursor: pointer;
  }
</style>
