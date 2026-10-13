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
const fwd = (p: string) => p.replace(/\\/g, "/");   // g++ MSYS sous Windows : chemins en « / »
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
  if (kind === "register") { extract = "#include <new>\n" + between(prod, "enum RegisterStatus", "enum RegisterExchange"); harness = "register_work_harness.cpp"; incName = "register_extract.inc"; }
  else if (kind === "validate") { extract = between(prod, "enum ValidateStatus", "static bool doValidateV1(const String& candidateId, float score);\nstatic bool doValidate() {"); harness = "validate_work_harness.cpp"; incName = "validate_extract.inc"; }
  else { extract = "#include <new>\n" + between(prod, "#define PULL_ID_MAX", "static bool doPull() {"); harness = "tft28_pull_work_harness.cpp"; incName = "pull_extract.inc"; }
  fs.writeFileSync(path.join(dir, incName), (kind === "register" ? hooks(false) : "") + mutate(extract));
  fs.writeFileSync(path.join(dir, "hooks.inc"), hooks(canary));
  const out = path.join(dir, "harness");
  compileHarness(choice.path!, fwd(path.join(HOST, harness)), fwd(out), [`-I${fwd(dir)}`, `-I${fwd(path.join(HOST, "shim"))}`, `-I${fwd(path.join(ROOT, "arduino_uno_r4", "pod_uno_r4"))}`, "-isystem", fwd(ajDir!), ...AJ_FLAGS, ...(canary ? ["-DHARNESS_CANARY=1"] : []), ...(lenient ? LENIENT : [])]);
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
  const muts: Array<[string, boolean, string, string, string?, string?]> = [
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
  const reg = "#include <new>\n" + between(prod, "enum RegisterStatus", "enum RegisterExchange"), val = between(prod, "enum ValidateStatus", "static bool doValidateV1(const String& candidateId, float score);\nstatic bool doValidate() {");
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

// ═══ firmware complet (setup / loop / doFetchFrame / streamFrame / carte SD / cartel / tactile / animations / ACK) contre les bibliothèques simulées ═══
import { encodeClip, CLIP } from "../lib/bench/clip";
const MOCK = path.join(HOST, "tft28");
const SKETCH_DIR = path.join(ROOT, "arduino_uno_r4", "pod_uno_r4");
let nBuild = 0;
function buildFull(canary: boolean, mutate: (s: string) => string = (s) => s, mutateHdr: (s: string) => string = (s) => s): string {
  const dir = fs.mkdtempSync(path.join(tmp, `full-${nBuild++}-`));
  const sk = path.join(dir, "sk"); fs.mkdirSync(sk);
  for (const f of ["podEdStack.h", "podNetStack.h", "pod_http.h", "pod_bench.h", "pod_bench_stream.h", "pod_touch_gesture.h", "pod_vote_r4.h", "pod_metrics.h", "pod_metrics_table.h"]) fs.copyFileSync(path.join(SKETCH_DIR, f), path.join(sk, f));
  fs.writeFileSync(path.join(sk, "pod_sd_stack.h"), mutateHdr(fs.readFileSync(path.join(SKETCH_DIR, "pod_sd_stack.h"), "utf8").replace(/\r\n/g, "\n")));   // gabarits onSd / onSdDirect (hors du .ino)
  fs.copyFileSync(path.join(MOCK, "pod_ssl_bounded.h"), path.join(sk, "pod_ssl_bounded.h"));   // le client TLS SIMULÉ (le vrai est testé contre le vrai Modem.cpp par boundedSsl.test.ts)
  fs.writeFileSync(path.join(sk, "sketch_body.inc"), mutate(src));
  const out = path.join(dir, "tft28_harness");
  const r = runProcess(choice.path!, ["-std=gnu++17", "-O1", "-w", "-fno-strict-aliasing", `-DPOD_CANARY=${canary ? 1 : 0}`, `-DPOD_RENDER_V1=${canary ? 1 : 0}`, `-I${fwd(sk)}`, `-I${fwd(MOCK)}`, "-isystem", fwd(ajDir!), ...AJ_FLAGS, fwd(path.join(HOST, "tft28_harness.cpp")), "-o", fwd(out)], 240000);
  assert.equal(r.status, 0, `compilation du harnais firmware complet impossible\n${(r.stderr || "").slice(-2500)}`);
  return out;
}
const clipHexFile = (() => {
  const f1 = Uint8Array.from({ length: CLIP.FRAME_BYTES }, (_, i) => (i * 7) & 0xff), f2 = Uint8Array.from({ length: CLIP.FRAME_BYTES }, (_, i) => (i * 13 + 5) & 0xff);
  const f = path.join(tmp, "clip.hex"); fs.writeFileSync(f, Buffer.from(encodeClip({ frames: [f1, f2], delaysMs: [50, 50], loops: 0, fg: 0x07e0, bg: 0x0842 })).toString("hex")); return f;
})();
const bigClipHexFile = (() => {
  const r = (() => { let s = 123456789 >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 0x100000000); })();
  const frames = Array.from({ length: 50 }, () => Uint8Array.from({ length: CLIP.FRAME_BYTES }, () => (r() < 0.02 ? Math.floor(r() * 256) : 0)));
  const bin = encodeClip({ frames, delaysMs: frames.map(() => 50), loops: 0, fg: 0x07e0, bg: 0x0842 });
  const f = path.join(tmp, "bigclip.hex"); fs.writeFileSync(f, Buffer.from(bin).toString("hex")); return f;
})();
const passFull = (exe: string) => { const r = runProcess(exe, ["--clip", fwd(clipHexFile), "--bigclip", fwd(bigClipHexFile)], 180000); return { ok: r.status === 0 && /^PASS \d+$/.test(r.stdout.trim()), out: r.stdout + r.stderr }; };
const exeCache = new Map<string, string>();
const fullExe = (canary: boolean) => { const k = String(canary); if (!exeCache.has(k)) exeCache.set(k, buildFull(canary)); return exeCache.get(k)!; };

for (const canary of [false, true]) {
  test(`HÔTE firmware COMPLET (${canary ? "CANARI POD_CANARY=1" : "PRODUCTION POD_CANARY=0"}) : image 240×320 octet par octet, cache SD, cartel / toucher, restauration, animations, pannes (tronqué, silence, taille, SD, défaut TLS), ACK 200 / refusé / impossible, aucun ACK hors affichage complet${canary ? ", AUCUN vote en 10 minutes de boucle" : ", le vote existe (test sensible)"}`, { skip: skipHost }, () => {
    const r = passFull(fullExe(canary));
    assert.ok(r.ok, r.out);
  });
}
test("HÔTE canari : arrêt sûr (le processus se FIGE, sans rien faire de plus) sur garde écrasée, erreur ou marge d'une pile dédiée (réseau, SD), mémoire insuffisante, marge de la pile principale < 128 o, marqueur détruit ; la commande de contrôle, elle, se termine", { skip: skipHost }, () => {
  const exe = fullExe(true);
  const ctrl = runProcess(exe, ["halt:control"], 20000); assert.equal(ctrl.status, 0, ctrl.stdout + ctrl.stderr); assert.match(ctrl.stdout, /NOHALT/);
  for (const sc of ["guard-net", "nomem-frame", "ack-stack", "sd-nomem", "margin-net", "main-stack", "marker", "sd-stack-margin"]) {
    const r = runProcess(exe, [`halt:${sc}`], 3000);
    assert.ok(r.status !== 0 && !/NOHALT/.test(r.stdout), `${sc} : le canari devait se figer (statut ${r.status}, sortie « ${r.stdout.trim()} »)`);
  }
  // production : la garde écrasée fige aussi (arrêt sûr silencieux), mais une simple marge ou un NOMEM ne figent pas
  const prodExe = fullExe(false);
  const g = runProcess(prodExe, ["halt:guard-net"], 3000); assert.ok(g.status !== 0 && !/NOHALT/.test(g.stdout), "production : garde écrasée => arrêt sûr");
  const c0 = runProcess(prodExe, ["halt:control"], 20000); assert.equal(c0.status, 0); assert.match(c0.stdout, /NOHALT/);
});
test("HÔTE firmware complet : CONTRÔLES NÉGATIFS — ACK avant l'affichage, défaut collant ignoré, ordre des octets, cache SD, bandes du cartel, ACK ignoré / vote atteignable en canari, pile SD sans échec fermé : le harnais les REFUSE", { skip: skipHost }, () => {
  const muts: Array<[string, boolean, string, string, string?, string?]> = [
    ["ACK malgré une image incomplète (production)", false, "  if (!shown) { logf(\"[FRAME] image incomplète — pas d'ACK, nouvel essai au prochain pull\"); sdFrameValid = false; return false; }", "  if (!shown) { logf(\"[FRAME] image incomplète — pas d'ACK, nouvel essai au prochain pull\"); sdFrameValid = false; ackFrame(frameId); return false; }"],
    ["défaut collant du client TLS ignoré", false, " && c.client.fault() == 0;   // défaut collant du client TLS borné : image refusée (ni affichage annoncé, ni ACK)", ";"],
    ["octets du bus non permutés (little-endian envoyé tel quel)", false, "    swapRowBytes();                                          // LE serveur -> BE bus SPI\n", ""],
    ["cache SD non écrit", false, "    if (saving && f.write(raw, ROW_BYTES) != (size_t)ROW_BYTES) {", "    if (false && f.write(raw, ROW_BYTES) != (size_t)ROW_BYTES) {"],
    ["ligne incomplète non signalée (image tronquée déclarée affichée)", false, "{ logf(\"[FRAME] ligne %d incomplète\", y); ok = false; break; }", "{ logf(\"[FRAME] ligne %d incomplète\", y); break; }"],
    ["masquage : seule la bande haute restaurée", false, "if (restoreRows(0, BAND_TOP_H) && restoreRows(BAND_BOT_Y, BAND_BOT_H)) {", "if (restoreRows(0, BAND_TOP_H)) {"],
    ["masquage : dernière ligne de la bande basse non restaurée", false, "restoreRows(BAND_BOT_Y, BAND_BOT_H)", "restoreRows(BAND_BOT_Y, BAND_BOT_H - 1)"],
    ["cartel qui déborde sur l'œuvre (bande haute trop haute)", false, "  tft.fillRect(0, 0, SCR_W, BAND_TOP_H - 1, C_DARK);\n  tft.drawFastHLine(0, BAND_TOP_H - 1, SCR_W, C_GOLD);\n  tft.setTextSize(2); tft.setTextColor(C_GOLD, C_DARK); tft.setCursor(8, 12);", "  tft.fillRect(0, 0, SCR_W, BAND_TOP_H + 20, C_DARK);\n  tft.drawFastHLine(0, BAND_TOP_H - 1, SCR_W, C_GOLD);\n  tft.setTextSize(2); tft.setTextColor(C_GOLD, C_DARK); tft.setCursor(8, 12);"],
    ["métadonnées SD écrites même sans image complète sur la carte", false, "  if (sdFrameValid) saveMeta(frameId);\n  logf(\"[FRAME] OK en %lu ms (frameId=%s source=%s, cache SD: %s)\", millis() - t0, frameId.c_str(), frameSource.c_str(), sdFrameValid ? \"oui\" : \"non\");\n  ackFrame(frameId);", "  saveMeta(frameId);\n  logf(\"[FRAME] OK en %lu ms (frameId=%s source=%s, cache SD: %s)\", millis() - t0, frameId.c_str(), frameSource.c_str(), sdFrameValid ? \"oui\" : \"non\");\n  ackFrame(frameId);"],
    ["CANARI : résultat de l'ACK ignoré", true, "  if (!acked) { logf(\"[CANARY] ECHEC ACK", "  if (false) { logf(\"[CANARY] ECHEC ACK"],
    ["CANARI : frame marquée acquittée avant l'ACK", true, "  const bool acked = ackFrame(frameId);\n", "  lastFrameId = frameId;\n  const bool acked = ackFrame(frameId);\n"],
    ["CANARI : une requête de vote ATTEIGNABLE (candidat retenu + doValidate qui interroge le serveur)", true, "static bool doValidate() {\n  pendingCandidateId = \"\";\n  return false;\n}", "static bool doValidate() {\n  String r; httpCall(\"GET\", \"/api/validate-candidate?deviceId=\" + deviceId, nullptr, r);\n  pendingCandidateId = \"\";\n  return false;\n}",
      "#define POD_CANARY_CANDIDATE(candId) do { if ((candId).length() > 0) logf(\"[CANARY] candidat annonce : AUCUN vote en build canari (oublie localement)\"); } while (0)", "#define POD_CANARY_CANDIDATE(candId) do { if ((candId).length() > 0) pendingCandidateId = (candId); } while (0)"],
    ["CANARI : candidat retenu", true, "#define POD_CANARY_CANDIDATE(candId) do { if ((candId).length() > 0) logf(\"[CANARY] candidat annonce : AUCUN vote en build canari (oublie localement)\"); } while (0)", "#define POD_CANARY_CANDIDATE(candId) do { if ((candId).length() > 0) pendingCandidateId = (candId); } while (0)"],
    ["CANARI : confirmation d'observation atteignable", true, "  pendingObsHashes = \"\"; pendingObsTarget = \"\";\n  logf(\"[CANARY] observation annoncee", "  { String r; httpCall(\"POST\", \"/api/obs-confirm\", nullptr, r); }\n  pendingObsHashes = \"\"; pendingObsTarget = \"\";\n  logf(\"[CANARY] observation annoncee"],
    ["CANARI : banc d'essai non ignoré", true, "#define POD_CANARY_NO_BENCH(flag) do { if (flag) { logf(\"[CANARY] banc d'essai annonce par le serveur : IGNORE en canari\"); flag = false; } } while (0)", "#define POD_CANARY_NO_BENCH(flag) ((void)0)"],
    ["FIX2 : tampon de travail de l'animation alloué AVANT le téléchargement (pic de tas)", false, "const bool got = netGetBlockClipToSd(hash, announced, writeFailed);", "uint8_t* early = (uint8_t*)malloc(2048); const bool got = netGetBlockClipToSd(hash, announced, writeFailed); free(early);"],
    ["FIX2 : échec d'allocation du tampon après le téléchargement ignoré (validation sans tampon)", false, "    if (!work) logf(", "    if (!work) { ok = animValidateAndMark(hash, announced, work, frames); } if (!work) logf("],
    ["GESTES : l'appui court interrompt la lecture au lieu de basculer le cartel sur place", false, "liveShown++; animCartelToggleLive(); }", "liveShown++; why = AE_TOUCH; return false; }"],
    ["GESTES : le démarrage de la lecture efface toujours tout l'écran (cartel perdu)", false, "if (cartelVisible) tft.fillRect(0, BAND_TOP_H, SCR_W, BAND_BOT_Y - BAND_TOP_H, si.bg);", "if (false) tft.fillRect(0, BAND_TOP_H, SCR_W, BAND_BOT_Y - BAND_TOP_H, si.bg);"],
    ["GESTES : l'appui long ne sort pas de la lecture", false, "podTouchLatchArm(touchLatch); why = AE_TOUCH; return false; }", "podTouchLatchArm(touchLatch); }"],
    ["GESTES : pas de verrou de relâchement après l'appui long (appui court fantôme)", false, "podTouchLatchArm(touchLatch); why = AE_TOUCH; return false; }", "why = AE_TOUCH; return false; }"],
    ["GESTES (FIX1) : un appui COURT hors du lecteur met l'animation en pause", false, "case PTA_TOGGLE_PLAYING: toggleCartelWhilePlaying(); break;", "case PTA_TOGGLE_PLAYING: onAnimTouch(); break;"],
    ["GESTES (FIX1) : le verrou de relâchement après un appui long est ignoré par serviceTouch", false, "  if (touchLatch.on) { (void)podTouchLatchBlocked(touchLatch, ts.touched(), millis()); return; }", ""],
    ["GESTES (FIX1) : le champ d'animation n'est jamais déclaré à l'écran (bascule toujours par la carte)", false, "animBg = si.bg; animBgValid = true;", "animBg = si.bg;"],
    ["GESTES (FIX1) : le verrou se lève dès le premier échantillon relâché", false, "  if (touchLatch.on) { (void)podTouchLatchBlocked(touchLatch, ts.touched(), millis()); return; }", "  if (touchLatch.on) { if (!ts.touched()) touchLatch.on = false; return; }"],
    ["GESTES : masquer le cartel en pause reprend l'animation", false, "    cartelVisible = false; logf(\"[TOUCH] cartel masqué en %lu ms\", millis() - t0);\n", "    cartelVisible = false; logf(\"[TOUCH] cartel masqué en %lu ms\", millis() - t0); if (animOn) animPaused = false;\n"],
    ["GESTES : la reprise par appui long ne restaure pas les bandes", false, "      if (cartelVisible) toggleCartel();                       // les bandes sont restaurées depuis la carte avant la reprise\n", ""],
    ["GESTES : masquer le cartel pendant la lecture ne remet pas le fond de l'animation", false, "tft.fillRect(0, 0, SCR_W, BAND_TOP_H, animBg);", "tft.fillRect(0, 0, SCR_W, BAND_TOP_H, C_BLACK);"],
    ["GESTES : le seuil de l'appui long est ignoré (tout contact est un appui court)", false, "  while (g == PG_NONE && tc.down && millis() - t0 < 2000UL) {", "  while (g == PG_NONE && tc.down && millis() - t0 < 100UL) {"],
    ["pile SD : échec ignoré (opération présentée comme faite)", false, "  if (!ran) sdStackFailed(what, ni);\n  return ran;", "  if (!ran) sdStackFailed(what, ni);\n  return true;"],
    ["pile SD : exécution directe même sur la pile principale", false, "  if (!podNetOnMainStack()) { onSdDirect(f); return true; }", "  { onSdDirect(f); return true; }"],
  ];
  for (const [name, canary, a, b, a2, b2] of muts) {
    const inHdr = name.startsWith("pile SD");   // ces mutants portent sur pod_sd_stack.h
    const hdrText = fs.readFileSync(path.join(SKETCH_DIR, "pod_sd_stack.h"), "utf8").replace(/\r\n/g, "\n");
    for (const x of [a, a2]) if (x) assert.equal((inHdr ? hdrText : src).split(x).length, 2, `mutation « ${name} » : motif introuvable ou multiple`);
    const mut = (s: string) => { let o = s.split(a).join(b); if (a2) o = o.split(a2).join(b2!); return o; };
    const r = passFull(inHdr ? buildFull(canary, (s) => s, mut) : buildFull(canary, mut));
    assert.ok(!r.ok, `mutation « ${name} » NON détectée`);
  }
});
