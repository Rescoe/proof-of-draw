// Générateur des golden vectors scene-v1 :  node --import tsx tests/fixtures/scene-v1-golden.generate.ts
// Écrit tests/fixtures/scene-v1-golden.json — vecteurs NORMATIFS comparés byte-for-byte aux firmwares OLED/TFT.
//
// Interop ANA ↔ PoD : si le dépôt ANA est présent à côté (../Agentic-Normie-Association), canonicalJson et sceneHash sont
// calculés par le code ANA (producteur de référence) ET par PoD ; le script refuse d'écrire si les deux divergent.
// Sans le dépôt ANA, il garde les valeurs ANA déjà présentes dans le JSON et vérifie que PoD les reproduit.
//
// Régénérer ce fichier = changer le contrat : prévenir GPT (ANA) et le binôme firmware avant de commit.

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { ALL_SCENES } from "../sceneFixtures";
import { validateScene } from "../../lib/scene/validate";
import { hashSceneJson, hashSinTable } from "../../lib/scene/hash";
import { SIN_Q15_HASH, XORSHIFT32_SEED1_FIRST10, xorshift32, SIN_Q15_256 } from "../../lib/scene/spec";
import { packScene, PACKAGE_PROFILE_DIMENSIONS, type ScenePackageProfile } from "../../lib/scene/package";
import {
  renderSceneIndices, indicesToOledBuffer, indicesToRgb565LE, renderPosterGray, posterTick,
} from "../../lib/scene/engine";
import { encodeForScreen } from "../../lib/screenEncode";
import { SCREEN_PROFILES } from "../../lib/screenProfiles";

const OUT = path.join(__dirname, "scene-v1-golden.json");
const ANA_FILE = path.resolve(__dirname, "../../../Agentic-Normie-Association/src/lib/anaSceneV1.ts");
const sha = (b: Uint8Array | string) => createHash("sha256").update(b as never).digest("hex");

async function main() {
  const previous = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, "utf8")) : null;
  const ana = fs.existsSync(ANA_FILE) ? await import(pathToFileURL(ANA_FILE).href) : null;
  console.log(ana ? "ANA présent : calcul croisé ANA ↔ PoD" : "ANA absent : vérification contre le JSON existant");

  let x = 1;
  const xs: number[] = [];
  for (let i = 0; i < 10; i++) { x = xorshift32(x); xs.push(x); }
  if (JSON.stringify(xs) !== JSON.stringify(XORSHIFT32_SEED1_FIRST10)) throw new Error("xorshift32 ≠ contrat");
  if (hashSinTable() !== SIN_Q15_HASH) throw new Error("table sinus ≠ hash du contrat");

  const scenes: Record<string, unknown> = {};
  for (const [name, scene] of Object.entries(ALL_SCENES)) {
    const v = validateScene(scene);
    if (!v.valid || !v.canonicalJson) throw new Error(`${name}: ${v.errors.join(" ; ")}`);
    const sceneHash = hashSceneJson(v.canonicalJson);

    if (ana) {
      const a = ana.validateSceneV1(scene);
      if (!a.valid) throw new Error(`${name}: ANA refuse la scène — ${a.errors.join(" ; ")}`);
      if (a.canonicalJson !== v.canonicalJson) throw new Error(`${name}: forme canonique ANA ≠ PoD`);
      if (a.sceneHash !== sceneHash) throw new Error(`${name}: sceneHash ANA ≠ PoD`);
    } else if (previous?.scenes?.[name]) {
      if (previous.scenes[name].canonicalJson !== v.canonicalJson || previous.scenes[name].sceneHash !== sceneHash) {
        throw new Error(`${name}: PoD ne reproduit plus les valeurs ANA du golden existant`);
      }
    }

    const ticks = [...new Set([0, 1, Math.floor(scene.durationTicks / 2), scene.durationTicks - 1])].filter((t) => t < scene.durationTicks).sort((a, b) => a - b);
    const profiles: Record<string, unknown> = {};
    for (const profile of ["oled096", "tft18"] as ScenePackageProfile[]) {
      const { width, height } = PACKAGE_PROFILE_DIMENSIONS[profile];
      const pkg = packScene(scene, profile, sceneHash);
      const frames: Record<string, string> = {};
      for (const t of ticks) {
        const idx = renderSceneIndices(scene, width, height, t);
        frames[String(t)] = sha(profile === "oled096"
          ? indicesToOledBuffer(idx, width, height, scene.palette, scene.backgroundIndex)
          : indicesToRgb565LE(idx, scene.palette));
      }
      profiles[profile] = { packageBytes: pkg.length, packageSha256: sha(pkg), frameSha256ByTick: frames };
    }

    const poster: Record<string, string> = {};
    for (const screen of ["eink27bw", "eink29bwr"] as const) {
      const p = SCREEN_PROFILES[screen];
      const enc = encodeForScreen(renderPosterGray(scene, p.width, p.height), p.width, p.height, screen) as Record<string, string>;
      poster[screen] = sha(Object.values(enc).join("|"));
    }

    scenes[name] = { canonicalJson: v.canonicalJson, sceneHash, canonicalBytes: v.bytes, posterTick: posterTick(scene), profiles, posterFrameSha256: poster };
  }

  // Bundle exemple : id / contentHash calculés par ANA (producteur de référence) quand le dépôt est présent.
  const artworkText = "<!DOCTYPE html><html><body><canvas></canvas></body></html>";
  const exSceneHash = (scenes.static as { sceneHash: string }).sceneHash;
  const bundleExample = {
    sourceId: "work_golden", revision: 1, artworkText, captureHash: "sha256:capture-golden",
    sourceHash: ana ? ana.hashArtworkSource(artworkText) : previous?.bundleExample?.sourceHash,
    contentHashSceneAndCapture: ana ? ana.hashGenerativeBundle("work_golden", 1, ana.hashArtworkSource(artworkText), exSceneHash, "sha256:capture-golden") : previous?.bundleExample?.contentHashSceneAndCapture,
    contentHashSceneOnly: ana ? ana.hashGenerativeBundle("work_golden", 1, ana.hashArtworkSource(artworkText), exSceneHash, undefined) : previous?.bundleExample?.contentHashSceneOnly,
  };
  if (!bundleExample.sourceHash || !bundleExample.contentHashSceneAndCapture || !bundleExample.contentHashSceneOnly) throw new Error("bundleExample incomplet (dépôt ANA absent et golden vide)");

  const out = {
    _doc: "Vecteurs normatifs scene-v1 — voir docs/SCENE_V1_MOTEUR.md. Généré par scene-v1-golden.generate.ts.",
    xorshift32Seed1: xs,
    sinTable: { count: SIN_Q15_256.length, sha256: SIN_Q15_HASH },
    bundleExample,
    scenes,
  };
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + "\n");
  console.log(`écrit ${OUT} (${Object.keys(scenes).length} scènes)`);
}

main().catch((e) => { console.error(e); process.exit(1); });
