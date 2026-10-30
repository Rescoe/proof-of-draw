// build-r4-station.mjs — construit la station R4 TFT 1,8″ (arduino_uno_r4/pod_uno_r4_tft18_env) en mode PUBLIABLE : Wi-Fi hors binaire (POD_WIFI_PORTAL=1), client OTA actif, jamais de secrets.h.
//   node ota-lab/r4-ota5/tools/build-r4-station.mjs --seq <N> --keys-dir <dossier r4-a.pub/r4-b.pub> [--extra "POD_X=1 ..."] [--out canary-builds/r4-station]
// 1. copie le sketch SANS secrets.h ni pod_build_flags.h (jamais) ; 2. écrit pod_build_flags.h (POD_SENSORS, POD_ENV_DISPLAY, POD_SD_CS_PIN=4, POD_OTA_R4=1, POD_WIFI_PORTAL=1, OTAR4_COMPILED_SEQ) et l'en-tête des clés PUBLIQUES ;
// 3. compile (arduino-cli, cœur renesas_uno) ; 4. wifi-guard.mjs sur le .bin ET le dossier de build (échec = aucun fichier de sortie conservé) ; 5. écrit un pin public (SHA-256, tailles, options exactes).
import { cpSync, mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync, rmSync, statSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";

const HERE = dirname(fileURLToPath(import.meta.url)), ROOT = resolve(HERE, "..", "..", "..");
const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const die = (m) => { console.error("REFUSÉ : " + m); process.exit(1); };
const seq = Number(arg("--seq")); if (!Number.isInteger(seq) || seq < 1) die("--seq <entier ≥ 1> requis (strictement supérieur à la plus haute séquence déjà installée)");
const keysDir = arg("--keys-dir"); if (!keysDir || !existsSync(join(keysDir, "r4-a.pub")) || !existsSync(join(keysDir, "r4-b.pub"))) die("--keys-dir : dossier avec r4-a.pub et r4-b.pub (clés PUBLIQUES)");
const SRC = join(ROOT, "arduino_uno_r4", "pod_uno_r4_tft18_env");
const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
const work = resolve(arg("--out", join(ROOT, "canary-builds", "r4-station")), stamp), sk = join(work, "pod_uno_r4_tft18_env"), out = join(work, "out");
mkdirSync(sk, { recursive: true });
for (const f of readdirSync(SRC)) { if (f === "secrets.h" || f === "pod_build_flags.h" || f === "pod_ota_r4_keys.h") continue; cpSync(join(SRC, f), join(sk, f), { recursive: true }); }
const hex = (id) => readFileSync(join(keysDir, id + ".pub"), "utf8").trim();
writeFileSync(join(sk, "pod_ota_r4_keys.h"), `// GÉNÉRÉ par build-r4-station.mjs : clés PUBLIQUES de publication OTA R4 (aucune graine privée).\n#pragma once\n#define OTAR4_PUB_A_HEX "${hex("r4-a")}"\n#define OTAR4_PUB_B_HEX "${hex("r4-b")}"\n`);
const opts = ["POD_SENSORS=1", "POD_ENV_DISPLAY=1", "POD_SD_CS_PIN=4", "POD_OTA_R4=1", "POD_WIFI_PORTAL=1", `OTAR4_COMPILED_SEQ=${seq}`, ...(arg("--extra", "") ? arg("--extra").split(/\s+/) : [])];
writeFileSync(join(sk, "pod_build_flags.h"), "// GÉNÉRÉ par build-r4-station.mjs (jamais commité) : station publiable, Wi-Fi hors binaire.\n" + opts.map((o) => `#define ${o.replace("=", " ")}`).join("\n") + "\n");
const IDE = process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, "Programs", "Arduino IDE", "resources", "app", "lib", "backend", "resources", "arduino-cli.exe") : "";
const cli = process.env.ARDUINO_CLI || (IDE && existsSync(IDE) ? IDE : "arduino-cli");
const FQBN = "arduino:renesas_uno:unor4wifi";
const r = spawnSync(cli, ["compile", "--fqbn", FQBN, "--output-dir", out, sk], { encoding: "utf8", timeout: 900000, maxBuffer: 50_000_000 });
const log = (r.stdout ?? "") + (r.stderr ?? "");
if (r.status !== 0) die("compilation en échec\n" + log.slice(-600));
const bin = join(out, "pod_uno_r4_tft18_env.ino.bin");
const g = spawnSync(process.execPath, [join(HERE, "wifi-guard.mjs"), "--bin", bin, "--build-dir", sk, ...process.argv.slice(2).flatMap((x, i, all) => (x === "--forbid-file" || x === "--forbid-secrets" ? [x, all[i + 1]] : []))], { encoding: "utf8" });
if (g.status !== 0) { rmSync(out, { recursive: true, force: true }); die("wifi-guard : " + (g.stderr || g.stdout).trim()); }
const data = readFileSync(bin), sha = createHash("sha256").update(data).digest("hex");
const flash = /Le croquis utilise (\d+) octets \((\d+)%\)/.exec(log) ?? /Sketch uses (\d+) bytes \((\d+)%\)/.exec(log), ram = /variables globales utilisent (\d+) octets \((\d+)%\)/.exec(log) ?? /Global variables use (\d+) bytes \((\d+)%\)/.exec(log);
const fw = [...readFileSync(join(sk, "pod_uno_r4_tft18_env.ino"), "utf8").matchAll(/#define FIRMWARE_VERSION +"([^"]+)"/g)].map((m) => m[1]).pop() ?? "?";   // dernière définition = celle du mode portail (#undef puis #define)
const pin = { fqbn: FQBN, firmwareVersion: fw, family: "uno-r4-wifi-tft18", channel: "canary", OTAR4_COMPILED_SEQ: seq, options: opts.join(" "), bytes: data.length, sha256: sha, flashBytes: flash ? Number(flash[1]) : null, ramGlobalBytes: ram ? Number(ram[1]) : null, wifiGuard: g.stdout.trim().replace(/\s+/g, " ") };
writeFileSync(join(work, "PIN.json"), JSON.stringify(pin, null, 2) + "\n");
console.log(`station ${fw} séquence ${seq} : ${data.length} o, SHA-256 ${sha}\n${pin.wifiGuard}\nsortie : ${out}\npin : ${join(work, "PIN.json")}`);
