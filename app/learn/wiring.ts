// app/learn/wiring.ts
// Données de câblage affichées dans l'onglet Apprendre. Chaque entrée est relevée
// dans le firmware correspondant (chemin indiqué) — à garder synchrone avec eux.
//
// Fait matériel important : sur ESP8266, le SPI matériel (SPI.begin()) utilise des
// broches FIXES : SCK = GPIO14 (D5), MOSI = GPIO13 (D7). Elles n'apparaissent donc
// dans aucun #define des e-ink (epdif.h ne définit que RST, DC, CS, BUSY) mais
// doivent être câblées : CLK → D5, DIN → D7.

export interface WireDef {
  node:   string;   // étiquette NodeMCU (D5, 3V3, GND…)
  pin:    string;   // étiquette sérigraphiée du module
  color:  string;   // couleur du fil (celles du câble Waveshare pour les e-ink)
  note?:  string;
}

export interface WiringSpec {
  id:         string;
  title:      string;
  moduleName: string;
  wires:      WireDef[];           // dans l'ordre des broches du module
  nodeOrder:  string[];            // ordre d'affichage côté NodeMCU
  gpio:       Record<string, string>;
}

/** Étiquette NodeMCU → GPIO ESP8266 (identique pour toutes les cartes NodeMCU v1 / ESP-12E). */
export const NODEMCU_GPIO: Record<string, string> = {
  D0: "GPIO16", D1: "GPIO5", D2: "GPIO4", D3: "GPIO0", D4: "GPIO2",
  D5: "GPIO14", D6: "GPIO12", D7: "GPIO13", D8: "GPIO15",
};

const NODE_ORDER = ["D0", "D1", "D2", "D4", "D5", "D6", "D7", "D8", "3V3", "GND"];

// Couleurs du câble fourni avec les modules e-Paper Waveshare
const WS = {
  VCC: "#9ca3af", GND: "#92400e", DIN: "#2563eb", CLK: "#eab308",
  CS: "#f97316", DC: "#16a34a", RST: "#f8fafc", BUSY: "#9333ea",
};

// Source : esp8266/esp_eink_2.9BWR/epdif.h, esp_eink_2.7BW/epdif.h, esp_eink_2.7BW_OLED/epdif.h
// (RST D1, DC D2, CS D8, BUSY D0) + SPI matériel ESP8266 (CLK D5, DIN D7).
const EINK_WIRES: WireDef[] = [
  { pin: "VCC",  node: "3V3",  color: WS.VCC,  note: "Alimentation 3,3 V uniquement (pas 5 V)" },
  { pin: "GND",  node: "GND",  color: WS.GND },
  { pin: "DIN",  node: "D7",   color: WS.DIN,  note: "Données (MOSI) — SPI matériel, broche imposée" },
  { pin: "CLK",  node: "D5",   color: WS.CLK,  note: "Horloge (SCK) — SPI matériel, broche imposée" },
  { pin: "CS",   node: "D8",   color: WS.CS,   note: "Chip select — doit être bas au démarrage (la carte le garantit)" },
  { pin: "DC",   node: "D2",   color: WS.DC,   note: "Données / commande" },
  { pin: "RST",  node: "D1",   color: WS.RST,  note: "Reset" },
  { pin: "BUSY", node: "D0",   color: WS.BUSY, note: "Occupé (lu par l'ESP pour attendre la fin du rafraîchissement)" },
];

export const WIRING: Record<"eink29bwr" | "eink27bw" | "oled" | "tft18" | "tftSd", WiringSpec> = {
  eink29bwr: {
    id: "eink29bwr",
    title: 'E-Ink 2.9" BWR — firmware esp_eink_2.9BWR',
    moduleName: 'e-Paper 2.9" B V4',
    wires: EINK_WIRES, nodeOrder: NODE_ORDER, gpio: NODEMCU_GPIO,
  },
  eink27bw: {
    id: "eink27bw",
    title: 'E-Ink 2.7" BW — firmwares esp_eink_2.7BW et esp_eink_2.7BW_OLED',
    moduleName: 'e-Paper 2.7" V2',
    wires: EINK_WIRES, nodeOrder: NODE_ORDER, gpio: NODEMCU_GPIO,
  },
  // Source : esp8266/esp_eink_2.7BW_OLED/esp_eink_2.7BW_OLED.ino (OLED_SDA D6, OLED_SCL D4, adresse I2C 0x3C, reset -1)
  oled: {
    id: "oled",
    title: "OLED 0.96″ (SSD1306, I²C) — en plus de l'e-ink 2.7″, firmware esp_eink_2.7BW_OLED",
    moduleName: 'OLED 0.96" I²C',
    wires: [
      { pin: "VCC", node: "3V3", color: "#dc2626", note: "3,3 V (même rail que l'e-ink)" },
      { pin: "GND", node: "GND", color: "#111827", note: "Masse commune avec l'e-ink" },
      { pin: "SCL", node: "D4",  color: "#eab308", note: "Horloge I²C (GPIO2). Les modules OLED ont leurs résistances de tirage : D4 reste haut au démarrage" },
      { pin: "SDA", node: "D6",  color: "#2563eb", note: "Données I²C (GPIO12). Adresse de l'écran : 0x3C" },
    ],
    nodeOrder: NODE_ORDER, gpio: NODEMCU_GPIO,
  },
  // Source : esp8266/esp_tft1.8/esp_tft1.8.ino (TFT_CS 4, TFT_DC 5, TFT_RST 16, TFT_MOSI 13, TFT_SCK 14)
  tft18: {
    id: "tft18",
    title: 'TFT 1.8" ST7735 — firmware esp_tft1.8',
    moduleName: 'TFT 1.8" (ST7735)',
    wires: [
      { pin: "VCC", node: "3V3", color: "#dc2626", note: "3,3 V" },
      { pin: "GND", node: "GND", color: "#111827" },
      { pin: "CS",  node: "D2",  color: "#f97316", note: "Chip select de l'écran" },
      { pin: "RES", node: "D0",  color: "#f8fafc", note: "Reset" },
      { pin: "DC",  node: "D1",  color: "#16a34a", note: "Données / commande (parfois noté A0)" },
      { pin: "SDA", node: "D7",  color: "#2563eb", note: "Données (MOSI)" },
      { pin: "SCL", node: "D5",  color: "#eab308", note: "Horloge (SCK)" },
      { pin: "BLK", node: "3V3", color: "#9333ea", note: "Rétroéclairage : relié au 3,3 V = toujours allumé" },
    ],
    nodeOrder: NODE_ORDER, gpio: NODEMCU_GPIO,
  },
  // Connecteur carte SD du module TFT — OPTIONNEL (le firmware démarre sans : sdAvailable = SD.begin(SD_CS))
  tftSd: {
    id: "tftSd",
    title: "Carte SD du module TFT (optionnelle) — bus partagé avec l'écran",
    moduleName: "Lecteur SD du module",
    wires: [
      { pin: "CS",   node: "D4", color: "#f97316", note: "Chip select de la SD (GPIO2, haut au démarrage = SD désélectionnée)" },
      { pin: "MOSI", node: "D7", color: "#2563eb", note: "Même fil que SDA de l'écran (bus partagé)" },
      { pin: "SCLK", node: "D5", color: "#eab308", note: "Même fil que SCL de l'écran (bus partagé)" },
      { pin: "MISO", node: "D6", color: "#16a34a", note: "Uniquement côté SD (l'écran n'a pas de MISO)" },
    ],
    nodeOrder: NODE_ORDER, gpio: NODEMCU_GPIO,
  },
};
