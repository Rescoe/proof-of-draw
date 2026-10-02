// Parité canvas → buffer écran → décodage (décision D3) et non-régression du refactor de canvasToScreen.
import test from "node:test";
import assert from "node:assert/strict";
import { SCREEN_PROFILES, ScreenId } from "@/lib/screenProfiles";
import { rgbaToScreenPayload, ScreenPayload } from "@/lib/canvasToScreen";
import { canvasToScreenPayload as legacyEncode } from "./fixtures/canvasToScreen.legacy";
import { screenPayloadToCanvas } from "@/lib/screenToCanvas";
import { modeForProfile, BLACK, WHITE, RED, cr, cg, cb, rng } from "@/lib/drawEngine";
import { randomSequence } from "./helpers";

// ImageData n'existe pas dans Node
class FakeImageData { constructor(public data: Uint8ClampedArray, public width: number, public height: number) {} }
(globalThis as unknown as { ImageData: typeof FakeImageData }).ImageData = FakeImageData;

const fakeCanvas = (rgba: Uint8ClampedArray) =>
  ({ getContext: () => ({ getImageData: () => ({ data: rgba }) }) }) as unknown as HTMLCanvasElement;

const IDS = Object.keys(SCREEN_PROFILES) as ScreenId[];

test("refactor sans régression : rgbaToScreenPayload == ancienne implémentation, bit pour bit", () => {
  for (const id of IDS) {
    const p = SCREEN_PROFILES[id];
    const r = rng(99);
    for (let round = 0; round < 3; round++) {
      const rgba = new Uint8ClampedArray(p.width * p.height * 4);
      for (let i = 0; i < rgba.length; i += 4) {
        // couleurs quelconques, y compris semi-transparentes (cas OLED/TFT)
        rgba[i] = Math.floor(r() * 256); rgba[i + 1] = Math.floor(r() * 256); rgba[i + 2] = Math.floor(r() * 256);
        rgba[i + 3] = round === 0 ? 255 : Math.floor(r() * 256);
      }
      const a = rgbaToScreenPayload(rgba, id);
      if (id === "tft28") continue;   // écran apparu après la copie « legacy » : vérifié par le test dédié ci-dessous
      const b = legacyEncode(fakeCanvas(rgba), id);
      assert.deepEqual(a, b, `${id} round ${round}`);
    }
  }
});

test("tft28 (TFT 2.8\" tactile 240×320) : RGB565 little-endian, transparent = blanc — formule indépendante, octet pour octet", () => {
  const p = SCREEN_PROFILES.tft28;
  assert.deepEqual([p.width, p.height, p.bufferSize], [240, 320, 153600]);
  const r = rng(7);
  const rgba = new Uint8ClampedArray(p.width * p.height * 4);
  for (let i = 0; i < rgba.length; i += 4) {
    rgba[i] = Math.floor(r() * 256); rgba[i + 1] = Math.floor(r() * 256); rgba[i + 2] = Math.floor(r() * 256);
    rgba[i + 3] = Math.floor(r() * 256);
  }
  const payload = rgbaToScreenPayload(rgba, "tft28") as { screen: string; buffer: string };
  assert.equal(payload.screen, "tft28");
  const buf = Buffer.from(payload.buffer, "base64");
  assert.equal(buf.length, 153600);
  for (let px = 0; px < p.width * p.height; px++) {
    const transparent = rgba[px * 4 + 3] < 32;
    const [rr, gg, bb] = transparent ? [255, 255, 255] : [rgba[px * 4], rgba[px * 4 + 1], rgba[px * 4 + 2]];
    const v = ((rr >> 3) << 11) | ((gg >> 2) << 5) | (bb >> 3);
    assert.equal(buf[px * 2], v & 0xff, `pixel ${px} octet bas`);
    assert.equal(buf[px * 2 + 1], v >> 8, `pixel ${px} octet haut`);
  }
});

test("tailles de buffer conformes aux profils d'écran", () => {
  for (const id of IDS) {
    const p = SCREEN_PROFILES[id];
    const rgba = new Uint8ClampedArray(p.width * p.height * 4).fill(255);
    const payload = rgbaToScreenPayload(rgba, id) as unknown as Record<string, string>;
    const size = (b64: string) => Buffer.from(b64, "base64").length;
    if (p.payloadType === "dual") { assert.equal(size(payload.black), p.bufferSize); assert.equal(size(payload.red), p.bufferSize); }
    else assert.equal(size(payload.buffer), p.bufferSize);
  }
});

function decodedPixel(id: ScreenId, payload: ScreenPayload, x: number, y: number) {
  const img = screenPayloadToCanvas(payload);
  const i = (y * img.width + x) * 4;
  return [img.data[i], img.data[i + 1], img.data[i + 2]];
}

test("aller-retour : ce que dessine le moteur == ce que l'écran affichera, pixel par pixel", () => {
  for (const id of IDS) {
    const p = SCREEN_PROFILES[id];
    const mode = modeForProfile(p);
    const s = randomSequence(31337, mode, 60, p.width, p.height, () => {});
    const bmp = s.bitmap;
    const payload = rgbaToScreenPayload(bmp.toRGBA(), id);
    const img = screenPayloadToCanvas(payload);
    assert.equal(img.width, p.width);
    assert.equal(img.height, p.height);
    let checked = 0;
    for (let y = 0; y < p.height; y++) for (let x = 0; x < p.width; x++) {
      const c = bmp.get(x, y);
      const [r, g, b] = decodedPixel(id, payload, x, y);
      if (id === "oled096") {
        // OLED : pixel sombre du canvas = pixel allumé (blanc) sur l'écran
        assert.equal(r === 255, c === BLACK, `oled ${x},${y}`);
      } else if (mode === "bw") {
        assert.equal(r === 0, c === BLACK, `bw ${id} ${x},${y}`);
        assert.ok(c === BLACK || c === WHITE);
      } else if (mode === "bwr") {
        const expected = c === BLACK ? [0, 0, 0] : c === RED ? [255, 0, 0] : [255, 255, 255];
        assert.deepEqual([r, g, b], expected, `bwr ${x},${y}`);
      } else {
        // RGB565 : mêmes 5/6/5 bits avant et après
        assert.equal(r >> 3, cr(c) >> 3, `r ${x},${y}`);
        assert.equal(g >> 2, cg(c) >> 2, `g ${x},${y}`);
        assert.equal(b >> 3, cb(c) >> 3, `b ${x},${y}`);
      }
      checked++;
    }
    assert.equal(checked, p.width * p.height);
  }
});
