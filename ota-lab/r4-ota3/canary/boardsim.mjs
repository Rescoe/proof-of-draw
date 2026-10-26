// boardsim.mjs — SIMULATEUR de la sonde (protocole @OTA3 du sketch en mode OTA3_AUTO) + pilote de la machine à états. Tests uniquement : aucune E/S, aucune carte.
// Le simulateur reproduit la sémantique du sketch (ticket consommé avant l'appel du module, refus d'un second U, relecture avant armement…) et sait injecter des défauts.
import { initialState, step } from "./machine.mjs";
import { assertSafeCommand } from "./protocol.mjs";

export const UID = "0123456789ABCDEF0123456789ABCDEF";
export const BASE_FCRC = ["11111111", "22222222", "33333333", "44444444", "55555555"];
export const mkCfg = (over = {}) => ({
  A: { name: "A", build: "A", size: 74884, sha: "a".repeat(64), run: "A1B2C3D4" },
  B: { name: "B", build: "B", size: 74884, sha: "b".repeat(64), run: "E5F60718" },
  pcAddresses: [{ address: "192.168.1.10", netmask: "255.255.255.0" }], serverPort: 8080,
  timeouts: { cmd: 1000, wifi: 1000, stage: 1000, ticket: 1000, programming: 2000, hash: 1000, boot: 1000 }, ...over,
});

export class SimBoard {
  constructor(cfg, opts = {}) {
    this.cfg = cfg; this.o = opts; this.running = "A"; this.uid = opts.uid ?? UID; this.fcrc = [...BASE_FCRC];
    this.exp = null; this.staged = null; this.verifyOk = false; this.armed = false; this.hostSet = false; this.updating = false; this.updateCalls = 0; this.sent = [];
  }
  img(name) { return name === "A" ? this.cfg.A : this.cfg.B; }
  idEvent(kind) {
    const im = this.img(this.running); const o = this.o;
    return { e: kind, build: this.running, run: o.badRun && this.running === "B" ? "DEADBEEF" : im.run, uid: o.otherUid && this.running === "B" ? "F".repeat(32) : this.uid, rst: "010000", n: 8192, fcrc: o.dataFlashChanges && this.running === "B" ? [...this.fcrc.slice(0, 4), "99999999"] : [...this.fcrc] };
  }
  boot() { return [this.idEvent("boot")]; }
  /** Commande reçue -> événements immédiats. L'effet de YES (reprogrammation) est livré par finishProgramming(). */
  command(line) {
    assertSafeCommand(line); this.sent.push(line); const [c, a1, a2] = line.split(" ");
    if (this.updating) return [];   // le firmware est bloqué dans ota.update()
    switch (c) {
      case "m": return [this.idEvent("hello")];
      case "h": { const n = Number(a1); const im = this.img(this.flashImage ?? this.running); return [{ e: "fhash", size: n, sha: (this.o.wrongFlashHash && this.running === "B") || (this.o.wrongInitHash && this.updateCalls === 0) || (this.o.wrongFinalHash && this.updateCalls === 2) ? "c".repeat(64) : im.sha }]; }
      case "w": if (this.o.injectErr) return [{ e: "err", m: "nowifi" }]; return [{ e: "wifi", ok: this.o.zeroIp ? 0 : 1, ip: this.o.zeroIp ? "0.0.0.0" : "192.168.1.55" }];
      case "s": this.hostSet = true; return [{ e: "server", ok: 1 }];
      case "d": { this.verifyOk = false; this.exp = null; const target = a1 === "good" ? this.cfg.B : this.cfg.A; this.staged = { size: this.o.badStageSize ? target.size - 1 : target.size, sha: this.o.stagedWrongSha ? "d".repeat(64) : target.sha };
        this.verifyOk = !this.o.verifyNegative; return [{ e: "stage", case: a1, dl: this.staged.size, vf: this.o.verifyNegative ? -10 : 0 }]; }
      case "e": this.exp = { sha: a1, size: Number(a2) }; return [{ e: "expect", size: Number(a2), sha: a1 }];
      case "r": return [this.ticket()];
      case "U": { const t = this.ticket(); if (t.ok !== 1) return [t, { e: "err", m: "u_refused" }]; this.armed = true; return [t, { e: "armed" }]; }
      case "YES": {
        if (!this.armed) return [{ e: "err", m: "go_cancelled" }];
        this.armed = false; const t = this.ticket(); if (t.ok !== 1) return [t, { e: "err", m: "go_cancelled" }];
        this.exp = null; this.verifyOk = false;   // ticket consommé AVANT l'appel
        const o = this.o; this.updating = true; this.updateCalls++;
        return o.doubleBegin ? [t, { e: "update_begin" }, { e: "update_begin" }] : [t, { e: "update_begin" }];
      }
      default: return [];
    }
  }
  ticket() {
    const ok = !!this.exp && this.verifyOk && this.staged && this.staged.size === this.exp.size && this.staged.sha === this.exp.sha;
    return { e: "ticket", ok: ok ? 1 : 0, why: ok ? 0 : 6, size: this.staged?.size ?? 0, sha: this.staged?.sha ?? "0".repeat(64) };
  }
  /** Fin de la reprogrammation : événements livrés après YES selon les défauts injectés. */
  finishProgramming() {
    const o = this.o; this.updating = false; const target = this.running === "A" ? "B" : "A";
    if (o.updateReturns) return [{ e: "update_returned", r: -1 }];
    if (o.noBoot) return [];
    if (o.stillOld) { this.flashImage = this.running; return [this.idEvent("boot")]; }
    this.running = target; this.flashImage = target;
    const out = [this.idEvent("boot")]; if (o.extraBoot) out.push(this.idEvent("boot")); return out;
  }
}

/** Pilote la machine contre le simulateur : exécute les actions send, simule la reprogrammation après update_begin. Rend { state, trace, sim }. */
export function drive(cfg, opts = {}, mutate = (e) => e) {
  const sim = new SimBoard(cfg, opts); let state = initialState(); const trace = [];
  const queue = [{ t: "board", ev: sim.boot()[0] }];
  if (opts.earlyPortGone) queue.push({ t: "port", kind: "gone", port: "COM5" });
  if (opts.earlySerialLost) queue.push({ t: "serial_lost" });
  let guard = 0;
  while (queue.length && guard++ < 500) {
    const ev = mutate(queue.shift()); const r = step(state, ev, cfg); state = r.state; trace.push({ in: ev.t === "board" ? ev.ev.e : ev.t, phase: state.phase });
    for (const a of r.actions) {
      if (a.type === "send") for (const e of sim.command(a.line)) queue.push({ t: "board", ev: e });
    }
    if (state.failed || state.done) break;
    if (sim.updating && state.phase === "PROGRAMMING" && !queue.length) {
      if (opts.portEvents) for (const p of opts.portEvents) queue.push({ t: "port", ...p });
      const fin = sim.finishProgramming();
      if (opts.dropBoot) { queue.push({ t: "serial_open", port: "COM7" }); for (const e of sim.command("m")) queue.push({ t: "board", ev: e }); }   // émule l'orchestrateur : identité redemandée après la reconnexion
      else for (const e of fin) queue.push({ t: "board", ev: e });
      if (opts.helloAfterBoot) queue.push({ t: "board", ev: sim.command("m")[0] });
      if (opts.helloWrong) queue.push({ t: "board", ev: { ...sim.command("m")[0], run: "BAD0BAD0" } });
      if (!queue.length) queue.push({ t: "timeout" });
    }
    if (!queue.length && !state.failed && !state.done) queue.push({ t: "timeout" });   // plus rien à livrer : le délai de la phase expire
  }
  return { state, trace, sim };
}
