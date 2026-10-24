// tests/hardwareMatrix.test.ts — la matrice de compatibilité (docs/MATRICE_COMPATIBILITE_MATERIELLE.md) est la source unique : ce test oblige la page Apprendre, les profils d'installation, les avertissements de téléchargement
// et les firmwares téléchargeables à rester COHÉRENTS avec elle. Quand ce test échoue, c'est qu'une des deux moitiés n'a pas été mise à jour dans le même lot (voir « Contrat de maintenance » dans la matrice).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { parseMatrixMarkdown, parseInline, HARDWARE_MATRIX_FILE, type MatrixBlock } from "../lib/hardwareMatrix";
import { INSTALL_PROFILES } from "../app/learn/data/installProfiles";
import { OTA_CLIENT_FIRMWARE, OTA_FAMILIES, familyOfFirmware, otaClientCapable } from "../lib/otaDistribution";

const root = path.join(__dirname, "..");
const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8").replace(/\r\n/g, "\n");
const blocks: MatrixBlock[] = parseMatrixMarkdown(read(HARDWARE_MATRIX_FILE));
const tables = blocks.filter((b): b is Extract<MatrixBlock, { kind: "table" }> => b.kind === "table");

test("matrice : analyse du fichier réel — légende, deux tables de profils, politique, contrat de maintenance", () => {
  const titles = blocks.filter((b) => b.kind === "h").map((b) => (b as { text: string }).text);
  for (const t of ["Légende de preuve", "Profils ESP8266", "Profils UNO R4 WiFi", "Politique de publication", "Contrat de maintenance obligatoire"]) assert.ok(titles.includes(t), "titre absent : " + t);
  for (const t of tables) for (const r of t.rows) assert.equal(r.length, t.head.length, `ligne à ${r.length} cellules pour ${t.head.length} colonnes : ${r[0]}`);
  assert.deepEqual(parseInline("a **b** `c` d").map((p) => p.kind), ["text", "strong", "text", "code", "text"]);
});

const esp = tables.find((t) => t.head[0] === "Profil déclaré" && t.head.includes("Portail Wi-Fi"))!;
const r4 = tables.find((t) => t.head[0] === "Profil déclaré" && t.head.includes("OTA Internet de production"))!;
const VOTE = 3;                                                                   // colonne « Vote / affichage réel » des deux tables
const proven = (cell: string) => /`V2`/.test(cell);
const find = (table: typeof esp, name: RegExp, baseOnly: boolean) => {
  const rows = table.rows.filter((r) => name.test(r[0]) && (!baseOnly || r[2].replace(/[`*]/g, "").trim() === "—"));
  assert.equal(rows.length, 1, `une seule ligne de base attendue pour ${name} (trouvé ${rows.length})`);
  return rows[0];
};

test("page Installer : « testé sur le matériel » == `V2` dans la matrice, pour les neuf profils", () => {
  const map: Array<[keyof typeof INSTALL_PROFILES, typeof esp, RegExp]> = [
    ["eink29bwr", esp, /^`eink29bwr`$/], ["eink27bwSolo", esp, /^`eink27bw`$/], ["eink27bwOled", esp, /^`multiscreen`$/], ["tft18", esp, /^`tft18`$/],
    ["r4Eink29", r4, /^`r4eink29-/], ["r4Eink27", r4, /^`r4eink27-/], ["r4Eink27Oled", r4, /^`r4multiscreen-/], ["r4Tft18", r4, /^`r4tft18-/], ["r4Tft28", r4, /^`r4tft28-/],
  ];
  assert.equal(map.length, Object.keys(INSTALL_PROFILES).length, "un profil d'installation sans correspondance dans la matrice");
  for (const [id, table, name] of map) {
    const row = find(table, name, table === esp);   // ESP8266 : ligne de BASE (sans module additionnel) ; R4 : une ligne par profil
    assert.equal(INSTALL_PROFILES[id].testedOnHardware, proven(row[VOTE]), `${String(id)} : la page dit testedOnHardware=${INSTALL_PROFILES[id].testedOnHardware}, la matrice dit V2=${proven(row[VOTE])}`);
    if (!INSTALL_PROFILES[id].testedOnHardware) assert.ok(INSTALL_PROFILES[id].statusNote, `${String(id)} : profil non éprouvé sans note explicative`);
  }
});

test("matrice : aucune variante capteur/OLED n'est présentée comme éprouvée sans `M`, `V2` ou `OTA` — et les variantes EXP/INCOMPATIBLES ne sont pas des profils d'installation", () => {
  for (const r of esp.rows.filter((x) => x[2].replace(/[`*]/g, "").trim() !== "—")) {
    const state = r[r.length - 1];
    assert.match(state, /EXP|INCOMPATIBLE|canari/i, `variante avec module sans décision de diffusion : ${r[0]} / ${r[2]}`);
  }
  for (const p of Object.values(INSTALL_PROFILES)) assert.doesNotMatch(p.firmwareFolder + p.firmwareVariant, /dht|oled_status|sensor/i, "un profil d'installation ne doit pas proposer une variante capteur");
});

test("téléchargements : avertissements de /api/esp-firmware cohérents avec la matrice", () => {
  const route = read("app/api/esp-firmware/route.ts");
  const warn = (key: string) => { const i = route.indexOf(`  ${key}: {`); assert.ok(i > 0, key); const seg = route.slice(i, route.indexOf("\n  },", i) > 0 ? route.indexOf("\n  },", i) : i + 900); const m = /statusWarning:\s*"([^"]*)"/.exec(seg); return m ? m[1] : ""; };
  for (const k of ["r4Eink27", "r4Eink27Oled", "r4Tft18"]) assert.match(warn(k), /NON TESTÉ/, k);
  for (const k of ["r4Eink29", "r4Tft28"]) { assert.match(warn(k), /v2 observé|observés/, k); assert.doesNotMatch(warn(k), /reste à confirmer/, k); }
  const solo = /eink27bwSolo: \{[\s\S]*?statusWarning: "([^"]*)"/.exec(route);
  assert.ok(solo && /NON ESSAYÉ/.test(solo[1]), "e-ink 2,7″ seul : avertissement attendu (aucune preuve matérielle en V2)");
});

test("synthèse technique : la table des firmwares ne dit « Testé en réel » que pour les profils éprouvés de la matrice", () => {
  const syn = read("app/learn/components/SynthesisPath.tsx");
  assert.match(syn, /\["UNO R4 WiFi", "e-ink 2,7″ seul · e-ink 2,7″ \+ OLED · TFT 1,8″", "Oui \(code livré\)", "À essayer"\]/);
  assert.match(syn, /\["ESP8266", "e-ink 2,7″ seul", "Oui \(code livré\)", "À essayer"\]/);
});

test("page Apprendre : la matrice est rendue depuis le fichier (aucune copie), reliée à la navigation et tracée par le déploiement", () => {
  assert.match(read("app/learn/page.tsx"), /path === "compat" \? <CompatibilityMatrix \/>/);
  assert.match(read("app/learn/components/LearnNavigation.tsx"), /path=compat#compatibilite/);
  assert.match(read("app/learn/components/CompatibilityMatrix.tsx"), /loadHardwareMatrix\(\)/);
  assert.match(read("next.config.ts"), /"\/learn": \["\.\/docs\/MATRICE_COMPATIBILITE_MATERIELLE\.md"\]/);
});

test("firmwares ESP8266 téléchargeables : options capteur/OLED à 0, version et famille compatibles avec le client OTA et la release de production", () => {
  const files: Array<[string, string]> = [["esp8266/esp_tft1.8/esp_tft1.8.ino", "tft18"], ["esp8266/esp_eink_2.9BWR/esp_eink_2.9BWR.ino", "eink29bwr"], ["esp8266/esp_eink_2.7BW_OLED/esp_eink_2.7BW_OLED.ino", "multiscreen"]];
  for (const [f, fam] of files) {
    const src = read(f);
    for (const opt of ["POD_SENSOR_DHT22", "POD_OLED_STATUS", "POD_SENSOR_DISPLAY"]) { const m = new RegExp(`#define ${opt} (\\d)`).exec(src); if (m) assert.equal(m[1], "0", `${f} : ${opt} doit valoir 0 dans le code téléchargeable`); }
    const version = /#define FIRMWARE_VERSION\s+"([^"]+)"/.exec(src)![1];
    assert.ok(otaClientCapable(version), `${f} : la version téléchargeable ${version} doit être reconnue comme client OTA (minimum ${OTA_CLIENT_FIRMWARE[fam]})`);
    assert.equal(familyOfFirmware(version), OTA_FAMILIES[fam]);
    assert.equal(/#define POD_OTA_FAMILY "([^"]+)"/.exec(src)![1], OTA_FAMILIES[fam]);
    assert.equal(/#define POD_OTA_CLIENT 1/.test(src), true, `${f} : le profil téléchargeable inclut le client OTA`);
  }
});
