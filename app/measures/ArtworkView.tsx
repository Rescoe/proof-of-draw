"use client";
// app/measures/ArtworkView.tsx — ŒUVRE EN BULLES (02/11/2026, refonte). Une bulle par mesure ; l'œuvre s'agrandit avec les données. Toute la logique de forme est dans lib/measureArt.ts (pur, testé) ;
// ici : dessin, sélection, surface « papier » / « nuit », légende construite d'après les données réellement présentes.
import { useMemo, useState } from "react";
import { formatMeasure, type Measure } from "@/lib/measures";
import { ART_HEIGHT, ART_SURFACE, SLOT_PX, artTempColor, bubbleRadius, buildArtwork, type ArtScheme, type Bubble } from "@/lib/measureArt";
import { exactLabel } from "@/lib/measureReading";

const PAD_X = 22, PAD_T = 26, PAD_B = 34;
const SCHEME_KEY = "pod.measuresArtScheme";
const pill = (on: boolean): React.CSSProperties => ({ padding: "0.25rem 0.7rem", borderRadius: 999, fontSize: "0.76rem", cursor: "pointer", minHeight: 44, border: `1px solid ${on ? "var(--accent)" : "var(--border)"}`, background: on ? "rgba(124,107,255,0.14)" : "transparent", color: on ? "var(--accent)" : "var(--text2)" });

/** Positions des petites bulles : éventail autour de la verticale (au-dessus si la température monte, en dessous si elle baisse). */
function satellites(b: Bubble, r: number): { dx: number; dy: number }[] {
  const n = Math.abs(b.sat), dir = b.sat > 0 ? -1 : 1, out: { dx: number; dy: number }[] = [];
  for (let i = 0; i < n; i++) {
    const a = n === 1 ? 0 : (-0.9 + (1.8 * i) / (n - 1));   // radians autour de la verticale
    out.push({ dx: Math.sin(a) * (r + 9), dy: dir * Math.cos(a) * (r + 9) });
  }
  return out;
}

export function ArtworkView({ measures, tz }: { measures: Measure[]; tz: number }) {
  const art = useMemo(() => buildArtwork(measures), [measures]);
  // monté seulement après le chargement des mesures (côté client) : la lecture du stockage ne peut pas désaccorder le rendu serveur
  const [scheme, setScheme] = useState<ArtScheme>(() => { try { const s = localStorage.getItem(SCHEME_KEY); if (s === "paper" || s === "night") return s; } catch { /* stockage indisponible */ } return "night"; });
  const [fit, setFit] = useState(false);
  const [sel, setSel] = useState<number | null>(null);
  const pick = (s: ArtScheme) => { setScheme(s); try { localStorage.setItem(SCHEME_KEY, s); } catch { /* idem */ } };
  const S = ART_SURFACE[scheme];

  if (art.bubbles.length === 0) return <p style={{ color: "var(--text3)", fontSize: "0.82rem", margin: 0 }}>Aucune mesure de température, d’humidité ou d’air sur cette période : il n’y a rien à dessiner.</p>;

  const width = Math.max(320, art.widthPx + PAD_X * 2), height = ART_HEIGHT + PAD_T + PAD_B;
  const cx = (b: Bubble) => PAD_X + b.slot * SLOT_PX;
  const cy = (b: Bubble) => PAD_T + (1 - b.y) * ART_HEIGHT;
  const hasTemp = art.bubbles.some((b) => b.temp !== null), hasHum = art.bubbles.some((b) => b.hum !== null), hasAir = art.bubbles.some((b) => b.air !== null), hasSat = art.bubbles.some((b) => b.sat !== 0);
  const selected = sel === null ? null : art.bubbles.find((b) => b.t === sel) ?? null;
  // repères de jours : première bulle de chaque jour local
  const dayMarks: { x: number; label: string }[] = [];
  let lastDay = -1;
  for (const b of art.bubbles) {
    const d = Math.floor((b.t + tz * 60) / 86400);
    if (d !== lastDay) { lastDay = d; const dt = new Date((b.t + tz * 60) * 1000); dayMarks.push({ x: cx(b), label: `${String(dt.getUTCDate()).padStart(2, "0")}/${String(dt.getUTCMonth() + 1).padStart(2, "0")}` }); }
  }
  const labelEvery = Math.ceil(dayMarks.length / Math.max(1, Math.floor(width / 70)));

  return (
    <div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "space-between", marginBottom: 8 }}>
        <div role="group" aria-label="Surface de l'œuvre" style={{ display: "flex", gap: 6 }}>
          <button type="button" style={pill(scheme === "paper")} aria-pressed={scheme === "paper"} onClick={() => pick("paper")}>☀ Papier</button>
          <button type="button" style={pill(scheme === "night")} aria-pressed={scheme === "night"} onClick={() => pick("night")}>☾ Nuit</button>
        </div>
        <button type="button" style={pill(fit)} aria-pressed={fit} onClick={() => setFit((v) => !v)}>{fit ? "↔ Taille réelle" : "⤢ Tout voir"}</button>
      </div>
      <div style={{ background: S.bg, borderRadius: 12, overflowX: fit ? "hidden" : "auto", border: "1px solid var(--border)" }}>
        <svg viewBox={`0 0 ${width} ${height}`} width={fit ? "100%" : width} height={fit ? undefined : height} role="img"
          aria-label={`Œuvre : ${art.bubbles.length} bulles, une par mesure. Température en hauteur, humidité en taille.`} style={{ display: "block", minWidth: fit ? 0 : width }}>
          {dayMarks.map((m, i) => i % labelEvery === 0 ? <g key={i}><line x1={m.x} x2={m.x} y1={PAD_T - 10} y2={PAD_T + ART_HEIGHT + 4} stroke={S.empty} strokeDasharray="2 5" /><text x={m.x + 3} y={height - 10} fontSize="10" fill={S.muted}>{m.label}</text></g> : null)}
          {art.bubbles.map((b, i) => {
            const r = bubbleRadius(b.size), col = artTempColor(b.temp, scheme), x = cx(b), y = cy(b), prev = art.bubbles[i - 1];
            return (
              <g key={b.t} onPointerDown={() => setSel(b.t)} style={{ cursor: "pointer" }}>
                {prev && b.slot - prev.slot >= 3 && <line x1={cx(prev) + 8} x2={x - 8} y1={PAD_T + ART_HEIGHT / 2} y2={PAD_T + ART_HEIGHT / 2} stroke={S.empty} strokeDasharray="3 4" />}
                {b.halo > 0 && <circle cx={x} cy={y} r={r + 4 + b.halo * 16} fill="none" stroke={S.halo} strokeWidth={2 + b.halo * 6} opacity={0.18 + 0.55 * b.halo} />}
                <circle cx={x} cy={y} r={r} fill={col} opacity={0.88} stroke={S.ink} strokeOpacity={0.18} strokeWidth={0.8} />
                {satellites(b, r).map((s, k) => <circle key={k} cx={x + s.dx} cy={y + s.dy} r={2.3} fill={col} opacity={0.95} />)}
                {selected === b && <circle cx={x} cy={y} r={r + 7 + b.halo * 16} fill="none" stroke={S.ink} strokeWidth={1.5} />}
                <circle cx={x} cy={y} r={Math.max(r + 6, 14)} fill="transparent" />
              </g>
            );
          })}
        </svg>
      </div>

      <div style={{ minHeight: 44, margin: "8px 0", fontSize: "0.82rem", color: "var(--text2)" }} aria-live="polite">
        {selected ? (
          <>
            <b style={{ color: "var(--text)" }}>{exactLabel(selected.t, tz)}</b>
            {selected.temp !== null && <> · {formatMeasure("temp", selected.temp)}</>}
            {selected.hum !== null && <> · {formatMeasure("hum", selected.hum)}</>}
            {selected.air !== null && <> · air : {formatMeasure("vocidx", selected.air)}</>}
            {selected.delta !== null && selected.sat !== 0 && <> · {selected.delta > 0 ? "+" : "−"}{(Math.abs(selected.delta) / 10).toFixed(1).replace(".", ",")} °C depuis la mesure précédente ({Math.abs(selected.sat)} petite{Math.abs(selected.sat) > 1 ? "s" : ""} bulle{Math.abs(selected.sat) > 1 ? "s" : ""} {selected.sat > 0 ? "au-dessus" : "en dessous"})</>}
          </>
        ) : "Touchez une bulle pour lire la mesure qu’elle représente."}
      </div>

      <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "grid", gap: 6, fontSize: "0.78rem", color: "var(--text2)", borderTop: "1px solid var(--border)", paddingTop: 8 }} aria-label="Légende de l'œuvre">
        <li><b>Une bulle = une mesure.</b> {art.bubbles.length} bulle{art.bubbles.length > 1 ? "s" : ""} : plus la carte envoie de mesures, plus l’œuvre s’étend. Un trou dans les données reste un trou (trait pointillé).</li>
        {hasTemp && <li><b>Hauteur et couleur = température.</b> En haut, plus chaud. <span aria-hidden style={{ display: "inline-block", width: 90, height: 8, borderRadius: 4, verticalAlign: "middle", background: `linear-gradient(90deg,${[0, 100, 170, 220, 280, 340].map((t) => artTempColor(t, scheme)).join(",")})` }} /> de 0 °C à 34 °C ; plage de hauteur : {formatMeasure("temp", art.tempLo as number)} à {formatMeasure("temp", art.tempHi as number)}.</li>}
        {hasHum && <li><b>Taille = humidité.</b> Plus l’air est humide, plus la bulle est grande (de 0 % à 100 %).</li>}
        {hasAir && <li><b>Halo violet = air chargé</b> (indice de Sensirion). Pas de halo tant que l’air est habituel (indice ≤ 100) ; plus il est chargé, plus le halo est large et marqué.</li>}
        {hasSat && <li><b>Petites bulles = variation de température</b> depuis la mesure précédente : une par demi-degré (cinq au plus), au-dessus si ça se réchauffe, en dessous si ça se refroidit.</li>}
        {!hasTemp && <li>Sans température mesurée (ou publique), les bulles restent sur une ligne médiane : rien n’est inventé.</li>}
      </ul>
    </div>
  );
}
