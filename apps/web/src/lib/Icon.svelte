<script lang="ts" context="module">
  /**
   * Icônes SVG inline (style « stroke », viewBox 24×24). Couleur = `currentColor`.
   * Ajouter une icône = une entrée `name -> contenu <path/.../>` dans PATHS.
   * Les icônes « fill » (lecture/pause) portent leur propre fill plein.
   */
  export type IconName =
    | 'home' | 'library' | 'compass' | 'sliders' | 'gamepad' | 'users'
    | 'heart' | 'heart-filled' | 'clock' | 'search'
    | 'play' | 'pause' | 'skip-back' | 'skip-forward' | 'shuffle'
    | 'repeat' | 'repeat-1' | 'infinity'
    | 'volume' | 'volume-low' | 'volume-mute' | 'queue' | 'more' | 'settings'
    | 'download' | 'chevron-right' | 'chevron-down' | 'music' | 'plus' | 'check';

  const STROKE = new Set<IconName>([
    'home','library','compass','sliders','gamepad','users','heart','clock','search',
    'skip-back','skip-forward','shuffle','repeat','repeat-1','infinity','volume',
    'volume-low','volume-mute','queue','more','settings','download','chevron-right',
    'chevron-down','music','plus','check',
  ]);

  const PATHS: Record<IconName, string> = {
    home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/>',
    library: '<rect x="3" y="4" width="5" height="16" rx="1"/><rect x="10" y="4" width="5" height="16" rx="1"/><path d="m17.5 5 3.2 14.6"/>',
    compass: '<circle cx="12" cy="12" r="9"/><path d="m15.5 8.5-2 5-5 2 2-5z"/>',
    sliders: '<line x1="4" y1="7" x2="20" y2="7"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="17" x2="20" y2="17"/><circle cx="9" cy="7" r="2" fill="var(--bg-panel,#14121c)"/><circle cx="15" cy="12" r="2" fill="var(--bg-panel,#14121c)"/><circle cx="8" cy="17" r="2" fill="var(--bg-panel,#14121c)"/>',
    gamepad: '<path d="M7 9h10a4 4 0 0 1 4 4v1a3 3 0 0 1-5.2 2L14 15h-4l-1.8 1A3 3 0 0 1 3 14v-1a4 4 0 0 1 4-4Z"/><line x1="7.5" y1="12" x2="9.5" y2="12"/><line x1="8.5" y1="11" x2="8.5" y2="13"/><circle cx="15.5" cy="11.5" r=".6" fill="currentColor"/><circle cx="17" cy="13" r=".6" fill="currentColor"/>',
    users: '<circle cx="9" cy="8" r="3"/><path d="M3.5 20a5.5 5.5 0 0 1 11 0"/><path d="M16 5.5a3 3 0 0 1 0 5.5"/><path d="M17.5 14.2A5.5 5.5 0 0 1 21 20"/>',
    heart: '<path d="M12 20s-7-4.4-9.2-8.4A4.6 4.6 0 0 1 12 6a4.6 4.6 0 0 1 9.2 5.6C19 15.6 12 20 12 20Z"/>',
    'heart-filled': '<path d="M12 20s-7-4.4-9.2-8.4A4.6 4.6 0 0 1 12 6a4.6 4.6 0 0 1 9.2 5.6C19 15.6 12 20 12 20Z" fill="currentColor" stroke="currentColor"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>',
    search: '<circle cx="11" cy="11" r="7"/><line x1="16.5" y1="16.5" x2="21" y2="21"/>',
    play: '<path d="M7 4.5v15l13-7.5z" fill="currentColor" stroke="none"/>',
    pause: '<rect x="6" y="4.5" width="4" height="15" rx="1" fill="currentColor" stroke="none"/><rect x="14" y="4.5" width="4" height="15" rx="1" fill="currentColor" stroke="none"/>',
    'skip-back': '<path d="M18 5v14l-10-7z" fill="currentColor" stroke="none"/><rect x="5" y="5" width="2.4" height="14" rx="1" fill="currentColor" stroke="none"/>',
    'skip-forward': '<path d="M6 5v14l10-7z" fill="currentColor" stroke="none"/><rect x="16.6" y="5" width="2.4" height="14" rx="1" fill="currentColor" stroke="none"/>',
    shuffle: '<path d="M3 7h3.5l11 10H21"/><path d="m17.5 3.5 3.5 3.5-3.5 3.5"/><path d="M3 17h3.5l3-2.7"/><path d="m14.5 9.7 3-2.7"/><path d="m17.5 13.5 3.5 3.5-3.5 3.5"/>',
    repeat: '<path d="M17 2.5 21 6l-4 3.5"/><path d="M3 11V9a3 3 0 0 1 3-3h15"/><path d="M7 21.5 3 18l4-3.5"/><path d="M21 13v2a3 3 0 0 1-3 3H3"/>',
    'repeat-1': '<path d="M17 2.5 21 6l-4 3.5"/><path d="M3 11V9a3 3 0 0 1 3-3h15"/><path d="M7 21.5 3 18l4-3.5"/><path d="M21 13v2a3 3 0 0 1-3 3H3"/><path d="M12.5 13.5v-3l-1.2.8" stroke-width="1.6"/>',
    infinity: '<path d="M7 9a3 3 0 1 0 0 6c2 0 3.2-2 5-3 1.8-1 3-3 5-3a3 3 0 1 1 0 6c-2 0-3.2-2-5-3-1.8-1-3-3-5-3Z"/>',
    volume: '<path d="M4 9.5h3l4-3v11l-4-3H4z" fill="currentColor" stroke="currentColor"/><path d="M16 8.5a4 4 0 0 1 0 7" fill="none"/><path d="M18.5 6.5a7 7 0 0 1 0 11" fill="none"/>',
    'volume-low': '<path d="M4 9.5h3l4-3v11l-4-3H4z" fill="currentColor" stroke="currentColor"/><path d="M16 9.5a3.5 3.5 0 0 1 0 5" fill="none"/>',
    'volume-mute': '<path d="M4 9.5h3l4-3v11l-4-3H4z" fill="currentColor" stroke="currentColor"/><line x1="16" y1="9" x2="21" y2="15"/><line x1="21" y1="9" x2="16" y2="15"/>',
    queue: '<line x1="4" y1="7" x2="15" y2="7"/><line x1="4" y1="12" x2="15" y2="12"/><line x1="4" y1="17" x2="11" y2="17"/><path d="M16 17V9l4 1.5" /><circle cx="16" cy="17.5" r="1.8"/>',
    more: '<circle cx="5" cy="12" r="1.6" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.6" fill="currentColor" stroke="none"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M12 2.5v2.5M12 19v2.5M21.5 12H19M5 12H2.5M18.5 5.5 16.8 7.2M7.2 16.8 5.5 18.5M18.5 18.5 16.8 16.8M7.2 7.2 5.5 5.5"/>',
    download: '<path d="M12 3v11"/><path d="m7.5 10 4.5 4.5L16.5 10"/><path d="M4 19.5h16"/>',
    'chevron-right': '<path d="m9 5 7 7-7 7"/>',
    'chevron-down': '<path d="m5 9 7 7 7-7"/>',
    music: '<circle cx="7" cy="18" r="2.5"/><circle cx="17" cy="16" r="2.5"/><path d="M9.5 18V6l10-2v10"/>',
    plus: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
    check: '<path d="m5 12.5 4.5 4.5L19 7"/>',
  };

  export const ICON_NAMES = Object.keys(PATHS) as IconName[];
  export const ICON_PATHS = PATHS;
  export const ICON_STROKE = STROKE;
</script>

<script lang="ts">
  export let name: IconName;
  export let size: number | string = 20;
  export let strokeWidth = 1.9;
  $: stroke = ICON_STROKE.has(name);
</script>

<svg
  width={size}
  height={size}
  viewBox="0 0 24 24"
  fill="none"
  stroke={stroke ? 'currentColor' : 'none'}
  stroke-width={strokeWidth}
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"
  class="icon"
>
  {@html ICON_PATHS[name]}
</svg>

<style>
  .icon {
    display: block;
    flex: none;
  }
</style>
