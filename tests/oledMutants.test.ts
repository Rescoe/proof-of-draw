// tests/oledMutants.test.ts — MUTANTS de l'OLED auxiliaire du BWR (29/10/2026) : chaque mutation d'un en-tête (pod_oled_stream.h, pod_oled_flash.h) DOIT faire échouer les harnais hôte (compilation, sortie ou code retour).
// Un mutant qui survit = une vérification qui ne vérifie rien. Les en-têtes mutés sont copiés dans un dossier temporaire ; les sources du dépôt ne sont jamais modifiées.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { CLIP, encodeClip } from "../lib/bench/clip";
import { crc32 } from "../lib/scene/package";

const root = path.join(__dirname, "..");
const FW = path.join(root, "esp8266", "esp_eink_2.9BWR");
const fwd = (p: string) => p.replace(/\\/g, "/");
function findCompiler(): string | null {
  for (const c of [process.env.CXX, "g++", "C:\\msys64\\mingw64\\bin\\g++.exe", "/usr/bin/g++", "/usr/local/bin/g++"].filter(Boolean) as string[]) {
    try { execFileSync(c, ["--version"], { stdio: "ignore" }); return c; } catch { /* suivant */ }
  }
  return null;
}
const compiler = findCompiler();
const skip = compiler ? false : "aucun compilateur C++ (g++) trouvé : mutants de l'OLED ignorés — définir CXX pour les activer";
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "oledmut-"));

function rng(seed: number) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 0x100000000); }
const r = rng(99);
const frames = Array.from({ length: 4 }, () => Uint8Array.from({ length: CLIP.FRAME_BYTES }, () => (r() < 0.2 ? Math.floor(r() * 256) : 0)));
const clip = encodeClip({ frames, delaysMs: frames.map(() => 100), loops: 0, fg: 0xffff, bg: 0 });
const clipHex = path.join(tmp, "clip.hex"); fs.writeFileSync(clipHex, Buffer.from(clip).toString("hex"));
const other = encodeClip({ frames: frames.slice(0, 3), delaysMs: [100, 100, 100], loops: 0, fg: 0xffff, bg: 0 });
const otherHex = path.join(tmp, "other.hex"); fs.writeFileSync(otherHex, Buffer.from(other).toString("hex"));

const wantTimes = Array.from({ length: 12 }, (_, i) => 1000 + 100 * i);   // 100 ms par image, horloge simulée au pas de 10 ms
let bigClip: Uint8Array = new Uint8Array(0);
for (let n = 6; n <= 12 && !(bigClip.length > 8300 && bigClip.length <= 9216); n++) {
  const fr = Array.from({ length: n }, () => Uint8Array.from({ length: CLIP.FRAME_BYTES }, () => (r() < 0.97 ? Math.floor(r() * 256) : 0)));
  bigClip = encodeClip({ frames: fr, delaysMs: Array(n).fill(100), loops: 0, fg: 0xffff, bg: 0 });
}
const bigHex = path.join(tmp, "big.hex"); fs.writeFileSync(bigHex, Buffer.from(bigClip).toString("hex"));

function ssdFrom(frame: Uint8Array): Buffer {
  const out = Buffer.alloc(1024);
  for (let y = 0; y < 64; y++) for (let x = 0; x < 128; x++) if ((frame[y * 16 + (x >> 3)] >> (7 - (x & 7))) & 1) out[(y >> 3) * 128 + x] |= 1 << (y & 7);
  return out;
}
const want = Array.from({ length: 12 }, (_, i) => (crc32(ssdFrom(frames[i % 4])) >>> 0).toString(16).padStart(8, "0"));

/** Copie les en-têtes, applique la mutation (texte exact, une seule occurrence), compile le harnais ; retourne true si le mutant est DÉTECTÉ. */
function detected(file: "pod_oled_stream.h" | "pod_oled_flash.h", from: string, to: string, harness: "stream" | "flash"): boolean {
  const dir = fs.mkdtempSync(path.join(tmp, "m-"));
  for (const f of fs.readdirSync(FW)) if (/\.h$/.test(f)) fs.copyFileSync(path.join(FW, f), path.join(dir, f));
  const p = path.join(dir, file);
  const src = fs.readFileSync(p, "utf8");
  assert.equal(src.split(from).length - 1, 1, `mutation « ${from} » : exactement une occurrence attendue dans ${file}`);
  fs.writeFileSync(p, src.replace(from, () => to));
  const exe = path.join(dir, process.platform === "win32" ? "h.exe" : "h");
  const cpp = path.join(root, "consensus-pod", "host", harness === "stream" ? "oled_stream_harness.cpp" : "oled_flash_harness.cpp");
  const c = spawnSync(compiler as string, ["-std=c++11", "-O2", `-I${fwd(dir)}`, fwd(cpp), "-o", fwd(exe)], { encoding: "utf8" });
  if (c.status !== 0) return true;                                                       // ne compile plus : détecté
  const args = harness === "stream" ? ["play", clipHex, "12", "10", "1"] : [clipHex, otherHex, "3", bigHex];
  const run = spawnSync(exe, args, { encoding: "utf8", timeout: 20000, maxBuffer: 64 * 1024 * 1024 });
  if (run.status !== 0 || run.error) return true;                                        // code retour ou délai : détecté
  if (harness === "stream") {
    const got = run.stdout.split(/\r?\n/).filter((l) => l.startsWith("SHOWN ")).map((l) => l.split(" ")[2]);
    const times = run.stdout.split(/\r?\n/).filter((l) => l.startsWith("SHOWN ")).map((l) => Number(l.split(" ")[3]));
    if (JSON.stringify(got.slice(0, want.length)) !== JSON.stringify(want) || JSON.stringify(times.slice(0, wantTimes.length)) !== JSON.stringify(wantTimes)) return true;
    const oob = spawnSync(exe, ["oob", clipHex], { encoding: "utf8", timeout: 20000 });      // bornes : doit RÉUSSIR avec le code d'origine
    return oob.status !== 0 || !!oob.error;
  }
  return /^FAIL/m.test(run.stdout);
}

const STREAM: Array<[string, string, string]> = [
  ["bit MSB↔LSB : un octet PBC1 → 8 pixels d'une ligne", "if (v & (0x80u >> i))", "if (v & (1u << i))"],
  ["page SSD1306 : y / 8", "const int y = off >> 4, bx = (off & 15) << 3;\n  uint8_t* col = ssd + ((y >> 3) << 7) + bx;", "const int y = off >> 4, bx = (off & 15) << 3;\n  uint8_t* col = ssd + ((y >> 2) << 7) + bx;"],
  ["bit de la page : y % 8", "const uint8_t m = (uint8_t)(1u << (y & 7));", "const uint8_t m = (uint8_t)(1u << ((y + 1) & 7));"],
  ["une transition REMPLACE les octets (pas de OU)", "else col[i] &= (uint8_t)~m; }", "}"],
  ["transition de retour : au bon rang", "const bool isReturn = (k == c.frames - 1);", "const bool isReturn = (k == c.frames);"],
  ["transition de retour : retour au début des transitions", "if (isReturn) { pos = c.offTrans; k = 0; loopNo++; }", "if (isReturn) { k = 0; loopNo++; }"],
  ["position mémorisée entre deux appels", "pos += used;", "pos += 0;"],
  ["délai de l'image : celui de la transition", "const uint32_t step = (uint32_t)d * 10u;", "const uint32_t step = (uint32_t)c.delay0 * 10u + 7u;"],
  ["image 0 lue en entier (4 quarts)", "for (int o = 0; o < podbench::FRAME_BYTES; o += (int)PODOLED_BUF) {", "for (int o = 0; o < podbench::FRAME_BYTES - (int)PODOLED_BUF; o += (int)PODOLED_BUF) {"],
  ["un run qui sort de l'image est refusé", "if (len < 1 || off + len > podbench::FRAME_BYTES || !s.read(buf, (size_t)len)) return false;", "if (len < 1 || !s.read(buf, (size_t)len)) return false;"],
];
const FLASH: Array<[string, string, string]> = [
  ["marqueur de validation de l'en-tête", "h->commit == OA_COMMIT && ", ""],
  ["emplacement actif = séquence la plus grande", "(int32_t)(h1.seq - h0.seq) > 0 ? 1 : 0", "(int32_t)(h1.seq - h0.seq) < 0 ? 1 : 0"],
  ["fenêtre de la source : octets restants de la fenêtre", "const uint32_t off = pos - at, take = (64u - off) < n ? (64u - off) : (uint32_t)n;", "const uint32_t off = pos - at, take = (65u - off) < n ? (65u - off) : (uint32_t)n;"],
  ["l'en-tête s'écrit à l'emplacement de l'emplacement (pas ailleurs)", "return fl->write(slotBase(slot), (const uint8_t*)&h, OA_HDR);", "return fl->write(slotBase(slot) + OA_SECTOR, (const uint8_t*)&h, OA_HDR);"],
  ["les données commencent après l'en-tête", "if (!fl->write(slotBase(slot) + OA_HDR + flushed, blk, OA_WRITE_BLOCK)) return false;", "if (!fl->write(slotBase(slot) + flushed, blk, OA_WRITE_BLOCK)) return false;"],
  ["effacement des 3 secteurs", "for (uint32_t i = 0; i < 3; i++) if (!fl->erase(slotBase(slot) / OA_SECTOR + i)) return false;", "for (uint32_t i = 0; i < 2; i++) if (!fl->erase(slotBase(slot) / OA_SECTOR + i)) return false;"],
  ["plafond de capacité d'un clip", "if (total + n > OA_DATA_MAX) return false;", ""],
  ["l'en-tête n'est écrit qu'avec la taille réelle", "h.bytes = total;", "h.bytes = total + 4;"],
];

for (const [name, from, to] of STREAM) test(`MUTANT lecteur en flux — ${name} : DÉTECTÉ`, { skip }, () => assert.ok(detected("pod_oled_stream.h", from, to, "stream"), `le mutant « ${name} » a survécu`));
for (const [name, from, to] of FLASH) test(`MUTANT stockage flash — ${name} : DÉTECTÉ`, { skip }, () => assert.ok(detected("pod_oled_flash.h", from, to, "flash"), `le mutant « ${name} » a survécu`));
