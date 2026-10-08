// tests/helpers/cppHarness.ts — compilation et exécution du harnais C++ des tests différentiels (firmware ↔ TypeScript), avec un diagnostic EXPLOITABLE.
//
// Pourquoi (Lot 0S, 06/10/2026) : sur un poste où g++ était présent mais ne compilait pas, le test échouait sans dire QUEL compilateur, QUELLE commande, ni le stderr.
// Désormais : le compilateur retenu et sa version sont affichés ; en cas d'échec, l'erreur contient le compilateur, la commande exacte, le répertoire, le code de sortie,
// le signal, l'erreur de lancement (ENOENT, ENOMEM…), stdout ET stderr, et un conseil adapté à Windows. Ne modifie ni les métriques ni les vecteurs attendus.

import { execFileSync, spawnSync } from "node:child_process";

export interface CompilerProbe { candidate: string; ok: boolean; detail: string }
export interface CompilerChoice { path: string | null; version: string; tried: CompilerProbe[] }

/** Candidats dans l'ordre : CXX (variable d'environnement), g++ du PATH, installations usuelles (MSYS2 sur Windows, /usr). Que des « / » : un « \b » ou « \t » serait interprété. */
export function compilerCandidates(env: NodeJS.ProcessEnv = process.env): string[] {
  return [env.CXX, "g++", "C:/msys64/mingw64/bin/g++.exe", "/usr/bin/g++", "/usr/local/bin/g++"].filter((c): c is string => Boolean(c));
}

export function findCompiler(candidates: string[] = compilerCandidates()): CompilerChoice {
  const tried: CompilerProbe[] = [];
  for (const c of candidates) {
    try {
      const out = execFileSync(c, ["--version"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
      const version = out.split(/\r?\n/)[0] ?? "";
      tried.push({ candidate: c, ok: true, detail: version });
      return { path: c, version, tried };
    } catch (e) {
      const err = e as NodeJS.ErrnoException;
      tried.push({ candidate: c, ok: false, detail: err.code ?? err.message.split("\n")[0] });
    }
  }
  return { path: null, version: "", tried };
}

export function describeChoice(choice: CompilerChoice): string {
  return choice.path
    ? `compilateur C++ : ${choice.path} (${choice.version})`
    : `aucun compilateur C++ trouvé. Essayés : ${choice.tried.map((t) => `${t.candidate} → ${t.detail}`).join(" ; ")}. Définir CXX (ex. CXX=C:/msys64/mingw64/bin/g++.exe) pour activer le test différentiel.`;
}

export interface ProcessReport {
  command: string; cwd: string; status: number | null; signal: string | null; spawnError?: NodeJS.ErrnoException; stdout: string; stderr: string;
}

/** Conseils selon l'échec (Windows : DLL MinGW introuvable = code 0xC0000135 = 3221225781, PATH). */
export function hintFor(r: ProcessReport, platform: string = process.platform): string {
  const hints: string[] = [];
  if (r.spawnError?.code === "ENOENT") hints.push("le programme est introuvable : vérifier le chemin/CXX et le PATH");
  if (r.spawnError?.code === "ENOMEM") hints.push("ENOMEM au lancement du processus : mémoire insuffisante ou limite de l'environnement ; relancer le test seul");
  if (platform === "win32") {
    if (r.status === 3221225781) hints.push("code 0xC0000135 : une DLL MinGW est introuvable — ajouter C:\\msys64\\mingw64\\bin au PATH de cette session");
    hints.push("sous Windows, utiliser des « / » dans CXX (CXX=C:/msys64/mingw64/bin/g++.exe) : un « \\b » ou « \\t » dans un chemin est interprété comme un caractère de contrôle");
  }
  if (!r.stderr.trim() && !r.stdout.trim() && r.status !== 0) hints.push("aucune sortie : le processus n'a rien écrit ; lancer la commande ci-dessus à la main");
  return hints.map((h) => `  → ${h}`).join("\n");
}

export function formatFailure(title: string, r: ProcessReport, platform: string = process.platform): string {
  return [
    title,
    `  commande : ${r.command}`,
    `  répertoire : ${r.cwd}`,
    `  code de sortie : ${r.status}${r.signal ? ` (signal ${r.signal})` : ""}`,
    r.spawnError ? `  erreur de lancement : ${r.spawnError.code ?? ""} ${r.spawnError.message}` : "  erreur de lancement : aucune",
    `  --- stdout ---\n${r.stdout.trimEnd() || "(vide)"}`,
    `  --- stderr ---\n${r.stderr.trimEnd() || "(vide)"}`,
    hintFor(r, platform),
  ].filter(Boolean).join("\n");
}

const quote = (a: string) => (/\s/.test(a) ? `"${a}"` : a);

export function runProcess(program: string, args: string[]): ProcessReport {
  const r = spawnSync(program, args, { encoding: "utf8" });
  return {
    command: [program, ...args].map(quote).join(" "), cwd: process.cwd(), status: r.status, signal: r.signal,
    spawnError: r.error as NodeJS.ErrnoException | undefined, stdout: r.stdout ?? "", stderr: r.stderr ?? "",
  };
}

/** Compile le harnais ; lève une erreur DIAGNOSTIQUÉE en cas d'échec. Retourne la ligne de commande exécutée (pour l'afficher). */
export function compileHarness(compiler: string, source: string, exe: string, extraArgs: string[] = []): string {
  const args = ["-std=c++11", "-Wall", "-Wextra", "-Werror", "-O2", ...extraArgs, source, "-o", exe];
  const report = runProcess(compiler, args);
  if (report.status !== 0 || report.spawnError) throw new Error(formatFailure("compilation du harnais C++ (pod_metrics.h) impossible", report));
  return report.command;
}

/** Exécute le harnais compilé ; lève une erreur DIAGNOSTIQUÉE si le processus échoue. */
export function runHarness(exe: string, args: string[]): string {
  const report = runProcess(exe, args);
  if (report.status !== 0 || report.spawnError) throw new Error(formatFailure("exécution du harnais C++ impossible", report));
  return report.stdout.trim();
}
