// tests/otaDistribution.test.ts — distribution OTA SERVEUR (18/10/2026), pure et INACTIVE : défi HMAC, signature d'appareil Ed25519, annonce bornée, ordre des contrôles (aucun Redis avant l'étape 6),
// registre statique de releases, contrôle de pré-publication. Les clés sont éphémères (générées en mémoire) ; rien n'est déployé, aucune route de /api/pull n'est modifiée.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { generateKeyPairSync, sign as cryptoSign, createPublicKey } from "node:crypto";
import { canonicalManifestBytes, type OtaManifest } from "../lib/otaManifest";
import { buildSignedFile, checkOffer, regionSha256 } from "../lib/otaTrailer";
import {
  OTA_ANNOUNCE_MAX_JSON, OTA_CLIENT_FIRMWARE, OTA_FILE_OVERHEAD, otaClientCapable, otaImagePath, otaAnnouncement, otaChallenge, otaFetchMessage, otaImageResponse, parseFetchQuery, pickRelease, verifyOtaChallenge,
  familyOfFirmware, type FetchDeps, type OtaRelease,
} from "../lib/otaDistribution";
import { probeUrl, interpret } from "../scripts/ota-probe-release";
import { checkPublication, containsSecret, loadAllReleases, loadReleaseDir, trustedKeysFromEnv } from "../lib/otaReleases";

const root = path.join(__dirname, "..");
const SECRET = "s".repeat(40), NOW = Date.UTC(2026, 9, 18, 12, 0, 0);
const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 }), rsaB = generateKeyPairSync("rsa", { modulusLength: 2048 });
const pubPem = (k: typeof rsa) => k.publicKey.export({ type: "spki", format: "pem" }).toString();
const KEYS = { "ota-a": pubPem(rsa), "ota-b": pubPem(rsaB) };
const ed = generateKeyPairSync("ed25519"), edOther = generateKeyPairSync("ed25519");
const rawPub = (k: typeof ed) => (k.publicKey.export({ type: "spki", format: "der" }) as Buffer).subarray(-32).toString("hex");
const edSign = (k: typeof ed, msg: string) => cryptoSign(null, Buffer.from(msg), k.privateKey).toString("hex");
const DEVICE = "dev_ABCD1234", OTHER_DEVICE = "dev_ZZZZ9999";

function makeRelease(seq: number, over: Record<string, unknown> = {}, imageText = "image-firmware-factice-".repeat(40), signer = rsa, keyId = "ota-a"): { manifest: OtaManifest; file: Buffer; releaseId: string } {
  const version = `tft18-2.${4 + seq}`, releaseId = `tft18-2.${4 + seq}-ota${seq}`;
  const built = buildSignedFile(Buffer.from(imageText), { otaSeq: seq, family: "esp8266-tft18", firmwareVersion: version }, signer.privateKey.export({ type: "pkcs8", format: "pem" }));
  const body: Record<string, unknown> = {
    schema: "pod-ota-manifest-v2", releaseId, family: "esp8266-tft18", profile: { board: "esp8266", screen: "tft18", flash: "4M2M" }, channel: "stable", firmwareVersion: version,
    otaSeq: seq, minOtaSeq: 1, revokedSeqs: [], url: `/firmware/${releaseId}/image.bin`, size: built.region.length, sha256: regionSha256(built.region), wave: { of: 100, upTo: 100 }, ...over,
  };
  const sig = cryptoSign("sha256", canonicalManifestBytes(body as unknown as OtaManifest), signer.privateKey).toString("base64");
  return { manifest: { ...body, signature: { alg: "rsa2048-pkcs1-sha256", keyId, sig } } as unknown as OtaManifest, file: built.file, releaseId };
}
function writeRelease(rootDir: string, r: ReturnType<typeof makeRelease>) {
  const d = path.join(rootDir, r.releaseId); fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, "manifest.json"), JSON.stringify(r.manifest)); fs.writeFileSync(path.join(d, "image.bin"), r.file); return d;
}
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "otadist-"));
const R5 = makeRelease(5);
const device = (o: Partial<{ deviceId: string; firmware: string; otaSeq: number; publicKey: string }> = {}) => ({ deviceId: DEVICE, firmware: "tft18-2.7", publicKey: rawPub(ed), ...o });

// ── défi ──────────────────────────────────────────────────────────────────────────────────────────────
test("défi : déterministe, lié à l'appareil, à la release et à l'expiration ; toute altération est refusée", () => {
  const exp = 1_800_000_000, c = otaChallenge(SECRET, DEVICE, "r1", exp);
  assert.match(c, /^[0-9a-f]{64}$/); assert.equal(c, otaChallenge(SECRET, DEVICE, "r1", exp));
  assert.ok(verifyOtaChallenge(SECRET, DEVICE, "r1", exp, c));
  for (const [d, r, e] of [[OTHER_DEVICE, "r1", exp], [DEVICE, "r2", exp], [DEVICE, "r1", exp + 1]] as const) assert.equal(verifyOtaChallenge(SECRET, d, r, e, c), false);
  assert.equal(verifyOtaChallenge("t".repeat(40), DEVICE, "r1", exp, c), false);
  assert.equal(verifyOtaChallenge(SECRET, DEVICE, "r1", exp, c.toUpperCase()), false); assert.equal(verifyOtaChallenge(SECRET, DEVICE, "r1", exp, "zz"), false);
  assert.throws(() => otaChallenge("court", DEVICE, "r1", exp));
});

// ── annonce ──────────────────────────────────────────────────────────────────────────────────────────
const ann = (o: Partial<Parameters<typeof otaAnnouncement>[0]> = {}) => otaAnnouncement({ mode: "on", secret: SECRET, killed: false, manifests: [R5.manifest], device: device(), now: NOW, ...o });
test("annonce : bornée (≤ 200 o de JSON), complète pour les contrôles de l'appareil, défi valide", () => {
  const a = ann()!; assert.ok(a);
  assert.ok(JSON.stringify(a).length <= OTA_ANNOUNCE_MAX_JSON, `${JSON.stringify(a).length} o`);
  assert.equal(a.r, R5.releaseId); assert.equal(a.s, 5); assert.equal(a.z, R5.manifest.size); assert.equal(a.k, 0); assert.equal("u" in a, false, "l'URL n'est pas annoncée : elle est dérivée de r"); assert.equal(otaImagePath(a.r), R5.manifest.url);
  assert.ok(verifyOtaChallenge(SECRET, DEVICE, a.r, a.e, a.c)); assert.equal(a.e, Math.floor(NOW / 1000) + 1800);
  // l'appareil accepte l'offre construite depuis l'annonce (miroir de podota::checkOffer)
  assert.equal(checkOffer({ family: "esp8266-tft18", firmwareVersion: a.v, otaSeq: a.s, minOtaSeq: a.m, size: a.z, keySlot: a.k, urlPath: otaImagePath(a.r) }, { family: "esp8266-tft18", installedSeq: 4, maxStage: 700_000 }), "OK");
});
test("annonce : AUCUNE si inactive, sans secret, interrupteur d'urgence, déjà à jour, mauvaise famille, firmware inconnu, canari non listé, hors vague, pas encore active", () => {
  assert.equal(ann({ mode: "off" }), null); assert.equal(ann({ secret: null }), null); assert.equal(ann({ killed: true }), null);
  assert.equal(ann({ device: device({ firmware: R5.manifest.firmwareVersion }) }), null, "déjà à cette version");
  assert.equal(ann({ device: device({ firmware: "eink29bwr-2.3" }) }), null, "autre famille");
  assert.equal(ann({ device: device({ firmware: "inconnu" }) }), null);
  const canary = makeRelease(6, { channel: "canary", canaryDevices: ["dev_AAAAAAAA"] });
  assert.equal(ann({ manifests: [canary.manifest] }), null, "canari : appareil non listé");
  assert.ok(ann({ manifests: [canary.manifest], device: device({ deviceId: "dev_AAAAAAAA" }) }));
  const wave0 = makeRelease(7, { wave: { of: 100, upTo: 0 } }); assert.equal(ann({ manifests: [wave0.manifest] }), null, "vague 0 %");
  const later = makeRelease(8, { activatesAt: new Date(NOW + 3600_000).toISOString() }); assert.equal(ann({ manifests: [later.manifest] }), null);
  assert.equal(ann({ manifests: [] }), null);
});
test("annonce : la release la plus récente éligible gagne ; une révocation ne rétrograde jamais", () => {
  const r6 = makeRelease(6); assert.equal(pickRelease([R5.manifest, r6.manifest], device(), NOW)?.otaSeq, 6);
  assert.equal(pickRelease([r6.manifest, R5.manifest], device(), NOW)?.otaSeq, 6);
  assert.equal(familyOfFirmware("tft18-2.4"), "esp8266-tft18"); assert.equal(familyOfFirmware("eink29bwr-2.3"), ""); assert.equal(familyOfFirmware("constructor-1.1"), "");
});

// ── requête ──────────────────────────────────────────────────────────────────────────────────────────
const SIG = "a".repeat(128), CH = "b".repeat(64);
test("requête : exactement d, e, c, g dans cet ordre, formats stricts", () => {
  assert.equal(parseFetchQuery(`?d=${DEVICE}&e=1800000000&c=${CH}&g=${SIG}`).ok, true);
  for (const bad of ["", `?e=1&d=${DEVICE}&c=${CH}&g=${SIG}`, `?d=${DEVICE}&e=1&c=${CH}&g=${SIG}&x=1`, `?d=dev_abc&e=1&c=${CH}&g=${SIG}`, `?d=${DEVICE}&e=1&c=${"B".repeat(64)}&g=${SIG}`, `?d=${DEVICE}&e=1&c=${CH}&g=${"a".repeat(127)}`, `?d=${DEVICE}&e=&c=${CH}&g=${SIG}`, `?d=${DEVICE}&e=1&c=${CH}&g=${SIG}%20`])
    assert.equal(parseFetchQuery(bad).ok, false, bad);
});

// ── route : ordre des contrôles et coût Redis ──────────────────────────────────────────────────────────
function deps(over: Partial<FetchDeps> = {}) {
  const calls = { killed: 0, pre: 0, rate: 0, device: 0, release: 0 };
  const exp = Math.floor(NOW / 1000) + 600, ch = otaChallenge(SECRET, DEVICE, R5.releaseId, exp);
  const sig = edSign(ed, otaFetchMessage(DEVICE, R5.releaseId, exp, ch));
  const d: FetchDeps = {
    mode: "on", secret: SECRET, trustedKeysPresent: true, now: NOW, releaseId: R5.releaseId, fileName: "image.bin", rawSearch: `?d=${DEVICE}&e=${exp}&c=${ch}&g=${sig}`,
    loadRelease: (id) => { calls.release++; return id === R5.releaseId ? { manifest: R5.manifest, file: R5.file } : null; },
    isKilled: async () => { calls.killed++; return false; }, preLimitOk: async () => { calls.pre++; return true; }, rateLimitOk: async () => { calls.rate++; return true; },
    loadDevice: async () => { calls.device++; return { publicKey: rawPub(ed), firmware: "tft18-2.4" }; }, log: () => {}, ...over,
  };
  return { d, calls, exp, ch, sig };
}
const redisCalls = (c: { killed: number; pre: number; rate: number; device: number }) => c.killed + c.pre + c.rate + c.device;
test("route : succès — octets EXACTS du fichier signé, jamais de cache partagé", async () => {
  const { d, calls } = deps(); const r = await otaImageResponse(d);
  assert.equal(r.status, 200); assert.equal(r.headers.get("Cache-Control"), "private, no-store"); assert.equal(r.headers.get("Content-Length"), String(R5.file.length));
  assert.ok(Buffer.from(await r.arrayBuffer()).equals(R5.file)); assert.equal(r.headers.get("X-Ota-Seq"), "5");
  assert.deepEqual(calls, { killed: 1, pre: 1, rate: 1, device: 1, release: 1 }, "au plus 4 appels Redis par téléchargement (interrupteur, limite par IP, appareil, quota)");
});
test("route : tout refus AVANT l'étape 6 coûte ZÉRO commande Redis ; chaque refus a le bon statut et n'est jamais mis en cache", async () => {
  const cases: Array<[string, Partial<FetchDeps>, number]> = [
    ["mode off", { mode: "off" }, 404], ["secret absent", { secret: null }, 404], ["clés de confiance absentes", { trustedKeysPresent: false }, 404],
    ["autre nom de fichier", { fileName: "firmware.bin" }, 404], ["release mal formée", { releaseId: "../x" }, 404],
    ["requête", { rawSearch: "?d=x" }, 400], ["release inconnue", { releaseId: "inconnue" }, 403],   // le défi est lié à la release : release différente ⇒ défi invalide
  ];
  for (const [name, over, status] of cases) { const { d, calls } = deps(over); const r = await otaImageResponse(d); assert.equal(r.status, status, name); assert.equal(redisCalls(calls), 0, name); assert.equal(r.headers.get("Cache-Control"), "no-store", name); }
  { const x = deps(); const r = await otaImageResponse({ ...x.d, now: NOW + 3600_000 }); assert.equal(r.status, 410); assert.equal(redisCalls(x.calls), 0); }
  { const x = deps(); const r = await otaImageResponse({ ...x.d, rawSearch: x.d.rawSearch.replace(/&c=[0-9a-f]{2}/, "&c=00") }); assert.equal(r.status, 403); assert.equal(redisCalls(x.calls), 0, "défi altéré"); }
  { const x = deps({ loadRelease: () => null }); const r = await otaImageResponse(x.d); assert.equal(r.status, 404); assert.equal(redisCalls(x.calls), 0); }
});
test("route : défi d'un AUTRE appareil, signature d'une autre clé, appareil inconnu ou sans clé, interrupteur d'urgence, limite de débit, déjà à jour, autre famille", async () => {
  const x = deps();
  const otherDev = otaChallenge(SECRET, OTHER_DEVICE, R5.releaseId, x.exp);
  let r = await otaImageResponse({ ...x.d, rawSearch: `?d=${DEVICE}&e=${x.exp}&c=${otherDev}&g=${x.sig}` }); assert.equal(r.status, 403, "défi émis pour un autre appareil");
  const forged = edSign(edOther, otaFetchMessage(DEVICE, R5.releaseId, x.exp, x.ch));
  r = await otaImageResponse({ ...x.d, rawSearch: `?d=${DEVICE}&e=${x.exp}&c=${x.ch}&g=${forged}` }); assert.equal(r.status, 403, "signature d'une autre clé (connaît le deviceId, pas la clé privée)");
  const wrongMsg = edSign(ed, otaFetchMessage(DEVICE, R5.releaseId, x.exp + 1, x.ch));
  r = await otaImageResponse({ ...x.d, rawSearch: `?d=${DEVICE}&e=${x.exp}&c=${x.ch}&g=${wrongMsg}` }); assert.equal(r.status, 403, "signature d'un autre message");
  r = await otaImageResponse(deps({ loadDevice: async () => null }).d); assert.equal(r.status, 403);
  r = await otaImageResponse(deps({ loadDevice: async () => ({ firmware: "tft18-2.4" }) }).d); assert.equal(r.status, 403, "appareil sans clé publique enregistrée");
  const k = deps({ isKilled: async () => true }); r = await otaImageResponse(k.d); assert.equal(r.status, 503); assert.equal(r.headers.get("Retry-After"), "3600"); assert.equal(k.calls.device, 0, "coupé avant toute lecture d'appareil");
  const pl = deps({ preLimitOk: async () => false }); r = await otaImageResponse(pl.d); assert.equal(r.status, 429); assert.equal(pl.calls.device, 0, "limite par IP avant toute lecture d'appareil"); assert.equal(pl.calls.rate, 0); assert.equal(r.headers.get("Retry-After"), "600");
  const rl = deps({ rateLimitOk: async () => false }); r = await otaImageResponse(rl.d); assert.equal(r.status, 429, "quota épuisé par des téléchargements authentifiés"); assert.equal(rl.calls.device, 1); assert.equal(r.headers.get("Retry-After"), "3600");
  r = await otaImageResponse(deps({ loadDevice: async () => ({ publicKey: rawPub(ed), firmware: R5.manifest.firmwareVersion }) }).d); assert.equal(r.status, 403, "déjà à jour");
  r = await otaImageResponse(deps({ loadDevice: async () => ({ publicKey: rawPub(ed), firmware: "eink29bwr-2.3" }) }).d); assert.equal(r.status, 403, "autre famille");
});

test("QUOTA : des signatures invalides (défi valide) ne consomment JAMAIS le quota de l'appareil ; la requête légitime qui suit garde ses 3 téléchargements", async () => {
  let quota = 0, pre = 0; const LIMIT = 3, PRE = 20;
  const x = deps({ preLimitOk: async () => ++pre <= PRE, rateLimitOk: async () => ++quota <= LIMIT });
  const bad = (sig: string) => ({ ...x.d, rawSearch: `?d=${DEVICE}&e=${x.exp}&c=${x.ch}&g=${sig}` });
  const forged = edSign(edOther, otaFetchMessage(DEVICE, R5.releaseId, x.exp, x.ch));
  for (let i = 0; i < 8; i++) { const r = await otaImageResponse(bad(i % 2 ? forged : "0".repeat(128))); assert.equal(r.status, 403, "signature invalide #" + i); }
  assert.equal(quota, 0, "aucune signature invalide n'a touché au quota de l'appareil");
  for (let i = 1; i <= 3; i++) { const r = await otaImageResponse(x.d); assert.equal(r.status, 200, "téléchargement légitime " + i); }
  assert.equal(quota, 3); const r4 = await otaImageResponse(x.d); assert.equal(r4.status, 429, "le quota reste un vrai plafond pour les téléchargements authentifiés");
});
test("LIMITE PAR IP : l'abus non authentifié est freiné (429 avant toute lecture d'appareil ni vérification Ed25519) sans toucher au quota de l'appareil", async () => {
  let pre = 0, quota = 0, dev = 0; const x = deps({ preLimitOk: async () => ++pre <= 20, rateLimitOk: async () => { quota++; return true; }, loadDevice: async () => { dev++; return { publicKey: rawPub(ed), firmware: "tft18-2.4" }; } });
  const forged = edSign(edOther, otaFetchMessage(DEVICE, R5.releaseId, x.exp, x.ch)); const bad = { ...x.d, rawSearch: `?d=${DEVICE}&e=${x.exp}&c=${x.ch}&g=${forged}` };
  const codes: number[] = []; for (let i = 0; i < 30; i++) codes.push((await otaImageResponse(bad)).status);
  assert.equal(codes.filter((c) => c === 403).length, 20); assert.equal(codes.filter((c) => c === 429).length, 10); assert.equal(dev, 20, "au-delà de la limite : 0 lecture d'appareil"); assert.equal(quota, 0);
});

// ── registre de releases & publication ──────────────────────────────────────────────────────────────────
test("registre : une release valide est chargée ; chaque incohérence la fait REFUSER (image altérée, taille, url, mauvaise clé, dossier, version non votante)", () => {
  const t = tmp(); const dir = writeRelease(t, R5);
  assert.deepEqual(loadReleaseDir(dir, KEYS).errors, []); assert.ok(loadReleaseDir(dir, KEYS).release);
  const tamper = (f: (b: Buffer) => Buffer) => { const r = makeRelease(5); const d2 = writeRelease(tmp(), { ...r, file: f(Buffer.from(r.file)) }); return loadReleaseDir(d2, KEYS); };
  assert.ok(tamper((b) => { b[3] ^= 1; return b; }).errors.length, "octet de l'image altéré");
  assert.ok(tamper((b) => b.subarray(0, b.length - 1)).errors.length, "fichier tronqué");
  assert.ok(tamper((b) => Buffer.concat([b, Buffer.from([0])])).errors.length, "octet en trop");
  const bad = (over: Record<string, unknown>, signer = rsa, keyId = "ota-a") => loadReleaseDir(writeRelease(tmp(), makeRelease(5, over, undefined, signer, keyId)), KEYS);
  assert.ok(bad({ url: "/firmware/ailleurs/image.bin" }).errors.length, "url ≠ /firmware/<releaseId>/image.bin");
  assert.ok(bad({}, rsaB, "ota-a").errors.length, "manifeste signé par la mauvaise clé");
  assert.ok(bad({ firmwareVersion: "tft18-1.0" }).errors.length, "version qui ne sait pas voter");
  assert.ok(bad({ sha256: "0".repeat(64) }).errors.length, "SHA-256 du manifeste faux");
  { const r = makeRelease(5); const d = path.join(tmp(), "mauvais-nom"); fs.mkdirSync(d); fs.writeFileSync(path.join(d, "manifest.json"), JSON.stringify(r.manifest)); fs.writeFileSync(path.join(d, "image.bin"), r.file); assert.ok(loadReleaseDir(d, KEYS).errors.length, "dossier ≠ releaseId"); }
  const all = loadAllReleases(t, KEYS); assert.equal(all.releases.length, 1);
});
test("clés de confiance : seulement des clés PUBLIQUES RSA-2048 aux créneaux ota-a / ota-b ; une clé privée, une RSA-1024, un autre créneau → tout est refusé", () => {
  const ok = trustedKeysFromEnv({ OTA_TRUSTED_KEYS: JSON.stringify(KEYS) } as unknown as NodeJS.ProcessEnv); assert.deepEqual(Object.keys(ok ?? {}), ["ota-a", "ota-b"]);
  const priv = rsa.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const rsa1024 = generateKeyPairSync("rsa", { modulusLength: 1024 }), ec = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  for (const v of [JSON.stringify({ "ota-a": priv }), JSON.stringify({ "ota-a": pubPem(rsa1024 as unknown as typeof rsa) }), JSON.stringify({ "ota-c": KEYS["ota-a"] }), JSON.stringify({ "ota-a": ec.publicKey.export({ type: "spki", format: "pem" }).toString() }), "pas du json", "{}", ""])
    assert.equal(trustedKeysFromEnv({ OTA_TRUSTED_KEYS: v } as unknown as NodeJS.ProcessEnv), null, v.slice(0, 30));
  assert.equal(trustedKeysFromEnv({} as unknown as NodeJS.ProcessEnv), null);
  assert.equal(createPublicKey(KEYS["ota-a"]).type, "public");
});
test("pré-publication : séquence strictement croissante, aucun identifiant Wi-Fi dans l'image, première diffusion stable large refusée sans canari", () => {
  const W10 = { wave: { of: 100, upTo: 10 } }; const R5w = makeRelease(5, W10);
  const t = tmp(); writeRelease(t, R5w);
  assert.deepEqual(checkPublication(t, R5w.releaseId, KEYS).errors, []);
  const r6 = makeRelease(6, W10); writeRelease(t, r6); assert.deepEqual(checkPublication(t, r6.releaseId, KEYS).errors, []);
  const dup = makeRelease(6, { releaseId: "tft18-2.10-autre", ...W10 }); dup.manifest.url = "/firmware/tft18-2.10-autre/image.bin";
  // même séquence qu'une release existante : refusé (re-signature du manifeste avec l'url corrigée)
  const body = { ...dup.manifest } as Record<string, unknown>; delete body.signature; body.releaseId = "tft18-2.10-autre"; body.url = "/firmware/tft18-2.10-autre/image.bin";
  const sig = cryptoSign("sha256", canonicalManifestBytes(body as unknown as OtaManifest), rsa.privateKey).toString("base64");
  writeRelease(t, { manifest: { ...body, signature: { alg: "rsa2048-pkcs1-sha256", keyId: "ota-a", sig } } as unknown as OtaManifest, file: dup.file, releaseId: "tft18-2.10-autre" });
  assert.ok(checkPublication(t, "tft18-2.10-autre", KEYS).errors.some((e) => /strictement supérieur/.test(e)));
  const leaky = makeRelease(9, W10, "firmware avec SECRET_WIFI_SSID dedans " + "x".repeat(200)); const t2 = tmp(); writeRelease(t2, leaky);
  assert.ok(checkPublication(t2, leaky.releaseId, KEYS).errors.some((e) => /SECRET_WIFI/.test(e)));
  const leaky2 = makeRelease(9, W10, "...MonSsidSecret..." + "x".repeat(200)); const t3 = tmp(); writeRelease(t3, leaky2);
  assert.ok(checkPublication(t3, leaky2.releaseId, KEYS, ["MonSsidSecret", null]).errors.some((e) => /identifiant Wi-Fi/.test(e)));
  assert.equal(containsSecret(Buffer.from("abc"), ["abc"]), false, "secret de moins de 4 o ignoré");
  const t4 = tmp(); writeRelease(t4, R5); assert.ok(checkPublication(t4, R5.releaseId, KEYS).errors.some((e) => /canary/.test(e)), "stable à 100 % sans canari antérieur : refusé");
});

// ── garde-fous de câblage ──────────────────────────────────────────────────────────────────────────────
const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8").replace(/\r\n/g, "\n");
export function distributionViolations(src: string): string[] {
  const v: string[] = []; const code = src.replace(/\/\/.*$/gm, "");
  const i = code.indexOf("export async function otaImageResponse"); const f = code.slice(i);
  const pos = (s: string) => f.indexOf(s);
  if (pos("verifyOtaChallenge(") < 0 || pos("verifyOtaChallenge(") > pos("d.isKilled()")) v.push("le défi n'est plus vérifié AVANT Redis");
  if (pos("q.exp * 1000 <= d.now") < 0 || pos("q.exp * 1000 <= d.now") > pos("d.isKilled()")) v.push("l'expiration n'est plus vérifiée avant Redis");
  if (pos("d.isKilled()") < 0 || pos("d.isKilled()") > pos("d.preLimitOk(")) v.push("l'interrupteur d'urgence doit précéder la limite par IP");
  if (pos("d.preLimitOk(") < 0 || pos("d.preLimitOk(") > pos("d.loadDevice(")) v.push("la limite par IP (non authentifiée) doit précéder la lecture d'appareil");
  if (pos("d.rateLimitOk(") < 0 || pos("d.rateLimitOk(") < pos("verifyEd25519(")) v.push("le quota de l'appareil ne doit être compté QU'APRÈS la signature d'appareil");
  if (pos("d.rateLimitOk(") < pos("pickRelease(")) v.push("le quota de l'appareil ne doit pas être consommé par un appareil non éligible");
  if (!/if \(!HEX128\.test\(q\.sig\) \|\| !verifyEd25519\(dev\.publicKey, otaFetchMessage\(/.test(f) || pos("verifyEd25519(") > pos("pickRelease(")) v.push("la signature d'appareil n'est plus vérifiée avant l'éligibilité");
  if (!/"Cache-Control": "private, no-store"/.test(f)) v.push("l'image peut être mise en cache partagé");
  if (!/d\.mode !== "on" \|\| !d\.secret \|\| !d\.trustedKeysPresent/.test(f)) v.push("la route n'est plus inactive par défaut");
  if (/PRIVATE|privateKey|signManifest|cryptoSign/.test(code)) v.push("une clé privée / une signature apparaît côté serveur");
  return v;
}
test("contrat structurel de lib/otaDistribution.ts + 8 mutants", () => {
  const src = read("lib/otaDistribution.ts"); assert.deepEqual(distributionViolations(src), []);
  const muts: Array<[string, string, string]> = [
    ["défi après Redis", "if (!verifyOtaChallenge(d.secret, q.deviceId, d.releaseId, q.exp, q.challenge)) return fail(\"défi invalide\", 403);", "/* défi retiré */"],
    ["expiration retirée", "if (q.exp * 1000 <= d.now) return fail(\"défi expiré\", 410);", ""],
    ["limite par IP avant interrupteur", "if (await d.isKilled())", "if (!(await d.preLimitOk())) return fail(\"x\", 429); if (await d.isKilled())"],
    ["quota compté AVANT la signature (le défaut audité)", "const dev = await d.loadDevice(q.deviceId);", "if (!(await d.rateLimitOk(q.deviceId))) return fail(\"x\", 429); const dev = await d.loadDevice(q.deviceId);"],
    ["signature d'appareil retirée", "if (!HEX128.test(q.sig) || !verifyEd25519(dev.publicKey,", "if (false && !verifyEd25519(dev.publicKey,"],
    ["cache public", "\"Cache-Control\": \"private, no-store\"", "\"Cache-Control\": \"public, max-age=3600\""],
    ["active par défaut", "d.mode !== \"on\" || !d.secret || !d.trustedKeysPresent", "false"],
    ["clé privée côté serveur", "export const OTA_CHALLENGE_DOMAIN", "const privateKey = 1; export const OTA_CHALLENGE_DOMAIN"],
  ];
  for (const [name, a, b] of muts) { assert.ok(src.includes(a), "motif absent : " + name); assert.notDeepEqual(distributionViolations(src.replace(a, () => b)), [], `mutant survivant : ${name}`); }
});
test("branchement : /api/pull appelle la distribution SEULEMENT derrière OTA_DIST_MODE (kill-switch dans le MGET existant, registre importé dynamiquement) ; /api/register et /api/ping n'y touchent pas ; la route n'a aucune clé privée", () => {
  for (const f of ["app/api/register/route.ts", "app/api/ping/route.ts"]) assert.doesNotMatch(read(f), /otaDistribution|otaReleases|otaRegistry|OTA_DIST/, f);
  const pull = read("app/api/pull/route.ts");
  assert.match(pull, /const otaOn = otaDistModeFromEnv\(\) === "on";/);
  assert.match(pull, /\.\.\.\(otaOn \? \[OTA_KILL_KEY\] : \[\]\),/, "ota:kill n'est une clé du MGET que si le mode est on");
  assert.match(pull, /await import\("@\/lib\/otaRegistry"\)/, "les releases ne sont chargées que dans la branche active");
  assert.doesNotMatch(pull, /from "@\/lib\/otaRegistry"|from "@\/lib\/otaReleases"/, "aucun import statique du registre");
  const route = read("app/firmware/[release]/[file]/route.ts");
  assert.doesNotMatch(route, /PRIVATE|privateKey/); assert.match(route, /redis\.get\(OTA_KILL_KEY\)/); assert.match(route, /otaDistModeFromEnv\(\)/);
  assert.equal(OTA_FILE_OVERHEAD, 260);
});

// ── outil de publication hors ligne ──────────────────────────────────────────────────────────────────────
import { signRelease } from "../scripts/ota-release-sign";
test("publication hors ligne : release signée, contrôlée, relue par le registre ; aucune clé privée écrite ; refus : clés dans le dépôt, image avec identifiants, réécriture", () => {
  const kd = tmp(), out = tmp();
  fs.writeFileSync(path.join(kd, "release-a.private.pem"), rsa.privateKey.export({ type: "pkcs8", format: "pem" })); fs.writeFileSync(path.join(kd, "release-a.public.pem"), KEYS["ota-a"]);
  const img = path.join(tmp(), "generique.bin"); fs.writeFileSync(img, Buffer.from("firmware-generique-".repeat(50)));
  const o = { image: img, family: "esp8266-tft18", version: "tft18-2.6", seq: 3, channel: "canary" as const, canaryDevices: [DEVICE], keySlot: "a" as const, keysDir: kd, out };
  const r = signRelease(o); assert.deepEqual(r.check.errors, []); assert.ok(r.check.ok); assert.equal(r.releaseId, "tft18-2.6-ota3");
  const loaded = loadReleaseDir(r.dir, { "ota-a": KEYS["ota-a"] }); assert.deepEqual(loaded.errors, []); assert.equal(loaded.release?.manifest.otaSeq, 3);
  for (const f of fs.readdirSync(r.dir)) assert.doesNotMatch(fs.readFileSync(path.join(r.dir, f)).toString("latin1"), /PRIVATE KEY/, "aucune clé privée dans la release");
  assert.throws(() => signRelease(o), /existe déjà/);
  assert.throws(() => signRelease({ ...o, seq: 4, keysDir: path.join(root, "ota-lab") }), /dans le dépôt/);
  const dirty = path.join(tmp(), "sale.bin"); fs.writeFileSync(dirty, Buffer.from("x".repeat(100) + "SECRET_WIFI_SSID"));
  assert.throws(() => signRelease({ ...o, seq: 5, image: dirty }), /SECRET_WIFI/);
  const dirty2 = path.join(tmp(), "sale2.bin"); fs.writeFileSync(dirty2, Buffer.from("x".repeat(100) + "MonSsidSecret"));
  assert.throws(() => signRelease({ ...o, seq: 6, image: dirty2, secrets: ["MonSsidSecret"] }), /identifiant Wi-Fi/);
  assert.equal(signRelease({ ...o, seq: 7, version: "tft18-1.0" }).check.ok, false, "version qui ne sait pas voter : le contrôle de pré-publication échoue");
});

test("annonce : réservée aux firmwares QUI LISENT `ota` (tft18 >= 2.7) et aux appareils ayant une clé publique ; un ancien firmware reçoit exactement la réponse d'avant", () => {
  for (const fw of ["tft18-2.6", "tft18-2.4", "tft18-1.9", "tft18-2.7abc", "tft18-2.7-x", "multiscreen-2.7", "r4tft28-2.7", ""]) assert.equal(ann({ device: device({ firmware: fw }) }), null, fw);
  for (const fw of ["tft18-2.7", "tft18-2.10", "tft18-3.0", "tft18-2.7.1"]) assert.ok(otaClientCapable(fw), fw);
  assert.deepEqual(OTA_CLIENT_FIRMWARE, { tft18: [2, 7] }, "toute nouvelle famille cliente est une décision explicite");
  assert.equal(ann({ device: device({ publicKey: undefined }) }), null, "sans clé publique : l'appareil ne pourrait pas signer son téléchargement");
  assert.equal(ann({ device: device({ publicKey: "zz" }) }), null);
});
test("annonce : compte l'octet — la taille réelle du JSON (mesurée) laisse de la marge au document ArduinoJson du firmware", () => {
  const a = ann()!; const n = JSON.stringify(a).length;
  assert.ok(n >= 150 && n <= OTA_ANNOUNCE_MAX_JSON, `${n} o`);
});
test("annonce : un appareil déjà à la séquence de la release (otaSeq déclaré) ou plus récent n'est pas invité", () => {
  assert.equal(ann({ device: device({ otaSeq: 5 }) }), null); assert.equal(ann({ device: device({ otaSeq: 9 }) }), null); assert.ok(ann({ device: device({ otaSeq: 4 }) }));
});

test("SONDE DE PRÉSENCE (scripts/ota-probe-release.ts) : défi forgé + signature fausse ⇒ la réponse dit si la release est CHARGÉE ; un 400 ne le prouve pas", async () => {
  const BASE = "https://exemple.invalid";
  const run = async (over: Partial<FetchDeps> = {}, secret = SECRET) => {
    const x = deps(over); const u = new URL(probeUrl(BASE, R5.releaseId, DEVICE, secret, NOW));
    const r = await otaImageResponse({ ...x.d, rawSearch: u.search }); const error = String(((await r.json()) as { error?: string }).error ?? "");
    return { status: r.status, text: interpret(r.status, error), calls: x.calls };
  };
  const closed = await run({ isKilled: async () => true }); assert.equal(closed.status, 503); assert.match(closed.text, /^PRÉSENTE.*FERMÉE/); assert.equal(closed.calls.device, 0, "porte fermée : la signature n'est jamais examinée, aucune lecture d'appareil");
  const open = await run(); assert.equal(open.status, 403); assert.match(open.text, /^PRÉSENTE.*OUVERTE/);
  const absent = await run({ loadRelease: () => null }); assert.equal(absent.status, 404); assert.match(absent.text, /^ABSENTE/); assert.equal(absent.calls.killed, 0, "release absente : 0 commande Redis");
  const inactive = await run({ mode: "off" }); assert.equal(inactive.status, 404); assert.match(inactive.text, /^INACTIVE/);
  const wrong = await run({}, "autre-secret-".repeat(4)); assert.equal(wrong.status, 403); assert.match(wrong.text, /^INCONCLUANT.*OTA_TICKET_SECRET/);
  const bare = await otaImageResponse({ ...deps().d, rawSearch: "" }); assert.equal(bare.status, 400, "une requête sans paramètres répond 400 que la release existe ou non : ce n'est PAS une preuve de présence");
  const noParams = await otaImageResponse({ ...deps({ loadRelease: () => null }).d, rawSearch: "" }); assert.equal(noParams.status, 400);
  assert.doesNotMatch(probeUrl(BASE, R5.releaseId, DEVICE, SECRET, NOW), /autre|SECRET/);
});
