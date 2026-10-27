import type { PublicShown } from "@/lib/displayState";
import { ShownThumb } from "../../LiveDisplays";
import { SCREEN_COLOR, type LayoutNode } from "../../model";

type Props = { node: LayoutNode; label: string; shown?: PublicShown; selected: boolean; hitRadius: number; detailed: boolean; thumbnail: boolean; latest?: boolean; scale?: number; onSelect: () => void; onFocus: () => void };

export function ScreenNode({ node, label, shown, selected, hitRadius, detailed, thumbnail, latest = false, scale = 1, onSelect, onFocus }: Props) {
  const color = SCREEN_COLOR[node.screen ?? ""] ?? "#94a3b8";
  return (
    <g className={`ng-node ng-screen${latest ? " is-latest" : ""}${selected ? " is-selected" : ""}${shown ? " is-confirmed" : ""}`} transform={`translate(${node.x} ${node.y}) scale(${scale})`} role="button" tabIndex={0}
      aria-label={`${label}${shown ? ", affichage confirmé" : ", sans affichage confirmé"}`} onClick={onSelect} onDoubleClick={onFocus}
      onKeyDown={(event) => { if (event.key === "Enter") onSelect(); }}>
      <circle className="ng-hit" r={hitRadius} />
      {latest && <rect className="ng-screen__halo" x={-46} y={-34} width={92} height={68} rx={9} style={{ stroke: color }} />}
      {thumbnail && shown?.frameId ? (
        <foreignObject className="ng-screen__thumb" x={-38} y={-27} width={76} height={54}>
          <div className="ng-thumb" style={{ borderColor: color }}><ShownThumb frameId={shown.frameId} screen={node.screen!} box={{ w: 76, h: 54 }} animHash={shown.isAnimation ? shown.blockHash : undefined} /></div>
        </foreignObject>
      ) : <rect className="ng-screen__body" x={-node.radius} y={-node.radius * 0.72} width={node.radius * 2} height={node.radius * 1.44} rx={4} style={{ stroke: color }} />}
      {detailed && <text className="ng-screen__label" textAnchor="middle" y={thumbnail ? 42 : node.radius + 15} style={{ fill: color }}>{label}</text>}
    </g>
  );
}
