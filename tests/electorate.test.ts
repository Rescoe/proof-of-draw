// LOT 2 (28/10/2026) — l'électorat expliqué : qui compte dans le quorum, pourquoi les autres sont exclus, et le résumé BORNÉ figé dans le candidat.
// Reproduit l'état réel lu en lecture seule le 27/10 (8 appareils, un seul compté) pour que le « réseau de 1 » ne soit plus jamais un mystère.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { exclusionReason, summarizePool, poolSummaryText, readPoolSummary, type DeviceLike } from "../lib/electorate";
import { expiredReason } from "../lib/rejectedArchive";

const NOW = Date.UTC(2026, 9, 27, 11, 40);
const W = 45 * 60_000;
const MIN = 60_000;
const ON = {} as unknown as NodeJS.ProcessEnv;
const dev = (over: Partial<DeviceLike> = {}): DeviceLike => ({ screens: ["eink29bwr"], firmware: "eink29bwr-2.12", artistName: "x", lastPing: NOW - 5 * MIN, missedVotes: 0, ...over });

test("exclusionReason : chaque état a UNE raison, dans l'ordre non appairé > inactif > capteur seul > firmware incapable > manques ; un appareil sain est compté", () => {
  assert.equal(exclusionReason(dev(), NOW, W, ON), null);
  assert.equal(exclusionReason(dev({ artistName: undefined, artistId: undefined }), NOW, W, ON), "not-paired");
  assert.equal(exclusionReason(dev({ lastPing: NOW - 901 * MIN }), NOW, W, ON), "inactive");
  assert.equal(exclusionReason(dev({ screens: ["sensor"], firmware: "r4dht22-1.3" }), NOW, W, ON), "sensor-only");
  assert.equal(exclusionReason(dev({ firmware: "2.0" }), NOW, W, ON), "firmware-not-capable");
  assert.equal(exclusionReason(dev({ missedVotes: 3 }), NOW, W, ON), "missed-votes");
  assert.equal(exclusionReason(dev({ missedVotes: 2 }), NOW, W, ON), null, "deux manques ne suffisent plus");
  assert.equal(exclusionReason(dev({ missedVotes: 1 }), NOW, W, { QUORUM_MAX_MISSED: "1" } as unknown as NodeJS.ProcessEnv), "missed-votes", "le seuil historique reste réglable");
  // priorité : un appareil inactif ET non appairé est « non appairé » ; inactif ET sans vote capable est « inactif »
  assert.equal(exclusionReason(dev({ artistName: undefined, lastPing: 0 }), NOW, W, ON), "not-paired");
  assert.equal(exclusionReason(dev({ firmware: "2.0", lastPing: 0 }), NOW, W, ON), "inactive");
});

test("RÉEL du 27/10 : 8 appareils lus, un seul compté — le résumé dit pourquoi, et le plancher de 1 n'est pas pris pour un validateur", () => {
  const devices: (DeviceLike | null)[] = [
    dev({ screens: ["tft18"], firmware: "tft18-2.10", lastPing: NOW - 901 * MIN, missedVotes: 1 }),
    dev({ firmware: "r4eink29-1.2", lastPing: NOW - 1388 * MIN, missedVotes: 1 }),
    dev({ firmware: "2.0", lastPing: NOW - 30560 * MIN }),
    dev({ screens: ["tft28"], firmware: "r4tft28-2.6", lastPing: NOW - 1403 * MIN, missedVotes: 1 }),
    dev({ screens: ["tft18"], firmware: "r4tft18-2.3", lastPing: NOW - 15 * MIN }),            // la station : comptée
    dev({ screens: ["oled096", "eink27bw"], firmware: "multiscreen-2.8", lastPing: NOW - 11 * MIN, missedVotes: 3 }),   // active mais exclue (animations impossibles à voter)
    dev({ firmware: "eink29bwr-2.12", lastPing: NOW - 1404 * MIN, missedVotes: 1 }),
    dev({ firmware: "eink29bwr-2.12", lastPing: NOW - 742 * MIN, missedVotes: 1 }),
    null,
  ];
  const { count, summary } = summarizePool(devices, NOW, W, ON);
  assert.equal(count, 1);
  assert.deepEqual(summary, { total: 8, counted: 1, floor: false, excluded: { inactive: 6, "missed-votes": 1 }, maxMissed: 3, animV3: 0, at: NOW });
  assert.equal(poolSummaryText(summary), "1 compté(s) sur 8 : 6 inactif, 1 exclu après des manques ; 0 capable(s) de voter une animation v3");
  // aucun appareil compté : le « 1 » est un PLANCHER, et le résumé le dit
  const none = summarizePool(devices.filter((_, i) => i !== 4), NOW, W, ON);
  assert.equal(none.count, 1);
  assert.equal(none.summary.floor, true);
  assert.equal(none.summary.counted, 0);
  assert.match(poolSummaryText(none.summary), /aucun appareil compté sur 7 \(plancher de 1\) : 6 inactif, 1 exclu après des manques ; 0 capable/);
  assert.equal(summarizePool([], NOW, W, ON).summary.floor, true);
});

test("le résumé est BORNÉ et sans secret : clés fixes, aucun identifiant, taille < 200 octets ; readPoolSummary refuse tout le reste", () => {
  const { summary } = summarizePool([dev(), dev({ lastPing: 0 }), dev({ missedVotes: 9 })], NOW, W, ON);
  assert.deepEqual(Object.keys(summary).sort(), ["animV3", "at", "counted", "excluded", "floor", "maxMissed", "total"]);
  assert.ok(JSON.stringify(summary).length < 200);
  assert.deepEqual(readPoolSummary(JSON.parse(JSON.stringify(summary))), summary);
  for (const bad of [null, undefined, 3, "x", {}, { ...summary, total: -1 }, { ...summary, floor: "oui" }, { ...summary, counted: 1.5 }, { ...summary, at: "x" }, { ...summary, total: 10 ** 9 }]) assert.equal(readPoolSummary(bad), null, JSON.stringify(bad));
  const dirty = readPoolSummary({ ...summary, deviceIds: ["dev_AAAAAAAA"], excluded: { ...summary.excluded, secret: 5, inactive: 2 } });
  assert.ok(dirty && !("deviceIds" in dirty) && !("secret" in dirty.excluded), "les champs inconnus sont ignorés");
});

test("« Rejetés » : le motif d'un candidat expiré explique l'électorat figé au dépôt (et reste lisible sans résumé : anciens candidats)", () => {
  const { summary } = summarizePool([dev({ screens: ["tft18"], firmware: "r4tft18-2.3" }), dev({ lastPing: 0 })], NOW, W, ON);
  const withPool = expiredReason({ candidateId: "c", deviceId: "d", poolScreen: "tft18", drawScore: 1, score: 1, poolSize: 1, submittedAt: NOW - 41 * MIN, pool: summary } as never, NOW);
  assert.match(withPool, /réseau de 1 validateur\(s\), 1 vote\(s\) nécessaire\(s\)/);
  assert.match(withPool, /électorat au dépôt : 1 compté\(s\) sur 2 : 1 inactif/);
  assert.match(withPool, /41 min sans décision/);
  const old = expiredReason({ candidateId: "c", deviceId: "d", poolScreen: "tft18", drawScore: 1, score: 1, poolSize: 3, submittedAt: NOW - 10 * MIN } as never, NOW);
  assert.equal(old.includes("électorat au dépôt"), false);
});

test("branchement : le décompte du quorum passe par lib/electorate.ts (source unique), le candidat porte `pool`, aucune commande Redis de plus", () => {
  const root = path.join(__dirname, "..");
  const ds = fs.readFileSync(path.join(root, "lib/deviceStore.ts"), "utf8");
  assert.match(ds, /summarizePool\(devices, now, activeWindowMs\)/);
  assert.match(ds, /export async function getGlobalActiveCount[\s\S]{0,160}getGlobalPoolInfo/);
  const sc = fs.readFileSync(path.join(root, "app/api/submit-candidate/route.ts"), "utf8");
  assert.match(sc, /getGlobalPoolInfo\(\)/);
  assert.match(sc, /\.\.\.\(poolSummary \? \{ pool: poolSummary \} : \{\}\)/);
  // une seule lecture : getGlobalPoolInfo ne contient qu'un SMEMBERS et un MGET
  const body = ds.slice(ds.indexOf("export async function getGlobalPoolInfo"), ds.indexOf("export async function getGlobalActiveCount"));
  assert.equal((body.match(/redis\.smembers/g) ?? []).length, 1);
  assert.equal((body.match(/redis\.mget/g) ?? []).length, 1);
});
