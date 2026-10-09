// tests/helpers/netStackEdits.ts — LOT8B2B2-NETSTACK-FIX1 : table EXACTE (tests/helpers/netStackEdits.json) des modifications apportées aux cinq sketches UNO R4 pour exécuter TOUTE transaction réseau/TLS
// sur une pile dédiée (podNetStack.h). Comme tests/helpers/edStackEdits.ts : sert à ANNULER les modifications dans les tests — « sketch actuel, modifications annulées » doit être IDENTIQUE, au texte près
// (hors blocs du canari), au sketch sauvegardé dans firmware-backups/2026-10-09_avant-netstack-fix1/ ; les contrôles des lots précédents s'appliquent alors au texte annulé.
import fs from "node:fs";
import path from "node:path";
import { undoEdStack } from "./edStackEdits";

export interface NetEdit { id: string; old: string; neu: string }
const table: Record<string, NetEdit[]> = JSON.parse(fs.readFileSync(path.join(__dirname, "netStackEdits.json"), "utf8"));

export const NET_SKETCHES = Object.keys(table);
export const netEditsFor = (sketch: string): NetEdit[] => table[sketch] ?? [];

const count = (t: string, s: string) => t.split(s).length - 1;

/** Annule les modifications réseau. Lève si l'une d'elles n'apparaît pas exactement une fois. */
export function undoNetStack(src: string, sketch: string): string {
  let t = src.replace(/\r\n/g, "\n");
  for (const e of [...netEditsFor(sketch)].reverse()) {
    if (count(t, e.neu) !== 1) throw new Error(`${sketch} : modification réseau « ${e.id} » absente ou en double (${count(t, e.neu)})`);
    t = t.split(e.neu).join(e.old);
  }
  return t;
}

/** Annule d'abord les modifications réseau, puis celles de PodEd : on retrouve le sketch d'avant STACK-FIX1 (hors blocs du canari). */
export const undoAllStacks = (src: string, sketch: string): string => undoEdStack(undoNetStack(src, sketch), sketch);
