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

/**
 * Firmware minimal par écran pour comprendre `anim` dans /api/pull = écran qui possède une lecture d'animation FONCTIONNELLE.
 * La version vient de l'appareil lui-même (champ `firmware` de /api/register, renvoyé à chaque démarrage) : c'est la seule source de vérité.
 *   tft28   R4 + TFT 2.8"        r4tft28-2.4    clip rangé sur la microSD
 *   tft18   ESP8266 + TFT 1.8"   tft18-2.2      clip rangé en flash (LittleFS) ou retéléchargé
 *   oled096 ESP8266 + OLED       multiscreen-2.2 idem (carte e-ink 2.7" + OLED)
 * Un écran dont le firmware est plus ancien, ou inconnu, ne reçoit JAMAIS d'animation (ni l'affiche, ni conversion) : voir validation-result.
 */
export const ANIM_POINTER_FIRMWARE: Record<string, { prefix: string; min: [number, number] }> = {
  tft28: { prefix: "r4tft28", min: [2, 4] },
  tft18: { prefix: "tft18", min: [2, 2] },
  oled096: { prefix: "multiscreen", min: [2, 2] },
};

/** Cet appareil sait-il jouer une animation sur CET écran ? */
export function animCapable(device: { screens?: readonly string[]; firmware?: string | null } | null | undefined, screen: string): boolean {
  return !!device && !!device.screens?.includes(screen) && supportsAnimPointer([screen], device.firmware);
}

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

/** Pointeur d'un bloc d'animation (pour le réafficher depuis la galerie) ; null si le bloc n'est pas une animation. */
export function animPointerOfBlock(block: { blockHash: string; kind?: string; anim?: { bytes: number; frames: number } | null }): AnimPointer | null {
  if (block.kind !== "animation" || !block.anim) return null;
  return readAnimPointer({ anim: { hash: block.blockHash, bytes: block.anim.bytes, frames: block.anim.frames } });
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
