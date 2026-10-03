// POST /api/bench/send — le propriétaire envoie une animation au TFT 2.8" tactile (banc d'essai).
// Corps : { deviceId, frames: string[] (base64, 1024 octets chacune), delaysMs: number[], loops, fg, bg } (fg/bg = RGB565).
// Le serveur ENCODE (différences entre images) et applique les plafonds — l'interface n'est jamais la source de vérité.
// Option : gallery: { title } → l'animation FAITE À LA MAIN est aussi enregistrée dans la galerie « Animations » (jamais les modèles de test).

import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { getDevice } from "@/lib/deviceStore";
import { sessionOwnsDevice } from "@/lib/session";
import { CLIP, clipStats, encodeClip, validateClipInput } from "@/lib/bench/clip";
import { benchLock, benchLog, DEVICE_ID_REGEX, storeClip, type ClipPointer } from "@/lib/bench/store";
import { buildAnimItem, galleryRefusal, saveAnimation } from "@/lib/anim/store";

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "JSON invalide" }, { status: 400 }); }

  const deviceId = String(body.deviceId ?? "");
  if (!DEVICE_ID_REGEX.test(deviceId)) return NextResponse.json({ error: "deviceId invalide" }, { status: 400 });
  if (!(await sessionOwnsDevice(deviceId))) return NextResponse.json({ error: "Non autorisé" }, { status: 403 });
  const device = await getDevice(deviceId);
  if (!device) return NextResponse.json({ error: "Appareil introuvable" }, { status: 404 });
  if (!device.screens.includes("tft28")) return NextResponse.json({ error: "Le banc d'essai ne concerne que le TFT 2.8\" tactile" }, { status: 400 });

  const rawFrames = Array.isArray(body.frames) ? body.frames : [];
  if (rawFrames.length > CLIP.MAX_FRAMES) return NextResponse.json({ error: `1 à ${CLIP.MAX_FRAMES} images` }, { status: 400 });
  const frames = rawFrames.map((f) => new Uint8Array(Buffer.from(String(f), "base64")));
  const input = {
    frames,
    delaysMs: Array.isArray(body.delaysMs) ? body.delaysMs.map(Number) : [],
    loops: Number(body.loops),
    fg: Number(body.fg),
    bg: Number(body.bg),
  };
  const invalid = validateClipInput(input);
  if (invalid) return NextResponse.json({ error: invalid }, { status: 400 });

  if (!(await benchLock("send", deviceId, 3))) return NextResponse.json({ error: "Un envoi toutes les 3 secondes maximum" }, { status: 429 });

  const stats = clipStats(input);
  if (!stats.fitsDevice) {
    return NextResponse.json({
      error: `Clip trop gros pour l'appareil : ${stats.bytes} octets (maximum ${CLIP.MAX_CLIP_BYTES}). Moins d'images, moins de pixels qui changent, ou un dessin plus simple.`,
      stats,
    }, { status: 413 });
  }
  const bin = encodeClip(input);
  const ptr: ClipPointer = {
    clipId: randomBytes(4).toString("hex"),
    bytes: bin.length, frames: frames.length, loops: input.loops, playMs: stats.playMs, createdAt: Date.now(),
  };
  await storeClip(deviceId, bin, ptr);

  let gallery: { id: string; duplicate: boolean } | { refused: string } | undefined;
  const g = body.gallery;
  if (g && typeof g === "object") {
    const refusal = galleryRefusal(input);
    if (refusal) gallery = { refused: refusal };
    else gallery = await saveAnimation(buildAnimItem(input, { title: (g as { title?: unknown }).title, author: device.artistName, deviceId }));
  }
  await benchLog(deviceId, `clip ${ptr.clipId} ENVOYÉ : ${bin.length} octets, ${frames.length} images, ${input.loops === 0 ? "en boucle (∞)" : `${input.loops} boucle(s)`}${gallery && "id" in gallery ? (gallery.duplicate ? " · déjà dans la galerie" : " · enregistré dans la galerie") : ""}`);
  return NextResponse.json({ ok: true, ...ptr, stats, ...(gallery ? { gallery } : {}) });
}
