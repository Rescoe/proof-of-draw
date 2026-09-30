// Tests du moteur de dessin pur — `npm test`
import test from "node:test";
import assert from "node:assert/strict";
import {
  DrawSession, Replayer, Bitmap, BLACK, WHITE, RED, bresenham, ellipseThin, floodRegion, brushMask,
  textureBit, TEXTURES, quantize565, scoreActions, scoreTimeline, craftProfile, symmetricCopies,
  measureText, encodeCustomBrush, decodeCustomBrush, customTextureId, parseCustomTexture,
} from "@/lib/drawEngine";
import { scoreFromActions, ActionEvent } from "@/lib/types/actions";
import { podHints } from "@/lib/drawEngine";
import { analyzeReplay } from "@/lib/crypto";
import { stroke, shape, fillS, gradS, textS, drawStroke, randomSequence, replayOf } from "./helpers";

// ─── Primitives ──────────────────────────────────────────────────────────────

test("bresenham : extrémités incluses et connexité 8", () => {
  for (const [x0, y0, x1, y1] of [[0, 0, 10, 3], [5, 5, 5, 5], [9, 2, 1, 8], [0, 7, 0, 0], [3, 3, 12, 3]]) {
    const px: [number, number][] = [];
    bresenham(x0, y0, x1, y1, (x, y) => px.push([x, y]));
    assert.deepEqual(px[0], [x0, y0]);
    assert.deepEqual(px[px.length - 1], [x1, y1]);
    for (let i = 1; i < px.length; i++) {
      assert.ok(Math.abs(px[i][0] - px[i - 1][0]) <= 1 && Math.abs(px[i][1] - px[i - 1][1]) <= 1);
    }
  }
});

test("ellipse fine : contour fermé, symétrique, dans son rectangle", () => {
  for (const [w, h] of [[5, 5], [20, 12], [31, 8], [2, 2], [9, 40], [1, 6]]) {
    const set = new Set<string>();
    ellipseThin(3, 4, 3 + w - 1, 4 + h - 1, (x, y) => set.add(x + "," + y));
    const pts = [...set].map(k => k.split(",").map(Number));
    assert.ok(pts.every(([x, y]) => x >= 3 && x <= 3 + w - 1 && y >= 4 && y <= 4 + h - 1), `hors cadre ${w}x${h}`);
    // symétrie gauche/droite et haut/bas
    for (const [x, y] of pts) {
      assert.ok(set.has((3 + 3 + w - 1 - x) + "," + y), `asymétrie H ${w}x${h}`);
      assert.ok(set.has(x + "," + (4 + 4 + h - 1 - y)), `asymétrie V ${w}x${h}`);
    }
    // fermeture : chaque pixel a au moins 2 voisins 8-connexes dans le contour (hors cas dégénérés)
    if (w >= 3 && h >= 3) {
      for (const [x, y] of pts) {
        let n = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if ((dx || dy) && set.has((x + dx) + "," + (y + dy))) n++;
        assert.ok(n >= 2, `trou dans l'ellipse ${w}x${h} en ${x},${y}`);
      }
    }
  }
});

test("remplissage : comparaison stricte, contigu vs global", () => {
  const b = new Bitmap(6, 4);
  // mur de pixels noirs colonne 3
  for (let y = 0; y < 4; y++) b.data[y * 6 + 3] = BLACK;
  const contig = floodRegion(b.data, 6, 4, 0, 0, true);
  assert.equal(contig.length, 12);            // colonnes 0..2 uniquement
  const glob = floodRegion(b.data, 6, 4, 0, 0, false);
  assert.equal(glob.length, 20);              // tous les blancs
  // pas de tolérance : un gris à 1 unité d'écart n'est PAS la même couleur
  b.data[0] = 0xffffffff - 1;
  assert.equal(floodRegion(b.data, 6, 4, 1, 0, true).includes(0), false);
});

test("empreintes de brosse : tailles attendues", () => {
  const count = (id: string, s: number) => brushMask(id, s).bits.reduce((a, v) => a + v, 0);
  assert.equal(count("round", 1), 1);
  assert.equal(count("round", 2), 4);
  assert.equal(count("round", 3), 5);   // croix
  assert.equal(count("round", 5), 21);
  assert.equal(count("square", 4), 16);
  assert.equal(count("pixel", 9), 1);
  assert.equal(count("hbar", 6), 6);
  assert.equal(count("slash", 5), 5);
  const id = encodeCustomBrush(3, 2, [1, 0, 1, 0, 1, 0]);
  assert.deepEqual(decodeCustomBrush(id), { w: 3, h: 2, bits: Uint8Array.from([1, 0, 1, 0, 1, 0]) });
});

test("textures : densités et texture personnalisée 8×8", () => {
  const density = (id: string) => { let n = 0; for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) if (textureBit(id, x, y)) n++; return n / 64; };
  assert.equal(density("solid"), 1);
  assert.equal(density("b50"), 0.5);
  assert.equal(density("b25"), 0.25);
  assert.equal(density("b12"), 0.125);
  assert.equal(density("b75"), 0.75);
  assert.equal(density("b88"), 56 / 64);
  for (const t of TEXTURES) assert.ok(density(t.id) > 0 && density(t.id) <= 1, t.id);
  const tile = new Uint8Array(64); tile[0] = 1; tile[9] = 1;
  const id = customTextureId(tile);
  assert.deepEqual([...parseCustomTexture(id)!], [...tile]);
});

test("symétrie : miroir et rotations reviennent sur elles-mêmes", () => {
  const c = symmetricCopies(3, 5, { m: "vh", cx: 32, cy: 24 });
  assert.deepEqual(c.map(p => [p.x, p.y]), [[3, 5], [60, 5], [3, 42], [60, 42]]);
  const r4 = symmetricCopies(10, 4, { m: "r4", cx: 20, cy: 20 });
  assert.equal(r4.length, 4);
  // rotation d'un quart de tour appliquée 4 fois = identité
  let p = { x: 10, y: 4 };
  for (let i = 0; i < 4; i++) { const q = symmetricCopies(p.x, p.y, { m: "r4", cx: 20, cy: 20 })[1]; p = { x: q.x, y: q.y }; }
  assert.deepEqual(p, { x: 10, y: 4 });
});

// ─── Session : tracé, historique, replay ─────────────────────────────────────

test("trait puis annuler / rétablir restaure exactement les pixels", () => {
  const s = new DrawSession({ width: 40, height: 30, mode: "bw" });
  const blank = s.bitmap.clone();
  drawStroke(s, 1, [[2, 2], [30, 20]], 1000, stroke({ size: 3 }));
  const drawn = s.bitmap.clone();
  assert.ok(!drawn.equals(blank));
  assert.ok(s.undo(2000));
  assert.ok(s.bitmap.equals(blank));
  assert.ok(s.redo(2100));
  assert.ok(s.bitmap.equals(drawn));
  assert.equal(s.canRedo, false);
});

test("régression audit C3 : annuler après un remplissage ne supprime pas le remplissage ; refaire le rétablit", () => {
  const s = new DrawSession({ width: 40, height: 30, mode: "bw" });
  s.fill({ x: 1, y: 1 }, 1000, fillS({ color: "#000000" }));
  const filled = s.bitmap.clone();
  drawStroke(s, 1, [[5, 5], [20, 20]], 2000, stroke({ color: "#FFFFFF", size: 2 }));
  assert.ok(s.undo(3000));
  assert.ok(s.bitmap.equals(filled), "le remplissage doit survivre à l'annulation du trait suivant");
  assert.ok(s.undo(3100));
  assert.ok(new Bitmap(40, 30).equals(s.bitmap));
  assert.ok(s.redo(3200));
  assert.ok(s.bitmap.equals(filled), "refaire un remplissage doit restaurer le remplissage");
});

test("régression audit C4 : après undo puis redo, le replay contient encore le trait", () => {
  const s = new DrawSession({ width: 40, height: 30, mode: "bw" });
  drawStroke(s, 1, [[2, 2], [25, 25]], 1000, stroke());
  drawStroke(s, 1, [[30, 2], [30, 28]], 2000, stroke());
  const before = s.getReplay().length;
  s.undo(3000);
  assert.ok(s.getReplay().length < before, "le replay ne contient plus le trait annulé");
  s.redo(3100);
  assert.equal(s.getReplay().length, before, "redo restaure le replay");
  assert.ok(replayOf(s).equals(s.bitmap));
});

test("plus de désynchronisation après > 50 gestes (audit C4, shift() de l'historique)", () => {
  const s = new DrawSession({ width: 60, height: 40, mode: "bw" });
  let t = 1000;
  for (let i = 0; i < 120; i++) { t = drawStroke(s, 1, [[i % 60, 0], [(i * 7) % 60, 39]], t + 40, stroke({ size: 1 })); }
  assert.ok(replayOf(s).equals(s.bitmap));
  for (let i = 0; i < 30; i++) s.undo(t += 20);
  assert.ok(replayOf(s).equals(s.bitmap));
  for (let i = 0; i < 10; i++) s.redo(t += 20);
  assert.ok(replayOf(s).equals(s.bitmap));
});

test("trait sans effet : ni entrée d'historique, ni point", () => {
  const s = new DrawSession({ width: 20, height: 20, mode: "bw" });
  drawStroke(s, 1, [[1, 1], [10, 10]], 1000, stroke({ color: "#FFFFFF" }));   // blanc sur blanc
  assert.equal(s.canUndo, false);
  assert.equal(s.score, 0);
  assert.equal(s.getActions().length, 0);
  assert.equal(s.fill({ x: 0, y: 0 }, 1500, fillS({ color: "#FFFFFF" })), false);
});

test("cadence : les points plus rapides que 16 ms ne sont ni tracés ni enregistrés", () => {
  const s = new DrawSession({ width: 60, height: 20, mode: "bw" });
  s.beginStroke(1, { x: 0, y: 5 }, 1000, stroke({ size: 1 }));
  assert.equal(s.moveStroke(1, { x: 10, y: 5 }, 1005), false);
  assert.equal(s.moveStroke(1, { x: 20, y: 5 }, 1016), true);
  assert.equal(s.moveStroke(1, { x: 30, y: 5 }, 1020), false);
  s.endStroke(1, { x: 40, y: 5 }, 1100);
  const ev = s.getReplay();
  assert.deepEqual(ev.map(e => e.kind), ["down", "move", "up"]);
  // le trait rejoué passe par le même chemin que le trait vu à l'écran
  assert.ok(replayOf(s).equals(s.bitmap));
  // aucun intervalle < 15 ms entre événements du replay
  for (let i = 1; i < ev.length; i++) assert.ok(ev[i].t - ev[i - 1].t >= 15, `intervalle ${ev[i].t - ev[i - 1].t}`);
});

test("annulation d'un trait en cours (pointercancel) : image intacte, rien d'enregistré", () => {
  const s = new DrawSession({ width: 30, height: 30, mode: "bw" });
  const blank = s.bitmap.clone();
  s.beginStroke(7, { x: 3, y: 3 }, 1000, stroke());
  s.moveStroke(7, { x: 20, y: 20 }, 1100);
  s.cancelStroke(7);
  assert.ok(s.bitmap.equals(blank));
  assert.equal(s.getActions().length, 0);
  assert.equal(s.getReplay().length, 0);
});

test("pixel parfait : plus de coins en L sur un tracé 1 px", () => {
  const s = new DrawSession({ width: 30, height: 30, mode: "bw" });
  // escalier : les points enregistrés créent des coins en L avec Bresenham simple
  drawStroke(s, 1, [[2, 2], [3, 2], [3, 3], [4, 3], [4, 4], [5, 4], [5, 5]], 1000, stroke({ brush: "pixel", size: 1, pixelPerfect: true }));
  const pp = [...Array(900).keys()].filter(i => s.bitmap.data[i] === BLACK).length;
  const s2 = new DrawSession({ width: 30, height: 30, mode: "bw" });
  drawStroke(s2, 1, [[2, 2], [3, 2], [3, 3], [4, 3], [4, 4], [5, 4], [5, 5]], 1000, stroke({ brush: "pixel", size: 1, pixelPerfect: false }));
  const raw = [...Array(900).keys()].filter(i => s2.bitmap.data[i] === BLACK).length;
  assert.ok(pp < raw, `pixel-parfait (${pp}) doit poser moins de pixels que le tracé brut (${raw})`);
  assert.ok(replayOf(s).equals(s.bitmap));
});

test("opacité RGB565 : un trait qui se recoupe ne s'assombrit pas deux fois", () => {
  const s = new DrawSession({ width: 30, height: 30, mode: "rgb565" });
  drawStroke(s, 1, [[2, 10], [25, 10], [2, 10], [25, 10]], 1000, stroke({ size: 1, color: "#000000", opacity: 50 }));
  const v = s.bitmap.get(10, 10);
  const single = new DrawSession({ width: 30, height: 30, mode: "rgb565" });
  drawStroke(single, 1, [[2, 10], [25, 10]], 1000, stroke({ size: 1, color: "#000000", opacity: 50 }));
  assert.equal(v, single.bitmap.get(10, 10));
  assert.notEqual(v, WHITE);
  assert.notEqual(v, BLACK);
});

test("effacer tout puis annuler restaure l'image", () => {
  const s = new DrawSession({ width: 30, height: 30, mode: "bwr" });
  drawStroke(s, 1, [[2, 2], [20, 20]], 1000, stroke({ color: "#CC0000" }));
  const before = s.bitmap.clone();
  assert.ok(s.clear(2000));
  assert.ok(new Bitmap(30, 30).equals(s.bitmap));
  assert.ok(s.undo(2100));
  assert.ok(s.bitmap.equals(before));
  assert.ok(replayOf(s).equals(s.bitmap));
});

test("le journal d'actions et le replay sont marqués v2 ; les anciens replays ne le sont pas", () => {
  const s = new DrawSession({ width: 30, height: 30, mode: "bw" });
  drawStroke(s, 1, [[2, 2], [20, 20]], 1000, stroke());
  assert.equal(s.getActions()[0].v, 2);
  assert.equal(s.getReplay()[0].v, 2);
});

// ─── Propriété : image reconstruite depuis le replay == image envoyée ───────

for (const mode of ["bw", "bwr", "rgb565"] as const) {
  test(`propriété replay == image (${mode}) sur 40 séquences aléatoires`, () => {
    for (let seed = 1; seed <= 40; seed++) {
      randomSequence(seed * 7919, mode, 45, 64, 48, (s, step, what) => {
        const rb = replayOf(s);
        if (!rb.equals(s.bitmap)) {
          let n = 0; for (let i = 0; i < rb.data.length; i++) if (rb.data[i] !== s.bitmap.data[i]) n++;
          assert.fail(`divergence mode=${mode} seed=${seed * 7919} étape=${step} (${what}) : ${n} pixels`);
        }
      });
    }
  });
}

test("l'image ne contient que des couleurs affichables par l'écran", () => {
  for (const mode of ["bw", "bwr", "rgb565"] as const) {
    for (let seed = 1; seed <= 15; seed++) {
      const s = randomSequence(seed * 104729, mode, 40, 64, 48, () => {});
      for (const c of s.bitmap.data) {
        if (mode === "bw") assert.ok(c === BLACK || c === WHITE, `bw: ${c.toString(16)}`);
        else if (mode === "bwr") assert.ok(c === BLACK || c === WHITE || c === RED, `bwr: ${c.toString(16)}`);
        else assert.equal(quantize565(c), c, `rgb565 non quantifié: ${c.toString(16)}`);
      }
    }
  }
});

test("instantané du brouillon : restauration fidèle (image, historique, score, replay)", () => {
  const s = randomSequence(4242, "bwr", 60, 64, 48, () => {});
  const snap = s.snapshot();
  const r = DrawSession.restore(snap);
  assert.ok(r.bitmap.equals(s.bitmap));
  assert.equal(r.score, s.score);
  assert.deepEqual(r.getActions(), s.getActions());
  assert.deepEqual(r.getReplay(), s.getReplay());
  assert.equal(r.canUndo, s.canUndo);
  // l'historique restauré reste fonctionnel
  const before = r.bitmap.clone();
  if (r.canUndo) { r.undo(99999); r.redo(99999 + 5); assert.ok(r.bitmap.equals(before)); }
  assert.ok(replayOf(r).equals(r.bitmap));
});

// ─── Sélection ───────────────────────────────────────────────────────────────

test("sélection rectangulaire : déplacer, dupliquer, retourner, supprimer", () => {
  const s = new DrawSession({ width: 40, height: 30, mode: "bw" });
  s.fill({ x: 0, y: 0 }, 1000, fillS({ color: "#FFFFFF" }));            // sans effet
  s.previewShape(shape({ shape: "rect", fill: true }), { x: 2, y: 2 }, { x: 5, y: 4 }, 1100);
  s.commitShape(1200);
  assert.equal(s.bitmap.get(3, 3), BLACK);
  s.selectRegion({ t: "rect", x: 2, y: 2, w: 4, h: 3 });
  s.floatUpdate({ dx: 10, dy: 5 });
  assert.ok(s.floatCommit(1300));
  assert.equal(s.bitmap.get(3, 3), WHITE, "la source est effacée");
  assert.equal(s.bitmap.get(13, 8), BLACK, "le contenu est à la nouvelle place");
  // duplication
  s.selectRegion({ t: "rect", x: 12, y: 7, w: 4, h: 3 });
  s.floatUpdate({ dx: 10, dy: 0, copy: true });
  assert.ok(s.floatCommit(1400));
  assert.equal(s.bitmap.get(13, 8), BLACK);
  assert.equal(s.bitmap.get(23, 8), BLACK);
  // suppression
  s.selectRegion({ t: "rect", x: 22, y: 7, w: 6, h: 4 });
  assert.ok(s.deleteSelection(1500));
  assert.equal(s.bitmap.get(23, 8), WHITE);
  assert.ok(replayOf(s).equals(s.bitmap));
  // tout s'annule
  while (s.canUndo) s.undo(2000);
  assert.ok(new Bitmap(40, 30).equals(s.bitmap));
});

test("sélection : rotation 90° puis retournement, aller-retour exact", () => {
  const s = new DrawSession({ width: 30, height: 30, mode: "bw" });
  s.previewShape(shape({ shape: "line", size: 1 }), { x: 5, y: 5 }, { x: 12, y: 8 }, 1000);
  s.commitShape(1010);
  s.selectRegion({ t: "rect", x: 3, y: 3, w: 12, h: 8 });
  const orig = s.bitmap.clone();
  // 4 quarts de tour = identité
  s.floatUpdate({ m: [0, -1, 1, 0] });
  const q1 = s.bitmap.clone();
  assert.ok(!q1.equals(orig));
  s.floatUpdate({ m: [1, 0, 0, 1] });   // retour identité
  assert.ok(s.bitmap.equals(orig));
  s.floatCancel();
  assert.ok(s.bitmap.equals(orig));
});

test("baguette magique : sélectionne la zone de couleur unie, en global aussi", () => {
  const s = new DrawSession({ width: 30, height: 20, mode: "bw" });
  s.previewShape(shape({ shape: "rect", size: 1 }), { x: 2, y: 2 }, { x: 10, y: 10 }, 1000);
  s.commitShape(1010);
  const inner = s.selectRegion({ t: "wand", x: 5, y: 5, g: 0 });
  assert.deepEqual(inner, { x: 3, y: 3, w: 7, h: 7 });
  const outer = s.selectRegion({ t: "wand", x: 0, y: 0, g: 0 });
  assert.deepEqual(outer, { x: 0, y: 0, w: 30, h: 20 });
});

// ─── Texte, dégradé, formes ──────────────────────────────────────────────────

test("texte pixel : dimensions et accents", () => {
  assert.deepEqual(measureText("AB", 1), { w: 11, h: 7 });
  assert.deepEqual(measureText("A\nB", 2), { w: 10, h: 34 });
  const s = new DrawSession({ width: 80, height: 30, mode: "bw" });
  assert.ok(s.text({ x: 1, y: 4 }, "Été", 1000, textS()));
  assert.ok(replayOf(s).equals(s.bitmap));
});

test("dégradé tramé 1 bit : du noir au blanc, monotone, uniquement noir/blanc", () => {
  const s = new DrawSession({ width: 64, height: 16, mode: "bw" });
  assert.ok(s.gradientFill({ x: 0, y: 0 }, { x: 63, y: 0 }, 1000, gradS({ color: "#000000", color2: "#FFFFFF" })));
  const dark = (x0: number, x1: number) => { let n = 0; for (let y = 0; y < 16; y++) for (let x = x0; x < x1; x++) if (s.bitmap.get(x, y) === BLACK) n++; return n; };
  assert.ok(dark(0, 16) > dark(16, 32) && dark(16, 32) > dark(32, 48) && dark(32, 48) > dark(48, 64));
  for (const c of s.bitmap.data) assert.ok(c === BLACK || c === WHITE);
  assert.ok(replayOf(s).equals(s.bitmap));
});

test("formes : rectangle plein, contour d'épaisseur 2, ellipse pleine", () => {
  const s = new DrawSession({ width: 30, height: 30, mode: "bw" });
  s.previewShape(shape({ shape: "rect", size: 2 }), { x: 2, y: 2 }, { x: 11, y: 9 }, 1000);
  s.commitShape(1010);
  assert.equal(s.bitmap.get(2, 2), BLACK);
  assert.equal(s.bitmap.get(3, 3), BLACK);   // 2 px d'épaisseur
  assert.equal(s.bitmap.get(4, 4), WHITE);   // intérieur
  s.previewShape(shape({ shape: "ellipse", fill: true }), { x: 14, y: 2 }, { x: 25, y: 13 }, 1100);
  s.commitShape(1110);
  assert.equal(s.bitmap.get(19, 7), BLACK);
  assert.equal(s.bitmap.get(14, 2), WHITE);  // coin du rectangle englobant hors de l'ellipse
});

test("aperçu de forme : le glissé ne laisse aucune trace, seule la validation compte", () => {
  const s = new DrawSession({ width: 30, height: 30, mode: "bw" });
  const blank = s.bitmap.clone();
  for (let x = 3; x < 25; x += 3) s.previewShape(shape({ shape: "line" }), { x: 1, y: 1 }, { x, y: 20 }, 1000 + x);
  s.cancelShape();
  assert.ok(s.bitmap.equals(blank));
  assert.equal(s.getActions().length, 0);
});

// ─── Score ───────────────────────────────────────────────────────────────────

const A = (kind: ActionEvent["kind"], extra: Partial<ActionEvent> = {}): ActionEvent => ({ kind, t: 0, ...extra });

test("score : les anciennes séquences (sans v:2) gardent EXACTEMENT les règles historiques", () => {
  const legacy: ActionEvent[] = [A("stroke"), A("stroke"), A("erase"), A("fill"), A("undo"), A("redo"), A("clear"), A("shape"), A("stroke"), A("undo"), A("undo"), A("move")];
  assert.equal(scoreActions(legacy), scoreFromActions(legacy));
  const tl = scoreTimeline(legacy);
  assert.equal(tl[tl.length - 1], scoreFromActions(legacy));
  for (let n = 1; n <= legacy.length; n++) assert.equal(tl[n - 1], scoreFromActions(legacy.slice(0, n)), `préfixe ${n}`);
});

test("score v2 : +1 par geste effectif, gomme et gestes sans effet à 0", () => {
  const seq: ActionEvent[] = [A("stroke", { v: 2, n: 5 }), A("stroke", { n: 0 }), A("erase", { n: 9 }), A("fill", { n: 40 }), A("shape", { n: 12 }), A("text", { n: 30 })];
  assert.equal(scoreActions(seq), 4);
});

test("score v2 : annuler retire les points du geste annulé, rétablir les rend, redo neutre sinon", () => {
  const seq: ActionEvent[] = [A("stroke", { v: 2, n: 5 }), A("erase", { n: 3 }), A("stroke", { n: 5 }), A("undo"), A("undo")];
  assert.equal(scoreActions(seq), 1);          // annule un trait puis la gomme : reste 1
  assert.equal(scoreActions([...seq, A("redo")]), 1);   // rétablit la gomme (0 point)
  assert.equal(scoreActions([...seq, A("redo"), A("redo")]), 2);
  assert.equal(scoreActions([...seq, A("stroke", { n: 2 }), A("redo")]), 2);  // un nouveau geste vide la pile "rétablir"
});

test("score v2 : effacer tout remet à zéro, l'annuler restaure", () => {
  const seq: ActionEvent[] = [A("stroke", { v: 2, n: 5 }), A("stroke", { n: 5 }), A("clear", { n: 100 }), A("stroke", { n: 1 })];
  assert.equal(scoreActions(seq), 1);
  assert.equal(scoreActions([...seq, A("undo"), A("undo")]), 2);   // annule le trait puis le clear
});

test("score v2 : les déplacements sont plafonnés à la moitié des gestes de dessin (anti-gonflage)", () => {
  const moves = Array.from({ length: 50 }, () => A("transform", { n: 10 }));
  const seq: ActionEvent[] = [A("stroke", { v: 2, n: 5 }), A("stroke", { n: 5 }), A("stroke", { n: 5 }), A("stroke", { n: 5 }), ...moves];
  assert.equal(scoreActions(seq), 4 + 2);   // 4 traits + crédit max floor(4/2)=2
  const only: ActionEvent[] = [A("stroke", { v: 2, n: 5 }), ...moves];
  assert.equal(scoreActions(only), 1);      // 1 geste → 0 crédit de déplacement
});

test("session : le score en direct suit les règles v2 (undo/redo/clear/déplacement)", () => {
  const s = new DrawSession({ width: 40, height: 30, mode: "bw" });
  drawStroke(s, 1, [[2, 2], [30, 20]], 1000, stroke());
  drawStroke(s, 1, [[2, 20], [30, 2]], 2000, stroke());
  assert.equal(s.score, 2);
  s.undo(3000);
  assert.equal(s.score, 1);
  s.redo(3100);
  assert.equal(s.score, 2);
  s.clear(3200);
  assert.equal(s.score, 0);
  s.undo(3300);
  assert.equal(s.score, 2);
  assert.equal(scoreActions(s.getActions()), s.score);
});

test("profil de savoir-faire : succès débloqués depuis le journal", () => {
  const seq: ActionEvent[] = [
    A("stroke", { v: 2, tool: "brush", n: 5 }), A("shape", { tool: "rect", n: 5 }), A("fill", { tool: "fill", n: 5, tx: "b50" }),
    A("fill", { tool: "gradient", n: 5 }), A("stroke", { tool: "brush", n: 3, sy: "v" }), A("transform", { tool: "select", n: 3 }),
    A("text", { tool: "text", n: 4 }), A("stroke", { tool: "brush", n: 5, br: "c:3x3:AA==" }),
  ];
  const p = craftProfile(seq);
  for (const id of ["first", "shapes", "fill", "texture", "symmetry", "gradient", "select", "text", "custom", "variety"]) {
    assert.ok(p.achievements.includes(id), id);
  }
});

test("podHints (client) == analyzeReplay (serveur) sur des replays réels du moteur", () => {
  for (const mode of ["bw", "bwr", "rgb565"] as const) {
    for (let seed = 1; seed <= 6; seed++) {
      const s = randomSequence(seed * 271, mode, 40, 64, 48, () => {});
      const replay = s.getReplay();
      const a = analyzeReplay(replay, 64, 48, s.getActions());
      const h = podHints(replay, 64, 48);
      assert.equal(h.sessionMs, a.sessionDurationMs);
      assert.equal(h.strokes, a.strokeCount);
      assert.equal(h.coverage, a.gridCoverage);
      assert.equal(h.automationRatio, a.automationRatio);
      assert.equal(h.colors, a.colorCount);
    }
  }
});

test("texte : chaque caractère supporté produit des pixels, les inconnus un carré de repli", () => {
  for (const ch of "AZaz09!?.,:;-+éèêàùçÉÀÇîïôöûüÿ♥★°€…«»☺") {
    const s = new DrawSession({ width: 20, height: 20, mode: "bw" });
    assert.ok(s.text({ x: 4, y: 6 }, ch, 1000, textS()), `caractère « ${ch} » sans pixel`);
  }
  const s = new DrawSession({ width: 20, height: 20, mode: "bw" });
  assert.ok(s.text({ x: 4, y: 4 }, "中", 1000, textS()));   // caractère inconnu → repli
  const blank = new DrawSession({ width: 20, height: 20, mode: "bw" });
  assert.equal(blank.text({ x: 4, y: 4 }, "   ", 1000, textS()), false);   // des espaces ne changent rien
});

test("un replay sans marqueur v:2 n'est jamais pris pour un replay du moteur v2", async () => {
  const { isReplayV2 } = await import("@/lib/drawEngine");
  const legacy = [{ kind: "down", t: 0, x: 1, y: 1, tool: "brush", color: "#000000", size: 2, id: 1 }, { kind: "up", t: 90, x: 1, y: 1, id: 1, tool: "brush" }] as never[];
  assert.equal(isReplayV2(legacy), false);
  const s = new DrawSession({ width: 30, height: 30, mode: "bw" });
  drawStroke(s, 1, [[2, 2], [20, 20]], 1000, stroke());
  assert.equal(isReplayV2(s.getReplay()), true);
});
