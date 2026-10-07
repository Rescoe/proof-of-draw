import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import {
  ADVANCE, BLACK, CARTEL_MODES, FONT_5X7, LAYOUT_VERSION, PATTERNS, RED, T_DARK, T_GOLD, T_WHITE, WHITE, artworkIdentity, bottomLine, bytesPlane, decodeGrid, dimsOf, eInkTopLine, encodeGrid,
  fitGrid, foldText, frameHashOf, patternGrid, planeBytes, renderFrame, renderGrid, renderHashOf, type RenderMeta,
} from "../lib/renderLayout";
import { hash32 } from "../lib/renderLayout";
import { hashArtworkSource, hashGenerativeBundle } from "../lib/scene/hash";
import { cartelZonesFor } from "../lib/cartelZones";
import { rgbaToScreenPayload } from "../lib/canvasToScreen";
import { buildRenderVectors, metaCases } from "./helpers/renderVectors";
import type { ScreenId } from "../lib/screenProfiles";

// Lot 8A — RASTERISEUR DE RÉFÉRENCE (lib/renderLayout.ts). Références logicielles seulement : aucune mesure sur écran.
const root = path.join(__dirname, "..");
const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8").replace(/\r\n/g, "\n");
const enc = (s: string) => new TextEncoder().encode(s);
const sha = (...p: (string | Uint8Array)[]) => { const h = createHash("sha256"); for (const x of p) h.update(x); return h.digest("hex"); };
const CARTEL: ScreenId[] = ["eink29bwr", "eink27bw", "tft18"];
const meta: RenderMeta = metaCases()[0].meta;

test("la police est EXACTEMENT la table de la R4 : les trois firmwares R4 qui la portent (e-ink 2,9″, 2,7″, 2,7″+OLED) sont parsés et comparés ENTIÈREMENT (42 glyphes × 5 colonnes)", () => {
  const files = ["arduino_uno_r4/pod_uno_r4_eink29/pod_uno_r4_eink29.ino", "arduino_uno_r4/pod_uno_r4_eink27/pod_uno_r4_eink27.ino", "arduino_uno_r4/pod_uno_r4_eink27_oled/pod_uno_r4_eink27_oled.ino"];
  for (const f of files) {
    const block = /FONT_5x7\[\]\[5\] = \{([\s\S]*?)\n\};/.exec(read(f));
    assert.ok(block, `${f} : table FONT_5x7 introuvable`);
    const parsed = [...block[1].matchAll(/\{([^}]*)\}/g)].map((m) => m[1].split(",").map((x) => parseInt(x.trim(), 16)));
    assert.equal(parsed.length, 42, f);
    assert.ok(parsed.every((g) => g.length === 5 && g.every((v) => Number.isInteger(v) && v >= 0 && v <= 0xff)), `${f} : glyphe mal formé`);
    assert.deepEqual(parsed, FONT_5X7.map((g) => [...g]), f);
  }
});

test("géométrie : les bandes lues par le rasteriseur sont celles de lib/cartelZones (une seule source) et le port C++ répète les mêmes nombres", () => {
  const h = read("consensus-pod/src/podRender.h");
  for (const s of CARTEL) {
    const z = cartelZonesFor(s)!, { w, h: hh } = dimsOf(s);
    const m = new RegExp(`"${s}", (\\d+), (\\d+), (\\d), (?:true|false), true, (\\d+), (\\d+)`).exec(h);
    assert.ok(m, s);
    assert.deepEqual([Number(m[1]), Number(m[2]), Number(m[4]), Number(m[5])], [w, hh, z.top.y1, z.bottom.y0], s);
  }
  for (const s of ["oled096", "tft28"] as ScreenId[]) assert.equal(cartelZonesFor(s), null, `${s} : aucun cartel gravé`);
});

test("pipeline de texte : majuscules, repli Latin-1 de la R4, caractères inconnus → « ? » → espace, contrôles → espace, continuation isolée ignorée", () => {
  assert.equal(foldText(enc("Léa")), "LEA");
  assert.equal(foldText(enc("Élodie Çağlar")), "ELODIE CA?LAR");   // ğ n'est pas dans la table : un seul « ? »
  assert.equal(foldText(enc("ß × ÷ Þ ÿ")), "S * / T Y");
  assert.equal(foldText(Uint8Array.from([0x41, 0x80, 0x42])), "AB");
  assert.equal(foldText(Uint8Array.from([0xf0, 0x9f, 0x98, 0x80, 0x41])), "?A");      // emoji = UN « ? »
  assert.equal(foldText(Uint8Array.from([0xc3])), "?");
  assert.equal(foldText(Uint8Array.from([0x09, 0x7f, 0x41])), "  A");
  // lignes : troncature aux bornes (⌊(W−4)/6⌋ = 48 e-ink 2,9″ ; 20 TFT 1,8″), séparateur « - », repli
  const m = (artist: string, title: string, ts = "", bi = -1): RenderMeta => ({ ts: enc(ts), blockIndex: bi, artist: enc(artist), title: enc(title) });
  assert.equal(bottomLine(m("", ""), 48), "PROOF-OF-DRAW");
  assert.equal(bottomLine(m("ab", "cd"), 48), "AB - CD");
  assert.equal(bottomLine(m("ab", ""), 48), "AB");
  assert.equal(bottomLine(m("", "cd"), 48), "CD");
  assert.equal(bottomLine(m("", "A".repeat(49)), 48).length, 48);
  assert.equal(bottomLine(m("", "A".repeat(47)), 48).length, 47);
  assert.equal(bottomLine(m("A".repeat(30), "B".repeat(30)), 48), "A".repeat(30) + " - " + "B".repeat(15));
  assert.equal(eInkTopLine(m("", "", "07/10", 5), 296), "07/10 #5");
  assert.equal(eInkTopLine(m("", "", "", -1), 296), "PROOF-OF-DRAW");
  assert.equal(eInkTopLine(m("", "", "X".repeat(60), 5), 296).length, 48);
  assert.equal(Math.floor((264 - 4) / ADVANCE), 43);
});

test("encodage == production : encodeGrid donne EXACTEMENT les octets de rgbaToScreenPayload, et decode(encode(g)) == g (e-ink, noir/rouge, bords)", () => {
  for (const s of ["eink29bwr", "eink27bw"] as ScreenId[]) {
    const { w, h } = dimsOf(s), g = patternGrid(s, "bwr", 7);
    const rgba = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      const v = g[i], c = v === RED && s === "eink29bwr" ? [255, 0, 0] : v === BLACK || v === RED ? [0, 0, 0] : [255, 255, 255];
      rgba.set([...c, 255], 4 * i);
    }
    const p = rgbaToScreenPayload(rgba, s) as { black?: string; red?: string; buffer?: string };
    const planes = encodeGrid(s, g);
    assert.equal(Buffer.from(planes[0]).toString("base64"), s === "eink29bwr" ? p.black : p.buffer, s);
    if (s === "eink29bwr") assert.equal(Buffer.from(planes[1]).toString("base64"), p.red);
    const back = decodeGrid(s, planes);
    for (let i = 0; i < g.length; i++) { const want = s === "eink27bw" && g[i] === RED ? BLACK : g[i]; if (back[i] !== want) assert.fail(`${s} pixel ${i}`); }
  }
  // TFT 1,8″ : encodeGrid == rgbaToScreenPayload OCTET PAR OCTET (RGB565 petit-boutiste), sur une grille de mots 16 bits quelconques ET sur un rendu avec cartel (palette 0x10C4 / 0xFEA0 / 0x7BEF…)
  const tftToRgba = (g: Uint16Array) => {
    const rgba = new Uint8ClampedArray(g.length * 4);
    g.forEach((v, i) => rgba.set([((v >> 11) & 31) << 3, ((v >> 5) & 63) << 2, (v & 31) << 3, 255], 4 * i));   // quantifié comme le producteur : r5<<3, g6<<2, b5<<3 ⇒ aller-retour exact
    return rgba;
  };
  const anyWords = new Uint16Array(128 * 160).map((_, i) => hash32(99, i, 0) & 0xffff);
  for (const g of [anyWords, patternGrid("tft18", "noise", 3), renderGrid("tft18", patternGrid("tft18", "bwr", 5), "fit", meta)]) {
    const p = rgbaToScreenPayload(tftToRgba(g), "tft18") as { buffer: string };
    const mine = encodeGrid("tft18", g)[0];
    assert.equal(mine.length, planeBytes("tft18"));
    assert.ok(Buffer.from(p.buffer, "base64").equals(Buffer.from(mine)), "tft18 : octets différents de la production");
    assert.deepEqual([...decodeGrid("tft18", [mine])], [...g]);
  }
  assert.throws(() => decodeGrid("oled096", [new Uint8Array(1024)]), /pas de cartel/);
});

test("modes : hidden = image inchangée ; overlay = bandes écrasées, reste intact (le rouge est conservé hors bandes) ; fit = image ajustée entre les bandes", () => {
  for (const s of CARTEL) {
    const z = cartelZonesFor(s)!, { w, h } = dimsOf(s), g = patternGrid(s, "bwr", 12345);
    assert.deepEqual([...renderGrid(s, g, "hidden", meta)], [...g]);
    const ov = renderGrid(s, g, "overlay", meta);
    for (let y = z.safe.y0; y <= z.safe.y1; y++) for (let x = 0; x < w; x++) if (ov[y * w + x] !== g[y * w + x]) assert.fail(`${s} overlay a modifié la zone sûre (${x},${y})`);
    let changed = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (ov[y * w + x] !== g[y * w + x]) changed++;
    assert.ok(changed > 0, `${s} : l'overlay doit graver un cartel`);
    if (s === "eink29bwr") assert.ok(ov.some((v, i) => v === RED && Math.floor(i / w) >= z.safe.y0 && Math.floor(i / w) <= z.safe.y1), "rouge conservé dans la zone sûre");
    // séparateurs
    const gold = s === "tft18" ? T_GOLD : BLACK;
    for (let x = 0; x < w; x++) { assert.equal(ov[z.top.y1 * w + x], gold, `${s} séparateur haut`); assert.equal(ov[z.bottom.y0 * w + x], gold, `${s} séparateur bas`); }
    if (s === "tft18") assert.equal(ov[0], T_DARK);
  }
});

test("fit : arithmétique entière, ratio conservé, centrage, plus proche voisin (formule du contrat), blanc autour — dimensions paires ET impaires de largeur cible", () => {
  for (const s of CARTEL) {
    const z = cartelZonesFor(s)!, { w, h } = dimsOf(s), g = patternGrid(s, "noise", 1), f = fitGrid(s, g), white = s === "tft18" ? T_WHITE : WHITE;
    const hs = z.safe.h, nw = Math.floor((w * hs) / h), x0 = Math.floor((w - nw) / 2);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const inside = y >= z.safe.y0 && y <= z.safe.y1 && x >= x0 && x < x0 + nw;
      if (!inside) { assert.equal(f[y * w + x], white, `${s} (${x},${y}) hors image`); continue; }
      const sx = Math.floor(((2 * (x - x0) + 1) * w) / (2 * nw)), sy = Math.floor(((2 * (y - z.safe.y0) + 1) * h) / (2 * hs));
      assert.equal(f[y * w + x], g[sy * w + sx], `${s} (${x},${y})`);
    }
    assert.ok(nw <= w && (w - nw) >= 0);
  }
  // exemples chiffrés : 2,9″ → 100 lignes, largeur 231, marge 32 ; 2,7″ → 148 lignes, largeur 222 ; TFT 1,8″ → 131 lignes, largeur 104
  assert.deepEqual(CARTEL.map((s) => { const z = cartelZonesFor(s)!, { w, h } = dimsOf(s); const nw = Math.floor((w * z.safe.h) / h); return [z.safe.h, nw, Math.floor((w - nw) / 2)]; }), [[100, 231, 32], [148, 222, 21], [131, 104, 12]]);
});

test("écrans SANS cartel gravé (OLED, TFT 2,8″) : plans inchangés quel que soit le mode — le rapport de rendu ne prétend rien d'autre", () => {
  for (const s of ["oled096", "tft28"] as ScreenId[]) {
    const p = bytesPlane(s, 5);
    for (const mode of CARTEL_MODES) {
      const r = renderFrame(s, [p], mode, meta);
      assert.deepEqual(r.planes[0], p);
      assert.equal(r.frameHash, frameHashOf(s, [p]));
      assert.equal(r.renderHash, renderHashOf(s, [p], mode));
    }
  }
});

test("hashes : domaines gelés pod-frame-v1 / pod-render-v1 recalculés à la main ; layoutVersion et mode font partie du renderHash ; 3 niveaux distincts", () => {
  const s: ScreenId = "eink29bwr", planes = encodeGrid(s, patternGrid(s, "stripes", 1));
  assert.equal(frameHashOf(s, planes), sha("pod-frame-v1|eink29bwr|296x128|2|", planes[0], planes[1]));
  const r = renderFrame(s, planes, "overlay", meta);
  assert.equal(r.frameHash, sha("pod-frame-v1|eink29bwr|296x128|2|", planes[0], planes[1]));
  assert.equal(r.renderHash, sha(`pod-render-v1|eink29bwr|296x128|2|${LAYOUT_VERSION}|overlay|`, r.planes[0], r.planes[1]));
  assert.notEqual(r.frameHash, r.renderHash);
  assert.notEqual(renderHashOf(s, r.planes, "overlay"), renderHashOf(s, r.planes, "fit"));
  assert.notEqual(renderHashOf(s, r.planes, "overlay", 1), renderHashOf(s, r.planes, "overlay", 2));
  assert.equal(renderHashOf("tft18", [new Uint8Array(planeBytes("tft18"))], "hidden"), sha("pod-render-v1|tft18|128x160|1|1|hidden|", new Uint8Array(planeBytes("tft18"))));
  assert.throws(() => renderFrame(s, [planes[0]], "fit", meta), /taille inattendue/);
});

test("artworkHash : table de décision — jamais inventé (absent plutôt que faux)", () => {
  const h = "ab".repeat(32);
  assert.deepEqual(artworkIdentity({ blockVersion: 2, contentHash: h }), { hash: h, source: "block-content-hash", reason: "contentHash du bloc v2" });
  assert.equal(artworkIdentity({ blockVersion: 2, contentHash: h, rulesVersion: 2, kind: "animation" }).source, "anim-root-v3");
  assert.equal(artworkIdentity({ blockVersion: 2 }).hash, null);
  assert.equal(artworkIdentity({ blockVersion: 2, contentHash: "XYZ" }).hash, null);
  assert.equal(artworkIdentity({ kind: "animation", anim: { root: h } }).source, "anim-root-v1");
  assert.equal(artworkIdentity({}).hash, null, "bloc v1 / legacy : aucune identité");
  assert.equal(artworkIdentity({ blockVersion: 1 }).hash, null);
  assert.equal(artworkIdentity({ source: "ana-agent" }).hash, null, "ANA ancien : le hash du bloc identifie la publication, pas le contenu");
  assert.equal(artworkIdentity({ source: "ana-agent", anaContentHash: "zz" }).hash, null);
  // ANA émet « sha256:<64 hex minuscules> » (lib/scene/hash.ts, feed V2) : valeurs RÉELLES calculées par les fonctions du contrat scene-v1 — poème, manifeste (source), scène
  const poemSource = hashArtworkSource("Le poème de Kori\nrévision 1");
  const sceneBundle = hashGenerativeBundle("work_1", 1, hashArtworkSource("// scène"), "sha256:" + "5".repeat(64), undefined);
  const captureBundle = hashGenerativeBundle("work_2", 3, hashArtworkSource("// capture"), undefined, "sha256:" + "6".repeat(64));
  for (const real of [poemSource, sceneBundle, captureBundle]) {
    assert.match(real, /^sha256:[0-9a-f]{64}$/);
    const id = artworkIdentity({ source: "ana-agent", anaContentHash: real });
    assert.deepEqual(id, { hash: real.slice(7), source: "ana-declared", reason: "contentHash déclaré par ANA (sha256: retiré ; non recalculable par PoD)" });
    assert.match(id.hash!, /^[0-9a-f]{64}$/, "artworkHash = 64 hex NUS");
    assert.equal(artworkIdentity({ anaContentHash: real }).hash, real.slice(7), "reconnu aussi sans le champ source");
  }
  // strict : préfixe, longueur, alphabet, casse — jamais « réparés »
  const bare = "ab".repeat(32);
  for (const bad of [bare, `sha256:${bare.slice(1)}`, `sha256:${bare}0`, `sha256:${"AB".repeat(32)}`, `sha256:${"g".repeat(64)}`, `SHA256:${bare}`, `sha256: ${bare}`, ` sha256:${bare}`, `sha256:${bare}\n`, `sha1:${bare}`, `sha256:`, "", "sha256:capture-a"])
    assert.equal(artworkIdentity({ source: "ana-agent", anaContentHash: bad }).hash, null, JSON.stringify(bad));
  assert.equal(artworkIdentity({ source: "ana-agent", anaContentHash: 42 as unknown as string }).hash, null);
  // le préfixe n'est accepté QUE côté ANA : les hash des blocs PoD restent des hex nus
  assert.equal(artworkIdentity({ blockVersion: 2, contentHash: `sha256:${bare}` }).hash, null);
  assert.equal(artworkIdentity({ kind: "animation", anim: { root: `sha256:${bare}` } }).hash, null);
  assert.equal(artworkIdentity({ source: "ana-agent", blockVersion: 2, contentHash: h }).hash, null, "ANA n'emprunte jamais le contentHash PoD sans contentHash ANA");
});

test("vecteurs d'or : le fichier commité == la sortie de la référence (déterministe), couverture ≥ 220 rvec, 3 modes × 5 écrans × motifs, textes aux bornes", () => {
  const { vectorsTxt } = buildRenderVectors();
  assert.equal(read("consensus-pod/test-vectors/render-vectors.txt"), vectorsTxt, "régénérer : node --import tsx scripts/gen-render-vectors.ts");
  const rv = vectorsTxt.split("\n").filter((l) => l.startsWith("rvec "));
  assert.ok(rv.length >= 220, String(rv.length));
  for (const s of ["eink29bwr", "eink27bw", "tft18", "oled096", "tft28"]) for (const mode of CARTEL_MODES) assert.ok(rv.some((l) => l.startsWith(`rvec ${s} `) && l.split(" ")[4] === mode), `${s} ${mode}`);
  for (const p of PATTERNS) assert.ok(rv.some((l) => l.split(" ")[2] === p), p);
  assert.equal(new Set(rv.map((l) => l.split(" ")[10])).size > 100, true, "les renderHash ne sont pas dégénérés");
  // un cas bleu : image tout-blanc et tout-noir et bord / limites, chaque écran
  for (const s of CARTEL) for (const p of ["white", "full", "border", "limits"]) assert.ok(rv.some((l) => l.startsWith(`rvec ${s} ${p} `)), `${s} ${p}`);
});

test("périmètre : le rasteriseur n'importe ni Redis, ni route, ni firmware ; le .ino n'utilise pas podRender.h ; aucune route ne l'appelle (8A = référence seulement)", () => {
  const src = read("lib/renderLayout.ts");
  assert.deepEqual([...src.matchAll(/^import .* from "([^"]+)"/gm)].map((m) => m[1]).sort(), ["@/lib/cartelZones", "@/lib/screenProfiles", "node:crypto"]);
  assert.doesNotMatch(src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, ""), /redis|upstash|fetch\(|process\.env|Math\.random|Date\.now|\bfloat\b/i);
  const walk = (d: string): string[] => fs.readdirSync(path.join(root, d), { withFileTypes: true }).flatMap((e) => e.name === "node_modules" || e.name === ".next" || e.name === ".claude" ? [] : e.isDirectory() ? walk(path.join(d, e.name)) : /\.(ino|h|cpp|ts|tsx)$/.test(e.name) ? [path.join(d, e.name)] : []);
  for (const d of ["esp8266", "arduino_uno_r4", "app", "lib"]) for (const f of walk(d)) {
    const t = fs.readFileSync(path.join(root, f), "utf8");
    if (f.replace(/\\/g, "/") === "lib/renderLayout.ts") continue;
    assert.doesNotMatch(t, /podRender\.h|renderLayout/, f);
  }
});

test("documentation du lot 8A : structure intacte (un seul titre, sections 1 à 7 chacune UNE fois, règle ANA complète, exigence 8B présente) — garde contre une copie accidentelle", () => {
  const doc = read("docs/LOT_8A_RASTERISEUR_REFERENCE_2026_10_07.md");
  const heads = doc.split("\n").filter((l) => /^#{1,3} /.test(l));
  assert.equal(heads.length, 8, heads.join("\n"));
  assert.equal(heads.filter((h) => h.startsWith("# ")).length, 1);
  assert.deepEqual(heads.slice(1).map((h) => h.slice(0, 5)), ["## 1.", "## 2.", "## 3.", "## 4.", "## 5.", "## 6.", "## 7."]);
  assert.ok(doc.includes("côté ANA, **seul** `^sha256:[0-9a-f]{64}$` est accepté ; `artworkHash` = les 64 hex **sans** le préfixe"));
  assert.ok(doc.includes("Exigence du LOT 8B") && doc.includes("`toWorkMeta()`") && doc.includes("aucune commande Redis supplémentaire"));
  assert.ok(doc.split("\n").length < 120, "document anormalement long (bloc dupliqué ?)");
});
