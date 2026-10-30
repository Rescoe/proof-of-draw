// wifi-guard.mjs — CONTRÔLE BLOQUANT « aucun identifiant Wi-Fi dans une image R4 destinée à la publication ».
//   node wifi-guard.mjs --bin <firmware.bin> [--build-dir <dossier du sketch compilé>] [--forbid-secrets <secrets.h>]... [--forbid-file <fichier>]... [--allow-empty-forbidden]
// Échoue (code 1) si :
//   1. une valeur INTERDITE (SSID ou mot de passe) apparaît dans les octets du .bin — recherche d'octets, pas de lecture du code source ;
//   2. le marqueur d'un Wi-Fi COMPILÉ (« PODWIFI:compiled-v1 ») est présent, ou celui d'un Wi-Fi lu de la flash (« PODWIFI:record-v1 ») est absent ;
//   3. un secrets.h contenant de vraies valeurs se trouve dans le dossier de build ;
//   4. aucune valeur interdite n'a pu être chargée (échec FERMÉ, sauf --allow-empty-forbidden).
// Les valeurs interdites viennent de FICHIERS locaux (secrets.h du banc, ~/.pod-wifi-forbidden.txt : une valeur par ligne, « # » = commentaire) : jamais de la conversation, jamais de Git.
// AUCUNE valeur n'est jamais affichée : seulement des numéros et des longueurs.
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const MARK_RECORD = "PODWIFI:record-v1";
export const MARK_COMPILED = "PODWIFI:compiled-v1";
const MIN_LEN = 4;                       // une valeur plus courte n'est pas cherchée (faux positifs)
const PLACEHOLDER = /^(votre|your|ton|mon|example|exemple|changeme|xxx|<|\.\.\.)/i;

/** Valeurs SSID / mot de passe d'un secrets.h (macros SECRET_WIFI_SSID / SECRET_WIFI_PASSWORD) ; les valeurs de gabarit sont ignorées. */
export function parseSecretsH(text) {
  const out = [];
  for (const m of text.matchAll(/#define\s+SECRET_WIFI_(?:SSID|PASS(?:WORD)?)\w*\s+"((?:[^"\\]|\\.)*)"/g)) {
    const v = m[1].replace(/\\(.)/g, "$1");
    if (v.length >= MIN_LEN && !PLACEHOLDER.test(v)) out.push(v);
  }
  return out;
}
export function parseForbiddenFile(text) {
  return text.split(/\r?\n/).map((l) => l.replace(/\s+$/, "")).filter((l) => l && !l.startsWith("#") && l.length >= MIN_LEN);
}

/** Cœur pur (testé) : image + valeurs interdites -> { ok, findings[] } ; les findings ne contiennent JAMAIS une valeur. */
export function checkImage(image, forbidden, { requireForbidden = true } = {}) {
  const findings = [];
  const vals = [...new Set(forbidden)].filter((v) => v.length >= MIN_LEN);
  if (vals.length === 0 && requireForbidden) findings.push("aucune valeur interdite chargée : le contrôle d'octets ne peut pas s'exécuter (échec fermé)");
  vals.forEach((v, i) => {
    const bytes = Buffer.from(v, "utf8");
    if (image.includes(bytes)) findings.push(`valeur interdite n°${i + 1} (longueur ${bytes.length}) PRÉSENTE dans l'image`);
  });
  if (image.includes(Buffer.from(MARK_COMPILED))) findings.push("marqueur de Wi-Fi COMPILÉ présent (" + MARK_COMPILED + ")");
  if (!image.includes(Buffer.from(MARK_RECORD))) findings.push("marqueur de Wi-Fi hors binaire absent (" + MARK_RECORD + ")");
  return { ok: findings.length === 0, findings, checked: vals.length };
}

/** Un secrets.h réel dans le dossier de build = une release ne doit pas être fabriquée ainsi. */
export function buildDirFindings(dir) {
  const f = join(dir, "secrets.h");
  if (!existsSync(f)) return [];
  return parseSecretsH(readFileSync(f, "utf8")).length > 0 ? ["secrets.h avec de vraies valeurs dans le dossier de build : release refusée"] : [];
}

/** Valeurs interdites par défaut : tout secrets.h connu du dépôt et ~/.pod-wifi-forbidden.txt. */
export function defaultForbidden(repoRoot) {
  const vals = [];
  const home = join(homedir(), ".pod-wifi-forbidden.txt");
  if (existsSync(home)) vals.push(...parseForbiddenFile(readFileSync(home, "utf8")));
  for (const top of ["arduino_uno_r4", "esp8266"]) {
    const d = join(repoRoot, top);
    if (!existsSync(d)) continue;
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const f = join(d, e.name, "secrets.h");
      if (e.isDirectory() && existsSync(f)) vals.push(...parseSecretsH(readFileSync(f, "utf8")));
    }
  }
  return vals;
}

function main() {
  const argv = process.argv.slice(2);
  const all = (n) => argv.flatMap((a, i) => (a === n ? [argv[i + 1]] : []));
  const bin = all("--bin")[0];
  if (!bin || !existsSync(bin)) { console.error("usage : wifi-guard.mjs --bin <firmware.bin> [--build-dir D] [--forbid-secrets secrets.h]... [--forbid-file F]... [--allow-empty-forbidden]"); process.exit(2); }
  const root = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..");
  const forbidden = defaultForbidden(root);
  for (const f of all("--forbid-secrets")) forbidden.push(...parseSecretsH(readFileSync(f, "utf8")));
  for (const f of all("--forbid-file")) forbidden.push(...parseForbiddenFile(readFileSync(f, "utf8")));
  const r = checkImage(readFileSync(bin), forbidden, { requireForbidden: !argv.includes("--allow-empty-forbidden") });
  const findings = [...r.findings];
  for (const d of all("--build-dir")) findings.push(...buildDirFindings(d));
  if (findings.length) { console.error("REFUSÉ (wifi-guard) :\n  - " + findings.join("\n  - ")); process.exit(1); }
  console.log(`wifi-guard OK : ${r.checked} valeur(s) interdite(s) absente(s) de l'image (${readFileSync(bin).length} o) ; marqueur ${MARK_RECORD} présent ; aucun secrets.h réel dans le build.`);
}
if (process.argv[1] && String(process.argv[1]).split(String.fromCharCode(92)).join("/").endsWith("/wifi-guard.mjs")) main();
