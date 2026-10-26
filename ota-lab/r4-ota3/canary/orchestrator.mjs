// orchestrator.mjs — orchestre le canari A -> B -> A. Toutes les E/S passent par `io` (injecté) : en test, `io` est un simulateur ; en réel, real-io.mjs. Aucune logique de décision ici : la machine à états (machine.mjs) décide ; ce module
// (1) enchaîne les étapes NON destructives (prévol, compilation, détection), (2) demande UNE confirmation, (3) téléverse A, (4) alimente la machine avec les événements série / port / délais, (5) écrit le verdict et la récupération.
// Ordre imposé (point 2 du GO) : prévol non destructif -> compilation -> détection non destructive -> résumé -> CONFIRMATION -> téléversement A -> suite entièrement automatique.
import { step, initialState, DEFAULT_TIMEOUTS } from "./machine.mjs";
import { parseLine } from "./protocol.mjs";
import { compatible, recoveryText } from "./board.mjs";
import { buildVerdict, verdictText, safeText } from "./verdict.mjs";

export const CONFIRM_TOKEN = "OTA3-A-B-A";
class Abort extends Error { constructor(code, why, phase) { super(why); this.code = code; this.phase = phase; } }

/** Mode --prepare : prévol + compilation + dossier de service + latest.json ; AUCUN téléversement, AUCUN port ouvert. Rend les commandes à lancer. */
export async function prepareCanary(io) {
  const pre = await io.preflight(); if (!pre.ok) return { ok: false, why: "prévol en échec : " + pre.checks.filter((c) => !c.ok).map((c) => c.name + " (" + c.detail + ")").join(" ; "), pre };
  const build = await io.build(); const boards = compatible(await io.listBoards().catch(() => []));
  const prepared = { runId: io.runId, commit: pre.commit, serverPort: io.serverPort, serveDir: build.serveDir, A: { ...build.A }, B: { ...build.B } }; io.writePrepared(prepared);
  return { ok: true, prepared, port: boards.length === 1 ? boards[0].port : null, boards: boards.length };
}

export async function runCanary(io, opts = {}) {
  const timeouts = { ...DEFAULT_TIMEOUTS, ...(opts.timeouts ?? {}) }; const pollMs = opts.pollMs ?? 1500;
  const ctx = { runId: io.runId, startedAt: new Date().toISOString(), portsSeen: [], confirmed: false, aborted: null, recoveryWritten: false };
  const journals = { 1: [], 2: [] }; let mstate = initialState(); let server = null, transport = null, finished = false, cancelTimer = null, uploadStarted = false, cfg = null, board = null, build = null;
  const t0 = io.now(); const stamp = () => `+${((io.now() - t0) / 1000).toFixed(1)}s`;
  const jr = (txt) => journals[mstate.leg === 2 ? 2 : 1].push(`${stamp()} ${txt}`);
  const say = (m) => io.log(m);

  const writeAll = async () => {
    ctx.endedAt = new Date().toISOString();
    for (const r of mstate.report) if (r.k === "port" && r.port && !ctx.portsSeen.includes(r.port)) ctx.portsSeen.push(r.port);
    const v = buildVerdict(mstate, ctx);
    if (mstate.failed || ctx.aborted) { if (uploadStarted || ctx.aborted?.phase === "post-upload") { io.write("recovery.txt", recoveryText({ cli: io.cli, sketchDir: io.sketchDir, buildDirA: build?.A?.dir ?? "<dossier du build A>", productionSketch: io.productionSketch, state: mstate.failed ? `${mstate.failed.phase} (jambe ${mstate.failed.leg})` : (ctx.aborted?.phase ?? "?") })); v.recovery_file = "recovery.txt"; ctx.recoveryWritten = true; } }
    io.write("verdict.json", safeText(JSON.stringify(v, null, 2) + "\n", "verdict.json")); io.write("verdict.txt", safeText(verdictText(v), "verdict.txt"));
    io.write("serial-A-to-B.log", journals[1].join("\n") + "\n"); io.write("serial-B-to-A.log", journals[2].join("\n") + "\n");
    if (server) { try { io.write("server.log", server.lines().join("\n") + "\n"); } catch { /* */ } }
    return v;
  };

  try {
    // 1. prévol non destructif
    const pre = await io.preflight(); ctx.preflight = pre; ctx.commit = pre.commit; ctx.dirty = pre.dirty; io.write("preflight.json", safeText(JSON.stringify(pre, null, 2) + "\n", "preflight.json"));
    io.write("preflight.txt", safeText(pre.checks.map((c) => `${c.ok ? "OK  " : "ÉCHEC"} ${c.name} — ${c.detail}`).join("\n") + "\n", "preflight.txt"));
    if (!pre.ok) throw new Abort("preflight", `prévol en échec : ${pre.checks.filter((c) => !c.ok).map((c) => c.name).join(", ")}`, "preflight");
    // 2. compilation (A et B, tailles et hashes figés)
    if (opts.attach) { build = await io.loadPrepared(); if (build.commit !== pre.commit) throw new Abort("stale_prepare", `la préparation (${build.commit}) ne correspond pas au commit actuel (${pre.commit}) : relancer --prepare`, "preflight"); }
    else build = await io.build();
    ctx.images = { A: { size: build.A.size, sha: build.A.sha, run: build.A.run }, B: { size: build.B.size, sha: build.B.sha, run: build.B.run } };
    io.write("images.json", JSON.stringify(ctx.images, null, 2) + "\n");
    // 3. détection non destructive : exactement UNE carte compatible
    const found = compatible(await io.listBoards());
    if (found.length === 0) throw new Abort("no_board", "aucune carte UNO R4 WiFi détectée (ou carte en mode bootloader)", "detect");
    if (found.length > 1) throw new Abort("ambiguous_boards", `plusieurs cartes compatibles (${found.map((b) => b.port).join(", ")}) : aucune sélection arbitraire`, "detect");
    board = found[0]; ctx.portsSeen.push(board.port);
    cfg = { A: { name: "A", build: "A", ...build.A }, B: { name: "B", build: "B", ...build.B }, pcAddresses: io.pcAddresses(), serverPort: io.serverPort, timeouts };
    if (opts.attach) { const sv = await io.checkServer(build); if (!sv.ok) throw new Abort("server_unreachable", `serveur externe non conforme : ${sv.detail}`, "detect"); }
    // 4. résumé + CONFIRMATION UNIQUE (avant tout téléversement : il remplace déjà le firmware de production)
    const summary = [
      "=== CANARI OTA-3 : A -> B -> A ===", `Carte : UNO R4 WiFi sur ${board.port}`,
      `Image A : ${build.A.size} o  SHA-256 ${build.A.sha}`, `Image B : ${build.B.size} o  SHA-256 ${build.B.sha}`,
      opts.attach ? "ATTENTION — DESTRUCTIF : la carte doit déjà porter l'image A de cette préparation (téléversée par vos soins) ; deux reprogrammations (A->B, B->A) par le module Wi-Fi vont suivre. Serveur externe vérifié." : "ATTENTION — DESTRUCTIF : le téléversement de A REMPLACE le firmware de production de la carte ; puis deux reprogrammations (A->B, B->A) par le module Wi-Fi.",
      "Aucune coupure de courant, aucun retry : au premier écart tout s'arrête et recovery.txt explique comment réparer.", "La flash de données (clés, verrou de vote) est comparée avant/après.",
      `Pour continuer, tapez exactement : ${CONFIRM_TOKEN}`,
    ].join("\n");
    const typed = String(await io.confirm(summary)).replace(/[\r\n]+$/, "");
    if (typed !== CONFIRM_TOKEN) throw new Abort("not_confirmed", "confirmation absente ou incorrecte : rien n'a été téléversé", "confirm");
    ctx.confirmed = true;
    // 5-6. serveur local + téléversement de A (mode complet) ; en mode attach : serveur et téléversement sont faits par le porteur, la reprogrammation reste destructive
    if (opts.attach) uploadStarted = true;
    else {
    server = await io.startServer(build.serveDir);
    uploadStarted = true; say("Téléversement de A…"); const up = await io.upload(board.port, build.A.dir);
    if (!up.ok) throw new Abort("upload_failed", `téléversement de A en échec (aucun retry) : ${String(up.out ?? "").slice(0, 200)}`, "post-upload");
    }
    if (!opts.attach) await io.sleep(opts.settleMs ?? 6000);   // laisse la carte redémarrer et se réénumérer avant d'ouvrir le port
    // 7. suite entièrement automatique : machine alimentée par la série, les ports et les délais
    await new Promise((resolve) => {
      let present = null;   // null = pas encore vu après le téléversement
      let lastLineAt = 0, reopens = 0, progStart = 0, holdUntil = 0;   // flux muet : un port ouvert juste après un reset USB peut garder un descripteur périmé (aucun octet, aucune erreur)
      const arm = (name, ms) => { if (cancelTimer) cancelTimer(); cancelTimer = io.timer(ms, () => feed({ t: "timeout" })); };
      const settle = () => { if (finished) return; if (mstate.done || mstate.failed) { finished = true; if (cancelTimer) cancelTimer(); resolve(); } };
      function feed(input) {
        if (finished) return; const r = step(mstate, input, cfg); mstate = r.state; if (mstate.phase === "PROGRAMMING" && !progStart) progStart = io.now(); if (mstate.phase !== "PROGRAMMING") progStart = 0;
        for (const a of r.actions) {
          if (a.type === "send") { jr(`>> ${a.line}`); try { transport?.send(a.line); } catch (e) { jr(`-- envoi impossible : ${e.message}`); } }
          else if (a.type === "timer") arm(a.name, a.ms);
        }
        settle();
      }
      function attach(port) {
        const tr = io.openSerial(port); transport = tr; board.port = port; if (!ctx.portsSeen.includes(port)) ctx.portsSeen.push(port);
        let idSeen = false;
        tr.onLine((l) => { lastLineAt = io.now(); jr(`<< ${l}`); const p = parseLine(l); if (p.kind === "event" && (p.ev.e === "boot" || p.ev.e === "hello")) idSeen = true; if (p.kind === "event" && p.ev.e === "update_begin") { idSeen = false; if (opts.closeOnUpdate) { holdUntil = io.now() + (opts.holdMs ?? 45000); transport = null; jr(`-- EXPÉRIENCE : port PC fermé pendant la reprogrammation (réouverture après ${Math.round((opts.holdMs ?? 45000) / 1000)} s)`); try { tr.close(); } catch { /* */ } } } if (p.kind === "event") feed({ t: "board", ev: p.ev }); else if (p.kind === "bad") feed({ t: "hw_error", why: `ligne @OTA3 invalide : ${p.why}` }); else feed({ t: "text", s: l }); });
        tr.onClose((why) => { if (tr !== transport) return; transport = null; jr(`-- port série fermé (${why})`); feed({ t: "serial_lost" }); });
        tr.onOpen((err) => { if (err) { jr(`-- ouverture impossible : ${err.message}`); if (mstate.phase === "PROGRAMMING") { if (tr === transport) transport = null; return; } feed({ t: "hw_error", why: `ouverture du port ${port} impossible` }); } else { feed({ t: "serial_open", port }); } });   // pendant la reprogrammation le port peut être indisponible un instant : on réessaie au prochain sondage
        // l'événement boot a pu partir avant l'ouverture (ou pendant une reconnexion) : si aucune identité n'a été vue 3 s après l'ouverture, on la redemande (commande m, liste blanche), seulement en phase WAIT_BOOT_A / PROGRAMMING
        const tick = () => {
          if (finished || transport !== tr) return;
          const waiting = (mstate.phase === "WAIT_BOOT_A" || mstate.phase === "PROGRAMMING") && !idSeen;
          if (waiting) {
            const quietSince = Math.max(lastLineAt, attachedAt, mstate.phase === "PROGRAMMING" ? progStart : 0);
            if (io.now() - quietSince > (opts.reopenMs ?? 12000) && reopens < 3) { reopens++; jr(`-- flux muet depuis ${Math.round((io.now() - quietSince) / 1000)} s : réouverture du port (${reopens}/3)`); transport = null; try { tr.close(); } catch { /* */ } attach(port); return; }
            jr(">> m"); try { tr.send("m"); } catch { /* */ }
          }
          io.timer(opts.helloMs ?? 3000, tick);
        };
        const attachedAt = io.now(); io.timer(opts.helloMs ?? 3000, tick);
      }
      const watch = async () => {
        while (!finished) {
          await io.sleep(pollMs); if (finished) return;
          let list; try { list = await io.listBoards(); } catch (e) { feed({ t: "hw_error", why: `board list: ${e.message}` }); return; }
          const comp = compatible(list); const same = board.serial ? comp.filter((b) => b.serial === board.serial) : comp;
          if (comp.length > 1) { feed({ t: "ambiguous", ports: comp.map((b) => b.port) }); return; }
          if (same.length === 1) {
            const p = same[0].port;
            if (present === false || (present && present !== p)) { feed({ t: "port", kind: present === false ? "back" : "changed", port: p }); if (finished) return; }
            if (io.now() < holdUntil) { present = p; continue; }   // port volontairement fermé : on ne le rouvre pas avant la fin du délai
            if (!transport || present === false || (present && present !== p)) { if (transport) { try { transport.close(); } catch { /* */ } transport = null; } attach(p); }
            present = p;
          } else if (present) { feed({ t: "port", kind: "gone", port: present }); present = false; if (finished) return; }
          else if (present === null && ++waitedPolls * pollMs > timeouts.boot) { feed({ t: "hw_error", why: "aucune carte revue après le téléversement" }); return; }
        }
      };
      let waitedPolls = 0;
      board.serial = board.serial ?? null; arm("boot", timeouts.boot + 5000); watch();
    });
    return finalize();
  } catch (e) {
    if (!(e instanceof Abort)) { ctx.aborted = { code: "exception", why: String(e.message ?? e), phase: uploadStarted ? "post-upload" : "pre-run" }; }
    else ctx.aborted = { code: e.code, why: e.message, phase: e.phase };
    return finalize();
  }

  async function finalize() {
    finished = true; if (cancelTimer) cancelTimer();
    try { transport?.close(); } catch { /* */ }
    try { if (server) await server.stop(); } catch { /* */ }
    let v; try { v = await writeAll(); } catch (e) { v = { verdict: "FAIL", recovery_file: null }; try { io.write("verdict.txt", `VERDICT : FAIL (écriture du verdict impossible : ${String(e.message).slice(0, 120)})\n`); } catch { /* */ } }   // l'orchestrateur ne plante JAMAIS à la fin
    say(`\nVERDICT : ${v.verdict}`);
    return { verdict: v.verdict, exitCode: v.verdict === "PASS" ? 0 : 1, dir: io.runDir, v };
  }
}

// ── point d'entrée réel : node ota-lab/r4-ota3/canary/orchestrator.mjs (lancé par RUN-CANARY.cmd) ──
import { fileURLToPath } from "node:url"; import { resolve } from "node:path";
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const { makeRealIo } = await import("./real-io.mjs"); const pi = process.argv.indexOf("--port"); const mode = process.argv.includes("--prepare") ? "prepare" : process.argv.includes("--attach") ? "attach" : "full";
  const io = makeRealIo({ ...(pi > 0 ? { serverPort: Number(process.argv[pi + 1]) } : {}), external: mode !== "full" });   // --port N : autre port TCP si 8080 est occupé ; prepare/attach : serveur du porteur (port non contrôlé)
  if (mode === "prepare") {
    console.log("PRÉPARATION (aucun téléversement, aucun port ouvert) : prévol, compilation de A et B, dossier de service…");
    const p = await prepareCanary(io); if (!p.ok) { console.log("\nÉCHEC : " + p.why); process.exit(1); }
    const q = p.prepared; const port = p.port ?? "<PORT>"; const nl = String.fromCharCode(10);
    console.log(nl + `PRÊT — build ${q.commit}. Image A : ${q.A.size} o (${q.A.sha.slice(0, 12)}…), image B : ${q.B.size} o (${q.B.sha.slice(0, 12)}…).${p.boards === 1 ? "" : " (carte non détectée : remplacer <PORT>)"}`);
    console.log(nl + "ÉTAPE 2 — dans une AUTRE fenêtre (à laisser ouverte) :" + nl + "   ota-lab\\r4-ota3\\CANARY-2-SERVEUR.cmd");
    console.log("ÉTAPE 3 — téléverser l'image A DE CETTE PRÉPARATION (pas depuis l'IDE : il compilerait une autre image) :" + nl + `   "${io.cli}" upload --fqbn arduino:renesas_uno:unor4wifi -p ${port} --input-dir "${q.A.dir}"`);
    console.log("ÉTAPE 4 — lancer le canari :" + nl + "   ota-lab\\r4-ota3\\CANARY-3-LANCER.cmd");
    process.exit(0);
  }
  if (process.argv.includes("--dry-run")) {   // essai à blanc : prévol et compilation RÉELS, carte FICTIVE, confirmation impossible -> s'arrête avant tout téléversement ; n'énumère ni n'ouvre aucun port
    const { FQBN } = await import("./board.mjs"); io.listBoards = async () => [{ port: "COM0", protocol: "serial", serial: "DRY-RUN", fqbns: [FQBN] }]; io.confirm = async () => "DRY-RUN (aucune confirmation donnée)";
    console.log("ESSAI À BLANC : aucune carte ne sera touchée.");
  }
  console.log(`Canari OTA-3 — run ${io.runId} — mode ${mode} — résultats : ${io.runDir}\n`);
  const r = await runCanary(io, { attach: mode === "attach", closeOnUpdate: !process.argv.includes("--keep-port-open")   /* DÉFAUT depuis le PASS du 17/10/2026 : le port série du PC reste ouvert (DTR) = reprogrammation du module en échec (3 essais) ; fermé = réussite */ });
  console.log(`\n==============================\n VERDICT : ${r.verdict}\n Dossier : ${r.dir}\n  verdict.txt / verdict.json / serial-A-to-B.log / serial-B-to-A.log / server.log / preflight.txt${r.v.recovery_file ? " / recovery.txt" : ""}\n==============================`);
  process.exit(r.exitCode);
}
