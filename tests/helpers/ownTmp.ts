// tests/helpers/ownTmp.ts — dossiers temporaires d'un test : créés par CE processus, supprimés à sa sortie (normale, échec d'assertion, exception ou signal), JAMAIS de purge globale de %TEMP%.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const mine = new Set<string>();
let armed = false;

/** Supprime les dossiers créés par ce processus (et eux seuls). */
export function cleanOwnTmp(): void {
  for (const d of mine) { try { fs.rmSync(d, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); } catch { /* occupé : le prochain essai (sortie) réessaie */ } }
  mine.clear();
}

/** Crée un dossier temporaire privé et programme sa suppression à la sortie du processus. */
export function ownTmp(prefix: string): string {
  if (!armed) {
    armed = true;
    process.on("exit", cleanOwnTmp);
    for (const sig of ["SIGINT", "SIGTERM"] as const) process.on(sig, () => { cleanOwnTmp(); process.exit(1); });
  }
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  mine.add(d);
  return d;
}
