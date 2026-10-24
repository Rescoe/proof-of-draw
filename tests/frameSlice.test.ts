// tests/frameSlice.test.ts — frame par morceaux (24/10/2026) : contrat de /api/pull-frame?off=&len= et rétro-compatibilité.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { FRAME_SLICE_MAX, parseFrameSlice } from "../lib/frameSlice";

const TOTAL = 9472;
test("sans off ni len : réponse complète (firmwares déployés inchangés)", () => {
  assert.deepEqual(parseFrameSlice(null, null, TOTAL), { ok: true, whole: true, off: 0, end: TOTAL });
});
test("morceaux : bornes exactes, dernier morceau tronqué à la fin", () => {
  assert.deepEqual(parseFrameSlice("0", "2368", TOTAL), { ok: true, whole: false, off: 0, end: 2368 });
  assert.deepEqual(parseFrameSlice("7104", "2368", TOTAL), { ok: true, whole: false, off: 7104, end: 9472 });
  assert.deepEqual(parseFrameSlice("9000", "4096", TOTAL), { ok: true, whole: false, off: 9000, end: 9472 });
});
test("le découpage de 4 morceaux de 2 368 o reconstitue exactement les deux plans de 4 736 o", () => {
  let got = 0; const seen: Array<[number, number]> = [];
  for (let off = 0; off < TOTAL; off += 2368) { const s = parseFrameSlice(String(off), "2368", TOTAL); assert.ok(s.ok && !s.whole); if (s.ok) { seen.push([s.off, s.end]); got += s.end - s.off; } }
  assert.equal(got, TOTAL); assert.deepEqual(seen, [[0, 2368], [2368, 4736], [4736, 7104], [7104, 9472]]);   // aucun morceau ne traverse la frontière noir / rouge (4 736)
});
test("refus : un seul des deux paramètres, non numériques, len hors bornes, off hors de la frame", () => {
  for (const [o, l] of [["0", null], [null, "100"], ["a", "100"], ["0", "x"], ["-1", "100"], ["0", "0"], ["0", String(FRAME_SLICE_MAX + 1)], [String(TOTAL), "10"], ["99999999", "10"], ["0", "1e3"]] as Array<[string | null, string | null]>)
    assert.equal(parseFrameSlice(o, l, TOTAL).ok, false, `${o}/${l}`);
});
test("la route utilise binResponse pour les quatre écrans binaires et annonce la taille totale", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "app/api/pull-frame/route.ts"), "utf8").replace(/\r\n/g, "\n");
  assert.equal((src.match(/return binResponse\(/g) ?? []).length, 4);
  assert.match(src, /"X-Frame-Total"/);
  assert.match(src, /parseFrameSlice\(url\.searchParams\.get\("off"\), url\.searchParams\.get\("len"\)/);
});
