// tests/sceneV1Package.test.ts — paquet binaire ANAS : aller-retour, taille, rejet atomique des paquets corrompus.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import {
  packScene, unpackScene, crc32, HEADER_BYTES, PACKAGE_PROFILE_DIMENSIONS, type ScenePackageProfile,
} from "../lib/scene/package";
import { validateScene, canonicalizeScene } from "../lib/scene/validate";
import { hashSceneJson } from "../lib/scene/hash";
import { ALL_SCENES } from "./sceneFixtures";

const golden = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "scene-v1-golden.json"), "utf8"));
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const hashOf = (name: string) => hashSceneJson(validateScene(ALL_SCENES[name]).canonicalJson!);
const PROFILES: ScenePackageProfile[] = ["oled096", "tft18"];

/** Réécrit le CRC32 final d'un paquet modifié : simule un paquet bien formé mais sémantiquement faux. */
function resign(bytes: Uint8Array): Uint8Array {
  const out = Uint8Array.from(bytes);
  new DataView(out.buffer).setUint32(out.length - 4, crc32(out.subarray(0, out.length - 4)), true);
  return out;
}

test("CRC32 IEEE : vecteur standard « 123456789 » = 0xCBF43926", () => {
  assert.equal(crc32(new TextEncoder().encode("123456789")), 0xcbf43926);
  assert.equal(crc32(new Uint8Array(0)), 0);
});

test("aller-retour : pack → unpack redonne exactement la même scène, le même profil et les mêmes dimensions", () => {
  for (const name of Object.keys(ALL_SCENES)) {
    for (const profile of PROFILES) {
      const pkg = packScene(ALL_SCENES[name], profile, hashOf(name));
      const r = unpackScene(pkg);
      assert.ok(r.ok, `${name}/${profile}: ${r.ok ? "" : r.reason}`);
      if (!r.ok) continue;
      assert.equal(r.value.profile, profile);
      assert.deepEqual({ w: r.value.width, h: r.value.height }, { w: PACKAGE_PROFILE_DIMENSIONS[profile].width, h: PACKAGE_PROFILE_DIMENSIONS[profile].height });
      assert.equal(canonicalizeScene(r.value.scene), canonicalizeScene(ALL_SCENES[name]));
      assert.equal(r.value.sceneHashPrefix, hashOf(name).slice("sha256:".length, "sha256:".length + 16));
    }
  }
});

test("taille : tous les paquets ≤ 4096 octets, et plus compacts que le JSON canonique", () => {
  for (const name of Object.keys(ALL_SCENES)) {
    const pkg = packScene(ALL_SCENES[name], "oled096", hashOf(name));
    assert.ok(pkg.length <= 4096, `${name}: ${pkg.length}`);
    assert.ok(pkg.length < validateScene(ALL_SCENES[name]).bytes!, `${name}: binaire plus petit que le JSON`);
  }
});

test("GOLDEN : taille et sha256 des paquets identiques aux vecteurs normatifs (les firmwares parsent ces octets)", () => {
  for (const name of Object.keys(ALL_SCENES)) {
    for (const profile of PROFILES) {
      const pkg = packScene(ALL_SCENES[name], profile, hashOf(name));
      const g = golden.scenes[name].profiles[profile];
      assert.equal(pkg.length, g.packageBytes, `${name}/${profile}`);
      assert.equal(sha(pkg), g.packageSha256, `${name}/${profile}`);
    }
  }
});

test("en-tête : magic ANAS, versions, profil, dimensions, graine, cadence — little-endian", () => {
  const scene = ALL_SCENES.static;
  const pkg = packScene(scene, "tft18", hashOf("static"));
  const v = new DataView(pkg.buffer);
  assert.equal(String.fromCharCode(...pkg.subarray(0, 4)), "ANAS");
  assert.deepEqual([pkg[4], pkg[5], pkg[6], pkg[7]], [1, 1, 2, 0]);
  assert.equal(v.getUint16(8, true), 128);
  assert.equal(v.getUint16(10, true), 160);
  assert.equal(v.getUint32(12, true), scene.seed);
  assert.deepEqual([pkg[16], pkg[17], pkg[18], pkg[19], pkg[20], pkg[21]], [scene.tickRate, scene.durationTicks, scene.loopCount, scene.backgroundIndex, scene.palette.length, scene.entities.length]);
  assert.equal(HEADER_BYTES + v.getUint16(22, true) + 4, pkg.length);
});

test("REJET ATOMIQUE : tout paquet tronqué (chaque longueur 0..n−1) est refusé, jamais d'exception", () => {
  const pkg = packScene(ALL_SCENES.full24, "oled096", hashOf("full24"));
  for (let len = 0; len < pkg.length; len++) {
    const r = unpackScene(pkg.subarray(0, len));
    assert.equal(r.ok, false, `longueur ${len}`);
  }
  assert.equal(unpackScene(pkg).ok, true);
});

test("REJET : un seul octet modifié (chaque position) est détecté ; octets ajoutés refusés", () => {
  const pkg = packScene(ALL_SCENES.polyline, "tft18", hashOf("polyline"));
  for (let i = 0; i < pkg.length; i++) {
    const bad = Uint8Array.from(pkg);
    bad[i] ^= 0x01;
    assert.equal(unpackScene(bad).ok, false, `octet ${i}`);
  }
  assert.equal(unpackScene(Uint8Array.from([...pkg, 0])).ok, false);
  assert.equal(unpackScene(new Uint8Array(0)).ok, false);
});

test("REJET : magic, versions, profil, dimensions et champ réservé invalides — même avec un CRC valide", () => {
  const pkg = packScene(ALL_SCENES.static, "oled096", hashOf("static"));
  const mutate = (fn: (b: Uint8Array) => void) => { const b = Uint8Array.from(pkg); fn(b); return unpackScene(resign(b)); };
  assert.equal(mutate((b) => { b[0] = 0x58; }).ok, false, "magic");
  assert.equal(mutate((b) => { b[4] = 2; }).ok, false, "formatVersion");
  assert.equal(mutate((b) => { b[5] = 2; }).ok, false, "rendererVersion");
  assert.equal(mutate((b) => { b[6] = 9; }).ok, false, "profil");
  assert.equal(mutate((b) => { b[7] = 1; }).ok, false, "réservé");
  assert.equal(mutate((b) => { b[8] = 64; }).ok, false, "largeur ≠ profil");
});

test("REJET sémantique : un paquet bien formé (CRC valide) dont la scène viole le contrat est refusé", () => {
  const pkg = packScene(ALL_SCENES.oscillate, "oled096", hashOf("oscillate"));
  // seed = 0 (interdit)
  const noSeed = Uint8Array.from(pkg); new DataView(noSeed.buffer).setUint32(12, 0, true);
  const r1 = unpackScene(resign(noSeed));
  assert.ok(!r1.ok && r1.reason.includes("manifeste invalide"), r1.ok ? "" : r1.reason);
  // tickRate = 6 (> 5)
  const fast = Uint8Array.from(pkg); fast[16] = 6;
  assert.equal(unpackScene(resign(fast)).ok, false);
  // paletteCount = 0
  const noPal = Uint8Array.from(pkg); noPal[20] = 0;
  assert.equal(unpackScene(resign(noPal)).ok, false);
});

test("packScene refuse un sceneHash mal formé", () => {
  assert.throws(() => packScene(ALL_SCENES.static, "oled096", "sha256:zz"), /sceneHash invalide/);
});
