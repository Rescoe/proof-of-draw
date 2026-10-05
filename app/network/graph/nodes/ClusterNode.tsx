import type { ClusterGroup, LayoutNode } from "../../model";

type Props = { node: LayoutNode; cluster: ClusterGroup; selected: boolean; hitRadius: number; markerScale: number; marker: boolean; onSelect: () => void; onFocus: () => void };

export function ClusterNode({ node, cluster, selected, hitRadius, markerScale, marker, onSelect, onFocus }: Props) {
  return (
    <g className={`ng-node ng-cluster${selected ? " is-selected" : ""}`} transform={`translate(${node.x} ${node.y})`} role="button" tabIndex={0}
      aria-label={`Zone de la carte, ${cluster.deviceCount} appareils, ${cluster.artistCount} artistes`} onClick={() => { onSelect(); onFocus(); }}
      onKeyDown={(event) => { if (event.key === "Enter") { onSelect(); onFocus(); } }}>
      <circle className="ng-hit" r={hitRadius} />
      <circle className="ng-cluster__orbit" r={node.radius} />
      <circle className="ng-cluster__orbit ng-cluster__orbit--inner" r={node.radius * .72} />
      {marker && <g transform={`scale(${markerScale})`}>
        <circle className="ng-cluster__body" r={46} />
        <text className="ng-cluster__value" textAnchor="middle" y={3}>{cluster.deviceCount}</text>
        <text className="ng-cluster__label" textAnchor="middle" y={17}>APPAREILS</text>
        <text className="ng-cluster__count" textAnchor="middle" y={31}>{cluster.artistCount} artistes</text>
      </g>}
    </g>
  );
}
