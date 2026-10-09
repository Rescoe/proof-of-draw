// DOPULL-PHASE-AUDIT1 (09/10/2026) — sondes de phase silencieuses dans doPull (canari e-ink 2,9″ seulement), rapport APRÈS le retour, production inchangée.
// Contexte matériel (canari e99f77e) : après un pull HTTP 200 sans frame, le marqueur de pile principale est détruit (1016 / 1024 o) quelque part dans le traitement LOCAL de doPull.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "..");
const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8").replace(/\r\n/g, "\n");
const INO = "arduino_uno_r4/pod_uno_r4_eink29/pod_uno_r4_eink29.ino";
const SKETCHES = ["pod_uno_r4_eink29", "pod_uno_r4_eink27", "pod_uno_r4_eink27_oled", "pod_uno_r4_tft18", "pod_uno_r4"];
const BLOCK = /#if POD_RENDER_V1 && POD_CANARY\n([\s\S]*?)\n#endif\n/g;

/** Ce que la sonde k doit suivre immédiatement (texte de production qui la précède, blocs de canari précédents retirés). */
const ANCHORS: Array<[number, string]> = [
  [1, "static bool doPull() {"],
  [2, 'const int code = httpCall("GET", "/api/pull?deviceId=" + deviceId, nullptr, resp);'],
  [3, "JSON_DOC(doc, 2048);"],
  [4, 'if (err) { logf("[PULL] JSON: %s", err.c_str()); return false; }'],
  [5, 'newFrameId = fo["frameId"] | ""; }'],
  [6, "currentBlockIndex);\n    }"],
  [7, "if (strlen(owned) >= 16) saveOwnedBlockHash(String(owned));"],
  [8, "if (strlen(owned) >= 16) saveOwnedBlockHash(String(owned));\n  }"],
  [9, "if (newCandId.length() > 0) pendingCandidateId = newCandId;"],
  [10, '{ logf("[PULL] aucune frame");'],
];

/** Violations de la règle des sondes de doPull (liste vide = conforme). */
export function doPullProbeViolations(src: string): string[] {
  const v: string[] = [];
  const start = src.indexOf("static bool doPull() {");
  if (start < 0) return ["doPull absente"];
  const end = src.indexOf("\n}\n", start);
  const fn = src.slice(start, end + 3);
  // parcours des blocs de canari : texte de production précédent = fn sans les blocs déjà passés
  const seen: Array<{ k: number; before: string; body: string }> = [];
  let prod = "", last = 0, m: RegExpExecArray | null;
  BLOCK.lastIndex = 0;
  while ((m = BLOCK.exec(fn))) {
    prod += fn.slice(last, m.index);
    last = m.index + m[0].length;
    const probe = /POD_DP_PROBE\((\d+)\);/.exec(m[1]);
    if (probe) seen.push({ k: Number(probe[1]), before: prod.replace(/\s+$/, ""), body: m[1].trim() });
  }
  const order = seen.map((s) => s.k);
  if (JSON.stringify(order) !== JSON.stringify([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])) v.push(`sondes présentes dans l'ordre ${order.join(",")} au lieu de 1 à 10`);
  for (const [k, anchor] of ANCHORS) {
    const s = seen.find((x) => x.k === k);
    if (!s) { v.push(`sonde ${k} absente`); continue; }
    if (!s.before.endsWith(anchor)) v.push(`sonde ${k} : mal placée (elle doit suivre « ${anchor.replace(/\n/g, "⏎")} »)`);
    const expected = k === 1 ? "g_podDpPhase = 0; POD_DP_PROBE(1);" : `POD_DP_PROBE(${k});`;
    if (s.body !== expected) v.push(`sonde ${k} : contenu inattendu « ${s.body} »`);
  }
  // la sonde 10 est suivie du retour (aucun autre code entre le journal « aucune frame » et return)
  if (!/POD_DP_PROBE\(10\);\n#endif\n  return true; \}/.test(fn)) v.push("la sonde 10 doit précéder immédiatement « return true; } »");
  // rapports APRÈS le retour de doPull chez les appelants (setup : avant 7b ; boucle principale)
  const setupSite = /    doPull\(\);\n#if POD_RENDER_V1 && POD_CANARY\n  podCanaryDoPull\(\);\n#endif\n#if POD_RENDER_V1 && POD_CANARY\n  podCanaryCheck\("7b apres doPull", true\);/;
  if (!setupSite.test(src)) v.push("setup : podCanaryDoPull() doit suivre doPull() et précéder le contrôle 7b");
  const loopSite = /    doPull\(\);\n#if POD_RENDER_V1 && POD_CANARY\n  podCanaryDoPull\(\);\n#endif\n    lastPullMs = millis\(\);\n    if \(pendingCandidateId/;
  if (!loopSite.test(src)) v.push("boucle principale : podCanaryDoPull() doit suivre doPull()");
  return v;
}

test("DOPULL-PHASE-AUDIT1 : dix sondes silencieuses dans doPull, à leur place, sans rien d'autre que la macro ; rapport après le retour chez les appelants ; CONTRÔLES NÉGATIFS (sonde supprimée, déplacée ou permutée, rapport supprimé)", () => {
  const src = read(INO);
  assert.deepEqual(doPullProbeViolations(src), []);
  // mutants : chaque sonde supprimée, chaque paire adjacente permutée, la sonde 10 avant le journal, le rapport supprimé de chaque appelant
  const block = (k: number) => `#if POD_RENDER_V1 && POD_CANARY\n  ${k === 1 ? "g_podDpPhase = 0; " : ""}POD_DP_PROBE(${k});\n#endif\n`;
  for (let k = 1; k <= 10; k++) {
    assert.ok(src.includes(block(k)), `bloc de la sonde ${k} introuvable`);
    assert.notEqual(doPullProbeViolations(src.replace(block(k), "")).length, 0, `mutant « sonde ${k} supprimée » NON détecté`);
  }
  for (let k = 2; k <= 9; k++) {
    const sw = src.replace(block(k), "@@A@@").replace(block(k + 1), block(k)).replace("@@A@@", block(k + 1));
    assert.notEqual(sw, src);
    assert.notEqual(doPullProbeViolations(sw).length, 0, `mutant « sondes ${k} et ${k + 1} permutées » NON détecté`);
  }
  assert.notEqual(doPullProbeViolations(src.replace(block(10), "").replace('{ logf("[PULL] aucune frame");', block(10) + '{ logf("[PULL] aucune frame");')).length, 0, "mutant « sonde 10 avant le journal » NON détecté");
  const rep = "#if POD_RENDER_V1 && POD_CANARY\n  podCanaryDoPull();\n#endif\n";
  assert.equal(src.split(rep).length, 3, "deux rapports (setup et boucle)");
  assert.notEqual(doPullProbeViolations(src.replace(rep, "")).length, 0, "mutant « rapport du setup supprimé » NON détecté");
  assert.notEqual(doPullProbeViolations(src.replace(rep, "@@R@@").replace(rep, "").replace("@@R@@", rep)).length, 0, "mutant « rapport de la boucle supprimé » NON détecté");
});

test("DOPULL-PHASE-AUDIT1 : sondes SILENCIEUSES — la macro ne lit que deux mots de la pile et un octet, comparaison EXACTE (pas de plage), aucune E/S, allocation, String, logf, mallinfo ni appel ; rapport sur la pile de journal puis verrou ; longueur initiale mémorisée par podCanaryPaint", () => {
  const src = read(INO);
  const macro = /#define POD_DP_PROBE\(n\)[^\n]*/.exec(src)![0];
  assert.equal(macro, "#define POD_DP_PROBE(n) do { if (g_podDpPhase == 0 && (*(volatile uint32_t*)&__StackLimit != 0x434E5259UL || *((volatile uint32_t*)&__StackLimit + 1) != g_podPaintLen)) g_podDpPhase = (n); } while (0)");
  assert.doesNotMatch(macro, /Serial|logf|printf|malloc|String|mallinfo|delay|millis|podCanary|[<>]=?\s*\d/, "pas de test de plage ni d'appel");
  // les sondes ne contiennent rien d'autre que la macro (et la remise à zéro de l'entrée)
  const fn = src.slice(src.indexOf("static bool doPull() {"), src.indexOf("\n}\n", src.indexOf("static bool doPull() {")));
  for (const b of fn.matchAll(BLOCK)) if (/POD_DP_PROBE/.test(b[1])) assert.match(b[1].trim(), /^(g_podDpPhase = 0; )?POD_DP_PROBE\(\d+\);$/);
  // statiques : exactement deux, canari seulement ; podCanaryPaint mémorise la longueur initiale
  assert.equal((src.match(/^static volatile (?:uint32_t g_podPaintLen|uint8_t g_podDpPhase) = 0;$/gm) ?? []).length, 2);
  assert.match(src, /\*\(volatile uint32_t\*\)\(lo \+ 4\) = \(uint32_t\)\(hi - lo\);\n  g_podPaintLen = \(uint32_t\)\(hi - lo\);\n\}/);
  assert.match(src, /paintedOk = \(painted >= 16 && painted <= 1024 && painted == g_podPaintLen\);/, "contrôle de longueur EXACT, plus seulement plausible");
  // rapport
  const rep = /static void __attribute__\(\(noinline\)\) podCanaryDoPull\(\) \{[\s\S]*?\n\}\n/.exec(src)![0];
  assert.match(rep, /const uint8_t ph = g_podDpPhase;\n  if \(ph == 0\) return;\n  PodCanaryDpCtx c = \{ ph \};\n  podCanaryEmit\(podCanaryPrintDp, &c\);\n  for \(;;\) \{ __asm volatile\("nop"\); \}/);
  assert.match(src, /podCanaryHalt\("doPull phase"\);/);
});

for (const sk of SKETCHES.filter((s) => s !== "pod_uno_r4_eink29")) {
  test(`${sk} : aucune sonde de doPull ni statique de canari (inchangé)`, () => {
    assert.doesNotMatch(read(`arduino_uno_r4/${sk}/${sk}.ino`), /POD_DP_PROBE|g_podDpPhase|g_podPaintLen|podCanaryDoPull/);
  });
}

/** Un build qui règle les drapeaux DANS le fichier (IDE Arduino) ne voit un bloc `#if POD_RENDER_V1 && POD_CANARY` que s'il vient APRÈS leur définition (macros indéfinies = 0). */
function flagOrderViolations(src: string): string[] {
  const v: string[] = [];
  const iFlag = src.indexOf("#define POD_CANARY ");
  const iFlag2 = src.indexOf("#define POD_RENDER_V1 ");
  if (iFlag < 0 || iFlag2 < 0) return ["définition des drapeaux introuvable"];
  const firstBlock = src.indexOf("#if POD_RENDER_V1 && POD_CANARY");
  if (firstBlock >= 0 && firstBlock < Math.max(iFlag, iFlag2)) v.push("un bloc de canari précède la définition des drapeaux : exclu des builds à drapeaux dans le fichier");
  // l'inclusion de podNetStack.h suit la macro POD_NET_PROBE (déjà testé) ET les drapeaux
  if (src.indexOf('#include "podNetStack.h"') < Math.max(iFlag, iFlag2)) v.push("podNetStack.h est inclus avant la définition des drapeaux");
  return v;
}

test("DOPULL-PHASE-AUDIT1 : les sondes du canari (PodNet, doPull) sont définies APRÈS les drapeaux — un build à drapeaux réglés dans le fichier (IDE) les inclut ; CONTRÔLE NÉGATIF", () => {
  const src = read(INO);
  assert.deepEqual(flagOrderViolations(src), []);
  // mutant : le bloc de sondes remis avant les drapeaux (position d'avant ce lot)
  const probe = src.slice(src.indexOf("#if POD_RENDER_V1 && POD_CANARY\nextern char __StackLimit;   // NETSTACK-FIX3"), src.indexOf('#include "podNetStack.h"'));
  assert.ok(probe.length > 200 && probe.includes("POD_DP_PROBE"), "bloc de sondes introuvable");
  const moved = src.replace(probe, "").replace('#include "podEdStack.h"', probe + '#include "podEdStack.h"');
  assert.notEqual(moved, src);
  assert.notEqual(flagOrderViolations(moved).length, 0, "mutant « bloc de sondes avant les drapeaux » NON détecté");
});
