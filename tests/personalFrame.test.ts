// tests/personalFrame.test.ts — frame personnelle : annoncée tant que l'appareil ne l'a pas reçue ; un e-ink qui l'a reçue ne la repeint plus après un Reset (14/10/2026).
import test from "node:test";
import assert from "node:assert/strict";
import { personalFrameAnnounced } from "../lib/personalFrame";

const pf = (screen: string, createdAt?: number) => ({ createdAt, payload: { screen } });

test("aucune frame personnelle : rien à annoncer", () => {
  assert.equal(personalFrameAnnounced(null, {}), false);
  assert.equal(personalFrameAnnounced({ createdAt: 1 }, {}), false);
});
test("e-ink : frame personnelle neuve (jamais reçue) ou reçue avant sa création : annoncée", () => {
  for (const s of ["eink29bwr", "eink27bw"]) {
    assert.equal(personalFrameAnnounced(pf(s, 1000), {}), true, s);
    assert.equal(personalFrameAnnounced(pf(s, 1000), { lastFrameReceivedAt: 999 }), true, s);
  }
});
test("e-ink : frame personnelle DÉJÀ reçue (accusé de réception >= création) : plus annoncée (pas de repeinture ni de dessin ancien après un Reset)", () => {
  for (const s of ["eink29bwr", "eink27bw"]) {
    assert.equal(personalFrameAnnounced(pf(s, 1000), { lastFrameReceivedAt: 1000 }), false, s);
    assert.equal(personalFrameAnnounced(pf(s, 1000), { lastFrameReceivedAt: 5000 }), false, s);
  }
});
test("une NOUVELLE frame personnelle (créée après le dernier accusé) est de nouveau annoncée", () => {
  assert.equal(personalFrameAnnounced(pf("eink29bwr", 6000), { lastFrameReceivedAt: 5000 }), true);
});
test("écrans volatils (OLED, TFT) : comportement inchangé, toujours annoncée", () => {
  for (const s of ["oled096", "tft28", "tft18"]) assert.equal(personalFrameAnnounced(pf(s, 1000), { lastFrameReceivedAt: 9999 }), true, s);
});
test("sans date de création : annoncée (prudence)", () => {
  assert.equal(personalFrameAnnounced(pf("eink29bwr"), { lastFrameReceivedAt: 9999 }), true);
});
