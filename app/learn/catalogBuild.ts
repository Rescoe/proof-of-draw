// app/learn/catalogBuild.ts — catalogue complet côté serveur : entrées statiques + phases de la feuille de route + sections des documents markdown (matrice, dépannage).
// Lecture des fichiers à la construction (comme les composants qui les affichent) ; un document illisible n'enlève jamais le catalogue statique.
import { loadHardwareMatrix, loadTroubleshooting } from "../../lib/hardwareMatrix";
import { sectionsFromBlocks, type CatalogEntry } from "../../lib/learnCatalog";
import { phaseProgress, ROADMAP } from "./data/roadmap";
import { STATIC_CATALOG } from "./data/catalog";

export function roadmapEntries(): CatalogEntry[] {
  return ROADMAP.map((phase) => {
    const p = phaseProgress(phase);
    return {
      id: `roadmap:road-${phase.id}`, path: "roadmap", anchor: `road-${phase.id}`, kind: "etat", depth: "decouvrir",
      title: `Feuille de route — ${phase.title}`, summary: `${phase.summary} (${p.done}/${p.total} faits)`,
      keywords: ["feuille de route", "roadmap", "avancement"], body: phase.items.map((i) => `${i.title} ${i.note ?? ""}`).join(" "),
    };
  });
}

export function buildCatalog(): CatalogEntry[] {
  let matrix: CatalogEntry[] = [], help: CatalogEntry[] = [];
  try { matrix = sectionsFromBlocks(loadHardwareMatrix(), { prefix: "c-", path: "compat", kind: "reference", depth: "pratiquer", keywords: ["compatibilité", "matrice", "matériel"] }); } catch { /* document absent : catalogue statique seul */ }
  try { help = sectionsFromBlocks(loadTroubleshooting(), { prefix: "h-", path: "help", kind: "depannage", depth: "pratiquer", keywords: ["dépannage", "problème", "aide"] }); } catch { /* idem */ }
  // ordre : statique par parcours, puis les sous-sections de leur parcours juste après leur entrée principale
  const out: CatalogEntry[] = [];
  for (const e of STATIC_CATALOG) {
    out.push(e);
    if (e.path === "help" && e.anchor === "depannage") out.push(...help);
    if (e.path === "roadmap") out.push(...roadmapEntries());
    if (e.path === "compat") out.push(...matrix);
  }
  return out;
}
