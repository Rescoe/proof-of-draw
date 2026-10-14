// scripts/verify-candidate-backup.ts — LOT TFT28-PROD-VOTE-CANARY-1 : vérification HORS LIGNE de la SAUVEGARDE du candidat avant un vote réel.
//   node --import tsx scripts/verify-candidate-backup.ts <export-de-candidate-current.json> [pod_vote_pins.h]
// Entrée : le JSON complet de `candidate:current` (console Upstash, `GET candidate:current`), payload compris, enregistré dans un fichier HORS du dépôt.
// Contrôles : JSON valide ; candidateId (UUID) ; écran tft28 ; v2.rawBytes = 153 600 ; contenu RECALCULÉ depuis le payload (même fonction que /api/candidate-frame) = 153 600 octets dont le SHA-256 égale v2.rawHash ;
//   métadonnées présentes (deviceId, poolScreen, imageHash, actionsHash, submittedAt, expiresAt, poolSize) ; avec pod_vote_pins.h : identifiant et hash EXACTEMENT égaux aux épingles.
// Aucun réseau, aucune écriture. Code de sortie 0 = sauvegarde exploitable ; 1 = NE PAS VOTER.
import fs from "node:fs";
import { createHash } from "node:crypto";
import { rawContent } from "../lib/podMetrics";

const problems: string[] = [];
const file = process.argv[2], pinsFile = process.argv[3];
if (!file) { console.error("usage : verify-candidate-backup.ts <export.json> [pod_vote_pins.h]"); process.exit(2); }
let cand: Record<string, unknown> = {};
try { cand = JSON.parse(fs.readFileSync(file, "utf8")); } catch (e) { console.error(`ECHEC : export illisible ou JSON invalide : ${(e as Error).message}`); process.exit(1); }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const id = typeof cand.candidateId === "string" ? cand.candidateId : "";
if (!UUID.test(id)) problems.push("candidateId absent ou n'est pas un UUID");
const v2 = (cand.v2 ?? {}) as { screen?: string; rawBytes?: number; rawHash?: string };
if (v2.screen !== "tft28") problems.push(`v2.screen = ${JSON.stringify(v2.screen)} (attendu "tft28")`);
if (v2.rawBytes !== 153600) problems.push(`v2.rawBytes = ${JSON.stringify(v2.rawBytes)} (attendu 153600)`);
if (typeof v2.rawHash !== "string" || !/^[0-9a-f]{64}$/.test(v2.rawHash)) problems.push("v2.rawHash absent ou n'est pas 64 hexadécimaux minuscules");
const payload = cand.payload as { buffer?: string } | undefined;
if (!payload || typeof payload.buffer !== "string" || payload.buffer.length === 0) problems.push("payload.buffer absent : la sauvegarde ne contient PAS l'image (export tronqué ?)");
else {
  try {
    const raw = rawContent("tft28", payload);
    if (raw.length !== 153600) problems.push(`contenu recalculé : ${raw.length} octets (attendu 153600)`);
    const h = createHash("sha256").update(raw).digest("hex");
    if (v2.rawHash && h !== v2.rawHash) problems.push(`SHA-256 du contenu recalculé (${h}) ≠ v2.rawHash (${v2.rawHash})`);
  } catch (e) { problems.push(`contenu illisible : ${(e as Error).message}`); }
}
for (const k of ["deviceId", "poolScreen", "imageHash", "actionsHash"]) if (typeof cand[k] !== "string" || !(cand[k] as string).length) problems.push(`métadonnée « ${k} » absente`);
for (const k of ["submittedAt", "expiresAt", "poolSize"]) if (typeof cand[k] !== "number") problems.push(`métadonnée « ${k} » absente`);
if (typeof cand.expiresAt === "number" && cand.expiresAt < Date.now()) problems.push("le candidat est déjà EXPIRÉ (expiresAt dépassé) : ne pas voter, recommencer avec un nouveau candidat");
if (pinsFile) {
  const pins = fs.readFileSync(pinsFile, "utf8");
  const get = (k: string) => new RegExp(`^\\s*#define\\s+${k}\\s+"([^"]*)"`, "m").exec(pins)?.[1] ?? null;
  if (get("POD_VOTE_PIN_ID") !== id) problems.push("POD_VOTE_PIN_ID ≠ candidateId de la sauvegarde");
  if (get("POD_VOTE_PIN_HASH") !== v2.rawHash) problems.push("POD_VOTE_PIN_HASH ≠ v2.rawHash de la sauvegarde");
}
if (problems.length) { console.error("ECHEC — NE PAS VOTER :\n- " + problems.join("\n- ")); process.exit(1); }
console.log(`OK : sauvegarde exploitable — candidateId ${id}, tft28, 153600 octets, SHA-256 ${v2.rawHash}${pinsFile ? ", épingles identiques" : ""}.`);
