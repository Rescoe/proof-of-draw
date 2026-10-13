// tests/touchGestures.test.ts — LOT8B2E ANIM-TOUCH-GESTURES-1 : appui COURT / appui LONG sur le TFT 2,8″ pendant une animation.
//   1. classificateur pur (pod_touch_gesture.h) : harnais C++ EXHAUSTIF sur l'hôte (seuils exacts, une action par contact, rebonds, cadences 5 – 50 ms, dépassement de millis()) + MUTANTS refusés ;
//   2. propriétés STATIQUES du sketch (aucune allocation dans le geste, accès SD / TFT sous onSd, bandes préservées, fichier fermé avant restauration, aucun journal sous le lecteur) + MUTANTS refusés ;
//   Le comportement du firmware COMPLET (temps virtuel, contacts scriptés, pause / reprise / bandes / fichiers ouverts) : tests/tft28Host.test.ts, section « 15c ».
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { compileHarness, describeChoice, findCompiler, runProcess } from "./helpers/cppHarness";
import { INO, ROOT, effective, fnBody, readText, stripBlock, stripHooks, stripLine } from "./helpers/tft28Source";

const choice = findCompiler();
console.log(`[touchGestures] ${describeChoice(choice)}`);
const skip = choice.path ? false : `${describeChoice(choice)} — exécution hôte IGNORÉE`;
const fwd = (p: string) => p.replace(/\\/g, "/");
const SK = path.join(ROOT, "arduino_uno_r4", "pod_uno_r4");
const HDR = readText("arduino_uno_r4/pod_uno_r4/pod_touch_gesture.h");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "touchgest-"));
let n = 0;

function runClassifier(header: string): { ok: boolean; out: string } {
  const dir = path.join(tmp, `h${n++}`); fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "pod_touch_gesture.h"), header);
  const exe = path.join(dir, "tg");
  const out = compileHarness(choice.path!, fwd(path.join(ROOT, "consensus-pod", "host", "touch_gesture_harness.cpp")), fwd(exe), ["-std=c++11", "-Wall", "-Wextra", "-Werror", "-O2", `-I${fwd(dir)}`]);
  void out;
  const r = runProcess(fwd(exe) + (process.platform === "win32" ? ".exe" : ""), [], 120000);
  return { ok: r.status === 0 && /^PASS \d+$/.test((r.stdout || "").trim()), out: (r.stdout || "") + (r.stderr || "") };
}

test("classificateur : seuils exacts, UNE action par contact, rebonds, cadences d'interrogation, dépassement de millis(), table des actions", { skip }, () => {
  const r = runClassifier(HDR);
  assert.ok(r.ok, r.out.slice(0, 2500));
});

test("classificateur : MUTANTS — chaque régression est REFUSÉE par le harnais", { skip }, () => {
  const muts: Array<[string, string, string]> = [
    ["seuil de l'appui long abaissé à 649 ms", "#define POD_TOUCH_LONG_MS            650u", "#define POD_TOUCH_LONG_MS            649u"],
    ["seuil de l'appui long relevé à 651 ms", "#define POD_TOUCH_LONG_MS            650u", "#define POD_TOUCH_LONG_MS            651u"],
    ["l'appui long agit à chaque échantillon (pas de verrou « déjà agi »)", "    if (!c.fired && (uint32_t)(now - c.downAt) >= POD_TOUCH_LONG_MS) { c.fired = true; return PG_LONG; }", "    if ((uint32_t)(now - c.downAt) >= POD_TOUCH_LONG_MS) { c.fired = true; return PG_LONG; }"],
    ["le relâchement d'un appui long produit un appui court", "  if (c.fired) return PG_NONE;                                                       // l'appui long a déjà agi : jamais de second geste\n", ""],
    ["pas d'anti-rebond au relâchement", "#define POD_TOUCH_RELEASE_STABLE_MS  30u", "#define POD_TOUCH_RELEASE_STABLE_MS  1u"],
    ["le bruit (un échantillon) donne un appui court", "#define POD_TOUCH_MIN_MS             20u", "#define POD_TOUCH_MIN_MS             1u"],
    ["comparaison du temps non protégée contre le dépassement de millis()", "(uint32_t)(now - c.downAt) >= POD_TOUCH_LONG_MS", "now >= c.downAt + POD_TOUCH_LONG_MS"],
    ["l'appui court est jugé sur la durée jusqu'à l'échantillon courant (rebond compté comme durée)", "const uint32_t dur = (uint32_t)(c.lastSeen - c.downAt);", "const uint32_t dur = (uint32_t)(now - c.downAt);"],
    ["table : pause et reprise inversées", "if (animPaused) return g == PG_LONG ? PTA_RESUME : PTA_TOGGLE_PAUSED;", "if (animPaused) return g == PG_LONG ? PTA_TOGGLE_PAUSED : PTA_RESUME;"],
    ["table : appui court pendant la lecture met en pause", "return g == PG_LONG ? PTA_PAUSE : PTA_TOGGLE_PLAYING;", "return PTA_PAUSE;"],
    ["table : image fixe, l'appui long ne bascule pas", "if (!animOn) return PTA_TOGGLE_STATIC;", "if (!animOn) return g == PG_LONG ? PTA_NONE : PTA_TOGGLE_STATIC;"],
    ["nouveau contact sans remise à zéro du verrou", "if (!c.down) { c.down = true; c.downAt = now; c.lastSeen = now; c.fired = false; return PG_NONE; }", "if (!c.down) { c.down = true; c.downAt = now; c.lastSeen = now; return PG_NONE; }"],
  ];
  for (const [label, from, to] of muts) {
    assert.equal(HDR.split(from).length, 2, `motif obsolète pour le mutant « ${label} »`);
    const r = runClassifier(HDR.split(from).join(to));
    assert.ok(!r.ok, `mutant NON refusé : ${label}`);
  }
});

// ─── propriétés STATIQUES du sketch ──────────────────────────────────────────────────────────────────────────────────
const code = (s: string) => stripBlock(stripLine(s));
const prodOf = (s: string) => stripHooks(effective(s, false));
const canOf = (s: string) => stripHooks(effective(s, true));
const src = readText(INO);

function violations(ino: string, hdr: string): string[] {
  const v: string[] = [];
  const c = code(ino), h = code(hdr);
  // en-tête : pur
  if (/\bmalloc\b|\bnew\b|\bString\b|#include\s*<Arduino|\bstatic\s+[A-Za-z_]+\s+\w+\s*(=|;)/.test(h.replace(/static inline/g, ""))) v.push("pod_touch_gesture.h : allocation, String, Arduino ou état statique");
  if (!/#include "pod_touch_gesture\.h"/.test(ino)) v.push("pod_touch_gesture.h non inclus");
  if (/static\s+PodTouchClassifier/.test(c)) v.push("le classificateur doit être LOCAL (aucun état statique)");
  const rr = fnBody(c, "static AnimEnd __attribute__((noinline)) runResidentAnim(");
  const live = fnBody(c, "static void __attribute__((noinline)) animCartelToggleLive(");
  const st = fnBody(c, "static void serviceTouch(");
  const tog = fnBody(c, "static void toggleCartelImpl(");
  const ap = fnBody(c, "static void onAnimTouchImpl(");
  for (const [name, b] of [["runResidentAnim", rr], ["animCartelToggleLive", live], ["serviceTouch", st], ["toggleCartelImpl", tog], ["onAnimTouchImpl", ap]] as const) if (!b) v.push(`${name} introuvable`);
  // 1. bascule du cartel PENDANT la lecture : TFT seulement, ni carte, ni journal, ni tas, ni String
  if (/\bSD\.|restoreRows|onSd\(|\blogf\(|\bString\b|\bmalloc\(|\bnew\b|saveMeta|File\b/.test(live)) v.push("animCartelToggleLive : accès carte, journal, String ou tas dans le geste");
  if (!/drawCartel\(\)/.test(live) || !/animBg/.test(live)) v.push("animCartelToggleLive : doit dessiner le cartel et masquer avec le fond de l'animation");
  if (!/fillRect\(0, 0, SCR_W, BAND_TOP_H, animBg\)/.test(live) || !/fillRect\(0, BAND_BOT_Y, SCR_W, BAND_BOT_H, animBg\)/.test(live)) v.push("animCartelToggleLive : masquer = bandes haute et basse au fond, SANS toucher la zone animée");
  // 2. lecture : classificateur local, cadence de 20 ms, long = sortie, court = bascule sur place, journal APRÈS la lecture
  if (!/PodTouchClassifier tc; podTouchReset\(tc\);/.test(rr)) v.push("runResidentAnim : classificateur local absent");
  if (!/millis\(\) - lastTouchChk >= POD_TOUCH_POLL_MS/.test(rr)) v.push("runResidentAnim : cadence d'interrogation du tactile");
  if (!/if \(g == PG_LONG\) \{ drainTouch\(\); touchHold = 3; why = AE_TOUCH; return false; \}/.test(rr)) v.push("runResidentAnim : l'appui long doit sortir de la lecture (AE_TOUCH) et poser le verrou de relâchement");
  if (!/if \(g == PG_SHORT\) \{ drainTouch\(\); [^}]*animCartelToggleLive\(\); \}/.test(rr)) v.push("runResidentAnim : l'appui court doit basculer le cartel SUR PLACE");
  const iHook = rr.indexOf("podTouchStep(tc"), iRet = rr.indexOf("return false; }", iHook);
  if (iHook < 0 || iRet < 0) v.push("runResidentAnim : crochet tactile introuvable");
  if (/\blogf\(/.test(rr.slice(rr.indexOf("podbench::playStream("), rr.indexOf("const bool ran = onSd(\"animPlay\", play);")))) v.push("runResidentAnim : journal DANS le lecteur (pile SD dédiée)");
  if (!/const bool ran = onSd\("animPlay", play\);\s*free\(work\);\s*if \(liveShown \|\| liveHidden\) logf\(/.test(rr)) v.push("runResidentAnim : le compte rendu des appuis courts se journalise APRÈS la lecture");
  // 3. bandes préservées : le cartel affiché n'est pas effacé au démarrage de la lecture
  if (!/if \(cartelVisible\) tft\.fillRect\(0, BAND_TOP_H, SCR_W, BAND_BOT_Y - BAND_TOP_H, si\.bg\);\s*else tft\.fillScreen\(si\.bg\);/.test(rr)) v.push("runResidentAnim : démarrage avec cartel visible = zone centrale seule (y 40..271)");
  if (/cartelVisible = false/.test(rr)) v.push("runResidentAnim : ne doit plus effacer l'indicateur du cartel au démarrage");
  if (!/animBg = si\.bg;/.test(rr)) v.push("runResidentAnim : animBg doit être posé au démarrage");
  // 4. fichier fermé AVANT toute restauration : la pause (restauration SD) n'a lieu qu'au retour de runResidentAnim
  if (/restoreRows|onAnimTouch/.test(rr)) v.push("runResidentAnim : aucune restauration SD / pause dans la lecture (le clip doit être fermé avant)");
  // 5. serviceTouch : pas d'allocation, pas d'accès direct SD / TFT (tout passe par toggleCartel / onAnimTouch, donc onSd)
  if (/\bString\b|\bmalloc\(|\bnew\b|\btft\.|\bSD\./.test(st)) v.push("serviceTouch : allocation ou accès direct SD / TFT");
  if (!/touchHold > 0/.test(st) || !/if \(g == PG_LONG\) touchHold = 3;/.test(st)) v.push("serviceTouch : verrou de relâchement après un appui long");
  if (!/podTouchAction\(g, animOn, animPaused\)/.test(st)) v.push("serviceTouch : actions décidées par podTouchAction");
  if (!/case PTA_TOGGLE_PAUSED:\s*toggleCartel\(\); break;/.test(st)) v.push("serviceTouch : appui court en pause = bascule du cartel SANS reprendre");
  if (!/case PTA_RESUME:[\s\S]*if \(cartelVisible\) toggleCartel\(\);[\s\S]*animPaused = false;/.test(st)) v.push("serviceTouch : appui long en pause = bandes restaurées depuis la carte PUIS reprise");
  // 6. masquer le cartel ne reprend plus l'animation
  if (/animPaused\s*=\s*false/.test(tog)) v.push("toggleCartelImpl : masquer le cartel ne doit pas reprendre l'animation");
  // 7. reprise automatique de 60 s inchangée, sans cartel
  if (!/animPaused = false; cartelVisible = false; logf\("\[ANIM\] reprise \(60 s\)"\);/.test(c)) v.push("loop : reprise automatique de 60 s (plein écran, sans cartel)");
  return v;
}

test("geste tactile (production et canari) : propriétés statiques du sketch", () => {
  assert.deepEqual(violations(prodOf(src), HDR), []);
  assert.deepEqual(violations(canOf(src), HDR), []);
});

test("geste tactile : MUTANTS du sketch — chaque régression est REFUSÉE", () => {
  const p = prodOf(src);
  const muts: Array<[string, string, string]> = [
    ["le démarrage de la lecture efface toujours tout l'écran (cartel perdu)", "if (cartelVisible) tft.fillRect(0, BAND_TOP_H, SCR_W, BAND_BOT_Y - BAND_TOP_H, si.bg);   // le cartel RESTE affiché : seule la zone centrale (y 40..271) est effacée\n    else tft.fillScreen(si.bg);", "tft.fillScreen(si.bg);"],
    ["le démarrage de la lecture oublie le cartel", "    animBg = si.bg;\n", "    animBg = si.bg; cartelVisible = false;\n"],
    ["l'appui long ne sort pas de la lecture", "if (g == PG_LONG) { drainTouch(); touchHold = 3; why = AE_TOUCH; return false; }", "if (g == PG_LONG) { drainTouch(); touchHold = 3; }"],
    ["l'appui long ne pose pas le verrou de relâchement (appui court fantôme)", "if (g == PG_LONG) { drainTouch(); touchHold = 3; why = AE_TOUCH; return false; }", "if (g == PG_LONG) { drainTouch(); why = AE_TOUCH; return false; }"],
    ["l'appui court restaure l'affiche depuis la carte PENDANT la lecture", "if (cartelVisible) liveHidden++; else liveShown++; animCartelToggleLive(); }", "if (cartelVisible) liveHidden++; else liveShown++; restoreRows(0, BAND_TOP_H); animCartelToggleLive(); }"],
    ["la bascule en direct journalise sur la pile SD", "  cartelVisible = false;\n}\nstatic bool waitTapOrTimeout", "  cartelVisible = false; logf(\"[TOUCH] cartel masqué\");\n}\nstatic bool waitTapOrTimeout"],
    ["masquer le cartel pendant la lecture écrase la zone animée", "tft.fillRect(0, 0, SCR_W, BAND_TOP_H, animBg);", "tft.fillRect(0, 0, SCR_W, BAND_TOP_H + 100, animBg);"],
    ["masquer le cartel reprend l'animation", "    cartelVisible = false; logf(\"[TOUCH] cartel masqué en %lu ms\", millis() - t0);\n", "    cartelVisible = false; logf(\"[TOUCH] cartel masqué en %lu ms\", millis() - t0); if (animOn) animPaused = false;\n"],
    ["serviceTouch dessine directement", "  drainTouch();\n  if (g == PG_LONG) touchHold = 3;", "  drainTouch(); tft.fillScreen(C_BLACK);\n  if (g == PG_LONG) touchHold = 3;"],
    ["serviceTouch sans verrou de relâchement", "  if (g == PG_LONG) touchHold = 3;\n", ""],
    ["interrogation du tactile à 200 ms", "millis() - lastTouchChk >= POD_TOUCH_POLL_MS", "millis() - lastTouchChk > 200UL"],
    ["la reprise par appui long ne restaure pas les bandes", "      if (cartelVisible) toggleCartel();                       // les bandes sont restaurées depuis la carte avant la reprise\n", ""],
    ["la reprise automatique de 60 s garde le cartel", "animPaused = false; cartelVisible = false; logf(\"[ANIM] reprise (60 s)\");", "animPaused = false; logf(\"[ANIM] reprise (60 s)\");"],
    ["le classificateur est global (état partagé)", "PodTouchClassifier tc; podTouchReset(tc);\n    const unsigned long tEnd", "static PodTouchClassifier tc; podTouchReset(tc);\n    const unsigned long tEnd"],
  ];
  for (const [label, from, to] of muts) {
    assert.equal(p.split(from).length, 2, `motif obsolète pour le mutant « ${label} »`);
    assert.notDeepEqual(violations(p.split(from).join(to), HDR), [], `mutant NON refusé : ${label}`);
  }
});

test("périmètre : aucun autre firmware ne reçoit le classificateur ; pod_bench.h et ses copies restent inchangés", () => {
  for (const d of ["pod_uno_r4_eink29", "pod_uno_r4_eink27", "pod_uno_r4_eink27_oled", "pod_uno_r4_tft18"]) {
    assert.ok(!fs.existsSync(path.join(SK, "..", d, "pod_touch_gesture.h")), `${d} ne doit pas recevoir pod_touch_gesture.h`);
    assert.doesNotMatch(readText(`arduino_uno_r4/${d}/${d}.ino`), /pod_touch_gesture|PodTouchClassifier/);
  }
  assert.match(src, /#define POD_RENDER_V1 0\b/); assert.match(src, /#define POD_CANARY 0\b/);
});
