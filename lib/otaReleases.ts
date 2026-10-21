import fs from "node:fs";
import path from "node:path";
import { createPublicKey } from "node:crypto";
import { loadManifest, regionMatchesManifest, type OtaManifest, type OtaTrustedKeys } from "@/lib/otaManifest";
import { deviceVerifyFile } from "@/lib/otaTrailer";
import { OTA_FILE_OVERHEAD, type OtaRelease } from "@/lib/otaDistribution";

// lib/otaReleases.ts — registre STATIQUE des releases OTA (18/10/2026) : un dossier par release `ota-releases/<releaseId>/{manifest.json,image.bin}`, aucune base de données, aucun état Redis.
// Une release n'est servie que si TOUT concorde : manifeste signé (clé publique de confiance), url == /firmware/<releaseId>/image.bin, fichier = région signée ‖ signature RSA ‖ longueur,
// région == manifeste (taille, SHA-256, trailer), signature RSA du fichier valide, version qui sait voter. Rien ici ne signe : la clé privée de publication reste HORS ligne et hors dépôt.
// Procédure de publication (hors ligne) : docs/ADR_DISTRIBUTION_OTA_ESP8266_2026_10_18.md § 8 ; contrôle de pré-publication : checkPublication().

/** OTA_TRUSTED_KEYS = JSON {"ota-a":"-----BEGIN PUBLIC KEY…","ota-b":"…"} : uniquement des clés PUBLIQUES RSA-2048. null si absent ou invalide (route inactive). */
export function trustedKeysFromEnv(env: NodeJS.ProcessEnv = process.env): OtaTrustedKeys | null {
  const raw = env.OTA_TRUSTED_KEYS;
  if (!raw) return null;
  try {
    const o = JSON.parse(raw) as Record<string, unknown>;
    const keys: Record<string, string> = {};
    for (const [id, pem] of Object.entries(o)) {
      if (id !== "ota-a" && id !== "ota-b") return null;
      if (typeof pem !== "string" || /PRIVATE/.test(pem)) return null;            // une clé privée dans la configuration du serveur est une ERREUR : tout est refusé
      const k = createPublicKey(pem);
      if (k.type !== "public" || k.asymmetricKeyType !== "rsa" || k.asymmetricKeyDetails?.modulusLength !== 2048) return null;
      keys[id] = pem;
    }
    return Object.keys(keys).length > 0 ? keys : null;
  } catch { return null; }
}

export interface LoadResult { release: OtaRelease | null; errors: string[] }

/** Charge ET vérifie un dossier de release ; n'exécute rien, ne contacte rien. */
export function loadReleaseDir(dir: string, keys: OtaTrustedKeys): LoadResult {
  const errors: string[] = [];
  let manifestJson: unknown, file: Buffer;
  try { manifestJson = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8")); } catch { return { release: null, errors: ["manifest.json illisible"] }; }
  try { file = fs.readFileSync(path.join(dir, "image.bin")); } catch { return { release: null, errors: ["image.bin illisible"] }; }
  const lm = loadManifest(manifestJson, keys);
  if (!lm.ok) return { release: null, errors: ["manifeste : " + lm.error] };
  const m: OtaManifest = lm.manifest;
  if (path.basename(dir) !== m.releaseId) errors.push("le dossier doit porter le releaseId du manifeste");
  if (m.url !== `/firmware/${m.releaseId}/image.bin`) errors.push("url du manifeste ≠ /firmware/<releaseId>/image.bin");
  if (file.length !== m.size + OTA_FILE_OVERHEAD) errors.push(`taille du fichier ${file.length} ≠ size + 260 (${m.size + OTA_FILE_OVERHEAD})`);
  else {
    if (!regionMatchesManifest(m, file.subarray(0, m.size))) errors.push("la région signée ne correspond pas au manifeste (taille, SHA-256 ou trailer)");
    const verdict = deviceVerifyFile(file, keys[m.signature.keyId], { otaSeq: m.otaSeq, size: m.size }, { family: m.family, installedSeq: 0 });
    if (verdict !== "OK") errors.push("vérification appareil du fichier : " + verdict);
  }
  return errors.length ? { release: null, errors } : { release: { manifest: m, file }, errors };
}

/** Toutes les releases VALIDES du dossier racine (les invalides sont ignorées et listées dans `skipped`). */
export function loadAllReleases(root: string, keys: OtaTrustedKeys): { releases: OtaRelease[]; skipped: Array<{ dir: string; errors: string[] }> } {
  const releases: OtaRelease[] = [], skipped: Array<{ dir: string; errors: string[] }> = [];
  let names: string[] = [];
  try { names = fs.readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort(); } catch { return { releases, skipped }; }
  for (const n of names) {
    const r = loadReleaseDir(path.join(root, n), keys);
    if (r.release) releases.push(r.release); else skipped.push({ dir: n, errors: r.errors });
  }
  return { releases, skipped };
}

/** Un secret en clair figure-t-il dans le fichier ? (secrets de moins de 4 octets ignorés). */
export const containsSecret = (file: Buffer, secrets: ReadonlyArray<string | null | undefined>): boolean => secrets.some((s) => !!s && s.length >= 4 && file.includes(Buffer.from(s, "latin1")));

export interface PublicationCheck { ok: boolean; errors: string[] }
/**
 * Contrôle de PRÉ-PUBLICATION d'un dossier de release (à lancer HORS ligne, avant de committer) : tout ce que loadReleaseDir vérifie, plus
 *  • séquence STRICTEMENT croissante : otaSeq > celui de toute autre release du registre ;  • l'image ne contient ni le nom « SECRET_WIFI » ni un secret fourni (SSID / mot de passe) ;
 *  • un canal « stable » ne démarre pas au-delà de la vague 10 % sans release « canary » antérieure de séquence plus basse.
 */
export function checkPublication(root: string, releaseId: string, keys: OtaTrustedKeys, secrets: ReadonlyArray<string | null | undefined> = []): PublicationCheck {
  const r = loadReleaseDir(path.join(root, releaseId), keys);
  if (!r.release) return { ok: false, errors: r.errors };
  const errors: string[] = [];
  const m = r.release.manifest;
  const others = loadAllReleases(root, keys).releases.filter((x) => x.manifest.releaseId !== releaseId);
  for (const o of others) if (o.manifest.otaSeq >= m.otaSeq) errors.push(`otaSeq ${m.otaSeq} n'est pas strictement supérieur à celui de ${o.manifest.releaseId} (${o.manifest.otaSeq})`);
  if (r.release.file.includes(Buffer.from("SECRET_WIFI", "latin1"))) errors.push("l'image contient le marqueur SECRET_WIFI (identifiants Wi-Fi compilés ?)");
  if (containsSecret(r.release.file, secrets)) errors.push("l'image contient un identifiant Wi-Fi en clair");
  if (m.channel === "stable" && m.wave.upTo > 10 && !others.some((o) => o.manifest.channel === "canary" && o.manifest.family === m.family && o.manifest.otaSeq < m.otaSeq)) errors.push("première diffusion stable au-delà de 10 % sans release canary antérieure de la même famille");
  return { ok: errors.length === 0, errors };
}
