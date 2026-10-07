import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { CLIP, decodeClip } from "../lib/bench/clip";
import { ANIM_RULE_CODES, ANIM_V3, analyzeClip, animRejectIsObjective, animRootOf, animVoteMessage, evaluateAnimRules, frameLeaf, frameMetrics, animVoteShapeOk, parseAnimVoteMessage, type AnimVote } from "../lib/animV3";
import { metricsFromRaw } from "../lib/podMetrics";
import { blockCanonicalV2, blockHashV2, merkleRoot, parseVoteMessageV3, sha256Hex, voteMessageV3, type BlockCanonicalV2 } from "../lib/podProtocolV3";
import { blankFrame, buildAnimClips, buildAnimVectors, enc, fixCrc } from "./helpers/animV3Vectors";

// Lot 6B-1 — RÉFÉRENCE PURE « pod-anim-v3 » (docs/SPEC_PODANIM_V3.md, R2) : décodage, empreintes, métriques par image, feuilles, racines, règles A1, message de vote propre, rulesVersion variable.
// Ni route, ni Redis, ni firmware. Le noyau C++ est vérifié séparément (tests/animV3Core.test.ts).
const root = path.join(__dirname, "..");
const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8").replace(/\r\n/g, "\n");
const sha = (d: string | Uint8Array) => createHash("sha256").update(d).digest("hex");

const DEV = "dev_AB12CD34", CAND = "123e4567-e89b-42d3-a456-426614174000", H = (c: string) => c.repeat(64);
const vote = (over: Partial<AnimVote> = {}): AnimVote => ({
  deviceId: DEV, candidateId: CAND, parentHash: H("a"), metricsVersion: 2, rulesVersion: 2, clipHash: H("b"), animRoot: H("c"), saltedHash: H("d"),
  frames: 12, E: 523_000, T: 311_000, R: 410_000, S: 460_000, verdict: "accept", ruleCode: "ok", vclass: "C0", ...over,
});

test("vecteurs : le fichier commité est EXACTEMENT ce que produit la référence TypeScript ; au moins 200 clips, toutes les familles de cas présentes", () => {
  const { vectorsTxt, clips } = buildAnimVectors();
  assert.equal(read("consensus-pod/test-vectors/anim-vectors.txt"), vectorsTxt, "régénérer : node --import tsx scripts/gen-anim-v3-vectors.ts");
  assert.ok(clips.length >= 200, `${clips.length} clips`);
  const kinds = new Map<string, number>(); for (const c of clips) { const a = analyzeClip(c.bin); const k = a.formatOk ? a.ruleCode : "format"; kinds.set(k, (kinds.get(k) ?? 0) + 1); }
  for (const [k, min] of [["ok", 8], ["static", 8], ["noise", 5], ["format", 8]] as const) assert.ok((kinds.get(k) ?? 0) >= min, `${k} : ${kinds.get(k)}`);
  const names = clips.map((c) => c.name).join(" ");
  for (const frag of ["n2", "n64", "statique-vide", "statique-plein", "alternance-nb", "damier", "run-255", "run-256", "délais-20ms", "délais-2550ms", "crc-faux", "retour-≠-image-0", "tronqué-", "mutation-", "durée-122s", "boucles-1", "couleurs-égales", "image-unique"]) assert.ok(names.includes(frag), frag);
  for (const cmd of ["aclip", "aleaf", "amerkle", "aroot", "arule", "avote", "ablock", "ablockbad"]) assert.match(vectorsTxt, new RegExp(`^${cmd} `, "m"), cmd);
  for (let n = 1; n <= 64; n++) assert.match(vectorsTxt, new RegExp(`^amerkle ${n} [0-9a-f]{64}$`, "m"), `Merkle N=${n}`);
});

test("analyzeClip est TOTALE : aucun clip du jeu, aucun octet aléatoire, aucune troncature ne la fait lever", () => {
  for (const c of buildAnimClips()) assert.doesNotThrow(() => analyzeClip(c.bin), c.name);
  let seed = 7; const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let i = 0; i < 300; i++) assert.doesNotThrow(() => analyzeClip(Uint8Array.from({ length: Math.floor(rnd() * 3000) }, () => Math.floor(rnd() * 256))));
  const valid = enc([sceneOf(1), sceneOf(2), sceneOf(3)], [100, 100, 100]);
  for (let cut = 0; cut < valid.length; cut += 37) { const a = analyzeClip(valid.slice(0, cut)); assert.equal(a.formatOk, false); assert.equal(a.ruleCode, "format"); assert.equal(a.clipHash, sha(valid.slice(0, cut)), "le hash porte sur les octets LUS"); }
});

function sceneOf(seed: number): Uint8Array { const f = blankFrame(); for (let y = 0; y < 12; y++) for (let x = 0; x < 10 + seed * 6; x++) { const i = (y + seed * 5) * CLIP.ROW_BYTES + ((x + seed * 3) >> 3); f[i % 1024] |= 0x80 >> ((x + seed * 3) & 7); } return f; }

test("T3 — équivalence de mise en page : les métriques d'une image PBC1 (lignes) = pod-metrics-2 de l'écran oled096 (pages) sur la même image", () => {
  let compared = 0;
  for (const c of buildAnimClips().filter((x) => x.name.startsWith("scène-") || x.name.startsWith("damier") || x.name.startsWith("aléatoire")).slice(0, 40)) {
    const clip = decodeClip(c.bin);
    for (const f of clip.frames.slice(0, 4)) {
      const pages = new Uint8Array(1024);
      for (let y = 0; y < CLIP.H; y++) for (let x = 0; x < CLIP.W; x++) if ((f[y * 16 + (x >> 3)] >> (7 - (x & 7))) & 1) pages[(y >> 3) * CLIP.W + x] |= 1 << (y & 7);
      const oled = metricsFromRaw("oled096", pages), mine = frameMetrics(f);
      assert.deepEqual({ e: mine.e, t: mine.t, r: mine.r, s: mine.s }, { e: oled.e, t: oled.t, r: oled.r, s: oled.s }, c.name);
      compared++;
    }
  }
  assert.ok(compared >= 60, String(compared));
});

test("engagements : feuille (46 octets), racine des images, racine d'animation, agrégats entiers et affiche recalculés INDÉPENDAMMENT", () => {
  const f = [sceneOf(1), sceneOf(2), sceneOf(3), sceneOf(2), sceneOf(1)], delays = [100, 130, 70, 2550, 20];
  const bin = enc(f, delays, 0xf800, 0x07e0), a = analyzeClip(bin);
  assert.equal(a.formatOk, true); assert.equal(a.N, 5); assert.equal(a.loops, 0); assert.equal(a.fg, 0xf800); assert.equal(a.bg, 0x07e0);
  assert.equal(a.clipHash, sha(bin));
  const leaves = a.frames.map((fr, i) => {
    assert.equal(fr.hash, sha(f[i])); assert.equal(fr.delayUnits, delays[i] / 10);
    const b = Buffer.alloc(46); b[0] = 0x02; Buffer.from(fr.hash, "hex").copy(b, 1); b.writeUInt32BE(fr.e, 33); b.writeUInt32BE(fr.t, 37); b.writeUInt32BE(fr.r, 41); b[45] = fr.delayUnits;
    assert.equal(b.length, 46); assert.equal(fr.leaf, sha(b)); assert.equal(frameLeaf(fr.hash, fr.e, fr.t, fr.r, fr.delayUnits).toString("hex"), fr.leaf);
    return Buffer.from(fr.leaf, "hex");
  });
  assert.equal(a.framesRoot, merkleRoot(leaves));
  assert.equal(a.animRoot, sha(`pod-anim-v3|pbc1|${a.clipHash}|${a.framesRoot}|5|0|${0xf800}|${0x07e0}`));
  assert.equal(a.animRoot, animRootOf(a.clipHash, a.framesRoot, 5, 0, 0xf800, 0x07e0));
  const mean = (k: "e" | "t" | "r" | "s") => Math.floor(a.frames.reduce((x, fr) => x + fr[k], 0) / 5);
  assert.deepEqual({ E: a.E, T: a.T, R: a.R, S: a.S }, { E: mean("e"), T: mean("t"), R: mean("r"), S: mean("s") });
  let best = 0; a.frames.forEach((fr, i) => { if (fr.s > a.frames[best].s) best = i; }); assert.equal(a.posterIndex, best, "premier indice maximisant s_i");
  for (const fr of a.frames) assert.equal(fr.s, Math.min(1_000_000, Math.floor((4 * fr.e + 4 * fr.t + 2 * fr.r) / 10)));
  assert.throws(() => frameLeaf("zz", 0, 0, 0, 10)); assert.throws(() => frameLeaf(H("a"), 0, 0, 0, 1)); assert.throws(() => frameLeaf(H("a"), 0, 0, 0, 256)); assert.throws(() => frameLeaf(H("a"), 1_000_001, 0, 0, 10));
});

test("la racine de Merkle des images ne duplique JAMAIS le dernier nœud (N impair : nœud promu), pour tout N de 2 à 64", () => {
  const leaf = (i: number) => createHash("sha256").update(`anim-leaf-${i}`).digest();
  assert.notEqual(merkleRoot([leaf(0), leaf(1), leaf(2)]), merkleRoot([leaf(0), leaf(1), leaf(2), leaf(2)]));
  const roots = new Set<string>();
  for (let n = 2; n <= 64; n++) roots.add(merkleRoot(Array.from({ length: n }, (_, i) => leaf(i))));
  assert.equal(roots.size, 63, "63 racines distinctes pour 63 tailles");
});

test("règles A1 : static (images identiques) rejeté ; ALTERNANCE noir/blanc d'images uniformes ACCEPTÉE ; damier alterné = bruit ; images aléatoires ≠ bruit (T ≈ 50 %) ; pas de règle « uniform »", () => {
  const stat = analyzeClip(enc([sceneOf(1), sceneOf(1), sceneOf(1)], [100, 100, 100]));
  assert.equal(stat.ruleCode, "static"); assert.equal(stat.allIdentical, true);
  assert.equal(analyzeClip(enc([blankFrame(), blankFrame()], [100, 100])).ruleCode, "static", "tout vide et fixe = statique, pas « uniform »");
  const alt = analyzeClip(enc([blankFrame(), new Uint8Array(1024).fill(0xff), blankFrame()], [100, 100, 100]));
  assert.equal(alt.ruleCode, "ok"); assert.equal(alt.E, 0); assert.equal(alt.T, 0); assert.equal(alt.allIdentical, false);
  const checker = (p: number) => { const f = blankFrame(); for (let y = 0; y < 64; y++) for (let x = 0; x < 128; x++) if ((x + y + p) & 1) f[y * 16 + (x >> 3)] |= 0x80 >> (x & 7); return f; };
  const noise = analyzeClip(enc([checker(0), checker(1)], [100, 100]));
  assert.equal(noise.ruleCode, "noise"); assert.ok(noise.E > 980_000 && noise.T > 900_000);
  let s = 3; const rb = () => Uint8Array.from({ length: 1024 }, () => (s = (s * 1664525 + 1013904223) >>> 0) >>> 24);
  const rnd = analyzeClip(enc([rb(), rb()], [100, 100]));
  assert.equal(rnd.formatOk, true); assert.equal(rnd.ruleCode, "ok"); assert.ok(rnd.T < 900_000);
  assert.ok(!ANIM_RULE_CODES.includes("uniform" as never));
  // priorité figée : format → hash → static → noise → ok
  assert.deepEqual(evaluateAnimRules({ formatOk: false, hashOk: false, allIdentical: true, E: 1_000_000, T: 1_000_000 }), { verdict: "reject", ruleCode: "format" });
  assert.deepEqual(evaluateAnimRules({ formatOk: true, hashOk: false, allIdentical: true, E: 1_000_000, T: 1_000_000 }), { verdict: "reject", ruleCode: "hash" });
  assert.deepEqual(evaluateAnimRules({ formatOk: true, hashOk: true, allIdentical: true, E: 1_000_000, T: 1_000_000 }), { verdict: "reject", ruleCode: "static" });
  assert.deepEqual(evaluateAnimRules({ formatOk: true, hashOk: true, allIdentical: false, E: 980_001, T: 900_001 }), { verdict: "reject", ruleCode: "noise" });
  assert.deepEqual(evaluateAnimRules({ formatOk: true, hashOk: true, allIdentical: false, E: 980_000, T: 900_001 }), { verdict: "accept", ruleCode: "ok" }, "bornes strictes");
  assert.deepEqual(evaluateAnimRules({ formatOk: true, hashOk: true, allIdentical: false, E: 980_001, T: 900_000 }), { verdict: "accept", ruleCode: "ok" }, "bornes strictes");
});

test("format A1 : n = 1, couleurs égales, boucles ≠ 0, CRC, magie, tailles, retour ≠ image 0, délais, durée > 120 s, > 9 216 octets → « format » (jamais une exception)", () => {
  const names = new Map(buildAnimClips().map((c) => [c.name, c.bin]));
  for (const n of ["image-unique-n1", "couleurs-égales", "boucles-1", "boucles-100", "crc-faux", "crc-faux-corps", "magie-X", "version-2", "largeur-64", "hauteur-32", "drapeaux-1", "réservé-1", "n-0", "n-65", "transitions-n-1", "corps-plus-un",
    "corps-moins-un", "octet-en-trop-après-crc", "octets-en-trop-avant-crc", "retour-délai-≠-délai-0", "délai-0-à-1", "délai-0-à-0", "délai-transition-à-1", "run-longueur-0", "trop-gros-9217", "durée-122s-n48", "vide", "un-octet", "alternance-nb-n8"]) {
    const a = analyzeClip(names.get(n)!); assert.equal(a.formatOk, false, n); assert.equal(a.ruleCode, "format", n); assert.ok(a.reason, n);
  }
  assert.equal(analyzeClip(names.get("délais-2550ms-n47-limite")!).formatOk, true, "47 × 2550 ms = 119,85 s : accepté");
  assert.equal(analyzeClip(names.get("alternance-nb-n7")!).formatOk, true, "7 alternances noir/blanc tiennent dans 9 216 octets");
});

test("T4 — toute modification est détectée : chaque octet isolé (CRC) ; avec CRC corrigée, le hash ET la racine changent ; image, délai, ordre, couleur, N, boucles", () => {
  const small = enc([sceneOf(1), sceneOf(2)], [100, 130], 0xf800, 0x07e0), ref = analyzeClip(small);
  assert.equal(ref.formatOk, true);
  for (let i = 0; i < small.length; i++) {
    const o = Uint8Array.from(small); o[i] ^= 0x01;
    const raw = analyzeClip(o); assert.equal(raw.formatOk, false, `octet ${i} : un seul octet altéré doit casser la CRC`);
    if (i >= small.length - 4) continue;   // les 4 derniers octets SONT la CRC : la corriger rétablit le clip d'origine
    const fixed = analyzeClip(fixCrc(o)); assert.notEqual(fixed.clipHash, ref.clipHash, `octet ${i}`);
    assert.ok(!(fixed.formatOk && fixed.animRoot === ref.animRoot), `octet ${i} : même racine avec un clip différent`);
  }
  const f = [sceneOf(1), sceneOf(2), sceneOf(3)], d = [100, 100, 100], base = analyzeClip(enc(f, d, 0xf800, 0x07e0));
  const variants: Record<string, ReturnType<typeof analyzeClip>> = {
    délai: analyzeClip(enc(f, [100, 110, 100], 0xf800, 0x07e0)),
    ordre: analyzeClip(enc([f[0], f[2], f[1]], d, 0xf800, 0x07e0)),
    couleurFg: analyzeClip(enc(f, d, 0xf801, 0x07e0)),
    couleurBg: analyzeClip(enc(f, d, 0xf800, 0x07e1)),
    imageAjoutée: analyzeClip(enc([...f, sceneOf(4)], [...d, 100], 0xf800, 0x07e0)),
    pixel: analyzeClip(enc([f[0], (() => { const g = Uint8Array.from(f[1]); g[5] ^= 0x10; return g; })(), f[2]], d, 0xf800, 0x07e0)),
  };
  for (const [k, v] of Object.entries(variants)) { assert.equal(v.formatOk, true, k); assert.notEqual(v.animRoot, base.animRoot, k); assert.notEqual(v.clipHash, base.clipHash, k); }
  assert.notEqual(variants.délai.framesRoot, base.framesRoot, "le délai de chaque image est dans sa feuille");
  assert.notEqual(variants.ordre.framesRoot, base.framesRoot);
  assert.equal(variants.couleurFg.framesRoot, base.framesRoot, "les couleurs ne changent pas les images (1 bit) mais changent animRoot");
  assert.equal(analyzeClip(enc(f, d, 0xf800, 0x07e0, 1)).formatOk, false, "boucles ≠ 0 : format");
});

test("message de vote d'animation : domaine PROPRE, 17 éléments, forme canonique stricte, S signé ; aller-retour pour chaque motif ; rejet des formes douteuses", () => {
  for (const [ruleCode, verdict] of [["ok", "accept"], ["static", "reject"], ["noise", "reject"], ["rules", "reject"]] as const) {
    const v = vote({ ruleCode, verdict }), m = animVoteMessage(v);
    assert.equal(m.split("|").length, 17); assert.ok(m.startsWith("pod-vote-v3-anim|")); assert.deepEqual(parseAnimVoteMessage(m), v);
  }
  assert.ok(animVoteMessage(vote()).includes("|460000|accept|ok|C0"), "S est dans le message signé");
  const zero = { E: 0, T: 0, R: 0, S: 0 };
  assert.deepEqual(parseAnimVoteMessage(animVoteMessage(vote({ ...zero, verdict: "reject", ruleCode: "hash" }))), vote({ ...zero, verdict: "reject", ruleCode: "hash" }));
  assert.deepEqual(parseAnimVoteMessage(animVoteMessage(vote({ ...zero, frames: 0, verdict: "reject", ruleCode: "format" })))?.frames, 0, "frames = 0 : rejet `format` d'un clip illisible");
  // 6B1-FIX1 : `format` ⇒ TOUJOURS frames = 0 et E = T = R = S = 0 (représentation unique) ; `hash` ⇒ clip lisible, frames 2..64
  assert.equal(parseAnimVoteMessage(animVoteMessage(vote({ ...zero, frames: 5, verdict: "reject", ruleCode: "format" }))), null, "format avec N déclaré : non canonique");
  assert.equal(parseAnimVoteMessage(animVoteMessage(vote({ ...zero, frames: 0, S: 1, verdict: "reject", ruleCode: "format" }))), null);
  assert.equal(parseAnimVoteMessage(animVoteMessage(vote({ ...zero, frames: 2, verdict: "reject", ruleCode: "hash" })))?.frames, 2);
  assert.equal(parseAnimVoteMessage(animVoteMessage(vote({ ...zero, frames: 64, verdict: "reject", ruleCode: "hash" })))?.frames, 64);
  const bad = (v: Partial<AnimVote>) => assert.equal(parseAnimVoteMessage(animVoteMessage(vote(v))), null, JSON.stringify(v));
  bad({ frames: 0 });                                                             // accept avec frames = 0
  bad({ frames: 0, verdict: "reject", ruleCode: "static" }); bad({ frames: 0, ...zero, verdict: "reject", ruleCode: "hash" }); bad({ frames: 0, verdict: "reject", ruleCode: "noise" });
  bad({ frames: 1 }); bad({ frames: 65 }); bad({ frames: -1 });
  bad({ ...zero, E: 5, verdict: "reject", ruleCode: "format", frames: 0 }); bad({ E: 1, T: 0, R: 0, S: 0, verdict: "reject", ruleCode: "hash" });
  bad({ rulesVersion: 1 }); bad({ rulesVersion: 3 }); bad({ metricsVersion: 1 }); bad({ metricsVersion: 3 });
  bad({ ruleCode: "uniform" as never, verdict: "reject" }); bad({ verdict: "accept", ruleCode: "static" }); bad({ verdict: "reject", ruleCode: "ok" });
  bad({ E: 1_000_001 }); bad({ S: -1 }); bad({ T: 1.5 }); bad({ vclass: "C3" as never });
  bad({ clipHash: "B".repeat(64) }); bad({ animRoot: H("c").slice(1) }); bad({ saltedHash: "g".repeat(64) }); bad({ deviceId: "dev_abc" }); bad({ candidateId: CAND.toUpperCase() });
  const ok = animVoteMessage(vote());
  for (const m of [ok.replace("|12|", "|012|"), ok.replace("|C0", "|C0|"), ` ${ok}`, `${ok} `, ok.replace("|accept|", "| accept|"), ok.split("|").slice(0, 16).join("|"), `${ok}|x`, ok.replace("pod-vote-v3-anim", "pod-vote-v3-anim ")]) assert.equal(parseAnimVoteMessage(m), null, m);
  assert.equal(parseAnimVoteMessage(""), null);
});

test("6B1-FIX1 — UN rejet = UN message : la table (format | hash | autres) est appliquée par le parseur ET par `animVoteShapeOk` ; les vecteurs « avotebad » sont tous refusés côté TypeScript", () => {
  const z = { E: 0, T: 0, R: 0, S: 0 };
  for (const [ruleCode, frames, zero, expected] of [
    ["format", 0, true, true], ["format", 2, true, false], ["format", 64, true, false], ["format", 0, false, false],
    ["hash", 0, true, false], ["hash", 1, true, false], ["hash", 2, true, true], ["hash", 64, true, true], ["hash", 65, true, false], ["hash", 8, false, false],
    ["static", 0, false, false], ["static", 2, false, true], ["noise", 64, false, true], ["noise", 65, false, false], ["ok", 1, false, false], ["ok", 12, false, true], ["rules", 0, false, false], ["rules", 12, false, true],
  ] as const) {
    const base = zero ? z : { E: 5, T: 6, R: 7, S: 8 };
    assert.equal(animVoteShapeOk({ ruleCode, frames, ...base }), expected, `${ruleCode} frames=${frames} zero=${zero}`);
    const v = vote({ ruleCode, frames, ...base, verdict: ruleCode === "ok" ? "accept" : "reject" });
    assert.equal(parseAnimVoteMessage(animVoteMessage(v)) !== null, expected, `parse ${ruleCode} frames=${frames} zero=${zero}`);
  }
  // l'analyse de référence produit déjà la forme canonique : N = 0 et métriques nulles pour tout échec de format
  const a = analyzeClip(new Uint8Array(10)); assert.equal(a.N, 0); assert.deepEqual([a.E, a.T, a.R, a.S], [0, 0, 0, 0]);
  const bads = read("consensus-pod/test-vectors/anim-vectors.txt").split("\n").filter((l) => l.startsWith("avotebad "));
  assert.ok(bads.length >= 20, String(bads.length));
  for (const l of bads) {
    const t = l.split(" "), rule = t[14];
    const msg = ["pod-vote-v3-anim", t[1], t[2], t[3], t[4], t[5], t[6], t[7], t[8], t[9], t[10], t[11], t[12], t[13], rule === "ok" ? "accept" : "reject", rule, t[15]].join("|");
    assert.equal(parseAnimVoteMessage(msg), null, l);
  }
});

test("DOMAINES SÉPARÉS : un message d'animation n'est pas lisible comme message d'image, et inversement", () => {
  const anim = animVoteMessage(vote());
  assert.equal(parseVoteMessageV3(anim), null);
  const still = voteMessageV3({ deviceId: DEV, candidateId: CAND, parentHash: H("a"), metricsVersion: 2, rulesVersion: 1, rawHash: H("b"), saltedHash: H("d"), e: 1, t: 2, r: 3, verdict: "accept", ruleCode: "ok", vclass: "C0" });
  assert.equal(parseAnimVoteMessage(still), null);
  assert.ok(still.startsWith("pod-vote-v3|") && !anim.startsWith("pod-vote-v3|"), "le premier élément diffère : « pod-vote-v3 » n'est pas un préfixe de « pod-vote-v3-anim| »");
  // un message d'image dont on a seulement changé le préfixe n'est pas non plus valide
  assert.equal(parseAnimVoteMessage(still.replace("pod-vote-v3|", "pod-vote-v3-anim|")), null);
  assert.equal(parseVoteMessageV3(anim.replace("pod-vote-v3-anim|", "pod-vote-v3|")), null);
});

test("refus d'animation : seuls `static`, `noise` et `format` sont objectifs ; `hash`, `rules` et toute valeur différente de la référence sont des litiges neutres", () => {
  const alt = analyzeClip(enc([sceneOf(1), sceneOf(1)], [100, 100])), good = analyzeClip(enc([sceneOf(1), sceneOf(2)], [100, 100])), bad = analyzeClip(new Uint8Array(10));
  const sig = (a: typeof alt) => ({ E: a.E, T: a.T, R: a.R, S: a.S });
  assert.equal(animRejectIsObjective({ ruleCode: "static", ...sig(alt) }, alt), true);
  assert.equal(animRejectIsObjective({ ruleCode: "static", ...sig(good) }, good), false, "refus « static » à tort");
  assert.equal(animRejectIsObjective({ ruleCode: "static", ...sig(alt), S: alt.S + 1 }, alt), false, "S différent de la référence");
  assert.equal(animRejectIsObjective({ ruleCode: "noise", ...sig(good) }, good), false);
  assert.equal(animRejectIsObjective({ ruleCode: "format", E: 0, T: 0, R: 0, S: 0 }, bad), true);
  assert.equal(animRejectIsObjective({ ruleCode: "format", E: 0, T: 0, R: 0, S: 0 }, good), false, "format refusé à tort");
  assert.equal(animRejectIsObjective({ ruleCode: "hash", E: 0, T: 0, R: 0, S: 0 }, good), false);
  assert.equal(animRejectIsObjective({ ruleCode: "rules", ...sig(good) }, good), false);
  assert.equal(animRejectIsObjective({ ruleCode: "static", E: 0, T: 0, R: 0, S: 0 }, bad), false);
});

test("rulesVersion VARIABLE par bloc : sans champ = 1 (hash historique INCHANGÉ), 2 pour une animation, valeur inconnue REFUSÉE", () => {
  const b: BlockCanonicalV2 = {
    parentHash: H("1"), imageHash: H("2"), actionsHash: H("3"), contentHash: H("4"), deviceId: DEV, poolScreen: "oled096", validatorProfileIds: ["art_b", "art_a"], scorePpm: 123456, minedAt: 1_700_000_000_000,
    votesRoot: H("5"), committeeMode: "quorum", committeeK: 3, committeeRoot: H("6"), minerRoot: H("7"),
  };
  assert.equal(blockCanonicalV2(b), blockCanonicalV2({ ...b, rulesVersion: 1 }), "absent ≡ 1 : un bloc sans le champ garde son texte canonique et son hash");
  assert.equal(blockHashV2(b), blockHashV2({ ...b, rulesVersion: 1 }));
  assert.ok(blockCanonicalV2(b).startsWith('{"blockVersion":2,"metricsVersion":2,"rulesVersion":1,"parentHash"'));
  const anim = blockCanonicalV2({ ...b, rulesVersion: 2, animRoot: H("4") });
  assert.ok(anim.startsWith('{"blockVersion":2,"metricsVersion":2,"rulesVersion":2,"parentHash"'));
  assert.notEqual(blockHashV2({ ...b, rulesVersion: 2 }), blockHashV2(b), "le jeu de règles est ENGAGÉ dans le hash");
  for (const rv of [0, 3, -1, 1.5, NaN]) assert.throws(() => blockCanonicalV2({ ...b, rulesVersion: rv }), /rulesVersion inconnue/, String(rv));
  // le bloc v2 d'une image fixe n'a pas bougé : mêmes vecteurs C++/TS qu'avant (la régression est aussi gardée par tests/consensusPodCore.test.ts)
  assert.match(read("consensus-pod/test-vectors/vectors.txt"), /"rulesVersion":1,/);
});

test("pureté : lib/animV3.ts n'importe ni Redis, ni réseau, ni route ; PÉRIMÈTRE EXACT des fichiers qui l'utilisent (liste blanche) : aucun firmware, aucune route de vote, de pull ou d'enregistrement", () => {
  const src = read("lib/animV3.ts").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  const imports = [...src.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]).sort();
  for (const i of imports) assert.ok(["@/lib/bench/clip", "@/lib/podMetrics", "@/lib/podProtocolV3"].includes(i), `import inattendu : ${i}`);
  for (const bad of [/redis/i, /fetch\(/, /NextResponse/, /process\.env/, /Math\.random/, /Date\.now/]) assert.doesNotMatch(src, bad, String(bad));
  const offenders: string[] = [];
  const walk = (dir: string) => { for (const e of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const rel = path.join(dir, e.name).replace(/\\/g, "/");
    if (e.isDirectory()) { if (!["node_modules", ".next", ".git", "firmware-backups", ".claude", "tests", "docs", "scripts"].includes(e.name)) walk(rel); }
    else if (/\.(ts|tsx|ino|h|cpp)$/.test(e.name) && /animV3|podAnimV3|pod-vote-v3-anim|ANIM_V3_MODE|clipTicket|clipPointer|candidate-clip|CLIP_TICKET_SECRET|animShadow|animReps|podVerifyAnim/.test(fs.readFileSync(path.join(root, rel), "utf8"))) offenders.push(rel);
  } };
  for (const d of ["app", "lib", "esp8266", "arduino_uno_r4", "consensus-pod"]) walk(d);
  // 6B-2 : référence, mode, ticket, réponse de route, shadow, représentants, vérificateur — et rien d'autre. Aucun firmware ; aucune route de vote/pull/registre/ACK ne les référence ;
  // seule la route de DÉPÔT du candidat journalise la référence en shadow, et seule la route candidate-clip sert le clip.
  assert.deepEqual(offenders.sort(), [
    "app/api/candidate-clip/route.ts", "app/api/submit-candidate/route.ts", "consensus-pod/host/anim_harness.cpp", "consensus-pod/src/podAnimV3.h",
    "lib/animClipResponse.ts", "lib/animReps.ts", "lib/animShadow.ts", "lib/animV3.ts", "lib/animV3Mode.ts", "lib/clipTicket.ts", "lib/podVerify.ts", "lib/podVerifyAnim.ts",
  ].sort());
  for (const f of ["app/api/pull/route.ts", "app/api/validate-candidate/route.ts", "app/api/validation-result/route.ts", "app/api/register/route.ts", "app/api/ack-frame/route.ts"]) assert.doesNotMatch(read(f), /clipTicket|clipPointer|candidate-clip|animV3/, `${f} ne distribue aucun ticket`);
  assert.equal(ANIM_V3.rulesVersion, 2);
});
