/* eslint-disable @typescript-eslint/no-require-imports */
// scripts/check-vote-pins.js — LOT8B2E V4-FIX2 : contrôle HORS LIGNE du fichier LOCAL pod_vote_pins.h avant de compiler le canari de vote.
//   node scripts/check-vote-pins.js [chemin/pod_vote_pins.h]      (défaut : arduino_uno_r4/pod_uno_r4/pod_vote_pins.h)
// Vérifie : les trois définitions existent, aucune valeur modèle (« < … > »), hôte ≠ production et sans schéma ni chemin, identifiant = UUID de 36 caractères, hash = 64 hexadécimaux MINUSCULES, fichier ignoré par git et
// non suivi. Ne prouve PAS l'isolation du backend (preuve non logicielle : docs/PROTOCOLE_ISOLATION_ET_VERROU_VOTE_TFT28_2026_10_14.md) ni que le hash est celui du candidat.
const fs = require("fs");
const path = require("path");
const cp = require("child_process");
const root = path.resolve(__dirname, "..");
const file = path.resolve(process.argv[2] || path.join(root, "arduino_uno_r4/pod_uno_r4/pod_vote_pins.h"));
const PROD = ["proof-of-draw.vercel.app"];
const problems = [];
let src = "";
try { src = fs.readFileSync(file, "utf8"); } catch { console.error(`ECHEC : fichier illisible ou absent : ${file}`); process.exit(1); }
const get = (k) => { const m = new RegExp(`^\\s*#define\\s+${k}\\s+"([^"]*)"`, "m").exec(src); return m ? m[1] : null; };
const hostOnly = path.basename(file) === "pod_preview_host.h";   // TFT28-PREVIEW-ENROLL-1 : fichier d'hôte du build d'appairage (POD_PREVIEW_HOST seul, aucun candidat)
const HOSTKEY = hostOnly ? "POD_PREVIEW_HOST" : "POD_VOTE_BACKEND_HOST";
const host = get(HOSTKEY), id = hostOnly ? "" : get("POD_VOTE_PIN_ID"), hash = hostOnly ? "" : get("POD_VOTE_PIN_HASH");
if (host === null) problems.push(`${HOSTKEY} absent`);
if (id === null) problems.push("POD_VOTE_PIN_ID absent");
if (hash === null) problems.push("POD_VOTE_PIN_HASH absent");
for (const [k, v] of [[HOSTKEY, host], ["POD_VOTE_PIN_ID", id], ["POD_VOTE_PIN_HASH", hash]]) if (v !== null && /[<>]/.test(v)) problems.push(`${k} : valeur modèle non renseignée`);
if (host !== null && !/[<>]/.test(host)) {
  if (!/^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/.test(host) || !host.includes(".")) problems.push("hôte : nom de domaine seul attendu (minuscules, sans schéma, sans chemin, sans port)");
  if (PROD.includes(host.toLowerCase())) problems.push("hôte = PRODUCTION : refusé");
  if (/(^|\.)proof-of-draw\.vercel\.app$/.test(host)) problems.push("hôte : alias de production");
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
console.log(`OK (formats seulement) : hôte ${host}, identifiant ${id}, hash ${hash.slice(0, 8)}…${hash.slice(-8)}. L'isolation du backend reste à PROUVER hors logiciel.`);
