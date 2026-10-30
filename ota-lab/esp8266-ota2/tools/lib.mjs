// lib.mjs — chemins communs de l'atelier OTA-2 (ota-lab/esp8266-ota2). Tout ce qui est généré va sous artifacts/ ou logs/ (ignorés par git).
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const SKETCH_DIR = join(ROOT, "sketch", "ota2_probe");
export const ARTIFACTS = join(ROOT, "artifacts");
export const LOGS = join(ROOT, "logs");
export const KEYS_DIR = join(ARTIFACTS, "keys");
export const SERVE_DIR = join(ARTIFACTS, "serve");
/** Valeur d'une option `--nom valeur` (ou défaut). */
export function opt(argv, name, def) { const i = argv.indexOf(name); return i >= 0 && i + 1 < argv.length ? argv[i + 1] : def; }
export const flag = (argv, name) => argv.includes(name);
