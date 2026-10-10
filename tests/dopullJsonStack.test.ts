// DOPULL-JSON-STACK-FIX1 (10/10/2026) — TOUT le décodage de la réponse /api/pull sur une pile de TRAVAIL dédiée (podWorkRun), après la fermeture de TLS, résultat borné, échec fermé.
// Contexte matériel (canari b03c0b4, 10/10/2026) : phases 1 à 3 de doPull saines, marqueur de la pile principale détruit PENDANT deserializeJson(doc, resp).
// Ce fichier vérifie : (1) statiquement, la structure du code (rien de JSON hors de la pile de travail, aucun effet de bord avant un retour valide, ordre des effets) avec des contrôles négatifs ;
// (2) sur l'HÔTE, le code RÉEL extrait du sketch contre ArduinoJson réel : réponses minimale / complète / 429 / tronquée / trop imbriquée / hors bornes, observation maximale, panne d'allocation à chaque point.
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
const stripLine = (s: string) => s.replace(/\/\/.*$/gm, "");

/** Corps (accolades équilibrées, hors littéraux de chaîne) de la fonction dont la ligne de tête contient `head`. */
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

const WORKER = "static void __attribute__((noinline)) pullParseWork(";
const APPLY = "static int __attribute__((noinline)) doPullApply(";
const STAGE = "static int __attribute__((noinline)) doPullStage(";
const DOPULL = "static bool doPull() {";
const SIDE_EFFECTS = ["pendingWorkTitle = ", "pendingArtistName = ", "pendingDisplayTs = ", "currentBlockIndex = ", "pendingObsHashes = ", "pendingObsTarget = ", "saveOwnedBlockHash(", "nextPullIntervalMs = ", "currentBlockHash = ", "saveBlockHashToEEPROM(", "pendingCandidateId = ", "frameId = ", "frameSource = "];

/** Violations de la règle « décodage sur la pile de travail, rien n'est appliqué avant un retour valide » (liste vide = conforme). */
export function pullStackViolations(srcRaw: string): string[] {
  const v: string[] = [];
  const src = stripLine(noCanary(srcRaw));
  const worker = body(src, WORKER), apply = body(src, APPLY), stage = body(src, STAGE), dopull = body(src, DOPULL);
  if (!worker || !apply || !stage || !dopull) return ["pullParseWork / doPullApply / doPullStage / doPull introuvables"];
  // 1. tout le décodage est dans pullParseWork : AUCUN jeton ArduinoJson dans les trois fonctions de la chaîne principale
  for (const [n, b] of [["doPull", dopull], ["doPullStage", stage], ["doPullApply", apply]] as const)
    for (const tok of ["deserializeJson(", "JSON_DOC(", "JsonObject", "JsonArray", "JsonVariant", ".as<String>()", "DynamicJsonDocument", "JsonDocument"])
      if (b.includes(tok)) v.push(`${n} contient « ${tok} » : le décodage doit rester sur la pile de travail`);
  if ((worker.match(/deserializeJson\(/g) ?? []).length !== 2) v.push("pullParseWork doit contenir les deux décodages (429 et réponse)");
  // chaque appel réel (la ligne de commentaire du bloc en cite un en texte) porte la limite d'imbrication explicite
  const callsAll = (src.match(/deserializeJson\(/g) ?? []).length, callsLimited = (src.match(/deserializeJson\([a-z]+, resp, DeserializationOption::NestingLimit\(POD_WORK_JSON_NESTING\)\)/g) ?? []).length;
  if (callsAll !== callsLimited) v.push("chaque deserializeJson (hors commentaire) doit porter DeserializationOption::NestingLimit(POD_WORK_JSON_NESTING)");
  if (!worker.includes(".as<String>()")) v.push("la conversion JsonVariant -> String de l'observation doit vivre dans pullParseWork");
  // 2. pullParseWork et ses aides ne touchent à AUCUN état global, mémoire non volatile, périphérique ni journal
  const pure = worker + body(src, "static bool __attribute__((noinline)) pullSetId(") + body(src, "static bool __attribute__((noinline)) pullSetText(");
  const pureNoStr = pure.replace(/"(?:[^"\\]|\\.)*"/g, '""');
  for (const tok of ["logf(", "pending", "currentBlock", "lastPullMs", "nextPull", "save", "EEPROM", "epd", "httpCall", "ackFrame", "Serial", "millis", "delay(", "NVIC_SystemReset", "deviceId"])
    if (pureNoStr.includes(tok)) v.push(`le code exécuté sur la pile de travail contient « ${tok} » (effet de bord ou état global)`);
  // 3. un seul lanceur, appelé une seule fois, jamais depuis une transaction réseau
  if ((src.match(/podWorkRun\(/g) ?? []).length !== 3) v.push("podWorkRun doit être appelé exactement trois fois (pull, register et validate)");
  if (!/auto wk = \[&\]\(\) \{ pullParseWork\(resp, code, r\); \};\n  return podWorkRun\(wk, &ni\);/.test(src)) v.push("pullParseOnWorkStack : lanceur attendu introuvable");
  if ((src.match(/pullParseOnWorkStack\(/g) ?? []).length !== 2) v.push("pullParseOnWorkStack : une définition et un seul appel (doPullApply)");
  // 4. ordre dans doPullApply : lancement -> échec de pile fermé -> statuts -> effets
  const iRun = apply.indexOf("const bool ran = pullParseOnWorkStack(resp, code, r, ni);");
  const iFail = apply.indexOf("if (!ran) { pullWorkFailed(ni); return 0; }");
  const iRate = apply.indexOf("if (r.status == PULL_P_RATE) {");
  const iJson = apply.indexOf("if (r.status == PULL_P_JSON) {");
  const iOk = apply.indexOf("if (r.status != PULL_P_OK) {");
  if (iRun < 0 || iFail < iRun) v.push("doPullApply : l'échec de la pile de travail doit être traité (fermé) immédiatement après le lancement");
  if (!(iFail < iRate && iRate < iJson && iJson < iOk)) v.push("doPullApply : ordre attendu échec de pile -> 429 -> JSON -> statut OK");
  const allowedBeforeOk = ["lastPullMs = "];   // le seul effet d'un 429 (valide) : le prochain pull avancé
  for (const e of SIDE_EFFECTS) {
    const i = apply.indexOf(e);
    if (i < 0) { v.push(`doPullApply : effet « ${e} » absent`); continue; }
    if (i < iOk) v.push(`doPullApply : « ${e} » AVANT la validation du résultat (statut OK)`);
  }
  for (const e of allowedBeforeOk) { const i = apply.indexOf(e); if (i < iFail || i > iOk) v.push(`doPullApply : « ${e} » mal placé (après l'échec de pile, dans la branche 429)`); }
  // 5. ordre des effets, comme avant : cartel, observation, ownedBlock, puis intervalle, bloc, candidat
  const order = ["pendingWorkTitle = ", "pendingObsHashes = ", "saveOwnedBlockHash(", "nextPullIntervalMs = ", "saveBlockHashToEEPROM(", "pendingCandidateId = "].map((e) => apply.indexOf(e));
  if (order.some((x, i) => x < 0 || (i > 0 && x < order[i - 1]))) v.push("doPullApply : ordre des effets (cartel, observation, ownedBlock, intervalle, bloc, candidat) modifié");
  // 6. doPull : la réponse est reçue (httpCall, TLS fermé) AVANT l'étage d'analyse ; l'étage n'est appelé que pour 200/429 ; resp libérée avant toute image
  const iHttp = dopull.indexOf('httpCall("GET", "/api/pull?deviceId=" + deviceId, nullptr, resp)');
  const iStage = dopull.indexOf("st = doPullStage(resp, code, newFrameId, newFrameSource);");
  const iGuard = dopull.indexOf("if (code != 429 && code != 200) { logf(\"[PULL] erreur HTTP %d\", code); return false; }");
  const iFree = dopull.indexOf("}", iStage);
  const iFetch = dopull.indexOf("doFetchFrame(");
  if (!(iHttp >= 0 && iHttp < iGuard && iGuard < iStage && iStage < iFree && iFree < iFetch)) v.push("doPull : ordre attendu httpCall -> code 200/429 -> doPullStage -> resp libérée -> doFetchFrame");
  if (!/if \(st == 0\) return false;\n  if \(st == 2\) return true;/.test(dopull)) v.push("doPull : retours 0 (échec) et 2 (429) attendus");
  // 7. l'échec de pile ferme : GUARD => arrêt sûr AVANT tout journal ; la structure de sortie est au tas (pas dans la pile principale)
  const pwf = body(src, "static void __attribute__((noinline)) pullWorkFailed(");
  if (!/^\{\n  if \(ni\.err == POD_NET_GUARD\) logfSafeStop\(\);\n  logf\(/.test(pwf)) v.push("pullWorkFailed : logfSafeStop() doit précéder tout logf sur GUARD");
  if (!/PullParsed\* const r = new \(std::nothrow\) PullParsed\(\);\n  if \(!r\) \{[^\n]*return 0; \}\n  const int rc = doPullApply\(\*r, resp, code, frameId, frameSource\);\n  delete r;\n  return rc;/.test(stage)) v.push("doPullStage : PullParsed doit être alloué au tas (échec => rejet) et libéré");
  if (/PullParsed [a-z]\w*;/.test(dopull + apply)) v.push("PullParsed ne doit pas vivre dans les cadres de la pile principale");
  // 8. bornes écrites
  for (const [k, n] of [["PULL_ID_MAX", 64], ["PULL_SRC_MAX", 16], ["PULL_TITLE_MAX", 255], ["PULL_ARTIST_MAX", 127], ["PULL_TS_MAX", 63], ["PULL_OBS_MAX", 8]] as const)
    if (!new RegExp(`#define ${k}\\s+${n}\\b`).test(src)) v.push(`borne ${k} = ${n} absente`);
  return v;
}

test("DOPULL-JSON-STACK-FIX1 (statique) : le décodage de /api/pull vit tout entier sur la pile de travail, rien n'est appliqué avant un retour valide, ordre des effets conservé ; CONTRÔLES NÉGATIFS", () => {
  const src = read(INO);
  assert.deepEqual(pullStackViolations(src), []);
  const mutants: Array<[string, string, string]> = [
    ["ownedBlock enregistré AVANT le lancement", "const bool ran = pullParseOnWorkStack(resp, code, r, ni);", "saveOwnedBlockHash(String(\"x\")); const bool ran = pullParseOnWorkStack(resp, code, r, ni);"],
    ["échec de pile ignoré", "if (!ran) { pullWorkFailed(ni); return 0; }", "if (!ran) { pullWorkFailed(ni); }"],
    ["échec de pile non traité", "  if (!ran) { pullWorkFailed(ni); return 0; }\n", ""],
    ["cartel appliqué avant la validation", "  if (r.status == PULL_P_RATE) {", "  pendingWorkTitle = r.workTitle;\n  if (r.status == PULL_P_RATE) {"],
    ["statut OK non vérifié", "if (r.status != PULL_P_OK) {", "if (false) {"],
    ["JSON décodé dans doPull (pile principale)", "    const int code = httpCall(\"GET\", \"/api/pull?deviceId=\" + deviceId, nullptr, resp);", "    const int code = httpCall(\"GET\", \"/api/pull?deviceId=\" + deviceId, nullptr, resp); { JSON_DOC(zz, 64); deserializeJson(zz, resp); }"],
    ["conversion String dans doApply", "  r.cartelBlockIndex = currentBlockIndex;", "  r.cartelBlockIndex = currentBlockIndex; JsonVariant vv; String ss = vv.as<String>();"],
    ["journal dans le code de la pile de travail", "  JSON_DOC(doc, 2048);", "  logf(\"x\"); JSON_DOC(doc, 2048);"],
    ["écriture mémoire non volatile dans le code de la pile de travail", "  r.status = PULL_P_OK;\n}", "  saveOwnedBlockHash(r.owned); r.status = PULL_P_OK;\n}"],
    ["lancement SANS pile de travail", "return podWorkRun(wk, &ni);", "wk(); return true;"],
    ["journal AVANT l'arrêt sûr sur GUARD", "  if (ni.err == POD_NET_GUARD) logfSafeStop();\n  logf(\"[PULL] analyse", "  logf(\"avant\"); if (ni.err == POD_NET_GUARD) logfSafeStop();\n  logf(\"[PULL] analyse"],
    ["PullParsed dans la pile principale", "  PullParsed* const r = new (std::nothrow) PullParsed();\n  if (!r) { logf(\"[PULL] réponse rejetée : mémoire insuffisante\"); return 0; }\n  const int rc = doPullApply(*r, resp, code, frameId, frameSource);\n  delete r;\n  return rc;", "  PullParsed pp;\n  return doPullApply(pp, resp, code, frameId, frameSource);"],
    ["ordre des effets : bloc avant ownedBlock", "  if (r.owned.length() >= 16) saveOwnedBlockHash(r.owned);", "  nextPullIntervalMs = 1; saveBlockHashToEEPROM(r.blockHash); if (r.owned.length() >= 16) saveOwnedBlockHash(r.owned);"],
    ["borne ID supprimée", "#define PULL_ID_MAX     64", "#define PULL_ID_MAX     640"],
    ["étage appelé avant la réponse", "    st = doPullStage(resp, code, newFrameId, newFrameSource);", "    st = 1;"],
  ];
  for (const [name, a, b] of mutants) {
    assert.ok(src.split(a).length === 2, `mutation « ${name} » : motif introuvable ou multiple`);
    assert.notEqual(pullStackViolations(src.replace(a, () => b)).length, 0, `mutation « ${name} » NON détectée`);
  }
});

test("DOPULL-JSON-STACK-FIX1 : les quatre autres firmwares R4 sont INCHANGÉS (aucun décodage sur pile de travail : propagation après validation matérielle) ; l'en-tête podNetStack.h porte podWorkRun et sa taille justifiée", () => {
  for (const sk of OTHERS) {
    const s = read(`arduino_uno_r4/${sk}/${sk}.ino`);
    assert.doesNotMatch(s, /PullParsed|podWorkRun|pullParseWork|doPullStage|doPullApply/, `${sk} ne doit pas porter le correctif (propagation ultérieure)`);
    assert.match(s, /const DeserializationError err = deserializeJson\(doc, resp\);/, `${sk} : doPull d'avant conservé`);
  }
  const h = read("consensus-pod/src/adapters/podNetStack.h");
  assert.match(h, /#define POD_WORK_STACK_TOTAL 2048u/);
  assert.match(h, /#define POD_WORK_DEEPEST_CALL 1536u/);
  assert.match(h, /#define POD_WORK_JSON_NESTING 8u/);
  assert.match(h, /static_assert\(POD_WORK_STACK_TOTAL >= POD_NET_GUARD_BYTES \+ POD_WORK_DEEPEST_CALL \+ 32u \+ 104u \+ POD_NET_MARGIN_GOAL, /);
  assert.match(h, /template <typename F> static bool podWorkRun\(F& f, PodNetInfo\* info = nullptr\) \{\s*const bool ok = PodNet::runSized\(\[\]\(void\* p\) \{ \(\*static_cast<F\*>\(p\)\)\(\); \}, &f, POD_WORK_STACK_TOTAL, info\);/);
  for (const sk of ["pod_uno_r4_eink29", ...OTHERS]) assert.equal(fs.readFileSync(path.join(root, `arduino_uno_r4/${sk}/podNetStack.h`)).compare(fs.readFileSync(path.join(root, "consensus-pod/src/adapters/podNetStack.h"))), 0, `${sk}/podNetStack.h diverge`);
});

test("DOPULL-JSON-STACK-FIX1 (canari) : une ligne « [CANARY] pull JSON » (pile de travail utilisée / marge / erreur / statut, tas avant et après), verrou sur toute erreur de pile ou statut inattendu ; le contrôle de la pile principale suit le RETOUR du rapport (règle A/B/C) ; aucune variable globale de plus", () => {
  const src = read(INO);
  const rep = /static void __attribute__\(\(noinline\)\) podCanaryPull\([^\n]*\{[\s\S]*?\n\}\n/.exec(src)![0];
  assert.doesNotMatch(rep, /podCanaryCheck/, "aucun podCanaryCheck dans le corps de la fonction de rapport");
  assert.match(src, /podCanaryPull\(ni, ran, r\.status, heapB\);\n#endif\n#if POD_RENDER_V1 && POD_CANARY\n  podCanaryCheck\("  P: apres l'analyse du pull \(silencieux\)", false\);\n#endif\n  if \(!ran\) \{ pullWorkFailed\(ni\); return 0; \}/);
  assert.match(src, /POD_DP_PROBE\(3\);\n#endif\n#if POD_RENDER_V1 && POD_CANARY\n  podCanaryPull\(/, "la sonde 3 précède le rapport");
  assert.match(src, /\[CANARY\] pull JSON : pile de travail dediee utilisee /);
  assert.match(src, /static bool __attribute__\(\(noinline\)\) podCanaryPullBad\(const PodNetInfo& ni, bool ran, uint8_t status\) \{ return !ran \|\| ni\.err != POD_NET_OK \|\| \(status != PULL_P_OK && status != PULL_P_RATE\); \}/);
  assert.match(src, /podCanaryPhase\(ni\.pad\[0\]\);\n  PodCanaryPullCtx c/, "la phase de PodNet (pad[0]) est contrôlée");
  // le build sans canari ne contient rien de tout cela
  const prod = noCanary(src);
  assert.doesNotMatch(prod, /podCanaryPull|PodCanaryPullCtx|heapB/);
});

// ── Exécution hôte du code RÉEL ─────────────────────────────────────────────────────────────────────────
const choice = findCompiler();
console.log(`[dopullJsonStack] ${describeChoice(choice)}`);
const ajCandidates = [process.env.ARDUINOJSON_DIR, path.join(os.homedir(), "Documents", "Arduino", "libraries", "ArduinoJson", "src"), path.join(os.homedir(), "Arduino", "libraries", "ArduinoJson", "src")].filter((x): x is string => !!x);
const ajDir = ajCandidates.find((d) => fs.existsSync(path.join(d, "ArduinoJson.h")));
const skipHost = !choice.path ? `${describeChoice(choice)} — exécution hôte IGNORÉE` : !ajDir ? `ArduinoJson introuvable (essayés : ${ajCandidates.join(", ")} ; variable ARDUINOJSON_DIR) — exécution hôte IGNORÉE` : false;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pullwork-"));
const exeName = process.platform === "win32" ? "pull_work_harness.exe" : "pull_work_harness";

/** Du premier « #define PULL_ID_MAX » à la fin de doPullStage, blocs de canari retirés (le code réel, sans l'instrument). */
function extractPull(): string {
  const src = read(INO);
  const a = src.indexOf("#define PULL_ID_MAX"), b = src.indexOf(DOPULL);
  assert.ok(a > 0 && b > a, "région du décodage introuvable");
  return noCanary(src.slice(a, b));
}
function build(mutate: (s: string) => string = (s) => s, lenient = false): string {
  const dir = fs.mkdtempSync(path.join(tmp, "b-"));
  fs.writeFileSync(path.join(dir, "pull_extract.inc"), mutate(extractPull()));
  const out = path.join(dir, exeName);
  compileHarness(choice.path!, path.join(root, "consensus-pod", "host", "pull_work_harness.cpp"), out,
    [`-I${dir}`, `-I${path.join(root, "consensus-pod", "host", "shim")}`, `-I${path.join(root, "consensus-pod", "src", "adapters")}`, `-isystem`, ajDir!,
      "-DARDUINOJSON_ENABLE_ARDUINO_STRING=1", "-DARDUINOJSON_ENABLE_ARDUINO_STREAM=0", "-DARDUINOJSON_ENABLE_ARDUINO_PRINT=0", "-DARDUINOJSON_ENABLE_PROGMEM=0", ...(lenient ? ["-Wno-unused-variable", "-Wno-unused-parameter", "-Wno-unused-function", "-Wno-unused-but-set-variable"] : [])]);
  return out;
}

test("DOPULL-JSON-STACK-FIX1 (HÔTE) : le code RÉEL du décodage contre ArduinoJson réel — minimale, complète, 429, tronquée, trop imbriquée, hors bornes, observation à 8/9, UTF-8, NOMEM/NESTED/GUARD/MARGIN, panne d'allocation à chaque point : tout ou rien", { skip: skipHost }, () => {
  const r = runProcess(build(), [], 60000);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout.trim(), /^PASS \d+$/);
});

test("DOPULL-JSON-STACK-FIX1 (HÔTE) : CONTRÔLES NÉGATIFS — borne supprimée, copie non vérifiée, effet avant la validation, échec de pile ignoré, journal avant l'arrêt sûr : le harnais les REFUSE", { skip: skipHost }, () => {
  const mutants: Array<[string, string, string]> = [
    ["borne des identifiants supprimée", "  if (n > max) { r.status = PULL_P_BOUNDS; return false; }\n  dst = \"\";\n  if (n > 0 && !dst.concat(src, (unsigned int)n)) { r.status = PULL_P_HEAP; return false; }\n  if (dst.length() != n) { r.status = PULL_P_HEAP; return false; }\n  return true;\n}\n// copie d'un texte", "  dst = src;\n  return true;\n}\n// copie d'un texte"],
    ["troncature UTF-8 sans frontière", "while (n > 0 && (((uint8_t)src[n]) & 0xC0) == 0x80) n--;", ""],
    ["observation : plafond de 8 supprimé", "if (hArr.size() > PULL_OBS_MAX) { r.status = PULL_P_BOUNDS; return; }", ""],
    ["observation : copie non vérifiée", "      if (arr.length() != want) { r.status = PULL_P_HEAP; return; }\n      r.obsHashes = arr;\n      if (r.obsHashes.length() != want) { r.status = PULL_P_HEAP; return; }", "      r.obsHashes = arr;"],
    ["concat non vérifié", "if (n > 0 && !dst.concat(src, (unsigned int)n)) { r.status = PULL_P_HEAP; return false; }\n  if (dst.length() != n) { r.status = PULL_P_HEAP; return false; }\n  return true;\n}\n// copie d'un texte", "dst.concat(src, (unsigned int)n);\n  return true;\n}\n// copie d'un texte"],
    ["ownedBlock appliqué avant la validation", "  if (!ran) { pullWorkFailed(ni); return 0; }", "  if (r.owned.length() >= 16) saveOwnedBlockHash(r.owned);\n  if (!ran) { pullWorkFailed(ni); return 0; }"],
    ["échec de pile ignoré", "if (!ran) { pullWorkFailed(ni); return 0; }", "if (!ran) { pullWorkFailed(ni); }"],
    ["statut non OK ignoré", "if (r.status != PULL_P_OK) {", "if (false) {"],
    ["cartel appliqué avant la validation", "  if (r.status == PULL_P_RATE) {", "  pendingWorkTitle = r.workTitle;\n  if (r.status == PULL_P_RATE) {"],
    ["journal avant l'arrêt sûr sur GUARD", "  if (ni.err == POD_NET_GUARD) logfSafeStop();\n  logf(", "  logf(\"avant\"); if (ni.err == POD_NET_GUARD) logfSafeStop();\n  logf("],
    ["décodage SANS pile de travail", "return podWorkRun(wk, &ni);", "wk(); return true;"],
    ["pas d'arrêt sûr sur GUARD", "  if (ni.err == POD_NET_GUARD) logfSafeStop();\n", ""],
  ];
  const base = extractPull();
  for (const [name, a, b] of mutants) {
    assert.ok(base.split(a).length === 2, `mutation « ${name} » : motif introuvable ou multiple`);
    const r = runProcess(build((s) => s.split(a).join(b), true), [], 60000);
    const bad = r.status !== 0 || !/^PASS \d+$/.test(r.stdout.trim());
    assert.ok(bad, `mutation « ${name} » NON détectée`);
  }
});
