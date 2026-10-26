"use client";
// Simule GET /api/sensor?public=1 avec 31 jours de mesures synthétiques (une toutes les 30 min, un trou de 2 jours) pour vérifier l'interface sans serveur.
// ?scenario=empty, error ou private pour les états limites.
import { useEffect, useState } from "react";
import { MeasuresExplorer } from "../MeasuresExplorer";

function synthetic(): { t: number; v: { temp: number; hum: number } }[] {
  const now = Math.floor(Date.now() / 1000), out = [];
  for (let k = 0; k < 31 * 48; k++) {
    const t = now - k * 1800;
    const day = Math.floor(t / 86400), hour = (t % 86400) / 3600;
    if (day % 11 === 3) continue;   // trou de 24 h
    const temp = 16 + 5 * Math.sin(((hour - 9) / 24) * Math.PI * 2) + 3 * Math.sin(day / 3);
    const hum = 55 - 14 * Math.sin(((hour - 9) / 24) * Math.PI * 2) + 8 * Math.cos(day / 2);
    out.push({ t, v: { temp: Math.round(temp * 10), hum: Math.round(hum * 10) } });
  }
  return out;
}

export default function LabClient() {
  const [scenario, setScenario] = useState("");
  const [ready, setReady] = useState(false);
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
    setScenario(sc); setReady(true);
    return () => { window.fetch = real; };
  }, []);
  return (
    <div style={{ maxWidth: 760, margin: "0 auto", padding: "1rem 0" }}>
      <p style={{ color: "var(--text3)", fontSize: "0.8rem" }}>Bac à sable (dev) · scénario : {scenario || "données synthétiques"} · ?scenario=empty | error | private</p>
      {ready && <MeasuresExplorer deviceId="dev_LAB00001" sensorLabel="Capteur du salon" ownerName="Artiste test" kinds={["temp", "hum"]} />}
    </div>
  );
}
