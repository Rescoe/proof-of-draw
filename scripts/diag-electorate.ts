// scripts/diag-electorate.ts — DIAGNOSTIC DE L'ÉLECTORAT (28/10/2026), LECTURE SEULE.
// Usage : node --env-file=<.env.local> --import tsx scripts/diag-electorate.ts [candidateId]
// Garanties : n'utilise que le jeton Redis LECTURE SEULE (KV_REST_API_READ_ONLY_TOKEN) — le serveur Upstash refuse toute écriture avec ce jeton ; commandes bornées (SMEMBERS devices:all, un MGET, quelques GET / LRANGE) ;
// jamais de KEYS / SCAN / FLUSH ; AUCUN secret affiché (ni MAC, ni code d'appairage, ni clé publique ou privée, ni Wi-Fi) : seulement leur présence.
import { Redis } from "@upstash/redis";
import { ACTIVE_WINDOW_MS } from "../lib/pullBudget";
import { voteV2Capable } from "../lib/voteCapability";
import { maxMissedFromEnv } from "../lib/quorumResponsive";
import { exclusionReason, EXCLUSION_LABEL, summarizePool, poolSummaryText } from "../lib/electorate";

const url = process.env.KV_REST_API_URL, token = process.env.KV_REST_API_READ_ONLY_TOKEN;
if (!url || !token) { console.error("KV_REST_API_URL / KV_REST_API_READ_ONLY_TOKEN absents (jeton LECTURE SEULE exigé : aucun repli sur le jeton d'écriture)."); process.exit(2); }
const redis = new Redis({ url, token });
const now = Date.now();
const minAgo = (t?: number) => (typeof t === "number" && t > 0 ? Math.round((now - t) / 60000) : null);
const parse = (raw: unknown) => { if (raw == null) return null; try { return typeof raw === "string" ? JSON.parse(raw) : raw; } catch { return null; } };

type Row = { deviceId: string; family: string; firmware: string; screens: string; sensors: string; paired: boolean; lastPingMin: number | null; missedVotes: number; lastVoteMin: number | null; v2Capable: boolean; counted: boolean; reason: string };

async function main() {
  const ids = ((await redis.smembers("devices:all")) as string[]) ?? [];
  const raws = ids.length ? await redis.mget<unknown[]>(...ids.map((id) => `device:${id}`)) : [];
  const max = maxMissedFromEnv();
  const rows: Row[] = [];
  ids.forEach((id, i) => {
    const d = parse(raws[i]);
    if (!d) { rows.push({ deviceId: id, family: "?", firmware: "?", screens: "?", sensors: "?", paired: false, lastPingMin: null, missedVotes: 0, lastVoteMin: null, v2Capable: false, counted: false, reason: "fiche expirée (index obsolète)" }); return; }
    const paired = !!(d.artistId || d.artistName), capable = voteV2Capable(d.firmware), missed = d.missedVotes ?? 0;
    const why = exclusionReason(d, now, ACTIVE_WINDOW_MS);   // MÊME règle que le quorum du serveur (lib/electorate.ts)
    const reason = why === null ? "compté" : why === "missed-votes" ? `exclu : ${missed} manque(s) (seuil ${max})` : EXCLUSION_LABEL[why];
    rows.push({ deviceId: d.deviceId ?? id, family: String(d.firmware ?? "?").split("-")[0], firmware: String(d.firmware ?? "?"), screens: (d.screens ?? []).join("+"), sensors: (d.sensors ?? []).join("+") || "-", paired, lastPingMin: minAgo(d.lastPing), missedVotes: missed, lastVoteMin: minAgo(d.lastVoteAt), v2Capable: capable, counted: reason === "compté", reason });
  });
  console.log(`# Électorat au ${new Date(now).toISOString()} — ${rows.length} appareil(s) connus ; seuil de manques = ${max} ; fenêtre d'activité = ${ACTIVE_WINDOW_MS / 60000} min`);
  console.table(rows.map((r) => ({ deviceId: r.deviceId, firmware: r.firmware, ecrans: r.screens, capteurs: r.sensors, appaire: r.paired, "ping(min)": r.lastPingMin, manques: r.missedVotes, "dernierVote(min)": r.lastVoteMin, v2: r.v2Capable, compte: r.counted, raison: r.reason })));
  const counted = rows.filter((r) => r.counted).length;
  const pool = summarizePool(raws.map((r) => parse(r)), now, ACTIVE_WINDOW_MS);
console.log(`# Compris dans le quorum : ${counted} ; plancher appliqué par getGlobalActiveCount : ${pool.count} — ${poolSummaryText(pool.summary)}${counted === 0 ? "  <== AUCUN appareil compté : le « réseau de 1 » est un PLANCHER, pas un vrai validateur" : ""}`);

  // Candidats récents (archive conservée 90 jours) : liste des refusés / expirés, puis le candidat demandé ou le dernier.
  const list = ((await redis.lrange("rejected:draws", 0, 4)) as unknown[]) ?? [];
  console.log(`# ${list.length} entrée(s) lues dans rejected:draws (les plus récentes)`);
  for (const e of list) {
    const x = parse(e) as Record<string, unknown> | null;
    if (!x) continue;
    const pick = (k: string) => x[k];
    console.log(JSON.stringify({ candidateId: pick("candidateId"), titre: pick("workTitle") ?? pick("title"), ecran: pick("poolScreen"), appareil: pick("deviceId"), score: pick("drawScore"), motif: pick("reason") ?? pick("rejectReason"), reseau: pick("poolSize"), quorum: pick("quorumNeeded"), votes: Array.isArray(pick("votes")) ? (pick("votes") as unknown[]).length : pick("votes"), date: pick("rejectedAt") ?? pick("submittedAt") }));
  }
  const want = process.argv[2] ?? ((await redis.get<string>("candidate:last")) ?? "");
  const arch = want ? parse(await redis.get(`candidate:archive:${want}`)) as Record<string, any> | null : null;
  if (arch) {
    const v2 = arch.v2 ?? null;
    console.log(`# Archive du candidat ${String(want).slice(0, 8)}… : écran=${arch.poolScreen} poolSize=${arch.poolSize} quorum=${arch.quorumNeeded} score=${arch.drawScore ?? arch.score}`);
    console.log(`#   spécification v2 du serveur : ${v2 ? `e=${v2.e} t=${v2.t} r=${v2.r} s=${v2.s} octets=${v2.rawBytes}` : "(aucune)"}`);
    const voters = ((await redis.smembers(`candidate:voters:${want}`)) as string[]) ?? [];
    console.log(`#   votants enregistrés : ${voters.length ? voters.join(", ") : "(aucun)"} ; état final : ${(await redis.get(`candidate:final:${want}`)) ?? "(non réglé)"}`);
  } else console.log(`# Archive du candidat ${want || "(aucun)"} introuvable (expirée ou jamais archivée).`);
}
main().catch((e) => { console.error("Erreur :", e instanceof Error ? e.message : String(e)); process.exit(1); });
