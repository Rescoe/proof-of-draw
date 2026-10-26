// canarySimIo.mjs — `io` simulé pour tester l'ORCHESTRATEUR de bout en bout (ordre des étapes, confirmation, ports, arrêts) sans carte, sans arduino-cli, sans réseau.
import { SimBoard, mkCfg } from "../../canary/boardsim.mjs";
import { FQBN } from "../../canary/board.mjs";

export function makeSimIo({ boardOpts = {}, mode = "gone-back", typed = "OTA3-A-B-A", boards, preflightOk = true, uploadOk = true, extraBoardAt = null, vanishAt = null, vanishSilent = false, bootDelay = 15, attach = false, serverOk = true, staleCommit = false, deadFirst = 0 } = {}) {
  const cfg = mkCfg(); const sim = new SimBoard(cfg, boardOpts); const calls = []; const files = {}; let visible = boards ?? [{ port: "COM5", protocol: "serial", serial: "SN-1", fqbns: [FQBN] }];
  let curPort = "COM5"; let transports = []; let serverStopped = false, serverStarted = false; let pendingBoot = null; let uploaded = attach; let vanished = false; let prepared = null; let opened = 0;   // deadFirst : les N premiers ports ouverts sont « périmés » (ouverture réussie, aucun octet, commandes ignorées)   // attach : le porteur a déjà téléversé A
  const emitLines = (t, evs) => setTimeout(() => { for (const e of evs) t.cbs.line.forEach((f) => f("@OTA3 " + JSON.stringify(e))); }, 2);
  const mkTransport = (port) => {
    const dead = ++opened <= deadFirst;
    const t = { port, cbs: { line: [], close: [], open: [] }, closed: false };
    const api = {
      onLine: (f) => t.cbs.line.push(f), onClose: (f) => t.cbs.close.push(f), onOpen: (f) => t.cbs.open.push(f),
      send(cmd) {
        calls.push("serial:" + cmd); if (dead) return;
        if (cmd === "m" && pendingBoot) return;   // causalité : une image qui démarre imprime son boot AVANT de lire la moindre commande
        const evs = sim.command(cmd);
        if (evs.some((e) => e.e === "update_begin")) {
          emitLines(t, evs.filter((e) => e.e !== "update_begin").concat([{ e: "update_begin" }]));
          setTimeout(() => {
            pendingBoot = sim.finishProgramming();
            if (mode === "gone-back") { visible = []; closeAll(); setTimeout(() => { curPort = "COM7"; visible = [{ port: "COM7", protocol: "serial", serial: "SN-1", fqbns: [FQBN] }]; }, 25); }
            else if (mode === "changed-silent") { visible = []; setTimeout(() => { curPort = "COM7"; visible = [{ port: "COM7", protocol: "serial", serial: "SN-1", fqbns: [FQBN] }]; }, 25); }   // COM change SANS fermeture du flux : l'ancien pont reste ouvert
            else if (mode === "stale-handle") { /* le flux courant reste ouvert et MUET ; la nouvelle identité n'est livrée qu'à un NOUVEAU port ouvert */ }
            else if (mode === "stay-reopen") { closeAll(); }
            else { const t2 = transports[transports.length - 1]; if (t2 && pendingBoot.length) { setTimeout(() => { emitLines(t2, pendingBoot); pendingBoot = null; }, bootDelay); } }
          }, 20);
        } else emitLines(t, evs);
      },
      close() { t.closed = true; },
    };
    t.api = api; transports.push(t);
    setTimeout(() => t.cbs.open.forEach((f) => f(null)), 1);
    if (dead) return api;
    if (!uploaded) {} else if (pendingBoot) { const b = pendingBoot; pendingBoot = null; setTimeout(() => emitLines(t, b), bootDelay); }
    else if (!sim.updating && !sim.sentBoot) { sim.sentBoot = true; setTimeout(() => emitLines(t, sim.boot()), bootDelay); }
    return api;
  };
  const closeAll = () => { for (const t of transports) if (!t.closed) { t.closed = true; setTimeout(() => t.cbs.close.forEach((f) => f("simulé")), 1); } };
  const io = {
    runId: "TEST", runDir: "/sim", cli: "arduino-cli", sketchDir: "/sketch", productionSketch: "/prod", serverPort: 8080, calls, files,
    now: () => Date.now(), sleep: (ms) => new Promise((r) => setTimeout(r, ms)), timer: (ms, fn) => { const t = setTimeout(fn, ms); return () => clearTimeout(t); }, log: () => {},
    write: (n, s) => { files[n] = s; }, pcAddresses: () => cfg.pcAddresses,
    async preflight() { calls.push("preflight"); return { ok: preflightOk, commit: "abc1234", dirty: false, checks: [{ name: "secrets.h présent dans le sketch", ok: preflightOk, detail: "(contenu jamais lu ni journalisé)" }, { name: "cœur arduino:renesas_uno 1.6.0 installé", ok: true, detail: "1.6.0" }] }; },
    async build() { calls.push("build"); return { A: { ...cfg.A, dir: "/a" }, B: { ...cfg.B, dir: "/b" }, serveDir: "/serve" }; },
    async listBoards() {
      calls.push("listBoards"); if (vanishAt && uploaded && !vanished && sim.sent.length >= vanishAt) { vanished = true; visible = []; if (!vanishSilent) closeAll(); }
      if (extraBoardAt && uploaded && sim.sent.length >= extraBoardAt) return [...visible, { port: "COM9", protocol: "serial", serial: "SN-2", fqbns: [FQBN] }];
      return visible;
    },
    async confirm() { calls.push("confirm"); return typed; },
    async startServer() { calls.push("startServer"); serverStarted = true; return { lines: () => ["GET /good.ota", "GET /to-a.ota"], stop: async () => { serverStopped = true; calls.push("stopServer"); } }; },
    writePrepared(p) { calls.push("writePrepared"); prepared = p; },
    async loadPrepared() { calls.push("loadPrepared"); return { commit: staleCommit ? "zzz" : "abc1234", serverPort: 8080, A: { ...cfg.A, dir: "/a" }, B: { ...cfg.B, dir: "/b" }, serveDir: "/serve" }; },
    async checkServer() { calls.push("checkServer"); return serverOk ? { ok: true, detail: "ok" } : { ok: false, detail: "aucun serveur" }; },
    async upload(port) { calls.push("upload:" + port); if (!uploadOk) return { ok: false, out: "erreur simulée" }; uploaded = true; return { ok: true, out: "" }; },
    openSerial: (port) => { calls.push("open:" + port); return mkTransport(port); },
  };
  return { io, sim, cfg, get prepared() { return prepared; }, get serverStopped() { return serverStopped; }, get serverStarted() { return serverStarted; } };
}
