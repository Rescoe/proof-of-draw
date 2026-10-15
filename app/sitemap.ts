import type { MetadataRoute } from "next";
import { PUBLIC_PAGES, SITE_URL, VERIFIED_AT } from "@/lib/projectStatus";

// Pages publiques stables uniquement (aucune requête Redis : pas de pages d'artistes ni de blocs individuels).
export default function sitemap(): MetadataRoute.Sitemap {
  return PUBLIC_PAGES.map((p) => ({ url: `${SITE_URL}${p.path === "/" ? "" : p.path}`, lastModified: VERIFIED_AT, changeFrequency: "weekly" as const, priority: p.priority }));
}
