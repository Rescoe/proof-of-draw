// negatives.mjs — jeu de CAS NÉGATIFS du manifeste R4 / du binaire brut. Chaque cas dit pourquoi un appareil doit REFUSER. Utilisé par les tests ; en ligne de commande, écrit artifacts/negatives/<cas>/ (JAMAIS transmis au matériel).
//   node --import tsx ota-lab/r4-ota5/tools/negatives.mjs --bin <fichier.bin> [--keys-dir D] [--out D]
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs"; import { join, dirname } from "node:path"; import { fileURLToPath } from "node:url";
import { signR4Manifest, r4Body, r4SignedBytes, privKeyFromSeedHex, sha256Hex, R4_MAX_SIZE } from "../../../lib/otaManifestR4.ts"; import { sign as cryptoSign } from "node:crypto";

/** Appareil de référence pour les verdicts attendus. */
export const REF_DEVICE = Object.freeze({ family: "uno-r4-wifi-tft28", installedSeq: 5, channel: "canary", nowSeconds: 1_800_000_000 });
const BASE = (bin) => ({ family: "uno-r4-wifi-tft28", firmware: "r4tft28-2.6", seq: 6, channel: "canary", size: bin.length, sha256: sha256Hex(bin), notbefore: 0, keyid: "r4-a" });

/** keys = { seeds: {id: seedHex}, pubs: {id: pubHex} }. Renvoie des cas { name, manifest, binary, device?, expectWhy, note }. expectWhy = code de refus de evaluateR4Manifest, ou binaire: "size"/"sha256". */
export function buildNegatives(bin, keys) {
  const seed = keys.seeds["r4-a"]; const sign = (m) => signR4Manifest(m, seed); const good = sign(BASE(bin)); const cases = [];
  const add = (name, manifest, binary, expectWhy, note, device) => cases.push({ name, manifest, binary, expectWhy, note, device });
  add("ok", good, bin, "ok", "référence acceptée");
  const text = good.toString("latin1");
  const flipSig = text.replace(/sig=([0-9a-f])/, (m, c) => "sig=" + (c === "0" ? "1" : "0")); add("signature-invalide", Buffer.from(flipSig, "latin1"), bin, "signature", "un chiffre de la signature modifié");
  add("manifeste-modifie-apres-signature", Buffer.from(text.replace("seq=6", "seq=9"), "latin1"), bin, "signature", "seq changée après signature");
  add("taille-modifiee-apres-signature", Buffer.from(text.replace(`size=${bin.length}`, `size=${bin.length + 1}`), "latin1"), bin, "signature", "size changée après signature");
  add("cle-inconnue", sign({ ...BASE(bin), keyid: "r4-b" }), bin, "signature", "signé par r4-b alors que le firmware ne connaît que la clé de r4-a dans ce scénario", { ...REF_DEVICE, keys: ["r4-a"] });
  add("mauvaise-famille-appareil", good, bin, "family", "manifeste valide pour une autre famille que celle de l'appareil", { ...REF_DEVICE, family: "uno-r4-wifi-eink29" });
  add("canal-non-eligible", good, bin, "channel", "canal du manifeste ≠ canal de l'appareil", { ...REF_DEVICE, channel: "stable" });
  add("rejeu-meme-sequence", sign({ ...BASE(bin), seq: 5 }), bin, "not-newer", "seq == installée");
  add("downgrade", sign({ ...BASE(bin), seq: 3 }), bin, "not-newer", "seq < installée");
  add("activation-differee", sign({ ...BASE(bin), notbefore: REF_DEVICE.nowSeconds + 3600 }), bin, "not-active", "notbefore dans le futur");
  add("firmware-sans-vote-v2", sign({ ...BASE(bin), firmware: "r4tft28-2.4" }), bin, "vote-incompatible", "version qui ne sait pas voter : l'appareil ne serait plus compté");
  add("firmware-inconnu", sign({ ...BASE(bin), firmware: "inconnu-9.9" }), bin, "vote-incompatible", "préfixe absent de VOTE_V2_FIRMWARE");
  const mal = (name, mut, note) => add(name, Buffer.from(mut(text), "latin1"), bin, "parse", note);
  mal("champ-inconnu", (t) => t.replace("keyid=r4-a\n", "keyid=r4-a\nextra=1\n"), "ligne supplémentaire"); mal("champ-manquant", (t) => t.replace(/notbefore=0\n/, ""), "notbefore absent");
  mal("champs-dans-le-desordre", (t) => t.replace(/family=([^\n]*)\nfirmware=([^\n]*)\n/, "firmware=$2\nfamily=$1\n"), "ordre inversé"); mal("champ-duplique", (t) => t.replace("seq=6\n", "seq=6\nseq=6\n"), "seq dupliquée");
  mal("schema-inconnu", (t) => t.replace("pod-ota-manifest-r4-v1", "pod-ota-manifest-v2"), "schéma OTA-1 v2 : refusé par le parseur R4"); mal("sha256-mal-forme", (t) => t.replace(/sha256=[0-9a-f]{64}/, "sha256=" + "G".repeat(64)), "hash non hexadécimal");
  mal("sha256-majuscules", (t) => t.replace(/sha256=([0-9a-f]{64})/, (m, h) => "sha256=" + h.toUpperCase()), "hash en majuscules (forme canonique = minuscules)"); mal("sig-courte", (t) => t.replace(/sig=[0-9a-f]{128}/, "sig=" + "ab".repeat(10)), "signature trop courte");
  mal("sequence-corrompue-lettres", (t) => t.replace("seq=6", "seq=6x"), "seq non numérique"); mal("sequence-zeros-initiaux", (t) => t.replace("seq=6", "seq=06"), "zéros initiaux"); mal("sequence-hors-limite", (t) => t.replace("seq=6", "seq=2147483648"), "seq > 2^31-1"); mal("sequence-zero", (t) => t.replace("seq=6", "seq=0"), "seq == 0");
  mal("taille-nulle", (t) => t.replace(`size=${bin.length}`, "size=0"), "size nulle"); mal("taille-trop-grande", (t) => t.replace(`size=${bin.length}`, `size=${R4_MAX_SIZE + 1}`), "size > 0x3C000");
  mal("famille-inconnue", (t) => t.replace("uno-r4-wifi-tft28", "uno-r4-wifi-xxx"), "famille hors liste"); mal("canal-inconnu", (t) => t.replace("channel=canary", "channel=beta"), "canal hors liste"); mal("keyid-inconnu", (t) => t.replace("keyid=r4-a", "keyid=r4-z"), "keyid hors liste");
  mal("caractere-non-ascii", (t) => t.replace("firmware=r4tft28-2.6", "firmware=r4tft28-2.6é"), "octet non ASCII"); mal("pas-de-fin-de-ligne", (t) => t.slice(0, -1), "dernier \\n absent"); mal("espaces", (t) => t.replace("seq=6", "seq= 6"), "espace après =");
  add("manifeste-trop-long", Buffer.concat([good, Buffer.alloc(600, 0x41)]), bin, "parse", "> 512 o"); add("manifeste-vide", Buffer.alloc(0), bin, "parse", "vide");
  mal("sequence-11-chiffres", (t) => t.replace("seq=6", "seq=10000000006"), "11 chiffres (débordement de format)"); mal("firmware-mal-forme", (t) => t.replace("firmware=r4tft28-2.6", "firmware=r4tft28-2.6x"), "suffixe parasite sur la version");
  mal("ligne-apres-sig", (t) => t + "x=1\n", "ligne supplémentaire APRÈS sig= (le corps signé change de longueur)"); mal("nom-de-champ-modifie", (t) => t.replace("\nfamily=", "\nfamilx="), "nom de champ altéré, valeurs inchangées"); mal("sequence-debordement-64-bits", (t) => t.replace("seq=6", "seq=18446744073709551622"), "2^64 + 6 : repasse à 6 sur 64 bits");
  add("canal-development-refuse", sign({ ...BASE(bin), channel: "development" }), bin, "channel", "canal development : jamais éligible, même si l'appareil est sur development", { ...REF_DEVICE, channel: "development" });
  add("activation-egale-maintenant", sign({ ...BASE(bin), notbefore: REF_DEVICE.nowSeconds }), bin, "ok", "notbefore == maintenant : actif");
  // domaine de signature : une signature valide d'un AUTRE message (sans préfixe de domaine) doit être refusée
  const bodyNoDomain = r4Body({ ...BASE(bin), schema: "pod-ota-manifest-r4-v1" }); const sigNoDomain = cryptoSign(null, bodyNoDomain, privKeyFromSeedHex(seed)).toString("hex");
  add("signature-sans-separation-de-domaine", Buffer.concat([bodyNoDomain, Buffer.from(`sig=${sigNoDomain}\n`, "latin1")]), bin, "signature", "signée sans le préfixe de domaine : refusée");
  // binaire (manifeste valide)
  add("binaire-tronque", good, bin.subarray(0, bin.length - 1), "size", "un octet de moins"); add("binaire-plus-long", good, Buffer.concat([bin, Buffer.from([0])]), "size", "un octet de plus");
  const alt = Buffer.from(bin); alt[Math.floor(alt.length / 2)] ^= 1; add("binaire-sha256-faux", good, alt, "sha256", "un bit modifié, même taille");
  return cases;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; }; const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
  const binFile = arg("--bin"); if (!binFile) { console.error("usage : negatives.mjs --bin <fichier.bin> [--keys-dir D] [--out D]"); process.exit(2); }
  const kd = arg("--keys-dir", join(ROOT, "artifacts", "keys")), out = arg("--out", join(ROOT, "artifacts", "negatives")); const seeds = {}, pubs = {};
  for (const id of ["r4-a", "r4-b"]) { if (!existsSync(join(kd, id + ".seed"))) { console.error("clés absentes : lancer keygen.mjs"); process.exit(1); } seeds[id] = readFileSync(join(kd, id + ".seed"), "utf8").trim(); pubs[id] = readFileSync(join(kd, id + ".pub"), "utf8").trim(); }
  const cs = buildNegatives(readFileSync(binFile), { seeds, pubs }); for (const c of cs) { const d = join(out, c.name); mkdirSync(d, { recursive: true }); writeFileSync(join(d, "manifest.txt"), c.manifest); writeFileSync(join(d, "firmware.bin"), c.binary); writeFileSync(join(d, "case.json"), JSON.stringify({ name: c.name, expectWhy: c.expectWhy, note: c.note }, null, 2) + "\n"); }
  console.log(`${cs.length} cas écrits dans ${out} (laboratoire : à ne PAS transmettre au matériel)`);
}
