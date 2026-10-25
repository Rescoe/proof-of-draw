// tests/otaReleasesPolicy.test.ts — GARDE de la porte OTA (25/10/2026) : tant que `ota:kill` reste ouvert en permanence, ce qui protège la flotte, c'est le contenu du dépôt.
// Règle : toute release publiée est un CANARI ciblé sur 1 à 3 appareils nommés. Une release « stable » (vague, toute la famille) exige une approbation explicite et visible en revue :
// son identifiant doit figurer dans ota-releases/STABLE_APPROVED.txt (fichier absent = aucune release stable autorisée).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.join(__dirname, "..", "ota-releases");
const dirs = fs.existsSync(root) ? fs.readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name) : [];
const approvedFile = path.join(root, "STABLE_APPROVED.txt");
const approved = new Set(fs.existsSync(approvedFile) ? fs.readFileSync(approvedFile, "utf8").split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith("#")) : []);

test("chaque release du dépôt est un canari ciblé sur 1 à 3 appareils, sauf approbation explicite", () => {
  for (const d of dirs) {
    const m = JSON.parse(fs.readFileSync(path.join(root, d, "manifest.json"), "utf8"));
    assert.equal(m.releaseId, d, `${d} : releaseId ≠ nom du dossier`);
    if (m.channel === "stable") { assert.ok(approved.has(m.releaseId), `${d} : release STABLE sans approbation dans ota-releases/STABLE_APPROVED.txt`); continue; }
    assert.equal(m.channel, "canary", `${d} : canal « ${m.channel} » non autorisé (canary uniquement)`);
    assert.ok(Array.isArray(m.canaryDevices) && m.canaryDevices.length >= 1 && m.canaryDevices.length <= 3, `${d} : un canari cible 1 à 3 appareils`);
    for (const id of m.canaryDevices) assert.match(id, /^dev_[A-Z0-9]{8}$/, `${d} : identifiant d'appareil invalide`);
  }
});
test("garde : une approbation ne peut pas viser une release inexistante", () => {
  for (const id of approved) assert.ok(dirs.includes(id), `STABLE_APPROVED.txt cite ${id}, absente de ota-releases/`);
});
