import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { compileHarness, describeChoice, findCompiler, runProcess } from "./helpers/cppHarness";
import { SELFTEST, buildSelfTestHeader, expectedFor, selfTestCases } from "./helpers/animSelfTestHeader";

// Lot 6C — auto-tests embarqués de l'automate pod-anim-v3 (ESP8266 et UNO R4) : MÊME logique que sur les cartes, exécutée sur le PC avec le VRAI noyau ; les exemples sont COMPILÉS par arduino-cli
// (non rejoués ici : sans arduino-cli le test ne les compile pas et ne prétend rien). Aucun .ino de production, aucune variable, aucun Redis.
const root = path.join(__dirname, "..");
const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8").replace(/\r\n/g, "\n");
const choice = findCompiler();
console.log(`[animSelfTest] ${describeChoice(choice)}`);
const skip = choice.path ? false : `${describeChoice(choice)} — exécution hôte de l'auto-test IGNORÉE (ni verte, ni réussie)`;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "animselftest-"));
const exe = path.join(tmp, process.platform === "win32" ? "anim_selftest_host.exe" : "anim_selftest_host");
let compiled = false;
function ensureCompiled() { if (!compiled && choice.path) { console.log(`[animSelfTest] ${compileHarness(choice.path, path.join(root, "consensus-pod", "host", "anim_selftest_host.cpp"), exe)}`); compiled = true; } }

test("en-tête généré : le fichier commité est EXACTEMENT ce que produit la référence TypeScript ; 9 cas couvrent toutes les situations exigées par le lot 6C", () => {
  assert.equal(read("consensus-pod/src/podAnimV3_selftest.h"), buildSelfTestHeader(), "régénérer : node --import tsx scripts/gen-anim-selftest.ts");
  const cases = selfTestCases();
  const byName = new Map(cases.map((c) => [c.name, expectedFor(c)]));
  assert.equal(byName.get("valide-2-images")!.rule, "ok"); assert.equal(byName.get("valide-2-images")!.a.N, 2);
  assert.equal(byName.get("valide-64-images")!.rule, "ok"); assert.equal(byName.get("valide-64-images")!.a.N, 64);
  assert.equal(byName.get("statique")!.rule, "static");
  assert.equal(byName.get("alternance-noir-blanc")!.rule, "ok"); assert.equal(byName.get("alternance-noir-blanc")!.a.E, 0, "images uniformes qui diffèrent : acceptée");
  assert.equal(byName.get("bruit")!.rule, "noise");
  for (const n of ["crc-altérée", "corps-altéré", "tronqué"]) assert.equal(byName.get(n)!.rule, "format", n);
  assert.equal(byName.get("racine-annoncée-fausse")!.rule, "hash");
  // tous les messages `pod-vote-v3-anim` attendus sont canoniques et de la bonne forme
  for (const [n, e] of byName) { const msg = e.line.split("|").slice(11).join("|"); assert.match(msg, /^pod-vote-v3-anim\|dev_AB12CD34\|/, n); }
  assert.ok(cases.every((c) => c.data.length <= 9216), "aucun clip n'excède 9 216 octets");
  assert.ok(Math.max(...cases.map((c) => c.data.length)) > 4096, "le plus gros clip dépasse 4 Ko : il ne tiendrait pas dans les tampons de l'auto-test s'il était chargé en entier");
  assert.deepEqual(SELFTEST.fragments, [1, 7, 61, 256]);
});

test("AUTO-TEST HÔTE (même fichier podAnimSelfTest.h que les exemples, g++ -Wall -Wextra -Werror) : 9 cas × 4 découpages = 36 vérifications conformes", { skip }, () => {
  ensureCompiled();
  const r = runProcess(exe, []);
  assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
  assert.match(r.stdout, /\[ANIMTEST\] RESULTAT PASS 36\/36/);
  for (let i = 0; i < 9; i++) assert.match(r.stdout, new RegExp(`\\[ANIMTEST\\] c${i} \\w+ OK 4/4 decoupages`), `cas ${i}`);
  const m = /sizeof\(PodAnimStream\)=(\d+)/.exec(r.stdout); assert.ok(m && Number(m[1]) <= 2048, `sizeof(PodAnimStream) hôte = ${m?.[1]} (≤ 2 048)`);
});

test("CONTRÔLE NÉGATIF : une valeur attendue modifiée (un caractère) fait ÉCHOUER l'auto-test ; un clip altéré aussi (le harnais n'est pas complaisant)", { skip }, () => {
  ensureCompiled();
  const copy = path.join(tmp, "copie"); fs.cpSync(path.join(root, "consensus-pod"), copy, { recursive: true });
  const header = path.join(copy, "src", "podAnimV3_selftest.h"), original = fs.readFileSync(header, "utf8");
  const run = (name: string, mutated: string) => {
    assert.notEqual(mutated, original, name);
    fs.writeFileSync(header, mutated);
    const bin = path.join(tmp, `neg-${name}${process.platform === "win32" ? ".exe" : ""}`);
    compileHarness(choice.path!, path.join(copy, "host", "anim_selftest_host.cpp"), bin);
    return runProcess(bin, []);
  };
  const flip = (c: string) => (c === "0" ? "1" : "0");
  // 1. une valeur attendue (attendu c0 : dernier chiffre du premier hash)
  const exp0 = original.replace(/(POD_ANIMTEST_EXPECT_0\[\] PROGMEM = "ok\|2\|\d+\|\d+\|\d+\|\d+\|\d+\|0\|)([0-9a-f])/, (_m, a, b) => a + flip(b));
  const r1 = run("attendu", exp0); assert.equal(r1.status, 1, r1.stdout); assert.match(r1.stdout, /ECART c0/);
  // 2. un octet du clip (le deuxième tableau d'octets, dans le corps)
  const start = original.indexOf("POD_ANIMTEST_CLIP_0[] PROGMEM = {");
  let at = start; for (let k = 0; k < 150; k++) at = original.indexOf("0x", at + 2);   // le 150ᵉ octet du clip (dans le corps)
  const clip1 = original.slice(0, at + 2) + flip(original[at + 2]) + original.slice(at + 3);
  const r2 = run("clip", clip1); assert.equal(r2.status, 1, r2.stdout); assert.match(r2.stdout, /ECART|ECHEC/);
  fs.writeFileSync(header, original);
});

test("les exemples sont SÉPARÉS des firmwares, avertissent « ne pas déployer / jamais essayé sur la carte », utilisent le VRAI noyau et placent tout l'état en GLOBAL (jamais sur la pile)", () => {
  for (const [dir, adapter, sha] of [["AnimSelfTestEsp8266", "crypto_esp8266.h", "PodSha256Br"], ["AnimSelfTestUnoR4", "crypto_uno_r4.h", "PodSha256Rw"]] as const) {
    const f = `consensus-pod/examples/${dir}/${dir}.ino`, src = read(f);
    assert.match(src, /NE PAS DÉPLOYER/); assert.match(src, /COMPILÉ seulement, JAMAIS essayé sur la carte/);
    assert.ok(src.includes(`#include "adapters/${adapter}"`) && src.includes('#include "podAnimSelfTest.h"') && src.includes(`typedef ${sha} Sha;`));
    assert.match(src, /static PodAnimTestWork<Sha> W;/, "état de l'auto-test = objet global/static");
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    const fn = code.slice(code.indexOf("void setup()"));
    assert.doesNotMatch(fn, /PodAnimStream</, "aucun automate en variable locale"); assert.doesNotMatch(fn, /PodAnimTestWork</, "aucun état de test en variable locale");
    assert.doesNotMatch(code, /br_sha256|SHA256 \w+;|WiFi|http|secrets/i, "aucune réimplémentation du SHA ni réseau ni secret dans l'exemple");
    assert.ok(!/HTTPClient|WiFiClient|WiFi\.begin/.test(code));
  }
  assert.match(read("consensus-pod/examples/AnimSelfTestUnoR4/AnimSelfTestUnoR4.ino"), /PILE PRINCIPALE DE ~1 Ko/);
  // le runner : fragment de 256 octets, jamais le clip entier ; aucun tampon ≥ 1 Ko hors de l'automate lui-même
  const runner = read("consensus-pod/src/podAnimSelfTest.h").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  assert.match(runner, /#define POD_ANIMTEST_FRAG_MAX 256/);
  const arrays = [...runner.matchAll(/\b(?:uint8_t|char)\s+\w+\[(\w+|\d+)\]/g)].map((m) => (Number.isNaN(Number(m[1])) ? (m[1] === "POD_ANIMTEST_FRAG_MAX" ? 256 : 0) : Number(m[1])));
  assert.ok(arrays.every((n) => n <= 768), `tampons du runner : ${arrays}`);
  assert.doesNotMatch(runner, /9216|MAX_CLIP\]/, "aucun tampon de la taille du clip");
  assert.match(runner, /POD_ANIMTEST_READ\(w->frag, k\.clip \+ off, n\)/, "lecture par FRAGMENTS de la flash vers un tampon de 256 octets");
});

test("aucun firmware de production, aucune route de vote/finalisation, aucune variable ni secret modifiés : l'auto-test et les adaptateurs sont du code de VALIDATION ; le noyau d'animation reste inutilisé par les firmwares", () => {
  const walk = (dir: string): string[] => fs.readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(dir, e.name)) : /\.(ino|h|cpp)$/.test(e.name) ? [path.join(dir, e.name).replace(/\\/g, "/")] : []);
  // lot 8B-2A : le noyau de RENDU (copies de consensusPoD.h dans 4 dossiers canaris, inactif par défaut) est autorisé là ; le noyau d'ANIMATION ne l'est nulle part
  const canary = ["esp8266/esp_eink_2.9BWR/", "esp8266/esp_tft1.8/", "arduino_uno_r4/pod_uno_r4_eink29/", "arduino_uno_r4/pod_uno_r4_tft18/", "esp8266/esp_eink_2.7BW/", "esp8266/esp_eink_2.7BW_OLED/", "arduino_uno_r4/pod_uno_r4_eink27/", "arduino_uno_r4/pod_uno_r4_eink27_oled/"];
  for (const f of [...walk("esp8266"), ...walk("arduino_uno_r4")]) {
    assert.doesNotMatch(read(f), /podAnim|PodAnim|podAnimSelfTest|AnimSelfTest/, f);
    if (!canary.some((c) => f.startsWith(c))) assert.doesNotMatch(read(f), /consensusPoD/, f);
  }
  const adapters = (read("consensus-pod/src/adapters/crypto_esp8266.h") + read("consensus-pod/src/adapters/crypto_uno_r4.h")).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  assert.doesNotMatch(adapters, /Serial|WiFi|malloc|new /);
  // le script de génération ne touche qu'à consensus-pod/src
  assert.match(read("scripts/gen-anim-selftest.ts"), /consensus-pod", "src", "podAnimV3_selftest\.h"/);
});
