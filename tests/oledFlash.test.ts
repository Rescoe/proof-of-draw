// tests/oledFlash.test.ts — OLED AUXILIAIRE du BWR 2,9″ (29/10/2026) : stockage du clip en FLASH BRUTE à deux emplacements (esp8266/esp_eink_2.9BWR/pod_oled_flash.h) vérifié avec une fausse flash qui applique la
// physique de la NOR (effacement par secteur, écriture alignée qui ne peut que mettre des bits à 0), + câblage du sketch (drapeau à 0, ordre des phases, aucune bibliothèque de fichiers, régions disjointes de la frame sauvegardée).
// NE PROUVE PAS : le vrai SPI flash (durée d'effacement, interaction avec le Wi-Fi), le tas réel (canari de banc).
import test, { before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { CLIP, encodeClip, type ClipInput } from "../lib/bench/clip";
import { crc32 } from "../lib/scene/package";

const root = path.join(__dirname, "..");
const FW = path.join(root, "esp8266", "esp_eink_2.9BWR");
const ino = fs.readFileSync(path.join(FW, "esp_eink_2.9BWR.ino"), "utf8").replace(/\r\n/g, "\n");
const fwd = (p: string) => p.replace(/\\/g, "/");
function findCompiler(): string | null {
  for (const c of [process.env.CXX, "g++", "C:\\msys64\\mingw64\\bin\\g++.exe", "/usr/bin/g++", "/usr/local/bin/g++"].filter(Boolean) as string[]) {
    try { execFileSync(c, ["--version"], { stdio: "ignore" }); return c; } catch { /* suivant */ }
  }
  return null;
}
const compiler = findCompiler();
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "oledflash-"));
const exe = path.join(tmp, process.platform === "win32" ? "oled_flash_harness.exe" : "oled_flash_harness");
const skip = compiler ? false : "aucun compilateur C++ (g++) trouvé : tests du stockage flash de l'OLED ignorés — définir CXX pour les activer";
before(() => {
  if (!compiler) return;
  const r = spawnSync(compiler, ["-std=c++11", "-Wall", "-Wextra", "-Werror", "-O2", `-I${fwd(FW)}`, fwd(path.join(root, "consensus-pod", "host", "oled_flash_harness.cpp")), "-o", fwd(exe)], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`compilation du harnais flash impossible :\n${r.stdout}\n${r.stderr}`);
});

function rng(seed: number) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 0x100000000); }
const randFrame = (r: () => number, density: number) => Uint8Array.from({ length: CLIP.FRAME_BYTES }, () => (r() < density ? Math.floor(r() * 256) : 0));
const mk = (frames: Uint8Array[], extra: Partial<ClipInput> = {}): ClipInput => ({ frames, delaysMs: frames.map(() => 100), loops: 0, fg: 0xffff, bg: 0, ...extra });
const hexFile = (name: string, bytes: Uint8Array) => { const f = path.join(tmp, name); fs.writeFileSync(f, Buffer.from(bytes).toString("hex")); return f; };
function ssdFrom(frame: Uint8Array): Buffer {
  const out = Buffer.alloc(1024);
  for (let y = 0; y < 64; y++) for (let x = 0; x < 128; x++) if ((frame[y * 16 + (x >> 3)] >> (7 - (x & 7))) & 1) out[(y >> 3) * 128 + x] |= 1 << (y & 7);
  return out;
}
const crcHex = (b: Uint8Array) => (crc32(b) >>> 0).toString(16).padStart(8, "0");

test("FLASH À DEUX EMPLACEMENTS : écriture dans l'inactif, en-tête en dernier, coupures, séquences, pannes, capacité — avec la physique de la NOR (20 graines)", { skip }, () => {
  const r = rng(7);
  const framesA = Array.from({ length: 5 }, () => randFrame(r, 0.2)), framesB = Array.from({ length: 3 }, () => randFrame(r, 0.3));
  const A = encodeClip(mk(framesA)), B = encodeClip(mk(framesB));
  assert.ok(A.length < 9216 && B.length < 9216, `clips d'essai ${A.length} / ${B.length}`);
  const fa = hexFile("a.hex", A), fb = hexFile("b.hex", B);
  // gros clip : occupe le 3e secteur (> 8 192 o) tout en restant sous le plafond du serveur
  let big: Uint8Array | null = null;
  for (let n = 6; n <= 12 && !big; n++) { const fr = Array.from({ length: n }, () => randFrame(r, 0.97)); const c = encodeClip(mk(fr)); if (c.length > 8300 && c.length <= 9216) big = c; }
  assert.ok(big, "un clip de 8 300 à 9 216 octets est constructible");
  const fbig = hexFile("big.hex", big!);
  let play: string[] = [];
  for (let seed = 1; seed <= 20; seed++) {
    const res = spawnSync(exe, [fa, fb, String(seed), fbig], { encoding: "utf8" });
    assert.equal(res.status, 0, `graine ${seed}\n${res.stdout}\n${res.stderr}`);
    assert.doesNotMatch(res.stdout, /^FAIL/m, `graine ${seed}\n${res.stdout}`);
    assert.match(res.stdout, /RT ok/);
    if (seed === 1) play = res.stdout.split(/\r?\n/).filter((l) => l.startsWith("PLAY ")).map((l) => l.split(" ")[2]);
  }
  // les images lues DEPUIS LA FLASH == l'attendu (f0, f1…f4, f0, f1…)
  const F = framesA.length;
  const want = Array.from({ length: 14 }, (_, i) => crcHex(ssdFrom(framesA[i % F])));
  assert.deepEqual(play, want);
});

test("RÉGIONS : les deux emplacements (0x3E0000 – 0x3E5FFF) sont dans la partition de fichiers et disjoints de la frame sauvegardée de la surimpression (ENV_FLASH_BASE) ; la capacité couvre le plafond du serveur", () => {
  const hdr = fs.readFileSync(path.join(FW, "pod_oled_flash.h"), "utf8");
  const oa = Number(/#define OA_FLASH_BASE\s+(0x[0-9A-Fa-f]+)UL/.exec(hdr)![1]);
  const env = Number(/#define ENV_FLASH_BASE\s+(0x[0-9A-Fa-f]+)UL/.exec(ino)![1]);
  const slot = 3 * 4096;
  assert.equal(oa % 4096, 0);
  assert.ok(oa >= 0x200000 && oa + 2 * slot <= 0x3FA000, "dans la partition de fichiers 0x200000..0x3FA000 (loin de l'EEPROM et du Wi-Fi système)");
  assert.ok(oa + 2 * slot <= env || env + 3 * 4096 <= oa, "disjoint de la frame sauvegardée de la surimpression");
  const dataMax = Number(/#define OA_DATA_MAX\s+(\d+)UL/.exec(hdr)![1]);
  assert.ok(dataMax >= 9216 && dataMax % 256 === 0 && 128 + dataMax <= slot);
  assert.match(fs.readFileSync(path.join(root, "lib/bench/clip.ts"), "utf8"), /MAX_CLIP_BYTES:?\s*9216|MAX_CLIP_BYTES = 9216/);
  assert.doesNotMatch(hdr.replace(/\/\/.*$/gm, ""), /Arduino\.h|\bString\b|\bmalloc\b|\bSerial\b|ESP\./, "en-tête pur (sans dépendance Arduino)");
});

test("SKETCH : drapeau POD_OLED_ANIM à 0 par défaut, exige POD_OLED_STATUS, aucune bibliothèque de fichiers (la frame sauvegardée vit dans la même partition), caps déclarées seulement avec l'option", () => {
  assert.match(ino, /#ifndef POD_OLED_ANIM\n#define POD_OLED_ANIM 0\n#endif/);
  assert.match(ino, /#if POD_OLED_ANIM && !POD_OLED_STATUS\n#error/);
  assert.doesNotMatch(ino, /LittleFS|SPIFFS/);
  assert.match(ino, /#if POD_OLED_ANIM\n\s+"\\"caps\\":\[\\"anim-oled\\"\],"[^\n]*\n#endif/);
  // tout ce qui est ajouté est dans des blocs POD_BWR_BEGIN/END (retirés par les tests d'identité) : retirer les blocs d'un sketch et de l'autre donne le même texte
});

test("SKETCH : le texte HORS blocs POD_BWR est identique à celui d'avant (aucun octet de production n'a bougé)", () => {
  const strip = (s: string) => s.replace(/\r\n/g, "\n").replace(/\/\/ POD_BWR_BEGIN[^\n]*\n[\s\S]*?\/\/ POD_BWR_END[^\n]*\n/g, "");
  let before = "";
  try { before = execFileSync("git", ["show", "ad2e672:esp8266/esp_eink_2.9BWR/esp_eink_2.9BWR.ino"], { cwd: root, encoding: "utf8", maxBuffer: 20 * 1024 * 1024 }); } catch { return; }   // sans historique (archive) : ignoré
  assert.equal(strip(ino), strip(before));
});

test("SKETCH : phases — l'acquisition libère les plans image AVANT le TLS et les réalloue APRÈS ; la lecture n'ouvre aucune connexion ; rien ne joue avant une tâche réseau ; l'animation s'efface devant le réseau", () => {
  const svc = ino.slice(ino.indexOf("static void podoaService() {"));
  const iFree = svc.indexOf("free(blackBuf)"), iAcq = svc.indexOf("podoaAcquire()"), iMal = svc.indexOf("blackBuf = (uint8_t*)malloc(BUF_SIZE)");
  assert.ok(iFree > 0 && iFree < iAcq && iAcq < iMal, "libération, acquisition, réallocation dans cet ordre");
  assert.match(svc, /!podoaNetDueSoon\(\)\) \{\n\s+free\(blackBuf\)/, "pas d'acquisition si une tâche réseau est imminente");
  const play = svc.slice(svc.indexOf("// 2. lecture"), svc.indexOf("// 3. pas d'animation"));
  assert.doesNotMatch(play, /WiFiClientSecure|HTTPClient|httpGet|httpPost|doPull|doValidate|doRegister/, "la lecture ne fait aucun réseau");
  assert.match(play, /podoaNetDueSoon\(\)\) break;/, "une tâche réseau interrompt la tranche");
  assert.match(play, /malloc\(PODOLED_BUF\)/); assert.match(play, /free\(buf\)/);
  const due = ino.slice(ino.indexOf("static bool podoaNetDueSoon()"), ino.indexOf("/** Appelé à CHAQUE tour de loop()"));
  for (const k of ["registered", "WiFi.status()", "lastPullMs + nextPullIntervalMs", "pendingCandidateId", "pendingObsHashes", "g_dht.nextReadMs", "g_dht.nextSendMs", "podotaesp::g_offerSet"]) assert.ok(due.includes(k), `condition réseau : ${k}`);
  // loop() : le service d'animation passe APRÈS pull, vote, observation, OTA — juste avant delay(100)
  const loop = ino.slice(ino.indexOf("void loop()"));
  const iPull = loop.indexOf("doPull();"), iVal = loop.indexOf("doValidate();"), iOta = loop.indexOf("podotaesp::maybeRun()"), iSvc = loop.indexOf("podoaService();"), iDelay = loop.lastIndexOf("delay(100);");
  assert.ok(iPull > 0 && iPull < iVal && iVal < iOta && iOta < iSvc && iSvc < iDelay, "ordre dans loop()");
  // pull : pointeur lu, animation oubliée seulement après l'affichage RÉUSSI d'une frame sans pointeur
  assert.match(ino, /podoaOnPull\(an\.isNull\(\) \? "" : \(const char\*\)\(an\["hash"\] \| ""\), an\.isNull\(\) \? 0 : \(uint32_t\)\(an\["bytes"\] \| 0\)\)/);
  assert.match(ino, /static void podoaAfterFrame\(bool fetchOk\) \{ if \(fetchOk && podoa::g\.pendHash\[0\] == 0\) podoaForget\(\); \}/);
  // l'ancien clip n'est effacé qu'APRÈS l'écriture de l'en-tête du nouveau
  const acq = ino.slice(ino.indexOf("static bool podoaAcquire()"), ino.indexOf("/** Écran capteur de l'OLED"));
  assert.ok(acq.indexOf("w->commit(") > 0 && acq.indexOf("w->commit(") < acq.indexOf("podoled::dropSlot(fl, old)"), "dropSlot de l'ancien clip après le commit du nouveau");
  assert.ok(acq.indexOf("podoaValidate(target") > 0 && acq.indexOf("podoaValidate(target") < acq.indexOf("w->commit("), "validation EN FLUX avant l'en-tête");
  assert.match(acq, /const int target = \(s\.slot == 0\) \? 1 : 0;/, "l'emplacement actif n'est jamais l'emplacement d'écriture");
  assert.match(ino, /static void oledStatus\([^)]*\) \{\n#if POD_OLED_ANIM\n\s+if \(podoaActive\(\)\) return;/, "l'écran d'état ne repeint pas l'OLED pendant une animation");
});
