// Produit complet R4 : UNO R4 WiFi + TFT 1,8″ + vote v2 + capteurs + OTA (26/10/2026). COMPILÉ seulement : propriétés STATIQUES du firmware (jamais flashé) + cohérence avec le serveur.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { voteV2Capable } from "../lib/voteCapability";

const root = path.join(__dirname, "..");
const D = path.join(root, "arduino_uno_r4/pod_uno_r4_tft18_env");
const rd = (...p: string[]) => fs.readFileSync(path.join(...p), "utf8").replace(/\r\n/g, "\n");
const ino = rd(D, "pod_uno_r4_tft18_env.ino");
const code = ino.replace(/\/\/[^\n]*/g, "");

/** Nom de la fonction (ou du lambda enveloppant) contenant la ligne i : dernière définition de fonction de niveau 0 rencontrée. */
function functionAt(lines: string[], i: number): string {
  for (let k = i; k >= 0; k--) { const m = /^(?:static\s+)?(?:inline\s+)?(?:[A-Za-z_][\w:<>*&]*\s+)+(?:__attribute__\(\([^)]*\)\)\s+)?(\w+)\s*\([^;]*\)\s*(?:const\s*)?\{\s*$/.exec(lines[k]); if (m && !/^\s/.test(lines[k])) return m[1]; }
  return "";
}

test("ENV R4 : copies identiques — pile réseau / Ed25519 / HTTP / TLS borné / capteurs / OTA (station) et vote / rendu / métriques (TFT 1,8″ d'origine)", () => {
  for (const f of ["podNetStack.h", "podEdStack.h", "pod_http.h", "pod_ssl_bounded.h", "dht22.h", "sgp40.h", "podOtaR4.h", "pod_ota_r4_client.h"]) assert.equal(rd(D, f), rd(root, "arduino_uno_r4/pod_uno_r4_station", f), `station/${f}`);
  for (const f of ["consensusPoD.h", "crypto_uno_r4.h", "podRender.h", "podRenderStream.h", "pod_metrics.h", "pod_metrics_table.h", "pod_vote_r4.h"]) assert.equal(rd(D, f), rd(root, "arduino_uno_r4/pod_uno_r4_tft18", f), `tft18/${f}`);
});

test("ENV R4 : tout est ÉTEINT par défaut (capteurs, OTA, rendu v1) ; version r4tft18-2.0 capable de voter (comptée dans le quorum)", () => {
  assert.match(ino, /#ifndef POD_SENSORS\n#define POD_SENSORS 0/);
  assert.match(ino, /#ifndef POD_OTA_R4\n#define POD_OTA_R4 0/);
  assert.match(ino, /#ifndef POD_RENDER_V1\n#define POD_RENDER_V1 0/);
  const v = /#ifndef FIRMWARE_VERSION\n#define FIRMWARE_VERSION\s+"([^"]+)"/.exec(ino);
  assert.ok(v && voteV2Capable(v[1]), `FIRMWARE_VERSION ${v?.[1]} doit être capable de voter (lib/voteCapability.ts)`);
  assert.match(ino, /#define SCREEN_TYPE\s+"tft18"/);
});

test("ENV R4 : TOUT le JSON est décodé sur la pile de travail (4 deserializeJson : register 1, pull 2, validate 1), TLS borné, aucun appel Wi-Fi direct", () => {
  const lines = code.split("\n"); const where: string[] = [];
  lines.forEach((l, i) => { if (/\bdeserializeJson\(/.test(l)) where.push(functionAt(lines, i)); });
  assert.deepEqual(where.sort(), ["pullParseWork", "pullParseWork", "registerParseWork", "validateParseWork"]);
  assert.ok(code.indexOf("#define WiFiSSLClient PodBoundedSSL") > 0 && code.indexOf("#define WiFiSSLClient PodBoundedSSL") < code.indexOf("struct Conn {"));
  const direct = lines.filter((l) => /\bWiFi\.\w+\(/.test(l)).filter((l) => /auto wx = /.test(l) === false);
  assert.deepEqual(direct.map((l) => l.trim()), [], "tout appel WiFi.* est dans une enveloppe podWifiRun (auto wx = …)");
  assert.equal(/\bSerial\.(print|write)/.test(code.replace(/static void logfEmit[\s\S]*?\n}\n/, "")), false, "Serial.print direct interdit hors logfEmit");
});

test("ENV R4 : l'affichage TFT n'est atteint que depuis la pile de travail (enveloppes), le flux de l'image ou setup()", () => {
  const lines = code.split("\n");
  const allowed = new Set(["tftStatusImpl", "drawCartelImpl", "displayKeyMaterialOnceImpl", "displayOnboardingQRImpl", "streamFrame", "podStreamFrame", "setup"]);
  lines.forEach((l, i) => { if (/\btft\.\w+\(/.test(l) && !/^Adafruit_ST7735 tft/.test(l)) { const f = functionAt(lines, i); assert.ok(allowed.has(f), `tft.* dans ${f || "?"} : ${l.trim()}`); } });
  for (const w of ["tftStatus", "drawCartel", "displayKeyMaterialOnce", "displayOnboardingQR"]) {
    const i = code.indexOf(`) ${w}(`);                                   // enveloppe « static void __attribute__((noinline)) w(...) { PodNetInfo ni; auto wk = [&]() { wImpl(... »
    assert.ok(i > 0, `enveloppe ${w}`);
    const line = code.slice(i, code.indexOf("\n", i));
    assert.ok(line.includes("PodNetInfo ni; auto wk = [&]() { " + w + "Impl(") && line.includes("podWorkRun(wk, &ni)"), `${w} passe par podWorkRun`);
  }
  assert.match(ino, /#define POD_NET_STACK_TOTAL 3072u/);
});

test("ENV R4 : la voie du vote lit le candidat dans une transaction FERMÉE avant de signer (PodEd), jamais l'inverse ; ACK après affichage", () => {
  const n = code.indexOf("netReadCandidate(candidateId, kind, bytes, chk);"), s = code.indexOf("PodEd::sign(sig, privateKey, publicKey", n);
  assert.ok(n > 0 && s > n, "lecture du candidat puis signature");
  assert.match(code, /auto tx = \[&\]\(\) \{\s*Conn c\(HTTP_TIMEOUT_MS\);\s*const int code = c\.request\("GET", String\("\/api\/candidate-frame/);
  const fetch = code.slice(code.indexOf("static bool doFetchFrame"));
  assert.ok(fetch.indexOf("ackFrame(frameId)") > fetch.indexOf("lastFrameId = frameId"), "ACK après l'affichage");
});

test("ENV R4 : l'enregistrement déclare les capteurs seulement avec POD_SENSORS, jamais ne se déclare « sensor » ; les grandeurs existent côté serveur", async () => {
  assert.match(ino, /#if POD_SENSORS\n#define SENSORS_JSON ",\\"sensors\\":\[\\"temp\\",\\"hum\\",\\"voc\\",\\"rssi\\",\\"lat\\",\\"dl\\"\]"\n#else\n#define SENSORS_JSON ""/);
  const { MEASURE_KINDS } = await import("../lib/measures");
  for (const k of ["temp", "hum", "voc", "rssi", "lat", "dl"]) assert.ok((MEASURE_KINDS as Record<string, unknown>)[k], k);
});

test("ENV R4 : OTA dans la famille uno-r4-wifi-tft18, chemin /firmware-r4/tft18/<canal>/ (fichiers statiques), clés/secrets/drapeaux de banc ignorés par git", () => {
  assert.match(ino, /#define OTAR4_FAMILY "uno-r4-wifi-tft18"\n\s+#define OTAR4_KIND "tft18"/);
  const gi = rd(root, ".gitignore");
  for (const p of ["arduino_uno_r4/**/pod_ota_r4_keys.h", "arduino_uno_r4/**/pod_build_flags.h", "arduino_uno_r4/**/pod_lab_ca.h", "arduino_uno_r4/**/secrets.h"]) assert.ok(gi.includes(p), p);
  assert.match(rd(D, "pod_ota_r4_client.h"), /#define OTAR4_BASE "\/firmware-r4\/" OTAR4_KIND "\/" OTAR4_CHANNEL/);
});
