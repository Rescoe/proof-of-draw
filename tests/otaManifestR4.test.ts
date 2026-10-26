// tests/otaManifestR4.test.ts — contrat du manifeste OTA R4 (ADR OTA-5) : format strict, signature Ed25519 avec séparation de domaine, politique d'appareil, binaire brut ; vérificateur INDÉPENDANT d'accord avec la référence ;
// MUTANTS de la référence TypeScript (retirer une garde fait dévier un cas). Aucune clé de production, aucun matériel.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { randomBytes } from "node:crypto";
import * as R4 from "@/lib/otaManifestR4";
import * as V2 from "@/lib/otaManifest";
import { buildNegatives, REF_DEVICE } from "../ota-lab/r4-ota5/tools/negatives.mjs";

const ROOT = path.join(import.meta.dirname, "..");
const bin = randomBytes(5000);
const kA = R4.generateTestKeyPair(), kB = R4.generateTestKeyPair();
const keys = { seeds: { "r4-a": kA.seedHex, "r4-b": kB.seedHex }, pubs: { "r4-a": kA.publicHex, "r4-b": kB.publicHex } };
type Case = { name: string; manifest: Buffer; binary: Buffer; expectWhy: string; note: string; device?: Record<string, unknown> };
const cases: Case[] = buildNegatives(bin, keys);
// Familles (26/10/2026) : écran 2,8″, écran 1,8″ + capteurs (vote), station capteur (sans vote). Jugées par la référence et par les mutants.
const famCase = (name: string, family: string, firmware: string, devFamily: string, expectWhy: string): Case => ({
  name, expectWhy, note: "familles R4", device: { family: devFamily }, binary: bin,
  manifest: R4.signR4Manifest({ family, firmware, seq: 6, channel: "canary", size: bin.length, sha256: R4.sha256Hex(bin), notbefore: 0, keyid: "r4-a" }, keys.seeds["r4-a"]),
});
const famCases: Case[] = [
  famCase("famille-capteur-ok", "uno-r4-wifi-sensor", "r4env-1.1", "uno-r4-wifi-sensor", "ok"),
  famCase("famille-capteur-firmware-quelconque", "uno-r4-wifi-sensor", "stationx-9.9", "uno-r4-wifi-sensor", "ok"),
  famCase("famille-ecran18-ok", "uno-r4-wifi-tft18", "r4tft18-2.0", "uno-r4-wifi-tft18", "ok"),
  famCase("famille-ecran18-firmware-sans-vote", "uno-r4-wifi-tft18", "r4tft18-1.0", "uno-r4-wifi-tft18", "vote-incompatible"),
  famCase("famille-capteur-sur-appareil-ecran", "uno-r4-wifi-sensor", "r4env-1.1", "uno-r4-wifi-tft18", "family"),
  famCase("famille-ecran-firmware-capteur", "uno-r4-wifi-tft28", "r4env-1.1", "uno-r4-wifi-tft28", "vote-incompatible"),
];

function judgeWith(mod: typeof R4, c: Case, full = false): string {
  const d = { ...REF_DEVICE, ...(c.device ?? {}) } as { family: string; installedSeq: number; channel: string; nowSeconds: number; keys?: string[] };
  const known: Record<string, string> = {}; for (const id of d.keys ?? ["r4-a", "r4-b"]) known[id] = keys.pubs[id as "r4-a"];
  const r = mod.evaluateR4Manifest(c.manifest, known, d);
  if (!r.ok) return full && r.detail ? `${r.why}:${r.detail}` : r.why;   // full : inclut le MOTIF précis d'un refus d'analyse (les mutants de l'analyse ne changent pas toujours le code `parse`)
  const b = mod.binaryMatchesR4(r.manifest!, c.binary);
  return b.ok ? "ok" : b.why;
}

test("référence : chaque cas négatif est refusé pour la raison attendue, la référence positive est acceptée", () => {
  assert.ok(cases.length >= 38, `jeu de cas : ${cases.length}`);
  for (const c of cases) assert.equal(judgeWith(R4, c), c.expectWhy, `${c.name} (${c.note})`);
});

test("familles : écran 2,8″ / écran 1,8″ (vote exigé) et station capteur (sans vote) jugés comme prévu", () => {
  for (const c of famCases) assert.equal(judgeWith(R4, c), c.expectWhy, c.name);
});

test("format : le manifeste signé a exactement 10 lignes dans l'ordre fixe, tient dans 512 o, ne contient que de l'ASCII", () => {
  const ok = cases.find((c) => c.name === "ok")!; const t = ok.manifest.toString("latin1");
  assert.deepEqual(t.split("\n").slice(0, 9).map((l) => l.split("=")[0]), ["schema", "family", "firmware", "seq", "channel", "size", "sha256", "notbefore", "keyid"]);
  assert.ok(ok.manifest.length <= 512 && /^sig=[0-9a-f]{128}\n$/.test(t.split("\n").slice(9).join("\n")));
  const p = R4.parseR4Manifest(ok.manifest); assert.ok(p.ok); assert.equal(p.body.toString("latin1") + `sig=${p.manifest.sig}\n`, t);
});

test("séparation : un manifeste R4 est refusé par le parseur OTA-1 v2 et un manifeste v2 par le parseur R4 ; clés de vote et d'OTA sans rapport", () => {
  const ok = cases.find((c) => c.name === "ok")!;
  assert.equal(V2.parseManifest(ok.manifest.toString("latin1")).ok, false, "le parseur v2 refuse un texte R4");
  const v2 = JSON.stringify({ schema: V2.OTA_SCHEMA }); assert.equal(R4.parseR4Manifest(v2).ok, false, "le parseur R4 refuse un JSON v2");
  assert.ok(R4.R4_DOMAIN.startsWith("POD-OTA-R4") && !/vote/i.test(R4.R4_DOMAIN));
  assert.equal(V2.OTA_SCHEMA, "pod-ota-manifest-v2", "OTA-1 inchangé"); assert.equal(V2.OTA_SIGNATURE_ALG, "rsa2048-pkcs1-sha256", "OTA-1 inchangé");
});

test("clé nulle (clé de test du dépôt) ou absente : tout est refusé, même un manifeste bien formé", () => {
  const ok = cases.find((c) => c.name === "ok")!;
  for (const k of [{} as Record<string, string>, { "r4-a": "0".repeat(64) }, { "r4-a": "xyz" }, { "r4-a": kB.publicHex }]) assert.equal(R4.evaluateR4Manifest(ok.manifest, k, REF_DEVICE).ok, false);
});

test("vérificateur INDÉPENDANT (outil CLI sans import de la référence) : même verdict accepté/refusé sur tous les cas qu'il sait juger", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "r4v-")); const skip = new Set(["firmware-sans-vote-v2", "firmware-inconnu"]);   // compatibilité de vote : politique de l'appareil, hors de l'outil
  for (const c of cases) {
    if (skip.has(c.name)) continue;
    const d = { ...REF_DEVICE, ...(c.device ?? {}) } as { family: string; installedSeq: number; channel: string; nowSeconds: number; keys?: string[] };
    const known: Record<string, string> = {}; for (const id of d.keys ?? ["r4-a", "r4-b"]) known[id] = keys.pubs[id as "r4-a"];
    writeFileSync(path.join(dir, "k.json"), JSON.stringify(known)); writeFileSync(path.join(dir, "m.txt"), c.manifest); writeFileSync(path.join(dir, "f.bin"), c.binary);
    let accepted = true, out = "";
    try { out = execFileSync(process.execPath, [path.join(ROOT, "ota-lab/r4-ota5/tools/verify-manifest.mjs"), path.join(dir, "m.txt"), "--bin", path.join(dir, "f.bin"), "--pub", path.join(dir, "k.json"), "--installed-seq", String(d.installedSeq), "--family", d.family, "--channel", d.channel, "--now", String(d.nowSeconds)], { encoding: "utf8" }); } catch (e) { accepted = false; out = String((e as { stdout?: string }).stdout ?? ""); }
    assert.equal(accepted, c.expectWhy === "ok", `${c.name} : ${out.trim()}`);
  }
});

// ── MUTANTS de la référence TypeScript ──
function mutantModule(find: string, repl: string): Promise<typeof R4> {
  const dir = mkdtempSync(path.join(tmpdir(), "r4m-")); let src = readFileSync(path.join(ROOT, "lib/otaManifestR4.ts"), "utf8");
  src = src.replace('import { voteV2Capable } from "@/lib/voteCapability";', 'const voteV2Capable = (f: string) => { const m = /^([a-z0-9]+)-(\\d+)\\.(\\d+)/.exec(f); return !!m && ((m[1] === "r4tft28" && (Number(m[2]) > 2 || (Number(m[2]) === 2 && Number(m[3]) >= 5))) || (m[1] === "r4tft18" && (Number(m[2]) > 1 || (Number(m[2]) === 1 && Number(m[3]) >= 1)))); };');
  if (!src.includes(find)) throw new Error("motif de mutant absent : " + find.slice(0, 60));
  const file = path.join(dir, "m.ts"); writeFileSync(file, src.replace(find, () => repl));
  return import(pathToFileURL(file).href + "?" + Math.random()) as Promise<typeof R4>;
}
const MUTANTS: [string, string, string][] = [
  ["séparation de domaine", 'export const R4_DOMAIN = "POD-OTA-R4-MANIFEST-V1\\n";', 'export const R4_DOMAIN = "";'],
  // (la garde « clé nulle » est une défense en profondeur : Node refuse déjà de vérifier avec la clé nulle ; son mutant est dans le test C++ de l'appareil)
  ["rejeu (seq <= installée)", "if (m.seq <= d.installedSeq)", "if (m.seq < d.installedSeq)"],
  ["borne de taille", "if (size < 1 || size > R4_MAX_SIZE)", "if (size < 1)"],
  ["activation différée", "if (m.notbefore > d.nowSeconds)", "if (false)"],
  ["compatibilité de vote", "&& !voteV2Capable(m.firmware))", "&& false)"],
  ["exemption de vote de la station capteur", "!(R4_NON_VOTING_FAMILIES as readonly string[]).includes(m.family) && ", ""],
  ["famille", "if (m.family !== d.family)", "if (false)"],
  ["canal", 'if (m.channel === "development" || m.channel !== d.channel)', "if (false)"],
  ["ordre des champs", "if (!l.startsWith(k + \"=\"))", "if (false)"],
  ["nombre de lignes", "if (lines.length !== ORDER.length + 1)", "if (false)"],
  ["fin de ligne", 'if (!text.endsWith("\\n"))', "if (false)"],
  ["ASCII", "if (!(b === 0x0a || (b >= 0x20 && b <= 0x7e)))", "if (false)"],
  ["zéros initiaux / format entier", "const UINT = /^(0|[1-9][0-9]{0,9})$/;", "const UINT = /^[0-9]{1,10}$/;"],
  ["borne de seq", "if (seq < 1 || seq > R4_MAX_SEQ)", "if (seq < 0)"],
  ["hash en minuscules", "const HEX = (n: number) => new RegExp(`^[0-9a-f]{${n}}$`);", "const HEX = (n: number) => new RegExp(`^[0-9a-fA-F]{${n}}$`);"],
  ["taille du binaire", "if (bin.length !== m.size)", "if (false)"],
  ["hash du binaire", "return sha256Hex(bin) === m.sha256 ?", "return true ?"],
  ["taille du manifeste", "buf.length > R4_MAX_MANIFEST_BYTES", "false"],
  ["schéma", "if (v.schema !== R4_SCHEMA)", "if (false)"],
  ["keyid", "if (!(R4_KEY_IDS as readonly string[]).includes(v.keyid))", "if (false)"],
];
test("MUTANTS de la référence TypeScript : retirer n'importe quelle garde fait dévier au moins un cas", async () => {
  for (const [name, find, repl] of MUTANTS) {
    const mod = await mutantModule(find, repl);
    const deviates = [...cases, ...famCases].some((c) => { try { return judgeWith(mod, c, true) !== judgeWith(R4, c, true); } catch { return true; } });
    assert.ok(deviates, `mutant survivant : ${name}`);
  }
});

test("outillage : les cas négatifs et les clés ne sont pas dans git ; make-manifest + verify-manifest + compare-staging de bout en bout", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "r4t-")); const keysDir = path.join(dir, "keys"), rel = path.join(dir, "rel");
  const tsx = ["--import", "tsx"]; const run = (f: string, a: string[]) => execFileSync(process.execPath, [...tsx, path.join(ROOT, "ota-lab/r4-ota5/tools", f), ...a], { encoding: "utf8", cwd: ROOT });
  run("keygen.mjs", ["--dir", keysDir]); assert.throws(() => run("keygen.mjs", ["--dir", keysDir]), /Command failed/, "refus d'écraser");
  writeFileSync(path.join(dir, "fw.bin"), bin);
  run("make-manifest.mjs", ["--bin", path.join(dir, "fw.bin"), "--seq", "7", "--firmware", "r4tft28-2.6", "--keys-dir", keysDir, "--out", rel]);
  const v = run("verify-manifest.mjs", [path.join(rel, "manifest.txt"), "--bin", path.join(rel, "firmware.bin"), "--pub", path.join(keysDir, "keys.json"), "--installed-seq", "6"]); assert.match(v, /ACCEPTÉ/);
  assert.throws(() => run("verify-manifest.mjs", [path.join(rel, "manifest.txt"), "--pub", path.join(keysDir, "keys.json"), "--installed-seq", "7"]), /Command failed/, "rejeu refusé");
  copyFileSync(path.join(rel, "firmware.bin"), path.join(dir, "relu.bin")); assert.match(run("compare-staging.mjs", [path.join(dir, "relu.bin"), path.join(dir, "fw.bin")]), /IDENTIQUES/);
  const bad = Buffer.from(bin); bad[100] ^= 1; writeFileSync(path.join(dir, "relu2.bin"), bad); assert.throws(() => run("compare-staging.mjs", [path.join(dir, "relu2.bin"), path.join(dir, "fw.bin")]), /Command failed/);
  const ig = execFileSync("git", ["check-ignore", "-q", "ota-lab/r4-ota5/artifacts/keys/r4-a.seed"], { cwd: ROOT }); assert.ok(ig !== undefined);
});
