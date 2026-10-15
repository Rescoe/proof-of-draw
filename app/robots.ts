import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/projectStatus";

// robots.txt : indications d'exploration pour les moteurs qui les respectent. Ce N'EST PAS une barrière de sécurité : les routes /api/ restent protégées par leurs propres contrôles (sessions, limites, listes de blocage).
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/api/", "/profile", "/my-devices", "/bench", "/draw-lab", "/onboard"] }],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
