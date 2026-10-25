// tests/r4PortalHeader.test.ts — portail Wi-Fi UNO R4 : l'en-tête HTTP ne doit jamais être tronqué (essai du 25/10/2026 : tampon de 260 o pour un en-tête de 284 o => la CSP était coupée, la ligne vide
// qui termine les en-têtes n'arrivait jamais, le navigateur affichait une page blanche).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const src = fs.readFileSync(path.join(__dirname, "..", "arduino_uno_r4", "pod_uno_r4_eink29", "pod_wifi_portal_r4.h"), "utf8");
const jsHash = /POD_PORTAL_JS_SHA256 "([^"]+)"/.exec(fs.readFileSync(path.join(__dirname, "..", "arduino_uno_r4", "pod_uno_r4_eink29", "pod_wifi_portal.h"), "utf8"))?.[1] ?? "";

test("l'en-tête du portail R4 tient dans son tampon, avec une marge, pour les codes 200 et 409", () => {
  const fn = src.slice(src.indexOf("static void __attribute__((noinline)) sendHeader("), src.indexOf("static void __attribute__((noinline)) sendText("));
  const buf = Number(/char h\[(\d+)\]/.exec(fn)?.[1]);
  assert.ok(buf >= 300, "tampon d'en-tête : " + buf);
  const fmt = /snprintf\(h, sizeof h, "((?:[^"\\]|\\.)*)"\s*POD_PORTAL_JS_SHA256\s*"((?:[^"\\]|\\.)*)"/.exec(fn);
  assert.ok(fmt, "format de l'en-tête introuvable");
  const text = (fmt![1] + jsHash + fmt![2]).replace(/\\r/g, "\r").replace(/\\n/g, "\n").replace(/%d/, "200").replace(/%s/, "OK");
  assert.ok(text.endsWith("\r\n\r\n"), "l'en-tête se termine par une ligne vide");
  assert.ok(text.length < buf - 20, `en-tête ${text.length} o dans un tampon de ${buf} o`);
  assert.ok(text.length > 259, "garde-fou du test : l'ancien tampon de 260 o aurait tronqué cet en-tête");
  assert.match(fn, /hn >= \(int\)sizeof h\) return;/, "jamais d'en-tête tronqué envoyé");
});
