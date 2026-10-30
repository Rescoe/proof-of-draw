// build.mjs — fabrique, sur des COPIES du firmware TFT 1,8″, les trois variantes du canari OTA : OFF (firmware de production, POD_OTA = 0), A (POD_OTA = 1, séquence 1, canari) et B (POD_OTA = 1, séquence 2, version suivante, canari).
// Rien n'est modifié dans esp8266/esp_tft1.8/ : chaque variante est une copie du dossier du firmware avec (1) un PRÉAMBULE de #define en tête du .ino, (2) pour B seulement, la chaîne FIRMWARE_VERSION remplacée, (3) pod_ota_keys.h (clés PUBLIQUES de test).
// A et B ne diffèrent donc QUE par POD_OTA_SEQ et FIRMWARE_VERSION (testé : tests/build.test.mjs). Les binaires embarquent secrets.h (Wi-Fi réel) : ils restent sous artifacts/ (ignoré par git) et ne sont jamais archivés dans les verdicts.
import { cpSync, mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync, rmSync, statSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { renderKeysHeader } from "../../esp8266-ota2/tools/configure.mjs";

export const LAB = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const ROOT = resolve(LAB, "..", "..");
export const TFT_DIR = join(ROOT, "esp8266", "esp_tft1.8");
export const KEYS_DIR = join(ROOT, "ota-lab", "esp8266-ota2", "artifacts", "keys");
export const FQBN = "esp8266:esp8266:nodemcuv2:eesz=4M2M";
// arduino-cli : variable ARDUINO_CLI, sinon celui de l'IDE Arduino 2.x (Windows, installation par utilisateur), sinon « arduino-cli » du PATH. Aucun chemin propre à un PC.
const IDE_CLI = process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, "Programs", "Arduino IDE", "resources", "app", "lib", "backend", "resources", "arduino-cli.exe") : "";
export const DEFAULT_CLI = process.env.ARDUINO_CLI || (IDE_CLI && existsSync(IDE_CLI) ? IDE_CLI : "arduino-cli");
export const VERSION_A = "tft18-2.4", VERSION_B = "tft18-2.5", SEQ_A = 1, SEQ_B = 2, FAMILY = "esp8266-tft18";
// Firmware FINAL (celui qui reste sur la carte) : POD_OTA = 1, AUCUN canari, séquence 3 (> B = 2), version suivante ; clés de PUBLICATION (release-a / release-b), jamais les clés de laboratoire.
export const VERSION_FINAL = "tft18-2.6", SEQ_FINAL = 3;
export const RELEASE_KEYS_DIR = join(homedir(), ".pod-ota-release");   // HORS du dépôt : les clés privées de publication n'y entrent jamais
export const RAM_BUDGET = 40000;   // règle du dépôt : RAM statique <= 40 000 o

export const sha256 = (b) => createHash("sha256").update(b).digest("hex");

/** Préambule de la variante (jamais de guillemet à échapper en ligne de commande : tout passe par le source de la copie). */
export function preamble(variant, { baseUrl, wifi, client, seq, portal, sensor } = {}) {
  if (variant === "OFF") return "";
  if (variant === "FINAL") {
    if (wifi !== undefined && wifi !== "migrate" && wifi !== "generic") throw new Error("wifi : migrate | generic");
    // Wi-Fi hors binaire (18/10/2026) : "migrate" = build LOCAL qui écrit l'enregistrement EEPROM depuis secrets.h ; "generic" = AUCUN identifiant dans le binaire (secrets.h n'est même pas copié).
    const w = wifi ? ["#define POD_WIFI_FROM_RECORD 1", ...(wifi === "migrate" ? ["#define POD_WIFI_MIGRATE 1"] : [])] : [];
    // Client OTA Internet (20/10/2026) : AUCUN secret, TLS authentifié ; exige le Wi-Fi hors binaire (jamais publier un binaire qui contient le Wi-Fi).
    if (client && wifi !== "generic") throw new Error("client OTA : exige wifi = generic");
    // Première connexion sans fil (22/10/2026) : portail de configuration Wi-Fi (point d'accès temporaire) ; exige le Wi-Fi hors binaire. NON essayé sur la carte tant que la procédure guidée n'a pas eu lieu.
    if (portal && !wifi) throw new Error("portail Wi-Fi : exige wifi = generic | migrate");
    return ["#define POD_OTA 1", `#define POD_OTA_SEQ ${seq ?? SEQ_FINAL}`, ...w, ...(client ? ["#define POD_OTA_CLIENT 1"] : []), ...(portal ? ["#define POD_WIFI_PORTAL 1"] : []), ...(sensor ? ["#define POD_SENSOR_DHT22 1"] : []), ""].join("\n");
  }
  if (variant !== "A" && variant !== "B") throw new Error("variante inconnue : " + variant);
  if (!/^http:\/\/[0-9.]+:\d{2,5}$/.test(String(baseUrl ?? ""))) throw new Error("baseUrl invalide (http://<IPv4>:<port> attendu) : " + baseUrl);
  return ["#define POD_OTA 1", `#define POD_OTA_SEQ ${variant === "A" ? SEQ_A : SEQ_B}`, "#define POD_OTA_CANARY 1", `#define POD_OTA_BASE_URL "${baseUrl}"`, "#define POD_ANIM_BUDGET_CAP_MS 8000UL", ""].join("\n");
}

/** Copie le firmware dans `dest` (sans host/), applique le préambule et la version, écrit pod_ota_keys.h. Rend les chemins. */
export function prepareSketch({ variant, dest, baseUrl, secretsFile, keysDir = KEYS_DIR, tftDir = TFT_DIR, releaseKeysDir = RELEASE_KEYS_DIR, wifi, client, seq, version, portal, sensor }) {
  rmSync(dest, { recursive: true, force: true });
  const sk = join(dest, "esp_tft1.8"); mkdirSync(sk, { recursive: true });
  for (const f of readdirSync(tftDir)) { const p = join(tftDir, f); if (statSync(p).isFile() && /\.(ino|h)$/.test(f) && !(wifi === "generic" && f === "secrets.h")) cpSync(p, join(sk, f)); }
  if (secretsFile && wifi !== "generic") cpSync(secretsFile, join(sk, "secrets.h"));
  if (wifi === "generic" && existsSync(join(sk, "secrets.h"))) throw new Error("build générique : secrets.h ne doit pas être dans la copie");
  const inoPath = join(sk, "esp_tft1.8.ino"); let ino = readFileSync(inoPath, "utf8");
  if (variant === "B" || variant === "FINAL") {
    const a = `#define FIRMWARE_VERSION  "${VERSION_A}"`;
    if (!ino.includes(a)) throw new Error("FIRMWARE_VERSION introuvable dans le firmware : la copie " + variant + " ne peut pas être fabriquée");
    ino = ino.replace(a, () => `#define FIRMWARE_VERSION  "${variant === "B" ? VERSION_B : (version ?? VERSION_FINAL)}"`);
  }
  writeFileSync(inoPath, preamble(variant, { baseUrl, wifi, client, seq, portal, sensor }) + ino);
  if (variant === "FINAL") {
    const pa = join(releaseKeysDir, "release-a.public.pem"), pb = join(releaseKeysDir, "release-b.public.pem");
    if (!existsSync(pa) || !existsSync(pb)) throw new Error("clés PUBLIQUES de publication absentes : " + releaseKeysDir + " (node ota-lab/esp8266-canary/tools/make-release-keys.mjs)");
    writeFileSync(join(sk, "pod_ota_keys.h"), renderKeysHeader(readFileSync(pa, "utf8"), readFileSync(pb, "utf8")));
  } else if (variant !== "OFF") {
    const pa = join(keysDir, "rsa.public.pem"), pb = join(keysDir, "rsab.public.pem");
    if (!existsSync(pa) || !existsSync(pb)) throw new Error("clés publiques de test absentes : " + keysDir);
    writeFileSync(join(sk, "pod_ota_keys.h"), renderKeysHeader(readFileSync(pa, "utf8"), readFileSync(pb, "utf8")));
  } else if (existsSync(join(sk, "pod_ota_keys.h"))) rmSync(join(sk, "pod_ota_keys.h"));
  return { sketchDir: sk, inoPath };
}

/** Analyse la sortie de arduino-cli : RAM statique, IRAM, flash. */
export function parseCompileOutput(text) {
  const ram = /Variables and constants in RAM \(global, static\), used (\d+) \/ (\d+) bytes/.exec(text);
  const iram = /Instruction RAM \(IRAM_ATTR, ICACHE_RAM_ATTR\), used (\d+) \/ (\d+) bytes/.exec(text);
  return { ramStatic: ram ? Number(ram[1]) : null, ramTotal: ram ? Number(ram[2]) : null, iram: iram ? Number(iram[1]) : null, iramTotal: iram ? Number(iram[2]) : null };
}

export function compileArgs(sketchDir, outDir) { return ["compile", "--fqbn", FQBN, "--output-dir", outDir, sketchDir]; }
export function uploadArgs(port, inputDir) { return ["upload", "--fqbn", FQBN, "-p", port, "--input-dir", inputDir]; }

/** Compile une variante. `run(cmd, args, opts) -> {code, stdout, stderr}` est injecté. */
export async function buildVariant({ run, cli = DEFAULT_CLI, variant, work, baseUrl, secretsFile, keysDir, tftDir, wifi, releaseKeysDir, client, seq, version, portal, sensor }) {
  const { sketchDir } = prepareSketch({ variant, dest: join(work, "src-" + variant), baseUrl, secretsFile, keysDir, tftDir, wifi, client, seq, version, portal, sensor, ...(releaseKeysDir ? { releaseKeysDir } : {}) });
  const out = join(work, "out-" + variant); mkdirSync(out, { recursive: true });
  const r = await run(cli, compileArgs(sketchDir, out), { timeout: 900000 });
  if (r.code !== 0) throw new Error(`compilation de ${variant} en échec : ${(r.stderr || r.stdout).slice(-400)}`);
  const binPath = join(out, "esp_tft1.8.ino.bin"); const bin = readFileSync(binPath);
  return { variant, dir: out, binPath, size: bin.length, sha: sha256(bin), bin, ...parseCompileOutput(r.stdout + r.stderr) };
}
