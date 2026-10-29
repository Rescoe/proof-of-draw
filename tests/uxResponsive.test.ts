// UX jalon 3 (29/10/2026) — responsive des pages de contenu : gouttières communes, matrice en cartes sur téléphone, grilles à une colonne sur très petit écran.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const read = (p: string) => fs.readFileSync(path.join(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");

test("matrice de compatibilité : tableau au-delà de 720 px, une CARTE par ligne en dessous (titre de colonne répété devant chaque valeur)", () => {
  const md = read("app/learn/components/MarkdownDoc.tsx");
  assert.ok(md.includes("styles.synthTableCards") && md.includes("data-label="));
  const css = read("app/learn/learn.module.css");
  const m = /@media \(max-width: 720px\) \{\n  \.synthTableCards \{[^}]*\}[\s\S]*?\n\}/.exec(css);
  assert.ok(m, "bloc responsive des cartes");
  assert.match(m[0], /\.synthTableCards tr \{[^}]*border-radius: 12px/);
  assert.match(m[0], /\.synthTableCards td::before \{ content: attr\(data-label\)/);
  assert.match(m[0], /\.synthTableCards thead \{ display: none; \}/, "en-tête retiré de la mise en page (sinon ses cellules élargissent la page) ; titres répétés par data-label");
  // seuls les tableaux issus du Markdown (matrice) passent en cartes : les tableaux écrits à la main de la synthèse gardent leur forme
  assert.ok(!read("app/learn/components/SynthesisPath.tsx").includes("synthTableCards"));
});

test("gouttières : /draw et /circles utilisent .pod-page (plus de padding « 1.5rem 0 »), message de cercle à la ligne", () => {
  assert.ok(read("app/draw/DrawChoice.tsx").includes('className="pod-page pod-page--narrow"'));
  const c = read("app/circles/CirclesClient.tsx");
  assert.ok(c.includes('className="pod-page"'));
  assert.ok(!c.includes('padding: "1.5rem 0 3rem"'));
  assert.ok(c.includes('flexWrap: "wrap" }}>') && c.includes('flex: "1 1 200px", minWidth: 0'));
});

test("artistes : grille d'œuvres à une colonne sous 420 px, deux sous 600 px", () => {
  const a = read("app/artists/[artistId]/page.tsx");
  assert.ok(a.includes("@media (max-width: 420px) {\n          .ab-grid { grid-template-columns: 1fr; }"));
  assert.ok(a.includes("@media (max-width: 600px) {\n          .ab-grid {\n            grid-template-columns: repeat(2, 1fr);"));
});
