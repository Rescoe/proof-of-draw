// lib/session.ts
// Cookie signé HMAC-SHA256 — zéro dépendance externe
// Le cookie contient { deviceIds: string[] } — les devices que ce client a onboardé
//
// Usage :
//   import { getSession, setSession } from "@/lib/session"
//   const session = await getSession()           // dans un Route Handler
//   const res = NextResponse.json(...)
//   await setSession(res, { deviceIds: [...] })
//   return res

import { cookies } from "next/headers";
import { NextResponse } from "next/server";

const COOKIE_NAME = "esp_session";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30 jours

// SECRET : mets SESSION_SECRET dans ton .env(.local)
// Fallback dev uniquement — en prod ce fallback ne doit pas être utilisé
function getSecret(): string {
  const s = process.env.SESSION_SECRET;
  if (!s) {
    console.warn("[session] ⚠️  SESSION_SECRET manquant — fallback dev UNIQUEMENT");
    return "dev_fallback_secret_change_in_production_please";
  }
  return s;
}

// ─── HMAC-SHA256 via WebCrypto (dispo dans Next.js Edge + Node 18+) ──────────
async function hmacSign(payload: string): Promise<string> {
  const secret = getSecret();
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return Buffer.from(sig).toString("base64url");
}

async function hmacVerify(payload: string, sig: string): Promise<boolean> {
  const expected = await hmacSign(payload);
  // timing-safe compare via crypto.subtle
  const a = new TextEncoder().encode(expected);
  const b = new TextEncoder().encode(sig);
  if (a.length !== b.length) return false;
  // WebCrypto n'a pas de timingSafeEqual natif simple, on fait XOR
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

// ─── Encode / decode ─────────────────────────────────────────────────────────
async function encode(data: SessionData): Promise<string> {
  const payload = Buffer.from(JSON.stringify(data)).toString("base64url");
  const sig = await hmacSign(payload);
  return `${payload}.${sig}`;
}

async function decode(token: string): Promise<SessionData | null> {
  const dot = token.lastIndexOf(".");
  if (dot === -1) return null;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const valid = await hmacVerify(payload, sig);
  if (!valid) return null;
  try {
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

// ─── Types ───────────────────────────────────────────────────────────────────
export interface SessionData {
  deviceIds: string[]; // devices que ce client a le droit de contrôler
}

// ─── API publique ─────────────────────────────────────────────────────────────

/** Lit la session depuis le cookie. Retourne { deviceIds: [] } si absent/invalide. */
export async function getSession(): Promise<SessionData> {
  const cookieStore = await cookies();
  const raw = cookieStore.get(COOKIE_NAME)?.value;
  if (!raw) return { deviceIds: [] };
  const data = await decode(raw);
  return data ?? { deviceIds: [] };
}

/** Écrit la session dans la réponse fournie. */
export async function setSession(
  res: NextResponse,
  data: SessionData
): Promise<void> {
  const token = await encode(data);
  res.cookies.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: COOKIE_MAX_AGE,
    path: "/",
  });
}

/** Ajoute un deviceId à la session existante (déduplique). */
export async function addDeviceToSession(
  res: NextResponse,
  deviceId: string
): Promise<void> {
  const current = await getSession();
  const ids = Array.from(new Set([...current.deviceIds, deviceId]));
  await setSession(res, { deviceIds: ids });
}

/** Vérifie qu'un deviceId est dans la session courante. */
export async function sessionOwnsDevice(deviceId: string): Promise<boolean> {
  const session = await getSession();
  return session.deviceIds.includes(deviceId);
}