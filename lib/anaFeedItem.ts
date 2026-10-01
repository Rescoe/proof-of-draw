// lib/anaFeedItem.ts
// Lecture tolérante d'un item du feed ANA (contrat d'échange ANA ↔ PoD, schémas V1 historique et V2).
// Fonction pure (aucune I/O) : valide, normalise et décode l'image ; testée dans tests/anaFeedItem.test.ts.
//
//   V1  : { id, kind: "celebration"|"spontaneous", pixels, canvasW, canvasH, title, agentTokenId, … }
//   V2  : même chose + schemaVersion 2, sourceId, revision, contentHash, agentImageUrl, media{…}
//         + kinds "poem" (text/display/language), "generative-capture" (capture{rgba8888|gray8}),
//           "generative-scene" (scene-v1 : non pris en charge, voir docs/ECHANGES_ANA_POD_AVANCEMENT.md).

const MAX_PIXELS = 2_000_000;       // garde-fou : ~1400×1400
const MAX_TEXT   = 20_000;

export type ParsedKind = "celebration" | "spontaneous" | "poem" | "generative-capture";

export interface ParsedItem {
  id:           string;
  sourceId:     string;
  kind:         ParsedKind;
  title:        string;
  publishedAt:  number;
  agentTokenId: number;
  agentName?:   string;
  contentHash?: string;
  context:      Record<string, unknown>;   // cartel, brief, vote… (recopié tel quel dans AnaWorkMeta)
  image?:       { gray: Uint8Array; w: number; h: number };            // dessins et captures
  poem?:        { text: string; displayText?: string; artForm: string; language?: string };
}

export type ParseResult =
  | { ok: true; item: ParsedItem }
  | { ok: false; reason: string; permanent: boolean };   // permanent = item invalide (ne pas réessayer)

const CONTEXT_KEYS = [
  "cartelText", "brief", "proposal", "memorialKind", "burnedTokenIds", "totalBurnedHonored",
  "voteResult", "yesCount", "noCount", "absCount", "revisionCount", "onChainWorkId", "txHash",
  "collectionAddress", "decisionNote",
] as const;

const str = (v: unknown) => (typeof v === "string" ? v : undefined);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
const rec = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

function b64(s: unknown): Uint8Array | null {
  if (typeof s !== "string" || !s) return null;
  try { return new Uint8Array(Buffer.from(s, "base64")); } catch { return null; }
}

/** RGBA 8 bits → gris, l'alpha étant composé sur fond blanc. */
export function rgbaToGray(rgba: Uint8Array, w: number, h: number): Uint8Array {
  const g = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const a = rgba[i * 4 + 3] / 255;
    const r = rgba[i * 4] * a + 255 * (1 - a), gg = rgba[i * 4 + 1] * a + 255 * (1 - a), b = rgba[i * 4 + 2] * a + 255 * (1 - a);
    g[i] = (r * 77 + gg * 150 + b * 29) / 256;
  }
  return g;
}

export function parseFeedItem(raw: unknown): ParseResult {
  const r = rec(raw);
  if (!r) return { ok: false, reason: "item non objet", permanent: true };
  const id = str(r.id);
  if (!id) return { ok: false, reason: "id manquant", permanent: true };
  const bad = (reason: string, permanent = true): ParseResult => ({ ok: false, reason: `${id}: ${reason}`, permanent });

  const kind = str(r.kind);
  if (kind === "generative-scene") return bad("scene-v1 non pris en charge (prototype matériel requis)", false);
  if (kind !== "celebration" && kind !== "spontaneous" && kind !== "poem" && kind !== "generative-capture") {
    return bad(`kind inconnu « ${kind} »`, false);   // peut devenir valide dans une version ultérieure de PoD
  }
  const agentTokenId = num(r.agentTokenId);
  if (agentTokenId === undefined) return bad("agentTokenId manquant");

  const item: ParsedItem = {
    id, sourceId: str(r.sourceId) ?? id, kind,
    title: (str(r.title) ?? "Sans titre").slice(0, 200),
    publishedAt: num(r.publishedAt) ?? 0,
    agentTokenId, agentName: str(r.agentName),
    contentHash: str(r.contentHash),
    context: {},
  };
  for (const k of CONTEXT_KEYS) if (r[k] !== undefined) item.context[k] = r[k];

  if (kind === "celebration" || kind === "spontaneous") {
    const media = rec(r.media);
    const pixels = b64(media?.pixels ?? r.pixels);
    const w = num(media?.canvasW ?? r.canvasW), h = num(media?.canvasH ?? r.canvasH);
    if (!pixels || !w || !h) return bad("pixels / dimensions manquants");
    if (w * h > MAX_PIXELS || pixels.length !== w * h) return bad(`pixels ${pixels.length} octets ≠ ${w}×${h}`);
    item.image = { gray: pixels, w, h };
    return { ok: true, item };
  }

  if (kind === "poem") {
    const text = (str(r.text) ?? "").normalize("NFC");
    if (!text.trim()) return bad("poème sans texte");
    if (text.length > MAX_TEXT) return bad("poème trop long");
    const display = rec(r.display);
    const displayText = display?.mode === "excerpt" ? str(display.text)?.normalize("NFC") : undefined;
    item.poem = { text, displayText: displayText?.trim() ? displayText : undefined, artForm: str(r.artForm) ?? "poem", language: str(r.language) };
    return { ok: true, item };
  }

  // generative-capture
  const cap = rec(r.capture);
  if (!cap) return bad("capture manquante");
  const w = num(cap.width), h = num(cap.height), enc = str(cap.pixelEncoding), data = b64(cap.pixels);
  if (!w || !h || !data || w * h > MAX_PIXELS) return bad("capture invalide");
  if (enc === "rgba8888") {
    if (data.length !== w * h * 4) return bad(`capture RGBA ${data.length} octets ≠ ${w}×${h}×4`);
    item.image = { gray: rgbaToGray(data, w, h), w, h };
  } else if (enc === "gray8") {
    if (data.length !== w * h) return bad(`capture gray8 ${data.length} octets ≠ ${w}×${h}`);
    item.image = { gray: data, w, h };
  } else return bad(`pixelEncoding « ${enc} » non pris en charge`);
  return { ok: true, item };
}
