// app/api/submit-candidate/route.ts
// Reçoit un dessin validé par /api/draw et le soumet comme candidat au consensus.

import { NextRequest, NextResponse } from "next/server";
import { redis } from "@/lib/redis";
import { getDevice, getGlobalActiveCount, getPoolSnapshot } from "@/lib/deviceStore";
import { getChainHead } from "@/lib/chain";
import { committeeEnforceBlockedByGuard, committeeModeFromEnv, planCandidateCommittee, waveDelayMsFromEnv, type CandidateCommittee } from "@/lib/committee";
import { blockReceiptsEnabled } from "@/lib/blockReceipts";
import { animV3EnforceRequested, animV3ModeFromEnv } from "@/lib/animV3Mode";
import { animShadowLine } from "@/lib/animShadow";
import { ELECTORATE_MAX, authorProfilesOf, candidateEligibilityOf, effectiveEligibilityMode, eligibilityConfigFromEnv, eligibilityModeFromEnv, planPool, type CandidateEligibility } from "@/lib/eligibility";
import {
  computeComplexity,
  decodeEinkBuffer,
  mergeChannels,
  hashDrawing,
  hashActions,
  hashPodEnriched,
  computeEnrichment,
  analyzeReplay,
  MAX_AUTOMATION_RATIO,
} from "@/lib/crypto";
import { setCandidate, getCurrentCandidate, Candidate } from "@/lib/chain";
import { markHot } from "@/lib/hot";
import { getEffectiveThresholds } from "@/lib/adaptiveValidation";
import { buildCandidateV2 } from "@/lib/podVote";
import { PPM } from "@/lib/podMetrics";
import type { ActionEvent, ReplayEvent } from "@/lib/types/actions";
import { BENCH_SCREENS } from "@/lib/bench/screens";
import { buildAnimSubmissionFromClip, type AnimScreen, type AnimSubmission } from "@/lib/anim/block";

const INTERNAL_SECRET  = process.env.INTERNAL_API_SECRET ?? "";

// Le quorum est désormais global : tous les ESP actifs du réseau votent,
// peu importe leur type d'écran. Seul le broadcast d'affichage reste filtré par écran.

export async function POST(req: NextRequest) {
  // Sécurité : le secret DOIT être configuré ET correspondre.
  // Si INTERNAL_API_SECRET est absent de l'environnement, on refuse toujours
  // (évite qu'un oubli de variable ouvre l'endpoint publiquement).
  const secret = req.headers.get("x-internal-secret");
  if (!INTERNAL_SECRET || secret !== INTERNAL_SECRET) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON invalide" }, { status: 400 });
  }

  const { deviceId, screen, black, red, buffer: bodyBuffer } = body as Record<string, string>;
  const animClip = typeof body.animClip === "string" ? body.animClip : undefined;
  const actions      = Array.isArray(body.actions)      ? (body.actions      as ActionEvent[])  : [];
  const replayEvents = Array.isArray(body.replayEvents) ? (body.replayEvents as ReplayEvent[])  : [];
  const drawScore    = typeof body.drawScore === "number" ? body.drawScore : 0;
  const workTitle    = typeof body.workTitle      === "string" ? body.workTitle.trim().slice(0, 80)  : undefined;
  const drawArtistName = typeof body.drawArtistName === "string" ? body.drawArtistName.trim().slice(0, 40) : undefined;

  if (!deviceId || !screen) {
    return NextResponse.json({ error: "deviceId et screen requis" }, { status: 400 });
  }

  const device = await getDevice(deviceId);
  if (!device) {
    return NextResponse.json({ error: "Device introuvable" }, { status: 404 });
  }

  // ── Animation : TOUT est dérivé du clip (images → empreintes, scores par image, racine, affiche). Rien n'est cru sur parole. ──
  let animSub: AnimSubmission | null = null;
  if (animClip) {
    if (!(BENCH_SCREENS as string[]).includes(screen)) return NextResponse.json({ error: "Cet écran ne joue pas d'animation" }, { status: 400 });
    try { animSub = buildAnimSubmissionFromClip(new Uint8Array(Buffer.from(animClip, "base64")), screen as AnimScreen); }
    catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : "Animation invalide" }, { status: 400 }); }
  }
  const buffer = animSub ? animSub.posterBuffer : bodyBuffer;

  let pixels: Uint8Array;

  if (screen === "eink29bwr" && black && red) {
    const bPx = decodeEinkBuffer(black, 296, 128);
    const rPx = decodeEinkBuffer(red, 296, 128);
    pixels = mergeChannels(bPx, rPx);
  } else if (screen === "eink27bw" && buffer) {
    // eink27bw : dimensions driver (176×264) après rotation 90° CCW
    pixels = decodeEinkBuffer(buffer, 176, 264);
  } else if (screen === "oled096" && buffer) {
    pixels = decodeEinkBuffer(buffer, 128, 64);
  } else if ((screen === "tft18" || screen === "tft28") && buffer) {
    // tft18 / tft28 : RGB565 little-endian → binaire "dessiné / fond blanc"
    // On compare directement à 0xFFFF (blanc pur) plutôt que via luminance :
    // la luminance rate les couleurs claires (sable, ciel, jaune) dont lum > 230.
    // Tout pixel qui n'est pas blanc pur = dessiné.
    const rgbBytes = Buffer.from(buffer, "base64");
    const tftPx = screen === "tft28" ? 240 * 320 : 128 * 160;
    pixels = new Uint8Array(tftPx);
    for (let i = 0; i < tftPx; i++) {
      const rgb565 = rgbBytes[i * 2] | (rgbBytes[i * 2 + 1] << 8);
      pixels[i] = rgb565 !== 0xFFFF ? 1 : 0;
    }
  } else {
    return NextResponse.json({ error: "Payload incomplet" }, { status: 400 });
  }

  const W = screen === "eink29bwr" ? 296
          : screen === "eink27bw"  ? 176
          : screen === "tft18"     ? 128
          : screen === "tft28"     ? 240
          : 128;
  const H = screen === "eink29bwr" ? 128
          : screen === "eink27bw"  ? 264
          : screen === "tft18"     ? 160
          : screen === "tft28"     ? 320
          : 64;

  // ── Métriques visuelles + seuils adaptatifs ──────────────────────────────────
  // Calculés en parallèle : metrics depuis les pixels, thresholds depuis l'historique Redis.
  // Animation : métriques = moyenne des métriques de chaque image (le score que les ESP signent est la moyenne des scores d'images).
  const metrics = animSub ? animSub.metrics : computeComplexity(pixels, W, H);
  // Validation réelle (P2) : métriques ENTIÈRES (pod-metrics-2) et hash du contenu brut, que les appareils recalculent. Pour un dessin statique, le score
  // du candidat devient celui de la V2 (corrige le score ≈ 0 de l'e-ink 2,9" BWR, défaut de la V1 : lib/podMetrics.ts).
  const v2 = animSub ? null : buildCandidateV2(screen, screen === "eink29bwr" ? { black, red } : { buffer });
  const effectiveScore = v2 ? v2.s / PPM : metrics.score;

  // ── Analyse géométrique et temporelle du replay ──────────────────────────────
  const [podGeometry, thresholds] = await Promise.all([
    replayEvents.length > 0
      ? Promise.resolve(analyzeReplay(replayEvents, W, H, actions))
      : Promise.resolve(null),
    getEffectiveThresholds(screen),
  ]);

  // seuils adaptatifs — loggés uniquement si mode adaptatif actif
  if (thresholds.mode === "adaptive") {
    console.log(`[submit-candidate] seuils adaptatifs screen=${screen} basé sur ${thresholds.adaptedFrom} blocs (moy complexité=${thresholds.avgComplexity.toFixed(3)})`);
  }

  // ── Vérifications côté serveur ────────────────────────────────────────────────
  // Le serveur n'est PAS juge de la qualité artistique — c'est le réseau ESP qui vote.
  // Le serveur bloque uniquement ce que le réseau ne peut pas détecter lui-même :
  //   • comportement automatisé prouvé (bot)
  // Tout le reste passe et les validateurs ESP décident.
  const qualityWarnings: string[] = [];

  if (podGeometry) {
    // Seul vrai rejet : automatisation (rythme de machine, > 80 % d'intervalles < 15 ms)
    if (podGeometry.automationRatio > MAX_AUTOMATION_RATIO) {
      console.warn(`[submit-candidate] REJET automation_suspected device=${deviceId} ratio=${(podGeometry.automationRatio * 100).toFixed(1)}%`);
      return NextResponse.json({
        rejected: true,
        reason:   "automation_suspected",
        message:  `Séquence d'actions suspecte (rythme non-humain détecté). Soumission rejetée.`,
        automationRatio: podGeometry.automationRatio,
      }, { status: 400 });
    }

    // Avertissements informatifs — transmis au candidat, affichés dans l'UI
    if (podGeometry.sessionDurationMs < thresholds.durationMs)
      qualityWarnings.push(`session courte (${(podGeometry.sessionDurationMs / 1000).toFixed(1)}s)`);
    if (podGeometry.strokeCount < thresholds.strokes)
      qualityWarnings.push(`peu de traits (${podGeometry.strokeCount})`);
    if (podGeometry.gridCoverage < thresholds.coverage)
      qualityWarnings.push(`couverture limitée (${(podGeometry.gridCoverage * 100).toFixed(1)}%)`);

  }

  // Complexité visuelle — warning seulement
  if (effectiveScore < thresholds.complexity)
    qualityWarnings.push(`complexité basse (${(effectiveScore * 100).toFixed(1)}%)`);


  const existing = await getCurrentCandidate();
  if (existing) {
    return NextResponse.json({
      error: "Un dessin est déjà en cours de validation",
      candidateId: existing.candidateId,
      expiresIn: Math.ceil((existing.expiresAt - Date.now()) / 1000),
    }, { status: 409 });
  }

  // Calculer les hashes (actions + enrichissement replay)
  const [imageHash, actionsHash] = await Promise.all([
    animSub ? Promise.resolve(animSub.part.root) : hashDrawing(screen, black, red, buffer),
    hashActions(actions),
  ]);

  // Axe 4 : calcul du hash enrichi si des events de replay sont fournis
  const enrichment = replayEvents.length > 0
    ? computeEnrichment(replayEvents, actions)
    : null;
  const podEnrichedHash = enrichment
    ? await hashPodEnriched(actionsHash, enrichment)
    : undefined;

  // Axe 2 : si drawArtistName est fourni, vérifier que l'ESP est bien en mode public
  const deviceOwnerName = device.artistName ?? "Artiste inconnu";
  const effectiveArtistName = drawArtistName || deviceOwnerName;

  // Quorum global : tous les ESP actifs du réseau, tous écrans confondus
  // Éligibilité des votants (Lot 2, ELIGIBILITY_MODE) : « off » (défaut) = EXACTEMENT le comportement historique ; « shadow » = plan calculé et journalisé, quorum inchangé ;
  // « enforce » = quorum en PROFILS éligibles (auteur exclu, une voix par profil ; bootstrap étiqueté sous 3 profils indépendants). Même lecture Redis que getGlobalActiveCount.
  const eligMode = eligibilityModeFromEnv();
  let poolSize: number;
  let eligibility: CandidateEligibility | undefined;
  let committee: CandidateCommittee | undefined;
  if (eligMode === "off") {
    poolSize = await getGlobalActiveCount();
  } else {
    const snap = await getPoolSnapshot();
    const plan = planPool(snap.devices, authorProfilesOf(device, drawArtistName, snap.devices), Date.now(), eligibilityConfigFromEnv());
    // Comité de validation (Lot 4, COMMITTEE_MODE) : seulement pour une image fixe à contenu v2 ET une éligibilité calculée. « enforce » exige l'éligibilité « enforce » ET les reçus de bloc
    // (BLOCK_RECEIPTS) : sans eux, le comité n'est pas vérifiable et le mineur ne peut pas être rejoué ; le plan reste alors en « shadow » (journal seul). +1 lecture : la tête de chaîne.
    const commMode = committeeModeFromEnv();
    if (committeeEnforceBlockedByGuard()) console.warn("[committee] COMMITTEE_MODE=enforce REFUSÉ : le tirage du comité est calculable par l'auteur avant la soumission (grinding, docs/SIMULATION_PROTOCOLE_V3). Ajouter COMMITTEE_GRINDING_ACK=true pour l'accepter EN CONNAISSANCE DE CAUSE ; plan calculé en SHADOW.");
    if (commMode !== "off" && v2) {
      const head = await getChainHead();
      const state = commMode === "enforce" && eligMode === "enforce" && blockReceiptsEnabled() ? "enforce" : "shadow";
      if (commMode === "enforce" && state === "shadow") console.warn("[committee] COMMITTEE_MODE=enforce ignoré (exige ELIGIBILITY_MODE=enforce ET BLOCK_RECEIPTS=true) : plan calculé en SHADOW");
      committee = planCandidateCommittee({ state, plan, parentHash: head?.blockHash ?? "0".repeat(64), contentHash: v2.rawHash, waveDelayMs: waveDelayMsFromEnv() }) ?? undefined;
      if (committee) console.log(`[committee] ${state.toUpperCase()} mode=${committee.mode} K=${committee.K} seuil=${committee.threshold} rangs=[${committee.ranked.join(",")}] quorumHistorique=${Math.max(1, Math.ceil(snap.legacyCount * 0.51))}`);
    }
    // Électorat trop grand pour être figé (> ELECTORATE_MAX) : sans comité « enforce » le contrôle serait dynamique (décalage numérateur/dénominateur) → ramené à « shadow » pour ce candidat (audit GPT FIX2).
    const effective = effectiveEligibilityMode(eligMode, plan, committee?.state === "enforce");
    if (effective.downgraded) console.warn(`[eligibility] ENFORCE ramené à SHADOW pour ce candidat : ${plan.profiles.length} profils > ${ELECTORATE_MAX} (électorat non figeable) et comité « enforce » inactif ; quorum historique conservé`);
    eligibility = candidateEligibilityOf(effective.mode, plan);
    poolSize = effective.mode === "enforce" ? plan.poolSize : snap.legacyCount;
    console.log(`[eligibility] ${eligMode.toUpperCase()}${effective.downgraded ? "→SHADOW" : ""} plan=${plan.kind} profils=${plan.profiles.length} indépendants=${plan.independentProfiles} auteur=[${plan.authorProfiles.join(",")}] poolHistorique=${snap.legacyCount} poolRetenu=${poolSize}`);
  }
  const CANDIDATE_TTL_SEC = parseInt(process.env.CANDIDATE_TTL_SEC ?? "1800");

  // Warning consolidé — résumé des observations de qualité (non-bloquant)
  const warning = qualityWarnings.length > 0
    ? `Observations : ${qualityWarnings.join(", ")}. Les validateurs du réseau décident.`
    : null;

  console.log(`[submit-candidate] device=${deviceId} screen=${screen} score=${metrics.score.toFixed(3)} drawScore=${drawScore} thresholds=${thresholds.mode}${warning ? ` warnings=[${qualityWarnings.join(", ")}]` : ""}`);

  const candidate: Candidate = {
    candidateId: crypto.randomUUID(),
    deviceId,
    artistName:      deviceOwnerName,         // propriétaire de l'ESP
    drawArtistName:  drawArtistName,           // artiste dessinateur (si ESP en prêt)
    deviceOwnerName: deviceOwnerName,
    workTitle:       workTitle || "Sans titre",
    poolScreen: screen,
    payload: screen === "eink29bwr"
      ? { screen: "eink29bwr", black: black!, red: red! }
      : { screen: screen as string, buffer: buffer! } as import("@/lib/queue").FramePayload,
    imageHash,
    actionsHash,
    drawScore: animSub ? animSub.drawScore : drawScore,
    ...(animSub ? { kind: "animation" as const, anim: animSub.part } : {}),
    actionSequence: actions,
    replayEvents:   replayEvents.length > 0 ? replayEvents : undefined,
    podHashEnriched: podEnrichedHash,
    podGeometry:     podGeometry ?? undefined,
    score: effectiveScore,
    ...(v2 ? { v2 } : {}),
    submittedAt: Date.now(),
    expiresAt: Date.now() + CANDIDATE_TTL_SEC * 1000,
    poolSize,
    ...(eligibility ? { eligibility } : {}),
    ...(committee ? { committee } : {}),
    warning,
  };

  await setCandidate(candidate);
  // pod-anim-v3 (lot 6B-2) : mode « shadow » = la référence v3 de l'animation est calculée et JOURNALISÉE, sans AUCUN effet (0 commande Redis, rien d'écrit, aucun vote ni bloc modifié). « off » (défaut) : rien.
  if (candidate.anim && animV3ModeFromEnv() === "shadow") {
    if (animV3EnforceRequested()) console.warn("[anim-v3] ANIM_V3_MODE=enforce IMPOSSIBLE (non implémenté : lot 8, capacités firmware) : ramené à SHADOW");
    const line = animShadowLine(candidate); if (line) console.log(line);
  }
  markHot().catch(() => {});   // quelqu'un dessine : les écrans au repos passent à 5 min de pull pendant 30 min

  console.log(`[submit-candidate] candidat créé id=${candidate.candidateId} poolSize=${poolSize} score=${metrics.score.toFixed(3)} drawScore=${drawScore} actionsHash=${actionsHash.slice(0, 12)}...`);

  return NextResponse.json({
    ok: true,
    candidateId: candidate.candidateId,
    score: effectiveScore,
    warning,
    metrics: v2
      ? { entropy: v2.e / PPM, transitions: v2.t / PPM, rle: v2.r / PPM }
      : { entropy: metrics.entropy, transitions: metrics.transitions, rle: metrics.rle },
    podGeometry: podGeometry ?? null,
    poolSize,
    expiresIn: CANDIDATE_TTL_SEC,
  });
}
