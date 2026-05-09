"use client";

import { useRef, useEffect, useCallback, useState } from "react";

export type Tool = "brush" | "eraser" | "fill";

export interface UseCanvasDrawingProps {
  width: number;
  height: number;
  colors: string[];
  pixelRatio?: number;
}

export interface UseCanvasDrawingReturn {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  tool: Tool;
  setTool: (t: Tool) => void;
  brushSize: number;
  setBrushSize: (s: number) => void;
  activeColor: string;
  setActiveColor: (c: string) => void;
  clearCanvas: () => void;
  getBase64: () => string;
  undo: () => void;
  canUndo: boolean;
}

export function useCanvasDrawing({
  width,
  height,
  colors,
  pixelRatio = 2,
}: UseCanvasDrawingProps): UseCanvasDrawingReturn {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [tool, setTool] = useState<Tool>("brush");
  const [brushSize, setBrushSize] = useState(2);
  const [activeColor, setActiveColor] = useState(colors[0]);
  const [canUndo, setCanUndo] = useState(false);

  const drawing = useRef(false);
  const lastPos = useRef<{ x: number; y: number } | null>(null);
  const history = useRef<ImageData[]>([]);

  // Init canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = colors[1] ?? "#FFFFFF"; // background = second color (white)
    ctx.fillRect(0, 0, width, height);
    saveHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [width, height]);

  const saveHistory = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const snap = ctx.getImageData(0, 0, width, height);
    history.current.push(snap);
    if (history.current.length > 40) history.current.shift();
    setCanUndo(history.current.length > 1);
  }, [width, height]);

  const undo = useCallback(() => {
    if (history.current.length <= 1) return;
    history.current.pop();
    const snap = history.current[history.current.length - 1];
    const canvas = canvasRef.current;
    if (!canvas || !snap) return;
    const ctx = canvas.getContext("2d");
    ctx?.putImageData(snap, 0, 0);
    setCanUndo(history.current.length > 1);
  }, []);

  const getPos = useCallback(
    (e: MouseEvent | TouchEvent): { x: number; y: number } => {
      const canvas = canvasRef.current!;
      const rect = canvas.getBoundingClientRect();
      const scaleX = width / rect.width;
      const scaleY = height / rect.height;
      if (e instanceof MouseEvent) {
        return {
          x: Math.floor((e.clientX - rect.left) * scaleX),
          y: Math.floor((e.clientY - rect.top) * scaleY),
        };
      }
      const touch = e.touches[0];
      return {
        x: Math.floor((touch.clientX - rect.left) * scaleX),
        y: Math.floor((touch.clientY - rect.top) * scaleY),
      };
    },
    [width, height]
  );

  const floodFill = useCallback(
    (ctx: CanvasRenderingContext2D, x: number, y: number, fillColor: string) => {
      const imageData = ctx.getImageData(0, 0, width, height);
      const data = imageData.data;
      const idx = (y * width + x) * 4;
      const targetR = data[idx],
        targetG = data[idx + 1],
        targetB = data[idx + 2];

      const r = parseInt(fillColor.slice(1, 3), 16);
      const g = parseInt(fillColor.slice(3, 5), 16);
      const b = parseInt(fillColor.slice(5, 7), 16);
      if (targetR === r && targetG === g && targetB === b) return;

      const match = (i: number) =>
        data[i] === targetR && data[i + 1] === targetG && data[i + 2] === targetB;

      const stack = [{ x, y }];
      while (stack.length) {
        const p = stack.pop()!;
        if (p.x < 0 || p.x >= width || p.y < 0 || p.y >= height) continue;
        const i = (p.y * width + p.x) * 4;
        if (!match(i)) continue;
        data[i] = r;
        data[i + 1] = g;
        data[i + 2] = b;
        data[i + 3] = 255;
        stack.push({ x: p.x + 1, y: p.y });
        stack.push({ x: p.x - 1, y: p.y });
        stack.push({ x: p.x, y: p.y + 1 });
        stack.push({ x: p.x, y: p.y - 1 });
      }
      ctx.putImageData(imageData, 0, 0);
    },
    [width, height]
  );

  const draw = useCallback(
    (ctx: CanvasRenderingContext2D, from: { x: number; y: number }, to: { x: number; y: number }) => {
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(to.x, to.y);
      ctx.strokeStyle = tool === "eraser" ? (colors[1] ?? "#FFFFFF") : activeColor;
      ctx.lineWidth = brushSize;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.stroke();
    },
    [tool, activeColor, brushSize, colors]
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const onDown = (e: MouseEvent | TouchEvent) => {
      e.preventDefault();
      drawing.current = true;
      const pos = getPos(e);
      const ctx = canvas.getContext("2d")!;

      if (tool === "fill") {
        floodFill(ctx, pos.x, pos.y, activeColor);
        saveHistory();
        return;
      }
      lastPos.current = pos;
      // Draw dot
      draw(ctx, pos, pos);
    };

    const onMove = (e: MouseEvent | TouchEvent) => {
      e.preventDefault();
      if (!drawing.current || !lastPos.current) return;
      const pos = getPos(e);
      const ctx = canvas.getContext("2d")!;
      draw(ctx, lastPos.current, pos);
      lastPos.current = pos;
    };

    const onUp = () => {
      if (drawing.current) saveHistory();
      drawing.current = false;
      lastPos.current = null;
    };

    canvas.addEventListener("mousedown", onDown);
    canvas.addEventListener("mousemove", onMove);
    canvas.addEventListener("mouseup", onUp);
    canvas.addEventListener("mouseleave", onUp);
    canvas.addEventListener("touchstart", onDown, { passive: false });
    canvas.addEventListener("touchmove", onMove, { passive: false });
    canvas.addEventListener("touchend", onUp);

    return () => {
      canvas.removeEventListener("mousedown", onDown);
      canvas.removeEventListener("mousemove", onMove);
      canvas.removeEventListener("mouseup", onUp);
      canvas.removeEventListener("mouseleave", onUp);
      canvas.removeEventListener("touchstart", onDown);
      canvas.removeEventListener("touchmove", onMove);
      canvas.removeEventListener("touchend", onUp);
    };
  }, [draw, floodFill, getPos, saveHistory, tool, activeColor]);

  const clearCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = colors[1] ?? "#FFFFFF";
    ctx.fillRect(0, 0, width, height);
    saveHistory();
  }, [colors, width, height, saveHistory]);

  const getBase64 = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return "";
    const data = canvas.toDataURL("image/png");
    return data.split(",")[1];
  }, []);

  return {
    canvasRef,
    tool,
    setTool,
    brushSize,
    setBrushSize,
    activeColor,
    setActiveColor,
    clearCanvas,
    getBase64,
    undo,
    canUndo,
  };
}
