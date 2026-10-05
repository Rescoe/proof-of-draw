import type { ArtistGroup, LayoutNode } from "../../model";

type Props = { node: LayoutNode; artist: ArtistGroup; selected: boolean; hitRadius: number; detailed: boolean; active: boolean; onSelect: () => void; onFocus: () => void };

export function ArtistNode({ node, artist, selected, hitRadius, detailed, active, onSelect, onFocus }: Props) {
  const initials = artist.label.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toLocaleUpperCase("fr")).join("") || "?";
  return (
    <g className={`ng-node ng-artist${selected ? " is-selected" : ""}${active ? " is-active" : ""}`} transform={`translate(${node.x} ${node.y})`} role="button" tabIndex={0}
      aria-label={`${artist.label}, ${artist.devices.length} appareils`} onClick={onSelect} onDoubleClick={onFocus}
      onKeyDown={(event) => { if (event.key === "Enter") onSelect(); }}>
      <circle className="ng-hit" r={hitRadius} />
      {detailed && <circle className="ng-artist__territory" r={Math.max(node.radius + 18, artist.devices.length > 1 ? 146 : 84)} />}
      {active && <circle className="ng-artist__activity" r={node.radius + 12} />}
      <circle className="ng-artist__body" r={node.radius} />
      <text className="ng-artist__initials" textAnchor="middle" y={5}>{initials}</text>
      {detailed && <>
        <text className="ng-artist__name" textAnchor="middle" y={node.radius + 20}>{artist.label}</text>
        <text className="ng-artist__meta" textAnchor="middle" y={node.radius + 35}>{artist.onlineCount}/{artist.devices.length} en ligne</text>
      </>}
    </g>
  );
}
