// tests/canary-machine.test.mjs — machine à états du canari A -> B -> A : succès, arrêts fermés, liste blanche des commandes, et MUTANTS (retirer n'importe quelle garde fait échouer au moins un scénario).
import test from "node:test"; import assert from "node:assert/strict"; import { mkdtempSync, copyFileSync, readFileSync, writeFileSync } from "node:fs"; import { tmpdir } from "node:os"; import { join, dirname } from "node:path"; import { fileURLToPath, pathToFileURL } from "node:url";
const CAN = join(dirname(fileURLToPath(import.meta.url)), "..", "canary");
import { assertSafeCommand, parseLine, LineSplitter, validateId } from "../canary/protocol.mjs";

async function load(mutate) {
  const d = mkdtempSync(join(tmpdir(), "canary-")); for (const f of ["protocol.mjs", "boardsim.mjs"]) copyFileSync(join(CAN, f), join(d, f));
  let m = readFileSync(join(CAN, "machine.mjs"), "utf8"); if (mutate) { if (!m.includes(mutate[0])) throw new Error("mutant : motif absent : " + mutate[0].slice(0, 70)); m = m.replace(mutate[0], mutate[1]); }
  writeFileSync(join(d, "machine.mjs"), m); return import(pathToFileURL(join(d, "boardsim.mjs")).href + "?" + Math.random());
}
// scénario -> code attendu : "DONE" ou le code d'arrêt
const SCEN = [
  ["ok", {}, "DONE"], ["ok-port-gone-back", { portEvents: [{ kind: "gone", port: "COM5" }, { kind: "back", port: "COM7" }] }, "DONE"], ["ok-hello-after-reopen", { dropBoot: true }, "DONE"], ["ok-hello-apres-boot", { helloAfterBoot: true }, "DONE"], ["hello-incoherent", { helloWrong: true }, "unexpected_boot"],
  ["verify-negatif", { verifyNegative: true }, "stage"], ["taille-staging", { badStageSize: true }, "stage"], ["ticket-refuse", { stagedWrongSha: true }, "ticket_refused"],
  ["ip-nulle", { zeroIp: true }, "wifi"], ["hash-flash-faux", { wrongFlashHash: true }, "flash_hash"], ["data-flash-change", { dataFlashChanges: true }, "data_flash_changed"],
  ["autre-carte", { otherUid: true }, "other_board"], ["mauvais-run", { badRun: true }, "wrong_build"], ["ancienne-image", { stillOld: true }, "not_programmed"],
  ["hash-initial-faux", { wrongInitHash: true }, "flash_hash"], ["hash-final-faux", { wrongFinalHash: true }, "flash_hash"], ["port-disparu-hors-programmation", { earlyPortGone: true }, "port_unexpected"], ["flux-perdu-hors-programmation", { earlySerialLost: true }, "serial_lost"], ["double-update-begin", { doubleBegin: true }, "retry"], ["erreur-de-la-sonde", { injectErr: true }, "board_err"], ["pas-de-boot", { noBoot: true }, "timeout"], ["update-revient", { updateReturns: true }, "update_returned"], ["boot-en-trop", { extraBoot: true }, "unexpected_boot"],
];
async function outcomes(mod) {
  const out = {};
  for (const [name, opts] of SCEN) { const r = mod.drive(mod.mkCfg(), opts); out[name] = r.state.done ? "DONE" : r.state.failed?.code ?? "?"; }
  return out;
}
const EXPECTED = Object.fromEntries(SCEN.map(([n, , c]) => [n, c]));

test("scénarios : le succès A -> B -> A et chaque arrêt fermé aboutissent au code attendu", async () => { assert.deepEqual(await outcomes(await load()), EXPECTED); });

test("succès : deux reprogrammations exactement, trois contrôles de hash de flash (A au départ, B, A final), les 5 CRC de data flash comparés, un seul update_begin par jambe", async () => {
  const m = await load(); const r = m.drive(m.mkCfg(), { portEvents: [{ kind: "gone", port: "COM5" }, { kind: "back", port: "COM8" }] });
  assert.ok(r.state.done); assert.equal(r.sim.updateCalls, 2); assert.equal(r.state.ctx.updateBegins, 2);
  assert.equal(r.state.report.filter((x) => x.k === "flash_hash").length, 3); assert.equal(r.state.report.filter((x) => x.k === "boot_after").length, 2);
  assert.deepEqual(r.sim.sent.filter((c) => c.startsWith("d ")), ["d good", "d to-a"]);
  assert.ok(!r.sim.sent.some((c) => /bad|slow|chunked/.test(c)), "jamais badmagic / badpayload");
  // ordre des commandes d'une jambe : e avant r avant U avant YES
  const i = (c) => r.sim.sent.indexOf(c); assert.ok(r.sim.sent.findIndex((c) => c.startsWith("e ")) < i("r") && i("r") < i("U") && i("U") < i("YES"));
});

test("aucun retry : un second update_begin dans la même jambe, ou après un retour d'ota.update(), arrête tout", async () => {
  const m = await load(); let n = 0;
  const r = m.drive(m.mkCfg(), {}, (e) => { if (e.t === "board" && e.ev.e === "update_begin" && n++ === 1) { /* deuxième update_begin de la partie = début de la jambe 2 : légitime */ } return e; });
  assert.ok(r.state.done);
  const { initialState, step } = await import(pathToFileURL(join(CAN, "machine.mjs")).href); const cfg = m.mkCfg();
  let s = initialState(); s = { ...s, phase: "PROGRAMMING", ctx: { ...s.ctx, uid: "U", base: ["1", "2", "3", "4", "5"], updateBegins: 1, updateBeginThisLeg: true } };
  assert.equal(step(s, { t: "board", ev: { e: "update_begin" } }, cfg).state.failed.code, "retry");
  let g = { ...s, phase: "GO" }; assert.equal(step(g, { t: "board", ev: { e: "update_begin" } }, cfg).state.failed.code, "retry", "deuxième update_begin dans la jambe");
  assert.equal(step(g, { t: "board", ev: { e: "update_returned", r: 0 } }, cfg).state.failed.code, "update_returned");
  // un état terminal ignore tout
  const f = step(g, { t: "timeout" }, cfg).state; assert.deepEqual(step(f, { t: "board", ev: { e: "armed" } }, cfg).actions, []);
});

test("matériel : disparition de port, flux perdu ou plusieurs cartes HORS reprogrammation = arrêt ; STOP de la sonde = arrêt", async () => {
  const m = await load(); const { initialState, step } = await import(pathToFileURL(join(CAN, "machine.mjs")).href); const cfg = m.mkCfg();
  for (const phase of ["WAIT_BOOT_A", "SRC_HASH", "WIFI", "SERVER", "STAGE", "EXPECT", "TICKET", "ARM", "GO", "POST_HASH"]) {
    const s = { ...initialState(), phase };
    assert.equal(step(s, { t: "port", kind: "gone", port: "COM5" }, cfg).state.failed?.code, "port_unexpected", phase);
    assert.equal(step(s, { t: "serial_lost" }, cfg).state.failed?.code, "serial_lost", phase);
  }
  const s = { ...initialState(), phase: "PROGRAMMING" };
  assert.equal(step(s, { t: "port", kind: "gone", port: "COM5" }, cfg).state.failed, null, "toléré pendant la reprogrammation");
  assert.equal(step(s, { t: "ambiguous", ports: ["COM5", "COM6"] }, cfg).state.failed.code, "ambiguous_ports");
  assert.equal(step(s, { t: "text", s: "[OTA3] STOP : garde écrasée" }, cfg).state.failed.code, "board_stop");
  assert.equal(step(s, { t: "board", ev: { e: "wifi", ok: 1, ip: "1.2.3.4" } }, cfg).state.failed.code, "unexpected_event", "rien d'autre qu'un boot n'est attendu");
});

test("liste blanche : badmagic, badpayload, autres cas, tailles hors limites et commandes inconnues sont REFUSÉS avant tout envoi", () => {
  for (const ok of ["d good", "d to-a", "r", "U", "YES", "w", "m", "h 74884", "h 245760", "s 192.168.1.10:8080", "e " + "a".repeat(64) + " 74884"]) assert.equal(assertSafeCommand(ok), ok);
  for (const bad of ["d badmagic", "d badpayload", "d slow/good", "d chunked/good", "d trunc", "d pad400", "h 0", "h 245761", "h 1000000", "e " + "a".repeat(64) + " 0", "e " + "a".repeat(63) + " 5", "x", "f", "s 1.2.3.4", "YES ", "u", "d good;U"]) assert.throws(() => assertSafeCommand(bad), /refusée|hors limites/, bad);
});

test("protocole : lignes @OTA3, fragments, JSON invalide, identités", () => {
  assert.equal(parseLine('[OTA3] texte').kind, "text"); assert.equal(parseLine('@OTA3 {"e":"armed"}').ev.e, "armed"); assert.equal(parseLine('@OTA3 {oops').kind, "bad"); assert.equal(parseLine('@OTA3 [1]').kind, "bad");
  const sp = new LineSplitter(); assert.deepEqual(sp.push("ab"), []); assert.deepEqual(sp.push("c\r\nd\n"), ["abc", "d"]);
  const good = { e: "boot", build: "A", run: "A1B2C3D4", uid: "0".repeat(32), n: 8192, fcrc: ["11111111", "22222222", "33333333", "44444444", "55555555"] };
  assert.ok(validateId(good).ok); for (const bad of [{ ...good, n: 4096 }, { ...good, uid: "xyz" }, { ...good, build: "C" }, { ...good, fcrc: ["1"] }, { ...good, run: "G".repeat(8) }]) assert.ok(!validateId(bad).ok);
});

test("choix de l'IP du serveur : une seule interface dans le sous-réseau de la carte, sinon arrêt", async () => {
  const { chooseServerIp } = await import(pathToFileURL(join(CAN, "machine.mjs")).href); const a = (address, netmask = "255.255.255.0") => ({ address, netmask });
  assert.equal(chooseServerIp("192.168.1.55", [a("192.168.1.10"), a("10.0.0.2")]).ip, "192.168.1.10");
  assert.ok(chooseServerIp("192.168.1.55", [a("10.0.0.2")]).error); assert.ok(chooseServerIp("192.168.1.55", [a("192.168.1.10"), a("192.168.1.11")]).error); assert.ok(chooseServerIp("0.0.0.0", [a("192.168.1.10")]).error);
  assert.equal(chooseServerIp("10.29.55.18", [a("10.29.55.189", "255.255.254.0")]).ip, "10.29.55.189");
});

// ── MUTANTS : chaque garde de la machine est nécessaire ──
const MUTANTS = [
  ["uid", "if (id.uid !== state.ctx.uid) return failWith", "if (false) return failWith"],
  ["ancienne image", "if (id.build === src.build && eqHex(id.run, src.run)) return failWith", "if (false) return failWith"],
  ["mauvaise build", "if (id.build !== dst.build || !eqHex(id.run, dst.run)) return failWith", "if (false) return failWith"],
  ["data flash", "if (id.fcrc.some((c, i) => c !== state.ctx.base[i])) return failWith", "if (false) return failWith"],
  ["hash flash après", "if (ev.size !== dst.size || !eqHex(ev.sha, dst.sha)) return failWith(state, \"flash_hash\"", "if (false) return failWith(state, \"flash_hash\""],
  ["hash flash avant", "if (ev.size !== src.size || !eqHex(ev.sha, src.sha)) return failWith", "if (false) return failWith"],
  ["vf", "ev.dl !== dst.size || ev.vf !== 0", "ev.dl !== dst.size"],
  ["taille staging", "ev.dl !== dst.size || ev.vf !== 0", "ev.vf !== 0"],
  ["ticket global", "if (ev.e === \"ticket\" && ev.ok !== 1) return failWith", "if (false) return failWith"],
  ["update_returned", "if (ev.e === \"update_returned\") return failWith", "if (false) return failWith"],
  ["boot inattendu", "if (ev.e !== \"hello\") return failWith(state, \"unexpected_boot\"", "if (false) return failWith(state, \"unexpected_boot\""],
  ["hello incohérent", "return failWith(state, \"unexpected_boot\", \"hello incohérent avec l'image qui doit tourner\");", "return { state, actions: [] };"],
  ["port inattendu", "if (state.phase !== \"PROGRAMMING\") return failWith(state, \"port_unexpected\"", "if (false) return failWith(state, \"port_unexpected\""],
  ["ip nulle", "if (ev.ok !== 1 || !isIpv4(ev.ip) || ev.ip === \"0.0.0.0\") return failWith", "if (false) return failWith"],
  ["flux perdu", "if (state.phase !== \"PROGRAMMING\") return failWith(state, \"serial_lost\"", "if (false) return failWith(state, \"serial_lost\""],
  ["retry", "if (ev.e === \"update_begin\") return failWith(state, \"retry\"", "if (false) return failWith(state, \"retry\""],
  ["timeout", "case \"timeout\": return failWith(state, \"timeout\", `délai dépassé en phase ${state.phase}`);", "case \"timeout\": return { state, actions: [] };"],
  ["erreur sonde", "if (ev.e === \"err\") return failWith", "if (false) return failWith"],
];
test("MUTANTS : retirer n'importe quelle garde de la machine fait dévier au moins un scénario", async () => {
  for (const [name, a, b] of MUTANTS) {
    let out; try { out = await outcomes(await load([a, b])); } catch (e) { throw new Error(`mutant « ${name} » : ${e.message}`); }
    assert.notDeepEqual(out, EXPECTED, `garde NON nécessaire (mutant survivant) : ${name}`);
  }
});
