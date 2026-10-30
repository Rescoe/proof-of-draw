// configure.mjs --preset <T1-alg0|T1-alg3|A|B> --ip <IP-du-PC> [--sketch <dossier>] [--keys <dossier>]
//   ou : --alg <0..3> --version <texte> --autorun <0|1> [--tls <0|1>] [--delay <s>] --ip <IP>
// Écrit dans le dossier du sketch UNIQUEMENT : ota_config.h (réglages) et public.key (clé publique, ALGO 0/1/2 ; supprimée pour ALGO 3). Ces deux fichiers sont ignorés par git.
// N'écrit jamais de clé privée, ni secrets.h, ni binaire.
import { readFileSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path"; import { pathToFileURL } from "node:url";
import { KEYS_DIR, SKETCH_DIR, opt } from "./lib.mjs";

export const PRESETS = {
  "T1-alg0": { alg: 0, version: "T1", autorun: 0 },       // T1 : boot seul (les classes de signature de la bibliothèque sont liées)
  "T1-alg2": { alg: 2, version: "T1", autorun: 0 },       // T1 : pile thunk gardée en permanence (coût d'une pile permanente)
  "T1-alg3": { alg: 3, version: "T1", autorun: 0 },       // T1 : aucun coût permanent
  A: { alg: 0, version: "A", autorun: 1 },                // T2/T3 : RSA, vérificateur installé explicitement
  "A-alg1": { alg: 1, version: "A", autorun: 1 },         // témoin : ECDSA de la bibliothèque (échec attendu sur une signature DER)
  "A-alg2": { alg: 2, version: "A", autorun: 1 },         // ECDSA brut maison, pile permanente
  "A-alg3": { alg: 3, version: "A", autorun: 1 },         // ECDSA brut maison, pile temporaire
  "A-neg": { alg: 4, version: "A", autorun: 1 },
  "A-manu": { alg: 0, version: "A", autorun: 0 },         // T3 : RSA, OTA lancée À LA MAIN (taper o) : le moniteur est ouvert avant chaque tentative
  "A-neg-manu": { alg: 4, version: "A", autorun: 0 },     // T3-N : aucun vérificateur, OTA lancée à la main (servir wrongsig ou good, jamais tampered)          // TÉMOIN NÉGATIF : aucun vérificateur (servir wrongsig ou good, jamais tampered)
  B: { alg: 0, version: "B", autorun: 0 },                // image cible servie par OTA
  // OTA-4B : le CODE DE PRODUCTION du socle TFT (ALGO 5). A5 = image installée (séquence 1) ; B5 = image cible compilée (séquence 2), enveloppée ensuite par tools/sign-release.mjs.
  A5: { alg: 5, version: "A5", autorun: 0, seq: 1 },
  B5: { alg: 5, version: "B5", autorun: 0, seq: 2 },
};

export const FAMILY = "esp8266-tft18";      // identifiant de famille lié à la signature (trailer) : celui du firmware TFT 1,8″

export function renderConfig({ alg, version, autorun, tls = 0, delay = 12, ip, pem = "", seq = 1 }) {
  if (![0, 1, 2, 3, 4, 5].includes(alg)) throw new Error("alg doit valoir 0, 1, 2, 3, 4 ou 5");
  if (!Number.isInteger(seq) || seq < 1 || seq > 0xffffffff) throw new Error("seq invalide");
  if (!/^[A-Za-z0-9._-]{1,16}$/.test(version)) throw new Error("version invalide");
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) throw new Error("ip invalide (IPv4 attendue)");
  const pemC = pem ? pem.trim().split("\n").map((l) => `"${l}\\n"`).join(" ") : '""';
  return `// ota_config.h — GÉNÉRÉ par tools/configure.mjs (ignoré par git). Ne pas éditer à la main : relancer configure.mjs.
#pragma once
#define OTA_ALG ${alg}
#define OTA_TLS ${tls}
#define OTA_URL "${tls ? "https" : "http"}://${ip}:${tls ? 8443 : 8080}/test"
#define PROBE_VERSION "${version}"
#define OTA_AUTORUN ${autorun}
#define OTA_DELAY_S ${delay}
#define OTA_PUBKEY_PEM_TEXT ${pemC}
#define OTA_BASE "http://${ip}:8080"
#define OTA_SEQ ${seq}
#define OTA_FAMILY "${FAMILY}"
`;
}

/** pod_ota_keys.h du laboratoire (ALGO 5) : les DEUX clés publiques de TEST (créneau A = rsa, créneau B = rsab), comme le ferait le fichier de publication du firmware. Jamais de clé privée. */
export function renderKeysHeader(pemA, pemB) {
  const q = String.fromCharCode(34), bs = String.fromCharCode(92);
  const lit = (pem) => pem.trim().split("\n").map((l) => "  " + q + l + bs + "n" + q).join("\n");
  return `// pod_ota_keys.h — GÉNÉRÉ par tools/configure.mjs pour l'ALGO 5 (clés publiques de TEST du laboratoire, ignoré par git). Même forme que le fichier de publication du firmware.
#pragma once
#include <pgmspace.h>
static const char POD_OTA_KEY_A_PEM[] PROGMEM =
${lit(pemA)};
static const char POD_OTA_KEY_B_PEM[] PROGMEM =
${lit(pemB)};
`;
}

export function configure({ sketch = SKETCH_DIR, keys = KEYS_DIR, ...cfg }) {
  const alg = cfg.alg;
  // ALGO 4 (témoin négatif) : aucune clé. ALGO 0 : RSA ; ALGO 1, 2, 3 : EC. La clé publique va toujours dans ota_config.h (le sketch installe lui-même le vérificateur).
  const pubFile = alg === 4 || alg === 5 ? null : alg === 0 ? "rsa.public.pem" : "ec.public.pem";
  const pubPem = pubFile ? readFileSync(join(keys, pubFile), "utf8") : "";
  writeFileSync(join(sketch, "ota_config.h"), renderConfig({ ...cfg, pem: pubPem }));
  // public.key (hook prebuild du cœur) n'est nécessaire que pour compiler les classes SigningVerifier/HashSHA256 de la bibliothèque (ALGO 0 et 1) ; absent sinon.
  if (alg <= 1) writeFileSync(join(sketch, "public.key"), pubPem);
  else if (existsSync(join(sketch, "public.key"))) rmSync(join(sketch, "public.key"));
  // ALGO 5 : les deux créneaux de clés publiques de test dans pod_ota_keys.h ; retiré pour les autres ALGO (aucune clé périmée dans le dossier du sketch)
  if (alg === 5) writeFileSync(join(sketch, "pod_ota_keys.h"), renderKeysHeader(readFileSync(join(keys, "rsa.public.pem"), "utf8"), readFileSync(join(keys, "rsab.public.pem"), "utf8")));
  else if (existsSync(join(sketch, "pod_ota_keys.h"))) rmSync(join(sketch, "pod_ota_keys.h"));
  return { alg, publicKey: alg === 5 ? "rsa.public.pem + rsab.public.pem" : pubFile ?? "(aucune)" };
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop() ?? "")) {
  const a = process.argv; const ip = opt(a, "--ip", "");
  const preset = opt(a, "--preset", "");
  let cfg;
  if (preset) { if (!PRESETS[preset]) { console.error("preset inconnu : " + preset); process.exit(2); } cfg = { ...PRESETS[preset] }; }
  else cfg = { alg: Number(opt(a, "--alg", "NaN")), version: opt(a, "--version", ""), autorun: Number(opt(a, "--autorun", "0")), tls: Number(opt(a, "--tls", "0")), delay: Number(opt(a, "--delay", "12")) };
  if (!ip) { console.error("usage: node tools/configure.mjs --preset <T1-alg0|T1-alg3|A|B> --ip <IP-du-PC>"); process.exit(2); }
  try {
    const r = configure({ ...cfg, ip, sketch: opt(a, "--sketch", SKETCH_DIR), keys: opt(a, "--keys", KEYS_DIR) });
    console.log(`configuré : ALGO ${r.alg}, version ${cfg.version}, autorun ${cfg.autorun}, clé publique ${r.publicKey} -> ${opt(a, "--sketch", SKETCH_DIR)}`);
  } catch (e) { console.error("ERREUR : " + (e instanceof Error ? e.message : e)); process.exit(1); }
}
