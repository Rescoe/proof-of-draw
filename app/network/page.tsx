import { getNetworkSnapshot } from "@/lib/networkSnapshot";
import { NetworkMap } from "./NetworkMap";

export default async function NetworkPage() {
  const snapshot = await getNetworkSnapshot();
  return <NetworkMap snapshot={snapshot} />;
}