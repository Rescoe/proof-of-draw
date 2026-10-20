import { createHash, createPublicKey, createPrivateKey, sign as cryptoSign, verify as cryptoVerify } from "node:crypto";
import { voteV2Capable } from "@/lib/voteCapability";

// lib/otaTrailer.ts — OTA-4A (15/10/2026) : « trailer » SIGNÉ d'une image de firmware + référence TypeScript de la vérification de l'appareil. PUR (aucun réseau, aucune route).
// ADR : docs/ADR_OTA_4A_CONTRAT_DE_SECURITE_2026_10_15.md. Le trailer est inclus dans la région signée (image ‖ trailer) : famille, séquence et version ne peuvent donc pas être
// séparées de la signature binaire. L'appareil ne vérifie AUCUNE signature de manifeste : l'annonce est consultative, c'est le trailer signé qui fait foi (anti-rejeu, anti-downgrade, anti-famille).
// Miroir C++ : consensus-pod/src/podOta.h (vecteurs différentiels : consensus-pod/test-vectors/ota-vectors.txt).

export const OTA_TRAILER_MAGIC = "PODOTA01";
export const OTA_TRAILER_LEN = 64;
export const OTA_SIG_LEN = 256;                      // RSA-2048 PKCS#1 v1.5
export const OTA_FAMILY_MAX = 24;
export const OTA_VERSION_MAX = 24;
export const OTA_MAX_REGION = 1_000_000;

export interface OtaTrailer { otaSeq: number; imageLen: number; family: string; firmwareVersion: string }

const ASCII_ID = /^[A-Za-z0-9._+-]+$/;

/** 64 octets : magic(8) ‖ otaSeq u32 LE ‖ imageLen u32 LE ‖ family(24, NUL) ‖ firmwareVersion(24, NUL). */
export function buildTrailer(t: OtaTrailer): Buffer {
  if (!Number.isInteger(t.otaSeq) || t.otaSeq < 1 || t.otaSeq > 0xffffffff) throw new Error("otaSeq invalide");
  if (!Number.isInteger(t.imageLen) || t.imageLen < 1 || t.imageLen > OTA_MAX_REGION) throw new Error("imageLen invalide");
  if (t.family.length < 1 || t.family.length > OTA_FAMILY_MAX || !ASCII_ID.test(t.family)) throw new Error("family invalide");
  if (t.firmwareVersion.length < 1 || t.firmwareVersion.length > OTA_VERSION_MAX || !ASCII_ID.test(t.firmwareVersion)) throw new Error("firmwareVersion invalide");
  const b = Buffer.alloc(OTA_TRAILER_LEN);
  b.write(OTA_TRAILER_MAGIC, 0, "ascii");
  b.writeUInt32LE(t.otaSeq, 8);
  b.writeUInt32LE(t.imageLen, 12);
  b.write(t.family, 16, "ascii");
  b.write(t.firmwareVersion, 40, "ascii");
  return b;
}

export type TrailerParse = { ok: true; trailer: OtaTrailer } | { ok: false; reason: "length" | "magic" | "seq" | "imageLen" | "family" | "version" };

function cstr(b: Buffer, off: number, max: number): string | null {
  const z = b.indexOf(0, off);
  const end = z < 0 || z > off + max ? off + max : z;
  const s = b.toString("latin1", off, end);
  for (let i = end; i < off + max; i++) if (b[i] !== 0) return null;      // remplissage strictement NUL
  return s;
}

/** Analyse stricte : toute anomalie (magic, remplissage non NUL, caractères hors alphabet, champ vide) rejette. */
export function parseTrailer(b: Buffer): TrailerParse {
  if (b.length !== OTA_TRAILER_LEN) return { ok: false, reason: "length" };
  if (b.toString("ascii", 0, 8) !== OTA_TRAILER_MAGIC) return { ok: false, reason: "magic" };
  const otaSeq = b.readUInt32LE(8), imageLen = b.readUInt32LE(12);
  if (otaSeq < 1) return { ok: false, reason: "seq" };
  if (imageLen < 1 || imageLen > OTA_MAX_REGION) return { ok: false, reason: "imageLen" };
  const family = cstr(b, 16, OTA_FAMILY_MAX), firmwareVersion = cstr(b, 40, OTA_VERSION_MAX);
  if (family === null || family.length < 1 || !ASCII_ID.test(family)) return { ok: false, reason: "family" };
  if (firmwareVersion === null || firmwareVersion.length < 1 || !ASCII_ID.test(firmwareVersion)) return { ok: false, reason: "version" };
  return { ok: true, trailer: { otaSeq, imageLen, family, firmwareVersion } };
}

/** Région signée = image ‖ trailer ; fichier servi = région ‖ signature RSA (256 o) ‖ longueur de signature (u32 LE = 256). Outil de publication (clé privée fournie par l'appelant, jamais stockée ici). */
export function buildSignedFile(image: Buffer, t: Omit<OtaTrailer, "imageLen">, privatePem: string | Buffer): { region: Buffer; file: Buffer } {
  const region = Buffer.concat([image, buildTrailer({ ...t, imageLen: image.length })]);
  const sig = cryptoSign("sha256", region, createPrivateKey(privatePem));
  if (sig.length !== OTA_SIG_LEN) throw new Error("clé RSA-2048 attendue");
  const len = Buffer.alloc(4); len.writeUInt32LE(OTA_SIG_LEN);
  return { region, file: Buffer.concat([region, sig, len]) };
}

export interface DeviceContext { family: string; installedSeq: number }
export interface OfferedRelease { otaSeq: number; size: number }       // size = taille de la région signée (image ‖ trailer)
export type DeviceVerdict = "OK" | "length-field" | "size" | "signature" | "trailer-magic" | "trailer-length" | "trailer-family" | "trailer-seq" | "trailer-image-len" | "trailer-version" | "downgrade" | "offer-seq" | "not-vote-capable";

/** Contrôles du trailer APRÈS une signature valide (miroir de podota::TrailerGuard::finish, ordre identique). `region` = image ‖ trailer. */
export function checkRegionTrailer(region: Buffer, offer: OfferedRelease, ctx: DeviceContext): DeviceVerdict {
  if (region.length !== offer.size) return "size";
  if (region.length < OTA_TRAILER_LEN + 1) return "trailer-length";
  const t = parseTrailer(region.subarray(region.length - OTA_TRAILER_LEN));
  if (!t.ok) return t.reason === "magic" ? "trailer-magic" : t.reason === "length" ? "trailer-length" : t.reason === "family" ? "trailer-family" : t.reason === "seq" ? "trailer-seq" : t.reason === "imageLen" ? "trailer-image-len" : "trailer-version";
  if (t.trailer.family !== ctx.family) return "trailer-family";
  if (t.trailer.otaSeq !== offer.otaSeq) return "offer-seq";
  if (t.trailer.imageLen !== region.length - OTA_TRAILER_LEN) return "trailer-image-len";
  if (t.trailer.otaSeq <= ctx.installedSeq) return "downgrade";
  if (!voteV2Capable(t.trailer.firmwareVersion)) return "not-vote-capable";
  return "OK";
}

/**
 * Référence TypeScript de ce que fait l'appareil, dans l'ordre exact du firmware (miroir de podOta.h) :
 *  1. champ de longueur de signature == 256 (contrôlé par Updater avant tout hachage) ; 2. taille de la région == taille annoncée ;
 *  3. signature RSA-2048/SHA-256 valide (clé du créneau choisi par keyId) ; 4. trailer (checkRegionTrailer).
 */
export function deviceVerifyFile(file: Buffer, publicPem: string | Buffer, offer: OfferedRelease, ctx: DeviceContext): DeviceVerdict {
  if (file.length < OTA_SIG_LEN + 4 + OTA_TRAILER_LEN + 1) return "length-field";
  if (file.readUInt32LE(file.length - 4) !== OTA_SIG_LEN) return "length-field";
  const region = file.subarray(0, file.length - OTA_SIG_LEN - 4), sig = file.subarray(file.length - OTA_SIG_LEN - 4, file.length - 4);
  if (region.length !== offer.size) return "size";
  try {
    const pub = createPublicKey(publicPem);
    if (pub.asymmetricKeyType !== "rsa" || pub.asymmetricKeyDetails?.modulusLength !== 2048) return "signature";
    if (!cryptoVerify("sha256", region, pub, sig)) return "signature";
  } catch { return "signature"; }
  return checkRegionTrailer(region, offer, ctx);
}

// ── Annonce (offre) reçue par l'appareil : contrôles de plausibilité AVANT tout téléchargement (miroir de podota::checkOffer, ordre identique) ──
export interface DeviceOffer { family: string; firmwareVersion: string; otaSeq: number; minOtaSeq: number; size: number; keySlot: number; urlPath: string }
export interface OfferContext { family: string; installedSeq: number; maxStage: number }       // maxStage = espace libre pour une image (ESP.getFreeSketchSpace)
export type OfferVerdict = "OK" | "field" | "family" | "key-slot" | "url" | "size" | "not-vote-capable" | "not-newer";
const URL_PATH = /^\/firmware\/[A-Za-z0-9._/-]{1,80}$/;

export function checkOffer(o: DeviceOffer, c: OfferContext): OfferVerdict {
  const idOk = (v: string, max: number) => v.length >= 1 && v.length <= max && ASCII_ID.test(v);
  if (!idOk(o.family, OTA_FAMILY_MAX) || !idOk(o.firmwareVersion, OTA_VERSION_MAX) || !Number.isInteger(o.otaSeq) || o.otaSeq < 1 || o.otaSeq > 0xffffffff ||
      !Number.isInteger(o.minOtaSeq) || o.minOtaSeq > o.otaSeq || o.minOtaSeq < 0) return "field";
  if (o.family !== c.family) return "family";
  if (o.keySlot !== 0 && o.keySlot !== 1) return "key-slot";
  if (!URL_PATH.test(o.urlPath) || o.urlPath.includes("..")) return "url";
  if (!Number.isInteger(o.size) || o.size <= OTA_TRAILER_LEN || o.size > OTA_MAX_REGION || o.size + OTA_SIG_LEN + 4 > c.maxStage) return "size";
  if (!voteV2Capable(o.firmwareVersion)) return "not-vote-capable";
  if (o.otaSeq <= c.installedSeq) return "not-newer";
  return "OK";
}

/** SHA-256 hex de la région signée (valeur du champ `sha256` du manifeste). */
export const regionSha256 = (region: Buffer): string => createHash("sha256").update(region).digest("hex");
