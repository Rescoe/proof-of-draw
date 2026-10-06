// lib/deviceMerge.ts — « Ancien ➜ Nouveau » : fusionner un ESP dans un autre (06/10/2026).
//
// Cas d'usage : un écran change de carte (ESP8266 ➜ UNO R4) ou une carte perd son identité (EEPROM effacée au téléversement) : l'app voit un NOUVEL appareil
// (autre MAC ⇒ autre deviceId). La fusion rapatrie en une seule action ce qui compte puis supprime l'ancien :
//   1. propriété des blocs (chain:device:{from}:owned ➜ {to}, bloc par bloc : transferBlockOwnership) ;
//   2. historique « miné » et « dessiné » (listes chain:device:{id}:blocks / :drawn) : ajouté à la fin des listes du nouveau ;
//   3. retrait de l'ancien des pools d'écrans (il ne reçoit ni ne vote plus) ;
//   4. suppression de l'ancien (fiche, MAC, code d'appairage, index) et de son lien de profil.
// Les blocs eux-mêmes sont IMMUABLES (chaîne) : minerDeviceId / deviceId d'origine restent ceux de l'ancien appareil ; seule la PROPRIÉTÉ suit. Irréversible.
//
// COÛT REDIS (opération rare, à la demande) : ≈ 6 commandes par bloc possédé + ~15 fixes. Aucun impact sur le pull ni sur les polls.
import { redis } from "@/lib/redis";
import { getOwnedBlockHashes, transferBlockOwnership } from "@/lib/chain";
import { deleteDevice, getDevice, type Device } from "@/lib/deviceStore";
import { deleteConfirmed } from "@/lib/deviceDeleteGuard";

const DEVICE_ID_REGEX = /^dev_[A-Z0-9]{8}$/;
const HISTORY_MAX = 500;   // même plafond de lecture que relatedBlockHashes()

export type MergePlan =
  | { ok: true }
  | { ok: false; status: number; error: string };

/** Vérifications pures (testées) : identifiants, appareils distincts, même profil, confirmation retapée. */
export function planMerge(
  fromId: unknown, toId: unknown, confirm: unknown,
  from: Pick<Device, "deviceId" | "deviceName" | "artistName" | "artistId"> | null,
  to: Pick<Device, "deviceId" | "artistId"> | null,
): MergePlan {
  if (typeof fromId !== "string" || !DEVICE_ID_REGEX.test(fromId)) return { ok: false, status: 400, error: "fromDeviceId invalide" };
  if (typeof toId !== "string" || !DEVICE_ID_REGEX.test(toId)) return { ok: false, status: 400, error: "toDeviceId invalide" };
  if (fromId === toId) return { ok: false, status: 400, error: "L'ancien et le nouvel appareil sont identiques" };
  if (!from) return { ok: false, status: 404, error: "Ancien appareil introuvable" };
  if (!to) return { ok: false, status: 404, error: "Nouvel appareil introuvable" };
  if (from.artistId && to.artistId && from.artistId !== to.artistId) return { ok: false, status: 409, error: "Les deux appareils doivent appartenir au même profil" };
  if (!to.artistId) return { ok: false, status: 409, error: "Le nouvel appareil n'est pas encore appairé à votre profil : appairez-le d'abord" };
  if (typeof confirm !== "string" || !deleteConfirmed(confirm, { deviceId: from.deviceId, deviceName: from.deviceName, artistName: from.artistName })) {
    return { ok: false, status: 400, error: "Confirmation incorrecte : retapez le nom de l'ancien appareil" };
  }
  return { ok: true };
}

export interface MergeResult {
  blocksTotal: number;
  blocksTransferred: number;
  blocksFailed: string[];
  historyMoved: number;
}

/** Exécute la fusion (l'autorisation et planMerge sont faites par la route). */
export async function mergeDevices(fromId: string, toId: string): Promise<MergeResult> {
  const from = await getDevice(fromId);

  // 1. propriété des blocs
  const hashes = await getOwnedBlockHashes(fromId);
  let transferred = 0;
  const failed: string[] = [];
  for (const h of hashes) {
    const r = await transferBlockOwnership(h, fromId, toId);
    if (r.ok) transferred++; else failed.push(h.slice(0, 12));
  }

  // 2. historique miné / dessiné : les plus anciens vont à la FIN des listes du nouvel appareil (les listes sont alimentées en LPUSH : récent en tête)
  let moved = 0;
  for (const kind of ["blocks", "drawn"] as const) {
    const old = (await redis.lrange<string>(`chain:device:${fromId}:${kind}`, 0, HISTORY_MAX - 1)) ?? [];
    if (old.length > 0) {
      const have = new Set((await redis.lrange<string>(`chain:device:${toId}:${kind}`, 0, HISTORY_MAX - 1)) ?? []);
      const fresh = old.filter((h) => !have.has(h));
      if (fresh.length > 0) { await redis.rpush(`chain:device:${toId}:${kind}`, ...fresh); moved += fresh.length; }
    }
  }

  // 3. pools d'écrans, 4. suppression de l'ancien (fiche, MAC, code, index) et de son lien de profil
  if (from) await Promise.all(from.screens.map((s) => redis.srem(`pool:screen:${s}`, fromId)));
  await redis.del(`artist:device:${fromId}`);
  await deleteDevice(fromId);

  console.log(`[deviceMerge] ${fromId} ➜ ${toId} : blocs ${transferred}/${hashes.length}, historique ${moved}`);
  return { blocksTotal: hashes.length, blocksTransferred: transferred, blocksFailed: failed, historyMoved: moved };
}
