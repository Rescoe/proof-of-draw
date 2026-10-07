import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { FIRMWARE_CARTEL, cartelBandAt, cartelZonesFor, countUnderCartel } from "../lib/cartelZones";
import { SCREEN_PROFILES, type ScreenId } from "../lib/screenProfiles";

// Lot 7.1 — zone du cartel. La géométrie est vérifiée CONTRE LES SOURCES des firmwares (relues ici), pas recopiée de mémoire : si un firmware change sa bande, ce test échoue.
const root = path.join(__dirname, "..");
const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8").replace(/\r\n/g, "\n");
const num = (src: string, re: RegExp) => { const m = re.exec(src); assert.ok(m, String(re)); return Number(m![1]); };
const has = (src: string, re: RegExp, why: string) => assert.match(src, re, why);

/** Lignes effacées par le cartel, DÉRIVÉES du code source du firmware (quatre familles de code). */
function derive(dir: string) {
  const ino = read(`${dir}/${path.basename(dir)}.ino`);
  if (dir.includes("esp_tft1.8")) {
    const band = num(ino, /void burnTFTCartel\(\) \{\s*const int BAND = (\d+);/), H = num(ino, /#define TFT_H\s+(\d+)/);
    has(ino, /tft\.fillRect\(0, 0, TFT_W, BAND, C_DARK\);\s*tft\.drawFastHLine\(0, BAND, TFT_W, C_GOLD\);/, "bande haute + liseré");
    has(ino, /int footerY = TFT_H - BAND;\s*tft\.fillRect\(0, footerY, TFT_W, BAND, C_DARK\);/, "bande basse");
    return { top: { y0: 0, y1: band }, bottom: { y0: H - band, y1: H - 1 } };
  }
  if (dir.includes("pod_uno_r4_tft18")) {
    const H = num(ino, /#define IMG_H\s+(\d+)/), topH = num(ino, /const int topH = (\d+), botY = IMG_H - (\d+);/), back = num(ino, /const int topH = \d+, botY = IMG_H - (\d+);/);
    has(ino, /tft\.fillRect\(0, 0, IMG_W, topH, C_DARK\);\s*tft\.fillRect\(0, botY, IMG_W, IMG_H - botY, C_DARK\);/, "bandes");
    return { top: { y0: 0, y1: topH - 1 }, bottom: { y0: H - back, y1: H - 1 } };
  }
  if (dir.startsWith("esp8266/esp_eink_2.7BW")) {
    const fn = ino.slice(ino.indexOf("void burnEinkCartel_landscape(uint8_t* buf"));
    const band = num(fn, /const int BAND = (\d+);/), W = num(ino, /#define E27_WIDTH\s+(\d+)/);
    has(fn, /clearPortraitCols\(buf, 0, BAND - 1\);\s*drawLandscapeSepLine\(buf, BAND - 1\);/, "bande haute (séparateur dans la bande)");
    has(fn, /int botPxStart = E27_WIDTH - BAND;[^\n]*\n\s*clearPortraitCols\(buf, botPxStart, E27_WIDTH - 1\);\s*drawLandscapeSepLine\(buf, botPxStart\);/, "bande basse");
    return { top: { y0: 0, y1: band - 1 }, bottom: { y0: W - band, y1: W - 1 } };
  }
  // familles « bande + séparateur à la ligne BAND » : ESP 2.9 et ports R4 e-ink
  const esp29 = dir === "esp8266/esp_eink_2.9BWR";
  const H = num(ino, /#define IMG_H\s+(\d+)/), band = num(ino, /const int BAND = (\d+);/);
  if (esp29) {
    has(ino, /clearRows29\(bBuf, 0, BAND - 1\);[^\n]*\n[^\n]*\n\s*drawHLine29\(bBuf, BAND\);/, "haut 2,9 ESP");
    has(ino, /int botSep = IMG_H - BAND - 1;[^\n]*\n\s*clearRows29\(bBuf, botSep \+ 1, IMG_H - 1\);/, "bas 2,9 ESP");
  } else {
    has(ino, /whiteRows\(0, BAND - 1\);\s*hLine\(blackBuf, BAND\);/, "haut R4");
    has(ino, /const int sep = IMG_H - BAND - 1;[^\n]*\n\s*whiteRows\(sep \+ 1, IMG_H - 1\);\s*hLine\(blackBuf, sep\);/, "bas R4");
  }
  return { top: { y0: 0, y1: band }, bottom: { y0: H - band - 1, y1: H - 1 } };
}

test("la géométrie par firmware (FIRMWARE_CARTEL) est EXACTEMENT celle que dérivent les sources .ino des 8 firmwares à cartel gravé", () => {
  assert.equal(Object.keys(FIRMWARE_CARTEL).length, 8);
  for (const [dir, f] of Object.entries(FIRMWARE_CARTEL)) assert.deepEqual({ top: f.top, bottom: f.bottom }, derive(dir), dir);
});

test("la zone retenue par écran est l'UNION conservatrice des firmwares : ce qui est annoncé « sûr » l'est partout ; lignes sûres 100 / 148 / 131", () => {
  for (const screen of ["eink29bwr", "eink27bw", "tft18"] as ScreenId[]) {
    const z = cartelZonesFor(screen)!, mine = Object.values(FIRMWARE_CARTEL).filter((f) => f.screen === screen);
    assert.ok(mine.length >= 2, screen);
    assert.equal(z.top.y0, 0); assert.equal(z.bottom.y1, z.canvasH - 1);
    assert.equal(z.top.y1, Math.max(...mine.map((f) => f.top.y1)), `${screen} : bas de la bande haute = le plus grand des firmwares`);
    assert.equal(z.bottom.y0, Math.min(...mine.map((f) => f.bottom.y0)), `${screen} : haut de la bande basse = le plus petit des firmwares`);
    for (const f of mine) for (let y = f.top.y0; y <= f.top.y1; y++) assert.equal(cartelBandAt(z, y), "top", `${screen} y=${y}`);
    for (const f of mine) for (let y = f.bottom.y0; y <= f.bottom.y1; y++) assert.equal(cartelBandAt(z, y), "bottom", `${screen} y=${y}`);
    assert.equal(z.safe.y0, z.top.y1 + 1); assert.equal(z.safe.y1, z.bottom.y0 - 1); assert.equal(z.safe.h, z.safe.y1 - z.safe.y0 + 1);
    assert.equal(cartelBandAt(z, z.safe.y0), null); assert.equal(cartelBandAt(z, z.safe.y1), null);
    const p = SCREEN_PROFILES[screen]; assert.equal(z.canvasW, p.width, screen); assert.equal(z.canvasH, p.height, screen);
  }
  assert.deepEqual([cartelZonesFor("eink29bwr")!.safe.h, cartelZonesFor("eink27bw")!.safe.h, cartelZonesFor("tft18")!.safe.h], [100, 148, 131]);
  assert.equal(cartelZonesFor("oled096"), null, "l'OLED ne reçoit pas de cartel gravé");
  assert.equal(cartelZonesFor("tft28"), null, "le TFT 2,8″ affiche le cartel à la demande (toucher), il ne l'écrit pas dans l'image");
});

function blank(w: number, h: number) { const d = new Uint8ClampedArray(w * h * 4); d.fill(255); return d; }
const put = (d: Uint8ClampedArray, w: number, x: number, y: number, rgb: [number, number, number] = [0, 0, 0], a = 255) => { const i = (y * w + x) * 4; d[i] = rgb[0]; d[i + 1] = rgb[1]; d[i + 2] = rgb[2]; d[i + 3] = a; };

test("countUnderCartel : page blanche = 0 sur les trois écrans ; trait en zone sûre = 0 ; trait dans une bande compté (haut / bas séparément) ; bornes exactes des bandes sur chaque écran", () => {
  const z = cartelZonesFor("eink29bwr")!, W = z.canvasW, H = z.canvasH;
  for (const s of ["eink29bwr", "eink27bw", "tft18"] as ScreenId[]) { const q = cartelZonesFor(s)!; assert.deepEqual(countUnderCartel(s, blank(q.canvasW, q.canvasH), q.canvasW, q.canvasH), { underCartel: 0, drawn: 0, share: 0, top: 0, bottom: 0 }, s); }
  const img = blank(W, H);
  for (let x = 0; x < 50; x++) put(img, W, x, 60);                      // zone sûre
  for (let x = 0; x < 10; x++) put(img, W, x, 5);                       // bande haute
  for (let x = 0; x < 30; x++) put(img, W, x, 120, [204, 0, 0]);        // bande basse (rouge)
  put(img, W, 0, 0, [255, 255, 255]);                                   // blanc explicite : ne compte pas
  assert.deepEqual(countUnderCartel("eink29bwr", img, W, H), { underCartel: 40, drawn: 90, share: 40 / 90, top: 10, bottom: 30 });
  for (const [s, rows] of [["eink29bwr", [13, 14, 113, 114]], ["eink27bw", [13, 14, 161, 162]], ["tft18", [14, 15, 145, 146]]] as const) {
    const q = cartelZonesFor(s)!, e = blank(q.canvasW, q.canvasH);
    for (const y of rows) put(e, q.canvasW, 3, y);
    const u = countUnderCartel(s, e, q.canvasW, q.canvasH)!;
    assert.deepEqual([u.top, u.bottom, u.drawn], [1, 1, 4], `${s} : lignes ${rows[0]} et ${rows[2 + 1]} dans le cartel, ${rows[1]} et ${rows[2]} sûres`);
  }
  assert.equal(countUnderCartel("oled096", blank(128, 64), 128, 64), null, "écran sans cartel gravé");
  assert.equal(countUnderCartel("eink29bwr", blank(10, 10), 10, 10), null, "dimensions incohérentes : jamais de faux zéro");
  assert.equal(countUnderCartel("eink29bwr", new Uint8ClampedArray(5), W, H), null);
});

test("countUnderCartel suit la QUANTIFICATION RÉELLE : sur l'e-ink un gris clair devient blanc (non compté), une couleur sombre ou un rouge franc est compté ; sur le TFT tout mot RGB565 ≠ blanc est compté (#F8F8F8 oui, #FFFFFE non)", () => {
  const count = (screen: ScreenId, rgb: [number, number, number], a = 255) => {
    const q = cartelZonesFor(screen)!, im = blank(q.canvasW, q.canvasH); put(im, q.canvasW, 5, 2, rgb, a);
    return countUnderCartel(screen, im, q.canvasW, q.canvasH)!.underCartel;
  };
  // e-ink 2,9″ BWR et 2,7″ : luminance (3R + 6G + B)/10 < 128 → noir ; rouge si R > 150 et G, B < 100 ; sinon blanc
  for (const s of ["eink29bwr", "eink27bw"] as ScreenId[]) {
    for (const light of [[255, 255, 255], [250, 250, 250], [240, 240, 240], [200, 200, 200], [128, 128, 128], [255, 220, 220], [250, 245, 200]] as [number, number, number][]) assert.equal(count(s, light), 0, `${s} ${light} : devient blanc`);
    for (const dark of [[0, 0, 0], [127, 127, 127], [60, 60, 200], [0, 0, 120]] as [number, number, number][]) assert.equal(count(s, dark), 1, `${s} ${dark} : devient noir`);
  }
  assert.equal(count("eink29bwr", [204, 0, 0]), 1, "rouge de la palette"); assert.equal(count("eink29bwr", [151, 99, 99]), 1, "juste rouge (R > 150, G et B < 100)");
  assert.equal(count("eink29bwr", [151, 100, 99]), 1, "G = 100 : plus « rouge » mais luminance (3R+6G+B)/10 = 115 < 128 → noir : toujours perdu");
  assert.equal(count("eink29bwr", [200, 100, 200]), 0, "G = 100 et luminance 192 → blanc");
  // TFT 1,8″ : RGB565 — blanc = 0xFFFF seulement ; les canaux sont tronqués (R5 = R>>3, G6 = G>>2, B5 = B>>3)
  assert.equal(count("tft18", [255, 255, 255]), 0); assert.equal(count("tft18", [255, 255, 254]), 0, "B>>3 = 31 : toujours blanc"); assert.equal(count("tft18", [255, 252, 255]), 0, "G>>2 = 63 : toujours blanc");
  assert.equal(count("tft18", [248, 248, 248]), 1, "#F8F8F8 : G>>2 = 62 → n'est PLUS blanc, visible sur le TFT (un seuil RGB > 245 l'aurait ignoré)");
  assert.equal(count("tft18", [247, 255, 255]), 1, "R>>3 = 30"); assert.equal(count("tft18", [255, 251, 255]), 1, "G>>2 = 62"); assert.equal(count("tft18", [250, 245, 245]), 1);
  assert.equal(count("tft18", [0, 0, 0]), 1); assert.equal(count("tft18", [10, 10, 10], 0), 0, "pixel transparent (α < 32) : blanc, comme l'encodeur du TFT");
});

test("interface : la zone est dessinée dans le calque de guides de la scène (hachures, suit rotation et zoom), activable depuis « Affichage », activée par défaut, et ne touche ni le moteur de dessin ni l'envoi", () => {
  const stage = read("app/draw/_studio/Stage.tsx"), panels = read("app/draw/_studio/panels.tsx"), storage = read("app/draw/_studio/storage.ts"), studio = read("app/draw/_studio/DrawStudio.tsx"), send = read("app/draw/_studio/SendFlow.tsx");
  assert.match(stage, /cartel: CartelZones \| null/); assert.match(stage, /cartelBandAt|props\.cartel|const \{ [^}]*cartel[^}]* \} = P\.current/);
  assert.match(stage, /band\(z\.top\.y0, z\.top\.y1,/); assert.match(stage, /band\(z\.bottom\.y0, z\.bottom\.y1,/); assert.match(stage, /rectPath\(0, y0, W, bh\)/, "bande dessinée dans l'espace dessin (suit zoom et rotation)");
  assert.match(stage, /\[props\.grid, props\.tool, props\.frameLabel, props\.textDraft, props\.model, props\.modelEdit, props\.cartel, invalidate\]/, "le calque se redessine quand la zone change");
  assert.match(storage, /cartel: boolean;/); assert.match(storage, /cartel: true,/);
  assert.match(panels, /label="Zone du cartel"/); assert.match(studio, /cartelZonesFor\(screenId\)/);
  assert.match(send, /countUnderCartel\(screenId/);
  const engine = fs.readdirSync(path.join(root, "lib", "drawEngine")).map((f) => read(`lib/drawEngine/${f}`)).join("\n");
  assert.doesNotMatch(engine, /cartel/i, "le moteur de dessin ignore le cartel : l'image du bloc reste complète");
  assert.doesNotMatch(read("lib/canvasToScreen.ts"), /cartel/i, "conversions canvas → buffer inchangées");
});

test("contrat de rendu GELÉ (LOT7-FIX1) : la spécification fixe trois niveaux de hash, les domaines SHA-256, l'ordre des plans BWR, l'exclusion des scènes, le compositeur TFT, le rasteriseur versionné, la signature pod-render-v1 et le vocabulaire « non authentifié »", () => {
  const spec = read("docs/SPEC_LOT_7_CARTELS_RENDU_2026_10_07.md");
  for (const needle of [
    "artworkHash", "frameHash", "renderHash", "pod-frame-v1|", "pod-render-v1|", "plan₀ = noir, plan₁ = rouge", "4 736 octets", "little-endian", "W x H",
    "ne vaut que pour l'e-ink 2,7″", "aucun framebuffer final n'existe", "compositeur ligne par ligne", "writePixels",
    "layoutVersion` versionne TOUT le rasteriseur", "mode = scene", "clipHash", "animRoot", "une preuve des pixels physiquement visibles",
    "rapport NON AUTHENTIFIÉ reçu avec l'ACK", "pod-render-v1|deviceId|frameId|screen|layoutVersion|cartelMode|artworkHash|frameHash|renderHash", "sans lecture Redis de plus", "`fit` par défaut", "aucun réglage visible avant",
  ]) assert.ok(spec.includes(needle), needle);
  assert.ok(!/témoignage/i.test(spec + read("lib/displayState.ts") + read("app/profile/OwnDisplaysDebug.tsx")), "le rapport n'est JAMAIS présenté comme un témoignage de l'appareil");
  assert.match(read("docs/PLAN_DE_TRAVAIL_CONSENSUS_FINAL_2026_10_06.md"), /8\.8 `cartelMode`, `renderHash` \(Lot 7\.4-7\.5\) \| \*\*contrat gelé/);
});
