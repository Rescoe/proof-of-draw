// tests/podR4Display.test.ts — affichage de l'UNO R4 (arduino_uno_r4/pod_uno_r4/pod_scale.h) compilé avec g++ et comparé au moteur de référence.
// Le firmware agrandit l'image 128×160 ×1,5 dans une fenêtre 192×240 d'un écran 240×320. Un faux ILI9341 (fenêtre d'adresse + curseur) reçoit
// EXACTEMENT les mêmes appels que Adafruit_ILI9341 ; on vérifie, pour chaque tick de chaque scène de référence (lecture « frame entière
// puis rectangles sales », 2 boucles), que l'écran final = l'agrandissement de la frame de référence, et qu'aucune fenêtre n'a débordé
// ni été remplie à moitié. Plus : image fixe, et copie de ana_scene_v1.h identique à celle du firmware ESP8266 testée par ailleurs.
// Sans compilateur C++ : ignoré (et le dit) — jamais faussement vert.

import test, { before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { packScene, PACKAGE_PROFILE_DIMENSIONS } from "../lib/scene/package";
import { validateScene } from "../lib/scene/validate";
import { hashSceneJson } from "../lib/scene/hash";
import { renderSceneIndices, indicesToRgb565LE } from "../lib/scene/engine";
import { ALL_SCENES } from "./sceneFixtures";

const ROOT = path.join(__dirname, "..");
const R4_DIR = path.join(ROOT, "arduino_uno_r4", "pod_uno_r4");
const ESP_DIR = path.join(ROOT, "esp8266", "esp_tft1.8");

function findCompiler(): string | null {
  const candidates = [process.env.CXX, "g++", "C:\\msys64\\mingw64\\bin\\g++.exe", "/usr/bin/g++", "/usr/local/bin/g++"].filter(Boolean) as string[];
  for (const c of candidates) {
    try { execFileSync(c, ["--version"], { stdio: "ignore" }); return c; } catch { /* suivant */ }
  }
  return null;
}
const compiler = findCompiler();
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "podr4disp-"));
const exe = path.join(tmp, process.platform === "win32" ? "scale_harness.exe" : "scale_harness");
const skip = compiler ? false : "aucun compilateur C++ (g++) trouvé : tests d'affichage R4 ignorés — définir CXX pour les activer";

before(() => {
  if (!compiler) return;
  const r = spawnSync(compiler, ["-std=c++11", "-Wall", "-Wextra", "-Werror", "-O2", path.join(R4_DIR, "host", "scale_harness.cpp"), "-o", exe], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`compilation du banc d'affichage R4 impossible :\n${r.stdout}\n${r.stderr}`);
});

const SCR_W = 240, SCR_H = 320, ART_X = 24, ART_Y = 40, SRC_W = 128, SRC_H = 160;
const srcIndex = (d: number) => (d % 3 === 0 ? 2 * Math.floor(d / 3) : 2 * Math.floor(d / 3) + 1);   // pixel destination -> pixel source (×1,5)

/** Écran 240×320 attendu : marges noires, image 128×160 agrandie ×1,5 au centre (formule indépendante du C++). */
function expectedScreen(frameLE: Uint8Array): Buffer {
  const out = Buffer.alloc(SCR_W * SCR_H * 2);
  for (let y = 0; y < 240; y++) {
    const sy = srcIndex(y);
    for (let x = 0; x < 192; x++) {
      const sx = srcIndex(x);
      const s = (sy * SRC_W + sx) * 2, d = ((ART_Y + y) * SCR_W + ART_X + x) * 2;
      out[d] = frameLE[s]; out[d + 1] = frameLE[s + 1];
    }
  }
  return out;
}

function run(args: string[]) {
  const r = spawnSync(exe, args, { maxBuffer: 512 * 1024 * 1024 });
  assert.equal(r.status, 0, `harness: ${r.stderr?.toString()}`);
  const m = /windows=(\d+) overflow=(\d+) underfill=(\d+)/.exec(r.stderr.toString());
  assert.ok(m, "statistiques de fenêtres absentes");
  return { screens: r.stdout as Buffer, windows: +m[1], overflow: +m[2], underfill: +m[3] };
}

test("ana_scene_v1.h du firmware R4 = copie IDENTIQUE de celui du TFT ESP8266 (déjà vérifié contre le moteur de référence)", () => {
  const sha = (p: string) => createHash("sha256").update(fs.readFileSync(p)).digest("hex");
  assert.equal(sha(path.join(R4_DIR, "ana_scene_v1.h")), sha(path.join(ESP_DIR, "ana_scene_v1.h")));
});

test("IMAGE FIXE : 128×160 agrandie ×1,5 — chaque pixel de l'écran = formule indépendante, marges noires, fenêtre unique pleine", { skip }, () => {
  const img = Buffer.alloc(SRC_W * SRC_H * 2);
  let seed = 12345;
  for (let i = 0; i < img.length; i++) { seed = (seed * 1103515245 + 12345) & 0x7fffffff; img[i] = (seed >> 16) & 0xff; }
  const f = path.join(tmp, "img.bin");
  fs.writeFileSync(f, img);
  const r = run(["frame", f]);
  assert.equal(r.overflow, 0); assert.equal(r.underfill, 0); assert.equal(r.windows, 1);
  assert.ok(Buffer.compare(r.screens, expectedScreen(img)) === 0, "l'écran ≠ l'agrandissement de référence");
});

test("SCÈNES : chaque tick, écran 240×320 = agrandissement ×1,5 de la frame de référence (frame entière + rectangles sales agrandis, 2 boucles)", { skip }, () => {
  const { width, height } = PACKAGE_PROFILE_DIMENSIONS.tft18;
  assert.deepEqual([width, height], [SRC_W, SRC_H]);
  let compared = 0;
  for (const [name, scene] of Object.entries(ALL_SCENES)) {
    const hash = hashSceneJson(validateScene(scene).canonicalJson!);
    const f = path.join(tmp, `scene-${name}.hex`);
    fs.writeFileSync(f, Buffer.from(packScene(scene, "tft18", hash)).toString("hex"));
    const r = run(["scene", f, "2"]);
    assert.equal(r.overflow, 0, `${name} : pixel hors fenêtre`);
    assert.equal(r.underfill, 0, `${name} : fenêtre remplie à moitié`);
    const frameBytes = SCR_W * SCR_H * 2;
    const total = scene.durationTicks * 2;
    assert.equal(r.screens.length, total * frameBytes, `${name} : nombre d'écrans`);
    for (let step = 0; step < total; step++) {
      const tick = step % scene.durationTicks;
      const ref = indicesToRgb565LE(renderSceneIndices(scene, width, height, tick), scene.palette);
      const got = r.screens.subarray(step * frameBytes, (step + 1) * frameBytes);
      assert.ok(Buffer.compare(got, expectedScreen(ref)) === 0, `${name} tick ${tick} (étape ${step}) : l'écran ≠ l'agrandissement de la référence`);
      compared++;
    }
  }
  assert.ok(compared > 100, `trop peu de frames comparées (${compared})`);
});
