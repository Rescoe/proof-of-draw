// publish-r4-release.mjs --kind <sensor|tft18|tft28> --channel <canary|stable> --release <dossier contenant manifest.txt + firmware.bin> --pub <keys.json> [--public <dossier public/>]
// Prépare la PUBLICATION d'une mise à jour OTA R4 : vérifie le manifeste SIGNÉ avec le vérificateur INDÉPENDANT (verify-manifest.mjs) puis copie manifest.txt et firmware.bin dans
// public/firmware-r4/<kind>/<channel>/ — fichiers STATIQUES servis par le CDN du site (aucune route, aucune commande Redis). ⚠ FUSIONNER ce dossier sur main = ENVOYER la mise à jour aux cartes du canal :
// ce script n'écrit que dans le dossier de travail, il ne commite, ne pousse et ne déploie rien. Refuse : kind/canal inconnus, canal du manifeste ≠ canal demandé, famille ≠ famille du kind, signature/hash/taille faux.
// Retirer une mise à jour = supprimer ces deux fichiers (le client reçoit 404 : « rien à faire »). Les cartes déjà mises à jour ne reviennent PAS en arrière (pas de rollback automatique).
import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs"; import { join, dirname } from "node:path"; import { fileURLToPath } from "node:url"; import { spawnSync } from "node:child_process";
const HERE = dirname(fileURLToPath(import.meta.url)); const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const FAMILY = { sensor: "uno-r4-wifi-sensor", tft18: "uno-r4-wifi-tft18", tft28: "uno-r4-wifi-tft28" };
const die = (m) => { console.error("REFUSÉ : " + m); process.exit(1); };
const kind = arg("--kind"), channel = arg("--channel"), rel = arg("--release"), pub = arg("--pub"), pubDir = arg("--public", join(HERE, "..", "..", "..", "public"));
if (!kind || !FAMILY[kind]) die("--kind sensor|tft18|tft28"); if (!["canary", "stable"].includes(channel ?? "")) die("--channel canary|stable (jamais development)");
if (!rel || !existsSync(join(rel, "manifest.txt")) || !existsSync(join(rel, "firmware.bin"))) die("--release : dossier avec manifest.txt et firmware.bin"); if (!pub || !existsSync(pub)) die("--pub keys.json (clés PUBLIQUES de publication)");
const v = spawnSync(process.execPath, [join(HERE, "verify-manifest.mjs"), join(rel, "manifest.txt"), "--bin", join(rel, "firmware.bin"), "--pub", pub, "--family", FAMILY[kind], "--channel", channel], { encoding: "utf8" });
if (v.status !== 0) die("vérificateur indépendant : " + (v.stdout || v.stderr).trim());
// CONTRÔLE BLOQUANT (30/10/2026) : aucun identifiant Wi-Fi dans l'image publiée (recherche d'octets + marqueurs ; valeurs interdites lues dans des FICHIERS locaux, jamais affichées). --build-dir : dossier du sketch compilé (refus si un vrai secrets.h s'y trouve).
{ const bd = arg("--build-dir"); const g = spawnSync(process.execPath, [join(HERE, "wifi-guard.mjs"), "--bin", join(rel, "firmware.bin"), ...(bd ? ["--build-dir", bd] : []), ...process.argv.slice(2).flatMap((x, i, all) => (x === "--forbid-file" || x === "--forbid-secrets" ? [x, all[i + 1]] : []))], { encoding: "utf8" });
  if (g.status !== 0) die("wifi-guard : " + (g.stderr || g.stdout).trim()); console.log((g.stdout || "").trim()); }
const dest = join(pubDir, "firmware-r4", kind, channel); mkdirSync(dest, { recursive: true });
copyFileSync(join(rel, "manifest.txt"), join(dest, "manifest.txt")); copyFileSync(join(rel, "firmware.bin"), join(dest, "firmware.bin"));
console.log(v.stdout.trim()); console.log(`copié dans ${dest} (${readFileSync(join(dest, "firmware.bin")).length} o). Rien n'est commité ni déployé : fusionner = envoyer la mise à jour aux cartes du canal « ${channel} ».`);
