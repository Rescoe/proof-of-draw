import type { PublicShown } from "@/lib/displayState";
import type { NetworkDevice } from "@/lib/networkSnapshot";
import { ShownThumb } from "../../LiveDisplays";
import { HARDWARE_COLOR, type LayoutNode } from "../../model";

type Props = {
  node: LayoutNode;
  device: NetworkDevice;
  shown?: PublicShown;
  shownScreen?: string;
  selected: boolean;
  hitRadius: number;
  detailed: boolean;
  thumbnail: boolean;
  active: boolean;
  onSelect: () => void;
  onFocus: () => void;
};

export function DeviceNode({ node, device, shown, shownScreen, selected, hitRadius, detailed, thumbnail, active, onSelect, onFocus }: Props) {
  const icon = device.hardware === "uno-r4" ? "R4" : device.hardware === "esp8266" ? "ESP" : "?";
  return (
    <g className={`ng-node ng-device${selected ? " is-selected" : ""}${device.isOnline ? " is-online" : " is-offline"}${active ? " is-active" : ""}`}
      transform={`translate(${node.x} ${node.y})`} role="button" tabIndex={0} aria-label={`Appareil ${device.publicId}, ${device.isOnline ? "en ligne" : "hors ligne"}`}
      onClick={onSelect} onDoubleClick={onFocus} onKeyDown={(event) => { if (event.key === "Enter") onSelect(); }}>
      <circle className="ng-hit" r={hitRadius} />
      {active && <circle className="ng-device__activity" r={node.radius + 9} />}
      <circle className="ng-device__body" r={node.radius} style={{ stroke: HARDWARE_COLOR[device.hardware] }} />
      {thumbnail && shown?.frameId && shownScreen ? (
        <foreignObject className="ng-device__thumb" x={-24} y={-17} width={48} height={34}>
          <div className="ng-thumb"><ShownThumb frameId={shown.frameId} screen={shownScreen} box={{ w: 48, h: 34 }} /></div>
        </foreignObject>
      ) : <text className="ng-device__icon" textAnchor="middle" y={4}>{icon}</text>}
      <circle className="ng-device__status" cx={node.radius * 0.68} cy={-node.radius * 0.68} r={5} />
      {detailed && <text className="ng-device__label" textAnchor="middle" y={node.radius + 17}>{device.publicId.slice(0, 11)}</text>}
    </g>
  );
}
