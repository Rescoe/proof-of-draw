// lib/networkSnapshot.ts
// Les types d'écrans disponibles sont définis dans lib/screenProfiles.ts.
// Ajouter un écran ici = uniquement dans screenProfiles.ts.

import { unstable_cache } from "next/cache";
import { redis } from "@/lib/redis";
import { SCREEN_IDS, SCREEN_PROFILES, ScreenId } from "@/lib/screenProfiles";

// Ré-exporté pour compatibilité avec les composants qui importent ScreenType
export type ScreenType = ScreenId;

type DeviceRecord = {
  deviceId: string;
  mac?: string;
  screens: string[];
  firmware: string;
  artistName?: string;
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
  artistName?: string;
  firmware: string;

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

const ONLINE_WINDOW_MS =
  20 * 60 * 1000;

const NETWORK_CACHE_SECONDS = 3600;

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

function isOnline(
  device: Pick<
    DeviceRecord,
    "lastSeen" | "lastPing"
  >
) {
  const lastActivity = Math.max(
    device.lastSeen || 0,
    device.lastPing || 0
  );

  return (
    Date.now() - lastActivity <=
    ONLINE_WINDOW_MS
  );
}

function sanitizeFrame(
  frame: RawFrame | null | undefined
): NetworkFrame | null {
  if (!frame?.frameId || !frame.createdAt) {
    return null;
  }

  const payload = frame.payload ?? {};

  const hasBwr = Boolean(
    payload.black || payload.red
  );

  const hasMono = Boolean(
    payload.buffer
  );

  const preview: NetworkPreview = hasBwr
    ? {
        mode: "bwr",
        black: payload.black,
        red: payload.red,
      }
    : hasMono
      ? {
          mode: "mono",
          buffer: payload.buffer,
        }
      : {
          mode: "none",
        };

  return {
    frameId: frame.frameId,

    createdAt: frame.createdAt,

    ageSec: Math.max(
      0,
      Math.floor(
        (Date.now() - frame.createdAt) /
          1000
      )
    ),

    sourceDeviceId:
      frame.sourceDeviceId,

    targetScreen: payload.screen,

    preview,
  };
}

async function fetchDevice(
  deviceId: string
): Promise<NetworkDevice | null> {
  const [device, frame] =
    await Promise.all([
      redis.get<DeviceRecord>(
        `device:${deviceId}`
      ),

      redis.get<RawFrame>(
        `frame:${deviceId}`
      ),
    ]);

  if (!device) {
    return null;
  }

  const screens = Array.isArray(
    device.screens
  )
    ? device.screens
    : [];

  return {
    deviceId: device.deviceId,

    artistName: device.artistName,

    firmware: device.firmware,

    screens: screens.map((screen) => {
      const meta =
        getScreenMeta(screen);

      return {
        screen,
        label: meta.label,
        description:
          meta.description,
      };
    }),

    lastSeen:
      device.lastSeen ?? 0,

    lastPing:
      device.lastPing ?? 0,

    framesSent:
      device.framesSent ?? 0,

    createdAt:
      device.createdAt ?? 0,

    isOnline: isOnline(device),

    recentFrame:
      sanitizeFrame(frame),
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

  if (allDeviceIds.length > 0) {
    const deviceKeys = allDeviceIds.map((id) => `device:${id}`);
    const frameKeys  = allDeviceIds.map((id) => `frame:${id}`);

    // 2 mget en parallèle au lieu de N*2 get individuels
    const [deviceRaws, frameRaws] = await Promise.all([
      redis.mget<(DeviceRecord | null)[]>(...deviceKeys),
      redis.mget<(RawFrame | null)[]>(...frameKeys),
    ]);

    for (let i = 0; i < allDeviceIds.length; i++) {
      const raw = deviceRaws[i];
      if (!raw) continue;

      const device: DeviceRecord = typeof raw === "string" ? JSON.parse(raw) : raw;
      const frameRaw = frameRaws[i];
      const frame: RawFrame | null = frameRaw
        ? (typeof frameRaw === "string" ? JSON.parse(frameRaw) : frameRaw)
        : null;

      const screens = Array.isArray(device.screens) ? device.screens : [];

      devices.push({
        deviceId:   device.deviceId,
        artistName: device.artistName,
        firmware:   device.firmware,
        screens:    screens.map((screen) => {
          const meta = getScreenMeta(screen);
          return { screen, label: meta.label, description: meta.description };
        }),
        lastSeen:   device.lastSeen ?? 0,
        lastPing:   device.lastPing ?? 0,
        framesSent: device.framesSent ?? 0,
        createdAt:  device.createdAt ?? 0,
        isOnline:   isOnline(device),
        recentFrame: sanitizeFrame(frame),
      });
    }
  }

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

  const framesWaiting =
    devices.filter(
      (d) => Boolean(d.recentFrame)
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
        "network-snapshot",
      ],
    }
  );

export const NETWORK_CACHE_TTL_SECONDS =
  NETWORK_CACHE_SECONDS;