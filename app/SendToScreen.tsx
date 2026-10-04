"use client";

// app/SendToScreen.tsx
// Bouton "Afficher sur mon écran" pour les galeries (humaine + agent IA) :
// l'utilisateur choisit UN de SES écrans (jamais celui d'un autre) et le dessin
// y est envoyé, converti au format de l'écran si nécessaire — POST /api/send-to-screen.

import { useEffect, useState } from "react";
import { SCREEN_PROFILES } from "@/lib/screenProfiles";
import type { OwnedDevice } from "@/lib/deviceStore";
import { animCapable } from "@/lib/anim/pointer";

const screenName = (id: string) =>
  (SCREEN_PROFILES as Record<string, { name: string }>)[id]?.name ?? id;

/** `animScreen` : le bloc est une ANIMATION faite pour cet écran → seuls les écrans de ce type dont le firmware la joue sont proposés. */
export function SendToScreen({ source, blockHash, animScreen }: { source: "human" | "ana"; blockHash: string; animScreen?: string }) {
  const [devices, setDevices] = useState<OwnedDevice[] | null>(null);
  const [choice, setChoice]   = useState("");   // "deviceId|screen"
  const [busy, setBusy]       = useState(false);
  const [msg, setMsg]         = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/devices?mine=1", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { devices: [] }))
      .then((d) => { if (!cancelled) setDevices(d.devices ?? []); })
      .catch(() => { if (!cancelled) setDevices([]); });
    return () => { cancelled = true; };
  }, []);

  const options = (devices ?? []).flatMap((d) =>
    d.screens.filter((sc) => !animScreen || (sc === animScreen && animCapable(d, sc))).map((sc) => ({
      value: `${d.deviceId}|${sc}`,
      label: `${d.deviceName || d.artistName || d.deviceId} — ${screenName(sc)}`,
    })));

  useEffect(() => {
    if (!choice && options.length > 0) setChoice(options[0].value);
  }, [options.length]); // eslint-disable-line react-hooks/exhaustive-deps

  async function send() {
    const [deviceId, screen] = choice.split("|");
    if (!deviceId || !screen) return;
    setBusy(true); setMsg(null);
    try {
      const res  = await fetch("/api/send-to-screen", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source, blockHash, deviceId, screen }),
      });
      const data = await res.json().catch(() => ({}));
      setMsg(res.ok
        ? { ok: true,  text: "Envoyé — l'écran l'affichera à son prochain rafraîchissement." }
        : { ok: false, text: data.error ?? "Envoi impossible" });
    } catch {
      setMsg({ ok: false, text: "Erreur réseau" });
    } finally { setBusy(false); }
  }

  if (devices === null) return null;
  if (options.length === 0 && animScreen) {
    return <div className="sts sts--muted">Cette animation se joue sur un écran {screenName(animScreen)} dont le firmware lit les animations : aucun de vos écrans ne convient pour l’instant (voir Mon profil).</div>;
  }
  if (options.length === 0) {
    return <div className="sts sts--muted">Aucun écran associé à cette session — connectez un ESP pour pouvoir y réafficher ce dessin.</div>;
  }

  return (
    <div className="sts">
      <div className="sts__title">Afficher sur mon écran</div>
      <div className="sts__row">
        <select className="sts__select" value={choice} onChange={(e) => setChoice(e.target.value)} disabled={busy}>
          {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <button className="sts__btn" onClick={send} disabled={busy || !choice}>{busy ? "Envoi…" : "Envoyer"}</button>
      </div>
      {msg && <div className={`sts__msg ${msg.ok ? "sts__msg--ok" : "sts__msg--err"}`}>{msg.text}</div>}
      <style>{`
        .sts { margin-top: 14px; padding: 10px 12px; border: 1px solid rgba(255,255,255,0.08); border-radius: 10px; background: var(--bg3, #151c2c); }
        .sts--muted { font-size: 12px; color: var(--text3, #64748b); }
        .sts__title { font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text3, #64748b); margin-bottom: 8px; }
        .sts__row { display: flex; gap: 8px; flex-wrap: wrap; }
        .sts__select { flex: 1; min-width: 180px; background: var(--bg2, #1e2533); color: var(--text1, #f1f5f9); border: 1px solid rgba(255,255,255,0.1); border-radius: 8px; padding: 7px 10px; font-size: 13px; }
        .sts__btn { background: var(--accent, #7c6bff); color: #fff; border: none; border-radius: 8px; padding: 7px 16px; font-size: 13px; font-weight: 600; cursor: pointer; }
        .sts__btn:disabled { opacity: 0.5; cursor: default; }
        .sts__msg { font-size: 12px; margin-top: 8px; }
        .sts__msg--ok { color: #4ade80; }
        .sts__msg--err { color: #f87171; }
      `}</style>
    </div>
  );
}
