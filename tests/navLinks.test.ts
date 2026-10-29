// UX jalon 1 (29/10/2026) — navigation : une architecture, deux présentations (barre bureau, tiroir tablette/téléphone), aucune destination perdue, aucun libellé technique.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { DRAWER_GROUPS, DRAWER_HOME, NAV_ENTRIES, allNavHrefs, pathOf } from "../lib/navLinks";

const read = (p: string) => fs.readFileSync(path.join(__dirname, "..", p), "utf8");
const label = (e: (typeof NAV_ENTRIES)[number]) => (e.kind === "link" ? e.link.label : e.label);

test("barre bureau : Accueil · Galerie · Créer une œuvre · Réseau · Communauté · Apprendre · Mon espace (décision D1)", () => {
  assert.deepEqual(NAV_ENTRIES.map(label), ["Accueil", "Galerie", "Créer une œuvre", "Réseau", "Communauté", "Apprendre", "Mon espace"]);
});

test("« Créer une œuvre » est l'unique appel à l'action ; « Communauté » regroupe Artistes et Cercles privés", () => {
  const ctas = NAV_ENTRIES.filter((e) => e.kind === "link" && e.cta);
  assert.deepEqual(ctas.map(label), ["Créer une œuvre"]);
  const community = NAV_ENTRIES.find((e) => e.kind === "menu");
  assert.ok(community && community.kind === "menu");
  assert.deepEqual(community.links.map((l) => [l.label, l.href]), [["Artistes", "/artists"], ["Cercles privés", "/circles"]]);
});

test("tiroir : Accueil puis exactement les quatre groupes PARTICIPER · EXPLORER · MON COMPTE · AIDE, dans cet ordre", () => {
  assert.equal(DRAWER_HOME.label, "Accueil");
  assert.deepEqual(DRAWER_GROUPS.map((g) => g.label), ["Participer", "Explorer", "Mon compte", "Aide"]);
  assert.deepEqual(DRAWER_GROUPS.map((g) => g.links.map((l) => l.label)), [
    ["Créer une œuvre", "Galerie"],
    ["Réseau en direct", "Artistes", "Cercles privés"],
    ["Mon espace", "Associer un appareil"],
    ["Comprendre Proof-of-Draw", "Installer un appareil", "Documentation technique"],
  ]);
});

test("vocabulaire : « Onboard » n'est jamais un libellé ; « Associer un appareil » mène à /onboard ; « Installer un appareil » au guide d'installation", () => {
  const labels = [...NAV_ENTRIES.flatMap((e) => (e.kind === "link" ? [e.link.label] : [e.label, ...e.links.map((l) => l.label)])), DRAWER_HOME.label, ...DRAWER_GROUPS.flatMap((g) => g.links.map((l) => l.label))];
  assert.ok(!labels.some((l) => /onboard|plus$|block explorer/i.test(l)), labels.join(" | "));
  const by = (l: string) => DRAWER_GROUPS.flatMap((g) => g.links).find((x) => x.label === l)!;
  assert.equal(by("Associer un appareil").href, "/onboard");
  assert.equal(by("Installer un appareil").href, "/learn?path=install#installer");
  assert.equal(by("Documentation technique").href, "/learn?path=network#how");
});

test("aucune destination historique n'est perdue : la navigation expose les chemins principaux, la Galerie garde le filtre Animations", () => {
  const paths = new Set(allNavHrefs().map(pathOf));
  for (const p of ["/", "/draw", "/gallery", "/network", "/artists", "/circles", "/learn", "/profile", "/onboard"]) assert.ok(paths.has(p), p);
  const gal = read("app/gallery/GalleryClient.tsx");
  assert.match(gal, /\["animation", "🎞 Animations"\]/, "le filtre Animations reste dans la Galerie");
});

test("hamburger : la barre complète est masquée à 1024 px (plus à 560 px) et la barre ne passe jamais à la ligne", () => {
  const css = read("app/globals.css").replace(/\r\n/g, "\n");
  const m = /@media \(max-width: 1024px\) \{\n  \.site-nav__links \{ display: none !important; \}\n  \.nav-burger \{ display: flex !important; \}\n\}/.exec(css);
  assert.ok(m, "bloc de bascule à 1024 px");
  assert.doesNotMatch(css, /@media \(max-width: 560px\) \{[^}]*\.site-nav__links \{ display: none/, "plus de bascule à 560 px");
  assert.match(css, /\.site-nav__links \{[^}]*flex-wrap: nowrap/);
});

test("accessibilité : aria-current, Échap + clic extérieur sur « Communauté », tiroir groupé avec rôle group", () => {
  const nav = read("app/NavMenu.tsx");
  assert.match(nav, /aria-current=\{/);
  assert.match(nav, /aria-haspopup="menu"/);
  assert.match(nav, /e\.key === "Escape"/);
  assert.match(nav, /document\.addEventListener\("mousedown", onDown\)/);
  assert.match(nav, /role="group" aria-labelledby=/);
  assert.match(nav, /<Suspense fallback=\{<NavMenuView search="" \/>\}>/, "useSearchParams derrière une frontière Suspense");
});

test("tiroir : focus piégé (Tab / Maj+Tab), premier lien focalisé à l'ouverture, focus rendu au bouton, reste de la page inerte", () => {
  const nav = read("app/NavMenu.tsx");
  for (const needle of ['main?.setAttribute("inert", "")', 'main?.removeAttribute("inert")', 'e.key !== "Tab"', "e.shiftKey && cur === first", "last.focus()", "burgerRef.current?.focus()", "?.focus()", "aria-controls=\"nav-drawer\""]) {
    assert.ok(nav.includes(needle), needle);
  }
});

test("Communauté : le bouton n'a jamais aria-current (ce n'est pas un lien vers la page) ; les liens du menu et du tiroir utilisent isCurrentPage", () => {
  const nav = read("app/NavMenu.tsx");
  assert.ok(!nav.includes('aria-controls={`nav-${id}-menu`} aria-current'), "pas d'aria-current sur le bouton Communauté");
  assert.ok((nav.match(/isCurrentPage\(/g) ?? []).length >= 4, "barre, menu, tiroir (accueil + groupes)");
});

test("tiroir : ancré sous la barre (top: 100%), défilable jusqu'au dernier lien, zones sûres respectées", () => {
  const css = read("app/globals.css").replace(/\r\n/g, "\n");
  const m = /\.nav-drawer \{([^}]*)\}/.exec(css);
  assert.ok(m, ".nav-drawer");
  assert.match(m[1], /position: absolute/);
  assert.match(m[1], /top: 100%/);
  assert.match(m[1], /overflow-y: auto/);
  assert.match(m[1], /max-height: calc\(100dvh - 80px\)/);
  assert.match(m[1], /env\(safe-area-inset-bottom/);
  assert.doesNotMatch(m[1], /76px/, "plus de valeur magique pour la hauteur de la barre");
});
