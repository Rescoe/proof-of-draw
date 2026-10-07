import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { OBS_BADGE, OBS_CHIP, OBS_CHIP_TITLE, OBS_FIELD_LABEL, OBS_FIELD_VALUE, OBS_FORBIDDEN_WORDS, OBS_NOTE, OBS_ROW_CONFIRMED, OBS_ROW_PENDING, OBS_SECTION_TITLE } from "../lib/observationWording";
import { ROADMAP } from "../app/learn/data/roadmap";
import { ANIM_CHIP_TITLE, ANIM_FORBIDDEN_CLAIM } from "../lib/animationWording";

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

// ── Animations : jamais « validée image par image » tant que le vote reste v1 (LOT0S-AUDIT-FIX1) ───────────────────────────────────────────
function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const rel = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== "node_modules" && e.name !== ".next") walk(rel, out); }
    else if (/\.(tsx?|md)$/.test(e.name)) out.push(rel);
  }
  return out;
}

test("le libellé public d'une animation dit que le vote est encore v1 et ne promet aucune validation image par image", () => {
  assert.doesNotMatch(ANIM_CHIP_TITLE, ANIM_FORBIDDEN_CLAIM);
  assert.match(ANIM_CHIP_TITLE, /v1/);
  assert.match(ANIM_CHIP_TITLE, /pas encore validées par calcul/);
  assert.match(ANIM_CHIP_TITLE, /peut être recalculée/);
});

test("le détecteur de formulation interdite reconnaît les variantes et laisse passer les phrases exactes", () => {
  for (const bad of ["Animation validée image par image", "animations validées image par image", "validation de chaque image par image", "Validée image après image"]) assert.match(bad, ANIM_FORBIDDEN_CLAIM, bad);
  for (const ok of ["🔎 Vérifier image par image", "Recalcule l'empreinte SHA-256 de chaque image", "Animations VALIDÉES par calcul (racine, empreinte et métriques par image)", "Animation : l’empreinte de chaque image est consignée"]) assert.doesNotMatch(ok, ANIM_FORBIDDEN_CLAIM, ok);
});

test("aucun texte de l'application (pages, composants, libellés) n'affirme « validée image par image »", () => {
  const offenders: string[] = [];
  for (const file of [...walk("app"), ...walk("lib")]) {
    // la définition de la règle et ce test nomment la formulation interdite : ils sont exclus
    if (file.replace(/\\/g, "/") === "lib/animationWording.ts") continue;
    read(file).split("\n").forEach((line, i) => { if (ANIM_FORBIDDEN_CLAIM.test(line)) offenders.push(`${file}:${i + 1} ${line.trim().slice(0, 100)}`); });
  }
  assert.deepEqual(offenders, []);
  assert.ok(read("app/gallery/GalleryClient.tsx").includes("ANIM_CHIP_TITLE"), "la galerie utilise le libellé centralisé");
});

// ── Budget du lot 0S : chemin nominal distinct du chemin d'erreur 404 ──────────────────────────────────────────────────────────────────────
test("le budget Redis du lot 0S distingue le chemin nominal (200) du chemin d'erreur 404 (+1 lecture par requête, coût assumé)", () => {
  const doc = read("docs/LOT_0S_PREUVES_ET_HYGIENE_2026_10_06.md");
  assert.match(doc, /Commandes Redis — chemin normal \(200\)/);
  assert.match(doc, /Commandes Redis — chemin d'erreur 404/);
  assert.match(doc, /\+1 lecture du candidat courant par requête/);
  assert.match(doc, /Coût d'erreur assumé, non nul/);
  assert.doesNotMatch(doc, /\*\*0 nouvelle commande\.\*\*/, "l'ancienne affirmation de coût strictement nul ne doit plus figurer");
  assert.match(read("lib/candidateFrameResponse.ts"), /Chemin d'erreur 404 sur un identifiant VALIDE : \+1 lecture par requête/);
});
