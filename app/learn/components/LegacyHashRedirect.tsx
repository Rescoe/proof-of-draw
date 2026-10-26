"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { pathForHash } from "../../../lib/learnCatalog";

/** Anciens liens `/learn#ancre` (sans `?path=`) : redirige vers le parcours qui porte l'ancre (table testée dans lib/learnCatalog.ts). */
export function LegacyHashRedirect({ hasPath }: { hasPath: boolean }) {
  const router = useRouter();

  useEffect(() => {
    if (hasPath) return;
    const hash = window.location.hash.slice(1);
    const path = pathForHash(hash);
    if (path) router.replace(`/learn?path=${path}#${hash}`);
  }, [hasPath, router]);

  return null;
}
