import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { compileHarness, describeChoice, findCompiler, runProcess } from "./helpers/cppHarness";
import { ED_EDITS, ED_SKETCHES, editsFor, undoEdStack } from "./helpers/edStackEdits";
import { undoNetStack } from "./helpers/netStackEdits";
import { verifyEd25519 } from "../lib/ed25519";
import { voteMessageV2 } from "../lib/podVote";

// LOT8B2B2-CANARY-R4-STACK-FIX1 — Ed25519 sur UNO R4 : pile dédiée (consensus-pod/src/adapters/podEdStack.h).
// Hôte uniquement pour le calcul ; la bascule réelle de pile Thumb et la profondeur sur Cortex-M4 NE PEUVENT PAS être prouvées ici (micro-canari matériel : docs/LOT_8B2B2_PILE_ED25519_R4_2026_10_08.md).
// Sans g++ ou sans la bibliothèque Crypto 0.4.0 installée, la partie différentielle est IGNORÉE et le dit (jamais faussement verte).
const root = path.join(__dirname, "..");
const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8").replace(/\r\n/g, "\n");
const HDR = "consensus-pod/src/adapters/podEdStack.h";
const BACKUP = "firmware-backups/2026-10-08_avant-correctif-pile-ed25519-r4";
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

// ── 1. le correctif ne change RIEN d'autre dans les cinq firmwares ─────────────────────────────────────────────
for (const sk of ED_SKETCHES) {
  test(`${sk} : en annulant les modifications EXACTES de la table (tests/helpers/edStackEdits.ts), on retrouve le sketch d'avant le correctif au texte près`, () => {
    const now = read(`arduino_uno_r4/${sk}/${sk}.ino`), before = read(`${BACKUP}/${sk}/${sk}.ino`);
    // l'instrument de canari (blocs « POD_RENDER_V1 && POD_CANARY », absents du chemin désactivé) a évolué depuis (BOOT-FIX2) : il est exclu de la comparaison, comme dans la vue « POD_RENDER_V1 = 0 »
    const noCanary = (s: string) => s.replace(/#if POD_RENDER_V1 && POD_CANARY\n[\s\S]*?\n#endif\n/g, "");
    assert.equal(noCanary(undoEdStack(undoNetStack(now, sk), sk)), noCanary(before));   // NETSTACK-FIX1 (transactions réseau) annulé d'abord, puis PodEd
    for (const e of editsFor(sk)) assert.equal(now.split(e.neu).length - 1, 1, `${sk} : « ${e.id} » doit apparaître une seule fois`);
  });

  test(`${sk} : plus AUCUN appel direct Ed25519::sign/verify/derivePublicKey (tout passe par PodEd), chaque appel contrôle son résultat, défauts POD_RENDER_V1/POD_CANARY inchangés`, () => {
    const src = read(`arduino_uno_r4/${sk}/${sk}.ino`), code = stripComments(src);
    assert.doesNotMatch(code, /Ed25519::(sign|verify|derivePublicKey|generatePrivateKey)/);
    assert.match(src, /#include <Ed25519\.h>\n#include "podEdStack\.h"/);
    const calls = [...code.matchAll(/PodEd::(sign|verify|derivePublicKey)\(/g)];
    assert.ok(calls.length >= 6, `${sk} : appels PodEd attendus >= 6, trouvés ${calls.length}`);
    // un appel dont le résultat serait ignoré est interdit : chaque PodEd:: est précédé de « if (! », « = » ou « && »
    for (const m of code.matchAll(/(.{0,28})PodEd::(sign|verify|derivePublicKey)\(/g)) assert.match(m[1], /(if \(!|else if \(!|const bool \w+ = |signedOk && )$/, `résultat ignoré : ${m[0]}`);
    assert.match(src, /\[ED25519\] pile dédiée/);
    if (sk !== "pod_uno_r4") { assert.match(src, /#define POD_RENDER_V1 0\b/); assert.doesNotMatch(src, /#define POD_(RENDER_V1|CANARY) 1\b/); }
    if (sk === "pod_uno_r4_eink29") assert.match(src, /#define POD_CANARY 0\b/);
    assert.equal(fs.readFileSync(path.join(root, `arduino_uno_r4/${sk}/podEdStack.h`)).compare(fs.readFileSync(path.join(root, HDR))), 0, "copie divergente de l'original");
  });
}

test("table des modifications : chaque modification est unique, signale l'échec fermé, n'écrit jamais d'EEPROM sur échec, et un vote impossible n'est JAMAIS envoyé", () => {
  const ids = ED_EDITS.map((e) => e.id); assert.equal(new Set(ids).size, ids.length);
  const gen = ED_EDITS.find((e) => e.id === "generateKeys")!.neu;
  assert.ok(gen.indexOf("return;") > 0 && gen.indexOf("return;") < gen.indexOf("keysLoaded = true"), "génération annulée AVANT keysLoaded/saveKeysToEEPROM");
  assert.match(gen, /memset\(privateKey, 0, 32\)/);
  const load = ED_EDITS.find((e) => e.id === "loadKeys")!.neu;
  assert.match(load, /clé publique de l'EEPROM conservée/);
  assert.doesNotMatch(load.split("else if")[0], /EEPROM\.update/, "un échec de dérivation ne doit RIEN écrire en EEPROM");
  assert.match(ED_EDITS.find((e) => e.id === "signV2")!.neu, /vote NON envoyé"\); return false; \}/);
  assert.match(ED_EDITS.find((e) => e.id === "signV1")!.neu, /return String\(\); \}/);
  assert.match(ED_EDITS.find((e) => e.id === "callV1")!.neu, /signature\.length\(\) == 0\) \{ pendingCandidateId = ""; return false; \}/);
});

// ── 2. contraintes du fichier podEdStack.h ────────────────────────────────────────────────────────────────────
test("podEdStack.h : aucune variable globale (hors crochets de test hôte), trampoline Thumb de 8 instructions (SP déplacé sur la pile dédiée puis rétabli, sans CONTROL ni PSP), effacement AVANT free(), échec fermé", () => {
  const raw = read(HDR);
  const prod = stripComments(raw.replace(/#ifdef POD_ED_HOST_TEST[\s\S]*?#endif\n/g, ""));
  // aucune déclaration de variable au niveau fichier ou espace de noms (la R4 e-ink 2,9″ n'a que 528 o de marge statique)
  assert.doesNotMatch(prod, /^\s*(static|extern)\s+[\w:<>\s*]+?\s+\w+(\[[^\]]*\])?\s*(=[^=;]*)?;\s*$/m, "variable globale/statique détectée");
  assert.doesNotMatch(prod, /\bstatic\s+\w+\s+\w+\s*(\[[^\]]*\])?\s*=/, "variable statique locale détectée");
  const asm = /__asm volatile\(([\s\S]*?)\);\n\}/.exec(raw)![1];
  const ins = [...asm.matchAll(/"([^"\\]*?)\s*(?:\\n)?\s*"/g)].map((m) => m[1].trim().replace(/\s+/g, " ")).filter(Boolean);
  const idx = (s: string, from = 0) => { const i = ins.findIndex((x, k) => k >= from && x.startsWith(s)); assert.ok(i >= 0, `instruction « ${s} » absente`); return i; };
  assert.match(raw, /__attribute__\(\(naked, noinline, used\)\)/);
  // trampoline : exactement ces 8 instructions, dans cet ordre (sauvegarde, fn → r4, ancien SP → r5, arg → r0, SP := sommet de la pile dédiée, appel, SP := ancien SP, retour)
  assert.deepEqual(ins, ["push {r4, r5, lr}", "mov r4, r0", "mov r5, sp", "mov r0, r1", "mov sp, r2", "blx r4", "mov sp, r5", "pop {r4, r5, pc}"]);
  const call = idx("blx r4"), setSp = idx("mov sp, r2"), restore = idx("mov sp, r5");
  assert.ok(setSp < call && call < restore, "ordre : SP dédié → appel → SP d'origine");
  assert.doesNotMatch(asm, /\b(msr|mrs|control|psp|isb)\b/i, "aucune manipulation de CONTROL / PSP : le fil principal reste sur MSP");
  // l'ordre dans execute() : appel, contrôle garde/marge, effacement, puis free
  const ex = raw.slice(raw.indexOf("static bool execute"));
  assert.ok(ex.indexOf("podEdCallOnStack(") < ex.indexOf("POD_ED_GUARD;") && ex.indexOf("POD_ED_GUARD;") < ex.indexOf("wipe(blk") && ex.indexOf("wipe(blk") < ex.indexOf("free(blk)"), "effacement avant free(), contrôles après l'appel");
  assert.match(ex, /if \(!blk\) \{ I->err = POD_ED_NOMEM; return false; \}/);
  assert.match(raw, /memset\(pub, 0, 32\); return false;/); assert.match(raw, /memset\(sig, 0, 64\); return false;/);
  assert.match(raw, /return podedimpl::execute\(&j, info\) && j\.ok;/);
  // constantes : 2 304 o au total, garde 64 o, marge minimale 128 o
  assert.match(raw, /#define POD_ED_STACK_TOTAL 2304u/); assert.match(raw, /#define POD_ED_GUARD_BYTES 64u/); assert.match(raw, /#define POD_ED_MARGIN_MIN 128u/);
  assert.match(raw, /#error "podEdStack\.h : trampoline écrit pour Cortex-M4/);
  // la bibliothèque Crypto n'est PAS modifiée : aucun fichier de la bibliothèque dans le dépôt, aucune copie locale
  assert.equal(fs.existsSync(path.join(root, "arduino_uno_r4", "pod_uno_r4_eink29", "Ed25519.cpp")), false);
});

test("scripts/stack-callgraph.js : frames (push, stmdb, sub sp, vpush), appels directs, appels terminaux (b.w), appels indirects comptés, pire chemin et cadre propre", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { parse, deepest, countIndirect } = require("../scripts/stack-callgraph.js");
  const dis = [
    "0000a000 <leaf>:", "    a000:\tpush\t{r4, lr}", "    a002:\tsub\tsp, #8", "    a004:\tpop\t{r4, pc}", "",
    "0000a010 <mid>:", "    a010:\tstmdb\tsp!, {r4, r5, r6, lr}", "    a014:\tsub\tsp, #100\t; 0x64", "    a016:\tbl\ta000 <leaf>", "    a01a:\tblx\tr3", "    a01c:\tpop\t{r4, r5, r6, pc}", "",
    "0000a020 <tail>:", "    a020:\tpush\t{r4, r5, r6, r7, r8, lr}", "    a024:\tsub\tsp, #200", "    a026:\tb.w\ta000 <leaf>", "",
    "0000a030 <top>:", "    a030:\tvpush\t{d8, d9}", "    a034:\tpush\t{lr}", "    a036:\tbl\ta010 <mid>", "    a03a:\tb.w\ta020 <tail>", "",
    "0000a040 <loopy>:", "    a040:\tpush\t{lr}", "    a042:\tbl\ta040 <loopy>", "",
  ].join("\r\n");   // CRLF volontaire : objdump sous Windows
  const f = parse(dis);
  assert.equal(f.get("leaf").frame, 8 + 8); assert.equal(f.get("mid").frame, 16 + 100); assert.equal(f.get("tail").frame, 24 + 200); assert.equal(f.get("top").frame, 16 + 4);
  assert.equal(f.get("mid").indirect, 1); assert.equal(countIndirect(f, "top"), 1);
  // top → mid(116) → leaf(16) = 20 + 116 + 16 = 152 ; top → (terminal) tail : le cadre de top (20) a disparu... mais tail(224) + leaf terminal(16) = 224 → 224 est plus profond
  const d = deepest(f, "top");
  assert.equal(d.depth, Math.max(20 + 116 + 16, 224));
  assert.equal(deepest(f, "mid").depth, 116 + 16);
  assert.equal(deepest(f, "loopy").depth, 4, "récursion : signalée, non bouclante");
});

// ── 3. différentiel hôte avec la VRAIE bibliothèque Crypto 0.4.0 ───────────────────────────────────────────────
const choice = findCompiler();
console.log(`[edStack] ${describeChoice(choice)}`);
const cryptoCandidates = [process.env.POD_CRYPTO_SRC, path.join(os.homedir(), "Documents", "Arduino", "libraries", "Crypto", "src"), path.join(os.homedir(), "Arduino", "libraries", "Crypto", "src")].filter((c): c is string => Boolean(c));
const cryptoSrc = cryptoCandidates.find((c) => fs.existsSync(path.join(c, "Ed25519.cpp")));
const skip = !choice.path ? "aucun compilateur C++" : !cryptoSrc ? "bibliothèque Crypto 0.4.0 introuvable (POD_CRYPTO_SRC ou ~/Documents/Arduino/libraries/Crypto/src)" : false;
if (skip) console.log(`[edStack] différentiel hôte IGNORÉ : ${skip}`);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "edstack-"));
const exe = (n: string) => path.join(tmp, process.platform === "win32" ? `${n}.exe` : n);
const PKCS8 = Buffer.from("302e020100300506032b657004220420", "hex");

function makeVectors(): string {
  const out: string[] = [];
  const one = (seed: Buffer, msg: Buffer) => {
    const priv = crypto.createPrivateKey({ key: Buffer.concat([PKCS8, seed]), format: "der", type: "pkcs8" });
    const pub = crypto.createPublicKey(priv).export({ format: "der", type: "spki" }).subarray(-32);
    out.push(`vec ${seed.toString("hex")} ${pub.toString("hex")} ${msg.length ? msg.toString("hex") : "-"} ${crypto.sign(null, msg, priv).toString("hex")}`);
  };
  // RFC 8032 § 7.1 (tests 1 à 3)
  for (const [s, m] of [["9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60", ""], ["4ccd089b28ff96da9db6c346ec114e0f5b8a319f35aba624da8cf6ed4fb8a6fb", "72"], ["c5aa8df43f9f837bedb7442f31dcb7b166d38535076f094b85ce3a2e0b4458f7", "af82"]]) one(Buffer.from(s, "hex"), Buffer.from(m, "hex"));
  let x = 12345; const rnd = () => (x = (x * 1103515245 + 12345) & 0x7fffffff);
  for (const len of [0, 1, 31, 32, 63, 64, 65, 111, 112, 127, 128, 129, 160, 200, 255, 256, 300]) {   // frontières de bloc SHA-512 + messages de la taille d'un vote
    const seed = Buffer.alloc(32); for (let i = 0; i < 32; i++) seed[i] = rnd() >> 8;
    const msg = Buffer.alloc(len); for (let i = 0; i < len; i++) msg[i] = rnd() >> 8;
    one(seed, msg);
  }
  // un vrai message de vote v2 (forme de podVoteMessage) signé par une clé fixe
  one(Buffer.alloc(32, 7), Buffer.from("dev-1:cand-42:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef:1234:567:89:accept"));
  const f = path.join(tmp, "vectors.txt"); fs.writeFileSync(f, out.join("\n") + "\n"); return f;
}
let libObjs: string[] | null = null;
function ensureLib(): string[] {
  if (libObjs) return libObjs;
  libObjs = [];
  for (const n of ["Ed25519", "Curve25519", "BigNumberUtil", "SHA512", "Hash", "Crypto"]) {
    const o = path.join(tmp, `${n}.o`);
    const r = runProcess(choice.path!, ["-std=c++11", "-O2", "-w", "-c", `-I${cryptoSrc}`, path.join(cryptoSrc!, `${n}.cpp`), "-o", o]);
    assert.equal(r.status, 0, `compilation de la bibliothèque Crypto (${n}) : ${r.stderr}`);
    libObjs.push(o);
  }
  return libObjs;
}
function buildHarness(name: string, hdr: string): string {
  const dir = path.join(tmp, name); fs.mkdirSync(path.join(dir, "host"), { recursive: true }); fs.mkdirSync(path.join(dir, "src", "adapters"), { recursive: true });
  fs.writeFileSync(path.join(dir, "src", "adapters", "podEdStack.h"), hdr);
  fs.copyFileSync(path.join(root, "consensus-pod", "host", "ed_stack_harness.cpp"), path.join(dir, "host", "ed_stack_harness.cpp"));
  const e = exe(name);
  compileHarness(choice.path!, path.join(dir, "host", "ed_stack_harness.cpp"), e, [`-I${cryptoSrc}`, ...ensureLib()]);
  return e;
}
const run = (e: string, vec: string) => runProcess(e, [vec]);

test("DIFFÉRENTIEL HÔTE : dérivation, signature et vérification via PodEd == Node/OpenSSL et RFC 8032, octet par octet (21 vecteurs, frontières de bloc SHA-512, message de vote) ; falsifications rejetées ; 4 cycles sans dérive du tas ; effacement avant free() ; échec fermé (garde, marge, malloc)", { skip }, () => {
  const e = buildHarness("ed_stack_ok", read(HDR));
  const r = run(e, makeVectors());
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout.trim(), /^PASS \d+$/);
  assert.ok(Number(r.stdout.trim().split(" ")[1]) >= 300, r.stdout);
});

test("CONTRÔLES NÉGATIFS DU CODE : sans le contrôle de garde, sans le contrôle de marge, sans remise à zéro de la sortie, sans effacement, ou avec un malloc non vérifié, le harnais REFUSE le wrapper", { skip }, () => {
  const hdr = read(HDR);
  const mutants: Array<[string, string, string]> = [
    ["garde", "if (!guardOk) { I->err = POD_ED_GUARD; good = false; }", "if (!guardOk && false) { I->err = POD_ED_GUARD; good = false; }"],
    ["marge", "else if (untouched < POD_ED_MARGIN_MIN) { I->err = POD_ED_MARGIN; good = false; }", "else if (untouched < POD_ED_MARGIN_MIN && false) { I->err = POD_ED_MARGIN; good = false; }"],
    ["sortie", "memset(sig, 0, 64); return false;", "return false;"],
    ["effacement", "    wipe(blk, POD_ED_STACK_TOTAL);   // la pile dédiée a porté des résidus de la clé privée\n", "    if (!blk) wipe(blk, 1);\n"],
    ["malloc", "if (!blk) { I->err = POD_ED_NOMEM; return false; }", "if (!blk) { I->err = POD_ED_OK; return true; }"],
  ];
  const vec = makeVectors();
  for (const [name, a, b] of mutants) {
    assert.equal(hdr.split(a).length, 2, `mutation « ${name} » : motif introuvable`);
    const e = buildHarness(`ed_stack_mut_${name}`, hdr.split(a).join(b));
    const r = run(e, vec);
    assert.notEqual(r.status, 0, `mutation « ${name} » NON détectée par le harnais`);
  }
});

test("SIGNATURE RÉELLE D'UN VOTE par PodEd (hôte) VÉRIFIÉE par la référence du serveur (lib/ed25519.ts, celle de /api/validation-result) : vote v1 « deviceId:candidateId:score », vote v2 « pod-vote-v2|… » accept et reject ; message ou clé altérés refusés", { skip }, () => {
  const e = buildHarness("ed_stack_vote", read(HDR));
  const seed = crypto.createHash("sha256").update("clé de test du correctif de pile").digest("hex");   // clé de TEST, sans lien avec une clé réelle
  const hx = (s: string) => Buffer.from(s, "utf8").toString("hex");
  const rawHash = crypto.createHash("sha256").update("contenu-candidat").digest("hex");
  const messages = [
    "esp-r4-7f3a:cand-42:0.543",
    voteMessageV2({ deviceId: "esp-r4-7f3a", candidateId: "cand-42", rawHash, e: 612345, t: 98765, r: 400000, verdict: "accept" }),
    voteMessageV2({ deviceId: "esp-r4-7f3a", candidateId: "cand-43", rawHash, e: 0, t: 0, r: 1000000, verdict: "reject" }),
  ];
  for (const m of messages) {
    const r = runProcess(e, ["--sign", seed, hx(m)]);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const [, pub, sig] = /^pub=([0-9a-f]{64}) sig=([0-9a-f]{128})$/.exec(r.stdout.trim())!;
    assert.equal(verifyEd25519(pub, m, sig), true, `le serveur refuse la signature de « ${m.slice(0, 40)}… »`);
    assert.equal(verifyEd25519(pub, m + "x", sig), false, "message altéré accepté");
    assert.equal(verifyEd25519(pub.replace(/^./, (c) => (c === "0" ? "1" : "0")), m, sig), false, "clé altérée acceptée");
    // même octets que Node (Ed25519 est déterministe)
    const priv = crypto.createPrivateKey({ key: Buffer.concat([PKCS8, Buffer.from(seed, "hex")]), format: "der", type: "pkcs8" });
    assert.equal(crypto.sign(null, Buffer.from(m, "utf8"), priv).toString("hex"), sig);
  }
});
