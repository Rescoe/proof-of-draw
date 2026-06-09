"use client";

import { useEffect, useRef, useState } from "react";
import { OwnedDevice } from "@/lib/deviceStore";
import { SCREEN_PROFILES } from "@/lib/screenProfiles";
import { BlockFrameCanvas } from "@/app/BlockFrameCanvas";
import type { BlockImagePayload } from "@/lib/chain";

// ── Types ─────────────────────────────────────────────────────────────────────

interface ArtistProfile {
  artistId:              string;
  slug?:                 string;
  displayName:           string;
  bio?:                  string;
  profileImageBlockHash?: string;
  profileImageCrop?:     { cx: number; cy: number; zoom: number };
  createdAt:             number;
  updatedAt:             number;
}

// Display sizes matching BlockFrameCanvas.tsx
const DISPLAY_SIZES: Record<string, { w: number; h: number }> = {
  eink29bwr: { w: 222, h: 96  },
  eink27bw:  { w: 132, h: 88  },
  oled096:   { w: 128, h: 64  },
  tft18:     { w: 128, h: 160 },
};

const AVATAR_SIZE = 72;

function coverTransform(
  screen: string,
  crop?: { cx: number; cy: number; zoom: number },
): { tx: number; ty: number; scale: number } {
  const ds = DISPLAY_SIZES[screen] ?? { w: 128, h: 128 };
  const coverScale = Math.max(AVATAR_SIZE / ds.w, AVATAR_SIZE / ds.h) * 1.01;
  const zoom  = crop?.zoom ?? 1;
  const scale = coverScale * zoom;
  const cx    = crop?.cx ?? 0.5;
  const cy    = crop?.cy ?? 0.5;
  return {
    tx: AVATAR_SIZE / 2 - cx * ds.w * scale,
    ty: AVATAR_SIZE / 2 - cy * ds.h * scale,
    scale,
  };
}

function clampCrop(
  cx: number, cy: number, zoom: number,
  ds: { w: number; h: number },
): { cx: number; cy: number; zoom: number } {
  const scale  = Math.max(AVATAR_SIZE / ds.w, AVATAR_SIZE / ds.h) * zoom;
  const halfCx = (AVATAR_SIZE / 2) / (ds.w * scale);
  const halfCy = (AVATAR_SIZE / 2) / (ds.h * scale);
  return {
    cx:   Math.max(halfCx, Math.min(1 - halfCx, cx)),
    cy:   Math.max(halfCy, Math.min(1 - halfCy, cy)),
    zoom: Math.max(1, zoom),
  };
}

interface MinedBlock {
  blockHash:    string;
  blockIndex:   number;
  workTitle?:   string;
  minedAt:      number;
  poolScreen:   string;
  imagePayload: BlockImagePayload | null; // peut être null si image non trouvée
}

interface PublicDevice {
  deviceId:   string;
  artistName: string;
  screens:    string[];
  isOnline:   boolean;
}

function isKnownScreen(sid: string): sid is keyof typeof SCREEN_PROFILES {
  return sid in SCREEN_PROFILES;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function timeSince(ts?: number): string {
  if (!ts) return "jamais";
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60)   return `il y a ${s}s`;
  if (s < 3600) return `il y a ${Math.floor(s / 60)}min`;
  return `il y a ${Math.floor(s / 3600)}h`;
}

function statusColor(isOnline: boolean, lastPing?: number): string {
  if (isOnline) return "#4ade80";
  if (!lastPing) return "var(--text3)";
  return Math.floor((Date.now() - lastPing) / 1000) < 3600 ? "#fb923c" : "var(--text3)";
}

// ── Composant édition de slug ─────────────────────────────────────────────────

function SlugEditor({
  artistId,
  currentSlug,
  onSave,
}: {
  artistId: string;
  currentSlug?: string;
  onSave: (slug: string) => Promise<void>;
}) {
  const [editing,  setEditing]  = useState(false);
  const [draft,    setDraft]    = useState(currentSlug ?? "");
  const [status,   setStatus]   = useState<"idle" | "checking" | "ok" | "taken" | "short">("idle");
  const [saving,   setSaving]   = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Resync si le slug change depuis l'extérieur (après save)
  useEffect(() => { if (!editing) setDraft(currentSlug ?? ""); }, [currentSlug, editing]);

  function handleChange(v: string) {
    setDraft(v);
    setStatus("checking");
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(async () => {
      const n = v.trim().toLowerCase()
        .normalize("NFD").replace(/[̀-ͯ]/g, "")
        .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 30);
      if (n.length < 3) { setStatus("short"); return; }
      const res = await fetch(
        `/api/artist/check-slug?slug=${encodeURIComponent(n)}&artistId=${artistId}`,
      ).then(r => r.json()).catch(() => null);
      setStatus(!res ? "idle" : res.available ? "ok" : "taken");
    }, 400);
  }

  async function save() {
    if (status !== "ok" && draft.trim() !== currentSlug) return;
    setSaving(true);
    try { await onSave(draft.trim()); setEditing(false); }
    finally { setSaving(false); }
  }

  const statusColor = status === "ok" ? "#4ade80" : status === "taken" ? "#f87171" : "var(--text3)";
  const statusLabel = {
    idle: "", checking: "vérification…",
    ok: "✓ disponible", taken: "✗ déjà utilisé", short: "trop court (3 car. min)",
  }[status];

  if (!editing) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.78rem", color: "var(--text3)" }}>
        <span style={{ fontFamily: "JetBrains Mono, monospace" }}>
          /artists/<strong style={{ color: currentSlug ? "var(--accent)" : "var(--text3)" }}>
            {currentSlug ?? "—"}
          </strong>
        </span>
        <button
          onClick={() => { setDraft(currentSlug ?? ""); setStatus("idle"); setEditing(true); }}
          style={{
            background: "none", border: "1px solid var(--border)", borderRadius: 4,
            padding: "0.15rem 0.5rem", fontSize: "0.68rem", cursor: "pointer",
            color: "var(--text3)",
          }}
        >
          ✏️ modifier
        </button>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
        <span style={{ fontSize: "0.78rem", color: "var(--text3)", whiteSpace: "nowrap", fontFamily: "JetBrains Mono, monospace" }}>
          /artists/
        </span>
        <input
          value={draft}
          onChange={e => handleChange(e.target.value)}
          maxLength={30}
          placeholder="mon-nom-artiste"
          style={{
            border: "1px solid var(--accent)", borderRadius: 6,
            padding: "0.25rem 0.5rem", background: "var(--bg)",
            color: "var(--text)", fontSize: "0.82rem",
            fontFamily: "JetBrains Mono, monospace",
            outline: "none", width: 180,
          }}
        />
        <button
          onClick={save}
          disabled={saving || (status !== "ok" && draft.trim() !== currentSlug)}
          style={{
            padding: "0.25rem 0.7rem", borderRadius: 5, border: "none",
            background: "var(--accent)", color: "#fff", fontSize: "0.75rem",
            cursor: "pointer", opacity: (saving || (status !== "ok" && draft.trim() !== currentSlug)) ? 0.4 : 1,
          }}
        >
          {saving ? "…" : "✓"}
        </button>
        <button
          onClick={() => setEditing(false)}
          style={{
            background: "none", border: "1px solid var(--border)", borderRadius: 5,
            padding: "0.25rem 0.5rem", fontSize: "0.75rem", cursor: "pointer", color: "var(--text3)",
          }}
        >
          ✕
        </button>
      </div>
      {statusLabel && (
        <span style={{ fontSize: "0.7rem", color: statusColor, marginLeft: 68 }}>
          {statusLabel}
        </span>
      )}
    </div>
  );
}

// ── Composant liaison multi-appareils ─────────────────────────────────────────

function LiaisonSection({ artistId }: { artistId: string }) {
  const [genCode,    setGenCode]    = useState<string | null>(null);
  const [expiresAt,  setExpiresAt]  = useState<number>(0);
  const [countdown,  setCountdown]  = useState(0);
  const [generating, setGenerating] = useState(false);
  const [joinCode,   setJoinCode]   = useState("");
  const [joining,    setJoining]    = useState(false);
  const [joinMsg,    setJoinMsg]    = useState<{ ok: boolean; text: string } | null>(null);
  const [copied,     setCopied]     = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, []);

  async function generateCode() {
    setGenerating(true);
    try {
      const res  = await fetch("/api/artist/link-code", { method: "POST" });
      const data = await res.json();
      if (!res.ok) { alert(data.error ?? "Erreur"); return; }
      setGenCode(data.code);
      setExpiresAt(data.expiresAt);
      setCountdown(data.expiresIn);
      if (intervalRef.current) clearInterval(intervalRef.current);
      intervalRef.current = setInterval(() => {
        setCountdown(prev => {
          if (prev <= 1) { clearInterval(intervalRef.current!); setGenCode(null); return 0; }
          return prev - 1;
        });
      }, 1000);
    } catch { alert("Erreur réseau"); }
    finally { setGenerating(false); }
  }

  async function copyCode() {
    if (!genCode) return;
    await navigator.clipboard.writeText(genCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function joinByCode() {
    const code = joinCode.trim().toUpperCase();
    if (!code) return;
    setJoining(true);
    setJoinMsg(null);
    try {
      const res  = await fetch("/api/artist/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const data = await res.json();
      if (!res.ok) { setJoinMsg({ ok: false, text: data.error ?? "Erreur" }); return; }
      setJoinMsg({ ok: true, text: `Connecté au profil "${data.profile.displayName}" !` });
      setJoinCode("");
      // Recharger la page pour refléter le nouveau profil
      setTimeout(() => window.location.reload(), 1200);
    } catch { setJoinMsg({ ok: false, text: "Erreur réseau" }); }
    finally { setJoining(false); }
  }

  void artistId; // utilisé pour la requête generate (via session côté serveur)

  return (
    <div style={{ marginTop: "2rem" }}>
      <div style={{
        padding: "1.5rem",
        borderRadius: 12,
        border: "1px solid var(--border)",
        background: "var(--bg2)",
      }}>
        <h2 style={{ fontSize: "0.9rem", fontWeight: 800, letterSpacing: "-0.01em", margin: "0 0 0.35rem" }}>
          🔗 Connexion multi-appareils
        </h2>
        <p style={{ fontSize: "0.78rem", color: "var(--text3)", margin: "0 0 1.25rem", lineHeight: 1.5 }}>
          Partagez votre session entre plusieurs navigateurs ou appareils.
          Générez un code sur cet appareil, puis entrez-le sur l&apos;autre.
        </p>

        <div style={{ display: "flex", gap: "1.5rem", flexWrap: "wrap" }}>

          {/* Génération */}
          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={{ fontSize: "0.72rem", color: "var(--text3)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "0.6rem" }}>
              Générer un code
            </div>
            {genCode ? (
              <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                  <span style={{
                    fontFamily: "JetBrains Mono, monospace",
                    fontSize: "1.3rem", fontWeight: 800, letterSpacing: "0.12em",
                    color: countdown > 60 ? "#4ade80" : countdown > 20 ? "#fb923c" : "#f87171",
                  }}>
                    {genCode}
                  </span>
                  <button onClick={copyCode} style={{
                    fontSize: "0.72rem", padding: "0.3rem 0.7rem",
                    borderRadius: 4, border: "1px solid var(--border)",
                    background: "var(--bg)", cursor: "pointer", color: "var(--text2)",
                  }}>
                    {copied ? "✓ Copié" : "Copier"}
                  </button>
                </div>
                <div style={{ fontSize: "0.7rem", color: "var(--text3)" }}>
                  Expire dans {countdown}s · valable 1 fois
                </div>
              </div>
            ) : (
              <button
                onClick={generateCode}
                disabled={generating}
                style={{
                  padding: "0.5rem 1.1rem", borderRadius: 7,
                  border: "1px solid var(--border)", background: "var(--bg)",
                  color: "var(--text2)", fontSize: "0.82rem", cursor: "pointer",
                  opacity: generating ? 0.5 : 1,
                }}
              >
                {generating ? "Génération…" : "Générer un code"}
              </button>
            )}
          </div>

          {/* Rejoindre */}
          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={{ fontSize: "0.72rem", color: "var(--text3)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "0.6rem" }}>
              Rejoindre avec un code
            </div>
            <div style={{ display: "flex", gap: "0.5rem" }}>
              <input
                value={joinCode}
                onChange={e => setJoinCode(e.target.value.toUpperCase())}
                placeholder="XXXX-XXXX"
                maxLength={9}
                onKeyDown={e => { if (e.key === "Enter") joinByCode(); }}
                style={{
                  fontFamily: "JetBrains Mono, monospace",
                  fontSize: "0.9rem", letterSpacing: "0.08em",
                  padding: "0.4rem 0.7rem", borderRadius: 6,
                  border: "1px solid var(--border)", background: "var(--bg)",
                  color: "var(--text)", width: 130, outline: "none",
                }}
              />
              <button
                onClick={joinByCode}
                disabled={joining || !joinCode.trim()}
                style={{
                  padding: "0.4rem 0.9rem", borderRadius: 6,
                  border: "none", background: "var(--accent)",
                  color: "#fff", fontSize: "0.82rem", cursor: "pointer",
                  opacity: (joining || !joinCode.trim()) ? 0.5 : 1,
                }}
              >
                {joining ? "…" : "Rejoindre"}
              </button>
            </div>
            {joinMsg && (
              <div style={{
                marginTop: "0.5rem", fontSize: "0.75rem",
                color: joinMsg.ok ? "#4ade80" : "#f87171",
              }}>
                {joinMsg.text}
              </div>
            )}
          </div>

        </div>
      </div>
    </div>
  );
}

// ── Composant édition inline ──────────────────────────────────────────────────

function InlineEdit({
  value, placeholder, onSave, multiline = false, maxLength = 60, style,
}: {
  value: string; placeholder: string; onSave: (v: string) => Promise<void>;
  multiline?: boolean; maxLength?: number; style?: React.CSSProperties;
}) {
  const [editing, setEditing] = useState(false);
  const [draft,   setDraft]   = useState(value);
  const [saving,  setSaving]  = useState(false);
  const ref = useRef<HTMLInputElement & HTMLTextAreaElement>(null);

  useEffect(() => { if (editing && ref.current) ref.current.focus(); }, [editing]);

  async function save() {
    if (draft.trim() === value) { setEditing(false); return; }
    setSaving(true);
    try { await onSave(draft.trim()); setEditing(false); }
    finally { setSaving(false); }
  }

  if (!editing) {
    return (
      <span
        onClick={() => { setDraft(value); setEditing(true); }}
        title="Cliquer pour modifier"
        style={{ cursor: "text", borderBottom: "1px dashed var(--border)", paddingBottom: 1, ...style }}
      >
        {value || <span style={{ color: "var(--text3)" }}>{placeholder}</span>}
      </span>
    );
  }

  const commonProps = {
    value: draft, maxLength, disabled: saving,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setDraft(e.target.value),
    onKeyDown: (e: React.KeyboardEvent) => {
      if (!multiline && e.key === "Enter") { e.preventDefault(); save(); }
      if (e.key === "Escape") { setDraft(value); setEditing(false); }
    },
    style: {
      border: "1px solid var(--accent)", borderRadius: 6,
      padding: "0.25rem 0.5rem", background: "var(--bg)",
      color: "var(--text)", fontSize: "inherit", fontFamily: "inherit",
      fontWeight: "inherit", width: "100%", outline: "none",
      resize: multiline ? ("vertical" as const) : ("none" as const), ...style,
    },
  };

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: "0.5rem", width: "100%" }}>
      {multiline
        ? <textarea ref={ref as React.RefObject<HTMLTextAreaElement>} rows={3} {...commonProps} />
        : <input    ref={ref as React.RefObject<HTMLInputElement>}             {...commonProps} />}
      <button
        onClick={save} disabled={saving}
        style={{
          padding: "0.2rem 0.6rem", borderRadius: 5, border: "none",
          background: "var(--accent)", color: "#fff", fontSize: "0.75rem",
          cursor: "pointer", flexShrink: 0, opacity: saving ? 0.6 : 1,
        }}
      >
        {saving ? "…" : "✓"}
      </button>
    </span>
  );
}

// ── CropEditor ────────────────────────────────────────────────────────────────

function CropEditor({
  block,
  initialCrop,
  onConfirm,
  onBack,
}: {
  block: MinedBlock;
  initialCrop?: { cx: number; cy: number; zoom: number };
  onConfirm: (crop: { cx: number; cy: number; zoom: number }) => void;
  onBack: () => void;
}) {
  const screen = block.imagePayload?.screen ?? "eink29bwr";
  const ds = DISPLAY_SIZES[screen] ?? { w: 128, h: 128 };

  const [cx,   setCx]   = useState(initialCrop?.cx   ?? 0.5);
  const [cy,   setCy]   = useState(initialCrop?.cy   ?? 0.5);
  const [zoom, setZoom] = useState(initialCrop?.zoom ?? 1);

  // Refs pour les handlers d'événement — évite les closures stales sur cx/cy/zoom
  // (sans ref, onMouseMove lirait la valeur initiale figée au moment du rendu
  // qui a attaché l'event listener, et le drag partirait dans le mauvais sens).
  const cxRef   = useRef(cx);
  const cyRef   = useRef(cy);
  const zoomRef = useRef(zoom);
  useEffect(() => { cxRef.current = cx; },   [cx]);
  useEffect(() => { cyRef.current = cy; },   [cy]);
  useEffect(() => { zoomRef.current = zoom; }, [zoom]);

  const dragging = useRef(false);
  const lastPos  = useRef({ x: 0, y: 0 });

  // Cercle de prévisualisation plus grand (240px) pour plus de précision
  const PREVIEW = 240;

  // Toutes les transformations sont calculées côté rendu (pas dans les handlers)
  // pour rester synchrones avec l'état React.
  const previewScale = Math.max(PREVIEW / ds.w, PREVIEW / ds.h) * zoom;
  const ptx = PREVIEW / 2 - cx * ds.w * previewScale;
  const pty = PREVIEW / 2 - cy * ds.h * previewScale;

  const avatarScale = Math.max(AVATAR_SIZE / ds.w, AVATAR_SIZE / ds.h) * zoom;
  const tx = AVATAR_SIZE / 2 - cx * ds.w * avatarScale;
  const ty = AVATAR_SIZE / 2 - cy * ds.h * avatarScale;

  function onMouseDown(e: React.MouseEvent | React.TouchEvent) {
    dragging.current = true;
    const pt = "touches" in e ? e.touches[0] : e;
    lastPos.current = { x: pt.clientX, y: pt.clientY };
  }

  function onMouseMove(e: React.MouseEvent | React.TouchEvent) {
    if (!dragging.current) return;
    const pt = "touches" in e ? e.touches[0] : e;
    const dx = pt.clientX - lastPos.current.x;
    const dy = pt.clientY - lastPos.current.y;
    lastPos.current = { x: pt.clientX, y: pt.clientY };
    // On lit les refs (valeurs courantes) plutôt que les fermetures stales,
    // et on met à jour cx/cy en un seul set fonctionnel indépendant.
    const ps = Math.max(PREVIEW / ds.w, PREVIEW / ds.h) * zoomRef.current;
    const newCx = clampCrop(cxRef.current - dx / (ds.w * ps), cyRef.current, zoomRef.current, ds).cx;
    const newCy = clampCrop(newCx, cyRef.current - dy / (ds.h * ps), zoomRef.current, ds).cy;
    setCx(newCx);
    setCy(newCy);
  }

  function onMouseUp() { dragging.current = false; }

  function onWheel(e: React.WheelEvent) {
    e.preventDefault();
    const z = Math.max(1, Math.min(4, zoomRef.current - e.deltaY * 0.002));
    const clamped = clampCrop(cxRef.current, cyRef.current, z, ds);
    setZoom(clamped.zoom);
    setCx(clamped.cx);
    setCy(clamped.cy);
  }

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "1.25rem" }}>
        <button onClick={onBack} style={{
          background: "none", border: "1px solid var(--border)", borderRadius: 6,
          padding: "0.35rem 0.75rem", color: "var(--text3)", cursor: "pointer", fontSize: "0.8rem",
        }}>← Retour</button>
        <div style={{ fontSize: "0.9rem", fontWeight: 700, color: "var(--text1)" }}>
          Recadrer la photo
        </div>
      </div>

      {/* Cercle de recadrage — unconstrained:true est OBLIGATOIRE ici : sans cette
          prop, maxWidth:"100%" dans BlockFrameCanvas se résout par rapport au
          conteneur parent (240px du cercle) au lieu de DISPLAY_SIZES (ex 222px),
          et le canvas se rend à 240px → tout le calcul de translate/scale est faux. */}
      <div style={{ display: "flex", justifyContent: "center", marginBottom: "1rem" }}>
        <div
          style={{
            width: PREVIEW, height: PREVIEW, borderRadius: "50%",
            overflow: "hidden", cursor: "grab", position: "relative",
            border: "3px solid var(--accent)",
            boxShadow: "0 0 0 6px rgba(124,107,255,0.12)",
            userSelect: "none", flexShrink: 0,
          }}
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
          onMouseLeave={onMouseUp}
          onTouchStart={onMouseDown}
          onTouchMove={e => { e.preventDefault(); onMouseMove(e); }}
          onTouchEnd={onMouseUp}
          onWheel={onWheel}
        >
          {block.imagePayload && (
            <div style={{
              position: "absolute",
              transformOrigin: "top left",
              transform: `translate(${ptx}px, ${pty}px) scale(${previewScale})`,
              pointerEvents: "none",
            }}>
              <BlockFrameCanvas payload={block.imagePayload} unconstrained />
            </div>
          )}
        </div>
      </div>

      {/* Result preview at actual avatar size */}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "0.5rem", marginBottom: "1.25rem" }}>
        <div style={{ fontSize: "0.72rem", color: "var(--text3)" }}>Aperçu réel</div>
        <div style={{
          width: AVATAR_SIZE, height: AVATAR_SIZE, borderRadius: "50%",
          overflow: "hidden", position: "relative",
          border: "2px solid var(--accent)",
        }}>
          {block.imagePayload && (
            <div style={{
              position: "absolute", transformOrigin: "top left",
              transform: `translate(${tx}px, ${ty}px) scale(${avatarScale})`,
              pointerEvents: "none",
            }}>
              <BlockFrameCanvas payload={block.imagePayload} unconstrained />
            </div>
          )}
        </div>
      </div>

      {/* Zoom slider */}
      <div style={{ marginBottom: "1.25rem" }}>
        <div style={{ fontSize: "0.72rem", color: "var(--text3)", marginBottom: "0.4rem" }}>
          Zoom · {zoom.toFixed(2)}×
        </div>
        <input
          type="range" min={1} max={4} step={0.01}
          value={zoom}
          onChange={e => {
            const z = parseFloat(e.target.value);
            const clamped = clampCrop(cx, cy, z, ds);
            setZoom(clamped.zoom);
            setCx(clamped.cx);
            setCy(clamped.cy);
          }}
          style={{ width: "100%", accentColor: "var(--accent)" }}
        />
        <div style={{ fontSize: "0.68rem", color: "var(--text3)", marginTop: "0.3rem" }}>
          Glissez l&apos;image pour repositionner · Molette ou slider pour zoomer
        </div>
      </div>

      <button
        onClick={() => onConfirm({ cx, cy, zoom })}
        style={{
          width: "100%", padding: "0.75rem",
          borderRadius: 8, border: "none",
          background: "var(--accent)", color: "#fff",
          fontWeight: 700, fontSize: "0.9rem", cursor: "pointer",
        }}
      >
        Confirmer ce recadrage
      </button>
    </div>
  );
}

// ── Composant picker de photo de profil ───────────────────────────────────────

function ProfileImagePicker({
  blocks,
  selectedHash,
  selectedCrop,
  onSelect,
  onClose,
}: {
  blocks: MinedBlock[];
  selectedHash?: string;
  selectedCrop?: { cx: number; cy: number; zoom: number };
  onSelect: (hash: string, crop: { cx: number; cy: number; zoom: number }) => Promise<void>;
  onClose: () => void;
}) {
  const [cropping, setCropping] = useState<MinedBlock | null>(null);
  const [saving,   setSaving]   = useState(false);

  async function confirmCrop(hash: string, crop: { cx: number; cy: number; zoom: number }) {
    setSaving(true);
    try { await onSelect(hash, crop); onClose(); }
    finally { setSaving(false); }
  }

  return (
    <div
      onClick={cropping ? undefined : onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 50,
        background: "rgba(0,0,0,0.6)", display: "flex",
        alignItems: "center", justifyContent: "center", padding: "1rem",
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: "var(--bg2)", borderRadius: 14,
          border: "1px solid var(--border)", padding: "1.5rem",
          maxWidth: 560, width: "100%", maxHeight: "90vh", overflowY: "auto",
        }}
      >
        {cropping ? (
          <CropEditor
            block={cropping}
            initialCrop={cropping.blockHash === selectedHash ? selectedCrop : undefined}
            onConfirm={(crop) => confirmCrop(cropping.blockHash, crop)}
            onBack={() => setCropping(null)}
          />
        ) : (
          <>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1rem" }}>
              <h3 style={{ fontWeight: 800, fontSize: "1.1rem", margin: 0 }}>
                Choisir une photo de profil
              </h3>
              <button onClick={onClose} style={{
                background: "none", border: "none", fontSize: "1.2rem",
                cursor: "pointer", color: "var(--text3)",
              }}>✕</button>
            </div>

            {blocks.length === 0 ? (
              <div style={{ textAlign: "center", padding: "2rem", color: "var(--text3)" }}>
                <div style={{ fontSize: "2rem", marginBottom: "0.5rem" }}>🎨</div>
                <p>Aucun bloc miné pour l&apos;instant. Dessinez et faites valider un bloc !</p>
              </div>
            ) : (
              <>
                <p style={{ fontSize: "0.8rem", color: "var(--text3)", marginBottom: "1rem" }}>
                  Choisissez un dessin validé comme photo de profil — vous pourrez le recadrer à l&apos;étape suivante.
                </p>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: "0.75rem" }}>
                  {blocks.map(b => (
                    <button
                      key={b.blockHash}
                      onClick={() => setCropping(b)}
                      disabled={saving}
                      style={{
                        border: `2px solid ${selectedHash === b.blockHash ? "var(--accent)" : "var(--border)"}`,
                        borderRadius: 10, background: "var(--bg)", padding: "0.5rem",
                        cursor: "pointer", position: "relative", opacity: saving ? 0.6 : 1,
                        transition: "border-color 0.15s",
                      }}
                    >
                      {selectedHash === b.blockHash && (
                        <div style={{
                          position: "absolute", top: 4, right: 4,
                          background: "var(--accent)", color: "#fff",
                          borderRadius: "50%", width: 18, height: 18,
                          fontSize: "0.65rem", display: "flex", alignItems: "center", justifyContent: "center",
                          fontWeight: 700,
                        }}>✓</div>
                      )}
                      <div style={{ display: "flex", justifyContent: "center", pointerEvents: "none", overflow: "hidden" }}>
                        {b.imagePayload
                          ? <BlockFrameCanvas payload={b.imagePayload} />
                          : <div style={{ width: 80, height: 60, background: "var(--bg3)", borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text3)", fontSize: "0.7rem" }}>image manquante</div>
                        }
                      </div>
                      <div style={{ marginTop: "0.4rem", fontSize: "0.68rem", color: "var(--text3)", textAlign: "center", lineHeight: 1.3 }}>
                        <div style={{ color: "var(--text2)", fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                          {b.workTitle || "Sans titre"}
                        </div>
                        <div>#{b.blockIndex} · {b.poolScreen}</div>
                      </div>
                    </button>
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ── Composant avatar ──────────────────────────────────────────────────────────

function ProfileAvatar({
  profile,
  selectedBlock,
  onClick,
}: {
  profile: ArtistProfile | null;
  selectedBlock: MinedBlock | null;
  onClick: () => void;
}) {
  const hasImage = !!(selectedBlock?.imagePayload);
  const crop = profile?.profileImageCrop;
  const screen = selectedBlock?.imagePayload?.screen ?? "eink29bwr";
  const { tx, ty, scale } = coverTransform(screen, crop);

  return (
    <button
      onClick={onClick}
      title="Changer la photo de profil"
      style={{
        width: AVATAR_SIZE, height: AVATAR_SIZE, borderRadius: "50%", flexShrink: 0,
        border: hasImage ? "2px solid var(--accent)" : "2px dashed var(--border)",
        background: hasImage ? "var(--bg3)" : "linear-gradient(135deg, var(--accent) 0%, #6366f1 100%)",
        cursor: "pointer", overflow: "hidden", padding: 0,
        position: "relative", transition: "border-color 0.15s",
      }}
    >
      {hasImage ? (
        <div style={{
          position: "absolute",
          transformOrigin: "top left",
          transform: `translate(${tx}px, ${ty}px) scale(${scale})`,
          pointerEvents: "none",
        }}>
          <BlockFrameCanvas payload={selectedBlock!.imagePayload!} unconstrained />
        </div>
      ) : (
        <span style={{
          position: "absolute", inset: 0,
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: "1.6rem",
        }}>🎨</span>
      )}
      <div style={{
        position: "absolute", inset: 0, borderRadius: "50%",
        background: "rgba(0,0,0,0.45)",
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: "0.6rem", color: "#fff", fontWeight: 700,
        opacity: 0, transition: "opacity 0.15s",
      }} className="avatar-overlay">
        ✏️
      </div>
    </button>
  );
}

// ── Page principale ──────────────────────────────────────────────────────────

export default function ProfilePage() {
  const [tab,            setTab]            = useState<"mine" | "shared">("mine");
  const [profile,        setProfile]        = useState<ArtistProfile | null>(null);
  const [loadingProf,    setLoadingProf]    = useState(true);
  const [minedBlocks,    setMinedBlocks]    = useState<MinedBlock[]>([]);
  const [showPicker,     setShowPicker]     = useState(false);
  const [devices,        setDevices]        = useState<OwnedDevice[]>([]);
  const [publicDevices,  setPublicDevices]  = useState<PublicDevice[]>([]);
  const [loading,        setLoading]        = useState(true);
  const [loadingPub,     setLoadingPub]     = useState(false);
  const [rotating,       setRotating]       = useState<string | null>(null);
  const [newCode,        setNewCode]        = useState<Record<string, string>>({});
  const [copyMsg,        setCopyMsg]        = useState<Record<string, string>>({});
  const [toggling,       setToggling]       = useState<string | null>(null);
  const [profError,      setProfError]      = useState<string | null>(null);
  const [deleting,       setDeleting]       = useState(false);

  // Bloc sélectionné comme avatar
  const selectedBlock = profile?.profileImageBlockHash
    ? (minedBlocks.find(b => b.blockHash === profile.profileImageBlockHash) ?? null)
    : null;

  // ── Chargements ─────────────────────────────────────────────────────────────

  async function loadProfile() {
    setLoadingProf(true);
    try {
      const res  = await fetch("/api/artist", { cache: "no-store" });
      const data = await res.json();
      setProfile(data.profile ?? null);
    } catch { setProfile(null); }
    finally { setLoadingProf(false); }
  }

  async function loadMinedBlocks() {
    try {
      const res  = await fetch("/api/artist/blocks", { cache: "no-store" });
      const data = await res.json();
      setMinedBlocks(data.blocks ?? []);
    } catch { setMinedBlocks([]); }
  }

  async function loadDevices() {
    setLoading(true);
    try {
      const res  = await fetch("/api/devices?mine=1", { cache: "no-store" });
      const data = await res.json();
      setDevices(data.devices ?? []);
    } catch { setDevices([]); }
    finally { setLoading(false); }
  }

  async function loadPublic() {
    setLoadingPub(true);
    try {
      const res  = await fetch("/api/public-screens", { cache: "no-store" });
      const data = await res.json();
      setPublicDevices(data.devices ?? []);
    } catch { setPublicDevices([]); }
    finally { setLoadingPub(false); }
  }

  useEffect(() => {
    loadProfile();
    loadMinedBlocks();
    loadDevices();
    loadPublic();
  }, []);

  // ── Helpers POST /api/artist ─────────────────────────────────────────────

  async function postProfile(updates: {
    displayName?: string;
    bio?: string;
    profileImageBlockHash?: string;
    profileImageCrop?: { cx: number; cy: number; zoom: number };
    slug?: string;
  }) {
    setProfError(null);
    const current = profile;
    const displayName = updates.displayName ?? current?.displayName ?? "";
    if (!displayName) { setProfError("Définissez d'abord un nom d'artiste."); return false; }

    const res  = await fetch("/api/artist", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({
        displayName,
        bio:                   updates.bio ?? current?.bio,
        profileImageBlockHash: updates.profileImageBlockHash ?? current?.profileImageBlockHash,
        profileImageCrop:      updates.profileImageCrop ?? current?.profileImageCrop,
        ...(updates.slug !== undefined ? { slug: updates.slug } : {}),
      }),
    });
    const data = await res.json();
    if (!res.ok) { setProfError(data.error ?? "Erreur"); return false; }
    setProfile(data.profile);
    return true;
  }

  async function saveArtistName(displayName: string) {
    await postProfile({ displayName });
    setDevices(prev => prev.map(d => ({ ...d, artistName: displayName })));
  }

  async function saveArtistBio(bio: string) {
    await postProfile({ bio });
  }

  async function saveProfileImage(hash: string, crop: { cx: number; cy: number; zoom: number }) {
    await postProfile({ profileImageBlockHash: hash, profileImageCrop: crop });
  }

  async function saveSlug(slug: string) {
    await postProfile({ slug });
  }

  async function handleDeleteProfile() {
    if (!confirm("Supprimer définitivement votre profil artiste ? Vos blocs minés restent dans la blockchain, mais votre nom, bio et photo de profil seront effacés.")) return;
    if (!confirm("Dernière confirmation — cette action est irréversible.")) return;
    setDeleting(true);
    try {
      const res = await fetch("/api/artist", { method: "DELETE" });
      if (res.ok) {
        setProfile(null);
        setMinedBlocks([]);
        window.location.reload();
      } else {
        const d = await res.json();
        alert(d.error ?? "Erreur lors de la suppression");
      }
    } catch { alert("Erreur réseau"); }
    finally { setDeleting(false); }
  }

  // ── Actions devices ────────────────────────────────────────────────────────

  async function saveDeviceName(deviceId: string, deviceName: string) {
    const res  = await fetch("/api/devices/rename", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ deviceId, deviceName }),
    });
    if (res.ok) {
      const data = await res.json();
      setDevices(prev =>
        prev.map(d => d.deviceId === deviceId ? { ...d, deviceName: data.deviceName } : d)
      );
    }
  }

  async function handleRotateCode(deviceId: string) {
    if (!confirm("Générer un nouveau code ? L'ancien ne fonctionnera plus.")) return;
    setRotating(deviceId);
    try {
      const res  = await fetch("/api/devices/rotate-code", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ deviceId }),
      });
      const data = await res.json();
      if (data.ok && data.pairCode) {
        setNewCode(p => ({ ...p, [deviceId]: data.pairCode }));
      } else { alert(data.error ?? "Erreur"); }
    } catch { alert("Erreur réseau"); }
    finally { setRotating(null); }
  }

  async function handleTogglePublic(deviceId: string, current: boolean) {
    setToggling(deviceId);
    try {
      await fetch(`/api/my-devices/${deviceId}/availability`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ enabled: !current }),
      });
      await loadDevices();
    } catch { alert("Erreur réseau"); }
    finally { setToggling(null); }
  }

  async function copyCode(deviceId: string, code: string) {
    await navigator.clipboard.writeText(code);
    setCopyMsg(p => ({ ...p, [deviceId]: "Copié !" }));
    setTimeout(() => setCopyMsg(p => ({ ...p, [deviceId]: "" })), 2000);
  }

  // ── Stats ─────────────────────────────────────────────────────────────────

  const totalFrames = devices.reduce((acc, d) => acc + (d.framesSent ?? 0), 0);
  const onlineCount = devices.filter(d => d.isOnline).length;

  // ── Rendu ─────────────────────────────────────────────────────────────────

  return (
    <div style={{ maxWidth: 740, margin: "0 auto", padding: "2rem 1rem" }}>

      {/* ── Picker overlay ── */}
      {showPicker && (
        <ProfileImagePicker
          blocks={minedBlocks}
          selectedHash={profile?.profileImageBlockHash}
          selectedCrop={profile?.profileImageCrop}
          onSelect={saveProfileImage}
          onClose={() => setShowPicker(false)}
        />
      )}

      {/* ── Carte profil artiste ── */}
      <div style={{
        padding: "1.75rem 2rem",
        borderRadius: 14,
        border: "1px solid var(--border)",
        background: "var(--bg2)",
        marginBottom: "2rem",
      }}>
        <div className="profile-header" style={{ display: "flex", alignItems: "flex-start", gap: "1.25rem" }}>

          {/* Avatar cliquable */}
          <ProfileAvatar
            profile={profile}
            selectedBlock={selectedBlock}
            onClick={() => setShowPicker(true)}
          />

          <div style={{ flex: 1, minWidth: 0 }}>
            {loadingProf ? (
              <div style={{ color: "var(--text3)", fontSize: "0.9rem" }}>Chargement…</div>
            ) : (
              <>
                {/* Nom d'artiste */}
                <div style={{ fontSize: "1.4rem", fontWeight: 800, letterSpacing: "-0.02em", marginBottom: "0.35rem" }}>
                  <InlineEdit
                    value={profile?.displayName ?? ""}
                    placeholder="Votre nom d'artiste… (cliquer pour définir)"
                    onSave={saveArtistName}
                    maxLength={60}
                  />
                </div>

                {/* Bio */}
                <div style={{ fontSize: "0.85rem", color: "var(--text2)", lineHeight: 1.5, marginBottom: "0.5rem" }}>
                  <InlineEdit
                    value={profile?.bio ?? ""}
                    placeholder="Une courte bio… (cliquer pour ajouter)"
                    onSave={saveArtistBio}
                    multiline
                    maxLength={300}
                  />
                </div>

                {/* Slug URL */}
                {profile && (
                  <div style={{ marginTop: "0.4rem", marginBottom: "0.3rem" }}>
                    <SlugEditor
                      artistId={profile.artistId}
                      currentSlug={profile.slug}
                      onSave={saveSlug}
                    />
                  </div>
                )}

                {profError && (
                  <div style={{ fontSize: "0.78rem", color: "#f87171", marginTop: "0.25rem" }}>
                    {profError}
                  </div>
                )}

                {/* Photo de profil hint */}
                {!profile?.profileImageBlockHash && minedBlocks.length > 0 && (
                  <button
                    onClick={() => setShowPicker(true)}
                    style={{
                      background: "none", border: "1px dashed var(--border)",
                      borderRadius: 6, padding: "0.25rem 0.75rem",
                      fontSize: "0.72rem", color: "var(--text3)", cursor: "pointer",
                      marginBottom: "0.5rem",
                    }}
                  >
                    🎨 Choisir un dessin miné comme photo de profil
                  </button>
                )}

                {/* Stats */}
                <div className="profile-stats" style={{ display: "flex", gap: "1.5rem", marginTop: "0.5rem", flexWrap: "wrap" }}>
                  {[
                    { label: "ESP liés",          value: devices.length },
                    { label: "En ligne",           value: onlineCount },
                    { label: "Frames envoyées",    value: totalFrames },
                    { label: "Blocs minés",        value: minedBlocks.length },
                  ].map(s => (
                    <div key={s.label}>
                      <div style={{ fontSize: "1.1rem", fontWeight: 800, fontFamily: "JetBrains Mono, monospace" }}>
                        {s.value}
                      </div>
                      <div style={{ fontSize: "0.7rem", color: "var(--text3)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                        {s.label}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* Actions rapides */}
          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", flexShrink: 0 }}>
            <a
              href="/onboard"
              style={{
                padding: "0.5rem 1rem",
                borderRadius: 8,
                background: "var(--accent)",
                color: "#fff",
                textDecoration: "none",
                fontWeight: 600,
                fontSize: "0.8rem",
                whiteSpace: "nowrap",
                textAlign: "center",
              }}
            >
              + Ajouter un ESP
            </a>
            {profile && (
              <button
                onClick={handleDeleteProfile}
                disabled={deleting}
                title="Supprimer définitivement votre profil artiste"
                style={{
                  padding: "0.5rem 1rem",
                  borderRadius: 8,
                  border: "1px solid rgba(248,113,113,0.35)",
                  background: "rgba(248,113,113,0.06)",
                  color: "#f87171",
                  fontWeight: 600,
                  fontSize: "0.8rem",
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                  opacity: deleting ? 0.5 : 1,
                }}
              >
                {deleting ? "Suppression…" : "🗑 Supprimer le profil"}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ── Connexion multi-appareils ── */}
      {profile && <LiaisonSection artistId={profile.artistId} />}

      {/* ── Onglets ── */}
      <div style={{
        display: "flex", gap: 0, marginBottom: "1.5rem",
        borderBottom: "1px solid var(--border)",
        marginTop: "2rem",
      }}>
        {([
          { key: "mine",   label: "Mes ESP" },
          { key: "shared", label: `ESP disponibles${publicDevices.length ? ` (${publicDevices.length})` : ""}` },
        ] as const).map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            style={{
              padding: "0.6rem 1.2rem",
              background: "none", border: "none",
              borderBottom: `2px solid ${tab === key ? "var(--accent)" : "transparent"}`,
              color: tab === key ? "var(--accent)" : "var(--text3)",
              fontWeight: tab === key ? 700 : 500,
              fontSize: "0.875rem", cursor: "pointer",
              transition: "color 0.12s, border-color 0.12s",
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {/* ── Tab : ESP disponibles ── */}
      {tab === "shared" && (
        loadingPub ? (
          <div style={{ color: "var(--text3)", textAlign: "center", padding: "2rem" }}>Chargement…</div>
        ) : publicDevices.length === 0 ? (
          <div style={{
            textAlign: "center", padding: "3rem 2rem",
            border: "1px dashed var(--border)", borderRadius: 12,
          }}>
            <div style={{ fontSize: "2.5rem", marginBottom: "0.75rem" }}>📡</div>
            <p style={{ color: "var(--text2)", marginBottom: "0.5rem" }}>Aucun ESP partagé pour l&apos;instant.</p>
            <p style={{ color: "var(--text3)", fontSize: "0.8rem" }}>
              Les artistes qui activent le prêt public sur leurs ESP apparaissent ici.
            </p>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
            {publicDevices.map(pub => (
              <div key={pub.deviceId} style={{
                padding: "1rem 1.25rem",
                borderRadius: 10,
                border: "1px solid var(--border)",
                background: "var(--bg2)",
                display: "flex", alignItems: "center", justifyContent: "space-between", gap: "1rem",
                flexWrap: "wrap",
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
                  <div style={{
                    width: 8, height: 8, borderRadius: "50%", flexShrink: 0,
                    background: pub.isOnline ? "#4ade80" : "var(--text3)",
                  }} />
                  <div>
                    <div style={{ fontWeight: 700, fontSize: "0.95rem" }}>{pub.artistName}</div>
                    <div style={{ fontSize: "0.72rem", color: "var(--text3)" }}>
                      {pub.screens.map(sid => isKnownScreen(sid) ? SCREEN_PROFILES[sid].name : sid).join(" · ")}
                    </div>
                  </div>
                </div>
                <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                  {pub.screens.map(sid => (
                    <a
                      key={sid}
                      href={`/draw/${pub.deviceId}/${sid}`}
                      style={{
                        padding: "0.45rem 1rem", borderRadius: 7,
                        background: pub.isOnline ? "var(--accent)" : "var(--bg3)",
                        color: pub.isOnline ? "#fff" : "var(--text3)",
                        textDecoration: "none", fontWeight: 600, fontSize: "0.8rem",
                        whiteSpace: "nowrap",
                        border: `1px solid ${pub.isOnline ? "transparent" : "var(--border)"}`,
                        pointerEvents: pub.isOnline ? "auto" : "none",
                        opacity: pub.isOnline ? 1 : 0.5,
                      }}
                    >
                      {isKnownScreen(sid) ? SCREEN_PROFILES[sid].name : sid}
                      {pub.isOnline ? " ✏️" : " 🔴"}
                    </a>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )
      )}

      {/* ── Tab : Mes ESP ── */}
      {tab === "mine" && (
        loading ? (
          <div style={{ color: "var(--text3)", textAlign: "center", padding: "3rem" }}>Chargement…</div>
        ) : devices.length === 0 ? (
          <div style={{
            textAlign: "center", padding: "4rem 2rem",
            border: "1px dashed var(--border)", borderRadius: 12,
          }}>
            <div style={{ fontSize: "3rem", marginBottom: "1rem" }}>📡</div>
            <p style={{ color: "var(--text2)", marginBottom: "1rem" }}>Aucun ESP associé à cette session.</p>
            <a href="/onboard" style={{ color: "var(--accent)", textDecoration: "none", fontWeight: 600 }}>
              Connecter mon premier ESP →
            </a>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
            {devices.map(d => {
              const primaryScreen = d.screens?.[0];
              const drawUrl       = primaryScreen ? `/draw/${d.deviceId}/${primaryScreen}` : null;
              const displayCode   = newCode[d.deviceId];

              return (
                <div key={d.deviceId} style={{
                  padding: "1.25rem 1.5rem", borderRadius: 10,
                  border: "1px solid var(--border)", background: "var(--bg2)",
                }}>
                  {/* En-tête */}
                  <div className="device-header" style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "1rem" }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.2rem" }}>
                        <div style={{
                          width: 8, height: 8, borderRadius: "50%", flexShrink: 0,
                          background: statusColor(d.isOnline, d.lastPing),
                        }} />
                        <span style={{ fontWeight: 700, fontSize: "1rem" }}>
                          <InlineEdit
                            value={d.deviceName ?? ""}
                            placeholder={d.artistName ?? "Nommer cet appareil…"}
                            onSave={v => saveDeviceName(d.deviceId, v)}
                            maxLength={40}
                            style={{ fontSize: "1rem", fontWeight: 700 }}
                          />
                        </span>
                      </div>
                      <div style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "0.7rem", color: "var(--text3)" }}>
                        {d.firmware ?? "firmware inconnu"} · {d.deviceId}
                      </div>
                    </div>
                    {drawUrl && (
                      <a href={drawUrl} className="device-draw-btn" style={{
                        padding: "0.5rem 1.1rem", borderRadius: 6,
                        background: "var(--accent)", color: "#fff",
                        textDecoration: "none", fontWeight: 600, fontSize: "0.875rem",
                        whiteSpace: "nowrap", flexShrink: 0,
                      }}>
                        ✏️ Dessiner
                      </a>
                    )}
                  </div>

                  {/* Stats */}
                  <div className="device-stats-grid" style={{
                    display: "grid", gridTemplateColumns: "repeat(3, 1fr)",
                    gap: "0.75rem", marginTop: "1rem",
                  }}>
                    {[
                      { label: "Frames envoyées", value: d.framesSent ?? 0 },
                      { label: "Dernier ping",    value: timeSince(d.lastPing) },
                      { label: "Enregistré",      value: timeSince(d.createdAt) },
                    ].map(s => (
                      <div key={s.label} style={{ padding: "0.75rem", borderRadius: 8, background: "var(--bg3)" }}>
                        <div style={{ color: "var(--text3)", fontSize: "0.68rem", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                          {s.label}
                        </div>
                        <div style={{
                          fontWeight: 700, fontSize: "0.95rem", marginTop: "0.25rem",
                          fontFamily: typeof s.value === "number" ? "JetBrains Mono, monospace" : undefined,
                        }}>
                          {s.value}
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Écrans */}
                  <div style={{ marginTop: "1rem", display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                    {d.screens?.map(sid => {
                      if (!isKnownScreen(sid)) return null;
                      const p = SCREEN_PROFILES[sid];
                      const isTft = sid === "tft18";
                      return (
                        <a key={sid} href={`/draw/${d.deviceId}/${sid}`} style={{
                          display: "flex", alignItems: "center", gap: "0.5rem",
                          padding: "0.3rem 0.75rem", borderRadius: 6,
                          border: "1px solid var(--border)", background: "var(--bg)",
                          textDecoration: "none", color: "var(--text2)", fontSize: "0.78rem",
                        }}>
                          <div>
                            <div>{p.name}</div>
                            <div style={{ fontSize: "0.65rem", color: "var(--text3)", fontFamily: "JetBrains Mono, monospace" }}>
                              {p.width}×{p.height}
                            </div>
                          </div>
                          {isTft ? (
                            <span style={{
                              fontSize: "0.65rem", fontWeight: 700,
                              background: "linear-gradient(90deg, #f55, #4f4, #55f)",
                              WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
                            }}>RGB</span>
                          ) : (
                            <div style={{ display: "flex", gap: 3 }}>
                              {p.colors.map((c: string) => (
                                <div key={c} style={{
                                  width: 8, height: 8, borderRadius: 2,
                                  background: c, border: "1px solid rgba(255,255,255,0.1)",
                                }} />
                              ))}
                            </div>
                          )}
                        </a>
                      );
                    })}
                  </div>

                  {/* Sécurité */}
                  <div style={{
                    marginTop: "1.25rem", paddingTop: "1rem",
                    borderTop: "1px solid var(--border)",
                    display: "flex", flexDirection: "column", gap: "0.5rem",
                  }}>
                    <div style={{ fontSize: "0.72rem", color: "var(--text3)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                      Sécurité
                    </div>
                    {displayCode && (
                      <div style={{
                        display: "flex", alignItems: "center", gap: "0.75rem",
                        padding: "0.6rem 0.9rem", borderRadius: 6,
                        background: "var(--bg3)", border: "1px solid var(--border)",
                      }}>
                        <span style={{
                          fontFamily: "JetBrains Mono, monospace",
                          fontSize: "1rem", fontWeight: 700, letterSpacing: "0.08em", color: "#4ade80",
                        }}>
                          {displayCode}
                        </span>
                        <button onClick={() => copyCode(d.deviceId, displayCode)} style={{
                          marginLeft: "auto", fontSize: "0.75rem",
                          padding: "0.3rem 0.7rem", borderRadius: 4,
                          border: "1px solid var(--border)", background: "var(--bg)",
                          color: "var(--text2)", cursor: "pointer",
                        }}>
                          {copyMsg[d.deviceId] || "Copier"}
                        </button>
                        <span style={{ fontSize: "0.72rem", color: "var(--text3)" }}>Nouveau code — à noter !</span>
                      </div>
                    )}
                    <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                      <button
                        onClick={() => handleRotateCode(d.deviceId)}
                        disabled={rotating === d.deviceId}
                        style={{
                          padding: "0.4rem 0.9rem", borderRadius: 6,
                          border: "1px solid var(--border)", background: "var(--bg)",
                          color: "var(--text2)", fontSize: "0.78rem", cursor: "pointer",
                          opacity: rotating === d.deviceId ? 0.5 : 1,
                        }}
                      >
                        🔄 {rotating === d.deviceId ? "En cours…" : "Nouveau code de jumelage"}
                      </button>
                      <a href="/onboard" style={{
                        padding: "0.4rem 0.9rem", borderRadius: 6,
                        border: "1px solid var(--border)", background: "var(--bg)",
                        color: "var(--text2)", fontSize: "0.78rem", textDecoration: "none",
                      }}>
                        📲 Connecter un autre appareil
                      </a>
                    </div>
                    <p style={{ fontSize: "0.7rem", color: "var(--text3)", marginTop: "0.25rem" }}>
                      Pour reprendre le contrôle depuis un autre appareil, utilisez{" "}
                      <a href="/onboard" style={{ color: "var(--accent)" }}>/onboard</a>{" "}
                      avec le code affiché sur l&apos;écran.
                    </p>
                  </div>

                  {/* Prêt public */}
                  <div style={{ marginTop: "1rem", paddingTop: "1rem", borderTop: "1px solid var(--border)" }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "1rem" }}>
                      <div>
                        <div style={{ fontSize: "0.72rem", color: "var(--text3)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                          Prêt public
                        </div>
                        <p style={{ fontSize: "0.72rem", color: "var(--text3)", marginTop: "0.2rem", marginBottom: 0 }}>
                          {d.publicMode
                            ? "D'autres artistes peuvent dessiner sur cet ESP."
                            : "Seul vous pouvez dessiner sur cet ESP."}
                        </p>
                      </div>
                      <button
                        onClick={() => handleTogglePublic(d.deviceId, !!d.publicMode)}
                        disabled={toggling === d.deviceId}
                        style={{
                          padding: "0.4rem 1rem", borderRadius: 6,
                          border: `1px solid ${d.publicMode ? "rgba(74,222,128,0.4)" : "var(--border)"}`,
                          background: d.publicMode ? "rgba(74,222,128,0.1)" : "var(--bg)",
                          color: d.publicMode ? "#4ade80" : "var(--text2)",
                          fontSize: "0.78rem", cursor: "pointer", fontWeight: 600, flexShrink: 0,
                          opacity: toggling === d.deviceId ? 0.5 : 1,
                        }}
                      >
                        {toggling === d.deviceId ? "…" : d.publicMode ? "✓ Public" : "Privé"}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )
      )}

      <style>{`
        button:hover .avatar-overlay { opacity: 1 !important; }

        /* ── Mobile responsive ── */
        @media (max-width: 600px) {
          /* Carte profil : avatar + info empilés */
          .profile-header {
            flex-direction: column !important;
            align-items: flex-start !important;
            gap: 1rem !important;
          }
          .profile-avatar-col {
            display: flex !important;
            align-items: center !important;
            gap: 1rem !important;
            width: 100% !important;
          }
          .profile-info-col { width: 100% !important; }
          .profile-add-btn { align-self: flex-start !important; }

          /* Stats : 2 colonnes sur mobile */
          .profile-stats {
            display: grid !important;
            grid-template-columns: 1fr 1fr !important;
            gap: 0.75rem !important;
          }

          /* Device card : stats en 2 colonnes */
          .device-stats-grid {
            grid-template-columns: repeat(2, 1fr) !important;
          }

          /* Bouton dessiner pleine largeur */
          .device-draw-btn {
            width: 100% !important;
            text-align: center !important;
            margin-top: 0.75rem !important;
          }

          /* En-tête device : empilé */
          .device-header {
            flex-direction: column !important;
            align-items: flex-start !important;
            gap: 0.5rem !important;
          }
        }
      `}</style>
    </div>
  );
}
