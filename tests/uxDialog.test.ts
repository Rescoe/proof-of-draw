// UX jalon 5 (29/10/2026) — dialogues partagés : Échap, focus piégé et rendu, défilement verrouillé, feuille plein écran sur téléphone ; suite de viewports séparée de npm test.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const read = (p: string) => fs.readFileSync(path.join(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");

test("useDialog : Échap (sauf dialogue imbriqué), Tab / Maj+Tab piégés, premier élément focalisé, focus rendu au déclencheur, défilement restauré", () => {
  const h = read("app/ui/useDialog.ts");
  for (const needle of ['e.key === "Escape"', 'document.querySelector("[data-nested-dialog]")', 'e.key !== "Tab"', "e.shiftKey", "trigger.focus()", "document.body.style.overflow = prevOverflow", "querySelector<HTMLElement>(FOCUSABLE)"]) assert.ok(h.includes(needle), needle);
});

test("dialogues migrés : SensorModal et BlockDetail passent par useDialog ; l'agrandissement d'un graphique est marqué imbriqué", () => {
  assert.ok(read("app/profile/SensorPanel.tsx").includes("useDialog(true, onClose)"));
  assert.ok(read("app/BlockDetail.tsx").includes("useDialog(true, onClose)"));
  assert.ok(read("app/MeasuresExplorer.tsx").includes('data-nested-dialog=""'));
  assert.ok(!read("app/profile/SensorPanel.tsx").includes('e.key === "Escape"'), "plus de gestionnaire d'Échap local dans SensorModal");
});

test("feuille plein écran sur téléphone : en-tête collant, bouton fermer ≥ 44 px, zones sûres", () => {
  const css = read("app/globals.css");
  assert.ok(css.includes(".pod-dialog__head { position: sticky; top: 0;"));
  assert.ok(css.includes(".pod-dialog__close { background: none; border: 0; color: var(--text2); font-size: 1.2rem; cursor: pointer; min-width: 44px; min-height: 44px;"));
  const m = /@media \(max-width: 600px\) \{\n  \.pod-dialog-backdrop \{ padding: 0; align-items: stretch; \}\n  \.pod-dialog \{[^}]*height: 100dvh[^}]*env\(safe-area-inset-bottom\)/.exec(css);
  assert.ok(m, "feuille plein écran ≤ 600 px");
  const bd = read("app/BlockDetail.tsx");
  assert.ok(bd.includes(".bd-modal { max-width: none; max-height: none; height: 100dvh;"));
  assert.ok(bd.indexOf("@media (max-width: 600px)") > bd.indexOf(".bd-modal {"), "la règle téléphone vient APRÈS la règle de base et l'emporte");
});

test("suite de viewports : script test:ui séparé, jamais dans npm test, exclue de tsc, sorties ignorées par git, Playwright en devDependency", () => {
  const pkg = JSON.parse(read("package.json"));
  assert.equal(pkg.scripts["test:ui"], "playwright test -c tests/ui/playwright.config.ts");
  assert.equal(pkg.scripts.test, "node --import tsx --test tests/*.test.ts", "npm test inchangé : pas de navigateur dans la suite hôte");
  assert.ok(pkg.devDependencies["@playwright/test"], "devDependency");
  assert.ok(!pkg.dependencies["@playwright/test"], "jamais une dépendance de production");
  assert.ok(!/playwright/.test(pkg.scripts.build), "jamais dans le build");
  assert.ok(JSON.parse(read("tsconfig.json")).exclude.includes("tests/ui"));
  assert.ok(read(".gitignore").includes("/tests/ui/.output"));
  const spec = read("tests/ui/viewports.spec.ts");
  for (const w of ["320, 568", "360, 800", "390, 844", "430, 932", "600, 960", "768, 1024", "820, 1180", "1024, 768", "1180, 820", "1280, 720", "1440, 900", "1920, 1080"]) assert.ok(spec.includes(w), w);
  assert.ok(spec.includes("scrollWidth") && spec.includes("Participer") && spec.includes("43.5"));
});
