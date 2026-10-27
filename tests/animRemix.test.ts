// 29/10/2026 — remix / reprise d'une ANIMATION : l'animation entière (toutes les images) est rouverte dans l'atelier, jamais seulement son affiche ; et l'OLED auxiliaire d'un BWR est un second écran public.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { CLIP, encodeClip } from "../lib/bench/clip";
import { clipB64ToStudioSeed, clipToStudioSeed, parseClipSeedRequest, rgb565ToHex } from "../lib/anim/seedClip";
import { rejectedEntry } from "../lib/rejectedArchive";
import { OLED_AUX_ID, toNetworkDevice, type DeviceRecord } from "../lib/networkSnapshot";

const read = (p: string) => fs.readFileSync(path.join(__dirname, "..", p), "utf8");
const frames = Array.from({ length: 5 }, (_, k) => Uint8Array.from({ length: CLIP.FRAME_BYTES }, (_, i) => (i * 7 + k * 13) & (i % 3 === 0 ? 0xff : 0)));
const delays = [60, 80, 100, 120, 140];

test("couleurs : RVB565 → #rrggbb (extrémités exactes, aller-retour avec hexTo565 de l'atelier)", () => {
  assert.equal(rgb565ToHex(0xffff), "#ffffff");
  assert.equal(rgb565ToHex(0), "#000000");
  const hexTo565 = (hex: string) => { const n = parseInt(hex.slice(1), 16); return (((n >> 16) & 0xff) >> 3 << 11) | (((n >> 8) & 0xff) >> 2 << 5) | ((n & 0xff) >> 3); };
  for (const v of [0x07e0, 0xf800, 0x001f, 0x1234, 0xabcd]) assert.equal(hexTo565(rgb565ToHex(v)), v);
});

test("un clip PBC1 redevient un brouillon COMPLET : toutes les images, tous les délais, couleurs et boucles", () => {
  const clip = encodeClip({ frames, delaysMs: delays, loops: 0, fg: 0x07e0, bg: 0x0000 });
  for (const seed of [clipToStudioSeed(clip), clipB64ToStudioSeed(Buffer.from(clip).toString("base64"))]) {
    assert.equal(seed.frames.length, 5, "les 5 images, pas seulement l'affiche");
    seed.frames.forEach((f, i) => assert.deepEqual([...f], [...frames[i]], `image ${i}`));
    assert.deepEqual(seed.delays, delays);
    assert.equal(seed.fg, rgb565ToHex(0x07e0)); assert.equal(seed.bg, "#000000"); assert.equal(seed.loops, 0);
  }
  const bad = Uint8Array.from(clip); bad[bad.length - 1] ^= 1;
  assert.throws(() => clipToStudioSeed(bad), /CRC|clip invalide/, "un clip altéré est refusé");
});

test("adresse de l'atelier : ?resume={candidat} ou ?remix={bloc 64 hex} ; tout autre format = aucune demande", () => {
  const h = "a".repeat(64);
  assert.deepEqual(parseClipSeedRequest(`?remix=${h}&device=dev_X`), { kind: "remix", blockHash: h });
  assert.deepEqual(parseClipSeedRequest("?resume=45a789ff-0eb2-43de-a1ce-44d4af8ac1a0"), { kind: "resume", candidateId: "45a789ff-0eb2-43de-a1ce-44d4af8ac1a0" });
  for (const bad of ["", "?remix=xyz", "?remix=" + "a".repeat(63), "?resume=a", "?resume=../etc/passwd", "?resume=" + "a".repeat(65)]) assert.equal(parseClipSeedRequest(bad), null, bad);
});

test("un rejet d'ANIMATION porte kind=animation (absent pour un dessin : forme historique inchangée)", () => {
  const base = { candidateId: "c-12345678", deviceId: "dev_A", poolScreen: "tft18", drawScore: 1, score: 0.5 };
  assert.equal(rejectedEntry({ ...base, kind: "animation" }, "x", 1).kind, "animation");
  assert.equal("kind" in rejectedEntry(base, "x", 1), false);
});

test("câblage : /api/rejected-image sert le clip sur demande, la galerie route une animation vers l'atelier, le studio de dessin renvoie vers l'atelier au lieu d'ouvrir l'affiche", () => {
  const route = read("app/api/rejected-image/route.ts");
  assert.match(route, /searchParams\.get\("clip"\) === "1"/);
  assert.match(route, /animation: true/);
  const gal = read("app/gallery/GalleryClient.tsx");
  assert.match(gal, /item\.kind === "animation"[\s\S]*\/animer\?resume=/);
  assert.match(gal, /item\.kind !== "animation" && isValidScreenId/, "plus de « Reprendre ce dessin » pour une animation");
  const seed = read("app/draw/_studio/seed.ts");
  assert.match(seed, /r\.body\.animation === true\) throw new SeedElsewhereError/);
  assert.match(seed, /meta\.body\.kind === "animation"\) throw new SeedElsewhereError/);
  assert.match(read("app/BlockDetail.tsx"), /\/animer\?remix=\$\{block\.blockHash\}/);
  const studio = read("app/animer/AnimStudio.tsx");
  assert.match(studio, /parseClipSeedRequest\(window\.location\.search\)/);
  assert.match(studio, /handmade: false/, "copie non soumise tant qu'on n'y a pas touché");
});

const bwr = (over: Partial<DeviceRecord> = {}): DeviceRecord => ({ deviceId: "dev_T46HBXG1", screens: ["eink29bwr"], firmware: "eink29bwr-2.13", caps: ["anim-oled"], artistName: "x", lastSeen: Date.now(), lastPing: Date.now(), ...over } as DeviceRecord);
test("vue réseau : un BWR à OLED auxiliaire (caps + firmware ≥ 2.13) montre DEUX écrans, sans entrer dans aucune pool", () => {
  const d = toNetworkDevice(bwr(), null);
  assert.deepEqual(d.screens.map((s) => s.screen), ["eink29bwr", OLED_AUX_ID]);
  assert.deepEqual(d.pools, ["eink29bwr"], "la pool oled096 ne gagne pas ce BWR");
  assert.match(d.screens[1].label, /OLED/);
});
test("vue réseau : sans capacité, firmware plus ancien ou autre écran => un seul écran, comme avant", () => {
  assert.deepEqual(toNetworkDevice(bwr({ caps: undefined }), null).screens.map((s) => s.screen), ["eink29bwr"]);
  assert.deepEqual(toNetworkDevice(bwr({ firmware: "eink29bwr-2.12" }), null).screens.map((s) => s.screen), ["eink29bwr"]);
  assert.deepEqual(toNetworkDevice(bwr({ screens: ["tft18"], firmware: "tft18-2.5" }), null).screens.map((s) => s.screen), ["tft18"]);
});

// ── OLED auxiliaire : ce que la constellation montre ────────────────────────────────────────────────────────────────────────────────────
import { buildAuxOledRecord, buildShownRecord, readShownMap, recordDisplayed, OLED_AUX_SCREEN_ID, type DisplayKV } from "../lib/displayState";
const H = "ab".repeat(32);
const animFrame = { frameId: "frame-anim-1", sourceDeviceId: "consensus", payload: { screen: "eink29bwr", black: "AA", red: "BB", _block: { index: 130, artistName: "Roubzi", hash: H }, anim: { hash: H, bytes: 900, frames: 12 } } };
const kv = (): DisplayKV & { store: Map<string, string> } => {
  const store = new Map<string, string>();
  return { store, set: async (k, v, o) => { if (o?.nx && store.has(k)) return null; store.set(k, v); return "OK"; }, mget: async (...ks) => ks.map((k) => store.get(k) ?? null), get: async (k) => store.get(k) ?? null };
};
test("ACK d'un BWR à OLED qui reçoit une ANIMATION : le pseudo-écran oled096aux est enregistré (sans image, avec le bloc) — et apparaît dans la vue publique", async () => {
  const k = kv();
  const rec = await recordDisplayed(k, "dev_T46", "eink29bwr", animFrame, "consensus", undefined, 1000, null, true);
  assert.ok(rec?.hasImage, "l'affiche BWR garde son image");
  const map = await readShownMap(k, [{ deviceId: "dev_T46", screen: "eink29bwr" }, { deviceId: "dev_T46", screen: OLED_AUX_SCREEN_ID }]);
  const aux = map.dev_T46[OLED_AUX_SCREEN_ID];
  assert.equal(aux.isAnimation, true); assert.equal(aux.blockHash, H); assert.equal(aux.hasImage, false); assert.equal(aux.blockIndex, 130);
  assert.equal(map.dev_T46.eink29bwr.isAnimation, true);
});
test("pas d'enregistrement aux : carte sans OLED, frame sans pointeur, frame personnelle", async () => {
  const k1 = kv(); await recordDisplayed(k1, "d", "eink29bwr", animFrame, "consensus", undefined, 1000, null, false);
  assert.equal(k1.store.has(`shown:d:${OLED_AUX_SCREEN_ID}`), false);
  const { anim: _a, ...p } = animFrame.payload; void _a;
  const k2 = kv(); await recordDisplayed(k2, "d", "eink29bwr", { ...animFrame, payload: p }, "consensus", undefined, 1000, null, true);
  assert.equal(k2.store.has(`shown:d:${OLED_AUX_SCREEN_ID}`), false);
  const personal = buildShownRecord(animFrame, "eink29bwr", "personal", 1)!;
  assert.equal(buildAuxOledRecord(personal, animFrame), null);
  assert.equal(buildAuxOledRecord(buildShownRecord({ ...animFrame, payload: { ...animFrame.payload, anim: { hash: "zz" } } }, "eink29bwr", "consensus", 1)!, { ...animFrame, payload: { ...animFrame.payload, anim: { hash: "zz" } } }), null, "pointeur invalide refusé");
});
test("câblage : la boucle d'animation est rejouée dans les vignettes de la constellation et du panneau", () => {
  assert.match(read("app/network/graph/nodes/ScreenNode.tsx"), /animHash=\{shown\.isAnimation \? shown\.blockHash : undefined\}/);
  assert.match(read("app/network/LiveDisplays.tsx"), /if \(animHash\) return <AnimLoop/);
  assert.match(read("app/network/AnimLoop.tsx"), /\/api\/block-clip\?hash=/);
  assert.match(read("app/api/ack-frame/route.ts"), /animOledAuxCapable\(device\)/);
});

import { withAuxOledFromHead } from "../lib/displayState";
test("constellation : l'OLED auxiliaire des cartes EN LIGNE montre la dernière animation (annoncée) ; rien si le dernier bloc est un dessin ou si la carte est hors ligne", () => {
  const dev = (id: string, online: boolean, aux = true) => ({ deviceId: id, isOnline: online, screens: [{ screen: "eink29bwr" }, ...(aux ? [{ screen: OLED_AUX_SCREEN_ID }] : [])] });
  const head = { blockHash: H, blockIndex: 124, kind: "animation", minedAt: 1000, workTitle: "Zombimouche_v2" };
  const m = withAuxOledFromHead({}, [dev("a", true), dev("b", false), dev("c", true, false)], head);
  assert.equal(m.a[OLED_AUX_SCREEN_ID].isAnimation, true); assert.equal(m.a[OLED_AUX_SCREEN_ID].blockHash, H); assert.equal(m.a[OLED_AUX_SCREEN_ID].blockIndex, 124);
  assert.equal(m.b, undefined); assert.equal(m.c, undefined);
  assert.deepEqual(withAuxOledFromHead({}, [dev("a", true)], { ...head, kind: undefined }), {});
  assert.deepEqual(withAuxOledFromHead({}, [dev("a", true)], null), {});
  assert.deepEqual(withAuxOledFromHead({}, [dev("a", true)], { ...head, blockHash: "zz" }), {});
});
