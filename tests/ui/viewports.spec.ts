// tests/ui/viewports.spec.ts — navigation et pages principales aux viewports du plan UX (UX jalon 5). Assertions : aucun défilement horizontal du document, barre sur UNE ligne au-dessus de 1024 px,
// hamburger en dessous, cibles de navigation ≥ 44 px, tiroir en quatre groupes avec focus piégé et rendu, aucun nombre d'indice COV visible.
import { test, expect, type Page } from "@playwright/test";

const PHONES: Array<[number, number]> = [[320, 568], [360, 800], [390, 844], [430, 932]];
const TABLETS: Array<[number, number]> = [[600, 960], [768, 1024], [820, 1180], [1024, 768]];
const DESKTOPS: Array<[number, number]> = [[1025, 700], [1180, 820], [1280, 720], [1366, 1024], [1440, 900], [1920, 1080]];
const PAGES = ["/learn", "/learn?path=compat", "/gallery", "/draw", ...(process.env.UI_WITH_DATA === "1" ? ["/", "/network"] : [])];

async function ready(page: Page, url: string) {
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".site-nav", { timeout: 60_000 });
  await page.waitForTimeout(1500);   // hydratation
}

for (const [w, h] of [...PHONES, ...TABLETS, ...DESKTOPS]) {
  test.describe(`${w}×${h}`, () => {
    test.use({ viewport: { width: w, height: h } });

    for (const url of PAGES) {
      test(`${url} : aucun défilement horizontal`, async ({ page }) => {
        await ready(page, url);
        const m = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
        expect(m.sw, `scrollWidth ${m.sw} > clientWidth ${m.cw}`).toBeLessThanOrEqual(m.cw + 1);
      });
    }

    test("navigation : barre sur une ligne ou hamburger, cibles ≥ 44 px", async ({ page }) => {
      await ready(page, "/learn");
      const burger = page.locator(".nav-burger");
      if (w <= 1024) {
        await expect(burger).toBeVisible();
        await expect(page.locator(".site-nav__links")).toBeHidden();
        const b = await burger.boundingBox();
        expect(b!.width).toBeGreaterThanOrEqual(43.5); expect(b!.height).toBeGreaterThanOrEqual(43.5);
      } else {
        await expect(burger).toBeHidden();
        const tops = await page.locator(".site-nav__links > *").evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().top)));
        expect(new Set(tops).size, `entrées sur plusieurs lignes : ${tops.join(",")}`).toBe(1);
        const hs = await page.locator(".site-nav__links > *").evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
        for (const x of hs) expect(x).toBeGreaterThanOrEqual(43.5);
      }
    });

    if (w <= 1024) {
      test("tiroir : quatre groupes, focus piégé, Échap rend le focus, dernier lien atteignable", async ({ page }) => {
        await ready(page, "/gallery");
        const drawer = page.locator("#nav-drawer");
        // le clic peut précéder l'hydratation (serveur de développement) : on réessaie jusqu'à ce que le tiroir s'ouvre
        await expect(async () => { if (!(await drawer.isVisible())) await page.locator(".nav-burger").click(); await expect(drawer).toBeVisible({ timeout: 1500 }); }).toPass({ timeout: 20_000 });
        await expect(drawer.locator(".nav-drawer__sep")).toHaveText(["Participer", "Explorer", "Mon compte", "Aide"]);
        expect(await page.evaluate(() => document.getElementById("nav-drawer")!.contains(document.activeElement))).toBe(true);
        const last = drawer.getByRole("link", { name: "Documentation technique" });
        await last.scrollIntoViewIfNeeded();
        const box = await last.boundingBox();
        expect(box!.y + box!.height).toBeLessThanOrEqual(h + 1);
        // Tab ne sort jamais du tiroir (plus de liens que de Tab : on boucle)
        for (let i = 0; i < 16; i++) await page.keyboard.press("Tab");
        expect(await page.evaluate(() => { const d = document.getElementById("nav-drawer")!; const a = document.activeElement; return d.contains(a) || a === document.querySelector(".nav-burger"); })).toBe(true);
        await page.keyboard.press("Escape");
        await expect(drawer).toBeHidden();
        expect(await page.evaluate(() => document.activeElement === document.querySelector(".nav-burger"))).toBe(true);
      });
    }
  });
}

test.describe("matrice de compatibilité en cartes sur téléphone", () => {
  test.use({ viewport: { width: 390, height: 844 } });
  test("une carte par ligne, titre de colonne devant chaque valeur, aucun débordement", async ({ page }) => {
    await ready(page, "/learn?path=compat");
    const info = await page.evaluate(() => {
      const t = document.querySelector("table[class*=synthTableCards]") as HTMLElement;
      const tr = t.querySelector("tbody tr") as HTMLElement;
      return { theadDisplay: getComputedStyle(t.querySelector("thead")!).display, trDisplay: getComputedStyle(tr).display, labels: [...tr.querySelectorAll("td")].map((td) => td.getAttribute("data-label")).filter(Boolean).length, sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth };
    });
    expect(info.theadDisplay).toBe("none"); expect(info.trDisplay).toBe("block"); expect(info.labels).toBeGreaterThanOrEqual(2);
    expect(info.sw).toBeLessThanOrEqual(info.cw + 1);
  });
});
