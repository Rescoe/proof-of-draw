// lib/scene/validate.ts
// Revalidation STRICTE du manifeste `ana-scene-v1` côté PoD (contrat note 37 §3-4, §8).
// ANA valide déjà avant d'émettre ; PoD ne lui fait pas confiance : même règles, recalcul de la
// forme canonique, aucune clé inconnue, aucun flottant, aucune correction silencieuse.
// Module PUR (pas de Node) : le hash vit dans lib/scene/hash.ts.

import {
  SCENE_SCHEMA, SCENE_RENDERER_VERSION, SCENE_MAX_BYTES, SCENE_MAX_ENTITIES, SCENE_MAX_POINTS,
  SCENE_MAX_TICKS, SCENE_MAX_OPS_PER_TICK, SIN_Q15_256,
  type AnaScene, type SceneEntity, type SceneGeometry, type SceneMotion, type ScenePrimitive,
} from "./spec";

export interface SceneValidation {
  valid: boolean;
  errors: string[];
  scene?: AnaScene;
  canonicalJson?: string;
  bytes?: number;
}

const SCENE_KEYS = ["schema", "rendererVersion", "seed", "tickRate", "durationTicks", "loopCount", "backgroundIndex", "palette", "clear", "entities"];
const ENTITY_KEYS = ["id", "primitive", "colorIndex", "geometry", "motion"];
const GEOMETRY_KEYS: Record<ScenePrimitive, string[]> = {
  point: ["type", "x", "y", "size"],
  line: ["type", "x1", "y1", "x2", "y2", "width"],
  rect: ["type", "x0", "y0", "x1", "y1", "fill"],
  circle: ["type", "cx", "cy", "r", "fill"],
  polyline: ["type", "points", "closed", "width"],
};
const MOTION_KEYS: Record<SceneMotion["type"], string[]> = {
  static: ["type"],
  linear: ["type", "dx", "dy", "edge"],
  "oscillate-x": ["type", "amplitude", "period", "phase"],
  "oscillate-y": ["type", "amplitude", "period", "phase"],
  orbit: ["type", "radiusX", "radiusY", "period", "phase"],
};

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function exactKeys(value: Record<string, unknown>, expected: string[], path: string, errors: string[]): void {
  for (const key of Object.keys(value)) if (!expected.includes(key)) errors.push(`${path}: unknown key ${key}`);
  for (const key of expected) if (!(key in value)) errors.push(`${path}: missing key ${key}`);
}

function integer(value: unknown, min: number, max: number, path: string, errors: string[]): value is number {
  if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max) {
    errors.push(`${path}: expected integer ${min}..${max}`);
    return false;
  }
  return true;
}

function bool(value: unknown, path: string, errors: string[]): value is boolean {
  if (typeof value !== "boolean") { errors.push(`${path}: expected boolean`); return false; }
  return true;
}

function validateMotion(raw: unknown, durationTicks: number, path: string, errors: string[]): SceneMotion | null {
  if (!isRecord(raw) || typeof raw.type !== "string" || !(raw.type in MOTION_KEYS)) {
    errors.push(`${path}: unsupported motion`);
    return null;
  }
  const type = raw.type as SceneMotion["type"];
  exactKeys(raw, MOTION_KEYS[type], path, errors);
  if (type === "static") return { type };
  if (type === "linear") {
    const dxOk = integer(raw.dx, -32768, 32767, `${path}.dx`, errors);
    const dyOk = integer(raw.dy, -32768, 32767, `${path}.dy`, errors);
    if (raw.edge !== "wrap") errors.push(`${path}.edge: expected wrap`);
    return dxOk && dyOk && raw.edge === "wrap" ? { type, dx: raw.dx as number, dy: raw.dy as number, edge: "wrap" } : null;
  }
  const periodOk = integer(raw.period, 2, durationTicks, `${path}.period`, errors);
  const phaseOk = periodOk && integer(raw.phase, 0, (raw.period as number) - 1, `${path}.phase`, errors);
  if (type === "orbit") {
    const rx = integer(raw.radiusX, 0, 32767, `${path}.radiusX`, errors);
    const ry = integer(raw.radiusY, 0, 32767, `${path}.radiusY`, errors);
    return rx && ry && phaseOk
      ? { type, radiusX: raw.radiusX as number, radiusY: raw.radiusY as number, period: raw.period as number, phase: raw.phase as number }
      : null;
  }
  const ampOk = integer(raw.amplitude, 0, 32767, `${path}.amplitude`, errors);
  return ampOk && phaseOk
    ? { type, amplitude: raw.amplitude as number, period: raw.period as number, phase: raw.phase as number }
    : null;
}

function validateGeometry(raw: unknown, primitive: ScenePrimitive, path: string, errors: string[]): SceneGeometry | null {
  if (!isRecord(raw)) { errors.push(`${path}: expected object`); return null; }
  exactKeys(raw, GEOMETRY_KEYS[primitive], path, errors);
  if (raw.type !== primitive) errors.push(`${path}.type: must equal primitive ${primitive}`);
  const u16 = (key: string) => integer(raw[key], 0, 65535, `${path}.${key}`, errors);
  if (primitive === "point") {
    return u16("x") && u16("y") && integer(raw.size, 1, 4, `${path}.size`, errors) && raw.type === primitive
      ? { type: primitive, x: raw.x as number, y: raw.y as number, size: raw.size as number } : null;
  }
  if (primitive === "line") {
    return u16("x1") && u16("y1") && u16("x2") && u16("y2") && integer(raw.width, 1, 4, `${path}.width`, errors) && raw.type === primitive
      ? { type: primitive, x1: raw.x1 as number, y1: raw.y1 as number, x2: raw.x2 as number, y2: raw.y2 as number, width: raw.width as number } : null;
  }
  if (primitive === "rect") {
    const ok = u16("x0") && u16("y0") && u16("x1") && u16("y1") && bool(raw.fill, `${path}.fill`, errors);
    if (ok && ((raw.x0 as number) > (raw.x1 as number) || (raw.y0 as number) > (raw.y1 as number))) errors.push(`${path}: rect bounds are reversed`);
    return ok && (raw.x0 as number) <= (raw.x1 as number) && (raw.y0 as number) <= (raw.y1 as number) && raw.type === primitive
      ? { type: primitive, x0: raw.x0 as number, y0: raw.y0 as number, x1: raw.x1 as number, y1: raw.y1 as number, fill: raw.fill as boolean } : null;
  }
  if (primitive === "circle") {
    const ok = u16("cx") && u16("cy") && integer(raw.r, 1, 32767, `${path}.r`, errors) && bool(raw.fill, `${path}.fill`, errors);
    if (ok && ((raw.cx as number) < (raw.r as number) || (raw.cy as number) < (raw.r as number)
      || (raw.cx as number) + (raw.r as number) > 65535 || (raw.cy as number) + (raw.r as number) > 65535)) {
      errors.push(`${path}: circle exceeds normalized canvas`);
    }
    return ok && raw.type === primitive ? { type: primitive, cx: raw.cx as number, cy: raw.cy as number, r: raw.r as number, fill: raw.fill as boolean } : null;
  }
  if (!Array.isArray(raw.points) || raw.points.length < 2 || raw.points.length > SCENE_MAX_POINTS) {
    errors.push(`${path}.points: expected 2..${SCENE_MAX_POINTS} points`);
    return null;
  }
  const points: Array<{ x: number; y: number }> = [];
  raw.points.forEach((point, index) => {
    const pp = `${path}.points[${index}]`;
    if (!isRecord(point)) { errors.push(`${pp}: expected object`); return; }
    exactKeys(point, ["x", "y"], pp, errors);
    if (integer(point.x, 0, 65535, `${pp}.x`, errors) && integer(point.y, 0, 65535, `${pp}.y`, errors)) points.push({ x: point.x as number, y: point.y as number });
  });
  const restOk = bool(raw.closed, `${path}.closed`, errors) && integer(raw.width, 1, 4, `${path}.width`, errors);
  return points.length === raw.points.length && restOk && raw.type === primitive
    ? { type: primitive, points, closed: raw.closed as boolean, width: raw.width as number } : null;
}

function geometryBounds(g: SceneGeometry): { minX: number; minY: number; maxX: number; maxY: number } {
  switch (g.type) {
    case "point": return { minX: g.x, minY: g.y, maxX: g.x, maxY: g.y };
    case "line": return { minX: Math.min(g.x1, g.x2), minY: Math.min(g.y1, g.y2), maxX: Math.max(g.x1, g.x2), maxY: Math.max(g.y1, g.y2) };
    case "rect": return { minX: g.x0, minY: g.y0, maxX: g.x1, maxY: g.y1 };
    case "circle": return { minX: g.cx - g.r, minY: g.cy - g.r, maxX: g.cx + g.r, maxY: g.cy + g.r };
    case "polyline": {
      const xs = g.points.map((p) => p.x), ys = g.points.map((p) => p.y);
      return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
    }
  }
}

function validateMotionBounds(entity: SceneEntity, path: string, errors: string[]): void {
  const b = geometryBounds(entity.geometry);
  const m = entity.motion;
  const fitsX = (r: number) => b.minX >= r && b.maxX + r <= 65535;
  const fitsY = (r: number) => b.minY >= r && b.maxY + r <= 65535;
  if (m.type === "oscillate-x" && !fitsX(m.amplitude)) errors.push(`${path}.motion: oscillation exceeds horizontal canvas`);
  if (m.type === "oscillate-y" && !fitsY(m.amplitude)) errors.push(`${path}.motion: oscillation exceeds vertical canvas`);
  if (m.type === "orbit" && (!fitsX(m.radiusX) || !fitsY(m.radiusY))) errors.push(`${path}.motion: orbit exceeds normalized canvas`);
}

/** Coût logique par tick d'une entité (contrat : budget ≤ 256 opérations logiques / tick). */
export function operationCost(e: SceneEntity): number {
  switch (e.primitive) {
    case "point": return 1;
    case "line": return 1;
    case "rect": return 4;
    case "circle": return 8;
    case "polyline": return e.geometry.type === "polyline" ? e.geometry.points.length + (e.geometry.closed ? 1 : 0) : 0;
  }
}

function canonicalGeometry(g: SceneGeometry): SceneGeometry {
  switch (g.type) {
    case "point": return { type: g.type, x: g.x, y: g.y, size: g.size };
    case "line": return { type: g.type, x1: g.x1, y1: g.y1, x2: g.x2, y2: g.y2, width: g.width };
    case "rect": return { type: g.type, x0: g.x0, y0: g.y0, x1: g.x1, y1: g.y1, fill: g.fill };
    case "circle": return { type: g.type, cx: g.cx, cy: g.cy, r: g.r, fill: g.fill };
    case "polyline": return { type: g.type, points: g.points.map((p) => ({ x: p.x, y: p.y })), closed: g.closed, width: g.width };
  }
}

function canonicalMotion(m: SceneMotion): SceneMotion {
  switch (m.type) {
    case "static": return { type: m.type };
    case "linear": return { type: m.type, dx: m.dx, dy: m.dy, edge: m.edge };
    case "oscillate-x":
    case "oscillate-y": return { type: m.type, amplitude: m.amplitude, period: m.period, phase: m.phase };
    case "orbit": return { type: m.type, radiusX: m.radiusX, radiusY: m.radiusY, period: m.period, phase: m.phase };
  }
}

/** Forme canonique : objet reconstruit dans l'ordre fixe du schéma, `JSON.stringify` sans espaces. L'ordre des entités/points est sémantique. */
export function canonicalizeScene(scene: AnaScene): string {
  const canonical: AnaScene = {
    schema: SCENE_SCHEMA,
    rendererVersion: SCENE_RENDERER_VERSION,
    seed: scene.seed,
    tickRate: scene.tickRate,
    durationTicks: scene.durationTicks,
    loopCount: scene.loopCount,
    backgroundIndex: scene.backgroundIndex,
    palette: [...scene.palette],
    clear: "solid",
    entities: scene.entities.map((e) => ({
      id: e.id, primitive: e.primitive, colorIndex: e.colorIndex,
      geometry: canonicalGeometry(e.geometry), motion: canonicalMotion(e.motion),
    })),
  };
  return JSON.stringify(canonical);
}

/** Décalage de mouvement d'une entité au tick donné — arithmétique entière uniquement (contrat §5). */
export function motionOffset(m: SceneMotion, tick: number): { x: number; y: number } {
  if (m.type === "static") return { x: 0, y: 0 };
  if (m.type === "linear") return { x: m.dx * tick, y: m.dy * tick };
  const index = Math.floor((((tick + m.phase) % m.period) * 256) / m.period) & 255;
  const sin = SIN_Q15_256[index];
  if (m.type === "orbit") {
    const cos = SIN_Q15_256[(index + 64) & 255];
    return { x: Math.trunc((m.radiusX * cos) / 32767), y: Math.trunc((m.radiusY * sin) / 32767) };
  }
  const d = Math.trunc((m.amplitude * sin) / 32767);
  return m.type === "oscillate-x" ? { x: d, y: 0 } : { x: 0, y: d };
}

/** Valide un manifeste brut. N'accepte QUE la forme exacte du schéma ; ne corrige rien. */
export function validateScene(raw: unknown): SceneValidation {
  const errors: string[] = [];
  if (!isRecord(raw)) return { valid: false, errors: ["scene: expected object"] };
  exactKeys(raw, SCENE_KEYS, "scene", errors);
  if (raw.schema !== SCENE_SCHEMA) errors.push(`scene.schema: expected ${SCENE_SCHEMA}`);
  if (raw.rendererVersion !== SCENE_RENDERER_VERSION) errors.push("scene.rendererVersion: expected 1");
  integer(raw.seed, 1, 0xffffffff, "scene.seed", errors);
  integer(raw.tickRate, 1, 5, "scene.tickRate", errors);
  integer(raw.durationTicks, 1, SCENE_MAX_TICKS, "scene.durationTicks", errors);
  integer(raw.loopCount, 1, 3, "scene.loopCount", errors);
  if (raw.clear !== "solid") errors.push("scene.clear: expected solid");
  if (!Array.isArray(raw.palette) || raw.palette.length < 1 || raw.palette.length > 8) {
    errors.push("scene.palette: expected 1..8 RGB565 integers");
  }
  const palette = Array.isArray(raw.palette) ? raw.palette : [];
  palette.forEach((c, i) => integer(c, 0, 65535, `scene.palette[${i}]`, errors));
  integer(raw.backgroundIndex, 0, Math.max(0, palette.length - 1), "scene.backgroundIndex", errors);
  if (!Array.isArray(raw.entities) || raw.entities.length < 1 || raw.entities.length > SCENE_MAX_ENTITIES) {
    errors.push(`scene.entities: expected 1..${SCENE_MAX_ENTITIES} entities`);
  }
  const durationTicks = Number.isSafeInteger(raw.durationTicks) ? (raw.durationTicks as number) : SCENE_MAX_TICKS;
  const entities: SceneEntity[] = [];
  const ids = new Set<number>();
  if (Array.isArray(raw.entities)) raw.entities.forEach((item, index) => {
    const path = `scene.entities[${index}]`;
    if (!isRecord(item)) { errors.push(`${path}: expected object`); return; }
    exactKeys(item, ENTITY_KEYS, path, errors);
    const primitive = item.primitive;
    if (typeof primitive !== "string" || !(primitive in GEOMETRY_KEYS)) { errors.push(`${path}.primitive: unsupported primitive`); return; }
    const idOk = integer(item.id, 0, SCENE_MAX_ENTITIES - 1, `${path}.id`, errors);
    if (idOk && ids.has(item.id as number)) errors.push(`${path}.id: duplicate id ${item.id}`);
    if (idOk) ids.add(item.id as number);
    const colorOk = integer(item.colorIndex, 0, Math.max(0, palette.length - 1), `${path}.colorIndex`, errors);
    const geometry = validateGeometry(item.geometry, primitive as ScenePrimitive, `${path}.geometry`, errors);
    const motion = validateMotion(item.motion, durationTicks, `${path}.motion`, errors);
    if (idOk && colorOk && geometry && motion) {
      const entity: SceneEntity = { id: item.id as number, primitive: primitive as ScenePrimitive, colorIndex: item.colorIndex as number, geometry, motion };
      validateMotionBounds(entity, path, errors);
      entities.push(entity);
    }
  });

  const ops = entities.reduce((sum, e) => sum + operationCost(e), 0);
  if (ops > SCENE_MAX_OPS_PER_TICK) errors.push(`scene.entities: ${ops} logical operations per tick exceeds ${SCENE_MAX_OPS_PER_TICK}`);
  if (errors.length > 0) return { valid: false, errors };

  const scene: AnaScene = {
    schema: SCENE_SCHEMA,
    rendererVersion: SCENE_RENDERER_VERSION,
    seed: raw.seed as number,
    tickRate: raw.tickRate as number,
    durationTicks: raw.durationTicks as number,
    loopCount: raw.loopCount as number,
    backgroundIndex: raw.backgroundIndex as number,
    palette: palette as number[],
    clear: "solid",
    entities,
  };
  // Simulation de tous les ticks : l'arithmétique de mouvement doit rester dans les entiers sûrs.
  for (let tick = 0; tick < scene.durationTicks; tick++) {
    for (let i = 0; i < scene.entities.length; i++) {
      const o = motionOffset(scene.entities[i].motion, tick);
      if (!Number.isSafeInteger(o.x) || !Number.isSafeInteger(o.y)) return { valid: false, errors: [`entities[${i}]: unsafe arithmetic at tick ${tick}`] };
    }
  }
  const canonicalJson = canonicalizeScene(scene);
  const bytes = new TextEncoder().encode(canonicalJson).length;
  if (bytes > SCENE_MAX_BYTES) return { valid: false, errors: [`scene: canonical JSON is ${bytes} bytes, maximum is ${SCENE_MAX_BYTES}`] };
  return { valid: true, errors: [], scene, canonicalJson, bytes };
}
