// tests/measuresPublic.test.ts — « Mesures publiques » (25/10/2026) : le propriétaire décide si les mesures de son capteur sont visibles dans la vue réseau et l'historique public. Défaut : privées.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { toNetworkDevice, type DeviceRecord } from "../lib/networkSnapshot";

const root = path.join(__dirname, "..");
const read = (...p: string[]) => fs.readFileSync(path.join(root, ...p), "utf8");
const now = Date.UTC(2026, 9, 25, 12, 0, 0);
const rec = (over: Partial<DeviceRecord> = {}): DeviceRecord => ({
  deviceId: "dev_T46HBXG1", screens: ["eink29bwr"], firmware: "eink29bwr-2.12", sensors: ["temp", "hum"], lastSeen: now - 60_000, lastPing: now - 60_000, framesSent: 3, createdAt: now - 86_400_000, ...over,
} as DeviceRecord);
const raw = `${Math.floor(now / 1000) - 120};temp=214;hum=550`;

test("vue réseau : sans réglage (défaut) ou à false, AUCUNE mesure n'est exposée — pas même la dernière valeur ni l'heure", () => {
  for (const over of [{}, { measuresPublic: false }]) {
    const d = toNetworkDevice(rec(over), null, now, raw);
    assert.equal(d.measures, undefined, JSON.stringify(over));
    assert.equal(JSON.stringify(d).includes("214"), false, "la valeur ne figure nulle part dans la fiche publique");
  }
});

test("vue réseau : avec measuresPublic = true, la dernière mesure et les grandeurs sont exposées comme avant", () => {
  const d = toNetworkDevice(rec({ measuresPublic: true }), null, now, raw);
  assert.deepEqual(d.measures?.kinds, ["temp", "hum"]);
  assert.equal(d.measures?.latest?.v.temp, 214);
  assert.equal(d.measures?.latest?.v.hum, 550);
});

test("route capteur : l'historique public exige measuresPublic = true, répond 404 identique sinon, et accepte ?hours= jusqu'à 31 jours", () => {
  const route = read("app", "api", "sensor", "route.ts");
  const pub = route.slice(route.indexOf('sp.get("public") === "1"'), route.indexOf("if (!(await sessionOwnsDevice(deviceId)))"));
  assert.match(pub, /device\?\.measuresPublic !== true/);
  assert.match(pub, /aucune mesure"[^)]*status: 404/);
  assert.match(pub, /PUBLIC_MAX_HOURS/);
  assert.match(route, /const PUBLIC_MAX_HOURS = 744/);
  assert.doesNotMatch(pub, /artistId|artistName|pairCode/, "aucun identifiant d'artiste ni code d'appairage dans la réponse publique");
  // la lecture propriétaire (cookie) reste inchangée et ne dépend pas du réglage
  const own = route.slice(route.indexOf("if (!(await sessionOwnsDevice(deviceId)))"));
  assert.doesNotMatch(own, /measuresPublic/);
});

test("réglage : route propriétaire (session requise, booléen strict), setter du store, champ renvoyé au propriétaire, commutateur dans « Gérer » seulement pour un appareil avec capteur", () => {
  const r = read("app", "api", "my-devices", "[deviceId]", "measures-public", "route.ts");
  assert.match(r, /sessionOwnsDevice\(deviceId\)/);
  assert.match(r, /typeof body\.enabled !== "boolean"/);
  assert.match(r, /setMeasuresPublic\(deviceId, body\.enabled\)/);
  const store = read("lib", "deviceStore.ts");
  assert.match(store, /export async function setMeasuresPublic\(/);
  assert.match(store, /measuresPublic:\s+d\.measuresPublic === true/, "le propriétaire voit l'état courant (faux par défaut)");
  const panel = read("app", "profile", "DevicesPanel.tsx");
  assert.match(panel, /\(d\.sensors\?\.length \?\? 0\) > 0 &&/);
  assert.match(panel, /toggle\("meas", "measures-public"/);
});

test("aucun autre chemin public ne lit les mesures d'un appareil privé (hors /api/sensor et la vue réseau)", () => {
  const offenders: string[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (e.name !== "node_modules" && e.name !== ".next") walk(p); continue; }
      if (!/\.(ts|tsx)$/.test(e.name)) continue;
      const s = fs.readFileSync(p, "utf8");
      if (/measKey\(/.test(s)) offenders.push(path.relative(root, p).replace(/\\/g, "/"));
    }
  };
  walk(path.join(root, "app")); walk(path.join(root, "lib"));
  const allowed = new Set(["app/api/sensor/route.ts", "lib/measures.ts", "lib/networkSnapshot.ts", "app/api/devices/route.ts"]);
  const unexpected = offenders.filter((f) => !allowed.has(f));
  assert.deepEqual(unexpected, [], "nouveau lecteur de meas:{deviceId} : vérifier qu'il respecte measuresPublic ou qu'il est réservé au propriétaire, puis l'ajouter ici");
});
