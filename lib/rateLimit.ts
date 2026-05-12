// lib/rateLimit.ts
// Rate limiting, blacklist automatique et device cap — tout centralisé ici.
// Toutes les règles sont pilotées par variables d'environnement.
// Zéro logique métier dans ce fichier.

import { redis } from "@/lib/redis";
import { NextRequest, NextResponse } from "next/server";

// ─── Config (variables d'env avec fallbacks stricts) ─────────────────────────
const MAX_ACTIVE_DEVICES       = parseInt(process.env.MAX_ACTIVE_DEVICES       ?? "50");
const REGISTER_LIMIT           = parseInt(process.env.REGISTER_LIMIT_PER_MINUTE ?? "5");   // par IP, par minute
const ONBOARD_LIMIT            = parseInt(process.env.ONBOARD_LIMIT_PER_MINUTE  ?? "10");  // par IP, par minute
const PULL_LIMIT               = parseInt(process.env.PULL_LIMIT_PER_WINDOW     ?? "6");   // par deviceId, par 10min
const PING_LIMIT               = parseInt(process.env.PING_LIMIT_PER_HOUR       ?? "6");   // par deviceId, par heure
const DRAW_LIMIT               = parseInt(process.env.DRAW_LIMIT_PER_MINUTE     ?? "10");  // par IP, par minute
const ABUSE_STRIKE_THRESHOLD   = parseInt(process.env.ABUSE_STRIKE_THRESHOLD    ?? "10");  // nb de rejets avant blacklist
const BLACKLIST_TTL            = parseInt(process.env.BLACKLIST_TTL_SECONDS      ?? String(7 * 24 * 3600)); // 7 jours par défaut
const AUTO_BLACKLIST_ENABLED   = process.env.AUTO_BLACKLIST_ENABLED !== "false"; // true par défaut

// ─── Helpers clés Redis ───────────────────────────────────────────────────────
const key = {
  blacklistIP:     (ip: string)       => `bl:ip:${ip}`,
  blacklistDevice: (id: string)       => `bl:dev:${id}`,
  strikes:         (id: string)       => `strikes:${id}`,
  rateLimit:       (route: string, id: string) => `rl:${route}:${id}`,
  deviceCount:     ()                 => `meta:device_count`,
};

// ─── Blacklist ────────────────────────────────────────────────────────────────

/** Vérifie si une IP ou un deviceId est blacklisté. */
export async function isBlacklisted(ip: string, deviceId?: string): Promise<boolean> {
  const checks: Promise<string | null>[] = [redis.get(key.blacklistIP(ip))];
  if (deviceId) checks.push(redis.get(key.blacklistDevice(deviceId)));
  const results = await Promise.all(checks);
  return results.some((r) => r !== null);
}

/** Blackliste manuellement une IP ou un device. */
export async function blacklist(target: string, type: "ip" | "device"): Promise<void> {
  const k = type === "ip" ? key.blacklistIP(target) : key.blacklistDevice(target);
  await redis.set(k, "1", { ex: BLACKLIST_TTL });
  console.warn(`[blacklist] ${type}=${target} blacklisté pour ${BLACKLIST_TTL}s`);
}

/** Retire un blacklist (pour futur panneau admin). */
export async function unblacklist(target: string, type: "ip" | "device"): Promise<void> {
  const k = type === "ip" ? key.blacklistIP(target) : key.blacklistDevice(target);
  await redis.del(k);
}

/** Incrémente le compteur de strikes. Auto-blacklist si seuil atteint. */
async function strike(id: string, type: "ip" | "device"): Promise<void> {
  if (!AUTO_BLACKLIST_ENABLED) return;
  const k = key.strikes(id);
  const count = await redis.incr(k);
  if (count === 1) await redis.expire(k, 3600); // fenêtre 1h
  if (count >= ABUSE_STRIKE_THRESHOLD) {
    await blacklist(id, type);
    await redis.del(k);
    console.warn(`[blacklist] auto-blacklist ${type}=${id} après ${count} strikes`);
  }
}

// ─── Rate limit générique ─────────────────────────────────────────────────────

interface RateLimitOptions {
  route:      string;
  id:         string;        // IP ou deviceId
  limit:      number;        // nb max de requêtes
  windowSec:  number;        // fenêtre en secondes
  strikeId?:  string;        // ID à striker en cas d'abus (IP ou deviceId)
  strikeType?: "ip" | "device";
}

interface RateLimitResult {
  allowed:    boolean;
  retryAfter: number;        // secondes restantes si bloqué
}

export async function checkRateLimit(opts: RateLimitOptions): Promise<RateLimitResult> {
  const k = key.rateLimit(opts.route, opts.id);
  const count = await redis.incr(k);
  if (count === 1) await redis.expire(k, opts.windowSec);

  if (count > opts.limit) {
    const ttl = await redis.ttl(k);
    // Strike si dépassement répété (count >> limite = comportement abusif)
    if (opts.strikeId && count >= opts.limit * 3) {
      await strike(opts.strikeId, opts.strikeType ?? "ip");
    }
    return { allowed: false, retryAfter: ttl > 0 ? ttl : opts.windowSec };
  }

  return { allowed: true, retryAfter: 0 };
}

// ─── Device cap global ────────────────────────────────────────────────────────

/** Vérifie si le plafond global de devices est atteint. */
export async function isDeviceCapReached(): Promise<boolean> {
  const count = await redis.get<number>(key.deviceCount());
  return (count ?? 0) >= MAX_ACTIVE_DEVICES;
}

/** Incrémente le compteur global de devices (appelé à chaque nouveau register). */
export async function incrementDeviceCount(): Promise<void> {
  await redis.incr(key.deviceCount());
}

/** Décrémente le compteur (appelé à la suppression d'un device). */
export async function decrementDeviceCount(): Promise<void> {
  await redis.decr(key.deviceCount());
}

// ─── Helper IP ────────────────────────────────────────────────────────────────
export function getIP(req: NextRequest): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0].trim() ??
    req.headers.get("x-real-ip") ??
    "unknown"
  );
}

// ─── Réponse 429 standard ─────────────────────────────────────────────────────
export function tooManyRequests(retryAfter: number): NextResponse {
  return NextResponse.json(
    { error: "Trop de requêtes. Réessayez plus tard.", retryAfter },
    {
      status: 429,
      headers: {
        "Retry-After": String(retryAfter),
        "X-RateLimit-Reset": String(Math.floor(Date.now() / 1000) + retryAfter),
      },
    }
  );
}

export function forbidden(reason: string): NextResponse {
  return NextResponse.json({ error: reason }, { status: 403 });
}