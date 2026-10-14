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

// ── MULTISCREEN-PERSONAL-FRAME-FIX1 : appareil à plusieurs écrans (audit GPT du 14/10/2026) ──────────────────────────────────────
import { personalFrameSupersededBy } from "../lib/personalFrame";
test("multi-écran : l'accusé de l'autre écran ne prouve rien — la frame personnelle e-ink jamais affichée reste annoncée", () => {
  const multi = { screens: ["oled096", "eink27bw"], lastFrameReceivedAt: 9999 };
  assert.equal(personalFrameAnnounced(pf("eink27bw", 1000), multi), true);
  assert.equal(personalFrameAnnounced(pf("eink29bwr", 1000), { screens: ["eink29bwr"], lastFrameReceivedAt: 9999 }), false, "un seul écran : règle inchangée");
  assert.equal(personalFrameAnnounced(pf("eink29bwr", 1000), { screens: ["eink29bwr", "oled096"], lastFrameReceivedAt: 9999 }), true);
});
test("ACK de consensus : ne remplace la frame personnelle que si elle vise le MÊME écran (ACK OLED n'efface pas une frame personnelle e-ink)", () => {
  const eink = JSON.stringify({ frameId: "p1", payload: { screen: "eink27bw", buffer: "xx" } });
  assert.equal(personalFrameSupersededBy(eink, "oled096"), false, "ACK OLED : la frame personnelle e-ink est conservée");
  assert.equal(personalFrameSupersededBy(eink, "eink27bw"), true, "ACK e-ink : la frame personnelle e-ink est remplacée");
  assert.equal(personalFrameSupersededBy({ payload: { screen: "oled096" } }, "oled096"), true, "valeur déjà décodée (objet) acceptée");
});
test("ACK de consensus : valeurs absentes, illisibles ou sans écran => rien n'est supprimé", () => {
  for (const raw of [null, undefined, "", "pas du json", "{}", JSON.stringify({ payload: {} }), JSON.stringify({ payload: { screen: 5 } }), "null"]) assert.equal(personalFrameSupersededBy(raw, "oled096"), false, String(raw));
});
