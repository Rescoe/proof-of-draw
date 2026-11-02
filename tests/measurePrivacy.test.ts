// tests/measurePrivacy.test.ts — confidentialité PAR GRANDEUR des mesures (02/11/2026). Le filtrage est serveur ; ces tests le figent, y compris par « mutants » :
// des copies volontairement fautives de lib/measurePrivacy.ts doivent être REFUSÉES par les mêmes assertions.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { chosenPublicKinds, filterPublic, filterPublicLatest, isShareable, publicKindsOf, sanitizePublicKinds } from "../lib/measurePrivacy";
import { MEASURE_KIND_IDS, MEASURE_KINDS, type Measure } from "../lib/measures";
import { toNetworkDevice, type DeviceRecord } from "../lib/networkSnapshot";

const root = path.join(__dirname, "..");
const read = (...p: string[]) => fs.readFileSync(path.join(root, ...p), "utf8");
const now = Date.UTC(2026, 10, 2, 12, 0, 0);
const station = { screens: ["tft18"], sensors: ["temp", "hum", "voc", "vocidx", "rssi", "lat", "dl"] };

type Mod = Pick<typeof import("../lib/measurePrivacy"), "publicKindsOf" | "filterPublic" | "filterPublicLatest" | "isShareable" | "sanitizePublicKinds">;
function checkBehaviour(m: Mod) {
  // défaut sûr : température + humidité seulement ; air, brut, diagnostic privés
  assert.deepEqual(m.publicKindsOf(station), ["temp", "hum"]);
  // interrupteur général : plus rien, même si le propriétaire a listé des grandeurs
  assert.deepEqual(m.publicKindsOf({ ...station, measuresPublic: false, measuresPublicKinds: ["temp", "vocidx"] }), []);
  // choix explicite du propriétaire (liste blanche) : air publié, température retirée
  assert.deepEqual(m.publicKindsOf({ ...station, measuresPublicKinds: ["vocidx"] }), ["vocidx"]);
  // liste vide = tout privé
  assert.deepEqual(m.publicKindsOf({ ...station, measuresPublicKinds: [] }), []);
  // le brut du SGP40 ("never") et une grandeur inconnue / nouvelle ne sortent JAMAIS, même listés
  assert.deepEqual(m.publicKindsOf({ ...station, measuresPublicKinds: ["voc", "co2", "temp"] }), ["temp"]);
  assert.equal(m.isShareable("voc"), false);
  assert.equal(m.isShareable("co2"), false);
  assert.equal(m.isShareable("vocidx"), true);
  // un appareil qui ne déclare pas la grandeur ne peut pas la publier
  assert.deepEqual(m.publicKindsOf({ screens: ["tft18"], sensors: ["temp"], measuresPublicKinds: ["temp", "vocidx"] }), ["temp"]);
  // liste corrompue (pas un tableau) → défaut du registre, jamais « tout »
  assert.deepEqual(m.publicKindsOf({ ...station, measuresPublicKinds: "all" }), ["temp", "hum"]);
  assert.equal(m.sanitizePublicKinds("temp"), null);
  assert.deepEqual(m.sanitizePublicKinds(["temp", "temp", 3, "vocidx", "voc"]), ["temp", "vocidx"]);
  // filtrage des données : aucune grandeur privée, et une mesure purement privée disparaît (pas même son heure)
  const ms: Measure[] = [{ t: 300, v: { temp: 200, vocidx: 150 } }, { t: 200, v: { vocidx: 90 } }, { t: 100, v: { hum: 500, rssi: -60 } }];
  assert.deepEqual(m.filterPublic(ms, ["temp", "hum"]), [{ t: 300, v: { temp: 200 } }, { t: 100, v: { hum: 500 } }]);
  assert.deepEqual(m.filterPublic(ms, []), []);
  assert.equal(m.filterPublicLatest(ms[0], ["hum"]), null);
  assert.deepEqual(m.filterPublicLatest(ms[0], ["temp"]), { t: 300, v: { temp: 200 } });
  assert.equal(m.filterPublicLatest(null, ["temp"]), null);
  assert.equal(ms[0].v.vocidx, 150, "l'entrée n'est pas modifiée");
}

test("confidentialité par grandeur : comportement du module réel", () => checkBehaviour({ publicKindsOf, filterPublic, filterPublicLatest, isShareable, sanitizePublicKinds }));

test("registre : toute grandeur a une visibilité ; seules température et humidité sont publiques par défaut ; le brut SGP40 n'est jamais partageable", () => {
  for (const k of MEASURE_KIND_IDS) assert.ok(["public", "private", "never"].includes(MEASURE_KINDS[k].visibility), k);
  assert.deepEqual(MEASURE_KIND_IDS.filter((k) => MEASURE_KINDS[k].visibility === "public"), ["temp", "hum"]);
  assert.equal(MEASURE_KINDS.voc.visibility, "never");
  assert.equal(MEASURE_KINDS.vocidx.visibility, "private");
});

test("vue réseau : une grandeur privée n'apparaît ni dans les genres, ni dans la dernière mesure, ni nulle part dans la fiche publique", () => {
  const rec = { deviceId: "dev_T46HBXG1", ...station, firmware: "r4tft18-2.7", lastSeen: now - 60_000, lastPing: now - 60_000, framesSent: 0, createdAt: now - 1e9 } as unknown as DeviceRecord;
  const rawLatest = `${Math.floor(now / 1000) - 60};temp=214;hum=550;voc=31000;vocidx=187;rssi=-71;lat=700;dl=64`;
  const d = toNetworkDevice(rec, null, now, rawLatest);
  assert.deepEqual(d.measures?.kinds, ["temp", "hum"]);
  assert.deepEqual(Object.keys(d.measures?.latest?.v ?? {}).sort(), ["hum", "temp"]);
  const json = JSON.stringify(d);
  for (const secret of ["31000", "187", "vocidx", "rssi", "-71"]) assert.equal(json.includes(secret), false, secret);
  // publié par le propriétaire → visible ; le brut ne sort jamais
  const d2 = toNetworkDevice({ ...rec, measuresPublicKinds: ["temp", "hum", "vocidx"] } as DeviceRecord, null, now, rawLatest);
  assert.equal(d2.measures?.latest?.v.vocidx, 187);
  assert.equal(JSON.stringify(d2).includes("31000"), false);
  // tout privé : rien, pas même l'heure
  const d3 = toNetworkDevice({ ...rec, measuresPublicKinds: [] } as DeviceRecord, null, now, rawLatest);
  assert.equal(d3.measures, undefined);
});

test("chosenPublicKinds (interface du propriétaire) ignore l'interrupteur général, publicKindsOf le respecte", () => {
  const dev = { ...station, measuresPublic: false, measuresPublicKinds: ["temp", "vocidx"] };
  assert.deepEqual(chosenPublicKinds(dev), ["temp", "vocidx"]);
  assert.deepEqual(publicKindsOf(dev), []);
});

test("routes : la réponse publique est filtrée AVANT l'envoi (donc avant le cache partagé), sans stale-while-revalidate, et le réglage exige le propriétaire", () => {
  const route = read("app", "api", "sensor", "route.ts");
  const pub = route.slice(route.indexOf('sp.get("public") === "1"'), route.indexOf("if (!(await sessionOwnsDevice(deviceId)))"));
  assert.match(pub, /publicKindsOf\(device\)/);
  assert.match(pub, /filterPublic\(all, allowed\)/);
  assert.ok(pub.indexOf("filterPublic(") < pub.indexOf("NextResponse.json({ deviceId, kinds"), "filtre avant la réponse");
  assert.doesNotMatch(pub, /const newest = all\[0\]/, "l'heure de référence ne vient pas des mesures non filtrées");
  assert.doesNotMatch(pub, /Cache-Control[^\n]*stale-while-revalidate/);
  const set = read("app", "api", "my-devices", "[deviceId]", "measures-public", "route.ts");
  assert.ok(set.indexOf("sessionOwnsDevice(deviceId)") > 0 && set.indexOf("sessionOwnsDevice(deviceId)") < set.indexOf("setMeasuresPublicKinds("), "propriétaire vérifié avant toute écriture");
  assert.match(set, /sanitizePublicKinds\(body\.kinds\)/);
  assert.match(read("app", "api", "artists", "[artistId]", "route.ts"), /publicKindsOf\(d\)/);
  assert.match(read("lib", "networkSnapshot.ts"), /filterPublicLatest\(measures\.latest, kinds\)/);
});

// ── mutants : chaque copie fautive doit être détectée par checkBehaviour ──
const src = read("lib", "measurePrivacy.ts");
const mutants: [string, string, string][] = [
  ["défaut = tout", "defaultPublicKinds(declared)", "declared"],
  ["interrupteur général ignoré", "device.measuresPublic === false ? [] : chosenPublicKinds(device)", "chosenPublicKinds(device)"],
  ["« never » partageable", 'MEASURE_KINDS[k].visibility !== "never"', "true"],
  ["grandeur inconnue partageable", "isMeasureKind(k) && MEASURE_KINDS[k].visibility !== \"never\"", "typeof k === \"string\""],
  ["liste ignorée", "sanitizePublicKinds(device.measuresPublicKinds) ?? ", ""],
  ["pas d'intersection avec les déclarées", "return declared.filter((k) => allowed.includes(k) && isShareable(k));", "return allowed.filter(isShareable);"],
  ["filtre de données sans effet", "for (const k of allowed) if (m.v[k] !== undefined) v[k] = m.v[k];", "Object.assign(v, m.v);"],
  ["mesure vide conservée", "if (Object.keys(v).length > 0) out.push({ t: m.t, v });", "out.push({ t: m.t, v });"],
  ["liste vide = tout", "if (allowed.length === 0) return [];", "if (allowed.length === 0) return measures;"],
  ["liste corrompue acceptée", "if (!Array.isArray(raw)) return null;", "if (!Array.isArray(raw)) return [\"temp\", \"hum\", \"vocidx\"];"],
];
for (const [name, from, to] of mutants) {
  test(`mutant refusé : ${name}`, async () => {
    assert.ok(src.includes(from), `motif introuvable : ${from}`);
    const file = path.join(root, "lib", `__mutant_privacy_${Math.random().toString(36).slice(2)}.ts`);
    fs.writeFileSync(file, src.replace(from, to));
    try {
      const mod = (await import(pathToFileURL(file).href)) as Mod;
      assert.throws(() => checkBehaviour(mod), Error, `le mutant « ${name} » n'a pas été détecté`);
    } finally { fs.rmSync(file, { force: true }); }
  });
}
