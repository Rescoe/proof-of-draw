// lib/scene/store.ts
// Stockage Redis des paquets ANAS : UN seul paquet ≤ 4 Ko par artifactId, écrit à la compilation, lu au téléchargement.
// Jamais une copie par appareil, jamais une commande par frame, aucun SCAN (contrat note 37 §7, §9).
// Le client Redis est injecté : tests sans Redis, comptage de commandes vérifiable.

import { packScene, type ScenePackageProfile } from "./package";
import type { AnaScene } from "./spec";
import {
  SCENE_CAPABILITY_CLASSES, SCENE_SCREENS, artifactIdFor, buildScenePointer, type ScenePointer,
} from "./delivery";

export interface SceneKV {
  set(key: string, value: string, opts?: { nx?: boolean; ex?: number }): Promise<unknown>;
  get(key: string): Promise<unknown>;
}

// Contenu de galerie durable : on garde le paquet longtemps (TTL obligatoire sur tout objet Redis du projet).
const PACKAGE_TTL_SEC = 90 * 24 * 3600;

export const packageKey = (artifactId: string) => `scene:pkg:${artifactId}`;

/** Écrit le paquet s'il n'existe pas (SET NX : une commande, idempotent — « compilé une seule fois »). */
export async function putScenePackage(kv: SceneKV, artifactId: string, bytes: Uint8Array): Promise<"written" | "exists"> {
  const r = await kv.set(packageKey(artifactId), Buffer.from(bytes).toString("base64"), { nx: true, ex: PACKAGE_TTL_SEC });
  return r === "OK" ? "written" : "exists";
}

/** Lit le paquet : UNE commande GET. null si absent / illisible. */
export async function getScenePackage(kv: SceneKV, artifactId: string): Promise<Uint8Array | null> {
  const raw = await kv.get(packageKey(artifactId));
  if (typeof raw !== "string" || raw.length === 0) return null;
  return new Uint8Array(Buffer.from(raw, "base64"));
}

/**
 * Compile la scène pour chaque profil/classe de capacité et pose les paquets. Retourne un pointeur léger par profil
 * (à glisser dans la frame de livraison). Idempotent : relancé sur le même contentHash, n'écrase rien.
 */
export async function compileSceneArtifacts(
  kv: SceneKV, args: { scene: AnaScene; sceneHash: string; contentHash: string },
): Promise<Record<ScenePackageProfile, ScenePointer>> {
  const pointers = {} as Record<ScenePackageProfile, ScenePointer>;
  for (const profile of SCENE_SCREENS) {
    const bytes = packScene(args.scene, profile, args.sceneHash);
    for (const cls of SCENE_CAPABILITY_CLASSES[profile]) {
      await putScenePackage(kv, artifactIdFor(args.contentHash, profile, 1, cls), bytes);
    }
    pointers[profile] = buildScenePointer(args.scene, args.sceneHash, args.contentHash, profile, bytes.length);
  }
  return pointers;
}
