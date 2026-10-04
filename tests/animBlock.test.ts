import test from "node:test";
import assert from "node:assert/strict";
import { CLIP, decodeClip, encodeClip, type ClipInput } from "../lib/bench/clip";
import { animCapable, animPointerOfBlock, animPullMeta, readAnimPointer, supportsAnimPointer, withoutAnimPointer } from "../lib/anim/pointer";
import { animBlockDoc, animRefusal, buildAnimSubmission, buildAnimSubmissionFromClip, posterFor, verifyAnimDoc } from "../lib/anim/block";

const frame = (fill: (f: Uint8Array) => void) => { const f = new Uint8Array(CLIP.FRAME_BYTES); fill(f); return f; };
const mk = (frames: Uint8Array[], extra: Partial<ClipInput> = {}): ClipInput => ({ frames, delaysMs: frames.map(() => 100), loops: 2, fg: 0x07e0, bg: 0x0000, ...extra });
const ball = (x: number) => frame((f) => { for (let y = 28; y < 36; y++) f[y * 16 + (x >> 3)] |= 0x80 >> (x & 7); });
const input = () => mk([ball(10), ball(40), ball(70), ball(100)]);

test("animation : une empreinte et un score PAR IMAGE, score = moyenne, racine déterministe", () => {
  const a = buildAnimSubmission(input(), "tft28"), b = buildAnimSubmission(input(), "tft28");
  assert.equal(a.part.frames, 4);
  assert.equal(a.part.frameHashes.length, 4);
  assert.equal(a.part.frameScores.length, 4);
  assert.ok(a.part.frameHashes.every((h) => /^[a-f0-9]{64}$/.test(h)));
  assert.equal(new Set(a.part.frameHashes).size, 4, "4 images différentes = 4 empreintes différentes");
  assert.equal(a.part.root, b.part.root, "même animation = même racine");
  assert.match(a.part.root, /^[a-f0-9]{64}$/);
  const mean = a.part.frameScores.reduce((s, v) => s + v, 0) / 4;
  assert.ok(Math.abs(a.metrics.score - mean) < 0.0002, `score ${a.metrics.score} ≈ moyenne ${mean}`);
  assert.ok(a.metrics.score > 0 && a.metrics.score <= 1);
  assert.equal(a.drawScore, 3, "3 transitions différentes");
});

test("racine : toute modification d'une image, d'un délai ou des couleurs la change (les boucles : voir le test dédié)", () => {
  const base = buildAnimSubmission(input(), "tft28").part.root;
  const mod = (f: (i: ClipInput) => void) => { const i = input(); f(i); return buildAnimSubmission(i, "tft28").part.root; };
  assert.notEqual(mod((i) => { i.frames[2][0] ^= 0x01; }), base, "un pixel d'une image");
  assert.notEqual(mod((i) => { i.delaysMs[1] = 200; }), base, "un délai");
  assert.notEqual(mod((i) => { i.fg = 0xf800; }), base, "la couleur");
  assert.equal(mod(() => {}), base);
});

test("la racine ne dépend pas de l'écran (l'animation est la même), l'affiche si", () => {
  const a = buildAnimSubmission(input(), "tft28"), b = buildAnimSubmission(input(), "oled096");
  assert.equal(a.part.root, b.part.root);
  assert.notEqual(a.posterBuffer, b.posterBuffer);
});

test("rejouable : le clip du candidat redonne exactement les mêmes empreintes, scores et racine", () => {
  const a = buildAnimSubmission(input(), "tft18");
  const again = buildAnimSubmissionFromClip(new Uint8Array(Buffer.from(a.part.clip, "base64")), "tft18");
  assert.deepEqual(again.part, a.part);
  assert.equal(again.posterBuffer, a.posterBuffer);
  const dec = decodeClip(a.bin);
  assert.equal(dec.frames.length, 4);
  assert.ok(dec.frames.every((f, i) => f.every((v, k) => v === input().frames[i][k])));
});

test("un clip altéré est refusé (CRC) : aucune dérivation sur un clip douteux", () => {
  const a = buildAnimSubmission(input(), "tft28");
  const bin = new Uint8Array(Buffer.from(a.part.clip, "base64"));
  bin[40] ^= 0xff;
  assert.throws(() => buildAnimSubmissionFromClip(bin, "tft28"), /invalide/);
});

test("refus : une image, images identiques, rien de dessiné, clip trop gros", () => {
  assert.match(animRefusal(mk([ball(10)]))!, /2 images/);
  assert.match(animRefusal(mk([ball(10), ball(10)]))!, /identiques/);
  assert.throws(() => buildAnimSubmission(mk([ball(10)]), "tft28"), /2 images/);
  const noise = (seed: number) => frame((f) => { let s = seed; for (let i = 0; i < f.length; i++) { s = (s * 1664525 + 1013904223) >>> 0; f[i] = s >>> 24; } });
  assert.throws(() => buildAnimSubmission(mk(Array.from({ length: 12 }, (_, i) => noise(i + 1))), "tft28"), /trop gros/);
});

test("affiche : format de chaque écran, image au meilleur score, pixel au bon endroit", () => {
  const f = ball(10);
  const oled = Buffer.from(posterFor(f, "oled096", 0xffff, 0), "base64");
  assert.equal(oled.length, 1024);
  assert.equal(oled[(30 >> 3) * 128 + 10] & (1 << (30 & 7)), 1 << (30 & 7), "pixel (10,30) allumé, page-major");
  assert.equal(oled[0], 0);

  const t18 = Buffer.from(posterFor(f, "tft18", 0x07e0, 0x0000), "base64");
  assert.equal(t18.length, 128 * 160 * 2);
  const o18 = ((48 + 30) * 128 + 10) * 2;                    // clip 1:1 centré verticalement : 48 px de marge
  assert.equal(t18.readUInt16LE(o18), 0x07e0);
  assert.equal(t18.readUInt16LE(0), 0x0000, "marge = couleur de fond");

  const t28 = Buffer.from(posterFor(f, "tft28", 0x07e0, 0x0000), "base64");
  assert.equal(t28.length, 240 * 320 * 2);
  assert.equal(t28.readUInt16LE(((100 + 56) * 240 + 20) * 2), 0x07e0, "×1,875 : (10,30) ↔ ≈ (19..20, 56) dans la zone de 120 lignes");
  assert.equal(t28.readUInt16LE(0), 0x0000);

  const heavy = frame((g) => { for (let i = 0; i < g.length; i += 2) g[i] = 0xaa; });   // beaucoup de transitions
  const sub = buildAnimSubmission(mk([ball(10), heavy, ball(70)]), "oled096");
  assert.equal(sub.part.posterIndex, sub.part.frameScores.indexOf(Math.max(...sub.part.frameScores)));
});

test("vérification publique d'un bloc : document intact = cohérent, document modifié = détecté", () => {
  const sub = buildAnimSubmission(input(), "tft28");
  const doc = animBlockDoc(sub.part);
  assert.equal(verifyAnimDoc(doc, "tft28"), null);
  assert.match(verifyAnimDoc({ ...doc, frameScores: doc.frameScores.map((s) => s + 0.01) }, "tft28")!, /scores/);
  assert.match(verifyAnimDoc({ ...doc, frameHashes: [...doc.frameHashes].reverse() }, "tft28")!, /empreintes/);
  assert.match(verifyAnimDoc({ ...doc, root: "0".repeat(64) }, "tft28")!, /racine/);
});

test("capacité : seul un écran dont le firmware (déclaré) lit les animations en reçoit — jamais d'e-ink, jamais de version inconnue", () => {
  assert.equal(animCapable({ screens: ["tft28"], firmware: "r4tft28-2.4" }, "tft28"), true);
  assert.equal(animCapable({ screens: ["tft28"], firmware: "r4tft28-2.3" }, "tft28"), false, "R4 trop ancien");
  assert.equal(animCapable({ screens: ["tft28"] }, "tft28"), false, "version inconnue : pas d'animation");
  assert.equal(animCapable({ screens: ["oled096", "eink27bw"], firmware: "multiscreen-2.2" }, "oled096"), true, "multiscreen e-ink + OLED");
  assert.equal(animCapable({ screens: ["oled096", "eink27bw"], firmware: "multiscreen-2.1" }, "oled096"), false, "2.1 = banc d'essai seulement");
  assert.equal(animCapable({ screens: ["oled096", "eink27bw"], firmware: "multiscreen-2.2" }, "eink27bw"), false, "l'e-ink du même appareil n'anime pas");
  assert.equal(animCapable({ screens: ["tft18"], firmware: "tft18-2.2" }, "tft18"), true);
  assert.equal(animCapable({ screens: ["tft18"], firmware: "tft18-2.1" }, "tft18"), false);
  assert.equal(animCapable({ screens: ["tft18"], firmware: "tft18-2.2" }, "tft28"), false, "l'appareil n'a pas cet écran");
  assert.equal(animCapable({ screens: ["eink29bwr"], firmware: "r4eink29-1.0" }, "eink29bwr"), false);
  assert.equal(animCapable(null, "tft28"), false);
});

test("une animation de bloc tourne TOUJOURS en boucle : le nombre de boucles de l'auteur est ignoré", () => {
  const a = buildAnimSubmission(input(), "tft28");           // l'entrée demande 2 boucles
  assert.equal(a.part.loops, 0);
  assert.equal(decodeClip(a.bin).loops, 0);
  const b = buildAnimSubmission(mk([ball(10), ball(40), ball(70), ball(100)], { loops: 7 }), "tft28");
  assert.equal(a.part.root, b.part.root, "2 ou 7 boucles demandées : même animation, même racine");
  // un clip déjà encodé avec des boucles (ancien format) reste lisible et distinct
  const fin = buildAnimSubmissionFromClip(encodeClip(input()), "tft28").part;
  assert.equal(fin.loops, 2);
  assert.notEqual(fin.root, a.part.root);
});

test("pointeur d'animation : annoncé seulement au firmware qui sait le lire, validé strictement", () => {
  assert.equal(supportsAnimPointer(["tft28"], "r4tft28-2.4"), true);
  assert.equal(supportsAnimPointer(["tft28"], "r4tft28-2.10"), true);
  assert.equal(supportsAnimPointer(["tft28"], "r4tft28-3.0"), true);
  assert.equal(supportsAnimPointer(["tft28"], "r4tft28-2.3"), false);
  assert.equal(supportsAnimPointer(["tft28"], undefined), false, "version inconnue : pas de pointeur");
  assert.equal(supportsAnimPointer(["tft18"], "tft18-2.9"), true);
  assert.equal(supportsAnimPointer(["tft18"], "tft18-2.1"), false);
  assert.equal(supportsAnimPointer(["eink29bwr"], "r4eink29-1.0"), false);

  const hash = "a".repeat(64);
  const payload = { screen: "tft28", anim: { hash, bytes: 4000, frames: 12 } };
  assert.deepEqual(readAnimPointer(payload), { hash, bytes: 4000, frames: 12 });
  assert.equal(readAnimPointer({ anim: { hash: "xyz", bytes: 1, frames: 1 } }), null);
  assert.equal(readAnimPointer({ anim: { hash, bytes: "4000", frames: 1 } }), null);
  assert.equal(readAnimPointer({ screen: "tft28" }), null);
  assert.equal(readAnimPointer(null), null);

  assert.deepEqual(animPullMeta({ screens: ["tft28"], firmware: "r4tft28-2.4" }, "tft28", payload), { hash, bytes: 4000, frames: 12 });
  assert.equal(animPullMeta({ screens: ["tft28"], firmware: "r4tft28-2.3" }, "tft28", payload), undefined, "ancien firmware : réponse inchangée");
  assert.equal(animPullMeta({ screens: ["tft28"], firmware: "r4tft28-2.4" }, "oled096", payload), undefined);
  assert.equal("anim" in withoutAnimPointer({ ...payload, workTitle: "x" }), false);
  assert.equal(withoutAnimPointer({ ...payload, workTitle: "x" }).workTitle, "x");
});

test("galerie → écran : le pointeur d'un bloc d'animation suit l'image renvoyée (sinon l'écran n'a que l'affiche)", () => {
  const blockHash = "b".repeat(64);
  assert.deepEqual(animPointerOfBlock({ blockHash, kind: "animation", anim: { bytes: 3000, frames: 8 } }), { hash: blockHash, bytes: 3000, frames: 8 });
  assert.equal(animPointerOfBlock({ blockHash }), null, "un dessin n'a pas de pointeur");
  assert.equal(animPointerOfBlock({ blockHash, kind: "animation" }), null);
  // image personnelle (send-to-screen) : le pull annonce le pointeur comme pour une frame de consensus
  const personal = { screen: "oled096", anim: { hash: blockHash, bytes: 3000, frames: 8 } };
  assert.deepEqual(animPullMeta({ screens: ["oled096", "eink27bw"], firmware: "multiscreen-2.2" }, "oled096", personal), { hash: blockHash, bytes: 3000, frames: 8 });
  assert.equal(animPullMeta({ screens: ["oled096", "eink27bw"], firmware: "multiscreen-2.1" }, "oled096", personal), undefined);
});
