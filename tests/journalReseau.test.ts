// tests/journalReseau.test.ts — « Journal réseau » (25/10/2026) : toute la semaine, date complète, recherche par jour, défilement qui ne saute plus.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.join(__dirname, "..");
const read = (...p: string[]) => fs.readFileSync(path.join(root, ...p), "utf8");

test("serveur : ?days=N (1 à 31) renvoie les blocs de la chaîne canonique ET les rejets de la fenêtre ; sans paramètre le comportement d'origine (50 événements) est inchangé", () => {
  const r = read("app", "api", "network", "activity-log", "route.ts");
  assert.match(r, /getCanonicalChain\(\)/);
  assert.match(r, /Math\.min\(31, d\)/);
  assert.match(r, /days > 0 \? MAX_EVENTS_WINDOW : 50/, "sans days : 50 événements comme avant");
  assert.match(r, /"CANDIDATE_REJECTED"/);
  assert.match(r, /rejected:draws", 0, 199/);
  assert.match(r, /const memo = new Map<number/, "cache mémoire par valeur de days");
  assert.doesNotMatch(r, /deviceId: r\.deviceId/, "identifiant public seulement pour les appareils (publicDeviceId)");
  assert.match(r, /publicDeviceId\(r\.deviceId\)/);
});

test("client : 7 jours, horodatage COMPLET JJ/MM/AAAA HH:MM:SS, filtre par jour et recherche, défilement collant", () => {
  const c = read("app", "network", "EspActivityFeed.tsx");
  assert.match(c, /activity-log\?days=\$\{WINDOW_DAYS\}/);
  assert.match(c, /const WINDOW_DAYS = 7/);
  assert.match(c, /\$\{p2\(d\.getDate\(\)\)\}\/\$\{p2\(d\.getMonth\(\) \+ 1\)\}\/\$\{d\.getFullYear\(\)\} \$\{p2\(d\.getHours\(\)\)\}:\$\{p2\(d\.getMinutes\(\)\)\}:\$\{p2\(d\.getSeconds\(\)\)\}/);
  assert.doesNotMatch(c, /slice\(-20\)/, "plus de limite à 20 lignes");
  assert.match(c, /KEEP_LINES = 3000/);
  assert.match(c, /type="date"/); assert.match(c, /type="search"/);
  assert.match(c, /stickRef\.current && !day && !query/, "ne ramène en bas que si le lecteur y était");
  assert.match(c, /flex: 0 0 auto;/, "les lignes ne se compressent plus");
  assert.match(c, /grid-template-columns: 11\.2em 5\.6em/, "colonne d'horodatage assez large pour la date complète");
  assert.match(c, /"CANDIDATE_REJECTED"/);
});
