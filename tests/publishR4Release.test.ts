// Publication d'une mise à jour OTA R4 (fichiers statiques public/firmware-r4/<kind>/<canal>/) : le script vérifie avant de copier, ne commite ni ne déploie rien.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, existsSync, readFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { generateTestKeyPair, signR4Manifest, sha256Hex } from "../lib/otaManifestR4";

const ROOT = path.join(__dirname, "..");
const TOOL = path.join(ROOT, "ota-lab/r4-ota5/tools/publish-r4-release.mjs");
const bin = Buffer.concat([Buffer.from([0xf0, 0x7f, 0x00, 0x20, 0x01, 0x41, 0x00, 0x00]), Buffer.from("PODWIFI:record-v1"), randomBytes(2000)]);   // vecteurs Cortex-M plausibles + marqueur « Wi-Fi hors binaire » (exigé par wifi-guard)
const FORBID = (() => { const d = mkdtempSync(path.join(tmpdir(), "r4forbid-")); const f = path.join(d, "forbidden.txt"); writeFileSync(f, "SsidDeTest-4242\nMotDePasseDeTest-777\n"); return f; })();
const kA = generateTestKeyPair();

function release(over: Partial<{ family: string; channel: string; firmware: string }> = {}, tamper = false) {
  const dir = mkdtempSync(path.join(tmpdir(), "r4pub-"));
  const m = signR4Manifest({ family: over.family ?? "uno-r4-wifi-tft18", firmware: over.firmware ?? "r4tft18-2.1", seq: 7, channel: over.channel ?? "canary", size: bin.length, sha256: sha256Hex(bin), notbefore: 0, keyid: "r4-a" }, kA.seedHex);
  writeFileSync(path.join(dir, "manifest.txt"), m);
  const b = Buffer.from(bin); if (tamper) b[500] ^= 1;
  writeFileSync(path.join(dir, "firmware.bin"), b);
  writeFileSync(path.join(dir, "keys.json"), JSON.stringify({ "r4-a": kA.publicHex }));
  return dir;
}
const run = (args: string[]) => { try { return { ok: true, out: execFileSync(process.execPath, ["--import", "tsx", TOOL, ...args], { encoding: "utf8", cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] }) }; } catch (e) { const x = e as { stderr?: Buffer | string; stdout?: Buffer | string }; return { ok: false, out: String(x.stderr ?? "") + String(x.stdout ?? "") }; } };

test("publication : une release valide est copiée dans public/firmware-r4/<kind>/<canal>/ (et nulle part ailleurs)", () => {
  const rel = release(); const pub = mkdtempSync(path.join(tmpdir(), "r4public-"));
  const r = run(["--kind", "tft18", "--channel", "canary", "--release", rel, "--pub", path.join(rel, "keys.json"), "--public", pub, "--forbid-file", FORBID]);
  assert.equal(r.ok, true, r.out);
  assert.match(r.out, /wifi-guard OK/);
  assert.ok(existsSync(path.join(pub, "firmware-r4/tft18/canary/manifest.txt")) && existsSync(path.join(pub, "firmware-r4/tft18/canary/firmware.bin")));
  assert.equal(readFileSync(path.join(pub, "firmware-r4/tft18/canary/firmware.bin")).length, bin.length);
  assert.match(r.out, /Rien n'est commité ni déployé/);
});

test("publication : refus — canal ≠ manifeste, famille ≠ kind, binaire altéré, canal development, kind inconnu, clé étrangère", () => {
  const pub = mkdtempSync(path.join(tmpdir(), "r4public-"));
  const refused = (rel: string, args: string[], why: RegExp, keys = path.join(rel, "keys.json")) => { const r = run(["--release", rel, "--pub", keys, "--public", pub, ...args]); assert.equal(r.ok, false, `devait être refusé : ${args.join(" ")}`); assert.match(r.out, why); };
  refused(release(), ["--kind", "tft18", "--channel", "stable"], /canal non éligible/);
  refused(release({ family: "uno-r4-wifi-sensor", firmware: "r4env-1.2" }), ["--kind", "tft18", "--channel", "canary"], /famille/);
  refused(release({}, true), ["--kind", "tft18", "--channel", "canary"], /binaire|sha|hash/i);
  refused(release({ channel: "development" }), ["--kind", "tft18", "--channel", "development"], /canary\|stable|jamais development/);
  refused(release(), ["--kind", "inconnu", "--channel", "canary"], /--kind/);
  const other = mkdtempSync(path.join(tmpdir(), "r4k-")); const kB = generateTestKeyPair(); writeFileSync(path.join(other, "keys.json"), JSON.stringify({ "r4-a": kB.publicHex }));
  refused(release(), ["--kind", "tft18", "--channel", "canary"], /signature/, path.join(other, "keys.json"));
  assert.equal(existsSync(path.join(pub, "firmware-r4")), false, "rien n'a été copié par un refus");
  mkdirSync(pub, { recursive: true });
});

test("publication : wifi-guard BLOQUE — binaire avec un identifiant Wi-Fi, sans marqueur « hors binaire », ou sans liste de valeurs interdites (échec fermé) ; rien n'est copié et aucune valeur n'est affichée", () => {
  const pub = mkdtempSync(path.join(tmpdir(), "r4public-"));
  const withBin = (b: Buffer) => {
    const dir = mkdtempSync(path.join(tmpdir(), "r4pub-"));
    writeFileSync(path.join(dir, "manifest.txt"), signR4Manifest({ family: "uno-r4-wifi-tft18", firmware: "r4tft18-2.9", seq: 15, channel: "canary", size: b.length, sha256: sha256Hex(b), notbefore: 0, keyid: "r4-a" }, kA.seedHex));
    writeFileSync(path.join(dir, "firmware.bin"), b); writeFileSync(path.join(dir, "keys.json"), JSON.stringify({ "r4-a": kA.publicHex }));
    return dir;
  };
  const go = (rel: string, extra: string[]) => run(["--kind", "tft18", "--channel", "canary", "--release", rel, "--pub", path.join(rel, "keys.json"), "--public", pub, ...extra]);
  const leaked = go(withBin(Buffer.concat([bin, Buffer.from("SsidDeTest-4242")])), ["--forbid-file", FORBID]);
  assert.equal(leaked.ok, false); assert.match(leaked.out, /wifi-guard/); assert.match(leaked.out, /PRÉSENTE/); assert.ok(!leaked.out.includes("SsidDeTest-4242"), "valeur secrète affichée");
  const nomark = go(withBin(Buffer.concat([Buffer.from([0xf0, 0x7f, 0x00, 0x20]), randomBytes(500)])), ["--forbid-file", FORBID]);
  assert.equal(nomark.ok, false); assert.match(nomark.out, /marqueur de Wi-Fi hors binaire absent/);
  const compiled = go(withBin(Buffer.concat([bin, Buffer.from("PODWIFI:compiled-v1")])), ["--forbid-file", FORBID]);
  assert.equal(compiled.ok, false); assert.match(compiled.out, /COMPILÉ/);
  const nolist = go(withBin(bin), []);
  if (!nolist.ok) assert.match(nolist.out, /aucune valeur interdite|PRÉSENTE/);   // sans liste fournie : refus fermé, sauf si le poste a un secrets.h / ~/.pod-wifi-forbidden.txt dont aucune valeur n'est dans l'image
  assert.equal(existsSync(path.join(pub, "firmware-r4")), false, "rien n'a été copié par un refus");
});

test("publication : le dossier public/firmware-r4 du dépôt ne contient AUCUNE release (publier = fusionner un commit, jamais un effet de bord)", () => {
  assert.equal(existsSync(path.join(ROOT, "public/firmware-r4")) ? readdirCount(path.join(ROOT, "public/firmware-r4")) : 0, 0);
});
function readdirCount(d: string): number { return require("node:fs").readdirSync(d).filter((n: string) => n !== ".gitkeep" && n !== "README.md").length; }
