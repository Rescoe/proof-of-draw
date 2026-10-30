// tests/buildToolsReproducible.test.ts — les outils de reconstruction suivis (ota-lab/esp8266-canary + esp8266-ota2) sont génériques : aucun chemin de PC, aucun secret, options reproductibles, pins publics.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const read = (f: string) => fs.readFileSync(f, "utf8").replace(/\r\n/g, "\n");
const TOOLS = ["ota-lab/esp8266-canary/tools/build-bwr.mjs", "ota-lab/esp8266-canary/canary/build.mjs", "ota-lab/esp8266-ota2/tools/configure.mjs", "ota-lab/esp8266-ota2/tools/lib.mjs"];

test("outils de build : aucun chemin personnel ni secret en dur", () => {
  for (const f of TOOLS) {
    const s = read(f);
    assert.doesNotMatch(s, /C:[\\/]+Users[\\/]+[A-Za-z0-9_.-]+/i, `${f} : chemin propre à un PC`);
    assert.doesNotMatch(s, /PRIVATE KEY|SECRET_WIFI_(SSID|PASS)\w*\s+"[^"]|password\s*[:=]\s*["'][^"']+/i, `${f} : secret`);
  }
});

test("outils de build : arduino-cli par variable d'environnement / IDE de l'utilisateur / PATH ; clés privées jamais lues ; build hors sketch (copie)", () => {
  const b = read("ota-lab/esp8266-canary/canary/build.mjs");
  assert.match(b, /process\.env\.ARDUINO_CLI/);
  assert.match(b, /process\.env\.LOCALAPPDATA/);
  assert.match(b, /"arduino-cli"/);
  assert.match(b, /RELEASE_KEYS_DIR = join\(homedir\(\), "\.pod-ota-release"\)/, "dossier de clés hors du dépôt");
  const t = read("ota-lab/esp8266-canary/tools/build-bwr.mjs");
  assert.doesNotMatch(t, /\.private\.pem/, "le build ne lit jamais une clé privée");
  assert.match(t, /f !== "secrets\.h" \|\| MIG/, "secrets.h n'est jamais copié hors build de migration locale");
  assert.match(t, /--define/); assert.match(t, /--src/); assert.match(t, /--chunk/); assert.match(t, /--display/);
  assert.match(t, /clés publiques de publication absentes/, "repli sur l'en-tête public suivi du sketch");
});

test("pins de build suivis : publics, sans secret, champs complets", () => {
  const dir = "ota-lab/esp8266-canary";
  const pins = fs.readdirSync(dir).filter((f) => /BUILD-PIN\.json$/.test(f));
  assert.ok(pins.length >= 8, "pins BWR suivis");
  for (const f of pins) {
    const raw = read(path.join(dir, f));
    assert.doesNotMatch(raw, /password|passwd|PRIVATE KEY|token|"ssid"/i, `${f} : secret`);
    const j = JSON.parse(raw);
    assert.ok(typeof j.version === "string" || f === "PORTAL-BUILD-PIN.json", `${f} : version`);
    if (j.sha) assert.match(j.sha, /^[0-9a-f]{64}$/, `${f} : SHA-256 complet`);
  }
  assert.ok(!fs.existsSync(path.join(dir, "MS27-OTA-MIG-BUILD-PIN.json")), "pas de pin de build de migration locale (le binaire contient le Wi-Fi)");
});

test(".gitignore : canary-builds, artefacts et binaires de banc restent hors Git", () => {
  const g = read(".gitignore");
  assert.match(g, /canary-builds/);
});
