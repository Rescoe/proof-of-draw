import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { compileHarness, describeChoice, findCompiler, runProcess } from "./helpers/cppHarness";

// Lot 8A — PORT C++ du rasteriseur (consensus-pod/src/podRender.h) vérifié OCTET PAR OCTET contre les vecteurs d'or de la référence TypeScript.
// Sans g++, la partie différentielle est IGNORÉE et le dit (jamais faussement verte). Référence logicielle : jamais essayée sur un écran.
const root = path.join(__dirname, "..");
const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8").replace(/\r\n/g, "\n");
const choice = findCompiler();
console.log(`[podRender] ${describeChoice(choice)}`);
const skip = choice.path ? false : `${describeChoice(choice)} — vérification différentielle du rasteriseur IGNORÉE (ni verte, ni réussie)`;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "podrender-"));
const exe = path.join(tmp, process.platform === "win32" ? "render_harness.exe" : "render_harness");
const vectors = path.join(root, "consensus-pod", "test-vectors", "render-vectors.txt");
let compiled = false;
function ensureCompiled() { if (!compiled && choice.path) { console.log(`[podRender] ${compileHarness(choice.path, path.join(root, "consensus-pod", "host", "render_harness.cpp"), exe)}`); compiled = true; } }

test("RASTERISEUR C++ (g++ -Wall -Wextra -Werror) == TypeScript : police, repli des accents, ≥ 220 rendus (3 modes × 5 écrans), frameHash ET renderHash identiques", { skip }, () => {
  ensureCompiled();
  const r = runProcess(exe, [vectors]);
  assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
  const m = /^PASS (\d+) \(rvec=(\d+) rtext=(\d+)\)$/m.exec(r.stdout);
  assert.ok(m, r.stdout);
  assert.ok(Number(m[1]) >= 480 && Number(m[2]) >= 220 && Number(m[3]) >= 30, `vérifications : ${m[0]}`);
});

test("CONTRÔLE NÉGATIF : un caractère modifié (frameHash, renderHash, texte replié, police), un mode ou une commande inconnue est détecté", { skip }, () => {
  ensureCompiled();
  const lines = fs.readFileSync(vectors, "utf8").split("\n");
  const flip = (c: string) => (c === "0" ? "1" : "0");
  const cases: Array<[string, (l: string) => string]> = [
    ["rvec", (l) => { const t = l.split(" "); t[9] = t[9].replace(/.$/, flip); return t.join(" "); }],                        // frameHash
    ["rvec", (l) => l.replace(/.$/, flip)],                                                                                     // renderHash
    ["rvec", (l) => { const t = l.split(" "); t[4] = t[4] === "fit" ? "overlay" : "fit"; return t.join(" "); }],             // mode : le rendu change
    ["rvec", (l) => { const t = l.split(" "); t[5] = String(Number(t[5]) + 1); return t.join(" "); }],                       // n° de bloc gravé
    ["rtext", (l) => l.replace(/.$/, (c) => (c === "0" ? "1" : "0"))],
    ["rfont", (l) => l.replace(/.$/, flip)],
  ];
  for (const [cmd, mutate] of cases) {
    // première ligne dont la mutation change vraiment le résultat attendu (renderHash d'un mode « hidden » ne dépend pas du n° de bloc, etc.) : on teste toutes jusqu'à la première détectée
    const idx = lines.map((l, i) => (l.startsWith(cmd + " ") && l.split(" ")[4] !== "hidden" ? i : -1)).filter((i) => i >= 0);
    assert.ok(idx.length, cmd);
    let detected = false;
    for (const i of idx.slice(0, 6)) {
      const bad = [...lines]; bad[i] = mutate(bad[i]);
      if (bad[i] === lines[i]) continue;
      const f = path.join(tmp, `bad-${cmd}-${i}.txt`); fs.writeFileSync(f, bad.join("\n"));
      const r = runProcess(exe, [f]);
      if (r.status === 1 && /ÉCART/.test(r.stdout)) { detected = true; break; }
    }
    assert.ok(detected, `${cmd} : la modification aurait dû être détectée`);
  }
  const unknown = path.join(tmp, "unknown.txt"); fs.writeFileSync(unknown, "inconnue 1 2 3\n");
  assert.equal(runProcess(exe, [unknown]).status, 1);
  const malformed = path.join(tmp, "malformed.txt"); fs.writeFileSync(malformed, "rvec eink29bwr white\n");
  assert.equal(runProcess(exe, [malformed]).status, 1, "une ligne mal formée est une erreur");
  const badMode = path.join(tmp, "badmode.txt"); fs.writeFileSync(badMode, "rvec eink29bwr white 1 diagonal 1 - - - " + "0".repeat(64) + " " + "0".repeat(64) + "\n");
  assert.equal(runProcess(exe, [badMode]).status, 1, "mode inconnu = erreur");
  const empty = path.join(tmp, "empty.txt"); fs.writeFileSync(empty, "# rien\n");
  assert.equal(runProcess(exe, [empty]).status, 1, "fichier de vecteurs vide = échec (jamais faussement vert)");
});

test("portabilité de podRender.h : ni String, ni allocation, ni printf, ni STL, ni E/S, ni Arduino.h, ni flottant ; seul consensusPoD.h est inclus ; aucune variable statique modifiable (tampons fournis par l'appelant)", () => {
  const src = read("consensus-pod/src/podRender.h").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  for (const bad of [/\bString\b/, /\bmalloc\b|\bfree\(/, /\bnew\b/, /\bprintf\b|\bsnprintf\b/, /std::/, /#include <Arduino/, /\bSerial\b/, /\bdelay\(/, /\bWiFi/, /\bfetch\b/, /\bfloat\b|\bdouble\b/, /\bmillis\(/, /\bfopen\b|\bFILE\b/]) assert.doesNotMatch(src, bad, String(bad));
  assert.deepEqual([...src.matchAll(/#include\s+[<"]([^>"]+)[>"]/g)].map((m) => m[1]), ["consensusPoD.h"]);
  assert.doesNotMatch(src, /^\s*static\s+(?!inline|const)[A-Za-z_0-9<> ]+\s+\w+(\[[^\]]*\])?\s*;/m, "aucune variable statique modifiable");
});

test("8A = référence : le harnais est le SEUL consommateur de podRender.h (aucun .ino, aucune route) ; lecture seule des vecteurs", () => {
  const walk = (d: string): string[] => fs.readdirSync(path.join(root, d), { withFileTypes: true }).flatMap((e) => e.name === "node_modules" || e.name === ".next" || e.name === ".claude" ? [] : e.isDirectory() ? walk(path.join(d, e.name)) : /\.(ino|h|cpp|ts|tsx)$/.test(e.name) ? [path.join(d, e.name)] : []);
  const users = ["esp8266", "arduino_uno_r4", "app", "lib", "consensus-pod"].flatMap(walk).filter((f) => /podRender\.h/.test(fs.readFileSync(path.join(root, f), "utf8"))).map((f) => f.replace(/\\/g, "/")).filter((f) => f !== "lib/renderLayout.ts" && f !== "consensus-pod/src/podRender.h" && !f.startsWith("tests/"));
  const canary = ["esp8266/esp_eink_2.9BWR/", "esp8266/esp_tft1.8/", "arduino_uno_r4/pod_uno_r4_eink29/", "arduino_uno_r4/pod_uno_r4_tft18/"];   // lot 8B-2A : copies du noyau dans les 4 dossiers canaris SEULEMENT (sketch compilé avec POD_RENDER_V1 = 0 par défaut)
  assert.deepEqual(users.filter((u) => !canary.some((c) => u.startsWith(c))).sort(), ["consensus-pod/host/render_harness.cpp", "consensus-pod/host/render_stream_harness.cpp", "consensus-pod/src/podRenderStream.h"]);   // 8B-1 : le noyau en flux (et son harnais) réutilisent police, texte, géométrie
});
