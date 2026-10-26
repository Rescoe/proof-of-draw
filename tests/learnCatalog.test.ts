import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  DEPTHS, KINDS, LEARN_PATHS, facetCounts, headingIds, hrefOf, normalize, parsePath, pathForHash, scoreEntry, searchCatalog, sectionsFromBlocks, shorten, tokens,
  type CatalogEntry, type LearnPath, type MdBlock,
} from "../lib/learnCatalog";
import { STATIC_CATALOG } from "../app/learn/data/catalog";
import { buildCatalog } from "../app/learn/catalogBuild";
import { loadHardwareMatrix, loadTroubleshooting } from "../lib/hardwareMatrix";

const read = (p: string) => readFileSync(p, "utf8");
const SOURCES: Record<string, LearnPath> = {
  "app/learn/components/InstallGuide.tsx": "install", "app/learn/components/NoEspPath.tsx": "no-esp", "app/learn/components/ExpertDocumentation.tsx": "network",
  "app/learn/components/PowerPath.tsx": "power", "app/learn/components/SynthesisPath.tsx": "synthesis", "app/learn/components/Troubleshooting.tsx": "help",
  "app/learn/components/Roadmap.tsx": "roadmap", "app/learn/components/CompatibilityMatrix.tsx": "compat",
};
/** Ancres qui ne sont pas des sujets : décalages de défilement et conteneurs. Tout autre id présent dans un composant DOIT figurer au catalogue. */
const NOT_TOPICS = new Set(["roadmap-title", "aide", "matrice", "sans-esp", "install-step-3", "install-step-8", "libraries", "firmware", "configure", "draw", "material", "arduino-ide", "install-step-4", "install-step-6"]);

function anchorsOf(file: string): string[] {
  const src = read(file);
  return [...src.matchAll(/\bid="([a-z0-9-]+)"/g)].map((m) => m[1]);
}

test("chaque ancre d'un composant d'Apprendre est au catalogue (rien ne devient introuvable) ou explicitement hors sujet", () => {
  const catalogued = new Set(buildCatalog().map((e) => `${e.path}:${e.anchor}`));
  for (const [file, path] of Object.entries(SOURCES)) {
    for (const a of anchorsOf(file)) {
      if (NOT_TOPICS.has(a)) continue;
      assert.ok(catalogued.has(`${path}:${a}`), `ancre « ${a} » de ${file} absente du catalogue`);
    }
  }
});

test("chaque entrée STATIQUE pointe vers une ancre qui existe dans le composant de son parcours", () => {
  for (const e of STATIC_CATALOG) {
    const files = Object.entries(SOURCES).filter(([, p]) => p === e.path).map(([f]) => f);
    const found = files.some((f) => read(f).includes(`id="${e.anchor}"`) || read(f).includes(`id: "${e.anchor}"`));
    assert.ok(found, `entrée ${e.id} : ancre « ${e.anchor} » introuvable dans ${files.join(", ")}`);
  }
});

test("les anciennes ancres (liens existants) se redirigent vers le bon parcours, et jamais vers un autre", () => {
  for (const [hash, path] of [["wiring", "install"], ["onboard", "install"], ["sans-esp", "no-esp"], ["how", "network"], ["consensus", "network"], ["consommation", "power"],
    ["synthese", "synthesis"], ["synth-niveaux", "synthesis"], ["depannage", "help"], ["aide", "help"], ["feuille-de-route", "roadmap"], ["compatibilite", "compat"], ["matrice", "compat"]] as const) {
    assert.equal(pathForHash(hash), path, hash);
  }
  assert.equal(pathForHash(""), null); assert.equal(pathForHash("inconnu"), null);
  for (const e of buildCatalog()) {
    const p = pathForHash(e.anchor);
    if (p !== null) assert.equal(p, e.path, `ancre ${e.anchor} : parcours incohérent`);
  }
});

test("parsePath : les 8 parcours, rien d'autre", () => {
  for (const p of LEARN_PATHS) assert.equal(parsePath(p), p);
  assert.equal(parsePath("roadmap"), "roadmap"); assert.equal(parsePath("compat"), "compat");
  assert.equal(parsePath("hack"), null); assert.equal(parsePath(undefined), null); assert.equal(parsePath(["install", "x"]), "install");
});

test("catalogue : identifiants uniques, profondeurs et types valides, résumés non vides, tous les parcours représentés", () => {
  const all = buildCatalog();
  assert.equal(new Set(all.map((e) => e.id)).size, all.length, "ids en double");
  for (const e of all) {
    assert.ok(DEPTHS.includes(e.depth) && KINDS.includes(e.kind), e.id);
    assert.ok(e.title.trim() && e.summary.trim(), `${e.id} : titre/résumé vide`);
    assert.match(hrefOf(e), /^\/learn\?path=[a-z-]+#[a-z0-9-]+$/);
  }
  for (const p of LEARN_PATHS) assert.ok(all.some((e) => e.path === p), `parcours sans entrée : ${p}`);
  for (const d of DEPTHS) assert.ok(all.some((e) => e.depth === d), d);
  for (const k of KINDS) assert.ok(all.some((e) => e.kind === k), k);
});

test("sections des documents markdown : une entrée par titre de niveau 2, ancre = id rendu, texte intégral cherchable", () => {
  const m = loadHardwareMatrix(), h = loadTroubleshooting();
  const mIds = headingIds(m, "c-"), hIds = headingIds(h, "h-");
  const all = buildCatalog();
  for (const [blocks, ids, path] of [[m, mIds, "compat"], [h, hIds, "help"]] as const) {
    blocks.forEach((b, i) => { if (b.kind === "h" && b.level === 2) assert.ok(all.some((e) => e.path === path && e.anchor === ids[i]), `titre « ${b.text} » absent`); });
  }
  assert.ok(all.filter((e) => e.path === "compat" && e.id.startsWith("c-")).length >= 3);
});

test("headingIds : stable, unique (doublons suffixés), vide hors titres 2-3", () => {
  const blocks: MdBlock[] = [{ kind: "h", level: 2, text: "Wi-Fi : ça ne marche pas" }, { kind: "p", text: "x" }, { kind: "h", level: 2, text: "Wi-Fi : ça ne marche pas" }, { kind: "h", level: 1, text: "Titre" }];
  assert.deepEqual(headingIds(blocks, "h-"), ["h-wi-fi-ca-ne-marche-pas", null, "h-wi-fi-ca-ne-marche-pas-2", null]);
  assert.deepEqual(headingIds(blocks, "h-"), headingIds(blocks, "h-"));
});

test("sectionsFromBlocks : résumé = premier paragraphe, texte = jusqu'au titre suivant, liens markdown nettoyés", () => {
  const blocks: MdBlock[] = [
    { kind: "h", level: 2, text: "Batterie" }, { kind: "p", text: "Voir [le guide](/learn?path=power) pour l'autonomie." }, { kind: "ul", items: ["a", "b"] },
    { kind: "h", level: 2, text: "Suite" }, { kind: "p", text: "autre" },
  ];
  const [a, b] = sectionsFromBlocks(blocks, { prefix: "c-", path: "compat", kind: "reference", depth: "pratiquer" });
  assert.equal(a.summary, "Voir le guide pour l'autonomie.");
  assert.ok(a.body!.includes("a b") && !a.body!.includes("autre"));
  assert.equal(b.title, "Suite");
});

test("sectionsFromBlocks : le résumé n'est jamais un tableau brut et ne coupe jamais un mot", () => {
  const long = "mot ".repeat(80).trim();
  const blocks: MdBlock[] = [
    { kind: "h", level: 2, text: "Profils" }, { kind: "table", head: ["Profil", "Vote"], rows: [["tft18", "V2"]] },
    { kind: "h", level: 2, text: "Longue" }, { kind: "p", text: long },
  ];
  const [a, b] = sectionsFromBlocks(blocks, { prefix: "c-", path: "compat", kind: "reference", depth: "pratiquer" });
  assert.ok(!a.summary.includes("tft18") && a.summary.length > 0);
  assert.ok(a.body!.includes("tft18"), "le tableau reste cherchable");
  assert.ok(b.summary.endsWith("…") && b.summary.length <= 191 && /mot…$/.test(b.summary));
  assert.equal(shorten("court", 190), "court");
});

test("normalize / tokens : accents, ponctuation, apostrophes, casse", () => {
  assert.equal(normalize("Câblage  Wi‑Fi, l’écran !"), "cablage wi fi l ecran");
  assert.deepEqual(tokens("  Écran   Noir "), ["ecran", "noir"]);
});

const ENTRIES: CatalogEntry[] = [
  { id: "a", path: "install", anchor: "wiring", title: "Câbler l’écran à la carte", summary: "Schéma de branchement.", kind: "guide", depth: "pratiquer", keywords: ["câblage", "broches"] },
  { id: "b", path: "help", anchor: "depannage", title: "Dépannage Wi-Fi", summary: "La carte ne se connecte pas.", kind: "depannage", depth: "pratiquer", keywords: ["wifi"] },
  { id: "c", path: "network", anchor: "consensus", title: "Protocole de consensus", summary: "Votes signés et quorum.", kind: "concept", depth: "comprendre", body: "le wifi de la carte n'intervient pas" },
];

test("recherche : insensible aux accents et à la ponctuation (wifi = Wi-Fi), tous les mots requis, titre avant texte", () => {
  assert.deepEqual(searchCatalog(ENTRIES, { query: "wifi" }).map((e) => e.id), ["b", "c"]);   // titre/mots-clés avant le texte intégral
  assert.deepEqual(searchCatalog(ENTRIES, { query: "cablage ecran" }).map((e) => e.id), ["a"]);
  assert.deepEqual(searchCatalog(ENTRIES, { query: "wifi cablage" }).map((e) => e.id), []);   // AND
  assert.deepEqual(searchCatalog(ENTRIES, { query: "QUORUM" }).map((e) => e.id), ["c"]);
  assert.deepEqual(searchCatalog(ENTRIES, { query: "cabl" }).map((e) => e.id), ["a"]);          // début de mot
});

test("recherche : sans requête l'ordre du catalogue est conservé ; filtres profondeur / type combinables", () => {
  assert.deepEqual(searchCatalog(ENTRIES).map((e) => e.id), ["a", "b", "c"]);
  assert.deepEqual(searchCatalog(ENTRIES, { depth: "comprendre" }).map((e) => e.id), ["c"]);
  assert.deepEqual(searchCatalog(ENTRIES, { kind: "depannage" }).map((e) => e.id), ["b"]);
  assert.deepEqual(searchCatalog(ENTRIES, { depth: "pratiquer", kind: "guide" }).map((e) => e.id), ["a"]);
  assert.deepEqual(searchCatalog(ENTRIES, { query: "zzzz" }), []);
  assert.equal(scoreEntry(ENTRIES[0], []), 1);
});

test("facetCounts : chaque famille ignore son propre filtre", () => {
  const c = facetCounts(ENTRIES, { query: "", depth: "comprendre", kind: null });
  assert.equal(c.depth.pratiquer, 2); assert.equal(c.depth.comprendre, 1);   // la profondeur ne se compte pas elle-même
  assert.equal(c.kind.concept, 1); assert.equal(c.kind.guide, 0);            // les types respectent la profondeur choisie
});

test("sur le vrai catalogue : les recherches de tous les jours aboutissent", () => {
  const all = buildCatalog();
  const top = (q: string) => searchCatalog(all, { query: q }).slice(0, 5).map((e) => `${e.path}:${e.anchor}`);
  assert.ok(top("wifi").some((x) => x.startsWith("help:") || x.includes("i-r4-wifi")), "wifi");
  assert.ok(top("cablage").includes("install:wiring"), "câblage");
  assert.ok(top("batterie").some((x) => x.startsWith("power:")), "batterie");
  assert.ok(top("port usb").includes("install:i-port-usb"), "port usb");
  assert.ok(top("vote").some((x) => x.startsWith("network:") || x.startsWith("synthesis:")), "vote");
  assert.ok(top("glossaire").includes("synthesis:synth-glossaire"), "glossaire");
  assert.ok(top("feuille de route").some((x) => x.startsWith("roadmap:")), "feuille de route");
  assert.ok(top("ota").some((x) => x.startsWith("compat:")), "ota");
});

test("page Apprendre : feuille de route et matrice sont des destinations dédiées (plus rendues après chaque parcours), ancres historiques conservées", () => {
  const page = read("app/learn/page.tsx");
  assert.match(page, /path === "roadmap" \? <Roadmap \/>/);
  assert.match(page, /path === "compat" \? <CompatibilityMatrix \/>/);
  assert.equal((page.match(/<Roadmap \/>/g) ?? []).length, 1);
  assert.equal((page.match(/<CompatibilityMatrix \/>/g) ?? []).length, 1);
  assert.match(read("app/learn/components/Roadmap.tsx"), /id="feuille-de-route"/);
  assert.match(read("app/learn/components/CompatibilityMatrix.tsx"), /id="compatibilite"/);
  assert.match(read("app/learn/components/CompatibilityMatrix.tsx"), /id="matrice"/);
});
