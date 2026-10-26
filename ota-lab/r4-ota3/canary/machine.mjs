// machine.mjs — machine à états PURE du canari A -> B -> A : step(state, événement) -> { state, actions }. Aucun effet de bord, aucune E/S, aucune horloge : tout est rejouable en test.
// Principe d'ARRÊT FERMÉ : tout événement qui n'est pas exactement celui attendu dans la phase courante fait passer l'état à FAILED (terminal) ; un état FAILED ou DONE ignore tout.
// Le ticket de flash n'est PAS réimplémenté ici : il vit dans le sketch (ota3_ticket.h). La machine ne fait que (1) exiger les événements `ticket` ok=1 avec la bonne taille et le bon SHA-256, (2) refuser tout écart.
import { assertSafeCommand, isIpv4, validateId, SAFE_CASES } from "./protocol.mjs";

export const DEFAULT_TIMEOUTS = Object.freeze({ cmd: 20000, wifi: 45000, stage: 90000, ticket: 60000, programming: 300000, hash: 30000, boot: 60000 });

/** Choisit l'IPv4 du PC dans le sous-réseau de la carte. Exactement une interface, sinon erreur (jamais de choix arbitraire). */
export function chooseServerIp(boardIp, addrs) {
  if (!isIpv4(boardIp) || boardIp === "0.0.0.0") return { error: "adresse de la carte invalide" };
  const n = (ip) => ip.split(".").reduce((a, x) => ((a << 8) | Number(x)) >>> 0, 0);
  const hits = (addrs ?? []).filter((a) => isIpv4(a.address) && isIpv4(a.netmask) && ((n(a.address) & n(a.netmask)) >>> 0) === ((n(boardIp) & n(a.netmask)) >>> 0));
  if (hits.length === 0) return { error: "aucune interface du PC dans le sous-réseau de la carte" };
  if (hits.length > 1) return { error: `plusieurs interfaces du PC dans le sous-réseau de la carte (${hits.length}) : ambigu` };
  return { ip: hits[0].address };
}

const send = (line) => ({ type: "send", line: assertSafeCommand(line) });
const timer = (cfg, name) => ({ type: "timer", name, ms: cfg.timeouts[name] ?? DEFAULT_TIMEOUTS[name] });
const eqHex = (a, b) => typeof a === "string" && typeof b === "string" && a.toUpperCase() === b.toUpperCase();

export function initialState() {
  return { phase: "WAIT_BOOT_A", leg: 1, done: false, failed: null, ctx: { uid: null, base: null, bootsSeen: 0, updateBegins: 0, updateBeginThisLeg: false, ports: [], hostIp: null }, report: [] };
}
const legInfo = (cfg, leg) => (leg === 1 ? { src: cfg.A, dst: cfg.B, caseName: "good" } : { src: cfg.B, dst: cfg.A, caseName: "to-a" });

function failWith(state, code, why) {
  const failed = { code, why, phase: state.phase, leg: state.leg };
  return { state: { ...state, phase: "FAILED", failed, report: [...state.report, { k: "fail", ...failed }] }, actions: [{ type: "abort", code, why }] };
}
const ok = (state, phase, actions, note, ctxPatch) => ({ state: { ...state, phase, ctx: ctxPatch ? { ...state.ctx, ...ctxPatch } : state.ctx, report: note ? [...state.report, note] : state.report }, actions });

export function step(state, input, cfg) {
  if (state.done || state.failed) return { state, actions: [] };
  const { dst, src, caseName } = legInfo(cfg, state.leg);
  if (!SAFE_CASES.includes(caseName)) return failWith(state, "case", "cas non autorisé");   // garde de conception : ne peut pas arriver

  // ── événements qui ne viennent pas de la carte ──
  switch (input.t) {
    case "timeout": return failWith(state, "timeout", `délai dépassé en phase ${state.phase}`);
    case "ambiguous": return failWith(state, "ambiguous_ports", `plusieurs cartes compatibles : ${(input.ports ?? []).join(", ")}`);
    case "hw_error": return failWith(state, "hardware", input.why ?? "erreur matérielle");
    case "text": return /STOP :|garde écrasée/.test(input.s ?? "") ? failWith(state, "board_stop", "arrêt de sécurité de la sonde") : { state, actions: [] };
    case "port": {
      if (state.phase !== "PROGRAMMING") return failWith(state, "port_unexpected", `${input.kind} (${input.port ?? "?"}) hors reprogrammation`);
      const ports = [...state.ctx.ports, { kind: input.kind, port: input.port, leg: state.leg }];
      return ok(state, state.phase, [], { k: "port", kind: input.kind, port: input.port, leg: state.leg }, { ports });
    }
    case "serial_lost":
      if (state.phase !== "PROGRAMMING") return failWith(state, "serial_lost", "flux série perdu hors reprogrammation");
      return ok(state, state.phase, [], { k: "serial_lost", leg: state.leg });
    case "serial_open":
      return ok(state, state.phase, [], { k: "serial_open", port: input.port, leg: state.leg });   // l'orchestrateur envoie « m » (hello) s'il n'a vu aucune identité 3 s après l'ouverture
    case "board": break;
    default: return failWith(state, "input", `entrée inconnue : ${input.t}`);
  }

  const ev = input.ev;
  // ── règles globales sur les événements de la carte ──
  if (ev.e === "err") return failWith(state, "board_err", `erreur de la sonde : ${ev.m ?? "?"}`);
  if (ev.e === "update_returned") return failWith(state, "update_returned", `ota.update() est revenu (r=${ev.r}) : pas de reprogrammation ; aucun retry`);
  if (ev.e === "ticket" && ev.ok !== 1) return failWith(state, "ticket_refused", `ticket refusé (why=${ev.why})`);
  const isId = ev.e === "boot" || ev.e === "hello";
  if (isId && !(state.phase === "WAIT_BOOT_A" || state.phase === "PROGRAMMING")) {
    // « boot » hors reprogrammation = reset NON prévu (arrêt). « hello » (réponse à la commande m, inoffensive) est toléré s'il décrit exactement l'image qui tourne, la même puce et la même flash de données.
    if (ev.e !== "hello") return failWith(state, "unexpected_boot", `boot inattendu en phase ${state.phase} : reset non prévu`);
    const v = validateId(ev); const running = state.phase === "POST_HASH" ? dst : src;
    if (!v.ok || v.id.uid !== state.ctx.uid || v.id.build !== running.build || !eqHex(v.id.run, running.run) || v.id.fcrc.some((c, i) => c !== state.ctx.base[i])) return failWith(state, "unexpected_boot", "hello incohérent avec l'image qui doit tourner");
    return { state, actions: [] };
  }

  const T = (name) => timer(cfg, name);
  switch (state.phase) {
    case "WAIT_BOOT_A": {
      if (!isId) return failWith(state, "unexpected_event", `${ev.e} avant le boot de A`);
      const v = validateId(ev); if (!v.ok) return failWith(state, "bad_id", v.why);
      if (v.id.build !== "A" || !eqHex(v.id.run, cfg.A.run)) return failWith(state, "wrong_build", `mauvaise build au départ (${v.id.build}/${v.id.run})`);
      return ok(state, "SRC_HASH", [send(`h ${cfg.A.size}`), T("hash")], { k: "boot", leg: 0, id: v.id }, { uid: v.id.uid, base: v.id.fcrc, bootsSeen: 1 });
    }
    case "SRC_HASH": {
      if (ev.e !== "fhash") return failWith(state, "unexpected_event", `${ev.e} au lieu de fhash`);
      if (ev.size !== src.size || !eqHex(ev.sha, src.sha)) return failWith(state, "flash_hash", "le SHA-256 de la flash ne correspond pas à l'image attendue");
      return ok(state, "WIFI", [send("w"), T("wifi")], { k: "flash_hash", leg: state.leg, image: src.name, size: ev.size });
    }
    case "WIFI": {
      if (ev.e !== "wifi") return failWith(state, "unexpected_event", `${ev.e} au lieu de wifi`);
      if (ev.ok !== 1 || !isIpv4(ev.ip) || ev.ip === "0.0.0.0") return failWith(state, "wifi", "Wi-Fi non connecté ou adresse nulle");
      const c = chooseServerIp(ev.ip, cfg.pcAddresses); if (c.error) return failWith(state, "server_ip", c.error);
      return ok(state, "SERVER", [send(`s ${c.ip}:${cfg.serverPort}`), T("cmd")], { k: "wifi", leg: state.leg }, { hostIp: c.ip });
    }
    case "SERVER": {
      if (ev.e !== "server" || ev.ok !== 1) return failWith(state, "unexpected_event", `${ev.e} au lieu de server`);
      return ok(state, "STAGE", [send(`d ${caseName}`), T("stage")], null);
    }
    case "STAGE": {
      if (ev.e !== "stage") return failWith(state, "unexpected_event", `${ev.e} au lieu de stage`);
      if (ev.case !== caseName || ev.dl !== dst.size || ev.vf !== 0) return failWith(state, "stage", `téléchargement/verify incorrects (dl=${ev.dl}, vf=${ev.vf})`);
      return ok(state, "EXPECT", [send(`e ${dst.sha.toLowerCase()} ${dst.size}`), T("cmd")], { k: "stage", leg: state.leg, case: caseName, dl: ev.dl });
    }
    case "EXPECT": {
      if (ev.e !== "expect") return failWith(state, "unexpected_event", `${ev.e} au lieu de expect`);
      if (ev.size !== dst.size || !eqHex(ev.sha, dst.sha)) return failWith(state, "expect", "valeurs attendues mal enregistrées");
      return ok(state, "TICKET", [send("r"), T("ticket")], null);
    }
    case "TICKET": {
      if (ev.e !== "ticket") return failWith(state, "unexpected_event", `${ev.e} au lieu de ticket`);
      if (ev.size !== dst.size || !eqHex(ev.sha, dst.sha)) return failWith(state, "ticket_mismatch", "le ticket ne concerne pas l'image attendue");
      return ok(state, "ARM", [send("U"), T("ticket")], { k: "ticket", leg: state.leg, step: "r" });
    }
    case "ARM": {
      if (ev.e === "ticket") { if (ev.size !== dst.size || !eqHex(ev.sha, dst.sha)) return failWith(state, "ticket_mismatch", "ticket d'armement incorrect"); return ok(state, "ARM", [], { k: "ticket", leg: state.leg, step: "U" }); }
      if (ev.e !== "armed") return failWith(state, "unexpected_event", `${ev.e} au lieu de armed`);
      return ok(state, "GO", [send("YES"), T("ticket")], null);
    }
    case "GO": {
      if (ev.e === "ticket") { if (ev.size !== dst.size || !eqHex(ev.sha, dst.sha)) return failWith(state, "ticket_mismatch", "ticket juste avant programmation incorrect"); return ok(state, "GO", [], { k: "ticket", leg: state.leg, step: "YES" }); }
      if (ev.e !== "update_begin") return failWith(state, "unexpected_event", `${ev.e} au lieu de update_begin`);
      if (state.ctx.updateBegins >= 2 || state.ctx.updateBeginThisLeg) return failWith(state, "retry", "deuxième update_begin : aucun retry");
      return ok(state, "PROGRAMMING", [T("programming")], { k: "update_begin", leg: state.leg }, { updateBegins: state.ctx.updateBegins + 1, updateBeginThisLeg: true });
    }
    case "PROGRAMMING": {
      if (ev.e === "update_begin") return failWith(state, "retry", "update_begin pendant la reprogrammation");
      if (!isId) return failWith(state, "unexpected_event", `${ev.e} pendant la reprogrammation (rien n'est attendu avant boot)`);
      const v = validateId(ev); if (!v.ok) return failWith(state, "bad_id", v.why);
      const id = v.id;
      if (id.uid !== state.ctx.uid) return failWith(state, "other_board", "identifiant de puce différent : ce n'est pas la même carte");
      if (id.build === src.build && eqHex(id.run, src.run)) return failWith(state, "not_programmed", "l'ancienne image tourne encore : reprogrammation non effectuée");
      if (id.build !== dst.build || !eqHex(id.run, dst.run)) return failWith(state, "wrong_build", `mauvaise image démarrée (${id.build}/${id.run})`);
      if (id.fcrc.some((c, i) => c !== state.ctx.base[i])) return failWith(state, "data_flash_changed", "la flash de données a changé");
      return ok(state, "POST_HASH", [send(`h ${dst.size}`), T("hash")], { k: "boot_after", leg: state.leg, build: id.build, run: id.run, kind: ev.e, rst: id.rst, fcrc_same: true }, { bootsSeen: state.ctx.bootsSeen + (ev.e === "boot" ? 1 : 0) });
    }
    case "POST_HASH": {
      if (ev.e !== "fhash") return failWith(state, "unexpected_event", `${ev.e} au lieu de fhash`);
      if (ev.size !== dst.size || !eqHex(ev.sha, dst.sha)) return failWith(state, "flash_hash", "la flash programmée ne contient pas l'image attendue (SHA-256 différent du .bin)");
      const n = { k: "flash_hash", leg: state.leg, image: dst.name, size: ev.size, after_programming: true };
      if (state.leg === 2) return { state: { ...state, phase: "DONE", done: true, report: [...state.report, n, { k: "done" }] }, actions: [{ type: "done" }] };
      return ok({ ...state, leg: 2 }, "WIFI", [send("w"), T("wifi")], n, { updateBeginThisLeg: false });
    }
    default: return failWith(state, "phase", `phase inconnue : ${state.phase}`);
  }
}
