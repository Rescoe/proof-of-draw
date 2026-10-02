import test from "node:test";
import assert from "node:assert/strict";
import { SCREEN_IDS, SCREEN_PROFILES, isDualBuffer, maxBufferBase64Length } from "../lib/screenProfiles";

const b64Len = (bytes: number) => Math.ceil(bytes / 3) * 4;

test("un buffer plein de CHAQUE écran passe la limite d'envoi (régression : « Buffer trop grand » sur le TFT 2.8\")", () => {
  for (const id of SCREEN_IDS) {
    const full = b64Len(SCREEN_PROFILES[id].bufferSize);
    assert.ok(full <= maxBufferBase64Length(id), `${id} : ${full} > limite ${maxBufferBase64Length(id)}`);
    assert.ok(!isDualBuffer(id) || SCREEN_PROFILES[id].payloadType === "dual");
  }
  assert.ok(maxBufferBase64Length("tft28") >= 204_800);
});

test("la limite reste serrée : un buffer 2× trop gros est refusé, un écran inconnu n'accepte rien", () => {
  for (const id of SCREEN_IDS) assert.ok(b64Len(SCREEN_PROFILES[id].bufferSize * 2) > maxBufferBase64Length(id), id);
  assert.equal(maxBufferBase64Length("nope"), 0);
});
