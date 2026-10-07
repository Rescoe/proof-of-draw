import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { compileHarness, describeChoice, findCompiler, runProcess } from "./helpers/cppHarness";
import { buildAnimVectors } from "./helpers/animV3Vectors";

// Lot 6B-1 — NOYAU C++ « pod-anim-v3 » (consensus-pod/src/podAnimV3.h) : parité BIT À BIT avec la référence TypeScript (lib/animV3.ts) sur plus de 200 clips lus par morceaux irréguliers, Merkle de 1 à 64
// feuilles, feuilles d'images, racines, règles A1, messages de vote d'animation et bloc v2 à rulesVersion variable. Sans g++, la partie différentielle est IGNORÉE et le dit (jamais faussement verte).
const root = path.join(__dirname, "..");
const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8").replace(/\r\n/g, "\n");
const choice = findCompiler();
console.log(`[podAnimV3] ${describeChoice(choice)}`);
const skip = choice.path ? false : `${describeChoice(choice)} — vérification différentielle du noyau d'animation IGNORÉE (ni verte, ni réussie)`;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "podanim-"));
const exe = path.join(tmp, process.platform === "win32" ? "anim_harness.exe" : "anim_harness");
const vectors = path.join(root, "consensus-pod", "test-vectors", "anim-vectors.txt");
let compiled = false;
function ensureCompiled() { if (!compiled && choice.path) { console.log(`[podAnimV3] ${compileHarness(choice.path, path.join(root, "consensus-pod", "host", "anim_harness.cpp"), exe)}`); compiled = true; } }

test("NOYAU C++ (g++ -Wall -Wextra -Werror) == TypeScript : ≥ 200 clips en flux (morceaux de 1 à 1 024 octets), Merkle 1-64, feuilles, animRoot, règles A1, message de vote, bloc v2 (rulesVersion 1 et 2)", { skip }, () => {
  ensureCompiled();
  const r = runProcess(exe, [vectors]);
  assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
  const m = /^PASS (\d+)$/m.exec(r.stdout);
  assert.ok(m && Number(m[1]) > 2500, `vérifications conformes : ${m?.[1]}`);
  assert.ok(buildAnimVectors().clips.length >= 200);
});

test("CONTRÔLE NÉGATIF : une modification d'un caractère est détectée (valeur attendue OU octet du clip), une commande inconnue est une erreur", { skip }, () => {
  ensureCompiled();
  const lines = fs.readFileSync(vectors, "utf8").split("\n");
  const flip = (c: string) => (c === "0" ? "1" : "0");
  const cases: Array<[string, (l: string) => string]> = [
    ["aclip", (l) => { const t = l.split(" "); t[6] = t[6].replace(/.$/, flip); return t.join(" "); }],                 // animRoot attendu
    ["aclip", (l) => { const t = l.split(" "); t[1] = t[1].slice(0, 2400) + flip(t[1][2400]) + t[1].slice(2401); return t.join(" "); }],   // un octet DU CLIP (la CRC doit refuser ⇒ plus du tout la valeur attendue)
    ["aleaf", (l) => l.replace(/.$/, flip)],
    ["amerkle", (l) => l.replace(/.$/, flip)],
    ["aroot", (l) => l.replace(/.$/, flip)],
    ["arule", (l) => l.replace(/ (ok|static|noise|hash|format)$/, " rules")],
    ["avote", (l) => l.replace("pod-vote-v3-anim", "pod-vote-v3")],
    ["ablock", (l) => l.replace(/.$/, (c) => (c === "a" ? "b" : "a"))],
    ["ablockbad", (l) => l.replace(/ \d+$/, " 1")],
  ];
  for (const [cmd, mutate] of cases) {
    const i = lines.findIndex((l, k) => l.startsWith(cmd + " ") && !(cmd === "aclip" && (!lines[k].split(" ")[1] || lines[k].split(" ")[1].length < 2500 || lines[k].split(" ")[2] === "format")));
    assert.ok(i >= 0, cmd);
    const bad = [...lines]; bad[i] = mutate(bad[i]);
    assert.notEqual(bad[i], lines[i], `mutation de « ${cmd} » sans effet`);
    const f = path.join(tmp, `bad-${cmd}-${i}.txt`); fs.writeFileSync(f, bad.join("\n"));
    const r = runProcess(exe, [f]);
    assert.equal(r.status, 1, `${cmd} : la modification aurait dû être détectée\n${r.stdout}`);
    assert.match(r.stdout, /ÉCART ligne/);
  }
  const unknown = path.join(tmp, "unknown.txt"); fs.writeFileSync(unknown, "inconnue 1 2 3\n");
  assert.equal(runProcess(exe, [unknown]).status, 1);
  const malformed = path.join(tmp, "malformed.txt"); fs.writeFileSync(malformed, "aclip - ok\n");
  assert.equal(runProcess(exe, [malformed]).status, 1, "une ligne mal formée est une erreur");
});

test("portabilité de podAnimV3.h : ni String, ni allocation, ni printf, ni STL, ni E/S, ni Arduino.h ; seul consensusPoD.h est inclus ; aucun tampon statique dans le noyau (l'objet appartient à l'appelant)", () => {
  const src = read("consensus-pod/src/podAnimV3.h").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  for (const bad of [/\bString\b/, /\bmalloc\b|\bfree\(/, /\bnew\b/, /\bprintf\b|\bsnprintf\b/, /std::/, /#include <Arduino/, /\bSerial\b/, /\bdelay\(/, /\bWiFi/, /\bfetch\b/, /\bfloat\b|\bdouble\b/, /\bmillis\(/]) assert.doesNotMatch(src, bad, String(bad));
  assert.deepEqual([...src.matchAll(/#include\s+[<"]([^>"]+)[>"]/g)].map((m) => m[1]), ["consensusPoD.h"]);
  assert.doesNotMatch(src, /^\s*static\s+(?!inline|const)[A-Za-z_0-9<> ]+\s+\w+(\[[^\]]*\])?\s*;/m, "aucune variable statique dans le noyau");
});

test("mémoire : l'automate de flux tient dans ~2 Ko (image 1 024 o + métriques + 7 hachages + contextes SHA), vérifié à la compilation (static_assert) ; aucun firmware ne l'utilise (6B-1)", () => {
  const h = read("consensus-pod/host/anim_harness.cpp");
  assert.match(h, /static_assert\(sizeof\(PodAnimStream<Sha>\) <= 2304/);
  assert.match(read("consensus-pod/src/podAnimV3.h"), /uint8_t frame_\[POD_ANIM_FRAME_BYTES\]/);
  for (const dir of ["esp8266", "arduino_uno_r4"]) {
    const walk = (d: string): string[] => fs.readdirSync(path.join(root, d), { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(d, e.name)) : /\.(ino|h|cpp)$/.test(e.name) ? [path.join(d, e.name)] : []);
    for (const f of walk(dir)) assert.doesNotMatch(fs.readFileSync(path.join(root, f), "utf8"), /podAnimV3/, f);
  }
});
