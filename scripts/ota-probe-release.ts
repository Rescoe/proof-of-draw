// scripts/ota-probe-release.ts — SONDE DE PRÉSENCE d'une release OTA déployée (Preview ou production), SANS aucun effet : un 400 ne prouve RIEN (il vient avant le chargement de la release).
//   OTA_TICKET_SECRET=<valeur de la variable Vercel, jamais affichée> node --import tsx scripts/ota-probe-release.ts --base https://… --release tft18-2.8-ota5 --device dev_XXXXXXXX
// Elle forge un défi VALIDE (HMAC avec OTA_TICKET_SECRET) et une signature d'appareil FAUSSE (128 zéros) : la route répond alors selon l'étape atteinte, et la signature n'est jamais examinée si la porte est fermée.
//   404 « route inactive »     OTA_DIST_MODE ≠ on, ou OTA_TICKET_SECRET / OTA_TRUSTED_KEYS absents côté serveur
//   403 « défi invalide »      OTA_TICKET_SECRET différent entre ce poste et le serveur (la sonde ne prouve rien d'autre)
//   404 « release inconnue »   le défi est accepté mais la release n'est PAS chargée (ota-releases/ absent du déploiement, signature du manifeste refusée, clés de confiance fausses)
//   503 « distribution suspendue »  release PRÉSENTE et chargée + ota:kill posé : c'est la réponse attendue AVANT l'ouverture de la porte (1 commande Redis)
//   403 « signature d'appareil invalide » (ou « appareil inconnu ») : release présente ET porte OUVERTE — ne lancer la sonde que porte fermée
// Le secret est lu dans l'environnement, jamais journalisé ; l'URL affichée ne contient ni défi ni signature.
import { otaChallenge, OTA_TICKET_TTL_SEC } from "../lib/otaDistribution";

export function probeUrl(base: string, releaseId: string, deviceId: string, secret: string, nowMs: number = Date.now()): string {
  const exp = Math.floor(nowMs / 1000) + OTA_TICKET_TTL_SEC;
  return `${base.replace(/\/+$/, "")}/firmware/${releaseId}/image.bin?d=${deviceId}&e=${exp}&c=${otaChallenge(secret, deviceId, releaseId, exp)}&g=${"0".repeat(128)}`;
}
export function interpret(status: number, error: string): string {
  if (status === 503) return "PRÉSENTE — release chargée par le serveur, porte FERMÉE (résultat attendu avant l'ouverture)";
  if (status === 403 && /signature|appareil/.test(error)) return "PRÉSENTE — release chargée ET porte OUVERTE (ota:kill absent) : refermer si ce n'est pas voulu";
  if (status === 404 && /release inconnue/.test(error)) return "ABSENTE — défi accepté mais release non chargée (ota-releases/ non déployé, manifeste ou clés de confiance refusés)";
  if (status === 404) return "INACTIVE — OTA_DIST_MODE ≠ on, ou variables OTA manquantes côté serveur";
  if (status === 403 && /défi/.test(error)) return "INCONCLUANT — le défi est refusé : OTA_TICKET_SECRET diffère entre ce poste et le serveur";
  if (status === 410) return "INCONCLUANT — défi expiré (horloge du poste)";
  if (status === 429) return "INCONCLUANT — limite par IP atteinte, réessayer plus tard";
  return `INATTENDU (${status}) : ${error}`;
}
/**
 * Quelle release est CHARGÉE ? Porte fermée, le 503 porte les empreintes (X-Ota-File-Sha256 = fichier signé servi ; X-Ota-Region-Sha256 = région signée du manifeste). Sans empreinte (ancien déploiement)
 * ou sans valeur attendue, on le dit : « 503 » seul ne distingue PAS l'ancienne release de la nouvelle.
 */
export function identify(headers: { get(n: string): string | null }, expectFile?: string, expectRegion?: string): string {
  const file = headers.get("x-ota-file-sha256"), region = headers.get("x-ota-region-sha256");
  if (!file || !region) return "EMPREINTE ABSENTE — le déploiement ne publie pas les empreintes (ANCIEN code) : impossible de distinguer l'ancienne release de la nouvelle";
  const known = `fichier ${file.slice(0, 16)}…, région ${region.slice(0, 16)}…`;
  if (!expectFile && !expectRegion) return `EMPREINTE LUE (${known}) — aucune valeur attendue fournie (--expect-file-sha / --expect-region-sha)`;
  const okFile = !expectFile || file === expectFile.toLowerCase(), okRegion = !expectRegion || region === expectRegion.toLowerCase();
  return okFile && okRegion ? `RELEASE ATTENDUE — ${known} == valeurs attendues` : `RELEASE DIFFÉRENTE — ${known} ≠ attendu${!okFile ? " (fichier)" : ""}${!okRegion ? " (région)" : ""}`;
}
async function main() {
  const arg = (n: string) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : undefined; };
  const base = arg("--base"), release = arg("--release"), device = arg("--device"), secret = process.env.OTA_TICKET_SECRET;
  if (!base || !release || !device || !secret) { console.error("usage : OTA_TICKET_SECRET=… node --import tsx scripts/ota-probe-release.ts --base <url> --release <id> --device <dev_…> [--expect-file-sha <hex64>] [--expect-region-sha <hex64>]"); process.exit(2); }
  const res = await fetch(probeUrl(base, release, device, secret), { redirect: "manual", headers: { "user-agent": "pod-ota-probe" } });
  let error = ""; try { error = String(((await res.json()) as { error?: string }).error ?? ""); } catch { /* corps non JSON */ }
  const id = res.status === 503 ? "\n" + identify(res.headers, arg("--expect-file-sha"), arg("--expect-region-sha")) : "";
  console.log(`GET ${base}/firmware/${release}/image.bin (défi forgé, signature fausse) → ${res.status} « ${error} »\n${interpret(res.status, error)}${id}`);
}
if (process.argv[1] && /ota-probe-release/.test(process.argv[1])) main().catch((e) => { console.error("erreur : " + (e instanceof Error ? e.message : e)); process.exit(2); });
