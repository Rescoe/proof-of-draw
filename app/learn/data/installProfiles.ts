import { SCREEN_PROFILES, type ScreenId, type ScreenProfile } from "../../../lib/screenProfiles";
import { WIRING, type WiringSpec } from "../wiring";

export type InstallProfileId = "eink29bwr" | "eink27bwSolo" | "eink27bwOled" | "tft18";

export interface LibraryRequirement {
  name: string;
  version: string;
  purpose: string;
}

export interface InstallProfile {
  id: InstallProfileId;
  screenIds: ScreenId[];
  screens: ScreenProfile[];
  firmwareVariant: string;
  firmwareFilename: string;
  firmwareFolder: string;
  moduleReference: string;
  shortDescription: string;
  wiring: WiringSpec[];
  optionalWiring?: WiringSpec;
  /** Version du firmware qui sait jouer les animations (blocs d'animation), pour les écrans concernés. Voir lib/anim/pointer.ts. */
  animationFirmware?: string;
  specificLibraries: LibraryRequirement[];
  accent: string;
}

export const COMMON_LIBRARIES: LibraryRequirement[] = [
  {
    name: "ArduinoJson",
    version: "7.x ou plus récent",
    purpose: "Lecture des réponses JSON du serveur.",
  },
  {
    name: "QRCode",
    version: "dernière version — Richard Moore",
    purpose: "Génération du QR code d’appairage.",
  },
  {
    name: "Crypto",
    version: "dernière version — Rhys Weatherley",
    purpose: "Génération des clés et signature Ed25519.",
  },
];

function screens(...ids: ScreenId[]) {
  return ids.map((id) => SCREEN_PROFILES[id]);
}

export const INSTALL_PROFILES: Record<InstallProfileId, InstallProfile> = {
  eink29bwr: {
    id: "eink29bwr",
    screenIds: ["eink29bwr"],
    screens: screens("eink29bwr"),
    firmwareVariant: "eink29bwr",
    firmwareFilename: "pod-firmware-eink29bwr.zip",
    firmwareFolder: "esp_eink_2.9BWR",
    moduleReference: "Waveshare 2.9inch e-Paper B V4",
    shortDescription: "Trois couleurs, noir, blanc et rouge. Variante recommandée pour débuter.",
    wiring: [WIRING.eink29bwr],
    specificLibraries: [],
    accent: "#ef4444",
  },
  eink27bwSolo: {
    id: "eink27bwSolo",
    screenIds: ["eink27bw"],
    screens: screens("eink27bw"),
    firmwareVariant: "eink27bwSolo",
    firmwareFilename: "pod-firmware-eink27bw-solo.zip",
    firmwareFolder: "esp_eink_2.7BW",
    moduleReference: "Waveshare 2.7inch e-Paper V2",
    shortDescription: "Écran e-ink noir et blanc utilisé seul, sans OLED secondaire.",
    wiring: [WIRING.eink27bw],
    specificLibraries: [],
    accent: "#e5e7eb",
  },
  eink27bwOled: {
    id: "eink27bwOled",
    screenIds: ["eink27bw", "oled096"],
    screens: screens("eink27bw", "oled096"),
    firmwareVariant: "eink27bw",
    firmwareFilename: "pod-firmware-eink27bw-oled.zip",
    firmwareFolder: "esp_eink_2.7BW_OLED",
    moduleReference: "Waveshare 2.7inch e-Paper V2 + OLED SSD1306 I²C",
    shortDescription: "Double écran : l’e-ink affiche l’œuvre et l’OLED présente les informations réseau.",
    animationFirmware: "multiscreen-2.2",
    wiring: [WIRING.eink27bw, WIRING.oled],
    specificLibraries: [
      {
        name: "Adafruit GFX Library",
        version: "dernière version",
        purpose: "Base graphique de l’écran OLED.",
      },
      {
        name: "Adafruit SSD1306",
        version: "dernière version",
        purpose: "Pilote de l’OLED 0.96\".",
      },
    ],
    accent: "#22d3ee",
  },
  tft18: {
    id: "tft18",
    screenIds: ["tft18"],
    screens: screens("tft18"),
    firmwareVariant: "tft18",
    firmwareFilename: "pod-firmware-tft18.zip",
    firmwareFolder: "esp_tft1.8",
    moduleReference: "ST7735S 1.8inch TFT",
    shortDescription: "Écran couleur à rafraîchissement rapide. Le lecteur de carte SD reste facultatif.",
    wiring: [WIRING.tft18],
    optionalWiring: WIRING.tftSd,
    animationFirmware: "tft18-2.2",
    specificLibraries: [
      {
        name: "Adafruit GFX Library",
        version: "dernière version",
        purpose: "Base graphique de l’écran TFT.",
      },
      {
        name: "Adafruit ST7735 and ST7789 Library",
        version: "dernière version",
        purpose: "Pilote du TFT 1.8\".",
      },
    ],
    accent: "#f59e0b",
  },
};

export const INSTALL_PROFILE_LIST = Object.values(INSTALL_PROFILES);

export function isInstallProfileId(value: string | null): value is InstallProfileId {
  return !!value && value in INSTALL_PROFILES;
}

export function profileLabel(profile: InstallProfile) {
  return profile.screens.map((screen) => screen.name).join(" + ");
}

export function profileTechnicalSummary(profile: InstallProfile) {
  return profile.screens.map((screen) => screen.description).join(" · ");
}
