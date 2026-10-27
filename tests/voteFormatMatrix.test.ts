// LOT 4 (28/10/2026) — matrice « famille de firmware × format du candidat » : déduite du code, comparée au document, et AUCUNE famille ne peut être « NON » sans que le test le dise.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { FAMILIES, FORMATS, NEED, cell, renderMatrix, verifyFamilies } from "./helpers/voteFormatMatrix";

const doc = fs.readFileSync(path.join(__dirname, "..", "docs", "MATRICE_VALIDATEUR_X_FORMAT_2026_10_28.md"), "utf8").replace(/\r\n/g, "\n");

test("le code des sketchs correspond à ce que la matrice affirme (motifs de tampon, BUF_SIZE, podKindFromName des cinq formats)", () => {
  assert.deepEqual(verifyFamilies(), []);
});

test("le tableau du document est EXACTEMENT celui qui est déduit du code (régénérer avec scripts/gen-vote-format-matrix.ts)", () => {
  const m = /<!-- MATRIX:BEGIN -->\n([\s\S]*?)\n<!-- MATRIX:END -->/.exec(doc);
  assert.ok(m, "marqueurs du tableau");
  assert.equal(m![1], renderMatrix());
});

test("règle produit : CHAQUE famille relit CHAQUE format (aucune cellule NON) ; un tampon statique couvre le besoin le plus grand (4 736 o)", () => {
  for (const f of FAMILIES) for (const fmt of FORMATS) assert.ok(!cell(f, fmt).startsWith("NON"), `${f.id} × ${fmt} : ${cell(f, fmt)}`);
  assert.equal(Math.max(...FORMATS.map((x) => NEED[x])), 4736);
  for (const f of FAMILIES) if (f.provides !== "tas") assert.ok(f.provides >= 4736, `${f.id} : tampon statique insuffisant`);
});

test("MUTANTS : un tampon trop petit ou un format inconnu seraient vus par la matrice", () => {
  const small = { ...FAMILIES[0], provides: 1000 as number | "tas" };
  assert.ok(cell(small, "eink29bwr").startsWith("NON"));
  assert.ok(cell(small, "oled096").startsWith("NON"), "1 000 o < 1 024 o");
  assert.ok(cell(small, "tft28").startsWith("oui"), "un format sans tampon reste lisible");
});
