// tests/publicState.test.ts — ÉTAT PUBLIC COHÉRENT (15/10/2026) : une source unique (lib/projectStatus.ts), et des tests qui REFUSENT les anciennes affirmations dans les surfaces publiques
// (README, AGENTS.md, CLAUDE.md, page Apprendre, feuille de route, métadonnées, manifeste, /llms.txt) ainsi que toute annonce de ce que le projet n'est pas.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { HARDWARE_PENDING, HARDWARE_VALIDATED, LIMITS, NEVER_CLAIM, PROOF_BLOCKS, PUBLIC_PAGES, SITE_URL, TRUST_MODEL, VERIFIED_AT, VOTE } from "../lib/projectStatus";
import { buildLlmsTxt } from "../lib/llmsTxt";
import robots from "../app/robots";
import sitemap from "../app/sitemap";
import { ROADMAP } from "../app/learn/data/roadmap";

const root = path.join(__dirname, "..");
const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8").replace(/\r\n/g, "\n");
function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const rel = path.join(dir, e.name);
    if (e.isDirectory()) { if (!["node_modules", ".next"].includes(e.name)) walk(rel, out); } else if (/\.(tsx?|md|json)$/.test(e.name)) out.push(rel);
  }
  return out;
}
/** Surfaces PUBLIQUES et instructions pour agents : tout ce qu'un visiteur, un moteur ou une IA lit comme l'état courant. */
const SURFACES = ["README.md", "AGENTS.md", "CLAUDE.md", "app/layout.tsx", "public/manifest.json", "lib/projectStatus.ts", "lib/llmsTxt.ts", "app/api/esp-firmware/route.ts", ...walk("app/learn")];

// ── source de vérité ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
test("source de vérité : blocs de preuve, familles, formulation canonique du modèle de confiance", () => {
  assert.deepEqual(PROOF_BLOCKS.map((b) => b.index), [100, 101, 103, 104]);
  const b104 = PROOF_BLOCKS.find((b) => b.index === 104)!;
  assert.deepEqual([b104.votesV2, b104.votesV1, b104.rejects], [2, 0, 0]);
  assert.equal(PROOF_BLOCKS.find((b) => b.index === 101)!.votesV1, 1, "le #101 comptait un vote v1 : ne pas le cacher");
  assert.equal(VOTE.operational, true);
  assert.equal(HARDWARE_VALIDATED.length, 4);
  assert.equal(HARDWARE_PENDING.length, 5);
  assert.equal(TRUST_MODEL,
    "Proof-of-Draw fournit une preuve applicative et cryptographique orchestrée par le serveur et les appareils. Les votes v2 sont réellement signés en Ed25519 et vérifiés côté serveur. Les clés sont toutefois stockées dans l'EEPROM ou la flash et ne sont pas protégées par un secure element. La chaîne est liée par hashes et stockée dans l'infrastructure Proof-of-Draw ; elle n'est pas encore une blockchain publique autonome. L'ACK constitue une preuve applicative de traitement par le firmware, pas une preuve optique indépendante des pixels.");
  assert.match(VOTE.nonVoting, /continue de recevoir/); assert.match(VOTE.nonVoting, /pendingValidation/);
  assert.match(VOTE.animations, /encore votées en v1/);
  assert.ok(LIMITS.some((l) => /OTA/.test(l)) && LIMITS.some((l) => /Proof-of-Display Duration/.test(l)));
  assert.equal(NEVER_CLAIM.length, 5);
});

test("README et feuille de route citent les mêmes blocs et le même état que la source", () => {
  const readme = read("README.md");
  for (const b of PROOF_BLOCKS) assert.ok(readme.includes(`#${b.index}`), `README : bloc #${b.index}`);
  assert.match(readme, /lib\/projectStatus\.ts/);
  const road = JSON.stringify(ROADMAP);
  for (const b of PROOF_BLOCKS) assert.ok(road.includes(`#${b.index}`), `feuille de route : bloc #${b.index}`);
  assert.match(read("docs/ETAT_PUBLIC_ET_SOURCES_IA_2026_10_15.md"), new RegExp(VERIFIED_AT));
});

// ── anciennes affirmations REFUSÉES ──────────────────────────────────────────────────────────────────────────────────────────────────────
test("refus : « vote multi-appareils encore en validation » et « vote réel matériel à valider »", () => {
  for (const file of SURFACES) {
    const t = read(file);
    assert.doesNotMatch(t, /real multi-device voting[^.\n]*still under validation/i, `${file} : vote multi-appareils présenté comme en validation`);
    assert.doesNotMatch(t, /vote matériel multi-appareils[^.\n]*(ne doi|reste|attend)/i, `${file}`);
    assert.doesNotMatch(t, /vote réel contrôlé sur le matériel fait encore partie du chantier/i, `${file}`);
  }
});

test("refus : Ed25519 réelle présentée comme future", () => {
  for (const file of SURFACES) {
    const t = read(file);
    assert.doesNotMatch(t, /Signature ED25519 réelle \(clé privée EEPROM/i, `${file} : ancienne ligne de roadmap V2`);
    assert.doesNotMatch(t, /(signature|signatures) Ed25519 (réelle )?(sera|seront|est prévue|à venir|future)/i, `${file}`);
  }
  assert.doesNotMatch(read("AGENTS.md"), /### V2 — Roadmap/);
  assert.match(read("AGENTS.md"), /signature Ed25519 réelle/i);
});

test("refus : tous les votes matériels marqués « non validé » (README) ou « à essayer pour le vote » (Apprendre)", () => {
  const readme = read("README.md");
  assert.doesNotMatch(readme, /\|\s*non validé\s*\|/i, "colonne « Vote réel : non validé »");
  assert.match(readme, /Vote v2 observé sur la carte/);
  const learn = walk("app/learn").map(read).join("\n");
  assert.doesNotMatch(learn, /est encore à essayer pour le vote/i);
  assert.doesNotMatch(learn, /Testé en réel/, "l'ancienne colonne « Testé en réel » mélangeait affichage et vote : remplacée");
  assert.match(read("app/learn/components/SynthesisPath.tsx"), /Vote v2 observé sur la carte/);
});

test("refus : les appareils non votants présentés comme ne recevant rien, ou les votes v1 comme comptés", () => {
  const road = read("app/learn/data/roadmap.ts"), synth = read("app/learn/components/SynthesisPath.tsx");
  assert.doesNotMatch(road, /seuls les firmwares qui savent voter en v2 comptent, reçoivent et votent/i);
  assert.doesNotMatch(road, /(ne reçoivent|ne reçoit) (rien|aucune)/i);
  assert.match(road, /RECEVOIR les œuvres/);
  assert.doesNotMatch(synth, /votes anciens \(écho\) sont encore comptés/i);
  assert.doesNotMatch(synth, /Un appareil non appairé peut encore voter/i);
  for (const s of [road, synth]) assert.doesNotMatch(s, /micro-canari sur la carte à faire/i);
});

test("refus : lignes contradictoires de la feuille de route (TFT 2,8″, pile Ed25519 R4)", () => {
  const items = Object.fromEntries(ROADMAP.flatMap((p) => p.items).map((i) => [i.id, i]));
  assert.equal(items["fw-tft28"].status, "done");
  assert.doesNotMatch(items["fw-tft28"].note ?? "", /reste à reprendre|marge de pile encore trop étroite/);
  assert.equal(items["r4-stack"].status, "done");
  assert.doesNotMatch(items["r4-stack"].note ?? "", /à faire\.?$/);
  assert.equal(items["r4-net-stack"].status, "done");
  assert.notEqual(items["ota"].status, "done");
  assert.equal(items["fw-qualification"].status, "doing");
});

test("refus : licence — code annoncé MIT alors que le README réserve les droits ; CC0 annoncé sans consentement", () => {
  assert.match(read("README.md"), /Aucune licence logicielle n’est actuellement accordée/);
  for (const file of SURFACES) {
    if (file === "lib/projectStatus.ts" || file === "tests/publicState.test.ts") continue;
    const t = read(file);
    assert.doesNotMatch(t, /Licence MIT|Licence : MIT|MIT — code libre|sous licence MIT/i, `${file} : code annoncé MIT`);
    assert.doesNotMatch(t, /Licence CC0|CC0 — domaine public|placé dans le domaine public universel/i, `${file} : CC0 annoncé comme acquis`);
  }
  const expert = read("app/learn/components/ExpertDocumentation.tsx");
  assert.match(expert, /Aucune licence logicielle générale n’est accordée/);
  assert.match(expert, /n’est pas encore fixé/);
  assert.match(read("app/api/esp-firmware/route.ts"), /tous droits réservés/);
});

test("refus : blockchain autonome / décentralisée annoncée comme existante (seules les négations sont admises)", () => {
  const negation = /n[’']est pas|n[’']existe pas|pas encore|≠|jamais|Ne jamais|ne pas|\bnon\b|NEVER|pas une|n[’']est ni|Une blockchain|décrire la chaîne/i;
  for (const file of SURFACES) {
    if (file === "lib/projectStatus.ts") continue;   // la liste NEVER_CLAIM nomme les affirmations interdites
    read(file).split("\n").forEach((line, i) => {
      if (/blockchain[^.\n]{0,25}(autonome|décentralis|publique)|(autonome|décentralis)\w*[^.\n]{0,15}blockchain|decentrali[sz]ed blockchain/i.test(line)) {
        assert.match(line, negation, `${file}:${i + 1} blockchain autonome/décentralisée sans négation : ${line.trim().slice(0, 140)}`);
      }
    });
  }
});

test("refus : aucune annonce de signature matérielle inviolable, de preuve optique, d'OTA universelle ou de validation de toutes les cartes (hors négation)", () => {
  const negation = /n[’']est pas|n[’']existe|pas encore|≠|jamais|Ne jamais|ne pas|\bnon\b|sans |aucun|ni |pas une|n[’']est ni|NEVER|attendent|restante|à qualifier|encore/i;
  const risky = /signature matérielle inviolable|preuve optique|OTA universelle|validation matérielle de toutes les cartes|toutes les cartes (sont|ont été) (validées|testées)/i;
  for (const file of SURFACES) {
    if (file === "lib/projectStatus.ts") continue;
    read(file).split("\n").forEach((line, i) => { if (risky.test(line)) assert.match(line, negation, `${file}:${i + 1} ${line.trim().slice(0, 140)}`); });
  }
  assert.ok(NEVER_CLAIM.every((c) => c.length > 5));
});

// ── /llms.txt, robots, sitemap, métadonnées ──────────────────────────────────────────────────────────────────────────────────────────────
test("llms.txt : factuel, daté, avec le modèle de confiance, les limites, les familles et les liens canoniques ; ne se présente pas comme un standard obligatoire", () => {
  const t = buildLlmsTxt();
  assert.match(t, new RegExp(`vérifié le ${VERIFIED_AT}`));
  assert.ok(t.includes(TRUST_MODEL));
  for (const b of PROOF_BLOCKS) assert.ok(t.includes(`#${b.index} :`));
  for (const h of [...HARDWARE_VALIDATED, ...HARDWARE_PENDING]) assert.ok(t.includes(h), h);
  for (const l of LIMITS) assert.ok(t.includes(l), l);
  assert.match(t, /pas un standard obligatoire/);
  for (const u of ["/learn", "/network", "/gallery", "/sitemap.xml"]) assert.ok(t.includes(`${SITE_URL}${u}`), u);
  assert.match(t, /github\.com\/Rescoe\/proof-of-draw/);
  assert.match(t, /Ed25519 réelle[^\n]*attestation matérielle forte/);
  assert.doesNotMatch(t, /\bMIT\b|CC0 —/);
});

test("robots.txt : pages publiques autorisées, API et pages privées exclues, sitemap déclaré ; pas présenté comme une barrière de sécurité", () => {
  const r = robots();
  const rule = (Array.isArray(r.rules) ? r.rules[0] : r.rules) as { allow?: string | string[]; disallow?: string | string[] };
  assert.equal(rule.allow, "/");
  const dis = ([] as string[]).concat(rule.disallow ?? []);
  for (const p of ["/api/", "/profile", "/my-devices", "/bench", "/draw-lab", "/onboard"]) assert.ok(dis.includes(p), p);
  assert.equal(r.sitemap, `${SITE_URL}/sitemap.xml`);
  assert.match(read("app/robots.ts"), /N'EST PAS une barrière de sécurité/);
});

test("sitemap : pages publiques stables seulement, URLs absolues, aucune requête Redis", () => {
  const urls = sitemap().map((s) => s.url);
  assert.equal(urls.length, PUBLIC_PAGES.length);
  assert.ok(urls.includes(SITE_URL) && urls.includes(`${SITE_URL}/learn`) && urls.includes(`${SITE_URL}/network`) && urls.includes(`${SITE_URL}/gallery`) && urls.includes(`${SITE_URL}/artists`) && urls.includes(`${SITE_URL}/draw`));
  for (const u of urls) assert.ok(u.startsWith("https://"));
  for (const bad of ["/api", "/profile", "/my-devices", "/bench", "/draw-lab", "/onboard"]) assert.ok(!urls.some((u) => u.includes(bad)), bad);
  assert.doesNotMatch(read("app/sitemap.ts"), /from "@\/lib\/redis"|redis\.(get|set|mget|lrange)/i);
});

test("métadonnées : metadataBase, description réelle, OpenGraph, Twitter, robots, JSON-LD sobre ; manifeste Proof-of-Draw", () => {
  const layout = read("app/layout.tsx");
  for (const k of ["metadataBase", "openGraph", "twitter", "robots:", "manifest:", "application/ld+json", "SoftwareSourceCode", "WebSite"]) assert.ok(layout.includes(k), k);
  assert.doesNotMatch(layout, /Réseau de dessins distribués entre ESP8266, écrans e-ink et OLED\./, "ancienne description");
  assert.doesNotMatch(layout, /"license"|"offers"|"price"|"Organization"/, "JSON-LD : aucune licence, prix ni organisation inventés");
  const m = JSON.parse(read("public/manifest.json"));
  assert.equal(m.name, "Proof-of-Draw");
  assert.doesNotMatch(JSON.stringify(m), /ESP Canvas|ESPCanvas/);
  assert.match(m.description, /ESP8266/); assert.match(m.description, /UNO R4/);
  assert.ok(fs.existsSync(path.join(root, "public", String(m.icons[0].src).replace(/^\//, ""))), "l'icône du manifeste existe");
});
