// REGISTER-JSON-STACK-FIX1 (10/10/2026) — la réponse de /api/register est décodée sur la pile de TRAVAIL dédiée (podWorkRun), après le retour de httpCall, résultat borné, tout ou rien, échec fermé.
// Contexte matériel (canari c19efb8) : doRegister atteint 948 / 1 024 o (marge 76 o < 128 o, marqueur et longueur intacts : arrêt préventif) — JsonDocument, deserializeJson et deviceId/pairCode.as<String>() sur la pile principale.
// (1) règles statiques + contrôles négatifs ; (2) exécution HÔTE du code réel contre ArduinoJson réel ; (3) INVENTAIRE FORMEL des deserializeJson des cinq firmwares R4.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { compileHarness, describeChoice, findCompiler, runProcess } from "./helpers/cppHarness";

const root = path.resolve(__dirname, "..");
const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8").replace(/\r\n/g, "\n");
const INO = "arduino_uno_r4/pod_uno_r4_eink29/pod_uno_r4_eink29.ino";
const SKETCHES = ["pod_uno_r4_eink29", "pod_uno_r4_eink27", "pod_uno_r4_eink27_oled", "pod_uno_r4_tft18", "pod_uno_r4"];
const noCanary = (s: string) => s.replace(/#if POD_RENDER_V1 && POD_CANARY\n[\s\S]*?\n#endif\n/g, "");
const stripLine = (s: string) => s.replace(/("(?:[^"\\\n]|\\.)*")|\/\/.*$/gm, (_m, str?: string) => str ?? "");   // un « // » dans un littéral (https://…) n'est pas un commentaire
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

const WORKER = "static void __attribute__((noinline)) registerParseWork(";
const DECODE = "static bool __attribute__((noinline)) doRegisterDecode(";
const DOREG = "static bool doRegister() {";

/** Violations de la règle « décodage du register sur la pile de travail, rien d'inscrit avant un résultat complet » (liste vide = conforme). */
export function registerStackViolations(srcRaw: string): string[] {
  const v: string[] = [];
  const src = stripLine(noCanary(srcRaw));
  const worker = body(src, WORKER), decode = body(src, DECODE), doreg = body(src, DOREG);
  if (!worker || !decode || !doreg) return ["registerParseWork / doRegisterDecode / doRegister introuvables"];
  // 1. doRegister ne contient plus aucun jeton ArduinoJson ; le décodage vit dans registerParseWork
  for (const tok of ["deserializeJson(", "JSON_DOC(", "JsonDocument", "DynamicJsonDocument", "JsonVariant", ".as<String>()"])
    for (const [n, b] of [["doRegister", doreg], ["doRegisterDecode", decode]] as const) if (b.includes(tok)) v.push(`${n} contient « ${tok} » : le décodage doit rester sur la pile de travail`);
  if (!worker.includes("deserializeJson(doc, resp)") || !worker.includes("JSON_DOC(doc, 768)")) v.push("registerParseWork doit porter le document et deserializeJson");
  if (worker.includes(".as<String>()")) v.push("aucune conversion String dans registerParseWork : les valeurs sont validées puis copiées dans des tampons bornés");
  // 2. le code exécuté sur la pile de travail ne touche à aucun état global, journal, mémoire non volatile ni périphérique
  const pure = stripStr(worker + body(src, "static bool __attribute__((noinline)) regDeviceIdOk(") + body(src, "static bool __attribute__((noinline)) regPairCodeOk("));
  for (const re of [/\blogf\(/, /(?<![.\w])(deviceId|pairCode|paired|registered)\b/, /\bsave/, /EEPROM/, /\bepd\b/, /httpCall/, /Serial/, /millis/, /delay\(/, /\bdisplay/])
    if (re.test(pure)) v.push(`le code exécuté sur la pile de travail contient ${re} (effet de bord ou état global)`);
  // 3. un seul lanceur par décodeur (2 au total dans le fichier : pull + register), jamais depuis une transaction réseau
  if ((src.match(/podWorkRun\(/g) ?? []).length !== 2) v.push("podWorkRun doit être appelé exactement deux fois (pull et register)");
  if (!/auto rk = \[&\]\(\) \{ registerParseWork\(resp, r\); \};\n  return podWorkRun\(rk, &ni\);/.test(src)) v.push("registerParseOnWorkStack : lanceur attendu introuvable");
  if ((src.match(/registerParseOnWorkStack\(/g) ?? []).length !== 2) v.push("registerParseOnWorkStack : une définition et un seul appel (doRegisterDecode)");
  // 4. doRegisterDecode : structure au tas, lancement, puis traitement de l'échec AVANT toute inscription
  if (!/RegisterParsed\* const r = new \(std::nothrow\) RegisterParsed\(\);\n  if \(!r\) \{[^\n]*return false; \}/.test(decode)) v.push("doRegisterDecode : RegisterParsed doit être allouée au tas (échec = rejet)");
  if (/RegisterParsed [a-z]\w*;/.test(decode + doreg)) v.push("RegisterParsed ne doit pas vivre dans la pile principale");
  const iRun = decode.indexOf("const bool ran = registerParseOnWorkStack(resp, *r, ni);");
  const iFail = decode.indexOf("if (!ran) registerWorkFailed(ni);");
  const iJson = decode.indexOf("else if (r->status == REG_P_JSON)");
  const iBad = decode.indexOf("else if (r->status != REG_P_OK)");
  const iSet = decode.indexOf("else { deviceId = r->deviceId; pairCode = r->pairCode; paired = r->paired; registered = true; ok = true; }");
  if (!(iRun >= 0 && iRun < iFail && iFail < iJson && iJson < iBad && iBad < iSet)) v.push("doRegisterDecode : ordre attendu lancement -> échec de pile -> JSON -> statut -> inscription (dans la SEULE branche valide)");
  for (const tok of ["deviceId =", "pairCode =", "paired =", "registered ="]) if ((decode.match(new RegExp(tok.replace(/[=]/g, "\\="), "g")) ?? []).length !== 1) v.push(`doRegisterDecode : « ${tok} » doit apparaître exactement une fois (branche valide)`);
  if (!/delete r;\n  return ok;/.test(decode)) v.push("doRegisterDecode : libération puis retour de ok");
  // 5. doRegister : la requête (httpCall) PRÉCÈDE le décodage ; l'inscription n'est jamais faite par doRegister
  const iHttp = doreg.indexOf('httpCall("POST", "/api/register", &body, resp) != 200');
  const iDec = doreg.indexOf("if (!doRegisterDecode(resp)) return false;");
  const iLog = doreg.indexOf('logf("[REGISTER] deviceId=%s paired=%s"');
  if (!(iHttp >= 0 && iHttp < iDec && iDec < iLog)) v.push("doRegister : ordre attendu httpCall -> doRegisterDecode -> journal");
  for (const tok of ["deviceId =", "pairCode =", "paired =", "registered ="]) if (doreg.includes(tok)) v.push(`doRegister contient « ${tok} » : seule doRegisterDecode inscrit l'état`);
  // 6. GUARD : arrêt sûr avant tout journal
  if (!/^\{\n  if \(ni\.err == POD_NET_GUARD\) logfSafeStop\(\);\n  logf\(/.test(body(src, "static void __attribute__((noinline)) registerWorkFailed("))) v.push("registerWorkFailed : logfSafeStop() doit précéder tout logf sur GUARD");
  // 7. contrat des valeurs : refus, jamais de troncature
  if (!src.includes("strlen(s) != 12") || !src.includes("strlen(s) != 8") || !src.includes('"ABCDEFGHJKLMNPQRSTUVWXYZ23456789"')) v.push("contrat deviceId (12 car.) / pairCode (8 car., alphabet du serveur) absent");
  if (/strncpy|strlcpy|snprintf/.test(worker)) v.push("registerParseWork ne doit rien tronquer (memcpy de longueurs vérifiées seulement)");
  return v;
}

test("REGISTER-JSON-STACK-FIX1 (statique) : la réponse du register est décodée sur la pile de travail APRÈS httpCall, rien n'est inscrit avant un résultat complet, valeurs refusées jamais tronquées ; CONTRÔLES NÉGATIFS", () => {
  const src = read(INO);
  assert.deepEqual(registerStackViolations(src), []);
  const mutants: Array<[string, string, string]> = [
    ["décodage dans doRegister (pile principale)", "  if (!doRegisterDecode(resp)) return false;", "  { JSON_DOC(zz, 64); deserializeJson(zz, resp); }\n  if (!doRegisterDecode(resp)) return false;"],
    ["conversion String dans le décodeur", "  const bool isPaired = doc[\"paired\"] | false;", "  const bool isPaired = doc[\"paired\"] | false; String zz = doc[\"deviceId\"].as<String>();"],
    ["inscription par doRegister", "  if (!doRegisterDecode(resp)) return false;", "  if (!doRegisterDecode(resp)) return false;\n  registered = true;"],
    ["état inscrit AVANT le contrôle de la pile", "  const bool ran = registerParseOnWorkStack(resp, *r, ni);", "  deviceId = \"x\";\n  const bool ran = registerParseOnWorkStack(resp, *r, ni);"],
    ["échec de pile ignoré", "if (!ran) registerWorkFailed(ni);\n  else if (r->status == REG_P_JSON)", "if (!ran) {}\n  else if (r->status == REG_P_JSON)"],
    ["statut non vérifié", "else if (r->status != REG_P_OK)", "else if (false)"],
    ["journal dans le code de la pile de travail", "  JSON_DOC(doc, 768);\n  const DeserializationError err", "  logf(\"x\");\n  JSON_DOC(doc, 768);\n  const DeserializationError err"],
    ["état global dans le code de la pile de travail", "  r.paired = isPaired;\n", "  r.paired = isPaired; registered = true;\n"],
    ["lancement SANS pile de travail", "return podWorkRun(rk, &ni);", "rk(); return true;"],
    ["structure dans la pile principale", "  RegisterParsed* const r = new (std::nothrow) RegisterParsed();\n  if (!r) { logf(\"[REGISTER] réponse rejetée : mémoire insuffisante\"); return false; }", "  RegisterParsed rr; RegisterParsed* const r = &rr;"],
    ["journal AVANT l'arrêt sûr sur GUARD", "  if (ni.err == POD_NET_GUARD) logfSafeStop();\n  logf(\"[REGISTER] analyse", "  logf(\"avant\"); if (ni.err == POD_NET_GUARD) logfSafeStop();\n  logf(\"[REGISTER] analyse"],
    ["troncature du pairCode", "if (strlen(s) != 8) return false;", "if (strlen(s) < 8) return false;"],
    ["décodage avant la requête", "  String resp;\n  if (httpCall(\"POST\"", "  String resp; if (!doRegisterDecode(resp)) return false;\n  if (httpCall(\"POST\""],
  ];
  for (const [name, a, b] of mutants) {
    assert.equal(src.split(a).length, 2, `mutation « ${name} » : motif introuvable ou multiple`);
    assert.notEqual(registerStackViolations(src.replace(a, () => b)).length, 0, `mutation « ${name} » NON détectée`);
  }
});

test("REGISTER-JSON-STACK-FIX1 (canari) : ligne « [CANARY] register JSON » (utilisation, marge, erreur, statut, tas avant / après), verrou sur erreur de pile ou statut ≠ OK, contrôle de la pile principale APRÈS le retour du rapport, rien en production", () => {
  const src = read(INO);
  const rep = /static void __attribute__\(\(noinline\)\) podCanaryRegister\([^\n]*\{[\s\S]*?\n\}\n/.exec(src)![0];
  assert.doesNotMatch(rep, /podCanaryCheck/, "aucun podCanaryCheck dans le corps de la fonction de rapport");
  assert.match(src, /podCanaryRegister\(ni, ran, r->status, heapB\);\n#endif\n#if POD_RENDER_V1 && POD_CANARY\n  podCanaryCheck\("  Q: apres le decodage du register \(silencieux\)", false\);\n#endif\n  bool ok = false;/);
  assert.match(src, /\[CANARY\] register JSON : pile de travail dediee utilisee /);
  assert.match(src, /podCanaryPhase\(ni\.pad\[0\]\);\n  PodCanaryRegCtx c/);
  assert.match(src, /return !ran \|\| ni\.err != POD_NET_OK \|\| status != REG_P_OK; \}/);
  // les aides de tas sont définies UNE fois, avant leurs deux usages (register puis pull)
  assert.equal((src.match(/static void podCanaryHeapRun\(/g) ?? []).length, 1);
  assert.ok(src.indexOf("podCanaryHeapMark() {") < src.indexOf("static bool doRegister() {") && src.indexOf("static bool doRegister() {") < src.indexOf("static int __attribute__((noinline)) doPullApply("));
  assert.doesNotMatch(noCanary(src), /podCanaryRegister|PodCanaryRegCtx|podCanaryRegBad/);
});

// ── Exécution hôte du code RÉEL ─────────────────────────────────────────────────────────────────────────
const choice = findCompiler();
console.log(`[registerJsonStack] ${describeChoice(choice)}`);
const ajCandidates = [process.env.ARDUINOJSON_DIR, path.join(os.homedir(), "Documents", "Arduino", "libraries", "ArduinoJson", "src"), path.join(os.homedir(), "Arduino", "libraries", "ArduinoJson", "src")].filter((x): x is string => !!x);
const ajDir = ajCandidates.find((d) => fs.existsSync(path.join(d, "ArduinoJson.h")));
const skipHost = !choice.path ? `${describeChoice(choice)} — exécution hôte IGNORÉE` : !ajDir ? `ArduinoJson introuvable (essayés : ${ajCandidates.join(", ")} ; variable ARDUINOJSON_DIR) — exécution hôte IGNORÉE` : false;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "regwork-"));
const exeName = process.platform === "win32" ? "register_work_harness.exe" : "register_work_harness";

/** De « #include <new> » (début du bloc register) jusqu'à doRegister, blocs de canari retirés. */
function extractRegister(): string {
  const src = read(INO);
  const a = src.indexOf("#include <new>\nenum RegisterStatus"), b = src.indexOf(DOREG);
  assert.ok(a > 0 && b > a, "région du décodage du register introuvable");
  return noCanary(src.slice(a, b));
}
function build(mutate: (s: string) => string = (s) => s, lenient = false): string {
  const dir = fs.mkdtempSync(path.join(tmp, "b-"));
  fs.writeFileSync(path.join(dir, "register_extract.inc"), mutate(extractRegister()));
  const out = path.join(dir, exeName);
  compileHarness(choice.path!, path.join(root, "consensus-pod", "host", "register_work_harness.cpp"), out,
    [`-I${dir}`, `-I${path.join(root, "consensus-pod", "host", "shim")}`, `-I${path.join(root, "consensus-pod", "src", "adapters")}`, `-isystem`, ajDir!,
      "-DARDUINOJSON_ENABLE_ARDUINO_STRING=1", "-DARDUINOJSON_ENABLE_ARDUINO_STREAM=0", "-DARDUINOJSON_ENABLE_ARDUINO_PRINT=0", "-DARDUINOJSON_ENABLE_PROGMEM=0", ...(lenient ? ["-Wno-unused-variable", "-Wno-unused-parameter", "-Wno-unused-function", "-Wno-unused-but-set-variable"] : [])]);
  return out;
}

test("REGISTER-JSON-STACK-FIX1 (HÔTE) : le code RÉEL du décodage contre ArduinoJson réel — appairé / non appairé / champs absents / types inattendus / valeurs trop courtes, trop longues, hors alphabet / JSON tronqué / NOMEM, NESTED, GUARD, MARGIN / allocation impossible : tout ou rien", { skip: skipHost }, () => {
  const r = runProcess(build(), [], 60000);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout.trim(), /^PASS \d+$/);
});

test("REGISTER-JSON-STACK-FIX1 (HÔTE) : CONTRÔLES NÉGATIFS — validation relâchée, troncature, état inscrit trop tôt, échec de pile ignoré, journal avant l'arrêt sûr : le harnais les REFUSE", { skip: skipHost }, () => {
  const mutants: Array<[string, string, string]> = [
    ["deviceId non validé", "  if (!regDeviceIdOk(id)) { r.status = REG_P_INVALID; return; }\n", ""],
    ["longueur du deviceId relâchée", "if (strlen(s) != 12 ||", "if (strlen(s) < 12 ||"],
    ["pairCode : longueur relâchée", "if (strlen(s) != 8) return false;", "if (strlen(s) < 8) return false;"],
    ["pairCode : alphabet ignoré", "if (strchr(ALPHA, s[i]) == nullptr) return false;", "(void)0;"],
    ["pairCode obligatoire seulement si... toujours accepté", "if (pc[0] != '\\0' ? !regPairCodeOk(pc) : !isPaired) { r.status = REG_P_INVALID; return; }", "if (pc[0] != '\\0' && !regPairCodeOk(pc)) { r.status = REG_P_INVALID; return; }"],
    ["état inscrit malgré un statut invalide", "else if (r->status != REG_P_OK) logf(", "else if (false) logf("],
    ["échec de pile ignoré", "if (!ran) registerWorkFailed(ni);\n  else if (r->status == REG_P_JSON)", "if (!ran) {}\n  else if (r->status == REG_P_JSON)"],
    ["état inscrit avant le lancement", "  const bool ran = registerParseOnWorkStack(resp, *r, ni);", "  registered = true;\n  const bool ran = registerParseOnWorkStack(resp, *r, ni);"],
    ["journal avant l'arrêt sûr sur GUARD", "  if (ni.err == POD_NET_GUARD) logfSafeStop();\n  logf(", "  logf(\"avant\"); if (ni.err == POD_NET_GUARD) logfSafeStop();\n  logf("],
    ["décodage SANS pile de travail", "return podWorkRun(rk, &ni);", "rk(); return true;"],
    ["pairCode jamais copié", "  if (pc[0] != '\\0') { memcpy(r.pairCode, pc, 8); r.pairCode[8] = '\\0'; }\n", ""],
    ["allocation non vérifiée", "  if (!r) { logf(\"[REGISTER] réponse rejetée : mémoire insuffisante\"); return false; }\n", ""],
  ];
  const base = extractRegister();
  for (const [name, a, b] of mutants) {
    assert.equal(base.split(a).length, 2, `mutation « ${name} » : motif introuvable ou multiple`);
    const r = runProcess(build((s) => s.split(a).join(b), true), [], 60000);
    const bad = r.status !== 0 || !/^PASS \d+$/.test(r.stdout.trim());
    assert.ok(bad, `mutation « ${name} » NON détectée`);
  }
});

// ── Inventaire FORMEL des deserializeJson des cinq firmwares R4 ─────────────────────────────────────────
/** Fonction englobante d'une ligne : dernière définition de fonction de niveau supérieur (ligne non indentée terminée par « { ») qui la précède. */
function enclosing(lines: string[], idx: number): string {
  for (let i = idx; i >= 0; i--) {
    const l = lines[i].replace(/__attribute__\(\([^)]*\)\)\s*/g, "");
    const m = /^[A-Za-z_][^(]*?\b([A-Za-z_]\w*)\([^;]*\)\s*(?:const\s*)?\{\s*$/.exec(l);
    if (m && !/^(if|for|while|switch|else)$/.test(m[1])) return m[1];
  }
  return "?";
}
export interface JsonSite { sketch: string; fn: string; line: number; stack: "travail" | "principale" }
export function jsonInventory(): JsonSite[] {
  const out: JsonSite[] = [];
  for (const sk of SKETCHES) {
    const lines = read(`arduino_uno_r4/${sk}/${sk}.ino`).split("\n");
    lines.forEach((l, i) => {
      if (/^\s*\/\//.test(l) || !/\bdeserializeJson\(/.test(l.replace(/\/\/.*$/, ""))) return;
      const fn = enclosing(lines, i);
      out.push({ sketch: sk, fn, line: i + 1, stack: /^(pullParseWork|registerParseWork)$/.test(fn) ? "travail" : "principale" });
    });
  }
  return out;
}

test("INVENTAIRE FORMEL des deserializeJson des cinq firmwares R4 : exactement les sites connus ; le e-ink 2,9″ n'en a plus que doValidate sur la pile principale (à migrer AVANT le premier vote réel) ; les quatre autres restent à migrer APRÈS validation matérielle", () => {
  const inv = jsonInventory();
  const key = (s: JsonSite) => `${s.sketch}:${s.fn}:${s.stack}`;
  const got = inv.map(key).sort();
  const want = [
    "pod_uno_r4_eink29:pullParseWork:travail", "pod_uno_r4_eink29:pullParseWork:travail", "pod_uno_r4_eink29:registerParseWork:travail", "pod_uno_r4_eink29:doValidate:principale",
    "pod_uno_r4_eink27:doRegister:principale", "pod_uno_r4_eink27:doPull:principale", "pod_uno_r4_eink27:doPull:principale", "pod_uno_r4_eink27:doValidate:principale",
    "pod_uno_r4_eink27_oled:doRegister:principale", "pod_uno_r4_eink27_oled:doPull:principale", "pod_uno_r4_eink27_oled:doPull:principale", "pod_uno_r4_eink27_oled:doValidate:principale",
    "pod_uno_r4_tft18:doRegister:principale", "pod_uno_r4_tft18:doPull:principale", "pod_uno_r4_tft18:doPull:principale", "pod_uno_r4_tft18:doValidate:principale",
    "pod_uno_r4:doRegister:principale", "pod_uno_r4:doPull:principale", "pod_uno_r4:doPull:principale", "pod_uno_r4:doValidate:principale", "pod_uno_r4:benchPollOnce:principale",
  ].sort();
  assert.deepEqual(got, want, "un deserializeJson a été ajouté, déplacé ou migré : le classer ici ET dans docs/LOT_8B2B2_REGISTER_JSON_STACK_FIX1_2026_10_10.md § 6");
});
