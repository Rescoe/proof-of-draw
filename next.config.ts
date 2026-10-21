import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  turbopack: {
    root: path.resolve(__dirname),
  },
  // OTA (20/10/2026, inactif tant que OTA_DIST_MODE ≠ on) : les releases signées sont des fichiers du dépôt, lus à l'exécution par node:fs
  // (lib/otaRegistry.ts) ; le traçage de Vercel ne les inclurait pas sans cette déclaration. Aucun effet sur les autres routes.
  outputFileTracingIncludes: {
    "/api/pull": ["./ota-releases/**/*"],
    "/firmware/[release]/[file]": ["./ota-releases/**/*"],
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-XSS-Protection", value: "1; mode=block" },
        ],
      },
    ];
  },
};

export default nextConfig;