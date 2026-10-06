import test from "node:test";
import assert from "node:assert/strict";
import { planMerge } from "../lib/deviceMerge";

const OLD = { deviceId: "dev_AAAAAAAA", deviceName: "Écran salon", artistName: "Thib", artistId: "art_1" };
const NEW = { deviceId: "dev_BBBBBBBB", artistId: "art_1" };

test("fusion valide : même profil, appareils distincts, nom de l'ancien retapé (casse et accents tolérés)", () => {
  assert.deepEqual(planMerge(OLD.deviceId, NEW.deviceId, "ecran SALON", OLD, NEW), { ok: true });
});

test("identifiants invalides ou identiques : refus 400", () => {
  assert.equal((planMerge("x", NEW.deviceId, "Écran salon", OLD, NEW) as { status: number }).status, 400);
  assert.equal((planMerge(OLD.deviceId, "dev_bad", "Écran salon", OLD, NEW) as { status: number }).status, 400);
  assert.equal((planMerge(OLD.deviceId, OLD.deviceId, "Écran salon", OLD, OLD) as { status: number }).status, 400);
  assert.equal((planMerge(undefined, undefined, "", null, null) as { status: number }).status, 400);
});

test("appareil introuvable : 404", () => {
  assert.equal((planMerge(OLD.deviceId, NEW.deviceId, "Écran salon", null, NEW) as { status: number }).status, 404);
  assert.equal((planMerge(OLD.deviceId, NEW.deviceId, "Écran salon", OLD, null) as { status: number }).status, 404);
});

test("profils différents, ou nouvel appareil non appairé : 409 (jamais de fusion entre profils)", () => {
  assert.equal((planMerge(OLD.deviceId, NEW.deviceId, "Écran salon", OLD, { ...NEW, artistId: "art_2" }) as { status: number }).status, 409);
  assert.equal((planMerge(OLD.deviceId, NEW.deviceId, "Écran salon", OLD, { deviceId: NEW.deviceId, artistId: undefined }) as { status: number }).status, 409);
});

test("confirmation absente, vide ou fausse : refus (rien ne s'efface sans retaper le nom)", () => {
  for (const c of [undefined, "", "   ", "autre nom", 42]) {
    assert.equal((planMerge(OLD.deviceId, NEW.deviceId, c, OLD, NEW) as { status: number }).status, 400, String(c));
  }
});

test("ancien appareil sans nom : la confirmation est le nom d'artiste, puis l'identifiant", () => {
  assert.deepEqual(planMerge(OLD.deviceId, NEW.deviceId, "thib", { ...OLD, deviceName: undefined }, NEW), { ok: true });
  assert.deepEqual(planMerge(OLD.deviceId, NEW.deviceId, "dev_aaaaaaaa", { ...OLD, deviceName: undefined, artistName: undefined }, NEW), { ok: true });
});
