"use client";

// app/BlockFrameCanvas.tsx
// Rendu client d'une image de bloc miné (base64 → canvas).
// Utilise screenToCanvas.ts qui gère les 3 types d'écrans.
// Axe 1 : la rotation était corrigée dans screenToCanvas.ts → on supprime le rotate 180° ici.
// SVG export : bouton de téléchargement pixel-art.

import { useEffect, useRef, useCallback } from "react";
import type { BlockImagePayload } from "@/lib/chain";
import { eink29bwrToCanvas, eink27bwToCanvas, oled096ToCanvas, tft18ToCanvas } from "@/lib/screenToCanvas";

// Dimensions CSS d'affichage par type d'écran
const DISPLAY_SIZES: Record<string, { w: number; h: number }> = {
  eink29bwr: { w: 222, h: 96  },  // 296×128 × 0.75
  eink27bw:  { w: 132, h: 88  },  // 264×176 × 0.5
  oled096:   { w: 128, h: 64  },  // 128×64  × 1
  tft18:     { w: 128, h: 160 },  // 128×160 × 1
};

export function BlockFrameCanvas({
  payload,
  blockHash,
  blockIndex,
  showDownload = false,
}: {
  payload: BlockImagePayload;
  blockHash?: string;
  blockIndex?: number;
  showDownload?: boolean;
}) {
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
      } else if (payload.screen === "tft18" && payload.buffer) {
        imageData = tft18ToCanvas(payload.buffer);
      }
      if (!imageData) return;

      canvas.width  = imageData.width;
      canvas.height = imageData.height;

      // Axe 1 : rotation supprimée — screenToCanvas.ts est maintenant correct
      ctx.putImageData(imageData, 0, 0);
    } catch {}
  }, [payload]);

  const handleDownloadSVG = useCallback(() => {
    if (!blockHash) return;
    const url = `/api/block-svg?hash=${blockHash}&scale=2`;
    const a = document.createElement("a");
    a.href = url;
    a.download = `pod-bloc-${blockIndex ?? "?"}-${blockHash.slice(0, 8)}.svg`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }, [blockHash, blockIndex]);

  const size = DISPLAY_SIZES[payload.screen] ?? { w: 148, h: 64 };

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
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
      {showDownload && blockHash && (
        <button
          onClick={handleDownloadSVG}
          title="Télécharger en SVG pixel-art"
          style={{
            fontSize: 10,
            padding: "3px 10px",
            borderRadius: 6,
            border: "1px solid rgba(124,107,255,0.3)",
            background: "rgba(124,107,255,0.08)",
            color: "var(--accent, #7c6bff)",
            cursor: "pointer",
            fontFamily: "monospace",
            letterSpacing: "0.05em",
          }}
        >
          ↓ SVG
        </button>
      )}
    </div>
  );
}
