// tests/ui/playwright.config.ts — suite de viewports (UX jalon 5, 29/10/2026). SÉPARÉE de `npm test` (node --test) et jamais lancée par le build Vercel :
//   npm run test:ui                      (serveur de développement déjà lancé sur http://localhost:3000, ou UI_BASE_URL=…)
//   UI_CHROMIUM="C:/…/chrome.exe" npm run test:ui     (navigateur déjà installé ; sinon : npx playwright install chromium)
// Pages SANS Redis uniquement par défaut (/learn, /gallery, /draw) ; UI_WITH_DATA=1 ajoute l'accueil et /network (le serveur doit alors avoir accès à la base).
// Sorties (captures, traces) : tests/ui/.output, ignoré par git.
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: /.*\.spec\.ts/,
  outputDir: "./.output",
  reporter: [["list"]],
  fullyParallel: true,
  retries: 0,
  use: {
    baseURL: process.env.UI_BASE_URL ?? "http://localhost:3000",
    launchOptions: process.env.UI_CHROMIUM ? { executablePath: process.env.UI_CHROMIUM } : {},
    screenshot: "only-on-failure",
    trace: "off",
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
});
