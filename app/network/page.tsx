import { getNetworkSnapshotFor } from "@/lib/network/source";
import { NetworkMap } from "./NetworkMap";

export default async function NetworkPage({ searchParams }: { searchParams: Promise<{ fixture?: string | string[] }> }) {
  const params = await searchParams;
  const fixture = Array.isArray(params.fixture) ? params.fixture[0] : params.fixture;
  const snapshot = await getNetworkSnapshotFor(fixture);
  return <NetworkMap snapshot={snapshot} fixture={fixture} />;
}
