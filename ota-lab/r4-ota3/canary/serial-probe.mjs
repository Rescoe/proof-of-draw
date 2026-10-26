// serial-probe.mjs — SONDE DE LECTURE SEULE du pont série (GO matériel du 16/10/2026) : énumère les cartes (arduino-cli board list), exige UNE carte compatible, ouvre son port par le pont PowerShell,
// LIT pendant quelques secondes, n'ENVOIE RIEN (aucune commande, pas même « m »), ferme. Ne téléverse rien, ne touche à aucun fichier de la carte.
// Usage : node ota-lab/r4-ota3/canary/serial-probe.mjs [--seconds 15]     Écrit runs/probe-<horodatage>/probe.log (lignes brutes, LOCAL, ignoré par git) et affiche un résumé SANS adresse IP.
import { fileURLToPath } from "node:url"; import { resolve } from "node:path";
import { compatible, FQBN } from "./board.mjs"; import { parseLine } from "./protocol.mjs";

/** io : { listBoards(), openSerial(port), sleep(ms), now() }. Rend { ok, code, summary, lines } ; n'appelle JAMAIS send(). */
export async function runSerialProbe(io, { seconds = 15 } = {}) {
  const list = await io.listBoards(); const found = compatible(list);
  if (found.length === 0) return { ok: false, code: "no_board", summary: `aucune carte ${FQBN} sur un port série (carte absente, occupée, ou en mode bootloader)`, lines: [] };
  if (found.length > 1) return { ok: false, code: "ambiguous_boards", summary: `plusieurs cartes compatibles (${found.map((b) => b.port).join(", ")}) : aucune sélection arbitraire`, lines: [] };
  const board = found[0]; const lines = []; let opened = null, closedWhy = null;
  const tr = io.openSerial(board.port);
  tr.onOpen((e) => { opened = e ? { error: e.message } : { ok: true }; }); tr.onLine((l) => lines.push(l)); tr.onClose((w) => { closedWhy = w; });
  const t0 = io.now(); while (io.now() - t0 < seconds * 1000 && closedWhy === null) await io.sleep(100);
  try { tr.close(); } catch { /* */ }
  await io.sleep(300);
  const ev = lines.map(parseLine); const nEvents = ev.filter((x) => x.kind === "event").length, nOta3 = lines.filter((l) => l.includes("[OTA3]")).length;
  const opened_ok = opened?.ok === true;
  return { ok: opened_ok, code: opened_ok ? "ok" : "open_failed", board: { port: board.port, has_serial_number: !!board.serial, vid: board.vid, pid: board.pid },
    summary: opened_ok ? `port ${board.port} ouvert, ${lines.length} ligne(s) lue(s) en ${seconds} s (${nOta3} ligne(s) [OTA3], ${nEvents} événement(s) @OTA3)${closedWhy ? `, flux fermé : ${closedWhy}` : ""}` : `ouverture impossible : ${opened?.error ?? "aucune réponse du pont"}`, lines };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const { listBoards } = await import("./board.mjs"); const { run } = await import("./real-io.mjs"); const { openSerial } = await import("./transport.mjs");
  const { mkdirSync, writeFileSync } = await import("node:fs"); const { join, dirname } = await import("node:path");
  const si = process.argv.indexOf("--seconds"); const seconds = si > 0 ? Number(process.argv[si + 1]) : 15;
  const cli = process.env.ARDUINO_CLI ?? (await import("./board.mjs")).DEFAULT_CLI;
  const io = { listBoards: () => listBoards(run, cli), openSerial: (p) => openSerial(p), sleep: (ms) => new Promise((r) => setTimeout(r, ms)), now: () => Date.now() };
  console.log(`SONDE DE LECTURE SEULE (${seconds} s) : rien ne sera envoyé à la carte.`);
  const r = await runSerialProbe(io, { seconds });
  const id = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 15); const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "runs", `probe-${id}`); mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "probe.log"), r.lines.join("\n") + "\n"); writeFileSync(join(dir, "probe.json"), JSON.stringify({ ok: r.ok, code: r.code, summary: r.summary, board: r.board ?? null }, null, 2) + "\n");
  console.log(`${r.ok ? "OK" : "ÉCHEC"} [${r.code}] ${r.summary}\nDossier (local, ignoré par git) : ${dir}`);
  process.exit(r.ok ? 0 : 1);
}
