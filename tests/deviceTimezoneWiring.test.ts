// tests/deviceTimezoneWiring.test.ts — branchement statique du fuseau horaire par appareil (25/10/2026).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
const read = (p: string) => fs.readFileSync(path.join(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");

test("/api/pull : l'heure locale (now, tzo) et l'horodatage converti ne concernent QUE les appareils qui ont déclaré des capteurs", () => {
  const src = read("app/api/pull/route.ts");
  assert.match(src, /if \(measureKindsOf\(device\)\.length > 0\) \{[\s\S]*?timeMeta = \{ now: Math\.floor\(nowMs \/ 1000\), tzo: utcOffsetMinutes\(tz, nowMs\) \};/);
  assert.match(src, /\.\.\.\(timeMeta \?\? \{\}\),/);
  assert.equal((src.match(/timeMeta/g) ?? []).length, 3, "timeMeta : déclaration, affectation, usage conditionnel (pas d'autre champ ajouté au JSON léger)");
});
test("/api/devices/timezone : exige la propriété de l'appareil et refuse un fuseau inconnu", () => {
  const src = read("app/api/devices/timezone/route.ts");
  assert.match(src, /isValidTimezone\(timezone\)/);
  assert.match(src, /sessionOwnsDevice\(deviceId\)/);
  assert.ok(src.indexOf("!isValidTimezone(timezone)") < src.indexOf("await sessionOwnsDevice(deviceId)"), "validation avant tout accès Redis");
});
test("l'interface « Gérer » propose le fuseau horaire (liste de suggestions, enregistrement vers la route)", () => {
  const ui = read("app/profile/DevicesPanel.tsx");
  assert.match(ui, /Fuseau horaire de l&apos;écran/);
  assert.match(ui, /postJson\("\/api\/devices\/timezone"/);
  assert.match(ui, /Europe\/Paris/);
});
test("la fiche appareil porte le fuseau (type propriétaire inclus)", () => {
  const st = read("lib/deviceStore.ts");
  assert.equal((st.match(/timezone\?: string/g) ?? []).length, 2);
  assert.match(st, /timezone:\s+d\.timezone,/);
  assert.match(st, /export async function setDeviceTimezone\(/);
});
