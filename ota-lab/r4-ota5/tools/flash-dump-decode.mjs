// flash-dump-decode.mjs — décode et COMPARE des vidages de la data flash (8 192 o) d'une station R4. N'affiche JAMAIS la clé privée, le SSID ni le mot de passe.
//   node flash-dump-decode.mjs --log dump.log --out dump.bin [--lookup]      : vérifie les 256 lignes (CRC-32), écrit le binaire (HORS Git : il contient la clé privée), résume l'identité publique
//   node flash-dump-decode.mjs --diff avant.bin apres.bin                     : liste les plages d'octets modifiées par zone et rend un verdict
// --lookup : retrouve l'appareil par sa clé publique (Redis, jeton LECTURE SEULE de .env.local) : deviceId, firmware, dernier signe de vie, appairage.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";

export const SIZE = 8192;
export function crc32(d) { let c = 0xFFFFFFFF; for (const b of d) { c ^= b; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1)); } return (~c) >>> 0; }
const hex = (b) => Buffer.from(b).toString("hex");
const le32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;

/** Lignes « FD aaaa <64 hex> <crc> » -> { ok, bin, errors[] } ; garde le DERNIER vidage complet du journal. */
export function parseLog(text) {
  const rows = new Map(); let last = null;
  for (const l of text.split(/\r?\n/)) {
    if (l.startsWith("FD BEGIN")) { rows.clear(); continue; }
    if (l.startsWith("FD END")) { last = new Map(rows); continue; }
    const m = /^FD ([0-9a-f]{4}) ([0-9a-f]{64}) ([0-9a-f]{8})$/.exec(l.trim());
    if (m) rows.set(parseInt(m[1], 16), { data: Buffer.from(m[2], "hex"), crc: parseInt(m[3], 16) });
  }
  const errors = [];
  if (!last) return { ok: false, bin: null, errors: ["aucun vidage complet (FD BEGIN … FD END) dans le journal"] };
  const bin = Buffer.alloc(SIZE, 0);
  for (let a = 0; a < SIZE; a += 32) {
    const r = last.get(a);
    if (!r) { errors.push(`ligne ${a.toString(16).padStart(4, "0")} manquante`); continue; }
    if (crc32(r.data) !== r.crc) errors.push(`CRC faux à l'adresse ${a.toString(16).padStart(4, "0")}`);
    r.data.copy(bin, a);
  }
  return { ok: errors.length === 0, bin, errors };
}

/** Un enregistrement de séquence OTA (bloc de 1 Ko) : « OTS1 », version 1, 0xA5, séquence, génération, CRC-32 des 16 premiers octets. */
export function decodeSeqBlock(b) {
  if (b.subarray(0, 20).every((x) => x === 0xFF)) return { kind: "vierge" };
  if (b.subarray(0, 4).toString("latin1") === "OTS1" && b[4] === 1 && b[5] === 0xA5 && le32(b, 16) === crc32(b.subarray(0, 16))) return { kind: "valide", seq: le32(b, 8), gen: le32(b, 12) };
  return { kind: "invalide" };
}
/** Enregistrement Wi-Fi « PWC1 » (105 o à 512) : seulement l'état et les longueurs. */
export function wifiState(bin) {
  const r = bin.subarray(512, 617);
  if (r.every((x) => x === 0xFF)) return { kind: "vierge" };
  if (r.subarray(0, 4).toString("latin1") !== "PWC1") return { kind: "invalide" };
  if (le32(r, 101) !== crc32(r.subarray(0, 101))) return { kind: "invalide (CRC)" };
  return { kind: "valide", ssidLen: r[4], passLen: r[5] };
}
export function summarize(bin) {
  const seqs = [2048, 3072].map((o) => decodeSeqBlock(bin.subarray(o, o + 1024)));
  const valid = seqs.filter((s) => s.kind === "valide");
  const nonFF = (a, b) => bin.subarray(a, b).filter((x) => x !== 0xFF).length;
  return {
    sha256: createHash("sha256").update(bin).digest("hex"),
    keyGeneratedFlag: bin[64], keyFlagOk: bin[64] === 0xED,
    publicKey: hex(bin.subarray(65, 97)),
    privateKeyPresent: !bin.subarray(0, 32).every((x) => x === 0xFF || x === 0x00),   // seulement « présente », jamais la valeur
    onboardingShown: bin[97] === 0x01,
    ownedHead: bin[98], ownedCount: bin[99],
    wifi: wifiState(bin),
    seqBlockA: seqs[0], seqBlockB: seqs[1],
    effectiveSeq: valid.length ? Math.max(...valid.map((s) => s.seq)) : null,
    nonErasedBytes: { block0: nonFF(0, 1024), block1: nonFF(1024, 2048), block2: nonFF(2048, 3072), block3: nonFF(3072, 4096), blocks4to7: nonFF(4096, 8192) },
  };
}
const ZONES = [
  ["identité (clés, drapeaux, blocs possédés) 0..511", 0, 512, "identite"],
  ["enregistrement Wi-Fi 512..616", 512, 617, "wifi"],
  ["reste du bloc 0 (617..1023)", 617, 1024, "bloc0-reste"],
  ["bloc 1 (1024..2047)", 1024, 2048, "autre"],
  ["séquence OTA bloc A (2048..3071)", 2048, 3072, "seq"],
  ["séquence OTA bloc B (3072..4095)", 3072, 4096, "seq"],
  ["blocs 4..7 (4096..8191)", 4096, 8192, "autre"],
];
export function diff(before, after) {
  const changed = [];
  let i = 0;
  while (i < SIZE) { if (before[i] === after[i]) { i++; continue; } let j = i; while (j < SIZE && before[j] !== after[j]) j++; changed.push([i, j]); i = j; }
  const byZone = ZONES.map(([name, a, b, id]) => ({ name, id, bytes: changed.reduce((n, [x, y]) => n + Math.max(0, Math.min(y, b) - Math.max(x, a)), 0) }));
  const get = (id) => byZone.filter((z) => z.id === id).reduce((n, z) => n + z.bytes, 0);
  const verdict = { identityUnchanged: get("identite") === 0, block0RestUnchanged: get("bloc0-reste") === 0, otherUnchanged: get("autre") === 0, onlyExpectedChanged: get("identite") === 0 && get("bloc0-reste") === 0 && get("autre") === 0 };
  return { changedRanges: changed, byZone, verdict };
}

async function lookupByPublicKey(pub) {
  const envPath = join(process.cwd(), ".env.local");
  if (existsSync(envPath)) process.loadEnvFile(envPath);
  const url = process.env.KV_REST_API_URL, tok = process.env.KV_REST_API_READ_ONLY_TOKEN;
  if (!url || !tok) return { error: "jeton lecture seule absent (.env.local)" };
  const r = async (...c) => (await (await fetch(url, { method: "POST", headers: { Authorization: "Bearer " + tok }, body: JSON.stringify(c) })).json()).result;
  const ids = await r("SMEMBERS", "devices:all");
  for (const id of ids ?? []) {
    const raw = await r("GET", "device:" + id); if (!raw) continue;
    const d = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (d.publicKey === pub) return { deviceId: d.deviceId, firmware: d.firmware, screens: d.screens, lastSeen: d.lastSeen ? new Date(d.lastSeen).toISOString() : null, artistIdPresent: !!d.artistId, pairCodePresent: !!d.pairCode };
  }
  return { error: "aucun appareil enregistré avec cette clé publique" };
}

async function main() {
  const argv = process.argv.slice(2), arg = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
  if (argv.includes("--diff")) {
    const i = argv.indexOf("--diff"); const a = readFileSync(argv[i + 1]), b = readFileSync(argv[i + 2]);
    if (a.length !== SIZE || b.length !== SIZE) { console.error("les deux fichiers doivent faire 8192 o"); process.exit(2); }
    const d = diff(a, b);
    console.log("plages modifiées :", d.changedRanges.length ? d.changedRanges.map(([x, y]) => `${x}..${y - 1}`).join(", ") : "aucune");
    for (const z of d.byZone) console.log(`  ${z.name} : ${z.bytes} octet(s) modifié(s)`);
    console.log("verdict :", JSON.stringify(d.verdict));
    const sa = summarize(a), sb = summarize(b);
    console.log("clé publique inchangée :", sa.publicKey === sb.publicKey, "| drapeau clés inchangé :", sa.keyGeneratedFlag === sb.keyGeneratedFlag, "| appairage (drapeau 97) inchangé :", sa.onboardingShown === sb.onboardingShown, "| blocs possédés inchangés :", sa.ownedHead === sb.ownedHead && sa.ownedCount === sb.ownedCount);
    console.log("séquence effective avant → après :", sa.effectiveSeq, "→", sb.effectiveSeq, "| Wi-Fi avant → après :", sa.wifi.kind, "→", sb.wifi.kind);
    process.exit(d.verdict.onlyExpectedChanged && sa.publicKey === sb.publicKey ? 0 : 1);
  }
  const log = arg("--log"), out = arg("--out");
  if (!log) { console.error("usage : --log dump.log [--out dump.bin] [--lookup]   |   --diff avant.bin apres.bin"); process.exit(2); }
  const p = parseLog(readFileSync(log, "utf8"));
  if (!p.ok) { console.error("VIDAGE INVALIDE :\n  - " + p.errors.slice(0, 8).join("\n  - ")); process.exit(1); }
  if (out) writeFileSync(out, p.bin);
  const s = summarize(p.bin);
  console.log("vidage complet et valide : 256 lignes, CRC-32 de chaque ligne vérifié, " + SIZE + " octets" + (out ? " -> " + out : ""));
  console.log(JSON.stringify(s, null, 2));
  if (argv.includes("--lookup")) console.log("appareil (par clé publique) :", JSON.stringify(await lookupByPublicKey(s.publicKey)));
}
if (process.argv[1] && String(process.argv[1]).split(String.fromCharCode(92)).join("/").endsWith("/flash-dump-decode.mjs")) main();
