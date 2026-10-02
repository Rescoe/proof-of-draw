"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

const INSTALL_HASHES = new Set([
  "material", "wiring", "arduino-ide", "esp-boards", "libraries", "firmware", "configure", "onboard", "draw",
]);
const NETWORK_HASHES = new Set(["how", "roles", "consensus", "why", "licence"]);

export function LegacyHashRedirect({ hasPath }: { hasPath: boolean }) {
  const router = useRouter();

  useEffect(() => {
    if (hasPath) return;
    const hash = window.location.hash.slice(1);
    if (!hash) return;
    if (INSTALL_HASHES.has(hash)) router.replace(`/learn?path=install#${hash}`);
    else if (hash === "no-esp" || hash === "sans-esp") router.replace(`/learn?path=no-esp#${hash}`);
    else if (NETWORK_HASHES.has(hash) || hash === "reseau") router.replace(`/learn?path=network#${hash}`);
  }, [hasPath, router]);

  return null;
}
