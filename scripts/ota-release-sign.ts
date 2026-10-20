// scripts/ota-release-sign.ts — PUBLICATION HORS LIGNE d'une release OTA : signe l'image et le manifeste, écrit ota-releases/<releaseId>/{manifest.json,image.bin}, puis lance le contrôle de pré-publication.
//   node --import tsx scripts/ota-release-sign.ts --image <firmware.bin> --family esp8266-tft18 --version tft18-2.6 --seq 3 --channel canary --canary-devices dev_XXXXXXXX
//        --key-slot a --keys-dir "C:\Users\<vous>\.pod-ota-release" [--wave 10] [--min-seq 1] [--secrets esp8266/esp_tft1.8/secrets.h] [--out ota-releases] [--notes "…"]
// La clé PRIVÉE est lue dans --keys-dir (release-a.private.pem / release-b.private.pem), qui doit être HORS du dépôt ; elle n'est jamais copiée, affichée ni journalisée. Rien n'est téléversé ni déployé.
// L'image doit être le binaire GÉNÉRIQUE (sans Wi-Fi) : le script refuse « SECRET_WIFI » et, avec --secrets, tout SSID / mot de passe en clair.
import fs from "node:fs";
import path from "node:path";
import { createPublicKey, sign as cryptoSign } from "node:crypto";
import { buildSignedFile } from "../lib/otaTrailer";
import { canonicalManifestBytes, type OtaManifest, type OtaChannel } from "../lib/otaManifest";
import { regionSha256 } from "../lib/otaTrailer";
import { checkPublication, containsSecret } from "../lib/otaReleases";

export interface SignOptions {
  image: string; family: string; version: string; seq: number; minSeq?: number; channel: OtaChannel; canaryDevices?: string[]; wave?: number; keySlot: "a" | "b"; keysDir: string;
  out: string; secrets?: Array<string | null | undefined>; notes?: string; repoRoot?: string; board?: string; screen?: string;
}
export interface SignResult { releaseId: string; dir: string; regionSha256: string; fileBytes: number; check: { ok: boolean; errors: string[] } }

const inside = (root: string, p: string) => { const r = path.relative(path.resolve(root), path.resolve(p)); return r === "" || (!r.startsWith("..") && !path.isAbsolute(r)); };

export function signRelease(o: SignOptions): SignResult {
  const repo = o.repoRoot ?? path.join(__dirname, "..");
  if (inside(repo, o.keysDir)) throw new Error("dossier de clés dans le dépôt : refusé (les clés privées de publication restent hors git)");
  const privPath = path.join(o.keysDir, `release-${o.keySlot}.private.pem`), pubPath = path.join(o.keysDir, `release-${o.keySlot}.public.pem`);
  const priv = fs.readFileSync(privPath), pub = fs.readFileSync(pubPath, "utf8");
  if (createPublicKey(priv).asymmetricKeyDetails?.modulusLength !== 2048) throw new Error("clé RSA-2048 attendue");
  const image = fs.readFileSync(o.image);
  if (image.includes(Buffer.from("SECRET_WIFI", "latin1"))) throw new Error("l'image contient SECRET_WIFI : binaire non générique, publication refusée");
  if (containsSecret(image, o.secrets ?? [])) throw new Error("l'image contient un identifiant Wi-Fi en clair : publication refusée");
  const built = buildSignedFile(image, { otaSeq: o.seq, family: o.family, firmwareVersion: o.version }, priv);
  const releaseId = `${o.version}-ota${o.seq}`;
  const body: Record<string, unknown> = {
    schema: "pod-ota-manifest-v2", releaseId, family: o.family, profile: { board: o.board ?? "esp8266", screen: o.screen ?? o.family.replace(/^esp8266-/, ""), flash: "4M2M" }, channel: o.channel,
    firmwareVersion: o.version, otaSeq: o.seq, minOtaSeq: o.minSeq ?? 1, revokedSeqs: [], url: `/firmware/${releaseId}/image.bin`, size: built.region.length, sha256: regionSha256(built.region),
    wave: { of: 100, upTo: o.channel === "stable" ? (o.wave ?? 10) : 100 },
    ...(o.channel === "canary" ? { canaryDevices: o.canaryDevices ?? [] } : {}), ...(o.notes ? { notes: o.notes } : {}),
  };
  const sig = cryptoSign("sha256", canonicalManifestBytes(body as unknown as OtaManifest), priv).toString("base64");
  const manifest = { ...body, signature: { alg: "rsa2048-pkcs1-sha256", keyId: `ota-${o.keySlot}`, sig } };
  const dir = path.join(o.out, releaseId);
  if (fs.existsSync(dir)) throw new Error(`${dir} existe déjà : une release publiée ne se réécrit jamais (incrémenter la séquence)`);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  fs.writeFileSync(path.join(dir, "image.bin"), built.file);
  const check = checkPublication(o.out, releaseId, { [`ota-${o.keySlot}`]: pub }, o.secrets ?? []);
  return { releaseId, dir, regionSha256: regionSha256(built.region), fileBytes: built.file.length, check };
}

if (process.argv[1] && process.argv[1].replace(/\\/g, "/").endsWith("ota-release-sign.ts")) {
  const a = process.argv.slice(2), opt = (n: string) => { const i = a.indexOf(n); return i >= 0 ? a[i + 1] : undefined; };
  try {
    let secrets: string[] = [];
    if (opt("--secrets")) {
      const t = fs.readFileSync(opt("--secrets")!, "utf8");
      const g = (n: string) => new RegExp("^\\s*#define\\s+" + n + "\\s+\"((?:[^\"\\\\]|\\\\.)*)\"", "m").exec(t)?.[1];
      secrets = [g("SECRET_WIFI_SSID"), g("SECRET_WIFI_PASSWORD")].filter((x): x is string => !!x);
    }
    const r = signRelease({
      image: opt("--image")!, family: opt("--family")!, version: opt("--version")!, seq: Number(opt("--seq")), minSeq: opt("--min-seq") ? Number(opt("--min-seq")) : undefined,
      channel: opt("--channel") as OtaChannel, canaryDevices: opt("--canary-devices")?.split(","), wave: opt("--wave") ? Number(opt("--wave")) : undefined,
      keySlot: (opt("--key-slot") as "a" | "b") ?? "a", keysDir: opt("--keys-dir")!, out: opt("--out") ?? "ota-releases", secrets, notes: opt("--notes"),
    });
    console.log(`release ${r.releaseId} écrite dans ${r.dir} (${r.fileBytes} o ; SHA-256 de la région signée ${r.regionSha256})`);
    console.log(r.check.ok ? "contrôle de pré-publication : OK" : "contrôle de pré-publication : ÉCHEC\n  - " + r.check.errors.join("\n  - "));
    process.exit(r.check.ok ? 0 : 1);
  } catch (e) { console.error("erreur : " + (e as Error).message); process.exit(2); }
}
