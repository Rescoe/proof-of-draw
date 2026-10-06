import { SCREEN_PROFILES, type ScreenId, type ScreenProfile } from "../../../lib/screenProfiles";
import { WIRING, type WiringSpec } from "../wiring";

export type BoardId = "esp8266" | "unoR4";
export type InstallScreenId = "eink29bwr" | "eink27bwSolo" | "eink27bwOled" | "tft18" | "tft28";
export type InstallProfileId = "eink29bwr" | "eink27bwSolo" | "eink27bwOled" | "tft18" | "r4Eink29" | "r4Tft28";

export interface LibraryRequirement {
  name: string;
  version: string;
  purpose: string;
}

export interface BoardProfile {
  id: BoardId;
  name: string;
  shortName: string;
  arduinoPackage: string;
  arduinoMenu: string[];
  networkLibraries: string;
}

export interface InstallScreenOption {
  id: InstallScreenId;
  label: string;
  technicalSummary: string;
  moduleReference: string;
  accent: string;
}

export interface InstallProfile {
  id: InstallProfileId;
  boardId: BoardId;
  installScreenId: InstallScreenId;
  screenIds: ScreenId[];
  screens: ScreenProfile[];
  firmwareVariant: string;
  firmwareFilename: string;
  firmwareFolder: string;
  firmwareEntryFile: string;
  moduleReference: string;
  shortDescription: string;
  wiringIntro: string;
  wiring: WiringSpec[];
  optionalWiring?: WiringSpec;
  /** Version du firmware qui sait jouer les animations (blocs d'animation), pour les écrans concernés. */
  animationFirmware?: string;
  specificLibraries: LibraryRequirement[];
  accent: string;
  testedOnHardware: boolean;
  statusNote?: string;
}

export const BOARD_PROFILES: Record<BoardId, BoardProfile> = {
  esp8266: {
    id: "esp8266",
    name: "NodeMCU v1 (ESP8266 / ESP-12E)",
    shortName: "ESP8266",
    arduinoPackage: "esp8266 by ESP8266 Community",
    arduinoMenu: ["Outils", "Type de carte", "ESP8266 Boards", "NodeMCU 1.0 (ESP-12E Module)"],
    networkLibraries: "ESP8266WiFi, ESP8266HTTPClient, EEPROM, SPI et SD sont incluses avec le cœur ESP8266.",
  },
  unoR4: {
    id: "unoR4",
    name: "Arduino UNO R4 WiFi",
    shortName: "UNO R4 WiFi",
    arduinoPackage: "Arduino UNO R4 Boards by Arduino",
    arduinoMenu: ["Outils", "Type de carte", "Arduino UNO R4 Boards", "Arduino UNO R4 WiFi"],
    networkLibraries: "WiFiS3, EEPROM, SPI et SD sont fournies avec le cœur Arduino UNO R4.",
  },
};

export const COMMON_LIBRARIES: LibraryRequirement[] = [
  { name: "ArduinoJson", version: "7.x ou plus récent", purpose: "Lecture des réponses JSON du serveur." },
  { name: "QRCode", version: "dernière version — Richard Moore", purpose: "Génération du QR code d’appairage." },
  { name: "Crypto", version: "dernière version — Rhys Weatherley", purpose: "Génération des clés et signature Ed25519." },
];

function screens(...ids: ScreenId[]) {
  return ids.map((id) => SCREEN_PROFILES[id]);
}

export const INSTALL_SCREEN_OPTIONS: InstallScreenOption[] = [
  { id: "eink29bwr", label: 'E-Ink 2.9" BWR', technicalSummary: "296 × 128 · noir, blanc et rouge", moduleReference: "Waveshare 2.9inch e-Paper B V4", accent: "#ef4444" },
  { id: "eink27bwSolo", label: 'E-Ink 2.7" BW', technicalSummary: "264 × 176 · noir et blanc", moduleReference: "Waveshare 2.7inch e-Paper V2", accent: "#e5e7eb" },
  { id: "eink27bwOled", label: 'E-Ink 2.7" BW + OLED', technicalSummary: "E-ink principal + OLED 0.96″ d’informations", moduleReference: "Waveshare 2.7inch e-Paper V2 + OLED SSD1306 I²C", accent: "#22d3ee" },
  { id: "tft18", label: 'TFT 1.8" couleur', technicalSummary: "128 × 160 · ST7735S", moduleReference: "ST7735S 1.8inch TFT", accent: "#f59e0b" },
  { id: "tft28", label: 'TFT 2.8" tactile', technicalSummary: "240 × 320 · ILI9341 + tactile + microSD", moduleReference: "Shield TFT 2.8inch ILI9341 / STMPE610", accent: "#2dd4bf" },
];

export const INSTALL_PROFILES: Record<InstallProfileId, InstallProfile> = {
  eink29bwr: {
    id: "eink29bwr", boardId: "esp8266", installScreenId: "eink29bwr",
    screenIds: ["eink29bwr"], screens: screens("eink29bwr"),
    firmwareVariant: "eink29bwr", firmwareFilename: "pod-firmware-eink29bwr.zip",
    firmwareFolder: "esp_eink_2.9BWR", firmwareEntryFile: "esp_eink_2.9BWR.ino",
    moduleReference: "Waveshare 2.9inch e-Paper B V4",
    shortDescription: "Trois couleurs, noir, blanc et rouge. Variante ESP8266 recommandée pour débuter.",
    wiringIntro: "Reliez les huit fils du module aux broches D0 à D8 indiquées sur le NodeMCU.",
    wiring: [WIRING.eink29bwr], specificLibraries: [], accent: "#ef4444", testedOnHardware: true,
  },
  eink27bwSolo: {
    id: "eink27bwSolo", boardId: "esp8266", installScreenId: "eink27bwSolo",
    screenIds: ["eink27bw"], screens: screens("eink27bw"),
    firmwareVariant: "eink27bwSolo", firmwareFilename: "pod-firmware-eink27bw-solo.zip",
    firmwareFolder: "esp_eink_2.7BW", firmwareEntryFile: "esp_eink_2.7BW.ino",
    moduleReference: "Waveshare 2.7inch e-Paper V2",
    shortDescription: "Écran e-ink noir et blanc utilisé seul, sans OLED secondaire.",
    wiringIntro: "Reliez les huit fils du module aux broches D0 à D8 indiquées sur le NodeMCU.",
    wiring: [WIRING.eink27bw], specificLibraries: [], accent: "#e5e7eb", testedOnHardware: true,
  },
  eink27bwOled: {
    id: "eink27bwOled", boardId: "esp8266", installScreenId: "eink27bwOled",
    screenIds: ["eink27bw", "oled096"], screens: screens("eink27bw", "oled096"),
    firmwareVariant: "eink27bw", firmwareFilename: "pod-firmware-eink27bw-oled.zip",
    firmwareFolder: "esp_eink_2.7BW_OLED", firmwareEntryFile: "esp_eink_2.7BW_OLED.ino",
    moduleReference: "Waveshare 2.7inch e-Paper V2 + OLED SSD1306 I²C",
    shortDescription: "Double écran : l’e-ink affiche l’œuvre et l’OLED présente les informations réseau.",
    wiringIntro: "Câblez d’abord l’e-ink, puis ajoutez l’OLED sur les deux broches I²C indiquées.",
    animationFirmware: "multiscreen-2.2", wiring: [WIRING.eink27bw, WIRING.oled],
    specificLibraries: [
      { name: "Adafruit GFX Library", version: "dernière version", purpose: "Base graphique de l’écran OLED." },
      { name: "Adafruit SSD1306", version: "dernière version", purpose: "Pilote de l’OLED 0.96\"." },
    ],
    accent: "#22d3ee", testedOnHardware: true,
  },
  tft18: {
    id: "tft18", boardId: "esp8266", installScreenId: "tft18",
    screenIds: ["tft18"], screens: screens("tft18"),
    firmwareVariant: "tft18", firmwareFilename: "pod-firmware-tft18.zip",
    firmwareFolder: "esp_tft1.8", firmwareEntryFile: "esp_tft1.8.ino",
    moduleReference: "ST7735S 1.8inch TFT",
    shortDescription: "Écran couleur à rafraîchissement rapide. Le lecteur de carte SD reste facultatif.",
    wiringIntro: "Reliez le TFT au bus SPI du NodeMCU. Le lecteur microSD peut être ajouté ensuite.",
    wiring: [WIRING.tft18], optionalWiring: WIRING.tftSd, animationFirmware: "tft18-2.2",
    specificLibraries: [
      { name: "Adafruit GFX Library", version: "dernière version", purpose: "Base graphique de l’écran TFT." },
      { name: "Adafruit ST7735 and ST7789 Library", version: "dernière version", purpose: "Pilote du TFT 1.8\"." },
    ],
    accent: "#f59e0b", testedOnHardware: true,
  },
  r4Eink29: {
    id: "r4Eink29", boardId: "unoR4", installScreenId: "eink29bwr",
    screenIds: ["eink29bwr"], screens: screens("eink29bwr"),
    firmwareVariant: "r4Eink29", firmwareFilename: "pod-firmware-r4-eink29bwr.zip",
    firmwareFolder: "pod_uno_r4_eink29", firmwareEntryFile: "pod_uno_r4_eink29.ino",
    moduleReference: "Waveshare 2.9inch e-Paper B V4",
    shortDescription: "Le même e-ink trois couleurs, piloté par une UNO R4 WiFi avec buffers statiques.",
    wiringIntro: "Utilisez le SPI matériel de la R4 : DIN sur D11 et CLK sur D13, puis les quatre lignes de contrôle.",
    wiring: [WIRING.r4Eink29], specificLibraries: [], accent: "#ef4444", testedOnHardware: false,
    statusNote: "Le firmware compile et son lecteur réseau est testé sur PC, mais cette combinaison doit encore être validée sur une carte physique.",
  },
  r4Tft28: {
    id: "r4Tft28", boardId: "unoR4", installScreenId: "tft28",
    screenIds: ["tft28"], screens: screens("tft28"),
    firmwareVariant: "r4Tft28", firmwareFilename: "pod-firmware-r4-tft28.zip",
    firmwareFolder: "pod_uno_r4", firmwareEntryFile: "pod_uno_r4.ino",
    moduleReference: "Shield TFT 2.8inch ILI9341 / STMPE610",
    shortDescription: "Écran couleur tactile avec microSD, conçu comme un shield à enficher directement sur l’UNO R4 WiFi.",
    wiringIntro: "Enfichez le shield sur la R4 sans fils volants. Le schéma rappelle les broches SPI et les sélections utilisées.",
    wiring: [WIRING.r4Tft28], animationFirmware: "r4tft28-2.4",
    specificLibraries: [
      { name: "Adafruit GFX Library", version: "dernière version", purpose: "Base graphique du TFT." },
      { name: "Adafruit ILI9341", version: "dernière version", purpose: "Pilote de l’écran 2.8\"." },
      { name: "Adafruit BusIO", version: "dernière version", purpose: "Bus matériel utilisé par les pilotes Adafruit." },
      { name: "Adafruit STMPE610", version: "dernière version", purpose: "Contrôleur tactile du shield." },
    ],
    accent: "#2dd4bf", testedOnHardware: false,
    statusNote: "Le firmware, le serveur et le lecteur HTTP sont vérifiés sans matériel ; le parcours complet Wi-Fi, tactile et microSD reste à tester sur la carte.",
  },
};

export const INSTALL_PROFILE_LIST = Object.values(INSTALL_PROFILES);

export function isBoardId(value: string | null): value is BoardId {
  return value === "esp8266" || value === "unoR4";
}

export function isInstallProfileId(value: string | null): value is InstallProfileId {
  return !!value && value in INSTALL_PROFILES;
}

export function isInstallScreenId(value: string | null): value is InstallScreenId {
  return !!value && INSTALL_SCREEN_OPTIONS.some((screen) => screen.id === value);
}

export function profileForSelection(screenId: InstallScreenId, boardId: BoardId) {
  return INSTALL_PROFILE_LIST.find((profile) => profile.installScreenId === screenId && profile.boardId === boardId);
}

export function resolveInstallProfileId(screenValue: string | null, boardValue: string | null): InstallProfileId {
  if (isInstallScreenId(screenValue) && isBoardId(boardValue)) {
    return profileForSelection(screenValue, boardValue)?.id
      ?? INSTALL_PROFILE_LIST.find((profile) => profile.installScreenId === screenValue)?.id
      ?? INSTALL_PROFILES.eink29bwr.id;
  }
  if (isInstallProfileId(screenValue)) return screenValue;
  if (isInstallScreenId(screenValue)) {
    return INSTALL_PROFILE_LIST.find((profile) => profile.installScreenId === screenValue)?.id ?? INSTALL_PROFILES.eink29bwr.id;
  }
  return INSTALL_PROFILES.eink29bwr.id;
}

export function profileLabel(profile: InstallProfile) {
  return profile.screens.map((screen) => screen.name).join(" + ");
}

export function profileTechnicalSummary(profile: InstallProfile) {
  return profile.screens.map((screen) => screen.description).join(" · ");
}
