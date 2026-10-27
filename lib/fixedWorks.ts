// lib/fixedWorks.ts — « ŒUVRES FIXES » par écran (29/10/2026). Pur, sans Redis, testé.
//
// Un écran DYNAMIQUE (TFT 2,8″, TFT 1,8″, OLED) est fait pour les animations : par défaut il n'affiche QUE des animations (réglage désactivé pour tous). Le propriétaire peut activer « œuvres fixes » écran par écran.
// Deux réglages indépendants par écran, appliqués dans cet ordre :
//   1. QUELLES œuvres : animations seulement (défaut des écrans dynamiques) ou animations + œuvres fixes (`fixedWorksScreens`) ;
//   2. QUELLES ORIGINES : œuvres faites pour ce type d'écran seulement, ou aussi celles d'un autre type, converties (`acceptsConvertedScreens`, défaut : activé). Il s'applique à ce que le 1 a choisi :
//      animations d'un autre type d'écran, et — si les œuvres fixes sont activées — dessins fixes d'un autre type.
// Les écrans non dynamiques (e-ink) ne reçoivent que des œuvres fixes : pas de réglage, comportement inchangé.
import { BENCH_SCREENS } from "@/lib/bench/screens";

export const DYNAMIC_SCREENS: readonly string[] = BENCH_SCREENS;
export const isDynamicScreen = (screen: string): boolean => DYNAMIC_SCREENS.includes(screen);

type Cfg = { screens?: readonly string[] | null; fixedWorksScreens?: readonly string[] | null };

/** Écrans de l'appareil qui affichent des œuvres fixes. ABSENT (jamais réglé) : tous SAUF les écrans dynamiques. */
export function fixedWorksScreensOf(d: Cfg): string[] {
  const screens = d.screens ?? [];
  const list = d.fixedWorksScreens ?? screens.filter((s) => !isDynamicScreen(s));
  return list.filter((s) => screens.includes(s) && s !== "sensor");
}

/** Cet écran de cet appareil affiche-t-il les œuvres fixes ? */
export function showsFixedWorks(d: Cfg | null | undefined, screen: string): boolean {
  return !!d && fixedWorksScreensOf(d).includes(screen);
}

/** Une animation faite pour `origin` est-elle livrée à cet écran ? Même type : toujours ; autre type : seulement si l'écran accepte les conversions (défaut : oui). */
export function acceptsAnimationFrom(d: { screens?: readonly string[] | null; acceptsConvertedScreens?: readonly string[] | null } | null | undefined, screen: string, origin?: string | null): boolean {
  if (!d) return false;
  if (!origin || origin === screen) return true;
  return (d.acceptsConvertedScreens ?? d.screens ?? []).includes(screen);
}
