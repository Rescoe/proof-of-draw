// lib/scene/bundle.ts
// Revalidation d'un bundle générative ANA `schemaVersion: 2` côté PoD (contrat note 37 §2, §4, §8).
// Fonction PURE (node:crypto pour les hashes uniquement). Ne lève jamais : retourne un statut observable.
//   - le manifeste repasse le parseur strict (aucune correction silencieuse) ;
//   - la forme canonique est RECALCULÉE : sceneHash et bytes annoncés doivent correspondre ;
//   - sourceHash de la scène = sourceHash du bundle ;
//   - contentHash et suffixe de l'id sont recalculés depuis (sourceId, revision, sourceHash, sceneHash, captureHash).
// Tout écart invalide la SCÈNE (jamais la capture, qui garde son propre contrôle) : fallback capture + erreur visible.

import type { AnaScene } from "./spec";
import { validateScene } from "./validate";
import { hashSceneJson, hashGenerativeBundle } from "./hash";

export interface SceneStatusOk {
  status: "ok";
  scene: AnaScene;
  sceneHash: string;
  bytes: number;
  canonicalJson: string;
}
export interface SceneStatusInvalid { status: "invalid"; errors: string[] }
export interface SceneStatusAbsent { status: "absent" }
export type SceneStatus = SceneStatusOk | SceneStatusInvalid | SceneStatusAbsent;

const rec = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const SHA = /^sha256:[0-9a-f]{64}$/;

export function evaluateSceneBundle(raw: Record<string, unknown>): SceneStatus {
  if (raw.scene === undefined) return { status: "absent" };
  const s = rec(raw.scene);
  if (!s) return { status: "invalid", errors: ["scene: objet attendu"] };

  const errors: string[] = [];
  if (s.schema !== "ana-scene-v1") errors.push("scene.schema ≠ ana-scene-v1");
  if (s.encoding !== "json") errors.push("scene.encoding ≠ json");
  if (s.rendererVersion !== 1) errors.push("scene.rendererVersion ≠ 1");

  const check = validateScene(s.manifest);
  if (!check.valid || !check.scene || check.canonicalJson === undefined || check.bytes === undefined) {
    return { status: "invalid", errors: [...errors, ...check.errors].slice(0, 8) };
  }

  const sceneHash = hashSceneJson(check.canonicalJson);
  if (typeof s.sceneHash !== "string" || s.sceneHash !== sceneHash) errors.push("sceneHash annoncé ≠ hash recalculé de la forme canonique");
  if (s.bytes !== check.bytes) errors.push(`bytes annoncé (${String(s.bytes)}) ≠ octets canoniques (${check.bytes})`);

  const sourceHash = raw.sourceHash;
  if (typeof sourceHash !== "string" || !SHA.test(sourceHash)) errors.push("sourceHash du bundle absent ou mal formé");
  if (s.sourceHash !== sourceHash) errors.push("scene.sourceHash ≠ sourceHash du bundle (scène d'une autre révision du HTML)");

  // contentHash + suffixe d'id : recalculés avec le captureHash éventuel du même bundle.
  const sourceId = raw.sourceId, revision = raw.revision;
  const cap = rec(raw.capture);
  const captureHash = cap && typeof cap.captureHash === "string" ? cap.captureHash : undefined;
  if (typeof sourceId !== "string" || !sourceId) errors.push("sourceId manquant");
  else if (!Number.isSafeInteger(revision) || (revision as number) < 1) errors.push("revision invalide");
  else if (typeof sourceHash === "string") {
    const contentHash = hashGenerativeBundle(sourceId, revision as number, sourceHash, sceneHash, captureHash);
    if (raw.contentHash !== contentHash) errors.push("contentHash du bundle ≠ hash recalculé");
    if (raw.id !== `ana-work:${sourceId}:generative:${contentHash.slice("sha256:".length)}`) errors.push("id du bundle ≠ ana-work:<sourceId>:generative:<contentHash>");
  }

  if (errors.length > 0) return { status: "invalid", errors: errors.slice(0, 8) };
  return { status: "ok", scene: check.scene, sceneHash, bytes: check.bytes, canonicalJson: check.canonicalJson };
}
