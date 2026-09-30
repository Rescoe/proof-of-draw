"use client";
// Client du bac à sable (voir page.tsx) : envoi simulé, cooldown local.

import { useCallback, useState } from "react";
import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import { ScreenId, isValidScreenId } from "@/lib/screenProfiles";
import type { StudioSendInput, StudioSendResult } from "../draw/_studio/types";
import type { DrawStudioProps } from "../draw/_studio/DrawStudio";

const DrawStudio = dynamic<DrawStudioProps>(() => import("../draw/_studio/DrawStudio"), { ssr: false });

export default function LabClient() {
  const sp = useSearchParams();
  const raw = sp.get("screen") ?? "oled096";
  const screenId: ScreenId = isValidScreenId(raw) ? raw : "oled096";
  const guest = sp.get("guest") === "1";
  const [until, setUntil] = useState(0);
  const [now, tick] = useState(0);
  const remaining = until ? Math.max(0, Math.ceil((until - now) / 1000)) : 0;

  const onSend = useCallback(async (input: StudioSendInput): Promise<StudioSendResult> => {
    await new Promise(r => setTimeout(r, 700));
    const mode = sp.get("send");
    // eslint-disable-next-line no-console
    console.log("[draw-lab] envoi simulé", { title: input.workTitle, score: input.drawScore, actions: input.actions.length, replay: input.replayEvents.length, screen: input.payload.screen });
    if (mode === "error") return { status: "error", message: "Pas de connexion au serveur (simulation)." };
    if (mode === "reject") return { status: "rejected", message: "Séquence d'actions suspecte (simulation)." };
    if (mode === "full") return { status: "queue_full", message: "File d'attente pleine (simulation)." };
    return { status: "ok", nextDrawIn: Number(sp.get("cd") ?? 900), validation: "pending", poolSize: 3 };
  }, [sp]);

  return (
    <DrawStudio
      screenId={screenId}
      deviceId="dev_LAB00001"
      deviceLabel="ESP de démonstration"
      isGuest={guest}
      artistPrefill={guest ? "Camille" : undefined}
      cooldownRemaining={remaining}
      onSend={onSend}
      onCooldownStart={s => { setUntil(Date.now() + s * 1000); tick(Date.now()); const id = setInterval(() => tick(Date.now()), 1000); setTimeout(() => clearInterval(id), s * 1000 + 1500); }}
      onExit={() => { window.history.back(); }}
      notice={sp.get("notice") ? { kind: "warn", text: "Bandeau d'information de démonstration", action: { label: "OK", run: () => {} } } : null}
    />
  );
}
