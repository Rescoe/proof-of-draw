// lib/deviceLog.ts — JOURNAL PAR APPAREIL (25/10/2026) : chaque échange d'une carte avec le serveur laisse une ligne lisible par son propriétaire dans l'app (« Gérer » → Journal), 7 jours.
//
// Principe : un enrobage (`withDeviceLog`) autour des routes que les cartes appellent (register, pull, pull-frame, ack-frame, validate-candidate, validation-result, sensor, obs-confirm).
// Il note le résultat de l'échange (méthode, statut, quelques champs utiles) SANS changer la réponse, et n'écrit jamais d'image, de signature, de code d'appairage ni de clé.
// Stockage : liste Redis `devlog:{deviceId}` (la plus récente en tête), 400 lignes au plus, TTL 7 jours renouvelé à chaque écriture ; la lecture écarte aussi les lignes de plus de 7 jours.
// Quota Redis (règle primordiale) : UNE commande (EVAL) par ligne écrite. Un pull « au repos » (rien de nouveau) n'est consigné qu'une fois par heure et par instance serverless (porte en MÉMOIRE : 0 commande) ;
// tout fait nouveau (frame, candidat, annonce OTA, tâche d'observation, erreur) est consigné à chaque fois.
// Au mieux : un échec de journalisation n'interrompt JAMAIS la route.
import type { NextRequest } from "next/server";
import { redis } from "@/lib/redis";

export const DEVLOG_KEEP = 400;
export const DEVLOG_TTL_SEC = 7 * 24 * 3600;
export const DEVLOG_IDLE_PULL_MS = 3_600_000;
export const devLogKey = (deviceId: string) => `devlog:${deviceId}`;

export interface DevLogEntry { t: number; k: string; m: string }

const LOG_SCRIPT = `redis.call('LPUSH', KEYS[1], ARGV[1])
redis.call('LTRIM', KEYS[1], 0, tonumber(ARGV[2]) - 1)
redis.call('EXPIRE', KEYS[1], tonumber(ARGV[3]))
return 1`;

const DEVICE_RE = /^dev_[A-Z0-9]{8}$/;

/** Texte sûr pour une ligne de journal : sans caractère de contrôle, 200 caractères au plus. */
export function cleanText(s: unknown, max = 200): string {
  return String(s ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

export async function devLog(deviceId: string, kind: string, message: string, now: number = Date.now()): Promise<void> {
  if (!DEVICE_RE.test(deviceId)) return;
  const entry: DevLogEntry = { t: now, k: cleanText(kind, 16), m: cleanText(message) };
  try { await redis.eval(LOG_SCRIPT, [devLogKey(deviceId)], [JSON.stringify(entry), String(DEVLOG_KEEP), String(DEVLOG_TTL_SEC)]); }
  catch (e) { console.error("[devlog] écriture impossible:", e instanceof Error ? e.message : "erreur"); }
}

export function parseEntries(raws: unknown[], now: number = Date.now()): DevLogEntry[] {
  const out: DevLogEntry[] = [];
  const min = now - DEVLOG_TTL_SEC * 1000;
  for (const raw of raws ?? []) {
    try {
      const e = (typeof raw === "string" ? JSON.parse(raw) : raw) as Partial<DevLogEntry> | null;
      if (e && typeof e.t === "number" && typeof e.m === "string" && e.t >= min) out.push({ t: e.t, k: typeof e.k === "string" ? e.k : "", m: e.m });
    } catch { /* ligne illisible : ignorée */ }
  }
  return out;
}

export async function readDevLog(deviceId: string, now: number = Date.now()): Promise<DevLogEntry[]> {
  const raws = await redis.lrange(devLogKey(deviceId), 0, DEVLOG_KEEP - 1);
  return parseEntries(raws as unknown[], now);
}

export async function clearDevLog(deviceId: string): Promise<void> {
  await redis.del(devLogKey(deviceId));
}

// ── enrobage des routes ─────────────────────────────────────────────────────────────────────────────────────────────────

type Handler = (req: NextRequest) => Promise<Response>;
const short = (v: unknown) => cleanText(v, 12);
const lastIdle = new Map<string, number>();   // porte « pull au repos » : en MÉMOIRE (0 commande Redis)

/** Champs de la réponse JSON, choisis un par un (jamais d'image, de signature ni de code). */
function describeResponse(route: string, j: Record<string, unknown> | null): { text: string; idle: boolean } {
  if (!j) return { text: "", idle: false };
  const parts: string[] = [];
  const chain = j.chain as Record<string, unknown> | null | undefined;
  const pending = j.pendingValidation as Record<string, unknown> | null | undefined;
  const ota = j.ota as Record<string, unknown> | null | undefined;
  const obs = j.pendingObservation as unknown;
  if (typeof j.error === "string") parts.push(`erreur : ${cleanText(j.error, 120)}`);
  if (route === "pull") {
    if (chain && typeof chain.blockIndex === "number") parts.push(`bloc #${chain.blockIndex}`);
    if (typeof j.frameSource === "string") parts.push(`frame ${j.frameSource}${j.frameSource !== "none" && j.frameId ? " " + short(j.frameId) : ""}`);
    if (pending?.candidateId) parts.push(`candidat ${short(pending.candidateId)} à valider`);
    if (ota) parts.push("mise à jour OTA annoncée");
    if (obs) parts.push("tâche d'observation");
    if (typeof j.retryAfter === "number") parts.push(`prochain pull dans ${j.retryAfter} s`);
    const idle = !pending?.candidateId && !ota && !obs && (j.frameSource === "none" || (typeof j.retryAfter === "number" && j.retryAfter >= 240));
    return { text: parts.join(", "), idle };
  }
  for (const k of ["paired", "registered", "ok", "stored", "blockMined", "approved", "accepted", "duplicate", "cleared"]) if (typeof j[k] === "boolean") parts.push(`${k}=${j[k]}`);
  for (const k of ["nextSec", "count", "decision", "reason", "message", "status"]) if (j[k] !== undefined && typeof j[k] !== "object") parts.push(`${k}=${cleanText(j[k], 60)}`);
  if (typeof j.candidateId === "string") parts.push(`candidat ${short(j.candidateId)}`);
  return { text: parts.join(", "), idle: false };
}

function describeRequest(route: string, b: Record<string, unknown> | null): string {
  if (!b) return "";
  const parts: string[] = [];
  if (typeof b.firmware === "string") parts.push(`firmware ${cleanText(b.firmware, 40)}`);
  if (Array.isArray(b.screens)) parts.push(`écrans ${b.screens.map((s) => cleanText(s, 16)).slice(0, 4).join("+")}`);
  if (Array.isArray(b.sensors)) parts.push(`capteurs ${b.sensors.map((s) => cleanText(s, 8)).slice(0, 4).join("+")}`);
  if (typeof b.frameId === "string") parts.push(`frame ${short(b.frameId)}`);
  if (typeof b.candidateId === "string") parts.push(`candidat ${short(b.candidateId)}`);
  if (b.verdict === "accept" || b.verdict === "reject") parts.push(b.verdict === "accept" ? "vote : ACCEPTE" : "vote : REFUSE");
  if (typeof b.reason === "string" && b.reason) parts.push(`motif ${cleanText(b.reason, 60)}`);
  if (Number(b.v) === 2) parts.push("vote v2");
  if (typeof b.decision === "string") parts.push(`décision ${cleanText(b.decision, 12)}`);
  if (typeof b.approved === "boolean") parts.push(b.approved ? "vote : approuve" : "vote : refuse");
  if (typeof b.score === "number") parts.push(`score ${b.score}`);
  if (Array.isArray(b.r)) parts.push(`${b.r.length} lecture(s)`);
  if (Array.isArray(b.blockHashes)) parts.push(`${b.blockHashes.length} bloc(s) confirmé(s)`);
  return parts.join(", ");
}

const KIND: Record<string, string> = { register: "register", pull: "pull", "pull-frame": "image", "ack-frame": "ack", "validate-candidate": "candidat", "validation-result": "vote", sensor: "capteur", "obs-confirm": "obs" };

export function withDeviceLog(route: string, handler: Handler): Handler {
  return async (req: NextRequest) => {
    let body: Record<string, unknown> | null = null;
    if (req.method !== "GET") {
      try {
        const len = Number(req.headers.get("content-length") ?? "0");
        if ((req.headers.get("content-type") ?? "").includes("json") && len > 0 && len <= 16384) body = await req.clone().json();
      } catch { body = null; }
    }
    const res = await handler(req);
    try {
      const url = new URL(req.url);
      let deviceId = url.searchParams.get("deviceId") ?? (typeof body?.deviceId === "string" ? body.deviceId : "");
      let json: Record<string, unknown> | null = null;
      const type = res.headers.get("content-type") ?? "";
      const size = Number(res.headers.get("content-length") ?? "0");
      if (type.includes("json") && (size === 0 || size <= 8192)) {
        try { json = await res.clone().json(); } catch { json = null; }
      }
      if (!deviceId && typeof json?.deviceId === "string") deviceId = json.deviceId;
      if (!DEVICE_RE.test(deviceId)) return res;
      const d = describeResponse(route, json);
      if (route === "pull" && d.idle && res.status === 200) {
        const last = lastIdle.get(deviceId) ?? 0;
        if (Date.now() - last < DEVLOG_IDLE_PULL_MS) return res;
        lastIdle.set(deviceId, Date.now());
        if (lastIdle.size > 500) lastIdle.clear();
      }
      const extra = route === "pull-frame" ? [res.headers.get("x-frame-total") ? `${res.headers.get("x-frame-total")} o au total` : "", size ? `${size} o envoyés` : ""].filter(Boolean).join(", ") : "";
      const text = [`${req.method} → ${res.status}`, describeRequest(route, body), d.text, extra].filter(Boolean).join(" · ");
      await devLog(deviceId, KIND[route] ?? route, text);
    } catch { /* au mieux : jamais d'impact sur la réponse */ }
    return res;
  };
}
