"use client";

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

export type WorldBounds = { x: number; y: number; width: number; height: number };
export type ViewportTransform = { x: number; y: number; scale: number; width: number; height: number; fitScale: number };

const MIN_SCALE = 0.08;
const MAX_SCALE = 5;

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export function useViewport(world: WorldBounds, locked: boolean) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<SVGGElement>(null);
  const transformRef = useRef<ViewportTransform>({ x: 0, y: 0, scale: 1, width: 1, height: 1, fitScale: 1 });
  const [view, setView] = useState(transformRef.current);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const previousPinch = useRef<{ x: number; y: number; distance: number } | null>(null);
  const publishTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const publish = useCallback(() => {
    if (publishTimer.current) return;
    publishTimer.current = setTimeout(() => {
      publishTimer.current = null;
      setView({ ...transformRef.current });
    }, 100);
  }, []);

  const apply = useCallback((next: ViewportTransform, immediate = false) => {
    const value = { ...next, scale: clamp(next.scale, MIN_SCALE, MAX_SCALE) };
    transformRef.current = value;
    contentRef.current?.setAttribute("transform", `translate(${value.x} ${value.y}) scale(${value.scale})`);
    const root = viewportRef.current;
    if (root) root.style.setProperty("--graph-scale", String(value.scale));
    if (immediate) setView({ ...value });
    else publish();
  }, [publish]);

  const fit = useCallback((immediate = true) => {
    const root = viewportRef.current;
    if (!root) return;
    const { width, height } = root.getBoundingClientRect();
    if (!width || !height) return;
    const padding = Math.min(72, Math.max(24, width * 0.07));
    const fitScale = clamp(Math.min(
      (width - padding * 2) / Math.max(1, world.width),
      (height - padding * 2) / Math.max(1, world.height),
    ), MIN_SCALE, 1.15);
    apply({
      x: width / 2 - (world.x + world.width / 2) * fitScale,
      y: height / 2 - (world.y + world.height / 2) * fitScale,
      scale: fitScale,
      width,
      height,
      fitScale,
    }, immediate);
  }, [apply, world.height, world.width, world.x, world.y]);

  useEffect(() => {
    const root = viewportRef.current;
    if (!root) return;
    // Le premier rendu est cadré automatiquement. Ensuite, une petite variation
    // de largeur (apparition de la scrollbar quand un panneau s'ouvre, par
    // exemple) conserve le point exploré au lieu de renvoyer l'utilisateur à
    // la vue globale.
    fit(true);
    const observer = new ResizeObserver(() => {
      const { width, height } = root.getBoundingClientRect();
      const current = transformRef.current;
      if (!width || !height || (Math.abs(width - current.width) < 1 && Math.abs(height - current.height) < 1)) return;
      apply({
        ...current,
        x: current.x + (width - current.width) / 2,
        y: current.y + (height - current.height) / 2,
        width,
        height,
      }, true);
    });
    observer.observe(root);
    return () => observer.disconnect();
  }, [apply, fit]);

  useEffect(() => () => {
    if (publishTimer.current) clearTimeout(publishTimer.current);
  }, []);

  const zoomAt = useCallback((screenX: number, screenY: number, factor: number) => {
    const current = transformRef.current;
    const nextScale = clamp(current.scale * factor, MIN_SCALE, MAX_SCALE);
    const worldX = (screenX - current.x) / current.scale;
    const worldY = (screenY - current.y) / current.scale;
    apply({
      ...current,
      x: screenX - worldX * nextScale,
      y: screenY - worldY * nextScale,
      scale: nextScale,
    });
  }, [apply]);

  const zoomBy = useCallback((factor: number) => {
    const current = transformRef.current;
    zoomAt(current.width / 2, current.height / 2, factor);
  }, [zoomAt]);

  const focusPoint = useCallback((x: number, y: number, requestedScale?: number) => {
    const current = transformRef.current;
    const scale = clamp(requestedScale ?? Math.max(current.fitScale * 2.2, 0.9), MIN_SCALE, MAX_SCALE);
    apply({ ...current, x: current.width / 2 - x * scale, y: current.height / 2 - y * scale, scale }, true);
  }, [apply]);

  useEffect(() => {
    const root = viewportRef.current;
    if (!root) return;
    const wheel = (event: WheelEvent) => {
      if (locked) return;
      event.preventDefault();
      const rect = root.getBoundingClientRect();
      zoomAt(event.clientX - rect.left, event.clientY - rect.top, Math.exp(-event.deltaY * 0.0014));
    };
    root.addEventListener("wheel", wheel, { passive: false });
    return () => root.removeEventListener("wheel", wheel);
  }, [locked, zoomAt]);

  const point = useCallback((event: ReactPointerEvent) => {
    const rect = viewportRef.current?.getBoundingClientRect();
    return { x: event.clientX - (rect?.left ?? 0), y: event.clientY - (rect?.top ?? 0) };
  }, []);

  const onPointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (locked) return;
    // Ne jamais capturer le pointeur d'un nœud : la capture par le viewport
    // redirigerait le `pointerup` et empêcherait le clic/sélection du SVG.
    if ((event.target as Element).closest(".ng-node")) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    pointers.current.set(event.pointerId, point(event));
  }, [locked, point]);

  const onPointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (locked || !pointers.current.has(event.pointerId)) return;
    const next = point(event);
    const previous = pointers.current.get(event.pointerId)!;
    pointers.current.set(event.pointerId, next);
    const active = [...pointers.current.values()];
    if (active.length === 1) {
      const current = transformRef.current;
      apply({ ...current, x: current.x + next.x - previous.x, y: current.y + next.y - previous.y });
      return;
    }
    const [a, b] = active;
    const pinch = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, distance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)) };
    if (previousPinch.current) {
      const current = transformRef.current;
      apply({ ...current, x: current.x + pinch.x - previousPinch.current.x, y: current.y + pinch.y - previousPinch.current.y });
      zoomAt(pinch.x, pinch.y, pinch.distance / previousPinch.current.distance);
    }
    previousPinch.current = pinch;
  }, [apply, locked, point, zoomAt]);

  const releasePointer = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    pointers.current.delete(event.pointerId);
    previousPinch.current = null;
    try { event.currentTarget.releasePointerCapture(event.pointerId); } catch { /* déjà libéré */ }
    setView({ ...transformRef.current });
  }, []);

  const onKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    const current = transformRef.current;
    const step = event.shiftKey ? 90 : 36;
    if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "+", "=", "-", "0"].includes(event.key)) event.preventDefault();
    if (event.key === "ArrowLeft") apply({ ...current, x: current.x + step });
    if (event.key === "ArrowRight") apply({ ...current, x: current.x - step });
    if (event.key === "ArrowUp") apply({ ...current, y: current.y + step });
    if (event.key === "ArrowDown") apply({ ...current, y: current.y - step });
    if (event.key === "+" || event.key === "=") zoomBy(1.25);
    if (event.key === "-") zoomBy(0.8);
    if (event.key === "0") fit(true);
  }, [apply, fit, zoomBy]);

  return {
    viewportRef,
    contentRef,
    view,
    fit,
    zoomBy,
    focusPoint,
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp: releasePointer,
      onPointerCancel: releasePointer,
      onKeyDown,
    },
  };
}
