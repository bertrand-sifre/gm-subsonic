/**
 * Placeholders visuels déterministes pour les métadonnées absentes du backend
 * (le backend ne fournit pas de jaquette). Une chaîne -> une couleur stable et
 * des initiales : deux jeux différents ont des jaquettes distinctes mais
 * reproductibles d'une session à l'autre.
 */

/** Hash 32 bits déterministe (FNV-1a) d'une chaîne. */
function hash(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Teinte (0..360) stable dérivée d'une chaîne. */
export function hueOf(str: string): number {
  return hash(str) % 360;
}

/** Dégradé CSS stable pour une jaquette placeholder. */
export function coverGradient(str: string): string {
  const h = hueOf(str);
  const h2 = (h + 40) % 360;
  return `linear-gradient(135deg, hsl(${h} 55% 42%), hsl(${h2} 60% 24%))`;
}

/** Initiales d'un titre de jeu (1 à 3 lettres, mots significatifs). */
export function initials(name: string): string {
  const words = name
    .replace(/[:\-_]/g, ' ')
    .split(/\s+/)
    .filter((w) => w && !/^(the|of|a|and|le|la|les|de|du|des)$/i.test(w));
  const src = words.length ? words : name.split(/\s+/);
  return src
    .slice(0, 3)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
}

/**
 * Couleur d'une voix d'après son type de canal APU (repère visuel cohérent
 * entre le mixer, les ondes et la barre de structure).
 */
export const KIND_COLOR: Record<string, string> = {
  pulse: '#7c8cff',
  square: '#7c8cff',
  triangle: '#2ec5a0',
  noise: '#c77dff',
  dmc: '#ff9f43',
  pcm: '#ff9f43',
  saw: '#ff6b9d',
  wave: '#4dd0e1',
  fm: '#ffd166',
};

/** Couleur d'une voix (id de voix + kind optionnel). `__main__` = accent. */
export function voiceColor(kind: string | undefined, id?: string): string {
  if (id === '__main__') return '#8b7cf0';
  return (kind && KIND_COLOR[kind]) || '#8b7cf0';
}
