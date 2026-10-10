// PULLFRAME-PHASE-AUDIT1 (10/10/2026) — marques de phase du canari autour de doFetchFrame (e-ink 2,9″ seulement), production inchangée.
// Contexte matériel (canari 7df39b6) : « [PULL] nouvelle frame 6429e8f5… (personal) » puis plus rien : aucun « [HTTP GET] /api/pull-frame », aucun « [FRAME] », aucun ACK. Les 15 points ci-dessous permettent de LOCALISER le dernier point atteint.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "..");
const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8").replace(/\r\n/g, "\n");
const INO = "arduino_uno_r4/pod_uno_r4_eink29/pod_uno_r4_eink29.ino";
const OTHERS = ["pod_uno_r4_eink27", "pod_uno_r4_eink27_oled", "pod_uno_r4_tft18", "pod_uno_r4"];
const noCanary = (s: string) => s.replace(/#if POD_RENDER_V1 && POD_CANARY\n[\s\S]*?\n#endif\n/g, "");

const MACRO = '#define POD_FF_MARK(n, txt) do { if (g_podFfPhase != 0) podFfSay((n), txt); } while (0)';
const SAY = 'static void __attribute__((noinline)) podFfSay(uint8_t n, const char* txt) {\n  g_podFfPhase = n;\n  const unsigned long t0 = millis();\n  for (uint32_t i = 0; i < 400000UL && Serial.availableForWrite() < 120 && millis() - t0 < 200UL; i++) { }\n  if (Serial.availableForWrite() < 120) { if (g_podFfDrop < 255) g_podFfDrop++; return; }\n  logf("[CANARY] FF %u : %s | marqueur %s | perdues=%u | t=%lu ms", (unsigned)n, txt, (*(volatile uint32_t*)&__StackLimit == 0x434E5259UL && *((volatile uint32_t*)&__StackLimit + 1) == g_podPaintLen) ? "OK" : "DETRUIT", (unsigned)g_podFfDrop, (unsigned long)millis());\n}';

/** Corps (accolades équilibrées, hors littéraux) de la fonction/structure dont la tête contient `head`. */
function body(src: string, head: string): string {
  const i = src.indexOf(head);
  if (i < 0) return "";
  let j = src.indexOf("{", i + head.length - 1), depth = 0;
  const start = j;
  for (; j < src.length; j++) {
    const c = src[j];
    if (c === '"') { j++; while (j < src.length && src[j] !== '"') { if (src[j] === "\\") j++; j++; } }
    else if (c === "'") { j++; while (j < src.length && src[j] !== "'") { if (src[j] === "\\") j++; j++; } }
    else if (c === "{") depth++;
    else if (c === "}") { depth--; if (depth === 0) return src.slice(start, j + 1); }
  }
  return "";
}
/** Position de la marque n dans `s` (POD_FF_MARK(n, … ou POD_FF_START pour 1). */
const at = (s: string, n: number): number => (n === 1 ? s.indexOf("POD_FF_START(") : s.indexOf(`POD_FF_MARK(${n}, `));

/** Violations des règles de traçage (liste vide = conforme). */
export function pullFrameViolations(src: string): string[] {
  const v: string[] = [];
  // 1. le bloc : statique unique, macros exactes, avant Conn, sous garde
  const iStatic = src.indexOf("static volatile uint8_t g_podFfPhase = 0;");
  const iConn = src.indexOf("struct Conn {");
  if (iStatic < 0 || iConn < 0 || iStatic > iConn) v.push("g_podFfPhase doit être défini avant struct Conn");
  if ((src.match(/g_podFfPhase = 0;\n/g) ?? []).length < 1 || (src.match(/^static volatile uint8_t g_podFfPhase = 0;$/gm) ?? []).length !== 1) v.push("exactement un statique g_podFfPhase");
  if (!src.includes(MACRO + "\n")) v.push("macro POD_FF_MARK : texte exact attendu (garde g_podFfPhase != 0, appel de podFfSay seulement)");
  if (!src.includes(SAY + "\n")) v.push("podFfSay : texte exact attendu (attente BORNÉE du tampon USB, ligne perdue et comptée sinon, marqueur + longueur exacts, logf seulement)");
  if ((src.match(/^static volatile uint8_t g_podFfDrop = 0;$/gm) ?? []).length !== 1) v.push("exactement un statique g_podFfDrop");
  if (!src.includes("#define POD_FF_START(txt) do { g_podFfPhase = 1; POD_FF_MARK(1, txt); } while (0)\n#define POD_FF_STOP() do { g_podFfPhase = 0; } while (0)\n")) v.push("POD_FF_START / POD_FF_STOP : texte exact attendu");
  const blk = /#if POD_RENDER_V1 && POD_CANARY\n\/\/ PULLFRAME-PHASE-AUDIT1[\s\S]*?\n#endif\n/.exec(src);
  if (!blk) v.push("bloc PULLFRAME-PHASE-AUDIT1 introuvable");
  else if (/Serial\.(print|println|write)|malloc|new |String|mallinfo|delay|httpCall|WiFi/.test(blk[0].replace(/\/\/.*$/gm, ""))) v.push("le bloc des marques ne doit contenir ni E/S directe, ni allocation, ni String, ni réseau");
  // 2. chaque marque est dans un bloc de canari ne contenant QUE la marque (10 : la lecture des en-têtes ; 15 : l'arrêt)
  for (let n = 1; n <= 15; n++) {
    const count = n === 1 ? (src.match(/POD_FF_START\("/g) ?? []).length : (src.match(new RegExp(`POD_FF_MARK\\(${n}, "`, "g")) ?? []).length;
    if (count !== 1) { v.push(`marque ${n} : ${count} occurrence(s) au lieu d'une`); continue; }
    const re = n === 1 ? /#if POD_RENDER_V1 && POD_CANARY\n  POD_FF_START\("[^"\n]*"\);\n#endif\n/
      : n === 10 ? /#if POD_RENDER_V1 && POD_CANARY\n    \{ const int rcHdr = rd\.readHeaders\(\); POD_FF_MARK\(10, "[^"\n]*"\); return rcHdr; \}\n#endif\n/
      : n === 15 ? /#if POD_RENDER_V1 && POD_CANARY\n  POD_FF_MARK\(15, "[^"\n]*"\); POD_FF_STOP\(\);\n#endif\n/
      : new RegExp(`#if POD_RENDER_V1 && POD_CANARY\\n\\s+POD_FF_MARK\\(${n}, "[^"\\n]*"\\);\\n#endif\\n`);
    if (!re.test(src)) v.push(`marque ${n} : doit être seule dans son bloc de canari`);
  }
  if ((src.match(/POD_FF_STOP\(\);/g) ?? []).length !== 1) v.push("POD_FF_STOP exactement une fois, juste après la marque 15");
  // 3. ordre dans chaque fonction
  const req = body(src, "int request(const char* method");
  const order = (name: string, s: string, seq: Array<number | string>): void => {
    let last = -1;
    for (const e of seq) {
      const p = typeof e === "number" ? at(s, e) : s.indexOf(e);
      if (p < 0) { v.push(`${name} : « ${e} » introuvable`); return; }
      if (p < last) { v.push(`${name} : « ${e} » hors d'ordre`); return; }
      last = p;
    }
  };
  order("Conn::request", req, [6, "client.connect(SERVER_HOST, 443)", 7, 8, "client.print(req);", 9, "rd.readHeaders(); POD_FF_MARK(10"]);
  const fetch = body(src, "static bool doFetchFrame(const String& frameId");
  order("doFetchFrame", fetch, [2, "auto tx = [&]() {", 4, "Conn c(HTTP_TIMEOUT_MS);", 5, 'c.request("GET"', "c.rd.readBody(blackBuf", 11, "c.rd.readBody(redBuf", 12, 13, "c.client.stop();", 14, "};", 3, "podNetRun(tx, &ni)", 15, 'podCanaryNet("pull-frame"']);
  const pull = body(src, "static bool doPull() {");
  order("doPull", pull, [1, "doFetchFrame(newFrameId, newFrameSource);"]);
  // 4. production : rien
  const prod = noCanary(src);
  if (/POD_FF|g_podFf/.test(prod)) v.push("des marques existent HORS des blocs de canari");
  return v;
}

test("PULLFRAME-PHASE-AUDIT1 : quinze marques de phase du canari, chacune seule dans son bloc gardé, dans l'ordre de chaque fonction, sans E/S directe ni allocation ; rien en production ; CONTRÔLES NÉGATIFS", () => {
  const src = read(INO);
  assert.deepEqual(pullFrameViolations(src), []);
  const rm = (n: number): [string, RegExp] => [`marque ${n} supprimée`, n === 1 ? /#if POD_RENDER_V1 && POD_CANARY\n  POD_FF_START\("[^"\n]*"\);\n#endif\n/ : n === 10 ? /#if POD_RENDER_V1 && POD_CANARY\n    \{ const int rcHdr[^\n]*\n#endif\n/ : new RegExp(`#if POD_RENDER_V1 && POD_CANARY\\n\\s+POD_FF_MARK\\(${n}, "[^"\\n]*"\\);( POD_FF_STOP\\(\\);)?\\n#endif\\n`)];
  for (let n = 1; n <= 15; n++) {
    const [name, re] = rm(n);
    assert.ok(re.test(src), `bloc de la marque ${n} introuvable`);
    assert.notEqual(pullFrameViolations(src.replace(re, "")).length, 0, `mutant « ${name} » NON détecté`);
  }
  const mutants: Array<[string, string, string]> = [
    ["garde g_podFfPhase retirée", "do { if (g_podFfPhase != 0) podFfSay((n), txt); } while (0)", "do { podFfSay((n), txt); } while (0)"],
    ["attente USB NON bornée", "i < 400000UL && Serial.availableForWrite() < 120 && millis() - t0 < 200UL", "Serial.availableForWrite() < 120"],
    ["ligne imprimée même sans place dans le tampon USB", "if (Serial.availableForWrite() < 120) { if (g_podFfDrop < 255) g_podFfDrop++; return; }\n", ""],
    ["compteur de lignes perdues supprimé", "if (g_podFfDrop < 255) g_podFfDrop++;", ""],
    ["impression directe par Serial", 'logf("[CANARY] FF %u : %s | marqueur %s | perdues=%u | t=%lu ms"', 'Serial.println("[CANARY] FF"); logf("[CANARY] FF %u : %s | marqueur %s | perdues=%u | t=%lu ms"'],
    ["contrôle du marqueur affaibli (longueur ignorée)", " && *((volatile uint32_t*)&__StackLimit + 1) == g_podPaintLen) ? \"OK\"", ") ? \"OK\""],
    ["arrêt du traçage supprimé", " POD_FF_STOP();\n#endif", "\n#endif"],
    ["marque 3 déplacée après podNetRun", '  POD_FF_MARK(3, "avant podNetRun (pile reseau dediee)");\n#endif\n  const bool ran = podNetRun(tx, &ni);', '#endif\n  const bool ran = podNetRun(tx, &ni);\n#if POD_RENDER_V1 && POD_CANARY\n  POD_FF_MARK(3, "avant podNetRun (pile reseau dediee)");'],
    ["marques 6 et 7 permutées", 'POD_FF_MARK(6, "avant client.connect");', 'POD_FF_MARK(7, "avant client.connect");'],
    ["marque dans la production", "  const bool ran = podNetRun(tx, &ni);\n", "  const bool ran = podNetRun(tx, &ni); POD_FF_MARK(3, \"x\");\n"],
  ];
  for (const [name, a, b] of mutants) {
    assert.ok(src.split(a).length >= 2, `mutation « ${name} » : motif introuvable`);
    assert.notEqual(pullFrameViolations(src.replace(a, () => b)).length, 0, `mutation « ${name} » NON détectée`);
  }
});

test("PULLFRAME-PHASE-AUDIT1 : les quatre autres firmwares R4 et la production ne portent aucune marque ; les statiques de canari ajoutés sont DEUX octets", () => {
  for (const sk of OTHERS) assert.doesNotMatch(read(`arduino_uno_r4/${sk}/${sk}.ino`), /POD_FF|g_podFf/, sk);
  const src = read(INO);
  assert.equal((src.match(/^static volatile uint8_t g_podFfPhase = 0;$/gm) ?? []).length, 1);
  assert.equal((src.match(/^static volatile uint8_t g_podFfDrop = 0;$/gm) ?? []).length, 1);
  assert.doesNotMatch(noCanary(src), /POD_FF|g_podFf/);
});
