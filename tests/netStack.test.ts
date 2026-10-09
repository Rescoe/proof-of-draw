import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { compileHarness, describeChoice, findCompiler, runProcess } from "./helpers/cppHarness";
import { NET_SKETCHES, netEditsFor, undoNetStack } from "./helpers/netStackEdits";

// LOT8B2B2-NETSTACK-FIX1 — TOUTE transaction réseau/TLS des cinq firmwares UNO R4 sur une pile dédiée (consensus-pod/src/adapters/podNetStack.h).
// Cause mesurée sur la carte (BOOT-FIX2, 09/10/2026) : WiFiSSLClient::connect() descend de 456 o SOUS __StackLimit (pile max réelle 1480 o). L'hôte prouve la logique (garde, marge, échec fermé, imbrication, effacement) ;
// le déplacement réel de SP et la profondeur réelle restent à mesurer par le canari sans frame (docs/LOT_8B2B2_NETSTACK_FIX1_2026_10_09.md).
const root = path.join(__dirname, "..");
const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8").replace(/\r\n/g, "\n");
const HDR = "consensus-pod/src/adapters/podNetStack.h";
const EDH = "consensus-pod/src/adapters/podEdStack.h";
const BACKUP = "firmware-backups/2026-10-09_avant-netstack-fix1";
const SKETCHES = ["pod_uno_r4_eink29", "pod_uno_r4_eink27", "pod_uno_r4_eink27_oled", "pod_uno_r4_tft18", "pod_uno_r4"];
const stripLine = (s: string) => s.replace(/\/\/.*$/gm, "");
const noCanary = (s: string) => s.replace(/#if POD_RENDER_V1 && POD_CANARY\n[\s\S]*?\n#endif\n/g, "");
/** corps des lambdas « auto tx = [&]() { … }; » (comptage d'accolades hors littéraux de chaîne) */
function lambdaBodies(src: string): string[] {
  const out: string[] = [];
  const re = /auto tx = \[&\]\(\) \{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    let depth = 1, i = m.index + m[0].length;
    const start = i;
    while (i < src.length && depth > 0) {
      const c = src[i];
      if (c === '"') { i++; while (i < src.length && src[i] !== '"') { if (src[i] === "\\") i++; i++; } }
      else if (c === "{") depth++;
      else if (c === "}") depth--;
      i++;
    }
    out.push(src.slice(start, i - 1));
  }
  return out;
}

test("la table couvre les cinq firmwares", () => {
  assert.deepEqual([...NET_SKETCHES].sort(), [...SKETCHES].sort());
});

for (const sk of SKETCHES) {
  test(`${sk} : en annulant les modifications EXACTES de la table, on retrouve le sketch d'avant NETSTACK-FIX1 au texte près (hors blocs du canari) ; chaque modification est unique`, () => {
    const now = read(`arduino_uno_r4/${sk}/${sk}.ino`), before = read(`${BACKUP}/${sk}/${sk}.ino`);
    assert.equal(noCanary(undoNetStack(now, sk)), noCanary(before));
    for (const e of netEditsFor(sk)) assert.equal(now.split(e.neu).length - 1, 1, `${sk} : « ${e.id} »`);
  });

  test(`${sk} : plus AUCUNE transaction réseau hors de la pile dédiée — chaque Conn vit dans un « auto tx = [&]() » exécuté par podNetRun, résultat toujours testé, aucun PodEd ni autre transaction à l'intérieur, signature APRÈS la fermeture`, () => {
    const src = read(`arduino_uno_r4/${sk}/${sk}.ino`), code = stripLine(src);
    assert.match(src, /#include "podEdStack\.h".*\n(?:[\s\S]*?\n)?#include "podNetStack\.h"/);
    const conns = (code.match(/Conn c\(HTTP_TIMEOUT_MS\);/g) ?? []).length, lambdas = lambdaBodies(code);
    assert.ok(conns >= 3, `${sk} : au moins 3 sites réseau`);
    assert.equal(lambdas.length, conns, "autant de lambdas que de Conn");
    for (const b of lambdas) {
      assert.equal((b.match(/Conn c\(HTTP_TIMEOUT_MS\);/g) ?? []).length, 1, "un seul Conn par lambda");
      assert.match(b, /c\.client\.stop\(\);\s*$/, "la connexion est fermée explicitement en DERNIER, avant de quitter la pile dédiée");
      assert.doesNotMatch(b, /\breturn\b/, "aucune sortie anticipée de la lambda : client.stop() est toujours appelé (même si request() retourne un code négatif)");
      // jamais d'imbrication ni de travail non réseau dans la pile dédiée
      assert.doesNotMatch(b, /PodEd::|signED25519|podNetRun|httpCall\(|ackFrame\(|NVIC_SystemReset|EEPROM|display\(|refreshPanel\(/);
    }
    // aucune requête hors lambda : `.request(` n'existe que dans la définition de Conn et dans les lambdas
    const outside = lambdas.reduce((s, b) => s.split(b).join(""), code);
    assert.equal((outside.match(/\.request\(/g) ?? []).length, 0, "une requête est émise hors de la pile dédiée");
    assert.equal((outside.match(/client\.connect\(/g) ?? []).length, 1, "connect() n'existe que dans Conn::request");
    // chaque podNetRun : résultat stocké dans `ran` et exploité
    const runs = [...code.matchAll(/const bool ran = podNetRun\(tx, &ni\);/g)], raw = [...code.matchAll(/return podNetRun\(tx, &ni\);/g)];
    assert.equal(runs.length + raw.length, conns);
    assert.equal(raw.length, 1, "un seul helper brut : netHttpRaw");
    for (const m of runs) assert.match(code.slice(m.index!, m.index! + 1200), /if \(!ran\)/, "résultat de podNetRun non exploité");
    const hc = code.slice(code.indexOf("static int httpCall"), code.indexOf("\n}\n", code.indexOf("static int httpCall")));
    assert.match(hc, /const bool ran = netHttpRaw\(method, path, body, code, complete, ni\);[\s\S]*if \(!ran\)/, "httpCall exploite le résultat du helper");
    // le helper brut est noinline : sa fermeture, son PodNetInfo et son cadre ont disparu avant le journal et le traitement de la réponse
    assert.match(code, /static bool __attribute__\(\(noinline\)\) netHttpRaw\(/);
    assert.doesNotMatch(hc, /auto tx|Conn c\(/, "httpCall ne porte plus la fermeture ni le Conn");
    assert.equal((code.match(/podNetRun\(/g) ?? []).length, conns, "un appel podNetRun par transaction");
    // le vote : la pile réseau est fermée AVANT la signature (jamais imbriquée dans PodEd)
    const v = code.indexOf("static bool doValidateV2"), end = code.indexOf("\n}\n", v), body = code.slice(v, end);
    assert.ok(body.indexOf("netReadCandidate(candidateId, kind, bytes, chk") > 0 && body.indexOf("netReadCandidate(") < body.indexOf("PodEd::sign("), "la lecture du candidat (pile réseau, fonction à part) précède la signature");
    assert.equal(body.includes("podNetRun("), false, "doValidateV2 ne contient plus de transaction : son cadre ne porte que la signature");
  });
}

test("échec fermé aux sites : un échec de pile dédiée ne laisse aucun résultat présenté comme réussi, jamais de vote ni d'ACK ; formulations HONNÊTES : NON exécutée (NOMEM/NESTED) ≠ EXÉCUTÉE mais résultat local rejeté (GUARD/MARGIN)", () => {
  for (const sk of SKETCHES) {
    const code = stripLine(read(`arduino_uno_r4/${sk}/${sk}.ino`));
    // httpCall : code -5 si la transaction a été EXÉCUTÉE (un POST/vote/ACK a pu partir), -4 sinon ; le message le dit
    assert.match(code, /if \(!ran\) \{ logf\("\[HTTP %s\] pile réseau dédiée : %s \(erreur %u, marge %u o\)%s", method, podNetWhy\(ni\), \(unsigned\)ni\.err, \(unsigned\)ni\.margin, podNetExecuted\(ni\) \? " — la requête a PU atteindre le serveur \(POST, vote ou ACK possibles\)" : ""\); return podNetExecuted\(ni\) \? -5 : -4; \}/, `${sk} : httpCall`);
    for (const m of code.matchAll(/if \(!ran\) \{([^\n]*)\}\n/g)) {
      const s = m[1];
      if (/\[HTTP %s\]/.test(s)) continue;   // httpCall : vérifié ci-dessus
      // échec fermé : les indicateurs de succès sont remis à zéro AVANT le traitement d'échec existant (ou : chk remis à zéro)
      const closed = /(got|shown) = false;/.test(s) || /memset\(&chk, 0, sizeof\(chk\)\)/.test(s);
      assert.ok(closed, `${sk} : échec de pile dédiée non fermé : ${s.slice(0, 80)}`);
      assert.match(s, /podNetWhy\(ni\), \(unsigned\)ni\.err, \(unsigned\)ni\.margin/, "la cause honnête (non exécutée / exécutée-rejetée), l'erreur et la marge sont journalisées");
      assert.doesNotMatch(s, /indisponible/, "plus de « indisponible » : la formulation dépend de podNetWhy");
    }
    // TFT : l'écran a pu être redessiné AVANT la détection de la marge → jamais « image NON présentée » ; e-ink/OLED : l'image n'est affichée qu'après, donc la formule reste exacte
    const frames = [...code.matchAll(/if \(!ran\) \{ (?:got|shown) = false; noFrame = false; logf\("(\[FRAME\]|\[OLED\])([^\n]*)\}\n/g)].map((m) => m[0]);
    assert.ok(frames.length >= 1, `${sk} : échec de lecture d'image`);
    for (const l of frames) {
      if (sk === "pod_uno_r4_tft18" || sk === "pod_uno_r4") {
        assert.doesNotMatch(l, /NON présentée/, `${sk} : formulation fausse sur TFT`);
        assert.match(l, /l'écran a pu être partiellement ou totalement redessiné/);
      } else assert.match(l, /image NON présentée, pas d'ACK/);
      assert.match(l, /pas d'ACK/);
    }
  }
  // aucune formulation « NON présentée » ne subsiste dans les sketches TFT
  for (const sk of ["pod_uno_r4_tft18", "pod_uno_r4"]) assert.doesNotMatch(read(`arduino_uno_r4/${sk}/${sk}.ino`), /image NON présentée/);
});

/** NETSTACK-FIX3-R1 : le corps de logfSafeStop() doit être EXACTEMENT une boucle sans fin silencieuse. Retourne les violations (liste vide = conforme). */
function silentStopViolations(src: string): string[] {
  const code = stripLine(src);
  const m = /static void __attribute__\(\(noinline, noreturn\)\) logfSafeStop\(\) \{([\s\S]*?)\n\}\n/.exec(code);
  if (!m) return ["fonction absente ou sans noinline/noreturn"];
  const body = m[1].replace(/\s+/g, " ").trim();
  const v: string[] = [];
  if (body !== 'for (;;) { __asm volatile("nop"); }') v.push(`corps inattendu : ${body}`);
  if (/\b(Serial|logf|printf|print|println|write|flush|malloc|calloc|realloc|free|new|delete|String|mallinfo|delay|millis|return|break|goto|PodNet|WiFi|Conn)\b/.test(body)) v.push("E/S, allocation, retour ou appel interdit dans le corps");
  return v;
}

test("logfSafeStop (NETSTACK-FIX3-R1) : arrêt fatal SILENCIEUX immédiat dans les cinq firmwares — aucune E/S, allocation ni retour ; un correctif qui imprime, alloue ou retourne est REFUSÉ", () => {
  for (const sk of SKETCHES) assert.deepEqual(silentStopViolations(read(`arduino_uno_r4/${sk}/${sk}.ino`)), [], sk);
  const base = read("arduino_uno_r4/pod_uno_r4_eink29/pod_uno_r4_eink29.ino");
  const stop = /static void __attribute__\(\(noinline, noreturn\)\) logfSafeStop\(\) \{[\s\S]*?\n\}\n/.exec(base)![0];
  const mutants: Array<[string, string]> = [
    ["Serial.println avant la boucle", 'static void __attribute__((noinline, noreturn)) logfSafeStop() {\n  Serial.println(F("x"));\n  for (;;) { __asm volatile("nop"); }\n}\n'],
    ["logf", 'static void __attribute__((noinline, noreturn)) logfSafeStop() {\n  logf("x");\n  for (;;) { __asm volatile("nop"); }\n}\n'],
    ["allocation", 'static void __attribute__((noinline, noreturn)) logfSafeStop() {\n  void* p = malloc(4); (void)p;\n  for (;;) { __asm volatile("nop"); }\n}\n'],
    ["String", 'static void __attribute__((noinline, noreturn)) logfSafeStop() {\n  String s("x");\n  for (;;) { __asm volatile("nop"); }\n}\n'],
    ["retour", 'static void __attribute__((noinline, noreturn)) logfSafeStop() {\n  if (millis() > 1) return;\n  for (;;) { __asm volatile("nop"); }\n}\n'],
    ["boucle remplacée par un delay", 'static void __attribute__((noinline, noreturn)) logfSafeStop() {\n  delay(1000);\n}\n'],
    ["sans noreturn", 'static void __attribute__((noinline)) logfSafeStop() {\n  for (;;) { __asm volatile("nop"); }\n}\n'],
  ];
  for (const [name, fn] of mutants) assert.notEqual(silentStopViolations(base.replace(stop, fn)).length, 0, `mutant « ${name} » NON refusé`);
});

test("journal sur pile dédiée (NETSTACK-FIX2) : logf s'exécute sur la pile de journal quand l'appelant est sur la pile principale, directement sur une pile dédiée ; tampon statique unique ; abandon silencieux de la ligne en cas d'échec", () => {
  for (const sk of SKETCHES) {
    const src = read(`arduino_uno_r4/${sk}/${sk}.ino`), code = stripLine(src);
    const fn = /static void logf\(const char\* fmt, \.\.\.\) \{[\s\S]*?\n\}\n/.exec(code)![0];
    const tail = sk === "pod_uno_r4_eink29" ? String.raw`if \(li\.err == POD_NET_GUARD\s*#if POD_RENDER_V1 && POD_CANARY\s*\|\| li\.err == POD_NET_MARGIN\s*#endif\s*\) logfSafeStop\(\);` : String.raw`if \(li\.err == POD_NET_GUARD\) logfSafeStop\(\);`;   // MARGIN n'est fatal que dans le build de canari (e-ink 2,9″)
    assert.match(fn, new RegExp(String.raw`LogJob j = \{ fmt, &ap \};\s*if \(podNetOnMainStack\(\)\) \{\s*PodNetInfo li;\s*PodNet::runSized\(logfEmit, &j, POD_LOG_STACK_TOTAL, &li\);\s*${tail}\s*\} else logfEmit\(&j\);\s*va_end\(ap\);`), sk);
    // GUARD = garde écrasée = voisin du tas corrompu : ARRÊT SÛR définitif (noreturn, boucle sans fin, aucun retour) — pas une simple ligne perdue ; NOMEM : ligne abandonnée
    const stop = /static void __attribute__\(\(noinline, noreturn\)\) logfSafeStop\(\) \{[\s\S]*?\n\}\n/.exec(code)![0];
    assert.match(stop, /for \(;;\) \{ __asm volatile\("nop"\); \}/); assert.doesNotMatch(stop, /\b(return|break|goto)\b/);
    const emit = /static void logfEmit\(void\* p\) \{[\s\S]*?\n\}\n/.exec(code)![0];
    assert.match(emit, /static char b\[256\];/); assert.match(emit, /vsnprintf\(b, sizeof\(b\), j->fmt, \*j->ap\);\s*Serial\.println\(b\);/);
    assert.equal((code.match(/Serial\.println\(b\)/g) ?? []).length, 1, "une seule écriture du journal");
    assert.doesNotMatch(fn, /Serial\./, "logf n'écrit pas lui-même");
  }
  // la taille de la pile de journal tient la chaîne vsnprintf du pire cas + exception + objectif de marge
  const h = read(HDR);
  assert.match(h, /#define POD_LOG_STACK_TOTAL 1536u/); assert.match(h, /POD_LOG_STACK_TOTAL >= POD_NET_GUARD_BYTES \+ 736u \+ 104u \+ POD_NET_MARGIN_GOAL/);
});

test("podNetStack.h : aucune variable globale (hors crochets de test), même trampoline de 8 instructions que PodEd (validé sur carte), imbrication refusée AVANT toute allocation, effacement AVANT free(), constantes", () => {
  const raw = read(HDR);
  const prod = stripLine(raw.replace(/#ifdef POD_NET_HOST_TEST[\s\S]*?#endif\n/g, ""));
  assert.doesNotMatch(prod.replace(/#if POD_NET_SWITCH_STACK[\s\S]*?\n#else\n/, ""), /^\s*(static|extern)\s+[\w:<>\s*]+?\s+\w+(\[[^\]]*\])?\s*(=[^=;]*)?;\s*$/m, "variable globale/statique détectée");
  const asm = (s: string) => [.../__asm volatile\(([\s\S]*?)\);\n\}/.exec(s)![1].matchAll(/"([^"\\]*?)\s*(?:\\n)?\s*"/g)].map((m) => m[1].trim().replace(/\s+/g, " ")).filter(Boolean);
  assert.deepEqual(asm(raw), asm(read(EDH)), "le trampoline doit être EXACTEMENT celui de PodEd");
  assert.deepEqual(asm(raw), ["push {r4, r5, lr}", "mov r4, r0", "mov r5, sp", "mov r0, r1", "mov sp, r2", "blx r4", "mov sp, r5", "pop {r4, r5, pc}"]);
  assert.doesNotMatch(raw.slice(raw.indexOf("__asm volatile"), raw.indexOf("#else", raw.indexOf("__asm volatile"))).replace(/\/\/.*$/gm, ""), /\b(msr|mrs|control|psp|isb)\b/i);
  const run = raw.slice(raw.indexOf("static bool runSized("));
  assert.ok(run.indexOf("podNetOnMainStack()") < run.indexOf("malloc(") && run.indexOf("malloc(") < run.indexOf("podNetCallOnStack(") && run.indexOf("podNetCallOnStack(") < run.indexOf("POD_NET_GUARD_PAINT) { guardOk") + 1000, "imbrication refusée avant malloc, appel avant les contrôles");
  assert.ok(run.indexOf("podNetCallOnStack(") < run.indexOf("wipe(blk") && run.indexOf("wipe(blk") < run.indexOf("free(blk)"), "effacement avant free()");
  assert.match(run, /if \(!blk\) \{ I->err = POD_NET_NOMEM; return false; \}/);
  assert.match(raw, /static bool runSized\(void \(\*fn\)\(void\*\), void\* ctx, size_t total, PodNetInfo\* info = nullptr\)/);
  assert.match(raw, /static inline bool podNetExecuted\(const PodNetInfo& ni\) \{ return ni\.err == POD_NET_GUARD \|\| ni\.err == POD_NET_MARGIN; \}/);
  assert.match(raw, /#define POD_NET_STACK_TOTAL 2048u/); assert.match(raw, /#define POD_NET_GUARD_BYTES 64u/); assert.match(raw, /#define POD_NET_MARGIN_MIN 128u/); assert.match(raw, /#define POD_NET_MARGIN_GOAL 256u/);
  // PodEd refuse aussi l'imbrication, avant toute allocation
  const ed = read(EDH), ex = ed.slice(ed.indexOf("static bool execute"));
  assert.ok(ex.indexOf("podEdOnMainStack()") > 0 && ex.indexOf("podEdOnMainStack()") < ex.indexOf("malloc("), "PodEd : imbrication refusée avant malloc");
  for (const sk of SKETCHES) assert.equal(fs.readFileSync(path.join(root, `arduino_uno_r4/${sk}/podNetStack.h`)).compare(fs.readFileSync(path.join(root, HDR))), 0, `${sk}/podNetStack.h diverge de l'original`);
});

// ── Exécution hôte ───────────────────────────────────────────────────────────────────────────────────────────
const choice = findCompiler();
console.log(`[netStack] ${describeChoice(choice)}`);
const skip = choice.path ? false : `${describeChoice(choice)} — exécution hôte de PodNet IGNORÉE`;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "netstack-"));
function build(name: string, hdr: string): string {
  const dir = path.join(tmp, name); fs.mkdirSync(path.join(dir, "host"), { recursive: true }); fs.mkdirSync(path.join(dir, "src", "adapters"), { recursive: true });
  fs.writeFileSync(path.join(dir, "src", "adapters", "podNetStack.h"), hdr);
  fs.copyFileSync(path.join(root, "consensus-pod", "host", "net_stack_harness.cpp"), path.join(dir, "host", "net_stack_harness.cpp"));
  const exe = path.join(dir, process.platform === "win32" ? `${name}.exe` : name);
  compileHarness(choice.path!, path.join(dir, "host", "net_stack_harness.cpp"), exe);
  return exe;
}

test("EXÉCUTION HÔTE de PodNet : résultats chez l'appelant, un seul appel, marge 127 refusée / 128 acceptée / objectif 256, garde, malloc impossible et imbrication → fn non appelée, effacement complet, aucune fuite, 4 transactions sans dérive du tas", { skip }, () => {
  const r = runProcess(build("net_ok", read(HDR)), []);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout.trim(), /^PASS \d+$/);
});

test("CONTRÔLES NÉGATIFS : sans le contrôle de garde, de marge, d'imbrication, de malloc, sans effacement, ou en appelant fn malgré l'échec de malloc, le harnais REFUSE PodNet", { skip }, () => {
  const hdr = read(HDR);
  const mutants: Array<[string, string, string]> = [
    ["garde", "if (!guardOk) { I->err = POD_NET_GUARD; good = false; }", "if (!guardOk && false) { I->err = POD_NET_GUARD; good = false; }"],
    ["marge", "else if (untouched < POD_NET_MARGIN_MIN) { I->err = POD_NET_MARGIN; good = false; }", "else if (untouched < POD_NET_MARGIN_MIN && false) { I->err = POD_NET_MARGIN; good = false; }"],
    ["imbrication", "if (!podNetOnMainStack()) { I->err = POD_NET_NESTED; return false; }", "if (!podNetOnMainStack() && false) { I->err = POD_NET_NESTED; return false; }"],
    ["malloc", "if (!blk) { I->err = POD_NET_NOMEM; return false; }", "if (!blk) { I->err = POD_NET_OK; fn(ctx); return true; }"],
    ["effacement", "    podnetimpl::wipe(blk, total);   // requêtes et réponses ont transité par cette pile\n", "    if (!blk) podnetimpl::wipe(blk, 1);\n"],
    ["objectif", "I->low = (untouched < POD_NET_MARGIN_GOAL) ? 1 : 0;", "I->low = 0;"],
  ];
  for (const [name, a, b] of mutants) {
    assert.equal(hdr.split(a).length, 2, `mutation « ${name} » : motif introuvable`);
    const r = runProcess(build(`net_mut_${name}`, hdr.split(a).join(b)), []);
    assert.notEqual(r.status, 0, `mutation « ${name} » NON détectée`);
  }
});

// ── NETSTACK-FIX3 : sondes de phase de PodNet (sans E/S) ────────────────────────────────────────────────────────
test("sondes de phase : 8 phases dans l'ordre, première phase fautive mémorisée dans PodNetInfo::pad[0], aucune E/S ni appel de bibliothèque dans la sonde, no-op par défaut", () => {
  const h = read(HDR);
  assert.match(h, /#ifndef POD_NET_PROBE\n#define POD_NET_PROBE\(I, n\) \(\(void\)0\)\n#endif/);
  const run = h.slice(h.indexOf("static bool runSized("));
  const phases = [...run.matchAll(/POD_NET_PROBE\(I, (\d)\);/g)].map((m) => Number(m[1]));
  assert.deepEqual(phases, [1, 2, 3, 4, 5, 6, 7], "sept sondes dans runSized, dans l'ordre du code");
  assert.ok(run.indexOf("POD_NET_PROBE(I, 3)") > run.indexOf("podNetCallOnStack(") && run.indexOf("POD_NET_PROBE(I, 4)") > run.indexOf("guardOk") && run.indexOf("POD_NET_PROBE(I, 6)") > run.indexOf("wipe(blk") && run.indexOf("POD_NET_PROBE(I, 7)") > run.indexOf("free(blk)"));
  assert.match(h, /if \(info\) \{ POD_NET_PROBE\(info, 8\); \}\n  return ok;/, "phase 8 : retour de podNetRun");
  // la sonde du sketch : un seul mot lu, une seule écriture dans pad[0] si vide ; définie AVANT l'inclusion de podNetStack.h ; uniquement dans le build de canari
  const src = read("arduino_uno_r4/pod_uno_r4_eink29/pod_uno_r4_eink29.ino");
  const probe = /static inline void podNetProbe\(uint8_t\* slot, uint8_t phase\) \{([^\n]*)\}/.exec(src)![1];
  assert.match(probe, /^ if \(\*slot == 0 && \*\(volatile uint32_t\*\)&__StackLimit != 0x434E5259UL\) \*slot = phase; $/);
  assert.ok(src.indexOf("#define POD_NET_PROBE(I, n) podNetProbe((I)->pad, (n))") < src.indexOf('#include "podNetStack.h"'));
  assert.match(src, /#if POD_RENDER_V1 && POD_CANARY\nextern char __StackLimit;[^\n]*\nstatic inline void podNetProbe/);
  for (const sk of SKETCHES.filter((s) => s !== "pod_uno_r4_eink29")) assert.doesNotMatch(read(`arduino_uno_r4/${sk}/${sk}.ino`), /POD_NET_PROBE|podNetProbe/);
});

test("EXÉCUTION HÔTE des sondes de phase : chaque phase k destructrice est désignée (pad[0] == k), marqueur déjà détruit à l'entrée = phase 1 (cause antérieure à PodNet), première phase conservée, NOMEM = phases 1 et 8 seulement ; CONTRÔLES NÉGATIFS : sonde écrasante, phase supprimée ou déplacée → refusé", { skip }, () => {
  const harness = path.join(root, "consensus-pod", "host", "net_probe_harness.cpp");
  const exe = path.join(tmp, process.platform === "win32" ? "net_probe.exe" : "net_probe");
  compileHarness(choice.path!, harness, exe);
  const r = runProcess(exe, []); assert.equal(r.status, 0, r.stdout + r.stderr); assert.match(r.stdout.trim(), /^PASS \d+$/);
  const hdr = read(HDR);
  const mutants: Array<[string, (s: string) => string]> = [
    ["phase 3 supprimée", (s) => s.split("    POD_NET_PROBE(I, 3);\n").join("")],
    ["phase 7 avant free", (s) => s.split("    free(blk);\n    POD_NET_PROBE(I, 7);").join("    POD_NET_PROBE(I, 7);\n    free(blk);")],
    ["phase 8 supprimée", (s) => s.split("  if (info) { POD_NET_PROBE(info, 8); }\n").join("")],
  ];
  for (const [name, f] of mutants) {
    const dir = fs.mkdtempSync(path.join(tmp, "p-")); fs.mkdirSync(path.join(dir, "host")); fs.mkdirSync(path.join(dir, "src", "adapters"), { recursive: true });
    const m = f(hdr); assert.notEqual(m, hdr, `mutation « ${name} » sans effet`);
    fs.writeFileSync(path.join(dir, "src", "adapters", "podNetStack.h"), m); fs.copyFileSync(harness, path.join(dir, "host", "net_probe_harness.cpp"));
    const e = path.join(dir, "p.exe"); compileHarness(choice.path!, path.join(dir, "host", "net_probe_harness.cpp"), e);
    assert.notEqual(runProcess(e, [], 20000).status, 0, `mutation « ${name} » NON détectée`);
  }
  // sonde qui écrase au lieu de garder la première phase
  const dir = fs.mkdtempSync(path.join(tmp, "p-")); fs.mkdirSync(path.join(dir, "host")); fs.mkdirSync(path.join(dir, "src", "adapters"), { recursive: true });
  fs.writeFileSync(path.join(dir, "src", "adapters", "podNetStack.h"), hdr);
  const h2 = fs.readFileSync(harness, "utf8").split("if (*slot == 0 && g_marker != MAGIC) *slot = phase;").join("if (g_marker != MAGIC) *slot = phase;");
  assert.notEqual(h2, fs.readFileSync(harness, "utf8")); fs.writeFileSync(path.join(dir, "host", "net_probe_harness.cpp"), h2);
  const e2 = path.join(dir, "p2.exe"); compileHarness(choice.path!, path.join(dir, "host", "net_probe_harness.cpp"), e2);
  assert.notEqual(runProcess(e2, [], 20000).status, 0, "sonde écrasante NON détectée");
});
