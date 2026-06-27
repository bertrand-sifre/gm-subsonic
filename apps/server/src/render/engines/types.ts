/**
 * Interface d'un MOTEUR PCM : sait rendre une portion d'une sous-piste émulée en
 * WAV 44.1 kHz. C'est le point d'extension du rendu sans couture : aujourd'hui
 * deux implémentations — libgme (le mix complet, cf. `libgme.ts`) et nsftool
 * (une voix isolée, cf. `nsftool.ts`). Demain, un moteur USF/lazyusf2, un moteur
 * SPC… s'ajoutent ici sans toucher au reste.
 */

export interface PcmRequest {
  /** Source émulée (NSF/NSFe/SPC…). */
  sourcePath: string;
  /** Sous-piste, 0-based. */
  trackIndex: number;
  /** Borne de fin du rendu, en échantillons à 44.1 kHz. */
  endSample: number;
  /** Si présent : ne rendre que cette voix (canal APU) plutôt que le mix. */
  channelIndex?: number;
}

export interface PcmEngine {
  /** Écrit `[0, endSample]` de la sous-piste demandée dans `outWav`. */
  renderWav(outWav: string, req: PcmRequest): Promise<void>;
}
