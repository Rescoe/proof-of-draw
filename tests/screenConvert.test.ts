// tests/screenConvert.test.ts — encodage / décodage / conversion inter-écrans (les 4 types) et rendu de poèmes
import test from "node:test";
import assert from "node:assert/strict";
import { encodeForScreen } from "../lib/screenEncode";
import { decodePayloadToBitmap, convertPayload } from "../lib/screenConvert";
import { renderPoem, wrapText, AVATAR_SIZE } from "../lib/poemRender";
import { SCREEN_PROFILES, SCREEN_IDS, type ScreenId } from "../lib/screenProfiles";

/** Image de test à la taille native d'un écran : cadre + diagonale + bloc plein (+ bloc rouge). */
function pattern(screen: ScreenId, withRed: boolean) {
  const { width: W, height: H } = SCREEN_PROFILES[screen];
  const gray = new Uint8Array(W * H).fill(255);
  const red = new Uint8Array(W * H);
  for (let x = 0; x < W; x++) { gray[x] = 0; gray[(H - 1) * W + x] = 0; }
  for (let y = 0; y < H; y++) { gray[y * W] = 0; gray[y * W + W - 1] = 0; }
  for (let i = 0; i < Math.min(W, H); i++) gray[i * W + i] = 0;
  for (let y = 10; y < 26; y++) for (let x = 20; x < 36; x++) { gray[y * W + x] = 0; if (withRed) red[y * W + x] = 1; }
  return { W, H, gray, red };
}

const inkCount = (g: Uint8Array) => g.reduce((n, v) => n + (v < 128 ? 1 : 0), 0);

for (const screen of SCREEN_IDS) {
  test(`aller-retour ${screen} : encode → decode restitue l'image à l'identique`, () => {
    const { W, H, gray, red } = pattern(screen, screen === "eink29bwr" || screen === "tft18");
    const enc = encodeForScreen(gray, W, H, screen, { red });
    const bmp = decodePayloadToBitmap({ ...enc, screen })!;
    assert.ok(bmp, "décodage possible");
    assert.equal(bmp.w, W); assert.equal(bmp.h, H);
    // Le TFT décode avec un seuil de luminance : l'encre noire/rouge est restituée à l'identique
    assert.deepEqual(Array.from(bmp.gray), Array.from(gray));
    if (screen === "eink29bwr" || screen === "tft18") assert.deepEqual(Array.from(bmp.red!), Array.from(red));
  });
}

for (const from of SCREEN_IDS) for (const to of SCREEN_IDS) {
  if (from === to) continue;
  test(`conversion ${from} → ${to} : image non vide, bonnes dimensions`, () => {
    const { W, H, gray, red } = pattern(from, from === "eink29bwr" || from === "tft18");
    const src = { ...encodeForScreen(gray, W, H, from, { red }), screen: from };
    const out = convertPayload(src, to);
    assert.ok(out, "conversion possible");
    assert.equal(out!.screen, to);
    const back = decodePayloadToBitmap(out as unknown as Record<string, unknown>)!;
    assert.equal(back.w, SCREEN_PROFILES[to].width);
    assert.equal(back.h, SCREEN_PROFILES[to].height);
    assert.ok(inkCount(back.gray) > 100, "l'image convertie contient de l'encre");
  });
}

test("le rouge BWR survit vers le TFT et revient vers le BWR ; une cible mono ne l'invente ni ne le garde", () => {
  const { W, H, gray, red } = pattern("eink29bwr", true);
  const bwr = { ...encodeForScreen(gray, W, H, "eink29bwr", { red }), screen: "eink29bwr" };
  const tft = convertPayload(bwr, "tft18")!;
  assert.ok(decodePayloadToBitmap(tft as unknown as Record<string, unknown>)!.red!.some((v) => v === 1), "rouge conservé sur TFT");
  const back = convertPayload(tft as unknown as Record<string, unknown>, "eink29bwr")!;
  assert.ok(decodePayloadToBitmap(back as unknown as Record<string, unknown>)!.red!.some((v) => v === 1), "rouge conservé au retour sur BWR");
  const mono = convertPayload(bwr, "eink27bw")!;
  assert.ok(!("red" in mono), "cible mono : pas de canal rouge");
});

// ─── Poèmes ───────────────────────────────────────────────────────────────────

const HAIKU = "Un vieil étang calme\nUne grenouille y plonge\nLe bruit de l'eau";
const AVATAR = new Uint8Array(AVATAR_SIZE * AVATAR_SIZE).fill(255).map((_, i) => (i % 7 === 0 ? 0 : 255));

for (const screen of SCREEN_IDS) {
  test(`poème ${screen} : rendu à la taille exacte de l'écran, encodable, avec et sans Normie`, () => {
    for (const avatar of [undefined, AVATAR]) {
      const r = renderPoem({ text: HAIKU, title: "Étang", avatar }, screen);
      assert.equal(r.w, SCREEN_PROFILES[screen].width);
      assert.equal(r.h, SCREEN_PROFILES[screen].height);
      assert.ok(inkCount(r.pixels) > 50, "du texte est dessiné");
      const enc = encodeForScreen(r.pixels, r.w, r.h, screen);
      assert.ok(decodePayloadToBitmap({ ...enc, screen }), "décodable");
      assert.equal(r.truncated, false, "un haïku tient sur tous les écrans");
    }
  });
}

test("poème trop long : tronqué proprement avec « ... » sur l'OLED, jamais hors cadre", () => {
  const long = Array.from({ length: 60 }, (_, i) => `vers numéro ${i + 1} du très long poème`).join("\n");
  const r = renderPoem({ text: long, avatar: AVATAR }, "oled096");
  assert.equal(r.truncated, true);
  assert.equal(r.pixels.length, 128 * 64);
});

test("la zone du Normie reste réservée : aucun texte dans les 40×40 de l'OLED", () => {
  const without = renderPoem({ text: HAIKU }, "oled096");
  const withAv  = renderPoem({ text: HAIKU, avatar: new Uint8Array(AVATAR_SIZE * AVATAR_SIZE).fill(255) }, "oled096");
  // avatar tout blanc : seul le texte décalé à droite est dessiné ; rien dans la colonne de gauche
  for (let y = 0; y < 64; y++) for (let x = 0; x < 44; x++) assert.equal(withAv.pixels[y * 128 + x], 255);
  assert.ok(inkCount(without.pixels) > 0);
});

test("wrapText : coupe aux mots, conserve les strophes, coupe les mots trop longs", () => {
  assert.deepEqual(wrapText("un deux trois", 7), ["un deux", "trois"]);
  assert.deepEqual(wrapText("a\n\nb", 5), ["a", "", "b"]);
  assert.deepEqual(wrapText("abcdefghij", 4), ["abcd", "efgh", "ij"]);
});

// ── TFT ↔ TFT : les couleurs survivent (un dessin en couleur ne devient pas « noir, blanc, rouge ») ─────────────────────
function colourFrame(screen: "tft18" | "tft28") {
  const { width: W, height: H } = SCREEN_PROFILES[screen];
  const buf = Buffer.alloc(W * H * 2, 0xff);                                      // fond blanc
  const COLOURS = [0x07e0 /* vert */, 0x001f /* bleu */, 0xffe0 /* jaune */, 0xf81f /* magenta */];
  for (let y = Math.floor(H * 0.2); y < Math.floor(H * 0.8); y++) {
    for (let x = Math.floor(W * 0.1); x < Math.floor(W * 0.9); x++) {
      const v = COLOURS[Math.floor(((x - W * 0.1) / (W * 0.8)) * COLOURS.length)];
      buf[(y * W + x) * 2] = v & 0xff; buf[(y * W + x) * 2 + 1] = v >> 8;
    }
  }
  return { screen, buffer: buf.toString("base64"), COLOURS };
}
const distinct565 = (b64: string) => {
  const b = Buffer.from(b64, "base64"), s = new Set<number>();
  for (let i = 0; i < b.length; i += 2) s.add(b[i] | (b[i + 1] << 8));
  return s;
};

for (const [from, to] of [["tft18", "tft28"], ["tft28", "tft18"]] as const) {
  test(`conversion ${from} → ${to} : les couleurs d'origine sont conservées (pas de passage par le noir/rouge)`, () => {
    const src = colourFrame(from);
    const out = convertPayload({ screen: from, buffer: src.buffer }, to) as unknown as { screen: string; buffer: string };
    assert.ok(out, "conversion possible");
    assert.equal(out.screen, to);
    assert.equal(Buffer.from(out.buffer, "base64").length, SCREEN_PROFILES[to].bufferSize);
    const colours = distinct565(out.buffer);
    for (const c of src.COLOURS) assert.ok(colours.has(c), `couleur 0x${c.toString(16)} perdue`);
    assert.ok(colours.has(0xffff), "le fond blanc reste blanc");
    assert.ok(![...colours].every((c) => c === 0xffff || c === 0x0000 || c === 0xf800), "image encore en noir/blanc/rouge");
  });
}
