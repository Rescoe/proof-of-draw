// UX jalon 2 (29/10/2026) — composition de l'accueil : un seul journal, aucune section « Actuellement affiché », constellation pleine largeur sans colonne de terminal vide, une seule section d'artistes.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const read = (p: string) => fs.readFileSync(path.join(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");

test("accueil : ordre hero → portes → réseau → journal unique → artistes du réseau → œuvres récentes → comprendre/rejoindre ; plus de RecentArtists séparé", () => {
  const h = read("app/page.tsx");
  const order = ['className="hero"', 'className="home-actions"', '<NetworkMap snapshot={snapshot} surface="home" />', "<EspActivityFeed />", "<NetworkArtists snapshot={snapshot} />", "<BlockGallery />", 'className="home-learn"'];
  let at = -1;
  for (const needle of order) { const i = h.indexOf(needle); assert.ok(i > at, `${needle} absent ou dans le mauvais ordre`); at = i; }
  assert.equal(h.split("<EspActivityFeed").length - 1, 1, "UN seul journal sur l'accueil");
  assert.ok(!h.includes("<RecentArtists"), "pas de seconde liste d'artistes");
  assert.ok(!h.includes("LiveDisplays"), "aucune section « Actuellement affiché » sur l'accueil");
});

test("NetworkMap : prop surface explicite, défaut « network » ; en « home » ni terminal ni LiveDisplaysSection, panneau seulement avec une sélection", () => {
  const m = read("app/network/NetworkMap.tsx");
  assert.ok(m.includes('export type NetworkSurface = "home" | "network";'));
  assert.ok(m.includes('surface = "network"'));
  assert.ok(m.includes("(!isHome || selected) && ("), "pas d'aside (donc pas de colonne) en accueil sans sélection");
  assert.match(m, /\{!isHome && \(\s*<LiveDisplaysSection/);
  assert.ok(read("app/network/page.tsx").includes('surface="network"'), "/network passe la surface explicitement");
  // les miniatures des nœuds et les boucles d'animation viennent de la même lecture (useLiveDisplays) : conservées
  assert.ok(m.includes("displays={live.data?.displays ?? null}"));
});

test("grille de l'accueil : une colonne sans sélection ; deux colonnes seulement avec un détail ouvert ; une colonne (détail sous la carte) à 900 px et moins", () => {
  const m = read("app/network/NetworkMap.tsx");
  assert.match(m, /\.nv2-layout--home \{ grid-template-columns: minmax\(0, 1fr\); \}/);
  assert.match(m, /\.nv2-layout--home\.nv2-layout--home-selected \{ grid-template-columns: minmax\(0, 1fr\) minmax\(300px, 340px\); \}/);
  const mediaAt = m.indexOf("@media (max-width: 900px) {");
  assert.ok(mediaAt > m.indexOf(".nv2-layout--home.nv2-layout--home-selected"), "la règle étroite vient après et l'emporte");
  assert.ok(m.slice(mediaAt, mediaAt + 300).includes(".nv2-layout--home.nv2-layout--home-selected { grid-template-columns: 1fr; }"));
});

test("Artistes du réseau : section unique et bornée, dérivée du snapshot (aucune lecture de plus), deux vues d'une même liste", () => {
  const s = read("app/NetworkArtists.tsx");
  assert.ok(s.includes("networkArtists(snapshot.devices, NETWORK_ARTISTS_MAX)") && s.includes("NETWORK_ARTISTS_MAX = 6"));
  assert.ok(!/redis/i.test(s), "pas d'accès Redis direct ici");
  const c = read("app/NetworkArtistsClient.tsx");
  assert.ok(c.includes("Actifs maintenant") && c.includes("Nouveaux artistes") && c.includes("Tous les artistes →"));
  assert.ok(c.includes("Artistes du réseau"));
});
