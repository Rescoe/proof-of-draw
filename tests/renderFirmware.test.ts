import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { compileHarness, describeChoice, findCompiler, runProcess } from "./helpers/cppHarness";

// Lot 8B-2A — INTÉGRATION INACTIVE du noyau de rendu en flux dans QUATRE firmwares canaris (ESP8266 e-ink 2,9″ BWR, ESP8266 TFT 1,8″, UNO R4 e-ink 2,9″ BWR, UNO R4 TFT 1,8″).
// Compilés seulement (arduino-cli, chemin désactivé puis activé) ; JAMAIS flashés, JAMAIS essayés sur une carte. Garantie testée ici : avec POD_RENDER_V1 = 0 (défaut), chaque firmware et chaque pilote modifié
// sont, au texte près (lignes vides ignorées), IDENTIQUES à la sauvegarde d'avant le lot — le chemin d'avant n'a donc pas changé.
const root = path.join(__dirname, "..");
const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8").replace(/\r\n/g, "\n");
const BACKUP = "firmware-backups/2026-10-08_avant-rendu-v1-canaris";

const SKETCHES: Array<{ name: string; ino: string; backup: string; drivers: Array<[string, string]>; crypto: string; family: "esp" | "r4" }> = [
  { name: "ESP8266 e-ink 2,9″", ino: "esp8266/esp_eink_2.9BWR/esp_eink_2.9BWR.ino", backup: `${BACKUP}/esp_eink_2.9BWR/esp_eink_2.9BWR.ino`,
    drivers: [["esp8266/esp_eink_2.9BWR/epd2in9b_V4.h", `${BACKUP}/esp_eink_2.9BWR/epd2in9b_V4.h`], ["esp8266/esp_eink_2.9BWR/epd2in9b_V4.cpp", `${BACKUP}/esp_eink_2.9BWR/epd2in9b_V4.cpp`]], crypto: "crypto_esp8266.h", family: "esp" },
  { name: "ESP8266 TFT 1,8″", ino: "esp8266/esp_tft1.8/esp_tft1.8.ino", backup: `${BACKUP}/esp_tft1.8/esp_tft1.8.ino`, drivers: [], crypto: "crypto_esp8266.h", family: "esp" },
  { name: "UNO R4 e-ink 2,9″", ino: "arduino_uno_r4/pod_uno_r4_eink29/pod_uno_r4_eink29.ino", backup: `${BACKUP}/pod_uno_r4_eink29/pod_uno_r4_eink29.ino`,
    drivers: [["arduino_uno_r4/pod_uno_r4_eink29/epd29b.h", `${BACKUP}/pod_uno_r4_eink29/epd29b.h`]], crypto: "crypto_uno_r4.h", family: "r4" },
  { name: "UNO R4 TFT 1,8″", ino: "arduino_uno_r4/pod_uno_r4_tft18/pod_uno_r4_tft18.ino", backup: `${BACKUP}/pod_uno_r4_tft18/pod_uno_r4_tft18.ino`, drivers: [], crypto: "crypto_uno_r4.h", family: "r4" },
];

/** Vue « POD_RENDER_V1 = 0 » : retire les blocs balisés POD_RENDER_V1_BEGIN / _END, évalue les `#if POD_RENDER_V1` / `#if !POD_RENDER_V1` (autres conditionnelles conservées telles quelles), ignore les lignes vides. */
function offView(src: string): string {
  const noMarked = src.replace(/\n?\/\/ POD_RENDER_V1_BEGIN[\s\S]*?\/\/ POD_RENDER_V1_END\n?/g, "\n");
  const out: string[] = [];
  const stack: Array<{ ours: boolean; active: boolean }> = [];
  const keep = () => stack.every((s) => !s.ours || s.active);
  for (const line of noMarked.split("\n")) {
    const t = line.trim();
    if (/^#if\s+POD_RENDER_V1\b/.test(t)) { stack.push({ ours: true, active: false }); continue; }
    if (/^#if\s+!POD_RENDER_V1\b/.test(t)) { stack.push({ ours: true, active: true }); continue; }
    if (/^#(if|ifdef|ifndef)\b/.test(t)) { stack.push({ ours: false, active: true }); if (keep()) out.push(line); continue; }
    const top = stack[stack.length - 1];
    if (/^#else\b/.test(t) && top?.ours) { top.active = !top.active; continue; }
    if (/^#endif\b/.test(t)) { const s = stack.pop(); if (s && !s.ours && keep()) out.push(line); continue; }
    if (keep()) out.push(line);
  }
  return out.map((l) => l.replace(/\s+$/, "")).filter((l) => l.length > 0).join("\n");
}
const plain = (src: string) => src.split("\n").map((l) => l.replace(/\s+$/, "")).filter((l) => l.length > 0).join("\n");

for (const s of SKETCHES) {
  test(`${s.name} : POD_RENDER_V1 vaut 0 par défaut, le noyau n'est inclus QUE si 1, et la vue « chemin désactivé » est IDENTIQUE au firmware d'avant le lot`, () => {
    const src = read(s.ino);
    assert.match(src, /#ifndef POD_RENDER_V1\n#define POD_RENDER_V1 0\n#endif/);
    assert.match(src, /#ifndef POD_RENDER_MODE_DEFAULT\n#define POD_RENDER_MODE_DEFAULT POD_R_FIT/);
    // le noyau n'est inclus que sous #if POD_RENDER_V1
    assert.match(src, new RegExp(`#if POD_RENDER_V1\\n#include "podRenderStream.h"\\n#include "${s.crypto.replace(".", "\\.")}"\\n#endif`));
    assert.equal((src.match(/#include "podRender(Stream)?\.h"/g) ?? []).length, 1);
    // chemin désactivé == avant
    assert.equal(offView(src), plain(read(s.backup)), `${s.name} : la vue POD_RENDER_V1=0 diffère du firmware d'origine`);
    // aucun symbole du noyau hors des blocs actifs seulement avec 1
    const offOnly = offView(src);
    assert.doesNotMatch(offOnly, /PodEinkRenderer|PodTftRenderer|PodFrameHasher|PodPassHasher|podRender|POD_R_/);
    // périmètre : l'ACK et les routes ne changent pas — ackFrame et les chemins d'URL sont ceux d'avant
    const before = read(s.backup), after = src;
    const fn = (t: string, re: RegExp) => (re.exec(t) ?? [""])[0];
    assert.equal(fn(after, /bool ackFrame\([\s\S]*?\n\}/), fn(before, /bool ackFrame\([\s\S]*?\n\}/));
    assert.equal(fn(after, /static bool ackFrame\([\s\S]*?\n\}/), fn(before, /static bool ackFrame\([\s\S]*?\n\}/));
    for (const route of ["/api/ack-frame", "/api/pull-frame", "/api/pull?", "/api/validation-result", "/api/register"]) assert.equal(after.split(route).length, before.split(route).length, route);
  });

  test(`${s.name} : chemin ACTIVÉ — aucune allocation dynamique, AUCUN ACK hors succès (l'écran peut rester blanc ou partiellement dessiné : documenté), hashes seulement journalisés`, () => {
    const src = read(s.ino);
    const on = src.split("\n").join("\n");
    // blocs actifs seulement avec POD_RENDER_V1 = 1
    const blocks = [...on.matchAll(/#if POD_RENDER_V1\n([\s\S]*?)\n#(?:else|endif)/g)].map((m) => m[1]).join("\n");
    assert.doesNotMatch(blocks, /\bmalloc\(|\bnew\b|\bString\s+\w+\s*=\s*String\(/, "aucune allocation dans le chemin v1");
    assert.doesNotMatch(blocks, /ackFrame\(|httpPost\(|httpCall\(/, "le chemin v1 ne parle pas au serveur (ACK / routes inchangés)");
    assert.match(blocks, /renderHash/);
    assert.match(blocks, /calculé ET remis/);
    if (s.family === "esp" && s.ino.includes("eink")) {
      assert.match(blocks, /return 0;[\s\S]*return 1;[\s\S]*return 2;/, "trois états : échec · calculé non remis · calculé ET remis");
      assert.match(src, /podRenderAndShow\(\) != 2/);
    }
    if (s.family === "r4" && s.ino.includes("eink")) assert.match(src, /podRenderAndShow\(\) != 2/);
    // R4 : objets GLOBAUX (pile principale de 1 Ko)
    if (s.family === "r4") assert.match(blocks, /static Pod(Eink|Tft)Renderer<PodSha256Rw> g_pod/);
    // ESP8266 TFT : tampons statiques (hors tas)
    if (s.ino.includes("esp_tft")) assert.match(blocks, /static PodTftRenderer<PodSha256Br> g_podTft;/);
    // succès seulement si calculé ET remis : les sketches TFT n'écrivent le succès (ACK) qu'après 2 / success
    if (s.ino.includes("tft")) assert.match(src, /podStreamFrame\(|podRenderStreamToTft\(/);
  });

  test(`${s.name} : copies d'en-têtes du dossier IDENTIQUES aux originaux de consensus-pod/src (sinon : node scripts/sync-bench-header.js)`, () => {
    const dir = path.dirname(s.ino);
    for (const [name, master] of [["consensusPoD.h", "consensus-pod/src/consensusPoD.h"], ["podRender.h", "consensus-pod/src/podRender.h"], ["podRenderStream.h", "consensus-pod/src/podRenderStream.h"], [s.crypto, `consensus-pod/src/adapters/${s.crypto}`]]) {
      assert.ok(fs.existsSync(path.join(root, dir, name)), `${dir}/${name} absent`);
      assert.ok(Buffer.compare(fs.readFileSync(path.join(root, dir, name)), fs.readFileSync(path.join(root, master))) === 0, `${dir}/${name} diverge de ${master}`);
    }
  });
}

test("pilotes modifiés : seuls des AJOUTS balisés (DisplayStream / displayStream) — la vue sans ajout est identique au pilote d'avant", () => {
  for (const s of SKETCHES) for (const [driver, backup] of s.drivers) {
    const src = read(driver);
    assert.equal((src.match(/POD_RENDER_V1_BEGIN/g) ?? []).length, 1, driver);
    assert.equal(offView(src), plain(read(backup)), `${driver} : modification hors des blocs balisés`);
  }
  // contrat du pilote : plan noir tel quel (0x24), plan rouge inversé (0x26), jamais de franchissement de frontière, pas de rafraîchissement si la production s'arrête
  const esp = read("esp8266/esp_eink_2.9BWR/epd2in9b_V4.cpp"), r4 = read("arduino_uno_r4/pod_uno_r4_eink29/epd29b.h");
  assert.match(esp, /SendCommand\(0x24\);[\s\S]*if \(n == 0 \|\| n > cap\) return false;[\s\S]*SendData\(\(unsigned char\)~chunk\[i\]\)[\s\S]*SendCommand\(0x26\)[\s\S]*TurnOnDisplay\(\);\s*return true;/);
  assert.match(r4, /command\(plane == 0 \? 0x24 : 0x26\)[\s\S]*if \(n == 0 \|\| n > cap\) \{[^}]*return -1;[\s\S]*\(uint8_t\)~chunk\[i\][\s\S]*return refresh\(\) \? 0 : -2;/);
});

test("deux sources de vérité des octets : les tables de police sont en FLASH sur Arduino (POD_PROGMEM) et lues par POD_READ_U8 ; équivalence prouvée par les mêmes vecteurs (build avec faux Arduino.h)", () => {
  const src = read("consensus-pod/src/podRender.h");
  assert.match(src, /POD_FONT_5X7\[42\]\[5\] POD_PROGMEM/);
  assert.match(src, /L1\[\] POD_PROGMEM/);
  assert.match(src, /#define POD_READ_U8\(p\) pgm_read_byte\(p\)/);
});

const choice = findCompiler();
console.log(`[renderFirmware] ${describeChoice(choice)}`);
const skip = choice.path ? false : `${describeChoice(choice)} — build avec faux Arduino.h IGNORÉ (ni vert, ni réussi)`;
test("chemin PROGMEM : le harnais de flux compilé avec un FAUX Arduino.h (ARDUINO défini, PROGMEM, pgm_read_*) retrouve les mêmes vecteurs et les mêmes octets", { skip }, () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "podprogmem-"));
  const stubDir = path.join(tmp, "stub"); fs.mkdirSync(stubDir);
  fs.writeFileSync(path.join(stubDir, "Arduino.h"), [
    "#pragma once", "#include <stdint.h>", "#include <stddef.h>", "#define PROGMEM",
    "static inline uint8_t pgm_read_byte_stub(const void* p) { return *(const volatile uint8_t*)p; }",
    "#define pgm_read_byte(p) pgm_read_byte_stub((const void*)(p))",
    "#define pgm_read_dword(p) (*(const uint32_t*)(p))", ""].join("\n"));
  const exe = path.join(tmp, process.platform === "win32" ? "progmem.exe" : "progmem");
  const cpp = path.join(root, "consensus-pod", "host", "render_stream_harness.cpp");
  const r = compileHarness(choice.path!, cpp, exe, ["-DARDUINO=100", `-I${stubDir}`]);
  assert.ok(r.length >= 0);
  const run = runProcess(exe, [path.join(root, "consensus-pod", "test-vectors", "render-vectors.txt")]);
  assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`);
  assert.match(run.stdout, /^PASS \d+ \(rvec=228 /m);
});

test("mesures de compilation ARCHIVÉES (docs/mesures/8B2A_2026_10_08) : chemin désactivé == base, ESP8266 ≤ 40 000 o, R4 : marge statique résiduelle documentée, aucun avertissement nouveau, surcoût de pile borné", () => {
  const dir = "docs/mesures/8B2A_2026_10_08";
  const rows = read(`${dir}/tailles_firmwares.txt`).split("\n").filter((l) => l.includes("|") && !l.startsWith("#")).map((l) => {
    const [name, ram, flash] = l.split(" | ");
    const n = (s: string) => s.replace(/^(RAM|flash) /, "").split(" · ").map(Number);
    return { name, ram: n(ram), flash: n(flash) };
  });
  assert.equal(rows.length, 4);
  for (const r of rows) {
    const [base, off, on] = r.ram, [fbase, foff, fon] = r.flash;
    assert.equal(off, base, `${r.name} : RAM chemin désactivé ≠ base`);
    assert.ok(Math.abs(foff - fbase) <= 16, `${r.name} : flash chemin désactivé trop différent de la base (${foff - fbase})`);
    assert.ok(on > off && fon > foff, `${r.name} : le chemin activé doit coûter quelque chose`);
    if (r.name.startsWith("ESP8266")) assert.ok(on <= 40000, `${r.name} : RAM statique ${on} > 40 000 (règle 8)`);
    else assert.ok(32768 - 9472 - on >= 0, `${r.name} : RAM R4 au-delà de ce que l'éditeur de liens accepte`);
  }
  const r4e = rows.find((r) => r.name.includes("R4_e-ink") || r.name.includes("UNO_R4_e-ink"))!;
  assert.ok(32768 - 9472 - r4e.ram[2] >= 100 && 32768 - 9472 - r4e.ram[2] <= 300, "marge statique R4 e-ink annoncée : 184 o (documentée dans la note)");
  const warn = read(`${dir}/avertissements.txt`);
  assert.equal((warn.match(/aucun avertissement nouveau/g) ?? []).length, 8);
  assert.doesNotMatch(warn, /NOUVEAUX/);
  const frame = (name: string, mode: number, fn: string) => {
    const section = read(`${dir}/pile_colle_firmwares.txt`).split(/^== /m).find((s) => s.startsWith(`${name} POD_RENDER_V1=${mode}`))!;
    const m = section.split("\n").map((l) => /^(\d+)\t(.*)$/.exec(l)).find((x) => x && x[2].includes("bool " + fn + "("));
    assert.ok(m, `${name} ${mode} ${fn}`);
    return Number(m[1]);
  };
  assert.ok(frame("esp_eink", 1, "doFetchFrame") - frame("esp_eink", 0, "doFetchFrame") <= 200);
  assert.ok(frame("esp_tft", 1, "doFetchFrame") <= frame("esp_tft", 0, "doFetchFrame"));
  assert.ok(frame("r4_eink", 1, "doPull") - frame("r4_eink", 0, "doPull") <= 64);
  assert.ok(frame("r4_tft", 1, "doPull") - frame("r4_tft", 0, "doPull") <= 96);
  // la note du lot annonce ces mêmes chiffres et ses limites
  const doc = read("docs/LOT_8B2A_INTEGRATION_CANARIS_2026_10_08.md");
  for (const needle of ["184 o avec le rendu v1", "Jamais flashés", "NON validée", "marge faible", "ne parle pas au serveur", "aucun avertissement nouveau", "État de l'écran après un échec — NON garanti inchangé", "fin physique", "partiellement redessinée", "l'écran peut être **resté blanc**", "`c5a9b7e` est **poussé**"]) assert.ok(doc.includes(needle) || doc.includes(needle.toLowerCase()), needle);
  const heads = doc.split("\n").filter((l) => /^#{1,2} /.test(l));
  assert.deepEqual(heads.slice(1).map((h) => h.slice(0, 5)), ["## 1.", "## 2.", "## 3.", "## 4.", "## 5.", "## 6.", "## 7."]);
});

test("honnêteté des messages et commentaires : aucun firmware ni pilote ne prétend qu'un échec laisse l'écran inchangé, ni qu'un BUSY expiré signifie « non remis »", () => {
  const files = ["esp8266/esp_eink_2.9BWR/esp_eink_2.9BWR.ino", "esp8266/esp_tft1.8/esp_tft1.8.ino", "arduino_uno_r4/pod_uno_r4_eink29/pod_uno_r4_eink29.ino", "arduino_uno_r4/pod_uno_r4_tft18/pod_uno_r4_tft18.ino",
    "esp8266/esp_eink_2.9BWR/epd2in9b_V4.h", "arduino_uno_r4/pod_uno_r4_eink29/epd29b.h", "docs/LOT_8B2A_INTEGRATION_CANARIS_2026_10_08.md"];
  for (const f of files) {
    const t = read(f);
    assert.doesNotMatch(t, /rien n'est envoyé|n'a PAS été rafraîchi|garde son image|rien affiché de nouveau|aucune écriture si le rendu échoue|mais NON remis/, f);
  }
  const r4 = read("arduino_uno_r4/pod_uno_r4_eink29/pod_uno_r4_eink29.ino");
  assert.match(r4, /FIN PHYSIQUE du rafraîchissement n'est pas confirmée/);
  assert.match(r4, /données ET commande de rafraîchissement ENVOYÉES/);
  assert.match(read("arduino_uno_r4/pod_uno_r4_eink29/epd29b.h"), /la fin physique du rafraîchissement n'est PAS confirmée/);
  assert.match(read("esp8266/esp_eink_2.9BWR/esp_eink_2.9BWR.ino"), /clearDisplayWhite\(\) peut avoir affiché une page BLANCHE/);
});
