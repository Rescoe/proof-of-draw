// scripts/canary-verify-render.ts — calcule, HORS CARTE, les frameHash / renderHash que le canari R4 e-ink 2,9″ doit afficher (référence TypeScript lib/renderLayout.ts, layoutVersion 1).
// Usage (voir docs/CANARY_R4_EINK29_RENDU_V1_2026_10_08.md) :
//   node --import tsx scripts/canary-verify-render.ts --planes planes.bin --ts "07/10/2026 20:37" --artist "Léa" --title "Le Chat Noir" --block 42 [--mode fit|overlay|hidden] [--screen eink29bwr]
// `planes.bin` = les 9 472 octets de GET /api/pull-frame?deviceId=…&screen=eink29bwr&fmt=bin (plan noir 4 736 o puis plan rouge 4 736 o), `--ts/--artist/--title/--block` = la ligne « [CANARY] meta … » du moniteur série.
// Lecture seule, aucun réseau, aucun Redis. Sortie : « frameHash=<64 hex> renderHash=<64 hex> » à comparer aux lignes « [RENDER] frameHash=… » et « … renderHash=… » de la carte.
import fs from "node:fs";
import { planeBytes, planeCount, renderFrame, type CartelMode } from "../lib/renderLayout";
import type { ScreenId } from "../lib/screenProfiles";

export interface VerifyInput { screen: ScreenId; planes: Uint8Array; ts: string; artist: string; title: string; block: number; mode: CartelMode }
export interface VerifyOutput { frameHash: string; renderHash: string }

/** Découpe l'image reçue (plans concaténés) et rend avec la référence. Lève une erreur claire si la taille est fausse. */
export function verifyRender(i: VerifyInput): VerifyOutput {
  const n = planeCount(i.screen), len = planeBytes(i.screen);
  if (i.planes.length !== n * len) throw new Error(`${i.screen} : ${n * len} octets attendus (${n} plan(s) de ${len}), ${i.planes.length} reçus — fichier tronqué ou mauvais écran ?`);
  const enc = new TextEncoder();
  const planes = Array.from({ length: n }, (_, k) => i.planes.slice(k * len, (k + 1) * len));
  const r = renderFrame(i.screen, planes, i.mode, { ts: enc.encode(i.ts), artist: enc.encode(i.artist), title: enc.encode(i.title), blockIndex: i.block });
  return { frameHash: r.frameHash, renderHash: r.renderHash };
}

function arg(name: string, def?: string): string {
  const k = process.argv.indexOf(`--${name}`);
  if (k >= 0 && k + 1 < process.argv.length) return process.argv[k + 1];
  if (def !== undefined) return def;
  throw new Error(`argument manquant : --${name}`);
}

if (require.main === module) {
  try {
    const mode = arg("mode", "fit") as CartelMode;
    if (!["fit", "overlay", "hidden"].includes(mode)) throw new Error("--mode : fit | overlay | hidden");
    const out = verifyRender({ screen: arg("screen", "eink29bwr") as ScreenId, planes: new Uint8Array(fs.readFileSync(arg("planes"))), ts: arg("ts", ""), artist: arg("artist", ""), title: arg("title", ""), block: Number(arg("block", "-1")), mode });
    console.log(`frameHash=${out.frameHash} renderHash=${out.renderHash}`);
  } catch (e) {
    console.error(`canary-verify-render : ${(e as Error).message}`);
    process.exit(1);
  }
}
