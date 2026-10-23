// tests/helpers/bwrStrip.ts — ramène le sketch ESP8266 e-ink 2,9″ BWR à son état d'AVANT le portail Wi-Fi / le client OTA / le profil de distribution (23/10/2026), pour les tests qui prouvent
// qu'un lot antérieur (canari, rendu v1…) n'a rien changé au firmware d'avant. Toutes les additions sont encadrées par « POD_BWR_BEGIN … POD_BWR_END » ; seule autre différence voulue : le glyphe « / » de la police 5×7.
export function stripBwr(src: string): string {
  const out: string[] = []; let skip = false;
  for (const line of src.split("\n")) {
    if (line.includes("POD_BWR_BEGIN")) { skip = true; continue; }
    if (skip) { if (line.includes("POD_BWR_END")) skip = false; continue; }
    out.push(line);
  }
  return out.join("\n").replace("{0x20,0x10,0x08,0x04,0x02},{0x00,0x00,0x00,0x00,0x00},", "{0x02,0x01,0x02,0x04,0x02},{0x00,0x00,0x00,0x00,0x00},");
}
export const isBwrIno = (p: string): boolean => p.split("\\").join("/").endsWith("esp8266/esp_eink_2.9BWR/esp_eink_2.9BWR.ino");
