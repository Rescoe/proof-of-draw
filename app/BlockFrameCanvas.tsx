"use client";

// app/BlockFrameCanvas.tsx
// Rendu client d'une image de bloc miné (base64 → canvas).
// Utilise screenToCanvas.ts qui gère les 3 types d'écrans.

import { useEffect, useRef } from "react";
import type { BlockImagePayload } from "@/lib/chain";
import { eink29bwrToCanvas, eink27bwToCanvas, oled096ToCanvas } from "@/lib/screenToCanvas";

// Dimensions CSS d'affichage par type d'écran
const DISPLAY_SIZES: Record<string, { w: number; h: number }> = {
  eink29bwr: { w: 222, h: 96  },  // 296×128 × 0.75
  eink27bw:  { w: 132, h: 88  },  // 264×176 × 0.5
  oled096:   { w: 128, h: 64  },  // 128×64  × 1
};

export function BlockFrameCanvas({ payload }: { payload: BlockImagePayload }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

useEffect(() => {
  const canvas = canvasRef.current;
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  try {
    let imageData: ImageData | null = null;
    if (payload.screen === "eink29bwr" && payload.black && payload.red) {
      imageData = eink29bwrToCanvas(payload.black, payload.red);
    } else if (payload.screen === "eink27bw" && payload.buffer) {
      imageData = eink27bwToCanvas(payload.buffer);
    } else if (payload.screen === "oled096" && payload.buffer) {
      imageData = oled096ToCanvas(payload.buffer);
    }
    if (!imageData) return;

    canvas.width  = imageData.width;
    canvas.height = imageData.height;

    // Les écrans e-ink sont montés à 180° dans le boîtier
    if (payload.screen === "eink29bwr" || payload.screen === "eink27bw") {
      ctx.translate(imageData.width, imageData.height);
      ctx.rotate(Math.PI);
    }

    ctx.putImageData(imageData, 0, 0);
  } catch {}
}, [payload]);

  const size = DISPLAY_SIZES[payload.screen] ?? { w: 148, h: 64 };

  return (
    <canvas
      ref={canvasRef}
      style={{
        width: size.w,
        height: size.h,
        imageRendering: "pixelated",
        display: "block",
        maxWidth: "100%",
      }}
    />
  );
}
