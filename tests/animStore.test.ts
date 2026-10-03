import test from "node:test";
import assert from "node:assert/strict";
import { CLIP, decodeClip, type ClipInput } from "../lib/bench/clip";
import { animId, buildAnimItem, cleanTitle, galleryRefusal } from "../lib/anim/store";

const frame = (fill: (f: Uint8Array) => void) => { const f = new Uint8Array(CLIP.FRAME_BYTES); fill(f); return f; };
const mk = (frames: Uint8Array[], extra: Partial<ClipInput> = {}): ClipInput => ({ frames, delaysMs: frames.map(() => 100), loops: 2, fg: 0x07e0, bg: 0, ...extra });
const ball = (x: number) => frame((f) => { for (let y = 28; y < 36; y++) f[y * 16 + (x >> 3)] |= 0x80 >> (x & 7); });

test("galerie : seules les animations dessinées sont acceptées (≥ 2 images différentes, de l'encre)", () => {
  assert.equal(galleryRefusal(mk([ball(10), ball(20), ball(30)])), null);
  assert.match(galleryRefusal(mk([ball(10)]))!, /2 images/);
  assert.match(galleryRefusal(mk([ball(10), ball(10)]))!, /identiques/);
  assert.match(galleryRefusal(mk([frame(() => {}), frame(() => {}), frame(() => {})]))!, /identiques|dessiné/);
});

test("fiche : identifiant = empreinte du clip (même animation → même id), clip relisible, métadonnées nettoyées", () => {
  const input = mk([ball(10), ball(20), ball(30)], { loops: 3 });
  const a = buildAnimItem(input, { title: "  Ma   <b>balle</b>\n", author: "Roubzi", deviceId: "dev_7B4L17N3", now: 1000 });
  const b = buildAnimItem(input, { title: "autre titre", author: "Autre", now: 2000 });
  assert.equal(a.id, b.id, "même clip = même identifiant : jamais deux fois dans la galerie");
  assert.match(a.id, /^[a-f0-9]{12}$/);
  assert.equal(a.title, "Ma b balle /b");
  assert.equal(a.author, "Roubzi");
  assert.equal(a.frames, 3); assert.equal(a.loops, 3); assert.equal(a.fg, 0x07e0); assert.equal(a.deviceId, "dev_7B4L17N3");
  const d = decodeClip(new Uint8Array(Buffer.from(a.clip, "base64")));
  assert.equal(d.frames.length, 3);
  assert.equal(a.bytes, Buffer.from(a.clip, "base64").length);
  const c = buildAnimItem(mk([ball(10), ball(20), ball(31)], { loops: 3 }), { title: "x", now: 1 });
  assert.notEqual(c.id, a.id, "une animation différente a un autre identifiant");
});

test("titres : vides → « Sans titre », longs coupés à 60, caractères de contrôle et balises retirés ; auteur par défaut « Anonyme »", () => {
  assert.equal(cleanTitle(""), "Sans titre");
  assert.equal(cleanTitle(undefined), "Sans titre");
  assert.equal(cleanTitle("x".repeat(100)).length, 60);
  assert.equal(cleanTitle("a\u0000b\tc"), "a b c");
  assert.equal(buildAnimItem(mk([ball(1), ball(2)]), { title: "t", author: "   " }).author, "Anonyme");
});

test("animId : stable et sensible au moindre octet", () => {
  const x = new Uint8Array([1, 2, 3]);
  assert.equal(animId(x), animId(Uint8Array.from(x)));
  assert.notEqual(animId(x), animId(new Uint8Array([1, 2, 4])));
});
