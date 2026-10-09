// LOT8B2B2 NETSTACK-WIFI-CALLS-FIX1 (09/10/2026) — tout appel DIRECT au module Wi-Fi des cinq firmwares UNO R4 s'exécute sur une pile dédiée (podWifiRun, 1 536 o), résultats chez l'appelant, échec fermé.
// Cause matérielle (canari FIX3-R1) : WiFi.macAddress() appelé depuis doRegister détruisait le marqueur de pile (24 o sous __StackLimit).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { compileHarness, describeChoice, findCompiler, runProcess } from "./helpers/cppHarness";

const root = path.resolve(__dirname, "..");
const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8").replace(/\r\n/g, "\n");
const strip = (s: string) => s.replace(/\/\/[^\n]*/g, "");   // commentaires de ligne
const SKETCHES = ["pod_uno_r4_eink29", "pod_uno_r4_eink27", "pod_uno_r4_eink27_oled", "pod_uno_r4_tft18", "pod_uno_r4"];
const ino = (sk: string) => `arduino_uno_r4/${sk}/${sk}.ino`;
const METHODS = ["status", "firmwareVersion", "begin", "macAddress", "RSSI", "localIP"];
const WRAPPERS = ["wifiStatusT", "wifiStatus", "wifiFirmware", "wifiBegin", "wifiMac", "wifiRssi", "wifiIpString"];
const BLOCK_START = "// ─── MODULE Wi-Fi sur PILE DÉDIÉE";
const BLOCK_END = "// ─── Clés Ed25519";

/** Texte entre les accolades correspondantes à partir de l'index de « { ». */
function braced(code: string, open: number): string {
  let depth = 0;
  for (let i = open; i < code.length; i++) { if (code[i] === "{") depth++; else if (code[i] === "}") { depth--; if (depth === 0) return code.slice(open, i + 1); } }
  throw new Error("accolades non appariées");
}

for (const sk of SKETCHES) {
  test(`${sk} : AUCUN appel direct au module Wi-Fi hors des enveloppes sur pile dédiée ; chaque méthode une seule fois ; jamais dans une transaction PodNet`, () => {
    const src = read(ino(sk)), code = strip(src);
    const lines = code.split("\n").filter((l) => /\bWiFi\.[A-Za-z]+\(/.test(l));
    for (const l of lines) assert.match(l, /^\s*auto wx = \[&\]\(\) \{ [^\n]*\};$/, `${sk} : appel direct au module hors d'une enveloppe : ${l.trim()}`);
    const used = lines.map((l) => /WiFi\.([A-Za-z]+)\(/.exec(l)![1]).sort();
    assert.deepEqual(used, [...METHODS].sort(), `${sk} : exactement une enveloppe par méthode du module`);
    // chaque enveloppe appelle podWifiRun sur SA lambda et rien d'autre
    assert.equal((code.match(/podWifiRun\(wx, &ni\)/g) ?? []).length, 6);
    assert.equal((code.match(/\bpodWifiRun\b/g) ?? []).length, 6, "podWifiRun n'est utilisé que par les six enveloppes");
    // aucune enveloppe (ni podWifiRun) à l'intérieur d'une transaction PodNet (lambda « auto tx » lancée par podNetRun) : pas d'imbrication
    for (const m of code.matchAll(/auto tx = \[&\]\(\) \{/g)) {
      const body = braced(code, m.index! + m[0].length - 1);
      assert.doesNotMatch(body, /\bpodWifiRun\b|\bwifi(StatusT|Status|Firmware|Begin|Mac|Rssi|IpString)\s*\(|\bWiFi\.[A-Za-z]+\(/, `${sk} : appel au module imbriqué dans une transaction PodNet`);
    }
    // les enveloppes sont définies AVANT leur premier usage et avant la section des clés
    const iBlock = src.indexOf(BLOCK_START), iKeys = src.indexOf(BLOCK_END);
    assert.ok(iBlock > 0 && iBlock < iKeys, "bloc des enveloppes avant la section des clés");
    for (const w of WRAPPERS) assert.ok(src.indexOf(`${w}(`) >= iBlock, `${sk} : ${w} utilisée avant sa définition`);
    // attribut noinline sur la fonction qui porte PodNetInfo dans sa signature : sinon le générateur de prototypes de l'IDE place le prototype avant le type
    assert.match(code, /static void __attribute__\(\(noinline\)\) wifiFailed\(const char\* what, const PodNetInfo& ni\) \{/);
  });

  test(`${sk} : échec fermé aux sites d'appel — statut inconnu, firmware/IP « ? », MAC vide, clés non générées, aucune inscription`, () => {
    const full = read(ino(sk));
    const code = strip(full);
    const blk = strip(full.slice(full.indexOf(BLOCK_START), full.indexOf(BLOCK_END)));
    // chaque enveloppe : si l'appel a échoué (NOMEM, NESTED, GUARD, MARGIN), AUCUN résultat partiel n'est rendu
    assert.match(blk, /if \(!ran\) \{ wifiFailed\("status", ni\); return POD_WIFI_UNKNOWN; \}\s*return st;/);
    assert.match(blk, /if \(!ran\) \{ wifiFailed\("firmwareVersion", ni\); return String\("\?"\); \}\s*return fw;/);
    assert.match(blk, /if \(!ran\) wifiFailed\("begin", ni\);/);
    assert.match(blk, /if \(!ran\) \{ memset\(m, 0, 6\); wifiFailed\("macAddress", ni\); return false; \}\s*return true;/);
    assert.match(blk, /if \(!ran\) \{ rssi = 0; wifiFailed\("RSSI", ni\); return false; \}\s*rssi = r;\s*return true;/);
    assert.match(blk, /if \(!ran\) \{ wifiFailed\("localIP", ni\); return String\("\?"\); \}\s*return ip;/);
    // la chaîne « a.b.c.d » est formée sur la pile dédiée (IPAddress::toString appelle sniprintf) : jamais sur la pile principale
    assert.match(blk, /static String __attribute__\(\(noinline\)\) wifiIpString\(\) \{\s*String ip; PodNetInfo ni;\s*auto wx = \[&\]\(\) \{ ip = WiFi\.localIP\(\)\.toString\(\); \};/);
    assert.match(blk, /#define POD_WIFI_UNKNOWN 0xFEu/);
    // garde écrasée : voisin du tas corrompu → arrêt sûr silencieux
    assert.match(blk, /if \(ni\.err == POD_NET_GUARD\) logfSafeStop\(\);/);
    // ORDRE (NETSTACK-WIFI-CALLS-FIX2) : sur GUARD, l'arrêt sûr précède TOUT journal — logf alloue au tas, dont le voisin peut être corrompu
    const wf = /static void __attribute__\(\(noinline\)\) wifiFailed\(const char\* what, const PodNetInfo& ni\) \{[\s\S]*?\n\}\n/.exec(blk + "\n")![0];
    assert.ok(wf.indexOf("logfSafeStop();") > 0 && wf.indexOf("logfSafeStop();") < wf.indexOf("logf("), `${sk} : logfSafeStop() doit précéder le premier logf`);
    assert.equal((wf.match(/logf\(/g) ?? []).length, 1, "un seul journal dans wifiFailed, après l'arrêt sûr");
    assert.match(blk, /logf\("\[WIFI\] %s : pile Wi-Fi dédiée : %s \(erreur %u, marge %u o\) — résultat IGNORÉ", what, podNetWhy\(ni\), \(unsigned\)ni\.err, \(unsigned\)ni\.margin\);/);
    // l'état inconnu n'est ni « connecté » ni « module absent » : la boucle de connexion échoue → redémarrage ; le test « module absent » n'est pas déclenché par une panne mémoire
    assert.match(code, /wifiStatusT\("status \(module present \?\)"\) == WL_NO_MODULE/);
    assert.match(code, /while \(wifiStatus\(\) != WL_CONNECTED && tries\+\+ < 4\) \{\s*wifiBegin\(\);\s*for \(int i = 0; i < 20 && wifiStatus\(\) != WL_CONNECTED; i\+\+\) delay\(500\);/);
    assert.match(code, /if \(wifiStatus\(\) != WL_CONNECTED\) \{ logf\("\[WIFI\] échec/);
    // MAC : chaîne vide si le module échoue ; doRegister n'inscrit pas
    assert.match(code, /static String macString\(\) \{\s*uint8_t m\[6\] = \{0\};\s*if \(!wifiMac\(m\)\) return String\(\);/);
    const dr = code.slice(code.indexOf("static bool doRegister()"));
    const iMac = dr.indexOf("const String mac = macString();"), iChk = dr.indexOf("if (mac.length() == 0) { logf(\"[REGISTER] adresse MAC indisponible"), iHttp = dr.indexOf("httpCall(\"POST\", \"/api/register\"");
    assert.ok(iMac >= 0 && iMac < iChk && iChk < iHttp, "doRegister : la MAC vide est refusée AVANT toute requête d'inscription");
    assert.match(dr.slice(iChk, iChk + 200), /inscription ANNULÉE"\); return false; \}/);
    // clés : entropie par le module ; échec → génération annulée, AUCUNE clé enregistrée
    const ge = code.slice(code.indexOf("static bool gatherEntropy(uint8_t out[32]) {"), code.indexOf("static void generateKeys()"));
    assert.match(ge, /if \(!wifiMac\(mac\) \|\| !wifiRssi\(rssi\)\) \{ memset\(out, 0, 32\); return false; \}/);
    assert.match(ge, /h\.finalize\(out, 32\);\s*return true;/);
    const gk = code.slice(code.indexOf("static void generateKeys()"));
    const iEnt = gk.indexOf("if (!gatherEntropy(privateKey)) {"), iDer = gk.indexOf("PodEd::derivePublicKey"), iSave = gk.indexOf("saveKeysToEEPROM();");
    assert.ok(iEnt > 0 && iEnt < iDer && iDer < iSave, "entropie contrôlée avant la dérivation et l'enregistrement");
    assert.match(gk.slice(iEnt, iEnt + 220), /memset\(privateKey, 0, 32\); return; \}/);
  });

  test(`${sk} : l'adresse MAC est encodée par un hexadécimal manuel borné dans char[18] — plus de snprintf pour la MAC`, () => {
    const code = strip(read(ino(sk)));
    assert.match(code, /static char macHexDigit\(uint8_t v\) \{ return \(char\)\(v < 10 \? '0' \+ v : 'a' \+ \(v - 10\)\); \}/);
    const fn = /static String macString\(\) \{[\s\S]*?\n\}\n/.exec(code)![0];
    assert.doesNotMatch(fn, /snprintf|sprintf|WiFi\./);
    assert.match(fn, /char b\[18\];/);
    assert.match(fn, /for \(uint8_t i = 0; i < 6; i\+\+\) \{ b\[3 \* i\] = macHexDigit\(m\[i\] >> 4\); b\[3 \* i \+ 1\] = macHexDigit\(m\[i\] & 15\); b\[3 \* i \+ 2\] = \(i < 5\) \? ':' : '\\0'; \}/);
  });
}

test("podNetStack.h : pile du module Wi-Fi — 1 536 o, garde 64 o, marge 128 o minimale / 256 o visée, taille justifiée par l'ELF (static_assert), copies identiques dans les cinq dossiers", () => {
  const h = read("consensus-pod/src/adapters/podNetStack.h");
  assert.match(h, /#define POD_WIFI_STACK_TOTAL 1536u/);
  assert.match(h, /#define POD_WIFI_DEEPEST_CALL 664u/);
  assert.match(h, /static_assert\(POD_WIFI_STACK_TOTAL >= POD_NET_GUARD_BYTES \+ POD_WIFI_DEEPEST_CALL \+ 32u \+ 104u \+ POD_NET_MARGIN_GOAL, /);
  assert.match(h, /template <typename F> static bool podWifiRun\(F& f, PodNetInfo\* info = nullptr\) \{\s*const bool ok = PodNet::runSized\(\[\]\(void\* p\) \{ \(\*static_cast<F\*>\(p\)\)\(\); \}, &f, POD_WIFI_STACK_TOTAL, info\);/);
  for (const sk of SKETCHES) assert.equal(fs.readFileSync(path.join(root, `arduino_uno_r4/${sk}/podNetStack.h`)).compare(fs.readFileSync(path.join(root, "consensus-pod/src/adapters/podNetStack.h"))), 0, `${sk}/podNetStack.h diverge`);
});

// ── Exécution hôte du code RÉEL des enveloppes ────────────────────────────────────────────────────────────
const choice = findCompiler();
console.log(`[wifiCalls] ${describeChoice(choice)}`);
const skip = choice.path ? false : `${describeChoice(choice)} — exécution hôte des enveloppes IGNORÉE`;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "wificalls-"));
const exe = path.join(tmp, process.platform === "win32" ? "wifi_calls_harness.exe" : "wifi_calls_harness");

function extractWifi(sk: string): string {
  const src = read(ino(sk));
  const blk = src.slice(src.indexOf(BLOCK_START), src.indexOf(BLOCK_END));
  const helper = /static char macHexDigit\(uint8_t v\) \{[^\n]*\n/.exec(src)![0];
  const mac = /static String macString\(\) \{[\s\S]*?\n\}\n/.exec(src)![0];
  return `${blk}\n${helper}${mac}\n`;
}
function build(sk: string, mutate: (s: string) => string = (s) => s): string {
  const dir = fs.mkdtempSync(path.join(tmp, "b-"));
  fs.writeFileSync(path.join(dir, "wifi_extract.inc"), mutate(extractWifi(sk)));
  const out = path.join(dir, path.basename(exe));
  compileHarness(choice.path!, path.join(root, "consensus-pod", "host", "wifi_calls_harness.cpp"), out, [`-I${dir}`]);
  return out;
}

for (const sk of SKETCHES) {
  test(`${sk} : EXÉCUTION HÔTE du code réel des enveloppes — pile de 1 536 o, résultats chez l'appelant, NOMEM/NESTED/MARGIN/GUARD = échec fermé, MAC hexadécimale == %02x pour 256 motifs`, { skip }, () => {
    const r = runProcess(build(sk), []);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout.trim(), /^PASS \d+$/);
  });
}

test("CONTRÔLES NÉGATIFS : une enveloppe qui rend un résultat malgré l'échec, sans pile dédiée, sans arrêt sûr sur GUARD, ou une MAC mal encodée est REFUSÉE par le harnais hôte", { skip }, () => {
  const sk = "pod_uno_r4_eink27";
  const mutants: Array<[string, string, string]> = [
    ["statut rendu malgré l'échec", 'if (!ran) { wifiFailed("status", ni); return POD_WIFI_UNKNOWN; }', 'if (!ran) { wifiFailed("status", ni); } '],
    ["MAC rendue malgré MARGIN", 'if (!ran) { memset(m, 0, 6); wifiFailed("macAddress", ni); return false; }', 'if (!ran && false) { memset(m, 0, 6); wifiFailed("macAddress", ni); return false; }'],
    ["RSSI conservé malgré l'échec", 'if (!ran) { rssi = 0; wifiFailed("RSSI", ni); return false; }', 'if (!ran) { wifiFailed("RSSI", ni); return false; }'],
    ["firmware rendu malgré l'échec", 'if (!ran) { wifiFailed("firmwareVersion", ni); return String("?"); }', 'if (!ran) { wifiFailed("firmwareVersion", ni); }'],
    ["IP rendue malgré l'échec", 'if (!ran) { wifiFailed("localIP", ni); return String("?"); }', 'if (!ran) { wifiFailed("localIP", ni); } '],
    ["pas d'arrêt sûr sur GUARD", "if (ni.err == POD_NET_GUARD) logfSafeStop();", ""],
    ["journal AVANT l'arrêt sûr sur GUARD (régression FIX2)", "if (ni.err == POD_NET_GUARD) logfSafeStop();", 'logf("avant l arret"); if (ni.err == POD_NET_GUARD) logfSafeStop();'],
    ["macString non vide en cas d'échec", "if (!wifiMac(m)) return String();", "wifiMac(m);"],
    ["MAC : chiffres majuscules", "'a' + (v - 10)", "'A' + (v - 10)"],
    ["MAC : quartet haut/bas permutés", "macHexDigit(m[i] >> 4); b[3 * i + 1] = macHexDigit(m[i] & 15)", "macHexDigit(m[i] & 15); b[3 * i + 1] = macHexDigit(m[i] >> 4)"],
    ["appel au module hors pile dédiée (sans podWifiRun)", "const bool ran = podWifiRun(wx, &ni);\n  if (!ran) { memset(m, 0, 6);", "wx(); const bool ran = true;\n  if (!ran) { memset(m, 0, 6);"],
  ];
  for (const [name, a, b] of mutants) {
    const base = extractWifi(sk);
    assert.ok(base.split(a).length >= 2, `mutation « ${name} » : motif introuvable`);
    const r = runProcess(build(sk, (s) => s.split(a).join(b)), [], 20000);
    const bad = r.status !== 0 || !/^PASS \d+$/.test(r.stdout.trim());
    assert.ok(bad, `mutation « ${name} » NON détectée`);
  }
});
