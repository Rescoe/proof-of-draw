/* eslint-disable @typescript-eslint/no-require-imports */
// scripts/fetch-wifis3-sources.js — PULLFRAME-BOUNDED-SSL-FIX1 : télécharge (lecture seule) les sources WiFiS3 des cœurs Arduino Renesas 1.5.3 et 1.6.0 dans
// consensus-pod/host/wifis3/.cache/<version>/ (IGNORÉ par git : code LGPL tiers, jamais commité) et VÉRIFIE les SHA-256 figés dans
// docs/PREUVE_WIFIS3_RX_BORNE_RENESAS_1_5_3_1_6_0_2026_10_11.md. Le harnais hôte (consensus-pod/host/wifis3/bounded_ssl_harness.cpp) compile ces VRAIS fichiers.
// Usage : node scripts/fetch-wifis3-sources.js     (code de sortie 1 si un SHA-256 diffère ou si le réseau échoue)
const fs = require("fs"), path = require("path"), crypto = require("crypto");
const OUT = path.join(__dirname, "..", "consensus-pod", "host", "wifis3", ".cache");
const RAW = "https://raw.githubusercontent.com/arduino/ArduinoCore-renesas";
const VERSIONS = ["1.5.3", "1.6.0"];
const SRC = ["WiFiSSLClient.cpp", "WiFiSSLClient.h", "WiFiClient.cpp", "WiFiClient.h", "Modem.cpp", "Modem.h", "WiFiCommands.h", "WiFiTypes.h", "StringHelpers.h", "WiFiFileSystem.h"];
const PINNED = {   // identiques en 1.5.3 et 1.6.0 (docs/PREUVE_WIFIS3_RX_BORNE_RENESAS_1_5_3_1_6_0_2026_10_11.md)
  "WiFiSSLClient.cpp": "69EED35A5498B7F6CAAEDDB43DC806F80D4B13D3FE5A7E0474171B152079FF53",
  "WiFiClient.h": "C5ACB6074B928C9C5C083835F28A6396C3151A6C4520576934BFB974D070228F",
  "Modem.cpp": "2C2AA923EA176CF723932E55F5AFEDF9AF25DE4B7BA738595F068BC0B2CAAD26",
};
const sha = (b) => crypto.createHash("sha256").update(b).digest("hex").toUpperCase();
async function get(url) { const r = await fetch(url); if (!r.ok) throw new Error(`${r.status} ${url}`); return Buffer.from(await r.arrayBuffer()); }
(async () => {
  let bad = 0; const lines = [];
  for (const v of VERSIONS) {
    const dir = path.join(OUT, v); fs.mkdirSync(dir, { recursive: true });
    for (const f of SRC) fs.writeFileSync(path.join(dir, f), await get(`${RAW}/${v}/libraries/WiFiS3/src/${f}`));
    fs.writeFileSync(path.join(dir, "FifoBuffer.h"), await get(`${RAW}/${v}/cores/arduino/FifoBuffer.h`));
    for (const [f, want] of Object.entries(PINNED)) {
      const got = sha(fs.readFileSync(path.join(dir, f)));
      lines.push(`${v} ${f} ${got === want ? "OK" : "DIFFERE"} ${got}`);
      if (got !== want) bad++;
    }
  }
  // commandes AT (macros PROMPT/CMD_WRITE/_SSLCLIENTRECEIVE) et côté module (borne min(demandé, disponible)) : dépôt du pont, branche main (version du pont de la carte INCONNUE)
  const br = "https://raw.githubusercontent.com/arduino/uno-r4-wifi-usb-bridge/main/UNOR4USBBridge";
  fs.writeFileSync(path.join(OUT, "bridge_commands.h"), await get(`${br}/commands.h`));
  fs.writeFileSync(path.join(OUT, "bridge_cmds_wifi_SSL.h"), await get(`${br}/cmds_wifi_SSL.h`));
  lines.push(`pont main commands.h ${sha(fs.readFileSync(path.join(OUT, "bridge_commands.h")))}`);
  lines.push(`pont main cmds_wifi_SSL.h ${sha(fs.readFileSync(path.join(OUT, "bridge_cmds_wifi_SSL.h")))}`);
  console.log(lines.join("\n"));
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(String(e)); process.exit(1); });
