// scripts/trial-report.ts — RAPPORT D'ESSAI, LECTURE SEULE (28/10/2026).
// Usage : node --env-file=<.env.local> --import tsx scripts/trial-report.ts [candidateId ...]   (sans argument : le candidat courant, sinon le dernier archivé)
// Jeton Redis LECTURE SEULE uniquement (KV_REST_API_READ_ONLY_TOKEN) ; commandes bornées (quelques GET, un SMEMBERS devices:all, un MGET) ; aucun secret affiché.
// Protocole d'essai (voir docs/PLAN_RESEAU_VALIDATEURS_ET_STATION_R4_2026_10_28.md § 6) : soumettre depuis l'interface un dessin BWR, un dessin TFT 1,8″, un dessin OLED, si possible un TFT 2,8″, puis une animation ;
// lancer ce script après chaque soumission (et de nouveau une fois le candidat réglé) ; le rapport montre l'électorat figé, les votants, le format local de chacun et les votes croisés.
import { Redis } from "@upstash/redis";
import { trialReport, type TrialCandidate, type TrialDevice, type TrialVote } from "../lib/trialReport";

const url = process.env.KV_REST_API_URL, token = process.env.KV_REST_API_READ_ONLY_TOKEN;
if (!url || !token) { console.error("KV_REST_API_URL / KV_REST_API_READ_ONLY_TOKEN absents (jeton LECTURE SEULE exigé)."); process.exit(2); }
const redis = new Redis({ url, token });
const parse = (raw: unknown) => { if (raw == null) return null; try { return typeof raw === "string" ? JSON.parse(raw) : raw; } catch { return null; } };

async function main() {
  const ids = ((await redis.smembers("devices:all")) as string[]) ?? [];
  const raws = ids.length ? await redis.mget<unknown[]>(...ids.map((id) => `device:${id}`)) : [];
  const devices = new Map<string, TrialDevice>();
  raws.forEach((r) => { const d = parse(r) as TrialDevice | null; if (d?.deviceId) devices.set(d.deviceId, { deviceId: d.deviceId, firmware: d.firmware, screens: d.screens }); });
  const wanted = process.argv.slice(2);
  if (wanted.length === 0) {
    const cur = parse(await redis.get("candidate:current")) as { candidateId?: string } | null;
    const last = (await redis.get<string>("candidate:last")) ?? "";
    wanted.push(cur?.candidateId ?? last);
  }
  const now = Date.now();
  console.log(`# Rapport d'essai — ${new Date(now).toISOString()} — ${devices.size} appareil(s) connus\n`);
  for (const id of wanted.filter(Boolean)) {
    const live = parse(await redis.get("candidate:current")) as (TrialCandidate & { candidateId: string }) | null;
    const arch = live?.candidateId === id ? live : (parse(await redis.get(`candidate:archive:${id}`)) as TrialCandidate | null);
    if (!arch) { console.log(`### Candidat ${id.slice(0, 8)}… introuvable (expiré ou jamais archivé)\n`); continue; }
    const voteMap = parse(await redis.get("candidate:votes")) as { candidateId?: string; votes?: Record<string, TrialVote> } | null;
    const votes = voteMap?.candidateId === id ? Object.values(voteMap.votes ?? {}) : [];
    let voters: string[] = [];
    if (votes.length === 0) voters = ((await redis.smembers(`candidate:voters:${id}`)) as string[]) ?? [];
    const fallbackVotes: TrialVote[] = votes.length ? votes : voters.map((deviceId) => ({ deviceId, detailLost: true }));
    const finalState = (await redis.get<string>(`candidate:final:${id}`)) ?? null;
    console.log(trialReport(arch, fallbackVotes, devices, finalState, now) + "\n");
  }
}
main().catch((e) => { console.error("Erreur :", e instanceof Error ? e.message : String(e)); process.exit(1); });
