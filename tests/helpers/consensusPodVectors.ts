// tests/helpers/consensusPodVectors.ts — construit le fichier de vecteurs du noyau C++ à partir de la référence TypeScript (voir scripts/gen-consensus-pod-vectors.ts).
import { createHash } from "node:crypto";
import {
  blockCanonicalV2, blockHashV2, committeeRank, committeeSeed, decide, drawMiner, evaluateRules, merkleRoot, minerSeed, saltNonce, saltedHash, threshold, voteLeaf, voteMessageV3,
  type Committee, type Verdict, type VoteClass, type BlockCanonicalV2, type RuleCode,
} from "../../lib/podProtocolV3";
import { mulberry32, shuffle } from "../../lib/podSim";

const sha = (d: string | Uint8Array) => createHash("sha256").update(d).digest("hex");
const hex = (b: Uint8Array) => Buffer.from(b).toString("hex");
const pat = (n: number, mul: number) => Uint8Array.from({ length: n }, (_, i) => (i * mul + 13) & 0xff);
const VERDICT_CHAR: Record<string, string> = { none: "0", accept: "1", reject: "2" };

export function buildConsensusVectors() {
  const rng = mulberry32(20261007);
  const L: string[] = [];
  const push = (...t: (string | number)[]) => L.push(t.join(" "));
  const h64 = () => sha(`v${rng()}${rng()}`);
  const dev = () => `dev_${Array.from({ length: 8 }, () => "ABCDEFGHJKLMNPQRSTUVWXYZ0123456789"[Math.floor(rng() * 34)]).join("")}`;
  const uuid = () => { const h = sha(`u${rng()}`); return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`; };

  push("#", "vecteurs du noyau consensusPoD — générés par scripts/gen-consensus-pod-vectors.ts à partir de lib/podProtocolV3.ts (NE PAS ÉDITER À LA MAIN)");
  // SHA-256 : adaptateur PC vérifié contre Node (longueurs autour des frontières de bloc de 64 octets)
  for (const n of [0, 1, 3, 55, 56, 63, 64, 65, 119, 120, 128, 1000]) { const b = pat(n, 7); push("sha256hex", n === 0 ? "-" : hex(b), sha(b)); }
  // règles
  const bounds = [0, 1, 979_999, 980_000, 980_001, 899_999, 900_000, 900_001, 1_000_000];
  for (const e of bounds) for (const t of [0, 1, 900_000, 900_001, 1_000_000]) for (const [f, h] of [[1, 1], [1, 0], [0, 1], [0, 0]]) { if (rng() < 0.35) push("rule", f, h, e, t, evaluateRules({ formatOk: !!f, hashOk: !!h, e, t }).ruleCode); }
  for (let i = 0; i < 40; i++) { const e = Math.floor(rng() * 1_000_001), t = Math.floor(rng() * 1_000_001); push("rule", 1, 1, e, t, evaluateRules({ formatOk: true, hashOk: true, e, t }).ruleCode); }
  push("rule", 1, 1, 0, 0, "uniform"); push("rule", 1, 1, 523000, 311000, "ok"); push("rule", 0, 0, 0, 0, "format");
  // nonce et hash salé
  const nonces: string[] = [];
  for (let i = 0; i < 6; i++) { const c = uuid(), p = h64(), d = dev(); const n = hex(saltNonce(c, p, d)); nonces.push(n); push("nonce", c, p, d, n); }
  for (const n of [0, 1, 63, 64, 65, 1024]) { const raw = pat(n, 31), nn = nonces[n % nonces.length]; push("salted", nn, n === 0 ? "-" : hex(raw), saltedHash(Buffer.from(nn, "hex"), raw)); }
  // message de vote v3
  for (let i = 0; i < 10; i++) {
    const accept = rng() < 0.6, rc: RuleCode = accept ? "ok" : (["hash", "metrics", "uniform", "noise", "format", "rules"] as RuleCode[])[Math.floor(rng() * 6)];
    const v = { deviceId: dev(), candidateId: uuid(), parentHash: h64(), metricsVersion: 2, rulesVersion: 1, rawHash: h64(), saltedHash: h64(), e: Math.floor(rng() * 1_000_001), t: Math.floor(rng() * 1_000_001), r: Math.floor(rng() * 1_000_001),
      verdict: (accept ? "accept" : "reject") as Verdict, ruleCode: rc, vclass: (["C0", "C1", "C2"] as VoteClass[])[i % 3] };
    push("message", v.deviceId, v.candidateId, v.parentHash, v.metricsVersion, v.rulesVersion, v.rawHash, v.saltedHash, v.e, v.t, v.r, v.verdict, v.ruleCode, v.vclass, voteMessageV3(v));
  }
  // feuilles et racines de Merkle
  const leafOf = (i: number) => voteLeaf(`m${i}`, "ab".repeat(64), "cd".repeat(32));
  for (let i = 0; i < 6; i++) { const m = `pod-vote-v2|${dev()}|${uuid()}|${h64()}|2|${Math.floor(rng() * 1e6)}|${Math.floor(rng() * 1e6)}|${Math.floor(rng() * 1e6)}|accept`; const sig = sha(m) + sha(m + "s"), pub = sha(m + "p"); push("leaf", m, sig, pub, hex(voteLeaf(m, sig, pub))); }
  for (let n = 0; n <= 14; n++) push("merkle", n, merkleRoot(Array.from({ length: n }, (_, i) => leafOf(i))));
  // comité : graine, rang
  const seeds: string[] = [];
  for (let i = 0; i < 5; i++) { const p = h64(), c = h64(), s = committeeSeed(p, c); seeds.push(s); push("cseed", p, c, s); }
  for (let i = 0; i < 14; i++) { const prof = i % 3 === 0 ? `esp_${dev()}` : `art_${sha(`p${i}`).slice(0, 10)}`; push("crank", seeds[i % seeds.length], prof, committeeRank(seeds[i % seeds.length], prof)); }
  // règle des sièges : fenêtre de K (vague 1) ou de min(2K, n) (vague 2), répartition aléatoire de silences, approbations et refus
  for (let i = 0; i < 260; i++) {
    const K = 1 + Math.floor(rng() * 7), wave2 = rng() < 0.5, n = K + Math.floor(rng() * (K + 3)), windowN = wave2 ? Math.min(2 * K, n) : K;
    const verdicts = Array.from({ length: windowN }, () => { const x = rng(); return x < 0.35 ? "none" : x < 0.8 ? "accept" : "reject"; });
    const c: Committee = { mode: "committee", K, threshold: threshold(K), ranked: Array.from({ length: windowN }, (_, r) => `p${r}`) };
    const votes = new Map<string, Verdict>(); verdicts.forEach((v, r) => { if (v !== "none") votes.set(`p${r}`, v as Verdict); });
    const d = decide(c, wave2 && windowN > K ? 2 : 1, votes);
    push("decide", K, threshold(K), windowN, verdicts.map((v) => VERDICT_CHAR[v]).join(""), d.state === "pending" ? 0 : d.state === "accept" ? 1 : 2, d.accepts, d.rejects);
  }
  // mineur déterministe
  for (let i = 0; i < 24; i++) {
    const n = 1 + Math.floor(rng() * 14), parent = h64(), content = h64(), votesRoot = h64();
    const cands = shuffle(Array.from({ length: n }, (_, k) => ({ profileId: `art_${k}${sha(`m${i}${k}`).slice(0, 6)}`, minedBlocks: Math.floor(rng() * rng() * 40) })), rng);
    const winner = drawMiner({ parentHash: parent, contentHash: content, votesRoot, accepted: cands })!;
    push("miner", parent, content, votesRoot, n, cands.map((c) => `${c.profileId}:${c.minedBlocks}`).join(","), winner, minerSeed(committeeSeed(parent, content), votesRoot));
  }
  // bloc v2 canonique et hash
  for (let i = 0; i < 10; i++) {
    const nv = Math.floor(rng() * 8), withAnim = i % 3 === 0;
    const b: BlockCanonicalV2 = {
      parentHash: i === 0 ? "0".repeat(64) : h64(), imageHash: h64(), actionsHash: h64(), contentHash: h64(), deviceId: dev(), poolScreen: (["oled096", "eink27bw", "eink29bwr", "tft18", "tft28"])[i % 5],
      validatorProfileIds: shuffle(Array.from({ length: nv }, (_, k) => `art_${k}${sha(`b${i}${k}`).slice(0, 5)}`), rng), scorePpm: Math.floor(rng() * 1_000_001), minedAt: 1_700_000_000_000 + Math.floor(rng() * 200_000_000_000),
      ...(withAnim ? { animRoot: h64() } : {}), votesRoot: h64(), committeeMode: (["committee", "bootstrap", "quorum"] as const)[i % 3], committeeK: 1 + Math.floor(rng() * 14),
    };
    push("block", b.parentHash, b.imageHash, b.actionsHash, b.contentHash, b.deviceId, b.poolScreen, nv === 0 ? "-" : b.validatorProfileIds.join(","), b.scorePpm, b.minedAt, withAnim ? b.animRoot! : "-", b.votesRoot, b.committeeMode, b.committeeK, blockCanonicalV2(b), blockHashV2(b));
  }

  // ── jeu minimal embarqué dans les sketches d'auto-test (compilation ESP8266 / R4) ───────────────────────────────────────────────────────────────
  const c0 = "123e4567-e89b-42d3-a456-426614174000", p0 = sha("pod-selftest-parent"), d0 = "dev_AB12CD34";
  const raw16 = Uint8Array.from({ length: 16 }, (_, i) => i);
  const n0 = hex(saltNonce(c0, p0, d0));
  const selftestH = [
    "// consensusPoD_selftest.h — jeu minimal d'auto-test embarqué (GÉNÉRÉ par scripts/gen-consensus-pod-vectors.ts : ne pas éditer). Utilisé par examples/SelfTest*.",
    "#pragma once",
    `#define POD_SELFTEST_CANDIDATE "${c0}"`, `#define POD_SELFTEST_PARENT "${p0}"`, `#define POD_SELFTEST_DEVICE "${d0}"`,
    `#define POD_SELFTEST_NONCE_HEX "${n0}"`,
    `#define POD_SELFTEST_SALTED16 "${saltedHash(Buffer.from(n0, "hex"), raw16)}"`,
    `#define POD_SELFTEST_MERKLE3 "${merkleRoot([0, 1, 2].map(leafOf))}"`,
    `#define POD_SELFTEST_SEED "${committeeSeed(p0, sha("pod-selftest-content"))}"`,
    `#define POD_SELFTEST_CONTENT "${sha("pod-selftest-content")}"`,
    "",
  ].join("\n");

  return { vectorsTxt: L.join("\n") + "\n", selftestH, lines: L.length };
}
