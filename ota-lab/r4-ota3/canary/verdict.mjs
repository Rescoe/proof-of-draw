// verdict.mjs — verdict lisible (txt) et machine-readable (json) du canari. Le verdict ne contient AUCUNE adresse IP, aucun identifiant de puce complet, aucun secret : des hash/tailles de binaires,
// les CRC de flash de données, l'issue de chaque étape et les ports COM vus. Les journaux bruts (série, serveur) contiennent des adresses privées : ils restent locaux (runs/ est ignoré par git).
import { createHash } from "node:crypto";

const BS = String.fromCharCode(92);
const IPV4_ANY = /\b\d{1,3}(?:\.\d{1,3}){3}\b/;
const SENSITIVE = new RegExp("SECRET_WIFI|WIFI_SSID|WIFI_PASSWORD|passw(or)?d"+BS+"s*[=:]|"+BS+"bssid"+BS+"s*[=:]", "i");   // valeurs ou macros Wi-Fi ; le simple nom de fichier « secrets.h » est légitime
export function assertClean(text) {
  if (IPV4_ANY.test(text)) throw new Error("le verdict contient une adresse IP : refus d'écrire");
  if (SENSITIVE.test(text)) throw new Error("le verdict contient un terme sensible : refus d'écrire");
  return text;
}
/** Écrit via `write` ; si le texte est refusé (IP, secret), écrit un message de rejet à la place : un verdict ne doit JAMAIS faire planter l'orchestrateur ni fuiter. */
export function safeText(text, name = "fichier") { try { return assertClean(text); } catch (e) { return "[" + name + " NON ÉCRIT : " + e.message + "]" + String.fromCharCode(10); } }
export const shortId = (uid) => (uid ? createHash("sha256").update(String(uid)).digest("hex").slice(0, 12) : null);

/** machineState = état final de la machine ; ctx = { runId, startedAt, endedAt, commit, dirty, images, preflight, portsSeen, aborted, recoveryWritten, steps } */
export function buildVerdict(machineState, ctx) {
  const done = !!machineState?.done, failed = machineState?.failed ?? null;
  const verdict = done ? "PASS" : ctx.aborted ? "ABORTED" : "FAIL";
  const rep = machineState?.report ?? [];
  const boots = rep.filter((r) => r.k === "boot_after").map((r) => ({ leg: r.leg, build: r.build, run: r.run, evidence: r.kind, rst: r.rst, data_flash_unchanged: r.fcrc_same === true }));
  return {
    verdict, run_id: ctx.runId, started_at: ctx.startedAt, ended_at: ctx.endedAt, commit: ctx.commit ?? null, working_tree_clean: ctx.dirty === false,
    failure: failed ? { code: failed.code, why: failed.why, phase: failed.phase, leg: failed.leg } : ctx.aborted ? { code: ctx.aborted.code, why: ctx.aborted.why, phase: ctx.aborted.phase ?? "pre-run", leg: 0 } : null,
    images: ctx.images ?? null, board: { id_hash: shortId(machineState?.ctx?.uid), ports_seen: [...new Set(ctx.portsSeen ?? [])] },
    data_flash: { baseline_crc: machineState?.ctx?.base ?? null, unchanged_after_each_programming: boots.length > 0 && boots.every((b) => b.data_flash_unchanged) },
    programmings: boots, flash_hash_checks: rep.filter((r) => r.k === "flash_hash").length, update_calls: machineState?.ctx?.updateBegins ?? 0,
    steps: rep, preflight: ctx.preflight ?? null, recovery_file: ctx.recoveryWritten ? "recovery.txt" : null, destructive_confirmation: ctx.confirmed === true,
  };
}
export function verdictText(v) {
  const L = [];
  L.push(`VERDICT : ${v.verdict}`); L.push(`Run : ${v.run_id}   Commit : ${v.commit ?? "?"}${v.working_tree_clean ? "" : "  (arbre non propre !)"}`);
  if (v.failure) L.push(`CAUSE : [${v.failure.code}] ${v.failure.why}  (phase ${v.failure.phase}, jambe ${v.failure.leg})`);
  if (v.images) for (const k of ["A", "B"]) if (v.images[k]) L.push(`Image ${k} : ${v.images[k].size} o, SHA-256 ${v.images[k].sha}, run ${v.images[k].run}`);
  L.push(`Reprogrammations demandées : ${v.update_calls}   Contrôles du SHA-256 de la flash programme : ${v.flash_hash_checks}`);
  for (const b of v.programmings) L.push(`  jambe ${b.leg} : démarrage ${b.build} (run ${b.run}) confirmé par « ${b.evidence} » ; flash de données inchangée : ${b.data_flash_unchanged ? "oui" : "NON"}`);
  L.push(`Flash de données (CRC de départ) : ${v.data_flash.baseline_crc ? v.data_flash.baseline_crc.join(" ") : "?"}`);
  L.push(`Ports COM vus : ${v.board.ports_seen.join(", ") || "?"}`);
  if (v.recovery_file) L.push("Une procédure de récupération est écrite dans recovery.txt.");
  L.push(v.verdict === "PASS" ? "Le canari A -> B -> A est RÉUSSI sur cette carte. Cela ne généralise RIEN : la seule affirmation publique reste « OTA non généralisée »." : "Le canari n'a PAS abouti. Aucun retry n'a été fait.");
  return L.join("\n") + "\n";   // le filtre (IP, secrets) est appliqué par safeText() à l'écriture
}
