/* eslint-disable @typescript-eslint/no-require-imports */
// scripts/check-vote-pins.js — LOT8B2E V4-FIX2 / TFT28-PROD-VOTE-CANARY-1 : contrôle HORS LIGNE du fichier LOCAL pod_vote_pins.h avant de compiler le canari de vote.
//   node scripts/check-vote-pins.js [chemin/pod_vote_pins.h]      (défaut : arduino_uno_r4/pod_uno_r4/pod_vote_pins.h)
// Vérifie : les trois définitions existent, aucune valeur modèle (« < … > »), nom de domaine seul, identifiant = UUID de 36 caractères, hash = 64 hexadécimaux MINUSCULES, fichier ignoré par git et non suivi.
// PRODUCTION (decision du 14/10/2026, docs/DECISION_TESTS_DIRECTS_PRODUCTION_2026_10_14.md) : l'hôte proof-of-draw.vercel.app est REFUSÉ par défaut ; il n'est accepté qu'avec le consentement LOCAL et EXPLICITE
//   « #define POD_VOTE_ALLOW_PRODUCTION 1 » dans le même fichier ; le consentement avec un AUTRE hôte est incohérent et refusé ; le fichier d'hôte d'appairage (pod_preview_host.h) n'accepte JAMAIS la production.
// Ne prouve PAS l'isolation d'un backend (preuve non logicielle : docs/PROTOCOLE_ISOLATION_ET_VERROU_VOTE_TFT28_2026_10_14.md) ni que le hash est celui du candidat.
const fs = require("fs");
const path = require("path");
const cp = require("child_process");
const root = path.resolve(__dirname, "..");
const file = path.resolve(process.argv[2] || path.join(root, "arduino_uno_r4/pod_uno_r4/pod_vote_pins.h"));
const PROD_HOST = "proof-of-draw.vercel.app";
const problems = [];
let src = "";
try { src = fs.readFileSync(file, "utf8"); } catch { console.error(`ECHEC : fichier illisible ou absent : ${file}`); process.exit(1); }
const get = (k) => { const m = new RegExp(`^\\s*#define\\s+${k}\\s+"([^"]*)"`, "m").exec(src); return m ? m[1] : null; };
const hostOnly = path.basename(file) === "pod_preview_host.h";   // TFT28-PREVIEW-ENROLL-1 : fichier d'hôte du build d'appairage (POD_PREVIEW_HOST seul, aucun candidat)
const HOSTKEY = hostOnly ? "POD_PREVIEW_HOST" : "POD_VOTE_BACKEND_HOST";
const host = get(HOSTKEY), id = hostOnly ? "" : get("POD_VOTE_PIN_ID"), hash = hostOnly ? "" : get("POD_VOTE_PIN_HASH");
// consentement : seule une ligne #define NON commentée compte ; la valeur doit être exactement 0 ou 1
const consentM = /^[ \t]*#define[ \t]+POD_VOTE_ALLOW_PRODUCTION\b[ \t]*([^\r\n]*)$/m.exec(src);
let consent = false;
if (consentM) {
  const val = consentM[1].replace(/\/\/.*$/, "").trim();
  if (val === "1") consent = true; else if (val !== "0") problems.push(`POD_VOTE_ALLOW_PRODUCTION : valeur « ${val} » invalide (0 ou exactement 1)`);
  if (hostOnly) problems.push("POD_VOTE_ALLOW_PRODUCTION n'a aucun sens dans pod_preview_host.h (le build d'appairage refuse toujours la production)");
}
if (host === null) problems.push(`${HOSTKEY} absent`);
if (id === null) problems.push("POD_VOTE_PIN_ID absent");
if (hash === null) problems.push("POD_VOTE_PIN_HASH absent");
for (const [k, v] of [[HOSTKEY, host], ["POD_VOTE_PIN_ID", id], ["POD_VOTE_PIN_HASH", hash]]) if (v !== null && /[<>]/.test(v)) problems.push(`${k} : valeur modèle non renseignée`);
let productionAccepted = false;
if (host !== null && !/[<>]/.test(host)) {
  if (!/^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/.test(host) || !host.includes(".")) problems.push("hôte : nom de domaine seul attendu (minuscules, sans schéma, sans chemin, sans port)");
  const isProd = host.toLowerCase() === PROD_HOST;
  if (isProd && !hostOnly && consent) productionAccepted = true;
  else if (isProd) problems.push(hostOnly ? "hôte = PRODUCTION : refusé (le build d'appairage ne cible jamais la production)" : "hôte = PRODUCTION : refusé SANS le consentement local « #define POD_VOTE_ALLOW_PRODUCTION 1 »");
  else if (/(^|\.)proof-of-draw\.vercel\.app$/.test(host)) problems.push("hôte : alias de production (seul l'hôte de production exact est admis, avec consentement)");
  if (consent && !isProd) problems.push("POD_VOTE_ALLOW_PRODUCTION = 1 avec un hôte qui n'est PAS la production : consentement incohérent, refusé");
}
if (!hostOnly && id !== null && !/[<>]/.test(id) && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) problems.push("identifiant : UUID de 36 caractères attendu");
if (!hostOnly && hash !== null && !/[<>]/.test(hash) && !/^[0-9a-f]{64}$/.test(hash)) problems.push("hash : 64 hexadécimaux minuscules attendus");
const rel = path.relative(root, file).replace(/\\/g, "/");
if (!rel.startsWith("..")) {
  const git = (a) => cp.spawnSync("git", a, { cwd: root, encoding: "utf8" });
  if (git(["check-ignore", "-q", rel]).status !== 0) problems.push("fichier NON ignoré par git (risque de commit)");
  if ((git(["ls-files", "--", rel]).stdout || "").trim() !== "") problems.push("fichier SUIVI par git");
}
if (problems.length) { console.error("ECHEC :\n- " + problems.join("\n- ")); process.exit(1); }
if (hostOnly) { console.log(`OK (format seulement) : hôte Preview ${host}. L'isolation du backend reste à PROUVER hors logiciel.`); process.exit(0); }
if (productionAccepted) {
  console.log("╔══════════════════════════════════════════════════════════════════════════════╗");
  console.log("║  ATTENTION : VOTE RÉEL SUR PRODUCTION (proof-of-draw.vercel.app)             ║");
  console.log("║  Si le candidat épinglé est accepté, un bloc est miné dans la chaîne         ║");
  console.log("║  principale. Une seule tentative (verrou EEPROM). Sauvegarder le candidat    ║");
  console.log("║  AVANT le vote : docs/LOT_TFT28_PROD_VOTE_CANARY_1_2026_10_14.md § 5.        ║");
  console.log("╚══════════════════════════════════════════════════════════════════════════════╝");
}
console.log(`OK (formats seulement) : hôte ${host}${productionAccepted ? " [PRODUCTION, consentement local]" : ""}, identifiant ${id}, hash ${hash.slice(0, 8)}…${hash.slice(-8)}. ${productionAccepted ? "Aucune isolation : le vote est RÉEL." : "L'isolation du backend reste à PROUVER hors logiciel."}`);
