// tests/format.test.mjs — le format .ota fabriqué par nos outils est celui que LIT le module (transcription du décodeur et du contrôle de CRC), et les cas de laboratoire ont les effets annoncés.
import test from "node:test"; import assert from "node:assert/strict"; import http from "node:http"; import { mkdtempSync, writeFileSync } from "node:fs"; import { tmpdir } from "node:os"; import { join } from "node:path";
import { crc32 } from "node:zlib"; import { randomBytes } from "node:crypto";
import { R4_MAGIC, ESP32_MAGIC, HEADER, crc, buildOta, parseOta, lzssEncodeLiterals, lzssEncodeGreedy, lzssDecode, makeCases } from "../tools/ota-format.mjs";
import { writeCases } from "../tools/make-ota.mjs"; import { makeHandler } from "../tools/serve-r4.mjs";

const img = (n) => { const b = Buffer.alloc(n); for (let i = 0; i < n; i++) b[i] = (i * 131 + (i >> 5) * 17) & 255; return b; };

test("CRC : identique au CRC-32 standard (même polynôme et table que utility.cpp)", () => {
  const d = randomBytes(1000); assert.equal(crc(d), crc32(d) >>> 0); assert.equal(crc(Buffer.from("123456789")), 0xCBF43926);
});
test("littéraux seuls : aller-retour exact pour toutes les longueurs de 0 à 64 (aucun octet parasite dû au bourrage)", () => {
  for (let n = 0; n <= 64; n++) { const d = randomBytes(n); assert.deepEqual(lzssDecode(lzssEncodeLiterals(d)), d, `n=${n}`); }
});
test("copies : l'encodeur glouton exerce le chemin « copie » du décodeur et compresse un binaire répétitif", () => {
  const d = Buffer.concat([img(1500), img(1500), Buffer.from("abcabcabcabcabcabcabcabc")]);
  const c = lzssEncodeGreedy(d); assert.deepEqual(lzssDecode(c), d); assert.ok(c.length < lzssEncodeLiterals(d).length, "doit compresser");
});
test("en-tête : len = taille du fichier - 8, magie R4, CRC sur magie + version + flux, valide", () => {
  const f = buildOta(lzssEncodeLiterals(img(300))); assert.equal(f.readUInt32LE(0), f.length - 8); assert.equal(f.readUInt32LE(8), R4_MAGIC); assert.equal(f.length, HEADER + lzssEncodeLiterals(img(300)).length);
  const p = parseOta(f); assert.ok(p.ok && p.lenOk && p.code === 0); assert.deepEqual(p.bin, img(300));
});

test("cas de laboratoire : chacun a l'effet que le CODE du module lui donne", () => {
  const bin = img(5000), cs = makeCases(bin);
  const good = parseOta(cs.good.file); assert.ok(good.ok); assert.deepEqual(good.bin, bin);
  const bad = parseOta(cs.badcrc.file); assert.equal(bad.code, -10); assert.deepEqual(bad.bin, bin, "le téléchargement réussit : seul verify() voit la faute");
  assert.equal(parseOta(cs.badpayload.file).code, -10);
  assert.equal(parseOta(cs.badmagic.file).code, -11); assert.equal(parseOta(cs.badmagic.file, { magic: ESP32_MAGIC }).ok, true, "magie d'une autre carte : valide pour CETTE autre carte");
  const tr = parseOta(cs.trunc.file); assert.equal(tr.code, -10); assert.ok(tr.bin.length < bin.length);
  const ll = parseOta(cs.lenlie.file); assert.ok(ll.ok, "len faux : accepté"); assert.equal(ll.lenOk, false);
  const sb = parseOta(cs.sigbit.file); assert.ok(sb.ok && sb.signatureBit, "bit « signature » armé : accepté, rien ne le lit");
  assert.ok(cs.pad200.file.length > 200 * 1024 && cs.pad400.file.length > 400 * 1024);
  assert.equal(cs.pad200.expect.flashable, false); assert.equal(cs.pad400.expect.flashable, false);
});
test("write-cases : fichiers, to-a, cases.json avec SHA-256", () => {
  const dir = mkdtempSync(join(tmpdir(), "ota3-")); const m = writeCases({ bBin: img(3000), aBin: img(2000), outDir: dir });
  for (const n of ["good", "badcrc", "badmagic", "trunc", "lenlie", "sigbit", "pad200", "pad400", "to-a"]) assert.ok(m.cases[n], n);
  assert.match(m.imageB.sha256, /^[0-9a-f]{64}$/);
});

test("serveur : Content-Length, chunked sans Content-Length, 404 hors nom valide / traversée", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ota3s-")); writeFileSync(join(dir, "good.ota"), img(9000)); const logs = [];
  const srv = http.createServer(makeHandler({ dir, log: (s) => logs.push(s) })); await new Promise((r) => srv.listen(0, "127.0.0.1", r)); const port = srv.address().port;
  const get = (p) => new Promise((res) => http.get({ port, host: "127.0.0.1", path: p }, (r) => { const c = []; r.on("data", (d) => c.push(d)); r.on("end", () => res({ s: r.statusCode, h: r.headers, b: Buffer.concat(c) })); }));
  try {
    const a = await get("/good.ota"); assert.equal(a.s, 200); assert.equal(a.h["content-length"], "9000"); assert.deepEqual(a.b, img(9000));
    const c = await get("/chunked/good.ota"); assert.equal(c.s, 200); assert.equal(c.h["content-length"], undefined); assert.match(c.h["transfer-encoding"], /chunked/); assert.deepEqual(c.b, img(9000));
    const sl = await get("/slow/good.ota"); assert.equal(sl.s, 200); assert.equal(sl.b.length, 9000);
    for (const bad of ["/../x.ota", "/good.bin", "/Good.ota", "/nope.ota", "/%2e%2e/good.ota", "/slow/../good.ota"]) assert.equal((await get(bad)).s, 404, bad);
    assert.ok(logs.some((l) => l.includes("GET /good.ota")));
  } finally { srv.close(); }
});
