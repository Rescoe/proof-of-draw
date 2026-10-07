// tests/helpers/animV3Vectors.ts — construit les VECTEURS du noyau C++ « pod-anim-v3 » à partir de la référence TypeScript (lib/animV3.ts). Voir scripts/gen-anim-v3-vectors.ts.
// Écrit consensus-pod/test-vectors/anim-vectors.txt : une ligne = une vérification (jetons séparés par des espaces). Déterministe (générateur pseudo-aléatoire à graine fixe).
import { createHash } from "node:crypto";
import { CLIP, encodeClip, type ClipInput } from "../../lib/bench/clip";
import { crc32 } from "../../lib/scene/package";
import { ANIM_V3, analyzeClip, animRootOf, animVoteMessage, evaluateAnimRules, frameLeaf, type AnimRuleCode, type AnimVote } from "../../lib/animV3";
import { blockCanonicalV2, blockHashV2, merkleRoot, type BlockCanonicalV2, type VoteClass } from "../../lib/podProtocolV3";
import { mulberry32, shuffle } from "../../lib/podSim";

const sha = (d: string | Uint8Array) => createHash("sha256").update(d).digest("hex");
const hex = (b: Uint8Array) => Buffer.from(b).toString("hex");

// ─── Fabrication d'images et de clips ───────────────────────────────────────────────────────────────────────────────────────────────────────
export const blankFrame = () => new Uint8Array(CLIP.FRAME_BYTES);
const setPx = (f: Uint8Array, x: number, y: number, v: number) => { const i = y * CLIP.ROW_BYTES + (x >> 3), m = 0x80 >> (x & 7); if (v) f[i] |= m; else f[i] &= ~m; };
function rect(f: Uint8Array, x0: number, y0: number, w: number, h: number, v: number) { for (let y = y0; y < Math.min(CLIP.H, y0 + h); y++) for (let x = x0; x < Math.min(CLIP.W, x0 + w); x++) setPx(f, x, y, v); }
const randInt = (rng: () => number, a: number, b: number) => a + Math.floor(rng() * (b - a + 1));
const sceneFrame = (rng: () => number): Uint8Array => { const f = blankFrame(); for (let k = 0; k < randInt(rng, 2, 6); k++) rect(f, randInt(rng, 0, 120), randInt(rng, 0, 56), randInt(rng, 2, 40), randInt(rng, 2, 24), 1); return f; };
const evolve = (rng: () => number, prev: Uint8Array): Uint8Array => { const f = Uint8Array.from(prev); for (let k = 0; k < randInt(rng, 1, 2); k++) rect(f, randInt(rng, 0, 120), randInt(rng, 0, 60), randInt(rng, 2, 16), randInt(rng, 2, 8), rng() < 0.5 ? 1 : 0); return f; };
const checker = (phase: number): Uint8Array => { const f = blankFrame(); for (let y = 0; y < CLIP.H; y++) for (let x = 0; x < CLIP.W; x++) setPx(f, x, y, (x + y + phase) & 1); return f; };
const full = () => new Uint8Array(CLIP.FRAME_BYTES).fill(0xff);
const rgb = (rng: () => number) => Math.floor(rng() * 65536);

/** Clip valide encodé par la référence (loops = 0 par défaut : la boucle sans fin est imposée aux animations de bloc). */
export function enc(frames: Uint8Array[], delaysMs: number[], fg = 0xffff, bg = 0x0000, loops = 0): Uint8Array {
  const input: ClipInput = { frames, delaysMs, loops, fg, bg };
  return encodeClip(input);
}
export const fixCrc = (bin: Uint8Array): Uint8Array => { const o = Uint8Array.from(bin); if (o.length >= 4) new DataView(o.buffer).setUint32(o.length - 4, crc32(o.subarray(0, o.length - 4)), true); return o; };

/** Positions (clip VALIDE) : octet de délai de chaque étape, runs (en-tête, longueur, données). */
export function layout(bin: Uint8Array) {
  const le16 = (p: number) => bin[p] | (bin[p + 1] << 8);
  const n = le16(8); let p = 20; const delay0 = p; p += 1 + CLIP.FRAME_BYTES;
  const trans: { delayPos: number; runs: { hdr: number; len: number; data: number }[] }[] = [];
  for (let t = 1; t <= n; t++) {
    const delayPos = p, nr = le16(p + 1); p += 3; const runs: { hdr: number; len: number; data: number }[] = [];
    for (let r = 0; r < nr; r++) { runs.push({ hdr: p, len: bin[p + 2], data: p + 3 }); p += 3 + bin[p + 2]; }
    trans.push({ delayPos, runs });
  }
  return { n, delay0, trans, end: p };
}

export interface NamedClip { name: string; bin: Uint8Array }

/** Jeu de clips du différentiel TS ↔ C++ (≥ 200) : valides variés, statiques, alternances, bruit, runs de 255, délais extrêmes, invalides (format), mutations aléatoires. */
export function buildAnimClips(): NamedClip[] {
  const rng = mulberry32(20261008);
  const clips: NamedClip[] = [];
  const add = (name: string, bin: Uint8Array) => clips.push({ name, bin });
  const delaysFor = (n: number, lo = 20, hi = 2550) => { const cap = Math.min(hi, Math.floor(110_000 / n / 10) * 10); return Array.from({ length: n }, () => Math.max(lo, randInt(rng, lo / 10, cap / 10) * 10)); };

  // A. animations « de dessin » : 8 tailles imposées (2…64 images) puis tailles aléatoires
  const SIZES = [2, 3, 4, 5, 8, 16, 32, 64];
  for (let i = 0; i < 100; i++) {
    const n = i < SIZES.length ? SIZES[i] : randInt(rng, 2, 64);
    const frames: Uint8Array[] = [sceneFrame(rng)]; for (let k = 1; k < n; k++) frames.push(evolve(rng, frames[k - 1]));
    let fg = rgb(rng), bg = rgb(rng); if (fg === bg) bg ^= 1;
    add(`scène-${i}-n${n}`, enc(frames, delaysFor(n), fg, bg));
  }
  // B. statiques : toutes les images identiques (vide, plein, aléatoire)
  for (const n of [2, 3, 5, 17, 64]) for (const kind of ["vide", "plein", "scène"]) {
    const f = kind === "vide" ? blankFrame() : kind === "plein" ? full() : sceneFrame(rng);
    add(`statique-${kind}-n${n}`, enc(Array.from({ length: n }, () => Uint8Array.from(f)), delaysFor(n)));
  }
  // C. alternance noir ↔ blanc : images UNIFORMES qui diffèrent (acceptée) ; au-delà de 7 images le clip dépasse 9 216 octets (format)
  for (const n of [2, 3, 4, 5, 6, 7, 8, 10, 20]) add(`alternance-nb-n${n}`, enc(Array.from({ length: n }, (_, i) => (i % 2 ? full() : blankFrame())), delaysFor(n)));
  // D. bruit pur : damier dont la phase alterne (E = 10⁶, T = 10⁶) ; images aléatoires (E = 10⁶ mais T ≈ 5·10⁵ : PAS du bruit selon A1)
  for (const n of [2, 3, 4, 5, 6, 7]) add(`damier-n${n}`, enc(Array.from({ length: n }, (_, i) => checker(i & 1)), delaysFor(n)));
  for (const n of [2, 3, 4, 5, 6]) add(`aléatoire-n${n}`, enc(Array.from({ length: n }, () => Uint8Array.from({ length: CLIP.FRAME_BYTES }, () => Math.floor(rng() * 256))), delaysFor(n)));
  // E. bords des runs de 255 octets
  for (const L of [1, 254, 255, 256, 509, 510, 511, 1023, 1024]) for (const n of [2, 3]) {
    const frames: Uint8Array[] = [blankFrame()]; for (let k = 1; k < n; k++) { const f = Uint8Array.from(frames[k - 1]); for (let i = 0; i < L; i++) f[(i + 3 * k) % CLIP.FRAME_BYTES] ^= 0xff; frames.push(f); }
    add(`run-${L}-n${n}`, enc(frames, delaysFor(n)));
  }
  // F. délais extrêmes
  const two = (n: number) => Array.from({ length: n }, () => 20);
  add("délais-20ms-n2", enc([sceneFrame(rng), sceneFrame(rng)], two(2)));
  { const fr: Uint8Array[] = [sceneFrame(rng)]; for (let k = 1; k < 47; k++) fr.push(evolve(rng, fr[k - 1])); add("délais-2550ms-n47-limite", enc(fr, Array.from({ length: 47 }, () => 2550))); }
  { const fr: Uint8Array[] = [sceneFrame(rng)]; for (let k = 1; k < 48; k++) fr.push(evolve(rng, fr[k - 1])); const b = enc(fr, Array.from({ length: 48 }, () => 2000)); const L = layout(b); const o = Uint8Array.from(b); o[L.delay0] = 255; for (const t of L.trans) o[t.delayPos] = 255; add("durée-122s-n48", fixCrc(o)); }
  add("délais-mixtes-n3", enc([sceneFrame(rng), sceneFrame(rng), sceneFrame(rng)], [20, 2550, 130]));

  // G. clips INVALIDES (format) — chaque cas isole UNE cause
  const base = (() => { const fr: Uint8Array[] = [sceneFrame(rng)]; for (let k = 1; k < 6; k++) fr.push(evolve(rng, fr[k - 1])); return enc(fr, [100, 120, 140, 160, 180, 200], 0xf800, 0x07e0); })();
  const baseL = layout(base);
  const mod = (fn: (o: Uint8Array) => void, crc = true) => { const o = Uint8Array.from(base); fn(o); return crc ? fixCrc(o) : o; };
  add("image-unique-n1", enc([sceneFrame(rng)], [100]));
  add("couleurs-égales", enc([sceneFrame(rng), sceneFrame(rng)], [100, 100], 0x1234, 0x1234));
  add("boucles-1", enc([sceneFrame(rng), sceneFrame(rng)], [100, 100], 0xffff, 0, 1));
  add("boucles-100", enc([sceneFrame(rng), sceneFrame(rng)], [100, 100], 0xffff, 0, 100));
  add("crc-faux", mod((o) => { o[o.length - 1] ^= 0xff; }, false));
  add("crc-faux-corps", mod((o) => { o[500] ^= 0x01; }, false));
  add("magie-X", mod((o) => { o[0] = 0x58; }));
  add("magie-X-crc-faux", mod((o) => { o[0] = 0x58; }, false));
  add("version-2", mod((o) => { o[4] = 2; }));
  add("largeur-64", mod((o) => { o[5] = 64; }));
  add("hauteur-32", mod((o) => { o[6] = 32; }));
  add("drapeaux-1", mod((o) => { o[7] = 1; }));
  add("réservé-1", mod((o) => { o[11] = 1; }));
  add("n-0", mod((o) => { o[8] = 0; o[9] = 0; }));
  add("n-65", mod((o) => { o[8] = 65; }));
  add("transitions-n-1", mod((o) => { o[16] = o[16] - 1; }));
  add("corps-plus-un", mod((o) => { o[18] = (o[18] + 1) & 0xff; }));
  add("corps-moins-un", mod((o) => { o[18] = (o[18] - 1) & 0xff; }));
  for (const len of [0, 1, 19, 20, 23, 24, 100, 1044, 1045, 1046, base.length - 5, base.length - 4, base.length - 1]) add(`tronqué-${len}`, base.slice(0, len));
  add("octet-en-trop-après-crc", (() => { const o = new Uint8Array(base.length + 1); o.set(base); return o; })());
  add("octets-en-trop-avant-crc", (() => { const body = base.slice(0, base.length - 4), o = new Uint8Array(body.length + 3 + 4); o.set(body); o[18] = (body.length - 20 + 3) & 0xff; o[19] = (body.length - 20 + 3) >> 8; return fixCrc(o); })());
  add("retour-≠-image-0", mod((o) => { const r = baseL.trans[baseL.trans.length - 1].runs[0]; if (r) o[r.data] ^= 0xff; else o[baseL.trans[baseL.trans.length - 1].delayPos + 3] ^= 1; }));
  add("retour-délai-≠-délai-0", mod((o) => { o[baseL.trans[baseL.trans.length - 1].delayPos] = 99; }));
  add("délai-0-à-1", mod((o) => { o[baseL.delay0] = 1; }));
  add("délai-0-à-0", mod((o) => { o[baseL.delay0] = 0; }));
  add("délai-transition-à-1", mod((o) => { o[baseL.trans[2].delayPos] = 1; }));
  add("run-longueur-0", mod((o) => { const t = baseL.trans.find((x) => x.runs.length > 0)!; o[t.runs[0].hdr + 2] = 0; }));
  add("run-hors-image", mod((o) => { const t = baseL.trans.find((x) => x.runs.length > 0)!; o[t.runs[0].hdr] = 0xf8; o[t.runs[0].hdr + 1] = 0x03; }));
  add("trop-gros-9217", (() => { const fr = Array.from({ length: 10 }, () => Uint8Array.from({ length: CLIP.FRAME_BYTES }, () => Math.floor(rng() * 256))); return enc(fr, delaysFor(10)); })());
  add("vide", new Uint8Array(0));
  add("un-octet", Uint8Array.from([0x50]));

  // H. mutations aléatoires d'octets de clips valides (avec ou sans correction de la CRC) : les deux implémentations doivent s'accorder sur TOUT
  const seeds = clips.filter((c) => c.name.startsWith("scène-")).slice(0, 6);
  for (const s of seeds) for (let k = 0; k < 10; k++) {
    const o = Uint8Array.from(s.bin), pos = Math.floor(rng() * o.length); o[pos] ^= 1 + Math.floor(rng() * 255);
    add(`mutation-${s.name}-${k}-pos${pos}${k % 2 ? "-crc-corrigée" : ""}`, k % 2 ? fixCrc(o) : o);
  }
  return clips;
}

const VCLASS: VoteClass[] = ["C0", "C1", "C2"];

export function buildAnimVectors() {
  const rng = mulberry32(20261009);
  const L: string[] = [];
  const push = (...t: (string | number)[]) => L.push(t.join(" "));
  const h64 = () => sha(`a${rng()}${rng()}`);
  const dev = () => `dev_${Array.from({ length: 8 }, () => "ABCDEFGHJKLMNPQRSTUVWXYZ0123456789"[Math.floor(rng() * 34)]).join("")}`;
  const uuid = () => { const h = sha(`u${rng()}`); return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`; };
  push("#", "vecteurs du noyau pod-anim-v3 — générés par scripts/gen-anim-v3-vectors.ts à partir de lib/animV3.ts (NE PAS ÉDITER À LA MAIN)");

  // clips (≥ 200) : l'automate C++ lit le clip par morceaux irréguliers
  const clips = buildAnimClips();
  for (const c of clips) {
    const a = analyzeClip(c.bin), h = c.bin.length ? hex(c.bin) : "-";
    if (!a.formatOk) push("aclip", h, "format", "-", a.clipHash, "-", "-", "-", "-", "-", "-", "-", "-");
    else push("aclip", h, a.ruleCode, a.N, a.clipHash, a.framesRoot, a.animRoot, a.E, a.T, a.R, a.S, a.posterIndex, a.allIdentical ? 1 : 0);
  }
  // feuilles d'image
  for (let i = 0; i < 24; i++) {
    const fh = h64(), e = i === 0 ? 0 : Math.floor(rng() * 1_000_001), t = i === 1 ? 1_000_000 : Math.floor(rng() * 1_000_001), r = Math.floor(rng() * 1_000_001), d = i === 2 ? 2 : i === 3 ? 255 : randInt(rng, 2, 255);
    push("aleaf", fh, e, t, r, d, frameLeaf(fh, e, t, r, d).toString("hex"));
  }
  // Merkle des images : TOUS les nombres de feuilles de 1 à 64 (impairs compris : nœud promu, jamais dupliqué)
  for (let n = 1; n <= 64; n++) push("amerkle", n, merkleRoot(Array.from({ length: n }, (_, i) => createHash("sha256").update(`anim-leaf-${i}`).digest())));
  // racine d'animation
  for (let i = 0; i < 12; i++) { const ch = h64(), fr = h64(), n = 2 + (i % 63), loops = i % 2 ? 0 : randInt(rng, 0, 100), fg = rgb(rng), bg = rgb(rng); push("aroot", ch, fr, n, loops, fg, bg, animRootOf(ch, fr, n, loops, fg, bg)); }
  // règles A1
  for (const f of [1, 0]) for (const h of [1, 0]) for (const s of [0, 1]) for (const [E, T] of [[0, 0], [1_000_000, 1_000_000], [980_000, 1_000_000], [980_001, 900_000], [980_001, 900_001], [500_000, 500_000], [1_000_000, 0], [0, 1_000_000]]) {
    push("arule", f, h, s, E, T, evaluateAnimRules({ formatOk: !!f, hashOk: !!h, allIdentical: !!s, E, T }).ruleCode);
  }
  // message de vote d'animation
  const codes: AnimRuleCode[] = ["ok", "static", "noise", "format", "hash", "rules"];
  for (let i = 0; i < 18; i++) {
    const ruleCode = codes[i % codes.length], accept = ruleCode === "ok", noCalc = ruleCode === "format" || ruleCode === "hash";
    const v: AnimVote = {
      deviceId: dev(), candidateId: uuid(), parentHash: h64(), metricsVersion: 2, rulesVersion: 2, clipHash: h64(), animRoot: h64(), saltedHash: h64(),
      frames: ruleCode === "format" ? 0 : randInt(rng, 2, 64),   // `format` ⇒ TOUJOURS 0 ; tous les autres motifs ⇒ 2..64 (6B1-FIX1)
      E: noCalc ? 0 : Math.floor(rng() * 1_000_001), T: noCalc ? 0 : Math.floor(rng() * 1_000_001), R: noCalc ? 0 : Math.floor(rng() * 1_000_001), S: noCalc ? 0 : Math.floor(rng() * 1_000_001),
      verdict: accept ? "accept" : "reject", ruleCode, vclass: VCLASS[i % 3],
    };
    push("avote", v.deviceId, v.candidateId, v.parentHash, v.metricsVersion, v.rulesVersion, v.clipHash, v.animRoot, v.saltedHash, v.frames, v.E, v.T, v.R, v.S, v.ruleCode, v.vclass, animVoteMessage(v));
  }
  // messages NON canoniques : un même rejet n'a qu'UNE représentation valide (6B1-FIX1) — TS et C++ doivent tous deux refuser
  const bad: Array<Partial<AnimVote>> = [
    { verdict: "reject", ruleCode: "format", frames: 5, E: 0, T: 0, R: 0, S: 0 },      // format avec N déclaré
    { verdict: "reject", ruleCode: "format", frames: 2, E: 0, T: 0, R: 0, S: 0 },
    { verdict: "reject", ruleCode: "format", frames: 64, E: 0, T: 0, R: 0, S: 0 },
    { verdict: "reject", ruleCode: "format", frames: 0, E: 1, T: 0, R: 0, S: 0 },      // format avec métriques
    { verdict: "reject", ruleCode: "format", frames: 0, E: 0, T: 0, R: 0, S: 7 },
    { verdict: "reject", ruleCode: "hash", frames: 0, E: 0, T: 0, R: 0, S: 0 },        // hash avec N inconnu
    { verdict: "reject", ruleCode: "hash", frames: 1, E: 0, T: 0, R: 0, S: 0 },
    { verdict: "reject", ruleCode: "hash", frames: 65, E: 0, T: 0, R: 0, S: 0 },
    { verdict: "reject", ruleCode: "hash", frames: 8, E: 1, T: 0, R: 0, S: 0 },        // hash avec métriques
    { verdict: "reject", ruleCode: "static", frames: 0 }, { verdict: "reject", ruleCode: "noise", frames: 0 }, { verdict: "accept", ruleCode: "ok", frames: 0 }, { verdict: "reject", ruleCode: "rules", frames: 0 },
    { verdict: "accept", ruleCode: "ok", frames: 1 }, { verdict: "accept", ruleCode: "ok", frames: 65 },
    { verdict: "accept", ruleCode: "ok", frames: 10, E: 1_000_001 }, { verdict: "accept", ruleCode: "ok", frames: 10, S: 1_000_001 },
    { verdict: "accept", ruleCode: "ok", frames: 10, metricsVersion: 1 }, { verdict: "accept", ruleCode: "ok", frames: 10, metricsVersion: 3 },
    { verdict: "accept", ruleCode: "ok", frames: 10, rulesVersion: 1 }, { verdict: "accept", ruleCode: "ok", frames: 10, rulesVersion: 3 },
  ];
  for (const b of bad) {
    const v: AnimVote = { deviceId: dev(), candidateId: uuid(), parentHash: h64(), metricsVersion: 2, rulesVersion: 2, clipHash: h64(), animRoot: h64(), saltedHash: h64(), frames: 12, E: 5, T: 6, R: 7, S: 8, verdict: "accept", ruleCode: "ok", vclass: "C0", ...b };
    push("avotebad", v.deviceId, v.candidateId, v.parentHash, v.metricsVersion, v.rulesVersion, v.clipHash, v.animRoot, v.saltedHash, v.frames, v.E, v.T, v.R, v.S, v.ruleCode, v.vclass);
  }
  // bloc v2 : rulesVersion VARIABLE (1 = image fixe, 2 = animation) ; une valeur inconnue est refusée
  for (let i = 0; i < 12; i++) {
    const rv = (i % 2 ? 2 : 1) as 1 | 2, nv = Math.floor(rng() * 8), content = h64();
    const b: BlockCanonicalV2 = {
      parentHash: h64(), imageHash: h64(), actionsHash: h64(), contentHash: content, deviceId: dev(), poolScreen: (["oled096", "tft18", "tft28"])[i % 3],
      validatorProfileIds: shuffle(Array.from({ length: nv }, (_, k) => `art_${k}${sha(`ab${i}${k}`).slice(0, 5)}`), rng), scorePpm: Math.floor(rng() * 1_000_001), minedAt: 1_700_000_000_000 + Math.floor(rng() * 200_000_000_000),
      ...(rv === 2 ? { animRoot: content } : {}), votesRoot: h64(), committeeMode: (["committee", "bootstrap", "quorum"] as const)[i % 3], committeeK: 1 + Math.floor(rng() * 14), committeeRoot: h64(), minerRoot: h64(), rulesVersion: rv,
    };
    push("ablock", rv, b.parentHash, b.imageHash, b.actionsHash, b.contentHash, b.deviceId, b.poolScreen, nv === 0 ? "-" : b.validatorProfileIds.join(","), b.scorePpm, b.minedAt, rv === 2 ? b.animRoot! : "-", b.votesRoot, b.committeeMode, b.committeeK, b.committeeRoot, b.minerRoot, blockCanonicalV2(b), blockHashV2(b));
  }
  for (const rv of [0, 3, 4, 99, 4_294_967_295]) push("ablockbad", rv);
  return { vectorsTxt: L.join("\n") + "\n", clips, lines: L.length, ANIM_V3 };
}
