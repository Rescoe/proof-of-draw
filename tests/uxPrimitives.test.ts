// UX jalon 1 (29/10/2026) — primitives CSS partagées : cadre de page, boutons, pilules (disponibles, aucune page migrée dans ce commit).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const css = fs.readFileSync(path.join(__dirname, "..", "app/globals.css"), "utf8").replace(/\r\n/g, "\n");

test("primitives : .pod-page avec gouttières 16 / 24 / 32 px, .pod-btn à 44 px, .pod-pills qui passent à la ligne", () => {
  assert.match(css, /\.pod-page \{[^}]*padding: 1rem 16px 3rem/);
  assert.match(css, /@media \(min-width: 600px\) \{ \.pod-page \{ padding-inline: 24px; \} \}/);
  assert.match(css, /@media \(min-width: 1024px\) \{ \.pod-page \{ padding-inline: 32px; \} \}/);
  assert.match(css, /\.pod-btn \{[^}]*min-height: 44px/);
  assert.match(css, /\.pod-btn--sm \{ min-height: 36px/);
  assert.match(css, /\.pod-pills \{ display: flex; flex-wrap: wrap/);
  assert.match(css, /\.pod-pill\[aria-pressed="true"\][^{]*\{[^}]*text-decoration: underline/, "état actif aussi marqué par le trait, pas la couleur seule");
});
