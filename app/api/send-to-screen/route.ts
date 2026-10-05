// app/api/send-to-screen/route.ts
// POST /api/send-to-screen { source: "human" | "ana", blockHash, deviceId, screen }
// Réaffiche sur UN écran de l'utilisateur un dessin d'une galerie (humaine ou
// agent IA). Le dessin est converti au format de l'écran choisi si besoin
// (lib/screenConvert.ts) ; pour une œuvre d'agent, on préfère le bloc natif de
// cet écran quand il existe (encodé depuis les pixels bruts, sans conversion).
//
// Mécanisme : même "personal frame" que /api/personal-frame (affichée sur cet
// ESP seulement, effacée au prochain bloc validé par sa pool, pas de quorum).
// Auth : l'écran doit appartenir à l'utilisateur (cookie de session, ou ESP lié
// au même profil artiste). Rate limit partagé avec personal-frame : 10 / heure.

import { NextRequest, NextResponse } from "next/server";
import { redis } from "@/lib/redis";
import { getSession } from "@/lib/session";
import { getDevice, getDeviceIdsByArtist } from "@/lib/deviceStore";
import { getBlockByHash, getBlockImage, getBlockAnim } from "@/lib/chain";
import { getAnaBlockByHash, getAnaBlockImage, getRecentAnaWorks, anaGroupKey } from "@/lib/anaChain";
import { convertPayload } from "@/lib/screenConvert";
import { isValidScreenId } from "@/lib/screenProfiles";
import { animCapable, animPointerOfBlock, type AnimPointer } from "@/lib/anim/pointer";
import { decodeClip } from "@/lib/bench/clip";
import { posterFor, type AnimScreen } from "@/lib/anim/block";
import { getIP, isBlacklisted, forbidden } from "@/lib/rateLimit";
import { markHot } from "@/lib/hot";

const DEVICE_ID_REGEX = /^dev_[A-Z0-9]{8}$/;
const HASH_REGEX      = /^[0-9a-f]{64}$/;
const PERSONAL_TTL    = 7 * 24 * 3600;
const personalKey     = (deviceId: string) => `personal:frame:${deviceId}`;

async function userOwnsDevice(deviceId: string): Promise<boolean> {
  const session = await getSession();
  if (session.deviceIds.includes(deviceId)) return true;
  if (session.artistId) return (await getDeviceIdsByArtist(session.artistId)).includes(deviceId);
  return false;
}

export async function POST(req: NextRequest) {
  const ip = getIP(req);
  if (await isBlacklisted(ip)) return forbidden("Accès refusé");

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "JSON invalide" }, { status: 400 }); }

  const { source, blockHash, deviceId, screen } = body as Record<string, string>;
  if (source !== "human" && source !== "ana")
    return NextResponse.json({ error: "source invalide" }, { status: 400 });
  if (!blockHash || !HASH_REGEX.test(blockHash))
    return NextResponse.json({ error: "blockHash invalide" }, { status: 400 });
  if (!deviceId || !DEVICE_ID_REGEX.test(deviceId))
    return NextResponse.json({ error: "deviceId invalide" }, { status: 400 });
  if (!screen || !isValidScreenId(screen))
    return NextResponse.json({ error: "screen invalide" }, { status: 400 });

  if (await redis.get(`bl:dev:${deviceId}`)) return forbidden("Device banni");
  if (!(await userOwnsDevice(deviceId)))
    return NextResponse.json({ error: "Cet écran ne vous appartient pas" }, { status: 403 });

  const device = await getDevice(deviceId);
  if (!device || !device.screens.includes(screen))
    return NextResponse.json({ error: "Device ou écran introuvable" }, { status: 404 });

  // ── Source : image + métadonnées cartel ────────────────────────────────────
  let image: Record<string, unknown> | null = null;
  let workTitle: string | undefined;
  let drawArtistName: string | undefined;
  let blockIndex: number | undefined;     // n° du bloc d'origine : le cartel de l'écran doit afficher CELUI-LÀ, pas la tête de chaîne
  let animPtr: AnimPointer | null = null; // bloc d'ANIMATION : l'écran rapatrie le clip et le joue en boucle

  if (source === "human") {
    const [block, img] = await Promise.all([getBlockByHash(blockHash), getBlockImage(blockHash)]);
    if (!block || !img) return NextResponse.json({ error: "Bloc introuvable" }, { status: 404 });
    image = { ...img };
    workTitle = block.workTitle;
    drawArtistName = block.drawArtistName ?? block.artistName;
    blockIndex = block.blockIndex;
    if (block.kind === "animation") {
      // Le clip est le même pour tous les écrans dynamiques : il se réaffiche sur n'importe lequel de TES écrans dont le firmware (version déclarée) lit les
      // animations (TFT 2.8", TFT 1.8", OLED) — l'affiche est rendue pour CET écran depuis le clip. Jamais sur un e-ink ni sur un firmware ancien.
      if (!animCapable(device, screen)) {
        return NextResponse.json({
          error: "Une animation ne se réaffiche que sur un écran TFT 2.8\", TFT 1.8\" ou OLED dont le firmware lit les animations (voir Mon profil).",
        }, { status: 422 });
      }
      const doc = await getBlockAnim(blockHash);
      if (!doc) return NextResponse.json({ error: "Clip d'animation introuvable" }, { status: 404 });
      try {
        const clip = decodeClip(new Uint8Array(Buffer.from(doc.clip, "base64")));
        image = { screen, buffer: posterFor(clip.frames[doc.posterIndex] ?? clip.frames[0], screen as AnimScreen, clip.fg, clip.bg) };
      } catch { return NextResponse.json({ error: "Clip d'animation illisible" }, { status: 422 }); }
      animPtr = animPointerOfBlock(block);
    }
  } else {
    const block = await getAnaBlockByHash(blockHash);
    if (!block) return NextResponse.json({ error: "Bloc introuvable" }, { status: 404 });
    workTitle = block.workTitle;
    drawArtistName = block.drawArtistName ?? block.artistName;
    blockIndex = block.blockIndex;
    // Bloc natif de l'écran cible dans la même œuvre, s'il existe
    const key = anaGroupKey(block);
    const sibling = (await getRecentAnaWorks()).find((w) => w.groupKey === key)
      ?.screens.find((s) => s.screen === screen);
    const img = await getAnaBlockImage(sibling?.blockHash ?? blockHash);
    if (!img) return NextResponse.json({ error: "Image introuvable" }, { status: 404 });
    image = { ...img };
  }

  // ── Conversion si l'image n'est pas déjà au format de l'écran ──────────────
  let payload: Record<string, unknown>;
  if (image.screen === screen) {
    payload = image;
  } else {
    const converted = convertPayload(image, screen);
    if (!converted) return NextResponse.json({ error: "Conversion impossible" }, { status: 422 });
    payload = { ...converted };
  }

  // ── Rate limit partagé avec /api/personal-frame (10 / heure / device) ──────
  const rlKey = `rl:personal:${deviceId}`;
  const count = await redis.incr(rlKey);
  if (count === 1) await redis.expire(rlKey, 3600);
  if (count > 10)
    return NextResponse.json({ error: "Trop d'envois (10/heure max par écran)" }, { status: 429 });

  const stored = JSON.stringify({
    payload: { ...payload, screen, ...(animPtr ? { anim: animPtr } : {}), ...(workTitle ? { workTitle } : {}), ...(drawArtistName ? { drawArtistName } : {}), ...(typeof blockIndex === "number" ? { blockIndex } : {}) },
    frameId:   crypto.randomUUID(),
    createdAt: Date.now(),
    personal:  true,
  });
  await redis.set(personalKey(deviceId), stored, { ex: PERSONAL_TTL });
  markHot().catch(() => {});   // un écran attend une image : le réseau passe à 5 min de pull

  console.log(`[send-to-screen] source=${source} block=${blockHash.slice(0, 12)} device=${deviceId} screen=${screen}`);
  return NextResponse.json({ ok: true });
}
