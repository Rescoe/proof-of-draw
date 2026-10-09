import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { compileHarness, describeChoice, findCompiler, runProcess } from "./helpers/cppHarness";

// LOT8B2B2-CANARY-BOOT-FIX2 — l'instrument de canari de la pile principale du UNO R4 e-ink 2,9″ : points de contrôle CUMULATIFS et NON destructifs, diagnostic complet, VERROU FATAL réel.
// Le code testé sur l'hôte est EXTRAIT du sketch (pas recopié) puis exécuté contre une mémoire simulée. L'état réel de la pile sur la carte reste à mesurer (protocole : docs/LOT_8B2B2_BOOTFIX2_2026_10_08.md).
const root = path.join(__dirname, "..");
const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8").replace(/\r\n/g, "\n");
const INO = "arduino_uno_r4/pod_uno_r4_eink29/pod_uno_r4_eink29.ino";
// commentaires de ligne seulement : le sketch contient « Accept: */* » dans une chaîne, qu'un retrait de /* … */ prendrait pour un commentaire
const strip = (s: string) => s.replace(/\/\/.*$/gm, "");
const BLOCK = /#if POD_RENDER_V1 && POD_CANARY\n([\s\S]*?)\n#endif\n/g;

test("points de contrôle : tous les passages demandés sont instrumentés, dans l'ordre du démarrage, et UNE SEULE peinture (aucun repeint entre deux points)", () => {
  const src = read(INO);
  const code = strip(src);
  const tags = [...code.matchAll(/podCanaryCheck\("([^"]+)", (true|false)\)/g)].map((m) => m[1]);
  const setup = code.slice(code.indexOf("void setup()"), code.indexOf("void loop()"));
  const setupTags = [...setup.matchAll(/podCanaryCheck\("([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(setupTags.map((t) => t.split(" ")[0]), ["1", "1b", "2", "3", "4", "5", "6a", "6b", "7a", "7b", "8"], "ordre des points de contrôle de setup()");
  for (const needle of ["boot", "e-ink", "wifi", "cles", "selfTestEd25519", "avant doRegister", "apres doRegister", "avant doPull", "apres doPull", "pret", "calibration"]) assert.ok(tags.some((t) => t.includes(needle)), `point « ${needle} » absent`);
  // NETSTACK-FIX1 : la chaîne réseau tourne sur une pile dédiée, donc AUCUN point de contrôle de la pile principale n'est placé à l'intérieur d'une transaction (SP y serait « hors pile principale »).
  // Le contrôle de la pile principale et le rapport de la pile réseau ont lieu APRÈS chaque transaction (podCanaryNet), et à l'entrée de loop().
  assert.equal(tags.some((t) => t.includes("http:")), false, "plus de point silencieux « http: » à l'intérieur d'une transaction");
  assert.ok(tags.some((t) => t.includes("net: pile principale apres la transaction")), "contrôle de la pile principale après chaque transaction");
  for (const site of ["http", "pull-frame", "candidate-frame"]) assert.ok(code.includes(`podCanaryNet("${site}", ni, ran);`), `rapport de la pile réseau : ${site}`);
  assert.match(code, /void loop\(\) \{\s*#if POD_RENDER_V1 && POD_CANARY\s*podCanaryCheck\("loop", false\);/);
  // une seule peinture, dans setup() ; aucun appel à paintStack() ou podCanaryPaint() ailleurs (pas de repeint)
  assert.equal((code.match(/podCanaryPaint\(\)/g) ?? []).length, 2, "définition + un seul appel");
  assert.equal(code.slice(code.indexOf("void loop()")).includes("podCanaryPaint"), false);
  assert.equal((code.match(/paintStack\(\)/g) ?? []).length, 2, "définition + un seul appel (setup)");
});

test("instrument : Serial.print seulement (jamais logf/vsnprintf dans les points de contrôle), aucun delay(), aucune variable globale, tout est sous POD_RENDER_V1 && POD_CANARY", () => {
  const src = read(INO);
  const fn = /static void __attribute__\(\(noinline\)\) podCanaryCheck[\s\S]*?\n\}\n/.exec(src)![0];
  const c = strip(fn);
  assert.doesNotMatch(c, /logf\(|printf\(|vsnprintf|String\b|delay\(|WiFi|EEPROM|NVIC_SystemReset|httpCall|ackFrame/);
  // le verrou est la fonction podCanaryHalt (noreturn, boucle sans fin), appelée par podCanaryCheck seulement après `if (!alert) return;` et par podCanaryNet en cas d'échec de la pile réseau
  assert.ok(c.indexOf("podCanaryHalt(tag);") > c.indexOf("if (!alert) return;"), "le verrou n'est atteint qu'en cas d'anomalie");
  const halt = strip(/static void __attribute__\(\(noinline, noreturn\)\) podCanaryHalt[\s\S]*?\n\}\n/.exec(src)![0]);
  assert.match(halt, /for \(;;\)/, "verrou : boucle sans fin");
  assert.doesNotMatch(halt, /logf\(|printf\(|String\b|delay\(|WiFi|EEPROM|NVIC_SystemReset|httpCall|ackFrame/);
  assert.doesNotMatch(halt.slice(halt.indexOf("for (;;)")), /\b(break|return|goto)\b/, "aucune sortie de la boucle");
  const net = strip(/static void __attribute__\(\(noinline\)\) podCanaryNet[\s\S]*?\n\}\n/.exec(src)![0]);
  assert.match(net, /if \(!ran \|\| ni\.err != POD_NET_OK\) \{[^}]*podCanaryHalt\(tag\);/, "un échec de la pile réseau pose le verrou");
  assert.doesNotMatch(net, /logf\(|printf\(|String\b|delay\(/);
  // la peinture n'est pas dans le contrôle
  assert.doesNotMatch(c, /\*\w+ = CANARY_PAINT/);
  // tout le code d'instrument est dans des blocs gardés ; hors des blocs, seuls les appels « podCanaryCheck(…) » existent
  const outside = strip(src.replace(BLOCK, ""));
  assert.doesNotMatch(outside, /podCanary|CANARY_PAINT|CANARY_MAGIC|\[CANARY\]/);
  // le défaut du dépôt est inchangé (0/0) : testé par canaryPrep.test.ts, à l'état commité
});

// ── Exécution hôte du code RÉEL de l'instrument ──────────────────────────────────────────────────────────────
const choice = findCompiler();
console.log(`[canaryBootFix2] ${describeChoice(choice)}`);
const skip = choice.path ? false : `${describeChoice(choice)} — exécution hôte de l'instrument IGNORÉE`;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "canaryfix2-"));
const exe = path.join(tmp, process.platform === "win32" ? "canary_check_harness.exe" : "canary_check_harness");

function extract(): string {
  const src = read(INO);
  const pre = /extern "C" char\* sbrk\(int incr\);[\s\S]*?(?=#if POD_RENDER_V1 && POD_CANARY\n\/\/ ─── CANARI)/.exec(src)![0].replace('extern "C" char* sbrk(int incr);\n', "").replace("extern char __HeapLimit;\n", "");
  const can = /extern char __StackLimit, __StackTop, __HeapBase;\n[\s\S]*?\n\}\n(?=#endif\nstatic void reportMem)/.exec(src)![0].replace("extern char __StackLimit, __StackTop, __HeapBase;\n", "");
  return `${pre}\n${can}\n`;
}
function build(extra: (s: string) => string = (s) => s): string {
  const dir = fs.mkdtempSync(path.join(tmp, "b-"));
  fs.writeFileSync(path.join(dir, "canary_extract.inc"), extra(extract()));
  const out = path.join(dir, path.basename(exe));
  compileHarness(choice.path!, path.join(root, "consensus-pod", "host", "canary_check_harness.cpp"), out, [`-I${dir}`]);
  return out;
}

test("EXÉCUTION HÔTE du code extrait du sketch : pile saine → retour + mesure ; point silencieux muet ; aucun repeint ; maximum cumulatif conservé ; marge < 128 / marqueur détruit / écriture sous la limite / SP hors pile / longueur détruite → diagnostic complet puis VERROU FATAL (la fonction ne revient jamais)", { skip }, () => {
  const r = runProcess(build(), []);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const lines = r.stdout.trim().split("\n").filter((l) => /^S\d+ /.test(l));
  assert.equal(lines.length, 15, r.stdout);
  for (const l of lines) assert.match(l, /^S\d+ OK /, l);
});

test("CONTRÔLES NÉGATIFS : un instrument qui repeint, qui ne pose pas de verrou, qui ignore le marqueur ou la zone sous la limite est REFUSÉ par le harnais", { skip }, () => {
  const mutants: Array<[string, string, string]> = [
    ["sans verrou", "for (;;) if (millis() - t >= 10000UL)", "if (millis() - t >= 10000UL)"],
    ["marqueur ignoré", "const bool alert = !magicOk || !paintedOk ||", "const bool alert = false ||"],
    ["sous la limite ignoré", "|| below > 1024 ||", "|| false ||"],
    ["marge ignorée", "margin < 128 ||", "false ||"],
    ["repeint", "  const uint32_t sp = (uint32_t)(uintptr_t)__builtin_frame_address(0);", "  for (volatile uint8_t* q = lo + 8; q < end; q++) *q = CANARY_PAINT;\n  const uint32_t sp = (uint32_t)(uintptr_t)__builtin_frame_address(0);"],
    ["silencieux bavard", "if (!alert && !verbose) return;", "if (!alert && !verbose && false) return;"],
  ];
  for (const [name, a, b] of mutants) {
    const base = extract();
    assert.equal(base.split(a).length, 2, `mutation « ${name} » : motif introuvable`);
    // sans « noreturn » : le mutant « sans verrou » RETOURNE, ce que le compilateur refuserait sinon
    const r = runProcess(build((s) => s.split(a).join(b).split("noinline, noreturn").join("noinline")), []);
    const bad = r.status !== 0 || r.stdout.split("\n").some((l) => /^S\d+ ECART /.test(l));
    assert.ok(bad, `mutation « ${name} » NON détectée`);
  }
});
