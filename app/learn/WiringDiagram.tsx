// app/learn/WiringDiagram.tsx
// Schéma de câblage NodeMCU ↔ module écran, en SVG + tableau texte (accessible,
// copiable). Les données viennent de app/learn/wiring.ts, elles-mêmes relevées
// dans les firmwares (esp8266/*/epdif.h, *.ino) — voir les références de chaque entrée.

import type { WiringSpec } from "./wiring";

const ROW = 34;      // espacement vertical des broches
const TOP = 56;      // marge haute (titres des boîtes)
const NODE_X = 190;  // bord droit de la boîte NodeMCU
const MOD_X = 470;   // bord gauche de la boîte module

export function WiringDiagram({ spec }: { spec: WiringSpec }) {
  // Broches NodeMCU uniques, dans l'ordre physique du connecteur
  const nodePins = Array.from(new Set(spec.wires.map((w) => w.node)))
    .sort((a, b) => spec.nodeOrder.indexOf(a) - spec.nodeOrder.indexOf(b));
  const rows = Math.max(nodePins.length, spec.wires.length);
  const height = TOP + rows * ROW + 20;

  const nodeY = (pin: string) => TOP + nodePins.indexOf(pin) * ROW + ROW / 2;
  const modY  = (i: number)   => TOP + i * ROW + ROW / 2;

  return (
    <figure style={{ margin: "1rem 0" }}>
      <svg
        viewBox={`0 0 660 ${height}`}
        role="img"
        aria-label={`Schéma de câblage : ${spec.title}`}
        style={{ width: "100%", maxWidth: 660, height: "auto", display: "block" }}
      >
        {/* Boîte NodeMCU */}
        <rect x={20} y={12} width={NODE_X - 20} height={height - 24} rx={10}
          fill="var(--bg3)" stroke="var(--border)" />
        <text x={(20 + NODE_X) / 2} y={36} textAnchor="middle" fontSize={13} fontWeight={700} fill="var(--text)">
          NodeMCU v1
        </text>

        {/* Boîte module */}
        <rect x={MOD_X} y={12} width={640 - MOD_X + 20} height={height - 24} rx={10}
          fill="var(--bg3)" stroke="var(--border)" />
        <text x={(MOD_X + 660) / 2} y={36} textAnchor="middle" fontSize={13} fontWeight={700} fill="var(--text)">
          {spec.moduleName}
        </text>

        {/* Fils (dessinés avant les broches pour passer dessous) */}
        {spec.wires.map((w, i) => {
          const y1 = nodeY(w.node), y2 = modY(i);
          const mid = (NODE_X + MOD_X) / 2;
          return (
            <path key={`${w.pin}-${i}`}
              d={`M ${NODE_X} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${MOD_X} ${y2}`}
              fill="none" stroke={w.color} strokeWidth={3} strokeLinecap="round" />
          );
        })}

        {/* Broches NodeMCU */}
        {nodePins.map((pin) => {
          const gpio = spec.gpio[pin];
          return (
            <g key={pin}>
              <circle cx={NODE_X} cy={nodeY(pin)} r={5} fill="var(--text2)" />
              <text x={NODE_X - 14} y={nodeY(pin) + 4} textAnchor="end" fontSize={12}
                fontFamily="JetBrains Mono, monospace" fill="var(--text)">
                {pin}{gpio ? ` · ${gpio}` : ""}
              </text>
            </g>
          );
        })}

        {/* Broches du module */}
        {spec.wires.map((w, i) => (
          <g key={`m-${w.pin}-${i}`}>
            <circle cx={MOD_X} cy={modY(i)} r={5} fill="var(--text2)" />
            <text x={MOD_X + 14} y={modY(i) + 4} fontSize={12}
              fontFamily="JetBrains Mono, monospace" fill="var(--text)">
              {w.pin}
            </text>
          </g>
        ))}
      </svg>

      <figcaption style={{ fontSize: "0.78rem", color: "var(--text3)", marginTop: "0.4rem" }}>
        {spec.title}
      </figcaption>

      {/* Tableau équivalent (texte) */}
      <div style={{ overflowX: "auto", marginTop: "0.6rem" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.8rem" }}>
          <thead>
            <tr style={{ textAlign: "left", color: "var(--text3)" }}>
              <th style={th}>Fil</th>
              <th style={th}>Module</th>
              <th style={th}>NodeMCU</th>
              <th style={th}>Remarque</th>
            </tr>
          </thead>
          <tbody>
            {spec.wires.map((w, i) => (
              <tr key={`t-${w.pin}-${i}`}>
                <td style={td}>
                  <span aria-hidden style={{
                    display: "inline-block", width: 12, height: 12, borderRadius: 3,
                    background: w.color, border: "1px solid var(--border)", verticalAlign: "middle",
                  }} />
                </td>
                <td style={{ ...td, fontFamily: "JetBrains Mono, monospace", fontWeight: 700 }}>{w.pin}</td>
                <td style={{ ...td, fontFamily: "JetBrains Mono, monospace" }}>
                  {w.node}{spec.gpio[w.node] ? ` (${spec.gpio[w.node]})` : ""}
                </td>
                <td style={{ ...td, color: "var(--text2)" }}>{w.note ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </figure>
  );
}

const th: React.CSSProperties = { padding: "0.35rem 0.5rem", borderBottom: "1px solid var(--border)", fontWeight: 600 };
const td: React.CSSProperties = { padding: "0.35rem 0.5rem", borderBottom: "1px solid var(--border)" };
