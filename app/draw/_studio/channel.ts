"use client";
// app/draw/_studio/channel.ts — lien réseau de l'éditeur : cooldown (par appareil) et envoi.
//
//  • le cooldown vient d'abord du serveur (GET /api/draw-status), le stockage local ne sert que de
//    mémoire tampon : on n'envoie donc jamais un dessin voué au 429 (qui comptait comme abus) ;
//  • toute réponse est traduite en `StudioSendResult` : l'interface ne voit que des états métier ;
//  • aucune erreur ne provoque de navigation : le dessin reste à l'écran.

import { useCallback, useEffect, useRef, useState } from "react";
import { SCREEN_IDS, ScreenId } from "@/lib/screenProfiles";
import { clearCooldown, loadCooldownUntil, saveCooldownUntil } from "./storage";
import type { StudioSendInput, StudioSendResult } from "./types";

const DRAW_WINDOW_SEC = 900;
const SEND_TIMEOUT_MS = 45_000;

async function fetchDrawStatus(deviceId: string): Promise<number | null> {
  try {
    const r = await fetch(`/api/draw-status?deviceId=${encodeURIComponent(deviceId)}`, { cache: "no-store" });
    if (!r.ok) return null;
    const d = await r.json();
    return typeof d.nextDrawIn === "number" ? d.nextDrawIn : null;
  } catch { return null; }
}

export function useDrawChannel(deviceId: string, screenId: ScreenId) {
  const [until, setUntil] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const untilRef = useRef(0);
  useEffect(() => { untilRef.current = until; }, [until]);

  const start = useCallback((seconds: number) => {
    const u = Date.now() + Math.max(0, seconds) * 1000;
    setUntil(u);
    setNow(Date.now());
    saveCooldownUntil(deviceId, u);
  }, [deviceId]);

  // Mémoire locale d'abord (affichage immédiat), puis vérité serveur
  useEffect(() => {
    const local = loadCooldownUntil(deviceId, SCREEN_IDS);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- lecture du stockage local au montage (client uniquement)
    if (local) { setUntil(local); setNow(Date.now()); }
    let cancelled = false;
    fetchDrawStatus(deviceId).then(n => {
      if (cancelled || n === null) return;
      if (n > 0) start(n);
      else { setUntil(0); clearCooldown(deviceId); }
    });
    return () => { cancelled = true; };
  }, [deviceId, start]);

  useEffect(() => {
    if (!until) return;
    const id = window.setInterval(() => {
      const n = Date.now();
      setNow(n);
      if (n >= untilRef.current) { setUntil(0); clearCooldown(deviceId); }
    }, 1000);
    return () => window.clearInterval(id);
  }, [until, deviceId]);

  const remaining = until ? Math.max(0, Math.ceil((until - now) / 1000)) : 0;

  const send = useCallback(async (input: StudioSendInput): Promise<StudioSendResult> => {
    // Garde-fou : on ne poste jamais pendant un cooldown connu (évite un 429 = strike)
    const status = await fetchDrawStatus(deviceId);
    if (status !== null && status > 0) { start(status); return { status: "cooldown", nextDrawIn: status }; }
    if (status === null && untilRef.current > Date.now()) return { status: "cooldown", nextDrawIn: Math.ceil((untilRef.current - Date.now()) / 1000) };

    const p = input.payload;
    const base = {
      screen: screenId, deviceId, workTitle: input.workTitle, drawArtistName: input.drawArtistName,
      actions: input.actions, replayEvents: input.replayEvents, drawScore: input.drawScore,
    };
    const body = "black" in p ? { ...base, black: p.black, red: p.red } : { ...base, buffer: p.buffer };

    const ctl = new AbortController();
    const timer = window.setTimeout(() => ctl.abort(), SEND_TIMEOUT_MS);
    try {
      const res = await fetch("/api/draw", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: ctl.signal,
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 429) {
        const secs = typeof data.nextDrawIn === "number" ? data.nextDrawIn : DRAW_WINDOW_SEC;
        start(secs);
        return { status: "cooldown", nextDrawIn: secs };
      }
      if (res.status === 503 && data.queueFull) {
        return { status: "queue_full", message: `La file d'attente est pleine (${data.queueLen ?? "?"} dessins). Réessaie dans quelques minutes : ton dessin est conservé.` };
      }
      if (!res.ok && data.validation === "rejected") {
        return { status: "rejected", message: data.message || data.reason || "Dessin refusé par le contrôle de cohérence." };
      }
      if (res.status === 401 || res.status === 403) {
        return { status: "error", message: "Cet appareil n'est pas relié à ta session (ou l'accès est refusé). Reconnecte-toi depuis ton profil : ton dessin est conservé." };
      }
      if (!res.ok) return { status: "error", message: data.message || data.error || `Erreur serveur (${res.status})` };
      const secs = typeof data.nextDrawIn === "number" ? data.nextDrawIn : DRAW_WINDOW_SEC;
      start(secs);
      return {
        status: "ok", nextDrawIn: secs, validation: data.validation, queuePosition: data.queuePosition,
        poolSize: data.poolSize, warning: data.warning ?? null, message: data.message,
      };
    } catch (e) {
      const aborted = e instanceof DOMException && e.name === "AbortError";
      return { status: "error", message: aborted ? "Le serveur met trop de temps à répondre. Vérifie ta connexion et réessaie." : "Pas de connexion au serveur. Vérifie ton réseau et réessaie." };
    } finally { window.clearTimeout(timer); }
  }, [deviceId, screenId, start]);

  return { remaining, start, send };
}
