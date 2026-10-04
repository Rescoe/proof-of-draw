// lib/anim/pointer.ts — pointeur d'ANIMATION dans /api/pull (pur, sans Redis).
//
// Principe : une animation validée est un bloc dont le clip vit dans `chain:anim:{blockHash}`. Au lieu de faire interroger le serveur toutes les 3 s
// (mode banc d'essai : ≈ 200 commandes Redis par écran et par animation), le pull annonce UNE FOIS un petit pointeur ; l'écran télécharge le clip
// (/api/block-clip, immuable, mis en cache par le CDN), le range sur sa carte microSD et le joue EN BOUCLE sans plus rien demander au serveur.
// Seuls les écrans dont le firmware sait faire ça reçoivent le pointeur : les autres obtiennent exactement la même réponse qu'avant.

export interface AnimPointer {
  hash: string;     // hash du bloc (64 hex) : /api/block-clip?hash=…
  bytes: number;    // taille du clip (≤ 9216)
  frames: number;
}

/** Firmware minimal par écran pour comprendre `anim` dans /api/pull. tft28 : lecteur sur microSD (r4tft28-2.4). */
export const ANIM_POINTER_FIRMWARE: Record<string, { prefix: string; min: [number, number] }> = {
  tft28: { prefix: "r4tft28", min: [2, 4] },
};

export function supportsAnimPointer(screens: readonly string[] | undefined | null, firmware: string | null | undefined): boolean {
  if (!screens || !firmware) return false;
  for (const s of screens) {
    const req = ANIM_POINTER_FIRMWARE[s];
    if (!req) continue;
    const m = new RegExp(`^${req.prefix}-(\\d+)\\.(\\d+)`).exec(firmware);
    if (m && (Number(m[1]) > req.min[0] || (Number(m[1]) === req.min[0] && Number(m[2]) >= req.min[1]))) return true;
  }
  return false;
}

/** Pointeur porté par la frame de livraison (écrit au minage), ou null. Strictement validé. */
export function readAnimPointer(payload: Record<string, unknown> | null | undefined): AnimPointer | null {
  const p = payload?.anim;
  if (!p || typeof p !== "object" || Array.isArray(p)) return null;
  const a = p as Record<string, unknown>;
  if (typeof a.hash !== "string" || !/^[a-f0-9]{64}$/.test(a.hash)) return null;
  if (!Number.isSafeInteger(a.bytes) || !Number.isSafeInteger(a.frames)) return null;
  return { hash: a.hash, bytes: a.bytes as number, frames: a.frames as number };
}

/** Retire le pointeur d'un payload : le JSON léger de /api/pull ne doit JAMAIS grossir pour un firmware qui ne le demande pas. */
export function withoutAnimPointer(meta: Record<string, unknown>): Record<string, unknown> {
  const { anim: _anim, ...rest } = meta;
  void _anim;
  return rest;
}

/** Bloc `anim` de la réponse /api/pull : seulement pour un écran capable ET une frame qui porte un pointeur. */
export function animPullMeta(
  device: { screens?: string[]; firmware?: string },
  screen: string | null | undefined,
  payload: Record<string, unknown> | null | undefined,
): AnimPointer | undefined {
  if (!screen || !device.screens?.includes(screen) || !supportsAnimPointer([screen], device.firmware)) return undefined;
  return readAnimPointer(payload) ?? undefined;
}
