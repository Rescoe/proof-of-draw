// tests/sceneV1Firmware.test.ts — le lecteur FIRMWARE (esp8266/esp_tft1.8/ana_scene_v1.h) face au moteur de référence TypeScript.
// Le même fichier C++ est compilé ici avec g++ (banc d'essai host/scene_harness.cpp) puis comparé OCTET POUR OCTET :
//   • frames RGB565 (TFT) et page-major (OLED) de tous les ticks, hashes des golden vectors ;
//   • rectangles sales identiques ; lecture complète « frame entière puis seulement les rectangles » = frames de référence ;
//   • validation DIFFÉRENTIELLE : sur des milliers de paquets mutés (CRC re-signé), le firmware accepte/refuse exactement comme le parseur TS.
// Sans compilateur C++ sur la machine, ces tests sont ignorés (et le disent) — jamais faussement verts.

import test, { before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { packScene, unpackScene, crc32, PACKAGE_PROFILE_DIMENSIONS, type ScenePackageProfile } from "../lib/scene/package";
import { validateScene } from "../lib/scene/validate";
import { hashSceneJson } from "../lib/scene/hash";
import { renderSceneIndices, indicesToRgb565LE, indicesToOledBuffer, dirtyRectBetween, prevTickOf } from "../lib/scene/engine";
import { ALL_SCENES } from "./sceneFixtures";

const ROOT = path.join(__dirname, "..");
const FW_DIR = path.join(ROOT, "esp8266", "esp_tft1.8");
const golden = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "scene-v1-golden.json"), "utf8"));
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const hex = (b: Uint8Array) => Buffer.from(b).toString("hex");

function findCompiler(): string | null {
  const candidates = [process.env.CXX, "g++", "C:\\msys64\\mingw64\\bin\\g++.exe", "/usr/bin/g++", "/usr/local/bin/g++"].filter(Boolean) as string[];
  for (const c of candidates) {
    try { execFileSync(c, ["--version"], { stdio: "ignore" }); return c; } catch { /* suivant */ }
  }
  return null;
}

const compiler = findCompiler();
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "anascene-"));
const exe = path.join(tmp, process.platform === "win32" ? "scene_harness.exe" : "scene_harness");
const skip = compiler ? false : "aucun compilateur C++ (g++) trouvé : tests firmware ignorés — définir CXX pour les activer";

before(() => {
  if (!compiler) return;
  const r = spawnSync(compiler, ["-std=c++11", "-Wall", "-Wextra", "-Werror", "-O2", path.join(FW_DIR, "host", "scene_harness.cpp"), "-o", exe], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`compilation du lecteur firmware impossible :\n${r.stdout}\n${r.stderr}`);
});

let counter = 0;
function pkgFile(bytes: Uint8Array): string {
  const f = path.join(tmp, `p${counter++}.hex`);
  fs.writeFileSync(f, hex(bytes));
  return f;
}
const run = (args: string[]): Buffer => execFileSync(exe, args, { maxBuffer: 256 * 1024 * 1024 });
const text = (args: string[]) => run(args).toString("utf8").trim();

const hashOf = (name: string) => hashSceneJson(validateScene(ALL_SCENES[name]).canonicalJson!);
const PROFILES: ScenePackageProfile[] = ["oled096", "tft18"];
const prof = (p: ScenePackageProfile) => (p === "oled096" ? "oled" : "tft");

function resign(bytes: Uint8Array): Uint8Array {
  const out = Uint8Array.from(bytes);
  if (out.length >= 4) new DataView(out.buffer).setUint32(out.length - 4, crc32(out.subarray(0, out.length - 4)), true);
  return out;
}

test("CRC32 firmware = référence (vecteur « 123456789 » = cbf43926)", { skip }, () => {
  const f = path.join(tmp, "crc.hex");
  fs.writeFileSync(f, hex(new TextEncoder().encode("123456789")));
  assert.equal(text(["crc", f]), "cbf43926");
});

test("tous les paquets de référence sont acceptés avec les bonnes dimensions ; un paquet d'un AUTRE profil est refusé", { skip }, () => {
  for (const name of Object.keys(ALL_SCENES)) {
    const s = ALL_SCENES[name];
    for (const profile of PROFILES) {
      const f = pkgFile(packScene(s, profile, hashOf(name)));
      const d = PACKAGE_PROFILE_DIMENSIONS[profile];
      assert.equal(text(["validate", f, prof(profile)]), `OK ${d.width} ${d.height} ${s.tickRate} ${s.durationTicks} ${s.loopCount} ${s.entities.length}`, `${name}/${profile}`);
      assert.equal(text(["validate", f, profile === "tft18" ? "oled" : "tft"]), "ERR PROFILE", `${name}/${profile} autre profil`);
    }
  }
});

test("FRAMES : chaque tick, TFT (RGB565 LE) et OLED (page-major), identiques OCTET POUR OCTET au moteur de référence", { skip }, () => {
  let compared = 0;
  for (const [name, scene] of Object.entries(ALL_SCENES)) {
    for (const profile of PROFILES) {
      const { width, height } = PACKAGE_PROFILE_DIMENSIONS[profile];
      const f = pkgFile(packScene(scene, profile, hashOf(name)));
      for (let tick = 0; tick < scene.durationTicks; tick++) {
        const idx = renderSceneIndices(scene, width, height, tick);
        const expected = profile === "oled096"
          ? indicesToOledBuffer(idx, width, height, scene.palette, scene.backgroundIndex)
          : indicesToRgb565LE(idx, scene.palette);
        const actual = run(["frame", f, prof(profile), String(tick)]);
        assert.equal(actual.length, expected.length, `${name}/${profile} tick ${tick} taille`);
        assert.ok(Buffer.compare(actual, Buffer.from(expected)) === 0, `${name}/${profile} tick ${tick} : frame firmware ≠ référence`);
        compared++;
      }
    }
  }
  assert.ok(compared > 100, `trop peu de frames comparées (${compared})`);
});

test("GOLDEN : les hashes de frames normatifs (ticks 0, 1, milieu, dernier) sont reproduits par le firmware", { skip }, () => {
  for (const [name, scene] of Object.entries(ALL_SCENES)) {
    for (const profile of PROFILES) {
      const f = pkgFile(packScene(scene, profile, hashOf(name)));
      const expected = golden.scenes[name].profiles[profile].frameSha256ByTick as Record<string, string>;
      for (const [tick, hash] of Object.entries(expected)) {
        assert.equal(sha(run(["frame", f, prof(profile), tick])), hash, `${name}/${profile} tick ${tick}`);
      }
    }
  }
});

test("RECTANGLES SALES : mêmes zones que la référence pour chaque transition (boucle comprise)", { skip }, () => {
  for (const [name, scene] of Object.entries(ALL_SCENES)) {
    const f = pkgFile(packScene(scene, "tft18", hashOf(name)));
    const { width, height } = PACKAGE_PROFILE_DIMENSIONS.tft18;
    for (let tick = 0; tick < scene.durationTicks; tick++) {
      const prev = prevTickOf(scene, tick);
      const r = dirtyRectBetween(scene, width, height, prev, tick);
      const expected = r ? `${r.x} ${r.y} ${r.w} ${r.h}` : "none";
      assert.equal(text(["dirty", f, "tft", String(prev), String(tick)]), expected, `${name} ${prev}→${tick}`);
    }
  }
});

test("LECTURE COMPLÈTE : frame entière au tick 0 puis seulement les rectangles sales = les frames de référence, 2 boucles", { skip }, () => {
  for (const [name, scene] of Object.entries(ALL_SCENES)) {
    const f = pkgFile(packScene(scene, "tft18", hashOf(name)));
    const rectsFile = path.join(tmp, `rects-${name}.txt`);
    const screens = run(["sequence", f, "tft", "2", rectsFile]);
    const { width, height } = PACKAGE_PROFILE_DIMENSIONS.tft18;
    const frameBytes = width * height * 2;
    const total = scene.durationTicks * 2;
    assert.equal(screens.length, frameBytes * total, `${name} : une image d'écran par tick`);

    const rects = fs.readFileSync(rectsFile, "utf8").trim().split("\n");
    assert.equal(rects.length, total);
    assert.equal(rects[0], "full", "le premier tick est toujours plein écran");
    let pushedPixels = 0;
    for (let step = 0; step < total; step++) {
      const tick = step % scene.durationTicks;
      const expected = indicesToRgb565LE(renderSceneIndices(scene, width, height, tick), scene.palette);
      const got = screens.subarray(step * frameBytes, (step + 1) * frameBytes);
      assert.ok(Buffer.compare(got, Buffer.from(expected)) === 0, `${name} tick ${tick} (étape ${step}) : l'écran ≠ la référence`);
      if (step > 0) {
        const r = dirtyRectBetween(scene, width, height, prevTickOf(scene, tick), tick);
        assert.equal(rects[step], r ? `${r.x} ${r.y} ${r.w} ${r.h}` : "none", `${name} étape ${step} rectangle`);
        if (r) pushedPixels += r.w * r.h;
      }
    }
    // L'optimisation est réelle : sur les scènes à mouvement local on retransmet bien moins que « tout l'écran à chaque tick »
    if (name === "oscillate" || name === "orbit") assert.ok(pushedPixels < (total - 1) * width * height * 0.6, `${name} : ${pushedPixels} pixels poussés`);
  }
});

test("REJET : tout paquet tronqué (chaque longueur) et tout octet modifié (CRC non re-signé) est refusé par le firmware", { skip }, () => {
  const pkg = packScene(ALL_SCENES.full24, "tft18", hashOf("full24"));
  const lines: string[] = [];
  for (let len = 0; len < pkg.length; len++) lines.push(hex(pkg.subarray(0, len)));
  for (let i = 0; i < pkg.length; i++) { const b = Uint8Array.from(pkg); b[i] ^= 0x04; lines.push(hex(b)); }
  lines.push(hex(Uint8Array.from([...pkg, 0])));
  const f = path.join(tmp, "reject.txt");
  fs.writeFileSync(f, lines.join("\n") + "\n");
  const out = text(["validate_batch", f, "-"]).split("\n");
  assert.equal(out.length, lines.length);
  const accepted = out.map((o, i) => [o, i] as const).filter(([o]) => o === "OK");
  assert.deepEqual(accepted, [], `acceptés à tort : ${accepted.slice(0, 3).map(([, i]) => i).join(",")}`);
});

test("VALIDATION DIFFÉRENTIELLE : sur des milliers de paquets mutés (CRC re-signé), firmware et parseur TypeScript décident pareil", { skip }, () => {
  let seed = 0x2545f491;
  const rnd = (n: number) => { seed ^= seed << 13; seed >>>= 0; seed ^= seed >>> 17; seed ^= seed << 5; seed >>>= 0; return seed % n; };

  const cases: Uint8Array[] = [];
  for (const name of Object.keys(ALL_SCENES)) {
    for (const profile of PROFILES) {
      const base = packScene(ALL_SCENES[name], profile, hashOf(name));
      cases.push(base);
      for (let k = 0; k < 220; k++) {
        const b = Uint8Array.from(base);
        const edits = 1 + rnd(3);
        for (let e = 0; e < edits; e++) {
          const pos = rnd(2) === 0 ? rnd(Math.min(b.length - 4, 48)) : rnd(b.length - 4);   // en-tête et début de corps sur-échantillonnés
          b[pos] = rnd(4) === 0 ? rnd(256) : (b[pos] + (rnd(2) ? 1 : 255)) & 255;
        }
        cases.push(resign(b));
      }
      // Corps raccourci / allongé avec longueur et CRC cohérents : entités tronquées ou octets excédentaires
      for (const delta of [-1, -2, -3, -5, -9, 1, 2, 5]) {
        const body = base.subarray(32, base.length - 4);
        const nb = delta < 0 ? body.subarray(0, body.length + delta) : Uint8Array.from([...body, ...new Uint8Array(delta).fill(7)]);
        const b = new Uint8Array(32 + nb.length + 4);
        b.set(base.subarray(0, 32), 0); b.set(nb, 32);
        new DataView(b.buffer).setUint16(22, nb.length, true);
        cases.push(resign(b));
      }
    }
  }
  const f = path.join(tmp, "diff.txt");
  fs.writeFileSync(f, cases.map(hex).join("\n") + "\n");
  const out = text(["validate_batch", f, "-"]).split("\n");
  assert.equal(out.length, cases.length);

  let agree = 0, accepted = 0, skippedJson = 0;
  const mismatches: string[] = [];
  cases.forEach((c, i) => {
    const ts = unpackScene(c);
    // Seule différence assumée : le parseur TS applique aussi la limite de 4 096 octets du JSON canonique d'ANA (propre au manifeste)
    if (!ts.ok && ts.reason.includes("canonical JSON")) { skippedJson++; return; }
    const fw = out[i] === "OK";
    if (fw === ts.ok) { agree++; if (fw) accepted++; }
    else mismatches.push(`#${i} TS=${ts.ok ? "OK" : ts.reason} firmware=${out[i]}`);
  });
  assert.deepEqual(mismatches.slice(0, 5), [], `${mismatches.length} désaccord(s) sur ${cases.length}`);
  assert.ok(agree > 2000, `échantillon trop petit (${agree})`);
  assert.ok(accepted >= PROFILES.length * Object.keys(ALL_SCENES).length, "les paquets valides d'origine sont bien acceptés");
  assert.ok(accepted < agree * 0.9 && agree - accepted > 200, `mutations trop douces : ${accepted} acceptés / ${agree} (le test doit exercer des REFUS)`);
  void skippedJson;
});

test("entités aux EXTRÉMITÉS du canevas (coins, diagonale pleine, cercle maximal, tore) : frames identiques à la référence", { skip }, () => {
  // Le banc d'essai alloue exactement Fb::bytesFor(w,h) : une écriture hors bornes corromprait le tas et ferait échouer la
  // comparaison. Ce test concentre les cas de bord (rognage, repli en tore, tampons 4×4 dans les coins).
  const edge = {
    ...ALL_SCENES.static,
    entities: [
      { id: 0, primitive: "point" as const, colorIndex: 1, geometry: { type: "point" as const, x: 65535, y: 65535, size: 4 }, motion: { type: "static" as const } },
      { id: 1, primitive: "point" as const, colorIndex: 2, geometry: { type: "point" as const, x: 0, y: 0, size: 4 }, motion: { type: "static" as const } },
      { id: 2, primitive: "line" as const, colorIndex: 3, geometry: { type: "line" as const, x1: 0, y1: 65535, x2: 65535, y2: 0, width: 4 }, motion: { type: "static" as const } },
      { id: 3, primitive: "circle" as const, colorIndex: 4, geometry: { type: "circle" as const, cx: 32767, cy: 32767, r: 32767, fill: true }, motion: { type: "static" as const } },
      { id: 4, primitive: "point" as const, colorIndex: 5, geometry: { type: "point" as const, x: 100, y: 100, size: 4 }, motion: { type: "linear" as const, dx: 32767, dy: -32768, edge: "wrap" as const } },
    ],
  };
  const v = validateScene(edge);
  assert.ok(v.valid, v.errors.join(" | "));
  const h = hashSceneJson(v.canonicalJson!);
  for (const profile of PROFILES) {
    const { width, height } = PACKAGE_PROFILE_DIMENSIONS[profile];
    const f = pkgFile(packScene(edge, profile, h));
    for (let tick = 0; tick < edge.durationTicks; tick++) {
      const expected = profile === "oled096"
        ? indicesToOledBuffer(renderSceneIndices(edge, width, height, tick), width, height, edge.palette, edge.backgroundIndex)
        : indicesToRgb565LE(renderSceneIndices(edge, width, height, tick), edge.palette);
      assert.ok(Buffer.compare(run(["frame", f, prof(profile), String(tick)]), Buffer.from(expected)) === 0, `${profile} tick ${tick}`);
    }
  }
});
