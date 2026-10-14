// tests/helpers/tft28Source.ts — LOT8B2D-R4-TFT28-CANARY-1 : outils d'analyse du sketch UNO R4 + TFT 2,8″ (arduino_uno_r4/pod_uno_r4/pod_uno_r4.ino) partagés par les tests statiques et les harnais hôte.
import fs from "node:fs";
import path from "node:path";

export const ROOT = path.resolve(__dirname, "..", "..");
export const INO = "arduino_uno_r4/pod_uno_r4/pod_uno_r4.ino";
export const BACKUP = "firmware-backups/2026-10-12_avant-canari-tft28/pod_uno_r4.ino";
export const readText = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8").replace(/\r\n/g, "\n");

/**
 * LOT8B2E V4 : vue « POD_VOTE_CANARY = 0 » (la PRODUCTION et le canari d'affichage) : évalue `#if POD_VOTE_CANARY` (faux), `#if !POD_VOTE_CANARY` (vrai), `#else`, `#endif`, retire le bloc du drapeau ;
 * les autres conditionnelles sont conservées telles quelles. Les tests de la voie de vote de production lisent CETTE vue : le code du canari de vote (épinglage, verrou) n'en fait pas partie.
 */
export function voteCanaryOffView(src: string): string {
  const out: string[] = []; const st: Array<{ ours: boolean; active: boolean }> = [];
  const keep = () => st.every((s) => !s.ours || s.active);
  for (const line of src.replace(/\/\/ POD_VOTE_CANARY \(LOT8B2E V4\)[\s\S]*?#ifndef POD_VOTE_CANARY\n#define POD_VOTE_CANARY 0\n#endif\n/, "").replace(/\/\/ POD_PREVIEW_ENROLL \(LOT TFT28-PREVIEW-ENROLL-1\)[\s\S]*?#define POD_NOHW 0\n#endif\n\n/, "").split("\n")) {
    const t = line.trim();
    if (/^#if\s+(POD_VOTE_CANARY|POD_NOHW|POD_PREVIEW_ENROLL)\s*$/.test(t)) { st.push({ ours: true, active: false }); continue; }
    if (/^#if\s+!(POD_VOTE_CANARY|POD_NOHW|POD_PREVIEW_ENROLL)\s*$/.test(t)) { st.push({ ours: true, active: true }); continue; }
    if (/^#(if|ifdef|ifndef)\b/.test(t)) { st.push({ ours: false, active: true }); if (keep()) out.push(line); continue; }
    if (/^#else\b/.test(t) && st.length && st[st.length - 1].ours) { st[st.length - 1].active = !st[st.length - 1].active; continue; }
    if (/^#endif\b/.test(t)) { const top = st.pop(); if (top && !top.ours && keep()) out.push(line); continue; }
    if (keep()) out.push(line);
  }
  return out.join("\n");
}

/**
 * « Source effective » pour une valeur de POD_CANARY : évalue les conditionnelles `#if POD_CANARY`, `#if !POD_CANARY`, `#else`, `#endif` (non imbriquées entre elles) et laisse toutes les autres lignes
 * (y compris les autres `#if`) telles quelles. POD_CANARY = 0 : le texte de PRODUCTION ; POD_CANARY = 1 : le texte du CANARI.
 */
export function effective(src: string, canary: boolean): string {
  const out: string[] = [];
  const stack: Array<{ ours: boolean; active: boolean }> = [];
  const keep = () => stack.every((s) => !s.ours || s.active);
  for (const line of src.split("\n")) {
    const t = line.trim();
    if (/^#if\s+POD_CANARY\s*$/.test(t)) { stack.push({ ours: true, active: canary }); continue; }
    if (/^#if\s+!POD_CANARY\s*$/.test(t)) { stack.push({ ours: true, active: !canary }); continue; }
    if (/^#(if|ifdef|ifndef)\b/.test(t)) { stack.push({ ours: false, active: true }); if (keep()) out.push(line); continue; }
    const top = stack[stack.length - 1];
    if (/^#else\b/.test(t)) { if (top?.ours) { top.active = !top.active; continue; } if (keep()) out.push(line); continue; }
    if (/^#endif\b/.test(t)) { const s = stack.pop(); if (s && !s.ours && keep()) out.push(line); continue; }
    if (keep()) out.push(line);
  }
  return out.join("\n");
}

/** Retire les instructions-crochets du canari (macros sans effet en production) : POD_CANARY_XXX(...); */
export function stripHooks(src: string): string {
  return src
    .replace(/^([ \t]*)POD_CANARY_CANDIDATE\(([^;\n]*)\);[ \t]*\n/gm, "$1do { if (($2).length() > 0) pendingCandidateId = ($2); } while (0);\n")   // la SEULE macro dont la définition de production n'est pas vide : on la développe
    .replace(/^[ \t]*POD_CANARY_[A-Z_]+\([^;\n]*\);[ \t]*\n/gm, "").replace(/ \|\| POD_CANARY_LOG_FATAL\(li\)/g, "");
}

export const stripLine = (s: string) => s.replace(/("(?:[^"\\\n]|\\.)*")|\/\/.*$/gm, (_m, str?: string) => str ?? "");
export const stripBlock = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "");

/** Corps (accolades équilibrées, hors littéraux) de la première fonction dont la ligne de tête commence par `head` (comparaison sur le texte brut). Retourne "" si introuvable. */
export function fnBody(src: string, head: string): string {
  let i = src.indexOf(head);
  // un prototype (« …; » avant la première accolade) n'est pas une définition : on passe à l'occurrence suivante
  while (i >= 0) { const b = src.indexOf("{", i + head.length - 1), sc = src.indexOf(";", i + head.length - 1); if (b >= 0 && (sc < 0 || b < sc || /\)\s*$/.test(src.slice(i, b).split(";")[0]) && b < sc)) break; i = src.indexOf(head, i + 1); }
  if (i < 0) return "";
  let j = src.indexOf("{", i + head.length - 1), depth = 0;
  const start = i;
  for (; j < src.length; j++) {
    const c = src[j];
    if (c === '"') { j++; while (j < src.length && src[j] !== '"') { if (src[j] === "\\") j++; j++; } }
    else if (c === "'") { j++; while (j < src.length && src[j] !== "'") { if (src[j] === "\\") j++; j++; } }
    else if (c === "/" && src[j + 1] === "/") { while (j < src.length && src[j] !== "\n") j++; }
    else if (c === "{") depth++;
    else if (c === "}") { depth--; if (depth === 0) return src.slice(start, j + 1); }
  }
  return "";
}

/** Nom de l'élément de plus haut niveau qui contient la ligne n (1-based) : fonction, structure ou titre de section. */
export function topLevelName(lines: string[], n: number): string {
  for (let i = n - 1; i >= 0; i--) {
    const l = lines[i].replace(/__attribute__\(\([^)]*\)\)\s*/g, "");
    const m = /^(?:template\s*<[^>]*>\s*)?(?:static\s+)?(?:inline\s+)?[A-Za-z_][\w:<>,\s*&]*?\b([A-Za-z_]\w*)\s*\([^;]*\)\s*(?:const\s*)?\{\s*$/.exec(l);
    if (m && !/^(if|for|while|switch|else)$/.test(m[1])) return m[1];
    const s = /^(?:struct|enum(?:\s+\w+)?|class)\s+(\w+)/.exec(l);
    if (s) return s[1];
    const h = /^\/\/ ─── (.+?) ─/.exec(l);
    if (h) return `§ ${h[1]}`;
  }
  return "?";
}
