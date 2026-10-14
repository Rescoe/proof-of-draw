// tests/helpers/voteCanaryReach.ts — LOT8B2E V4-FIX1 : ANALYSE STATIQUE DE LA PORTÉE du build POD_VOTE_CANARY = 1 : tout ce qui est ATTEIGNABLE depuis setup() et loop()/voteCanaryLoop().
//
// Principe : (1) évaluer les conditionnelles du préprocesseur pour la configuration du canari de vote (POD_VOTE_CANARY = 1, POD_CANARY = 0, POD_VOTE_V1 = 0, POD_RENDER_V1 = 0 ; les conditions étrangères
// comme `__has_include`, TOUCH_ENABLED, ARDUINOJSON_VERSION… gardent leur branche « vraie ») ; (2) retirer commentaires et littéraux ; (3) découper les définitions de premier niveau (fonctions et structures
// avec méthodes) ; (4) fermeture transitive des références par nom depuis les points d'entrée ; (5) chercher dans CHAQUE fonction atteignable un accès à l'écran, au tactile ou à la carte SD.
// Sur-approximation volontaire : une référence par nom, même dans une branche jamais exécutée, compte comme atteignable (un faux positif se corrige en retirant la branche du build de vote, jamais en assouplissant le test).
export interface Reach { funcs: string[]; hits: Array<{ fn: string; what: string }>; defined: string[] }

export type Build = "vote" | "enroll";   // TFT28-PREVIEW-ENROLL-1 : le build d'appairage (POD_PREVIEW_ENROLL = 1, POD_VOTE_CANARY = 0) a la même analyse
const MACROS_BY_BUILD: Record<Build, Record<string, number>> = {
  vote: { POD_CANARY: 0, POD_RENDER_V1: 0, POD_VOTE_V1: 0, POD_VOTE_CANARY: 1, POD_PREVIEW_ENROLL: 0, POD_NOHW: 1 },
  enroll: { POD_CANARY: 0, POD_RENDER_V1: 0, POD_VOTE_V1: 0, POD_VOTE_CANARY: 0, POD_PREVIEW_ENROLL: 1, POD_NOHW: 1 },
};
let MACROS: Record<string, number> = MACROS_BY_BUILD.vote;

function evalCond(expr: string): boolean | null {   // null = condition étrangère (non évaluable)
  const toks = expr.replace(/\/\/.*$/, "").match(/\|\||&&|>=|<=|==|!=|[()!<>]|\d+|[A-Za-z_]\w*/g);
  if (!toks) return null;
  let i = 0; let foreign = false;
  const prim = (): number => {
    const t = toks[i++];
    if (t === "(") { const v = orx(); i++; return v; }
    if (t === "!") return prim() ? 0 : 1;
    if (/^\d+$/.test(t)) return Number(t);
    if (t in MACROS) return MACROS[t];
    foreign = true; return 1;
  };
  const cmp = (): number => { let v = prim(); while (toks[i] === ">=" || toks[i] === "<=" || toks[i] === "==" || toks[i] === "!=" || toks[i] === ">" || toks[i] === "<") { const o = toks[i++]; const r = prim(); v = (o === ">=" ? v >= r : o === "<=" ? v <= r : o === "==" ? v === r : o === "!=" ? v !== r : o === ">" ? v > r : v < r) ? 1 : 0; } return v; };
  const andx = (): number => { let v = cmp(); while (toks[i] === "&&") { i++; const r = cmp(); v = v && r ? 1 : 0; } return v; };
  const orx = (): number => { let v = andx(); while (toks[i] === "||") { i++; const r = andx(); v = v || r ? 1 : 0; } return v; };
  const v = orx();
  return foreign ? null : v !== 0;
}

/** Texte « effectif » pour la configuration du canari de vote. */
export function voteCanaryView(src: string, build: Build = "vote"): string {
  MACROS = MACROS_BY_BUILD[build];
  const out: string[] = [];
  const st: Array<{ active: boolean; taken: boolean; parent: boolean }> = [];
  const live = () => st.every((s) => s.active);
  for (const line of src.split("\n")) {
    const t = line.trim();
    let m: RegExpExecArray | null;
    if ((m = /^#if\s+(.*)$/.exec(t))) { const c = evalCond(m[1]); const a = c === null ? true : c; st.push({ active: a, taken: a, parent: true }); continue; }
    if ((m = /^#ifdef\s+(\w+)/.exec(t))) { const a = m[1] in MACROS ? true : true; st.push({ active: a, taken: a, parent: true }); continue; }
    if ((m = /^#ifndef\s+(\w+)/.exec(t))) { const a = m[1] in MACROS ? false : true; st.push({ active: a, taken: a, parent: true }); continue; }
    if (/^#else\b/.test(t) && st.length) { const s = st[st.length - 1]; s.active = !s.taken; s.taken = true; continue; }
    if (/^#endif\b/.test(t)) { st.pop(); continue; }
    if (/^#/.test(t)) continue;   // define / include / error / pragma : sans objet pour la portée
    if (live()) out.push(line); else out.push("");
  }
  return out.join("\n");
}

/** Remplace commentaires, chaînes et caractères littéraux par des espaces (les retours à la ligne sont conservés). */
export function stripLiterals(s: string): string {
  let o = ""; let i = 0;
  while (i < s.length) {
    const c = s[i], d = s[i + 1];
    if (c === "/" && d === "/") { while (i < s.length && s[i] !== "\n") { o += " "; i++; } continue; }
    if (c === "/" && d === "*") { i += 2; o += "  "; while (i < s.length && !(s[i] === "*" && s[i + 1] === "/")) { o += s[i] === "\n" ? "\n" : " "; i++; } i += 2; o += "  "; continue; }
    if (c === '"' || c === "'") { const q = c; o += q; i++; while (i < s.length && s[i] !== q) { if (s[i] === "\\") { o += "  "; i += 2; continue; } o += s[i] === "\n" ? "\n" : " "; i++; } o += q; i++; continue; }
    o += c; i++;
  }
  return o;
}

interface Def { name: string; body: string; kind: "fn" | "type" }
function definitions(clean: string): Def[] {
  const defs: Def[] = []; let depth = 0; let stmtStart = 0;
  for (let i = 0; i < clean.length; i++) {
    const c = clean[i];
    if (c === "{") {
      if (depth === 0) {
        const head = clean.slice(stmtStart, i).replace(/__attribute__\s*\(\([^)]*\)\)/g, " ").trim();
        let j = i + 1, d = 1; while (j < clean.length && d > 0) { if (clean[j] === "{") d++; else if (clean[j] === "}") d--; j++; }
        const body = clean.slice(i, j);
        let m: RegExpExecArray | null;
        if ((m = /\b(?:struct|class)\s+(\w+)/.exec(head)) && !/\)\s*$/.test(head)) defs.push({ name: m[1], body, kind: "type" });
        else if ((m = /([A-Za-z_]\w*)\s*\([^;{}]*\)\s*(?:const\s*)?(?:noexcept\s*)?$/.exec(head))) defs.push({ name: m[1], body: head + " " + body, kind: "fn" });
        i = j - 1; stmtStart = j; continue;
      }
      depth++;
    } else if (c === "}") depth = Math.max(0, depth - 1);
    else if (c === ";" && depth === 0) stmtStart = i + 1;
  }
  return defs;
}

const FORBIDDEN_NAMES = ["tftStatus", "pushRow", "swapRowBytes", "drawCartel", "displayOnboardingTFT", "displayKeyMaterialOnce", "registerShowOnboarding", "registerShowFailure", "registerShowConnected", "registerStatusOnDedicatedStack",
  "restoreLastFrame", "restoreLastFrameImpl", "restoreRows", "toggleCartel", "serviceTouch", "drainTouch", "initSD", "onSd", "runResidentAnim", "playBenchClip", "doBenchPoll", "fetchAnimToSd", "maybeFetchAnim", "animForget",
  "doFetchFrame", "ackFrame", "doObsConfirm", "streamFrame", "saveMeta", "onAnimTouch", "waitTapOrTimeout", "fastPixels"];
const FORBIDDEN_TOKENS: Array<[RegExp, string]> = [[/\btft\s*\./, "accès à l'écran (tft.)"], [/\bts\s*\./, "accès au tactile (ts.)"], [/\bSD\s*\./, "accès à la carte SD (SD.)"], [/\bFile\s+\w+\s*=/, "fichier de la carte SD"], [/\bonSd\s*\(/, "opération SD (onSd)"]];

/** Build d'appairage : aucune fonction de pull, de candidat, de vote, de verrou, d'ACK ni d'image ne doit être atteignable (en plus des familles écran / tactile / SD). */
const ENROLL_FORBIDDEN = /^(doPullw*|doValidatew*|voteCanaryLoop|vote[A-Z]w*|vc[A-Z]w*|netReadCandidate|netGetBlockClipToSd|netStreamFrame|ackw*|doFetchw*|doObsw*|doBenchw*|streamFrame|podCheckw*|pollBenchw*)$/;

/** Fonctions atteignables depuis les points d'entrée + accès matériel interdits trouvés dans chacune. */
export function reachFrom(src: string, entries: string[], build: Build = "vote"): Reach {
  const clean = stripLiterals(voteCanaryView(src, build));
  const defs = definitions(clean);
  const byName = new Map<string, Def[]>(); for (const d of defs) { const a = byName.get(d.name) ?? []; a.push(d); byName.set(d.name, a); }
  const seen = new Set<string>(); const queue = [...entries];
  while (queue.length) {
    const n = queue.pop()!; if (seen.has(n)) continue; seen.add(n);
    for (const d of byName.get(n) ?? []) for (const id of new Set(d.body.match(/[A-Za-z_]\w*/g) ?? [])) if (byName.has(id) && !seen.has(id)) queue.push(id);
  }
  const hits: Array<{ fn: string; what: string }> = [];
  for (const n of seen) {
    if (FORBIDDEN_NAMES.includes(n)) hits.push({ fn: n, what: "fonction d'affichage / tactile / SD / ACK atteignable" });
    if (build === "enroll" && ENROLL_FORBIDDEN.test(n)) hits.push({ fn: n, what: "fonction de pull / candidat / vote / verrou / ACK / image atteignable dans le build d'appairage" });
    for (const d of byName.get(n) ?? []) for (const [re, what] of FORBIDDEN_TOKENS) if (re.test(d.body)) hits.push({ fn: n, what });
  }
  return { funcs: [...seen].sort(), hits, defined: defs.map((d) => d.name) };
}
