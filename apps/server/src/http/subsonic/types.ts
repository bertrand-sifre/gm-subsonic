import type { Context } from 'hono';
import type { ScanResult } from '../../library/types.js';
import type { SubCatalog } from './catalog.js';

/** Dépendances injectées à chaque handler de verbe (construites une fois au mount). */
export interface VerbDeps {
  scan: ScanResult;
  catalog: SubCatalog;
}

/**
 * Un verbe Subsonic DÉCLARÉ : ses paramètres de query requis (vérifiés par le
 * dispatcher avant l'appel) + son handler. Remplace l'ancien `switch` par une
 * donnée que le registre agrège.
 */
export interface Verb {
  /** Query params obligatoires ; un absent -> erreur 10 avant le handler. */
  requires?: string[];
  handle: (c: Context, deps: VerbDeps) => Response | Promise<Response>;
}

/** Table verbe -> déclaration (un fichier de `verbs/` exporte la table de sa ressource). */
export type VerbMap = Record<string, Verb>;
