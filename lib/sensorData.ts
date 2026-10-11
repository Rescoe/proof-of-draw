// lib/sensorData.ts — capteur de température (UNO R4 WiFi + DHT22) : fonctions PURES (aucun accès Redis, testées dans tests/sensor.test.ts).
//
// Un appareil « capteur » s'enregistre avec screens = ["sensor"] : ce n'est PAS un écran. Il ne reçoit aucune frame, ne vote pas, n'entre ni dans les pools
// d'écrans, ni dans devices:all (sinon il gonflerait le quorum de validation), ni dans la vue réseau. Il poste au plus UNE mesure par heure.
//
// COÛT REDIS par appareil et par heure (règle PRIMORDIALE, CLAUDE.md) : limite IP 2 + GET appareil 1 + SET NX (anti-rafale, 3 000 s) 1 + LPUSH/LTRIM/EXPIRE 3
// + réécriture de la fiche (présence) 1 = 8 commandes/h ≈ 5 800/mois et par capteur. Lecture de l'historique (propriétaire, à l'ouverture du panneau) : 1 LRANGE.

export const SENSOR_SCREEN = "sensor";
/** Intervalle minimal accepté entre deux mesures d'un même capteur (le firmware poste toutes les 60 min). */
export const SENSOR_MIN_INTERVAL_SEC = 3000;
/** Mesures conservées : 31 jours d'une mesure par heure. */
export const SENSOR_KEEP = 24 * 31;
export const SENSOR_TTL_SEC = 40 * 24 * 3600;

export const sensorKey = (deviceId: string) => `sensor:t:${deviceId}`;
export const sensorGateKey = (deviceId: string) => `sensor:gate:${deviceId}`;

/** Vrai pour un appareil capteur (seul écran déclaré = « sensor »). */
export function isSensorScreens(screens: unknown): boolean {
  return Array.isArray(screens) && screens.length === 1 && screens[0] === SENSOR_SCREEN;
}

export interface SensorReading {
  /** secondes Unix (horloge du SERVEUR : la carte n'a pas d'horloge) */
  t: number;
  /** température en dixièmes de °C (215 = 21,5 °C) */
  c: number;
  /** humidité relative en dixièmes de % (456 = 45,6 %), absente si non fournie */
  h?: number;
}

export type ParsedReading = { ok: true; c: number; h?: number } | { ok: false; error: string };

const isInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v);

/** Valide le corps envoyé par la carte : c en dixièmes de °C [-400, 800] (plage du DHT22), h en dixièmes de % [0, 1000] facultatif. */
export function parseReading(body: unknown): ParsedReading {
  if (!body || typeof body !== "object") return { ok: false, error: "corps invalide" };
  const b = body as Record<string, unknown>;
  if (!isInt(b.c) || b.c < -400 || b.c > 800) return { ok: false, error: "c (dixièmes de °C, -400..800) requis" };
  if (b.h !== undefined && b.h !== null) {
    if (!isInt(b.h) || b.h < 0 || b.h > 1000) return { ok: false, error: "h (dixièmes de %, 0..1000) invalide" };
    return { ok: true, c: b.c, h: b.h };
  }
  return { ok: true, c: b.c };
}

/** Une mesure = une courte chaîne « t,c,h » (≈ 20 o) : la liste de 744 mesures pèse ≈ 15 Ko. */
export function encodeReading(r: SensorReading): string {
  return `${r.t},${r.c},${r.h === undefined ? "" : r.h}`;
}

export function decodeReading(raw: unknown): SensorReading | null {
  if (typeof raw !== "string") return null;
  const p = raw.split(",");
  if (p.length !== 3) return null;
  const t = Number(p[0]), c = Number(p[1]);
  if (!Number.isInteger(t) || !Number.isInteger(c) || t <= 0) return null;
  if (p[2] === "") return { t, c };
  const h = Number(p[2]);
  return Number.isInteger(h) ? { t, c, h } : { t, c };
}

/** Du plus récent au plus ancien (ordre LPUSH) ; les entrées illisibles sont ignorées. */
export function decodeReadings(raws: unknown[]): SensorReading[] {
  const out: SensorReading[] = [];
  for (const r of raws) { const d = decodeReading(r); if (d) out.push(d); }
  return out;
}

export interface SensorSummary { count: number; min: number | null; max: number | null; avg: number | null; last: SensorReading | null }

/** Résumé sur les mesures données (dixièmes de °C ; moyenne arrondie au dixième). */
export function summarize(readings: SensorReading[]): SensorSummary {
  if (readings.length === 0) return { count: 0, min: null, max: null, avg: null, last: null };
  let min = Infinity, max = -Infinity, sum = 0, last = readings[0];
  for (const r of readings) { if (r.c < min) min = r.c; if (r.c > max) max = r.c; sum += r.c; if (r.t > last.t) last = r; }
  return { count: readings.length, min, max, avg: Math.round(sum / readings.length), last };
}

/** « 21,5 °C » depuis des dixièmes. */
export function formatTemp(c: number): string { return `${(c / 10).toFixed(1).replace(".", ",")} °C`; }
export function formatHum(h: number): string { return `${(h / 10).toFixed(1).replace(".", ",")} %`; }

/** Nombre d'heures demandé par l'interface : entier borné à [1, SENSOR_KEEP], 168 (7 jours) par défaut. */
export function clampHours(raw: unknown): number {
  const n = Math.floor(Number(raw));
  return Number.isFinite(n) && n >= 1 ? Math.min(n, SENSOR_KEEP) : 168;
}
