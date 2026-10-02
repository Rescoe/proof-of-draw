// lib/scene/delivery.ts
// Logique PURE de livraison scene-v1 : capacité appareil, pointeur d'artefact, choix frame|scene (contrat note 37 §2, §6, §7).
// Aucun accès Redis ici — le paquet vit dans lib/scene/store.ts et n'est lu qu'au téléchargement.
//
// Règles de repli (jamais d'erreur côté appareil) :
//   e-ink, appareil sans capability scene-v1, capability insuffisante (fps / entités / taille), artefact absent → frame/capture
//   scène invalide → capture (décidé à l'ingestion : aucun pointeur n'est alors posé)

import { SCENE_MAX_BYTES, SCENE_MAX_ENTITIES, type AnaScene, type SceneCapability } from "./spec";
import { PROFILE_CODE, type ScenePackageProfile } from "./package";
import { playbackMs } from "./engine";

/** Écrans qui savent interpréter une scène. Les e-ink n'en reçoivent JAMAIS (poster calculé côté serveur). */
export const SCENE_SCREENS = Object.keys(PROFILE_CODE) as ScenePackageProfile[];
export const isSceneScreen = (screen: string): screen is ScenePackageProfile => (SCENE_SCREENS as string[]).includes(screen);

/** Classes de capacité compilées par profil (contrat : compile par (contentHash, profil, rendererVersion, classe)). */
export const SCENE_CAPABILITY_CLASSES: Record<ScenePackageProfile, readonly string[]> = {
  oled096: ["f5"],   // OLED pilote : 5 FPS
  tft18: ["f2"],     // TFT : 2 FPS ; "f4" ne s'ajoute qu'après benchmark matériel
};

export const capabilityClassOf = (cap: Pick<SceneCapability, "maxFps">): string => `f${cap.maxFps}`;

/** Identifiant déterministe de l'artefact compilé. */
export function artifactIdFor(contentHash: string, profile: ScenePackageProfile, rendererVersion: number, capClass: string): string {
  return `sc:${contentHash.replace(/^sha256:/, "").slice(0, 32)}:${profile}:r${rendererVersion}:${capClass}`;
}

/** Déclaration d'un appareil, strictement validée ; toute valeur inattendue = « pas de scene-v1 » (jamais d'erreur). */
export function parseSceneCapability(raw: unknown): SceneCapability | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const r = raw as Record<string, unknown>;
  if (r.sceneV1 !== true) return undefined;
  if (r.maxPackageBytes !== 4096 || r.maxEntities !== 24) return undefined;
  if (r.maxFps !== 2 && r.maxFps !== 4 && r.maxFps !== 5) return undefined;
  if (typeof r.dirtyRectangles !== "boolean") return undefined;
  const fw = typeof r.firmwareVersion === "string" ? r.firmwareVersion.slice(0, 32) : "";
  return { sceneV1: true, maxPackageBytes: 4096, maxEntities: 24, maxFps: r.maxFps, dirtyRectangles: r.dirtyRectangles, firmwareVersion: fw };
}

/** Pointeur léger stocké dans la frame de livraison (aucun octet de paquet, jamais de pixels) — ~300 octets. */
export interface ScenePointer {
  artifactIds: Record<string, string>;   // classe de capacité → artifactId
  packageBytes: number;
  sceneHash: string;
  contentHash: string;
  rendererVersion: 1;
  tickRate: number;
  durationTicks: number;
  loopCount: number;
  entityCount: number;
  playMs: number;
}

export function buildScenePointer(
  scene: AnaScene, sceneHash: string, contentHash: string, profile: ScenePackageProfile, packageBytes: number,
): ScenePointer {
  const artifactIds: Record<string, string> = {};
  for (const cls of SCENE_CAPABILITY_CLASSES[profile]) artifactIds[cls] = artifactIdFor(contentHash, profile, 1, cls);
  return {
    artifactIds, packageBytes, sceneHash, contentHash, rendererVersion: 1,
    tickRate: scene.tickRate, durationTicks: scene.durationTicks, loopCount: scene.loopCount,
    entityCount: scene.entities.length, playMs: playbackMs(scene),
  };
}

export function readScenePointer(payload: Record<string, unknown> | null | undefined): ScenePointer | null {
  const p = payload?.scene;
  if (!p || typeof p !== "object" || Array.isArray(p)) return null;
  const s = p as Record<string, unknown>;
  const ids = s.artifactIds;
  if (!ids || typeof ids !== "object") return null;
  const nums = ["packageBytes", "tickRate", "durationTicks", "loopCount", "entityCount", "playMs"] as const;
  for (const k of nums) if (!Number.isSafeInteger(s[k])) return null;
  if (typeof s.sceneHash !== "string" || typeof s.contentHash !== "string") return null;
  return s as unknown as ScenePointer;
}

/** Retire le pointeur d'un payload : le JSON léger de /api/pull ne doit JAMAIS grossir pour un firmware qui n'en veut pas. */
export function withoutScenePointer(meta: Record<string, unknown>): Record<string, unknown> {
  const { scene: _scene, ...rest } = meta;
  void _scene;
  return rest;
}

export type DeliverySelection =
  | { kind: "frame" }
  | { kind: "scene"; artifactId: string; capabilityClass: string; pointer: ScenePointer; fps: number; playMs: number };

/**
 * Cadence réelle de lecture : min(tickRate de la scène, maxFps de l'appareil). AUCUN tick n'est sauté — l'appareil rend
 * chaque tick 0..durationTicks−1 exactement comme le moteur de référence (les golden vectors s'appliquent tels quels) ;
 * un appareil plus lent que la scène joue donc l'animation plus lentement, jamais en sous-échantillonnant.
 */
export const effectiveFps = (pointer: Pick<ScenePointer, "tickRate">, cap: Pick<SceneCapability, "maxFps">): number =>
  Math.min(pointer.tickRate, cap.maxFps);

/** Durée de lecture complète (ms) sur CET appareil : ticks × boucles / cadence réelle. */
export const playMsFor = (pointer: Pick<ScenePointer, "durationTicks" | "loopCount" | "tickRate">, cap: Pick<SceneCapability, "maxFps">): number =>
  Math.ceil((pointer.durationTicks * pointer.loopCount * 1000) / effectiveFps(pointer, cap));

export function selectDelivery(
  device: { sceneCapability?: SceneCapability },
  screen: string | null | undefined,
  payload: Record<string, unknown> | null | undefined,
): DeliverySelection {
  const cap = device.sceneCapability;
  if (!screen || !isSceneScreen(screen) || !cap?.sceneV1) return { kind: "frame" };
  const pointer = readScenePointer(payload);
  if (!pointer) return { kind: "frame" };
  if (pointer.packageBytes > Math.min(cap.maxPackageBytes, SCENE_MAX_BYTES)) return { kind: "frame" };
  if (pointer.entityCount > Math.min(cap.maxEntities, SCENE_MAX_ENTITIES)) return { kind: "frame" };
  const capabilityClass = capabilityClassOf(cap);
  const artifactId = pointer.artifactIds[capabilityClass];
  if (!artifactId) return { kind: "frame" };
  return { kind: "scene", artifactId, capabilityClass, pointer, fps: effectiveFps(pointer, cap), playMs: playMsFor(pointer, cap) };
}

/** Bloc `scene` de la réponse /api/pull : métadonnées SEULES (≈ 200 octets), jamais de pixel ni de paquet. */
export function scenePullMeta(sel: Extract<DeliverySelection, { kind: "scene" }>) {
  return {
    artifactId:    sel.artifactId,
    bytes:         sel.pointer.packageBytes,
    hash:          sel.pointer.sceneHash.replace(/^sha256:/, "").slice(0, 16),
    tickRate:      sel.pointer.tickRate,
    fps:           sel.fps,
    durationTicks: sel.pointer.durationTicks,
    loopCount:     sel.pointer.loopCount,
    playMs:        sel.playMs,
  };
}

/** `retryAfter` d'un appareil en lecture : durée complète des boucles + marge ; aucun poll pendant PLAY (contrat §6). */
export const sceneRetryAfterSec = (sel: Extract<DeliverySelection, { kind: "scene" }>): number => Math.ceil(sel.playMs / 1000) + 30;
