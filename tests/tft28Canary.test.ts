// tests/tft28Canary.test.ts — LOT8B2D-R4-TFT28-CANARY-1 : UNO R4 WiFi + TFT 2,8″ tactile (arduino_uno_r4/pod_uno_r4/pod_uno_r4.ino).
// Preuves STATIQUES : (1) le chemin désactivé (POD_CANARY = 0) ne diffère du firmware d'origine (origin/main 3239d2e, figé dans firmware-backups/) que par des fonctions explicitement listées — l'affichage RGB565, le cache SD,
// le cartel, le toucher et les animations sont identiques au texte près ; (2) client TLS borné ; (3) tout le JSON sur la pile de travail ; (4) toute la carte SD sur pile dédiée ; (5) le canari ne contient AUCUN vote ;
// (6) crochets sans effet en production. Les exécutions hôte du vrai code sont dans tests/tft28Host.test.ts. Rien ici ne prouve un comportement sur la carte.
import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { BACKUP, INO, ROOT, effective, fnBody, readText, stripBlock, stripHooks, stripLine, topLevelName } from "./helpers/tft28Source";

const src = readText(INO), before = readText(BACKUP);
const prod = effective(src, false), can = effective(src, true);
const prodNoHooks = stripHooks(prod);
const code = (s: string) => stripBlock(stripLine(s));

test("sauvegarde figée d'avant le lot : empreinte SHA-256 (= sketch de origin/main 3239d2e)", () => {
  assert.equal(crypto.createHash("sha256").update(Buffer.from(readText(BACKUP), "utf8")).digest("hex")   /* fins de ligne normalisées : stable sous core.autocrlf */, "44fe50060b99360abd2092219cc4bf36e5a68ce9913ecaa0ef5bb95664408434");
});

test("drapeaux : POD_CANARY = 0 et POD_RENDER_V1 = 0 par défaut, jamais commités à 1 ; POD_RENDER_V1 sans AUCUN effet sur ce firmware (pas de rasteriseur v1)", () => {
  assert.match(src, /#ifndef POD_RENDER_V1\n#define POD_RENDER_V1 0\n#endif\n#ifndef POD_CANARY\n#define POD_CANARY 0\n#endif/);
  assert.doesNotMatch(src, /#define POD_(RENDER_V1|CANARY) 1\b/);
  const uses = code(src).match(/POD_RENDER_V1/g) ?? [];
  assert.equal(uses.length, 2, "POD_RENDER_V1 n'apparaît que dans sa définition par défaut (#ifndef + #define)");
  assert.doesNotMatch(src, /podRender|PodTftRenderer|PodEinkRenderer|podRenderStream|#include "podRender/);
  assert.equal(effective(src, false).includes("POD_RENDER_V1 1"), false);
});

// ── 1. chemin désactivé == firmware d'origine, hors fonctions listées ───────────────────────────────────────────────
function removedHunks(a: string, b: string): Array<{ start: number; count: number }> {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "tft28diff-"));
  const fa = path.join(d, "a").replace(/\\/g, "/"), fb = path.join(d, "b").replace(/\\/g, "/");
  fs.writeFileSync(fa, a); fs.writeFileSync(fb, b);
  let out = "";
  // git (déjà requis par le dépôt) plutôt que l'exécutable Unix « diff » : portable sous Windows ; code de sortie 1 = différences
  try { execFileSync("git", ["-c", "core.autocrlf=false", "diff", "--no-index", "--no-color", "--unified=0", fa, fb], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }); } catch (e) { out = (e as { stdout: string }).stdout ?? ""; }
  return [...out.matchAll(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/gm)].map((m) => ({ start: +m[1], count: m[2] === undefined ? 1 : +m[2] })).filter((h) => h.count > 0);
}
/** Fonctions d'ORIGINE autorisées à perdre ou modifier des lignes (chacune a une raison écrite dans docs/LOT_8B2D_R4_TFT28_CANARY_2026_10_12.md § 3). */
const MAY_CHANGE = new Set([
  "initSD", "restoreRows", "saveMeta", "restoreLastFrame", "toggleCartel", "animForget", "animLoadMarker", "onAnimTouch", "fetchAnimToSd", "runResidentAnim",   // carte SD sur pile dédiée (onSd)
  "doFetchFrame", "netGetBenchClip", "netGetBlockClip", "maybeFetchAnim",                                                                                                    // défaut collant du client TLS borné
  "doRegister", "doPull", "doValidate", "benchPollOnce",                                                                                                   // JSON sur la pile de travail
  "doValidateV2",                                                                                                                                          // re-register différé (plus de doRegister imbriqué sous le cadre de 416 o du vote)
  "serviceTouch", "loop",                                                                                                                                  // LOT8B2E ANIM-TOUCH-GESTURES-1 : appui court / long (classificateur), reprise automatique de 60 s sans cartel
]);
const MUST_BE_IDENTICAL = [
  "static void tftStatus(", "static void pushRow(int y) {", "static void swapRowBytes() {", "static void drawCartel() {", "static void drainTouch() {",
  "static bool waitTapOrTimeout(", "static bool streamFrame(", "static bool ackFrame(", "static void fastPixels(const uint16_t* colors, uint32_t len) {", "struct FastTft {", "static String asciiFold(",
  "static void displayKeyMaterialOnce() {", "static void displayOnboardingTFT(", "static void postBenchResult(", "static void playBenchClip(", "static void doBenchPoll() {", "static unsigned long msUntilNextTask() {",
  "static void maybeFetchAnim(const String& frameId) {", "static void saveOwnedBlockHash(", "static String loadOwnedHashesJson() {", "static void saveBlockHashToEEPROM(", "static String loadBlockHashFromEEPROM() {",
];
test("OFF : les lignes d'origine supprimées ou modifiées appartiennent toutes à des fonctions listées ; l'affichage, le cache SD, le cartel, le toucher, l'ACK et l'animation restent identiques au texte près", () => {
  const touched = new Map<string, number>();
  const oldLines = before.split("\n");
  for (const h of removedHunks(before, prodNoHooks)) for (let n = h.start; n < h.start + h.count; n++) { const f = topLevelName(oldLines, n); touched.set(f, (touched.get(f) ?? 0) + 1); }
  const unexpected = [...touched.keys()].filter((f) => !MAY_CHANGE.has(f));
  assert.deepEqual(unexpected, [], `lignes d'origine modifiées hors des fonctions listées : ${unexpected.join(", ")}`);
  for (const head of MUST_BE_IDENTICAL) {
    const a = fnBody(before, head), b = fnBody(prodNoHooks, head);
    assert.ok(a.length > 20, `${head} introuvable dans l'original`);
    assert.equal(b, a, `${head} a changé`);
  }
  // les fonctions renommées « …Impl » ont EXACTEMENT le corps d'origine
  for (const [orig, impl, sig] of [["initSD", "initSDImpl", "static void"], ["restoreRows", "restoreRowsImpl", "static bool"], ["saveMeta", "saveMetaImpl", "static void"], ["restoreLastFrame", "restoreLastFrameImpl", "static void"],
    ["toggleCartel", "toggleCartelImpl", "static void"], ["animForget", "animForgetImpl", "static void"], ["animLoadMarker", "animLoadMarkerImpl", "static void"], ["onAnimTouch", "onAnimTouchImpl", "static void"]]) {
    let a = fnBody(before, `${sig} ${orig}(`).replace(`${orig}(`, `${impl}(`);
    const b = fnBody(prodNoHooks, `${sig} ${impl}(`);
    // LOT8B2E ANIM-TOUCH-GESTURES-1 : les DEUX seules modifications voulues de ces corps (masquer le cartel ne reprend plus l'animation ; message de la pause par appui long)
    if (impl === "toggleCartelImpl") { const x = '    if (animOn && animPaused) { animPaused = false; logf("[ANIM] reprise"); }\n'; assert.equal(a.split(x).length, 2, "ligne de reprise automatique d'origine introuvable"); a = a.replace(x, ""); }
    if (impl === "onAnimTouchImpl") { const x = 'logf("[ANIM] pause (toucher) : re-toucher ou attendre 60 s pour reprendre");'; assert.equal(a.split(x).length, 2, "message de pause d'origine introuvable"); a = a.replace(x, 'logf("[ANIM] pause (appui long) : appui court = cartel, appui long ou 60 s = reprise");'); const y = "  animPaused = true; animPausedSince = millis();\n"; assert.equal(a.split(y).length, 2, "ligne de pause d'origine introuvable"); a = a.replace(y, "  animPaused = true; animPausedSince = millis(); animBgValid = false;   // l'affiche est restaurée : le champ d'animation n'est plus à l'écran\n"); }
    if (impl === "restoreLastFrameImpl") { const x = "  sdFrameValid = true; cartelVisible = false;\n"; assert.equal(a.split(x).length, 2, "ligne d'origine de restoreLastFrame introuvable"); a = a.replace(x, "  sdFrameValid = true; cartelVisible = false; animBgValid = false;\n"); }
    assert.ok(a.length > 20 && b.length > 20, `${orig} / ${impl} introuvable`);
    assert.equal(b, a, `${impl} : corps différent de ${orig} d'origine`);
  }
});

test("OFF : la partie réseau d'origine est inchangée (httpCall, Conn, netHttpRaw, doFetchFrame au défaut collant près) ; la cadence de pull est inchangée", () => {
  for (const head of ["static bool __attribute__((noinline)) netHttpRaw(", "static int httpCall("]) assert.equal(fnBody(prodNoHooks, head), fnBody(before, head), head);
  const df = fnBody(prodNoHooks, "static bool doFetchFrame("), dfOld = fnBody(before, "static bool doFetchFrame(");
  // LOT8B2E ANIM-TOUCH-GESTURES-1 (FIX1) : la SEULE autre différence voulue = « animBgValid = false » quand une nouvelle image remplace le champ d'animation
  const animBgDiff = [["      cartelVisible = false; animBgValid = false;            // une nouvelle image remplace tout, cartel compris (le champ d'animation n'est plus à l'écran)\n", "      cartelVisible = false;                                 // une nouvelle image remplace tout, cartel compris\n"]];
  let dfNorm = df.replace(" && c.client.fault() == 0;   // défaut collant du client TLS borné : image refusée (ni affichage annoncé, ni ACK)", ";");
  for (const [a, b] of animBgDiff) { assert.equal(dfNorm.split(a).length, 2, "ligne animBgValid de doFetchFrame introuvable"); dfNorm = dfNorm.replace(a, b); }
  assert.equal(dfNorm, dfOld);
  for (const k of ["#define PULL_INTERVAL     60000UL", "#define VALIDATE_INTERVAL 30000UL", "#define HTTP_TIMEOUT_MS   20000UL", "#define BENCH_POLL_MS      3000UL"]) assert.ok(src.includes(k), k);
  // même formule d'intervalle qu'avant (le défaut « frame déjà affichée => 60 s » du TFT est CONNU et NON corrigé ici : aucun changement de polling dans ce lot)
  assert.ok(prodNoHooks.includes("nextPullIntervalMs = (r.frameSource == \"none\" && r.candId.length() == 0) ? (unsigned long)r.retryAfter * 1000UL : PULL_INTERVAL;"));
  assert.ok(before.includes("nextPullIntervalMs = (newFrameSource == \"none\" && newCandId.length() == 0) ? (unsigned long)pullRetryAfter * 1000UL : PULL_INTERVAL;"));
  // le serveur : aucune route ajoutée ni retirée en production
  const routes = (s: string) => [...s.matchAll(/"(\/api\/[a-z\-/]+)/g)].map((m) => m[1]).sort().join(",");
  assert.equal(routes(code(prodNoHooks)), routes(code(before)));
});

// ── 2. client TLS borné ────────────────────────────────────────────────────────────────────────────────────────────
test("PodBoundedSSL : inclus, WiFiSSLClient redirigé AVANT Conn, tout téléchargement (image, clips) refuse le défaut collant ; copie identique à celle validée sur carte (e-ink 2,9″)", () => {
  assert.ok(src.includes('#include "pod_ssl_bounded.h"'));
  assert.ok(src.indexOf("#define WiFiSSLClient PodBoundedSSL") < src.indexOf("struct Conn {"));
  assert.match(src, /struct Conn \{\n  WiFiSSLClient client;\n  podhttp::Reader<WiFiSSLClient> rd;/);
  assert.equal(readText("arduino_uno_r4/pod_uno_r4/pod_ssl_bounded.h"), readText("arduino_uno_r4/pod_uno_r4_eink29/pod_ssl_bounded.h"));
  const c = code(src);
  assert.doesNotMatch(c, /set_new_handler|operator\s+new|operator\s+delete/, "jamais de new_handler ni d'operator new redéfini");
  assert.equal((c.match(/c\.client\.fault\(\) == 0/g) ?? []).length, 3, "image + deux clips");
  assert.equal((c.match(/WiFiSSLClient/g) ?? []).length, 4, "WiFiSSLClient : #define + Conn (2) + streamFrame, aucun autre usage direct");
  assert.doesNotMatch(c, /\bWiFiClient\b|\bWiFiSSLClient\s+\w+;(?!\s*podhttp)/);
});

// ── 3. JSON sur la pile de travail ─────────────────────────────────────────────────────────────────────────────────
test("JSON : les cinq décodeurs (register, pull ×2, validate, banc d'essai) sont sur la pile de travail, avec limite d'imbrication explicite ; aucun JSON sur la pile principale ni dans une transaction TLS", () => {
  const c = code(src);
  const calls = [...c.matchAll(/deserializeJson\(/g)];
  assert.equal(calls.length, 5);
  assert.equal((c.match(/deserializeJson\([a-z]+, resp, DeserializationOption::NestingLimit\(POD_WORK_JSON_NESTING\)\)/g) ?? []).length, 5, "chaque appel porte la limite d'imbrication explicite");
  const WORKERS = ["registerParseWork", "pullParseWork", "validateParseWork", "benchPollParseWork"];
  for (const w of WORKERS) assert.ok(fnBody(c, `static void __attribute__((noinline)) ${w}(`).includes("deserializeJson("), w);
  const inWorkers = WORKERS.map((w) => fnBody(c, `static void __attribute__((noinline)) ${w}(`)).join("\n");
  assert.equal((inWorkers.match(/deserializeJson\(/g) ?? []).length, 5);
  assert.equal((c.match(/podWorkRun\(/g) ?? []).length, 4, "quatre lanceurs (register, pull, validate, banc d'essai)");
  // aucun jeton ArduinoJson hors des quatre travailleurs
  const outside = WORKERS.reduce((s, w) => s.split(fnBody(c, `static void __attribute__((noinline)) ${w}(`)).join(""), c);
  for (const tok of ["JSON_DOC(", "JsonObject", "JsonArray", "JsonVariant", ".as<String>()", "DynamicJsonDocument", "JsonDocument ", "deserializeJson("]) {
    const left = outside.split("\n").filter((l) => l.includes(tok) && !/^#define JSON_DOC|^\s*#(if|define)/.test(l));
    assert.deepEqual(left, [], `« ${tok} » hors des travailleurs`);
  }
  // les travailleurs ne touchent ni à l'état global, ni au journal, ni à l'EEPROM, ni au réseau, ni à l'affichage
  const pure = inWorkers.replace(/"(?:[^"\\]|\\.)*"/g, '""');
  for (const re of [/\blogf\(/, /\bsave\w*\(/, /EEPROM/, /\btft\b/, /httpCall/, /ackFrame/, /Serial/, /millis\(/, /delay\(/, /\bpending\w+\b/, /\bcurrentBlock/, /\bnextPull/, /(?<![.\w])deviceId\b/, /(?<![.\w])registered\b/, /(?<![.\w])benchMode\b/])
    assert.doesNotMatch(pure, re, `un travailleur contient ${re}`);
  // aucun JSON dans une transaction TLS : les lambdas « auto tx = » ne contiennent pas de décodage
  for (const m of c.matchAll(/auto tx = \[&\]\(\) \{([\s\S]*?)\n  \};/g)) assert.doesNotMatch(m[1], /deserializeJson|Json|podWorkRun/);
  // bornes écrites
  assert.match(src, /#define PULL_ID_MAX     64\n#define PULL_SRC_MAX    16\n#define PULL_TITLE_MAX  255\n#define PULL_ARTIST_MAX 127\n#define PULL_OBS_MAX    8/);
});

test("JSON : « tout ou rien » — doPullApply et doRegisterDecode n'appliquent rien avant un résultat valide ; GUARD = arrêt sûr AVANT tout journal ; allocations au tas (échec = rejet)", () => {
  const apply = fnBody(code(src), "static int __attribute__((noinline)) doPullApply("), dec = fnBody(code(src), "static bool __attribute__((noinline)) doRegisterDecode(");
  const iRun = apply.indexOf("pullParseOnWorkStack(resp, code, r, ni)");
  for (const tok of ["pendingAnimHash =", "pendingObsHashes =", "saveOwnedBlockHash(", "benchMode =", "nextPullIntervalMs =", "currentBlockHash =", "saveBlockHashToEEPROM(", "pendingWorkTitle =", "lastPullMs ="]) {
    const i = apply.indexOf(tok); assert.ok(i > iRun, `${tok} doit suivre le décodage`);
  }
  assert.ok(apply.indexOf("if (!ran) { pullWorkFailed(ni); return 0; }") > iRun && apply.indexOf("if (r.status != PULL_P_OK)") > iRun);
  assert.ok(dec.indexOf("else { deviceId = r->deviceId;") > dec.indexOf("registerParseOnWorkStack(resp, *r, ni)"));
  for (const w of ["registerWorkFailed", "pullWorkFailed", "validateWorkFailed"]) assert.match(fnBody(code(src), `static void __attribute__((noinline)) ${w}(`), /\{\s*if \(ni\.err == POD_NET_GUARD\) logfSafeStop\(\);\s*logf\(/, w);
  assert.equal((code(src).match(/new \(std::nothrow\) (RegisterParsed|PullParsed|ValidateParsed|BenchPollParsed)\(\)/g) ?? []).length, 4);
  assert.doesNotMatch(code(src), /\b(RegisterParsed|PullParsed|ValidateParsed|BenchPollParsed) [a-z]\w*;/, "aucune structure décodée sur la pile principale");
});

// ── 4. carte SD / TFT sur pile dédiée ────────────────────────────────────────────────────────────────────────────────
test("SD : tout accès à la carte depuis la pile principale passe par onSd() ; streamFrame (pile réseau dédiée) et les travailleurs seuls l'appellent directement ; jamais d'imbrication", () => {
  const c = code(effective(src, false));
  const ALLOWED = ["initSDImpl", "restoreRowsImpl", "saveMetaImpl", "restoreLastFrameImpl", "toggleCartelImpl", "animForgetImpl", "animLoadMarkerImpl", "netGetBlockClipToSd", "animRemoveFiles", "animValidateAndMark", "runResidentAnim", "streamFrame"];
  const heads: Record<string, string> = {
    initSDImpl: "static void initSDImpl(", restoreRowsImpl: "static bool restoreRowsImpl(", saveMetaImpl: "static void saveMetaImpl(", restoreLastFrameImpl: "static void restoreLastFrameImpl(", toggleCartelImpl: "static void toggleCartelImpl(",
    animForgetImpl: "static void animForgetImpl(", animLoadMarkerImpl: "static void animLoadMarkerImpl(", netGetBlockClipToSd: "static bool __attribute__((noinline)) netGetBlockClipToSd(", animRemoveFiles: "static void __attribute__((noinline)) animRemoveFiles(", animValidateAndMark: "static bool __attribute__((noinline)) animValidateAndMark(", runResidentAnim: "static AnimEnd __attribute__((noinline)) runResidentAnim(", streamFrame: "static bool streamFrame(",
  };
  const allowedText = ALLOWED.map((n) => fnBody(c, heads[n])).join("\n");
  for (const [n, h] of Object.entries(heads)) assert.ok(fnBody(c, h).includes("SD."), `${n} doit accéder à la carte`);
  const rest = ALLOWED.reduce((s, n) => s.split(fnBody(c, heads[n])).join(""), c);
  assert.deepEqual(rest.split("\n").filter((l) => /\bSD\.(open|exists|remove|mkdir|begin)\(|\bFile\s+\w+\s*=\s*SD/.test(l)), [], "accès SD hors des fonctions listées");
  // les points d'entrée appelés depuis la pile principale sont des enveloppes onSd
  for (const [fn, tag] of [["initSD", "initSD"], ["restoreRows", "restoreRows"], ["saveMeta", "saveMeta"], ["restoreLastFrame", "restoreLastFrame"], ["toggleCartel", "toggleCartel"], ["animForget", "animForget"], ["animLoadMarker", "animLoadMarker"], ["onAnimTouch", "onAnimTouch"]]) {
    const w = fnBody(c, `static ${fn === "restoreRows" ? "bool" : "void"} ${fn}(`);
    assert.match(w, new RegExp(`onSd\\("${tag}", w\\)`), `${fn} : enveloppe onSd attendue`);
  }
  // ANIM-STREAM-FIX1 : fetchAnimToSd = marqueur supprimé -> clip écrit au fil de l'eau (pile réseau, FERMÉE au retour) -> validation en flux sur la pile SD ; runResidentAnim : tampon de 2 048 o (jamais le clip entier), validation + lecture sur UNE pile dédiée
  const fa = fnBody(c, "static bool fetchAnimToSd("); assert.ok(fa.indexOf("animRemoveFiles()") > 0 && fa.indexOf("animRemoveFiles()") < fa.indexOf("netGetBlockClipToSd(hash, announced, writeFailed)") && fa.indexOf("netGetBlockClipToSd(") < fa.indexOf("animValidateAndMark("));
  assert.ok(!/malloc\((announced|n)\)/.test(fa), "fetchAnimToSd n'alloue plus le clip entier");
  const ra = fnBody(c, "static AnimEnd __attribute__((noinline)) runResidentAnim("); assert.ok(ra.includes("malloc(ANIM_WORK_BYTES)") && ra.indexOf("malloc(ANIM_WORK_BYTES)") < ra.indexOf('onSd("animPlay", play)') && !/malloc\(n\)/.test(ra));
  // onSd : pas d'imbrication (branche directe dans une fonction à part, barrière de l'analyse statique), taille et échec fermé
  const sdHdr = code(readText("arduino_uno_r4/pod_uno_r4/pod_sd_stack.h"));
  assert.ok(!c.includes("template <typename F> static bool onSd("), "les gabarits ne sont plus définis dans le .ino");
  const sd = fnBody(sdHdr, "template <typename F> static bool onSd(");
  assert.match(sd, /if \(!podNetOnMainStack\(\)\) \{ onSdDirect\(f\); return true; \}/);
  assert.match(sd, /PodNet::runSized\(\[\]\(void\* p\) \{ \(\*static_cast<F\*>\(p\)\)\(\); \}, &f, POD_SD_STACK_TOTAL, &ni\)/);
  assert.match(sd, /if \(!ran\) sdStackFailed\(what, ni\);\s*return ran;/);
  assert.match(fnBody(c, "static void __attribute__((noinline)) sdStackFailed("), /\{\s*if \(ni\.err == POD_NET_GUARD\) logfSafeStop\(\);/);
  assert.ok(src.includes("#define POD_SD_STACK_TOTAL 1536u"));
  assert.ok(allowedText.length > 1000);
});

// ── 5. le canari ne contient AUCUN vote ─────────────────────────────────────────────────────────────────────────────
const VOTE_TOKENS = ["validate-candidate", "validation-result", "candidate-frame", "obs-confirm", "pod-vote", "signED25519", "doValidateV2", "doValidateV1", "netReadCandidate", "podVoteMessage", "podCheckStream", "PodScreenKind",
  "pod_vote_r4.h", "g_voteScratch", "g_voteChunk", "doValidateDecode", "validateParseWork", "ValidateParsed", "alreadyVoted", "rawHash", "signature\\\\\":"];
test("CANARI (POD_CANARY = 1) : aucune route de vote, aucune signature de vote, aucun décodeur de candidat dans le texte compilé ; la production les contient (le test est sensible)", () => {
  const canCode = code(can), prodCode = code(prod);   // le code compilé : les commentaires ne comptent pas (ils citent les routes pour expliquer)
  for (const t of VOTE_TOKENS) assert.ok(!canCode.includes(t), `canari : « ${t} » présent`);
  for (const t of ["validate-candidate", "validation-result", "candidate-frame", "obs-confirm", "signED25519", "doValidateV2", "netReadCandidate", "pod_vote_r4.h"]) assert.ok(prodCode.includes(t), `production : « ${t} » absent (test insensible)`);
  const cc = code(can);
  assert.match(fnBody(cc, "static bool doValidate() {"), /\{\s*pendingCandidateId = "";\s*return false;\s*\}$/, "stub de doValidate : ni requête ni journal");
  assert.doesNotMatch(fnBody(cc, "static bool doValidate() {"), /httpCall|doRegister|PodEd|logf/);
  assert.match(fnBody(cc, "static bool doObsConfirm() {"), /pendingObsHashes = ""; pendingObsTarget = "";/);
  assert.doesNotMatch(fnBody(cc, "static bool doObsConfirm() {"), /httpCall/);
  // aucun appel Ed25519 en canari hors de l'auto-test du boot (message fixe)
  assert.deepEqual([...cc.matchAll(/PodEd::(sign|verify|derivePublicKey)\(/g)].map((m) => m[1]).sort(), ["derivePublicKey", "derivePublicKey", "sign", "verify"]);
  assert.ok(fnBody(cc, "static void selfTestEd25519() {").includes('static const char msg[] = "pod-r4-selftest";'));
  // un candidat annoncé par le pull est oublié (jamais retenu) : une ligne de journal, aucune affectation de pendingCandidateId dans la chaîne du pull
  assert.ok(can.includes("#define POD_CANARY_CANDIDATE(candId) do { if ((candId).length() > 0) logf(\"[CANARY] candidat annonce : AUCUN vote en build canari (oublie localement)\"); } while (0)"));
  assert.ok(!/pendingCandidateId\s*=\s*r\.candId/.test(cc));
  // le banc d'essai annoncé par le serveur est ignoré
  assert.ok(can.includes("#define POD_CANARY_NO_BENCH(flag) do { if (flag) { logf(\"[CANARY] banc d'essai annonce par le serveur : IGNORE en canari\"); flag = false; } } while (0)"));
  // canari : lest de RAM statique (le vote retiré ne doit pas agrandir le tas)
  assert.match(src, /static volatile uint8_t g_canBallast\[\d+\];/);
});

test("CANARI : l'ACK décide du succès — requête AVANT l'état « acquitté » ; refus ou impossibilité => retour false, lastFrameId inchangé, métadonnées SD non écrites ; jamais d'ACK après une lecture ou un affichage incomplet", () => {
  const tail = fnBody(code(can), "static bool __attribute__((noinline)) doFetchTailCanary(");
  const iAck = tail.indexOf("const bool acked = ackFrame(frameId);"), iFail = tail.indexOf("if (!acked)"), iSet = tail.indexOf("lastFrameId = frameId;"), iMeta = tail.indexOf("saveMeta(frameId)");
  assert.ok(iAck >= 0 && iAck < iFail && iFail < iSet && iSet < iMeta);
  assert.match(tail, /if \(!acked\) \{[^}]*ECHEC ACK[^}]*return false; \}/);
  const df = fnBody(code(can), "static bool doFetchFrame(");
  assert.ok(df.indexOf("if (!shown) {") < df.indexOf("return doFetchTailCanary(frameId, frameSource, t0);"), "l'ACK n'est atteint qu'après un affichage complet");
  assert.equal((code(can).match(/ackFrame\(frameId\)/g) ?? []).length, 1, "un seul ACK dans le canari");
  assert.equal((code(prod).match(/ackFrame\(frameId\)/g) ?? []).length, 1, "un seul ACK en production");
  assert.match(fnBody(code(can), "static bool ackFrame(const String& frameId) {"), /if \(frameId\.length\(\) == 0\) return false;/);
});

// ── 6. crochets du canari ───────────────────────────────────────────────────────────────────────────────────────────
test("crochets : sans effet en production (macros vides), un seul bloc de définition en canari, aucune E/S série directe hors du bloc de canari et de logfEmit, arrêt sûr sur pile principale < 128 o ou erreur d'une pile dédiée", () => {
  for (const m of ["POD_CANARY_JSON", "POD_CANARY_NET", "POD_CANARY_SD", "POD_CANARY_WIFI", "POD_CANARY_ED", "POD_CANARY_CHECK", "POD_CANARY_HEAP", "POD_CANARY_NO_BENCH"]) {
    assert.equal((src.match(new RegExp(`#define ${m}\\(`, "g")) ?? []).length, 2, `${m} : une définition canari + une définition vide`);
    assert.match(src, new RegExp(`#define ${m}\\([^)]*\\) \\(\\(void\\)0\\)`));
  }
  assert.match(src, /#define POD_CANARY_CANDIDATE\(candId\) do \{ if \(\(candId\)\.length\(\) > 0\) pendingCandidateId = \(candId\); \} while \(0\)/, "production : l'ancienne affectation du candidat");
  // E/S série : seulement logfEmit (production) + bloc canari + setup (Serial.begin)
  const prodOnly = code(effective(src, false));
  assert.deepEqual(prodOnly.split("\n").filter((l) => /\bSerial\./.test(l)).map((l) => l.trim()), ["Serial.println(b);", "Serial.begin(115200);"]);
  const canaryBlock = /#if POD_CANARY\n\/\/ ─── CANARI \(LOT8B2D\)[\s\S]*?\n#endif\n/.exec(src)![0];
  assert.match(canaryBlock, /margin < 128/); assert.match(canaryBlock, /ni\.err != POD_NET_OK/); assert.match(canaryBlock, /Serial\.availableForWrite\(\) >= 120/);
  assert.match(canaryBlock, /static void __attribute__\(\(noinline, noreturn\)\) podCanaryHalt/);
  // un contrôle de pile ne s'appelle jamais depuis le corps d'une fonction de rapport (règle A/B/C du lot 8B-2B-2)
  for (const rep of ["podCanaryPrint", "podCanaryPrintHeap", "podCanaryPrintStack", "podCanaryEd"]) assert.doesNotMatch(fnBody(canaryBlock, `static void ${rep.startsWith("podCanaryEd") ? "__attribute__((noinline)) " : ""}${rep}(`), /podCanaryCheck\(/);
  // objectif >= 256 signalé ; pas d'accélération du polling : aucun delay/boucle réseau ajouté
  assert.match(canaryBlock, /SOUS L'OBJECTIF/);
  assert.doesNotMatch(code(canaryBlock), /httpCall|WiFiSSLClient|podNetRun|delay\(/);
  // le build canari ne s'active que par -DPOD_CANARY=1 : le texte de la production n'a plus aucune trace du canari
  assert.doesNotMatch(prodNoHooks.replace(/\/\/.*$/gm, ""), /podCanary|g_canBallast|g_podPaintLen|ECHEC ACK/);
});

test("aucun secret, binaire ni bibliothèque installée dans le dossier du sketch ; aucune propagation aux autres firmwares", () => {
  const dir = path.join(ROOT, "arduino_uno_r4", "pod_uno_r4");
  for (const f of fs.readdirSync(dir)) {
    assert.ok(!/^secrets\.h$/.test(f) && !/\.(bin|hex|elf|uf2)$/.test(f), f);
  }
  for (const other of ["pod_uno_r4_eink27", "pod_uno_r4_eink27_oled", "pod_uno_r4_tft18", "pod_uno_r4_dht22"]) {
    const d = path.join(ROOT, "arduino_uno_r4", other);
    if (!fs.existsSync(d)) continue;
    for (const f of fs.readdirSync(d)) if (/\.(ino)$/.test(f)) assert.doesNotMatch(fs.readFileSync(path.join(d, f), "utf8"), /onSd\(|LOT8B2D|POD_SD_STACK_TOTAL/, `${other}: aucune propagation`);
  }
});

// ── 7. inventaire formel (scripts/tft28-inventory.js) ───────────────────────────────────────────────────────────────────
test("INVENTAIRE FORMEL : WiFi.* (6, tous dans une enveloppe podWifiRun), Conn (5 en production, 4 en canari, tous dans un « auto tx » de podNetRun), deserializeJson (5 / 4, tous sur la pile de travail), Ed25519 (via PodEd), routes", () => {
  const inv = JSON.parse(execFileSync("node", [path.join(ROOT, "scripts", "tft28-inventory.js"), "--json"], { encoding: "utf8" })) as Record<"production" | "canari", Record<string, string[]>>;
  const fns = (a: string[]) => a.map((x) => x.split(" → ")[0]).sort();
  const count = (a: string[]) => a.reduce((n, x) => n + (/×(\d+)$/.exec(x) ? Number(/×(\d+)$/.exec(x)![1]) : 1), 0);
  for (const k of ["production", "canari"] as const) {
    assert.deepEqual(fns(inv[k].wifi), ["wifiBegin/λwx", "wifiFirmware/λwx", "wifiIpString/λwx", "wifiMac/λwx", "wifiRssi/λwx", "wifiStatusT/λwx"], `${k} : WiFi.*`);
    for (const c of inv[k].conn) assert.match(c, /\/λtx → Conn c$/, `${k} : Conn hors d'un auto tx : ${c}`);
    for (const j of inv[k].json) assert.match(j, /^(registerParseWork|pullParseWork|validateParseWork|benchPollParseWork) → deserializeJson/, `${k} : JSON hors pile de travail : ${j}`);
    for (const e of inv[k].ed25519) assert.match(e, /→ PodEd::/, `${k} : Ed25519 direct : ${e}`);
  }
  assert.deepEqual(fns(inv.production.conn), ["doFetchFrame/λtx", "netGetBenchClip/λtx", "netGetBlockClipToSd/λtx", "netHttpRaw/λtx", "netReadCandidate/λtx"]);
  assert.deepEqual(fns(inv.canari.conn), ["doFetchFrame/λtx", "netGetBenchClip/λtx", "netGetBlockClipToSd/λtx", "netHttpRaw/λtx"]);
  assert.equal(count(inv.production.json), 5, "production : 5 décodages");
  assert.equal(count(inv.canari.json), 4, "canari : 4 décodages (pas de candidat)");
  assert.deepEqual(inv.canari.ed25519.sort(), ["generateKeys → PodEd::derivePublicKey", "loadKeysFromEEPROM → PodEd::derivePublicKey", "selfTestEd25519 → PodEd::sign", "selfTestEd25519 → PodEd::verify"].sort());
  for (const r of inv.canari.routes) assert.doesNotMatch(r, /validate|validation|candidate-frame|obs-confirm/, `route de vote atteignable en canari : ${r}`);
  for (const r of ["/api/validate-candidate?device", "/api/validation-result", "/api/candidate-frame?candidate", "/api/obs-confirm"]) assert.ok(inv.production.routes.includes(r), `production : ${r}`);
  for (const r of ["/api/register", "/api/pull?device", "/api/pull-frame?device", "/api/ack-frame", "/api/block-clip?hash"]) assert.ok(inv.canari.routes.includes(r), `canari : ${r}`);
  // chaque lanceur de pile (réseau / Wi-Fi / travail / SD) existe pour chaque site profond : pas de lanceur imbriqué dans un autre
  const launchers = inv.canari.launchers.filter((l) => !/^(logf|onSd) → /.test(l));
  assert.ok(launchers.length >= 15);
});

// ── 8. compatibilité avec le générateur de prototypes d'Arduino (arduino-cli 1.4.1, cœur 1.6.0 : « error: 'F' is not a type ») ─────────────────────────────────────
test("générateur de prototypes d'Arduino : AUCUN gabarit (template) défini dans le .ino ; onSd / onSdDirect vivent dans pod_sd_stack.h, inclus après sdStackFailed et POD_CANARY_SD", () => {
  assert.doesNotMatch(code(src), /^\s*template\s*</m, "un template dans le .ino reçoit un prototype sans sa ligne « template <…> »");
  const hdr = readText("arduino_uno_r4/pod_uno_r4/pod_sd_stack.h");
  assert.match(hdr, /^#pragma once$/m);
  assert.match(code(hdr), /template <typename F> static void __attribute__\(\(noinline\)\) onSdDirect\(F& f\) \{ f\(\); \}/);
  assert.match(code(hdr), /template <typename F> static bool onSd\(const char\* what, F& f\) \{/);
  const iHdr = src.indexOf('#include "pod_sd_stack.h"');
  assert.ok(iHdr > src.indexOf("static void __attribute__((noinline)) sdStackFailed(") && iHdr > src.indexOf("#define POD_SD_STACK_TOTAL 1536u") && iHdr > src.indexOf("#define POD_CANARY_SD(tag, ni, ran) ((void)0)"), "ordre d'inclusion");
  assert.equal((src.match(/#include "pod_sd_stack.h"/g) ?? []).length, 1);
  // toute fonction de haut niveau dont la signature cite un type DÉFINI dans le .ino porte __attribute__ (le générateur d'Arduino ne lui fait alors pas de prototype avant la définition du type)
  for (const t of ["RegisterParsed", "PullParsed", "ValidateParsed", "BenchPollParsed", "PodCanaryCtx", "PodCanaryHeapCtx", "PodCanaryStackCtx"]) {
    for (const m of code(src).matchAll(new RegExp(`^(static [^\\n(]*\\b\\w+\\([^\\n]*\\b${t}\\b[^\\n]*\\)) \\{$`, "gm"))) assert.match(m[1], /__attribute__/, `${m[1].slice(0, 80)} : prototype généré avant la définition de ${t}`);
  }
});
