// tests/deviceTime.test.ts — fuseau horaire par appareil (25/10/2026).
import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_TIMEZONE, cartelTimestampFor, formatLocalShort, isValidTimezone, parisCartelTs, parseParisCartelTs, timezoneOf, utcOffsetMinutes } from "../lib/deviceTime";

test("validation du fuseau : noms IANA connus acceptés, tout le reste refusé", () => {
  for (const ok of ["Europe/Paris", "America/New_York", "Asia/Tokyo", "UTC", "America/Argentina/Buenos_Aires"]) assert.equal(isValidTimezone(ok), true, ok);
  for (const bad of ["", "Paris", "Europe/Atlantide", "../etc/passwd", "Europe/Paris; DROP", "x".repeat(80), 12, null, undefined]) assert.equal(isValidTimezone(bad as unknown), false, String(bad));
  assert.equal(timezoneOf({ timezone: "Asia/Tokyo" }), "Asia/Tokyo");
  assert.equal(timezoneOf({ timezone: "n'importe quoi" }), DEFAULT_TIMEZONE);
  assert.equal(timezoneOf(null), DEFAULT_TIMEZONE);
});
test("décalage UTC : heure d'été et d'hiver, demi-heures, pas d'heure d'été", () => {
  const ete = Date.UTC(2026, 6, 1, 12), hiver = Date.UTC(2026, 0, 15, 12);
  assert.equal(utcOffsetMinutes("Europe/Paris", ete), 120);
  assert.equal(utcOffsetMinutes("Europe/Paris", hiver), 60);
  assert.equal(utcOffsetMinutes("America/New_York", ete), -240);
  assert.equal(utcOffsetMinutes("Asia/Kolkata", ete), 330);
  assert.equal(utcOffsetMinutes("UTC", ete), 0);
});
test("le changement d'heure d'automne 2026 (25/10, 03:00 → 02:00 à Paris) est suivi", () => {
  assert.equal(utcOffsetMinutes("Europe/Paris", Date.UTC(2026, 9, 25, 0, 30)), 120);   // 02:30 d'été
  assert.equal(utcOffsetMinutes("Europe/Paris", Date.UTC(2026, 9, 25, 1, 30)), 60);    // 02:30 d'hiver
});
test("cartel : « JJ/MM/AAAA HH:MM (Paris) » converti dans le fuseau de l'écran, sans « (Paris) »", () => {
  assert.equal(cartelTimestampFor("24/10/2026 17:28 (Paris)", "Europe/Paris"), "24/10 17:28");
  assert.equal(cartelTimestampFor("24/10/2026 17:28 (Paris)", "America/New_York"), "24/10 11:28");
  assert.equal(cartelTimestampFor("24/10/2026 17:28 (Paris)", "Asia/Tokyo"), "25/10 00:28");
  assert.equal(cartelTimestampFor("01/01/2027 00:05 (Paris)", "America/Los_Angeles"), "31/12 15:05");
  assert.equal(cartelTimestampFor("n'importe quoi", "Europe/Paris"), null);
  assert.equal(cartelTimestampFor(null, "Europe/Paris"), null);
});
test("aller-retour : parse puis formatage à Paris redonne l'heure d'origine (hors heure ambiguë)", () => {
  for (const s of ["24/10/2026 17:28 (Paris)", "15/01/2026 08:00 (Paris)", "30/03/2026 10:15 (Paris)", "25/10/2026 04:00 (Paris)"]) {
    const ms = parseParisCartelTs(s)!; assert.ok(ms > 0, s);
    assert.equal(formatLocalShort(ms, "Europe/Paris"), s.slice(0, 5) + " " + s.slice(11, 16), s);
  }
});

test("parisCartelTs : date de minage du bloc renvoyé (et non celle de la tête de chaîne), aller-retour avec parseParisCartelTs, heure d'été et d'hiver", () => {
  const summer = Date.UTC(2026, 5, 6, 4, 56);      // 06/06/2026 06:56 à Paris (UTC+2)
  assert.equal(parisCartelTs(summer), "06/06/2026 06:56 (Paris)");
  const winter = Date.UTC(2026, 0, 15, 11, 5);     // 15/01/2026 12:05 à Paris (UTC+1)
  assert.equal(parisCartelTs(winter), "15/01/2026 12:05 (Paris)");
  assert.equal(parseParisCartelTs(parisCartelTs(summer)), summer);
});
