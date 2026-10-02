// lib/scene/package.ts
// Paquet binaire `ANAS` (≤ 4 096 octets) : ce que l'OLED/TFT télécharge et interprète — jamais de JSON ni de HTML sur l'ESP.
// Little-endian, aucun padding, CRC32 final. Format normatif décrit dans docs/SCENE_V1_MOTEUR.md.
// Les coordonnées restent NORMALISÉES (u16) : le firmware applique le même toPixel() que le moteur de référence.
//
//   Header (32 octets)
//     0  "ANAS"            4   magic
//     4  u8  formatVersion = 1
//     5  u8  rendererVersion = 1
//     6  u8  profile (1 = oled096, 2 = tft18)
//     7  u8  reserved = 0
//     8  u16 width     10 u16 height
//     12 u32 seed
//     16 u8  tickRate  17 u8 durationTicks  18 u8 loopCount  19 u8 backgroundIndex
//     20 u8  paletteCount  21 u8 entityCount  22 u16 bodyLength (octets entre le header et le CRC)
//     24 8 octets : 8 premiers octets de sceneHash (identité, diagnostic)
//   Corps : palette u16[paletteCount] puis entités (id u8, primitive u8, colorIndex u8, motion u8, géométrie, mouvement)
//   Trailer : u32 CRC32 (IEEE 802.3) de tous les octets précédents.

import {
  SCENE_RENDERER_VERSION, SCENE_MAX_BYTES, type AnaScene, type SceneEntity, type SceneGeometry, type SceneMotion,
} from "./spec";
import { validateScene } from "./validate";

export const PACKAGE_MAGIC = "ANAS";
export const PACKAGE_FORMAT_VERSION = 1;
export const HEADER_BYTES = 32;

export const PROFILE_CODE = { oled096: 1, tft18: 2 } as const;
export type ScenePackageProfile = keyof typeof PROFILE_CODE;
export const PACKAGE_PROFILE_DIMENSIONS: Record<ScenePackageProfile, { width: number; height: number }> = {
  oled096: { width: 128, height: 64 },
  tft18: { width: 128, height: 160 },
};

const PRIMITIVE_CODE = { point: 1, line: 2, rect: 3, circle: 4, polyline: 5 } as const;
const MOTION_CODE = { static: 0, linear: 1, "oscillate-x": 2, "oscillate-y": 3, orbit: 4 } as const;
const PRIMITIVE_BY_CODE = ["", "point", "line", "rect", "circle", "polyline"] as const;
const MOTION_BY_CODE = ["static", "linear", "oscillate-x", "oscillate-y", "orbit"] as const;

// ─── CRC32 (IEEE) ────────────────────────────────────────────────────────────

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// ─── Écriture ────────────────────────────────────────────────────────────────

class Writer {
  private b: number[] = [];
  u8(v: number) { this.b.push(v & 0xff); }
  u16(v: number) { this.b.push(v & 0xff, (v >> 8) & 0xff); }
  i16(v: number) { this.u16(v & 0xffff); }
  u32(v: number) { this.b.push(v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff); }
  get length() { return this.b.length; }
  bytes() { return Uint8Array.from(this.b); }
}

function writeGeometry(w: Writer, g: SceneGeometry): void {
  switch (g.type) {
    case "point": w.u16(g.x); w.u16(g.y); w.u8(g.size); return;
    case "line": w.u16(g.x1); w.u16(g.y1); w.u16(g.x2); w.u16(g.y2); w.u8(g.width); return;
    case "rect": w.u16(g.x0); w.u16(g.y0); w.u16(g.x1); w.u16(g.y1); w.u8(g.fill ? 1 : 0); return;
    case "circle": w.u16(g.cx); w.u16(g.cy); w.u16(g.r); w.u8(g.fill ? 1 : 0); return;
    case "polyline":
      w.u8(g.points.length); w.u8(g.closed ? 1 : 0); w.u8(g.width);
      for (const p of g.points) { w.u16(p.x); w.u16(p.y); }
      return;
  }
}

function writeMotion(w: Writer, m: SceneMotion): void {
  switch (m.type) {
    case "static": return;
    case "linear": w.i16(m.dx); w.i16(m.dy); return;
    case "oscillate-x":
    case "oscillate-y": w.u16(m.amplitude); w.u8(m.period); w.u8(m.phase); return;
    case "orbit": w.u16(m.radiusX); w.u16(m.radiusY); w.u8(m.period); w.u8(m.phase); return;
  }
}

/** Compile une scène DÉJÀ validée en paquet ANAS pour un profil. `sceneHash` = "sha256:<hex>" (8 premiers octets gardés). */
export function packScene(scene: AnaScene, profile: ScenePackageProfile, sceneHash: string): Uint8Array {
  const dims = PACKAGE_PROFILE_DIMENSIONS[profile];
  const hex = sceneHash.replace(/^sha256:/, "");
  if (!/^[0-9a-f]{64}$/.test(hex)) throw new Error("packScene: sceneHash invalide");

  const body = new Writer();
  for (const c of scene.palette) body.u16(c);
  for (const e of scene.entities) {
    body.u8(e.id); body.u8(PRIMITIVE_CODE[e.primitive]); body.u8(e.colorIndex); body.u8(MOTION_CODE[e.motion.type]);
    writeGeometry(body, e.geometry);
    writeMotion(body, e.motion);
  }
  const bodyBytes = body.bytes();

  const head = new Writer();
  for (const ch of PACKAGE_MAGIC) head.u8(ch.charCodeAt(0));
  head.u8(PACKAGE_FORMAT_VERSION); head.u8(SCENE_RENDERER_VERSION); head.u8(PROFILE_CODE[profile]); head.u8(0);
  head.u16(dims.width); head.u16(dims.height);
  head.u32(scene.seed);
  head.u8(scene.tickRate); head.u8(scene.durationTicks); head.u8(scene.loopCount); head.u8(scene.backgroundIndex);
  head.u8(scene.palette.length); head.u8(scene.entities.length); head.u16(bodyBytes.length);
  for (let i = 0; i < 8; i++) head.u8(parseInt(hex.slice(i * 2, i * 2 + 2), 16));
  const headBytes = head.bytes();

  const withoutCrc = new Uint8Array(headBytes.length + bodyBytes.length);
  withoutCrc.set(headBytes, 0); withoutCrc.set(bodyBytes, headBytes.length);
  const out = new Uint8Array(withoutCrc.length + 4);
  out.set(withoutCrc, 0);
  new DataView(out.buffer).setUint32(withoutCrc.length, crc32(withoutCrc), true);
  if (out.length > SCENE_MAX_BYTES) throw new Error(`packScene: paquet ${out.length} octets > ${SCENE_MAX_BYTES}`);
  return out;
}

// ─── Lecture (rejet atomique de tout paquet tronqué / corrompu) ──────────────

export interface UnpackedPackage {
  profile: ScenePackageProfile;
  width: number;
  height: number;
  scene: AnaScene;
  sceneHashPrefix: string;   // 16 hex = 8 premiers octets du sceneHash
}

export type UnpackResult = { ok: true; value: UnpackedPackage } | { ok: false; reason: string };

class Reader {
  private o = 0;
  constructor(private v: DataView, private end: number) {}   // `end` : fin lisible, relative au DataView
  get offset() { return this.o; }
  private need(n: number) { if (this.o + n > this.end) throw new Error("paquet tronqué"); }
  u8() { this.need(1); return this.v.getUint8(this.o++); }
  /** Booléen strict : 0 ou 1, tout autre octet = paquet invalide (aucune interprétation « truthy »). */
  bool() { const b = this.u8(); if (b > 1) throw new Error("booléen invalide"); return b === 1; }
  u16() { this.need(2); const x = this.v.getUint16(this.o, true); this.o += 2; return x; }
  i16() { this.need(2); const x = this.v.getInt16(this.o, true); this.o += 2; return x; }
}

function readGeometry(r: Reader, primitive: string): SceneGeometry {
  switch (primitive) {
    case "point": return { type: "point", x: r.u16(), y: r.u16(), size: r.u8() };
    case "line": return { type: "line", x1: r.u16(), y1: r.u16(), x2: r.u16(), y2: r.u16(), width: r.u8() };
    case "rect": return { type: "rect", x0: r.u16(), y0: r.u16(), x1: r.u16(), y1: r.u16(), fill: r.bool() };
    case "circle": return { type: "circle", cx: r.u16(), cy: r.u16(), r: r.u16(), fill: r.bool() };
    default: {
      const n = r.u8(), closed = r.bool(), width = r.u8();
      const points: Array<{ x: number; y: number }> = [];
      for (let i = 0; i < n; i++) points.push({ x: r.u16(), y: r.u16() });
      return { type: "polyline", points, closed, width };
    }
  }
}

function readMotion(r: Reader, type: SceneMotion["type"]): SceneMotion {
  switch (type) {
    case "static": return { type };
    case "linear": return { type, dx: r.i16(), dy: r.i16(), edge: "wrap" };
    case "oscillate-x":
    case "oscillate-y": return { type, amplitude: r.u16(), period: r.u8(), phase: r.u8() };
    case "orbit": return { type, radiusX: r.u16(), radiusY: r.u16(), period: r.u8(), phase: r.u8() };
  }
}

/** Décode ET revalide un paquet : magic, versions, longueur, CRC32, puis règles strictes du manifeste. Jamais d'exception. */
export function unpackScene(bytes: Uint8Array): UnpackResult {
  try {
    if (bytes.length < HEADER_BYTES + 4) return { ok: false, reason: "paquet trop court" };
    if (bytes.length > SCENE_MAX_BYTES) return { ok: false, reason: "paquet > 4096 octets" };
    const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]) !== PACKAGE_MAGIC) return { ok: false, reason: "magic invalide" };
    if (bytes[4] !== PACKAGE_FORMAT_VERSION) return { ok: false, reason: `formatVersion ${bytes[4]} non pris en charge` };
    if (bytes[5] !== SCENE_RENDERER_VERSION) return { ok: false, reason: `rendererVersion ${bytes[5]} non pris en charge` };
    const profile = (Object.keys(PROFILE_CODE) as ScenePackageProfile[]).find((p) => PROFILE_CODE[p] === bytes[6]);
    if (!profile) return { ok: false, reason: `profil ${bytes[6]} inconnu` };
    if (bytes[7] !== 0) return { ok: false, reason: "champ réservé non nul" };
    const width = v.getUint16(8, true), height = v.getUint16(10, true);
    const dims = PACKAGE_PROFILE_DIMENSIONS[profile];
    if (width !== dims.width || height !== dims.height) return { ok: false, reason: "dimensions incohérentes avec le profil" };
    const bodyLength = v.getUint16(22, true);
    if (HEADER_BYTES + bodyLength + 4 !== bytes.length) return { ok: false, reason: "longueur déclarée ≠ longueur reçue" };
    const crcPos = bytes.length - 4;
    if (crc32(bytes.subarray(0, crcPos)) !== v.getUint32(crcPos, true)) return { ok: false, reason: "CRC32 invalide" };

    const paletteCount = bytes[20], entityCount = bytes[21];
    const body = new Reader(new DataView(bytes.buffer, bytes.byteOffset + HEADER_BYTES, bodyLength), bodyLength);
    const palette: number[] = [];
    for (let i = 0; i < paletteCount; i++) palette.push(body.u16());
    const entities: SceneEntity[] = [];
    for (let i = 0; i < entityCount; i++) {
      const id = body.u8(), pc = body.u8(), colorIndex = body.u8(), mc = body.u8();
      const primitive = PRIMITIVE_BY_CODE[pc], motionType = MOTION_BY_CODE[mc];
      if (!primitive) return { ok: false, reason: `primitive ${pc} inconnue` };
      if (!motionType) return { ok: false, reason: `mouvement ${mc} inconnu` };
      const geometry = readGeometry(body, primitive);
      const motion = readMotion(body, motionType);
      entities.push({ id, primitive, colorIndex, geometry, motion });
    }
    if (body.offset !== bodyLength) return { ok: false, reason: "octets excédentaires dans le corps" };

    const candidate = {
      schema: "ana-scene-v1", rendererVersion: 1, seed: v.getUint32(12, true),
      tickRate: bytes[16], durationTicks: bytes[17], loopCount: bytes[18], backgroundIndex: bytes[19],
      palette, clear: "solid", entities,
    };
    const check = validateScene(candidate);
    if (!check.valid || !check.scene) return { ok: false, reason: `manifeste invalide : ${check.errors[0]}` };
    const prefix = Array.from(bytes.subarray(24, 32)).map((b) => b.toString(16).padStart(2, "0")).join("");
    return { ok: true, value: { profile, width, height, scene: check.scene, sceneHashPrefix: prefix } };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : "paquet illisible" };
  }
}
