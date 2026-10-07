// lib/displayState.ts
// « Ce que chaque écran affiche réellement » — distinct du dernier bloc miné/validé et de la frame en attente
// (frame:{device}:{écran}, supprimée à l'ACK). Source de vérité : l'ACK du firmware, envoyé APRÈS l'affichage.
//
// Stockage (clés TTL 30 j) :
//   shown:{deviceId}:{écran}      méta légère (~300 o) — ce qui est affiché là, quand, de qui
//   shown:img:{frameId}:{écran}   buffers de la frame, écrits UNE fois (SET NX) et partagés par tous les appareils
//                                 qui reçoivent le même frameId (pool de validation, diffusion ANA)
// Lecture publique : 1 MGET pour tout le réseau, mis en cache côté serveur et invalidé par chaque ACK (jamais par visiteur).
// Confidentialité : une frame PERSONNELLE (dessin envoyé par le propriétaire à son seul ESP) n'est jamais copiée ni
// décrite publiquement — la carte affiche seulement « affichage privé ».

export type DisplayKind = "human" | "ana" | "personal";

/**
 * RAPPORT DE RENDU (lot 7.5, D9) — « rapport NON AUTHENTIFIÉ reçu avec l'ACK » : l'ACK n'est pas signé, n'importe qui connaissant un `deviceId` peut en forger un ; il n'a donc aucune valeur de preuve.
 * Trois niveaux de hash (docs/SPEC_LOT_7_CARTELS_RENDU_2026_10_07.md § 4) : `artworkHash` = identité canonique de l'œuvre fournie par le serveur (`contentHash` du bloc) ; `frameHash` = buffer EXACT reçu
 * avant mise en page ; `renderHash` = buffer logique FINAL envoyé au pilote après fit/cartel (pas une preuve des pixels physiques). `layoutVersion` = version de TOUT le rasteriseur ; `cartelMode` = réglage appliqué.
 * JAMAIS voté, JAMAIS vérifié par le serveur, JAMAIS public ; pas de `renderHash` pour une scène animée (clipHash/animRoot). Aucun firmware actuel ne l'envoie (lot 8) : le champ reste absent.
 * Lot 8 : message signé `pod-render-v1` (clé Ed25519 de l'appareil) — alors seulement le rapport sera « authentifié par la clé de l'appareil ».
 */
export interface RenderReport { artworkHash?: string; frameHash?: string; renderHash?: string; layoutVersion?: number; cartelMode?: "overlay" | "fit" | "hidden" }

export interface ShownRecord {
  frameId:     string;
  screen:      string;
  shownAt:     number;
  kind:        DisplayKind;
  workTitle?:  string;
  artistName?: string;
  anaKind?:    string;     // poem | celebration | spontaneous | generative-capture
  blockHash?:  string;     // bloc galerie ANA correspondant
  blockIndex?: number;     // bloc de la chaîne humaine
  mode?:       "frame" | "scene";   // ce que l'appareil a joué (firmware scene-v1 : champ `mode` de l'ACK)
  render?:     RenderReport;        // rapport de rendu de l'appareil (débogage du propriétaire seulement ; jamais exposé publiquement)
  isAnimation?: boolean;            // l'œuvre est une ANIMATION de bloc (le pointeur `anim` accompagnait la frame) : l'écran la joue en boucle
  hasImage:    boolean;
}

/** Version exposée au public : une frame personnelle ne révèle rien d'autre que son existence ; le rapport de rendu (`render`) est EXCLU DU TYPE, pas seulement de la valeur. */
export type PublicShown = Omit<ShownRecord, "frameId" | "render"> & { frameId: string | null };

export interface DisplayKV {
  set(key: string, value: string, opts?: { nx?: boolean; ex?: number }): Promise<unknown>;
  mget(...keys: string[]): Promise<unknown[]>;
  get(key: string): Promise<unknown>;
}

export const SHOWN_TTL_SEC = 30 * 24 * 3600;
/** Tag du cache serveur de la vue « en direct » : invalidé par chaque ACK, jamais par un visiteur. */
export const DISPLAYS_CACHE_TAG = "network-displays";
export const shownKey = (deviceId: string, screen: string) => `shown:${deviceId}:${screen}`;
export const shownImageKey = (frameId: string, screen: string) => `shown:img:${frameId}:${screen}`;
export const FRAME_ID_RE = /^[A-Za-z0-9-]{6,64}$/;

type LooseFrame = { frameId?: string; sourceDeviceId?: string; payload?: Record<string, unknown> };

const str = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);
const int = (v: unknown): number | undefined => (Number.isSafeInteger(v) ? (v as number) : undefined);

/** Lecture STRICTE du rapport de rendu d'un corps d'ACK : champs inconnus ou invalides ignorés (jamais d'erreur : l'ACK doit réussir). `null` si rien d'exploitable. */
export function sanitizeRenderReport(body: unknown, mode?: "frame" | "scene"): RenderReport | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>, out: RenderReport = {};
  const hex = (v: unknown) => (typeof v === "string" && /^[0-9a-f]{64}$/.test(v) ? v : undefined);
  const aw = hex(b.artworkHash), fh = hex(b.frameHash), rh = hex(b.renderHash);
  if (aw) out.artworkHash = aw;
  if (fh) out.frameHash = fh;
  if (rh) out.renderHash = rh;
  if (Number.isSafeInteger(b.layoutVersion) && (b.layoutVersion as number) >= 1 && (b.layoutVersion as number) <= 255) out.layoutVersion = b.layoutVersion as number;
  if (b.cartelMode === "overlay" || b.cartelMode === "fit" || b.cartelMode === "hidden") out.cartelMode = b.cartelMode;
  // une SCÈNE animée n'a pas de rendu unique : ni frameHash ni renderHash (l'animation est identifiée par clipHash / animRoot, déjà engagés dans le bloc)
  if (mode === "scene") { delete out.frameHash; delete out.renderHash; }
  return Object.keys(out).length > 0 ? out : null;
}

export interface ImagePayload { screen: string; black?: string; red?: string; buffer?: string }

/** Buffers de la frame (seuls champs image) — jamais les métadonnées ni le pointeur de scène. */
export function imagePayloadOf(frame: LooseFrame, screen: string): ImagePayload | null {
  const p = frame.payload;
  if (!p) return null;
  const black = str(p.black), red = str(p.red), buffer = str(p.buffer);
  if (!black && !red && !buffer) return null;
  return { screen, ...(black ? { black } : {}), ...(red ? { red } : {}), ...(buffer ? { buffer } : {}) };
}

/**
 * Construit l'enregistrement d'affichage depuis la frame acquittée. `source` : "consensus" = frame de pool (validée ou
 * diffusée par le pont ANA), "personal" = dessin privé du propriétaire.
 */
export function buildShownRecord(
  frame: LooseFrame, screen: string, source: "consensus" | "personal", now: number, mode?: "frame" | "scene", render?: RenderReport | null,
): ShownRecord | null {
  const frameId = str(frame.frameId);
  if (!frameId || !FRAME_ID_RE.test(frameId)) return null;
  if (source === "personal") return { frameId, screen, shownAt: now, kind: "personal", hasImage: false };

  const p = frame.payload ?? {};
  const block = (p._block && typeof p._block === "object" ? p._block : {}) as Record<string, unknown>;
  const kind: DisplayKind = frame.sourceDeviceId === "ana-bridge" ? "ana" : "human";
  return {
    frameId, screen, shownAt: now, kind,
    workTitle:  str(p.workTitle)?.slice(0, 120),
    artistName: (str(p.drawArtistName) ?? str(block.artistName))?.slice(0, 80),
    anaKind:    kind === "ana" ? str(p.anaKind) : undefined,
    // bloc de la galerie : ANA (champ du payload) ou chaîne humaine (`_block.hash`, posé au minage depuis le 05/10/2026)
    blockHash:  kind === "ana"
      ? (/^[0-9a-f]{64}$/.test(String(p.blockHash)) ? String(p.blockHash) : undefined)
      : (/^[0-9a-f]{64}$/.test(String(block.hash)) ? String(block.hash) : undefined),
    ...(p.anim && typeof p.anim === "object" ? { isAnimation: true } : {}),
    blockIndex: int(block.index),
    ...(mode ? { mode } : {}),
    ...(render ? { render } : {}),
    hasImage: imagePayloadOf(frame, screen) !== null,
  };
}

/**
 * Enregistre ce qu'un appareil vient d'afficher : 1 SET (méta) + 1 SET NX (image partagée). Retourne l'enregistrement,
 * ou null si la frame n'est pas exploitable. Ne lève pas : un échec ici ne doit JAMAIS faire échouer l'ACK du firmware.
 */
export async function recordDisplayed(
  kv: DisplayKV, deviceId: string, screen: string, frame: LooseFrame,
  source: "consensus" | "personal", mode?: "frame" | "scene", now = Date.now(), render?: RenderReport | null,
): Promise<ShownRecord | null> {
  try {
    const rec = buildShownRecord(frame, screen, source, now, mode, render);
    if (!rec) return null;
    const writes: Promise<unknown>[] = [kv.set(shownKey(deviceId, screen), JSON.stringify(rec), { ex: SHOWN_TTL_SEC })];
    const img = rec.hasImage ? imagePayloadOf(frame, screen) : null;
    if (img) writes.push(kv.set(shownImageKey(rec.frameId, screen), JSON.stringify(img), { nx: true, ex: SHOWN_TTL_SEC }));
    await Promise.all(writes);
    return rec;
  } catch (e) {
    console.error("[displayState] enregistrement impossible :", e);
    return null;
  }
}

function parseRecord(raw: unknown): ShownRecord | null {
  try {
    const v = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!v || typeof v !== "object") return null;
    const r = v as ShownRecord;
    return typeof r.frameId === "string" && typeof r.shownAt === "number" && typeof r.screen === "string" ? r : null;
  } catch { return null; }
}

export function toPublicShown(rec: ShownRecord): PublicShown {
  if (rec.kind === "personal") return { frameId: null, screen: rec.screen, shownAt: rec.shownAt, kind: "personal", hasImage: false };
  const { render: _render, ...visible } = rec;   // le rapport de rendu n'est jamais public (débogage du propriétaire)
  void _render;
  return visible;
}

/** Enregistrements COMPLETS (vue du propriétaire : debug). Une seule commande MGET pour tous les couples (appareil, écran). */
export async function readShownRecords(
  kv: DisplayKV, pairs: { deviceId: string; screen: string }[],
): Promise<Record<string, Record<string, ShownRecord>>> {
  const out: Record<string, Record<string, ShownRecord>> = {};
  if (pairs.length === 0) return out;
  const raws = await kv.mget(...pairs.map((p) => shownKey(p.deviceId, p.screen)));
  pairs.forEach((p, i) => {
    const rec = parseRecord(raws[i]);
    if (rec) (out[p.deviceId] ??= {})[p.screen] = rec;
  });
  return out;
}

/**
 * Vue PUBLIQUE : uniquement les affichages qui ont une image à montrer. Une frame personnelle (privée) et un écran sans
 * confirmation sont simplement absents — la carte réseau n'affiche que des images.
 */
export async function readShownMap(
  kv: DisplayKV, pairs: { deviceId: string; screen: string }[],
): Promise<Record<string, Record<string, PublicShown>>> {
  const full = await readShownRecords(kv, pairs);
  const out: Record<string, Record<string, PublicShown>> = {};
  for (const [deviceId, screens] of Object.entries(full)) {
    for (const [screen, rec] of Object.entries(screens)) {
      if (rec.kind === "personal" || !rec.hasImage) continue;
      (out[deviceId] ??= {})[screen] = toPublicShown(rec);
    }
  }
  return out;
}

export async function readShownImage(kv: DisplayKV, frameId: string, screen: string): Promise<ImagePayload | null> {
  if (!FRAME_ID_RE.test(frameId)) return null;
  const raw = await kv.get(shownImageKey(frameId, screen));
  try {
    const v = typeof raw === "string" ? JSON.parse(raw) : raw;
    return v && typeof v === "object" && (v as ImagePayload).screen === screen ? (v as ImagePayload) : null;
  } catch { return null; }
}
