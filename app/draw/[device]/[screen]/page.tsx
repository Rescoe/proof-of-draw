"use client";
// app/draw/[device]/[screen]/page.tsx
// Page de dessin d'un écran : charge les infos de l'appareil, relie l'éditeur (Pod Studio)
// au réseau (cooldown + envoi) et ne redirige JAMAIS sur erreur — un dessin en cours
// ne doit pas disparaître parce qu'une requête a échoué.
//
// L'éditeur lui-même vit dans app/draw/_studio (moteur pur dans lib/drawEngine).

import { useCallback, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { SCREEN_PROFILES, ScreenId, isValidScreenId } from "@/lib/screenProfiles";
import type { OwnedDevice } from "@/lib/deviceStore";
import { useDrawChannel } from "../../_studio/channel";
import { wakeNetwork } from "@/lib/wakeNetwork";
import type { DrawStudioProps } from "../../_studio/DrawStudio";

function Splash({ text }: { text: string }) {
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 100, background: "#0a0a10", color: "#a9aac2", display: "grid", placeItems: "center", fontFamily: "'DM Sans', system-ui, sans-serif", fontSize: 15 }}>
      {text}
    </div>
  );
}

const DrawStudio = dynamic<DrawStudioProps>(() => import("../../_studio/DrawStudio"), {
  ssr: false,
  loading: () => <Splash text="Préparation de l'atelier…" />,
});

type Info =
  | { state: "loading" }
  | { state: "owned"; label: string }
  | { state: "guest"; label: string }
  | { state: "unknown" }
  | { state: "error" };

export default function DrawCanvasPage() {
  const params = useParams();
  const router = useRouter();
  const rawDevice = params.device, rawScreen = params.screen;
  const deviceId = String(Array.isArray(rawDevice) ? rawDevice[0] : rawDevice ?? "").trim();
  const screenParam = String(Array.isArray(rawScreen) ? rawScreen[0] : rawScreen ?? "");

  if (!isValidScreenId(screenParam)) {
    return (
      <div style={{ maxWidth: 480, margin: "80px auto", padding: 24, textAlign: "center" }}>
        <h1 style={{ fontSize: 22 }}>Écran inconnu</h1>
        <p style={{ color: "var(--text2)" }}>« {screenParam || "?"} » n&apos;est pas un type d&apos;écran pris en charge.</p>
        <Link href="/profile" style={{ color: "var(--accent)", fontWeight: 600 }}>← Retour à mon profil</Link>
      </div>
    );
  }
  return <DrawPageInner deviceId={deviceId} screenId={screenParam} onExit={() => router.push("/profile")} />;
}

function DrawPageInner({ deviceId, screenId, onExit }: { deviceId: string; screenId: ScreenId; onExit: () => void }) {
  const profile = SCREEN_PROFILES[screenId];
  const channel = useDrawChannel(deviceId, screenId);
  const [info, setInfo] = useState<Info>({ state: "loading" });
  const [prefill, setPrefill] = useState<string | undefined>(undefined);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => { wakeNetwork(); }, []);   // « j'ouvre l'atelier » : les écrans au repos passent de 15 à 5 min de pull (au plus 1 appel / 10 min / onglet)

  // Chargement de l'appareil : tentatives multiples, jamais de redirection
  useEffect(() => {
    let cancelled = false;
    async function load(n: number) {
      try {
        const res = await fetch("/api/devices?mine=1", { cache: "no-store" });
        const data = await res.json();
        if (cancelled) return;
        const d = (data.devices ?? []).find((x: OwnedDevice) => String(x.deviceId).trim() === deviceId);
        if (d && d.screens?.includes(screenId)) {
          setInfo({ state: "owned", label: d.artistName ? `Mon ESP « ${d.artistName} »` : `Mon ESP ${d.deviceId}` });
          return;
        }
        const pubRes = await fetch("/api/public-screens", { cache: "no-store" });
        const pubData = await pubRes.json();
        if (cancelled) return;
        const pub = (pubData.devices ?? []).find((p: { deviceId: string; screens: string[] }) => String(p.deviceId).trim() === deviceId && p.screens?.includes(screenId));
        if (pub) { setInfo({ state: "guest", label: `ESP de ${pub.artistName || deviceId}` }); return; }
        if (n < 2) { window.setTimeout(() => { if (!cancelled) void load(n + 1); }, 1200); return; }
        setInfo({ state: "unknown" });
      } catch {
        if (!cancelled) setInfo({ state: "error" });
      }
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- (re)démarrage du chargement quand l'appareil ou l'écran change
    setInfo({ state: "loading" });
    void load(0);
    return () => { cancelled = true; };
  }, [deviceId, screenId, attempt]);

  // Mode invité : nom d'artiste prérempli avec celui du profil (toujours modifiable)
  useEffect(() => {
    if (info.state !== "guest") return;
    let cancelled = false;
    fetch("/api/artist", { cache: "no-store" })
      .then(r => r.json())
      .then(d => { if (!cancelled && d?.profile?.displayName) setPrefill(String(d.profile.displayName)); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [info.state]);

  const retry = useCallback(() => setAttempt(a => a + 1), []);

  const label = info.state === "owned" || info.state === "guest" ? info.label : "cet appareil";
  const notice =
    info.state === "unknown"
      ? { kind: "warn" as const, text: "Cet appareil n'est pas relié à ta session : tu peux dessiner, l'envoi sera refusé tant que tu n'es pas reconnecté.", action: { label: "Réessayer", run: retry } }
      : info.state === "error"
        ? { kind: "warn" as const, text: "Connexion instable : impossible de vérifier l'appareil. Tu peux dessiner, l'envoi réessaiera.", action: { label: "Réessayer", run: retry } }
        : null;

  if (!profile) return <Splash text="Écran inconnu" />;
  return (
    <DrawStudio
      screenId={screenId}
      deviceId={deviceId}
      deviceLabel={label}
      isGuest={info.state === "guest"}
      artistPrefill={prefill}
      cooldownRemaining={channel.remaining}
      onSend={channel.send}
      onCooldownStart={channel.start}
      onExit={onExit}
      notice={notice}
    />
  );
}
