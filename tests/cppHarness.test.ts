import test from "node:test";
import assert from "node:assert/strict";
import { compilerCandidates, describeChoice, findCompiler, formatFailure, hintFor, runProcess, type ProcessReport } from "./helpers/cppHarness";

// Le diagnostic du harnais C++ doit rester EXPLOITABLE : c'est lui que lit quelqu'un dont le compilateur ne marche pas (poste de GPT, 06/10/2026).
const report = (over: Partial<ProcessReport> = {}): ProcessReport => ({ command: "g++ -std=c++11 a.cpp -o a.exe", cwd: "C:/x", status: 1, signal: null, stdout: "", stderr: "a.cpp:3: error: boom", ...over });

test("candidats : CXX d'abord, puis g++ du PATH, puis les installations usuelles ; chemins Windows avec des « / »", () => {
  const list = compilerCandidates({ CXX: "C:/outils/g++.exe" } as unknown as NodeJS.ProcessEnv);
  assert.equal(list[0], "C:/outils/g++.exe");
  assert.ok(list.includes("g++") && list.includes("C:/msys64/mingw64/bin/g++.exe"));
  assert.ok(list.every((c) => !c.includes("\\")), "aucun antislash : \\b, \\t… seraient interprétés");
  assert.equal(compilerCandidates({} as unknown as NodeJS.ProcessEnv)[0], "g++");
});

test("aucun compilateur : le message liste CHAQUE candidat essayé et explique CXX", () => {
  const choice = findCompiler(["/chemin/inexistant/g++-1", "/chemin/inexistant/g++-2"]);
  assert.equal(choice.path, null);
  assert.equal(choice.tried.length, 2);
  const msg = describeChoice(choice);
  assert.match(msg, /aucun compilateur C\+\+ trouvé/);
  assert.match(msg, /g\+\+-1 → /);
  assert.match(msg, /g\+\+-2 → /);
  assert.match(msg, /CXX=/);
});

test("échec de compilation : commande, répertoire, code, stdout ET stderr sont dans le message", () => {
  const msg = formatFailure("compilation impossible", report({ stdout: "sortie standard", stderr: "a.cpp:3: error: boom" }), "linux");
  for (const part of ["compilation impossible", "g++ -std=c++11 a.cpp -o a.exe", "C:/x", "code de sortie : 1", "sortie standard", "a.cpp:3: error: boom", "--- stdout ---", "--- stderr ---"]) assert.ok(msg.includes(part), part);
});

test("Windows : conseils sur CXX avec « / » et sur la DLL MinGW (0xC0000135) ; pas de conseil Windows ailleurs", () => {
  const win = hintFor(report({ status: 3221225781 }), "win32");
  assert.match(win, /0xC0000135/);
  assert.match(win, /C:\\msys64\\mingw64\\bin/);
  assert.match(win, /CXX=C:\/msys64/);
  assert.doesNotMatch(hintFor(report(), "linux"), /MinGW|msys64/);
});

test("lancement impossible (ENOENT) et mémoire (ENOMEM) : cause nommée ; aucune sortie : conseil de relancer à la main", () => {
  const enoent = Object.assign(new Error("spawn g++ ENOENT"), { code: "ENOENT" }) as NodeJS.ErrnoException;
  const enomem = Object.assign(new Error("uv_os_get_passwd ENOMEM"), { code: "ENOMEM" }) as NodeJS.ErrnoException;
  assert.match(hintFor(report({ spawnError: enoent, status: null })), /introuvable/);
  assert.match(hintFor(report({ spawnError: enomem, status: null })), /ENOMEM/);
  assert.match(formatFailure("t", report({ spawnError: enomem, status: null }), "linux"), /erreur de lancement : ENOMEM/);
  assert.match(hintFor(report({ stdout: "", stderr: "", status: 2 })), /aucune sortie/);
});

test("runProcess : un programme inexistant produit un rapport (pas d'exception), arguments à espaces entre guillemets", () => {
  const r = runProcess("/chemin/inexistant/prog", ["avec espace", "simple"]);
  assert.ok(r.spawnError, "erreur de lancement renseignée");
  assert.match(r.command, /"avec espace" simple/);
});
