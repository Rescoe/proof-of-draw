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
export const ANIM_POINTER_FIRMWARE: Record<string, { prefix: string; min: [number, number]; alt?: ReadonlyArray<{ prefix: string; min: [number, number] }> }> = {
  tft28: { prefix: "r4tft28", min: [2, 4] },
  // r4tft18-2.3 : UNO R4 WiFi + TFT 1,8″ (clip PBC1 sur la microSD, lecture en flux — arduino_uno_r4/pod_uno_r4_tft18_env)
  tft18: { prefix: "tft18", min: [2, 2], alt: [{ prefix: "r4tft18", min: [2, 3] }] },
  oled096: { prefix: "multiscreen", min: [2, 2], alt: [{ prefix: "multibwr", min: [2, 1] }] },   // multibwr : e-ink BWR 2,9″ + OLED (clip en flash brute)
};

/**
 * OLED AUXILIAIRE d'un e-ink BWR 2,9″ (29/10/2026) : la carte garde UN seul écran déclaré (`eink29bwr`) — pas de seconde file d'écran, pas de seconde frame, pas de second ACK. Une animation lui livre
 * l'affiche BWR habituelle ET le pointeur du clip, que l'OLED joue en boucle. Trois conditions CUMULATIVES : écran eink29bwr, capacité DÉCLARÉE « anim-oled » (firmware compilé avec l'OLED), firmware
 * eink29bwr-2.13 ou plus (le premier qui sache lire le clip). Une carte BWR sans OLED, ou plus ancienne, ne reçoit jamais le pointeur : sa réponse /api/pull est inchangée.
 */
export const ANIM_OLED_AUX_FIRMWARE = { prefix: "eink29bwr", min: [2, 13] as [number, number] };
export function animOledAuxCapable(device: { screens?: readonly string[] | null; firmware?: string | null; caps?: readonly string[] | null } | null | undefined): boolean {
  if (!device || !device.firmware || !device.screens?.includes("eink29bwr") || !device.caps?.includes("anim-oled")) return false;
  const m = new RegExp(`^${ANIM_OLED_AUX_FIRMWARE.prefix}-(\\d+)\\.(\\d+)`).exec(device.firmware);
  return !!m && (Number(m[1]) > ANIM_OLED_AUX_FIRMWARE.min[0] || (Number(m[1]) === ANIM_OLED_AUX_FIRMWARE.min[0] && Number(m[2]) >= ANIM_OLED_AUX_FIRMWARE.min[1]));
}

/** Cet appareil sait-il jouer une animation sur CET écran ? */
export function animCapable(device: { screens?: readonly string[]; firmware?: string | null } | null | undefined, screen: string): boolean {
  return !!device && !!device.screens?.includes(screen) && supportsAnimPointer([screen], device.firmware);
}

export function supportsAnimPointer(screens: readonly string[] | undefined | null, firmware: string | null | undefined): boolean {
  if (!screens || !firmware) return false;
  for (const s of screens) {
    const req = ANIM_POINTER_FIRMWARE[s];
    if (!req) continue;
    for (const r of [req, ...(req.alt ?? [])]) {
      const m = new RegExp(`^${r.prefix}-(\\d+)\\.(\\d+)`).exec(firmware);
      if (m && (Number(m[1]) > r.min[0] || (Number(m[1]) === r.min[0] && Number(m[2]) >= r.min[1]))) return true;
    }
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
  device: { screens?: string[]; firmware?: string; caps?: readonly string[] },
  screen: string | null | undefined,
  payload: Record<string, unknown> | null | undefined,
  head?: { blockHash: string; kind?: string; anim?: { bytes: number; frames: number } | null } | null,
): AnimPointer | undefined {
  // OLED auxiliaire d'un e-ink BWR (voir plus haut). LIVRAISON PAR POINTEUR SEUL (29/10/2026) : le serveur n'envoie plus d'affiche à l'e-ink ; quand la carte n'a AUCUNE frame en attente et que le dernier bloc de la
  // chaîne est une animation, le pull annonce le pointeur de ce bloc (0 commande Redis : la tête de chaîne est déjà lue). Une frame en attente SANS pointeur (nouvelle image fixe) = pas d'animation. Une ancienne frame
  // qui porte encore un pointeur (livraison d'avant ce changement) reste honorée.
  if (screen === "eink29bwr" || (screen == null && animOledAuxCapable(device))) {
    if (!animOledAuxCapable(device)) return undefined;
    if (screen === "eink29bwr") return readAnimPointer(payload) ?? undefined;
    return head ? animPointerOfBlock(head) ?? undefined : undefined;
  }
  if (!screen || !device.screens?.includes(screen) || !supportsAnimPointer([screen], device.firmware)) return undefined;
  return readAnimPointer(payload) ?? undefined;
}
