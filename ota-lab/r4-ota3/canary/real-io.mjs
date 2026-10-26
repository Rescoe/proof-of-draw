// real-io.mjs — entrées/sorties RÉELLES du canari (arduino-cli, système de fichiers, réseau, console). N'est utilisé que par main() : les tests utilisent un simulateur.
// Rien ici ne s'exécute à l'import. Les binaires de build (qui embarquent le Wi-Fi) restent dans artifacts/canary/<run>/ (ignoré par git) ; runs/<run>/ ne reçoit que des textes sans secret.
import { spawn, execFileSync } from "node:child_process"; import { createServer, request } from "node:http"; import net from "node:net"; import os from "node:os";
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, readdirSync } from "node:fs"; import { join, dirname, resolve } from "node:path"; import { fileURLToPath } from "node:url"; import { createHash, randomBytes } from "node:crypto"; import readline from "node:readline";
import { compileArgs, uploadArgs, listBoards, DEFAULT_CLI } from "./board.mjs"; import { openSerial, BRIDGE } from "./transport.mjs"; import { runPreflight } from "./preflight.mjs";
import { buildOta, lzssEncodeLiterals } from "../tools/ota-format.mjs"; import { makeHandler } from "../tools/serve-r4.mjs"; import { APP_MAX } from "./protocol.mjs";

const LAB = resolve(dirname(fileURLToPath(import.meta.url)), ".."); const ROOT = resolve(LAB, "..", "..");

export function run(cmd, args, { timeout = 120000, cwd = ROOT, env } = {}) {
  return new Promise((res) => {
    let out = "", err = ""; const c = spawn(cmd, args, { cwd, env: env ?? process.env, windowsHide: true }); const t = setTimeout(() => { try { c.kill(); } catch { /* */ } }, timeout);
    c.stdout.on("data", (d) => (out += d)); c.stderr.on("data", (d) => (err += d)); c.on("error", (e) => { clearTimeout(t); res({ code: -1, stdout: out, stderr: String(e.message) }); }); c.on("close", (code) => { clearTimeout(t); res({ code, stdout: out, stderr: err }); });
  });
}
const sha256 = (b) => createHash("sha256").update(b).digest("hex");

export function makeRealIo({ cli = process.env.ARDUINO_CLI ?? DEFAULT_CLI, serverPort = 8080, external = false } = {}) {
  const d = new Date(); const p2 = (n) => String(n).padStart(2, "0");
  const runId = `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}`;
  const runDir = join(LAB, "runs", runId); mkdirSync(runDir, { recursive: true });
  const art = join(LAB, "artifacts", "canary", runId); const sketchDir = join(LAB, "sketch", "ota3_r4_probe");
  const winlibs = "C:/Users/thibf/tools/winlibs-14.2/mingw64/bin";
  const io = {
    runId, runDir, cli, sketchDir, serverPort, productionSketch: join(ROOT, "arduino_uno_r4", "pod_uno_r4"),
    now: () => Date.now(), sleep: (ms) => new Promise((r) => setTimeout(r, ms)), timer: (ms, fn) => { const t = setTimeout(fn, ms); return () => clearTimeout(t); },
    log: (m) => console.log(m), write: (name, text) => writeFileSync(join(runDir, name), text),
    pcAddresses: () => Object.values(os.networkInterfaces()).flat().filter((a) => a && (a.family === "IPv4" || a.family === 4) && !a.internal).map((a) => ({ address: a.address, netmask: a.netmask })),
    listBoards: () => listBoards(run, cli),
    openSerial: (port) => openSerial(port),
    async preflight() {
      return runPreflight({
        nodeVersion: process.version, exec: (c, a) => run(c, a, { timeout: 30000 }), cli, serverPort: external ? null : serverPort, root: ROOT, sketchDir, bridge: BRIDGE,
        git: (a) => execFileSync("git", a, { cwd: ROOT, encoding: "utf8" }), exists: (p) => existsSync(p),
        ignored: (p) => { try { execFileSync("git", ["check-ignore", "-q", p], { cwd: ROOT }); return true; } catch { return false; } },
        powershell: async () => (await run("powershell", ["-NoProfile", "-Command", "[System.IO.Ports.SerialPort]::GetPortNames() | Out-Null; 'ok'"], { timeout: 20000 })).code === 0,
        portFree: (port) => new Promise((r) => { const s = net.createServer(); s.once("error", () => r(false)); s.listen(port, "0.0.0.0", () => s.close(() => r(true))); }),
        runHostTests: async () => { const files = readdirSync(join(LAB, "tests")).filter((f) => f.endsWith(".test.mjs")).map((f) => join(LAB, "tests", f)); const r = await run(process.execPath, ["--test", ...files], { timeout: 600000, env: { ...process.env, PATH: `${winlibs};${process.env.PATH}` } }); const m = /# pass (\d+)/.exec(r.stdout), f = /# fail (\d+)/.exec(r.stdout); return { ok: r.code === 0 && f?.[1] === "0", summary: `pass ${m?.[1] ?? "?"}, fail ${f?.[1] ?? "?"}` }; },
      });
    },
    async build() {
      mkdirSync(join(art, "serve"), { recursive: true }); const img = {};
      for (const [name, isB] of [["A", false], ["B", true]]) {
        const runIdHex = randomBytes(4).toString("hex").toUpperCase(); const dir = join(art, "build", name);
        const r = await run(cli, compileArgs(sketchDir, dir, { isB, runId: runIdHex }), { timeout: 600000 });
        if (r.code !== 0) throw new Error(`compilation de ${name} en échec : ${r.stderr.slice(-300)}`);
        const bin = readFileSync(join(dir, "ota3_r4_probe.ino.bin")); if (bin.length > APP_MAX) throw new Error(`image ${name} trop grande`);
        img[name] = { size: bin.length, sha: sha256(bin), run: runIdHex, dir, bin };
      }
      writeFileSync(join(art, "serve", "good.ota"), buildOta(lzssEncodeLiterals(img.B.bin))); writeFileSync(join(art, "serve", "to-a.ota"), buildOta(lzssEncodeLiterals(img.A.bin)));
      for (const n of ["A", "B"]) delete img[n].bin;
      return { ...img, serveDir: join(art, "serve") };
    },
    confirm: (summary) => new Promise((res) => { console.log("\n" + summary + "\n"); const rl = readline.createInterface({ input: process.stdin, output: process.stdout }); rl.question("> ", (a) => { rl.close(); res(a); }); }),
    async startServer(dir) {
      const lines = []; const log = (s) => { const l = `${new Date().toISOString()} ${s}`; lines.push(l); }; const srv = createServer(makeHandler({ dir, log }));
      await new Promise((r, j) => { srv.once("error", j); srv.listen(serverPort, "0.0.0.0", r); }); log(`HTTP sur ${serverPort}`);
      return { lines: () => lines, stop: () => new Promise((r) => { srv.closeAllConnections?.(); srv.close(() => r()); }) };
    },
    // ── mode porteur : le porteur lance le serveur et téléverse A lui-même ──
    writePrepared(p) { const f = join(LAB, "artifacts", "canary", "latest.json"); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, JSON.stringify(p, null, 2) + String.fromCharCode(10)); },
    async loadPrepared() {
      const f = join(LAB, "artifacts", "canary", "latest.json"); if (!existsSync(f)) throw new Error("aucune préparation : lancer d'abord --prepare");
      const p = JSON.parse(readFileSync(f, "utf8")); for (const x of [join(p.serveDir, "good.ota"), join(p.serveDir, "to-a.ota"), join(p.A.dir, "ota3_r4_probe.ino.bin"), join(p.B.dir, "ota3_r4_probe.ino.bin")]) if (!existsSync(x)) throw new Error("fichier de préparation manquant : " + x);
      return p;
    },
    checkServer(p) {   // le serveur du porteur doit répondre ET servir les deux fichiers de CETTE préparation (même Content-Length)
      const probe = (name) => new Promise((res) => { const rq = request({ host: "127.0.0.1", port: serverPort, path: "/" + name, method: "HEAD", timeout: 4000 }, (rs) => { res({ status: rs.statusCode, len: Number(rs.headers["content-length"] ?? -1) }); rs.resume(); }); rq.on("error", (e) => res({ err: e.message })); rq.on("timeout", () => { rq.destroy(); res({ err: "délai" }); }); rq.end(); });
      return (async () => { for (const n of ["good.ota", "to-a.ota"]) { const got = await probe(n); const want = readFileSync(join(p.serveDir, n)).length; if (got.err) return { ok: false, detail: `aucun serveur sur le port ${serverPort} (${got.err}) — lancer CANARY-2-SERVEUR` }; if (got.status !== 200 || got.len !== want) return { ok: false, detail: `${n} : réponse ${got.status}, ${got.len} o au lieu de ${want} o — ce n'est pas le serveur de la préparation courante` }; } return { ok: true, detail: "ok" }; })();
    },
    async upload(port, dir) { const r = await run(cli, uploadArgs(port, dir), { timeout: 300000 }); return { ok: r.code === 0, out: r.stdout.slice(-300) + r.stderr.slice(-300) }; },
  };
  return io;
}
export { rmSync };
