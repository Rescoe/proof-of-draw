"use client";

import { useEffect, useRef, useState } from "react";
import { OwnedDevice } from "@/lib/deviceStore";
import { SCREEN_PROFILES } from "@/lib/screenProfiles";
import { BlockFrameCanvas } from "@/app/BlockFrameCanvas";
import type { BlockImagePayload } from "@/lib/chain";

// ── Types ─────────────────────────────────────────────────────────────────────

interface ArtistProfile {
  artistId:              string;
  displayName:           string;
  bio?:                  string;
  profileImageBlockHash?: string;
  createdAt:             number;
  updatedAt:             number;
}

interface MinedBlock {
  blockHash:    string;
  blockIndex:   number;
  workTitle?:   string;
  minedAt:      number;
  poolScreen:   string;
  imagePayload: BlockImagePayload;
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

// ── Composant picker de photo de profil ───────────────────────────────────────

function ProfileImagePicker({
  blocks,
  selectedHash,
  onSelect,
  onClose,
}: {
  blocks: MinedBlock[];
  selectedHash?: string;
  onSelect: (hash: string) => Promise<void>;
  onClose: () => void;
}) {
  const [saving, setSaving] = useState<string | null>(null);

  async function pick(hash: string) {
    setSaving(hash);
    try { await onSelect(hash); onClose(); }
    finally { setSaving(null); }
  }

  return (
    <div
      onClick={onClose}
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
          maxWidth: 600, width: "100%", maxHeight: "80vh", overflowY: "auto",
        }}
      >
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
            <p>Aucun bloc miné pour l&apos;instant. Dessinez et faites valider un bloc pour débloquer cette fonctionnalité !</p>
          </div>
        ) : (
          <>
            <p style={{ fontSize: "0.8rem", color: "var(--text3)", marginBottom: "1rem" }}>
              Choisissez l&apos;un de vos dessins validés comme photo de profil.
            </p>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: "0.75rem" }}>
              {blocks.map(b => (
                <button
                  key={b.blockHash}
                  onClick={() => pick(b.blockHash)}
                  disabled={saving === b.blockHash}
                  style={{
                    border: `2px solid ${selectedHash === b.blockHash ? "var(--accent)" : "var(--border)"}`,
                    borderRadius: 10, background: "var(--bg)", padding: "0.5rem",
                    cursor: "pointer", position: "relative", opacity: saving === b.blockHash ? 0.6 : 1,
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
                  <div style={{ display: "flex", justifyContent: "center", pointerEvents: "none" }}>
                    <BlockFrameCanvas payload={b.imagePayload} />
                  </div>
                  <div style={{
                    marginTop: "0.4rem", fontSize: "0.68rem", color: "var(--text3)",
                    textAlign: "center", lineHeight: 1.3,
                  }}>
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
  const hasImage = !!selectedBlock;

  return (
    <button
      onClick={onClick}
      title="Changer la photo de profil"
      style={{
        width: 72, height: 72, borderRadius: "50%", flexShrink: 0,
        border: hasImage ? "2px solid var(--accent)" : "2px dashed var(--border)",
        background: hasImage ? "var(--bg3)" : "linear-gradient(135deg, var(--accent) 0%, #6366f1 100%)",
        cursor: "pointer", overflow: "hidden", padding: 0,
        display: "flex", alignItems: "center", justifyContent: "center",
        position: "relative", transition: "border-color 0.15s",
      }}
    >
      {hasImage ? (
        <div style={{
          width: "100%", height: "100%",
          display: "flex", alignItems: "center", justifyContent: "center",
          overflow: "hidden",
        }}>
          {/* Rendu inline du canvas — scale pour remplir le cercle */}
          <div style={{ transform: "scale(0.38)", transformOrigin: "center" }}>
            <BlockFrameCanvas payload={selectedBlock.imagePayload} />
          </div>
        </div>
      ) : (
        <span style={{ fontSize: "1.6rem" }}>🎨</span>
      )}
      {/* Overlay "modifier" au survol */}
      <div style={{
        position: "absolute", inset: 0, borderRadius: "50%",
        background: "rgba(0,0,0,0.45)",
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: "0.6rem", color: "#fff", fontWeight: 700,
        opacity: 0,
        transition: "opacity 0.15s",
      }}
        className="avatar-overlay"
      >
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
        bio:                  updates.bio ?? current?.bio,
        profileImageBlockHash: updates.profileImageBlockHash ?? current?.profileImageBlockHash,
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

  async function saveProfileImage(blockHash: string) {
    await postProfile({ profileImageBlockHash: blockHash });
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
        <div style={{ display: "flex", alignItems: "flex-start", gap: "1.25rem" }}>

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
                <div style={{ display: "flex", gap: "1.5rem", marginTop: "0.5rem", flexWrap: "wrap" }}>
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

          {/* Lien rapide onboard */}
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
              flexShrink: 0,
            }}
          >
            + Ajouter un ESP
          </a>
        </div>
      </div>

      {/* ── Onglets ── */}
      <div style={{
        display: "flex", gap: 0, marginBottom: "1.5rem",
        borderBottom: "1px solid var(--border)",
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
                    <div style={{ fontSize: "0.72rem", color: "var(--text3)", fontFamily: "monospace" }}>
                      {pub.screens.join(", ")}
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
                  <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "1rem" }}>
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
                      <a href={drawUrl} style={{
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
                  <div style={{
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
                      return (
                        <a key={sid} href={`/draw/${d.deviceId}/${sid}`} style={{
                          display: "flex", alignItems: "center", gap: "0.5rem",
                          padding: "0.3rem 0.75rem", borderRadius: 6,
                          border: "1px solid var(--border)", background: "var(--bg)",
                          textDecoration: "none", color: "var(--text2)", fontSize: "0.78rem",
                        }}>
                          {p.name}
                          <div style={{ display: "flex", gap: 3 }}>
                            {p.colors.map((c: string) => (
                              <div key={c} style={{
                                width: 8, height: 8, borderRadius: 2,
                                background: c, border: "1px solid rgba(255,255,255,0.1)",
                              }} />
                            ))}
                          </div>
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
      `}</style>
    </div>
  );
}
