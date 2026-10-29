// app/NetworkArtists.tsx — « Artistes du réseau » (accueil, UX jalon 2) : UNE seule section qui fusionne « actifs maintenant » (dérivés du snapshot déjà chargé pour la carte : aucune lecture de plus)
// et « nouveaux artistes » (les 10 profils les plus récents, mêmes lectures qu'avant). Bornée à 6 cartes par vue, lien vers l'annuaire complet.
import type { NetworkSnapshot } from "@/lib/networkSnapshot";
import { networkArtists } from "@/lib/networkArtists";
import { getRecentArtistSummaries } from "./RecentArtists";
import { NetworkArtistsClient } from "./NetworkArtistsClient";

export const NETWORK_ARTISTS_MAX = 6;

export async function NetworkArtists({ snapshot }: { snapshot: NetworkSnapshot | null }) {
  const summary = snapshot ? networkArtists(snapshot.devices, NETWORK_ARTISTS_MAX) : null;
  const recent = (await getRecentArtistSummaries()).slice(0, NETWORK_ARTISTS_MAX);
  if (!summary?.active.length && recent.length === 0) return null;
  return <NetworkArtistsClient summary={summary} recent={recent} />;
}
