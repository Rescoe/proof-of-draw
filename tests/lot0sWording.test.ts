import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { OBS_BADGE, OBS_CHIP, OBS_CHIP_TITLE, OBS_FIELD_LABEL, OBS_FIELD_VALUE, OBS_FORBIDDEN_WORDS, OBS_NOTE, OBS_ROW_CONFIRMED, OBS_ROW_PENDING, OBS_SECTION_TITLE } from "../lib/observationWording";
import { ROADMAP } from "../app/learn/data/roadmap";

// Lot 0S (06/10/2026) : vocabulaire honnête. Tests de TEXTE : ils protègent des formulations qui laisseraient croire à une vérification qui n'existe pas.
const root = path.join(__dirname, "..");
const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8").replace(/\r\n/g, "\n");

// ── obsConfirmed = réception, pas vérification ───────────────────────────────────────────────────────────────────────────────────────────
test("observation : aucun libellé ne parle de revérification, de validation ou de recalcul (sauf pour les nier)", () => {
  const labels = [OBS_FIELD_LABEL, OBS_FIELD_VALUE, OBS_SECTION_TITLE(1), OBS_SECTION_TITLE(3), OBS_BADGE(2, 5), OBS_ROW_CONFIRMED(1), OBS_ROW_CONFIRMED(4), OBS_ROW_PENDING, OBS_CHIP];
  for (const l of labels) assert.doesNotMatch(l, OBS_FORBIDDEN_WORDS, `libellé trompeur : « ${l} »`);
  assert.match(OBS_NOTE, /n’a pas recalculé/);
  assert.match(OBS_CHIP_TITLE, /aucun recalcul/);
  assert.match(OBS_FIELD_VALUE, /Confirmée par l’appareil/);
});

test("observation : accord du pluriel", () => {
  assert.equal(OBS_ROW_CONFIRMED(1), "✓ 1 réception confirmée");
  assert.equal(OBS_ROW_CONFIRMED(2), "✓ 2 réceptions confirmées");
  assert.match(OBS_SECTION_TITLE(1), /1 appareil\)/);
  assert.match(OBS_SECTION_TITLE(2), /2 appareils\)/);
});

test("les écrans qui affichent obsConfirmed utilisent ces libellés (ni « Observer », ni « validations », ni « obs ✓ » en dur)", () => {
  const detail = read("app/BlockDetail.tsx");
  const gallery = read("app/gallery/GalleryClient.tsx");
  assert.ok(detail.includes("OBS_FIELD_LABEL") && detail.includes("OBS_SECTION_TITLE") && detail.includes("OBS_BADGE") && detail.includes("OBS_ROW_CONFIRMED"));
  assert.ok(gallery.includes("OBS_CHIP"));
  assert.doesNotMatch(detail, /Observers \(|validations\}|Confirmé ✓|label="Observer"/, "ancien libellé « Observer / validations / Confirmé ✓ » encore présent");
  assert.doesNotMatch(gallery, />obs ✓</, "ancien chip « obs ✓ » encore présent");
});

// ── « image vide » → « image uniforme » ─────────────────────────────────────────────────────────────────────────────────────────────────
test("documentation des règles N2 : « image uniforme » (la règle rejette aussi une image toute pleine), plus « image vide »", () => {
  const chantier = read("docs/CHANTIER_VALIDATION_REELLE.md");
  assert.doesNotMatch(chantier, /image \*\*vide\*\*/, "« image **vide** » trompeur");
  assert.doesNotMatch(chantier, /\(non vide, pas de bruit pur/);
  assert.match(chantier, /image \*\*uniforme\*\*/);
  assert.match(read("docs/REPRISE_2026_10_06_VALIDATION_ET_RESEAU.md"), /image uniforme/);
});

test("le CODE de protocole n'est pas touché : le motif reste « blank » jusqu'à la v3 (versionné)", () => {
  assert.match(read("lib/podVote.ts"), /REJECT_REASONS = \["hash", "metrics", "blank", "noise", "format", "rules"\]/);
  assert.match(read("esp8266/_shared/pod_vote_esp.h"), /return "blank";/);
});

// ── page Apprendre : exactitude sur la mémoire ──────────────────────────────────────────────────────────────────────────────────────────
test("Apprendre : pas d'« aucun tampon » ni de scratch « alloué après la fermeture TLS » ; le scratch borné est dit « employé pendant la lecture »", () => {
  const synth = read("app/learn/components/SynthesisPath.tsx");
  assert.doesNotMatch(synth, /aucun tampon/i);
  assert.doesNotMatch(synth, /sans jamais garder l’image en mémoire/);
  assert.doesNotMatch(synth, /allocation après la fermeture/);
  assert.match(synth, /second buffer complet/);
  assert.match(synth, /espace de travail borné/);
  assert.match(synth, /pendant la lecture/);
});

// ── statuts matériels : jamais promus sans preuve du porteur ────────────────────────────────────────────────────────────────────────────
test("statuts matériels : ESP8266 e-ink 2,7 seul = compilé, non testé ; R4 + TFT 2,8 vote = non testé (feuille de route et synthèse)", () => {
  const items = Object.fromEntries(ROADMAP.flatMap((p) => p.items).map((i) => [i.id, i]));
  for (const id of ["fw-27solo", "fw-tft28"]) {
    assert.notEqual(items[id].status, "done", `${id} ne peut pas être « fait » sans essai sur la carte`);
    assert.match(items[id].note ?? "", /essai|à faire|non/i, `${id} doit dire que l'essai reste à faire`);
  }
  const synth = read("app/learn/components/SynthesisPath.tsx");
  assert.match(synth, /"e-ink 2,7″ seul", "Oui \(code livré\)", "À essayer"/);
  assert.match(synth, /"TFT 2,8″ tactile", "Oui \(code livré\)", "À essayer"/);
  for (const sketch of ["esp8266/esp_eink_2.7BW/esp_eink_2.7BW.ino", "arduino_uno_r4/pod_uno_r4/pod_uno_r4.ino"]) assert.ok(fs.existsSync(path.join(root, sketch)), sketch);
});

// ── cache de /api/candidate-frame ───────────────────────────────────────────────────────────────────────────────────────────────────────
test("la route /api/candidate-frame délègue au module testé et n'écrit plus de cache 404", () => {
  const route = read("app/api/candidate-frame/route.ts");
  assert.ok(route.includes("candidateFrameResponse"));
  assert.doesNotMatch(route, /s-maxage=30/);
});
