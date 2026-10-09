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
  // NETSTACK-FIX1/2 : la chaîne réseau tourne sur une pile dédiée, donc AUCUN point de contrôle de la pile principale n'est placé à l'intérieur d'une transaction (SP y serait « hors pile principale »).
  // Points SILENCIEUX A (juste après la transaction, avant tout rapport), B (après le rapport PodNet), C (après le journal HTTP normal) : ils isolent le premier passage destructeur sans repeindre.
  assert.equal(tags.some((t) => t.includes("http:")), false, "plus de point « http: » à l'intérieur d'une transaction");
  const abc = ["A: apres la transaction (silencieux)", "B: apres le rapport PodNet (silencieux)", "C: apres le journal HTTP (silencieux)"];
  for (const p of abc) assert.ok(code.includes(p), `point ${p} absent`);
  const hc = code.slice(code.indexOf("static int httpCall"), code.indexOf("\n}\n", code.indexOf("static int httpCall")));
  assert.ok(hc.indexOf(abc[0]) > hc.indexOf("netHttpRaw(") && hc.indexOf(abc[0]) < hc.indexOf("podCanaryNet(\"http\""), "A : immédiatement après la transaction, AVANT le rapport");
  assert.ok(hc.indexOf(abc[2]) > hc.indexOf("logf(\"[HTTP %s] %s -> %d\""), "C : après le journal HTTP normal");
  assert.ok(code.includes(abc[1].replace("B:", "B:")) && code.indexOf(abc[1]) > code.indexOf("podCanaryEmit(podCanaryPrintNet"), "B : dans podCanaryNet, après l'émission du rapport");
  for (const site of ["http", "pull-frame", "candidate-frame"]) assert.ok(code.includes(`podCanaryNet("${site}", ni, ran);`), `rapport de la pile réseau : ${site}`);
  assert.match(code, /void loop\(\) \{\s*#if POD_RENDER_V1 && POD_CANARY\s*podCanaryCheck\("loop", false\);/);
  // une seule peinture, dans setup() ; aucun appel à paintStack() ou podCanaryPaint() ailleurs (pas de repeint)
  assert.equal((code.match(/podCanaryPaint\(\)/g) ?? []).length, 2, "définition + un seul appel");
  assert.equal(code.slice(code.indexOf("void loop()")).includes("podCanaryPaint"), false);
  assert.equal((code.match(/paintStack\(\)/g) ?? []).length, 2, "définition + un seul appel (setup)");
});

test("instrument : le calcul n'appelle aucune bibliothèque, TOUTE sortie passe par la pile de journal dédiée (jamais logf/vsnprintf), verrou fatal réel, aucun delay(), tout est sous POD_RENDER_V1 && POD_CANARY", () => {
  const src = read(INO);
  const fn = /static void __attribute__\(\(noinline\)\) podCanaryCheck[\s\S]*?\n\}\n/.exec(src)![0];
  const c = strip(fn);
  assert.doesNotMatch(c, /logf\(|printf\(|vsnprintf|String\b|delay\(|WiFi|EEPROM|NVIC_SystemReset|httpCall|ackFrame|Serial\./, "podCanaryCheck ne calcule que : aucune E/S directe");
  assert.match(c, /podCanaryEmit\(podCanaryPrint, &c\);/);
  assert.ok(c.indexOf("podCanaryEmit(") > c.indexOf("if (!alert && !verbose) return;"), "point silencieux : rien avant le retour si tout va bien");
  assert.match(c, /if \(alert\) for \(;;\) \{ __asm volatile\("nop"\); \}/, "impression impossible (mémoire) : verrou SILENCIEUX, jamais de retour");
  // émission : sur la pile de journal dédiée si l'appelant est sur la pile principale, directement sinon
  const emit = strip(/static void podCanaryEmit[\s\S]*?\n\}\n/.exec(src)![0]);
  assert.match(emit, /if \(podNetOnMainStack\(\)\) PodNet::runSized\(fn, ctx, POD_LOG_STACK_TOTAL\);\s*else fn\(ctx\);/);
  // l'impression est dans podCanaryPrint / podCanaryPrintNet (Serial.print seulement) ; le verrou est la fonction podCanaryHalt
  const print = strip(/static void podCanaryPrint\(void\* v\) \{[\s\S]*?\n\}\n/.exec(src)![0]);
  assert.doesNotMatch(print, /logf\(|printf\(|vsnprintf|String\b|delay\(|WiFi|EEPROM|NVIC_SystemReset|httpCall|ackFrame/);
  assert.ok(print.indexOf("podCanaryHalt(c.tag);") > print.indexOf("if (!c.alert) return;"), "le verrou n'est atteint qu'en cas d'anomalie");
  const halt = strip(/static void __attribute__\(\(noinline, noreturn\)\) podCanaryHalt[\s\S]*?\n\}\n/.exec(src)![0]);
  assert.match(halt, /for \(;;\)/, "verrou : boucle sans fin");
  assert.doesNotMatch(halt, /logf\(|printf\(|String\b|delay\(|WiFi|EEPROM|NVIC_SystemReset|httpCall|ackFrame/);
  assert.doesNotMatch(halt.slice(halt.indexOf("for (;;)")), /\b(break|return|goto)\b/, "aucune sortie de la boucle");
  const pnet = strip(/static void podCanaryPrintNet\(void\* v\) \{[\s\S]*?\n\}\n/.exec(src)![0]);
  assert.match(pnet, /if \(!c\.ran \|\| ni\.err != POD_NET_OK\) \{[^}]*podCanaryHalt\(c\.tag\);/, "un échec de la pile réseau pose le verrou");
  const net = strip(/static void __attribute__\(\(noinline\)\) podCanaryNet[\s\S]*?\n\}\n/.exec(src)![0]);
  assert.match(net, /podCanaryEmit\(podCanaryPrintNet, &c\);\s*if \(!ran \|\| ni\.err != POD_NET_OK\) for \(;;\) \{ __asm volatile\("nop"\); \}/);
  assert.doesNotMatch(net, /logf\(|printf\(|String\b|delay\(|Serial\./);
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
  const log = /struct LogJob \{[^\n]*\n(?:static void logfEmit[\s\S]*?\n\}\n)/.exec(src)![0];   // LogJob + logfEmit (utilisés par la sonde de la pile de journal)
  // DOPULL-PHASE-AUDIT1 : les deux statiques du canari et la macro de sonde, tels que dans le sketch (bloc de sondes en tête de fichier)
  const dp = /static volatile uint32_t g_podPaintLen = 0;\nstatic volatile uint8_t g_podDpPhase = 0;\n#define POD_DP_PROBE\(n\)[^\n]*\n/.exec(src)![0];
  return `${pre}\n${dp}${log}\n${can}\n`;
}
/** Le CODE RÉEL de macString() tel que compilé quand POD_RENDER_V1 && POD_CANARY (directives des blocs de canari retirées, code conservé). */
function extractMac(): string {
  const src = read(INO);
  const helper = /static char macHexDigit\(uint8_t v\) \{[^\n]*\n/.exec(src)![0];
  const fn = /static String macString\(\) \{[\s\S]*?\n\}\n/.exec(src)![0];
  // MAC_TEST_HOOK() : UNE ligne insérée par le TEST dans la boucle d'encodage de la copie extraite, pour simuler une destruction du marqueur pendant l'encodage (sous-phase 2) ; hors de cette ligne, code du sketch mot pour mot
  const hooked = fn.replace(/^#if POD_RENDER_V1 && POD_CANARY\n/gm, "").replace(/^#endif\n/gm, "").replace("b[3 * i] = ", "MAC_TEST_HOOK(); b[3 * i] = ");
  if (!hooked.includes("MAC_TEST_HOOK();")) throw new Error("boucle d'encodage introuvable");
  return helper + hooked;
}
function build(extra: (s: string) => string = (s) => s, extraMac: (s: string) => string = (s) => s): string {
  const dir = fs.mkdtempSync(path.join(tmp, "b-"));
  fs.writeFileSync(path.join(dir, "canary_extract.inc"), extra(extract()));
  fs.writeFileSync(path.join(dir, "mac_extract.inc"), extraMac(extractMac()));
  const out = path.join(dir, path.basename(exe));
  compileHarness(choice.path!, path.join(root, "consensus-pod", "host", "canary_check_harness.cpp"), out, [`-I${dir}`]);
  return out;
}

test("EXÉCUTION HÔTE du code extrait du sketch : pile saine → retour + mesure ; point silencieux muet ; aucun repeint ; maximum cumulatif conservé ; marge < 128 / marqueur détruit / écriture sous la limite / SP hors pile / longueur détruite → diagnostic complet puis VERROU FATAL (la fonction ne revient jamais)", { skip }, () => {
  const r = runProcess(build(), []);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const lines = r.stdout.trim().split("\n").filter((l) => /^S\d+ /.test(l));
  assert.equal(lines.length, 40, r.stdout);
  for (const l of lines) assert.match(l, /^S\d+ OK /, l);
});

test("CONTRÔLES NÉGATIFS : un instrument qui repeint, qui ne pose pas de verrou, qui ignore le marqueur ou la zone sous la limite est REFUSÉ par le harnais", { skip }, () => {
  const mutants: Array<[string, string, string]> = [
    ["sans verrou", "for (;;) if (millis() - t >= 10000UL)", "if (millis() - t >= 10000UL)"],
    ["marqueur ignoré", "const bool alert = !magicOk || !paintedOk ||", "const bool alert = false ||"],
    ["zone sous la limite redevenue fatale (régression du faux positif « pile max 3072 »)", "margin < 128 || !spOk;", "margin < 128 || !spOk || stackDepthBytes() > 1024;"],
    ["marge ignorée", "margin < 128 ||", "false ||"],
    ["repeint", "  const uint32_t sp = (uint32_t)(uintptr_t)__builtin_frame_address(0);", "  for (volatile uint8_t* q = lo + 8; q < end; q++) *q = CANARY_PAINT;\n  const uint32_t sp = (uint32_t)(uintptr_t)__builtin_frame_address(0);"],
    ["silencieux bavard", "if (!alert && !verbose) return;", "if (!alert && !verbose && false) return;"],
  ];
  for (const [name, a, b] of mutants) {
    const base = extract();
    assert.equal(base.split(a).length, 2, `mutation « ${name} » : motif introuvable`);
    // sans « noreturn » : le mutant « sans verrou » RETOURNE, ce que le compilateur refuserait sinon
    const r = runProcess(build((s) => s.split(a).join(b).split("noinline, noreturn").join("noinline")), [], 20000);   // un mutant qui tombe dans le verrou silencieux ne rend jamais la main : tué après 20 s = détecté
    const bad = r.status !== 0 || r.stdout.split("\n").some((l) => /^S\d+ ECART /.test(l));
    assert.ok(bad, `mutation « ${name} » NON détectée`);
  }
});

test("NETSTACK-FIX3 : points R0-R2 de doRegister (avant la transaction), phase PodNet contrôlée AVANT le point A, sonde du journal fatale sur GUARD/MARGIN", () => {
  const src = read(INO), code = strip(src);
  const dr = code.slice(code.indexOf("static bool doRegister()"), code.indexOf("\n}\n", code.indexOf("static bool doRegister()")));
  const i0 = dr.indexOf("R0: entree de doRegister (silencieux)"), im = dr.indexOf("macString()"), iMp = dr.indexOf("podCanaryMacPhase(mac);"), i1 = dr.indexOf("R1: apres macString (silencieux ; ne prouve PAS a lui seul le module Wi-Fi"), i2 = dr.indexOf("R2: avant httpCall, corps construit (silencieux)"), ih = dr.indexOf('httpCall("POST", "/api/register"');
  assert.ok(i0 >= 0 && i0 < im && im < iMp && iMp < i1 && i1 < i2 && i2 < ih, "R0 < macString < rapport des sous-phases < R1 < R2 < httpCall");
  for (const p of ["R0", "R1", "R2"]) assert.match(dr, new RegExp(`podCanaryCheck\\("  ${p}:[^"]*silencieux[^"]*", false\\);`));
  const hc = code.slice(code.indexOf("static int httpCall"), code.indexOf("\n}\n", code.indexOf("static int httpCall")));
  assert.ok(hc.indexOf("podCanaryPhase(ni.pad[0]);") > hc.indexOf("netHttpRaw(") && hc.indexOf("podCanaryPhase(ni.pad[0]);") < hc.indexOf("A: apres la transaction"), "la phase est contrôlée juste après la transaction, AVANT A");
  assert.match(code, /static void __attribute__\(\(noinline\)\) podCanaryNet\(const char\* tag, const PodNetInfo& ni, bool ran\) \{\s*podCanaryPhase\(ni\.pad\[0\]\);/);
  const phase = /static void __attribute__\(\(noinline\)\) podCanaryPhase[\s\S]*?\n\}\n/.exec(code)![0];
  assert.match(phase, /if \(phase == 0\) return;[\s\S]*podCanaryEmit\(podCanaryPrintPhase, &c\);\s*for \(;;\) \{ __asm volatile\("nop"\); \}/);
  const pl = /static void podCanaryPrintLog\(void\* v\) \{[\s\S]*?\n\}\n/.exec(code)![0];
  assert.match(pl, /if \(c\.li\.err == POD_NET_GUARD \|\| c\.li\.err == POD_NET_MARGIN\) podCanaryHalt\("sonde de la pile de journal"\);/);
  assert.match(code, /podCanaryEmit\(podCanaryPrintLog, &c\);\s*if \(c\.li\.err == POD_NET_GUARD \|\| c\.li\.err == POD_NET_MARGIN\) for \(;;\)/);
});

test("NETSTACK-FIX3-R1 : sous-phases de macString() — silencieuses (aucune E/S, aucun logf, malloc, mallinfo ni String supplémentaire), dans des blocs de canari, texte hors canari INCHANGÉ ; rapport après le retour", () => {
  const src = read(INO);
  const fnRaw = /static String macString\(\) \{[\s\S]*?\n\}\n/.exec(src)![0];
  // hors blocs de canari : exactement la fonction d'avant
  const outside = fnRaw.replace(/#if POD_RENDER_V1 && POD_CANARY\n[\s\S]*?\n#endif\n/g, "");
  // production (NETSTACK-WIFI-CALLS-FIX1) : module Wi-Fi sur pile dédiée (wifiMac), échec fermé (chaîne vide), encodage hexadécimal manuel borné dans char[18] — plus de snprintf
  assert.equal(outside, "static String macString() {\n  uint8_t m[6] = {0};\n  if (!wifiMac(m)) return String();\n  char b[18];\n  for (uint8_t i = 0; i < 6; i++) { b[3 * i] = macHexDigit(m[i] >> 4); b[3 * i + 1] = macHexDigit(m[i] & 15); b[3 * i + 2] = (i < 5) ? ':' : '\\0'; }\n  return String(b);\n}\n");
  assert.doesNotMatch(fnRaw, /snprintf|WiFi\./, "ni snprintf ni appel direct au module dans macString");
  const blocks = [...fnRaw.matchAll(/#if POD_RENDER_V1 && POD_CANARY\n([\s\S]*?)\n#endif\n/g)].map((x) => strip(x[1]).replace(/\s+/g, " ").trim());
  assert.equal(blocks.length, 3, "une sonde après l'appel au module, une après l'encodage hexadécimal, une après la construction du String");
  // ordre : sonde 1 juste après wifiMac ; sonde 2 juste après la boucle d'encodage ; sonde 3 après la construction du String
  const iWifi = fnRaw.indexOf("wifiMac(m)"), iP1 = fnRaw.indexOf("macPh = 1;"), iSn = fnRaw.indexOf("macHexDigit(m[i] >> 4)"), iP2 = fnRaw.indexOf("macPh = 2;"), iS = fnRaw.indexOf("String s(b);"), iP3 = fnRaw.indexOf("macPh = 3;");
  assert.ok(iWifi < iP1 && iP1 < iSn && iSn < iP2 && iP2 < iS && iS < iP3, "ordre des sondes");
  assert.match(blocks[0], /^uint8_t macPh = 0; if \(\*\(volatile uint32_t\*\)&__StackLimit != 0x434E5259UL\) macPh = 1;$/);
  assert.match(blocks[1], /^if \(macPh == 0 && \*\(volatile uint32_t\*\)&__StackLimit != 0x434E5259UL\) macPh = 2;$/);
  // sonde 3 : le String retourné est construit UNE fois (celui qui est retourné), puis marqué en place ; rien d'autre
  assert.match(blocks[2], /^\{ String s\(b\); if \(macPh == 0 && \*\(volatile uint32_t\*\)&__StackLimit != 0x434E5259UL\) macPh = 3; if \(macPh\) \{ s\.setCharAt\(0, '!'\); s\.setCharAt\(1, \(char\)\('0' \+ macPh\)\); \} return s; \}$/);
  for (const b of blocks) assert.doesNotMatch(b.replace(/String s\(b\);/, ""), /Serial|logf|printf|malloc|calloc|realloc|new\b|mallinfo|String|delay|millis|freeHeapBytes|podCanary/, `sonde non silencieuse : ${b}`);
  // rapport APRÈS le retour : doRegister lit le String retourné ; la fonction de rapport ne passe que par la pile de journal puis verrou
  const rep = strip(/static void __attribute__\(\(noinline\)\) podCanaryMacPhase[\s\S]*?\n\}\n/.exec(src)![0]);
  assert.match(rep, /if \(mac\.length\(\) < 2 \|\| mac\.charAt\(0\) != '!'\) return;[\s\S]*podCanaryEmit\(podCanaryPrintMac, &c\);\s*for \(;;\) \{ __asm volatile\("nop"\); \}/);
  const pm = strip(/static void podCanaryPrintMac\(void\* v\) \{[\s\S]*?\n\}\n/.exec(src)![0]);
  assert.match(pm, /podCanaryHalt\("macString sous-phase"\);/);
  // le texte dit que R1 seul ne prouve pas le module Wi-Fi
  assert.match(src, /R1: apres macString \(silencieux ; ne prouve PAS a lui seul le module Wi-Fi/);
  // aucun autre firmware ne porte ces sondes
  for (const sk of ["pod_uno_r4_eink27", "pod_uno_r4_eink27_oled", "pod_uno_r4_tft18", "pod_uno_r4"]) assert.doesNotMatch(read(`arduino_uno_r4/${sk}/${sk}.ino`), /macPh|podCanaryMacPhase/);
});

test("NETSTACK-FIX3-R1 : CONTRÔLES NÉGATIFS des sous-phases de macString — sonde supprimée, sonde qui écrase la première, rapport qui ne s'arrête pas : REFUSÉS par le harnais hôte", { skip }, () => {
  const mutants: Array<[string, string, string]> = [
    ["sonde 1 supprimée", "macPh = 1;", "macPh = 0;"],
    ["sonde 2 supprimée", "macPh = 2;", "macPh = 0;"],
    ["sonde 3 supprimée", "macPh = 3;", "macPh = 0;"],
    ["la 2e sonde écrase la 1re (pas « première seulement »)", "if (macPh == 0 && *(volatile uint32_t*)&__StackLimit != 0x434E5259UL) macPh = 2;", "if (*(volatile uint32_t*)&__StackLimit != 0x434E5259UL) macPh = 2;"],
    ["le String retourné n'est pas marqué", "s.setCharAt(0, '!');", ""],
  ];
  for (const [name, a, b] of mutants) {
    const base = extractMac();
    assert.equal(base.split(a).length >= 2, true, `mutation « ${name} » : motif introuvable`);
    const r = runProcess(build((s) => s, (s) => s.split(a).join(b)), [], 20000);
    const bad = r.status !== 0 || r.stdout.split("\n").some((l) => /^S\d+ ECART /.test(l));
    assert.ok(bad, `mutation « ${name} » NON détectée`);
  }
  // rapport qui ne verrouille pas : retire le verrou final de podCanaryMacPhase (dans le code d'instrument)
  const a = 'podCanaryEmit(podCanaryPrintMac, &c);\n  for (;;) { __asm volatile("nop"); }';
  assert.equal(extract().split(a).length, 2, "motif du rapport");
  const r = runProcess(build((s) => s.split(a).join("podCanaryEmit(podCanaryPrintMac, &c);").split("podCanaryHalt(\"macString sous-phase\");").join("")), [], 20000);
  assert.ok(r.status !== 0 || r.stdout.split("\n").some((l) => /^S\d+ ECART /.test(l)), "un rapport qui ne s'arrête pas n'est pas détecté");
});

test("NETSTACK-WIFI-CALLS-FIX1 : le canari relève la pile Wi-Fi dédiée à chaque appel au module (utilisé/marge/erreur), verrou fatal sur toute erreur de la pile, aucun relevé hors build de canari", () => {
  const src = read(INO), code = strip(src);
  const blk = code.slice(code.indexOf("static uint8_t __attribute__((noinline)) wifiStatusT"), code.indexOf("static char macHexDigit") > 0 ? code.indexOf("// ─── Clés Ed25519") : undefined);
  for (const tag of ['podCanaryWifi(tag ? tag : "status", ni, ran, tag != nullptr);', 'podCanaryWifi("firmwareVersion", ni, ran, true);', 'podCanaryWifi("begin", ni, ran, true);', 'podCanaryWifi("macAddress", ni, ran, true);', 'podCanaryWifi("RSSI", ni, ran, true);', 'podCanaryWifi("localIP", ni, ran, true);'])
    assert.ok(src.includes(`#if POD_RENDER_V1 && POD_CANARY\n  ${tag}\n#endif\n`), `relevé absent ou hors bloc de canari : ${tag}`);
  assert.ok(blk.length > 100);
  const fn = strip(/static void __attribute__\(\(noinline\)\) podCanaryWifi[\s\S]*?\n\}\n/.exec(src)![0]);
  assert.match(fn, /podCanaryPhase\(ni\.pad\[0\]\);/, "la phase de PodNet est contrôlée pour les appels Wi-Fi aussi");
  assert.match(fn, /if \(verbose \|\| !ran \|\| ni\.err != POD_NET_OK\) \{[\s\S]*podCanaryEmit\(podCanaryPrintWifi, &c\);\s*if \(!ran \|\| ni\.err != POD_NET_OK\) for \(;;\) \{ __asm volatile\("nop"\); \}/);
  assert.match(fn, /podCanaryCheck\(tag, false\);/, "la pile principale est contrôlée juste après l'appel");
  const pr = strip(/static void podCanaryPrintWifi\(void\* v\) \{[\s\S]*?\n\}\n/.exec(src)![0]);
  assert.match(pr, /if \(!c\.ran \|\| ni\.err != POD_NET_OK\) \{[^}]*podCanaryHalt\(c\.tag\);/, "l'échec de la pile Wi-Fi pose le verrou");
  assert.doesNotMatch(fn + pr, /logf\(|String\b|WiFi|Conn\b|httpCall|delay\(/);
  // aucun autre firmware ne porte le relevé
  for (const sk of ["pod_uno_r4_eink27", "pod_uno_r4_eink27_oled", "pod_uno_r4_tft18", "pod_uno_r4"]) assert.doesNotMatch(read(`arduino_uno_r4/${sk}/${sk}.ino`), /podCanaryWifi/);
});

test("NETSTACK-WIFI-CALLS-FIX2 : critères fatals du canari = marqueur / longueur invalides, SP hors pile, marge principale < 128 o ; la zone 0xA5 sous la limite n'est plus fatale et n'est plus présentée comme une mesure valide ; 144 o = « sous l'objectif 256 » sans arrêt", () => {
  const src = read(INO);
  const fn = strip(/static void __attribute__\(\(noinline\)\) podCanaryCheck[\s\S]*?\n\}\n/.exec(src)![0]);
  assert.match(fn, /const bool alert = !magicOk \|\| !paintedOk \|\| margin < 128 \|\| !spOk;/, "exactement les quatre critères fatals");
  assert.doesNotMatch(fn.slice(0, fn.indexOf("const bool alert")), /stackDepthBytes|below/, "la zone sous la limite n'entre pas dans la décision");
  assert.ok(fn.indexOf("stackDepthBytes()") > fn.indexOf("if (!alert && !verbose) return;"), "indicateur calculé seulement pour le diagnostic, jamais par un point silencieux sain");
  const pr = /static void podCanaryPrint\(void\* v\) \{[\s\S]*?\n\}\n/.exec(src)![0];
  assert.doesNotMatch(strip(pr), /pile max|ecrit sous la limite ou/, "plus de « pile max » ni de « écrit sous la limite » dans la ligne de mesure");
  assert.match(pr, /c\.margin < 256 && !c\.alert\) \? F\(" o, SOUS L'OBJECTIF 256\) \| SP="\)/, "144 o : sous l'objectif 256, sans alerte");
  assert.match(pr, /zone 0xA5 sous la limite \(INDICATIF seulement, NON fiable depuis les piles temporaires allouees dans le tas\)/);
  // reportMem (production, cinq firmwares) ne présente plus stackDepthBytes() comme une « pile max » valide
  for (const sk of ["pod_uno_r4_eink29", "pod_uno_r4_eink27", "pod_uno_r4_eink27_oled", "pod_uno_r4_tft18", "pod_uno_r4"]) {
    const rm = /static void reportMem\(const char\* tag\) \{[^\n]*\n/.exec(read(`arduino_uno_r4/${sk}/${sk}.ino`))![0];
    assert.doesNotMatch(rm, /pile max/, `${sk} : reportMem parle encore de « pile max »`);
    assert.match(rm, /zone 0xA5 sous la pile %lu o \(INDICATIF : NON fiable des la 1re pile temporaire\)/);
  }
  // wifiFailed : sur GUARD, arrêt sûr AVANT tout journal (le tas voisin peut être corrompu, logf alloue)
  for (const sk of ["pod_uno_r4_eink29", "pod_uno_r4_eink27", "pod_uno_r4_eink27_oled", "pod_uno_r4_tft18", "pod_uno_r4"]) {
    const wf = strip(/static void __attribute__\(\(noinline\)\) wifiFailed[\s\S]*?\n\}\n/.exec(read(`arduino_uno_r4/${sk}/${sk}.ino`))![0]);
    assert.ok(wf.indexOf("if (ni.err == POD_NET_GUARD) logfSafeStop();") > 0 && wf.indexOf("if (ni.err == POD_NET_GUARD) logfSafeStop();") < wf.indexOf("logf("), `${sk} : logfSafeStop doit précéder logf`);
  }
});

/** NETSTACK-WIFI-CALLS-FIX3 : violations de la règle « le contrôle B est appelé APRÈS le retour complet de podCanaryNet, jamais depuis son corps » (liste vide = conforme). */
function podCanaryNetViolations(src: string): string[] {
  const v: string[] = [];
  const net = /static void __attribute__\(\(noinline\)\) podCanaryNet\(const char\* tag, const PodNetInfo& ni, bool ran\) \{[\s\S]*?\n\}\n/.exec(src);
  if (!net) return ["podCanaryNet absente"];
  if (/podCanaryCheck\s*\(/.test(strip(net[0]))) v.push("podCanaryCheck imbriqué dans le corps de podCanaryNet (cadre encore vivant : +20 o)");
  const code = strip(src);
  const sites: Array<[string, string]> = [["http", "B: apres le rapport PodNet (silencieux)"], ["pull-frame", "B (pull-frame): apres le rapport PodNet (silencieux)"], ["candidate-frame", "B (candidate-frame): apres le rapport PodNet (silencieux)"]];
  for (const [site, tag] of sites) {
    // « podCanaryNet("site", ni, ran); » puis (blocs gardés fermés) le contrôle B, sans rien d'autre entre les deux
    const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`podCanaryNet\\("${site}", ni, ran\\);\\s*#endif\\s*#if POD_RENDER_V1 && POD_CANARY\\s*podCanaryCheck\\("  ${esc(tag)}", false\\);\\s*#endif`);
    if (!re.test(code)) v.push(`le contrôle B de « ${site} » n'est pas appelé immédiatement après le retour de podCanaryNet`);
    if ((code.match(new RegExp(`podCanaryCheck\\("  ${esc(tag)}"`, "g")) ?? []).length !== 1) v.push(`le contrôle B de « ${site} » doit exister exactement une fois`);
  }
  // A avant le rapport, C après le journal HTTP (httpCall)
  const hc = code.slice(code.indexOf("static int httpCall"), code.indexOf("\n}\n", code.indexOf("static int httpCall")));
  const iA = hc.indexOf("A: apres la transaction (silencieux)"), iRep = hc.indexOf('podCanaryNet("http"'), iB = hc.indexOf("B: apres le rapport PodNet (silencieux)"), iLog = hc.indexOf('logf("[HTTP %s]'), iC = hc.indexOf("C: apres le journal HTTP (silencieux)");
  if (!(iA >= 0 && iA < iRep && iRep < iB && iB < iLog && iLog < iC)) v.push("ordre A < rapport < B < journal HTTP < C non respecté dans httpCall");
  return v;
}

test("NETSTACK-WIFI-CALLS-FIX3 : le contrôle B sort de podCanaryNet et suit son retour chez chaque appelant (http, pull-frame, candidate-frame) ; A avant le rapport, C après le journal HTTP ; CONTRÔLES NÉGATIFS", () => {
  const src = read(INO);
  assert.deepEqual(podCanaryNetViolations(src), []);
  // mutants : B remis dans le corps de podCanaryNet · B supprimé chez un appelant · B placé AVANT le rapport · C avant le journal HTTP
  const bHttp = '#if POD_RENDER_V1 && POD_CANARY\n  podCanaryCheck("  B: apres le rapport PodNet (silencieux)", false);\n#endif\n';
  assert.ok(src.includes(bHttp), "bloc B de httpCall introuvable");
  const mutants: Array<[string, string]> = [
    ["B réintroduit dans podCanaryNet", src.replace("  // NETSTACK-WIFI-CALLS-FIX3 : AUCUN podCanaryCheck ici.", '  podCanaryCheck("  B: apres le rapport PodNet (silencieux)", false);\n  // NETSTACK-WIFI-CALLS-FIX3 : AUCUN podCanaryCheck ici.')],
    ["B supprimé chez l'appelant pull-frame", src.replace('podCanaryCheck("  B (pull-frame): apres le rapport PodNet (silencieux)", false);', "")],
    ["B supprimé chez l'appelant candidate-frame", src.replace('podCanaryCheck("  B (candidate-frame): apres le rapport PodNet (silencieux)", false);', "")],
    ["B supprimé de httpCall", src.replace(bHttp, "")],
    ["B avant le rapport dans httpCall", src.replace(bHttp, "").replace('podCanaryNet("http", ni, ran);', 'podCanaryCheck("  B: apres le rapport PodNet (silencieux)", false);\n  podCanaryNet("http", ni, ran);')],
  ];
  for (const [name, s] of mutants) {
    assert.notStrictEqual(s, src, `mutation « ${name} » sans effet`);
    assert.notEqual(podCanaryNetViolations(s).length, 0, `mutation « ${name} » NON détectée`);
  }
  // le commentaire de l'instrument ne présente plus l'écriture sous __StackLimit comme critère fatal
  assert.doesNotMatch(src, /Toute ANOMALIE \(marqueur détruit, marge < 128 o, écriture sous __StackLimit/);
  assert.match(src, /Toute ANOMALIE \(marqueur ou longueur détruits, marge PRINCIPALE < 128 o, SP hors de la pile — PAS la zone 0xA5 peinte sous __StackLimit/);
  // aucun autre firmware ne porte ces contrôles, et le build de production (canari éteint) est inchangé : les blocs gardés sont retirés avant comparaison par netStack.test.ts
  for (const sk of ["pod_uno_r4_eink27", "pod_uno_r4_eink27_oled", "pod_uno_r4_tft18", "pod_uno_r4"]) assert.doesNotMatch(read(`arduino_uno_r4/${sk}/${sk}.ino`), /podCanaryCheck/);
});
