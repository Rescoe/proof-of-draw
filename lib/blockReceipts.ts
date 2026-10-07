// lib/blockReceipts.ts — REÇUS SIGNÉS d'un bloc et format de bloc « v2 » (pur, sans Redis). Lot 3 du plan de travail (docs/LOT_3_RECUS_ET_VERIFICATEUR_2026_10_07.md).
//
// Constat K1 : les votes signés étaient SUPPRIMÉS après le minage ; un bloc n'était pas vérifiable hors du serveur. Avec BLOCK_RECEIPTS=true, un bloc fini conserve les REÇUS de tous les
// votes (acceptations ET refus) et le hash du bloc s'ENGAGE sur eux (racine de Merkle `votesRoot`) : le serveur ne peut plus changer qui a voté quoi sans changer le hash.
// Format du hash : lib/podProtocolV3.ts (`blockCanonicalV2`, ordre des clés figé, score en ppm ENTIER). Mode de comité « quorum » = règle HISTORIQUE (⌈0,51 × électorat⌉), en attendant le comité (lot 4).
// Les votes v2 actuels (firmware déjà déployé) ne signent PAS la position dans la chaîne (`parentHash`) : le reçu prouve « cet appareil a signé CE contenu pour CE candidat », pas « à CETTE position ».
// Coût Redis : +1 commande par BLOC (un SET du document de reçus, écrit avec le bloc) ; 0 au repos. Désactivé par défaut (aucun effet sans BLOCK_RECEIPTS=true).

import type { Candidate, ValidationVote } from "@/lib/chain";
import { voterKey } from "@/lib/eligibility";
import { PPM } from "@/lib/podMetrics";
import { voteMessageV2 } from "@/lib/podVote";
import { blockHashV2, merkleRoot, voteLeaf, type BlockCanonicalV2 } from "@/lib/podProtocolV3";

export const blockReceiptsEnabled = (env: NodeJS.ProcessEnv = process.env): boolean => env.BLOCK_RECEIPTS === "true";

export interface Receipt {
  /** 2 = vote v2 (l'appareil a RECALCULÉ hash et métriques) ; 1 = vote hérité (écho du score serveur : la signature ne couvre aucun contenu) */
  v: 1 | 2;
  deviceId: string;
  profileId?: string;
  /** clé publique de l'appareil AU MOMENT du vote ("" si l'appareil n'en avait pas) */
  publicKey: string;
  verdict: "accept" | "reject";
  /** message EXACT signé (UTF-8) */
  message: string;
  /** signature Ed25519 hex (128 car.) — peut être vide ou invalide pour un vote hérité accepté en mode permissif */
  signature: string;
}

/** Comité du candidat tel qu'il a siégé (rangs recalculables : parentHash + contentHash du bloc). Hors hash : le vérificateur le recoupe, il n'en prouve pas la complétude (spec § 16). */
export interface ReceiptsCommittee { mode: "committee" | "bootstrap"; K: number; threshold: number; ranked: string[] }

export interface ReceiptsDoc {
  v: 1;
  candidateId: string;
  committee?: ReceiptsCommittee;
  /** électorat figé au dépôt du candidat (quorum historique : ⌈0,51 × poolSize⌉) */
  poolSize: number;
  receipts: Receipt[];
}

/** Message réellement signé par l'appareil, reconstruit depuis le vote stocké. */
export function receiptMessage(vote: ValidationVote, candidate: Pick<Candidate, "candidateId" | "v2">): string {
  if (vote.v === 2) {
    return voteMessageV2({
      deviceId: vote.deviceId, candidateId: candidate.candidateId, rawHash: vote.rawHash ?? candidate.v2?.rawHash ?? "",
      e: Math.round(vote.entropy * PPM), t: Math.round(vote.transitions * PPM), r: Math.round(vote.rle * PPM), verdict: vote.verdict === "reject" ? "reject" : "accept",
    });
  }
  return `${vote.deviceId}:${candidate.candidateId}:${vote.score.toFixed(3)}`;   // vote hérité (même format que app/api/validation-result)
}

export function buildReceipts(candidate: Pick<Candidate, "candidateId" | "poolSize" | "v2" | "committee">, allVotes: readonly ValidationVote[]): ReceiptsDoc {
  const receipts: Receipt[] = allVotes.map((v) => ({
    v: v.v === 2 ? 2 : 1, deviceId: v.deviceId, ...(v.profileId ? { profileId: v.profileId } : {}), publicKey: v.pk ?? "",
    verdict: v.verdict === "reject" ? "reject" as const : "accept" as const, message: receiptMessage(v, candidate), signature: v.signature ?? "",
  }));
  // ordre CANONIQUE : l'ordre des RANGS du comité s'il y en a un (spec § 6), sinon voterKey puis appareil
  const rank = new Map((candidate.committee?.ranked ?? []).map((p, i) => [p, i]));
  receipts.sort((a, b) => {
    const ka = a.profileId ?? a.deviceId, kb = b.profileId ?? b.deviceId;
    const ra = rank.get(ka) ?? Number.MAX_SAFE_INTEGER, rb = rank.get(kb) ?? Number.MAX_SAFE_INTEGER;
    if (ra !== rb) return ra - rb;
    return ka < kb ? -1 : ka > kb ? 1 : a.deviceId < b.deviceId ? -1 : a.deviceId > b.deviceId ? 1 : 0;
  });
  const c = candidate.committee;
  return { v: 1, candidateId: candidate.candidateId, ...(c ? { committee: { mode: c.mode, K: c.K, threshold: c.threshold, ranked: c.ranked } } : {}), poolSize: candidate.poolSize, receipts };
}

export const receiptLeaf = (r: Receipt): Buffer => voteLeaf(r.message, r.signature, r.publicKey);
export const receiptsRoot = (doc: ReceiptsDoc): string => merkleRoot(doc.receipts.map(receiptLeaf));

/** Clés de vote distinctes des approbations (profils en enforce, appareils sinon), triées : « validatorProfileIds » du hash canonique. */
export const validatorKeysOf = (doc: ReceiptsDoc): string[] => [...new Set(doc.receipts.filter((r) => r.verdict === "accept").map((r) => voterKey(r)))].sort();

/** Le contenu que les votes v2 recalculent : rawHash d'une image fixe, racine d'une animation ; repli sur le hash des pixels. */
export const contentHashOf = (c: Pick<Candidate, "v2" | "anim" | "imageHash">): string => c.v2?.rawHash ?? c.anim?.root ?? c.imageHash;

export interface BlockV2Inputs {
  candidate: Pick<Candidate, "candidateId" | "poolSize" | "v2" | "anim" | "imageHash" | "actionsHash" | "deviceId" | "poolScreen" | "committee">;
  allVotes: readonly ValidationVote[];
  parentHash: string;
  finalScore: number;
  minedAt: number;
}

/** Tous les champs du bloc v2 (hash compris) et le document de reçus à stocker. Pur : testable sans Redis. */
export function buildBlockV2(i: BlockV2Inputs) {
  const doc = buildReceipts(i.candidate, i.allVotes);
  const votesRoot = receiptsRoot(doc);
  const canonical: BlockCanonicalV2 = {
    parentHash: i.parentHash, imageHash: i.candidate.imageHash, actionsHash: i.candidate.actionsHash, contentHash: contentHashOf(i.candidate),
    deviceId: i.candidate.deviceId, poolScreen: i.candidate.poolScreen, validatorProfileIds: validatorKeysOf(doc),
    scorePpm: Math.round(i.finalScore * PPM), minedAt: i.minedAt, ...(i.candidate.anim?.root ? { animRoot: i.candidate.anim.root } : {}),
    // comité « enforce » : mode et K du comité ; sinon quorum historique (électorat = poolSize)
    votesRoot, committeeMode: i.candidate.committee?.state === "enforce" ? i.candidate.committee.mode : "quorum", committeeK: i.candidate.committee?.state === "enforce" ? i.candidate.committee.K : i.candidate.poolSize,
  };
  return {
    blockHash: blockHashV2(canonical), doc,
    fields: { blockVersion: 2 as const, contentHash: canonical.contentHash, scorePpm: canonical.scorePpm, votesRoot, committeeMode: canonical.committeeMode as "quorum" | "committee" | "bootstrap", committeeK: canonical.committeeK, receiptsCount: doc.receipts.length },
  };
}
