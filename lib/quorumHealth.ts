// lib/quorumHealth.ts — QUORUM VIVANT (25/10/2026) : un appareil qui reçoit les candidats mais ne vote JAMAIS ne doit plus compter dans le quorum.
//
// Constat du 25/10/2026 : le quorum est calculé sur TOUS les appareils appairés actifs (lastPing < 45 min), tous écrans confondus. Un TFT 1,8″ qui tire sans cesse et échoue à voter comptait dans le réseau de 4 :
// il fallait 3 votes sur 4, il n'y en avait que 2, et AUCUN dessin n'était miné depuis 2 jours (tous « expirés sans quorum »).
//
// Règle : un appareil qui était actif et capable de voter mais n'a PAS voté pour un candidat arrivé à expiration reçoit un « manque » (`missedVotes`). Au-delà de QUORUM_MAX_MISSED (défaut 1) il n'est plus
// compté dans le quorum (getGlobalActiveCount / getPoolSnapshot) ; il reste invité à voter : dès qu'il vote, son compteur retombe à 0 et il rejoint le quorum au candidat suivant. Un candidat MINÉ ne pénalise personne
// (les votants tardifs n'y sont pour rien). Le règlement d'un candidat expiré se fait une seule fois (SET NX), à la réconciliation (création du candidat suivant ou lecture de l'onglet « Rejetés »).
// Coût Redis : +2 commandes par vote (SADD + EXPIRE en un aller-retour), +4 à +6 par candidat expiré (porte, SMEMBERS, instantané du réseau) et 1 écriture par appareil pénalisé ou réhabilité. Rien au repos.
import { redis } from "@/lib/redis";
import { getPoolSnapshot, writeDeviceKey, type Device } from "@/lib/deviceStore";

export const VOTERS_TTL_SEC = 24 * 3600;
export const votersKey = (candidateId: string) => `candidate:voters:${candidateId}`;
export const settledKey = (candidateId: string) => `candidate:settled:${candidateId}`;

export { isResponsiveVoter, maxMissedFromEnv } from "@/lib/quorumResponsive";

/** Appareils à pénaliser pour un candidat expiré : actifs, appairés, capables de voter (le `devices` du plan), qui n'ont pas voté. */
export function silentDevices(devices: readonly Device[], voters: ReadonlySet<string>, now: number, activeWindowMs: number): Device[] {
  return devices.filter((d) => !!(d.artistId || d.artistName) && now - d.lastPing < activeWindowMs && !voters.has(d.deviceId));
}

/** À appeler quand un vote est ENREGISTRÉ : mémorise le votant (pour régler le candidat s'il expire) et réhabilite l'appareil. Au mieux : ne lève jamais. */
export async function noteVote(candidateId: string, device: Device, now: number = Date.now()): Promise<void> {
  try {
    await redis.pipeline().sadd(votersKey(candidateId), device.deviceId).expire(votersKey(candidateId), VOTERS_TTL_SEC).exec();
    if ((device.missedVotes ?? 0) > 0 || !device.lastVoteAt || now - device.lastVoteAt > 3_600_000) {
      device.missedVotes = 0; device.lastVoteAt = now;
      await writeDeviceKey(device);
    }
  } catch (e) { console.error("[quorumHealth] noteVote:", e instanceof Error ? e.message : "erreur"); }
}

/** Règle UNE fois un candidat arrivé à expiration sans quorum : les appareils actifs qui n'ont pas voté reçoivent un manque. Retourne leurs identifiants. */
export async function settleExpired(candidateId: string, now: number = Date.now(), activeWindowMs: number = 45 * 60_000): Promise<string[]> {
  try {
    const gate = await redis.set(settledKey(candidateId), "1", { nx: true, ex: VOTERS_TTL_SEC });
    if (gate === null) return [];
    const voters = new Set(((await redis.smembers(votersKey(candidateId))) as string[]) ?? []);
    const { devices } = await getPoolSnapshot(activeWindowMs);
    const silent = silentDevices(devices, voters, now, activeWindowMs);
    for (const d of silent) { d.missedVotes = (d.missedVotes ?? 0) + 1; await writeDeviceKey(d); }
    if (silent.length > 0) console.log(`[quorumHealth] candidat ${candidateId.slice(0, 8)} expiré : ${silent.length} appareil(s) sans vote — ${silent.map((d) => `${d.deviceId}(${d.missedVotes})`).join(", ")}`);
    return silent.map((d) => d.deviceId);
  } catch (e) { console.error("[quorumHealth] settleExpired:", e instanceof Error ? e.message : "erreur"); return []; }
}

/** Avant de calculer le quorum d'un NOUVEAU candidat : le précédent est-il arrivé à expiration sans décision ? Si oui, le régler d'abord (2 lectures : pointeur et candidat courant). */
export async function settleLostPrevious(now: number = Date.now()): Promise<void> {
  try {
    const lastId = await redis.get<string>("candidate:last");
    if (typeof lastId !== "string" || lastId.length === 0) return;
    const current = await redis.get("candidate:current");
    if (current) { try { const c = (typeof current === "string" ? JSON.parse(current) : current) as { candidateId?: string }; if (c?.candidateId === lastId) return; } catch { /* illisible : on continue */ } }
    const final = await redis.get<string>(`candidate:final:${lastId}`);
    if (final === "mined" || final === "rejected") return;   // miné ou refusé par décision : personne n est pénalisé (seul un candidat arrivé à expiration sans quorum compte)
    await settleExpired(lastId, now);
  } catch (e) { console.error("[quorumHealth] settleLostPrevious:", e instanceof Error ? e.message : "erreur"); }
}
