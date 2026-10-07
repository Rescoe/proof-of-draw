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
import { blockHashV2, committeeRank, committeeRoot, committeeSeed, committeeWindow, decide, drawMiner, minerRoot, quorumCommitteeRoot, threshold, type BlockCanonicalV2, type Committee, type Verdict } from "@/lib/podProtocolV3";

export interface ProofBlock {
  blockHash: string; parentHash: string; imageHash: string; actionsHash: string; deviceId: string; poolScreen: string;
  validatorIds: string[]; score: number; minedAt: number; animRoot?: string;
  blockVersion?: 2; contentHash?: string; scorePpm?: number; votesRoot?: string; committeeMode?: "quorum" | "committee" | "bootstrap"; committeeK?: number; receiptsCount?: number;
  /** engagements du hash : comité (mode, K, seuil, vague, liste ordonnée) et tirage du mineur (résultat + entrées) */
  committeeRoot?: string; minerRoot?: string;
  /** tirage du mineur (hors hash) : rejoué par le vérificateur */
  miner?: { profileId: string; accepted: { profileId: string; minedBlocks: number }[] };
}

/** Champs IMMUABLES d'un bloc (ceux que le hash couvre) : jamais la propriété, l'observation ni les images. */
export function toProofBlock(b: import("@/lib/chain").Block): ProofBlock {
  return {
    blockHash: b.blockHash, parentHash: b.parentHash, imageHash: b.imageHash, actionsHash: b.actionsHash, deviceId: b.deviceId, poolScreen: b.poolScreen,
    validatorIds: [...b.validatorIds].sort(), score: b.score, minedAt: b.minedAt, ...(b.anim?.root ? { animRoot: b.anim.root } : {}),
    ...(b.blockVersion === 2 ? { blockVersion: 2 as const, contentHash: b.contentHash, scorePpm: b.scorePpm, votesRoot: b.votesRoot, committeeMode: b.committeeMode, committeeK: b.committeeK, committeeRoot: b.committeeRoot, minerRoot: b.minerRoot, receiptsCount: b.receiptsCount, ...(b.miner ? { miner: b.miner } : {}) } : {}),
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

/**
 * Contrôles du COMITÉ (mode « committee » / « bootstrap ») : la liste de rangs fournie est bien ordonnée par les rangs recalculés (graine = parentHash + contentHash du BLOC), les reçus sont
 * exactement des membres de la fenêtre, dans l'ordre des rangs et au plus K, la décision (règle des sièges, seuil ⌈2K/3⌉) est « accepter », et le tirage du mineur se rejoue.
 * NE PROUVE PAS que la liste des profils éligibles était complète (un serveur pourrait en omettre ; spec § 16, point 1).
 */
function verifyCommittee(checks: Check[], block: ProofBlock, doc: ReceiptsDoc, mode: "committee" | "bootstrap") {
  const c = doc.committee;
  if (!c) { add(checks, "committee-ranks", "Comité : rangs rejouables", "fail", "document de reçus sans comité"); return; }
  const seed = committeeSeed(block.parentHash, block.contentHash ?? "");
  const ranks = c.ranked.map((p) => committeeRank(seed, p));
  const sorted = c.ranked.every((p, i) => i === 0 || ranks[i - 1] < ranks[i] || (ranks[i - 1] === ranks[i] && c.ranked[i - 1] < p));
  const uniq = new Set(c.ranked).size === c.ranked.length;
  const thr = mode === "bootstrap" ? c.K : threshold(c.K);
  const consistent = c.mode === mode && c.K === block.committeeK && c.K >= 1 && c.K <= 7 && c.ranked.length <= 2 * c.K && c.threshold === thr;
  add(checks, "committee-ranks", `Comité (${mode}, K = ${c.K}, seuil ${thr}) : rangs recalculés depuis la chaîne et le contenu`, sorted && uniq && consistent ? "ok" : "fail",
    sorted && uniq && consistent ? `${c.ranked.length} profil(s) classés` : "liste de rangs, K ou seuil incohérents avec le bloc");

  const committee: Committee = { mode, K: c.K, threshold: c.threshold, ranked: c.ranked };
  const window2 = new Set(committeeWindow(committee, 2));
  const inRankOrder = doc.receipts.every((r, i) => i === 0 || c.ranked.indexOf(doc.receipts[i - 1].profileId ?? "") < c.ranked.indexOf(r.profileId ?? ""));
  const members = doc.receipts.length <= c.K && doc.receipts.every((r) => !!r.profileId && window2.has(r.profileId)) && new Set(doc.receipts.map((r) => r.profileId)).size === doc.receipts.length;
  add(checks, "committee-members", "Chaque reçu est celui d'un membre du comité (un par profil, au plus K, dans l'ordre des rangs)", members && inRankOrder ? "ok" : "fail",
    members && inRankOrder ? undefined : "reçu hors comité, profil en double, plus de K reçus ou ordre des rangs non respecté");

  const verdicts = new Map<string, Verdict>(doc.receipts.filter((r) => r.profileId).map((r) => [r.profileId!, r.verdict] as [string, Verdict]));
  const d = decide(committee, 2, verdicts);
  add(checks, "committee-decision", `Décision rejouée : ${d.accepts} approbation(s) ≥ ${d.needed} et ≤ ${d.rejectLimit} refus tolérés`, d.state === "accept" ? "ok" : "fail", `${d.accepts} approbation(s), ${d.rejects} refus → ${d.state}`);

  if (block.miner) {
    const approvers = new Set(doc.receipts.filter((r) => r.verdict === "accept" && r.profileId).map((r) => r.profileId!));
    const sameSet = JSON.stringify(block.miner.accepted.map((a) => a.profileId).sort()) === JSON.stringify([...approvers].sort());
    const winner = drawMiner({ parentHash: block.parentHash, contentHash: block.contentHash ?? "", votesRoot: block.votesRoot ?? "", accepted: block.miner.accepted });
    add(checks, "miner", "Mineur : tirage déterministe rejoué (graine = chaîne + contenu + racine des reçus)", sameSet && winner === block.miner.profileId && approvers.has(block.miner.profileId) ? "ok" : "fail",
      `profil tiré : ${winner ?? "aucun"}${block.miner.accepted.length ? " ; nombres de blocs minés déclarés par le serveur (non vérifiables sans réplication de la chaîne)" : ""}`);
  } else add(checks, "miner", "Mineur : tirage déterministe rejoué", "na", "bloc sans tirage déterministe");
}

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
  } else if (!receipts || block.contentHash === undefined || block.scorePpm === undefined || block.votesRoot === undefined || block.committeeK === undefined || block.committeeRoot === undefined || block.minerRoot === undefined) {
    add(checks, "hash", "Hash du bloc recalculé (format v2)", "fail", "bloc v2 sans reçus ou champs obligatoires manquants");
  } else {
    const canonical: BlockCanonicalV2 = {
      parentHash: block.parentHash, imageHash: block.imageHash, actionsHash: block.actionsHash, contentHash: block.contentHash, deviceId: block.deviceId, poolScreen: block.poolScreen,
      validatorProfileIds: validatorKeysOf(receipts), scorePpm: block.scorePpm, minedAt: block.minedAt, ...(block.animRoot ? { animRoot: block.animRoot } : {}),
      votesRoot: receiptsRoot(receipts), committeeMode: block.committeeMode ?? "quorum", committeeK: block.committeeK, committeeRoot: block.committeeRoot, minerRoot: block.minerRoot,
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

    const mode = block.committeeMode ?? "quorum";
    // ENGAGEMENTS (audit GPT) : le comité tel que documenté (mode, K, seuil, vague, liste ORDONNÉE) et le tirage du mineur doivent redonner EXACTEMENT les racines contenues dans le hash du bloc.
    const c = receipts.committee;
    const expectedCommittee = c ? committeeRoot({ mode: c.mode, K: c.K, threshold: c.threshold, wave: c.wave, ranked: c.ranked }) : quorumCommitteeRoot(block.committeeK ?? 0);
    add(checks, "committee-commit", "Le comité documenté (mode, K, seuil, vague, rangs) est celui engagé dans le hash du bloc", expectedCommittee === block.committeeRoot && (c ? c.mode === mode : mode === "quorum") ? "ok" : "fail",
      expectedCommittee === block.committeeRoot ? undefined : "le comité des reçus ne correspond pas à committeeRoot : liste remplacée ou modifiée");
    add(checks, "miner-commit", "Le tirage du mineur (résultat et entrées) est celui engagé dans le hash du bloc", minerRoot(block.miner ?? null) === block.minerRoot ? "ok" : "fail",
      minerRoot(block.miner ?? null) === block.minerRoot ? undefined : "le tirage affiché ne correspond pas à minerRoot");
    if (mode === "quorum") {
      // quorum historique : approbations DISTINCTES (profil ou appareil ; un profil contradictoire s'abstient) ≥ ⌈0,51 × électorat⌉
      const groups = new Map<string, { a: boolean; r: boolean }>();
      for (const r of receipts.receipts) { const k = r.profileId ?? r.deviceId, e = groups.get(k) ?? { a: false, r: false }; if (r.verdict === "reject") e.r = true; else e.a = true; groups.set(k, e); }
      const accepts = [...groups.values()].filter((e) => e.a && !e.r).length;
      const needed = Math.max(1, Math.ceil((block.committeeK ?? 0) * 0.51));
      add(checks, "quorum", `Quorum historique (⌈0,51 × ${block.committeeK ?? "?"}⌉ = ${needed})`, accepts >= needed ? "ok" : "fail", `${accepts} approbation(s) distincte(s)`);
    } else verifyCommittee(checks, block, receipts, mode);

    // validateurs du bloc = appareils des reçus approuvés
    const fromReceipts = [...new Set(receipts.receipts.filter((r) => r.verdict === "accept").map((r) => r.deviceId))].sort();
    add(checks, "validators", "Validateurs du bloc = appareils des reçus approuvés", JSON.stringify(fromReceipts) === JSON.stringify([...block.validatorIds].sort()) ? "ok" : "fail");
    receiptsOk = checks.filter((c) => ["receipts-count", "votes-root", "binding", "signatures-v2", "quorum", "validators", "committee-commit", "miner-commit", "committee-ranks", "committee-members", "committee-decision", "miner"].includes(c.id)).every((c) => c.status === "ok" || (c.id === "miner" && c.status === "na"));
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
