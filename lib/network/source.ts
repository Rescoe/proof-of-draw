// lib/network/source.ts — source des données de la vue réseau : réelle (Redis, mise en cache) ou, en DÉVELOPPEMENT SEULEMENT, synthétique.
//
//   const snapshot = await getNetworkSnapshotFor(searchParams.fixture);   // page serveur (app/page.tsx, app/network/page.tsx)
//
// Hors production et avec ?fixture=<n> : jeu synthétique déterministe (lib/network/fixtures.ts), AUCUNE lecture Redis. En production, le paramètre est ignoré.

import { getNetworkSnapshot, type NetworkSnapshot } from "@/lib/networkSnapshot";
import { buildFixtureSnapshot, fixtureCount } from "@/lib/network/fixtures";

export async function getNetworkSnapshotFor(fixture: string | string[] | null | undefined): Promise<NetworkSnapshot> {
  const n = fixtureCount(Array.isArray(fixture) ? fixture[0] : fixture);
  return n !== null ? buildFixtureSnapshot(n) : getNetworkSnapshot();
}
