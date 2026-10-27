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
  for (const id of ["fw-27solo"]) assert.notEqual(items.find((i) => i.id === id)?.status, "done", `${id} n'a pas été essayé sur la carte`);
  // 14/10/2026 : le vote du TFT 2,8″ a été observé sur la carte (blocs #100 et #103) : "fait" n'est permis QUE parce que la note cite cette preuve.
  const tft = items.find((i) => i.id === "fw-tft28"); assert.equal(tft?.status, "done"); assert.match(tft?.note ?? "", /14\/10\/2026.*#103/);
  for (const id of ["anim-v2", "pi-nodes", "podscan"]) assert.equal(items.find((i) => i.id === id)?.status, "todo", `${id} n'existe pas encore`);
  // 28/10/2026 : l'OTA ESP8266 est prouvée sur certaines familles (matrice) mais pas distribuée sur R4 : « en cours », jamais « fait », et la note doit dire les deux
  const ota = items.find((i) => i.id === "ota"); assert.equal(ota?.status, "doing"); assert.match(ota?.note ?? "", /ESP8266/); assert.match(ota?.note ?? "", /aucune OTA R4 distribuée/);
  // le vote « tous les formats » n'est pas fait : le serveur invite déjà tout le monde, mais les corrections ne sont pas flashées et les capteurs seuls sont exclus
  const all = items.find((i) => i.id === "vote-all-formats"); assert.equal(all?.status, "doing"); assert.match(all?.note ?? "", /capteurs seuls restent exclus/);
  // la station R4 est « en cours » : rien n'y est observé en affichage d'œuvre ni en vote d'acceptation
  const st = items.find((i) => i.id === "station-r4"); assert.equal(st?.status, "doing"); assert.match(st?.note ?? "", /jamais observ/);
  // livrés derrière un interrupteur éteint et jamais essayés sur le réseau réel : « en cours », jamais « fait »
  for (const id of ["receipts", "verifier", "eligibility", "committee", "reputation"]) assert.equal(items.find((i) => i.id === id)?.status, "doing", `${id} : code livré, non activé`);
});
