// tests/podHttpR4.test.ts — le lecteur HTTP du firmware UNO R4 (arduino_uno_r4/pod_uno_r4/pod_http.h) compilé avec g++ (banc host/http_harness.cpp)
// et rejoué sur des réponses fragmentées à l'octet, avec « silences » du modem : Content-Length, chunked, fermeture, tronqué, illisible.
// Sans compilateur C++ ces tests sont ignorés (et le disent) — jamais faussement verts.

import test, { before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";

const ROOT = path.join(__dirname, "..");
const FW_DIR = path.join(ROOT, "arduino_uno_r4", "pod_uno_r4");

function findCompiler(): string | null {
  const candidates = [process.env.CXX, "g++", "C:\\msys64\\mingw64\\bin\\g++.exe", "/usr/bin/g++", "/usr/local/bin/g++"].filter(Boolean) as string[];
  for (const c of candidates) {
    try { execFileSync(c, ["--version"], { stdio: "ignore" }); return c; } catch { /* suivant */ }
  }
  return null;
}

const compiler = findCompiler();
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "podhttp-"));
const exe = path.join(tmp, process.platform === "win32" ? "http_harness.exe" : "http_harness");
const skip = compiler ? false : "aucun compilateur C++ (g++) trouvé : tests du lecteur HTTP R4 ignorés — définir CXX pour les activer";

before(() => {
  if (!compiler) return;
  const r = spawnSync(compiler, ["-std=c++11", "-Wall", "-Wextra", "-Werror", "-O2", path.join(FW_DIR, "host", "http_harness.cpp"), "-o", exe], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`compilation du lecteur HTTP impossible :\n${r.stdout}\n${r.stderr}`);
});

let n = 0;
function run(raw: Buffer | string, frag: number, stutter: boolean, mode: "bin" | "str" = "bin", cap = 4096) {
  const f = path.join(tmp, `r${n++}.hex`);
  fs.writeFileSync(f, Buffer.from(raw).toString("hex"));
  const out = execFileSync(exe, [f, String(frag), stutter ? "1" : "0", mode, String(cap)], { encoding: "utf8" }).trim();
  const m = /^status=(-?\d+)(?: len=(-?\d+) chunked=(\d) complete=(\d) got=(\d+) body=([0-9a-f]*))?$/.exec(out);
  assert.ok(m, `sortie inattendue : ${out}`);
  return m[1] === "-1" ? { status: -1 } : { status: +m[1], len: +m[2], chunked: m[3] === "1", complete: m[4] === "1", got: +m[5], body: Buffer.from(m[6], "hex") };
}

const CRLF = "\r\n";
const FRAGS = [1, 2, 3, 7, 64, 0];
const payload = Buffer.from(Array.from({ length: 300 }, (_, i) => (i * 37 + 11) & 0xff));

function withLength(body: Buffer, extra = "") {
  return Buffer.concat([Buffer.from(`HTTP/1.1 200 OK${CRLF}Content-Type: application/octet-stream${CRLF}Content-Length: ${body.length}${CRLF}${extra}${CRLF}`), body]);
}
function chunked(body: Buffer, sizes: number[], ext = "") {
  const parts: Buffer[] = [Buffer.from(`HTTP/1.1 200 OK${CRLF}Transfer-Encoding: chunked${CRLF}${CRLF}`)];
  let off = 0;
  for (const s of sizes) {
    const piece = body.subarray(off, off + s); off += s;
    parts.push(Buffer.from(`${piece.length.toString(16)}${ext}${CRLF}`), piece, Buffer.from(CRLF));
  }
  parts.push(Buffer.from(`0${CRLF}${CRLF}`));
  return Buffer.concat(parts);
}

test("Content-Length : corps binaire exact, quelle que soit la fragmentation (avec silences du modem)", { skip }, () => {
  for (const frag of FRAGS) for (const stutter of [false, true]) {
    const r = run(withLength(payload), frag, stutter);
    assert.equal(r.status, 200);
    assert.equal(r.len, 300);
    assert.equal(r.complete, true, `frag=${frag} stutter=${stutter}`);
    assert.deepEqual(r.body, payload);
  }
});

test("en-têtes insensibles à la casse, Connection/Date ignorés", { skip }, () => {
  const raw = Buffer.concat([Buffer.from(`HTTP/1.1 200 OK${CRLF}date: x${CRLF}CONTENT-LENGTH: 5${CRLF}connection: close${CRLF}${CRLF}hello`)]);
  const r = run(raw, 1, true);
  assert.equal(r.status, 200); assert.equal(r.len, 5); assert.equal(r.body!.toString(), "hello");
});

test("Transfer-Encoding: chunked : plusieurs tailles, extensions de chunk, fragmentation à l'octet", { skip }, () => {
  for (const frag of FRAGS) for (const stutter of [false, true]) {
    const r = run(chunked(payload, [1, 16, 100, 183]), frag, stutter);
    assert.equal(r.status, 200);
    assert.equal(r.chunked, true);
    assert.equal(r.complete, true, `frag=${frag} stutter=${stutter}`);
    assert.deepEqual(r.body, payload);
  }
  const ext = run(chunked(payload, [150, 150], ";name=val"), 3, false);
  assert.deepEqual(ext.body, payload); assert.equal(ext.complete, true);
});

test("chunked en majuscules hexa (Ab) et chunk d'une seule fois", { skip }, () => {
  const body = Buffer.alloc(0xab, 0x5a);
  const r = run(Buffer.concat([Buffer.from(`HTTP/1.1 200 OK${CRLF}transfer-encoding: Chunked${CRLF}${CRLF}AB${CRLF}`), body, Buffer.from(`${CRLF}0${CRLF}${CRLF}`)]), 5, true);
  assert.deepEqual(r.body, body); assert.equal(r.complete, true);
});

test("sans Content-Length : lit jusqu'à la fermeture", { skip }, () => {
  const raw = Buffer.concat([Buffer.from(`HTTP/1.1 200 OK${CRLF}${CRLF}`), payload]);
  const r = run(raw, 5, true);
  assert.equal(r.len, -1); assert.deepEqual(r.body, payload); assert.equal(r.complete, true);
});

test("corps TRONQUÉ (connexion coupée) : détecté, jamais présenté comme complet", { skip }, () => {
  const full = withLength(payload);
  const cut = full.subarray(0, full.length - 100);
  const r = run(cut, 7, false);
  assert.equal(r.status, 200); assert.equal(r.complete, false); assert.equal(r.got, 200);
  const ch = chunked(payload, [100, 200]);
  const r2 = run(ch.subarray(0, ch.length - 30), 7, false);
  assert.equal(r2.complete, false);
});

test("codes d'erreur et corps JSON : 404 / 429 lus en chaîne", { skip }, () => {
  const json = '{"error":"no frame"}';
  const raw = Buffer.from(`HTTP/1.1 404 Not Found${CRLF}Content-Type: application/json${CRLF}Content-Length: ${json.length}${CRLF}${CRLF}${json}`);
  const r = run(raw, 4, true, "str", 256);
  assert.equal(r.status, 404); assert.equal(r.body!.toString(), json); assert.equal(r.complete, true);
});

test("readBodyString : tampon trop petit = tronqué signalé (complete=false), jamais de débordement", { skip }, () => {
  const json = JSON.stringify({ a: "x".repeat(200) });
  const raw = Buffer.from(`HTTP/1.1 200 OK${CRLF}Content-Length: ${json.length}${CRLF}${CRLF}${json}`);
  const r = run(raw, 0, false, "str", 64);
  assert.equal(r.complete, false); assert.equal(r.got, 63);
  const ok = run(raw, 0, false, "str", json.length + 1);
  assert.equal(ok.complete, true); assert.equal(ok.body!.toString(), json);
});

test("réponses illisibles refusées (status -1) : bruit, code absurde, silence total", { skip }, () => {
  assert.equal(run(Buffer.from("garbage\r\n\r\n"), 3, false).status, -1);
  assert.equal(run(Buffer.from(`HTTP/1.1 999 X${CRLF}${CRLF}`), 3, false).status, -1);
  assert.equal(run(Buffer.alloc(0), 3, false).status, -1);
  assert.equal(run(Buffer.from(`HTTP/1.1 200 OK${CRLF}Content-Length: 4`), 1, false).status, -1);   // en-têtes jamais terminés
});

test("chunk de taille illisible : erreur, pas de boucle infinie", { skip }, () => {
  const raw = Buffer.from(`HTTP/1.1 200 OK${CRLF}Transfer-Encoding: chunked${CRLF}${CRLF}zz${CRLF}abc${CRLF}0${CRLF}${CRLF}`);
  const r = run(raw, 2, false);
  assert.equal(r.complete, false);
});
