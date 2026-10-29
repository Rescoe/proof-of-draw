// tests/otaBwrFamily.test.ts — le BWR 2,9″ entre dans la distribution OTA (22/10/2026) : famille liée à la signature, version minimale du client.
import test from "node:test";
import assert from "node:assert/strict";
import { otaClientCapable, familyOfFirmware, OTA_FAMILIES, OTA_CLIENT_FIRMWARE } from "../lib/otaDistribution";

test("BWR : seul un firmware qui LIT l'annonce (eink29bwr-2.4 et plus) la reçoit ; l'ancien (2.3) obtient la réponse d'avant", () => {
  assert.equal(otaClientCapable("eink29bwr-2.4"), true);
  assert.equal(otaClientCapable("eink29bwr-2.10"), true);
  assert.equal(otaClientCapable("eink29bwr-2.3"), false);
  assert.equal(otaClientCapable("eink29bwr-1.9"), false);
  assert.equal(otaClientCapable("eink27bw-2.4"), false, "les autres e-ink ne sont pas concernés");
});
test("BWR : la famille de la release est esp8266-eink29bwr (celle du trailer signé du firmware)", () => {
  assert.equal(familyOfFirmware("eink29bwr-2.4"), "esp8266-eink29bwr");
  assert.equal(familyOfFirmware("tft18-2.9"), "esp8266-tft18", "TFT inchangé");
  assert.equal(familyOfFirmware("eink27bw-2.1"), "", "famille inconnue = jamais éligible");
  assert.deepEqual(Object.keys(OTA_FAMILIES).sort(), ["eink29bwr", "multibwr", "multiscreen", "tft18"]);
  assert.deepEqual(Object.keys(OTA_CLIENT_FIRMWARE).sort(), ["eink29bwr", "multibwr", "multiscreen", "tft18"]);
  assert.equal(familyOfFirmware("multiscreen-2.6"), "esp8266-multiscreen");
  assert.equal(otaClientCapable("multiscreen-2.6"), true);
  assert.equal(otaClientCapable("multiscreen-2.5"), false, "l'ancien multiscreen ne reçoit rien");
});
