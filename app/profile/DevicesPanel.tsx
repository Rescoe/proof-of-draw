"use client";

// app/profile/DevicesPanel.tsx — liste compacte de « Mes ESP » (page « Mon profil »).
//
// Avant : chaque appareil étalait ~10 blocs (stats, sécurité, prêt public, ANA, conversion, transfert, suppression…) et un bouton par écran.
// Maintenant : une carte compacte par appareil (nom, état, écrans, pastilles de réglages) avec
//   • UN bouton « ✏️ Dessiner » — si l'appareil a plusieurs écrans, un petit menu permet de choisir lequel ;
//   • UN bouton « ⚙ Gérer » qui ouvre un panneau à sous-menus : Réglages · Accès · Blocs · Zone sensible (un seul panneau ouvert à la fois) ;
//   • une suppression protégée : il faut RETAPER le nom de l'appareil (lib/deviceDeleteGuard.ts).

import { useEffect, useRef, useState } from "react";
import type { OwnedDevice } from "@/lib/deviceStore";
import { SCREEN_PROFILES } from "@/lib/screenProfiles";
import { deleteConfirmWord, deleteConfirmed } from "@/lib/deviceDeleteGuard";
import { InlineEdit } from "./InlineEdit";
import { GiveDeviceModal } from "./GiveDeviceModal";

// ── Utilitaires ──────────────────────────────────────────────────────────────

type ManageTab = "settings" | "access" | "blocks" | "danger";
interface ArtistLite { artistId: string; displayName: string }

const screenName = (sid: string) => (SCREEN_PROFILES as Record<string, { name: string }>)[sid]?.name ?? sid;
const screenDims = (sid: string) => {
  const p = (SCREEN_PROFILES as Record<string, { width: number; height: number }>)[sid];
  return p ? `${p.width}×${p.height}` : "";
};
const deviceLabel = (d: OwnedDevice) => d.deviceName || d.artistName || d.deviceId;

function timeSince(ts?: number): string {
  if (!ts) return "jamais";
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60)   return `il y a ${s}s`;
  if (s < 3600) return `il y a ${Math.floor(s / 60)}min`;
  if (s < 86400) return `il y a ${Math.floor(s / 3600)}h`;
  return `il y a ${Math.floor(s / 86400)}j`;
}

function statusColor(isOnline: boolean, lastPing?: number): string {
  if (isOnline) return "#4ade80";
  if (!lastPing) return "var(--text3)";
  return Math.floor((Date.now() - lastPing) / 1000) < 3600 ? "#fb923c" : "var(--text3)";
}

async function postJson(url: string, body?: unknown): Promise<{ ok: boolean; data: Record<string, unknown> }> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, data };
}

// ── Styles partagés ──────────────────────────────────────────────────────────

const label: React.CSSProperties = { fontSize: "0.68rem", color: "var(--text3)", textTransform: "uppercase", letterSpacing: "0.05em" };
const muted: React.CSSProperties = { fontSize: "0.72rem", color: "var(--text3)", lineHeight: 1.5, margin: 0 };
const ghostBtn: React.CSSProperties = {
  padding: "0.4rem 0.85rem", borderRadius: 6, border: "1px solid var(--border)",
  background: "var(--bg)", color: "var(--text2)", fontSize: "0.78rem", cursor: "pointer",
};
const pill: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", gap: 4, padding: "0.12rem 0.55rem", borderRadius: 999,
  border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text2)", fontSize: "0.7rem", whiteSpace: "nowrap",
};

// ── Interrupteur ─────────────────────────────────────────────────────────────

function Switch({ on, busy, onChange, name }: { on: boolean; busy?: boolean; onChange: () => void; name: string }) {
  return (
    <button
      type="button" role="switch" aria-checked={on} aria-label={name} disabled={busy} onClick={onChange}
      style={{
        position: "relative", width: 42, height: 24, borderRadius: 999, flexShrink: 0, cursor: busy ? "wait" : "pointer",
        border: `1px solid ${on ? "rgba(124,107,255,0.6)" : "var(--border)"}`,
        background: on ? "var(--accent)" : "var(--bg3)", opacity: busy ? 0.5 : 1, transition: "background 0.15s",
      }}
    >
      <span style={{ position: "absolute", top: 2, left: on ? 20 : 2, width: 18, height: 18, borderRadius: "50%", background: "#fff", transition: "left 0.15s" }} />
    </button>
  );
}

function SettingRow({ title, desc, children }: { title: string; desc: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "1rem", padding: "0.7rem 0", borderTop: "1px solid var(--border)" }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: "0.85rem", fontWeight: 600, color: "var(--text)" }}>{title}</div>
        <p style={{ ...muted, marginTop: 2 }}>{desc}</p>
      </div>
      {children}
    </div>
  );
}

// ── Menu « Dessiner » : un bouton, un choix d'écran si plusieurs ─────────────

function DrawMenu({ d }: { d: OwnedDevice }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown); document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);

  const primary: React.CSSProperties = {
    padding: "0.45rem 0.95rem", borderRadius: 7, background: "var(--accent)", color: "#fff", textDecoration: "none",
    fontWeight: 600, fontSize: "0.82rem", whiteSpace: "nowrap", border: "none", cursor: "pointer", display: "inline-block",
  };
  if (d.screens.length === 0) return null;
  if (d.screens.length === 1) return <a href={`/draw/${d.deviceId}/${d.screens[0]}`} style={primary}>✏️ Dessiner</a>;

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button type="button" onClick={() => setOpen((v) => !v)} aria-haspopup="menu" aria-expanded={open} style={primary}>✏️ Dessiner ▾</button>
      {open && (
        <div role="menu" style={{
          position: "absolute", right: 0, top: "calc(100% + 4px)", zIndex: 20, minWidth: 210, padding: 4,
          borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg2)", boxShadow: "0 8px 24px rgba(0,0,0,0.35)",
        }}>
          <div style={{ ...label, padding: "0.35rem 0.6rem" }}>Dessiner pour…</div>
          {d.screens.map((sid) => (
            <a key={sid} role="menuitem" href={`/draw/${d.deviceId}/${sid}`} style={{
              display: "flex", justifyContent: "space-between", gap: "1rem", padding: "0.5rem 0.6rem", borderRadius: 6,
              color: "var(--text)", textDecoration: "none", fontSize: "0.82rem",
            }}>
              <span>{screenName(sid)}</span>
              <span style={{ color: "var(--text3)", fontFamily: "JetBrains Mono, monospace", fontSize: "0.7rem" }}>{screenDims(sid)}</span>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Fenêtre de suppression protégée ──────────────────────────────────────────

function DeleteModal({ d, canTransfer, onClose, onTransferFirst, onDone }: {
  d: OwnedDevice; canTransfer: boolean; onClose: () => void; onTransferFirst: () => void; onDone: () => void;
}) {
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const word = deleteConfirmWord(d);
  const ok = deleteConfirmed(typed, d);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !busy) onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  async function remove() {
    if (!ok || busy) return;
    setBusy(true); setErr(null);
    try {
      const { ok: good, data } = await postJson(`/api/my-devices/${d.deviceId}/delete`);
      if (!good) { setErr(typeof data.error === "string" ? data.error : "Échec de la suppression."); return; }
      onDone();
    } catch { setErr("Erreur réseau"); }
    finally { setBusy(false); }
  }

  return (
    <div
      role="dialog" aria-modal="true" aria-labelledby="del-title"
      onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}
      style={{ position: "fixed", inset: 0, zIndex: 100, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", padding: "1rem" }}
    >
      <div style={{ width: "100%", maxWidth: 440, padding: "1.5rem", borderRadius: 12, border: "1px solid rgba(248,113,113,0.45)", background: "var(--bg2)" }}>
        <h2 id="del-title" style={{ margin: "0 0 0.5rem", fontSize: "1.05rem", color: "#f87171" }}>🗑 Supprimer cet appareil ?</h2>
        <p style={{ ...muted, fontSize: "0.82rem", color: "var(--text2)", marginBottom: "0.8rem" }}>
          <strong>{deviceLabel(d)}</strong> <span style={{ fontFamily: "JetBrains Mono, monospace", color: "var(--text3)" }}>({d.deviceId})</span> sera supprimé
          <strong> définitivement</strong> : il n&apos;apparaîtra plus dans votre profil ni dans le réseau, et ne pourra être récupéré qu&apos;en le
          réappairant depuis son écran. {d.framesSent > 0 && <>Il a reçu <strong>{d.framesSent}</strong> frame(s).</>}
        </p>
        {canTransfer && (
          <p style={{ ...muted, marginBottom: "0.8rem" }}>
            Ses blocs minés ne suivent pas automatiquement :{" "}
            <button type="button" onClick={onTransferFirst} style={{ background: "none", border: "none", padding: 0, color: "var(--accent)", textDecoration: "underline", cursor: "pointer", fontSize: "inherit" }}>
              transférez-les d&apos;abord vers un autre appareil
            </button>.
          </p>
        )}
        <label htmlFor="del-confirm" style={{ ...label, display: "block", marginBottom: 4 }}>
          Pour confirmer, tapez : <span style={{ color: "var(--text)", textTransform: "none", fontFamily: "JetBrains Mono, monospace" }}>{word}</span>
        </label>
        <input
          id="del-confirm" autoFocus autoComplete="off" spellCheck={false} value={typed}
          onChange={(e) => setTyped(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") remove(); }}
          style={{ width: "100%", padding: "0.5rem 0.7rem", borderRadius: 7, border: `1px solid ${ok ? "#f87171" : "var(--border)"}`, background: "var(--bg)", color: "var(--text)", fontSize: "0.9rem", outline: "none", boxSizing: "border-box" }}
        />
        {err && <p role="alert" style={{ ...muted, color: "#f87171", marginTop: "0.5rem" }}>{err}</p>}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem", marginTop: "1rem" }}>
          <button type="button" onClick={onClose} disabled={busy} style={ghostBtn}>Annuler</button>
          <button
            type="button" onClick={remove} disabled={!ok || busy}
            style={{ padding: "0.4rem 0.95rem", borderRadius: 6, border: "none", background: "#dc2626", color: "#fff", fontSize: "0.8rem", fontWeight: 700, cursor: ok && !busy ? "pointer" : "not-allowed", opacity: ok && !busy ? 1 : 0.4 }}
          >
            {busy ? "Suppression…" : "Supprimer définitivement"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Panneau « Gérer » (sous-menus) ───────────────────────────────────────────

function ManagePanel({ d, devices, profile, tab, setTab, onReload, onGive, onAskDelete }: {
  d: OwnedDevice; devices: OwnedDevice[]; profile: ArtistLite | null; tab: ManageTab; setTab: (t: ManageTab) => void;
  onReload: () => void; onGive: () => void; onAskDelete: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [convScreen, setConvScreen] = useState(d.screens[0] ?? "");
  const [newCode, setNewCode] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [transferTo, setTransferTo] = useState("");
  const [transferMsg, setTransferMsg] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const others = devices.filter((o) => o.deviceId !== d.deviceId);

  async function run(key: string, fn: () => Promise<void>) {
    setBusy(key); setErr(null);
    try { await fn(); } catch { setErr("Erreur réseau"); } finally { setBusy(null); }
  }
  const toggle = (key: string, path: string, body: unknown) => run(key, async () => {
    const { ok, data } = await postJson(`/api/my-devices/${d.deviceId}/${path}`, body);
    if (!ok) setErr(typeof data.error === "string" ? data.error : "Échec de l'enregistrement");
    onReload();
  });

  const convOn = (d.acceptsConvertedScreens ?? []).includes(convScreen);
  const tabs: { key: ManageTab; label: string; show: boolean }[] = [
    { key: "settings", label: "Réglages", show: true },
    { key: "access",   label: "Accès", show: true },
    { key: "blocks",   label: "Blocs", show: others.length > 0 },
    { key: "danger",   label: "Zone sensible", show: true },
  ];

  return (
    <div style={{ marginTop: "0.9rem", borderTop: "1px solid var(--border)", paddingTop: "0.75rem" }}>
      <div role="tablist" style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: "0.4rem" }}>
        {tabs.filter((t) => t.show).map((t) => (
          <button
            key={t.key} role="tab" aria-selected={tab === t.key} onClick={() => setTab(t.key)}
            style={{
              padding: "0.3rem 0.8rem", borderRadius: 999, fontSize: "0.76rem", cursor: "pointer", fontWeight: tab === t.key ? 700 : 500,
              border: `1px solid ${tab === t.key ? (t.key === "danger" ? "rgba(248,113,113,0.5)" : "var(--accent)") : "var(--border)"}`,
              background: tab === t.key ? (t.key === "danger" ? "rgba(248,113,113,0.08)" : "rgba(124,107,255,0.1)") : "var(--bg)",
              color: tab === t.key ? (t.key === "danger" ? "#f87171" : "var(--accent)") : "var(--text2)",
            }}
          >
            {t.label}
          </button>
        ))}
      </div>
      {err && <p role="alert" style={{ ...muted, color: "#f87171", margin: "0.3rem 0" }}>{err}</p>}

      {tab === "settings" && (
        <div>
          <SettingRow
            title="Prêt public"
            desc={d.publicMode ? "D'autres artistes peuvent dessiner sur cet ESP." : "Seul vous pouvez dessiner sur cet ESP."}
          >
            <Switch name="Prêt public" on={!!d.publicMode} busy={busy === "public"} onChange={() => toggle("public", "availability", { enabled: !d.publicMode })} />
          </SettingRow>
          <SettingRow
            title="Œuvres d'agent IA"
            desc={d.acceptsAnaArt ? "Reçoit aussi les dessins publiés par les agents normies de l'ANA." : "N'affiche que les dessins humains."}
          >
            <Switch name="Œuvres d'agent IA" on={!!d.acceptsAnaArt} busy={busy === "ana"} onChange={() => toggle("ana", "accepts-ana-art", { enabled: !d.acceptsAnaArt })} />
          </SettingRow>
          <div style={{ padding: "0.7rem 0", borderTop: "1px solid var(--border)" }}>
            <div style={{ fontSize: "0.85rem", fontWeight: 600 }}>Dessins d&apos;autres écrans</div>
            <p style={{ ...muted, marginTop: 2, marginBottom: "0.55rem" }}>
              Reçoit les dessins conçus pour un autre type d&apos;écran, convertis automatiquement au format de l&apos;écran choisi.
            </p>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap" }}>
              {d.screens.length > 1 ? (
                <div role="group" aria-label="Écran concerné" style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                  {d.screens.map((sid) => (
                    <button
                      key={sid} type="button" onClick={() => setConvScreen(sid)} aria-pressed={convScreen === sid}
                      style={{ ...pill, cursor: "pointer", borderColor: convScreen === sid ? "var(--accent)" : "var(--border)", color: convScreen === sid ? "var(--accent)" : "var(--text2)", fontWeight: convScreen === sid ? 700 : 500 }}
                    >
                      {screenName(sid)}
                    </button>
                  ))}
                </div>
              ) : <span style={{ fontSize: "0.8rem", color: "var(--text2)" }}>{screenName(convScreen)}</span>}
              <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
                <span style={{ fontSize: "0.74rem", color: convOn ? "var(--accent)" : "var(--text3)" }}>{convOn ? "Activé" : "Désactivé"}</span>
                <Switch
                  name={`Conversion pour ${screenName(convScreen)}`} on={convOn} busy={busy === "conv"}
                  onChange={() => toggle("conv", "accepts-converted", { screen: convScreen, enabled: !convOn })}
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {tab === "access" && (
        <div style={{ borderTop: "1px solid var(--border)", paddingTop: "0.7rem", display: "flex", flexDirection: "column", gap: "0.8rem" }}>
          <div>
            <div style={{ fontSize: "0.85rem", fontWeight: 600 }}>Code de jumelage de l&apos;ESP</div>
            <p style={{ ...muted, marginTop: 2 }}>
              Le code affiché sur l&apos;écran de l&apos;ESP permet de le reprendre depuis <a href="/onboard" style={{ color: "var(--accent)" }}>/onboard</a>.
              Si vous pensez qu&apos;il a fuité, régénérez-le : l&apos;ancien cesse de fonctionner.
            </p>
            <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", flexWrap: "wrap", marginTop: "0.5rem" }}>
              <button
                type="button" disabled={busy === "rotate"} style={{ ...ghostBtn, opacity: busy === "rotate" ? 0.5 : 1 }}
                onClick={() => {
                  if (!confirm("Générer un nouveau code ? L'ancien ne fonctionnera plus.")) return;
                  run("rotate", async () => {
                    const { ok, data } = await postJson("/api/devices/rotate-code", { deviceId: d.deviceId });
                    if (ok && typeof data.pairCode === "string") setNewCode(data.pairCode);
                    else setErr(typeof data.error === "string" ? data.error : "Erreur");
                  });
                }}
              >
                🔄 {busy === "rotate" ? "En cours…" : "Régénérer le code"}
              </button>
              {newCode && (
                <>
                  <span style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "1rem", fontWeight: 700, letterSpacing: "0.08em", color: "#4ade80" }}>{newCode}</span>
                  <button type="button" style={ghostBtn} onClick={async () => { try { await navigator.clipboard.writeText(newCode); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch { /* presse-papiers indisponible */ } }}>
                    {copied ? "✓ Copié" : "Copier"}
                  </button>
                  <span style={muted}>À noter !</span>
                </>
              )}
            </div>
          </div>
          <div style={{ padding: "0.7rem 0.9rem", borderRadius: 8, background: "var(--bg3)" }}>
            <div style={{ fontSize: "0.82rem", fontWeight: 600 }}>Autoriser un autre PC ou téléphone à piloter vos ESP ?</div>
            <p style={{ ...muted, marginTop: 2 }}>
              Ce n&apos;est pas un réglage d&apos;ESP : voir <a href="#acces-equipements" style={{ color: "var(--accent)" }}>« Autoriser un autre équipement »</a> en haut de la page.
            </p>
          </div>
        </div>
      )}

      {tab === "blocks" && others.length > 0 && (
        <div style={{ borderTop: "1px solid var(--border)", paddingTop: "0.7rem" }}>
          <div style={{ fontSize: "0.85rem", fontWeight: 600 }}>Transférer les blocs minés</div>
          <p style={{ ...muted, marginTop: 2, marginBottom: "0.55rem" }}>Déplace tous les blocs minés de cet ESP vers un autre de vos appareils.</p>
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center" }}>
            <select value={transferTo} onChange={(e) => setTransferTo(e.target.value)} aria-label="Appareil de destination" style={{ ...ghostBtn, padding: "0.4rem 0.6rem" }}>
              <option value="">vers…</option>
              {others.map((o) => <option key={o.deviceId} value={o.deviceId}>{deviceLabel(o)}</option>)}
            </select>
            <button
              type="button" disabled={!transferTo || busy === "transfer"} style={{ ...ghostBtn, opacity: !transferTo || busy === "transfer" ? 0.5 : 1 }}
              onClick={() => run("transfer", async () => {
                setTransferMsg("");
                const { ok, data } = await postJson("/api/transfer-blocks", { fromDeviceId: d.deviceId, toDeviceId: transferTo });
                setTransferMsg(ok ? `${data.transferred}/${data.total} bloc(s) transféré(s).` : (typeof data.error === "string" ? data.error : "Échec du transfert."));
                onReload();
              })}
            >
              {busy === "transfer" ? "Transfert…" : "↪ Transférer tous les blocs"}
            </button>
          </div>
          {transferMsg && <p style={{ ...muted, marginTop: "0.4rem" }}>{transferMsg}</p>}
        </div>
      )}

      {tab === "danger" && (
        <div style={{ borderTop: "1px solid var(--border)", paddingTop: "0.7rem" }}>
          {profile && d.artistId === profile.artistId && (
            <SettingRow title="Donner cet ESP" desc="Le remettre à quelqu'un d'autre : vous choisissez les œuvres que vous gardez.">
              <button type="button" onClick={onGive} style={ghostBtn}>🎁 Donner…</button>
            </SettingRow>
          )}
          <SettingRow title="Supprimer cet appareil" desc="Irréversible. Une confirmation en retapant le nom de l'appareil vous sera demandée.">
            <button type="button" onClick={onAskDelete} style={{ ...ghostBtn, borderColor: "rgba(248,113,113,0.45)", color: "#f87171" }}>🗑 Supprimer…</button>
          </SettingRow>
        </div>
      )}
    </div>
  );
}

// ── Carte compacte ───────────────────────────────────────────────────────────

function DeviceCard({ d, open, onToggle, onRenamed, profile, children }: {
  d: OwnedDevice; open: boolean; onToggle: () => void; onRenamed: () => void; profile: ArtistLite | null; children: React.ReactNode;
}) {
  const convCount = (d.acceptsConvertedScreens ?? []).length;
  const mine = !profile || d.artistId === profile.artistId;
  return (
    <div style={{ padding: "1rem 1.1rem", borderRadius: 10, border: `1px solid ${open ? "var(--accent)" : "var(--border)"}`, background: "var(--bg2)" }}>
      <div className="dev-head" style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "0.75rem" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <span title={d.isOnline ? "En ligne" : `Dernier ping ${timeSince(d.lastPing)}`} style={{ width: 9, height: 9, borderRadius: "50%", flexShrink: 0, background: statusColor(d.isOnline, d.lastPing) }} />
            <span style={{ fontWeight: 700, fontSize: "0.98rem", minWidth: 0 }}>
              <InlineRename d={d} onSaved={onRenamed} />
            </span>
          </div>
          <div style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "0.68rem", color: "var(--text3)", marginTop: 2, overflowWrap: "anywhere" }}>
            {d.firmware ?? "firmware inconnu"} · {d.deviceId}
          </div>
        </div>
        <div className="dev-actions" style={{ display: "flex", gap: "0.4rem", flexShrink: 0 }}>
          <DrawMenu d={d} />
          {d.screens.includes("tft28") && <a href="/bench" title="Banc d'essai d'animation (test)" style={{ ...ghostBtn, textDecoration: "none", display: "inline-flex", alignItems: "center" }}>🧪 Banc d&apos;essai</a>}
          <button
            type="button" onClick={onToggle} aria-expanded={open}
            style={{ ...ghostBtn, fontWeight: 600, borderColor: open ? "var(--accent)" : "var(--border)", color: open ? "var(--accent)" : "var(--text2)" }}
          >
            ⚙ Gérer {open ? "▴" : "▾"}
          </button>
        </div>
      </div>

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: "0.6rem" }}>
        {d.screens.map((sid) => (
          <span key={sid} style={pill} title={`${screenName(sid)} ${screenDims(sid)}`}>
            {screenName(sid)} <span style={{ color: "var(--text3)", fontFamily: "JetBrains Mono, monospace", fontSize: "0.64rem" }}>{screenDims(sid)}</span>
          </span>
        ))}
        <span style={{ ...pill, color: d.publicMode ? "#4ade80" : "var(--text3)" }}>{d.publicMode ? "🌐 Public" : "🔒 Privé"}</span>
        {d.acceptsAnaArt && <span style={{ ...pill, color: "#7c6bff" }}>🤖 ANA</span>}
        {convCount > 0 && <span style={{ ...pill, color: "#7c6bff" }}>⇄ Conversion {convCount}/{d.screens.length}</span>}
        {!mine && <span style={{ ...pill, color: "#fb923c" }}>Artiste à part</span>}
      </div>

      <div style={{ fontSize: "0.72rem", color: "var(--text3)", marginTop: "0.5rem" }}>
        {d.framesSent ?? 0} frame{(d.framesSent ?? 0) > 1 ? "s" : ""} · ping {timeSince(d.lastPing)} · enregistré {timeSince(d.createdAt)}
      </div>

      {open && children}
    </div>
  );
}

/** Renommage : le nom est modifiable au clic ; l'enregistrement passe par /api/devices/rename. */
function InlineRename({ d, onSaved }: { d: OwnedDevice; onSaved: () => void }) {
  return (
    <InlineEdit
      value={d.deviceName ?? ""} placeholder={d.artistName ?? "Nommer cet appareil…"} maxLength={40} style={{ fontSize: "0.98rem", fontWeight: 700 }}
      onSave={async (v) => {
        const { ok } = await postJson("/api/devices/rename", { deviceId: d.deviceId, deviceName: v });
        if (ok) onSaved();
      }}
    />
  );
}

// ── Liste ────────────────────────────────────────────────────────────────────

export function DevicesPanel({ devices, profile, loading, onReload }: {
  devices: OwnedDevice[]; profile: ArtistLite | null; loading: boolean; onReload: () => void;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [tabs, setTabs] = useState<Record<string, ManageTab>>({});
  const [query, setQuery] = useState("");
  const [deleting, setDeleting] = useState<OwnedDevice | null>(null);
  const [giving, setGiving] = useState<OwnedDevice | null>(null);

  if (loading) return <div style={{ color: "var(--text3)", textAlign: "center", padding: "3rem" }}>Chargement…</div>;
  if (devices.length === 0) {
    return (
      <div style={{ textAlign: "center", padding: "4rem 2rem", border: "1px dashed var(--border)", borderRadius: 12 }}>
        <div style={{ fontSize: "3rem", marginBottom: "1rem" }}>📡</div>
        <p style={{ color: "var(--text2)", marginBottom: "1rem" }}>Aucun ESP associé à cette session.</p>
        <a href="/onboard" style={{ color: "var(--accent)", textDecoration: "none", fontWeight: 600 }}>Connecter mon premier ESP →</a>
      </div>
    );
  }

  const q = query.trim().toLowerCase();
  const sorted = [...devices].sort((a, b) => Number(b.isOnline) - Number(a.isOnline) || deviceLabel(a).localeCompare(deviceLabel(b)));
  const shown = q
    ? sorted.filter((d) => [deviceLabel(d), d.deviceId, d.firmware, ...d.screens.map(screenName)].join(" ").toLowerCase().includes(q))
    : sorted;
  const onlineCount = devices.filter((d) => d.isOnline).length;

  return (
    <div>
      {giving && (
        <GiveDeviceModal
          deviceId={giving.deviceId} label={deviceLabel(giving)}
          onClose={() => setGiving(null)} onDone={() => { setGiving(null); setOpenId(null); onReload(); }}
        />
      )}
      {deleting && (
        <DeleteModal
          d={deleting} canTransfer={devices.length > 1}
          onClose={() => setDeleting(null)}
          onTransferFirst={() => { setTabs((t) => ({ ...t, [deleting.deviceId]: "blocks" })); setOpenId(deleting.deviceId); setDeleting(null); }}
          onDone={() => { setDeleting(null); setOpenId(null); onReload(); }}
        />
      )}

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.75rem", flexWrap: "wrap", marginBottom: "0.75rem" }}>
        <div style={{ fontSize: "0.8rem", color: "var(--text3)" }}>
          {devices.length} appareil{devices.length > 1 ? "s" : ""} · {onlineCount} en ligne
        </div>
        {devices.length > 4 && (
          <input
            value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Rechercher (nom, écran, identifiant)…" aria-label="Rechercher un appareil"
            style={{ padding: "0.4rem 0.7rem", borderRadius: 7, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)", fontSize: "0.8rem", width: 260, maxWidth: "100%", outline: "none" }}
          />
        )}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "0.7rem" }}>
        {shown.map((d) => (
          <DeviceCard key={d.deviceId} d={d} profile={profile} onRenamed={onReload} open={openId === d.deviceId} onToggle={() => setOpenId(openId === d.deviceId ? null : d.deviceId)}>
            <ManagePanel
              d={d} devices={devices} profile={profile}
              tab={tabs[d.deviceId] ?? "settings"} setTab={(t) => setTabs((s) => ({ ...s, [d.deviceId]: t }))}
              onReload={onReload} onGive={() => setGiving(d)} onAskDelete={() => setDeleting(d)}
            />
          </DeviceCard>
        ))}
        {shown.length === 0 && <p style={{ ...muted, textAlign: "center", padding: "1.5rem" }}>Aucun appareil ne correspond à « {query} ».</p>}
      </div>

      <style>{`
        @media (max-width: 600px) {
          .dev-head { flex-direction: column !important; }
          .dev-actions { width: 100%; }
          .dev-actions > * { flex: 1; }
          .dev-actions > * > a, .dev-actions > * > button, .dev-actions > a, .dev-actions > button { width: 100%; text-align: center; box-sizing: border-box; }
        }
      `}</style>
    </div>
  );
}
