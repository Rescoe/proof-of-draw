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
import { blockHashV2, committeeRoot, merkleRoot, minerRoot, quorumCommitteeRoot, voteLeaf, type BlockCanonicalV2 } from "@/lib/podProtocolV3";

export const blockReceiptsEnabled = (env: NodeJS.ProcessEnv = process.env): boolean => env.BLOCK_RECEIPTS === "true";

export interface Receipt {
  /** 2 = vote v2 (l'appareil a RECALCULÉ hash et métriques) ; 1 = vote hérité (écho du score serveur : la signature ne couvre aucun contenu) ; 3 = vote d'animation signé du lot 6B (produit par aucun firmware actuel) */
  v: 1 | 2 | 3;
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
export interface ReceiptsCommittee { mode: "committee" | "bootstrap"; K: number; threshold: number; /** vague de la décision (1 = titulaires, 2 = suppléants admis) */ wave: 1 | 2; ranked: string[] }

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

export function buildReceipts(candidate: Pick<Candidate, "candidateId" | "poolSize" | "v2" | "committee">, allVotes: readonly ValidationVote[], wave: 1 | 2 = 1): ReceiptsDoc {
  const receipts: Receipt[] = allVotes.map((v) => ({
    v: v.v === 2 ? 2 : 1, deviceId: v.deviceId, ...(v.profileId ? { profileId: v.profileId } : {}), publicKey: v.pk ?? "",
    verdict: v.verdict === "reject" ? "reject" as const : "accept" as const, message: receiptMessage(v, candidate), signature: v.signature ?? "",
  }));
  // ordre CANONIQUE : l'ordre des RANGS du comité s'il y en a un (spec § 6), sinon voterKey puis appareil
  const enforced = candidate.committee?.state === "enforce" ? candidate.committee : undefined;   // un comité « shadow » n'a PAS siégé : il ne figure ni dans les reçus ni dans le hash
  const rank = new Map((enforced?.ranked ?? []).map((p, i) => [p, i]));
  receipts.sort((a, b) => {
    const ka = a.profileId ?? a.deviceId, kb = b.profileId ?? b.deviceId;
    const ra = rank.get(ka) ?? Number.MAX_SAFE_INTEGER, rb = rank.get(kb) ?? Number.MAX_SAFE_INTEGER;
    if (ra !== rb) return ra - rb;
    return ka < kb ? -1 : ka > kb ? 1 : a.deviceId < b.deviceId ? -1 : a.deviceId > b.deviceId ? 1 : 0;
  });
  const c = enforced;
  return { v: 1, candidateId: candidate.candidateId, ...(c ? { committee: { mode: c.mode, K: c.K, threshold: c.threshold, wave, ranked: c.ranked } } : {}), poolSize: candidate.poolSize, receipts };
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
  /** vague de la décision du comité (1 par défaut) — engagée dans le hash */
  wave?: 1 | 2;
}

/** Tirage du mineur tel qu'il est ENGAGÉ dans le hash : résultat + entrées (profils approbateurs et nombres de blocs minés retenus). */
export interface MinerCommit { profileId: string; accepted: { profileId: string; minedBlocks: number }[] }

/** Étape 1 : reçus, racine des reçus, engagement du comité. Le tirage du mineur (qui a besoin de `votesRoot`) se fait ENTRE les deux étapes. */
export function prepareBlockV2(i: BlockV2Inputs) {
  const wave = i.wave ?? 1;
  const doc = buildReceipts(i.candidate, i.allVotes, wave);
  const votesRoot = receiptsRoot(doc);
  const c = doc.committee;
  const committeeRootHex = c ? committeeRoot({ mode: c.mode, K: c.K, threshold: c.threshold, wave: c.wave, ranked: c.ranked }) : quorumCommitteeRoot(i.candidate.poolSize);
  return { input: i, doc, votesRoot, contentHash: contentHashOf(i.candidate), committeeRootHex, committeeMode: (c ? c.mode : "quorum") as "quorum" | "committee" | "bootstrap", committeeK: c ? c.K : i.candidate.poolSize };
}

/** Étape 2 : engagement du mineur et hash du bloc. `miner` = null : pas de tirage déterministe (quorum historique ou comité absent). */
export function sealBlockV2(p: ReturnType<typeof prepareBlockV2>, miner: MinerCommit | null) {
  const i = p.input;
  const canonical: BlockCanonicalV2 = {
    parentHash: i.parentHash, imageHash: i.candidate.imageHash, actionsHash: i.candidate.actionsHash, contentHash: p.contentHash,
    deviceId: i.candidate.deviceId, poolScreen: i.candidate.poolScreen, validatorProfileIds: validatorKeysOf(p.doc),
    scorePpm: Math.round(i.finalScore * PPM), minedAt: i.minedAt, ...(i.candidate.anim?.root ? { animRoot: i.candidate.anim.root } : {}),
    votesRoot: p.votesRoot, committeeMode: p.committeeMode, committeeK: p.committeeK, committeeRoot: p.committeeRootHex, minerRoot: minerRoot(miner),
  };
  return {
    blockHash: blockHashV2(canonical), doc: p.doc,
    fields: {
      blockVersion: 2 as const, contentHash: canonical.contentHash, scorePpm: canonical.scorePpm, votesRoot: p.votesRoot, committeeMode: p.committeeMode, committeeK: p.committeeK,
      committeeRoot: canonical.committeeRoot, minerRoot: canonical.minerRoot, receiptsCount: p.doc.receipts.length,
    },
  };
}

/** Tout en un (sans tirage déterministe du mineur) : pratique pour les tests et le quorum historique. Pur, sans Redis. */
export function buildBlockV2(i: BlockV2Inputs, miner: MinerCommit | null = null) { return sealBlockV2(prepareBlockV2(i), miner); }
