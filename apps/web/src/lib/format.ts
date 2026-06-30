/** Formatage du temps et helpers d'affichage partagés par les composants. */

/** m:ss (ex. 1:25). Négatif/NaN -> 0:00. */
export function fmt(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  // Arrondi qui pousse à 60 -> reporter la minute.
  if (s === 60) return `${m + 1}:00`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** m:ss.mmm — temps précis pour les repères de diagnostic. */
export function fmtMs(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 1000);
  return `${m}:${String(s).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
}

/** Numéro de piste sur 2 chiffres (ex. 1 -> "01"). */
export function pad2(n: number): string {
  return String(n).padStart(2, '0');
}
