// lib/deviceTime.ts — heure locale d'un appareil (25/10/2026) : fuseau horaire choisi dans l'app (« Gérer l'écran »), par défaut Europe/Paris.
// Sert à (1) écrire l'horodatage du cartel dans l'heure de l'écran (sans « (Paris) ») et (2) donner à l'ESP le décalage UTC courant (`tzo`, en minutes) pour dater ses mesures.
// Fonctions pures (Intl uniquement) ; le décalage est recalculé à chaque contact, donc le changement d'heure d'été est suivi sans règle sur la carte.
export const DEFAULT_TIMEZONE = "Europe/Paris";
const TZ_SHAPE = /^(UTC|[A-Za-z]+(?:\/[A-Za-z0-9_+\-]+){1,2})$/;

export function isValidTimezone(tz: unknown): tz is string {
  if (typeof tz !== "string" || tz.length === 0 || tz.length > 64 || !TZ_SHAPE.test(tz)) return false;
  try { new Intl.DateTimeFormat("fr-FR", { timeZone: tz }); return true; } catch { return false; }
}
export const timezoneOf = (d: { timezone?: string } | null | undefined): string => (d && isValidTimezone(d.timezone) ? d.timezone : DEFAULT_TIMEZONE);

function partsIn(tz: string, epochMs: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of new Intl.DateTimeFormat("en-GB", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(new Date(epochMs)))
    if (p.type !== "literal") out[p.type] = Number(p.value);
  return out;
}
/** Décalage de `tz` par rapport à UTC, en minutes, à l'instant donné (ex. Paris en été : 120). */
export function utcOffsetMinutes(tz: string, epochMs: number): number {
  const p = partsIn(tz, epochMs);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - Math.floor(epochMs / 1000) * 1000) / 60000);
}
const pad2 = (n: number) => String(n).padStart(2, "0");
/** « JJ/MM HH:MM » dans le fuseau donné. */
export function formatLocalShort(epochMs: number, tz: string): string {
  const p = partsIn(tz, epochMs);
  return `${pad2(p.day)}/${pad2(p.month)} ${pad2(p.hour)}:${pad2(p.minute)}`;
}
/** « JJ/MM/AAAA HH:MM (Paris) » (format historique du cartel, heure de Paris) → instant UTC en ms ; null si le texte n'est pas de ce format. */
export function parseParisCartelTs(ts: string | null | undefined): number | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2})(?: \(Paris\))?$/.exec(String(ts ?? "").trim());
  if (!m) return null;
  const [d, mo, y, h, mi] = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5])];
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59) return null;
  const naive = Date.UTC(y, mo - 1, d, h, mi);
  let utc = naive - utcOffsetMinutes("Europe/Paris", naive) * 60000;          // deux passes : le décalage dépend de l'instant cherché (changement d'heure)
  utc = naive - utcOffsetMinutes("Europe/Paris", utc) * 60000;
  return utc;
}
/** Horodatage du cartel d'un écran à capteur : heure locale courte « JJ/MM HH:MM », sans « (Paris) » ; null si le texte source est inconnu. */
export function cartelTimestampFor(ts: string | null | undefined, tz: string): string | null {
  const ms = parseParisCartelTs(ts);
  return ms === null ? null : formatLocalShort(ms, tz);
}
