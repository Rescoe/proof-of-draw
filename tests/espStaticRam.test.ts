import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// ESP8266 : 80 Ko de RAM au total. Chaque octet STATIQUE (.bss, .data, chaînes littérales non PROGMEM) est un octet de TAS en moins ; BearSSL (TLS) a besoin d'environ 35 Ko après le Wi-Fi.
// Le 06/10/2026, deux tampons « statiques » (5 808 + 1 024 o) ajoutés pour éviter la fragmentation ont fait passer le multiscreen de 39 420 à 47 160 o statiques : 30 Ko de tas, TLS impossible
// ([HTTP POST] /api/register → -1 puis Exception 29). Voir docs/NOTE_MULTISCREEN_TAS_2026_10_06.md.
const root = path.join(__dirname, "..");
const SKETCHES = [
  "esp8266/esp_eink_2.7BW_OLED/esp_eink_2.7BW_OLED.ino",
  "esp8266/esp_tft1.8/esp_tft1.8.ino",
  "esp8266/esp_eink_2.9BWR/esp_eink_2.9BWR.ino",
  "esp8266/esp_eink_2.7BW/esp_eink_2.7BW.ino",   // e-ink 2,7" SEUL (eink27bw-2.1, Lot 0S) : RAM statique mesurée à la compilation du 06/10/2026 = 34 240 o (≤ 40 000)
];
const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8");

// tampon statique d'au moins 2 000 octets (taille numérique, ou macro d'image complète) — hors commentaires
// `merged[BUF_SIZE]` du 2,9" est dans computeComplexityScore(), code mort retiré par l'éditeur de liens (absent du .elf) : toléré.
const BIG_STATIC = /^\s*static\s+(?:const\s+)?(?:uint8_t|uint16_t|char)\s+\w+\s*\[\s*(?:E27_BUF_SIZE|TFT_BUF_SIZE|BUF_SIZE|\d{4,}|\(\d+\s*\*\s*\d+\)\s*\/\s*8)\s*\]/;

for (const sketch of SKETCHES) {
  test(`${sketch} : aucun gros tampon statique (tampons d'image : malloc APRÈS le TLS, ou flash)`, () => {
    const offenders = read(sketch).split(/\r?\n/).map((line, i) => ({ line, n: i + 1 })).filter(({ line }) => !/^\s*\/\//.test(line) && BIG_STATIC.test(line) && !/\bmerged\[/.test(line));
    assert.deepEqual(offenders.map((o) => `${sketch}:${o.n} ${o.line.trim()}`), [], "un gros tampon statique réduit le tas sous ce que demande le TLS");
  });
}

// Seuls le multiscreen et le TFT 1,8" ont été migrés vers F()/PSTR(). Le 2,9" et le 2,7" seul gardent des messages Serial en RAM : leur RAM statique reste ≤ 40 000 o
// (relevé de compilation) mais NE PAS y ajouter de tampon : voir « Variables and constants in RAM » à chaque changement (CLAUDE.md, règle 8).
test("multiscreen et TFT 1,8\" : les messages Serial sont en mémoire flash (F() / PSTR()), pas en RAM", () => {
  for (const sketch of SKETCHES.slice(0, 2)) {
    const lines = read(sketch).split(/\r?\n/).filter((l) => !/^\s*\/\//.test(l));
    const ram = lines.filter((l) => /Serial\.(?:println|print)\(\s*"[^"]*"\s*\)/.test(l) || /Serial\.printf\(\s*"/.test(l));
    assert.deepEqual(ram.map((l) => l.trim().slice(0, 80)), [], `${sketch} : messages Serial encore en RAM`);
  }
});

test("le multiscreen télécharge l'image e-ink dans la flash puis alloue le tampon APRÈS la fermeture du TLS", () => {
  const src = read("esp8266/esp_eink_2.7BW_OLED/esp_eink_2.7BW_OLED.ino");
  assert.ok(src.includes('LittleFS.open(E27_TMP, "w")'), "écriture du flux dans un fichier");
  assert.ok(src.indexOf("// TLS fermé : le tas est de nouveau disponible") < src.indexOf("e27Buf = (uint8_t*)malloc(E27_BUF_SIZE);           // APRÈS le TLS"), "malloc après le TLS");
});
