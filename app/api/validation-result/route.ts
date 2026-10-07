// app/api/validation-result/route.ts
// Les ESP soumettent ici leurs métriques calculées localement.
//
// Corps attendu :
// {
//   deviceId:    "dev_XXXXXXXX",
//   candidateId: "uuid",
//   entropy:     0.72,
//   transitions: 0.41,
//   rle:         0.38,
//   score:       0.54,
//   signature:   "dev_XXXXXXXX:uuid:0.54"   // simplifié V1 — pas de crypto asymétrique côté ESP encore
// }
//
// Quand le quorum est atteint :
//   → finalise le bloc
//   → broadcast la frame validée à toute la pool
//   → supprime le candidat de Redis
//   → les ESP recevront la frame au prochain pull
// app/api/validation-result/route.ts

import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { redis } from "@/lib/redis";
import { frameKey } from "@/lib/queue";
import { broadcastConverted } from "@/lib/broadcast";
import type { Device } from "@/lib/deviceStore";
import { markHot } from "@/lib/hot";
import { countRejects, parseCandidateRaw, parseVotesRaw, PULL_KEY_CANDIDATE, PULL_KEY_VOTES, getVotes, castVote, claimFinalization, finalizeBlock, clearCandidate, ValidationVote } from "@/lib/chain";
import { getIP, forbidden } from "@/lib/rateLimit";
import { verifyEd25519 } from "@/lib/ed25519";
import { dequeueNextDraw } from "@/lib/drawQueue";
import { invalidateThresholdsCache } from "@/lib/adaptiveValidation";
import { broadcastAnimation } from "@/lib/anim/broadcast";
import { invalidateNetworkSnapshot } from "@/lib/networkSnapshot";
import { checkVoteV2, parseVoteV2, voteMessageV2 } from "@/lib/podVote";
import { PPM } from "@/lib/podMetrics";
import { eligibilityConfigFromEnv, eligibilityModeFromEnv, voteGate } from "@/lib/eligibility";

const DEVICE_ID_REGEX = /^dev_[A-Z0-9]{8}$/;
const BLACKLIST_TTL = parseInt(process.env.BLACKLIST_TTL_SECONDS ?? "604800");
const FRAME_TTL_SEC = parseInt(process.env.DRAW_WINDOW_SEC ?? "900");

async function broadcastValidatedFrame(poolScreen: string, payload: Record<string, unknown>, frameId: string, displayTime: number, blockIndex: number, artistName: string, blockHash?: string): Promise<void> {
  const _block = { index: blockIndex, artistName, displayTime, frameId, minedAt: Date.now(), ...(blockHash ? { hash: blockHash } : {}) };
  const ttl = Math.max(900, Math.min(displayTime, 7200));

  // Écrans d'autres types ayant opté pour la conversion : indépendant du pool natif
  // (peut y avoir des récepteurs même si la pool de ce type d'écran est vide).
  await broadcastConverted(poolScreen, payload, { frameId, extra: { _block }, ttlSec: ttl, sourceDeviceId: "consensus" });

  const members = (await redis.smembers(`pool:screen:${poolScreen}`)) as string[];
  if (!members || members.length === 0) return;

  const banValues = await redis.mget<(string | null)[]>(...members.map((dId) => `bl:dev:${dId}`));
  const eligible = members.filter((_, i) => !banValues[i]);

  const enrichedPayload = {
    ...payload,
    _block,
  };

  const stored = JSON.stringify({ payload: enrichedPayload, frameId, createdAt: Date.now(), sourceDeviceId: "consensus" });

  await Promise.all(eligible.map((dId) => redis.set(frameKey(dId, poolScreen), stored, { ex: ttl })));
  console.log(`[validation-result] broadcast pool=${poolScreen} devices=${eligible.length} ttl=${ttl}s`);
}

function json(body: unknown, status = 200) { return NextResponse.json(body, { status }); }

export async function POST(req: NextRequest) {
  try {
    const ip = getIP(req);

    let body: Record<string, unknown>;
    try { body = await req.json(); } catch { return json({ error: "JSON invalide" }, 400); }

    const { deviceId, candidateId, entropy, transitions, rle, score, signature } = body as Record<string, string | number>;

    if (!deviceId || !DEVICE_ID_REGEX.test(String(deviceId))) return json({ error: "deviceId invalide" }, 400);
    // Vote v2 (validation réelle, P2) : l'appareil a recalculé le hash et les métriques (e, t, r en ppm) et signe son verdict. Voir lib/podVote.ts.
    const isV2 = Number((body as Record<string, unknown>).v) === 2;
    if (!isV2 && (!candidateId || entropy == null || transitions == null || rle == null || score == null)) return json({ error: "Métriques manquantes" }, 400);
    if (!candidateId) return json({ error: "candidateId manquant" }, 400);

    // UN MGET : blacklist IP + appareil + candidat + votes (≈ 5 commandes avant le 05/10/2026 : blacklist, appareil, candidat, votes + écriture)
    const raws = await redis.mget<unknown[]>(`bl:ip:${ip}`, `device:${String(deviceId)}`, PULL_KEY_CANDIDATE, PULL_KEY_VOTES);
    if (raws[0] !== null) return forbidden("Accès refusé");
    let device: Device | null = null;
    try { device = raws[1] ? (typeof raws[1] === "string" ? JSON.parse(raws[1] as string) : (raws[1] as Device)) : null; } catch { device = null; }
    if (!device) return json({ error: "Device inconnu" }, 404);

    const candidate = parseCandidateRaw(raws[2]);
    if (!candidate) return json({ error: "Aucun candidat actif" }, 409);
    const prefetchedVotes = parseVotesRaw(raws[3]);
    if (candidate.candidateId !== String(candidateId)) return json({ error: "candidateId ne correspond pas au candidat actif", current: candidate.candidateId }, 409);

    // ── Éligibilité (Lot 2, ELIGIBILITY_MODE) : aucune lecture Redis de plus. « off » : aucun effet. « shadow » : journal seul. « enforce » : refus 403 (inéligible) / 409 (profil déjà représenté). ──
    const eligMode = eligibilityModeFromEnv();
    let voterProfileId: string | null = null;
    if (eligMode !== "off" && candidate.eligibility) {
      const prior = new Set<string>();
      if (prefetchedVotes && prefetchedVotes.candidateId === candidate.candidateId) for (const v of Object.values(prefetchedVotes.votes)) if (v.profileId && v.deviceId !== String(deviceId)) prior.add(v.profileId);
      const gate = voteGate({ mode: eligMode, eligibility: candidate.eligibility, device, now: Date.now(), cfg: eligibilityConfigFromEnv(), priorVoterProfiles: prior });
      if (gate.action === "shadow-refuse") console.warn(`[eligibility] SHADOW refuserait le vote device=${deviceId} raison=${gate.reason} profil=${gate.profileId ?? "?"}`);
      if (gate.action === "refuse") {
        console.warn(`[eligibility] REFUS du vote device=${deviceId} raison=${gate.reason} profil=${gate.profileId ?? "?"}`);
        return json({ error: gate.reason === "profile-already-voted" ? "Profil déjà représenté par un autre appareil" : "Appareil non éligible pour ce candidat", reason: gate.reason }, gate.status);
      }
      if (gate.action === "allow") voterProfileId = gate.profileId;
    }

    let espScore = Number(score);
    const serverScore = candidate.score;
    const drift = isV2 ? 0 : Math.abs(espScore - serverScore);
    if (drift > 0.4) console.warn(`[validation-result] drift élevé device=${deviceId} drift=${drift.toFixed(3)}`);

    // ── Vérification signature ED25519 ────────────────────────────────────────
    // MODE PERMISSIF : la signature est vérifiée et loggée, mais un échec
    // n'interdit plus le vote. Le vote est accepté dès que le device est
    // enregistré et actif. Cela permet le minage même en cas d'incompatibilité
    // de librairie ED25519 entre l'ESP et Node.js (problème rhempel vs OpenSSL).
    // STRICT_SIGNATURE=true dans les variables Vercel pour réactiver le rejet.
    // Vote v2 : signature OBLIGATOIRE (jamais permissive) sur « pod-vote-v2|appareil|candidat|hash|version|e|t|r|verdict » ; un accept doit reproduire
    // exactement le hash et les métriques du serveur (calcul entier, tolérance zéro). Un reject signé est conservé mais ne finalise rien.
    let v2Vote: { e: number; t: number; r: number; verdict: "accept" | "reject"; reason?: string; suspect: boolean } | null = null;
    if (isV2) {
      if (!candidate.v2) return json({ error: "Candidat sans spécification v2 : voter en v1" }, 409);
      const parsed = parseVoteV2(body);
      if (!parsed || parsed.deviceId !== String(deviceId) || parsed.candidateId !== candidate.candidateId) return json({ error: "Vote v2 invalide" }, 400);
      const sig2 = String(signature ?? "");
      if (!device.publicKey || sig2.length !== 128 || !verifyEd25519(device.publicKey, voteMessageV2(parsed), sig2)) {
        console.warn(`[validation-result] vote v2 : signature invalide ou clé absente device=${deviceId}`);
        return json({ error: "Signature invalide" }, 403);
      }
      const check = checkVoteV2(candidate.v2, parsed);
      if (!check.ok) {
        console.warn(`[validation-result] vote v2 refusé (${check.reason} différent du candidat) device=${deviceId}`);
        return json({ error: `Vote refusé : ${check.reason} différent du candidat`, reason: check.reason }, 422);
      }
      v2Vote = { e: parsed.e, t: parsed.t, r: parsed.r, verdict: check.verdict, reason: parsed.reason, suspect: check.suspect };
      espScore = check.verdict === "accept" ? candidate.v2.s / PPM : 0;
    }

    const STRICT_SIG = process.env.STRICT_SIGNATURE === "true";
    const sigStr = String(signature ?? "");

    if (isV2) {
      // déjà vérifiée plus haut
    } else if (device.publicKey && sigStr.length === 128) {
      // Tentative de vérification ED25519 — log le résultat, ne bloque QUE en mode strict
      const message = `${deviceId}:${String(candidateId)}:${espScore.toFixed(3)}`;
      const valid   = verifyEd25519(device.publicKey, message, sigStr);
      if (!valid) {
        console.warn(`[validation-result] signature ED25519 invalide device=${deviceId} pubKey=${device.publicKey.slice(0,16)}... msg="${message}" sig=${sigStr.slice(0,16)}...`);
        if (STRICT_SIG) {
          return json({ error: "Signature invalide" }, 403);
        }
        // Mode permissif → on continue malgré l'échec de vérification
        console.warn(`[validation-result] mode permissif — vote accepté malgré signature invalide device=${deviceId}`);
      } else {
        console.log(`[validation-result] signature ED25519 valide device=${deviceId}`);
      }
    } else if (device.publicKey && sigStr.length !== 128) {
      // Device avec publicKey mais signature format V1 (old firmware) — accepté avec warning
      console.warn(`[validation-result] signature V1 (longueur ${sigStr.length}) device=${deviceId} — reflash firmware recommandé`);
      if (STRICT_SIG) {
        return json({ error: "Signature invalide — longueur incorrecte, reflash firmware requis" }, 403);
      }
    } else {
      // Firmware v1 sans publicKey enregistrée — vote accepté (fallback)
      console.warn(`[validation-result] pas de publicKey device=${deviceId} — mise à jour firmware requise`);
    }

    const vote: ValidationVote = { ...(v2Vote
      ? { deviceId: String(deviceId), entropy: v2Vote.e / PPM, transitions: v2Vote.t / PPM, rle: v2Vote.r / PPM, score: espScore, signature: String(signature ?? ""), votedAt: Date.now(),
          v: 2, verdict: v2Vote.verdict, ...(v2Vote.reason ? { reason: v2Vote.reason } : {}), ...(v2Vote.suspect ? { suspect: true } : {}) }
      : { deviceId: String(deviceId), entropy: Number(entropy), transitions: Number(transitions), rle: Number(rle), score: espScore, signature: String(signature ?? ""), votedAt: Date.now() }),
      ...(voterProfileId ? { profileId: voterProfileId } : {}) };
    const { quorumReached, voteCount, needed, rejectCount } = await castVote(vote, candidate, prefetchedVotes);

    // Trop de refus pour que le quorum d'approbations soit encore atteignable : le candidat est refusé par le réseau (vote v2 uniquement).
    // G1 (reprise du 06/10/2026) : pendant le canari, un refus v2 est ENREGISTRÉ et observable (carte des votes + journal + réponse) mais ne supprime PAS le candidat :
    // le comité mélange encore des approbations v1 (écho du score serveur) et v2, ce mélange n'a pas de sémantique sûre. Les rejets ne deviennent bloquants qu'avec
    // ENFORCE_V2_REJECTIONS=true, et seulement pour un comité exclusivement v2 (après P0 et le canari matériel).
    const enforceRejections = process.env.ENFORCE_V2_REJECTIONS === "true";
    const rejectionsWouldBlock = !quorumReached && rejectCount !== undefined && rejectCount > 0 && candidate.poolSize - rejectCount < Math.max(1, needed);
    if (rejectionsWouldBlock && enforceRejections) {
      console.log(`[validation-result] candidat REFUSÉ par le réseau candidate=${candidate.candidateId} refus=${rejectCount}/${candidate.poolSize}`);
      await clearCandidate();
      return json({ ok: true, blockMined: false, rejected: true, rejectCount, voteCount, needed }, 200);
    }
    if (v2Vote?.verdict === "reject") {
      console.warn(`[validation-result] REFUS v2 OBSERVÉ (non bloquant) device=${deviceId} candidate=${candidate.candidateId} raison=${v2Vote.reason ?? "?"} refus=${rejectCount ?? 0}/${candidate.poolSize} bloquerait=${rejectionsWouldBlock}`);
    }

    // voteCount===0 && needed===0 → voteMap absent ou candidateId désynchronisé
    if (voteCount === 0 && needed === 0 && !quorumReached) {
      console.warn(`[validation-result] voteMap manquant ou désynchronisé device=${deviceId} candidate=${candidateId}`);
      return json({ error: "Vote non enregistré — candidat expiré ou désynchronisé", blockMined: false }, 409);
    }

    console.log(`[validation-result] vote device=${deviceId} votes=${voteCount}/${needed} quorum=${quorumReached}`);

    if (quorumReached) {
      // Un seul votant mine le bloc ; les votes tardifs (quorum déjà atteint) sortent ici.
      if (!(await claimFinalization(candidate.candidateId))) {
        console.log(`[validation-result] quorum déjà finalisé candidate=${candidate.candidateId} device=${deviceId} — vote tardif ignoré`);
        return json({ ok: true, blockMined: false, alreadyFinalized: true, voteCount, needed }, 200);
      }
      const voteMap = await getVotes();
      const accepted = voteMap ? Object.values(voteMap.votes).filter((v) => v.verdict !== "reject") : [];
      const allVotes = accepted.length > 0 ? accepted : [vote];
      const frameId = crypto.randomUUID();
      // vote.deviceId = l'ESP dont le vote vient d'atteindre le quorum → premier mineur
      const block = await finalizeBlock(candidate, allVotes, frameId, vote.deviceId, voteMap ? countRejects(voteMap) : 0);

      if (candidate.anim) {
        // Animation : diffusée à TOUS les écrans dynamiques (TFT 2.8", TFT 1.8", OLED) dont le firmware la joue — affiche à leur géométrie + pointeur du clip.
        // Jamais d'e-ink, jamais de firmware ancien ; pas besoin d'avoir opté pour les conversions (lib/anim/broadcast.ts).
        await broadcastAnimation({ part: candidate.anim, blockHash: block.blockHash, blockIndex: block.blockIndex, artistName: candidate.artistName, frameId, displayTime: block.displayTime })
          .catch((e) => console.error("[validation-result] diffusion de l'animation échouée:", e));
      } else {
        await broadcastValidatedFrame(candidate.poolScreen, candidate.payload, frameId, block.displayTime, block.blockIndex, candidate.artistName, block.blockHash);
      }
      await clearCandidate();
      invalidateNetworkSnapshot();   // un bloc vient d'être miné : la vue réseau se reconstruit à la prochaine visite
      markHot().catch(() => {});   // un bloc vient d'être miné : le réseau est actif, les écrans restent à 5 min de pull
      // Invalider le cache Next.js → la BlockGallery se rechargera immédiatement
      revalidatePath("/", "page");
      // Invalider le cache des seuils adaptatifs pour cet écran (nouveau bloc = nouvelle moyenne)
      invalidateThresholdsCache(candidate.poolScreen).catch(() => {});
      // La galerie de blocs se revalidera automatiquement dans ≤60s (TTL unstable_cache)
      const poolMembers = (await redis.smembers(`pool:screen:${candidate.poolScreen}`)) as string[];
      Promise.all(poolMembers.map((dId) => redis.del(`personal:frame:${dId}`))).catch((err) => console.error("[validation-result] clear personal frames error:", err));

      console.log(`[validation-result] BLOC #${block.blockIndex} finalisé hash=${block.blockHash.slice(0, 12)}... display=${block.displayTime}s`);

      // ── Traiter le prochain dessin en file d'attente ──────────────────────
      const INTERNAL_SECRET = process.env.INTERNAL_API_SECRET ?? "";
      const proto = req.headers.get("x-forwarded-proto") ?? "https";
      const host  = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
      const base  = process.env.NEXT_PUBLIC_BASE_URL?.trim().replace(/\/$/, "")
                    ?? (host ? `${proto}://${host}` : "https://proof-of-draw.vercel.app");

      const nextEntry = await dequeueNextDraw();
      if (nextEntry) {
        console.log(`[validation-result] traitement file d'attente: device=${nextEntry.deviceId} screen=${nextEntry.screen}`);
        // Fire-and-forget (la réponse principale n'attend pas)
        fetch(`${base}/api/submit-candidate`, {
          method:  "POST",
          headers: { "Content-Type": "application/json", "x-internal-secret": INTERNAL_SECRET },
          body:    JSON.stringify(nextEntry),
        }).then((r) => {
          if (!r.ok) console.error(`[validation-result] queue submit failed: ${r.status}`);
          else console.log(`[validation-result] queue submit ok device=${nextEntry.deviceId}`);
        }).catch((e) => console.error("[validation-result] queue submit error:", e));
      }

      return json({ ok: true, blockMined: true, blockIndex: block.blockIndex, blockHash: block.blockHash, displayTime: block.displayTime, score: block.score, artistName: block.artistName, voteCount }, 200);
    }

    return json({ ok: true, blockMined: false, voteCount, needed, candidateId: candidate.candidateId, expiresIn: Math.ceil((candidate.expiresAt - Date.now()) / 1000), ...(v2Vote?.verdict === "reject" ? { rejectObserved: true, rejectCount: rejectCount ?? 0 } : {}) }, 200);
  } catch (err) {
    console.error("[validation-result] fatal error:", err);
    return json({ error: "Erreur interne", blockMined: false }, 500);
  }
}
