// app/api/pull-frame/route.ts
import { NextRequest, NextResponse } from "next/server";
import { redis } from "@/lib/redis";
import { getDevice } from "@/lib/deviceStore";
import { getFrameForDevice } from "@/lib/queue";
import { isSceneScreen, selectDelivery } from "@/lib/scene/delivery";
import { getScenePackage } from "@/lib/scene/store";

const DEVICE_ID_REGEX = /^dev_[A-Z0-9]{8}$/;
const personalKey = (deviceId: string) => `personal:frame:${deviceId}`;

export async function GET(req: NextRequest) {
  try {
    const url      = new URL(req.url);
    const deviceId = url.searchParams.get("deviceId");
    const fmt      = url.searchParams.get("fmt");    // "bin" ou null
    const screen   = url.searchParams.get("screen"); // "eink29bwr" | "eink27bw" | "oled096" | null

    if (!deviceId || !DEVICE_ID_REGEX.test(deviceId))
      return NextResponse.json({ error: "deviceId invalide" }, { status: 400 });

    const device = await getDevice(deviceId);
    if (!device)
      return NextResponse.json({ error: "device inconnu" }, { status: 404 });

    // ── scene-v1 : paquet binaire ANAS (≤ 4 Ko) ────────────────────────────
    // GET /api/pull-frame?deviceId=…&screen=oled096&kind=scene&artifactId=…&fmt=bin
    // N'est servi qu'à un appareil déclaré scene-v1 ET seulement l'artefact désigné par SA frame en attente (le pointeur
    // de /api/pull) : pas de lecture arbitraire. Coût : 1 GET frame + 1 GET paquet, jamais de commande par frame d'animation.
    // En cas de refus (404) le firmware retombe sur le chemin frame ci-dessous, sans `kind` — comportement inchangé.
    if (url.searchParams.get("kind") === "scene") {
      const artifactId = url.searchParams.get("artifactId");
      if (fmt !== "bin" || !screen || !isSceneScreen(screen) || !artifactId)
        return NextResponse.json({ error: "kind=scene exige fmt=bin, screen oled096|tft18 et artifactId" }, { status: 400 });

      const pending = await getFrameForDevice(deviceId, [screen]);
      const selection = selectDelivery(device, screen, pending?.payload as Record<string, unknown> | undefined);
      if (selection.kind !== "scene" || selection.artifactId !== artifactId)
        return NextResponse.json({ error: "aucune scène en attente pour cet appareil" }, { status: 404 });

      const pkg = await getScenePackage(redis, artifactId);
      if (!pkg) return NextResponse.json({ error: "paquet de scène absent" }, { status: 404 });

      return new NextResponse(pkg as unknown as BodyInit, {
        status: 200,
        headers: {
          "Content-Type":   "application/octet-stream",
          "Content-Length": String(pkg.length),
          "X-Scene-Hash":   selection.pointer.sceneHash.replace(/^sha256:/, "").slice(0, 16),
          "X-Frame-Id":     pending?.frameId ?? "",
        },
      });
    }

    // Cherche consensus puis personal
    let payload: Record<string, unknown> | null = null;
    let frameId: string | undefined;

    // Un device multi-écran (eink27bw + oled096) a une frame distincte par
    // écran (voir lib/queue.ts) — quand le firmware précise &screen=, on ne
    // cherche QUE cette clé-là, jamais les autres écrans du device.
    const lookupScreens = screen ? [screen] : (device.screens ?? []);
    const consensusFrame = await getFrameForDevice(deviceId, lookupScreens);
    if (consensusFrame?.payload) {
      payload = consensusFrame.payload;
      frameId = consensusFrame.frameId;
    } else {
      const personalRaw = await redis.get(personalKey(deviceId));
      if (personalRaw) {
        const pf = typeof personalRaw === "string" ? JSON.parse(personalRaw) : personalRaw;
        if (pf?.payload) {
          payload = pf.payload;
          frameId = pf.frameId;
        }
      }
    }

    if (!payload) {
      return NextResponse.json({ error: "no frame" }, { status: 404 });
    }

    // ── Détermine le screen cible ──────────────────────────────────────────
    // Priorité : paramètre &screen= > payload.screen > premier screen du device
    const targetScreen = screen
      ?? payload.screen
      ?? (device.screens?.[0] as string | undefined);

    if (!targetScreen) {
      return NextResponse.json({ error: "screen indéterminable" }, { status: 400 });
    }

    // ── eink29bwr : black + red ────────────────────────────────────────────
    if (targetScreen === "eink29bwr") {
      const { black, red } = payload as { black?: string; red?: string };
      if (!black || !red) {
        console.error(`[pull-frame] payload manquant black/red pour ${deviceId}`);
        return NextResponse.json({ error: "payload incomplet pour eink29bwr" }, { status: 404 });
      }

      if (fmt === "bin") {
        const blackBytes = Buffer.from(black, "base64");
        const redBytes   = Buffer.from(red,   "base64");
        const combined   = Buffer.concat([blackBytes, redBytes]); // 9472 bytes

        return new NextResponse(combined, {
          status: 200,
          headers: {
            "Content-Type":   "application/octet-stream",
            "Content-Length": String(combined.length),
          },
        });
      }
      return NextResponse.json({ frameId, ...payload });
    }

    // ── eink27bw : buffer unique ───────────────────────────────────────────
    if (targetScreen === "eink27bw") {
      const { buffer } = payload as { buffer?: string };
      if (!buffer) {
        console.error(`[pull-frame] payload manquant buffer pour ${deviceId} (eink27bw)`);
        return NextResponse.json({ error: "payload incomplet pour eink27bw" }, { status: 404 });
      }

      if (fmt === "bin") {
        const bytes = Buffer.from(buffer, "base64");

        return new NextResponse(bytes, {
          status: 200,
          headers: {
            "Content-Type":   "application/octet-stream",
            "Content-Length": String(bytes.length),
          },
        });
      }
      return NextResponse.json({ frameId, ...payload });
    }

    // ── oled096 : buffer unique ────────────────────────────────────────────
    if (targetScreen === "oled096") {
      const { buffer } = payload as { buffer?: string };
      if (!buffer) {
        console.error(`[pull-frame] payload manquant buffer pour ${deviceId} (oled096)`);
        return NextResponse.json({ error: "payload incomplet pour oled096" }, { status: 404 });
      }

      if (fmt === "bin") {
        const bytes = Buffer.from(buffer, "base64");

        return new NextResponse(bytes, {
          status: 200,
          headers: {
            "Content-Type":   "application/octet-stream",
            "Content-Length": String(bytes.length),
          },
        });
      }
      return NextResponse.json({ frameId, ...payload });
    }

    // ── tft18 : buffer RGB565 little-endian (128×160×2 = 40960 bytes) ───────
    if (targetScreen === "tft18") {
      const { buffer } = payload as { buffer?: string };
      if (!buffer) {
        console.error(`[pull-frame] payload manquant buffer pour ${deviceId} (tft18)`);
        return NextResponse.json({ error: "payload incomplet pour tft18" }, { status: 404 });
      }

      if (fmt === "bin") {
        const bytes = Buffer.from(buffer, "base64");

        return new NextResponse(new Uint8Array(bytes), {
          status: 200,
          headers: {
            "Content-Type":   "application/octet-stream",
            "Content-Length": String(bytes.length),
          },
        });
      }
      return NextResponse.json({ frameId, ...payload });
    }

    // ── Screen inconnu ─────────────────────────────────────────────────────
    console.error(`[pull-frame] screen inconnu: ${targetScreen} pour ${deviceId}`);
    return NextResponse.json({ error: `screen inconnu: ${targetScreen}` }, { status: 400 });

  } catch (err) {
    console.error("[pull-frame] error:", err);
    return NextResponse.json({ error: "Erreur interne" }, { status: 500 });
  }
}