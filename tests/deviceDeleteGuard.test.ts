import test from "node:test";
import assert from "node:assert/strict";
import { deleteConfirmWord, deleteConfirmed } from "../lib/deviceDeleteGuard";

const named = { deviceId: "dev_KAD6PKC4", deviceName: "Roubzi Touchscreen", artistName: "Roubzi" };

test("le mot à retaper : nom de l'appareil, sinon nom d'artiste, sinon identifiant", () => {
  assert.equal(deleteConfirmWord(named), "Roubzi Touchscreen");
  assert.equal(deleteConfirmWord({ deviceId: "dev_A", artistName: "Roubzi" }), "Roubzi");
  assert.equal(deleteConfirmWord({ deviceId: "dev_A", deviceName: "   ", artistName: " " }), "dev_A");
});

test("confirmation tolérante à la casse, aux accents et aux espaces", () => {
  assert.equal(deleteConfirmed("roubzi touchscreen", named), true);
  assert.equal(deleteConfirmed("  ROUBZI   Touchscreen  ", named), true);
  assert.equal(deleteConfirmed("Écran Été", { deviceId: "dev_B", deviceName: "ecran ete" }), true);
});

test("refuse : vide, partiel, autre appareil, simple « oui » / « supprimer »", () => {
  for (const bad of ["", "   ", "Roubzi", "Roubzi Touch", "Roubzi Touchscreen 2", "oui", "supprimer", "dev_KAD6PKC4"]) {
    assert.equal(deleteConfirmed(bad, named), false, `« ${bad} » ne doit pas valider`);
  }
});

test("identifiant en dernier recours : exact seulement", () => {
  const bare = { deviceId: "dev_KAD6PKC4" };
  assert.equal(deleteConfirmed("dev_kad6pkc4", bare), true);
  assert.equal(deleteConfirmed("dev_kad6", bare), false);
});
