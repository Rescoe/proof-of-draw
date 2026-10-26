// lib/derivation.ts — « Remix » : une œuvre dérivée d'un bloc MINÉ (champ optionnel `derivedFromBlockHash`). Règles PURES, testées.
//
// Principes (décision du porteur, 26/10/2026) :
//   • le bloc source n'est JAMAIS modifié ; la filiation vit dans le NOUVEAU bloc, qui reste dans la chaîne canonique (parentHash = tête courante) ;
//   • `derivedFromBlockHash` entre dans le hash canonique du nouveau bloc quand il est présent (clé ABSENTE sinon : les blocs historiques gardent leur hash) ;
//   • le hash du bloc source engage déjà ses propres données : on ne recopie rien, aucune clé Redis de provenance.
// Limite assumée : la filiation est déclarée par l'artiste et vérifiée par LE SERVEUR (source existante, même écran, œuvre modifiée) ; les appareils votants ne la signent pas
// (leurs votes v2 portent sur le contenu). Elle est en revanche ENGAGÉE dans le hash : la retirer ou la changer invalide le bloc.

export const DERIVED_HASH_RE = /^[0-9a-f]{64}$/;

/** Hash source déclaré par un client : 64 hex (casse ignorée) → minuscules ; toute autre forme → null. */
export function parseDerivedFrom(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const h = raw.trim().toLowerCase();
  return DERIVED_HASH_RE.test(h) ? h : null;
}

export interface SourceBlockLite { blockHash: string; poolScreen: string; imageHash: string; kind?: string }
export interface DerivedCandidateLite { poolScreen: string; imageHash: string; kind?: string }

export type DerivationVerdict =
  | { ok: true }
  | { ok: false; code: "unknown_source" | "animation_unsupported" | "source_animation" | "screen_mismatch" | "identical"; message: string };

/** Contrôle serveur d'une filiation déclarée. `source` = le bloc minuté désigné (null = introuvable). */
export function checkDerivation(source: SourceBlockLite | null, candidate: DerivedCandidateLite): DerivationVerdict {
  if (!source) return { ok: false, code: "unknown_source", message: "Le bloc d'origine est introuvable dans la chaîne." };
  if (candidate.kind === "animation") return { ok: false, code: "animation_unsupported", message: "Une animation ne peut pas encore être une œuvre dérivée." };
  if (source.kind === "animation") return { ok: false, code: "source_animation", message: "Le bloc d'origine est une animation : seules les images fixes peuvent être remixées pour l'instant." };
  if (source.poolScreen !== candidate.poolScreen) return { ok: false, code: "screen_mismatch", message: "Une œuvre dérivée se dessine sur le même type d'écran que son bloc d'origine." };
  if (source.imageHash === candidate.imageHash) return { ok: false, code: "identical", message: "L'œuvre dérivée doit être modifiée : elle est identique à l'originale." };
  return { ok: true };
}
