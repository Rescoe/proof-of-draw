// UX jalon 1 (29/10/2026) — états actifs de la navigation : exactement UNE entrée active dans la barre bureau pour chaque URL historique, et un lien actif par destination dans le tiroir.
import test from "node:test";
import assert from "node:assert/strict";
import { DRAWER_GROUPS, NAV_ENTRIES, activeDrawerHrefs, activeEntryId, isActive, isCurrentPage, type NavLink } from "../lib/navLinks";

const split = (url: string): [string, string] => { const i = url.indexOf("?"); return i < 0 ? [url, ""] : [url.slice(0, i), url.slice(i)]; };

// URL (avec requête) → entrée de la barre bureau attendue
const DESKTOP: Array<[string, string | null]> = [
  ["/", "accueil"],
  ["/gallery", "galerie"], ["/gallery?type=animation", "galerie"], ["/gallery-ana", "galerie"], ["/gallery-anim", "galerie"],
  ["/draw", "creer"], ["/draw/dev_ABCDEFGH/tft28", "creer"], ["/animer", "creer"], ["/draw-lab", "creer"],
  ["/network", "reseau"],
  ["/artists", "communaute"], ["/artists/abc", "communaute"], ["/circles", "communaute"],
  ["/learn", "apprendre"], ["/learn?path=install", "apprendre"], ["/learn?path=compat", "apprendre"], ["/firmware", "apprendre"],
  ["/profile", "espace"], ["/my-devices", "espace"], ["/onboard", "espace"],
  ["/bench", null], ["/measures-lab", null],
];

test("barre bureau : chaque URL historique allume exactement l'entrée attendue (une seule), les pages hors navigation n'en allument aucune", () => {
  for (const [url, expected] of DESKTOP) {
    const [p, q] = split(url);
    assert.equal(activeEntryId(p, q), expected, url);
  }
});

test("barre bureau : « Communauté » est active pour Artistes et Cercles privés, « Galerie » ne l'est plus pour /artists", () => {
  assert.equal(activeEntryId("/artists/x"), "communaute");
  assert.notEqual(activeEntryId("/artists/x"), "galerie");
});

// URL → liens du tiroir actifs (au plus un, l'accueil compris)
const DRAWER: Array<[string, string[]]> = [
  ["/", ["/"]],
  ["/draw", ["/draw"]], ["/animer", ["/draw"]], ["/gallery", ["/gallery"]], ["/gallery?type=animation", ["/gallery"]], ["/gallery-ana", ["/gallery"]],
  ["/network", ["/network"]], ["/artists/abc", ["/artists"]], ["/circles", ["/circles"]],
  ["/profile", ["/profile"]], ["/my-devices", ["/profile"]], ["/onboard", ["/onboard"]],
  ["/learn", ["/learn"]], ["/learn?path=compat", ["/learn"]], ["/learn?path=help", ["/learn"]], ["/firmware", ["/learn"]],
  ["/learn?path=install", ["/learn?path=install#installer"]],
  ["/learn?path=network", ["/learn?path=network#how"]],
];

test("tiroir : un seul lien actif par adresse ; /onboard allume « Associer un appareil » et non « Mon espace » ; /learn?path=install allume « Installer un appareil »", () => {
  for (const [url, expected] of DRAWER) {
    const [p, q] = split(url);
    assert.deepEqual(activeDrawerHrefs(p, q), expected, url);
  }
});

test("isActive : préfixe exact (« /drawing » n'est pas « /draw »), règles de requête (query / notQuery)", () => {
  const draw: NavLink = { href: "/draw", label: "x" };
  assert.equal(isActive(draw, "/draw/dev_A/tft28"), true);
  assert.equal(isActive(draw, "/drawing"), false);
  const install = DRAWER_GROUPS[3].links[1];
  assert.equal(isActive(install, "/learn", "?path=install"), true);
  assert.equal(isActive(install, "/learn", "?path=help"), false);
  assert.equal(isActive(install, "/learn", ""), false);
  const understand = DRAWER_GROUPS[3].links[0];
  assert.equal(isActive(understand, "/learn", ""), true);
  assert.equal(isActive(understand, "/learn", "?path=install"), false);
  assert.equal(isActive(understand, "/learn", "?path=network"), false);
});

test("aria-current=\"page\" est réservé au lien qui représente EXACTEMENT la page courante ; une section parente reste « active » (style) sans aria-current", () => {
  const nav = NAV_ENTRIES.flatMap((e) => (e.kind === "link" ? [e.link] : e.links));
  const cur = (url: string) => { const [p, q] = split(url); return nav.filter((l) => isCurrentPage(l, p, q)).map((l) => l.label); };
  assert.deepEqual(cur("/artists"), ["Artistes"]);
  assert.deepEqual(cur("/artists/abc"), [], "page d'un artiste : Communauté reste active (style), aucun lien n'est « la page courante »");
  assert.equal(activeEntryId("/artists/abc"), "communaute");
  assert.deepEqual(cur("/circles"), ["Cercles privés"]);
  assert.deepEqual(cur("/learn"), ["Apprendre"]);
  assert.deepEqual(cur("/onboard"), [], "/onboard allume « Mon espace » (style) mais n'est pas la page /profile");
  assert.equal(activeEntryId("/onboard"), "espace");
  assert.deepEqual(cur("/gallery-ana"), [], "autre galerie : Galerie active (style), pas la page courante");
  assert.deepEqual(cur("/gallery"), ["Galerie"]);
  assert.deepEqual(cur("/"), ["Accueil"]);
});
