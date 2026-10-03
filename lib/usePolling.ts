"use client";
// lib/usePolling.ts — polling ÉCONOME en commandes Redis (règle primordiale : voir CLAUDE.md et docs/NOTE_BENCH_ET_QUOTAS_2026_10_03.md).
// Un `setInterval` nu tournait 24 h/24 même onglet caché ; ici :
//   • aucune requête quand l'onglet est caché ;
//   • arrêt après `idleStopMs` sans interaction (souris, clavier, toucher, défilement) — reprise immédiate à l'interaction suivante ;
//   • une requête immédiate au retour sur l'onglet / à la reprise.
// Les minuteries continuent de tourner (coût nul) ; seules les REQUÊTES sont suspendues.

import { useEffect, useRef } from "react";

export function usePolling(fn: () => void | Promise<void>, intervalMs: number, idleStopMs = 10 * 60_000): void {
  const fnRef = useRef(fn);
  useEffect(() => { fnRef.current = fn; });

  useEffect(() => {
    let lastActivity = Date.now();
    let sleeping = false;
    let stopped = false;
    const asleep = () => document.hidden || Date.now() - lastActivity > idleStopMs;
    const run = () => { void Promise.resolve(fnRef.current()).catch(() => { /* réessai au prochain tour */ }); };

    const wake = () => {
      lastActivity = Date.now();
      if (sleeping && !document.hidden) { sleeping = false; run(); }
    };
    const onVisibility = () => {
      if (document.hidden) { sleeping = true; return; }
      lastActivity = Date.now();
      sleeping = false;
      run();
    };

    const first = setTimeout(() => { if (!stopped && !asleep()) run(); }, 0);
    const timer = setInterval(() => {
      if (stopped) return;
      if (asleep()) { sleeping = true; return; }
      run();
    }, intervalMs);

    const events = ["pointerdown", "keydown", "scroll", "touchstart"] as const;
    for (const e of events) window.addEventListener(e, wake, { passive: true });
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stopped = true;
      clearTimeout(first);
      clearInterval(timer);
      for (const e of events) window.removeEventListener(e, wake);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [intervalMs, idleStopMs]);
}
