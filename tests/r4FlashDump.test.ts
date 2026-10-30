// tests/r4FlashDump.test.ts — vidage et comparaison de la data flash d'une station R4 : sonde et commande FLASH-DUMP en LECTURE SEULE, décodage vérifié par CRC-32, verdict de non-régression de l'identité.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
// @ts-ignore module .mjs
import { parseLog, summarize, diff, decodeSeqBlock, wifiState, crc32, SIZE } from "../ota-lab/r4-ota5/tools/flash-dump-decode.mjs";

const read = (f: string) => fs.readFileSync(f, "utf8").replace(/\r\n/g, "\n");
const le32 = (b: Buffer, o: number, v: number) => b.writeUInt32LE(v >>> 0, o);

function station(opts: { seq?: number; wifi?: boolean } = {}): Buffer {
  const b = Buffer.alloc(SIZE, 0xff);
  for (let i = 0; i < 32; i++) b[i] = (i * 7 + 3) & 0xff;                    // « clé privée » factice
  for (let i = 0; i < 32; i++) b[32 + i] = 0x61;                              // dernier bloc connu
  b[64] = 0xed; for (let i = 0; i < 32; i++) b[65 + i] = (i * 5 + 1) & 0xff;  // drapeau + clé publique
  b[97] = 0x01; b[98] = 2; b[99] = 3;
  if (opts.seq !== undefined) { const r = Buffer.alloc(1024, 0xff); r.write("OTS1", 0, "latin1"); r[4] = 1; r[5] = 0xa5; r[6] = 0; r[7] = 0; le32(r, 8, opts.seq); le32(r, 12, 1); le32(r, 16, crc32(r.subarray(0, 16))); r.copy(b, 2048); }
  if (opts.wifi) { const r = Buffer.alloc(105, 0); r.write("PWC1", 0, "latin1"); r[4] = 6; r[5] = 10; r.write("abcdef", 6, "latin1"); r.write("0123456789", 38, "latin1"); le32(r, 101, crc32(r.subarray(0, 101))); r.copy(b, 512); }
  return b;
}
function toLog(bin: Buffer, mutate?: (lines: string[]) => void): string {
  const lines = ["FD BEGIN 8192"];
  for (let a = 0; a < SIZE; a += 32) { const row = bin.subarray(a, a + 32); lines.push(`FD ${a.toString(16).padStart(4, "0")} ${row.toString("hex")} ${crc32(row).toString(16).padStart(8, "0")}`); }
  lines.push("FD END");
  mutate?.(lines);
  return "bruit série\n[WIFI] vidage\n" + lines.join("\n") + "\n";
}

test("décodage : 256 lignes vérifiées par CRC-32, binaire identique, résumé sans clé privée", () => {
  const bin = station({ seq: 13 });
  const p = parseLog(toLog(bin));
  assert.equal(p.ok, true, p.errors.join(";"));
  assert.ok(p.bin!.equals(bin));
  const s = summarize(p.bin);
  assert.equal(s.keyFlagOk, true); assert.equal(s.onboardingShown, true); assert.equal(s.ownedCount, 3);
  assert.equal(s.publicKey, bin.subarray(65, 97).toString("hex"));
  assert.equal(s.effectiveSeq, 13); assert.equal(s.seqBlockA.kind, "valide"); assert.equal(s.seqBlockB.kind, "vierge"); assert.equal(s.wifi.kind, "vierge");
  assert.equal(s.privateKeyPresent, true);
  assert.ok(!JSON.stringify(s).includes(bin.subarray(0, 32).toString("hex")), "la clé privée ne figure jamais dans le résumé");
});
test("vidage invalide refusé : CRC faux, ligne manquante, vidage incomplet", () => {
  const bin = station();
  const bad = parseLog(toLog(bin, (l) => { l[5] = l[5].replace(/ [0-9a-f]{8}$/, " 00000000"); }));
  assert.equal(bad.ok, false); assert.match(bad.errors.join(), /CRC faux/);
  const miss = parseLog(toLog(bin, (l) => { l.splice(10, 1); }));
  assert.equal(miss.ok, false); assert.match(miss.errors.join(), /manquante/);
  const noEnd = parseLog(toLog(bin, (l) => { l.pop(); }));
  assert.equal(noEnd.ok, false);
});
test("séquence OTA et enregistrement Wi-Fi : états décodés sans valeurs secrètes", () => {
  const b = station({ seq: 14, wifi: true });
  assert.deepEqual(decodeSeqBlock(b.subarray(2048, 3072)), { kind: "valide", seq: 14, gen: 1 });
  assert.equal(decodeSeqBlock(b.subarray(3072, 4096)).kind, "vierge");
  const w = wifiState(b);
  assert.deepEqual(w, { kind: "valide", ssidLen: 6, passLen: 10 });
  assert.ok(!JSON.stringify(summarize(b)).includes("abcdef") && !JSON.stringify(summarize(b)).includes("0123456789"));
  b[520] ^= 1; assert.match(wifiState(b).kind, /CRC/);
});
test("comparaison avant/après : seuls Wi-Fi et séquence OTA peuvent changer ; toute atteinte à l'identité, au reste du bloc 0 ou aux autres blocs est détectée (mutants)", () => {
  const before = station({ seq: 13 });
  const after = station({ seq: 14, wifi: true });
  const ok = diff(before, after);
  assert.equal(ok.verdict.onlyExpectedChanged, true);
  assert.ok((ok.byZone as Array<{ id: string; bytes: number }>).find((z) => z.id === "wifi")!.bytes > 0);
  const muts: Array<[string, number]> = [["clé privée", 5], ["clé publique", 70], ["drapeau d'appairage", 97], ["blocs possédés", 99], ["octet 700 (hors enregistrement Wi-Fi mais dans le bloc 0)", 700], ["bloc 1", 1500], ["bloc 7", 7500]];
  for (const [name, at] of muts) {
    const m = Buffer.from(after); m[at] ^= 0xff;
    assert.equal(diff(before, m).verdict.onlyExpectedChanged, false, `mutant non détecté : ${name}`);
  }
  const m2 = Buffer.from(after); m2[520] ^= 1;     // 520 est dans l'enregistrement Wi-Fi : autorisé
  assert.equal(diff(before, m2).verdict.onlyExpectedChanged, true);
});
test("la sonde et la commande FLASH-DUMP sont en LECTURE SEULE (aucune écriture, aucun effacement, aucune programmation de la data flash)", () => {
  const probe = read("ota-lab/r4-ota5/sketch/flash_dump_probe/flash_dump_probe.ino");
  assert.match(probe, /EEPROM\.read\(a \+ i\)/);
  assert.doesNotMatch(probe.replace(/\/\/[^\n]*/g, ""), /EEPROM\.(write|update|put|begin)|DataFlash|erase|program|WiFi|SD\./, "sonde : aucune écriture ni réseau");
  const ino = read("arduino_uno_r4/pod_uno_r4_tft18_env/pod_uno_r4_tft18_env.ino");
  const a = ino.indexOf("static void flashDumpImpl() {"), b = ino.indexOf("static void __attribute__((noinline)) flashDump()");
  assert.ok(a > 0 && b > a);
  const body = ino.slice(a, b);
  assert.match(body, /EEPROM\.read\(a \+ i\)/);
  assert.doesNotMatch(body, /EEPROM\.(write|update|put)|DataFlash|erase|program|podwifi::(store|clear)/, "FLASH-DUMP : lecture seule");
  assert.match(ino, /strcmp\(line, "FLASH-DUMP"\) == 0\) \{ logf\("\[WIFI\] vidage de la data flash demande \(lecture seule\)"\); flashDump\(\); continue; \}/);
  assert.ok(ino.includes("auto wk = [&]() { flashDumpImpl(); }; if (!podWorkRun(wk, &ni))"), "exécuté sur la pile de travail dédiée");
  assert.ok(!body.includes("g_wifiPass") && !body.includes("g_wifiSsid"), "ne touche pas aux identifiants");
});
test("outils : la capture n'écrit que dans un fichier local et ne téléverse rien ; le décodeur n'affiche ni clé privée ni identifiants", () => {
  const ps = read("ota-lab/r4-ota5/tools/flash-dump-capture.ps1");
  assert.doesNotMatch(ps.replace(/#[^\n]*/g, ""), /arduino-cli|upload|bossac|esptool/i);
  const dec = read("ota-lab/r4-ota5/tools/flash-dump-decode.mjs");
  assert.doesNotMatch(dec, /console\.log\([^)]*(subarray\(0, 32\)|privateKey\b)/);
  assert.match(dec, /privateKeyPresent/);
});
