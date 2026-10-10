// PULLFRAME-PHASE-AUDIT1 (10/10/2026), AUDIT2, AUDIT3 puis AUDIT4 — marques de phase du canari autour de doFetchFrame (e-ink 2,9″ seulement), production inchangée.
// Contexte matériel (canaris 7df39b6, 3628b3d, AUDIT2, AUDIT3) : « [PULL] nouvelle frame … (personal) » puis plus rien. AUDIT1 (logf) : aucune ligne FF ; AUDIT2 (RAM .noinit + jeton de 7 o) : inexploitable ;
// AUDIT3 (journal en flash de données, bloc 7, ajout seul) : dernière phase 9 sur deux démarrages consécutifs = client.print est revenu, la phase 10 (retour de readHeaders) n'est jamais écrite.
// AUDIT4 : ajoute (1) un client TLS « espion » (FfSSL) qui inscrit en flash, entre la marque 9 et la marque 10 seulement, les premiers appels de read() et connected() avec le temps écoulé (64 événements au plus),
// (2) cinq LED de la matrice pilotées en statique (F = écriture flash, R = dans read, C = dans connected, A = trace active, H = en-têtes lus) comme témoin indépendant de la flash.
// (1) règles statiques + contrôles négatifs ; (2) exécution HÔTE du code réel contre une flash simulée (programmation = ET binaire, effacement par bloc, pannes, étanchéité du bloc 7), un faux client TLS qui ne rend jamais la main et de fausses LED.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { compileHarness, describeChoice, findCompiler, runProcess } from "./helpers/cppHarness";

const root = path.resolve(__dirname, "..");
const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8").replace(/\r\n/g, "\n");
const INO = "arduino_uno_r4/pod_uno_r4_eink29/pod_uno_r4_eink29.ino";
const OTHERS = ["pod_uno_r4_eink27", "pod_uno_r4_eink27_oled", "pod_uno_r4_tft18", "pod_uno_r4"];
const noCanary = (s: string) => s.replace(/#if POD_RENDER_V1 && POD_CANARY\n[\s\S]*?\n#endif\n/g, "");
const stripLine = (s: string) => s.replace(/("(?:[^"\\\n]|\\.)*")|\/\/.*$/gm, (_m, str?: string) => str ?? "");

const MACRO = '#define POD_FF_MARK(n, txt) do { if (g_podFfPhase != 0) podFfNote((n)); } while (0)';
const NOTE_HEAD = "static void __attribute__((noinline)) podFfNote(uint8_t n)";
const APPEND_HEAD = "static void __attribute__((noinline)) podFfAppend(uint8_t e)";
const BOOT_HEAD = "static void __attribute__((noinline)) podFfBoot()";
const LED_HEAD = "static void __attribute__((noinline)) podFfLedSet(uint8_t m)";
const EV_HEAD = "static void __attribute__((noinline)) podFfEv(uint8_t id)";
const BLOCK_START = "#if POD_RENDER_V1 && POD_CANARY\n// PULLFRAME-PHASE-AUDIT4";
const BLOCK_END = "#define POD_FF_STOP() do { g_podFfPhase = 0; } while (0)\n#endif\n";

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
  // 1. le bloc : statiques uniques, constantes de la zone de flash, macros exactes, avant Conn, sous garde
  const iStatic = src.indexOf("static volatile uint8_t g_podFfPhase = 0;");
  const iConn = src.indexOf("struct Conn {");
  if (iStatic < 0 || iConn < 0 || iStatic > iConn) v.push("g_podFfPhase doit être défini avant struct Conn");
  for (const [decl, why] of [
    ["static volatile uint8_t g_podFfPhase = 0;", "g_podFfPhase"], ["static volatile uint16_t g_podFfPos = 0;", "g_podFfPos (0 = journal non armé)"], ["static volatile uint32_t g_podFfT0 = 0;", "g_podFfT0"],
    ["static volatile uint8_t g_podFfNR = 0;", "g_podFfNR"], ["static volatile uint8_t g_podFfNC = 0;", "g_podFfNC"], ["static volatile uint8_t g_podFfNE = 0;", "g_podFfNE"], ["static volatile uint8_t g_podFfTk = 0;", "g_podFfTk"], ["static volatile uint8_t g_podFfLed = 0;", "g_podFfLed"],
  ] as const) if ((src.split("\n" + decl + "\n").length - 1) !== 1) v.push(`exactement un statique ${why}`);
  if (/g_podFfRec|g_podFfDrop|\.noinit|kFfTok|PodFfRec/.test(stripLine(src))) v.push("l'enregistrement RAM .noinit d'AUDIT2 n'existe plus");
  for (const d of ["#define POD_FFL_BASE 0x1C00u\n", "#define POD_FFL_SIZE 0x400u\n", "#define POD_FFL_HDR 8u\n", "#define POD_FF_EVMAX 64u\n"]) if (!src.includes(d)) v.push(`constante attendue : ${d.trim()} (bloc 7 = dernier bloc de 1 Ko de la flash de données de 8 Ko ; les clés sont dans le bloc 0 ; 64 événements au plus)`);
  if (!src.includes(MACRO + "\n")) v.push("macro POD_FF_MARK : texte exact attendu (garde g_podFfPhase != 0, appel de podFfNote seulement)");
  if (!src.includes("#define POD_FF_START(txt) do { g_podFfPhase = 1; POD_FF_MARK(1, txt); } while (0)\n#define POD_FF_STOP() do { g_podFfPhase = 0; } while (0)\n")) v.push("POD_FF_START / POD_FF_STOP : texte exact attendu");
  if (!src.includes("static uint8_t podFfEntry(uint8_t n) { return (uint8_t)((n << 4) | ((~n) & 0x0F)); }\n")) v.push("podFfEntry : numéro de phase (4 bits) + son COMPLÉMENT (4 bits)");
  if (!src.includes("static bool podFfEntryOk(uint8_t b) { return (uint8_t)(b >> 4) == (uint8_t)((~b) & 0x0F); }\n")) v.push("podFfEntryOk : validation par le complément");
  if (!src.includes("static bool podFfIsEv(uint8_t b) { return (uint8_t)((b >> 4) ^ (b & 0x0F)) == 0x0A && (b >> 4) < 7; }\n")) v.push("podFfIsEv : un événement = identifiant (4 bits) + (identifiant XOR 0x0A) ; sept identifiants");
  const i0 = src.indexOf(BLOCK_START);
  const blk = i0 < 0 ? null : src.slice(i0, src.indexOf(BLOCK_END, i0) + BLOCK_END.length);
  if (!blk) v.push("bloc PULLFRAME-PHASE-AUDIT4 introuvable");
  else {
    const code = stripLine(blk);
    if (/Serial\.(print|println)|malloc|new |String\b|mallinfo|delay|httpCall|WiFi(?!SSLClient)|EEPROM\.|\bsprintf|snprintf/.test(code)) v.push("le bloc des marques ne doit contenir ni Serial.print, ni allocation, ni String, ni réseau (hors la classe cliente), ni EEPROM.xxx (EEPROM.update alloue une page de 1 Ko au tas), ni formatage");
    if (/LED_BUILTIN|digitalWrite|pinMode|FspTimer|attachInterrupt|analogWrite|Arduino_LED_Matrix|ArduinoLEDMatrix/.test(code)) v.push("les LED de la matrice sont pilotées en STATIQUE par les registres : ni LED_BUILTIN (D13 est l'horloge SPI de l'e-ink), ni pinMode/digitalWrite, ni minuteur, ni la bibliothèque de la matrice (interruption à 10 kHz)");
    for (const m of code.matchAll(/logf\("((?:[^"\\]|\\.)*)"/g)) if (m[1].length > 235) v.push(`un format logf de ${m[1].length} caractères : logf tronque à 255 (ligne « arme » coupée au dernier essai)`);
  }
  const code = stripLine(src);
  // 1b. podFfNote : LED, temps de départ, inscription en flash par marque (+ octet « pile détruite »), jeton d'un octet seulement pour 4 à 14 et seulement si la place existe
  const note = body(code, NOTE_HEAD);
  if (!note) v.push("podFfNote introuvable");
  else {
    if (/logf|String|malloc|new |delay|httpCall|WiFi|while|for \(|Serial\.(print|println)/.test(note)) v.push("podFfNote : ni logf, ni String, ni allocation, ni attente, ni boucle");
    if (!note.includes("podFfAppend(podFfEntry(n));")) v.push("podFfNote : une inscription en flash par marque");
    if (!note.includes("if (n == 1) podFfLedSet(1u << 3);")) v.push("podFfNote : LED A (trace active) allumée à la marque 1");
    if (!note.includes("if (n == 9) { g_podFfT0 = millis(); g_podFfNR = 0; g_podFfNC = 0; g_podFfNE = 0; g_podFfTk = 0; }")) v.push("podFfNote : à la marque 9 : temps de départ et compteurs remis à zéro (fenêtre des événements)");
    if (!note.includes("if (n == 10) podFfLedOn(4);") || note.indexOf("if (n == 10) podFfLedOn(4);") > note.indexOf("podFfAppend(podFfEntry(n));")) v.push("podFfNote : LED H allumée AVANT l'écriture flash de la phase 10 (témoin indépendant)");
    if (!note.includes("if (n == 15) podFfLedSet(0);")) v.push("podFfNote : toutes les LED éteintes à la marque 15");
    if (!note.includes("*(volatile uint32_t*)&__StackLimit != 0x434E5259UL || *((volatile uint32_t*)&__StackLimit + 1) != g_podPaintLen) podFfAppend(0xBD);")) v.push("podFfNote : marqueur ET longueur exacts ; octet 0xBD si la pile principale est détruite");
    if ((note.match(/Serial\.write\(/g) ?? []).length !== 1 || !note.includes("if (n >= 4 && n <= 14 && Serial.availableForWrite() >= 1) Serial.write((uint8_t)('A' + n - 1));")) v.push("podFfNote : UN Serial.write d'un octet, phases 4 à 14 seulement, seulement si availableForWrite() >= 1");
    if (note.indexOf("podFfAppend(podFfEntry(n))") > note.indexOf("Serial.write(")) v.push("podFfNote : l'inscription en flash précède le jeton série");
  }
  const app = body(code, APPEND_HEAD);
  if (!app) v.push("podFfAppend introuvable");
  else {
    if ((app.match(/\.program\(/g) ?? []).length !== 1 || !app.includes("DataFlashBlockDevice::getInstance().program(&e, POD_FFL_BASE + p, 1)")) v.push("podFfAppend : UNE programmation d'UN octet dans le bloc 7 (ajout seul)");
    if (!app.includes("if (p < POD_FFL_HDR || p >= POD_FFL_SIZE) return;")) v.push("podFfAppend : journal non armé (p < en-tête) ou plein (p >= taille) : aucune écriture");
    if (!app.includes("if (rc == 0) g_podFfPos = (uint16_t)(p + 1); else g_podFfPos = POD_FFL_SIZE;")) v.push("podFfAppend : toute erreur de flash DÉSACTIVE le journal");
    const iOn = app.indexOf("podFfLedOn(0);"), iPg = app.indexOf(".program("), iOff = app.indexOf("podFfLedOff(0);");
    if (iOn < 0 || iPg < 0 || iOff < 0 || !(iOn < iPg && iPg < iOff)) v.push("podFfAppend : LED F allumée AVANT la programmation et éteinte APRÈS (témoin d'une écriture flash qui ne revient pas)");
    if (/\.erase\(|logf|Serial/.test(app)) v.push("podFfAppend : ni effacement, ni journal, ni série");
  }
  // 1c. LED de la matrice : registres seulement, anode 7, cinq cathodes, mêmes masques que la bibliothèque du cœur
  const led = body(code, LED_HEAD);
  if (!led) v.push("podFfLedSet introuvable");
  else {
    if (!led.includes("R_PORT0->PCNTR1 &= ~((uint32_t)((1 << 3) | (1 << 4) | (1 << 11) | (1 << 12) | (1 << 13) | (1 << 15)));") || !led.includes("R_PORT2->PCNTR1 &= ~((uint32_t)((1 << 4) | (1 << 5) | (1 << 6) | (1 << 12) | (1 << 13)));")) v.push("podFfLedSet : toutes les broches de la matrice repassent en entrée (mêmes masques que la bibliothèque du cœur)");
    if (!led.includes("g_pin_cfg[28 + 7].pin") || !led.includes("g_pin_cfg[28 + kFfCath[i]].pin")) v.push("podFfLedSet : anode = broche 7, cathodes = kFfCath (indice de base 28)");
    if (!led.includes("IOPORT_CFG_PORT_DIRECTION_OUTPUT | IOPORT_CFG_PORT_OUTPUT_HIGH") || !led.includes("IOPORT_CFG_PORT_DIRECTION_OUTPUT | IOPORT_CFG_PORT_OUTPUT_LOW")) v.push("podFfLedSet : anode en sortie HAUTE, cathodes en sortie BASSE");
    if (!led.includes("if (m == 0) return;")) v.push("podFfLedSet : masque 0 = tout éteint");
  }
  if (!src.includes("static const uint8_t kFfCath[5] = { 3, 4, 8, 0, 6 };\n")) v.push("kFfCath : cinq cathodes de l'anode 7 (LED d'indice 0, 2, 6, 12, 20 de la matrice)");
  // 1d. événements : plafond, échantillonnage, temps, fenêtre 9 -> 10 seulement
  const ev = body(code, EV_HEAD);
  if (!ev) v.push("podFfEv introuvable");
  else {
    if (!ev.includes("if (g_podFfNE >= POD_FF_EVMAX) return;")) v.push("podFfEv : plafond de 64 événements");
    if (!ev.includes("const uint32_t u = id == 6 ? d / 1000UL : d >> 3;") || !ev.includes("(uint8_t)(u > 254UL ? 254UL : u)")) v.push("podFfEv : temps en unités de 8 ms (secondes pour le tick), plafonné à 254 (0xFF = vierge)");
    if ((ev.match(/podFfAppend\(/g) ?? []).length !== 2) v.push("podFfEv : DEUX octets (événement + temps)");
  }
  if (!code.includes("static bool __attribute__((noinline)) podFfPick(uint8_t k) { return k <= 3 || (k & (uint8_t)(k - 1)) == 0; }")) v.push("podFfPick : appels 1 à 3 puis puissances de 2");
  const tick = body(code, "static void __attribute__((noinline)) podFfTick()");
  if (!tick.includes("if (s > g_podFfTk) { g_podFfTk = (uint8_t)(s > 250UL ? 250UL : s); podFfEv(6); }")) v.push("podFfTick : un événement par seconde écoulée (le plafond global de 64 borne le journal)");
  const spy = body(code, "struct FfSSL : public WiFiSSLClient");
  if (!spy) v.push("FfSSL introuvable");
  else {
    if ((spy.match(/if \(g_podFfPhase != 9\) return WiFiSSLClient::(?:read\(b, n\)|connected\(\));/g) ?? []).length !== 2) v.push("FfSSL : read et connected ne font RIEN de plus hors de la fenêtre 9 -> 10");
    for (const [name, onBit, evIn, evOut] of [["read", "podFfLedOn(1);", "podFfEv(0);", "podFfEv(r > 0 ? 1 : 2);"], ["connected", "podFfLedOn(2);", "podFfEv(3);", "podFfEv(r ? 4 : 5);"]] as const) {
      const part = name === "read" ? spy.slice(spy.indexOf("int read("), spy.indexOf("uint8_t connected()")) : spy.slice(spy.indexOf("uint8_t connected()"));
      const base = name === "read" ? "WiFiSSLClient::read(b, n);" : "WiFiSSLClient::connected();";
      const offBit = onBit.replace("On", "Off");
      const iIn = part.indexOf(evIn), iOn = part.indexOf(onBit), iBase = part.indexOf(base, part.indexOf("podFfLedOn")), iOff = part.indexOf(offBit), iOut = part.indexOf(evOut);
      if ([iIn, iOn, iBase, iOff, iOut].some((x) => x < 0) || !(iIn < iOn && iOn < iBase && iBase < iOff && iOff < iOut)) v.push(`FfSSL::${name} : événement d'entrée, LED allumée, appel du vrai client, LED éteinte, événement de sortie — dans cet ordre`);
      if (!part.includes("podFfTick();") || !part.includes("podFfPick(")) v.push(`FfSSL::${name} : tick et échantillonnage`);
    }
  }
  if ((src.match(/^#define WiFiSSLClient FfSSL$/gm) ?? []).length !== 1) v.push("exactement un « #define WiFiSSLClient FfSSL », après la définition de FfSSL");
  else if (src.indexOf("#define WiFiSSLClient FfSSL") < src.indexOf("struct FfSSL : public WiFiSSLClient") || src.indexOf("#define WiFiSSLClient FfSSL") > iConn) v.push("#define WiFiSSLClient FfSSL : après FfSSL et avant struct Conn");
  // 1e. démarrage : empreinte du build, lecture protégée du journal précédent, effacement unique du bloc 7, armement avec relecture, test des LED
  const boot = body(code, BOOT_HEAD);
  if (!boot) v.push("podFfBoot introuvable");
  else {
    if (!boot.includes("BUILD PULLFRAME-PHASE-AUDIT4") || !boot.includes("__DATE__, __TIME__") || !boot.includes("base 2cdfe54")) v.push("podFfBoot : empreinte du build (lot, commit de base, date et heure de compilation)");
    if (!boot.includes("h[0] == 'F' && h[1] == 'F' && h[2] == 'L' && h[3] == '3' && (uint8_t)(h[4] ^ h[5]) == 0xFF")) v.push("podFfBoot : en-tête validé par sa magie ET le complément de la génération");
    if ((boot.match(/\.erase\(/g) ?? []).length !== 1 || !boot.includes("rc = df.erase(POD_FFL_BASE, POD_FFL_SIZE);")) v.push("podFfBoot : UN SEUL effacement, du bloc 7 entier");
    if (!boot.includes("if (hdrOk && (n == 0 || (n == 1 && lastPh == 0))) {")) v.push("podFfBoot : aucun effacement quand le journal précédent est vide (usure)");
    if (!boot.includes("const bool back = rc == 0 && rb == podFfEntry(0);") || !boot.includes("g_podFfPos = back ? pos : (uint16_t)POD_FFL_SIZE;")) v.push("podFfBoot : armement seulement après écriture ET relecture réussies");
    if (!boot.includes("if (b == 0xFF) { end = true; break; }")) v.push("podFfBoot : la lecture s'arrête au premier octet vierge");
    if (!boot.includes("if (wantT) { rt[(uint16_t)(n - 1) % 16] = b; wantT = false; continue; }")) v.push("podFfBoot : l'octet qui suit un événement est son temps, jamais une entrée");
    if ((boot.match(/df\.program\(/g) ?? []).length !== 2) v.push("podFfBoot : deux programmations (en-tête, marqueur d'armement)");
    if (!boot.includes("au plus UN effacement par demarrage")) v.push("podFfBoot : l'usure maximale est rapportée");
    if (!boot.includes("for (uint8_t i = 0; i < 5; i++) { podFfLedSet((uint8_t)(1u << i)); podFfWait(250UL); }") || !boot.includes("podFfLedSet(0);")) v.push("podFfBoot : test séquentiel des cinq LED (F, R, C, A, H) puis extinction");
  }
  if ((src.match(/^  podFfBoot\(\);\n  podCanaryCheck\("1c apres FFBOOT/gm) ?? []).length !== 1) v.push("podFfBoot appelé une fois dans setup, suivi du contrôle de pile 1c");
  // 1f. DataFlashBlockDevice / flash / client espion : seulement dans ce bloc de canari
  if (/DataFlashBlockDevice|POD_FFL_|FfSSL|R_PFS|R_PORT0|R_PORT2/.test(noCanary(src))) v.push("la flash de données, les LED et le client espion n'existent qu'en canari");
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
  if (/POD_FF|g_podFf|podFf|FfSSL/.test(prod)) v.push("des marques existent HORS des blocs de canari");
  return v;
}

test("PULLFRAME-PHASE-AUDIT4 : quinze marques de phase (journal en flash, bloc 7, ajout seul) + client TLS espion borné + cinq LED de la matrice en statique ; chaque marque seule dans son bloc gardé et dans l'ordre ; rien en production ; CONTRÔLES NÉGATIFS", () => {
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
    ["bloc 0 (les clés) au lieu du bloc 7", "#define POD_FFL_BASE 0x1C00u", "#define POD_FFL_BASE 0x0000u"],
    ["EEPROM.update au lieu de l'ajout seul", "const int rc = DataFlashBlockDevice::getInstance().program(&e, POD_FFL_BASE + p, 1);", "EEPROM.update(POD_FFL_BASE + p, e); const int rc = 0;"],
    ["complément supprimé de l'octet de phase", "return (uint8_t)((n << 4) | ((~n) & 0x0F));", "return (uint8_t)((n << 4) | 0x0F);"],
    ["validation par le complément affaiblie", "return (uint8_t)(b >> 4) == (uint8_t)((~b) & 0x0F);", "return b != 0xFF;"],
    ["journal non armé écrit quand même", "if (p < POD_FFL_HDR || p >= POD_FFL_SIZE) return;", "if (p >= POD_FFL_SIZE) return;"],
    ["erreur de flash sans désactivation", "else g_podFfPos = POD_FFL_SIZE;", ";"],
    ["LED F non allumée pendant l'écriture flash", "  podFfLedOn(0);\n", ""],
    ["LED H non allumée avant l'écriture de la phase 10", "  if (n == 10) podFfLedOn(4);\n", ""],
    ["LED H allumée APRÈS l'écriture de la phase 10", "  if (n == 10) podFfLedOn(4);\n  podFfAppend(podFfEntry(n));", "  podFfAppend(podFfEntry(n));\n  if (n == 10) podFfLedOn(4);"],
    ["LED non éteintes à la fin", "  if (n == 15) podFfLedSet(0);\n", ""],
    ["LED D13 (horloge SPI de l'e-ink) au lieu de la matrice", "  if (m == 0) return;\n", "  if (m == 0) return;\n  pinMode(LED_BUILTIN, OUTPUT); digitalWrite(LED_BUILTIN, HIGH);\n"],
    ["masque de broches de la matrice modifié", "(1 << 3) | (1 << 4) | (1 << 11) | (1 << 12) | (1 << 13) | (1 << 15)", "(1 << 3) | (1 << 4)"],
    ["événements hors de la fenêtre 9 -> 10", "    if (g_podFfPhase != 9) return WiFiSSLClient::read(b, n);", "    if (g_podFfPhase == 0) return WiFiSSLClient::read(b, n);"],
    ["plafond d'événements retiré", "  if (g_podFfNE >= POD_FF_EVMAX) return;\n", ""],
    ["échantillonnage retiré (toutes les entrées)", "return k <= 3 || (k & (uint8_t)(k - 1)) == 0;", "return true;"],
    ["temps non plafonné (0xFF = vierge)", "(uint8_t)(u > 254UL ? 254UL : u)", "(uint8_t)u"],
    ["sortie de read sans LED éteinte", "    podFfLedOff(1);\n", ""],
    ["vrai client appelé AVANT l'événement d'entrée", "    if (ev) podFfEv(3);\n    podFfLedOn(2);\n    const uint8_t r = WiFiSSLClient::connected();", "    const uint8_t r = WiFiSSLClient::connected();\n    if (ev) podFfEv(3);\n    podFfLedOn(2);"],
    ["redirection du nom du client supprimée", "#define WiFiSSLClient FfSSL\n", ""],
    ["jeton série sur la pile principale (phases 1 à 3 et 15)", "if (n >= 4 && n <= 14 && Serial.availableForWrite() >= 1)", "if (Serial.availableForWrite() >= 1)"],
    ["jeton série écrit sans vérifier la place", "n <= 14 && Serial.availableForWrite() >= 1)", "n <= 14)"],
    ["logf dans une marque", "  g_podFfPhase = n;\n  if (n == 1)", "  g_podFfPhase = n; logf(\"FF %u\", (unsigned)n);\n  if (n == 1)"],
    ["marqueur de pile non contrôlé", " || *((volatile uint32_t*)&__StackLimit + 1) != g_podPaintLen) podFfAppend(0xBD);", ") podFfAppend(0xBD);"],
    ["effacement à chaque démarrage (usure)", "if (hdrOk && (n == 0 || (n == 1 && lastPh == 0))) {", "if (false) {"],
    ["en-tête sans complément", " && (uint8_t)(h[4] ^ h[5]) == 0xFF", ""],
    ["armement sans relecture", "const bool back = rc == 0 && rb == podFfEntry(0);", "const bool back = true;"],
    ["l'octet de temps lu comme une entrée", "if (wantT) { rt[(uint16_t)(n - 1) % 16] = b; wantT = false; continue; }", ""],
    ["test des LED au démarrage supprimé", "for (uint8_t i = 0; i < 5; i++) { podFfLedSet((uint8_t)(1u << i)); podFfWait(250UL); }", ""],
    ["empreinte du build supprimée", "BUILD PULLFRAME-PHASE-AUDIT4", "BUILD"],
    ["podFfBoot jamais appelé", "  podFfBoot();\n", ""],
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

test("PULLFRAME-PHASE-AUDIT4 : carte de l'EEPROM — les clés, le dernier bloc et l'état du firmware tiennent dans le bloc 0 (452 premiers octets) ; la zone du journal (bloc 7) ne chevauche aucune donnée de AUCUN firmware R4", () => {
  const num = (src: string, name: string): number => {
    const m = new RegExp(`^#define ${name}\\s+(\\d+)`, "m").exec(src);
    assert.ok(m, `${name} introuvable`);
    return Number(m![1]);
  };
  for (const sk of ["pod_uno_r4_eink29", ...OTHERS]) {
    const s = read(`arduino_uno_r4/${sk}/${sk}.ino`);
    const ends: number[] = [];
    // chaque zone [offset, longueur] déclarée ; fin exclusive la plus haute
    ends.push(num(s, "EEPROM_PRIVKEY_OFF") + 32, num(s, "EEPROM_BLOCKHASH_OFF") + 32, num(s, "EEPROM_FLAG_OFF") + 1, num(s, "EEPROM_PUBKEY_OFF") + 32, num(s, "EEPROM_ONBOARDING_OFF") + 1);
    if (/#define EEPROM_OWNED_SLOTS_OFF/.test(s)) ends.push(num(s, "EEPROM_OWNED_HEAD_OFF") + 1, num(s, "EEPROM_OWNED_COUNT_OFF") + 1, num(s, "EEPROM_OWNED_SLOTS_OFF") + num(s, "OWNED_SLOTS_MAX") * num(s, "OWNED_HASH_LEN"));
    if (/#define EEPROM_FRAMEID_OFF/.test(s)) ends.push(num(s, "EEPROM_FRAMEID_OFF") + num(s, "FRAMEID_LEN"));
    assert.ok(Math.max(...ends) <= 1024, `${sk} : une donnée EEPROM dépasse le bloc 0 (fin ${Math.max(...ends)})`);
  }
  const s29 = read(INO);
  assert.equal(num(s29, "EEPROM_FRAMEID_OFF") + num(s29, "FRAMEID_LEN"), 452, "fin de la dernière donnée du e-ink 2,9″");
  // aucune autre écriture EEPROM à un décalage constant au-delà du bloc 0 : tous les accès passent par les EEPROM_*_OFF
  const eeprom = s29.replace(/\/\/.*$/gm, "").match(/EEPROM\.(?:read|update|write)\(([^)]*)\)/g) ?? [];
  assert.ok(eeprom.length > 10);
  for (const a of eeprom) assert.ok(/EEPROM_[A-Z_]*OFF|\boff\b|slotOff|\+ i\b/.test(a), `accès EEPROM hors table : ${a}`);
  assert.equal(0x1C00 % 0x400, 0, "le journal commence sur une frontière de bloc");
  assert.equal(0x1C00 + 0x400, 0x2000, "le journal est le DERNIER bloc de la flash de données de 8 Ko");
});

// ── Exécution hôte du code RÉEL contre une flash, un client TLS et des LED simulés ───────────────────────────
const choice = findCompiler();
console.log(`[pullFramePhases] ${describeChoice(choice)}`);
const skipHost = !choice.path ? `${describeChoice(choice)} — exécution hôte IGNORÉE` : false;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ffl-"));
const exeName = process.platform === "win32" ? "ffl_harness.exe" : "ffl_harness";

/** Le bloc du journal (sans les lignes #if / #endif), mot pour mot. */
function extractBlock(): string {
  const src = read(INO);
  const a = src.indexOf(BLOCK_START), b = src.indexOf(BLOCK_END, a);
  assert.ok(a > 0 && b > a, "bloc AUDIT4 introuvable");
  return src.slice(a + "#if POD_RENDER_V1 && POD_CANARY\n".length, b + BLOCK_END.length - "#endif\n".length);
}
function build(mutate: (s: string) => string = (s) => s, lenient = false): string {
  const dir = fs.mkdtempSync(path.join(tmp, "b-"));
  fs.writeFileSync(path.join(dir, "ffl_extract.inc"), mutate(extractBlock()));
  const out = path.join(dir, exeName);
  compileHarness(choice.path!, path.join(root, "consensus-pod", "host", "ffl_harness.cpp"), out, [`-I${dir}`, ...(lenient ? ["-Wno-unused-variable", "-Wno-unused-parameter", "-Wno-unused-function", "-Wno-maybe-uninitialized", "-Wno-empty-body", "-Wno-unused-but-set-variable"] : [])]);
  return out;
}

test("PULLFRAME-PHASE-AUDIT4 (HÔTE) : le code RÉEL contre une flash, un client TLS et des LED simulés — armement, 15 phases, rapport, valeurs aléatoires, écritures interrompues, pannes, journal plein, usure, étanchéité du bloc 7 ; événements bornés et échantillonnés ; appel de read / connected / écriture flash qui ne revient pas = bonne LED allumée", { skip: skipHost }, () => {
  const r = runProcess(build(), [], 60000);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout.trim(), /^PASS \d+$/);
});

test("PULLFRAME-PHASE-AUDIT4 (HÔTE) : CONTRÔLES NÉGATIFS — bloc 0, complément absent, effacement à chaque démarrage, armement sans relecture, journal qui déborde, jeton sans place, LED mal câblées, événements hors fenêtre ou sans plafond : le harnais les REFUSE", { skip: skipHost }, () => {
  const mutants: Array<[string, string, string]> = [
    ["effacement du bloc 0 (les clés)", "rc = df.erase(POD_FFL_BASE, POD_FFL_SIZE);", "rc = df.erase(0, POD_FFL_SIZE);"],
    ["programmation hors du bloc 7", "program(&e, POD_FFL_BASE + p, 1)", "program(&e, p, 1)"],
    ["complément supprimé de l'octet de phase", "return (uint8_t)((n << 4) | ((~n) & 0x0F));", "return (uint8_t)((n << 4) | 0x0F);"],
    ["validation d'octet affaiblie", "return (uint8_t)(b >> 4) == (uint8_t)((~b) & 0x0F);", "return b != 0xFF;"],
    ["en-tête sans complément", " && (uint8_t)(h[4] ^ h[5]) == 0xFF", ""],
    ["effacement à chaque démarrage", "if (hdrOk && (n == 0 || (n == 1 && lastPh == 0))) {", "if (false) {"],
    ["armement sans relecture", "const bool back = rc == 0 && rb == podFfEntry(0);", "const bool back = true;"],
    ["journal qui déborde du bloc", "if (p < POD_FFL_HDR || p >= POD_FFL_SIZE) return;", "if (p < POD_FFL_HDR) return;"],
    ["journal non armé écrit quand même", "if (p < POD_FFL_HDR || p >= POD_FFL_SIZE) return;", "if (p >= POD_FFL_SIZE) return;"],
    ["erreur de programmation sans désactivation", "else g_podFfPos = POD_FFL_SIZE;", ";"],
    ["jeton série sans vérifier la place", "n <= 14 && Serial.availableForWrite() >= 1)", "n <= 14)"],
    ["jeton série pour toutes les phases", "if (n >= 4 && n <= 14 && Serial.availableForWrite() >= 1)", "if (Serial.availableForWrite() >= 1)"],
    ["octet « pile détruite » supprimé", "podFfAppend(0xBD);", "(void)0;"],
    ["lecture sans arrêt au premier octet vierge", "if (b == 0xFF) { end = true; break; }", ""],
    ["effacement jamais vérifié", "rc = df.erase(POD_FFL_BASE, POD_FFL_SIZE);", "df.erase(POD_FFL_BASE, POD_FFL_SIZE); rc = 0;"],
    ["LED F non allumée pendant l'écriture flash", "  podFfLedOn(0);\n", ""],
    ["LED H non allumée avant la phase 10", "  if (n == 10) podFfLedOn(4);\n", ""],
    ["LED H après l'écriture de la phase 10", "  if (n == 10) podFfLedOn(4);\n  podFfAppend(podFfEntry(n));", "  podFfAppend(podFfEntry(n));\n  if (n == 10) podFfLedOn(4);"],
    ["LED R non éteinte après read", "    podFfLedOff(1);\n", ""],
    ["LED C et R confondues", "podFfLedOn(2);", "podFfLedOn(1);"],
    ["LED non éteintes à la marque 15", "  if (n == 15) podFfLedSet(0);\n", ""],
    ["événements hors de la fenêtre 9 -> 10", "    if (g_podFfPhase != 9) return WiFiSSLClient::read(b, n);", "    if (g_podFfPhase == 0) return WiFiSSLClient::read(b, n);"],
    ["plafond d'événements retiré", "  if (g_podFfNE >= POD_FF_EVMAX) return;\n", ""],
    ["échantillonnage retiré", "return k <= 3 || (k & (uint8_t)(k - 1)) == 0;", "return true;"],
    ["temps non plafonné", "(uint8_t)(u > 254UL ? 254UL : u)", "(uint8_t)u"],
    ["événement de sortie perdu", "    if (ev) podFfEv(r > 0 ? 1 : 2);\n", ""],
    ["l'octet de temps lu comme une entrée", "if (wantT) { rt[(uint16_t)(n - 1) % 16] = b; wantT = false; continue; }", ""],
    ["le vrai client n'est plus appelé", "const int r = WiFiSSLClient::read(b, n);", "const int r = 0;"],
  ];
  for (const [name, a, b] of mutants) {
    const base = extractBlock();
    assert.ok(base.split(a).length >= 2, `mutation « ${name} » : motif introuvable`);
    const r = runProcess(build((s) => s.split(a).join(b), true), [], 60000);
    assert.notEqual(r.status, 0, `mutation « ${name} » NON détectée`);
  }
});

test("PULLFRAME-PHASE-AUDIT4 : les quatre autres firmwares R4 et la production ne portent aucune marque ; statiques de canari : huit, hors enregistrement .noinit", () => {
  for (const sk of OTHERS) assert.doesNotMatch(read(`arduino_uno_r4/${sk}/${sk}.ino`), /POD_FF|g_podFf|podFf|FfSSL|DataFlashBlockDevice/, sk);
  const src = read(INO);
  assert.equal((src.match(/^static volatile (?:uint8_t|uint16_t|uint32_t) g_podFf\w+ = 0;$/gm) ?? []).length, 8);
  assert.doesNotMatch(noCanary(src), /POD_FF|g_podFf|podFf|FfSSL|DataFlashBlockDevice/);
});
