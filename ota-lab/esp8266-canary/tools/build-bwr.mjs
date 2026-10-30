// build-bwr.mjs — compile le firmware ESP8266 + e-ink 2,9″ BWR AVEC portail Wi-Fi (POD_WIFI_FROM_RECORD=1, POD_WIFI_PORTAL=1) dans canary-builds/ (ignoré par git) puis le CONTRÔLE (22/10/2026, lots A1 et B1).
//   node ota-lab/esp8266-canary/tools/build-bwr.mjs                                         — portail seul ; écrit BWR-BUILD-PIN.json
//   node ota-lab/esp8266-canary/tools/build-bwr.mjs --ota [--seq 6] [--version eink29bwr-2.4] — portail + client OTA Internet (POD_OTA=1, POD_OTA_CLIENT=1, clés PUBLIQUES de ~/.pod-ota-release) ; écrit BWR-OTA-BUILD-PIN.json
// Ne téléverse RIEN. Contrôle : le SSID de secrets.h ne doit PAS apparaître dans le binaire (le Wi-Fi n'est plus compilé) ; en mode --ota, les deux clés publiques de publication doivent y être. Faits écrits = PUBLICS.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DEFAULT_CLI, FQBN, ROOT, LAB, RELEASE_KEYS_DIR } from "../canary/build.mjs";
import { renderKeysHeader } from "../../esp8266-ota2/tools/configure.mjs";

const arg = (n) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : undefined; };
// --target ms27 : multiscreen ESP8266 e-ink 2,7″ + OLED (esp_eink_2.7BW_OLED) ; défaut bwr : e-ink 2,9″ BWR
const TARGETS = { bwr: { dir: "esp_eink_2.9BWR", ino: "esp_eink_2.9BWR.ino", ver: "eink29bwr-2.4", pin: "BWR" }, ms27: { dir: "esp_eink_2.7BW_OLED", ino: "esp_eink_2.7BW_OLED.ino", ver: "multiscreen-2.6", pin: "MS27" } };
const TG = TARGETS[arg("--target") ?? "bwr"]; if (!TG) throw new Error("--target : bwr | ms27");
// --migrate : build LOCAL qui inclut secrets.h et écrit l'enregistrement Wi-Fi dans l'EEPROM s'il manque (la carte garde son Wi-Fi sans portail) ; le binaire CONTIENT le Wi-Fi : JAMAIS publié ni partagé
const MIG = process.argv.includes("--migrate");
// --sensor : ajoute le capteur DHT22 EXPÉRIMENTAL (POD_SENSOR_DHT22=1, multiscreen seulement)
const SENS = process.argv.includes("--sensor");
// --oled : état/portail sur un OLED 0,96″ branché en plus (POD_OLED_STATUS=1, BWR seulement, EXPÉRIMENTAL)
const OLED = process.argv.includes("--oled");
// --display : surimpression T/H dans le cartel + rafraîchissement à chaque mesure (POD_SENSOR_DISPLAY=1, exige --sensor)
const DISP = process.argv.includes("--display");
const OTA = process.argv.includes("--ota"), SEQ = Number(arg("--seq") ?? 6), VERSION = arg("--version") ?? TG.ver;
const SRC = arg("--src") ? path.resolve(arg("--src")) : path.join(ROOT, "esp8266", TG.dir);   // --src : construire depuis un autre dossier (ex. worktree de main) sans toucher à l arbre de travail
const d = new Date(), p2 = (n) => String(n).padStart(2, "0");
const id = `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}`;
const work = path.join(ROOT, "canary-builds", "bwr-portal-2026-10-22", id + (OTA ? "-ota" : "") + (MIG ? "-mig" : "") + (SENS ? "-dht" : "") + (OLED ? "-oled" : "") + (DISP ? "-disp" : "") + (process.argv.includes("--chunk") ? "-chunk" : "")), sk = path.join(work, "src", TG.dir), out = path.join(work, "out");
fs.mkdirSync(sk, { recursive: true }); fs.mkdirSync(out, { recursive: true });
for (const f of fs.readdirSync(SRC)) if (f !== "secrets.h" || MIG) fs.copyFileSync(path.join(SRC, f), path.join(sk, f));   // secrets.h n'est PAS copié : il ne doit pas pouvoir être compilé
// --ballast N : BANC SEULEMENT (jamais publié pour un autre appareil) — réserve N octets de tas à l'initialisation de l'OLED pour SIMULER le coût d'un OLED sur une carte qui n'en a pas (mesuré ≈ 2,7 Ko au total dont 1 Ko de tampon Adafruit)
const BALLAST = Number(arg("--ballast") ?? 0);
if (BALLAST > 0) {
  const ip0 = path.join(sk, TG.ino), src0 = fs.readFileSync(ip0, "utf8"), key = "g_oledReady = oled.begin(SSD1306_SWITCHCAPVCC, 0x3C);";
  if (!src0.includes(key)) throw new Error("--ballast : point d'injection OLED introuvable");
  fs.writeFileSync(ip0, src0.replace(key, () => key + ` { static void* podBallast = malloc(${BALLAST}); (void)podBallast; Serial.println(F("[BALLAST] ${BALLAST} o de tas reserves (simulation OLED)")); }`));
}
let flags = "-DPOD_WIFI_FROM_RECORD=1 -DPOD_WIFI_PORTAL=1" + (MIG ? " -DPOD_WIFI_MIGRATE=1" : "") + (SENS ? " -DPOD_SENSOR_DHT22=1" : "") + (OLED ? " -DPOD_OLED_STATUS=1" : "") + (DISP ? " -DPOD_SENSOR_DISPLAY=1" : "") + (process.argv.includes("--chunk") ? " -DPOD_FRAME_CHUNK=1" : "");
// --define NOM=VAL (répétable) : options de compilation exactes, SANS toucher au sketch (les options du sketch sont gardées par #ifndef)
process.argv.forEach((x, i) => { if (x === "--define") flags += " -D" + process.argv[i + 1]; });
if (OTA) {
  const ip = path.join(sk, TG.ino), ino = fs.readFileSync(ip, "utf8"), m = /#define FIRMWARE_VERSION\s+"[^"]+"/.exec(ino);
  if (!m) throw new Error("FIRMWARE_VERSION introuvable dans le sketch");
  fs.writeFileSync(ip, ino.replace(m[0], () => `#define FIRMWARE_VERSION "${VERSION}"`));
  const pa = path.join(RELEASE_KEYS_DIR, "release-a.public.pem"), pb = path.join(RELEASE_KEYS_DIR, "release-b.public.pem");
  if (fs.existsSync(pa) && fs.existsSync(pb)) fs.writeFileSync(path.join(sk, "pod_ota_keys.h"), renderKeysHeader(fs.readFileSync(pa, "utf8"), fs.readFileSync(pb, "utf8")));
  else if (fs.existsSync(path.join(sk, "pod_ota_keys.h"))) console.log("⚠ clés publiques de publication absentes de " + RELEASE_KEYS_DIR + " : l'en-tête public SUIVI du sketch (pod_ota_keys.h) est conservé");
  else throw new Error("clés PUBLIQUES de publication absentes : " + RELEASE_KEYS_DIR);
  flags += ` -DPOD_OTA=1 -DPOD_OTA_CLIENT=1 -DPOD_OTA_SEQ=${SEQ}`;
}
const cli = process.env.ARDUINO_CLI ?? DEFAULT_CLI;
const r = spawnSync(cli, ["compile", "--fqbn", FQBN, "--build-property", `build.extra_flags=${flags}`, "--output-dir", out, sk], { encoding: "utf8", timeout: 900000, maxBuffer: 50_000_000 });
const log = (r.stdout ?? "") + (r.stderr ?? "");
if (r.status !== 0) { console.log("COMPILATION EN ÉCHEC\n" + log.slice(-800)); process.exit(1); }
const bin = fs.readFileSync(path.join(out, TG.ino + ".bin"));
const ram = /Variables and constants in RAM \(global, static\), used (\d+)/.exec(log)?.[1];
let ssidAbsent = null;
try { const s = /SECRET_WIFI_SSID\s+"([^"]+)"/.exec(fs.readFileSync(path.join(SRC, "secrets.h"), "utf8"))?.[1]; ssidAbsent = s ? !bin.includes(Buffer.from(s)) : null; } catch { /* secrets.h absent */ }
const sha = createHash("sha256").update(bin).digest("hex");
const keysPresent = OTA ? bin.includes(Buffer.from("BEGIN PUBLIC KEY")) : null;
console.log(`BWR ${OTA ? `portail + client OTA (${VERSION}, séquence ${SEQ})` : "avec portail"} : ${bin.length} o, RAM statique ${ram} o, SHA-256 ${sha}\nSSID absent du binaire : ${ssidAbsent === null ? "NON ÉTABLI (secrets.h illisible)" : ssidAbsent ? "oui" : "NON — IDENTIFIANT PRÉSENT"}${OTA ? `\nclés publiques de publication présentes : ${keysPresent ? "oui" : "NON"}` : ""}\ndossier : ${path.relative(ROOT, out).replace(/\\/g, "/")}`);
if ((ssidAbsent === false && !MIG) || (OTA && !keysPresent)) process.exit(2);
if (MIG) console.log("⚠ BUILD DE MIGRATION : le binaire CONTIENT le Wi-Fi (secrets.h) — local, par câble, jamais publié ni partagé");
const note = OTA ? "Build ESP8266 + e-ink 2,9″ BWR avec portail Wi-Fi ET client OTA Internet (lot B1, 22/10/2026). Faits PUBLICS ; binaire sous canary-builds/ (ignoré par git). NON essayé sur la carte." : "Build ESP8266 + e-ink 2,9″ BWR AVEC portail Wi-Fi (lot A1, 22/10/2026). Faits PUBLICS ; le binaire reste sous canary-builds/ (ignoré par git). NON essayé sur la carte.";
fs.writeFileSync(path.join(LAB, (OTA ? `${TG.pin}-OTA` : TG.pin) + (MIG ? "-MIG" : "") + (SENS ? "-DHT" : "") + (OLED ? "-OLED" : "") + (DISP ? "-DISP" : "") + (process.argv.includes("--chunk") ? "-CHUNK" : "") + "-BUILD-PIN.json"), JSON.stringify({ note, dir: path.relative(ROOT, out).replace(/\\/g, "/"), version: OTA ? VERSION : (/#define FIRMWARE_VERSION\s+"([^"]+)"/.exec(fs.readFileSync(path.join(SRC, TG.ino), "utf8"))?.[1] ?? "?"), ...(OTA ? { otaSeq: SEQ } : {}), sha, size: bin.length, ramStatic: Number(ram), ssidAbsent }, null, 2) + "\n");
