"use client";

// app/profile/PairDevice.tsx
// Appairage d'un appareil (PC, tablette, autre navigateur) à son profil, par un code à usage unique de 10 minutes.
//   • Côté profil existant (téléphone)  : « Appairer un nouvel appareil » → code + statut en direct (« ✓ appairé »).
//   • Côté nouvel appareil (sans profil) : « Appairer ce navigateur » → saisie du code → l'appareil rejoint le profil.
// L'appareil d'origine GARDE tous ses droits : l'appairage ajoute un navigateur au profil, il n'en retire jamais.

import { useCallback, useEffect, useRef, useState } from "react";

const POLL_MS = 4000;

const box: React.CSSProperties = { padding: "1.5rem", borderRadius: 12, border: "1px solid var(--border)", background: "var(--bg2)" };
const btn: React.CSSProperties = { padding: "0.55rem 1.1rem", borderRadius: 7, border: "none", background: "var(--accent)", color: "#fff", fontSize: "0.84rem", fontWeight: 600, cursor: "pointer" };
const btnGhost: React.CSSProperties = { padding: "0.4rem 0.8rem", borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text2)", fontSize: "0.76rem", cursor: "pointer" };
const small: React.CSSProperties = { fontSize: "0.78rem", color: "var(--text3)", lineHeight: 1.55, margin: 0 };

// ─── Nouvel appareil : saisir le code ─────────────────────────────────────────

export function JoinWithCode({ label = "Appairer cet appareil" }: { label?: string }) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function join() {
    if (busy || !code.trim()) return;
    setBusy(true); setMsg(null);
    try {
      const res = await fetch("/api/artist/join", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setMsg({ ok: false, text: res.status === 429 ? "Trop de tentatives, réessayez dans quelques minutes." : (data.error ?? "Erreur") }); return; }
      setMsg({ ok: true, text: `✓ Appareil appairé au profil « ${data.profile.displayName} »` });
      setCode("");
      setTimeout(() => window.location.reload(), 1200);
    } catch { setMsg({ ok: false, text: "Erreur réseau" }); }
    finally { setBusy(false); }
  }

  return (
    <div>
      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
        <input
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          onKeyDown={(e) => { if (e.key === "Enter") join(); }}
          placeholder="XXXX-XXXX"
          maxLength={9}
          autoCapitalize="characters"
          autoComplete="off"
          spellCheck={false}
          aria-label="Code d'appairage"
          style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "1rem", letterSpacing: "0.1em", padding: "0.5rem 0.7rem", borderRadius: 7, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)", width: 150, outline: "none" }}
        />
        <button onClick={join} disabled={busy || !code.trim()} style={{ ...btn, opacity: busy || !code.trim() ? 0.5 : 1 }}>{busy ? "…" : label}</button>
      </div>
      {msg && <div role="status" style={{ marginTop: "0.5rem", fontSize: "0.78rem", color: msg.ok ? "#4ade80" : "#f87171" }}>{msg.text}</div>}
    </div>
  );
}

/** Carte affichée sur un navigateur SANS profil : c'est ici qu'un PC rejoint le profil du téléphone. */
export function PairThisBrowser() {
  return (
    <div style={{ ...box, marginBottom: "2rem" }}>
      <h2 style={{ fontSize: "0.95rem", fontWeight: 800, margin: "0 0 0.35rem" }}>🔗 Vous avez déjà un profil sur un autre appareil ?</h2>
      <p style={{ ...small, marginBottom: "1rem" }}>
        Sur l&apos;appareil qui a vos ESP (votre téléphone), ouvrez <strong>Mon profil → Appairer un nouvel appareil</strong> : un code
        s&apos;affiche. Saisissez-le ici pour retrouver votre profil et vos ESP sur ce navigateur. L&apos;autre appareil garde ses droits.
      </p>
      <JoinWithCode />
    </div>
  );
}

// ─── Appareil d'origine : générer le code ─────────────────────────────────────

export function PairingSection() {
  const [code, setCode] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState(0);
  const [left, setLeft] = useState(0);
  const [state, setState] = useState<"idle" | "waiting" | "paired" | "expired">("idle");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [showJoin, setShowJoin] = useState(false);
  const stateRef = useRef(state);
  stateRef.current = state;

  const generate = useCallback(async () => {
    setBusy(true); setErr(null);
    try {
      const res = await fetch("/api/artist/link-code", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setErr(res.status === 429 ? "Trop de codes générés, réessayez dans quelques minutes." : (data.error ?? "Erreur")); return; }
      setCode(data.code); setExpiresAt(data.expiresAt); setLeft(data.expiresIn); setState("waiting");
    } catch { setErr("Erreur réseau"); }
    finally { setBusy(false); }
  }, []);

  // Compte à rebours + sondage de l'état du code (toutes les 4 s, onglet visible seulement), tant qu'il attend
  useEffect(() => {
    if (state !== "waiting" || !code) return;
    const tick = setInterval(() => {
      const remaining = Math.max(0, Math.round((expiresAt - Date.now()) / 1000));
      setLeft(remaining);
      if (remaining === 0 && stateRef.current === "waiting") setState("expired");
    }, 1000);
    const poll = setInterval(async () => {
      if (document.visibilityState !== "visible" || stateRef.current !== "waiting") return;
      try {
        const r = await fetch(`/api/artist/link-code?code=${encodeURIComponent(code)}`, { cache: "no-store" });
        const d = await r.json();
        if (d.status === "used") setState("paired");
        else if (d.status === "expired") setState("expired");
      } catch { /* réseau instable : prochain sondage */ }
    }, POLL_MS);
    return () => { clearInterval(tick); clearInterval(poll); };
  }, [state, code, expiresAt]);

  async function copy() {
    if (!code) return;
    try { await navigator.clipboard.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch { /* presse-papiers indisponible */ }
  }

  return (
    <div style={{ marginTop: "2rem" }}>
      <div style={box}>
        <h2 style={{ fontSize: "0.95rem", fontWeight: 800, margin: "0 0 0.35rem" }}>🔗 Appairer un nouvel appareil</h2>
        <p style={{ ...small, marginBottom: "1rem" }}>
          Pour utiliser votre profil et vos ESP depuis un PC, une tablette ou un autre navigateur : générez un code ici, puis saisissez-le
          sur le nouvel appareil (page « Mon profil »). <strong>Cet appareil garde tous ses droits</strong>, et le nouveau reçoit les mêmes
          — y compris sur les ESP que vous ajouterez plus tard.
        </p>

        {(state === "idle" || state === "expired") && (
          <>
            {state === "expired" && <p style={{ ...small, color: "#fb923c", marginBottom: "0.7rem" }}>Le code a expiré ou a déjà servi sans être utilisé.</p>}
            <button onClick={generate} disabled={busy} style={{ ...btn, opacity: busy ? 0.6 : 1 }}>{busy ? "Génération…" : "Appairer un nouvel appareil"}</button>
          </>
        )}

        {state === "waiting" && code && (
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
              <span style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "1.9rem", fontWeight: 800, letterSpacing: "0.14em", color: left > 120 ? "#4ade80" : left > 40 ? "#fb923c" : "#f87171" }}>{code}</span>
              <button onClick={copy} style={btnGhost}>{copied ? "✓ Copié" : "Copier"}</button>
            </div>
            <p style={{ ...small, marginTop: "0.6rem" }}>
              En attente du nouvel appareil… expire dans {Math.floor(left / 60)}:{String(left % 60).padStart(2, "0")} · utilisable une seule fois.
            </p>
          </div>
        )}

        {state === "paired" && (
          <div role="status">
            <p style={{ fontSize: "0.9rem", fontWeight: 700, color: "#4ade80", margin: "0 0 0.6rem" }}>✓ Nouvel appareil appairé</p>
            <p style={{ ...small, marginBottom: "0.8rem" }}>Il a maintenant accès à votre profil et à vos ESP. Vous pouvez en appairer un autre.</p>
            <button onClick={generate} disabled={busy} style={btnGhost}>Appairer un autre appareil</button>
          </div>
        )}

        {err && <p role="alert" style={{ ...small, color: "#f87171", marginTop: "0.6rem" }}>{err}</p>}

        <div style={{ marginTop: "1.25rem", borderTop: "1px solid var(--border)", paddingTop: "0.9rem" }}>
          <button onClick={() => setShowJoin((v) => !v)} style={{ ...btnGhost, border: "none", background: "none", padding: 0, textDecoration: "underline" }}>
            {showJoin ? "▾" : "▸"} J&apos;ai un code d&apos;un autre appareil
          </button>
          {showJoin && (
            <div style={{ marginTop: "0.8rem" }}>
              <p style={{ ...small, marginBottom: "0.6rem" }}>Cet appareil rejoindra le profil du code ; ses ESP actuels y seront rattachés.</p>
              <JoinWithCode label="Rejoindre" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
