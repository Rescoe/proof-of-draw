// board.mjs — arduino-cli : détection de la carte, compilation, téléversement. TOUT passe par arduino-cli (le cœur choisit son outil de téléversement ; aucune dépendance directe à dfu-util).
// Les fonctions prennent un `exec(cmd, args, opts) -> Promise<{code, stdout, stderr}>` injecté : testables sans arduino-cli ni carte.
export const FQBN = "arduino:renesas_uno:unor4wifi";
export const DEFAULT_CLI = "C:/Users/thibf/AppData/Local/Programs/Arduino IDE/resources/app/lib/backend/resources/arduino-cli.exe";

/** `arduino-cli board list --format json` (formats récents { detected_ports: [...] } et anciens [...]) -> [{ port, protocol, serial, vid, pid, fqbns }] */
export function parseBoardList(text) {
  let j; try { j = JSON.parse(text); } catch { return null; }
  const arr = Array.isArray(j) ? j : j?.detected_ports; if (!Array.isArray(arr)) return null;
  return arr.map((d) => ({ port: d.port?.address ?? d.address ?? null, protocol: d.port?.protocol ?? d.protocol ?? null, serial: d.port?.properties?.serialNumber ?? d.port?.hardware_id ?? null, vid: d.port?.properties?.vid ?? null, pid: d.port?.properties?.pid ?? null,
    fqbns: (d.matching_boards ?? d.boards ?? []).map((b) => b.fqbn).filter(Boolean) })).filter((d) => d.port);
}
/** Cartes compatibles (FQBN exact) sur un port série USB. */
export const compatible = (list) => (list ?? []).filter((b) => b.protocol === "serial" && b.fqbns.includes(FQBN));

export async function listBoards(exec, cli) {
  const r = await exec(cli, ["board", "list", "--format", "json"], { timeout: 30000 });
  if (r.code !== 0) throw new Error(`arduino-cli board list a échoué (${r.code}) : ${r.stderr.slice(0, 200)}`);
  const l = parseBoardList(r.stdout); if (!l) throw new Error("sortie de board list illisible"); return l;
}
export const compileArgs = (sketchDir, outDir, { isB, runId }) => ["compile", "--fqbn", FQBN, "--warnings", "all", "--build-property", `compiler.cpp.extra_flags=-DOTA3_AUTO=1 -DOTA3_IS_B=${isB ? 1 : 0} -DOTA3_RUN_ID=0x${runId}u`, "--output-dir", outDir, sketchDir];
export const uploadArgs = (port, inputDir) => ["upload", "--fqbn", FQBN, "-p", port, "--input-dir", inputDir];

/** Commandes de récupération imprimées dans recovery.txt (jamais exécutées automatiquement). */
export function recoveryText({ cli, sketchDir, buildDirA, productionSketch, state }) {
  return [
    "PROCÉDURE DE RÉCUPÉRATION (rien n'a été relancé automatiquement : aucun retry)",
    `État atteint : ${state}`,
    "",
    "1. Débrancher puis rebrancher l'USB. Si la carte ne répond pas : double appui RAPIDE sur RESET (la LED pulse) = bootloader.",
    "2. Relister la carte :",
    `   "${cli}" board list`,
    "3. Remettre la sonde A (build du canari) :",
    `   "${cli}" upload --fqbn ${FQBN} -p <PORT> --input-dir "${buildDirA}"`,
    "4. Ou remettre le firmware de production TFT 2,8″ (compiler puis téléverser avec les mêmes outils) :",
    `   "${cli}" compile --fqbn ${FQBN} --output-dir <DOSSIER> "${productionSketch}"`,
    `   "${cli}" upload  --fqbn ${FQBN} -p <PORT> --input-dir <DOSSIER>`,
    "",
    "Les binaires de build contiennent le Wi-Fi : ils restent sur ce PC (artifacts/, ignoré par git).",
  ].join("\n");
}
