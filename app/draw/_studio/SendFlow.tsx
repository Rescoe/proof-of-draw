"use client";
// app/draw/_studio/SendFlow.tsx
// Flux d'envoi en 3 étapes : Titre → Aperçu tel qu'affiché sur l'écran → Confirmer,
// puis écran de résultat. L'aperçu est produit en ENCODANT le dessin exactement
// comme à l'envoi, puis en le DÉCODANT : ce qu'on voit est le fichier envoyé.
//
// Machine à états : title → preview → confirm → sending → result
// Le verrou d'envoi est un ref (jamais deux envois, même en double-tap).

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft, Check, CircleAlert, Clock, ExternalLink, LoaderCircle, RefreshCw, Send, Star, TriangleAlert, X,
} from "lucide-react";
import Link from "next/link";
import { SCREEN_PROFILES, ScreenId } from "@/lib/screenProfiles";
import { rgbaToScreenPayload, ScreenPayload } from "@/lib/canvasToScreen";
import { screenPayloadToCanvas } from "@/lib/screenToCanvas";
import { ACHIEVEMENTS, DrawSession, PodHints, craftProfile, modeForProfile } from "@/lib/drawEngine";
import { Modal, formatTime } from "./ui";
import type { StudioSendInput, StudioSendResult } from "./types";

const DRAW_WINDOW_SEC = 900;
const HEAVY_BYTES = 900_000;
const MAX_BYTES = 3_800_000;

type Step = "title" | "preview" | "confirm" | "sending" | "result";

export interface SendFlowProps {
  session: DrawSession;
  screenId: ScreenId;
  deviceLabel: string;
  isGuest: boolean;
  title: string; onTitle: (v: string) => void;
  guestName: string; onGuestName: (v: string) => void;
  cooldown: number;
  hints: PodHints;
  onSend: (input: StudioSendInput) => Promise<StudioSendResult>;
  onSent: (r: Extract<StudioSendResult, { status: "ok" }>) => void;
  onCooldown: (seconds: number) => void;
  onClose: () => void;
}

/** Aperçu tel qu'affiché : décode le buffer réellement envoyé et l'habille comme l'écran physique. */
function ScreenPreview({ payload, screenId }: { payload: ScreenPayload; screenId: ScreenId }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const profile = SCREEN_PROFILES[screenId];
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const img = screenPayloadToCanvas(payload);
    const d = img.data;
    const kind = profile.svgBg === "#000000" ? "oled" : profile.pixelFormat === "rgb565" ? "tft" : "eink";
    for (let i = 0; i < d.length; i += 4) {
      if (kind === "oled") {
        const lit = d[i] > 127;
        d[i] = lit ? 0 : 6; d[i + 1] = lit ? 255 : 10; d[i + 2] = lit ? 150 : 8;
      } else if (kind === "eink") {
        const white = d[i] > 200 && d[i + 1] > 200;
        const red = d[i] > 200 && d[i + 1] < 60;
        if (red) { d[i] = 196; d[i + 1] = 26; d[i + 2] = 26; }
        else if (white) { d[i] = 238; d[i + 1] = 236; d[i + 2] = 226; }
        else { d[i] = 22; d[i + 1] = 22; d[i + 2] = 26; }
      }
    }
    c.width = img.width; c.height = img.height;
    c.getContext("2d")!.putImageData(new ImageData(d, img.width, img.height), 0, 0);
  }, [payload, profile]);
  const kind = profile.svgBg === "#000000" ? "oled" : profile.pixelFormat === "rgb565" ? "tft" : "eink";
  const scale = Math.max(1, Math.min(3, Math.floor(320 / profile.width)));
  return (
    <div className="st-preview">
      <canvas
        ref={ref} className={"st-preview__screen st-preview__screen--" + kind}
        style={{ width: profile.width * scale, maxWidth: "100%", height: "auto", aspectRatio: `${profile.width} / ${profile.height}` }}
        aria-label={`Aperçu du dessin tel qu'il sera affiché sur ${profile.name}`}
      />
    </div>
  );
}

export function SendFlow(props: SendFlowProps) {
  const { session, screenId } = props;
  const profile = SCREEN_PROFILES[screenId];
  const [step, setStep] = useState<Step>(props.cooldown > 0 ? "result" : "title");
  const [result, setResult] = useState<StudioSendResult | null>(props.cooldown > 0 ? { status: "cooldown", nextDrawIn: props.cooldown } : null);
  const [titleErr, setTitleErr] = useState(false);
  const lock = useRef(false);
  const titleRef = useRef<HTMLInputElement>(null);

  const payload = useMemo<ScreenPayload | null>(() => {
    try { return rgbaToScreenPayload(session.bitmap.toRGBA(), screenId); } catch { return null; }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, screenId, session.revision]);

  const actions = useMemo(() => session.getActions(), [session, session.revision]);
  const replay = useMemo(() => session.getReplay(), [session, session.revision]);
  const craft = useMemo(() => craftProfile(actions), [actions]);
  const bytes = useMemo(() => {
    try { return new Blob([JSON.stringify({ actions, replay, payload })]).size; } catch { return 0; }
  }, [actions, replay, payload]);

  useEffect(() => {
    if (step === "title") { const id = window.setTimeout(() => titleRef.current?.focus(), 60); return () => window.clearTimeout(id); }
  }, [step]);

  // Le compte à rebours suit la prop `cooldown` (source unique : le parent)
  const cooldown = props.cooldown;

  const goPreview = () => {
    if (!props.title.trim()) { setTitleErr(true); titleRef.current?.focus(); return; }
    setStep("preview");
  };

  const doSend = async () => {
    if (lock.current || !payload) return;
    lock.current = true;
    setStep("sending");
    const input: StudioSendInput = {
      workTitle: props.title.trim(),
      drawArtistName: props.isGuest && props.guestName.trim() ? props.guestName.trim() : undefined,
      payload,
      actions,
      replayEvents: replay,
      drawScore: session.score,
    };
    let r: StudioSendResult;
    try { r = await props.onSend(input); }
    catch (e) { r = { status: "error", message: e instanceof Error ? e.message : "Erreur réseau" }; }
    lock.current = false;
    setResult(r);
    setStep("result");
    if (r.status === "ok") props.onSent(r);
    if (r.status === "cooldown") props.onCooldown(r.nextDrawIn);
  };

  const stepIndex = step === "title" ? 0 : step === "preview" ? 1 : 2;
  const canClose = step !== "sending";

  // ── Résultat ────────────────────────────────────────────────────────────────
  if (step === "result" && result) {
    const remaining = cooldown;
    const progress = Math.min(100, Math.max(0, ((DRAW_WINDOW_SEC - remaining) / DRAW_WINDOW_SEC) * 100));
    const Cool = (
      <>
        <div className="st-countdown">{formatTime(remaining)}</div>
        <div className="st-progress"><i style={{ width: `${progress}%` }} /></div>
      </>
    );
    return (
      <Modal label="Résultat de l'envoi" onClose={props.onClose}>
        <div className="st-result">
          {result.status === "ok" && (
            <>
              <div className="st-result__icon" style={{ background: "rgba(74,222,128,0.16)", color: "var(--st-ok)" }}><Check size={34} /></div>
              <h3>{result.validation === "queued" ? "Dessin en file d'attente" : result.validation === "bypassed" ? "Dessin diffusé" : "Dessin envoyé au réseau !"}</h3>
              <p>
                {result.validation === "queued" && `Il passera bientôt en validation (position ${result.queuePosition ?? "?"}).`}
                {result.validation === "pending" && `Les écrans du réseau (${result.poolSize ?? "?"}) vont voter. S'il est validé, il sera affiché.`}
                {result.validation === "bypassed" && "Il est envoyé directement aux écrans."}
                {result.validation === "fallback_direct" && "Diffusé directement : la validation du réseau était indisponible."}
                {!["queued", "pending", "bypassed", "fallback_direct"].includes(result.validation ?? "") && "Il est en route vers l'écran."}
              </p>
              {result.warning && <div className="st-callout st-callout--warn" style={{ textAlign: "left" }}><TriangleAlert size={18} style={{ flex: "none", marginTop: 2 }} /><span>{result.warning}</span></div>}
              <div className="st-note" style={{ marginBottom: 4 }}>Prochain dessin possible dans</div>
              {Cool}
              <div className="st-dialog__actions" style={{ justifyContent: "center" }}>
                <Link href="/gallery" className="st-btn st-btn--solid"><ExternalLink size={16} /> Voir la galerie</Link>
                <button type="button" className="st-btn st-btn--accent" onClick={props.onClose}>Continuer à dessiner</button>
              </div>
            </>
          )}
          {result.status === "cooldown" && (
            <>
              <div className="st-result__icon" style={{ background: "rgba(251,191,36,0.14)", color: "var(--st-warn)" }}><Clock size={32} /></div>
              <h3>Un dessin toutes les 15 minutes</h3>
              <p>Cet appareil vient de recevoir un dessin. Ton travail est <b>sauvegardé</b> : tu peux continuer à dessiner, puis l&apos;envoyer à la fin du compte à rebours.</p>
              {Cool}
              <div className="st-dialog__actions" style={{ justifyContent: "center" }}>
                <button type="button" className="st-btn st-btn--accent" onClick={props.onClose}>Continuer à dessiner</button>
              </div>
            </>
          )}
          {result.status === "rejected" && (
            <>
              <div className="st-result__icon" style={{ background: "rgba(248,113,113,0.14)", color: "var(--st-err)" }}><CircleAlert size={32} /></div>
              <h3>Le dessin n&apos;a pas été accepté</h3>
              <p>{result.message}</p>
              <div className="st-note" style={{ marginBottom: 12 }}>Ton dessin est intact : retouche-le et réessaie. Aucun délai n&apos;est appliqué.</div>
              <div className="st-dialog__actions" style={{ justifyContent: "center" }}>
                <button type="button" className="st-btn st-btn--accent" onClick={props.onClose}>Modifier mon dessin</button>
              </div>
            </>
          )}
          {result.status === "queue_full" && (
            <>
              <div className="st-result__icon" style={{ background: "rgba(251,191,36,0.14)", color: "var(--st-warn)" }}><Clock size={32} /></div>
              <h3>Le réseau est très sollicité</h3>
              <p>{result.message}</p>
              <div className="st-dialog__actions" style={{ justifyContent: "center" }}>
                <button type="button" className="st-btn st-btn--solid" onClick={props.onClose}>Fermer</button>
                <button type="button" className="st-btn st-btn--accent" onClick={() => { setResult(null); setStep("confirm"); }}><RefreshCw size={16} /> Réessayer</button>
              </div>
            </>
          )}
          {result.status === "error" && (
            <>
              <div className="st-result__icon" style={{ background: "rgba(248,113,113,0.14)", color: "var(--st-err)" }}><CircleAlert size={32} /></div>
              <h3>L&apos;envoi a échoué</h3>
              <p>{result.message}</p>
              <div className="st-note" style={{ marginBottom: 12 }}>Ton dessin est conservé : rien n&apos;est perdu.</div>
              <div className="st-dialog__actions" style={{ justifyContent: "center" }}>
                <button type="button" className="st-btn st-btn--solid" onClick={props.onClose}>Fermer</button>
                <button type="button" className="st-btn st-btn--accent" onClick={() => { setResult(null); setStep("confirm"); }}><RefreshCw size={16} /> Réessayer</button>
              </div>
            </>
          )}
        </div>
      </Modal>
    );
  }

  return (
    <Modal label="Envoyer le dessin" onClose={canClose ? props.onClose : undefined}>
      <div className="st-row st-row--between" style={{ marginBottom: 2 }}>
        <h3 style={{ margin: 0 }}>Envoyer sur {profile.name}</h3>
        {canClose && <button type="button" className="st-btn st-btn--icon" onClick={props.onClose} aria-label="Fermer"><X size={20} /></button>}
      </div>
      <div className="st-steps" aria-label={`Étape ${stepIndex + 1} sur 3`}>
        {[0, 1, 2].map(i => <i key={i} className={i <= stepIndex ? "done" : ""} />)}
      </div>

      {step === "title" && (
        <>
          <div className="st-field">
            <label htmlFor="st-title-in">1 · Titre de l&apos;œuvre</label>
            <input
              id="st-title-in" ref={titleRef} className={"st-input" + (titleErr && !props.title.trim() ? " st-input--err" : "")}
              value={props.title} maxLength={80} placeholder="Donne un nom à ton dessin" enterKeyHint="next"
              onChange={e => { props.onTitle(e.target.value); setTitleErr(false); }}
              onKeyDown={e => { if (e.key === "Enter") goPreview(); }}
            />
            <div className="st-count">{props.title.length}/80</div>
          </div>
          {props.isGuest && (
            <div className="st-field">
              <label htmlFor="st-guest-in">Ton nom d&apos;artiste</label>
              <input id="st-guest-in" className="st-input" value={props.guestName} maxLength={40} placeholder="Anonyme si vide" onChange={e => props.onGuestName(e.target.value)} />
              <div className="st-note">Cet écran est partagé : ton nom signera le dessin.</div>
            </div>
          )}
          {titleErr && !props.title.trim() && <div className="st-callout st-callout--err"><CircleAlert size={18} style={{ flex: "none", marginTop: 2 }} /><span>Le titre est obligatoire avant l&apos;envoi.</span></div>}
          <div className="st-dialog__actions">
            <button type="button" className="st-btn st-btn--accent st-btn--big st-btn--block" onClick={goPreview}>Continuer</button>
          </div>
        </>
      )}

      {step === "preview" && payload && (
        <>
          <div className="st-h" style={{ marginTop: 0 }}>2 · Aperçu sur l&apos;écran</div>
          <ScreenPreview payload={payload} screenId={screenId} />
          <p className="st-note" style={{ marginBottom: 12 }}>
            Voici le fichier tel qu&apos;il sera envoyé, décodé comme le fera {profile.name}. {modeForProfile(profile) === "bw" ? "Les nuances sont des motifs de points : pas de gris sur cet écran." : modeForProfile(profile) === "bwr" ? "Trois couleurs seulement : noir, blanc et rouge." : "Les couleurs sont réduites en 16 bits."}
          </p>
          <div className="st-summary">
            <div><span>Points de dessin</span><b><Star size={12} fill="currentColor" style={{ verticalAlign: -1 }} /> {session.score}</b></div>
            <div><span>Techniques utilisées</span><b>{craft.achievements.length}/{ACHIEVEMENTS.length}</b></div>
            <div><span>Temps de dessin</span><b>{formatTime(Math.floor(props.hints.sessionMs / 1000))}</b></div>
          </div>
          {(!props.hints.okSession || !props.hints.okStrokes || !props.hints.okCoverage) && (
            <div className="st-callout st-callout--warn"><TriangleAlert size={18} style={{ flex: "none", marginTop: 2 }} />
              <span>
                {[!props.hints.okSession && "session très courte", !props.hints.okStrokes && "peu de traits", !props.hints.okCoverage && "dessin peu étendu"].filter(Boolean).join(", ")} :
                le réseau sera peut-être plus exigeant. Tu peux quand même envoyer.
              </span>
            </div>
          )}
          <div className="st-dialog__actions">
            <button type="button" className="st-btn st-btn--solid" onClick={() => setStep("title")}><ArrowLeft size={16} /> Titre</button>
            <button type="button" className="st-btn st-btn--accent" onClick={() => setStep("confirm")}>Continuer</button>
          </div>
        </>
      )}

      {step === "confirm" && (
        <>
          <div className="st-h" style={{ marginTop: 0 }}>3 · Confirmer l&apos;envoi</div>
          <div className="st-summary">
            <div><span>Œuvre</span><b style={{ textAlign: "right" }}>{props.title.trim()}</b></div>
            <div><span>Destination</span><b style={{ textAlign: "right" }}>{props.deviceLabel} · {profile.name}</b></div>
            {props.isGuest && <div><span>Signé</span><b>{props.guestName.trim() || "Anonyme"}</b></div>}
            <div><span>Points</span><b>{session.score}</b></div>
          </div>
          {bytes > MAX_BYTES && (
            <div className="st-callout st-callout--err"><CircleAlert size={18} style={{ flex: "none", marginTop: 2 }} /><span>Ce dessin est trop volumineux pour être envoyé ({(bytes / 1e6).toFixed(1)} Mo). Simplifie-le : efface une partie des traits puis réessaie.</span></div>
          )}
          {bytes > HEAVY_BYTES && bytes <= MAX_BYTES && (
            <div className="st-callout st-callout--warn"><TriangleAlert size={18} style={{ flex: "none", marginTop: 2 }} /><span>Dessin très détaillé ({(bytes / 1e6).toFixed(1)} Mo) : l&apos;envoi peut prendre un moment.</span></div>
          )}
          <div className="st-callout st-callout--info">
            <Clock size={18} style={{ flex: "none", marginTop: 2 }} />
            <span>Après l&apos;envoi, cet appareil devra attendre <b>15 minutes</b> avant le prochain dessin. Tu pourras continuer à dessiner pendant ce temps.</span>
          </div>
          <div className="st-dialog__actions">
            <button type="button" className="st-btn st-btn--solid" onClick={() => setStep("preview")}><ArrowLeft size={16} /> Aperçu</button>
            <button type="button" className="st-btn st-btn--accent st-btn--big" disabled={bytes > MAX_BYTES || !payload} onClick={doSend}><Send size={18} /> Envoyer au réseau</button>
          </div>
        </>
      )}

      {step === "sending" && (
        <div className="st-result" style={{ padding: "26px 0" }}>
          <div className="st-result__icon" style={{ background: "var(--st-accent-soft)", color: "var(--st-accent-hi)" }}>
            <LoaderCircle size={32} style={{ animation: "st-spin 0.9s linear infinite" }} />
          </div>
          <h3>Envoi en cours…</h3>
          <p>Ne ferme pas la page. Ton dessin reste sauvegardé sur cet appareil.</p>
        </div>
      )}
    </Modal>
  );
}
