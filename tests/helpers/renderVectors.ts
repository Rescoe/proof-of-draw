// tests/helpers/renderVectors.ts — VECTEURS D'OR du rasteriseur de rendu (lot 8A), produits par la référence TypeScript (lib/renderLayout.ts) ; le port C++ (consensus-pod/src/podRender.h) doit les
// retrouver à l'octet près. Une ligne = un cas : paramètres du motif et du cartel + hashes attendus (pas d'image dans le fichier : les motifs sont déterministes des deux côtés).
// Écrit par scripts/gen-render-vectors.ts dans consensus-pod/test-vectors/render-vectors.txt.
import { CARTEL_MODES, FONT_5X7, LAYOUT_VERSION, PATTERNS, bytesPlane, encodeGrid, foldText, frameHashOf, patternGrid, renderFrame, type CartelMode, type PatternName, type RenderMeta } from "../../lib/renderLayout";
import type { ScreenId } from "../../lib/screenProfiles";

const enc = (s: string) => new TextEncoder().encode(s);
const cat = (...p: (Uint8Array | number[])[]) => Uint8Array.from(p.flatMap((x) => Array.from(x)));
const hex = (b: Uint8Array) => (b.length ? Buffer.from(b).toString("hex") : "-");

export interface MetaCase { name: string; meta: RenderMeta }
/** Cas de texte : accents, longueurs aux bornes (48 caractères e-ink, 20 TFT), parités, caractères inconnus, UTF-8 invalide, contrôles, champs vides. */
export function metaCases(): MetaCase[] {
  const M = (name: string, ts: Uint8Array | string, blockIndex: number, artist: Uint8Array | string, title: Uint8Array | string): MetaCase => ({
    name, meta: { ts: typeof ts === "string" ? enc(ts) : ts, blockIndex, artist: typeof artist === "string" ? enc(artist) : artist, title: typeof title === "string" ? enc(title) : title },
  });
  const cases: MetaCase[] = [
    M("normal", "07/10/2026 20:37", 42, "Léa", "Le Chat Noir"),
    M("long", "Mardi 07 octobre 2026 à 20:37:59 UTC+02:00", 123456789, "Jean-Baptiste Poquelin de la Fontaine", "Les aventures extraordinaires du capitaine Nemo sous les mers"),
    M("accents", "", 7, "Élodie Çağlar", "Œuvre n°1 — été ß ÿ ÷ × Þ ð"),
    M("vide", "", -1, "", ""),
    M("titre-seul", "x", 0, "", "Seul"),
    M("artiste-seul", "12:00", 1, "Seule", ""),
    M("inconnus", "a:b.c-d/e#f", 99999, cat(enc("A&B (c) ,;'x'\"y\""), [0x1f, 0x7f, 0x09]), cat([0xf0, 0x9f, 0x98, 0x80], enc("ok"), [0x80, 0x80, 0xff, 0xe2, 0x82, 0xac], enc("fin"), [0xc3])),
    M("parite-1", "AB", 3, "A", "BC"),
    M("parite-2", "ABC", 12, "AB", "C"),
    M("minuscules", "a:b.c-d/e#f", 5, "x", "y"),
  ];
  for (const n of [19, 20, 21, 47, 48, 49]) cases.push(M(`titre-${n}`, "ts", n, "", "A".repeat(n)));
  return cases;
}

const SCREENS_CARTEL: ScreenId[] = ["eink29bwr", "eink27bw", "tft18"];
const SCREENS_PLAIN: ScreenId[] = ["oled096", "tft28"];
const SEEDS = [1, 7, 12345];

export function buildRenderVectors() {
  const L: string[] = [];
  const push = (...t: (string | number)[]) => L.push(t.join(" "));
  push("#", `vecteurs du rasteriseur de rendu (layoutVersion ${LAYOUT_VERSION}) — générés par scripts/gen-render-vectors.ts à partir de lib/renderLayout.ts (NE PAS ÉDITER À LA MAIN)`);
  push("rfont", hex(Uint8Array.from(FONT_5X7.flat())));
  // repli des accents et filtrage : table Latin-1 complète, puis cas limites
  push("rtext", hex(cat(Array.from({ length: 64 }, (_, i) => i + 0x80).flatMap((d) => [0xc3, d]))), hex(enc(foldText(cat(Array.from({ length: 64 }, (_, i) => i + 0x80).flatMap((d) => [0xc3, d]))))));
  for (const mc of metaCases()) for (const part of [mc.meta.ts, mc.meta.artist, mc.meta.title]) if (part.length) push("rtext", hex(part), hex(enc(foldText(part))) );
  push("rtext", hex(Uint8Array.from([0x41, 0x80, 0x42, 0xc3])), hex(enc(foldText(Uint8Array.from([0x41, 0x80, 0x42, 0xc3])))));   // continuation isolée, Ã final tronqué

  const vec = (screen: ScreenId, pattern: string, seed: number, mode: CartelMode, mc: MetaCase) => {
    const planes = pattern === "bytes" ? [bytesPlane(screen, seed)] : encodeGrid(screen, patternGrid(screen, pattern as PatternName, seed));
    const r = renderFrame(screen, planes, mode, mc.meta);
    if (r.frameHash !== frameHashOf(screen, planes)) throw new Error("frameHash incohérent");
    push("rvec", screen, pattern, seed, mode, mc.meta.blockIndex, hex(mc.meta.ts), hex(mc.meta.artist), hex(mc.meta.title), r.frameHash, r.renderHash);
  };
  const cases = metaCases(), normal = cases[0];
  // A. tous les motifs × les trois modes × chaque écran (cartel « normal », graine variable)
  for (const screen of SCREENS_CARTEL) PATTERNS.forEach((p, i) => { for (const mode of CARTEL_MODES) vec(screen, p, SEEDS[i % SEEDS.length], mode, normal); });
  // B. tous les textes × les trois modes × chaque écran (sur un bruit, graine 7)
  for (const screen of SCREENS_CARTEL) for (const mc of cases) for (const mode of CARTEL_MODES) vec(screen, "noise", 7, mode, mc);
  // C. écrans SANS cartel gravé : l'image est inchangée quel que soit le mode (OLED, TFT 2,8″)
  for (const screen of SCREENS_PLAIN) for (const mode of CARTEL_MODES) for (const seed of SEEDS.slice(0, 2)) vec(screen, "bytes", seed, mode, normal);
  return { vectorsTxt: L.join("\n") + "\n", lines: L.length };
}
