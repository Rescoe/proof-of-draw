// lib/ed25519.ts
// Vérification de signature ED25519 côté serveur.
// Utilise le module crypto natif Node.js (disponible sur Vercel / Node 18+).
//
// Format attendu :
//   pubKeyHex  : 64 chars hex = 32 bytes (clé publique brute)
//   message    : string UTF-8 signé par l'ESP ("deviceId:candidateId:score")
//   sigHex     : 128 chars hex = 64 bytes (signature ED25519)

import { createPublicKey, createVerify } from "node:crypto";

// Préfixe SPKI pour ED25519 (RFC 8032 / RFC 5958)
// Permet d'importer une clé publique brute (32 bytes) dans l'API Node.js crypto
// qui attend un format DER-SPKI complet.
// Structure : SEQUENCE { AlgorithmIdentifier { OID 1.3.101.112 } BIT STRING { 0x00 || pubkey } }
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

/**
 * Vérifie une signature ED25519 produite par un ESP8266 (bibliothèque Crypto rhempel).
 *
 * @param pubKeyHex  Clé publique hex 64 chars (stockée dans Device.publicKey)
 * @param message    Message UTF-8 signé : "deviceId:candidateId:score"
 * @param sigHex     Signature hex 128 chars envoyée dans le corps du vote
 * @returns          true si la signature est valide, false sinon
 */
export function verifyEd25519(
  pubKeyHex: string,
  message:   string,
  sigHex:    string,
): boolean {
  // Validation rapide des longueurs avant toute opération crypto
  if (pubKeyHex.length !== 64) return false;
  if (sigHex.length    !== 128) return false;

  try {
    const pubKeyBytes = Buffer.from(pubKeyHex, "hex");
    const sigBytes    = Buffer.from(sigHex,    "hex");
    const msgBytes    = Buffer.from(message,   "utf8");

    // Reconstruction de la clé au format SPKI attendu par Node.js
    const spkiDer = Buffer.concat([ED25519_SPKI_PREFIX, pubKeyBytes]);
    const pubKey  = createPublicKey({ key: spkiDer, format: "der", type: "spki" });

    return createVerify("ed25519").update(msgBytes).verify(pubKey, sigBytes);
  } catch {
    // Clé ou signature malformée → rejet silencieux
    return false;
  }
}
