import { createHash, createPublicKey, verify as cryptoVerify } from "node:crypto";
import { voteV2Capable } from "@/lib/voteCapability";
import { OTA_FAMILY_MAX, OTA_SIG_LEN, OTA_TRAILER_LEN, OTA_VERSION_MAX, parseTrailer } from "@/lib/otaTrailer";

// lib/otaManifest.ts — contrat du manifeste de mise à jour, PUR (sans Redis, sans réseau, sans route, sans clé privée).
// v1 (OTA-1, ECDSA P-256) est RETIRÉE le 15/10/2026 (OTA-4A) : schéma `pod-ota-manifest-v2`, signature RSA-2048 PKCS#1 v1.5 / SHA-256 avec la MÊME famille de clés de publication que le binaire.
// Qui vérifie quoi : le PUBLIEUR/SERVEUR vérifie ce manifeste avant de l'annoncer ; l'ESP8266 NE le vérifie pas (il ne garde qu'une primitive : RSA sur le binaire) et ne se fie qu'au trailer signé de l'image
// (lib/otaTrailer.ts). Spécification : docs/ADR_OTA_4A_CONTRAT_DE_SECURITE_2026_10_15.md. Rien n'est branché : aucune route, aucun firmware ne lit ce module.
// La clé privée de release n'existe JAMAIS ici : seules des clés PUBLIQUES (PEM) sont passées à la vérification.

export const OTA_SCHEMA = "pod-ota-manifest-v2";
export const OTA_CHANNELS = ["development", "canary", "stable"] as const;
export type OtaChannel = (typeof OTA_CHANNELS)[number];
export const OTA_SIGNATURE_ALG = "rsa2048-pkcs1-sha256";
/** Créneaux de clés publiques embarquées dans le firmware : active et secours. Tout autre identifiant est refusé. */
export const OTA_KEY_IDS = ["ota-a", "ota-b"] as const;
/** Plafond de la RÉGION SIGNÉE (image ‖ trailer, octets) : borne de sûreté, sous la limite de l'éditeur de liens (1 044 464 o) et au-dessus des firmwares actuels (≈ 0,55 Mo). */
export const OTA_MAX_SIZE = 1_000_000;

export interface OtaManifest {
  schema: typeof OTA_SCHEMA;
  releaseId: string;
  family: string;
  profile: { board: string; screen: string; flash?: string };
  channel: OtaChannel;
  firmwareVersion: string;
  otaSeq: number;
  minOtaSeq: number;
  revokedSeqs: number[];
  url: string;
  size: number;      // taille de la région signée (image ‖ trailer de 64 o) ; fichier servi = size + 256 (signature) + 4 (champ de longueur)
  sha256: string;    // SHA-256 de la région signée
  wave: { of: 100; upTo: number };
  activatesAt?: string;
  canaryDevices?: string[];
  notes?: string;
  signature: { alg: typeof OTA_SIGNATURE_ALG; keyId: (typeof OTA_KEY_IDS)[number]; sig: string };
}

export type ParseResult = { ok: true; manifest: OtaManifest } | { ok: false; error: string };

const ID = /^[A-Za-z0-9._+-]{1,64}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const DEVICE_ID = /^dev_[A-Z0-9]{8}$/;
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isUint = (v: unknown, max = 2 ** 31): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= max;

/** Validation stricte, sans repli ni troncature : toute anomalie rejette le manifeste entier. */
export function parseManifest(input: unknown): ParseResult {
  const fail = (error: string): ParseResult => ({ ok: false, error });
  if (!isObj(input)) return fail("manifeste : objet attendu");
  const m = input;
  if (m.schema !== OTA_SCHEMA) return fail("schema inconnu");
  if (typeof m.releaseId !== "string" || !ID.test(m.releaseId)) return fail("releaseId invalide");
  if (typeof m.family !== "string" || !ID.test(m.family) || m.family.length > OTA_FAMILY_MAX) return fail("family invalide (≤ 24 caractères : elle tient dans le trailer signé)");
  if (!isObj(m.profile) || typeof m.profile.board !== "string" || !ID.test(m.profile.board) || typeof m.profile.screen !== "string" || !ID.test(m.profile.screen)) return fail("profile invalide");
  if (m.profile.flash !== undefined && (typeof m.profile.flash !== "string" || !ID.test(m.profile.flash))) return fail("profile.flash invalide");
  if (typeof m.channel !== "string" || !(OTA_CHANNELS as readonly string[]).includes(m.channel)) return fail("channel invalide");
  if (typeof m.firmwareVersion !== "string" || m.firmwareVersion.length > OTA_VERSION_MAX || !voteV2Capable(m.firmwareVersion)) return fail("firmwareVersion : doit être une version qui sait voter en v2 (VOTE_V2_FIRMWARE)");
  if (!isUint(m.otaSeq) || m.otaSeq < 1) return fail("otaSeq invalide");
  if (!isUint(m.minOtaSeq) || m.minOtaSeq > m.otaSeq) return fail("minOtaSeq invalide (doit être <= otaSeq)");
  if (!Array.isArray(m.revokedSeqs) || m.revokedSeqs.length > 64 || !m.revokedSeqs.every((s) => isUint(s))) return fail("revokedSeqs invalide");
  if ((m.revokedSeqs as number[]).includes(m.otaSeq)) return fail("une release ne peut pas se révoquer elle-même");
  if (typeof m.url !== "string" || !/^\/firmware\/[A-Za-z0-9._\/-]{1,200}$/.test(m.url) || m.url.includes("..")) return fail("url : chemin statique /firmware/… attendu (jamais d'URL absolue)");
  if (!isUint(m.size, OTA_MAX_SIZE) || m.size <= OTA_TRAILER_LEN) return fail("size hors bornes (région signée = image + trailer de 64 o)");
  if (typeof m.sha256 !== "string" || !HEX64.test(m.sha256)) return fail("sha256 : 64 hex minuscules attendus");
  if (!isObj(m.wave) || m.wave.of !== 100 || !isUint(m.wave.upTo, 100)) return fail("wave invalide");
  if (m.activatesAt !== undefined && (typeof m.activatesAt !== "string" || !Number.isFinite(Date.parse(m.activatesAt)))) return fail("activatesAt invalide");
  if (m.canaryDevices !== undefined && (!Array.isArray(m.canaryDevices) || m.canaryDevices.length > 16 || !m.canaryDevices.every((d) => typeof d === "string" && DEVICE_ID.test(d)))) return fail("canaryDevices invalide");
  if (m.channel === "canary" && !(Array.isArray(m.canaryDevices) && m.canaryDevices.length > 0)) return fail("canal canary : canaryDevices obligatoire");
  if (m.notes !== undefined && (typeof m.notes !== "string" || m.notes.length > 200)) return fail("notes invalide");
  const s = m.signature;
  if (!isObj(s) || s.alg !== OTA_SIGNATURE_ALG || typeof s.keyId !== "string" || !(OTA_KEY_IDS as readonly string[]).includes(s.keyId) || typeof s.sig !== "string" || !/^[A-Za-z0-9+/]+={0,2}$/.test(s.sig) || s.sig.length !== 344) return fail("signature invalide (RSA-2048 : 344 caractères base64, keyId ota-a ou ota-b)");
  const known = new Set(["schema", "releaseId", "family", "profile", "channel", "firmwareVersion", "otaSeq", "minOtaSeq", "revokedSeqs", "url", "size", "sha256", "wave", "activatesAt", "canaryDevices", "notes", "signature"]);
  for (const k of Object.keys(m)) if (!known.has(k)) return fail(`champ inconnu : ${k}`);
  return { ok: true, manifest: m as unknown as OtaManifest };
}

/** Sérialisation canonique : clés triées récursivement, sans espaces, SANS le champ `signature`. Les octets signés. */
export function canonicalManifestBytes(manifest: Omit<OtaManifest, "signature"> | OtaManifest): Buffer {
  const { signature: _s, ...body } = manifest as OtaManifest;
  const sort = (v: unknown): unknown => Array.isArray(v) ? v.map(sort) : isObj(v) ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sort(v[k])])) : v;
  return Buffer.from(JSON.stringify(sort(body)), "utf8");
}

/** Clés publiques de publication acceptées : keyId → PEM (SPKI RSA-2048). Une clé inconnue = signature refusée. */
export type OtaTrustedKeys = Readonly<Record<string, string>>;

/** Vérifie la signature RSA-2048 PKCS#1 v1.5 / SHA-256 (base64, comme `openssl dgst -sha256 -sign`). Ne lève jamais : false au moindre doute. */
export function verifyManifestSignature(manifest: OtaManifest, keys: OtaTrustedKeys): boolean {
  try {
    const pem = Object.prototype.hasOwnProperty.call(keys, manifest.signature.keyId) ? keys[manifest.signature.keyId] : undefined;
    if (!pem) return false;
    const pub = createPublicKey(pem);
    if (pub.asymmetricKeyType !== "rsa" || pub.asymmetricKeyDetails?.modulusLength !== 2048) return false;
    const sig = Buffer.from(manifest.signature.sig, "base64");
    if (sig.length !== OTA_SIG_LEN) return false;
    return cryptoVerify("sha256", canonicalManifestBytes(manifest), pub, sig);
  } catch { return false; }
}

/** Parse + signature : la seule porte d'entrée à utiliser. */
export function loadManifest(input: unknown, keys: OtaTrustedKeys): ParseResult {
  const p = parseManifest(input);
  if (!p.ok) return p;
  return verifyManifestSignature(p.manifest, keys) ? p : { ok: false, error: "signature invalide ou clé inconnue" };
}

/**
 * La RÉGION SIGNÉE (image ‖ trailer) correspond-elle au manifeste ? Taille exacte, SHA-256, ET trailer cohérent (famille, séquence, version, longueur d'image).
 * Contrôle de PUBLICATION : une région dont le trailer contredit le manifeste ne doit jamais être annoncée.
 */
export function regionMatchesManifest(manifest: OtaManifest, region: Uint8Array): boolean {
  if (region.length !== manifest.size || createHash("sha256").update(region).digest("hex") !== manifest.sha256) return false;
  const t = parseTrailer(Buffer.from(region.subarray(region.length - OTA_TRAILER_LEN)));
  return t.ok && t.trailer.family === manifest.family && t.trailer.otaSeq === manifest.otaSeq && t.trailer.firmwareVersion === manifest.firmwareVersion && t.trailer.imageLen === region.length - OTA_TRAILER_LEN;
}

/** Vague déterministe 0–99, sans état serveur : octets 0–3 de SHA-256(deviceId) modulo 100. */
export function waveBucket(deviceId: string): number {
  return createHash("sha256").update(deviceId, "utf8").digest().readUInt32BE(0) % 100;
}

export interface OtaDeviceState {
  deviceId: string;
  family: string;
  firmware: string;
  otaSeq: number;
  channel: OtaChannel;
}
export type Eligibility = { eligible: true } | { eligible: false; reason: "family" | "channel" | "not-active" | "not-newer" | "wave" | "canary-device" };

/** Cet appareil doit-il être invité à installer cette release ? (annonce future dans /api/pull ; pur.) */
export function eligibleForRelease(m: OtaManifest, d: OtaDeviceState, now: number = Date.now()): Eligibility {
  if (m.family !== d.family) return { eligible: false, reason: "family" };
  if (m.channel === "development" || m.channel !== d.channel) return { eligible: false, reason: "channel" };
  if (m.activatesAt && now < Date.parse(m.activatesAt)) return { eligible: false, reason: "not-active" };
  if (m.channel === "canary" && !(m.canaryDevices ?? []).includes(d.deviceId)) return { eligible: false, reason: "canary-device" };
  // Anti-downgrade : jamais de séquence <= installée. La révocation oblige à avancer (une seq révoquée installée ou < minOtaSeq invite à la release suivante).
  if (m.otaSeq <= d.otaSeq) return { eligible: false, reason: "not-newer" };
  if (m.channel === "stable" && waveBucket(d.deviceId) >= m.wave.upTo) return { eligible: false, reason: "wave" };
  return { eligible: true };
}

/** Une séquence installée est-elle révoquée par ce manifeste ? (utile pour forcer l'avancée.) */
export function installedSeqRevoked(m: OtaManifest, installedSeq: number): boolean {
  return installedSeq < m.minOtaSeq || m.revokedSeqs.includes(installedSeq);
}
