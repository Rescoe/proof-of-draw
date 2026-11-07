// build-r4-tft28.mjs — construit l'UNO R4 WiFi + TFT 2,8″ tactile (arduino_uno_r4/pod_uno_r4) en mode PUBLIABLE : Wi-Fi hors binaire (POD_WIFI_PORTAL=1), client OTA actif (POD_OTA_R4=1), jamais de secrets.h (04/11/2026).
//   node ota-lab/r4-ota5/tools/build-r4-tft28.mjs --seq <N> [--keys-dir <dossier avec keys.json (clés PUBLIQUES r4-a / r4-b)>] [--forbid-file <fichier>] [--out canary-builds/r4-tft28]
// 1. copie le sketch SANS secrets.h, pod_build_flags.h ni pod_ota_r4_keys.h (jamais) ; 2. écrit pod_ota_r4_keys.h (clés PUBLIQUES seulement) ; 3. compile (arduino-cli, cœur renesas_uno, options passées en -D) ; 4. wifi-guard sur le .bin ET le dossier de build
// (échec = aucun fichier de sortie conservé) ; 5. écrit un pin public (SHA-256, tailles, options). ⚠ COMPILÉ SEULEMENT : jamais flashé ni essayé sur la carte.
import { cpSync, mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync, rmSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { homedir } from "node:os";

const HERE = dirname(fileURLToPath(import.meta.url)), ROOT = resolve(HERE, "..", "..", "..");
const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const die = (m) => { console.error("REFUSÉ : " + m); process.exit(1); };
const seq = Number(arg("--seq")); if (!Number.isInteger(seq) || seq < 1) die("--seq <entier ≥ 1> requis (strictement supérieur à la plus haute séquence déjà installée)");
const keysDir = arg("--keys-dir", join(homedir(), ".pod-ota-release-r4"));
if (!existsSync(join(keysDir, "keys.json"))) die("--keys-dir : dossier avec keys.json (clés PUBLIQUES r4-a / r4-b)");
const keys = JSON.parse(readFileSync(join(keysDir, "keys.json"), "utf8"));
for (const k of ["r4-a", "r4-b"]) if (!/^[0-9a-f]{64}$/.test(keys[k] ?? "")) die(`keys.json : ${k} doit être 64 caractères hexadécimaux (clé publique)`);
if (/seed|priv/i.test(JSON.stringify(Object.keys(keys)))) die("keys.json contient un champ de graine privée : refusé");

const SRC = join(ROOT, "arduino_uno_r4", "pod_uno_r4");
const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
const work = resolve(arg("--out", join(ROOT, "canary-builds", "r4-tft28")), stamp), sk = join(work, "pod_uno_r4"), out = join(work, "out");
mkdirSync(sk, { recursive: true });
for (const f of readdirSync(SRC)) { if (f === "secrets.h" || f === "pod_build_flags.h" || f === "pod_ota_r4_keys.h" || f === "pod_vote_pins.h") continue; cpSync(join(SRC, f), join(sk, f), { recursive: true }); }
// --fw <r4tft28-X.Y[.Z]> : version annoncée de CETTE construction (essai de mise à jour : une image B se distingue de A sur le serveur) ; remplace la définition de la version OTA dans la COPIE de travail seulement.
const fwOverride = arg("--fw");
if (fwOverride) {
  if (!/^r4tft28-\d+\.\d+(\.\d+)?$/.test(fwOverride)) die("--fw : r4tft28-X.Y ou r4tft28-X.Y.Z");
  const ino = join(sk, "pod_uno_r4.ino"), t = readFileSync(ino, "utf8");
  if (!t.includes('#define FIRMWARE_VERSION  "r4tft28-2.7"')) die("--fw : définition de version OTA introuvable dans le sketch");
  writeFileSync(ino, t.replace('#define FIRMWARE_VERSION  "r4tft28-2.7"', `#define FIRMWARE_VERSION  "${fwOverride}"`));
}
writeFileSync(join(sk, "pod_ota_r4_keys.h"), `// GÉNÉRÉ par build-r4-tft28.mjs : clés PUBLIQUES de publication OTA R4 (aucune graine privée).\n#pragma once\n#define OTAR4_PUB_A_HEX "${keys["r4-a"]}"\n#define OTAR4_PUB_B_HEX "${keys["r4-b"]}"\n`);

const opts = ["POD_WIFI_PORTAL=1", "POD_OTA_R4=1", `OTAR4_COMPILED_SEQ=${seq}`, ...(arg("--extra", "") ? arg("--extra").split(/\s+/) : [])];
const IDE = process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, "Programs", "Arduino IDE", "resources", "app", "lib", "backend", "resources", "arduino-cli.exe") : "";
const cli = process.env.ARDUINO_CLI || (IDE && existsSync(IDE) ? IDE : "arduino-cli");
const FQBN = "arduino:renesas_uno:unor4wifi";
const r = spawnSync(cli, ["compile", "--fqbn", FQBN, "--build-property", "compiler.cpp.extra_flags=" + opts.map((o) => "-D" + o).join(" "), "--output-dir", out, sk], { encoding: "utf8", timeout: 900000, maxBuffer: 50_000_000 });
const log = (r.stdout ?? "") + (r.stderr ?? "");
if (r.status !== 0) die("compilation en échec\n" + log.slice(-900));
const bin = join(out, "pod_uno_r4.ino.bin");
const forbid = arg("--forbid-file", join(homedir(), ".pod-wifi-forbidden.txt"));
const g = spawnSync(process.execPath, [join(HERE, "wifi-guard.mjs"), "--bin", bin, "--build-dir", sk, ...(existsSync(forbid) ? ["--forbid-file", forbid] : [])], { encoding: "utf8" });
if (g.status !== 0) { rmSync(out, { recursive: true, force: true }); die("wifi-guard : " + (g.stderr || g.stdout).trim()); }
const data = readFileSync(bin), sha = createHash("sha256").update(data).digest("hex");
const flash = /Le croquis utilise (\d+) octets \((\d+)%\)/.exec(log) ?? /Sketch uses (\d+) bytes \((\d+)%\)/.exec(log);
const ram = /variables globales utilisent (\d+) octets \((\d+)%\)/.exec(log) ?? /Global variables use (\d+) bytes \((\d+)%\)/.exec(log);
const fw = [...readFileSync(join(sk, "pod_uno_r4.ino"), "utf8").matchAll(/#define FIRMWARE_VERSION +"([^"]+)"/g)].map((m) => m[1]);
const pin = { fqbn: FQBN, family: "uno-r4-wifi-tft28", channel: "canary", OTAR4_COMPILED_SEQ: seq, options: opts.join(" "), firmwareVersions: fw, bytes: data.length, sha256: sha, flashBytes: flash ? Number(flash[1]) : null, flashPercent: flash ? Number(flash[2]) : null, staticRamBytes: ram ? Number(ram[1]) : null, staticRamPercent: ram ? Number(ram[2]) : null, wifiGuard: g.stdout.trim() };
writeFileSync(join(work, "PIN.json"), JSON.stringify(pin, null, 2) + "\n");
console.log(`TFT 2,8″ séquence ${seq} : ${data.length} o, SHA-256 ${sha}\nflash ${pin.flashBytes} o (${pin.flashPercent} %), RAM statique ${pin.staticRamBytes} o (${pin.staticRamPercent} %)\n${pin.wifiGuard}\nsortie : ${out}\npin : ${join(work, "PIN.json")}`);
