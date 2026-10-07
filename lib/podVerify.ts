// lib/podVerify.ts — VÉRIFICATEUR PUBLIC d'un bloc (pur : aucun Redis, aucun réseau). Lot 3 du plan de travail.
//
// Il répond à une question : « que peut-on vérifier de ce bloc SANS faire confiance au serveur ? ». Il ne dit JAMAIS « validé » : il liste des contrôles, chacun « ok », « fail »,
// « warn » ou « na » (non vérifiable), et un NIVEAU atteint. Il vérifie : le hash du bloc (v1 ou v2), le chaînage, la racine de Merkle des reçus, chaque signature Ed25519, la liaison
// candidat/contenu/appareil de chaque reçu, le quorum historique, la liste des validateurs et — si l'image est fournie — le hash du contenu et les métriques recalculées.
// IL NE PEUT PAS prouver : qu'une clé publique est celle d'un vrai appareil (identité), que l'ensemble des appareils éligibles était complet, que le geste est humain, ni la POSITION
// du vote dans la chaîne (les votes v2 déjà déployés ne signent pas `parentHash`).
// Un second vérificateur indépendant (GPT) devra reproduire les mêmes sorties sur les mêmes entrées.

import { createHash } from "node:crypto";
import { verifyEd25519 } from "@/lib/ed25519";
import { receiptsRoot, validatorKeysOf, type ReceiptsDoc } from "@/lib/blockReceipts";
import { isPodScreen, metricsFromRaw } from "@/lib/podMetrics";
import { blockHashV2, type BlockCanonicalV2 } from "@/lib/podProtocolV3";

export interface ProofBlock {
  blockHash: string; parentHash: string; imageHash: string; actionsHash: string; deviceId: string; poolScreen: string;
  validatorIds: string[]; score: number; minedAt: number; animRoot?: string;
  blockVersion?: 2; contentHash?: string; scorePpm?: number; votesRoot?: string; committeeMode?: "quorum"; committeeK?: number; receiptsCount?: number;
}

/** Champs IMMUABLES d'un bloc (ceux que le hash couvre) : jamais la propriété, l'observation ni les images. */
export function toProofBlock(b: import("@/lib/chain").Block): ProofBlock {
  return {
    blockHash: b.blockHash, parentHash: b.parentHash, imageHash: b.imageHash, actionsHash: b.actionsHash, deviceId: b.deviceId, poolScreen: b.poolScreen,
    validatorIds: [...b.validatorIds].sort(), score: b.score, minedAt: b.minedAt, ...(b.anim?.root ? { animRoot: b.anim.root } : {}),
    ...(b.blockVersion === 2 ? { blockVersion: 2 as const, contentHash: b.contentHash, scorePpm: b.scorePpm, votesRoot: b.votesRoot, committeeMode: b.committeeMode, committeeK: b.committeeK, receiptsCount: b.receiptsCount } : {}),
  };
}

export interface VerifyInput {
  block: ProofBlock;
  receipts: ReceiptsDoc | null;
  /** bloc précédent (au moins son blockHash) pour contrôler le chaînage */
  parent?: { blockHash: string } | null;
  /** contenu BRUT du bloc (même ordre canonique que /api/candidate-frame) pour recalculer hash et métriques */
  content?: { screen: string; raw: Uint8Array } | null;
}

export type CheckStatus = "ok" | "fail" | "warn" | "na";
export interface Check { id: string; label: string; status: CheckStatus; detail?: string }

/** Niveau ATTEINT (du plus faible au plus fort) : rien · hash du bloc/chaînage · reçus signés · contenu recalculé. */
export type VerifyLevel = "none" | "chain" | "receipts" | "content";

export interface VerifyReport {
  blockHash: string;
  blockVersion: 1 | 2;
  checks: Check[];
  /** aucun contrôle en échec */
  ok: boolean;
  level: VerifyLevel;
  stats: { receipts: number; v2Accepts: number; v1Echoes: number; rejects: number; invalidSignatures: number };
}

const sha256Hex = (d: Uint8Array | string) => createHash("sha256").update(d).digest("hex");
const HEX64 = /^[0-9a-f]{64}$/;

/** Hash d'un bloc v1 (format historique de finalizeBlock : score FLOTTANT, clé animRoot absente pour un dessin). */
export function blockHashV1(b: ProofBlock): string {
  return sha256Hex(JSON.stringify({
    parentHash: b.parentHash, imageHash: b.imageHash, actionsHash: b.actionsHash, deviceId: b.deviceId, poolScreen: b.poolScreen,
    validatorIds: [...b.validatorIds].sort(), score: b.score, minedAt: b.minedAt, animRoot: b.animRoot,
  }));
}

interface ParsedMessage { version: 1 | 2; deviceId: string; candidateId: string; rawHash?: string; e?: number; t?: number; r?: number; verdict?: string }
function parseMessage(m: string): ParsedMessage | null {
  if (m.startsWith("pod-vote-v2|")) {
    const p = m.split("|");
    if (p.length !== 9 || p[4] !== "2") return null;
    const [, deviceId, candidateId, rawHash, , e, t, r, verdict] = p;
    return { version: 2, deviceId, candidateId, rawHash, e: Number(e), t: Number(t), r: Number(r), verdict };
  }
  const p = m.split(":");
  if (p.length !== 3) return null;
  return { version: 1, deviceId: p[0], candidateId: p[1] };
}

const add = (checks: Check[], id: string, label: string, status: CheckStatus, detail?: string) => { checks.push({ id, label, status, ...(detail ? { detail } : {}) }); };

export function verifyBlock(input: VerifyInput): VerifyReport {
  const { block, receipts } = input;
  const checks: Check[] = [];
  const isV2 = block.blockVersion === 2;
  const stats = { receipts: receipts?.receipts.length ?? 0, v2Accepts: 0, v1Echoes: 0, rejects: 0, invalidSignatures: 0 };

  // ── 1. hash du bloc ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  let hashOk = false;
  if (!HEX64.test(block.blockHash)) add(checks, "hash", "Hash du bloc recalculé", "fail", "blockHash invalide");
  else if (!isV2) {
    hashOk = blockHashV1(block) === block.blockHash;
    add(checks, "hash", "Hash du bloc recalculé (format v1)", hashOk ? "ok" : "fail", hashOk ? undefined : "le hash recalculé diffère du hash annoncé");
  } else if (!receipts || block.contentHash === undefined || block.scorePpm === undefined || block.votesRoot === undefined || block.committeeK === undefined) {
    add(checks, "hash", "Hash du bloc recalculé (format v2)", "fail", "bloc v2 sans reçus ou champs obligatoires manquants");
  } else {
    const canonical: BlockCanonicalV2 = {
      parentHash: block.parentHash, imageHash: block.imageHash, actionsHash: block.actionsHash, contentHash: block.contentHash, deviceId: block.deviceId, poolScreen: block.poolScreen,
      validatorProfileIds: validatorKeysOf(receipts), scorePpm: block.scorePpm, minedAt: block.minedAt, ...(block.animRoot ? { animRoot: block.animRoot } : {}),
      votesRoot: receiptsRoot(receipts), committeeMode: "quorum", committeeK: block.committeeK,
    };
    hashOk = blockHashV2(canonical) === block.blockHash;
    add(checks, "hash", "Hash du bloc recalculé (format v2, engage les reçus)", hashOk ? "ok" : "fail", hashOk ? undefined : "le hash recalculé depuis les reçus diffère du hash annoncé");
  }

  // ── 2. chaînage ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  if (input.parent) add(checks, "chain", "Chaînage : parentHash = hash du bloc précédent", input.parent.blockHash === block.parentHash ? "ok" : "fail");
  else add(checks, "chain", "Chaînage : parentHash = hash du bloc précédent", "na", "bloc précédent non fourni");

  // ── 3. reçus ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  let receiptsOk = false, anyV2Valid = false;
  if (!isV2) {
    add(checks, "receipts", "Reçus signés des votes", "na", "bloc au format v1 : les votes signés n'ont pas été conservés");
  } else if (!receipts) {
    add(checks, "receipts", "Reçus signés des votes", "fail", "reçus introuvables");
  } else {
    const count = receipts.receipts.length;
    add(checks, "receipts-count", "Nombre de reçus = celui annoncé par le bloc", block.receiptsCount === count ? "ok" : "fail", `${count} reçu(s)`);
    add(checks, "votes-root", "Racine de Merkle des reçus = votesRoot du bloc", receiptsRoot(receipts) === block.votesRoot ? "ok" : "fail");

    let bindOk = true, sigFail = 0, v1Warn = 0;
    const bindProblems: string[] = [];
    for (const r of receipts.receipts) {
      const parsed = parseMessage(r.message);
      if (!parsed) { bindOk = false; bindProblems.push(`${r.deviceId} : message illisible`); continue; }
      if (parsed.deviceId !== r.deviceId) { bindOk = false; bindProblems.push(`${r.deviceId} : le message désigne un autre appareil`); }
      if (parsed.candidateId !== receipts.candidateId) { bindOk = false; bindProblems.push(`${r.deviceId} : le message désigne un autre candidat`); }
      if (parsed.version !== r.v) { bindOk = false; bindProblems.push(`${r.deviceId} : version déclarée ≠ version du message`); }
      if (parsed.version === 2) {
        if (r.verdict === "accept" && parsed.rawHash !== block.contentHash) { bindOk = false; bindProblems.push(`${r.deviceId} : le hash signé n'est pas celui du contenu du bloc`); }
        if (parsed.verdict !== r.verdict) { bindOk = false; bindProblems.push(`${r.deviceId} : verdict du reçu ≠ verdict signé`); }
      }
      const sigOk = r.publicKey.length === 64 && r.signature.length === 128 && verifyEd25519(r.publicKey, r.message, r.signature);
      if (!sigOk) { stats.invalidSignatures++; if (r.v === 2) sigFail++; else v1Warn++; }
      if (r.verdict === "reject") stats.rejects++;
      else if (r.v === 2) { stats.v2Accepts++; if (sigOk) anyV2Valid = true; }
      else stats.v1Echoes++;
    }
    add(checks, "binding", "Chaque reçu désigne ce candidat, cet appareil et ce contenu", bindOk ? "ok" : "fail", bindOk ? undefined : bindProblems.slice(0, 5).join(" ; "));
    add(checks, "signatures-v2", "Signatures Ed25519 des votes v2 valides", sigFail === 0 ? "ok" : "fail", sigFail ? `${sigFail} signature(s) invalide(s)` : `${stats.v2Accepts + receipts.receipts.filter((x) => x.v === 2 && x.verdict === "reject").length} vote(s) v2`);
    add(checks, "signatures-v1", "Votes hérités (écho du score du serveur)", v1Warn || stats.v1Echoes ? "warn" : "ok",
      stats.v1Echoes ? `${stats.v1Echoes} vote(s) hérité(s) : la signature ne couvre AUCUN contenu (le vote recopie le score du serveur)${v1Warn ? ` ; ${v1Warn} signature(s) absente(s) ou invalide(s) acceptée(s) en mode permissif` : ""}` : undefined);

    // quorum historique : approbations DISTINCTES (profil ou appareil ; un profil contradictoire s'abstient) ≥ ⌈0,51 × électorat⌉
    const groups = new Map<string, { a: boolean; r: boolean }>();
    for (const r of receipts.receipts) { const k = r.profileId ?? r.deviceId, e = groups.get(k) ?? { a: false, r: false }; if (r.verdict === "reject") e.r = true; else e.a = true; groups.set(k, e); }
    const accepts = [...groups.values()].filter((e) => e.a && !e.r).length;
    const needed = Math.max(1, Math.ceil((block.committeeK ?? 0) * 0.51));
    add(checks, "quorum", `Quorum historique (⌈0,51 × ${block.committeeK ?? "?"}⌉ = ${needed})`, accepts >= needed ? "ok" : "fail", `${accepts} approbation(s) distincte(s)`);

    // validateurs du bloc = appareils des reçus approuvés
    const fromReceipts = [...new Set(receipts.receipts.filter((r) => r.verdict === "accept").map((r) => r.deviceId))].sort();
    add(checks, "validators", "Validateurs du bloc = appareils des reçus approuvés", JSON.stringify(fromReceipts) === JSON.stringify([...block.validatorIds].sort()) ? "ok" : "fail");
    receiptsOk = checks.filter((c) => ["receipts-count", "votes-root", "binding", "signatures-v2", "quorum", "validators"].includes(c.id)).every((c) => c.status === "ok");
  }

  // ── 4. ce qui n'est PAS vérifiable (dit explicitement) ─────────────────────────────────────────────────────────────────────────────────
  add(checks, "identity", "Les clés publiques sont celles d'appareils réels", "na", "une clé n'est pas la preuve d'un appareil (aucun élément matériel sécurisé) : identité attestée par le seul serveur");
  add(checks, "position", "Les votes sont liés à la position du bloc dans la chaîne", isV2 ? "warn" : "na", isV2 ? "les votes v2 déjà déployés ne signent pas parentHash (le protocole v3 le fera)" : undefined);

  // ── 5. contenu recalculé ────────────────────────────────────────────────────────────────────────────────────────────────────────────
  let contentOk = false;
  if (input.content && isV2 && receipts) {
    const { screen, raw } = input.content;
    const hashMatches = sha256Hex(raw) === block.contentHash;
    add(checks, "content-hash", "SHA-256 du contenu fourni = contentHash du bloc", hashMatches ? "ok" : "fail");
    let metricsMatch = true, compared = 0;
    if (isPodScreen(screen) && hashMatches) {
      try {
        const m = metricsFromRaw(screen, raw);
        for (const r of receipts.receipts) { const p = parseMessage(r.message); if (p?.version === 2 && r.verdict === "accept") { compared++; if (p.e !== m.e || p.t !== m.t || p.r !== m.r) metricsMatch = false; } }
        add(checks, "content-metrics", "Métriques e/t/r recalculées = celles signées par les appareils", compared === 0 ? "na" : metricsMatch ? "ok" : "fail", compared ? `${compared} reçu(s) v2 comparé(s)` : "aucun reçu v2 approuvé");
        contentOk = hashMatches && metricsMatch && compared > 0;
      } catch (e) { add(checks, "content-metrics", "Métriques recalculées", "fail", e instanceof Error ? e.message : "contenu illisible"); metricsMatch = false; }
    } else add(checks, "content-metrics", "Métriques recalculées", "na", "écran non géré ou contenu incohérent");
  } else add(checks, "content-hash", "Contenu recalculé", "na", "contenu non fourni (ou bloc v1)");

  const ok = !checks.some((c) => c.status === "fail");
  let level: VerifyLevel = "none";
  if (hashOk && ok) level = "chain";
  if (level === "chain" && isV2 && receiptsOk && anyV2Valid) level = "receipts";
  if (level === "receipts" && contentOk) level = "content";
  return { blockHash: block.blockHash, blockVersion: isV2 ? 2 : 1, checks, ok, level, stats };
}

export const LEVEL_LABEL: Record<VerifyLevel, string> = {
  none: "Rien de vérifié (échec)",
  chain: "Intégrité du bloc seulement (hash et chaînage)",
  receipts: "Reçus signés vérifiés (au moins un appareil a signé ce contenu pour ce candidat)",
  content: "Contenu recalculé : hash et métriques identiques à ceux signés par les appareils",
};
