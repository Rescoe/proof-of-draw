// tests/displayState.test.ts — « ce que chaque écran affiche réellement » : enregistrement à l'ACK, partage d'image,
// confidentialité des frames personnelles, budget de commandes Redis.
import test from "node:test";
import assert from "node:assert/strict";
import {
  buildShownRecord, recordDisplayed, readShownMap, readShownRecords, readShownImage, toPublicShown, imagePayloadOf,
  shownKey, shownImageKey, SHOWN_TTL_SEC, type DisplayKV,
} from "../lib/displayState";

/** Faux Redis qui trace chaque commande : les budgets sont des assertions. */
function fakeKV() {
  const data = new Map<string, string>();
  const log: string[] = [];
  const kv: DisplayKV = {
    async set(key, value, opts) {
      log.push(`SET ${key}${opts?.nx ? " NX" : ""}${opts?.ex ? ` EX${opts.ex}` : ""}`);
      if (opts?.nx && data.has(key)) return null;
      data.set(key, value);
      return "OK";
    },
    async mget(...keys) { log.push(`MGET ×${keys.length}`); return keys.map((k) => data.get(k) ?? null); },
    async get(key) { log.push(`GET ${key}`); return data.get(key) ?? null; },
  };
  return { kv, data, log };
}

const anaFrame = {
  frameId: "11111111-2222-3333-4444-555555555555", sourceDeviceId: "ana-bridge",
  payload: { screen: "tft18", buffer: "QUJD", workTitle: "Neon Pulse Canvas", drawArtistName: "Kori", anaKind: "generative-capture", blockHash: "ab".repeat(32), scene: { artifactIds: {} } },
};
const humanFrame = {
  frameId: "frame-human-1", sourceDeviceId: "consensus",
  payload: { screen: "eink29bwr", black: "QQ==", red: "Qg==", _block: { index: 42, artistName: "Léa", displayTime: 900, frameId: "x", minedAt: 1 } },
};

test("frame ANA : titre, artiste, nature de l'œuvre, bloc galerie — jamais le pointeur de scène", () => {
  const r = buildShownRecord(anaFrame, "tft18", "consensus", 1000)!;
  assert.equal(r.kind, "ana");
  assert.equal(r.workTitle, "Neon Pulse Canvas");
  assert.equal(r.artistName, "Kori");
  assert.equal(r.anaKind, "generative-capture");
  assert.equal(r.blockHash, "ab".repeat(32));
  assert.equal(r.hasImage, true);
  assert.equal(r.shownAt, 1000);
  assert.ok(!("scene" in r) && !JSON.stringify(r).includes("artifactIds"));
});

test("frame humaine validée : artiste et numéro de bloc lus dans _block", () => {
  const r = buildShownRecord(humanFrame, "eink29bwr", "consensus", 5)!;
  assert.equal(r.kind, "human");
  assert.equal(r.artistName, "Léa");
  assert.equal(r.blockIndex, 42);
  assert.equal(r.anaKind, undefined);
  assert.equal(r.blockHash, undefined);
});

test("entrées invalides : frameId absent / mal formé, blockHash invalide → rien d'inventé", () => {
  assert.equal(buildShownRecord({ payload: {} }, "oled096", "consensus", 1), null);
  assert.equal(buildShownRecord({ frameId: "x", payload: {} }, "oled096", "consensus", 1), null);
  assert.equal(buildShownRecord({ frameId: "../../etc/passwd" }, "oled096", "consensus", 1), null);
  const r = buildShownRecord({ ...anaFrame, payload: { ...anaFrame.payload, blockHash: "pas-un-hash" } }, "tft18", "consensus", 1)!;
  assert.equal(r.blockHash, undefined);
  const empty = buildShownRecord({ frameId: "frame-empty-1", sourceDeviceId: "consensus", payload: { screen: "oled096" } }, "oled096", "consensus", 1)!;
  assert.equal(empty.hasImage, false, "frame sans buffer : pas d'aperçu promis");
});

test("ACK d'un écran : 1 SET méta + 1 SET NX image, TTL partout, buffers seuls dans l'image", async () => {
  const { kv, data, log } = fakeKV();
  const rec = await recordDisplayed(kv, "dev_AAAA1111", "tft18", anaFrame, "consensus", undefined, 1234);
  assert.ok(rec);
  assert.equal(log.length, 2);
  assert.ok(log.includes(`SET ${shownKey("dev_AAAA1111", "tft18")} EX${SHOWN_TTL_SEC}`));
  assert.ok(log.includes(`SET ${shownImageKey(anaFrame.frameId, "tft18")} NX EX${SHOWN_TTL_SEC}`));
  assert.deepEqual(JSON.parse(data.get(shownImageKey(anaFrame.frameId, "tft18"))!), { screen: "tft18", buffer: "QUJD" });
  assert.ok(!data.get(shownImageKey(anaFrame.frameId, "tft18"))!.includes("workTitle"), "aucune métadonnée dans la copie d'image");
});

test("image PARTAGÉE : N appareils recevant le même frameId n'écrivent l'image qu'une fois", async () => {
  const { kv, data } = fakeKV();
  await recordDisplayed(kv, "dev_AAAA1111", "tft18", anaFrame, "consensus", undefined, 1);
  const first = data.get(shownImageKey(anaFrame.frameId, "tft18"));
  await recordDisplayed(kv, "dev_BBBB2222", "tft18", { ...anaFrame, payload: { ...anaFrame.payload, buffer: "AUTRE" } }, "consensus", undefined, 2);
  assert.equal(data.get(shownImageKey(anaFrame.frameId, "tft18")), first, "SET NX : la première copie fait foi");
  assert.ok(data.has(shownKey("dev_AAAA1111", "tft18")) && data.has(shownKey("dev_BBBB2222", "tft18")), "mais chaque appareil a sa méta");
});

test("CONFIDENTIALITÉ : une frame personnelle n'est jamais copiée ni décrite publiquement", async () => {
  const { kv, data, log } = fakeKV();
  const personal = { frameId: "frame-perso-1", payload: { screen: "oled096", buffer: "SECRET", workTitle: "Mon dessin privé" } };
  const rec = await recordDisplayed(kv, "dev_AAAA1111", "oled096", personal, "personal", undefined, 9);
  assert.equal(rec?.kind, "personal");
  assert.equal(log.length, 1, "méta seule, aucune copie d'image");
  assert.ok(![...data.values()].some((v) => v.includes("SECRET")), "le buffer privé n'est écrit nulle part");
  assert.ok(![...data.values()].some((v) => v.includes("Mon dessin privé")), "pas même le titre");
  const pub = toPublicShown(rec!);
  assert.equal(pub.frameId, null);
  assert.deepEqual(Object.keys(pub).sort(), ["frameId", "hasImage", "kind", "screen", "shownAt"]);
  assert.equal(await readShownImage(kv, personal.frameId, "oled096"), null);
});

test("mode « scene » transmis par le firmware est conservé ; une valeur absente n'ajoute rien", () => {
  assert.equal(buildShownRecord(anaFrame, "tft18", "consensus", 1, "scene")!.mode, "scene");
  assert.ok(!("mode" in buildShownRecord(anaFrame, "tft18", "consensus", 1)!));
});

test("lecture publique : UN SEUL MGET, uniquement les affichages AVEC image — privé et non confirmé absents", async () => {
  const { kv, log } = fakeKV();
  await recordDisplayed(kv, "dev_AAAA1111", "tft18", anaFrame, "consensus", undefined, 100);
  await recordDisplayed(kv, "dev_AAAA1111", "oled096", { frameId: "frame-perso-9", payload: { screen: "oled096" } }, "personal", undefined, 200);
  log.length = 0;

  const map = await readShownMap(kv, [
    { deviceId: "dev_AAAA1111", screen: "tft18" }, { deviceId: "dev_AAAA1111", screen: "oled096" },
    { deviceId: "dev_CCCC3333", screen: "eink27bw" },
  ]);
  assert.deepEqual(log, ["MGET ×3"], "une commande, quel que soit le nombre d'appareils");
  assert.equal(map.dev_AAAA1111.tft18.workTitle, "Neon Pulse Canvas");
  assert.equal(map.dev_AAAA1111.oled096, undefined, "frame personnelle : jamais exposée, pas même son existence");
  assert.equal(map.dev_CCCC3333, undefined);
  assert.deepEqual(await readShownMap(kv, []), {});

  // vue propriétaire : tout, y compris l'affichage personnel (frameId inclus) — 1 seul MGET aussi
  log.length = 0;
  const own = await readShownRecords(kv, [{ deviceId: "dev_AAAA1111", screen: "tft18" }, { deviceId: "dev_AAAA1111", screen: "oled096" }]);
  assert.deepEqual(log, ["MGET ×2"]);
  assert.equal(own.dev_AAAA1111.oled096.kind, "personal");
  assert.equal(own.dev_AAAA1111.oled096.frameId, "frame-perso-9");
  assert.equal(own.dev_AAAA1111.tft18.blockHash, "ab".repeat(32));
});

test("lecture tolérante : valeurs corrompues ignorées sans exception", async () => {
  const { kv, data } = fakeKV();
  data.set(shownKey("dev_AAAA1111", "tft18"), "{pas du json");
  data.set(shownKey("dev_AAAA1111", "oled096"), JSON.stringify({ n: "importe quoi" }));
  assert.deepEqual(await readShownMap(kv, [{ deviceId: "dev_AAAA1111", screen: "tft18" }, { deviceId: "dev_AAAA1111", screen: "oled096" }]), {});
});

test("image : lecture en 1 GET, frameId invalide refusé sans toucher Redis, écran incohérent refusé", async () => {
  const { kv, log } = fakeKV();
  await recordDisplayed(kv, "dev_AAAA1111", "eink29bwr", humanFrame, "consensus", undefined, 1);
  log.length = 0;
  const img = await readShownImage(kv, humanFrame.frameId, "eink29bwr");
  assert.deepEqual(img, { screen: "eink29bwr", black: "QQ==", red: "Qg==" });
  assert.deepEqual(log, [`GET ${shownImageKey(humanFrame.frameId, "eink29bwr")}`]);
  log.length = 0;
  assert.equal(await readShownImage(kv, "../x", "eink29bwr"), null);
  assert.equal(await readShownImage(kv, "a b c", "eink29bwr"), null);
  assert.deepEqual(log, [], "frameId invalide : aucune commande");
  assert.equal(await readShownImage(kv, humanFrame.frameId, "oled096"), null);
});

test("imagePayloadOf : n'extrait que les buffers", () => {
  assert.deepEqual(imagePayloadOf(humanFrame, "eink29bwr"), { screen: "eink29bwr", black: "QQ==", red: "Qg==" });
  assert.equal(imagePayloadOf({ payload: { screen: "x", workTitle: "t" } }, "x"), null);
});

test("un échec Redis n'est JAMAIS propagé (l'ACK du firmware doit réussir)", async () => {
  const kv: DisplayKV = { async set() { throw new Error("redis down"); }, async mget() { return []; }, async get() { return null; } };
  const originalError = console.error;
  console.error = () => {};
  try { assert.equal(await recordDisplayed(kv, "dev_AAAA1111", "tft18", anaFrame, "consensus"), null); }
  finally { console.error = originalError; }
});

// ── Lot 7.5 : rapport de rendu de l'appareil (artworkHash / renderHash / layoutVersion / cartelMode) — témoignage consigné, jamais voté, jamais public, 0 commande de plus ──
import fs from "node:fs";
import path from "node:path";
import { sanitizeRenderReport } from "../lib/displayState";

test("rapport de rendu : lecture STRICTE (hash hexadécimaux de 64 caractères, version 1..255, mode connu) ; tout le reste est ignoré, jamais d'erreur", () => {
  const h = "ab".repeat(32);
  assert.deepEqual(sanitizeRenderReport({ artworkHash: h, renderHash: "cd".repeat(32), layoutVersion: 1, cartelMode: "overlay" }), { artworkHash: h, renderHash: "cd".repeat(32), layoutVersion: 1, cartelMode: "overlay" });
  assert.deepEqual(sanitizeRenderReport({ renderHash: h }), { renderHash: h });
  for (const bad of [null, undefined, 5, "x", [], {}, { renderHash: "AB".repeat(32) }, { renderHash: "ab".repeat(31) }, { renderHash: 12 }, { layoutVersion: 0 }, { layoutVersion: 256 }, { layoutVersion: 1.5 }, { layoutVersion: "1" }, { cartelMode: "plein" }, { cartelMode: "OVERLAY" }, { deviceId: "dev_AAAA1111", frameId: "x" }])
    assert.equal(sanitizeRenderReport(bad), null, JSON.stringify(bad));
  assert.deepEqual(sanitizeRenderReport({ renderHash: h, layoutVersion: 999, cartelMode: "zz", extra: 1 }), { renderHash: h }, "les champs invalides sont écartés, les valides conservés");
});

test("le rapport est consigné dans l'enregistrement D'AFFICHAGE existant (mêmes 2 commandes), absent par défaut, JAMAIS dans la vue publique ni pour une frame personnelle", async () => {
  const render = { artworkHash: "ab".repeat(32), renderHash: "cd".repeat(32), layoutVersion: 1, cartelMode: "overlay" as const };
  const a = fakeKV();
  const rec = await recordDisplayed(a.kv, "dev_AAAA1111", "eink29bwr", humanFrame, "consensus", undefined, 99, render);
  assert.deepEqual(rec!.render, render); assert.equal(a.log.length, 2, "aucune commande de plus");
  assert.deepEqual(JSON.parse(a.data.get(shownKey("dev_AAAA1111", "eink29bwr"))!).render, render);
  const b = fakeKV();
  assert.equal((await recordDisplayed(b.kv, "dev_AAAA1111", "eink29bwr", humanFrame, "consensus", undefined, 99))!.render, undefined, "sans rapport : champ absent (firmwares actuels)");
  assert.equal("render" in toPublicShown(rec!), false, "jamais public");
  assert.equal((await readShownMap(a.kv, [{ deviceId: "dev_AAAA1111", screen: "eink29bwr" }])).dev_AAAA1111.eink29bwr.hasImage, true);
  assert.equal(JSON.stringify(await readShownMap(a.kv, [{ deviceId: "dev_AAAA1111", screen: "eink29bwr" }])).includes("renderHash"), false);
  assert.equal((await readShownRecords(a.kv, [{ deviceId: "dev_AAAA1111", screen: "eink29bwr" }])).dev_AAAA1111.eink29bwr.render?.renderHash, render.renderHash, "visible pour le propriétaire");
  const p = fakeKV();
  const priv = await recordDisplayed(p.kv, "dev_AAAA1111", "tft18", { frameId: "frame-priv-1", payload: { screen: "tft18", buffer: "QQ==" } }, "personal", undefined, 99, render);
  assert.equal(priv!.render, undefined, "une frame personnelle ne consigne rien de plus que son existence");
});

test("route d'ACK : lit le rapport par sanitizeRenderReport (jamais bloquant), le transmet à recordDisplayed, n'ajoute aucune commande Redis ; l'interface propriétaire l'affiche comme « jamais voté ni vérifié »", () => {
  const root = path.join(__dirname, "..");
  const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8").replace(/\r\n/g, "\n");
  const ack = read("app/api/ack-frame/route.ts");
  assert.match(ack, /const render = sanitizeRenderReport\(body\);/);
  assert.match(ack, /recordDisplayed\(redis as unknown as DisplayKV, deviceId, t\.screen, t\.frame, "consensus", mode, undefined, render\)/);
  assert.deepEqual([...ack.matchAll(/\bredis\.([a-z]+)[<(]/g)].map((m) => m[1]), ["mget", "del"], "commandes directes de la route inchangées : un MGET et un DEL (+ l'écriture de l'appareil et l'enregistrement d'affichage existants)");
  assert.match(read("app/profile/OwnDisplaysDebug.tsx"), /jamais voté ni vérifié par le serveur/);
  assert.doesNotMatch(read("lib/podVerify.ts") + read("lib/chain.ts"), /renderHash|artworkHash/, "le rapport de rendu n'entre ni dans le vote ni dans le bloc");
});
