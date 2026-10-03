// tests/benchHeaderCopies.test.ts — les copies des en-têtes du banc d'essai (une par dossier de firmware, car chaque dossier est autonome)
// doivent être IDENTIQUES à leur original. Échec = lancer `node scripts/sync-bench-header.js`.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { MASTERS, COPIES } = require("../scripts/sync-bench-header.js") as { MASTERS: Record<string, string>; COPIES: Record<string, string[]> };
const root = path.join(__dirname, "..");

for (const [name, master] of Object.entries(MASTERS)) {
  test(`${name} : toutes les copies sont identiques à l'original (${master})`, () => {
    const original = fs.readFileSync(path.join(root, master));
    for (const copy of COPIES[name]) {
      const p = path.join(root, copy);
      assert.ok(fs.existsSync(p), `${copy} absent — lancer : node scripts/sync-bench-header.js`);
      assert.ok(Buffer.compare(fs.readFileSync(p), original) === 0, `${copy} diverge de ${master} — lancer : node scripts/sync-bench-header.js`);
    }
  });
}
