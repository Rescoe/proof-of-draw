// otaR4Vectors.ts — VECTEURS du noyau C++ OTA R4-B (consensus-pod/src/podOtaR4.h), produits par la référence TypeScript lib/otaManifestR4.ts. Clés de TEST déterministes (graines dérivées d'un libellé de test) : aucune clé de production.
// Ligne : « case <nom> <attendu> <famille> <seqInstallee> <canal> <now> <pubA|-> <pubB|-> <manifesteHex|-> <binaireHex|-> »
// <attendu> = refus d'evaluate (parse/signature/family/channel/not-newer/not-active/vote-incompatible) ou « ok » ; pour « ok », <binaire> décide : size (Content-Length honnête != taille signée) / sha256 / ok.
import { createHash } from "node:crypto";
import { signR4Manifest, sha256Hex, evaluateR4Manifest, binaryMatchesR4, pubKeyFromHex, parseR4Manifest } from "../../lib/otaManifestR4";
// @ts-expect-error module .mjs sans déclaration
import { buildNegatives, REF_DEVICE } from "../../ota-lab/r4-ota5/tools/negatives.mjs";
import { createPrivateKey, createPublicKey } from "node:crypto";

const seedOf = (label: string) => createHash("sha256").update("pod-ota-r4-TEST-seed:" + label).digest("hex");
const PKCS8 = Buffer.from("302e020100300506032b657004220420", "hex");
const pubOf = (seedHex: string) => createPublicKey(createPrivateKey({ key: Buffer.concat([PKCS8, Buffer.from(seedHex, "hex")]), format: "der", type: "pkcs8" })).export({ format: "der", type: "spki" }).subarray(-32).toString("hex");
export const TEST_SEEDS = { "r4-a": seedOf("a"), "r4-b": seedOf("b") };
export const TEST_PUBS = { "r4-a": pubOf(TEST_SEEDS["r4-a"]), "r4-b": pubOf(TEST_SEEDS["r4-b"]) };

/** Image de test : 1 201 o déterministes (6 blocs de 200 + 1 : frontière de bloc), table de vecteurs Cortex-M plausible (SP 0x20007FF0, reset 0x00004101). */
export function testImage(len = 1201): Buffer {
  const b = Buffer.alloc(len); let x = 0x1234567; for (let i = 0; i < len; i++) { x = (Math.imul(x, 1103515245) + 12345) & 0x7fffffff; b[i] = x >> 8; }
  b.writeUInt32LE(0x20007ff0, 0); b.writeUInt32LE(0x00004101, 4); return b;
}
export function buildOtaR4Vectors(): { txt: string; lines: number } {
  const bin = testImage(); const out: string[] = [];
  const cases = buildNegatives(bin, { seeds: TEST_SEEDS, pubs: TEST_PUBS }) as Array<{ name: string; manifest: Buffer; binary: Buffer; expectWhy: string; device?: Record<string, unknown> }>;
  for (const c of cases) {
    const dev = { ...REF_DEVICE, ...(c.device ?? {}) } as { family: string; installedSeq: number; channel: string; nowSeconds: number; keys?: string[] };
    const keys: Record<string, string> = {}; for (const id of dev.keys ?? ["r4-a", "r4-b"]) keys[id] = TEST_PUBS[id as "r4-a"];
    const ev = evaluateR4Manifest(c.manifest, keys, dev);
    let expect = ev.why as string;
    if (ev.ok) { const bm = binaryMatchesR4(ev.manifest!, c.binary); expect = bm.ok ? "ok" : bm.why; }
    if (expect !== c.expectWhy) throw new Error(`incohérence référence/attendu pour ${c.name} : ${expect} != ${c.expectWhy}`);
    out.push(`case ${c.name} ${expect} ${dev.family} ${dev.installedSeq} ${dev.channel} ${dev.nowSeconds} ${keys["r4-a"] ?? "-"} ${keys["r4-b"] ?? "-"} ${c.manifest.length ? c.manifest.toString("hex") : "-"} ${c.binary.length ? c.binary.toString("hex") : "-"}`);
  }
  // familles (26/10/2026) : écran 2,8″, écran 1,8″ + capteurs, station capteur sans vote
  const fam = (name: string, mFamily: string, firmware: string, dFamily: string) => {
    const man = signR4Manifest({ family: mFamily, firmware, seq: 6, channel: "canary", size: bin.length, sha256: sha256Hex(bin), notbefore: 0, keyid: "r4-a" }, TEST_SEEDS["r4-a"]);
    const dev = { ...REF_DEVICE, family: dFamily } as { family: string; installedSeq: number; channel: string; nowSeconds: number };
    const keys: Record<string, string> = { "r4-a": TEST_PUBS["r4-a"], "r4-b": TEST_PUBS["r4-b"] };
    const ev = evaluateR4Manifest(man, keys, dev); let expect = ev.why as string;
    if (ev.ok) { const bm = binaryMatchesR4(ev.manifest!, bin); expect = bm.ok ? "ok" : bm.why; }
    out.push(`case ${name} ${expect} ${dev.family} ${dev.installedSeq} ${dev.channel} ${dev.nowSeconds} ${keys["r4-a"]} ${keys["r4-b"]} ${man.toString("hex")} ${bin.toString("hex")}`);
    return expect;
  };
  const famExpect: Record<string, string> = {
    "famille-capteur-ok": fam("famille-capteur-ok", "uno-r4-wifi-sensor", "r4env-1.1", "uno-r4-wifi-sensor"),
    "famille-capteur-firmware-quelconque": fam("famille-capteur-firmware-quelconque", "uno-r4-wifi-sensor", "stationx-9.9", "uno-r4-wifi-sensor"),
    "famille-ecran18-ok": fam("famille-ecran18-ok", "uno-r4-wifi-tft18", "r4tft18-2.0", "uno-r4-wifi-tft18"),
    "famille-ecran18-firmware-sans-vote": fam("famille-ecran18-firmware-sans-vote", "uno-r4-wifi-tft18", "r4tft18-1.0", "uno-r4-wifi-tft18"),
    "famille-capteur-sur-appareil-ecran": fam("famille-capteur-sur-appareil-ecran", "uno-r4-wifi-sensor", "r4env-1.1", "uno-r4-wifi-tft18"),
    "famille-ecran-firmware-capteur": fam("famille-ecran-firmware-capteur", "uno-r4-wifi-tft28", "r4env-1.1", "uno-r4-wifi-tft28"),
  };
  const famWant: Record<string, string> = { "famille-capteur-ok": "ok", "famille-capteur-firmware-quelconque": "ok", "famille-ecran18-ok": "ok", "famille-ecran18-firmware-sans-vote": "vote-incompatible", "famille-capteur-sur-appareil-ecran": "family", "famille-ecran-firmware-capteur": "vote-incompatible" };
  for (const k of Object.keys(famWant)) if (famExpect[k] !== famWant[k]) throw new Error(`famille : ${k} attendu ${famWant[k]}, obtenu ${famExpect[k]}`);
  // clé nulle : la garde de défense en profondeur de l'appareil (Node refuse déjà de vérifier avec elle)
  const good = signR4Manifest({ family: "uno-r4-wifi-tft28", firmware: "r4tft28-2.6", seq: 6, channel: "canary", size: bin.length, sha256: sha256Hex(bin), notbefore: 0, keyid: "r4-a" }, TEST_SEEDS["r4-a"]);
  out.push(`case cle-nulle-ou-absente signature ${REF_DEVICE.family} ${REF_DEVICE.installedSeq} ${REF_DEVICE.channel} ${REF_DEVICE.nowSeconds} ${"00".repeat(32)} - ${good.toString("hex")} ${bin.toString("hex")}`);
  void pubKeyFromHex; void parseR4Manifest;
  return { txt: out.join("\n") + "\n", lines: out.length };
}
