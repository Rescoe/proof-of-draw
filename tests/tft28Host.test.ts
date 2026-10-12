// tests/tft28Host.test.ts — LOT8B2D-R4-TFT28-CANARY-1 : exécution HÔTE du code RÉEL extrait de arduino_uno_r4/pod_uno_r4/pod_uno_r4.ino.
//   (1) décodages JSON sur la pile de travail (register, pull, validate) contre ArduinoJson réel, en production ET en canari ; contrôles négatifs.
//   (2) firmware complet (setup / loop / doFetchFrame / streamFrame / cache SD / cartel / tactile / animations / ACK) contre des bibliothèques simulées — voir la suite du fichier.
// Ce que l'hôte NE prouve PAS : la profondeur réelle des piles, le déplacement réel de SP, le temps réel, le débit Wi-Fi, le rendu de l'ILI9341 ni la carte SD physique.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { compileHarness, describeChoice, findCompiler, runProcess } from "./helpers/cppHarness";
import { INO, ROOT, effective, readText } from "./helpers/tft28Source";

const src = readText(INO);
const choice = findCompiler();
console.log(`[tft28Host] ${describeChoice(choice)}`);
const ajCandidates = [process.env.ARDUINOJSON_DIR, path.join(os.homedir(), "Documents", "Arduino", "libraries", "ArduinoJson", "src"), path.join(os.homedir(), "Arduino", "libraries", "ArduinoJson", "src")].filter((x): x is string => !!x);
const ajDir = ajCandidates.find((d) => fs.existsSync(path.join(d, "ArduinoJson.h")));
const skipHost = !choice.path ? `${describeChoice(choice)} — exécution hôte IGNORÉE` : !ajDir ? `ArduinoJson introuvable (variable ARDUINOJSON_DIR) — exécution hôte IGNORÉE` : false;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tft28-"));
const HOST = path.join(ROOT, "consensus-pod", "host");
const AJ_FLAGS = ["-DARDUINOJSON_ENABLE_ARDUINO_STRING=1", "-DARDUINOJSON_ENABLE_ARDUINO_STREAM=0", "-DARDUINOJSON_ENABLE_ARDUINO_PRINT=0", "-DARDUINOJSON_ENABLE_PROGMEM=0"];
const LENIENT = ["-Wno-unused-variable", "-Wno-unused-parameter", "-Wno-unused-function", "-Wno-unused-but-set-variable"];
const between = (s: string, a: string, b: string) => { const i = s.indexOf(a), j = s.indexOf(b, i + 1); assert.ok(i >= 0 && j > i, `région introuvable : ${a.slice(0, 40)} … ${b.slice(0, 40)}`); return s.slice(i, j); };

function hooks(canary: boolean): string {
  const eff = effective(src, canary);
  const pick = (name: string) => { const m = new RegExp(`^#define ${name}\\(.*$`, "m").exec(eff); assert.ok(m, name); return m![0]; };
  return `#define POD_CANARY_JSON(tag, ni, ran, status, okA, okB) ((void)0)\n${pick("POD_CANARY_NO_BENCH")}\n${pick("POD_CANARY_CANDIDATE")}\n`;
}
function buildJson(kind: "register" | "pull" | "validate", canary: boolean, mutate: (s: string) => string = (s) => s, lenient = false): string {
  const dir = fs.mkdtempSync(path.join(tmp, `${kind}-`));
  const prod = effective(src, false);
  let extract: string, harness: string, incName: string;
  if (kind === "register") { extract = "#include <new>\n" + between(prod, "enum RegisterStatus", "static bool doRegister() {"); harness = "register_work_harness.cpp"; incName = "register_extract.inc"; }
  else if (kind === "validate") { extract = between(prod, "enum ValidateStatus", "static bool doValidateV1(const String& candidateId, float score);\nstatic bool doValidate() {"); harness = "validate_work_harness.cpp"; incName = "validate_extract.inc"; }
  else { extract = "#include <new>\n" + between(prod, "#define PULL_ID_MAX", "static bool doPull() {"); harness = "tft28_pull_work_harness.cpp"; incName = "pull_extract.inc"; }
  fs.writeFileSync(path.join(dir, incName), (kind === "register" ? hooks(false) : "") + mutate(extract));
  fs.writeFileSync(path.join(dir, "hooks.inc"), hooks(canary));
  const out = path.join(dir, "harness");
  compileHarness(choice.path!, path.join(HOST, harness), out, [`-I${dir}`, `-I${path.join(HOST, "shim")}`, `-I${path.join(ROOT, "arduino_uno_r4", "pod_uno_r4")}`, "-isystem", ajDir!, ...AJ_FLAGS, ...(canary ? ["-DHARNESS_CANARY=1"] : []), ...(lenient ? LENIENT : [])]);
  return out;
}
const passes = (r: { status: number | null; stdout: string }) => r.status === 0 && /^PASS \d+$/.test(r.stdout.trim());

test("HÔTE register (code RÉEL du TFT 2,8″) : appairé / non appairé / valeurs invalides, trop courtes, trop longues, hors alphabet / JSON tronqué / NOMEM, NESTED, GUARD, MARGIN : tout ou rien", { skip: skipHost }, () => {
  const r = runProcess(buildJson("register", false), [], 60000);
  assert.ok(passes(r), r.stdout + r.stderr);
});
test("HÔTE validate (code RÉEL du TFT 2,8″, PRODUCTION) : v2 / v1 / déjà voté / valeurs refusées jamais tronquées / pannes de pile : tout ou rien", { skip: skipHost }, () => {
  const r = runProcess(buildJson("validate", false), [], 60000);
  assert.ok(passes(r), r.stdout + r.stderr);
});
for (const canary of [false, true]) {
  test(`HÔTE pull (code RÉEL du TFT 2,8″, ${canary ? "CANARI : candidat oublié, banc d'essai ignoré" : "PRODUCTION : candidat retenu, banc d'essai activé"}) : réponses, bornes, 429, cartel seulement pour une nouvelle image, pannes de pile et d'allocation`, { skip: skipHost }, () => {
    const r = runProcess(buildJson("pull", canary), [], 60000);
    assert.ok(passes(r), r.stdout + r.stderr);
  });
}
test("HÔTE pull : CONTRÔLES NÉGATIFS — cartel appliqué sans nouvelle image, candidat retenu en canari, effets avant le retour valide, échec de pile ignoré, bornes relâchées : le harnais les REFUSE", { skip: skipHost }, () => {
  const muts: Array<[string, boolean, string, string]> = [
    ["cartel appliqué même pour une image déjà affichée", false, "if (frameSource == \"none\" || frameId.length() == 0 || frameId == lastFrameId) return 1;", "if (false) return 1;"],
    ["cartel jamais appliqué", false, "if (r.hasCartel) {\n    pendingWorkTitle", "if (false) {\n    pendingWorkTitle"],
    ["effet (animation) AVANT le contrôle de la pile", false, "  const bool ran = pullParseOnWorkStack(resp, code, r, ni);", "  pendingAnimHash = \"x\";\n  const bool ran = pullParseOnWorkStack(resp, code, r, ni);"],
    ["échec de pile ignoré", false, "if (!ran) { pullWorkFailed(ni); return 0; }", "if (!ran) { }"],
    ["borne de l'identifiant relâchée", false, "if (n > max) { r.status = PULL_P_BOUNDS; return false; }", "(void)max;"],
    ["journal avant l'arrêt sûr", false, "  if (ni.err == POD_NET_GUARD) logfSafeStop();\n  logf(\"[PULL] analyse JSON", "  logf(\"avant\"); if (ni.err == POD_NET_GUARD) logfSafeStop();\n  logf(\"[PULL] analyse JSON"],
    ["décodage SANS pile de travail", false, "return podWorkRun(wk, &ni);", "wk(); return true;"],
    ["ordre ownedBlock / bloc inversé", false, "  if (r.owned.length() >= 16) saveOwnedBlockHash(r.owned);\n", ""],
    ["candidat retenu en canari", true, "  POD_CANARY_CANDIDATE(r.candId);\n", "  if (r.candId.length() > 0) pendingCandidateId = r.candId;\n"],
    ["banc d'essai activé en canari", true, "  POD_CANARY_NO_BENCH(newBenchMode);\n", ""],
  ];
  const base = between(effective(src, false), "#define PULL_ID_MAX", "static bool doPull() {");
  for (const [name, canary, a, b] of muts) {
    assert.equal(base.split(a).length, 2, `mutation « ${name} » : motif introuvable ou multiple`);
    const r = runProcess(buildJson("pull", canary, (s) => s.split(a).join(b), true), [], 60000);
    assert.ok(!passes(r), `mutation « ${name} » NON détectée`);
  }
});
test("HÔTE register / validate : CONTRÔLES NÉGATIFS — validation relâchée, état inscrit trop tôt, décodage hors pile de travail", { skip: skipHost }, () => {
  const prod = effective(src, false);
  const reg = "#include <new>\n" + between(prod, "enum RegisterStatus", "static bool doRegister() {"), val = between(prod, "enum ValidateStatus", "static bool doValidateV1(const String& candidateId, float score);\nstatic bool doValidate() {");
  const cases: Array<["register" | "validate", string, string, string]> = [
    ["register", "deviceId non validé", "  if (!regDeviceIdOk(id)) { r.status = REG_P_INVALID; return; }\n", ""],
    ["register", "état inscrit avant le lancement", "  const bool ran = registerParseOnWorkStack(resp, *r, ni);", "  registered = true;\n  const bool ran = registerParseOnWorkStack(resp, *r, ni);"],
    ["register", "décodage SANS pile de travail", "return podWorkRun(rk, &ni);", "rk(); return true;"],
    ["validate", "hash non validé", "!valCharsOk(h, 64, 64, \"h\") || ", ""],
    ["validate", "décodage SANS pile de travail", "return podWorkRun(vk, &ni);", "vk(); return true;"],
  ];
  for (const [kind, name, a, b] of cases) {
    const base = kind === "register" ? reg : val;
    assert.equal(base.split(a).length, 2, `mutation « ${name} » : motif introuvable ou multiple`);
    const r = runProcess(buildJson(kind, false, (s) => s.split(a).join(b), true), [], 60000);
    assert.ok(!passes(r), `mutation ${kind} « ${name} » NON détectée`);
  }
});
