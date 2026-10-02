// lib/scene/hash.ts
// Hashes du contrat scene-v1 (note 37 §4). SERVEUR / TESTS uniquement (node:crypto) : l'aperçu galerie
// n'a pas besoin de hasher. Chaque formule est la copie littérale du contrat — ne pas « simplifier ».

import { createHash } from "node:crypto";
import { SIN_Q15_256 } from "./spec";

export const sha256Raw = (data: string | Uint8Array): string =>
  createHash("sha256").update(data as never).digest("hex");

/** sceneHash = sha256(UTF8("ana-scene-v1\0" + canonicalSceneJson)) */
export const hashSceneJson = (canonicalJson: string): string => `sha256:${sha256Raw(`ana-scene-v1\0${canonicalJson}`)}`;

/** sourceHash = sha256(octets UTF-8 exacts de artworkText) — aucune normalisation Unicode. */
export const hashArtworkSource = (artworkText: string): string => `sha256:${sha256Raw(artworkText)}`;

/** contentHash = sha256(UTF8("ana-generative-bundle-v1\0" + sourceId \0 revision \0 sourceHash \0 sceneHash|none \0 captureHash|none)) */
export function hashGenerativeBundle(
  sourceId: string, revision: number, sourceHash: string, sceneHash?: string, captureHash?: string,
): string {
  return `sha256:${sha256Raw(`ana-generative-bundle-v1\0${sourceId}\0${revision}\0${sourceHash}\0${sceneHash ?? "none"}\0${captureHash ?? "none"}`)}`;
}

/** Hash des 512 octets int16 little-endian de la table sinus (comparé à SIN_Q15_HASH). */
export function hashSinTable(table: readonly number[] = SIN_Q15_256): string {
  const bytes = Buffer.alloc(table.length * 2);
  table.forEach((v, i) => bytes.writeInt16LE(v, i * 2));
  return sha256Raw(bytes);
}
