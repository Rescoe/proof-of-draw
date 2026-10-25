// tests/otaPull.test.ts — annonce OTA dans /api/pull (20/10/2026) : COMPORTEMENT de la vraie route avec un Redis simulé (aucun réseau).
// Garanties testées : mode off = réponse ET liste de clés du MGET inchangées ; mode on = ZÉRO commande de plus (la clé ota:kill est une clé de plus DANS le MGET) ; un firmware qui ne lit pas `ota`
// reçoit octet pour octet la réponse d'avant ; kill-switch, secret absent, clés invalides, séquence déjà installée ⇒ pas d'annonce ; une erreur OTA n'altère jamais le pull.
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { generateKeyPairSync, sign as cryptoSign } from "node:crypto";
import { canonicalManifestBytes, type OtaManifest } from "../lib/otaManifest";
import { buildSignedFile, regionSha256 } from "../lib/otaTrailer";
import { verifyOtaChallenge } from "../lib/otaDistribution";

// ── Redis simulé (installé AVANT l'import de la route) ──────────────────────────────────────────────────────────────────────────────────
const calls: Array<{ cmd: string; args: unknown[] }> = [];
const store = new Map<string, unknown>();
const fake: Record<string, (...a: unknown[]) => unknown> = {
  mget: async (...keys) => { calls.push({ cmd: "mget", args: keys }); return keys.map((k) => store.get(String(k)) ?? null); },
};
const redisProxy = new Proxy({}, { get: (_t, p: string) => fake[p] ?? (async (...a: unknown[]) => { calls.push({ cmd: p, args: a }); return null; }) });
const redisPath = require.resolve("../lib/redis");
require.cache[redisPath] = { id: redisPath, filename: redisPath, loaded: true, exports: { redis: redisProxy } } as unknown as NodeJS.Module;

process.env.DEVICE_LOG = "off";   // le journal par appareil (lib/deviceLog.ts) ajoute UNE commande à un pull non répété : ce test mesure le pull SEUL
const ed = generateKeyPairSync("ed25519");
const pubHex = (ed.publicKey.export({ type: "spki", format: "der" }) as Buffer).subarray(-32).toString("hex");
const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 });
const DEVICE = "dev_ABCD1234", SECRET = "q".repeat(40);
const origCwd = process.cwd(), origRandom = Math.random;
const env0 = { ...process.env };
let offKeys = 0;

function makeRelease(seq: number) {
  const version = `tft18-2.${5 + seq}`, releaseId = `${version}-ota${seq}`;
  const built = buildSignedFile(Buffer.from("image-firmware-factice-".repeat(40)), { otaSeq: seq, family: "esp8266-tft18", firmwareVersion: version }, rsa.privateKey.export({ type: "pkcs8", format: "pem" }));
  const body = { schema: "pod-ota-manifest-v2", releaseId, family: "esp8266-tft18", profile: { board: "esp8266", screen: "tft18", flash: "4M2M" }, channel: "stable", firmwareVersion: version, otaSeq: seq, minOtaSeq: 1, revokedSeqs: [], url: `/firmware/${releaseId}/image.bin`, size: built.region.length, sha256: regionSha256(built.region), wave: { of: 100, upTo: 100 } };
  const sig = cryptoSign("sha256", canonicalManifestBytes(body as unknown as OtaManifest), rsa.privateKey).toString("base64");
  return { releaseId, manifest: { ...body, signature: { alg: "rsa2048-pkcs1-sha256", keyId: "ota-a", sig } }, file: built.file };
}
const REL = makeRelease(5);
let work = "";
before(() => {
  work = fs.mkdtempSync(path.join(os.tmpdir(), "otapull-"));
  const d = path.join(work, "ota-releases", REL.releaseId); fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, "manifest.json"), JSON.stringify(REL.manifest)); fs.writeFileSync(path.join(d, "image.bin"), REL.file);
  process.chdir(work);
  Math.random = () => 0.99;                                    // rate-limit échantillonné : jamais compté (aucune commande eval)
});
after(() => { process.chdir(origCwd); Math.random = origRandom; for (const k of Object.keys(process.env)) if (!(k in env0)) delete process.env[k]; Object.assign(process.env, env0); });

function setup(over: { firmware?: string; publicKey?: string | undefined; mode?: string; secret?: string | null; kill?: boolean; keys?: string | null } = {}) {
  store.clear(); calls.length = 0;
  const device = { deviceId: DEVICE, firmware: over.firmware ?? "tft18-2.7", publicKey: "publicKey" in over ? over.publicKey : pubHex, screens: ["tft18"], artistName: "x", lastPing: Date.now(), lastSeen: Date.now(), paired: true };
  store.set(`device:${DEVICE}`, JSON.stringify(device));
  if (over.kill) store.set("ota:kill", "1");
  if (over.mode === undefined) delete process.env.OTA_DIST_MODE; else process.env.OTA_DIST_MODE = over.mode;
  if (over.secret === null) delete process.env.OTA_TICKET_SECRET; else process.env.OTA_TICKET_SECRET = over.secret ?? SECRET;
  if (over.keys === null) delete process.env.OTA_TRUSTED_KEYS; else process.env.OTA_TRUSTED_KEYS = over.keys ?? JSON.stringify({ "ota-a": rsa.publicKey.export({ type: "spki", format: "pem" }).toString() });
}
async function pull(query = "") {
  const { resetOtaRegistryForTests } = await import("../lib/otaRegistry"); resetOtaRegistryForTests();
  const { NextRequest } = await import("next/server");
  const { GET } = await import("../app/api/pull/route");
  const res = await GET(new NextRequest(`http://localhost/api/pull?deviceId=${DEVICE}${query}`));
  const text = await res.text();
  return { status: res.status, text, body: JSON.parse(text) as Record<string, unknown> };
}
const mgets = () => calls.filter((c) => c.cmd === "mget");

test("mode off (défaut) : aucune annonce, la liste de clés du MGET est celle d'avant (sans ota:kill), UNE seule commande", async () => {
  setup({ mode: undefined });
  const r = await pull("&o=3");
  assert.equal(r.status, 200); assert.equal("ota" in r.body, false);
  assert.equal(calls.length, 1); assert.equal(mgets().length, 1);
  assert.equal(mgets()[0].args.includes("ota:kill"), false);
  offKeys = mgets()[0].args.length;
});

test("mode on + appareil capable + release destinée : annonce ≤ 200 o, valide, défi vérifiable ; MGET + 1 clé, TOUJOURS une seule commande Redis", async () => {
  setup({ mode: "on" });
  const r = await pull("&o=3");
  assert.equal(r.status, 200);
  const ota = r.body.ota as Record<string, unknown>; assert.ok(ota, "annonce présente");
  const json = JSON.stringify(ota); assert.ok(json.length <= 200, `${json.length} o`);
  assert.deepEqual(Object.keys(ota).sort(), ["c", "e", "k", "m", "r", "s", "v", "z"].sort());
  assert.equal(ota.r, REL.releaseId); assert.equal(ota.s, 5); assert.equal(ota.z, REL.manifest.size);
  assert.ok(verifyOtaChallenge(SECRET, DEVICE, ota.r as string, ota.e as number, ota.c as string));
  assert.equal(calls.length, 1, "aucune commande de plus : kill-switch lu dans le MGET existant");
  const keys = mgets()[0].args; assert.equal(keys.at(-1), "ota:kill"); assert.equal(keys.length, offKeys + 1);
  console.log(`[mesure] annonce OTA : ${json.length} o de JSON ; réponse de pull ${r.text.length} o avec / ${JSON.stringify({ ...r.body, ota: undefined }).length} o sans`);
});

test("firmware qui ne lit pas `ota` (tft18-2.6) : réponse OCTET POUR OCTET identique, mode on ou off", async () => {
  setup({ mode: undefined, firmware: "tft18-2.6" }); const off = await pull("&o=3");
  setup({ mode: "on", firmware: "tft18-2.6" });
  const on = await pull("&o=3");
  assert.equal(on.text, off.text); assert.equal("ota" in on.body, false);
});

test("kill-switch (ota:kill), secret absent, clés de confiance absentes ou invalides, séquence déjà installée, appareil sans clé : jamais d'annonce, le pull reste 200", async () => {
  const cases: Array<[string, Parameters<typeof setup>[0], string]> = [
    ["kill", { mode: "on", kill: true }, "&o=3"], ["secret absent", { mode: "on", secret: null }, "&o=3"], ["clés absentes", { mode: "on", keys: null }, "&o=3"],
    ["clé privée en config", { mode: "on", keys: JSON.stringify({ "ota-a": "-----BEGIN PRIVATE KEY-----\nxx\n-----END PRIVATE KEY-----" }) }, "&o=3"],
    ["déjà installée", { mode: "on" }, "&o=5"], ["plus récente installée", { mode: "on" }, "&o=9"], ["sans clé d'appareil", { mode: "on", publicKey: undefined }, "&o=3"], ["mode inconnu", { mode: "yes" }, "&o=3"],
  ];
  for (const [name, o, q] of cases) {
    setup(o); const r = await pull(q);
    assert.equal(r.status, 200, name); assert.equal("ota" in r.body, false, "CAS: " + name);
  }
});

test("`o` hostile ou absent : traité comme 0 (annonce possible), jamais d'erreur", async () => {
  for (const q of ["", "&o=", "&o=abc", "&o=-4", "&o=99999999999", "&o=3.5"]) { setup({ mode: "on" }); const r = await pull(q); assert.equal(r.status, 200, q); assert.ok(r.body.ota, q); }
});
