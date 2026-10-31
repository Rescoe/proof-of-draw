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
  const a = ino.indexOf("static void podoaSensorPage(uint8_t page)");
  const before = ino.slice(0, a);
  assert.ok(before.lastIndexOf("#if POD_MULTI_OLED") > before.lastIndexOf("#endif"));
});

test("audit 31/10 : espaces de travail du vote par morceaux STATIQUES (pile cont de 4 Ko), pile mesurée, mutants refusés", () => {
  const i = vote.indexOf("inline bool podFetchAndCheckChunked(");
  const body = vote.slice(i, vote.indexOf("inline bool podFetchAndCheck(", i));
  assert.match(body, /static PodFeeder feeder;/);
  assert.match(body, /static br_sha256_context sha;/);
  assert.match(body, /static uint8_t chunk\[\d+\];/);
  assert.match(body, /static uint8_t digest\[32\];/);
  assert.equal((body.match(/getFreeContStack\(\)/g) ?? []).length >= 3, true, "pile cont journalisée avant le GET, à chaque morceau et à la fin");
  // mutants : un objet lourd redevenu local doit être détecté
  for (const [name, from, to] of [["feeder", "static PodFeeder feeder;", "PodFeeder feeder;"], ["sha", "static br_sha256_context sha;", "br_sha256_context sha;"], ["chunk", /static uint8_t chunk\[\d+\];/, "uint8_t chunk[128];"]] as Array<[string, string | RegExp, string]>) {
    const mutated = body.replace(from, to);
    assert.notEqual(mutated, body, name);
    assert.doesNotMatch(mutated, name === "feeder" ? /static PodFeeder feeder;/ : name === "sha" ? /static br_sha256_context sha;/ : /static uint8_t chunk\[\d+\];/, name);
  }
});

test("audit 31/10 : le premier cycle OLED commence par l'animation (nextPagesMs initialisé à l'activation d'un clip, au démarrage ET à l'acquisition)", () => {
  const begin = ino.slice(ino.indexOf("static void podoaBegin()"), ino.indexOf("static bool podoaAcquire()"));
  assert.match(begin, /s\.pg = 0; s\.nextPagesMs = millis\(\) \+ podoa::ART_MS;/);
  const acq = ino.slice(ino.indexOf("static bool podoaAcquire()"), ino.indexOf("static void podoaSensorScreen()"));
  assert.match(acq, /s\.pg = 0; s\.nextPagesMs = millis\(\) \+ podoa::ART_MS;/);
});

// Modèle COMPORTEMENTAL : la VRAIE fonction podoaPages() du sketch est extraite et compilée (g++) avec des doublures ; on rejoue le cycle sur une horloge simulée.
test("cycle OLED (vraie fonction compilée sur l'hôte) : animation 30 s, température 6 s, humidité 6 s, reprise à l'image 0, puis recommence", () => {
  const start = ino.indexOf("static bool podoaPages(uint32_t now) {");
  let depth = 0, end = start;
  for (let k = ino.indexOf("{", start); k < ino.length; k++) { if (ino[k] === "{") depth++; else if (ino[k] === "}") { depth--; if (depth === 0) { end = k + 1; break; } } }
  const fn = ino.slice(start, end);
  const cpp = `#include <cstdint>\n#include <cstdio>\nstruct Info {}; struct Pl { int resets = 0; void reset(const Info&) { resets++; } };\n` +
    `namespace podoa { static const uint32_t PAGE_MS = 6000UL; static const uint32_t ART_MS = 30000UL; struct St { bool haveRead = true, on = true, playing = true; uint8_t pg = 0; uint32_t pageUntilMs = 0, nextPagesMs = 30000, holdUntilMs = 0; Info info; Pl pl; }; static St g; }\n` +
    `static void podoaSensorPage(uint8_t p) { std::printf("page %d\\n", p); }\n${fn}\n` +
    `int main() { uint32_t t = 0; for (; t <= 90000; t += 500) { bool shown = podoaPages(t); std::printf("t=%u shown=%d pg=%d playing=%d resets=%d\\n", t, shown, podoa::g.pg, podoa::g.playing, podoa::g.pl.resets); } return 0; }\n`;
  const dir = fs.mkdtempSync(path.join(require("os").tmpdir(), "podoa-"));
  fs.writeFileSync(path.join(dir, "m.cpp"), cpp);
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const cp = require("child_process") as typeof import("child_process");
  cp.execFileSync("g++", ["-std=c++17", "-o", path.join(dir, "m"), path.join(dir, "m.cpp")]);
  const out: string[] = cp.execFileSync(path.join(dir, "m"), { encoding: "utf8" }).split(/\r?\n/).filter(Boolean);
  const at = (t: number) => out.find((l) => l.startsWith(`t=${t} `))!;
  assert.match(at(29500), /shown=0 pg=0 playing=1/);            // 30 s d'animation
  assert.match(at(30000), /shown=1 pg=1 playing=0/);            // température
  assert.match(at(35500), /shown=1 pg=1/);
  assert.match(at(36000), /shown=1 pg=2/);                      // humidité
  assert.match(at(41500), /shown=1 pg=2/);
  assert.match(at(42000), /shown=0 pg=0 playing=1 resets=1/);   // reprise à l'image 0
  assert.match(at(71500), /shown=0 pg=0/);                      // 30 s d'animation à nouveau
  assert.match(at(72000), /shown=1 pg=1/);
  assert.equal(out.filter((l) => l.startsWith("page ")).slice(0, 4).join(","), "page 1,page 2,page 1,page 2");
});
