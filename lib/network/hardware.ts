// lib/network/hardware.ts — famille de carte d'un appareil, déduite de la version de firmware qu'il a déclarée (pur, testé).
// Une chaîne inconnue donne « unknown » : jamais de supposition silencieuse (un ancien firmware « 2.0 » est le e-ink 2.9" sur ESP8266).

export type Hardware = "esp8266" | "uno-r4" | "unknown";

export function hardwareOfFirmware(firmware: string | null | undefined): Hardware {
  const f = String(firmware ?? "").trim().toLowerCase();
  if (!f) return "unknown";
  if (/^r4/.test(f) || /uno[ -]?r4/.test(f)) return "uno-r4";
  if (/^(multiscreen|tft18|eink27bw|eink29bwr)-/.test(f)) return "esp8266";
  if (/^\d+\.\d+$/.test(f)) return "esp8266";
  return "unknown";
}

export const HARDWARE_LABEL: Record<Hardware, string> = {
  "esp8266": "ESP8266",
  "uno-r4": "UNO R4 WiFi",
  "unknown": "Matériel inconnu",
};
