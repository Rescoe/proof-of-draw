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
  // UX jalon 4 : le profil public passe par le panneau partagé (UNE lecture publique, UNE période 24 h / 7 jours / 30 jours pour toutes les grandeurs, sections par grandeur)
  assert.ok(comp.includes("<MeasuresPanel") && !/\bowner\b/.test(comp), "panneau en mode PUBLIC (jamais la prop owner)");
  const panel = read("app/measures/MeasuresPanel.tsx");
  assert.match(panel, /day: "24 h", week: "7 jours", month: "30 jours"/);
  assert.ok(panel.includes("useDeviceMeasures(deviceId, { owner })") && panel.includes("owner = false") && panel.includes("kindsOfGroup(kinds, \"link\")"));
  assert.ok(read("app/measures/useDeviceMeasures.ts").includes("&public=1"), "lecture publique tant que owner est faux");
});
test("la page n'ouvre l'onglet Capteurs que s'il existe un capteur public", () => {
  assert.ok(page.includes("sensorDevices.length > 0"));
  assert.ok(page.includes("<ArtistSensors devices={sensorDevices} ownerName={profile.displayName} />"));
});
