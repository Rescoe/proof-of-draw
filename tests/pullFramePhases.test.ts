// PULLFRAME-PHASE-AUDIT1 (10/10/2026) puis AUDIT2 — marques de phase du canari autour de doFetchFrame (e-ink 2,9″ seulement), production inchangée.
// Contexte matériel (canaris 7df39b6 puis 3628b3d) : « [PULL] nouvelle frame 6429e8f5… (personal) » puis plus rien : aucun « [HTTP GET] /api/pull-frame », aucun « [FRAME] », aucun ACK. AUDIT1 (marques imprimées par logf) n'a produit AUCUNE ligne FF, pas même FF 1.
// AUDIT2 : chaque phase est INSCRITE dans un enregistrement RAM « .noinit » (relu au démarrage suivant) puis, pour les phases 4 à 14 seulement (pile réseau dédiée), un jeton de 7 o est écrit par UN Serial.write si la place exacte existe. Jamais de logf, d'allocation ni d'attente dans une marque.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "..");
const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8").replace(/\r\n/g, "\n");
const INO = "arduino_uno_r4/pod_uno_r4_eink29/pod_uno_r4_eink29.ino";
const OTHERS = ["pod_uno_r4_eink27", "pod_uno_r4_eink27_oled", "pod_uno_r4_tft18", "pod_uno_r4"];
const noCanary = (s: string) => s.replace(/#if POD_RENDER_V1 && POD_CANARY\n[\s\S]*?\n#endif\n/g, "");

const MACRO = '#define POD_FF_MARK(n, txt) do { if (g_podFfPhase != 0) podFfNote((n)); } while (0)';
const NOTE_HEAD = "static void __attribute__((noinline)) podFfNote(uint8_t n)";
const TOKEN_HEAD = "static bool __attribute__((noinline)) podFfToken(uint8_t n)";
const BOOT_HEAD = "static void podFfBoot()";

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
  // 1. le bloc : statiques uniques, macros exactes, avant Conn, sous garde
  const iStatic = src.indexOf("static volatile uint8_t g_podFfPhase = 0;");
  const iConn = src.indexOf("struct Conn {");
  if (iStatic < 0 || iConn < 0 || iStatic > iConn) v.push("g_podFfPhase doit être défini avant struct Conn");
  if ((src.match(/^static volatile uint8_t g_podFfPhase = 0;$/gm) ?? []).length !== 1) v.push("exactement un statique g_podFfPhase");
  if ((src.match(/^static PodFfRec g_podFfRec __attribute__\(\(section\("\.noinit"\)\)\);$/gm) ?? []).length !== 1) v.push("exactement un enregistrement g_podFfRec en .noinit (survit au reset, ni EEPROM ni flash)");
  if (!src.includes("struct PodFfRec { uint32_t magic; uint32_t seq; uint32_t ms; uint8_t last; uint8_t drops; uint8_t badAt; uint8_t ctl; uint32_t chk; };\n")) v.push("PodFfRec : 20 o attendus (magic, seq, ms, last, drops, badAt, ctl, chk)");
  if (!src.includes(MACRO + "\n")) v.push("macro POD_FF_MARK : texte exact attendu (garde g_podFfPhase != 0, appel de podFfNote seulement)");
  if (!src.includes("#define POD_FF_START(txt) do { g_podFfPhase = 1; POD_FF_MARK(1, txt); } while (0)\n#define POD_FF_STOP() do { g_podFfPhase = 0; } while (0)\n")) v.push("POD_FF_START / POD_FF_STOP : texte exact attendu");
  const tok = /^static const char kFfTok\[\] = "((?:\[FF\d\d\]\\n)+)";$/m.exec(src);
  if (!tok) v.push("table de jetons kFfTok introuvable");
  else {
    const parts = [...tok[1].matchAll(/\[FF(\d\d)\]\\n/g)].map((m) => Number(m[1]));
    if (parts.length !== 16 || parts.some((p, i) => p !== i)) v.push("kFfTok : seize jetons « [FF00]\\n » à « [FF15]\\n » de 7 o chacun, dans l'ordre");
  }
  const blk = /#if POD_RENDER_V1 && POD_CANARY\n\/\/ PULLFRAME-PHASE-AUDIT2[\s\S]*?\n#endif\n/.exec(src);
  if (!blk) v.push("bloc PULLFRAME-PHASE-AUDIT2 introuvable");
  else if (/Serial\.(print|println)|malloc|new |String\b|mallinfo|delay|httpCall|WiFi|EEPROM/.test(blk[0].replace(/\/\/.*$/gm, ""))) v.push("le bloc des marques ne doit contenir ni Serial.print, ni allocation, ni String, ni réseau, ni EEPROM");
  // 1b. podFfNote : enregistrer d'abord, jeton ensuite et seulement sur pile dédiée, aucune E/S d'une autre nature
  const note = body(src, NOTE_HEAD);
  if (!note) v.push("podFfNote introuvable");
  else {
    if (/logf|String|malloc|new |delay|httpCall|WiFi|Serial\.|while|for \(/.test(note)) v.push("podFfNote : ni logf, ni String, ni allocation, ni attente, ni E/S directe (le jeton passe par podFfToken)");
    const iSeal = note.indexOf("podFfSeal();"), iTok = note.indexOf("podFfToken(n)");
    if (iSeal < 0 || iTok < 0 || iSeal > iTok) v.push("podFfNote : l'enregistrement est scellé AVANT le jeton série");
    if (!note.includes("if (n >= 4 && n <= 14) { if (!podFfToken(n))")) v.push("podFfNote : jeton série seulement pour les phases 4 à 14 (pile réseau dédiée) ; 1, 2, 3 et 15 = enregistrement seul (pile principale)");
    if (!note.includes("if (g_podFfRec.drops < 255) g_podFfRec.drops++;")) v.push("podFfNote : jetons perdus comptés");
    if (!note.includes("*(volatile uint32_t*)&__StackLimit == 0x434E5259UL && *((volatile uint32_t*)&__StackLimit + 1) == g_podPaintLen")) v.push("podFfNote : marqueur ET longueur exacts");
  }
  const token = body(src, TOKEN_HEAD);
  if (!token) v.push("podFfToken introuvable");
  else {
    if ((token.match(/Serial\.write\(/g) ?? []).length !== 1) v.push("podFfToken : exactement UN Serial.write");
    if (!token.includes("Serial.availableForWrite() < 7")) v.push("podFfToken : n'écrit que si la place EXACTE (7 o) existe");
    if (!token.includes("(kFfTok + 7u * n), 7)")) v.push("podFfToken : écrit exactement 7 o");
    if (/\b(for|while|delay|logf|print|println|millis|malloc)\b/.test(token)) v.push("podFfToken : ni boucle, ni attente, ni logf");
  }
  // 1c. démarrage : empreinte du build, rapport de l'enregistrement précédent, jeton de contrôle
  const boot = body(src, BOOT_HEAD);
  if (!boot) v.push("podFfBoot introuvable");
  else {
    if (!boot.includes("BUILD PULLFRAME-PHASE-AUDIT2") || !boot.includes("__DATE__, __TIME__") || !boot.includes("base 3628b3d")) v.push("podFfBoot : empreinte du build (lot, commit de base, date et heure de compilation)");
    if (!boot.includes("g_podFfRec.chk == podFfSum()")) v.push("podFfBoot : l'enregistrement précédent est validé par sa somme");
    if (!boot.includes("const bool w = podFfToken(0);")) v.push("podFfBoot : jeton de contrôle [FF00]");
    if (!/g_podFfRec\.last = 0; g_podFfRec\.drops = 0; g_podFfRec\.badAt = 0; g_podFfRec\.ctl = 0; podFfSeal\(\);/.test(boot)) v.push("podFfBoot : l'enregistrement est ré-armé");
  }
  if ((src.match(/^  podFfBoot\(\);\n  podCanaryCheck\("1c apres FFBOOT/gm) ?? []).length !== 1) v.push("podFfBoot appelé une fois dans setup, suivi du contrôle de pile 1c");
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
  if (/POD_FF|g_podFf|podFf/.test(prod)) v.push("des marques existent HORS des blocs de canari");
  return v;
}

test("PULLFRAME-PHASE-AUDIT2 : quinze marques de phase du canari (enregistrement RAM .noinit + jeton de 7 o sans logf pour les phases 4 à 14), chacune seule dans son bloc gardé, dans l'ordre de chaque fonction ; rien en production ; CONTRÔLES NÉGATIFS", () => {
  const src = read(INO);
  assert.deepEqual(pullFrameViolations(src), []);
  const rm = (n: number): [string, RegExp] => [`marque ${n} supprimée`, n === 1 ? /#if POD_RENDER_V1 && POD_CANARY\n  POD_FF_START\("[^"\n]*"\);\n#endif\n/ : n === 10 ? /#if POD_RENDER_V1 && POD_CANARY\n    \{ const int rcHdr[^\n]*\n#endif\n/ : new RegExp(`#if POD_RENDER_V1 && POD_CANARY\\n\\s+POD_FF_MARK\\(${n}, "[^"\\n]*"\\);( POD_FF_STOP\\(\\);)?\\n#endif\\n`)];
  for (let n = 1; n <= 15; n++) {
    const [name, re] = rm(n);
    assert.ok(re.test(src), `bloc de la marque ${n} introuvable`);
    assert.notEqual(pullFrameViolations(src.replace(re, "")).length, 0, `mutant « ${name} » NON détecté`);
  }
  const mutants: Array<[string, string, string]> = [
    ["garde g_podFfPhase retirée", "do { if (g_podFfPhase != 0) podFfNote((n)); } while (0)", "do { podFfNote((n)); } while (0)"],
    ["jeton écrit sans vérifier la place", "if (n > 15 || Serial.availableForWrite() < 7) return false;", "if (n > 15) return false;"],
    ["jeton plus long que la place vérifiée", "(kFfTok + 7u * n), 7) == 7", "(kFfTok + 7u * n), 70) == 70"],
    ["attente dans le jeton", "if (n > 15 || Serial.availableForWrite() < 7) return false;", "while (Serial.availableForWrite() < 7) { } if (n > 15) return false;"],
    ["enregistrement non scellé avant le jeton", "  podFfSeal();\n  if (n >= 4 && n <= 14)", "  if (n >= 4 && n <= 14)"],
    ["jeton série aussi sur la pile principale (phases 1 à 3 et 15)", "if (n >= 4 && n <= 14) {", "if (n >= 1) {"],
    ["logf dans une marque", "  g_podFfPhase = n;\n  g_podFfRec.last = n;", "  g_podFfPhase = n; logf(\"FF %u\", (unsigned)n);\n  g_podFfRec.last = n;"],
    ["enregistrement hors .noinit (effacé au reset)", ' __attribute__((section(".noinit")));', ";"],
    ["compteur de jetons perdus supprimé", "if (g_podFfRec.drops < 255) g_podFfRec.drops++;", ""],
    ["contrôle du marqueur affaibli (longueur ignorée)", " && *((volatile uint32_t*)&__StackLimit + 1) == g_podPaintLen", ""],
    ["arrêt du traçage supprimé", " POD_FF_STOP();\n#endif", "\n#endif"],
    ["marque 3 déplacée après podNetRun", '  POD_FF_MARK(3, "avant podNetRun (pile reseau dediee)");\n#endif\n  const bool ran = podNetRun(tx, &ni);', '#endif\n  const bool ran = podNetRun(tx, &ni);\n#if POD_RENDER_V1 && POD_CANARY\n  POD_FF_MARK(3, "avant podNetRun (pile reseau dediee)");'],
    ["marques 6 et 7 permutées", 'POD_FF_MARK(6, "avant client.connect");', 'POD_FF_MARK(7, "avant client.connect");'],
    ["marque dans la production", "  const bool ran = podNetRun(tx, &ni);\n", "  const bool ran = podNetRun(tx, &ni); POD_FF_MARK(3, \"x\");\n"],
    ["démarrage : rapport de l'enregistrement précédent non validé", "g_podFfRec.chk == podFfSum()", "true"],
    ["démarrage : jeton de contrôle supprimé", "const bool w = podFfToken(0);", "const bool w = true;"],
    ["démarrage : empreinte du build supprimée", "BUILD PULLFRAME-PHASE-AUDIT2", "BUILD"],
    ["démarrage : podFfBoot jamais appelé", "  podFfBoot();\n", ""],
    ["jeton [FF07] absent de la table", "[FF07]\\n", "[FF08]\\n"],
  ];
  for (const [name, a, b] of mutants) {
    assert.ok(src.split(a).length >= 2, `mutation « ${name} » : motif introuvable`);
    assert.notEqual(pullFrameViolations(src.replace(a, () => b)).length, 0, `mutation « ${name} » NON détectée`);
  }
});

test("PULLFRAME-PHASE-AUDIT2 : les quatre autres firmwares R4 et la production ne portent aucune marque ; statiques de canari : un octet de phase et UN enregistrement .noinit de 20 o", () => {
  for (const sk of OTHERS) assert.doesNotMatch(read(`arduino_uno_r4/${sk}/${sk}.ino`), /POD_FF|g_podFf|podFf/, sk);
  const src = read(INO);
  assert.equal((src.match(/^static volatile uint8_t g_podFfPhase = 0;$/gm) ?? []).length, 1);
  assert.equal((src.match(/g_podFfDrop/g) ?? []).length, 0, "g_podFfDrop n'existe plus (le compteur vit dans l'enregistrement .noinit)");
  assert.doesNotMatch(noCanary(src), /POD_FF|g_podFf|podFf/);
});
