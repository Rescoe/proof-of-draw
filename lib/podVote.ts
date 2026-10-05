// lib/podVote.ts — vote « v2 » : l'appareil a RECALCULÉ le hash du contenu et les métriques, puis signe son verdict (pur, sans Redis).
// Spécification : docs/CHANTIER_VALIDATION_REELLE.md § 5.1-5.4. Remplace l'écho du `score_server` (constat F1).

import { createHash } from "node:crypto";
import { PPM, METRICS_VERSION, isPodScreen, metricsFromRaw, rawContent, type PodScreen } from "@/lib/podMetrics";

/** Ce que le serveur annonce d'un candidat statique et que les appareils recalculent. */
export interface CandidateV2 {
  metricsVersion: typeof METRICS_VERSION;
  screen: PodScreen;
  /** SHA-256 hex du contenu brut canonique (tampon unique, ou noir ‖ rouge pour l'e-ink 2,9″). */
  rawHash: string;
  rawBytes: number;
  e: number; t: number; r: number; s: number;   // ppm
}

export type VoteVerdict = "accept" | "reject";
export const REJECT_REASONS = ["hash", "metrics", "blank", "noise", "format", "rules"] as const;
export type RejectReason = (typeof REJECT_REASONS)[number];

export const sha256Raw = (raw: Uint8Array): string => createHash("sha256").update(raw).digest("hex");

/** Candidat statique → spécification v2 ; null pour une animation ou un écran non géré. */
export function buildCandidateV2(screen: string, payload: { buffer?: string; black?: string; red?: string }): CandidateV2 | null {
  if (!isPodScreen(screen)) return null;
  try {
    const raw = rawContent(screen, payload);
    const m = metricsFromRaw(screen, raw);
    return { metricsVersion: METRICS_VERSION, screen, rawHash: sha256Raw(raw), rawBytes: raw.length, e: m.e, t: m.t, r: m.r, s: m.s };
  } catch { return null; }
}

/** Message signé par l'appareil : lie l'appareil, le candidat, le contenu, les métriques et le verdict. */
export function voteMessageV2(v: { deviceId: string; candidateId: string; rawHash: string; e: number; t: number; r: number; verdict: VoteVerdict }): string {
  return `pod-vote-v2|${v.deviceId}|${v.candidateId}|${v.rawHash}|${METRICS_VERSION}|${v.e}|${v.t}|${v.r}|${v.verdict}`;
}

export interface VoteV2Body {
  deviceId: string; candidateId: string; rawHash: string;
  e: number; t: number; r: number;
  verdict: VoteVerdict; reason?: string;
}

const isPpm = (n: unknown): n is number => typeof n === "number" && Number.isInteger(n) && n >= 0 && n <= PPM;

/** Lecture défensive du corps JSON d'un vote v2 (null = format invalide). */
export function parseVoteV2(body: Record<string, unknown>): VoteV2Body | null {
  const { deviceId, candidateId, rawHash, e, t, r, verdict, reason } = body;
  if (typeof deviceId !== "string" || typeof candidateId !== "string" || typeof rawHash !== "string" || !/^[0-9a-f]{64}$/.test(rawHash)) return null;
  if (!isPpm(e) || !isPpm(t) || !isPpm(r)) return null;
  if (verdict !== "accept" && verdict !== "reject") return null;
  if (reason !== undefined && !(REJECT_REASONS as readonly string[]).includes(String(reason))) return null;
  return { deviceId, candidateId, rawHash, e, t, r, verdict, reason: reason as string | undefined };
}

export type VoteCheck =
  | { ok: true; verdict: VoteVerdict; suspect: boolean }
  | { ok: false; reason: "hash" | "metrics" };

/**
 * Un `accept` doit reproduire EXACTEMENT le hash et les métriques du serveur (calcul entier : tolérance zéro). Un `reject` signé est toujours recevable ;
 * il est marqué `suspect` si l'appareil invoque hash/métriques alors que ses valeurs sont identiques à celles du serveur (alimente la réputation, phase P5).
 */
export function checkVoteV2(c: CandidateV2, v: VoteV2Body): VoteCheck {
  const hashOk = v.rawHash === c.rawHash;
  const metricsOk = v.e === c.e && v.t === c.t && v.r === c.r;
  if (v.verdict === "accept") {
    if (!hashOk) return { ok: false, reason: "hash" };
    if (!metricsOk) return { ok: false, reason: "metrics" };
    return { ok: true, verdict: "accept", suspect: false };
  }
  const claimsMismatch = v.reason === "hash" || v.reason === "metrics";
  return { ok: true, verdict: "reject", suspect: claimsMismatch && hashOk && metricsOk };
}
