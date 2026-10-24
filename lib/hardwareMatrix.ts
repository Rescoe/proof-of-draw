// lib/hardwareMatrix.ts — la matrice de compatibilité matérielle (docs/MATRICE_COMPATIBILITE_MATERIELLE.md) est la SOURCE UNIQUE : la page « Apprendre » la lit à la construction, il n'existe aucune copie à tenir à jour.
// Ce module est pur (analyse de texte) ; la lecture du fichier est dans loadHardwareMatrix(). Il ne comprend que les éléments utilisés par la matrice : titres #, ##, ###, citations >, tableaux, listes - et 1., blocs de code, paragraphes.
import fs from "node:fs";
import path from "node:path";

export type MatrixBlock =
  | { kind: "h"; level: 1 | 2 | 3; text: string }
  | { kind: "p"; text: string }
  | { kind: "quote"; lines: string[] }
  | { kind: "ul"; items: string[] }
  | { kind: "ol"; items: string[] }
  | { kind: "code"; text: string }
  | { kind: "table"; head: string[]; rows: string[][] };

const splitRow = (line: string): string[] => line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
const isSep = (line: string): boolean => /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(line);

export function parseMatrixMarkdown(src: string): MatrixBlock[] {
  const lines = src.replace(/\r\n/g, "\n").split("\n");
  const out: MatrixBlock[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === "") { i++; continue; }
    if (line.startsWith("```")) {
      const buf: string[] = []; i++;
      while (i < lines.length && !lines[i].startsWith("```")) buf.push(lines[i++]);
      i++; out.push({ kind: "code", text: buf.join("\n") }); continue;
    }
    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    if (h) { out.push({ kind: "h", level: h[1].length as 1 | 2 | 3, text: h[2].trim() }); i++; continue; }
    if (line.startsWith(">")) {
      const buf: string[] = [];
      while (i < lines.length && lines[i].startsWith(">")) buf.push(lines[i++].replace(/^>\s?/, "").replace(/\s{2,}$/, ""));
      out.push({ kind: "quote", lines: buf }); continue;
    }
    if (line.trim().startsWith("|") && i + 1 < lines.length && isSep(lines[i + 1])) {
      const head = splitRow(line); i += 2; const rows: string[][] = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) rows.push(splitRow(lines[i++]));
      out.push({ kind: "table", head, rows }); continue;
    }
    if (/^\s*-\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*-\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*-\s+/, ""));
      out.push({ kind: "ul", items }); continue;
    }
    if (/^\s*\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*\d+\.\s+/, ""));
      out.push({ kind: "ol", items }); continue;
    }
    const buf: string[] = [];
    while (i < lines.length && lines[i].trim() !== "" && !/^(#{1,3}\s|>|```|\s*-\s+|\s*\d+\.\s+)/.test(lines[i]) && !lines[i].trim().startsWith("|")) buf.push(lines[i++].trim());
    if (buf.length === 0) { buf.push(line.trim()); i++; }
    out.push({ kind: "p", text: buf.join(" ") });
  }
  return out;
}

export type InlinePart = { kind: "text" | "strong" | "code"; text: string };
/** `code`, **gras** ; le reste est du texte brut (jamais interprété comme HTML : le rendu passe par React). */
export function parseInline(text: string): InlinePart[] {
  const parts: InlinePart[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let last = 0, m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) parts.push({ kind: "text", text: text.slice(last, m.index) });
    const tok = m[0];
    parts.push(tok.startsWith("**") ? { kind: "strong", text: tok.slice(2, -2) } : { kind: "code", text: tok.slice(1, -1) });
    last = m.index + tok.length;
  }
  if (last < text.length) parts.push({ kind: "text", text: text.slice(last) });
  return parts;
}

export const HARDWARE_MATRIX_FILE = "docs/MATRICE_COMPATIBILITE_MATERIELLE.md";
export const TROUBLESHOOTING_FILE = "docs/DEPANNAGE_INSTALLATION.md";
/** Rendu serveur de n'importe quel document markdown du dépôt (chemin relatif à la racine, jamais fourni par l'utilisateur). */
export function loadMarkdownDoc(file: string, root: string = process.cwd()): MatrixBlock[] {
  return parseMatrixMarkdown(fs.readFileSync(path.join(root, file), "utf8"));
}
export function loadHardwareMatrix(root: string = process.cwd()): MatrixBlock[] { return loadMarkdownDoc(HARDWARE_MATRIX_FILE, root); }
export function loadTroubleshooting(root: string = process.cwd()): MatrixBlock[] { return loadMarkdownDoc(TROUBLESHOOTING_FILE, root); }
