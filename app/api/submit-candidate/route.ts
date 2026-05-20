// app/api/submit-candidate/route.ts
// Reçoit un dessin validé par /api/draw et le soumet comme candidat au consensus.

import { NextRequest, NextResponse } from "next/server";
import { redis } from "@/lib/redis";
import { getDevice, getGlobalActiveCount } from "@/lib/deviceStore";
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
import { getEffectiveThresholds } from "@/lib/adaptiveValidation";
import type { ActionEvent, ReplayEvent } from "@/lib/types/actions";

const INTERNAL_SECRET  = process.env.INTERNAL_API_SECRET ?? "";

// Le quorum est désormais global : tous les ESP actifs du réseau votent,
// peu importe leur type d'écran. Seul le broadcast d'affichage reste filtré par écran.

export async function POST(req: NextRequest) {
  const secret = req.headers.get("x-internal-secret");
  if (INTERNAL_SECRET && secret !== INTERNAL_SECRET) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON invalide" }, { status: 400 });
  }

  const { deviceId, screen, black, red, buffer } = body as Record<string, string>;
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
  } else if (screen === "tft18" && buffer) {
    // tft18 : RGB565 little-endian → luminance binaire pour calcul de complexité
    const rgbBytes = Buffer.from(buffer, "base64");
    pixels = new Uint8Array(128 * 160);
    for (let i = 0; i < 128 * 160; i++) {
      const rgb565 = rgbBytes[i * 2] | (rgbBytes[i * 2 + 1] << 8);
      const r = ((rgb565 >> 11) & 0x1F) << 3;
      const g = ((rgb565 >> 5)  & 0x3F) << 2;
      const b = (rgb565 & 0x1F) << 3;
      // Luminance BT.601 → pixel "actif" si non-blanc
      const lum = (r * 77 + g * 150 + b * 29) >> 8;
      pixels[i] = lum < 230 ? 1 : 0;
    }
  } else {
    return NextResponse.json({ error: "Payload incomplet" }, { status: 400 });
  }

  const W = screen === "eink29bwr" ? 296
          : screen === "eink27bw"  ? 176
          : screen === "tft18"     ? 128
          : 128;
  const H = screen === "eink29bwr" ? 128
          : screen === "eink27bw"  ? 264
          : screen === "tft18"     ? 160
          : 64;

  // ── Métriques visuelles + seuils adaptatifs ──────────────────────────────────
  // Calculés en parallèle : metrics depuis les pixels, thresholds depuis l'historique Redis.
  const metrics = computeComplexity(pixels, W, H);

  // ── Analyse géométrique et temporelle du replay ──────────────────────────────
  const [podGeometry, thresholds] = await Promise.all([
    replayEvents.length > 0
      ? Promise.resolve(analyzeReplay(replayEvents, W, H, actions))
      : Promise.resolve(null),
    getEffectiveThresholds(screen),
  ]);

  console.log(
    `[submit-candidate] seuils ${thresholds.mode} screen=${screen}` +
    ` dur≥${(thresholds.durationMs / 1000).toFixed(0)}s` +
    ` strokes≥${thresholds.strokes}` +
    ` coverage≥${(thresholds.coverage * 100).toFixed(1)}%` +
    ` complexity≥${thresholds.complexity.toFixed(3)}` +
    (thresholds.mode === "adaptive" ? ` (basé sur ${thresholds.adaptedFrom} blocs, moy=${thresholds.avgComplexity.toFixed(3)})` : " (plancher seul)"),
  );

  if (podGeometry) {
    // 1. Durée minimale de session (seuil adaptatif par écran)
    if (podGeometry.sessionDurationMs < thresholds.durationMs) {
      console.warn(`[submit-candidate] REJET session_trop_courte device=${deviceId} dur=${podGeometry.sessionDurationMs}ms < ${thresholds.durationMs}ms`);
      return NextResponse.json({
        rejected: true,
        reason:   "session_too_short",
        message:  `Session trop courte (${(podGeometry.sessionDurationMs / 1000).toFixed(1)}s < ${(thresholds.durationMs / 1000).toFixed(0)}s minimum pour ${screen}). Prenez le temps de dessiner.`,
        sessionDurationMs: podGeometry.sessionDurationMs,
        threshold: thresholds.durationMs,
      }, { status: 400 });
    }

    // 2. Nombre de strokes minimal
    if (podGeometry.strokeCount < thresholds.strokes) {
      console.warn(`[submit-candidate] REJET strokes_insuffisants device=${deviceId} strokes=${podGeometry.strokeCount} < ${thresholds.strokes}`);
      return NextResponse.json({
        rejected: true,
        reason:   "too_few_strokes",
        message:  `Trop peu de traits (${podGeometry.strokeCount} détecté${podGeometry.strokeCount > 1 ? "s" : ""}, minimum ${thresholds.strokes} pour ${screen}). Dessinez davantage.`,
        strokeCount: podGeometry.strokeCount,
        threshold: thresholds.strokes,
      }, { status: 400 });
    }

    // 3. Couverture spatiale minimale
    if (podGeometry.gridCoverage < thresholds.coverage) {
      console.warn(`[submit-candidate] REJET couverture_insuffisante device=${deviceId} coverage=${(podGeometry.gridCoverage * 100).toFixed(1)}% < ${(thresholds.coverage * 100).toFixed(1)}%`);
      return NextResponse.json({
        rejected: true,
        reason:   "insufficient_coverage",
        message:  `Dessin trop localisé (couverture ${(podGeometry.gridCoverage * 100).toFixed(1)}% < ${(thresholds.coverage * 100).toFixed(1)}% de la toile pour ${screen}). Utilisez plus de surface.`,
        gridCoverage: podGeometry.gridCoverage,
        threshold: thresholds.coverage,
      }, { status: 400 });
    }

    // 4. Suspicion d'automatisation (rythme non-humain) — seuil global
    if (podGeometry.automationRatio > MAX_AUTOMATION_RATIO) {
      console.warn(`[submit-candidate] REJET automation_suspected device=${deviceId} ratio=${(podGeometry.automationRatio * 100).toFixed(1)}%`);
      return NextResponse.json({
        rejected: true,
        reason:   "automation_suspected",
        message:  `Séquence d'actions suspecte (rythme non-humain détecté). Soumission rejetée.`,
        automationRatio: podGeometry.automationRatio,
      }, { status: 400 });
    }

    // 5. Action "move" (import image) présente dans la séquence — signal d'abus
    if (podGeometry.moveActionCount > 0) {
      console.warn(`[submit-candidate] REJET move_action_detected device=${deviceId} moveCount=${podGeometry.moveActionCount}`);
      return NextResponse.json({
        rejected: true,
        reason:   "image_import_detected",
        message:  `Import d'image détecté dans la séquence d'actions. L'image doit rester un guide visuel, pas être soumise.`,
        moveActionCount: podGeometry.moveActionCount,
      }, { status: 400 });
    }

    console.log(
      `[submit-candidate] geometry OK device=${deviceId}` +
      ` dur=${(podGeometry.sessionDurationMs / 1000).toFixed(1)}s` +
      ` strokes=${podGeometry.strokeCount}` +
      ` coverage=${(podGeometry.gridCoverage * 100).toFixed(1)}%` +
      ` autoRatio=${(podGeometry.automationRatio * 100).toFixed(0)}%`,
    );
  }

  // 6. Complexité visuelle minimale (seuil adaptatif par écran)
  // Calculée depuis les pixels du buffer — indépendante du replay
  if (metrics.score < thresholds.complexity) {
    console.warn(`[submit-candidate] REJET complexity device=${deviceId} score=${metrics.score.toFixed(3)} < ${thresholds.complexity.toFixed(3)}`);
    return NextResponse.json({
      rejected: true,
      reason:   "insufficient_complexity",
      message:  `Dessin trop simple (complexité ${(metrics.score * 100).toFixed(1)}% < ${(thresholds.complexity * 100).toFixed(1)}% attendu pour ${screen}). Enrichissez votre dessin.`,
      score: metrics.score,
      threshold: thresholds.complexity,
    }, { status: 400 });
  }

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
    hashDrawing(screen, black, red, buffer),
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
  const poolSize = await getGlobalActiveCount();
  const CANDIDATE_TTL_SEC = parseInt(process.env.CANDIDATE_TTL_SEC ?? "600");

  // Warning informatif (non-bloquant) si le dessin reste proche du seuil
  const warning = metrics.score < thresholds.complexity * 1.5
    ? `Dessin simple (complexité ${(metrics.score * 100).toFixed(1)}%). Validateurs décident.`
    : null;

  console.log(`[submit-candidate] device=${deviceId} screen=${screen} score=${metrics.score.toFixed(3)} drawScore=${drawScore} thresholds=${thresholds.mode}${warning ? " warning=near_floor" : ""}`);

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
      : { screen: screen as any, buffer: buffer! },
    imageHash,
    actionsHash,
    drawScore,
    actionSequence: actions,
    replayEvents:   replayEvents.length > 0 ? replayEvents : undefined,
    podHashEnriched: podEnrichedHash,
    podGeometry:     podGeometry ?? undefined,
    score: metrics.score,
    submittedAt: Date.now(),
    expiresAt: Date.now() + CANDIDATE_TTL_SEC * 1000,
    poolSize,
    warning,
  };

  await setCandidate(candidate);

  console.log(`[submit-candidate] candidat créé id=${candidate.candidateId} poolSize=${poolSize} score=${metrics.score.toFixed(3)} drawScore=${drawScore} actionsHash=${actionsHash.slice(0, 12)}...`);

  return NextResponse.json({
    ok: true,
    candidateId: candidate.candidateId,
    score: metrics.score,
    warning,
    metrics: {
      entropy:     metrics.entropy,
      transitions: metrics.transitions,
      rle:         metrics.rle,
    },
    podGeometry: podGeometry ?? null,
    poolSize,
    expiresIn: CANDIDATE_TTL_SEC,
  });
}
