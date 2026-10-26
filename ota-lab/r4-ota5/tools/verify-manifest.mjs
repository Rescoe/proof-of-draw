// verify-manifest.mjs <manifest.txt> [--bin firmware.bin] [--pub keys.json] [--installed-seq N] [--family uno-r4-wifi-tft28] [--channel canary] [--now S]
// VÉRIFICATEUR INDÉPENDANT : n'importe RIEN de lib/otaManifestR4.ts. Réimplémente l'analyse stricte et la vérification Ed25519 avec node:crypto seulement, pour qu'une erreur de la référence TypeScript ne passe pas inaperçue.
// Sortie : « ACCEPTÉ » (code 0) ou « REFUSÉ : <raison> » (code 1).
import { readFileSync } from "node:fs"; import { createHash, createPublicKey, verify } from "node:crypto";
const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const file = process.argv[2]; if (!file || file.startsWith("--")) { console.error("usage : verify-manifest.mjs <manifest.txt> [--bin F] [--pub keys.json] [--installed-seq N]"); process.exit(2); }
const refuse = (why) => { console.log("REFUSÉ : " + why); process.exit(1); };
const raw = readFileSync(file); if (raw.length === 0 || raw.length > 512) refuse("taille du manifeste");
for (const b of raw) if (!(b === 10 || (b >= 32 && b <= 126))) refuse("caractère non ASCII imprimable");
const txt = raw.toString("latin1"); if (txt[txt.length - 1] !== "\n") refuse("fin de ligne"); const L = txt.slice(0, -1).split("\n"); if (L.length !== 10) refuse("nombre de lignes");
const KEYS = ["schema", "family", "firmware", "seq", "channel", "size", "sha256", "notbefore", "keyid"]; const f = {};
KEYS.forEach((k, i) => { if (!L[i].startsWith(k + "=")) refuse(`ligne ${i + 1} : ${k}= attendu`); f[k] = L[i].slice(k.length + 1); if (!f[k] || f[k] !== f[k].trim()) refuse(k + " vide"); });
if (!L[9].startsWith("sig=")) refuse("sig= attendu"); const sig = L[9].slice(4);
if (f.schema !== "pod-ota-manifest-r4-v1") refuse("schema"); if (f.family !== arg("--family", "uno-r4-wifi-tft28")) refuse("famille");
if (!/^[a-z0-9]{1,16}-\d{1,3}\.\d{1,3}(\.\d{1,3})?$/.test(f.firmware)) refuse("firmware");
for (const k of ["seq", "size", "notbefore"]) if (!/^(0|[1-9][0-9]{0,9})$/.test(f[k])) refuse(k + " mal formé");
const seq = +f.seq, size = +f.size; if (seq < 1 || seq > 2147483647) refuse("seq hors limites"); if (size < 1 || size > 0x3c000) refuse("size hors limites");
if (!["development", "canary", "stable"].includes(f.channel)) refuse("channel"); if (f.channel === "development" || f.channel !== arg("--channel", f.channel)) refuse("canal non éligible");
if (!/^[0-9a-f]{64}$/.test(f.sha256)) refuse("sha256"); if (!["r4-a", "r4-b"].includes(f.keyid)) refuse("keyid"); if (!/^[0-9a-f]{128}$/.test(sig)) refuse("sig mal formée");
const keys = JSON.parse(readFileSync(arg("--pub", new URL("../artifacts/keys/keys.json", import.meta.url)), "utf8")); const pub = keys[f.keyid]; if (!pub || !/^[0-9a-f]{64}$/.test(pub) || /^0+$/.test(pub)) refuse("clé inconnue ou nulle");
const body = raw.subarray(0, raw.length - (4 + sig.length + 1)); const msg = Buffer.concat([Buffer.from("POD-OTA-R4-MANIFEST-V1\n", "latin1"), body]);
const key = createPublicKey({ key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), Buffer.from(pub, "hex")]), format: "der", type: "spki" });
if (!verify(null, msg, key, Buffer.from(sig, "hex"))) refuse("signature invalide");
const inst = Number(arg("--installed-seq", "0")); if (seq <= inst) refuse(`séquence ${seq} <= installée ${inst} (rejeu / downgrade)`);
if (+f.notbefore > Number(arg("--now", String(Math.floor(Date.now() / 1000))))) refuse("activation différée (notbefore dans le futur)");
const bi = process.argv.indexOf("--bin"); if (bi > 0) { const bin = readFileSync(process.argv[bi + 1]); if (bin.length !== size) refuse(`binaire : ${bin.length} o au lieu de ${size}`); if (createHash("sha256").update(bin).digest("hex") !== f.sha256) refuse("binaire : SHA-256 différent"); }
console.log(`ACCEPTÉ : seq=${seq} size=${size} firmware=${f.firmware} channel=${f.channel} keyid=${f.keyid}`);
