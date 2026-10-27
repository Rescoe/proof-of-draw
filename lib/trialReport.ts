// lib/trialReport.ts — RAPPORT D'ESSAI d'un candidat (28/10/2026) : pur (aucun accès Redis), sans secret. Alimenté par scripts/trial-report.ts (jeton Redis LECTURE SEULE).
// Preuve centrale visée : un appareil vote pour un format qu'il ne peut PAS afficher (« vote croisé »). Pour chaque candidat : électorat figé au dépôt, appareils invités/votants, format local de chaque votant,
// format du candidat, verdict et métriques recalculées contre la référence du serveur, quorum, issue exacte (bloc miné ou raison de la non-décision).
import { poolSummaryText, readPoolSummary } from "@/lib/electorate";
import { voteV2Capable } from "@/lib/voteCapability";

export interface TrialCandidate { candidateId: string; poolScreen: string; workTitle?: string; kind?: string; poolSize?: number; submittedAt?: number; expiresAt?: number; v2?: { e: number; t: number; r: number; rawBytes: number } | null; pool?: unknown }
export interface TrialVote { deviceId: string; detailLost?: boolean; v?: number; verdict?: string; reason?: string; e?: number; t?: number; r?: number; entropy?: number; transitions?: number; rle?: number; score?: number; votedAt?: number }
export interface TrialDevice { deviceId: string; firmware?: string; screens?: string[] }

const QUORUM_RATIO = 0.51;
const nameOf = (d: TrialDevice | undefined) => (d ? `${d.deviceId} (${String(d.firmware ?? "?")})` : "appareil inconnu");

export interface TrialRow { deviceId: string; firmware: string; localFormats: string; candidateFormat: string; crossFormat: boolean; kind: "v2" | "v1-echo" | "inconnu"; verdict: string; reason: string; metricsMatch: boolean | null; at: number | null }

export function trialRows(c: TrialCandidate, votes: readonly TrialVote[], devices: ReadonlyMap<string, TrialDevice>): TrialRow[] {
  return votes.map((v) => {
    const d = devices.get(v.deviceId);
    const local = (d?.screens ?? []).filter((s) => s !== "sensor");
    const isV2 = v.v === 2;
    const match = isV2 && c.v2 && typeof v.e === "number" ? v.e === c.v2.e && v.t === c.v2.t && v.r === c.v2.r : null;
    return { deviceId: v.deviceId, firmware: String(d?.firmware ?? "?"), localFormats: local.join("+") || "(aucun écran)", candidateFormat: c.poolScreen, crossFormat: local.length === 0 || !local.includes(c.poolScreen), kind: v.detailLost ? "inconnu" : isV2 ? "v2" : "v1-echo", verdict: v.detailLost ? "inconnu (détail du vote non conservé après expiration)" : isV2 ? String(v.verdict ?? "?") : "accept (écho v1, contenu non recalculé)", reason: String(v.reason ?? ""), metricsMatch: match, at: typeof v.votedAt === "number" ? v.votedAt : null };
  });
}

/** Issue exacte : miné, refusé, expiré, ou en cours (avec ce qui manque). */
export function trialOutcome(c: TrialCandidate, rows: readonly TrialRow[], finalState: string | null, now: number): string {
  const needed = Math.max(1, Math.ceil((c.poolSize ?? 1) * QUORUM_RATIO));
  const accepts = rows.filter((r) => r.verdict.startsWith("accept")).length, rejects = rows.filter((r) => r.verdict === "reject").length;
  const lost = rows.filter((r) => r.kind === "inconnu").length;
  const head = `${accepts} acceptation(s), ${rejects} refus${lost ? `, ${lost} vote(s) de détail non conservé` : ""}, quorum ${needed} sur un réseau de ${c.poolSize ?? "?"}`;
  if (finalState === "mined") return `BLOC MINÉ — ${head}`;
  if (finalState === "rejected") return `REFUSÉ par décision — ${head}`;
  if (finalState === "expired") return `EXPIRÉ sans décision — ${head}${rejects > 0 && accepts < needed ? " ; les refus ne finalisent rien" : ""}`;
  if (c.expiresAt && c.expiresAt < now) return `EXPIRÉ (non encore réglé) — ${head}`;
  return `EN COURS — ${head} ; manque ${Math.max(0, needed - accepts)} acceptation(s)`;
}

export function trialReport(c: TrialCandidate, votes: readonly TrialVote[], devices: ReadonlyMap<string, TrialDevice>, finalState: string | null, now: number): string {
  const rows = trialRows(c, votes, devices);
  const pool = readPoolSummary(c.pool);
  const out: string[] = [];
  out.push(`### Candidat ${c.candidateId.slice(0, 8)}… — « ${c.workTitle ?? "(sans titre)"} » — format ${c.poolScreen}${c.kind === "animation" ? " (ANIMATION : vote v1 « écho », contenu non recalculé)" : ""}`);
  out.push(`- Électorat au dépôt : ${pool ? poolSummaryText(pool) : "(non enregistré : candidat antérieur au 28/10/2026)"}`);
  out.push(`- Spécification v2 du serveur : ${c.v2 ? `e=${c.v2.e} t=${c.v2.t} r=${c.v2.r} (${c.v2.rawBytes} o)` : "aucune (animation ou candidat ancien)"}`);
  out.push(`- Issue : **${trialOutcome(c, rows, finalState, now)}**`);
  const cross = rows.filter((r) => r.crossFormat && r.kind === "v2");
  out.push(`- Votes croisés v2 (un appareil vote un format qu'il n'affiche pas) : **${cross.length}**${cross.length ? " — " + cross.map((r) => `${r.deviceId} [${r.localFormats} → ${r.candidateFormat}] ${r.verdict}`).join(" ; ") : ""}`);
  out.push("", "| Appareil | Firmware | Format local | Format du candidat | Vote croisé | Type | Verdict | Motif | Métriques = serveur |", "|---|---|---|---|---|---|---|---|---|");
  for (const r of rows) out.push(`| ${r.deviceId} | ${r.firmware} | ${r.localFormats} | ${r.candidateFormat} | ${r.crossFormat ? "oui" : "non"} | ${r.kind} | ${r.verdict} | ${r.reason || "-"} | ${r.metricsMatch === null ? "n/a" : r.metricsMatch ? "oui" : "NON"} |`);
  if (rows.length === 0) out.push("| (aucun vote enregistré) | | | | | | | | |");
  const silent = [...devices.values()].filter((d) => !votes.some((v) => v.deviceId === d.deviceId) && voteV2Capable(d.firmware));
  if (silent.length) out.push("", `Appareils capables de voter sans vote enregistré pour ce candidat : ${silent.map(nameOf).join(", ")} (inactifs, exclus ou en échec : voir le diagnostic de l'électorat).`);
  return out.join("\n");
}
