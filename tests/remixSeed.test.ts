import test from "node:test";
import assert from "node:assert/strict";
import { DrawSession, modeForProfile } from "../lib/drawEngine";
import { rgbaToScreenPayload } from "../lib/canvasToScreen";
import type { ScreenPayload } from "../lib/screenToCanvas";
import { payloadToStudioRGBA, toScreenPayload } from "../lib/remixSeed";
import { SCREEN_IDS, SCREEN_PROFILES } from "../lib/screenProfiles";

// ImageData n'existe pas dans Node (même technique que tests/canvasToScreen.test.ts)
class FakeImageData { constructor(public data: Uint8ClampedArray, public width: number, public height: number) {} }
(globalThis as unknown as { ImageData: typeof FakeImageData }).ImageData = FakeImageData;

const STROKE = { erase: false, brush: "pen", size: 3, color: "#000000", opacity: 100, texture: "solid", sym: null, pixelPerfect: false };
function rng(seed: number) { let a = seed >>> 0; return () => { a = (a * 1664525 + 1013904223) >>> 0; return a / 4294967296; }; }
const sessionFor = (id: (typeof SCREEN_IDS)[number]) => { const p = SCREEN_PROFILES[id]; return new DrawSession({ width: p.width, height: p.height, mode: modeForProfile(p) }); };

test("Remix : charger l'image d'un bloc dans la feuille puis la ré-encoder redonne EXACTEMENT le même buffer, pour chaque écran (sinon « œuvre modifiée » serait faussée)", () => {
  for (const id of SCREEN_IDS) {
    const p = SCREEN_PROFILES[id], r = rng(7);
    const px = new Uint8ClampedArray(p.width * p.height * 4);
    for (let i = 0; i < p.width * p.height; i++) { const v = r() < 0.5 ? 255 : r() < 0.5 ? 0 : 180; px[i * 4] = v; px[i * 4 + 1] = r() < 0.1 ? 0 : v; px[i * 4 + 2] = v; px[i * 4 + 3] = 255; }
    const original = rgbaToScreenPayload(px, id) as ScreenPayload;
    const s = sessionFor(id);
    assert.equal(s.seedFromRGBA(payloadToStudioRGBA(original)), true, id);
    const again = rgbaToScreenPayload(s.bitmap.toRGBA(), id);
    assert.deepEqual(again, original, `aller-retour non identique pour ${id}`);
  }
});

test("une feuille chargée n'a AUCUNE action : score 0, annuler impossible ; modifier change le buffer", () => {
  const id = "oled096", p = SCREEN_PROFILES[id];
  const px = new Uint8ClampedArray(p.width * p.height * 4).fill(255);
  for (let x = 10; x < 60; x++) { const o = (20 * p.width + x) * 4; px[o] = px[o + 1] = px[o + 2] = 0; }
  const original = rgbaToScreenPayload(px, id);
  const s = sessionFor(id);
  assert.equal(s.seedFromRGBA(payloadToStudioRGBA(original as ScreenPayload)), true);
  assert.equal(s.actionCount, 0); assert.equal(s.score, 0); assert.equal(s.canUndo, false);
  s.beginStroke(1, { x: 5, y: 40 }, 0, STROKE);
  s.endStroke(1, { x: 90, y: 40 }, 100);
  assert.ok(s.actionCount > 0);
  assert.notDeepEqual(rgbaToScreenPayload(s.bitmap.toRGBA(), id), original, "une modification change le buffer");
  s.undo(200);
  assert.deepEqual(rgbaToScreenPayload(s.bitmap.toRGBA(), id), original, "annuler revient à l'image d'origine, pas à une feuille blanche");
});

test("seedFromRGBA : refusé sur une feuille déjà utilisée ou aux mauvaises dimensions (rien n'est changé)", () => {
  const id = "oled096", p = SCREEN_PROFILES[id];
  const s = sessionFor(id);
  assert.equal(s.seedFromRGBA(new Uint8ClampedArray(10)), false);
  assert.equal(s.seedFromRGBA(new Uint8ClampedArray(p.width * p.height * 4).fill(0)), true);
  s.beginStroke(1, { x: 5, y: 5 }, 0, { ...STROKE, color: "#ffffff" });   // la feuille chargée est noire : un trait blanc la modifie
  s.endStroke(1, { x: 20, y: 20 }, 50);
  assert.ok(s.actionCount > 0);
  assert.equal(s.seedFromRGBA(new Uint8ClampedArray(p.width * p.height * 4).fill(255)), false, "feuille déjà utilisée");
});

test("toScreenPayload : écran différent, buffer absent ou forme invalide → null ; ancienne archive sans champ « screen » acceptée", () => {
  assert.equal(toScreenPayload({ screen: "tft18", buffer: "AAAA" }, "oled096"), null);
  assert.equal(toScreenPayload({ screen: "oled096" }, "oled096"), null);
  assert.equal(toScreenPayload(null, "oled096"), null);
  assert.equal(toScreenPayload({ screen: "eink29bwr", black: "AA" }, "eink29bwr"), null);
  assert.deepEqual(toScreenPayload({ buffer: "AAAA" }, "oled096"), { screen: "oled096", buffer: "AAAA" });
  assert.deepEqual(toScreenPayload({ screen: "eink29bwr", black: "A", red: "B" }, "eink29bwr"), { screen: "eink29bwr", black: "A", red: "B" });
});

// ── interface : adresses, câblage, jamais de fausse filiation ────────────────
import fs from "node:fs";
import path from "node:path";
import { parseSeedRequest } from "../app/draw/_studio/seed";
const read = (p: string) => fs.readFileSync(path.join(__dirname, "..", p), "utf8");

test("parseSeedRequest : ?remix = hash 64 hex (minuscules), ?resume = identifiant simple ; tout le reste est ignoré", () => {
  const H = "ab".repeat(32);
  assert.deepEqual(parseSeedRequest(`remix=${H.toUpperCase()}`), { kind: "remix", blockHash: H });
  assert.deepEqual(parseSeedRequest("resume=123e4567-e89b-42d3"), { kind: "resume", candidateId: "123e4567-e89b-42d3" });
  for (const bad of ["", "remix=abc", `remix=${H}0`, "remix=../../etc", "resume=a", "resume=<script>alert(1)</script>", "resume=" + "x".repeat(65), "autre=1"]) assert.equal(parseSeedRequest(bad), null, bad);
  assert.deepEqual(parseSeedRequest(`remix=${H}&resume=cand-12345678`), { kind: "remix", blockHash: H }, "le Remix a priorité");
});

test("reprise d'un rejet : aucune filiation (le bloc n'existe pas) ; Remix : filiation = hash du bloc source ; l'envoi ne porte la clé que si elle existe", () => {
  const seed = read("app/draw/_studio/seed.ts");
  const resume = seed.slice(seed.indexOf("/api/rejected-image"));
  assert.doesNotMatch(resume.slice(0, resume.indexOf("export function useSeed")), /derivedFromBlockHash/, "une reprise ne crée JAMAIS de fausse filiation");
  assert.match(seed, /derivedFromBlockHash: req\.blockHash/);
  assert.match(read("app/draw/_studio/channel.ts"), /input\.derivedFromBlockHash \? \{ derivedFromBlockHash: input\.derivedFromBlockHash \} : \{\}/);
  assert.match(read("app/draw/_studio/SendFlow.tsx"), /props\.origin\?\.derivedFromBlockHash \? \{ derivedFromBlockHash/);
});

test("studio : un Remix a son propre brouillon, l'origine est effacée quand on repart d'une feuille blanche, jamais de navigation sur erreur", () => {
  const studio = read("app/draw/_studio/DrawStudio.tsx");
  assert.match(studio, /const draftKey = `\$\{deviceId\}:\$\{screenId\}\$\{props\.seed \? `:\$\{props\.seed\.key\}` : ""\}`/);
  assert.match(studio, /setTitle\(""\);\s*\n\s*setOrigin\(null\);/);
  const page = read("app/draw/[device]/[screen]/page.tsx");
  assert.match(page, /Dessiner sur une feuille blanche/);
  assert.doesNotMatch(page.slice(page.indexOf('seed.state === "error"'), page.indexOf("return (\n    <DrawStudio")), /router\.(push|replace)/);
});

test("galerie : Remix proposé aux seuls blocs d'images fixes de la chaîne canonique ; motif de rejet affiché ; échecs d'API jamais présentés comme listes vides", () => {
  const bd = read("app/BlockDetail.tsx");
  assert.match(bd, /block\.kind !== "animation" && block\.source !== "ana-agent" && isValidScreenId\(block\.poolScreen\)/);
  assert.match(bd, /param="remix" value=\{block\.blockHash\}/);
  const g = read("app/gallery/GalleryClient.tsx");
  assert.match(g, /Motif du rejet/); assert.match(g, /param="resume"/);
  assert.match(g, /setRejError\(/); assert.doesNotMatch(g, /catch \{\s*setRejected\(\[\]\)/);
  assert.doesNotMatch(g, /silently ignore/);
});
