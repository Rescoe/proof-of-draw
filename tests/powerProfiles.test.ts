// tests/powerProfiles.test.ts — cohérence des estimations de consommation (page Apprendre, parcours « Consommation »)
import test from "node:test";
import assert from "node:assert/strict";
import { COMPONENTS, POWER_SETUPS, estimateSetup, fleetEstimate, pullAverageMa, shareByPart, HOURS_PER_YEAR } from "../app/learn/data/powerProfiles";

const by = (id: string) => POWER_SETUPS.find((s) => s.id === id)!;

test("chaque montage référence des composants connus et min ≤ typ ≤ max", () => {
  for (const c of Object.values(COMPONENTS)) assert.ok(c.ma.min <= c.ma.typ && c.ma.typ <= c.ma.max, c.id);
  for (const s of POWER_SETUPS) for (const id of [...s.parts, ...(s.animationPart ? [s.animationPart] : [])]) assert.ok(COMPONENTS[id], `${s.id}:${id}`);
});

test("fourchette cohérente : bas < typique < haut", () => {
  for (const s of POWER_SETUPS) {
    const lo = estimateSetup(s, { scenario: "min" }), mid = estimateSetup(s), hi = estimateSetup(s, { scenario: "max" });
    assert.ok(lo.eurosYear < mid.eurosYear && mid.eurosYear < hi.eurosYear, s.id);
  }
});

test("arithmétique : kWh/an = W prise × 8760 / 1000 ; coût = kWh × tarif", () => {
  const e = estimateSetup(by("eink29bwr"), { tariff: 0.25 });
  assert.ok(Math.abs(e.kwhYear - (e.wattsWall * HOURS_PER_YEAR) / 1000) < 1e-9);
  assert.ok(Math.abs(e.eurosYear - e.kwhYear * 0.25) < 1e-9);
  assert.ok(Math.abs(e.watts5v - (e.ma / 1000) * 5) < 1e-9);
});

test("ordres de grandeur : e-ink < OLED < TFT 1,8″ < TFT 2,8″ ; le tactile reste sous 5 €/an", () => {
  const cost = (id: string) => estimateSetup(by(id)).eurosYear;
  assert.ok(cost("eink29bwr") < cost("eink27bwOled"));
  assert.ok(cost("eink27bwOled") < cost("tft18"));
  assert.ok(cost("tft18") < cost("tft28"));
  assert.ok(cost("tft28") < 5);
  assert.ok(cost("eink29bwr") > 0.3);
});

test("animation en boucle : surcoût seulement pour les écrans dynamiques", () => {
  const tft = by("tft28");
  assert.ok(estimateSetup(tft, { withAnimation: true }).ma > estimateSetup(tft).ma);
  const ink = by("eink29bwr");
  assert.equal(estimateSetup(ink, { withAnimation: true }).ma, estimateSetup(ink).ma);
});

test("la rafale de pull est négligeable (< 1 % à 5 min) et la répartition fait 100 %", () => {
  assert.ok(pullAverageMa(300) < 1);
  const total = shareByPart(by("tft28")).reduce((t, p) => t + p.share, 0);
  assert.ok(Math.abs(total - 1) < 1e-9);
});

test("parc : somme des montages", () => {
  const one = estimateSetup(by("tft28")).kwhYear;
  assert.ok(Math.abs(fleetEstimate({ tft28: 3 }).kwhYear - 3 * one) < 1e-9);
  assert.equal(fleetEstimate({}).kwhYear, 0);
});
