// tests/helpers/msStrip.ts — ramène le sketch du MULTISCREEN ESP8266 (e-ink 2,7″ + OLED) à son état d'AVANT le portail Wi-Fi / le client OTA / le capteur DHT22 / le profil de distribution (23/10/2026), pour les tests qui prouvent
// qu'un lot antérieur (canari 8B2C, rendu v1…) n'a rien changé au firmware d'avant. Toutes les additions sont encadrées par « POD_MS_BEGIN … POD_MS_END » ; seule autre différence voulue : la version déclarée (2.5 → 2.7).
export function stripMs(src: string): string {
  const out: string[] = []; let skip = false;
  for (const line of src.split("\n")) {
    if (line.includes("POD_MS_BEGIN")) { skip = true; continue; }
    if (skip) { if (line.includes("POD_MS_END")) skip = false; continue; }
    out.push(line);
  }
  return out.join("\n").replace('#define FIRMWARE_VERSION "multiscreen-2.7"', '#define FIRMWARE_VERSION "multiscreen-2.5"');
}
export const isMsIno = (p: string): boolean => p.split("\\").join("/").endsWith("esp8266/esp_eink_2.7BW_OLED/esp_eink_2.7BW_OLED.ino");
