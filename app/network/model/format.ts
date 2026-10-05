// Formateurs purs utilisés par le graphe et ses panneaux.

export function shortId(value: string, head = 8, tail = 4): string {
  if (value.length <= head + tail + 1) return value;
  return `${value.slice(0, head)}…${value.slice(-tail)}`;
}

export function relativeTime(timestamp: number, now = Date.now()): string {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return "jamais";
  const seconds = Math.max(0, Math.floor((now - timestamp) / 1_000));
  if (seconds < 10) return "à l’instant";
  if (seconds < 60) return `il y a ${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `il y a ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `il y a ${hours} h`;
  return `il y a ${Math.floor(hours / 24)} j`;
}

export function normaliseLabel(value: string | null | undefined): string {
  return String(value ?? "").trim().toLocaleLowerCase("fr");
}

export function displayModeLabel(mode?: "frame" | "scene", isAnimation?: boolean): string {
  if (isAnimation) return "animation";
  return mode === "scene" ? "scène" : "image";
}

