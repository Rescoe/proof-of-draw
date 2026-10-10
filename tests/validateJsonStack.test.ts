// DOVALIDATE-JSON-STACK-FIX1 (10/10/2026) — la réponse de /api/validate-candidate est décodée sur la pile de TRAVAIL dédiée (podWorkRun), après le retour de httpCall et AVANT la lecture du candidat, la signature
// et le vote ; résultat borné, tout ou rien, échec fermé. C'était le dernier parseur ArduinoJson de la voie vote sur la pile principale du e-ink 2,9″.
// (1) règles statiques + contrôles négatifs ; (2) exécution HÔTE du code réel contre ArduinoJson réel.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { compileHarness, describeChoice, findCompiler, runProcess } from "./helpers/cppHarness";

const root = path.resolve(__dirname, "..");
const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8").replace(/\r\n/g, "\n");
const INO = "arduino_uno_r4/pod_uno_r4_eink29/pod_uno_r4_eink29.ino";
const OTHERS = ["pod_uno_r4_eink27", "pod_uno_r4_eink27_oled", "pod_uno_r4_tft18", "pod_uno_r4"];
const noCanary = (s: string) => s.replace(/#if POD_RENDER_V1 && POD_CANARY\n[\s\S]*?\n#endif\n/g, "");
const stripLine = (s: string) => s.replace(/("(?:[^"\\\n]|\\.)*")|\/\/.*$/gm, (_m, str?: string) => str ?? "");   // un « // » dans un littéral n'est pas un commentaire
const stripStr = (s: string) => s.replace(/"(?:[^"\\]|\\.)*"/g, '""');

function body(src: string, head: string): string {
  const i = src.indexOf(head);
  if (i < 0) return "";
  let j = src.indexOf("{", i + head.length - 1), depth = 0;
  const start = j;
  for (; j < src.length; j++) {
    const c = src[j];
    if (c === '"') { j++; while (j < src.length && src[j] !== '"') { if (src[j] === "\\") j++; j++; } }
    else if (c === "'") { j++; while (j < src.length && src[j] !== "'") { if (src[j] === "\\") j++; j++; } }
    else if (c === "{") depth++;
    else if (c === "}") { depth--; if (depth === 0) return src.slice(start, j + 1); }
  }
  return "";
}

const WORKER = "static void __attribute__((noinline)) validateParseWork(";
const DECODE = "static int __attribute__((noinline)) doValidateDecode(";
const DOVAL = "static bool doValidate() {";

/** Violations de la règle « décodage du validate sur la pile de travail, aucun vote avant un résultat complet » (liste vide = conforme). */
export function validateStackViolations(srcRaw: string): string[] {
  const v: string[] = [];
  const src = stripLine(noCanary(srcRaw));
  const worker = body(src, WORKER), decode = body(src, DECODE), doval = body(src, DOVAL);
  if (!worker || !decode || !doval) return ["validateParseWork / doValidateDecode / doValidate introuvables"];
  // 1. doValidate et doValidateDecode : aucun jeton ArduinoJson ; le décodage vit dans validateParseWork
  for (const tok of ["deserializeJson(", "JSON_DOC(", "JsonDocument", "DynamicJsonDocument", "JsonObject", "JsonVariant", ".as<String>()", "cand["])
    for (const [n, b] of [["doValidate", doval], ["doValidateDecode", decode]] as const) if (b.includes(tok)) v.push(`${n} contient « ${tok} » : le décodage doit rester sur la pile de travail`);
  if (!worker.includes("deserializeJson(doc, resp, DeserializationOption::NestingLimit(POD_WORK_JSON_NESTING))") || !worker.includes("JSON_DOC(doc, 768)")) v.push("validateParseWork doit porter le document et deserializeJson");
  if (worker.includes(".as<String>()") || /\bString\b/.test(stripStr(worker))) v.push("aucune String dans validateParseWork : valeurs lues en const char*, validées, copiées dans des tampons bornés");
  // 2. le code exécuté sur la pile de travail ne touche à aucun état global, journal, mémoire non volatile, réseau ni périphérique
  const pure = stripStr(worker + body(src, "static bool __attribute__((noinline)) valCharsOk("));
  for (const re of [/\blogf\(/, /(?<![.\w])(deviceId|pendingCandidateId|privateKey|publicKey|candidateId|v2screen|v2hash|v2bytes)\b/, /\bsave/, /EEPROM/, /\bepd\b/, /httpCall/, /Serial/, /millis/, /delay\(/, /PodEd/, /sign/, /\bdisplay/])
    if (re.test(pure)) v.push(`le code exécuté sur la pile de travail contient ${re} (effet de bord ou état global)`);
  // 3. trois lanceurs au total (pull, register, validate), un seul appel du nôtre, jamais dans une transaction réseau
  if ((src.match(/podWorkRun\(/g) ?? []).length !== 3) v.push("podWorkRun doit être appelé exactement trois fois (pull, register et validate)");
  if (!/auto vk = \[&\]\(\) \{ validateParseWork\(resp, r\); \};\n  return podWorkRun\(vk, &ni\);/.test(src)) v.push("validateParseOnWorkStack : lanceur attendu introuvable");
  if ((src.match(/validateParseOnWorkStack\(/g) ?? []).length !== 2) v.push("validateParseOnWorkStack : une définition et un seul appel (doValidateDecode)");
  // 4. doValidateDecode : structure au tas, lancement, échec de pile AVANT toute sortie, sorties seulement dans les deux branches valides
  if (!/ValidateParsed\* const r = new \(std::nothrow\) ValidateParsed\(\);\n  if \(!r\) \{[^\n]*return 0; \}/.test(decode)) v.push("doValidateDecode : ValidateParsed doit être allouée au tas (échec = rejet)");
  if (/ValidateParsed [a-z]\w*;/.test(decode + doval)) v.push("ValidateParsed ne doit pas vivre dans la pile principale");
  const iRun = decode.indexOf("const bool ran = validateParseOnWorkStack(resp, *r, ni);");
  const iFail = decode.indexOf("if (!ran) validateWorkFailed(ni);");
  const iJson = decode.indexOf("else if (r->status == VAL_P_JSON)");
  const iBad = decode.indexOf("else if (r->status != VAL_P_OK)");
  const iSkip = decode.indexOf("else if (r->skip) mode = 0;");
  const iV2 = decode.indexOf("else if (r->hasV2) { candidateId = r->candidateId; v2screen = r->screen; v2hash = r->hash; v2bytes = (size_t)r->bytes; mode = 1; }");
  const iV1 = decode.indexOf("else { candidateId = r->candidateId; score = r->score; mode = 2; }");
  if (!(iRun >= 0 && iRun < iFail && iFail < iJson && iJson < iBad && iBad < iSkip && iSkip < iV2 && iV2 < iV1)) v.push("doValidateDecode : ordre attendu lancement -> échec de pile -> JSON -> statut -> rien à voter -> v2 -> v1 (sorties dans les SEULES branches valides)");
  for (const tok of ["candidateId =", "v2screen =", "v2hash =", "v2bytes =", "score ="]) {
    const n = (decode.match(new RegExp(tok.replace(/[=]/g, "\\="), "g")) ?? []).length;
    if (n !== (tok === "candidateId =" ? 2 : 1)) v.push(`doValidateDecode : « ${tok} » ne doit apparaître que dans les branches valides`);
  }
  if (!/delete r;\n  return mode;/.test(decode)) v.push("doValidateDecode : libération puis retour du mode");
  // 5. doValidate : la requête PRÉCÈDE le décodage ; resp libérée avant la lecture du candidat, la signature et le vote ; aucun vote sans mode valide
  const iHttp = doval.indexOf('httpCall("GET", "/api/validate-candidate?deviceId=" + deviceId, nullptr, resp)');
  const iDec = doval.indexOf("mode = doValidateDecode(resp, candidateId, v2screen, v2bytes, v2hash, score);");
  const iFree = doval.indexOf("}", iDec);
  const iZero = doval.indexOf('if (mode == 0) { pendingCandidateId = ""; return false; }');
  const iV2c = doval.indexOf('if (mode == 1) { pendingCandidateId = ""; return doValidateV2(candidateId, v2screen, v2bytes, v2hash); }');
  const iSign = doval.indexOf("signED25519(");
  const iPost = doval.indexOf('httpCall("POST", "/api/validation-result"');
  if (!(iHttp >= 0 && iHttp < iDec && iDec < iFree && iFree < iZero && iZero < iV2c && iV2c < iSign && iSign < iPost)) v.push("doValidate : ordre attendu httpCall -> décodage -> resp libérée -> mode 0 -> mode 1 (v2) -> signature v1 -> vote");
  // 6. GUARD : arrêt sûr avant tout journal
  if (!/^\{\n  if \(ni\.err == POD_NET_GUARD\) logfSafeStop\(\);\n  logf\(/.test(body(src, "static void __attribute__((noinline)) validateWorkFailed("))) v.push("validateWorkFailed : logfSafeStop() doit précéder tout logf sur GUARD");
  // 7. contrat des valeurs : refus, jamais de troncature
  if (!worker.includes('valCharsOk(cid, 8, 64, "i")') || !worker.includes('valCharsOk(sc, 1, 16, "e")') || !worker.includes('valCharsOk(h, 64, 64, "h")') || !worker.includes("b < 1 || b > 262144")) v.push("contrat candidateId / écran / hash / taille absent de validateParseWork");
  if (/strncpy|strlcpy|snprintf/.test(worker)) v.push("validateParseWork ne doit rien tronquer");
  return v;
}

test("DOVALIDATE-JSON-STACK-FIX1 (statique) : la réponse du validate est décodée sur la pile de travail APRÈS httpCall et AVANT la lecture du candidat, la signature et le vote ; sorties seulement avec un résultat complet ; valeurs refusées jamais tronquées ; CONTRÔLES NÉGATIFS", () => {
  const src = read(INO);
  assert.deepEqual(validateStackViolations(src), []);
  const mutants: Array<[string, string, string]> = [
    ["décodage dans doValidate (pile principale)", "    mode = doValidateDecode(resp, candidateId, v2screen, v2bytes, v2hash, score);", "    { JSON_DOC(zz, 64); deserializeJson(zz, resp); }\n    mode = doValidateDecode(resp, candidateId, v2screen, v2bytes, v2hash, score);"],
    ["String dans le décodeur", "  const char* cid = cand[\"candidateId\"] | \"\";", "  const String cid2 = cand[\"candidateId\"].as<String>(); const char* cid = cand[\"candidateId\"] | \"\";"],
    ["état global dans le décodeur", "  r.status = VAL_P_OK;\n}\nstatic bool __attribute__((noinline)) validateParseOnWorkStack", "  pendingCandidateId = \"\"; r.status = VAL_P_OK;\n}\nstatic bool __attribute__((noinline)) validateParseOnWorkStack"],
    ["journal dans le code de la pile de travail", "  JSON_DOC(doc, 768);   // 512 avant", "  logf(\"x\");\n  JSON_DOC(doc, 768);   // 512 avant"],
    ["sorties écrites AVANT le contrôle de la pile", "  const bool ran = validateParseOnWorkStack(resp, *r, ni);", "  candidateId = \"x\";\n  const bool ran = validateParseOnWorkStack(resp, *r, ni);"],
    ["échec de pile ignoré", "if (!ran) validateWorkFailed(ni);\n  else if (r->status == VAL_P_JSON)", "if (!ran) {}\n  else if (r->status == VAL_P_JSON)"],
    ["statut non vérifié", "else if (r->status != VAL_P_OK)", "else if (false)"],
    ["lancement SANS pile de travail", "return podWorkRun(vk, &ni);", "vk(); return true;"],
    ["structure dans la pile principale", "  ValidateParsed* const r = new (std::nothrow) ValidateParsed();\n  if (!r) { logf(\"[VALIDATE] réponse rejetée : mémoire insuffisante\"); return 0; }", "  ValidateParsed rr; ValidateParsed* const r = &rr;"],
    ["journal AVANT l'arrêt sûr sur GUARD", "  if (ni.err == POD_NET_GUARD) logfSafeStop();\n  logf(\"[VALIDATE] analyse", "  logf(\"avant\"); if (ni.err == POD_NET_GUARD) logfSafeStop();\n  logf(\"[VALIDATE] analyse"],
    ["hash non borné", "valCharsOk(h, 64, 64, \"h\")", "valCharsOk(h, 1, 64, \"h\")"],
    ["taille non bornée", "b < 1 || b > 262144", "b < 0"],
    ["décodage avant la requête", "  {\n    String resp;\n    if (httpCall(\"GET\", \"/api/validate-candidate", "  {\n    String resp; mode = doValidateDecode(resp, candidateId, v2screen, v2bytes, v2hash, score);\n    if (httpCall(\"GET\", \"/api/validate-candidate"],
    ["vote v2 avant le contrôle du mode 0", "  if (mode == 0) { pendingCandidateId = \"\"; return false; }\n  // Validation RÉELLE : si le serveur annonce { v2 }, on revérifie le contenu au lieu de recopier son score (anciens serveurs / animations : chemin v1 ci-dessous).\n  if (mode == 1) { pendingCandidateId = \"\"; return doValidateV2(candidateId, v2screen, v2bytes, v2hash); }", "  if (mode == 1) { pendingCandidateId = \"\"; return doValidateV2(candidateId, v2screen, v2bytes, v2hash); }\n  if (mode == 0) { pendingCandidateId = \"\"; return false; }"],
  ];
  for (const [name, a, b] of mutants) {
    assert.equal(src.split(a).length, 2, `mutation « ${name} » : motif introuvable ou multiple`);
    assert.notEqual(validateStackViolations(src.replace(a, () => b)).length, 0, `mutation « ${name} » NON détectée`);
  }
});

test("DOVALIDATE-JSON-STACK-FIX1 : les quatre autres firmwares R4 sont INCHANGÉS (doValidate d'avant, aucune pile de travail) ; en-tête : deux constantes seulement", () => {
  for (const sk of OTHERS) {
    const s = read(`arduino_uno_r4/${sk}/${sk}.ino`);
    assert.doesNotMatch(s, /ValidateParsed|validateParseWork|doValidateDecode|podWorkRun/, `${sk} ne doit pas porter le correctif`);
    assert.match(s, /if \(deserializeJson\(doc, resp\)\) \{ pendingCandidateId = ""; return false; \}/, `${sk} : doValidate d'avant conservé`);
  }
});

test("DOVALIDATE-JSON-STACK-FIX1 (canari) : ligne « [CANARY] validate JSON », verrou sur erreur de pile ou statut ≠ OK, contrôle V: APRÈS le retour du rapport, rien en production", () => {
  const src = read(INO);
  const rep = /static void __attribute__\(\(noinline\)\) podCanaryValidate\([^\n]*\{[\s\S]*?\n\}\n/.exec(src)![0];
  assert.doesNotMatch(rep, /podCanaryCheck/, "aucun podCanaryCheck dans le corps de la fonction de rapport");
  assert.match(src, /podCanaryValidate\(ni, ran, r->status, heapB\);\n#endif\n#if POD_RENDER_V1 && POD_CANARY\n  podCanaryCheck\("  V: apres le decodage du validate \(silencieux\)", false\);\n#endif\n  int mode = 0;/);
  assert.match(src, /\[CANARY\] validate JSON : pile de travail dediee utilisee /);
  assert.match(src, /podCanaryPhase\(ni\.pad\[0\]\);\n  PodCanaryValCtx c/);
  assert.match(src, /return !ran \|\| ni\.err != POD_NET_OK \|\| status != VAL_P_OK; \}/);
  assert.doesNotMatch(noCanary(src), /podCanaryValidate|PodCanaryValCtx|podCanaryValBad/);
});

// ── Exécution hôte du code RÉEL ─────────────────────────────────────────────────────────────────────────
const choice = findCompiler();
console.log(`[validateJsonStack] ${describeChoice(choice)}`);
const ajCandidates = [process.env.ARDUINOJSON_DIR, path.join(os.homedir(), "Documents", "Arduino", "libraries", "ArduinoJson", "src"), path.join(os.homedir(), "Arduino", "libraries", "ArduinoJson", "src")].filter((x): x is string => !!x);
const ajDir = ajCandidates.find((d) => fs.existsSync(path.join(d, "ArduinoJson.h")));
const skipHost = !choice.path ? `${describeChoice(choice)} — exécution hôte IGNORÉE` : !ajDir ? `ArduinoJson introuvable (essayés : ${ajCandidates.join(", ")} ; variable ARDUINOJSON_DIR) — exécution hôte IGNORÉE` : false;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "valwork-"));
const exeName = process.platform === "win32" ? "validate_work_harness.exe" : "validate_work_harness";

/** De « enum ValidateStatus » jusqu'à doValidate, blocs de canari retirés. */
function extractValidate(): string {
  const src = read(INO);
  const a = src.indexOf("enum ValidateStatus"), b = src.indexOf(DOVAL);
  assert.ok(a > 0 && b > a, "région du décodage du validate introuvable");
  return noCanary(src.slice(a, b));
}
function build(mutate: (s: string) => string = (s) => s, lenient = false): string {
  const dir = fs.mkdtempSync(path.join(tmp, "b-"));
  fs.writeFileSync(path.join(dir, "validate_extract.inc"), mutate(extractValidate()));
  const out = path.join(dir, exeName);
  compileHarness(choice.path!, path.join(root, "consensus-pod", "host", "validate_work_harness.cpp"), out,
    [`-I${dir}`, `-I${path.join(root, "consensus-pod", "host", "shim")}`, `-I${path.join(root, "consensus-pod", "src", "adapters")}`, `-isystem`, ajDir!,
      "-DARDUINOJSON_ENABLE_ARDUINO_STRING=1", "-DARDUINOJSON_ENABLE_ARDUINO_STREAM=0", "-DARDUINOJSON_ENABLE_ARDUINO_PRINT=0", "-DARDUINOJSON_ENABLE_PROGMEM=0", ...(lenient ? ["-Wno-unused-variable", "-Wno-unused-parameter", "-Wno-unused-function", "-Wno-unused-but-set-variable"] : [])]);
  return out;
}

test("DOVALIDATE-JSON-STACK-FIX1 (HÔTE) : le code RÉEL du décodage contre ArduinoJson réel — v2 / v1 / déjà voté / candidat nul / valeurs invalides, absentes, trop longues, hors alphabet, mal typées / JSON tronqué / NOMEM, NESTED, GUARD, MARGIN / allocation impossible : tout ou rien", { skip: skipHost }, () => {
  const r = runProcess(build(), [], 60000);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout.trim(), /^PASS \d+$/);
});

test("DOVALIDATE-JSON-STACK-FIX1 (HÔTE) : CONTRÔLES NÉGATIFS — validation relâchée, sorties écrites trop tôt, échec de pile ignoré, journal avant l'arrêt sûr : le harnais les REFUSE", { skip: skipHost }, () => {
  const mutants: Array<[string, string, string]> = [
    ["identifiant non validé", "  if (!valCharsOk(cid, 8, 64, \"i\")) { r.status = VAL_P_INVALID; return; }\n", ""],
    ["longueur du hash relâchée", "valCharsOk(h, 64, 64, \"h\")", "valCharsOk(h, 1, 64, \"h\")"],
    ["hash non hexadécimal accepté", "default:  if (!(digit || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F'))) return false; break;", "default:  break;"],
    ["écran : alphabet ignoré", "case 'e': if (!(digit || lower || c == '_')) return false; break;", "case 'e': break;"],
    ["taille 0 acceptée", "b < 1 || b > 262144", "b < 0 || b > 262144"],
    ["taille énorme acceptée", "b < 1 || b > 262144", "b < 1"],
    ["sorties écrites avant le contrôle de la pile", "  const bool ran = validateParseOnWorkStack(resp, *r, ni);", "  candidateId = \"x\";\n  const bool ran = validateParseOnWorkStack(resp, *r, ni);"],
    ["échec de pile ignoré", "if (!ran) validateWorkFailed(ni);\n  else if (r->status == VAL_P_JSON)", "if (!ran) {}\n  else if (r->status == VAL_P_JSON)"],
    ["statut invalide accepté", "else if (r->status != VAL_P_OK) logf(", "else if (false) logf("],
    ["journal avant l'arrêt sûr sur GUARD", "  if (ni.err == POD_NET_GUARD) logfSafeStop();\n  logf(", "  logf(\"avant\"); if (ni.err == POD_NET_GUARD) logfSafeStop();\n  logf("],
    ["décodage SANS pile de travail", "return podWorkRun(vk, &ni);", "vk(); return true;"],
    ["déjà voté traité comme valide", "if ((doc[\"alreadyVoted\"] | false) || doc[\"candidate\"].isNull()) { r.skip = true; r.status = VAL_P_OK; return; }", "if (doc[\"candidate\"].isNull()) { r.skip = true; r.status = VAL_P_OK; return; }"],
    ["allocation non vérifiée", "  if (!r) { logf(\"[VALIDATE] réponse rejetée : mémoire insuffisante\"); return 0; }\n", ""],
  ];
  const base = extractValidate();
  for (const [name, a, b] of mutants) {
    assert.equal(base.split(a).length, 2, `mutation « ${name} » : motif introuvable ou multiple`);
    const r = runProcess(build((s) => s.split(a).join(b), true), [], 60000);
    const bad = r.status !== 0 || !/^PASS \d+$/.test(r.stdout.trim());
    assert.ok(bad, `mutation « ${name} » NON détectée`);
  }
});
