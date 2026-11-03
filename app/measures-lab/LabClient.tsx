"use client";
// Simule GET /api/sensor?public=1 avec 31 jours de mesures synthétiques (une toutes les 30 min, un trou de 2 jours) pour vérifier l'interface sans serveur.
// ?scenario=empty, error ou private pour les états limites.
import { useEffect, useState } from "react";
import { MeasuresExplorer } from "../MeasuresExplorer";
import { MeasuresPanel } from "../measures/MeasuresPanel";
import type { MeasureKind } from "@/lib/measures";

function synthetic(): { t: number; v: Record<string, number> }[] {
  // 02/11/2026 : une mesure par HEURE (cadence réelle des cartes), toutes les grandeurs (air, signal, latence, débit), un trou de 24 h
  const now = Math.floor(Date.now() / 1000), out = [];
  for (let k = 0; k < 31 * 24; k++) {
    const t = now - k * 3600;
    const day = Math.floor(t / 86400), hour = (t % 86400) / 3600;
    if (day % 11 === 3) continue;   // trou de 24 h
    const temp = 16 + 5 * Math.sin(((hour - 9) / 24) * Math.PI * 2) + 3 * Math.sin(day / 3);
    const hum = 55 - 14 * Math.sin(((hour - 9) / 24) * Math.PI * 2) + 8 * Math.cos(day / 2);
    const air = Math.max(1, Math.round(90 + 60 * Math.max(0, Math.sin(((hour - 17) / 24) * Math.PI * 2)) + 40 * Math.max(0, Math.sin(day * 1.3)) + 15 * Math.sin(k * 1.7)));
    out.push({ t, v: { temp: Math.round(temp * 10), hum: Math.round(hum * 10), vocidx: air, rssi: -60 - Math.round(8 * Math.sin(k / 5)), lat: 600 + Math.round(120 * Math.sin(k / 3)), dl: 55 + Math.round(10 * Math.cos(k / 7)) } });
  }
  return out;
}

export default function LabClient() {
  const [scenario, setScenario] = useState("");
  const [ready, setReady] = useState(false);
  const [view, setView] = useState("");
  useEffect(() => {
    const real = window.fetch.bind(window);
    const sc = new URLSearchParams(window.location.search).get("scenario") ?? "";
    window.fetch = (input, init) => {
      const url = typeof input === "string" ? input : input instanceof Request ? input.url : String(input);
      if (!url.includes("/api/sensor")) return real(input, init);
      if (sc === "error") return Promise.resolve(new Response("{}", { status: 500 }));
      if (sc === "private") return Promise.resolve(new Response("{}", { status: 404 }));
      return Promise.resolve(Response.json({ measures: sc === "empty" ? [] : synthetic() }));
    };
    // eslint-disable-next-line react-hooks/set-state-in-effect -- installation de la simulation avant le premier rendu de l'explorateur
    setScenario(sc); setView(new URLSearchParams(window.location.search).get("view") ?? ""); setReady(true);
    return () => { window.fetch = real; };
  }, []);
  return (
    <div style={{ maxWidth: 760, margin: "0 auto", padding: "1rem 0" }}>
      <p style={{ color: "var(--text3)", fontSize: "0.8rem" }}>Bac à sable (dev) · scénario : {scenario || "données synthétiques"} · ?scenario=empty | error | private · ?view=v1 (ancienne vue)</p>
      {ready && view === "v1" && <MeasuresExplorer deviceId="dev_LAB00001" sensorLabel="Capteur du salon" ownerName="Artiste test" kinds={["temp", "hum"]} />}
      {ready && view !== "v1" && <MeasuresPanel deviceId="dev_LAB00001" sensorLabel="Capteur du salon" ownerName="Artiste test" kinds={["temp", "hum", "vocidx", "rssi", "lat", "dl"] as MeasureKind[]} owner showTable measuresPublic />}
    </div>
  );
}
