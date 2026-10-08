import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { compileHarness, describeChoice, findCompiler, runProcess } from "./helpers/cppHarness";
import { buildConsensusVectors } from "./helpers/consensusPodVectors";

// Lot 5 — NOYAU C++ consensusPoD.h : parité BIT À BIT avec la référence TypeScript (lib/podProtocolV3.ts) sur des centaines de vecteurs, et garde-fous de portabilité (pas de String,
// d'allocation, de printf ni d'E/S). Sans g++, la partie différentielle est IGNORÉE et le dit (jamais faussement verte).
const root = path.join(__dirname, "..");
const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8").replace(/\r\n/g, "\n");

const choice = findCompiler();
console.log(`[consensusPod] ${describeChoice(choice)}`);
const skip = choice.path ? false : `${describeChoice(choice)} — vérification différentielle du noyau C++ IGNORÉE (ni verte, ni réussie)`;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "consensuspod-"));
const exe = path.join(tmp, process.platform === "win32" ? "core_harness.exe" : "core_harness");
const vectors = path.join(root, "consensus-pod", "test-vectors", "vectors.txt");
let compiled = false;
function ensureCompiled() { if (!compiled && choice.path) { console.log(`[consensusPod] ${compileHarness(choice.path, path.join(root, "consensus-pod", "host", "core_harness.cpp"), exe)}`); compiled = true; } }

test("vecteurs : les fichiers commités sont EXACTEMENT ce que produit la référence TypeScript (tout changement de protocole doit les régénérer volontairement)", () => {
  const { vectorsTxt, selftestH } = buildConsensusVectors();
  assert.equal(read("consensus-pod/test-vectors/vectors.txt"), vectorsTxt);
  assert.equal(read("consensus-pod/src/consensusPoD_selftest.h"), selftestH);
  assert.ok(vectorsTxt.split("\n").length > 400, "plusieurs centaines de vérifications");
  for (const cmd of ["sha256hex", "rule", "nonce", "salted", "message", "leaf", "merkle", "cseed", "crank", "decide", "miner", "block"]) assert.match(vectorsTxt, new RegExp(`^${cmd} `, "m"), cmd);
});

test("NOYAU C++ (g++ -Wall -Wextra -Werror) == TypeScript : SHA-256 (bords de blocs), règles, nonce, hash salé en flux, message v3, feuilles, Merkle 0-14, graine/rang, sièges, mineur, bloc v2", { skip }, () => {
  ensureCompiled();
  const r = runProcess(exe, [vectors]);
  assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
  const m = /^PASS (\d+)$/m.exec(r.stdout);
  assert.ok(m && Number(m[1]) > 1000, `vérifications conformes : ${m?.[1]}`);
});

test("CONTRÔLE NÉGATIF : un seul caractère modifié dans les vecteurs est détecté (le harnais n'est pas complaisant)", { skip }, () => {
  ensureCompiled();
  const lines = fs.readFileSync(vectors, "utf8").split("\n");
  const cases: Array<[string, (l: string) => string]> = [
    ["merkle", (l) => l.replace(/.$/, (c) => (c === "0" ? "1" : "0"))],
    ["block", (l) => l.replace(/.$/, (c) => (c === "a" ? "b" : "a"))],
    ["decide", (l) => l.replace(/ (\d)$/, (_m, d) => ` ${(Number(d) + 1) % 8}`)],
    ["miner", (l) => l.replace(/ [0-9a-f]{64}$/, " " + "0".repeat(64))],
    ["message", (l) => l.replace("pod-vote-v3", "pod-vote-v2")],
    ["rule", (l) => l.replace(/ (ok|uniform|noise|hash|format)$/, " rules")],
  ];
  for (const [cmd, mutate] of cases) {
    const i = lines.findIndex((l) => l.startsWith(cmd + " "));
    assert.ok(i >= 0, cmd);
    const bad = [...lines]; bad[i] = mutate(bad[i]);
    assert.notEqual(bad[i], lines[i], `mutation de « ${cmd} » sans effet`);
    const f = path.join(tmp, `bad-${cmd}.txt`); fs.writeFileSync(f, bad.join("\n"));
    const r = runProcess(exe, [f]);
    assert.equal(r.status, 1, `${cmd} : la modification aurait dû être détectée\n${r.stdout}`);
    assert.match(r.stdout, /ÉCART ligne/);
  }
  const unknown = path.join(tmp, "unknown.txt"); fs.writeFileSync(unknown, "inconnue 1 2 3\n");
  assert.equal(runProcess(exe, [unknown]).status, 1, "une commande inconnue est une erreur, jamais ignorée");
});

test("portabilité : le noyau n'utilise ni String, ni allocation, ni printf, ni STL, ni E/S, ni Arduino.h ; seuls <stdint.h> <stddef.h> <string.h> et pod_metrics.h", () => {
  const src = read("consensus-pod/src/consensusPoD.h").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  for (const bad of [/\bString\b/, /\bmalloc\b|\bfree\(/, /\bnew\b/, /\bprintf\b|\bsnprintf\b/, /std::/, /#include <Arduino/, /\bSerial\b/, /\bdelay\(/, /\bWiFi/, /\bfetch\b/]) assert.doesNotMatch(src, bad, String(bad));
  const includes = [...src.matchAll(/#include\s+[<"]([^>"]+)[>"]/g)].map((m) => m[1]).sort();
  assert.deepEqual(includes, ["pod_metrics.h", "stddef.h", "stdint.h", "string.h"]);
  assert.doesNotMatch(src, /\bstatic\s+(?!inline|const)[A-Za-z_0-9 ]+\[[^\]]*\]\s*;/, "aucun tampon statique dans le noyau : les tampons appartiennent à l'appelant");
});

test("les adaptateurs de SHA-256 : PC (portable), ESP8266 (BearSSL), UNO R4 (Crypto) exposent la même interface begin/update/finish ; seul l'adaptateur PC est compilé par le test", () => {
  for (const [file, cls, needs] of [["crypto_posix.h", "PodSha256Host", ""], ["crypto_esp8266.h", "PodSha256Br", "bearssl/bearssl_hash.h"], ["crypto_uno_r4.h", "PodSha256Rw", "SHA256.h"]] as const) {
    const src = read(`consensus-pod/src/adapters/${file}`);
    assert.match(src, new RegExp(`class ${cls}`)); assert.match(src, /void begin\(\)/); assert.match(src, /void update\(const void\* ?d(ata)?, size_t n\)/); assert.match(src, /void finish\(uint8_t out\[32\]\)/);
    if (needs) assert.ok(src.includes(needs), needs);
  }
});

test("la bibliothèque : structure Arduino (library.properties, src/, examples/), copies d'en-têtes identiques, NON PUBLIÉE (aucune licence ajoutée : décision réservée au porteur)", () => {
  const props = read("consensus-pod/library.properties");
  assert.match(props, /^name=ConsensusPoD$/m); assert.match(props, /^version=0\.0\.1$/m); assert.match(props, /BROUILLON INTERNE, non publié/);
  assert.match(read("consensus-pod/src/consensusPoD.h"), /#define POD_CORE_VERSION\s+"0\.0\.1"/);
  for (const f of ["consensus-pod/examples/SelfTestEsp8266/SelfTestEsp8266.ino", "consensus-pod/examples/SelfTestUnoR4/SelfTestUnoR4.ino"]) assert.match(read(f), /COMPILÉ seulement, JAMAIS essayé sur la carte/);
  assert.equal(fs.existsSync(path.join(root, "consensus-pod", "LICENSE")), false, "le choix de la licence est réservé au porteur");
  assert.match(read("consensus-pod/README.md"), /NON PUBLIÉ/);
});

test("aucun firmware du dépôt n'utilise encore consensusPoD.h (adoption au grand reflash) : les .ino et les en-têtes de firmware restent inchangés par ce lot", () => {
  const offenders: string[] = [];
  const walk = (dir: string) => { for (const e of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const rel = path.join(dir, e.name);
    if (e.isDirectory()) { if (!["node_modules", ".next", ".git", "firmware-backups", ".claude"].includes(e.name)) walk(rel); }
    else if (/\.(ino|h|cpp)$/.test(e.name) && fs.readFileSync(path.join(root, rel), "utf8").includes("consensusPoD")) offenders.push(rel.replace(/\\/g, "/"));
  } };
  for (const d of ["esp8266", "arduino_uno_r4"]) walk(d);
  // lot 8B-2A : seuls les 4 dossiers canaris portent des COPIES du noyau (rendu v1 inactif par défaut, POD_RENDER_V1 = 0) — vérifié par tests/renderFirmware.test.ts
  const canary = ["esp8266/esp_eink_2.9BWR/", "esp8266/esp_tft1.8/", "arduino_uno_r4/pod_uno_r4_eink29/", "arduino_uno_r4/pod_uno_r4_tft18/", "esp8266/esp_eink_2.7BW/", "esp8266/esp_eink_2.7BW_OLED/", "arduino_uno_r4/pod_uno_r4_eink27/", "arduino_uno_r4/pod_uno_r4_eink27_oled/"];
  assert.deepEqual(offenders.filter((o) => !canary.some((c) => o.startsWith(c))), []);
});
