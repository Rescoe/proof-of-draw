// tests/tft28RegisterStack.test.ts — LOT8B2D-R4-TFT28-REGISTER-STACK-FIX2 : doRegister du UNO R4 + TFT 2,8″ découpé en phases noinline (la marge principale matérielle était de 108 o < 128 o au retour de doRegister).
// Preuves STATIQUES (structure, ordre, échec fermé, mutants). Le comportement exécuté est dans tests/tft28Host.test.ts (section « 17b »). Rien ici ne prouve une marge sur la carte.
import test from "node:test";
import assert from "node:assert/strict";
import { INO, effective, fnBody, readText, stripBlock, stripHooks, stripLine } from "./helpers/tft28Source";

const src = readText(INO);
const prod = stripHooks(effective(src, false)), can = stripHooks(effective(src, true));
const code = (s: string) => stripBlock(stripLine(s));
const body = (s: string, head: string) => code(fnBody(s, head));

const HEADS = {
  readMac: "static bool __attribute__((noinline)) registerReadMac() {",
  build: "static void __attribute__((noinline)) registerBuildBody(String& body) {",
  post: "static int __attribute__((noinline)) registerPost(String& resp) {",
  exchange: "static uint8_t __attribute__((noinline)) registerExchange() {",
  log: "static void __attribute__((noinline)) registerLog() {",
  status: "static void __attribute__((noinline)) registerStatusOnDedicatedStack(",
  onboarding: "static void __attribute__((noinline)) registerShowOnboarding() {",
  failure: "static void __attribute__((noinline)) registerShowFailure() {",
  connected: "static void __attribute__((noinline)) registerShowConnected() {",
  doReg: "static bool doRegister() {",
};

/** Violations de structure (liste vide = conforme). */
function violations(s: string): string[] {
  const v: string[] = [];
  for (const [k, h] of Object.entries(HEADS)) if (!s.includes(h)) v.push(`fonction absente ou sans noinline : ${k}`);
  const dr = body(s, HEADS.doReg), ex = body(s, HEADS.exchange), po = body(s, HEADS.post), bb = body(s, HEADS.build), co = body(s, HEADS.connected), st = code(fnBody(s, HEADS.status)), rm = body(s, HEADS.readMac);
  // doRegister : fin driver, aucun objet String, aucune requête, aucun dessin direct
  if (/\bString\b|httpCall|macString|tft\.|tftStatus|bytesToHex|loadOwnedHashesJson/.test(dr)) v.push("doRegister n'est plus un simple pilote (String, requête, dessin ou corps)");
  const iEx = dr.indexOf("registerExchange()"), iLog = dr.indexOf("registerLog()"), iOn = dr.indexOf("registerShowOnboarding()"), iCo = dr.indexOf("registerShowConnected()"), iFa = dr.indexOf("registerShowFailure()");
  if (!(iFa > iEx && iEx >= 0 && iLog > iFa && iOn > iLog && iCo > iOn)) v.push("doRegister : ordre attendu échange -> (échec HTTP) -> journal -> écran");
  if (!/x == REGX_HTTP\)\s*\{\s*registerShowFailure\(\);\s*return false;\s*\}\s*if \(x != REGX_OK\) return false;/.test(dr)) v.push("doRegister : l'échec HTTP affiche l'échec, tout autre résultat non valide retourne false SANS suite");
  if (!/return true;\s*$/.test(dr.replace(/\}\s*$/, "").trim() + "")) v.push("doRegister : doit finir par return true");
  // échange : MAC -> transaction -> décodage, état inscrit seulement par doRegisterDecode
  const iMac = ex.indexOf("registerReadMac()"), iPost = ex.indexOf("registerPost(resp)"), iDec = ex.indexOf("doRegisterDecode(resp)");
  if (!(iMac >= 0 && iPost > iMac && iDec > iPost)) v.push("registerExchange : ordre attendu MAC -> requête -> décodage");
  if (!/if \(!registerReadMac\(\)\) \{[^}]*return REGX_NO_MAC;/.test(ex)) v.push("registerExchange : MAC absente => REGX_NO_MAC sans requête");
  if (!/registerPost\(resp\) != 200\) return REGX_HTTP;/.test(ex) || !/!doRegisterDecode\(resp\)\) return REGX_DECODE;/.test(ex)) v.push("registerExchange : HTTP != 200 et décodage refusé doivent retourner AVANT toute suite");
  for (const tok of ["deviceId =", "pairCode =", "paired =", "registered =", "tft", "logf(\"[REGISTER] deviceId"]) if (ex.includes(tok)) v.push(`registerExchange contient « ${tok} »`);
  // corps : ajouts successifs (pas de concaténation operator+ en chaîne), objets nés et morts dans la phase
  if (/"\s*\+\s*\(|\)\s*\+\s*"/.test(bb) || /\+ mac \+/.test(bb)) v.push("registerBuildBody : concaténation en chaîne (temporaires empilés) au lieu d'ajouts successifs");
  if (!bb.includes("body.reserve(") || !bb.includes("g_regMac")) v.push("registerBuildBody : réservation unique et MAC lue dans g_regMac");
  if (!/\{\s*String body;\s*registerBuildBody\(body\);\s*return httpCall\("POST", "\/api\/register", &body, resp\);/.test(po)) v.push("registerPost : le corps naît et MEURT dans cette phase (aucun corps ne survit à la requête)");
  if (!/g_regMac\[0\] = '\\0';/.test(rm)) v.push("registerReadMac : g_regMac doit être vidé avant toute lecture (échec => vide)");
  // écran « Connecte » : pile dédiée, jamais tftStatus direct
  if (!/onSd\("registerConnected", w\)/.test(co) || /(^|[^\w])tftStatus\([^)]*\);\s*$/.test(co.replace(/auto w[^;]*;/, ""))) v.push("registerShowConnected : l'écran doit passer par onSd");
  if (!/onSd\("registerStatus", w\)/.test(st)) v.push("registerStatusOnDedicatedStack : doit passer par onSd");
  // aucun dessin direct hors du parcours non appairé
  const allReg = [ex, po, bb, rm, code(fnBody(s, HEADS.log)), body(s, HEADS.failure)].join("\n");
  if (/tft\.|tftStatus\(/.test(allReg)) v.push("une phase non-écran dessine directement sur la pile principale");
  // parcours non appairé : inchangé (clés une seule fois puis QR) ; onboarding jamais sous onSd (chemin d'avant)
  const on = body(s, HEADS.onboarding);
  if (!/if \(!onboardingAlreadyShown\(\)\) \{\s*displayKeyMaterialOnce\(\);\s*displayOnboardingTFT\(String\("https:\/\/" SERVER_HOST "\/onboard\?code="\) \+ pairCode, pairCode, mac\);\s*setOnboardingShown\(\);\s*\} else \{\s*displayOnboardingTFT\(/.test(on)) v.push("parcours non appairé modifié");
  // aucun vote / aucun effet de bord réseau supplémentaire
  if (/validat|vote|candidate|ack-frame|pull/.test(code(fnBody(s, HEADS.exchange) + fnBody(s, HEADS.post)))) v.push("route inattendue dans l'inscription");
  return v;
}

for (const [name, s] of [["production", prod], ["canari", can]] as const) {
  test(`REGISTER-STACK-FIX2 (${name}) : doRegister = pilote, phases noinline, écran « Connecte » sur la pile dédiée, parcours non appairé conservé`, () => {
    assert.deepEqual(violations(s), []);
  });
}

test("REGISTER-STACK-FIX2 : MUTANTS — chaque régression structurelle est REFUSÉE", () => {
  const mut: Array<[string, (t: string) => string]> = [
    ["écran « Connecte » redevenu direct sur la pile principale", (t) => t.replace('onSd("registerConnected", w);', "w();")],
    ["écran d'échec redevenu direct", (t) => t.replace('onSd("registerStatus", w);', "w();")],
    ["corps reconstruit par concaténation en chaîne", (t) => t.replace('body += "{\\"mac\\":\\""; body += g_regMac;', 'body = "{\\"mac\\":\\"" + String(g_regMac) + "\\"";')],
    ["corps conservé après la requête (déclaré dans l'échange)", (t) => t.replace("  String body;\n  registerBuildBody(body);\n  return httpCall", "  static String body;\n  registerBuildBody(body);\n  return httpCall")],
    ["décodage après affichage (ordre inversé)", (t) => t.replace("  if (!doRegisterDecode(resp)) return REGX_DECODE;\n  return REGX_OK;", "  return REGX_OK;")],
    ["suite sur MAC absente", (t) => t.replace("return REGX_NO_MAC; }", "}")],
    ["suite sur HTTP non 200", (t) => t.replace("if (registerPost(resp) != 200) return REGX_HTTP;", "registerPost(resp);")],
    ["suite sur décodage refusé", (t) => t.replace("if (x != REGX_OK) return false;", "")],
    ["journal avant l'échange", (t) => t.replace("  const uint8_t x = registerExchange();", "  registerLog();\n  const uint8_t x = registerExchange();")],
    ["phase sans noinline", (t) => t.replace("static int __attribute__((noinline)) registerPost(", "static int registerPost(")],
    ["état inscrit par l'échange", (t) => t.replace("  String resp;\n  if (registerPost(resp)", "  registered = true;\n  String resp;\n  if (registerPost(resp)")],
    ["dessin direct dans une phase réseau", (t) => t.replace("  String resp;\n  if (registerPost(resp)", "  tft.fillScreen(0);\n  String resp;\n  if (registerPost(resp)")],
    ["onboarding sans clés au premier démarrage", (t) => t.replace("    displayKeyMaterialOnce();\n    displayOnboardingTFT", "    displayOnboardingTFT")],
    ["vote dans l'inscription", (t) => t.replace('  if (registerPost(resp) != 200) return REGX_HTTP;', '  httpCall("POST", "/api/validation-result", nullptr, resp);\n  if (registerPost(resp) != 200) return REGX_HTTP;')],
  ];
  for (const [label, f] of mut) {
    const m = f(prod);
    assert.notEqual(m, prod, `le mutant « ${label} » n'a rien changé (motif de remplacement obsolète)`);
    assert.notDeepEqual(violations(m), [], `mutant NON refusé : ${label}`);
  }
});
