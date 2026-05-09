// SECURITY MOCKED - activate after MVP
// Replace with real JWT, MQTT tokens, rate-limiting DB

export interface AuthContext {
  userId: string;
  token: string;
}

/** @mock Always returns true — replace with real JWT check */
export async function checkAuth(req?: Request): Promise<boolean> {
  // TODO: verify Authorization header, validate JWT
  void req;
  return true;
}

/** @mock Always returns true — replace with Redis/KV rate limiter */
export async function rateLimit(
  key: string,
  windowMs = 15 * 60 * 1000
): Promise<boolean> {
  // TODO: check request count per key in Redis within windowMs
  void key;
  void windowMs;
  return true;
}

/** @mock Always returns true — replace with DB quota check */
export async function quotaDaily(userId: string): Promise<boolean> {
  // TODO: check daily frame send count per user in DB
  void userId;
  return true;
}

export function generateDeviceId(name: string, ip: string): string {
  return `${name.toLowerCase().replace(/[^a-z0-9]/g, "-")}-${ip.replace(/[.:]/g, "")}`;
}
