// tests/helpers/propagation8b2b3Edits.ts — LOT8B2B3-R4-EINK27-PROPAGATION-1 : les deux sketches UNO R4 e-ink 2,7″ (solo et + OLED) portent désormais le client TLS borné et le décodage
// JSON sur pile de travail. Les tests « le sketch d'avant au texte près » des lots précédents rendent d'abord le sketch tel qu'il était AVANT ce lot (la sauvegarde exacte) : ils continuent
// ainsi de prouver que ces lots-là n'ont rien touché d'autre. Ce que CE lot change est vérifié à part, région par région (tests/r4Eink27Propagation.test.ts).
import fs from "node:fs";
import path from "node:path";

export const PROP_BACKUP_DIR = "firmware-backups/2026-10-12_avant-propagation-8b2b3";
export const PROP_SKETCHES = ["pod_uno_r4_eink27", "pod_uno_r4_eink27_oled"] as const;

export function propBackup(sketch: string): string {
  return fs.readFileSync(path.join(__dirname, "..", "..", PROP_BACKUP_DIR, sketch, `${sketch}.ino`), "utf8");
}

/** Sketch e-ink 2,7″ du lot => la sauvegarde d'avant le lot ; tout autre texte est rendu tel quel. */
export function undoPropagation8b2b3(src: string, sketch: string): string {
  return (PROP_SKETCHES as readonly string[]).includes(sketch) && src.includes("pod_ssl_bounded.h") ? propBackup(sketch) : src;
}
