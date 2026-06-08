// app/api/esp-firmware/route.ts
// GET /api/esp-firmware?variant=all|eink29bwr|eink27bw|tft18
// Retourne un ZIP contenant le(s) dossier(s) de firmware ESP correspondant(s).
// Fonctionne uniquement avec le runtime Node.js (fs disponible).

import { NextRequest, NextResponse } from "next/server";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import JSZip from "jszip";

export const runtime = "nodejs";

// Mapping variant → dossier(s) ESP
const FIRMWARE_MAP: Record<string, string[]> = {
  eink29bwr:     ["esp_eink_2.9BWR"],
  eink27bw:      ["esp_eink_2.7BW_OLED"],
  eink27bwSolo:  ["esp_eink_2.7BW"],
  tft18:         ["esp_tft1.8"],
  all:           ["esp_eink_2.9BWR", "esp_eink_2.7BW_OLED", "esp_eink_2.7BW", "esp_tft1.8"],
};

const LABEL_MAP: Record<string, string> = {
  eink29bwr:    "pod-firmware-eink29bwr",
  eink27bw:     "pod-firmware-eink27bw-oled",
  eink27bwSolo: "pod-firmware-eink27bw-solo",
  tft18:        "pod-firmware-tft18",
  all:          "pod-firmware-all",
};

async function addDirToZip(zip: JSZip, dirPath: string, zipPrefix: string) {
  const entries = await readdir(dirPath, { withFileTypes: true });
  await Promise.all(
    entries.map(async (entry) => {
      const fullPath = join(dirPath, entry.name);
      if (entry.isDirectory()) {
        await addDirToZip(zip, fullPath, `${zipPrefix}/${entry.name}`);
      } else {
        const content = await readFile(fullPath);
        zip.file(`${zipPrefix}/${entry.name}`, content);
      }
    }),
  );
}

export async function GET(req: NextRequest) {
  const variant = req.nextUrl.searchParams.get("variant") ?? "all";
  const folders  = FIRMWARE_MAP[variant];

  if (!folders) {
    return NextResponse.json({ error: "Variante inconnue" }, { status: 400 });
  }

  try {
    const zip = new JSZip();
    const esp8266Root = join(process.cwd(), "esp8266");

    for (const folder of folders) {
      const dirPath = join(esp8266Root, folder);
      await addDirToZip(zip, dirPath, folder);
    }

    // Ajouter un README succinct
    zip.file(
      "README.txt",
      [
        "Proof-of-Draw — Firmware ESP8266",
        "==================================",
        "",
        "Contenu de cette archive :",
        folders.map((f) => `  • ${f}/`).join("\n"),
        "",
        "Étapes :",
        "  1. Ouvrir le dossier correspondant à votre écran dans Arduino IDE",
        "  2. Modifier SERVER_URL dans le .ino avec l'URL de votre instance",
        "  3. Modifier WIFI_SSID et WIFI_PASSWORD",
        "  4. Flasher sur votre ESP8266 (Board : NodeMCU 1.0 / 80MHz)",
        "",
        "Bibliothèques Arduino requises :",
        "  • ESP8266WiFi (incluse dans le core ESP8266)",
        "  • ESP8266HTTPClient",
        "  • ArduinoJson >= 7.x",
        "  • Adafruit GFX + driver selon écran",
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

    const filename = `${LABEL_MAP[variant] ?? "pod-firmware"}.zip`;

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
