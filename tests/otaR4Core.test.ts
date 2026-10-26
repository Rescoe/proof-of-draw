import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { compileHarness, describeChoice, findCompiler, runProcess } from "./helpers/cppHarness";
import { buildOtaR4Vectors } from "./helpers/otaR4Vectors";
import { VOTE_V2_FIRMWARE } from "../lib/voteCapability";

// OTA R4-B (ADR OTA-5) — noyau C++ consensus-pod/src/podOtaR4.h : exécuté sur l'HÔTE avec la vraie bibliothèque Crypto 0.4.0 contre les vecteurs de lib/otaManifestR4.ts, puis MUTANTS (chaque garde retirée doit faire échouer le harnais).
// Prouve (hôte) le contrat ; ne prouve rien sur la carte (aucun firmware n'inclut ce noyau, aucune programmation).
const root = path.join(__dirname, "..");
const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8").replace(/\r\n/g, "\n");
const HDR = "consensus-pod/src/podOtaR4.h", HARNESS = "consensus-pod/host/ota_r4_harness.cpp", VEC = "consensus-pod/test-vectors/ota-r4-vectors.txt";
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

test("vecteurs commités == sortie du générateur (référence TypeScript)", () => {
  const { txt } = buildOtaR4Vectors();
  assert.equal(read(VEC), txt.replace(/\r\n/g, "\n"), "régénérer : node --import tsx scripts/gen-ota-r4-vectors.ts");
  assert.ok(txt.split("\n").filter(Boolean).length >= 40);
});

test("discipline : le noyau ne contient aucun appel au module, au réseau, au tas ni à la série ; la programmation n'est atteignable que derrière consume()", () => {
  const h = strip(read(HDR));
  for (const bad of ["OTAUpdate", "ota.update", "download(", "Serial", "malloc", "calloc", "new ", "WiFi", "SPIFFS", "delay(", "millis("]) assert.ok(!h.includes(bad), `jeton interdit dans le noyau : ${bad}`);
  assert.ok(!/#include\s*<Arduino/.test(h));
  assert.match(h, /programWithTicket\(Session& s, bool \(\*program\)\(void\*\), void\* ctx\) \{\s*if \(!consume\(s\)\) return false;\s*return program\(ctx\);/);
  assert.equal((h.match(/program\(ctx\)/g) ?? []).length, 1, "un seul appel de programmation, derrière consume()");
  const lab = path.join(root, "ota-lab", "r4-ota5", "sketch");
  if (fs.existsSync(lab)) {
    for (const f of fs.readdirSync(lab, { recursive: true }) as string[]) {
      if (!/\.(ino|h|cpp)$/.test(f)) continue;
      const t = strip(fs.readFileSync(path.join(lab, f), "utf8"));
      assert.ok(!/\.download\(|ota\.update\(|OTAUpdate\s*\w*\s*;\s*\w+\.update/.test(t), `appel interdit dans ${f}`);
    }
  }
});

test("la table de compatibilité de vote du noyau C++ == lib/voteCapability.ts (aucune dérive)", () => {
  const h = read(HDR); const cpp: Record<string, [number, number]> = {};
  for (const m of h.matchAll(/\{"([a-z0-9]+)", (\d+), (\d+)\}/g)) cpp[m[1]] = [Number(m[2]), Number(m[3])];
  assert.deepEqual(cpp, VOTE_V2_FIRMWARE);
});

const choice = findCompiler(); console.log(`[otaR4Core] ${describeChoice(choice)}`);
const cands = [process.env.POD_CRYPTO_SRC, path.join(os.homedir(), "Documents", "Arduino", "libraries", "Crypto", "src"), path.join(os.homedir(), "Arduino", "libraries", "Crypto", "src")].filter((c): c is string => Boolean(c));
const cryptoSrc = cands.find((c) => fs.existsSync(path.join(c, "Ed25519.cpp")));
const skip = !choice.path ? "aucun compilateur C++" : !cryptoSrc ? "bibliothèque Crypto 0.4.0 introuvable" : false;
if (skip) console.log(`[otaR4Core] différentiel hôte IGNORÉ : ${skip}`);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "otar4-"));
const exe = (n: string) => path.join(tmp, process.platform === "win32" ? `${n}.exe` : n);
let libs: string[] | null = null;
function ensureLib(): string[] {
  if (libs) return libs; libs = [];
  for (const n of ["Ed25519", "Curve25519", "BigNumberUtil", "SHA512", "SHA256", "Hash", "Crypto"]) {
    const o = path.join(tmp, `${n}.o`); const r = runProcess(choice.path!, ["-std=c++11", "-O2", "-w", "-c", `-I${cryptoSrc}`, path.join(cryptoSrc!, `${n}.cpp`), "-o", o]);
    assert.equal(r.status, 0, `compilation Crypto (${n}) : ${r.stderr}`); libs.push(o);
  }
  return libs;
}
function build(name: string, hdr: string, lenient = false): string {
  const dir = path.join(tmp, `${name}_src`); fs.mkdirSync(path.join(dir, "host"), { recursive: true }); fs.mkdirSync(path.join(dir, "src"), { recursive: true });
  fs.writeFileSync(path.join(dir, "src", "podOtaR4.h"), hdr); fs.copyFileSync(path.join(root, HARNESS), path.join(dir, "host", "ota_r4_harness.cpp"));
  const e = exe(name); const srcFile = path.join(dir, "host", "ota_r4_harness.cpp");
  if (lenient) { const r = runProcess(choice.path!, ["-std=c++11", "-w", "-O1", `-I${cryptoSrc}`, ...ensureLib(), srcFile, "-o", e]); assert.equal(r.status, 0, `un mutant doit COMPILER : ${r.stderr}`); return e; }
  compileHarness(choice.path!, srcFile, e, [`-I${cryptoSrc}`, ...ensureLib()]); return e;
}

test("DIFFÉRENTIEL HÔTE : le noyau C++ rend le même verdict que la référence TypeScript sur chaque vecteur, puis flux borné, ticket et séquence avec coupure à chaque octet", { skip }, () => {
  const e = build("ota_r4_ok", read(HDR)); const r = runProcess(e, [path.join(root, VEC)]);
  assert.equal(r.status, 0, r.stdout + r.stderr); assert.match(r.stdout, /PASS \d+/); assert.ok(Number(/PASS (\d+)/.exec(r.stdout)![1]) >= 190, r.stdout);
});

// ── MUTANTS du noyau : [nom, motif exact, remplacement] ; chacun DOIT faire échouer le harnais (compilation réussie, code de sortie != 0) ──
const NL = "\n";
const MUT: [string, string, string][] = [
  ["structure composée : ASCII + fin de ligne + nombre de lignes", "COMPOSITE", ""],
  ["parse : ASCII imprimable", "if (!(raw[i] == 0x0a || (raw[i] >= 0x20 && raw[i] <= 0x7e))) return false;", "if (false) return false;"],
  ["parse : fin de ligne finale", "if (raw[n - 1] != '\\n') return false;", ""],
  ["parse : nombre de lignes", "if (lines != 10) return false;", ""],
  ["parse : ordre et noms des champs", "memcmp(raw + pos, KEY[k], kl) != 0 || raw[pos + kl] != '='", "false"],
  ["parse : taille maximale du manifeste", "if (n == 0 || n > MAX_MANIFEST) return false;", "if (n == 0) return false;"],
  ["parse : zéros initiaux", "if (s[0] == '0' && n > 1) return false;", ""],
  ["parse : longueur d'un entier", "if (n == 0 || n > 10) return false;", "if (n == 0) return false;"],
  ["parse : seq >= 1", "if (seq < 1 || seq > MAX_SEQ) return false;", "if (seq > MAX_SEQ) return false;"],
  ["parse : seq <= 2^31-1", "if (seq < 1 || seq > MAX_SEQ) return false;", "if (seq < 1) return false;"],
  ["parse : size >= 1", "if (size < 1 || size > MAX_SIZE) return false;", "if (size > MAX_SIZE) return false;"],
  ["parse : size <= 0x3C000", "if (size < 1 || size > MAX_SIZE) return false;", "if (size < 1) return false;"],
  ["parse : schema", "if (vlen[0] != sizeof(SCHEMA) - 1 || memcmp(val[0], SCHEMA, vlen[0]) != 0) return false;", ""],
  ["parse : famille", "if (!familyOk(val[1], vlen[1])) return false;", ""],
  ["parse : famille station capteur", 'memcmp(s, "uno-r4-wifi-sensor", 18) == 0', "false"],
  ["parse : famille écran 1,8″", 'memcmp(s, "uno-r4-wifi-tft18", 17) == 0', "false"],
  ["evaluate : exemption de vote de la station capteur", "(familyVotes(m.family) && !voteCapable(pre, a, b))", "!voteCapable(pre, a, b)"],
  ["parse : forme du firmware", "vlen[2] >= sizeof m.firmware || !firmwareOk(val[2], vlen[2], pre, maj, mnr)", "vlen[2] >= sizeof m.firmware"],
  ["parse : canal inconnu", 'else if (is(4, "stable")) strcpy(m.channel, "stable"); else return false;', 'else if (is(4, "stable")) strcpy(m.channel, "stable"); else strcpy(m.channel, "beta");'],
  ["parse : sha256 (longueur/hex)", "if (vlen[6] != 64 || !hexN(val[6], 64, m.sha)) return false;", ""],
  ["parse : hexadécimal en minuscules", "if (c >= 'a' && c <= 'f') return c - 'a' + 10; return -1;", "if (c >= 'a' && c <= 'f') return c - 'a' + 10; if (c >= 'A' && c <= 'F') return c - 'A' + 10; return -1;"],
  ["parse : keyid inconnu", 'else if (is(8, "r4-b")) strcpy(m.keyid, "r4-b"); else return false;', 'else if (is(8, "r4-b")) strcpy(m.keyid, "r4-b"); else strcpy(m.keyid, "r4-z");'],
  ["parse : longueur de la signature", "if (sl != 128 || !hexN(sg, 128, m.sig)) return false;", "if (!hexN(sg, sl < 128 ? sl : 128, m.sig)) return false;"],
  ["evaluate : séparation de domaine", "v.verify(v.ctx, pub, work, DOMAIN_LEN + m.bodyLen, m.sig)", "v.verify(v.ctx, pub, work + DOMAIN_LEN, m.bodyLen, m.sig)"],
  ["evaluate : clé nulle", "if (!pub || allZero(pub, 32)) return W_SIGNATURE;", "if (!pub) return W_SIGNATURE;"],
  ["evaluate : clé absente", "if (!pub || allZero(pub, 32)) return W_SIGNATURE;", "if (pub && allZero(pub, 32)) return W_SIGNATURE;"],
  ["evaluate : effacement du tampon de travail", "memset(work, 0, WORK_BYTES);", ""],
  ["evaluate : famille", "if (!eq(m.family, d.family)) return W_FAMILY;", ""],
  ["evaluate : canal development", 'if (eq(m.channel, "development") || !eq(m.channel, d.channel)) return W_CHANNEL;', "if (!eq(m.channel, d.channel)) return W_CHANNEL;"],
  ["evaluate : canal de l'appareil", 'if (eq(m.channel, "development") || !eq(m.channel, d.channel)) return W_CHANNEL;', 'if (eq(m.channel, "development")) return W_CHANNEL;'],
  ["evaluate : compatibilité de vote", "if (!firmwareOk((const uint8_t*)m.firmware, strlen(m.firmware), pre, a, b) || (familyVotes(m.family) && !voteCapable(pre, a, b))) return W_VOTE_INCOMPAT;", ""],
  ["evaluate : seuil de vote de r4tft28", '{"r4tft28", 2, 5}', '{"r4tft28", 2, 4}'],
  ["evaluate : rejeu / downgrade", "if (m.seq <= d.installedSeq) return W_NOT_NEWER;", "if (m.seq < d.installedSeq) return W_NOT_NEWER;"],
  ["evaluate : activation différée", "if (m.notbefore > d.now) return W_NOT_ACTIVE;", ""],
  ["evaluate : activation à l'instant exact", "if (m.notbefore > d.now) return W_NOT_ACTIVE;", "if (m.notbefore >= d.now) return W_NOT_ACTIVE;"],
  ["begin : Content-Length == taille signée", "|| (uint64_t)contentLength != (uint64_t)m.size", ""],
  ["begin : suppression du staging antérieur", "s.stage.remove(s.stage.ctx); s.stageTouched = true;", "s.stageTouched = true;"],
  ["feed : octet en trop", "if ((uint64_t)s.received + n > s.m.size) { fail(s, E_EXCESS); return false; }", ""],
  ["feed : blocs de 200 o", `size_t c = n - off > BLOCK ? BLOCK : n - off;${NL}    if (!s.stage.write`, `size_t c = n - off;${NL}    if (!s.stage.write`],
  ["feed : échec d'écriture du staging", "if (!s.stage.write(s.stage.ctx, s.received, data + off, c)) { fail(s, E_STAGE_WRITE); return false; }", "s.stage.write(s.stage.ctx, s.received, data + off, c);"],
  ["feed : SHA-256 au fil de l'eau", `s.sha.update(s.sha.ctx, data + off, c);${NL}    if (s.received < 8)`, "if (s.received < 8)"],
  ["finish : réponse tronquée", "if (s.received != s.m.size) { fail(s, E_SHORT); return false; }", ""],
  ["finish : SHA-256 du téléchargement", "if (memcmp(h, s.m.sha, 32) != 0) { fail(s, E_HASH); return false; }", ""],
  ["fail : suppression du staging refusé", "if (s.stageTouched) { s.stage.remove(s.stage.ctx); s.stageTouched = false; }", ""],
  ["readback : état requis (finish d'abord)", "if (s.st != S_STAGED_UNTRUSTED) { fail(s, E_STATE); return false; }", ""],
  ["readback : échec de lecture", "if (!s.stage.read(s.stage.ctx, off, buf, c)) { fail(s, E_STAGE_READ); return false; }", "s.stage.read(s.stage.ctx, off, buf, c);"],
  ["readback : SHA-256 relu", "if (memcmp(h, s.m.sha, 32) != 0) { fail(s, E_READBACK_HASH); return false; }", ""],
  ["readback : vecteurs", "if (!vectorsOk(first, s.m.size)) { fail(s, E_VECTOR); return false; }", ""],
  ["vecteurs : SP sous la SRAM", "if (sp < SRAM_LO || sp > SRAM_HI) return false;", "if (sp > SRAM_HI) return false;"],
  ["vecteurs : SP au-dessus de la SRAM", "if (sp < SRAM_LO || sp > SRAM_HI) return false;", "if (sp < SRAM_LO) return false;"],
  ["vecteurs : bit Thumb", "return (rst & 1u) && rst >= APP_BASE", "return rst >= APP_BASE"],
  ["vecteurs : reset sous 0x4000", "&& rst >= APP_BASE && rst < APP_BASE + size", "&& rst < APP_BASE + size"],
  ["vecteurs : reset hors image", "&& rst >= APP_BASE && rst < APP_BASE + size", "&& rst >= APP_BASE"],
  ["consume : ticket et état", "if (s.st != S_READY || !s.ticket) return false;", "if (!s.ticket) return false;"],
  ["consume : usage unique", "s.ticket = false; s.st = S_CONSUMED; return true;", "return true;"],
  ["programmation sans ticket", `if (!consume(s)) return false;${NL}  return program(ctx);`, `consume(s);${NL}  return program(ctx);`],
  ["séquence : strictement croissante", "newSeq <= s.seq", "newSeq < s.seq"],
  ["séquence : double invalide refuse", "if (!s.ok || newSeq <= s.seq", "if (newSeq <= s.seq"],
  ["séquence : alternance des blocs", "uint8_t target = s.newest == 0 ? SEQ_BLOCK_B : SEQ_BLOCK_A;", "uint8_t target = SEQ_BLOCK_A;"],
  ["séquence : compteur de génération", "makeRecord(buf1024, newSeq, s.gen + 1);", "makeRecord(buf1024, newSeq, s.gen);"],
  ["séquence : relecture après écriture", "if (!f.readBlock(f.ctx, target, buf1024) || classify(buf1024, q, g) != R_VALID || q != newSeq || g != s.gen + 1) return false;", ""],
  ["séquence : CRC-32", "if (le32(b + 16) != crc32(b, 16)) return R_INVALID;", ""],
  ["séquence : magic", 'if (memcmp(b, "OTS1", 4) != 0 || b[4] != 1 || b[5] != 0xA5 || b[6] != 0 || b[7] != 0) return R_INVALID;', "if (b[4] != 1 || b[5] != 0xA5 || b[6] != 0 || b[7] != 0) return R_INVALID;"],
  ["séquence : version", "|| b[4] != 1 ||", "||"],
  ["séquence : nature", "|| b[5] != 0xA5 ||", "||"],
  ["séquence : réservé", "|| b[6] != 0 || b[7] != 0) return R_INVALID;", ") return R_INVALID;"],
  ["séquence : bornes de seq enregistrée", `if (seq < 1 || seq > MAX_SEQ) return R_INVALID;${NL}  return R_VALID;`, "return R_VALID;"],
  ["séquence : vierge sur 20 octets", "for (int i = 0; i < 20; i++) if (b[i] != 0xFF)", "for (int i = 0; i < 16; i++) if (b[i] != 0xFF)"],
  ["séquence : illisible = invalide", "k[i] = f.readBlock(f.ctx, blk, buf1024) ? classify(buf1024, sq[i], gn[i]) : R_INVALID;", "k[i] = f.readBlock(f.ctx, blk, buf1024) ? classify(buf1024, sq[i], gn[i]) : R_VIRGIN;"],
  ["séquence : max(compilée, valides)", "if (sq[i] > r.seq) r.seq = sq[i];", ""],
];
// Gardes de DÉFENSE EN PROFONDEUR : redondantes avec la validation champ par champ (aucun manifeste valide champ par champ ne peut les enfreindre) ; leur mutant isolé survit donc légitimement. La version composée (ci-dessus) ne survit pas.
const REDUNDANT = new Map<string, string>([
  ["parse : ASCII imprimable", "tout octet appartient à une clé, un « = », un « \n » ou une valeur, et chaque valeur est validée par un format strict"],
  ["parse : fin de ligne finale", "un texte sans « \n » final a 9 « \n » : refusé par le nombre de lignes (le mutant composé enlève les deux)"],
  ["parse : taille maximale du manifeste", "le plus long manifeste valide fait moins de 512 octets : borne de sécurité du tampon de travail (536 o), inatteignable par des champs valides"],
]);
const COMPOSITE = [["if (!(raw[i] == 0x0a || (raw[i] >= 0x20 && raw[i] <= 0x7e))) return false;", "if (false) return false;"], ["if (raw[n - 1] != '\\n') return false;", ""], ["if (lines != 10) return false;", ""]];
test("MUTANTS du noyau OTA R4-B : chaque garde retirée fait échouer le harnais hôte (sauf les gardes redondantes, documentées, dont la version composée échoue)", { skip }, () => {
  const src = read(HDR); const survivors: string[] = [];
  for (const [name, find, repl] of MUT) {
    let mutated: string;
    if (find === "COMPOSITE") { mutated = src; for (const [f, r] of COMPOSITE) { assert.ok(mutated.includes(f), "motif composé absent"); mutated = mutated.replace(f, () => r); } }
    else { assert.ok(src.includes(find), `motif de mutant absent : ${name}`); mutated = src.replace(find, () => repl); }
    const e = build("ota_r4_mut", mutated, true);
    const r = runProcess(e, [path.join(root, VEC)]);
    if (r.status === 0) survivors.push(name);
  }
  assert.deepEqual(survivors.sort(), [...REDUNDANT.keys()].sort(), `survivants inattendus ou garde redondante devenue nécessaire : ${survivors.join(" | ")}`);
});
