import test from "node:test";
import assert from "node:assert/strict";
import { ROADMAP, phaseProgress, roadmapProgress, STATUS_LABEL } from "../app/learn/data/roadmap";

// La feuille de route (fin de la page Apprendre) doit rester bien formée : c'est un document public, un statut erroné serait une promesse fausse.
test("feuille de route : identifiants uniques, statuts valides, chaque phase a des points", () => {
  const ids = new Set<string>();
  for (const phase of ROADMAP) {
    assert.ok(phase.items.length > 0, `phase ${phase.id} vide`);
    assert.ok(!ids.has(phase.id), `phase en double ${phase.id}`);
    ids.add(phase.id);
    for (const item of phase.items) {
      assert.ok(item.title.trim().length > 10, `titre trop court : ${item.id}`);
      assert.ok(item.status in STATUS_LABEL, `statut invalide : ${item.id}`);
      assert.ok(!ids.has(item.id), `point en double ${item.id}`);
      ids.add(item.id);
    }
  }
});

test("feuille de route : les totaux de progression sont cohérents", () => {
  const all = roadmapProgress();
  assert.equal(all.done + all.doing + all.todo, all.total);
  assert.equal(all.total, ROADMAP.reduce((n, p) => n + p.items.length, 0));
  for (const phase of ROADMAP) {
    const p = phaseProgress(phase);
    assert.equal(p.done + p.doing + p.todo, p.total);
  }
  assert.ok(all.done > 0 && all.todo > 0, "la feuille de route doit montrer à la fois le fait et le restant");
});

test("feuille de route : jamais « fait » sans preuve pour ce qui touche au matériel non essayé", () => {
  const items = ROADMAP.flatMap((p) => p.items);
  for (const id of ["fw-27solo", "fw-tft28"]) assert.notEqual(items.find((i) => i.id === id)?.status, "done", `${id} n'a pas été essayé sur la carte`);
  for (const id of ["receipts", "committee", "anim-v2", "ota"]) assert.equal(items.find((i) => i.id === id)?.status, "todo", `${id} n'existe pas encore`);
});
