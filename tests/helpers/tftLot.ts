// tests/helpers/tftLot.ts — LOT8B2D-R4-TFT28-CANARY-1 : le sketch UNO R4 + TFT 2,8″ (pod_uno_r4) a été modifié par ce lot (client TLS borné, JSON sur la pile de travail, canari).
// Les tests « historiques » des lots précédents (edStack, netStack) prouvent, par annulation de leurs tables de modifications, que CHAQUE lot n'a rien changé d'autre. Pour ce sketch ils s'appliquent donc
// à la version GELÉE d'avant le lot (firmware-backups/2026-10-12_avant-canari-tft28/pod_uno_r4.ino = origin/main 3239d2e) ; tests/tft28Canary.test.ts prouve séparément le delta de ce lot, fonction par fonction.
import fs from "node:fs";
import path from "node:path";

export const TFT28_BACKUP = "firmware-backups/2026-10-12_avant-canari-tft28/pod_uno_r4.ino";


/** Texte du sketch pour les tests d'historique : le sketch gelé d'avant le lot pour pod_uno_r4, le fichier courant pour les autres. */
export function readForHistory(root: string, sk: string): string {
  const file = sk === "pod_uno_r4" ? path.join(root, TFT28_BACKUP) : path.join(root, "arduino_uno_r4", sk, `${sk}.ino`);
  // vue « portail Wi-Fi éteint » (POD_WIFI_PORTAL = 0) : blocs POD_WIFI_BEGIN / POD_WIFI_END retirés
  return fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n").replace(/\n?\/\/ POD_WIFI_BEGIN[\s\S]*?\/\/ POD_WIFI_END\n?/g, "\n");
}

/**
 * Texte de PRODUCTION d'un sketch UNO R4 pour les tests des lots précédents : pour pod_uno_r4 (TFT 2,8″), le texte avec POD_CANARY = 0 et sans les crochets du canari (macros vides) — c'est-à-dire exactement ce que compile le firmware
 * de production ; les autres sketches sont lus tels quels. Les propriétés du canari TFT sont testées dans tests/tft28Canary.test.ts.
 */
/** Texte brut du sketch (blocs « POD_WIFI_BEGIN … POD_WIFI_END » du portail Wi-Fi inclus). */
export function readSketchRaw(root: string, sk: string): string {
  return fs.readFileSync(path.join(root, "arduino_uno_r4", sk, `${sk}.ino`), "utf8").replace(/\r\n/g, "\n");
}
/** Vue « portail Wi-Fi éteint » (POD_WIFI_PORTAL = 0, défaut) : les blocs balisés POD_WIFI_BEGIN / POD_WIFI_END sont retirés — c'est le firmware d'avant, au texte près. */
export function readSketch(root: string, sk: string): string {
  const raw = readSketchRaw(root, sk).replace(/\n?\/\/ POD_WIFI_BEGIN[\s\S]*?\/\/ POD_WIFI_END\n?/g, "\n");
  return sk === "pod_uno_r4" ? stripHooks(effective(raw, false)) : raw;
}
import { effective, stripHooks } from "./tft28Source";
