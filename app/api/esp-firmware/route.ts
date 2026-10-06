// app/api/esp-firmware/route.ts
// GET /api/esp-firmware?variant=all|eink29bwr|eink27bw|tft18|r4Eink29|r4Eink27|r4Eink27Oled|r4Tft18|r4Tft28
// Retourne un ZIP contenant le(s) dossier(s) de firmware correspondant(s).
// Fonctionne uniquement avec le runtime Node.js (fs disponible).

import { NextRequest, NextResponse } from "next/server";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import JSZip from "jszip";

export const runtime = "nodejs";

const FIRMWARE_ROOTS = {
  esp8266: join(process.cwd(), "esp8266"),
  arduino_uno_r4: join(process.cwd(), "arduino_uno_r4"),
} as const;

type FirmwareSource = {
  root: "esp8266" | "arduino_uno_r4";
  folder: string;
};

type FirmwareVariant = {
  label: string;
  board: "ESP8266 / NodeMCU" | "Arduino UNO R4 WiFi" | "plusieurs cartes";
  sources: FirmwareSource[];
  statusWarning?: string;
};

export const FIRMWARE_VARIANTS: Record<string, FirmwareVariant> = {
  eink29bwr: { label: "pod-firmware-eink29bwr", board: "ESP8266 / NodeMCU", sources: [{ root: "esp8266", folder: "esp_eink_2.9BWR" }] },
  eink27bw: { label: "pod-firmware-eink27bw-oled", board: "ESP8266 / NodeMCU", sources: [{ root: "esp8266", folder: "esp_eink_2.7BW_OLED" }] },
  eink27bwSolo: { label: "pod-firmware-eink27bw-solo", board: "ESP8266 / NodeMCU", sources: [{ root: "esp8266", folder: "esp_eink_2.7BW" }] },
  tft18: { label: "pod-firmware-tft18", board: "ESP8266 / NodeMCU", sources: [{ root: "esp8266", folder: "esp_tft1.8" }] },
  r4Eink29: {
    label: "pod-firmware-r4-eink29bwr",
    board: "Arduino UNO R4 WiFi",
    sources: [{ root: "arduino_uno_r4", folder: "pod_uno_r4_eink29" }],
    statusWarning: "Cette combinaison compile et a été testée côté protocole, mais sa validation sur écran physique reste à confirmer.",
  },
  r4Eink27: {
    label: "pod-firmware-r4-eink27bw",
    board: "Arduino UNO R4 WiFi",
    sources: [{ root: "arduino_uno_r4", folder: "pod_uno_r4_eink27" }],
    statusWarning: "PORT NON TESTÉ SUR LE MATÉRIEL (06/10/2026) : e-ink 2,7 pouces seul sur UNO R4 WiFi.",
  },
  r4Eink27Oled: {
    label: "pod-firmware-r4-eink27bw-oled",
    board: "Arduino UNO R4 WiFi",
    sources: [{ root: "arduino_uno_r4", folder: "pod_uno_r4_eink27_oled" }],
    statusWarning: "PORT NON TESTÉ SUR LE MATÉRIEL (06/10/2026) : multiscreen e-ink 2,7 pouces + OLED sur UNO R4 WiFi. Images fixes seulement avant validation.",
  },
  r4Tft18: {
    label: "pod-firmware-r4-tft18",
    board: "Arduino UNO R4 WiFi",
    sources: [{ root: "arduino_uno_r4", folder: "pod_uno_r4_tft18" }],
    statusWarning: "PORT NON TESTÉ SUR LE MATÉRIEL (06/10/2026) : TFT 1,8 pouces sur UNO R4 WiFi. Images fixes seulement avant validation.",
  },
  r4Tft28: {
    label: "pod-firmware-r4-tft28",
    board: "Arduino UNO R4 WiFi",
    sources: [{ root: "arduino_uno_r4", folder: "pod_uno_r4" }],
    statusWarning: "Cette combinaison compile et a été testée côté protocole, mais sa validation sur écran physique reste à confirmer.",
  },
  all: {
    label: "pod-firmware-all",
    board: "plusieurs cartes",
    statusWarning: "L’archive complète contient des ports marqués NON TESTÉS SUR LE MATÉRIEL. Lire l’en-tête de chaque sketch avant téléversement.",
    sources: [
      { root: "esp8266", folder: "esp_eink_2.9BWR" },
      { root: "esp8266", folder: "esp_eink_2.7BW_OLED" },
      { root: "esp8266", folder: "esp_eink_2.7BW" },
      { root: "esp8266", folder: "esp_tft1.8" },
      { root: "arduino_uno_r4", folder: "pod_uno_r4_eink29" },
      { root: "arduino_uno_r4", folder: "pod_uno_r4_eink27" },
      { root: "arduino_uno_r4", folder: "pod_uno_r4_eink27_oled" },
      { root: "arduino_uno_r4", folder: "pod_uno_r4_tft18" },
      { root: "arduino_uno_r4", folder: "pod_uno_r4" },
    ],
  },
};

async function addDirToZip(zip: JSZip, dirPath: string, zipPrefix: string) {
  const entries = await readdir(dirPath, { withFileTypes: true });
  await Promise.all(
    entries.map(async (entry) => {
      const fullPath = join(dirPath, entry.name);
      if (entry.isDirectory()) {
        await addDirToZip(zip, fullPath, `${zipPrefix}/${entry.name}`);
      } else {
        // Les identifiants Wi-Fi restent toujours locaux, même si un secrets.h
        // existe sur la machine qui construit l'archive.
        if (entry.name.toLowerCase() === "secrets.h") return;
        const content = await readFile(fullPath);
        zip.file(`${zipPrefix}/${entry.name}`, content);
      }
    }),
  );
}

export async function GET(req: NextRequest) {
  const variant = req.nextUrl.searchParams.get("variant") ?? "all";
  const config = FIRMWARE_VARIANTS[variant];

  if (!config) {
    return NextResponse.json({ error: "Variante inconnue" }, { status: 400 });
  }

  try {
    const zip = new JSZip();
    for (const source of config.sources) {
      const dirPath = join(FIRMWARE_ROOTS[source.root], source.folder);
      await addDirToZip(zip, dirPath, source.folder);
    }

    // Ajouter un README succinct
    zip.file(
      "README.txt",
      [
        "Proof-of-Draw — Firmware écran",
        "================================",
        "",
        `Carte : ${config.board}`,
        "",
        "Contenu de cette archive :",
        config.sources.map((source) => `  • ${source.folder}/`).join("\n"),
        "",
        "Étapes :",
        "  1. Ouvrir le dossier correspondant à votre écran dans Arduino IDE",
        "  2. Ne pas modifier l’adresse du serveur pour rejoindre le réseau public",
        config.board === "Arduino UNO R4 WiFi"
          ? "  3. Copier secrets.h.example en secrets.h, puis renseigner SECRET_WIFI_SSID et SECRET_WIFI_PASSWORD"
          : "  3. Modifier WIFI_SSID et WIFI_PASSWORD dans le fichier .ino",
        `  4. Sélectionner la bonne carte (${config.board}) puis téléverser`,
        "",
        "Wi-Fi : réseau 2,4 GHz uniquement (WPA2) ; si vous changez de box, mettez à jour les identifiants Wi-Fi",
        "et téléversez à nouveau. Moniteur série : 115200 bauds.",
        ...(config.statusWarning ? ["", `⚠ ${config.statusWarning}`] : []),
        "",
        "Bibliothèques Arduino requises (Gestionnaire de bibliothèques) :",
        "  • ArduinoJson >= 7.x (des avertissements « DynamicJsonDocument deprecated » à la compilation sont normaux)",
        "  • QRCode (Richard Moore)",
        "  • Crypto (Rhys Weatherley) — signature Ed25519",
        "  • TFT 1.8\" : Adafruit GFX Library + Adafruit ST7735 and ST7789 Library",
        "  • e-ink 2.7\" avec OLED : Adafruit GFX Library + Adafruit SSD1306",
        "  • TFT 2.8\" R4 : Adafruit GFX + ILI9341 + BusIO + STMPE610",
        "  (Les bibliothèques Wi-Fi, EEPROM, SPI et SD de la carte sont fournies avec son cœur Arduino.)",
        "",
        "⚠ Firmwares tft18 et e-ink 2.7\" + OLED (v2.1) : ils contiennent la lecture des animations du banc d'essai, écrite le 03/10/2026 et NON TESTÉE sur le matériel.",
        "  Ce code reste inactif (le banc d'essai de l'application a été retiré le 06/10/2026 : plus aucune interface n'active ce mode) ; le reste du firmware est inchangé.",
        "  Un firmware d'avant l'ajout est conservé dans le dépôt : firmware-backups/2026-10-03_avant-integration-animation/.",
        "",
        "Plus d'infos : https://proof-of-draw.vercel.app/learn",
        "",
        "Licence : MIT — code libre",
        "Dessins soumis au réseau : CC0 — domaine public avec traçabilité blockchain",
      ].join("\n"),
    );

    const buffer = await zip.generateAsync({
      type: "nodebuffer",
      compression: "DEFLATE",
      compressionOptions: { level: 6 },
    });

    const filename = `${config.label}.zip`;

    return new NextResponse(buffer as unknown as BodyInit, {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Length": String(buffer.length),
        "Cache-Control": "public, s-maxage=86400",
      },
    });
  } catch (err) {
    console.error("[esp-firmware]", err);
    return NextResponse.json({ error: "Erreur lors de la génération du ZIP" }, { status: 500 });
  }
}
