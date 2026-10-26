// Historique public des capteurs sur le profil artiste : l'API n'expose que les capteurs publics, la page lit l'historique public.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (f: string) => fs.readFileSync(f, "utf8").replace(/\r\n/g, "\n");
const api = read("app/api/artists/[artistId]/route.ts");
const comp = read("app/artists/[artistId]/ArtistSensors.tsx");
const page = read("app/artists/[artistId]/page.tsx");

test("l'API n'expose les grandeurs que si l'interrupteur « mesures publiques » n'est pas coupé", () => {
  assert.ok(api.includes("d.measuresPublic !== false && measureKindsOf(d).length > 0 ? { sensors: measureKindsOf(d) }"));
});
test("le composant lit uniquement l'historique public, 24 h / 7 j / 30 j, groupé par grandeur", () => {
  assert.ok(comp.includes("public=1&hours=${hours}"));
  assert.match(comp, /h: 24[\s\S]*h: 168[\s\S]*h: 720/);
  assert.ok(comp.includes("MEASURE_GROUPS") && comp.includes("!grouped.has(k)"));
});
test("la page n'ouvre l'onglet Capteurs que s'il existe un capteur public", () => {
  assert.ok(page.includes("sensorDevices.length > 0"));
  assert.ok(page.includes("<ArtistSensors devices={sensorDevices} ownerName={profile.displayName} />"));
});
