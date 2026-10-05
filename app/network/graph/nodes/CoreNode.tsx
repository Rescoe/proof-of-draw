import type { LayoutNode } from "../../model";

type Props = { node: LayoutNode; selected: boolean; hitRadius: number; markerScale: number; onSelect: () => void; onFocus: () => void };

export function CoreNode({ node, selected, hitRadius, markerScale, onSelect, onFocus }: Props) {
  return (
    <g className={`ng-node ng-core${selected ? " is-selected" : ""}`} transform={`translate(${node.x} ${node.y})`} role="button" tabIndex={0}
      aria-label="Noyau du réseau" onClick={onSelect} onDoubleClick={onFocus}
      onKeyDown={(event) => { if (event.key === "Enter") onSelect(); }}>
      <circle className="ng-hit" r={hitRadius} />
      <g transform={`scale(${markerScale})`}>
        <circle className="ng-core__aura" r={node.radius + 22} />
        <circle className="ng-core__body" r={node.radius} />
        <text className="ng-core__mark" textAnchor="middle" y={-2}>PoD</text>
        <text className="ng-core__status" textAnchor="middle" y={20}>CORE · LIVE</text>
      </g>
    </g>
  );
}
