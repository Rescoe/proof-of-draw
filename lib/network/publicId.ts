// lib/network/publicId.ts — identifiant PUBLIC d'un appareil (serveur seulement).
//
// Le `deviceId` sert d'identifiant aux routes des firmwares (pull, ACK, vote…) : mieux vaut ne pas le répandre dans de nouveaux flux publics.
// `publicId` = HMAC-SHA256(deviceId, secret serveur) tronqué à 12 hex (48 bits) : stable, non réversible (un hachage SANS secret serait
// retrouvable par force brute : 36^8 combinaisons seulement), utilisable pour relier un événement à un noeud d'affichage sans révéler l'identifiant.
// Secret : NETWORK_ID_SECRET, à défaut INTERNAL_API_SECRET, à défaut une constante (développement local).

import { createHmac } from "node:crypto";

const secret = (): string => process.env.NETWORK_ID_SECRET ?? process.env.INTERNAL_API_SECRET ?? "pod-public-id-dev";

export function publicDeviceId(deviceId: string): string {
  return "pub_" + createHmac("sha256", secret()).update(deviceId).digest("hex").slice(0, 12);
}

export const PUBLIC_ID_RE = /^pub_[0-9a-f]{12}$/;
