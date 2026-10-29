// UX jalon 4 (29/10/2026) — mesures : UNE lecture par appareil, UNE période pour toutes les grandeurs, un seul panneau partagé ; cache de session sûr (Promise partagée, clés privé/public disjointes).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { MEASURES_CACHE_TTL_MS, createSharedCache, measuresKey } from "../lib/measuresCache";

const read = (p: string) => fs.readFileSync(path.join(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");

test("cache : deux demandes SIMULTANÉES pour la même clé partagent une seule lecture", async () => {
  const cache = createSharedCache<string>();
  let calls = 0;
  const loader = () => { calls++; return new Promise<string>((r) => setTimeout(() => r("ok"), 5)); };
  const [a, b, c] = await Promise.all([cache.get("own:dev_A", loader), cache.get("own:dev_A", loader), cache.get("own:dev_A", loader)]);
  assert.deepEqual([a, b, c], ["ok", "ok", "ok"]);
  assert.equal(calls, 1);
  assert.equal(await cache.get("own:dev_A", loader), "ok");
  assert.equal(calls, 1, "rouvrir le même panneau ne relit rien tant que l'entrée est fraîche");
});

test("cache : clés privé / public DISJOINTES — une réponse privée n'est jamais servie à un appel public", async () => {
  assert.equal(measuresKey("dev_A", true), "own:dev_A");
  assert.equal(measuresKey("dev_A", false), "pub:dev_A");
  const cache = createSharedCache<string>();
  await cache.get(measuresKey("dev_A", true), async () => "PRIVÉ");
  let calls = 0;
  const pub = await cache.get(measuresKey("dev_A", false), async () => { calls++; return "PUBLIC"; });
  assert.equal(pub, "PUBLIC"); assert.equal(calls, 1);
  assert.equal(cache.has(measuresKey("dev_A", true)), true);
});

test("cache : expiration mesurable (2 min), invalidation explicite, un échec n'est jamais gardé", async () => {
  assert.equal(MEASURES_CACHE_TTL_MS, 120_000);
  let t = 1_000;
  const cache = createSharedCache<number>({ now: () => t });
  let n = 0;
  const loader = async () => ++n;
  assert.equal(await cache.get("k", loader), 1);
  t += MEASURES_CACHE_TTL_MS - 1;
  assert.equal(await cache.get("k", loader), 1, "encore frais à 1 ms de l'expiration");
  t += 2;
  assert.equal(await cache.get("k", loader), 2, "expiré : relu");
  cache.invalidate("k");
  assert.equal(cache.has("k"), false);
  assert.equal(await cache.get("k", loader), 3, "invalidé : relu");
  let boom = 0;
  await assert.rejects(cache.get("e", async () => { boom++; throw new Error("x"); }));
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(await cache.get("e", async () => { boom++; return 9; }), 9);
  assert.equal(boom, 2, "l'échec n'a pas été mis en cache");
});

test("câblage : le hook ignore un résultat tardif (démontage), invalide sur reload, n'a aucun polling ; une seule lecture dans le code", () => {
  const h = read("app/measures/useDeviceMeasures.ts");
  assert.ok(h.includes("let alive = true") && h.includes("alive = false"));
  assert.ok(h.includes("cache.invalidate(key)"));
  assert.ok(!/setInterval|setTimeout/.test(h), "aucun polling");
  assert.equal((h.match(/fetch\(/g) ?? []).length, 1, "un seul fetch dans le hook");
});

test("un seul panneau, une seule période : les quatre appelants passent par MeasuresPanel, plus aucun ne lit /api/sensor lui-même", () => {
  for (const f of ["app/profile/SensorPanel.tsx", "app/artists/[artistId]/ArtistSensors.tsx", "app/network/SidePanel.tsx", "app/network/ArtistPanel.tsx"]) {
    const s = read(f);
    assert.ok(s.includes("MeasuresPanel") || s.includes("useDeviceMeasures"), f);
    assert.ok(!s.includes("/api/sensor"), `${f} ne lit plus /api/sensor directement`);
    assert.ok(!s.includes("<MeasuresExplorer"), `${f} n'instancie plus MeasuresExplorer seul`);
  }
  const p = read("app/measures/MeasuresPanel.tsx");
  assert.equal((p.match(/useState<VizRange>/g) ?? []).length, 1, "UN seul état de période");
  assert.ok(p.includes("range={range} onRangeChange={setRange}"), "l'explorateur suit la période du panneau (son sélecteur interne est masqué)");
  assert.ok(p.includes("Relevés bruts") && p.includes("tableOnly"));
  const e = read("app/MeasuresExplorer.tsx");
  assert.ok(e.includes("{!controlled && ("), "pas de second sélecteur de période quand le parent la pilote");
  assert.ok(e.includes("given === undefined"), "aucune lecture quand les mesures sont fournies");
});

test("qualité de l'air : le panneau trace le niveau (vocidx) mais jamais le brut du SGP40", () => {
  const p = read("app/measures/MeasuresPanel.tsx");
  assert.ok(p.includes('kinds={["vocidx"]}'));
  assert.ok(!p.includes('"voc"'), "le brut n'est référencé nulle part dans le panneau");
});
