import test from "node:test";
import assert from "node:assert/strict";
import { HISTORY_MAX, histReducer, initHist, type Act, type Doc, type Hist } from "../lib/bench/history";
import { blank, setPixel, inkCount } from "../lib/bench/draw";

const doc = (): Doc => ({ frames: [blank(), blank()], delays: [100, 100], cur: 0 });
const run = (h: Hist, ...acts: Act[]) => acts.reduce(histReducer, h);
const paint = (x: number): Act => ({ type: "patch", fn: (d) => ({ ...d, frames: d.frames.map((f, i) => (i === d.cur ? setPixel(f, x, 5, true) : f)) }) });
const ink = (h: Hist, i = h.doc.cur) => inkCount(h.doc.frames[i]);

test("un trait (begin + plusieurs patch) = UN seul pas d'annulation ; annuler / rétablir restituent exactement l'état", () => {
  let h = initHist(doc());
  h = run(h, { type: "begin" }, paint(1), paint(2), paint(3));
  assert.equal(ink(h), 3); assert.equal(h.past.length, 1);
  h = run(h, { type: "undo" });
  assert.equal(ink(h), 0); assert.equal(h.future.length, 1);
  h = run(h, { type: "redo" });
  assert.equal(ink(h), 3); assert.equal(h.future.length, 0);
});

test("une nouvelle modification efface le « rétablir »", () => {
  let h = initHist(doc());
  h = run(h, { type: "begin" }, paint(1), { type: "begin" }, paint(2));
  h = run(h, { type: "undo" });
  assert.equal(h.future.length, 1);
  h = run(h, { type: "begin" }, paint(9));
  assert.equal(h.future.length, 0);
  assert.equal(ink(h), 2);
});

test("annuler / rétablir sans rien dans la pile : état inchangé (même objet)", () => {
  const h = initHist(doc());
  assert.equal(histReducer(h, { type: "undo" }), h);
  assert.equal(histReducer(h, { type: "redo" }), h);
});

test("commit = une opération en un coup (ajouter une image) ; annuler la retire, rétablir la remet", () => {
  let h = initHist(doc());
  h = run(h, { type: "commit", fn: (d) => ({ ...d, frames: [...d.frames, blank()], delays: [...d.delays, 100], cur: d.frames.length }) });
  assert.equal(h.doc.frames.length, 3); assert.equal(h.doc.cur, 2);
  h = run(h, { type: "undo" });
  assert.equal(h.doc.frames.length, 2); assert.equal(h.doc.cur, 0);
  h = run(h, { type: "redo" });
  assert.equal(h.doc.frames.length, 3); assert.equal(h.doc.cur, 2);
});

test("naviguer n'est pas une modification (aucun pas d'historique) ; annuler ramène à l'image modifiée", () => {
  let h = initHist(doc());
  h = run(h, { type: "begin" }, paint(4));            // modifie l'image 0
  h = run(h, { type: "nav", cur: 1 }, { type: "nav", cur: 1 });
  assert.equal(h.past.length, 1);
  h = run(h, { type: "undo" });
  assert.equal(h.doc.cur, 0, "on revient sur l'image où le trait avait été fait");
  assert.equal(ink(h, 0), 0);
});

test("l'historique est plafonné (les plus anciens pas sont oubliés) et les images partagées ne sont pas copiées", () => {
  let h = initHist(doc());
  for (let i = 0; i < HISTORY_MAX + 40; i++) h = run(h, { type: "begin" }, paint(i % 128));
  assert.equal(h.past.length, HISTORY_MAX);
  const untouched = h.doc.frames[1];
  assert.ok(h.past.every((d) => d.frames[1] === untouched), "l'image 1 jamais modifiée est PARTAGÉE par tous les instantanés");
});

test("reset (nouvelle animation importée) vide l'historique ; nav hors bornes est ramené dans les bornes", () => {
  let h = initHist(doc());
  h = run(h, { type: "begin" }, paint(1));
  h = run(h, { type: "reset", doc: doc() });
  assert.equal(h.past.length + h.future.length, 0);
  h = run(h, { type: "nav", cur: 99 });
  assert.equal(h.doc.cur, 1);
  h = run(h, { type: "commit", fn: (d) => ({ ...d, frames: [d.frames[0]], delays: [d.delays[0]] }) });
  assert.equal(h.doc.cur, 0, "après suppression, l'image courante reste valide");
});

test("step : image suivante / précédente en boucle, sans historique ; inactif avec une seule image", () => {
  let h = initHist(doc());
  h = run(h, { type: "step", delta: 1 }); assert.equal(h.doc.cur, 1);
  h = run(h, { type: "step", delta: 1 }); assert.equal(h.doc.cur, 0, "boucle");
  h = run(h, { type: "step", delta: -1 }); assert.equal(h.doc.cur, 1, "boucle en arrière");
  assert.equal(h.past.length, 0);
  const one = initHist({ frames: [blank()], delays: [100], cur: 0 });
  assert.equal(histReducer(one, { type: "step", delta: 1 }), one);
});
