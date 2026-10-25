// tests/measuresPublic.test.ts — « Mesures publiques » (25/10/2026) : les mesures d'un capteur sont publiques PAR DÉFAUT (vue réseau, historique public) ; le propriétaire décoche pour les garder privées.
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

test("vue réseau : par défaut (réglage absent) ou à true, la dernière mesure et les grandeurs sont exposées comme avant", () => {
  for (const over of [{}, { measuresPublic: true }]) {
    const d = toNetworkDevice(rec(over), null, now, raw);
    assert.deepEqual(d.measures?.kinds, ["temp", "hum"], JSON.stringify(over));
    assert.equal(d.measures?.latest?.v.temp, 214);
    assert.equal(d.measures?.latest?.v.hum, 550);
  }
});

test("vue réseau : si le propriétaire a décoché (measuresPublic = false), AUCUNE mesure n'est exposée — ni valeur, ni heure de la dernière mesure", () => {
  const d = toNetworkDevice(rec({ measuresPublic: false }), null, now, raw);
  assert.equal(d.measures, undefined);
  assert.equal(JSON.stringify(d).includes("214"), false, "la valeur ne figure nulle part dans la fiche publique");
});

test("route capteur : l'historique public répond 404 identique pour « privé » et « jamais mesuré », accepte ?hours= jusqu'à 31 jours, sans identifiant d'artiste", () => {
  const route = read("app", "api", "sensor", "route.ts");
  const pub = route.slice(route.indexOf('sp.get("public") === "1"'), route.indexOf("if (!(await sessionOwnsDevice(deviceId)))"));
  assert.match(pub, /!indexed \|\| !device \|\| device\.measuresPublic === false/);
  assert.match(pub, /aucune mesure"[^)]*status: 404/);
  assert.match(pub, /PUBLIC_MAX_HOURS/);
  assert.match(route, /const PUBLIC_MAX_HOURS = 744/);
  assert.doesNotMatch(pub, /artistId|artistName|pairCode/, "aucun identifiant d'artiste ni code d'appairage dans la réponse publique");
  const own = route.slice(route.indexOf("if (!(await sessionOwnsDevice(deviceId)))"));
  assert.doesNotMatch(own, /measuresPublic/, "la lecture propriétaire ne dépend pas du réglage");
});

test("réglage : route propriétaire (session requise, booléen strict), setter du store, état renvoyé au propriétaire (vrai par défaut), commutateur dans « Gérer » seulement pour un appareil avec capteur", () => {
  const r = read("app", "api", "my-devices", "[deviceId]", "measures-public", "route.ts");
  assert.match(r, /sessionOwnsDevice\(deviceId\)/);
  assert.match(r, /typeof body\.enabled !== "boolean"/);
  assert.match(r, /setMeasuresPublic\(deviceId, body\.enabled\)/);
  const store = read("lib", "deviceStore.ts");
  assert.match(store, /export async function setMeasuresPublic\(/);
  assert.match(store, /measuresPublic:\s+d\.measuresPublic !== false/);
  const panel = read("app", "profile", "DevicesPanel.tsx");
  assert.match(panel, /\(d\.sensors\?\.length \?\? 0\) > 0 &&/);
  assert.match(panel, /toggle\("meas", "measures-public", \{ enabled: d\.measuresPublic === false \}\)/);
});

test("avertissement du profil : visible tant que des mesures sont publiques, fermable, fermeture mémorisée dans le navigateur (avec repli si le stockage est indisponible)", () => {
  const panel = read("app", "profile", "DevicesPanel.tsx");
  assert.match(panel, /<MeasuresPublicNotice devices=\{devices\} \/>/);
  const notice = panel.slice(panel.indexOf("function MeasuresPublicNotice"), panel.indexOf("// ── Liste"));
  assert.match(notice, /Vos mesures de capteurs sont publiques/);
  assert.match(notice, /désactiver à tout moment/);
  assert.match(notice, /d\.measuresPublic !== false/, "n'apparaît que pour des mesures effectivement publiques");
  assert.match(notice, /aria-label="Fermer ce message"/);
  assert.match(notice, /try \{[^}]*localStorage\.setItem/);
  assert.match(notice, /catch/);
});

test("aucun autre chemin public ne lit les mesures d'un appareil (hors /api/sensor, la vue réseau et la liste du propriétaire)", () => {
  const offenders: string[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (e.name !== "node_modules" && e.name !== ".next") walk(p); continue; }
      if (!/\.(ts|tsx)$/.test(e.name)) continue;
      if (/measKey\(/.test(fs.readFileSync(p, "utf8"))) offenders.push(path.relative(root, p).replace(/\\/g, "/"));
    }
  };
  walk(path.join(root, "app")); walk(path.join(root, "lib"));
  const allowed = new Set(["app/api/sensor/route.ts", "lib/measures.ts", "lib/networkSnapshot.ts", "app/api/devices/route.ts"]);
  assert.deepEqual(offenders.filter((f) => !allowed.has(f)), [], "nouveau lecteur de meas:{deviceId} : vérifier qu'il respecte measuresPublic ou qu'il est réservé au propriétaire, puis l'ajouter ici");
});
