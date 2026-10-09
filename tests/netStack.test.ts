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
    assert.match(src, /#include "podEdStack\.h".*\n#include "podNetStack\.h"/);
    const conns = (code.match(/Conn c\(HTTP_TIMEOUT_MS\);/g) ?? []).length, lambdas = lambdaBodies(code);
    assert.ok(conns >= 3, `${sk} : au moins 3 sites réseau`);
    assert.equal(lambdas.length, conns, "autant de lambdas que de Conn");
    for (const b of lambdas) {
      assert.equal((b.match(/Conn c\(HTTP_TIMEOUT_MS\);/g) ?? []).length, 1, "un seul Conn par lambda");
      assert.match(b, /c\.client\.stop\(\);|if \(code < 0\) return;/, "la connexion est fermée avant de quitter la pile dédiée");
      // jamais d'imbrication ni de travail non réseau dans la pile dédiée
      assert.doesNotMatch(b, /PodEd::|signED25519|podNetRun|httpCall\(|ackFrame\(|NVIC_SystemReset|EEPROM|display\(|refreshPanel\(/);
    }
    // aucune requête hors lambda : `.request(` n'existe que dans la définition de Conn et dans les lambdas
    const outside = lambdas.reduce((s, b) => s.split(b).join(""), code);
    assert.equal((outside.match(/\.request\(/g) ?? []).length, 0, "une requête est émise hors de la pile dédiée");
    assert.equal((outside.match(/client\.connect\(/g) ?? []).length, 1, "connect() n'existe que dans Conn::request");
    // chaque podNetRun : résultat stocké dans `ran` et exploité
    const runs = [...code.matchAll(/const bool ran = podNetRun\(tx, &ni\);/g)];
    assert.equal(runs.length, conns);
    for (const m of runs) assert.match(code.slice(m.index!, m.index! + 1200), /if \(!ran\)/, "résultat de podNetRun non exploité");
    assert.equal((code.match(/podNetRun\(/g) ?? []).length, conns, "un appel podNetRun par transaction");
    // le vote : la pile réseau est fermée AVANT la signature (jamais imbriquée dans PodEd)
    const v = code.indexOf("static bool doValidateV2"), end = code.indexOf("\n}\n", v), body = code.slice(v, end);
    assert.ok(body.indexOf("netReadCandidate(candidateId, kind, bytes, chk") > 0 && body.indexOf("netReadCandidate(") < body.indexOf("PodEd::sign("), "la lecture du candidat (pile réseau, fonction à part) précède la signature");
    assert.equal(body.includes("podNetRun("), false, "doValidateV2 ne contient plus de transaction : son cadre ne porte que la signature");
  });
}

test("échec fermé aux sites : un échec de pile dédiée ne laisse aucun résultat présenté comme réussi (httpCall -4, image/clip/candidat comme échoués), jamais de vote ni d'ACK", () => {
  for (const sk of SKETCHES) {
    const code = stripLine(read(`arduino_uno_r4/${sk}/${sk}.ino`));
    assert.match(code, /if \(!ran\) \{ logf\("\[HTTP %s\] pile réseau dédiée indisponible[^;]*; return -4; \}/, `${sk} : httpCall`);
    for (const m of code.matchAll(/if \(!ran\) \{([^\n]*)\}\n/g)) {
      const s = m[1];
      // échec fermé : soit on sort (return false / -4), soit les indicateurs de succès sont remis à zéro AVANT le traitement d'échec existant
      const closed = /return (false|-4);/.test(s) || /(got|shown) = false;/.test(s) || /memset\(&chk, 0, sizeof\(chk\)\)/.test(s);
      assert.ok(closed, `${sk} : échec de pile dédiée non fermé : ${s.slice(0, 80)}`);
      assert.match(s, /\(unsigned\)ni\.err, \(unsigned\)ni\.margin/, "l'erreur et la marge sont journalisées");
    }
  }
  // e-ink 2,9″ : retours explicites (pas d'ACK, pas de vote)
  const e = stripLine(read("arduino_uno_r4/pod_uno_r4_eink29/pod_uno_r4_eink29.ino"));
  assert.match(e, /image NON présentée, pas d'ACK", \(unsigned\)ni\.err, \(unsigned\)ni\.margin\); return false; \}/);
});

test("podNetStack.h : aucune variable globale (hors crochets de test), même trampoline de 8 instructions que PodEd (validé sur carte), imbrication refusée AVANT toute allocation, effacement AVANT free(), constantes", () => {
  const raw = read(HDR);
  const prod = stripLine(raw.replace(/#ifdef POD_NET_HOST_TEST[\s\S]*?#endif\n/g, ""));
  assert.doesNotMatch(prod.replace(/#if POD_NET_SWITCH_STACK[\s\S]*?\n#else\n/, ""), /^\s*(static|extern)\s+[\w:<>\s*]+?\s+\w+(\[[^\]]*\])?\s*(=[^=;]*)?;\s*$/m, "variable globale/statique détectée");
  const asm = (s: string) => [.../__asm volatile\(([\s\S]*?)\);\n\}/.exec(s)![1].matchAll(/"([^"\\]*?)\s*(?:\\n)?\s*"/g)].map((m) => m[1].trim().replace(/\s+/g, " ")).filter(Boolean);
  assert.deepEqual(asm(raw), asm(read(EDH)), "le trampoline doit être EXACTEMENT celui de PodEd");
  assert.deepEqual(asm(raw), ["push {r4, r5, lr}", "mov r4, r0", "mov r5, sp", "mov r0, r1", "mov sp, r2", "blx r4", "mov sp, r5", "pop {r4, r5, pc}"]);
  assert.doesNotMatch(raw.slice(raw.indexOf("__asm volatile"), raw.indexOf("#else", raw.indexOf("__asm volatile"))).replace(/\/\/.*$/gm, ""), /\b(msr|mrs|control|psp|isb)\b/i);
  const run = raw.slice(raw.indexOf("static bool run("));
  assert.ok(run.indexOf("podNetOnMainStack()") < run.indexOf("malloc(") && run.indexOf("malloc(") < run.indexOf("podNetCallOnStack(") && run.indexOf("podNetCallOnStack(") < run.indexOf("POD_NET_GUARD_PAINT) { guardOk") + 1000, "imbrication refusée avant malloc, appel avant les contrôles");
  assert.ok(run.indexOf("podNetCallOnStack(") < run.indexOf("wipe(blk") && run.indexOf("wipe(blk") < run.indexOf("free(blk)"), "effacement avant free()");
  assert.match(run, /if \(!blk\) \{ I->err = POD_NET_NOMEM; return false; \}/);
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
    ["effacement", "    podnetimpl::wipe(blk, POD_NET_STACK_TOTAL);   // requêtes et réponses ont transité par cette pile\n", "    if (!blk) podnetimpl::wipe(blk, 1);\n"],
    ["objectif", "I->low = (untouched < POD_NET_MARGIN_GOAL) ? 1 : 0;", "I->low = 0;"],
  ];
  for (const [name, a, b] of mutants) {
    assert.equal(hdr.split(a).length, 2, `mutation « ${name} » : motif introuvable`);
    const r = runProcess(build(`net_mut_${name}`, hdr.split(a).join(b)), []);
    assert.notEqual(r.status, 0, `mutation « ${name} » NON détectée`);
  }
});
