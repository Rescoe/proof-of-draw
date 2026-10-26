// lib/otaManifestR4.ts — manifeste OTA de la famille UNO R4 WiFi (ADR OTA-5, 17/10/2026). RÉFÉRENCE pure (sans Redis, sans réseau) du format texte canonique que le RA4M1 analyse en C++ (consensus-pod/src/podOtaR4.h).
// Schéma DISTINCT de lib/otaManifest.ts (OTA-1 v2, RSA, ESP8266) : ni l'un ni l'autre ne s'analyse avec le parseur de l'autre. Aucune clé de production ici.
//
// Format (texte ASCII, fins de ligne « \n », ordre FIXE, aucune ligne en trop) :
//   schema=pod-ota-manifest-r4-v1
//   family=uno-r4-wifi-tft28
//   firmware=r4tft28-2.6
//   seq=7
//   channel=stable
//   size=76628
//   sha256=<64 hex minuscules>
//   notbefore=0
//   keyid=r4-a
//   sig=<128 hex minuscules>          <- signature Ed25519 de ("POD-OTA-R4-MANIFEST-V1\n" || corps), corps = toutes les lignes AVANT « sig= », « \n » final compris
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign as cryptoSign, verify as cryptoVerify, type KeyObject } from "node:crypto";
import { voteV2Capable } from "@/lib/voteCapability";

export const R4_SCHEMA = "pod-ota-manifest-r4-v1";
export const R4_DOMAIN = "POD-OTA-R4-MANIFEST-V1\n";
export const R4_FAMILIES = ["uno-r4-wifi-tft28", "uno-r4-wifi-tft18", "uno-r4-wifi-sensor"] as const;
/** Familles dont le firmware VOTE (compté dans le quorum) : sa version doit rester capable de voter. La station capteur (ni écran, ni vote) en est exemptée (26/10/2026). */
export const R4_NON_VOTING_FAMILIES = ["uno-r4-wifi-sensor"] as const;
export const R4_CHANNELS = ["development", "canary", "stable"] as const;
export const R4_KEY_IDS = ["r4-a", "r4-b"] as const;
export const R4_MAX_SIZE = 0x3c000;           // flash applicative : 0x40000 - 0x4000
export const R4_MAX_MANIFEST_BYTES = 512;
export const R4_MAX_SEQ = 2 ** 31 - 1;

export interface R4Manifest { schema: string; family: string; firmware: string; seq: number; channel: string; size: number; sha256: string; notbefore: number; keyid: string; sig: string }
export type R4Parse = { ok: true; manifest: R4Manifest; body: Buffer } | { ok: false; error: string };
export type R4Keys = Readonly<Record<string, string>>;   // keyid -> clé publique brute Ed25519 en hexadécimal (64 caractères)

const ORDER = ["schema", "family", "firmware", "seq", "channel", "size", "sha256", "notbefore", "keyid"] as const;
const HEX = (n: number) => new RegExp(`^[0-9a-f]{${n}}$`);
const FW = /^[a-z0-9]{1,16}-\d{1,3}\.\d{1,3}(?:\.\d{1,3})?$/;
const UINT = /^(0|[1-9][0-9]{0,9})$/;

/** Analyse STRICTE. Ne lève jamais. Renvoie aussi les octets du corps (ceux qui sont signés, sans le préfixe de domaine). */
export function parseR4Manifest(raw: Uint8Array | string): R4Parse {
  const buf = typeof raw === "string" ? Buffer.from(raw, "utf8") : Buffer.from(raw);
  const fail = (error: string): R4Parse => ({ ok: false, error });
  if (buf.length === 0 || buf.length > R4_MAX_MANIFEST_BYTES) return fail("taille du manifeste hors limites");
  for (const b of buf) if (!(b === 0x0a || (b >= 0x20 && b <= 0x7e))) return fail("caractère hors ASCII imprimable");
  const text = buf.toString("latin1"); if (!text.endsWith("\n")) return fail("fin de ligne manquante");
  const lines = text.slice(0, -1).split("\n");
  if (lines.length !== ORDER.length + 1) return fail("nombre de lignes incorrect");
  const v: Record<string, string> = {};
  for (let i = 0; i < ORDER.length; i++) { const k = ORDER[i]; const l = lines[i]; if (!l.startsWith(k + "=")) return fail(`ligne ${i + 1} : « ${k}= » attendu (champ inconnu, manquant ou dans le désordre)`); v[k] = l.slice(k.length + 1); if (v[k].length === 0 || v[k] !== v[k].trim()) return fail(`${k} vide ou avec espaces`); }
  if (!lines[ORDER.length].startsWith("sig=")) return fail("ligne sig= attendue en dernier");
  const sig = lines[ORDER.length].slice(4);
  if (v.schema !== R4_SCHEMA) return fail("schema inconnu");
  if (!(R4_FAMILIES as readonly string[]).includes(v.family)) return fail("famille inconnue");
  if (!FW.test(v.firmware)) return fail("firmware mal formé");
  for (const k of ["seq", "size", "notbefore"] as const) if (!UINT.test(v[k])) return fail(`${k} mal formé`);
  const seq = Number(v.seq), size = Number(v.size), notbefore = Number(v.notbefore);
  if (seq < 1 || seq > R4_MAX_SEQ) return fail("seq hors limites");
  if (size < 1 || size > R4_MAX_SIZE) return fail("size nulle ou supérieure à 0x3C000");
  if (!(R4_CHANNELS as readonly string[]).includes(v.channel)) return fail("channel invalide");
  if (!HEX(64).test(v.sha256)) return fail("sha256 mal formé");
  if (!(R4_KEY_IDS as readonly string[]).includes(v.keyid)) return fail("keyid inconnu");
  if (!HEX(128).test(sig)) return fail("sig mal formée");
  const bodyLen = buf.length - (4 + sig.length + 1);
  return { ok: true, manifest: { schema: v.schema, family: v.family, firmware: v.firmware, seq, channel: v.channel, size, sha256: v.sha256, notbefore, keyid: v.keyid, sig }, body: buf.subarray(0, bodyLen) };
}

/** Le corps canonique (lignes avant sig=) d'un manifeste sans signature. */
export function r4Body(m: Omit<R4Manifest, "sig">): Buffer {
  return Buffer.from(ORDER.map((k) => `${k}=${(m as unknown as Record<string, string | number>)[k]}`).join("\n") + "\n", "latin1");
}
export const r4SignedBytes = (body: Uint8Array): Buffer => Buffer.concat([Buffer.from(R4_DOMAIN, "latin1"), Buffer.from(body)]);

const SPKI_ED25519_PREFIX = Buffer.from("302a300506032b6570032100", "hex");
export const pubKeyFromHex = (hex: string): KeyObject => createPublicKey({ key: Buffer.concat([SPKI_ED25519_PREFIX, Buffer.from(hex, "hex")]), format: "der", type: "spki" });
const PKCS8_ED25519_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");
export const privKeyFromSeedHex = (hex: string): KeyObject => createPrivateKey({ key: Buffer.concat([PKCS8_ED25519_PREFIX, Buffer.from(hex, "hex")]), format: "der", type: "pkcs8" });

/** Paire de clés de TEST (graine 32 o + clé publique brute 32 o, en hexadécimal). Jamais une clé de production. */
export function generateTestKeyPair(): { seedHex: string; publicHex: string } {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const seedHex = (privateKey.export({ format: "der", type: "pkcs8" }) as Buffer).subarray(-32).toString("hex");
  const publicHex = (publicKey.export({ format: "der", type: "spki" }) as Buffer).subarray(-32).toString("hex");
  return { seedHex, publicHex };
}

/** Produit un manifeste signé complet (texte). `seedHex` = graine Ed25519 du keyid. */
export function signR4Manifest(m: Omit<R4Manifest, "sig" | "schema"> & { schema?: string }, seedHex: string): Buffer {
  const full = { ...m, schema: m.schema ?? R4_SCHEMA } as Omit<R4Manifest, "sig">;
  const body = r4Body(full);
  const sig = cryptoSign(null, r4SignedBytes(body), privKeyFromSeedHex(seedHex)).toString("hex");
  return Buffer.concat([body, Buffer.from(`sig=${sig}\n`, "latin1")]);
}

export function verifyR4Signature(p: Extract<R4Parse, { ok: true }>, keys: R4Keys): boolean {
  try {
    const hex = Object.prototype.hasOwnProperty.call(keys, p.manifest.keyid) ? keys[p.manifest.keyid] : undefined;
    if (!hex || !HEX(64).test(hex) || /^0+$/.test(hex)) return false;   // clé absente, mal formée ou NULLE (clé de test du dépôt) : refus
    return cryptoVerify(null, r4SignedBytes(p.body), pubKeyFromHex(hex), Buffer.from(p.manifest.sig, "hex"));
  } catch { return false; }
}

export interface R4Device { family: string; installedSeq: number; channel: string; nowSeconds: number }
export type R4Why = "ok" | "parse" | "signature" | "family" | "channel" | "not-newer" | "not-active" | "vote-incompatible" | "size";
/** Le CONTRAT complet côté appareil (ordre des refus identique à la version C++). */
export function evaluateR4Manifest(raw: Uint8Array | string, keys: R4Keys, d: R4Device): { ok: boolean; why: R4Why; manifest?: R4Manifest; detail?: string } {
  const p = parseR4Manifest(raw); if (!p.ok) return { ok: false, why: "parse", detail: p.error };
  if (!verifyR4Signature(p, keys)) return { ok: false, why: "signature" };
  const m = p.manifest;
  if (m.family !== d.family) return { ok: false, why: "family", manifest: m };
  if (m.channel === "development" || m.channel !== d.channel) return { ok: false, why: "channel", manifest: m };
  if (!(R4_NON_VOTING_FAMILIES as readonly string[]).includes(m.family) && !voteV2Capable(m.firmware)) return { ok: false, why: "vote-incompatible", manifest: m };
  if (m.seq <= d.installedSeq) return { ok: false, why: "not-newer", manifest: m };
  if (m.notbefore > d.nowSeconds) return { ok: false, why: "not-active", manifest: m };
  return { ok: true, why: "ok", manifest: m };
}

export const sha256Hex = (b: Uint8Array): string => createHash("sha256").update(b).digest("hex");

/** Vérifie le binaire brut contre le manifeste : taille EXACTE puis SHA-256. */
export function binaryMatchesR4(m: R4Manifest, bin: Uint8Array): { ok: boolean; why: "ok" | "size" | "sha256" } {
  if (bin.length !== m.size) return { ok: false, why: "size" };
  return sha256Hex(bin) === m.sha256 ? { ok: true, why: "ok" } : { ok: false, why: "sha256" };
}
