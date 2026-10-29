// UX jalon 1 (29/10/2026) — vocabulaire public : Galerie / Œuvres / Appareils / « Associer un appareil » ; aucun chemin ne change, les termes techniques restent dans les vues avancées.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const read = (p: string) => fs.readFileSync(path.join(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");

test("Galerie : titre, sous-titre, onglets « Œuvres validées / rejetées », lien Créations IA vers /gallery-ana, filtre Animations conservé", () => {
  const g = read("app/gallery/GalleryClient.tsx");
  assert.doesNotMatch(g, /Block Explorer/);
  assert.match(g, /Galerie\n\s*<\/h1>/);
  assert.match(g, /Œuvres validées par le réseau/);
  assert.match(g, /Œuvres validées\n\s*<\/button>/);
  assert.match(g, /Œuvres rejetées\n\s*<\/button>/);
  assert.ok(g.includes("/gallery-ana"), "Agents IA reste atteignable depuis la Galerie");
  assert.ok(g.includes('["animation", "🎞 Animations"]'));
  assert.ok(read("app/BlockGalleryClient.tsx").includes("Œuvres récentes"));
});

test("accueil : trois portes « Dessiner », « Galerie », « Installer un appareil » (guide d'installation), sans emoji", () => {
  const h = read("app/page.tsx");
  assert.match(h, /<strong>Dessiner<\/strong>/);
  assert.match(h, /<strong>Galerie<\/strong>/);
  assert.match(h, /href="\/learn\?path=install#installer"[^>]*>\s*<strong>Installer un appareil<\/strong>/);
  assert.doesNotMatch(h, /home-action__icon/);
  assert.doesNotMatch(h, /<strong>Découvrir<\/strong>|Connecter mon écran/);
});

test("« Associer un appareil » remplace « Connecter mon écran » / « Ajouter un ESP » / « Onboard » dans l'interface ; « Appareils liés » remplace « ESP liés »", () => {
  for (const f of ["app/profile/page.tsx", "app/circles/CirclesClient.tsx", "app/draw/DrawChoice.tsx", "app/onboard/page.tsx", "app/learn/data/catalog.ts"]) assert.doesNotMatch(read(f), /Connecter mon écran|Ajouter un ESP/, f);
  assert.ok(read("app/profile/page.tsx").includes("+ Associer un appareil"));
  assert.ok(read("app/profile/page.tsx").includes('label: "Appareils liés"'));
  assert.ok(read("app/artists/[artistId]/page.tsx").includes('label: "Appareils liés"'));
  assert.ok(read("app/onboard/page.tsx").includes(">Associer un appareil</h1>"));
  const guide = read("app/learn/components/InstallGuide.tsx");
  assert.doesNotMatch(guide, />Onboard</);
  assert.ok(guide.includes('<Link href="/onboard">page d’association</Link>'));
});

test("les chemins n'ont pas changé : /onboard, /gallery-ana, /learn?path=install#installer restent les destinations", () => {
  assert.ok(read("app/profile/page.tsx").includes('href="/onboard"'));
  assert.ok(read("app/circles/CirclesClient.tsx").includes('href="/onboard"'));
  assert.ok(read("app/draw/DrawChoice.tsx").includes('href="/onboard"'));
});

test("Galerie : titre et sous-titre empilés, recherche courte et pleine largeur sur téléphone, « Créations IA » = lien secondaire hors du groupe de filtres", () => {
  const g = read("app/gallery/GalleryClient.tsx");
  assert.ok(g.includes('<div className="gc-titlebar">'));
  assert.match(g, /\.gc-titlebar \{ display: flex; flex-direction: column/);
  assert.ok(g.includes('placeholder="Titre, artiste, hash, n° de bloc…"'));
  assert.match(g, /@media \(max-width: 640px\) \{[\s\S]*\.gc-search-bar \{ flex-direction: column/);
  assert.match(g, /\.gc-search-input \{ min-height: 44px; font-size: 16px; \}/);
  const filters = g.slice(g.indexOf('aria-label="Type d’œuvre"'), g.indexOf("{/* Les dessins d’agents IA"));
  assert.ok(!filters.includes("/gallery-ana"), "le lien n'est plus dans le groupe de filtres");
  assert.ok(g.includes('<Link href="/gallery-ana" className="gc-link-secondary">Créations d’agents IA →</Link>'));
});
