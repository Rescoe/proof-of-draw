// lib/networkSnapshot.ts
// Les types d'écrans disponibles sont définis dans lib/screenProfiles.ts.
// Ajouter un écran ici = uniquement dans screenProfiles.ts.

import { ONLINE_MS } from "@/lib/pullBudget";
import { unstable_cache, revalidateTag } from "next/cache";
import { redis } from "@/lib/redis";
import { SCREEN_IDS, SCREEN_PROFILES, ScreenId } from "@/lib/screenProfiles";
import { readShownRecords, type DisplayKV } from "@/lib/displayState";
import { animCapable } from "@/lib/anim/pointer";
import { publicDeviceId } from "@/lib/network/publicId";
import { hardwareOfFirmware, type Hardware } from "@/lib/network/hardware";

// Ré-exporté pour compatibilité avec les composants qui importent ScreenType
export type ScreenType = ScreenId;

export type DeviceRecord = {
  deviceId: string;
  mac?: string;
  screens: string[];
  firmware: string;
  artistName?: string;
  artistId?: string;
  sceneCapability?: { sceneV1?: boolean };
  pairCode?: string;
  lastSeen: number;
  lastPing: number;
  framesSent: number;
  createdAt: number;
};

type RawFrame = {
  payload?: {
    screen?: string;
    black?: string;
    red?: string;
    buffer?: string;
  };

  frameId?: string;
  createdAt?: number;
  sourceDeviceId?: string;
};

export type NetworkPreview = {
  mode: "mono" | "bwr" | "none";
  black?: string;
  red?: string;
  buffer?: string;
};

export type NetworkFrame = {
  frameId: string;
  createdAt: number;
  ageSec: number;
  sourceDeviceId?: string;
  targetScreen?: string;
  preview: NetworkPreview;
};

export type DeviceScreenInfo = {
  screen: string;
  label: string;
  description: string;
};

export type NetworkDevice = {
  deviceId: string;
  /** Identifiant PUBLIC stable (HMAC du deviceId) : relie un événement à un noeud sans révéler l'identifiant des firmwares. */
  publicId: string;
  artistName?: string;
  /**
   * Clé de regroupement STABLE d'un artiste : `a:<artistId>` (profil), sinon `n:<nom normalisé>`, sinon `unassigned`.
   * Deux artistes homonymes ont deux clés différentes dès qu'ils ont un profil ; ne jamais regrouper par nom seul quand `a:` existe.
   */
  artistKey: string;
  firmware: string;
  /** Famille de carte déduite de la version de firmware déclarée (« unknown » plutôt qu'une supposition). */
  hardware: Hardware;
  /** Capacités déduites de la version de firmware déclarée (lib/anim/pointer.ts). */
  capabilities: { animation: boolean; animationScreens: string[]; scene: boolean };
  /** Types d'écran de l'appareil (= les pools auxquels il appartient). */
  pools: string[];

  // IMPORTANT :
  // un device peut avoir plusieurs écrans
  screens: DeviceScreenInfo[];

  lastSeen: number;
  lastPing: number;
  framesSent: number;
  createdAt: number;

  isOnline: boolean;

  recentFrame: NetworkFrame | null;
};

export type NetworkScreenPool = {
  screen: string;
  label: string;
  description: string;

  // nombre d'écrans
  count: number;

  // nombre de devices distincts
  devicesCount: number;

  online: number;

  devices: NetworkDevice[];
};

export type NetworkSnapshot = {
  generatedAt: number;
  generatedAtIso: string;

  totals: {
    devices: number;
    screens: number;
    online: number;
    offline: number;
    framesWaiting: number;
    screenTypes: number;
  };

  // devices uniques
  devices: NetworkDevice[];

  // pools écran
  screens: NetworkScreenPool[];
};

const ONLINE_WINDOW_MS = ONLINE_MS;   // lib/pullBudget.ts : une seule définition de « en ligne »

// 300 s (3 600 avant le 05/10/2026, sans aucune invalidation : « en ligne » et nouveaux appareils pouvaient avoir 1 h de retard).
// Invalidé en plus par invalidateNetworkSnapshot() à l'enregistrement d'un appareil et au minage d'un bloc.
const NETWORK_CACHE_SECONDS = 300;
export const NETWORK_SNAPSHOT_TAG = "network-snapshot";

/** À appeler quand le réseau change (enregistrement d'un appareil, bloc miné). Ne lève jamais. */
export function invalidateNetworkSnapshot(): void {
  try { revalidateTag(NETWORK_SNAPSHOT_TAG, { expire: 0 }); } catch { /* hors contexte de requête : le TTL de repli suffit */ }
}

/** Fabrique le NetworkDevice public depuis la fiche appareil (pur : aucun accès Redis) — partagé avec les fixtures de test. */
export function toNetworkDevice(
  device: DeviceRecord,
  recentFrame: NetworkFrame | null,
  now: number = Date.now(),
): NetworkDevice {
  const screens = Array.isArray(device.screens) ? device.screens : [];
  const animationScreens = screens.filter((s) => animCapable({ screens, firmware: device.firmware }, s));
  const name = device.artistName?.trim();
  return {
    deviceId:   device.deviceId,
    publicId:   publicDeviceId(device.deviceId),
    artistName: device.artistName,
    artistKey:  device.artistId ? `a:${device.artistId}` : name ? `n:${name.toLocaleLowerCase("fr")}` : "unassigned",
    firmware:   device.firmware,
    hardware:   hardwareOfFirmware(device.firmware),
    capabilities: { animation: animationScreens.length > 0, animationScreens, scene: device.sceneCapability?.sceneV1 === true },
    pools:      [...screens],
    screens:    screens.map((screen) => {
      const meta = getScreenMeta(screen);
      return { screen, label: meta.label, description: meta.description };
    }),
    lastSeen:   device.lastSeen ?? 0,
    lastPing:   device.lastPing ?? 0,
    framesSent: device.framesSent ?? 0,
    createdAt:  device.createdAt ?? 0,
    isOnline:   Math.max(device.lastSeen || 0, device.lastPing || 0) > 0 && now - Math.max(device.lastSeen || 0, device.lastPing || 0) <= ONLINE_WINDOW_MS,
    recentFrame,
  };
}

// Métadonnées d’écran dérivées de screenProfiles — pas de liste hardcodée ici
function getScreenMeta(screen: string): { label: string; description: string } {
  const profile = SCREEN_PROFILES[screen as ScreenId];
  if (profile) {
    return { label: profile.name, description: profile.description };
  }
  // Écran inconnu du registre (firmware non mis à jour, etc.) — fallback gracieux
  return {
    label: screen,
    description: "Type d’écran enregistré dans Redis",
  };
}

/** Assemble le snapshot public depuis la liste des appareils (tri, pools par écran, totaux) — pur, partagé avec les fixtures de test. */
export function assembleNetworkSnapshot(devices: NetworkDevice[], framesWaiting: number): NetworkSnapshot {
  devices.sort((a, b) => {
    const aa = Math.max(
      a.lastSeen,
      a.lastPing
    );

    const bb = Math.max(
      b.lastSeen,
      b.lastPing
    );

    return bb - aa;
  });

  /*
    ==========================================
    STEP 3
    reconstruire les pools écran
    ==========================================
  */

  const screenPools: NetworkScreenPool[] =
    SCREEN_IDS.map((screen) => {
      const meta =
        getScreenMeta(screen);

      const poolDevices =
        devices.filter((device) =>
          device.screens.some(
            (s) => s.screen === screen
          )
        );

      return {
        screen,

        label: meta.label,

        description:
          meta.description,

        // nombre total d'écrans
        count: poolDevices.length,

        // devices distincts
        devicesCount:
          poolDevices.length,

        online:
          poolDevices.filter(
            (d) => d.isOnline
          ).length,

        devices: poolDevices,
      };
    });

  /*
    ==========================================
    STEP 4
    statistiques globales
    ==========================================
  */

  const online =
    devices.filter(
      (d) => d.isOnline
    ).length;

  const totalScreens =
    devices.reduce(
      (acc, device) =>
        acc + device.screens.length,
      0
    );

  const generatedAt = Date.now();

  return {
    generatedAt,

    generatedAtIso:
      new Date(
        generatedAt
      ).toISOString(),

    totals: {
      // DEVICES UNIQUES
      devices: devices.length,

      // ECRANS TOTAUX
      screens: totalScreens,

      online,

      offline:
        devices.length - online,

      framesWaiting,

      screenTypes:
        SCREEN_IDS.length,
    },

    devices,

    screens: screenPools,
  };
}

async function buildNetworkSnapshot(): Promise<NetworkSnapshot> {

  /*
    ==========================================
    STEP 1
    récupérer TOUS les devices uniques
    ==========================================
  */

  const poolResults =
    await Promise.all(
      SCREEN_IDS.map(
        async (screen) => {
          const ids =
            await redis.smembers<
              string[]
            >(
              `pool:screen:${screen}`
            );

          return {
            screen,
            ids:
              ids?.filter(Boolean) ??
              [],
          };
        }
      )
    );

  const allDeviceIds = [
    ...new Set(
      poolResults.flatMap(
        (p) => p.ids
      )
    ),
  ];

  /*
    ==========================================
    STEP 2
    charger devices uniques — batch mget (Axe 6 optimization)
    2 mget au lieu de N*2 redis.get individuels
    ==========================================
  */

  let devices: NetworkDevice[] = [];
  let framesWaiting = 0;

  if (allDeviceIds.length > 0) {
    const deviceKeys = allDeviceIds.map((id) => `device:${id}`);

    const deviceRaws = await redis.mget<(DeviceRecord | null)[]>(...deviceKeys);
    const parsedDevices: (DeviceRecord | null)[] = deviceRaws.map((raw) =>
      raw ? (typeof raw === "string" ? JSON.parse(raw) : raw) : null
    );

    const pairs: { deviceId: string; screen: string }[] = [];
    parsedDevices.forEach((device, i) => {
      if (!device) return;
      const screens = Array.isArray(device.screens) ? device.screens : [];
      for (const screen of screens) pairs.push({ deviceId: allDeviceIds[i], screen });
    });

    // ─ Ce que chaque écran AFFICHE réellement (ACK), en MÉTADONNÉES seulement (~300 o par écran) : 1 MGET.
    //   Avant le 05/10/2026 on relisait ici les frames EN ATTENTE avec leurs buffers d'image (jusqu'à 205 Ko chacune) et on les embarquait dans la
    //   page : 931 Ko de base64 sur 1,07 Mo de HTML pour une vitrine qui n'affichait aucune vignette. Les images se chargent désormais à la demande
    //   (/api/network/display-image, immuable, mise en cache).
    // ─ Nombre de frames en attente : 1 EXISTS (un compte, aucun payload).
    const [shown, waiting] = await Promise.all([
      readShownRecords(redis as unknown as DisplayKV, pairs),
      pairs.length > 0 ? redis.exists(...pairs.map(({ deviceId, screen }) => `frame:${deviceId}:${screen}`)) : Promise.resolve(0),
    ]);
    framesWaiting = Number(waiting) || 0;

    const now = Date.now();
    for (let i = 0; i < allDeviceIds.length; i++) {
      const device = parsedDevices[i];
      if (!device) continue;

      // Dernier affichage CONFIRMÉ de l'appareil (hors frame personnelle : jamais décrite publiquement)
      let recent: NetworkFrame | null = null;
      for (const rec of Object.values(shown[device.deviceId] ?? {})) {
        if (rec.kind === "personal") continue;
        if (!recent || rec.shownAt > recent.createdAt) {
          recent = {
            frameId: rec.frameId,
            createdAt: rec.shownAt,
            ageSec: Math.max(0, Math.floor((now - rec.shownAt) / 1000)),
            sourceDeviceId: rec.kind === "ana" ? "ana-bridge" : "consensus",
            targetScreen: rec.screen,
            preview: { mode: "none" },   // JAMAIS de buffer ici : les images passent par /api/network/display-image
          };
        }
      }
      devices.push(toNetworkDevice(device, recent, now));
    }
  }

  return assembleNetworkSnapshot(devices, framesWaiting);
}

/*
  ==========================================
  CACHE PARTAGÉ GLOBAL
  ==========================================

  Snapshot mutualisé entre tous les visiteurs
  pour éviter les lectures Redis répétées.

  Tous les utilisateurs reçoivent la même
  vue réseau pendant la fenêtre TTL.
*/

export const getNetworkSnapshot =
  unstable_cache(
    buildNetworkSnapshot,
    ["network-snapshot"],
    {
      revalidate:
        NETWORK_CACHE_SECONDS,

      tags: [
        NETWORK_SNAPSHOT_TAG,
      ],
    }
  );

export const NETWORK_CACHE_TTL_SECONDS =
  NETWORK_CACHE_SECONDS;