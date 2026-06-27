/**
 * Slug d'identifiant à partir d'un nom de fichier. ATTENTION : retire l'extension
 * → l'id de `gerudo-valley.ogg` est `gerudo-valley` (piège connu, cf. CLAUDE.md).
 */
export function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/\.[^.]+$/, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}
