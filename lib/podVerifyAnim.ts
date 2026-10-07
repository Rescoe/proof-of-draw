// lib/podVerifyAnim.ts — VÉRIFICATEUR PUBLIC d'un bloc ANIMATION v3 (rulesVersion = 2) — Lot 6B-2, docs/SPEC_PODANIM_V3.md § 9. Pur (aucun Redis, aucun réseau).
//
// Appelé par `verifyBlock` quand `block.rulesVersion === 2`. Il ne dit JAMAIS « validé » : il liste des contrôles ok/fail/warn/na et un niveau atteint (même vocabulaire que lib/podVerify.ts).
// Ce que le vérificateur exige d'un bloc animation v3 :
//   • le hash canonique v2 recalculé avec rulesVersion = 2 (jeu A1 engagé) et `animRoot` = `contentHash` ;
//   • des reçus `pod-vote-v3-anim` (v = 3), signés Ed25519, liés à CE candidat, CET appareil, CETTE racine d'animation ET CETTE POSITION (`parentHash` est signé : contrairement aux votes v2) ;
//   • AUCUN vote d'un autre type compté : les reçus v1 (écho du score serveur), v2 et v3-image sont signalés (warn) et EXCLUS du quorum ; un bloc dont le quorum n'est atteint qu'avec eux est REFUSÉ ;
//   • pas de comité d'animation (mode « quorum », racine du quorum historique, aucun tirage de mineur déterministe) : tant que le grinding n'est pas traité (balise), la décision reste le quorum ;
//   • si le clip est fourni : le hash du clip, les images, la racine, E/T/R/S et le score recalculés ; la règle A1 calculée doit être « ok ».
// NE PROUVE PAS : qu'une clé est celle d'un vrai appareil, la complétude des profils éligibles, ni que le geste est humain.

import { verifyEd25519 } from "@/lib/ed25519";
import { analyzeClip, parseAnimVoteMessage, type AnimVote } from "@/lib/animV3";
import { buildAnimSubmissionFromClip } from "@/lib/anim/block";
import { receiptsRoot, type Receipt, type ReceiptsDoc } from "@/lib/blockReceipts";
import { voterKey } from "@/lib/eligibility";
import { blockHashV2, minerRoot, quorumCommitteeRoot, type BlockCanonicalV2 } from "@/lib/podProtocolV3";
import type { Check, CheckStatus, VerifyInput, VerifyLevel, VerifyReport } from "@/lib/podVerify";

const HEX64 = /^[0-9a-f]{64}$/;
const ANIM_PREFIX = "pod-vote-v3-anim|";
const add = (checks: Check[], id: string, label: string, status: CheckStatus, detail?: string) => { checks.push({ id, label, status, ...(detail ? { detail } : {}) }); };
const isAnimReceipt = (r: Receipt) => r.v === 3 || r.message.startsWith(ANIM_PREFIX);

/** Clés de vote (profil, sinon appareil) distinctes des approbations d'ANIMATION, triées : `validatorProfileIds` du hash canonique d'un bloc animation v3 (le producteur futur DOIT utiliser cette fonction). */
export const animValidatorKeys = (doc: ReceiptsDoc): string[] => [...new Set(doc.receipts.filter((r) => isAnimReceipt(r) && r.verdict === "accept").map((r) => voterKey(r)))].sort();
/** Appareils distincts des approbations d'animation, triés : `validatorIds` du bloc. */
export const animValidatorDevices = (doc: ReceiptsDoc): string[] => [...new Set(doc.receipts.filter((r) => isAnimReceipt(r) && r.verdict === "accept").map((r) => r.deviceId))].sort();

export function verifyAnimBlock(input: VerifyInput): VerifyReport {
  const { block, receipts } = input;
  const checks: Check[] = [];
  const stats = { receipts: receipts?.receipts.length ?? 0, v2Accepts: 0, v1Echoes: 0, rejects: 0, invalidSignatures: 0 };
  const complete = !!receipts && block.contentHash !== undefined && block.scorePpm !== undefined && block.votesRoot !== undefined && block.committeeK !== undefined && block.committeeRoot !== undefined && block.minerRoot !== undefined;

  // ── 1. hash (jeu de règles 2 engagé ; animRoot = contentHash) ───────────────────────────────────────────────────────────────────────────
  let hashOk = false;
  if (!HEX64.test(block.blockHash)) add(checks, "hash", "Hash du bloc recalculé (animation v3)", "fail", "blockHash invalide");
  else if (!complete || !receipts) add(checks, "hash", "Hash du bloc recalculé (animation v3)", "fail", "bloc sans reçus ou champs obligatoires manquants");
  else {
    const canonical: BlockCanonicalV2 = {
      parentHash: block.parentHash, imageHash: block.imageHash, actionsHash: block.actionsHash, contentHash: block.contentHash!, deviceId: block.deviceId, poolScreen: block.poolScreen,
      validatorProfileIds: animValidatorKeys(receipts), scorePpm: block.scorePpm!, minedAt: block.minedAt, animRoot: block.contentHash!,
      votesRoot: receiptsRoot(receipts), committeeMode: block.committeeMode ?? "quorum", committeeK: block.committeeK!, committeeRoot: block.committeeRoot!, minerRoot: block.minerRoot!, rulesVersion: 2,
    };
    hashOk = blockHashV2(canonical) === block.blockHash && (block.animRoot === undefined || block.animRoot === block.contentHash);
    add(checks, "hash", "Hash du bloc recalculé (animation v3 : rulesVersion 2, engage les reçus)", hashOk ? "ok" : "fail", hashOk ? undefined : "le hash recalculé depuis les reçus diffère du hash annoncé (ou animRoot ≠ contentHash)");
  }

  // ── 2. chaînage ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  if (input.parent) add(checks, "chain", "Chaînage : parentHash = hash du bloc précédent", input.parent.blockHash === block.parentHash ? "ok" : "fail");
  else add(checks, "chain", "Chaînage : parentHash = hash du bloc précédent", "na", "bloc précédent non fourni");

  // ── 3. reçus ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  let receiptsOk = false, anyAnimValid = false;
  const animAccepts: { r: Receipt; v: AnimVote }[] = [];
  if (!receipts) add(checks, "receipts", "Reçus signés des votes", "fail", "reçus introuvables");
  else {
    add(checks, "receipts-count", "Nombre de reçus = celui annoncé par le bloc", block.receiptsCount === receipts.receipts.length ? "ok" : "fail", `${receipts.receipts.length} reçu(s)`);
    add(checks, "votes-root", "Racine de Merkle des reçus = votesRoot du bloc", receiptsRoot(receipts) === block.votesRoot ? "ok" : "fail");

    let bindOk = true, sigFail = 0, excluded = 0, positionOk = true, animCount = 0;
    const problems: string[] = [];
    for (const r of receipts.receipts) {
      if (!isAnimReceipt(r)) { excluded++; stats.v1Echoes++; continue; }   // écho v1, vote v2 ou v3-image : jamais compté pour une animation v3
      animCount++;
      const v = parseAnimVoteMessage(r.message);
      if (!v || r.v !== 3 || !r.message.startsWith(ANIM_PREFIX)) { bindOk = false; problems.push(`${r.deviceId} : message d'animation illisible ou version déclarée ≠ 3`); continue; }
      if (v.deviceId !== r.deviceId) { bindOk = false; problems.push(`${r.deviceId} : le message désigne un autre appareil`); }
      if (v.candidateId !== receipts.candidateId) { bindOk = false; problems.push(`${r.deviceId} : le message désigne un autre candidat`); }
      if (v.verdict !== r.verdict) { bindOk = false; problems.push(`${r.deviceId} : verdict du reçu ≠ verdict signé`); }
      if (v.parentHash !== block.parentHash) positionOk = false;
      if (v.verdict === "accept" && v.animRoot !== block.contentHash) { bindOk = false; problems.push(`${r.deviceId} : la racine d'animation signée n'est pas celle du bloc`); }
      const sigOk = r.publicKey.length === 64 && r.signature.length === 128 && verifyEd25519(r.publicKey, r.message, r.signature);
      if (!sigOk) { sigFail++; stats.invalidSignatures++; }
      if (r.verdict === "reject") stats.rejects++;
      else { stats.v2Accepts++; if (sigOk) { anyAnimValid = true; animAccepts.push({ r, v }); } }
    }
    add(checks, "binding", "Chaque reçu d'animation désigne ce candidat, cet appareil et cette racine d'animation", bindOk ? "ok" : "fail", bindOk ? undefined : problems.slice(0, 5).join(" ; "));
    add(checks, "signatures-v3-anim", "Signatures Ed25519 des votes d'animation valides", sigFail === 0 && animCount > 0 ? "ok" : "fail", animCount === 0 ? "aucun reçu d'animation v3" : sigFail ? `${sigFail} signature(s) invalide(s)` : `${animCount} vote(s) pod-vote-v3-anim`);
    add(checks, "anim-receipts-class", "Aucun vote hérité (v1), v2 ou v3-image n'est compté pour une animation v3", excluded === 0 ? "ok" : "warn", excluded ? `${excluded} reçu(s) d'une autre classe EXCLU(S) du quorum (un écho du score serveur ne valide aucun contenu)` : undefined);
    add(checks, "position", "Les votes sont liés à la position du bloc dans la chaîne (parentHash signé)", animCount > 0 && positionOk ? "ok" : "fail", animCount > 0 && positionOk ? undefined : "un vote signe un autre parentHash");

    // pas de comité d'animation : quorum historique seulement
    const mode = block.committeeMode ?? "quorum";
    const commitOk = mode === "quorum" && receipts.committee === undefined && block.committeeRoot === quorumCommitteeRoot(block.committeeK ?? 0);
    add(checks, "committee-commit", "Pas de comité d'animation : mode « quorum », racine du quorum historique engagée dans le hash", commitOk ? "ok" : "fail", commitOk ? undefined : "un comité (ou une racine inattendue) pour une animation : interdit tant que le grinding n'est pas traité");
    const minerOk = block.miner === undefined && block.minerRoot === minerRoot(null);
    add(checks, "miner-commit", "Pas de tirage de mineur déterministe pour une animation (minerRoot = « aucun »)", minerOk ? "ok" : "fail");

    // quorum : approbations DISTINCTES d'animation seulement (un profil contradictoire s'abstient) ≥ ⌈0,51 × électorat⌉
    const groups = new Map<string, { a: boolean; r: boolean }>();
    for (const r of receipts.receipts) { if (!isAnimReceipt(r)) continue; const k = voterKey(r), e = groups.get(k) ?? { a: false, r: false }; if (r.verdict === "reject") e.r = true; else e.a = true; groups.set(k, e); }
    const accepts = [...groups.values()].filter((e) => e.a && !e.r).length, needed = Math.max(1, Math.ceil((block.committeeK ?? 0) * 0.51));
    add(checks, "quorum", `Quorum historique d'animation (⌈0,51 × ${block.committeeK ?? "?"}⌉ = ${needed}) — reçus d'animation seulement`, accepts >= needed ? "ok" : "fail", `${accepts} approbation(s) distincte(s) de classe animation`);

    // les reçus d'une autre classe restent dans votesRoot (audit) mais ne sont JAMAIS présentés comme validateurs d'une animation (ni dans validatorIds, ni dans validatorProfileIds du hash)
    const fromReceipts = animValidatorDevices(receipts);
    add(checks, "validators", "Validateurs du bloc = appareils des reçus d'animation approuvés (les échos v1/v2/v3-image n'en font pas partie)", JSON.stringify(fromReceipts) === JSON.stringify([...block.validatorIds].sort()) ? "ok" : "fail",
      JSON.stringify(fromReceipts) === JSON.stringify([...block.validatorIds].sort()) ? undefined : "validateurs annoncés ≠ appareils des reçus d'animation approuvés");
    add(checks, "anim-rules", "Jeu de règles A1 (rulesVersion 2) ⇔ racine d'animation ⇔ reçus pod-vote-v3-anim", block.rulesVersion === 2 && animCount > 0 && HEX64.test(block.contentHash ?? "") ? "ok" : "fail");
    receiptsOk = ["receipts-count", "votes-root", "binding", "signatures-v3-anim", "position", "committee-commit", "miner-commit", "quorum", "validators", "anim-rules"].every((id) => checks.find((c) => c.id === id)?.status === "ok");
  }
  add(checks, "identity", "Les clés publiques sont celles d'appareils réels", "na", "une clé n'est pas la preuve d'un appareil (aucun élément matériel sécurisé) : identité attestée par le seul serveur");

  // ── 4. contenu recalculé (clip fourni) ──────────────────────────────────────────────────────────────────────────────────────────────────
  let contentOk = false;
  if (input.clip && receipts) {
    const a = analyzeClip(input.clip);
    add(checks, "anim-clip", "Clip PBC1 conforme au jeu A1 (CRC, structure, 2 à 64 images, boucle sans fin, couleurs distinctes, ≤ 9 216 o, ≤ 120 s)", a.formatOk ? "ok" : "fail", a.reason);
    if (a.formatOk) {
      const clipHashes = animAccepts.every(({ v }) => v.clipHash === a.clipHash);
      add(checks, "anim-frames", "Images décodées : empreintes, métriques et racine de Merkle recalculées", a.animRoot === block.contentHash ? "ok" : "fail", `${a.N} image(s) ; framesRoot ${a.framesRoot.slice(0, 12)}…`);
      add(checks, "anim-root", "animRoot recalculé = contentHash du bloc ; clipHash signé = hash du clip fourni", a.animRoot === block.contentHash && clipHashes ? "ok" : "fail", a.animRoot === block.contentHash ? undefined : "la racine d'animation recalculée diffère de celle du bloc");
      const metricsOk = animAccepts.length > 0 && animAccepts.every(({ v }) => v.frames === a.N && v.E === a.E && v.T === a.T && v.R === a.R && v.S === a.S);
      add(checks, "anim-metrics", "E, T, R, S et nombre d'images recalculés = ceux signés par chaque reçu approuvé ; scorePpm = S", metricsOk && block.scorePpm === a.S ? "ok" : "fail", animAccepts.length ? `${animAccepts.length} reçu(s) comparé(s)` : "aucun reçu approuvé");
      add(checks, "anim-rule", "La règle A1 calculée sur le clip est « ok » (ni statique, ni bruit)", a.ruleCode === "ok" ? "ok" : "fail", `règle calculée : ${a.ruleCode}`);
      if (input.posterIndex !== undefined) add(checks, "anim-poster", "Indice de l'affiche = premier maximum du score par image", input.posterIndex === a.posterIndex ? "ok" : "fail");
      else add(checks, "anim-poster", "Indice de l'affiche", "na", "indice non fourni");
      // imageHash : l'ANCIENNE racine v1 (JSON de flottants, lib/anim/block.ts) est conservée uniquement par compatibilité (A3) ; elle se recalcule depuis le même clip — un imageHash qui ne la redonne pas est un échec
      let v1Root = "", v1Detail: string | undefined;
      try { v1Root = buildAnimSubmissionFromClip(input.clip, "oled096").part.root; } catch (e) { v1Detail = e instanceof Error ? e.message : "racine v1 non calculable"; }
      const imageOk = v1Root !== "" && block.imageHash === v1Root;
      add(checks, "anim-image-hash", "imageHash = ancienne racine v1 recalculée depuis le clip (compatibilité, ne fait pas foi : contentHash fait foi)", imageOk ? "ok" : "fail", imageOk ? undefined : v1Detail ?? "imageHash ≠ racine v1 recalculée");
      contentOk = a.animRoot === block.contentHash && clipHashes && metricsOk && block.scorePpm === a.S && a.ruleCode === "ok" && imageOk;
    }
  } else add(checks, "anim-clip", "Clip recalculé", "na", "clip non fourni");

  const ok = !checks.some((c) => c.status === "fail");
  let level: VerifyLevel = "none";
  if (hashOk && ok) level = "chain";
  if (level === "chain" && receiptsOk && anyAnimValid) level = "receipts";
  if (level === "receipts" && contentOk) level = "content";
  return { blockHash: block.blockHash, chainLinked: !!input.parent && input.parent.blockHash === block.parentHash, blockVersion: 2, checks, ok, level, stats };
}
