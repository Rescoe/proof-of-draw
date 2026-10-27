// tests/helpers/voteFormatMatrix.ts — LOT 4 (28/10/2026) : matrice « famille de firmware × format du candidat » DÉDUITE du code des sketchs (jamais écrite à la main).
// Une cellule dit si le chemin de vote COMPILÉ peut relire ce format : le tampon de métriques exigé par le format (OLED 1 024 o, e-ink 2,9″ 4 736 o, les autres 0) doit être couvert par ce que le firmware fournit.
// Niveau de preuve : `C` (lecture du code + compilation) ; le flux et les métriques de CHAQUE format sont par ailleurs prouvés égaux à la référence TypeScript sur l'hôte (tests/podMetrics.test.ts). Aucun `M` ici.
import fs from "node:fs";
import path from "node:path";

export const FORMATS = ["oled096", "eink27bw", "eink29bwr", "tft18", "tft28"] as const;
export type Format = (typeof FORMATS)[number];
export const NEED: Record<Format, number> = { oled096: 1024, eink27bw: 0, eink29bwr: 4736, tft18: 0, tft28: 0 };
export const FORMAT_LABEL: Record<Format, string> = { oled096: "OLED 0,96″ (1 024 o)", eink27bw: "e-ink 2,7″ (5 808 o)", eink29bwr: "e-ink 2,9″ BWR (9 472 o)", tft18: "TFT 1,8″ (40 960 o)", tft28: "TFT 2,8″ (153 600 o)" };

export interface Family { id: string; label: string; ino: string; check: RegExp; provides: number | "tas"; how: string; extra?: { file: string; check: RegExp } }
export const FAMILIES: Family[] = [
  { id: "r4eink29", label: "UNO R4 + e-ink 2,9″", ino: "arduino_uno_r4/pod_uno_r4_eink29/pod_uno_r4_eink29.ino", check: /podCheckStream\(c\.rd, kind, bytes, blackBuf, BUF_SIZE,/, provides: 4736, how: "plan noir réutilisé (4 736 o)", extra: { file: "arduino_uno_r4/pod_uno_r4_eink29/pod_uno_r4_eink29.ino", check: /#define BUF_SIZE EPD_BUF_SIZE/ } },
  { id: "r4eink27", label: "UNO R4 + e-ink 2,7″", ino: "arduino_uno_r4/pod_uno_r4_eink27/pod_uno_r4_eink27.ino", check: /podCheckStream\(c\.rd, kind, bytes, blackBuf, BUF_SIZE,/, provides: 5808, how: "plan noir réutilisé (5 808 o)", extra: { file: "arduino_uno_r4/pod_uno_r4_eink27/pod_uno_r4_eink27.ino", check: /#define BUF_SIZE \(\(EPD_WIDTH \* EPD_HEIGHT\) \/ 8\)/ } },
  { id: "r4eink27oled", label: "UNO R4 + e-ink 2,7″ + OLED", ino: "arduino_uno_r4/pod_uno_r4_eink27_oled/pod_uno_r4_eink27_oled.ino", check: /uint8_t\* scratch = blackBuf;\n\s*const size_t scratchLen = BUF_SIZE;/, provides: 5808, how: "plan noir réutilisé (5 808 o)" },
  { id: "r4tft18", label: "UNO R4 + TFT 1,8″ (firmware de base)", ino: "arduino_uno_r4/pod_uno_r4_tft18/pod_uno_r4_tft18.ino", check: /static uint8_t g_voteScratch\[4736\];/, provides: 4736, how: "tampon statique (4 736 o)" },
  { id: "r4tft28", label: "UNO R4 + TFT 2,8″ (production)", ino: "arduino_uno_r4/pod_uno_r4/pod_uno_r4.ino", check: /static uint8_t g_voteScratch\[4736\];/, provides: 4736, how: "tampon statique (4 736 o) ; le canari de vote de laboratoire, lui, est épinglé sur son seul format" },
  { id: "r4station", label: "UNO R4 + TFT 1,8″ station (r4tft18-2.3)", ino: "arduino_uno_r4/pod_uno_r4_tft18_env/pod_uno_r4_tft18_env.ino", check: /podScratchNeed\(kind\)/, provides: "tas", how: "tampon au tas, seulement si le format l'exige" },
  { id: "espbwr", label: "ESP8266 + e-ink 2,9″ BWR", ino: "esp8266/esp_eink_2.9BWR/esp_eink_2.9BWR.ino", check: /if \(kind == POD_OLED096 \|\| kind == POD_EINK29BWR\) \{\s*scratchLen = POD_SCRATCH_BYTES;/, provides: "tas", how: "tampon au tas, seulement si le format l'exige (correctif du 28/10)" },
  { id: "espms", label: "ESP8266 multiscreen (e-ink 2,7″ + OLED)", ino: "esp8266/esp_eink_2.7BW_OLED/esp_eink_2.7BW_OLED.ino", check: /if \(kind == POD_OLED096 \|\| kind == POD_EINK29BWR\) \{\s*scratchLen = POD_SCRATCH_BYTES;/, provides: "tas", how: "tampon au tas, seulement si le format l'exige" },
  { id: "esp27", label: "ESP8266 + e-ink 2,7″ seul", ino: "esp8266/esp_eink_2.7BW/esp_eink_2.7BW.ino", check: /if \(kind == POD_OLED096 \|\| kind == POD_EINK29BWR\) \{\s*scratchLen = POD_SCRATCH_BYTES;/, provides: "tas", how: "tampon au tas, seulement si le format l'exige" },
  { id: "esptft18", label: "ESP8266 + TFT 1,8″ (archivé, toujours pris en charge)", ino: "esp8266/esp_tft1.8/esp_tft1.8.ino", check: /if \(kind == POD_OLED096 \|\| kind == POD_EINK29BWR\) \{\s*scratchLen = POD_SCRATCH_BYTES;/, provides: "tas", how: "tampon au tas, seulement si le format l'exige" },
];

const root = path.join(__dirname, "..", "..");
const rd = (p: string) => fs.readFileSync(path.join(root, p), "utf8").replace(/\r\n/g, "\n");

/** Vérifie que le code du sketch correspond à ce que la table affirme ; retourne les écarts. */
export function verifyFamilies(): string[] {
  const bad: string[] = [];
  for (const f of FAMILIES) {
    const src = rd(f.ino);
    if (!f.check.test(src)) bad.push(`${f.id} : le motif de tampon de vote est introuvable dans ${f.ino}`);
    if (f.extra && !f.extra.check.test(rd(f.extra.file))) bad.push(`${f.id} : définition de BUF_SIZE introuvable`);
  }
  for (const h of ["arduino_uno_r4/pod_uno_r4_eink29/pod_vote_r4.h", "esp8266/_shared/pod_vote_esp.h"]) {
    const src = rd(h);
    for (const fmt of FORMATS) if (!src.includes(`"${fmt}"`)) bad.push(`${h} : podKindFromName ne connaît pas ${fmt}`);
  }
  return bad;
}

export const cell = (f: Family, fmt: Format): string => {
  if (f.provides === "tas") return NEED[fmt] === 0 ? "oui (aucun tampon)" : `oui (${NEED[fmt]} o au tas, le temps de la lecture)`;
  return f.provides >= NEED[fmt] ? (NEED[fmt] === 0 ? "oui (aucun tampon)" : `oui (tampon ${f.provides} o ≥ ${NEED[fmt]} o)`) : `NON (tampon ${f.provides} o < ${NEED[fmt]} o)`;
};

export function renderMatrix(): string {
  const head = `| Famille de firmware | ${FORMATS.map((x) => FORMAT_LABEL[x]).join(" | ")} |`;
  const sep = `|---|${FORMATS.map(() => "---").join("|")}|`;
  const rows = FAMILIES.map((f) => `| **${f.label}** — ${f.how} | ${FORMATS.map((x) => cell(f, x)).join(" | ")} |`);
  return [head, sep, ...rows].join("\n");
}
