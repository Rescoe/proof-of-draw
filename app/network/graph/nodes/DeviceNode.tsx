import type { NetworkDevice } from "@/lib/networkSnapshot";
import { HARDWARE_COLOR, type LayoutNode } from "../../model";
import { formatMeasure } from "@/lib/measures";

type Props = {
  node: LayoutNode;
  device: NetworkDevice;
  selected: boolean;
  hitRadius: number;
  detailed: boolean;
  active: boolean;
  scale?: number;
  onSelect: () => void;
  onFocus: () => void;
};

export function DeviceNode({ node, device, selected, hitRadius, detailed, active, scale = 1, onSelect, onFocus }: Props) {
  const icon = device.measures && device.screens.length === 0 ? "🌡" : device.hardware === "uno-r4" ? "R4" : device.hardware === "esp8266" ? "ESP" : "?";
  // Capteur : dernière mesure sous le nœud (vue Constellation) — lue dans le snapshot, aucune requête
  const latest = device.measures?.latest;
  const isSensor = !!device.measures && device.screens.length === 0;   // capteur seul : losange ambre (les autres appareils sont des cercles)
  const reading = latest ? device.measures!.kinds.filter((k) => latest.v[k] !== undefined).map((k) => formatMeasure(k, latest.v[k] as number)).join(" · ") : "";
  return (
    <g className={`ng-node ng-device${isSensor ? " ng-device--sensor" : ""}${selected ? " is-selected" : ""}${device.isOnline ? " is-online" : " is-offline"}${active ? " is-active" : ""}`}
      transform={`translate(${node.x} ${node.y}) scale(${scale})`} role="button" tabIndex={0} aria-label={`Appareil ${device.publicId}, ${device.isOnline ? "en ligne" : "hors ligne"}`}
      onClick={onSelect} onDoubleClick={onFocus} onKeyDown={(event) => { if (event.key === "Enter") onSelect(); }}>
      <circle className="ng-hit" r={hitRadius} />
      {active && <circle className="ng-device__activity" r={node.radius + 9} />}
      {isSensor
        ? <rect className="ng-device__body" x={-node.radius * 0.78} y={-node.radius * 0.78} width={node.radius * 1.56} height={node.radius * 1.56} rx={5} transform="rotate(45)" style={{ stroke: "#fbbf24" }} />
        : <circle className="ng-device__body" r={node.radius} style={{ stroke: HARDWARE_COLOR[device.hardware] }} />}
      {/* Un appareil (ESP) n'affiche jamais d'image : seuls ses écrans (ScreenNode) en portent. */}
      <text className="ng-device__icon" textAnchor="middle" y={4}>{icon}</text>
      <circle className="ng-device__status" cx={node.radius * 0.68} cy={-node.radius * 0.68} r={5} />
      {detailed && <text className="ng-device__label" textAnchor="middle" y={node.radius + 17}>{device.publicId.slice(0, 11)}</text>}
      {reading && <text className="ng-device__label" textAnchor="middle" y={node.radius + (detailed ? 31 : 17)} style={{ fontWeight: 700 }}>{reading}</text>}
    </g>
  );
}
