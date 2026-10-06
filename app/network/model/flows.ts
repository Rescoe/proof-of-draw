import type { PublicShown } from "@/lib/displayState";
import type { NetworkDevice } from "@/lib/networkSnapshot";
import {
  CORE_NODE_ID,
  FLOW_ACTIVE_MS,
  FLOW_FADE_MS,
  FLOW_PULSE_PERIOD_MS,
  MAX_RECONSTRUCTED_FLOWS,
  MAX_VISIBLE_FLOWS,
  SCREEN_COLOR,
} from "./constants";
import { displayModeLabel, normaliseLabel } from "./format";
import { artistNodeId, deviceNodeId, screenNodeId, type ArtistGroup } from "./groups";

export type DisplaysMapLike = Record<string, Record<string, PublicShown>>;

export type NetworkEventLike = {
  id: string;
  type: "BLOCK_MINED" | "VALIDATION_PENDING" | "VALIDATION_VOTE" | "ANIMATION" | "CHAIN_EMPTY" | "PRESENCE" | "FRAME_SENT";
  ts: number;
  screen?: string;
  deviceRef?: string;
  artistName?: string;
  blockIndex?: number;
  workTitle?: string;
  validatorCount?: number;
  poolSize?: number;
  message: string;
};

export type FlowKind = "delivery" | "vote" | "validation" | "block" | "animation" | "pull" | "frame";
/**
 * observed      : un ACK d'écran, un vote ou un événement de la chaîne a réellement été relevé ;
 * reconstructed : déduit de données publiées (dernière présence d'un appareil, bloc miné ➜ appareils du pool de cet écran) — c'est ce que le trajet DEVRAIT avoir été,
 *                 pas une mesure. Toujours signalé par un astérisque dans l'interface.
 */
export type FlowOrigin = "observed" | "reconstructed";
export type FlowPhase = "active" | "fading" | "expired";

export type FlowLifetime = {
  phase: FlowPhase;
  ageMs: number;
  opacity: number;
};

export type ObservedFlow = {
  id: string;
  kind: FlowKind;
  origin: FlowOrigin;
  timestamp: number;
  path: string[];
  /** Un trajet d'un seul noeud produit un halo réel, jamais une fausse impulsion. */
  moving: boolean;
  color: string;
  label: string;
  detail?: string;
  artistKey?: string;
  publicId?: string;
  screen?: string;
  phase: Exclude<FlowPhase, "expired">;
  ageMs: number;
  opacity: number;
  pulsePeriodMs: number;
};

export function flowLifetime(timestamp: number, now: number): FlowLifetime {
  const ageMs = Math.max(0, now - timestamp);
  if (ageMs <= FLOW_ACTIVE_MS) return { phase: "active", ageMs, opacity: 1 };
  if (ageMs <= FLOW_ACTIVE_MS + FLOW_FADE_MS) {
    const opacity = 1 - (ageMs - FLOW_ACTIVE_MS) / FLOW_FADE_MS;
    return { phase: "fading", ageMs, opacity: Math.max(0, Math.min(1, opacity)) };
  }
  return { phase: "expired", ageMs, opacity: 0 };
}

function toObserved(
  base: Omit<ObservedFlow, "phase" | "ageMs" | "opacity" | "pulsePeriodMs" | "moving" | "origin"> & { origin?: FlowOrigin },
  now: number,
): ObservedFlow | null {
  const lifetime = flowLifetime(base.timestamp, now);
  if (lifetime.phase === "expired") return null;
  return {
    ...base,
    origin: base.origin ?? "observed",
    moving: base.path.length > 1,
    phase: lifetime.phase,
    ageMs: lifetime.ageMs,
    opacity: lifetime.opacity,
    pulsePeriodMs: FLOW_PULSE_PERIOD_MS,
  };
}

function uniqueArtistByName(artists: readonly ArtistGroup[], name?: string): ArtistGroup | undefined {
  const needle = normaliseLabel(name);
  if (!needle) return undefined;
  const matches = artists.filter((artist) => normaliseLabel(artist.label) === needle);
  return matches.length === 1 ? matches[0] : undefined;
}

/**
 * Transforme uniquement des ACK et événements réels en trajets de graphe.
 * Aucune donnée ⇒ aucun flux. Les événements ambigus restent des halos du core
 * plutôt que d'inventer un artiste ou un appareil cible.
 */
export function buildObservedFlows(input: {
  devices: readonly NetworkDevice[];
  artists: readonly ArtistGroup[];
  displays?: DisplaysMapLike | null;
  events?: readonly NetworkEventLike[];
  now?: number;
  maxFlows?: number;
  /** Ajoute les flux RECONSTITUÉS (présences, diffusions de blocs), marqués `origin: "reconstructed"`. Désactivé par défaut. */
  reconstruct?: boolean;
}): ObservedFlow[] {
  const now = input.now ?? Date.now();
  const maxFlows = input.maxFlows ?? MAX_VISIBLE_FLOWS;
  const deviceById = new Map(input.devices.map((device) => [device.deviceId, device]));
  const deviceByPublicId = new Map(input.devices.map((device) => [device.publicId, device]));
  const raw: ObservedFlow[] = [];

  for (const [deviceId, screens] of Object.entries(input.displays ?? {})) {
    const device = deviceById.get(deviceId);
    if (!device) continue;
    for (const [screen, shown] of Object.entries(screens)) {
      const flow = toObserved({
        id: `delivery:${device.publicId}:${screen}:${shown.shownAt}`,
        kind: "delivery",
        timestamp: shown.shownAt,
        path: [
          CORE_NODE_ID,
          artistNodeId(device.artistKey),
          deviceNodeId(device.publicId),
          screenNodeId(device.publicId, screen),
        ],
        color: SCREEN_COLOR[screen] ?? "#60a5fa",
        label: `${displayModeLabel(shown.mode, shown.isAnimation)} affichée`,
        detail: shown.workTitle,
        artistKey: device.artistKey,
        publicId: device.publicId,
        screen,
      }, now);
      if (flow) raw.push(flow);
    }
  }

  for (const event of input.events ?? []) {
    if (event.type === "VALIDATION_VOTE" && event.deviceRef) {
      const device = deviceByPublicId.get(event.deviceRef);
      if (!device) continue;
      const flow = toObserved({
        id: `event:${event.id}`,
        kind: "vote",
        timestamp: event.ts,
        path: [deviceNodeId(device.publicId), artistNodeId(device.artistKey), CORE_NODE_ID],
        color: "#a78bfa",
        label: "vote reçu",
        detail: event.message,
        artistKey: device.artistKey,
        publicId: device.publicId,
        screen: event.screen,
      }, now);
      if (flow) raw.push(flow);
      continue;
    }

    if (event.type === "VALIDATION_PENDING") {
      const artist = uniqueArtistByName(input.artists, event.artistName);
      const path = artist ? [artistNodeId(artist.artistKey), CORE_NODE_ID] : [CORE_NODE_ID];
      const flow = toObserved({
        id: `event:${event.id}`,
        kind: "validation",
        timestamp: event.ts,
        path,
        color: "#fbbf24",
        label: "validation en cours",
        detail: `${event.validatorCount ?? 0}/${event.poolSize ?? "?"} votes${event.workTitle ? ` · ${event.workTitle}` : ""}`,
        artistKey: artist?.artistKey,
        screen: event.screen,
      }, now);
      if (flow) raw.push(flow);
      continue;
    }

    if (event.type === "BLOCK_MINED") {
      const flow = toObserved({
        id: `event:${event.id}`,
        kind: "block",
        timestamp: event.ts,
        path: [CORE_NODE_ID],
        color: "#4ade80",
        label: `bloc #${event.blockIndex ?? "?"} validé`,
        detail: event.workTitle,
        screen: event.screen,
      }, now);
      if (flow) raw.push(flow);
      continue;
    }

    if (event.type === "ANIMATION") {
      const flow = toObserved({
        id: `event:${event.id}`,
        kind: "animation",
        timestamp: event.ts,
        path: [CORE_NODE_ID],
        color: "#2dd4bf",
        label: "animation publiée",
        detail: event.workTitle,
      }, now);
      if (flow) raw.push(flow);
    }
  }

  const priority: Record<FlowKind, number> = { delivery: 5, vote: 4, validation: 3, block: 2, animation: 1, frame: 1, pull: 0 };
  const observed = raw
    .sort((a, b) => b.timestamp - a.timestamp || priority[b.kind] - priority[a.kind] || a.id.localeCompare(b.id))
    .slice(0, Math.max(0, maxFlows));
  if (!input.reconstruct) return observed;
  return [...observed, ...buildReconstructedFlows({ ...input, now, shownOf: (deviceId, screen) => input.displays?.[deviceId]?.[screen] })];
}

/**
 * Flux RECONSTITUÉS : ce que les données publiées permettent de déduire, sans mesure directe.
 *   • pull    : la dernière présence d'un appareil (ping/pull) ➜ appareil → artiste → core. Réécrite au plus toutes les ≈ 12 min côté serveur (quota Redis) :
 *               c'est donc une présence récente, pas chaque requête ;
 *   • frame   : un bloc miné est diffusé aux appareils EN LIGNE de son type d'écran (le pool) ➜ core → artiste → appareil → écran ; omis dès que l'écran a confirmé
 *               l'affichage par un ACK (le flux observé de livraison prend le relais).
 * Aucune donnée ⇒ aucun flux. Plafonné (MAX_RECONSTRUCTED_FLOWS) : le reconstitué ne noie jamais l'observé.
 */
export function buildReconstructedFlows(input: {
  devices: readonly NetworkDevice[];
  events?: readonly NetworkEventLike[];
  now: number;
  shownOf?: (deviceId: string, screen: string) => PublicShown | undefined;
  max?: number;
}): ObservedFlow[] {
  const out: ObservedFlow[] = [];
  const now = input.now;

  for (const device of input.devices) {
    const timestamp = Math.max(device.lastPing || 0, device.lastSeen || 0);
    if (!timestamp) continue;
    const flow = toObserved({
      id: `recon:pull:${device.publicId}:${timestamp}`,
      kind: "pull",
      origin: "reconstructed",
      timestamp,
      path: [deviceNodeId(device.publicId), artistNodeId(device.artistKey), CORE_NODE_ID],
      color: "#60a5fa",
      label: "présence / pull*",
      detail: `dernière présence ${new Date(timestamp).toISOString()}`,
      artistKey: device.artistKey,
      publicId: device.publicId,
    }, now);
    if (flow) out.push(flow);
  }

  const blocks = (input.events ?? []).filter((event) => event.type === "BLOCK_MINED" && event.screen).sort((a, b) => b.ts - a.ts).slice(0, 3);
  for (const block of blocks) {
    const targets = input.devices
      .filter((device) => device.isOnline && device.screens.some((screen) => screen.screen === block.screen))
      .sort((a, b) => a.publicId.localeCompare(b.publicId))
      .slice(0, 6);
    for (const device of targets) {
      const confirmed = input.shownOf?.(device.deviceId, block.screen!);
      if (confirmed && confirmed.shownAt >= block.ts) continue;   // l'ACK a été observé : le flux de livraison observé s'en charge
      const flow = toObserved({
        id: `recon:frame:${block.id}:${device.publicId}`,
        kind: "frame",
        origin: "reconstructed",
        timestamp: block.ts,
        path: [CORE_NODE_ID, artistNodeId(device.artistKey), deviceNodeId(device.publicId), screenNodeId(device.publicId, block.screen!)],
        color: SCREEN_COLOR[block.screen!] ?? "#60a5fa",
        label: `bloc #${block.blockIndex ?? "?"} diffusé*`,
        detail: block.workTitle,
        artistKey: device.artistKey,
        publicId: device.publicId,
        screen: block.screen,
      }, now);
      if (flow) out.push(flow);
    }
  }

  return out
    .sort((a, b) => b.timestamp - a.timestamp || a.id.localeCompare(b.id))
    .slice(0, Math.max(0, input.max ?? MAX_RECONSTRUCTED_FLOWS));
}

export type ReconstructedLogEvent = {
  id: string;
  type: "PRESENCE" | "FRAME_SENT";
  ts: number;
  screen?: string;
  deviceRef?: string;
  blockIndex?: number;
  workTitle?: string;
  message: string;
};

/** Les flux reconstitués sous forme de lignes de journal (terminal de la page Réseau) : mêmes identifiants stables, toujours marquées d'un astérisque. */
export function reconstructedLogEvents(flows: readonly ObservedFlow[]): ReconstructedLogEvent[] {
  const out: ReconstructedLogEvent[] = [];
  for (const flow of flows) {
    if (flow.origin !== "reconstructed" || !flow.publicId) continue;
    if (flow.kind === "pull") {
      out.push({ id: flow.id, type: "PRESENCE", ts: flow.timestamp, deviceRef: flow.publicId, message: `PRESENCE* · ${flow.publicId.slice(0, 12)} · pull/ping reçu` });
    } else if (flow.kind === "frame") {
      out.push({ id: flow.id, type: "FRAME_SENT", ts: flow.timestamp, deviceRef: flow.publicId, screen: flow.screen, workTitle: flow.detail, message: `FRAME* · ${flow.label.replace(/\*$/, "")} → ${flow.publicId.slice(0, 12)}` });
    }
  }
  return out.sort((a, b) => a.ts - b.ts);
}

