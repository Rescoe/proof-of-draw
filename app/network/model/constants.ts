// Constantes partagées par les variantes home/full du graphe réseau.
// Ce module est volontairement pur : aucune API navigateur, aucun React.

export const CORE_NODE_ID = "core";

export const CLUSTER_ARTIST_THRESHOLD = 12;
export const CLUSTER_MAX_DEPTH = 6;

export const FLOW_ACTIVE_MS = 5 * 60_000;
export const FLOW_FADE_MS = 30_000;
export const FLOW_PULSE_PERIOD_MS = 4_000;
export const MAX_VISIBLE_FLOWS = 24;

export const SCREEN_COLOR: Readonly<Record<string, string>> = {
  eink29bwr: "#f87171",
  eink27bw: "#94a3b8",
  oled096: "#60a5fa",
  tft18: "#fbbf24",
  tft28: "#2dd4bf",
};

export const HARDWARE_COLOR = {
  "esp8266": "#60a5fa",
  "uno-r4": "#e879f9",
  unknown: "#94a3b8",
} as const;

export const GRAPH_GEOMETRY = {
  // La carte privilégie volontairement l'espace vide. Les coordonnées restent
  // déterministes, mais un grand réseau ne se transforme plus en « pelote ».
  minWorldSize: 2_100,
  worldSizePerArtist: 305,
  artistMinGap: 190,
  artistRadius: 54,
  deviceRadius: 30,
  screenRadius: 15,
  deviceOrbit: 112,
  deviceRingGap: 82,
  screenOrbit: 58,
} as const;

/**
 * Petit réseau (≤ 12 artistes, donc sans zones de navigation) : tout tient dans la vue, on peut donc se permettre de l'espace.
 * Les orbites sont plus larges (l'appareil ne colle plus à la bulle de l'artiste, l'écran ne colle plus à l'appareil) et les nœuds sont dessinés `nodeScale` fois plus gros
 * pour rester lisibles quand tout le réseau est cadré. Les coordonnées restent déterministes (clés stables) : seule l'échelle de dessin change.
 */
export const SPACIOUS_GEOMETRY = {
  deviceOrbit: 330,
  deviceRingGap: 150,
  screenOrbit: 150,
  nodeScale: 1.8,
} as const;

export const ZOOM_LEVEL = {
  clusters: 0.34,
  artists: 0.52,
  devices: 0.82,
  screens: 1.28,
  thumbnails: 1.7,
} as const;
