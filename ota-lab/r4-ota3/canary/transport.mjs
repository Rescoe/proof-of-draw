// transport.mjs — liaison série via le pont PowerShell. `spawn` est injecté (tests). La liste blanche des commandes est appliquée ICI, avant toute écriture sur le port.
import { spawn as realSpawn } from "node:child_process";
import { join, dirname } from "node:path"; import { fileURLToPath } from "node:url";
import { LineSplitter, assertSafeCommand } from "./protocol.mjs";

export const BRIDGE = join(dirname(fileURLToPath(import.meta.url)), "serial-bridge.ps1");

/** Ouvre le port : rend { onLine(cb), onClose(cb), onOpen(cb), send(cmd), close() }. onOpen reçoit (erreur|null). */
export function openSerial(port, { spawn = realSpawn, baud = 115200, bridge = BRIDGE } = {}) {
  const child = spawn("powershell", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", bridge, "-Port", port, "-Baud", String(baud)], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
  const cbs = { line: [], close: [], open: [] }; let closed = false, opened = false; const split = new LineSplitter();
  const emitClose = (why) => { if (closed) return; closed = true; cbs.close.forEach((f) => f(why)); };
  child.stdout.on("data", (d) => {
    for (const l of split.push(d.toString("utf8"))) {
      let m; try { m = JSON.parse(l); } catch { continue; }
      if (m.t === "open") { opened = true; cbs.open.forEach((f) => f(null)); }
      else if (m.t === "line") cbs.line.forEach((f) => f(m.s));
      else if (m.t === "error") { if (!opened) cbs.open.forEach((f) => f(new Error(m.s))); emitClose("error:" + m.s); }
      else if (m.t === "closed") emitClose(m.why);
    }
  });
  child.on("exit", (code) => emitClose("exit:" + code)); child.on("error", (e) => { if (!opened) cbs.open.forEach((f) => f(e)); emitClose("spawn:" + e.message); });
  return {
    onLine: (f) => cbs.line.push(f), onClose: (f) => cbs.close.push(f), onOpen: (f) => cbs.open.push(f),
    send(cmd) { assertSafeCommand(cmd); if (closed) throw new Error("port série fermé"); child.stdin.write(JSON.stringify({ cmd: "send", s: cmd }) + "\n"); },
    close() { try { child.stdin.write(JSON.stringify({ cmd: "close" }) + "\n"); child.stdin.end(); } catch { /* déjà fermé */ } setTimeout(() => { try { child.kill(); } catch { /* */ } }, 1500).unref?.(); },
  };
}
