import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// 01/11/2026 : le multiscreen (ESP8266 + e-ink 2,7″ + OLED) lit le candidat à voter par morceaux, comme le BWR + OLED (multibwr-2.2). Contrôles de TEXTE : le comportement n'a pas été essayé sur la carte.
const root = path.join(__dirname, "..");
const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8").replace(/\r\n/g, "\n");
const ino = read("esp8266/esp_eink_2.7BW_OLED/esp_eink_2.7BW_OLED.ino");
const shared = read("esp8266/_shared/pod_vote_esp.h");
const local = read("esp8266/esp_eink_2.7BW_OLED/pod_vote_esp.h");

test("multiscreen : lecture par morceaux activée par défaut et appelée à la place de la lecture d'une traite", () => {
  assert.match(ino, /#ifndef POD_VOTE_CHUNK\n#define POD_VOTE_CHUNK 1\n#endif/);
  assert.match(ino, /#if POD_VOTE_CHUNK\n\s+bool ok = podFetchAndCheckChunked\(/);
  assert.match(ino, /#else\n\s+bool ok = podFetchAndCheck\(/);
});

test("multiscreen : la copie locale de pod_vote_esp.h est celle du socle (morceaux, espaces de travail statiques)", () => {
  assert.equal(local, shared);
  assert.match(local, /static PodFeeder feeder;/);
  assert.match(local, /static br_sha256_context sha;/);
});

test("multiscreen : marqueur « Wi-Fi hors binaire » présent et lu au démarrage (contrôle de publication fermé)", () => {
  assert.match(ino, /static const char kPodWifiMarker\[\] PROGMEM __attribute__\(\(used\)\) = "PODWIFI:record-v1";/);
  assert.match(ino, /Serial\.println\(F\("\\n\[BOOT\] Proof-of-Draw multiscreen v2\.0"\)\);\n#if POD_WIFI_FROM_RECORD\n\s+Serial\.print\(F\("\[WIFI\] mode: "\)\); Serial\.println\(FPSTR\(kPodWifiMarker\)\);/);
});

test("outil de build : le contrôle Wi-Fi fermé s'applique à toutes les cibles (plus seulement au BWR)", () => {
  const b = read("ota-lab/esp8266-canary/tools/build-bwr.mjs");
  assert.match(b, /if \(!MIG\) \{\n\s+const r = checkImage\(bin, defaultForbidden\(ROOT\)\);/);
  assert.doesNotMatch(b, /\(arg\("--target"\) \?\? "bwr"\) === "bwr"\) \{/);
});
