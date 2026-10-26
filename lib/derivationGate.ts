// lib/derivationGate.ts — porte serveur du Remix : lit le bloc source (1 GET Redis, SEULEMENT si une filiation est déclarée) et applique lib/derivation.ts. Utilisée par /api/draw (refus immédiat,
// avant le verrou de dépôt : une erreur ne consomme pas le délai) et /api/submit-candidate (garde finale, y compris pour les dessins venus de la file d'attente).
import { getBlockByHash } from "@/lib/chain";
import { checkDerivation, parseDerivedFrom } from "@/lib/derivation";

export type GateResult =
  | { ok: true; derivedFromBlockHash?: string }
  | { ok: false; status: number; error: string; reason: string };

export async function gateDerivation(declared: unknown, candidate: { poolScreen: string; imageHash: string; kind?: string }, load: typeof getBlockByHash = getBlockByHash): Promise<GateResult> {
  if (declared === undefined || declared === null || declared === "") return { ok: true };
  const hash = parseDerivedFrom(declared);
  if (!hash) return { ok: false, status: 400, error: "derivedFromBlockHash invalide : 64 caractères hexadécimaux attendus", reason: "derivation_invalid" };
  const src = await load(hash);
  const verdict = checkDerivation(src ? { blockHash: src.blockHash, poolScreen: src.poolScreen, imageHash: src.imageHash, kind: src.kind } : null, candidate);
  if (!verdict.ok) return { ok: false, status: 400, error: verdict.message, reason: `derivation_${verdict.code}` };
  return { ok: true, derivedFromBlockHash: hash };
}
