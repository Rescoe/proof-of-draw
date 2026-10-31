import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// Correctifs du 31/10/2026 pour le multiscreen BWR + OLED du cousin (multibwr-2.2) : (1) le vote lit le candidat par morceaux (le BWR + OLED redémarrait dans la poignée de main TLS, sans jamais voter) ;
// (2) l'OLED alterne œuvre / température / humidité. Contrôles de TEXTE (le comportement matériel n'a pas été essayé sur la carte).
const root = path.join(__dirname, "..");
const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8").replace(/\r\n/g, "\n");
const ino = read("esp8266/esp_eink_2.9BWR/esp_eink_2.9BWR.ino");
const vote = read("esp8266/_shared/pod_vote_esp.h");

test("vote : lecture par morceaux activée par défaut dans le BWR, appelée à la place de la lecture d'une traite", () => {
  assert.match(ino, /#ifndef POD_VOTE_CHUNK\n#define POD_VOTE_CHUNK 1\n#endif/);
  assert.match(ino, /#if POD_VOTE_CHUNK\n\s+bool ok = podFetchAndCheckChunked\(/);
  assert.match(ino, /#else\n\s+bool ok = podFetchAndCheck\(/);
});

test("vote : fonction par morceaux — tampon TLS réduit, off/len, Content-Length contrôlé, SHA-256 et métriques sur la concaténation", () => {
  const i = vote.indexOf("inline bool podFetchAndCheckChunked(");
  const j = vote.indexOf("inline bool podFetchAndCheck(", i);
  assert.ok(i > 0 && j > i);
  const body = vote.slice(i, j);
  assert.match(body, /client\.setBufferSizes\(POD_VOTE_TLS_RX, 512\)/);
  assert.match(body, /"&off=" \+ String\(\(unsigned\)total\) \+ "&len="/);
  assert.match(body, /http\.getSize\(\) != \(int\)want/);
  assert.match(body, /br_sha256_update\(&sha, chunk, got\)[\s\S]*feeder\.feed\(chunk, got\)/);
  assert.match(body, /useHTTP10\(true\)/);
  assert.doesNotMatch(body, /readBytes\([^)]*want\)/);   // jamais un readBytes() isolé de toute la taille
  assert.match(vote, /POD_VOTE_CHUNK_LEN 2368u/);
});

test("OLED multiscreen : pages température / humidité entre les œuvres, animation relancée de l'image 0, image fixe nouvelle remet les pages à zéro", () => {
  assert.match(ino, /static void podoaSensorPage\(uint8_t page\)/);
  assert.match(ino, /static bool podoaPages\(uint32_t now\)/);
  assert.match(ino, /s\.pl\.reset\(s\.info\); s\.playing = true;/);
  assert.match(ino, /#if POD_MULTI_OLED\n\s+if \(podoaPages\(now\)\) return;\n#endif/);
  assert.match(ino, /s\.holdUntilMs = millis\(\) \+ 300000UL; s\.pg = 0;/);
  // tout le code des pages est sous POD_MULTI_OLED (le firmware non multiscreen reste celui d'avant)
  const a = ino.indexOf("static const uint32_t PODOA_PAGE_MS");
  const before = ino.slice(0, a);
  assert.ok(before.lastIndexOf("#if POD_MULTI_OLED") > before.lastIndexOf("#endif"));
});
