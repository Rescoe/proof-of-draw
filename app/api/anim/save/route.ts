// POST /api/anim/save — enregistre une animation FAITE À LA MAIN dans la galerie « Animations » (sans l'envoyer à un écran).
// Corps : { deviceId (un appareil du propriétaire : sert d'identité d'auteur), title, frames: base64[], delaysMs, loops, fg, bg }.

import { NextRequest, NextResponse } from "next/server";
import { getDevice } from "@/lib/deviceStore";
import { sessionOwnsDevice } from "@/lib/session";
import { CLIP, validateClipInput } from "@/lib/bench/clip";
import { benchLock, DEVICE_ID_REGEX } from "@/lib/bench/store";
import { buildAnimItem, galleryRefusal, saveAnimation } from "@/lib/anim/store";

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "JSON invalide" }, { status: 400 }); }
  const deviceId = String(body.deviceId ?? "");
  if (!DEVICE_ID_REGEX.test(deviceId)) return NextResponse.json({ error: "deviceId invalide" }, { status: 400 });
  if (!(await sessionOwnsDevice(deviceId))) return NextResponse.json({ error: "Non autorisé" }, { status: 403 });
  const device = await getDevice(deviceId);
  if (!device) return NextResponse.json({ error: "Appareil introuvable" }, { status: 404 });

  const rawFrames = Array.isArray(body.frames) ? body.frames : [];
  if (rawFrames.length > CLIP.MAX_FRAMES) return NextResponse.json({ error: `1 à ${CLIP.MAX_FRAMES} images` }, { status: 400 });
  const input = {
    frames: rawFrames.map((f) => new Uint8Array(Buffer.from(String(f), "base64"))),
    delaysMs: Array.isArray(body.delaysMs) ? body.delaysMs.map(Number) : [],
    loops: Number(body.loops), fg: Number(body.fg), bg: Number(body.bg),
  };
  const invalid = validateClipInput(input) ?? galleryRefusal(input);
  if (invalid) return NextResponse.json({ error: invalid }, { status: 400 });
  if (!(await benchLock("save", deviceId, 3))) return NextResponse.json({ error: "Un enregistrement toutes les 3 secondes maximum" }, { status: 429 });

  let item;
  try { item = buildAnimItem(input, { title: body.title, author: device.artistName, deviceId }); }
  catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : "Animation invalide" }, { status: 400 }); }
  const saved = await saveAnimation(item);
  return NextResponse.json({ ok: true, ...saved, bytes: item.bytes, frames: item.frames });
}
