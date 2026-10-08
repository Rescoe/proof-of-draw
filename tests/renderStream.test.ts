import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { compileHarness, describeChoice, findCompiler, runProcess } from "./helpers/cppHarness";

// Lot 8B-1 — NOYAU DE RENDU EN FLUX (consensus-pod/src/podRenderStream.h) : mêmes octets et mêmes hashes que la référence (228 vecteurs d'or) SANS grille logique complète.
// Hôte uniquement : jamais essayé sur une carte. Sans g++, la partie différentielle est IGNORÉE et le dit (jamais faussement verte).
const root = path.join(__dirname, "..");
const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8").replace(/\r\n/g, "\n");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
const choice = findCompiler();
console.log(`[podRenderStream] ${describeChoice(choice)}`);
const skip = choice.path ? false : `${describeChoice(choice)} — vérification différentielle du noyau de rendu en flux IGNORÉE (ni verte, ni réussie)`;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "podrenderstream-"));
const exe = path.join(tmp, process.platform === "win32" ? "render_stream_harness.exe" : "render_stream_harness");
const vectors = path.join(root, "consensus-pod", "test-vectors", "render-vectors.txt");
let compiled = false;
function ensureCompiled() { if (!compiled && choice.path) { console.log(`[podRenderStream] ${compileHarness(choice.path, path.join(root, "consensus-pod", "host", "render_stream_harness.cpp"), exe)}`); compiled = true; } }

test("NOYAU EN FLUX C++ (g++ -Wall -Wextra -Werror) == vecteurs d'or ET == référence à grille, octet par octet : e-ink 2 découpages, TFT 1,8″ ligne par ligne, sans traitement ; PLANS BRUTS pseudo-aléatoires (noir+rouge simultanés, RGB565 arbitraires, 3 modes, découpages traversant la frontière des plans) avec oracle indépendant ; paramètres invalides et entrées tronquées refusés", { skip }, () => {
  ensureCompiled();
  const r = runProcess(exe, [vectors]);
  assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
  const m = /^PASS (\d+) \(rvec=(\d+) flux=(\d+) raw=(\d+) retardSourceMax=(\d+) lignes\)$/m.exec(r.stdout);
  assert.ok(m, r.stdout);
  assert.ok(Number(m[1]) >= 3800 && Number(m[2]) >= 228 && Number(m[3]) >= 440 && Number(m[4]) >= 400, `vérifications : ${m[0]}`);
});

test("CONTRÔLE NÉGATIF : hash modifié, mode changé, n° de bloc changé, commande inconnue, ligne mal formée, mode inconnu, fichier vide → détectés", { skip }, () => {
  ensureCompiled();
  const lines = fs.readFileSync(vectors, "utf8").split("\n");
  const flip = (c: string) => (c === "0" ? "1" : "0");
  const cases: Array<[string, (l: string) => string]> = [
    ["frameHash", (l) => { const t = l.split(" "); t[9] = t[9].replace(/.$/, flip); return t.join(" "); }],
    ["renderHash", (l) => l.replace(/.$/, flip)],
    ["mode", (l) => { const t = l.split(" "); t[4] = t[4] === "fit" ? "overlay" : "fit"; return t.join(" "); }],
    ["n° de bloc", (l) => { const t = l.split(" "); t[5] = String(Number(t[5]) + 1); return t.join(" "); }],
  ];
  const eligible = (screen: string) => lines.map((l, i) => (l.startsWith(`rvec ${screen} `) && l.split(" ")[4] !== "hidden" ? i : -1)).filter((i) => i >= 0);
  for (const screen of ["eink29bwr", "eink27bw", "tft18"]) for (const [name, mutate] of cases) {
    let detected = false;
    for (const i of eligible(screen).slice(0, 6)) {
      const bad = [...lines]; bad[i] = mutate(bad[i]);
      if (bad[i] === lines[i]) continue;
      const f = path.join(tmp, `bad-${screen}-${name.replace(/\W/g, "")}-${i}.txt`); fs.writeFileSync(f, bad.join("\n"));
      const r = runProcess(exe, [f]);
      if (r.status === 1 && /ÉCART/.test(r.stdout)) { detected = true; break; }
    }
    assert.ok(detected, `${screen} / ${name} : la modification aurait dû être détectée`);
  }
  const w = (n: string, c: string) => { const f = path.join(tmp, n); fs.writeFileSync(f, c); return f; };
  assert.equal(runProcess(exe, [w("unknown.txt", "inconnue 1 2 3\n")]).status, 1);
  assert.equal(runProcess(exe, [w("malformed.txt", "rvec eink29bwr white\n")]).status, 1);
  assert.equal(runProcess(exe, [w("badmode.txt", "rvec eink29bwr white 1 diagonal 1 - - - " + "0".repeat(64) + " " + "0".repeat(64) + "\n")]).status, 1);
  assert.equal(runProcess(exe, [w("empty.txt", "# rien\n")]).status, 1, "fichier de vecteurs vide = échec");
});

test("portabilité : podRenderStream.h n'inclut que podRender.h ; ni String, ni allocation, ni printf, ni STL, ni E/S, ni Arduino.h, ni flottant, ni délai ; AUCUNE variable statique modifiable ; aucune fonction de grille (decode/encode/fit/burn/grid/pattern) ni pointeur de grille uint16_t*", () => {
  const src = strip(read("consensus-pod/src/podRenderStream.h"));
  for (const bad of [/\bString\b/, /\bmalloc\b|\bfree\(/, /\bnew\b|\bdelete\b/, /\bprintf\b|\bsnprintf\b/, /std::/, /#include <Arduino/, /\bSerial\b/, /\bdelay\(/, /\byield\(/, /\bWiFi/, /\bfetch\b/, /\bfloat\b|\bdouble\b/, /\bmillis\(/, /\bfopen\b|\bFILE\b/, /\bvirtual\b/])
    assert.doesNotMatch(src, bad, String(bad));
  assert.deepEqual([...src.matchAll(/#include\s+[<"]([^>"]+)[>"]/g)].map((m) => m[1]), ["podRender.h"]);
  assert.doesNotMatch(src, /^\s*static\s+(?!inline|const)[A-Za-z_0-9<> ]+\s+\w+(\[[^\]]*\])?\s*;/m, "aucune variable statique modifiable");
  assert.doesNotMatch(src, /\bpod_render_(decode|encode|fit|burn|grid|pattern|frame)\b/, "le noyau en flux n'appelle aucune fonction à grille");
  assert.doesNotMatch(src, /uint16_t\s*\*/, "aucun pointeur de grille uint16_t*");
  // tampons : aucun tableau local de plus de 256 octets (ligne TFT) — les seuls tableaux sont des lignes de texte (≤ 49), des préfixes de hash et des chiffres
  for (const m of src.matchAll(/\b(?:uint8_t|char|uint16_t)\s+\w+\[(\d+|[A-Z_]+)\]/g)) {
    const n = /^\d+$/.test(m[1]) ? Number(m[1]) : ({ POD_R_TEXT_MAX: 49, POD_R_MAX_ROW_BYTES: 256 } as Record<string, number>)[m[1]];
    assert.ok(n !== undefined && n <= 256, `tableau trop grand ou inconnu : ${m[0]}`);
  }
});

test("pas de grille dans la référence refactorée non plus : pod_render_bottom_line n'a plus de tampon temporaire (la pile de la R4 est de 1 Ko)", () => {
  const body = /static inline size_t pod_render_bottom_line[\s\S]*?\n\}/.exec(strip(read("consensus-pod/src/podRender.h")))![0];
  assert.doesNotMatch(body, /char\s+\w+\[POD_R_LINE_MAX\]/);
  assert.match(body, /char probe\[2\]/);
});

test("mesures de compilation ARCHIVÉES (docs/mesures/8B1_2026_10_07) : objets bornés, aucun tampon image ; ESP8266 ≤ 40 000 o de RAM statique ; pile de la bibliothèque documentée ; sondes jamais déployées", () => {
  const dir = "docs/mesures/8B1_2026_10_07";
  const sizes = read(`${dir}/tailles_objets_sondes.txt`);
  const size = (target: string, name: string) => { const m = new RegExp(`^${target} \\S+ ([0-9a-f]{8}) B ${name}$`, "m").exec(sizes); assert.ok(m, `${target} ${name}`); return parseInt(m[1], 16); };
  for (const target of ["ESP8266", "UNO_R4"]) {
    assert.ok(size(target, "PROBE_EINK") <= 300, `${target} PodEinkRenderer`);
    assert.ok(size(target, "PROBE_TFT") <= 448, `${target} PodTftRenderer`);
    assert.ok(size(target, "PROBE_FRAME") <= 160, `${target} PodFrameHasher`);
    assert.ok(size(target, "PROBE_PASS") <= 272, `${target} PodPassHasher`);
    assert.equal(size(target, "PROBE_LINE"), 52, "PodRLine : 49 + 1 + 2 octets, aligné");
  }
  const esp = read(`${dir}/compilation_esp_render.txt`);
  const used = Number(/RAM \(global, static\), used (\d+) \/ 80192/.exec(esp)![1]);
  assert.ok(used <= 40000, `RAM statique ESP8266 : ${used} o (règle 8 : ≤ 40 000)`);
  assert.match(read(`${dir}/compilation_r4_render.txt`), /Les variables globales utilisent \d+ octets/);
  // pile : les fonctions de la R4 (hors SHA) ne dépassent jamais 112 octets chacune, la plus profonde chaîne reste < 400 o (pile principale : 1 024 o)
  const frames = read(`${dir}/pile_r4_sans_inlining.txt`).split("\n").filter((l) => /^\d+\t/.test(l)).map((l) => Number(l.split("\t")[0]));
  const lib = frames.filter((n) => n !== Math.max(...frames));   // le plus grand cadre est setup() de la sonde, pas du noyau
  assert.ok(Math.max(...lib) <= 112, `plus grand cadre du noyau (R4) : ${Math.max(...lib)}`);
  // aucun firmware de production ne l'utilise ; seules les sondes (exemples « NE PAS DÉPLOYER ») l'incluent
  const walk = (d: string): string[] => fs.readdirSync(path.join(root, d), { withFileTypes: true }).flatMap((e) => e.name === "node_modules" || e.name === ".next" || e.name === ".claude" ? [] : e.isDirectory() ? walk(path.join(d, e.name)) : /\.(ino|h|cpp|ts|tsx)$/.test(e.name) ? [path.join(d, e.name)] : []);
  const users = ["esp8266", "arduino_uno_r4", "app", "lib", "consensus-pod", "scripts"].flatMap(walk).filter((f) => /podRenderStream/.test(fs.readFileSync(path.join(root, f), "utf8"))).map((f) => f.replace(/\\/g, "/")).sort();
  assert.deepEqual(users, [
    "consensus-pod/examples/RenderProbeEsp8266/RenderProbeEsp8266.ino", "consensus-pod/examples/RenderProbeUnoR4/RenderProbeUnoR4.ino", "consensus-pod/host/render_stream_harness.cpp",
    "consensus-pod/src/podRenderStream.h",
  ]);
  for (const ino of ["RenderProbeEsp8266/RenderProbeEsp8266.ino", "RenderProbeUnoR4/RenderProbeUnoR4.ino"]) assert.match(read(`consensus-pod/examples/${ino}`), /NE PAS DÉPLOYER[\s\S]*JAMAIS essayé sur la carte/);
});

test("CONTRÔLE NÉGATIF DU CODE : un noyau altéré (priorité du rouge inversée ; read() qui n'échoue plus sur sortie nulle ; frontière entre les plans décalée) est REFUSÉ par le harnais différentiel", { skip }, () => {
  const copy = path.join(tmp, "mutant"); fs.rmSync(copy, { recursive: true, force: true });
  for (const d of ["src", "host"]) fs.cpSync(path.join(root, "consensus-pod", d), path.join(copy, d), { recursive: true });
  const hdr = path.join(copy, "src", "podRenderStream.h"), orig = fs.readFileSync(hdr, "utf8");
  const mutations: Array<[string, string, string]> = [
    ["rouge", "if (src[1] && !((src[1][idx] >> bit) & 1)) return POD_R_RED;", "if (!((src[0][idx] >> bit) & 1)) return POD_R_BLACK;\n    if (src[1] && !((src[1][idx] >> bit) & 1)) return POD_R_RED;"],
    ["sortie nulle", "if (!out) { state = POD_RS_FAILED; return 0; }", "if (!out) return 0;"],
    ["frontiere des plans", "const int plane = pos >= perPlane ? 1 : 0;", "const int plane = pos > perPlane ? 1 : 0;"],
  ];
  for (const [name, from, to] of mutations) {
    assert.ok(orig.includes(from), `mutation « ${name} » : repère absent`);
    fs.writeFileSync(hdr, orig.split(from).join(to));
    const mexe = path.join(tmp, `mutant-${name.replace(/ /g, "_")}${process.platform === "win32" ? ".exe" : ""}`);
    compileHarness(choice.path!, path.join(copy, "host", "render_stream_harness.cpp"), mexe);
    const r = runProcess(mexe, [vectors]);
    assert.equal(r.status, 1, `mutation « ${name} » non détectée\n${r.stdout.slice(-300)}`);
    assert.match(r.stdout, /ÉCART/);
  }
});

test("documentation du lot 8B-1 : cohérente avec le correctif (plans bruts déjà livrés, plus « à ajouter »), structure intacte, § 8 présent", () => {
  const doc = read("docs/LOT_8B1_NOYAU_RENDU_FLUX_2026_10_07.md");
  assert.doesNotMatch(doc, /pourront être ajoutés/);
  assert.ok(doc.includes("Les 409 exécutions sur plans bruts (§ 8) étendent les vecteurs d'or structurés de 8A"));
  assert.ok(doc.includes("ni une mesure de temps, de pile ou de chien de garde sur carte"));
  const heads = doc.split("\n").filter((l) => /^#{1,2} /.test(l));
  assert.deepEqual(heads.slice(1).map((h) => h.slice(0, 5)), ["## 1.", "## 2.", "## 3.", "## 4.", "## 5.", "## 6.", "## 7.", "## 8."]);
  assert.equal(heads.filter((h) => h.startsWith("# ")).length, 1);
});
