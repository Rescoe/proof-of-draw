"use client";
// app/profile/Recovery.tsx
// Récupération durable de l'accès au profil (04/11/2026). La liaison téléphone ↔ ESP vit dans un cookie ; s'il disparaît (Safari qui purge, navigation privée,
// navigateur intégré, nouveau téléphone), le profil apparaissait « sans écran » et le code d'appairage n'était plus affiché nulle part. Trois filets :
//   1. RecoveryBackup  — le propriétaire obtient un LIEN de récupération (à garder dans une note / un message à soi-même), révocable.
//   2. SessionGuard    — copie du jeton dans le stockage local du navigateur : si le cookie disparaît mais pas ce stockage, l'accès se rétablit SEUL ;
//                        sinon il explique la situation et propose les chemins de retour. Il signale (anonymement) la famille de navigateur pour PROUVER la cause.
//   3. RecoverAccess   — saisie du lien / de la clé, ou du code d'appairage de l'ESP (route /api/onboard existante : retrouve le profil propriétaire).
// Le stockage local est un filet SUPPLÉMENTAIRE, jamais la seule source : tout est enveloppé de try/catch (navigation privée, stockage bloqué).

import { useEffect, useState } from "react";

const LS_TOKEN = "pod_recovery_v1";
const LS_MARK = "pod_paired_v1";

const lsGet = (k: string): string | null => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* stockage indisponible */ } };
const lsDel = (k: string) => { try { localStorage.removeItem(k); } catch { /* stockage indisponible */ } };

const box: React.CSSProperties = { padding: "1.25rem", borderRadius: 12, border: "1px solid var(--border)", background: "var(--bg2)" };
const btn: React.CSSProperties = { padding: "0.55rem 1.1rem", borderRadius: 7, border: "none", background: "var(--accent)", color: "#fff", fontSize: "0.84rem", fontWeight: 600, cursor: "pointer" };
const btnGhost: React.CSSProperties = { padding: "0.4rem 0.8rem", borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text2)", fontSize: "0.76rem", cursor: "pointer" };
const small: React.CSSProperties = { fontSize: "0.78rem", color: "var(--text3)", lineHeight: 1.55, margin: 0 };
const input: React.CSSProperties = { fontFamily: "JetBrains Mono, monospace", fontSize: "0.85rem", padding: "0.5rem 0.7rem", borderRadius: 7, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)", width: "100%", boxSizing: "border-box", outline: "none" };

async function postJson(url: string, body: unknown): Promise<{ ok: boolean; status: number; data: Record<string, unknown> }> {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

// ─── 3. Saisie : lien / clé de récupération, ou code d'appairage de l'ESP ─────

export function RecoverAccess({ title = "Retrouver mon accès" }: { title?: string }) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function go() {
    const v = value.trim();
    if (busy || !v) return;
    setBusy(true); setMsg(null);
    try {
      // Un code d'appairage = 8 caractères (avec ou sans tiret) ; tout le reste est traité comme lien / clé de récupération.
      const compact = v.replace(/[\s-]+/g, "").toUpperCase();
      const isPairCode = /^[A-Z0-9]{8}$/.test(compact) && !v.includes(".") && !v.includes("/");
      const { ok, status, data } = isPairCode
        ? await postJson("/api/onboard", { pairCode: compact })
        : await postJson("/api/artist/recover", { token: v });
      if (!ok) { setMsg({ ok: false, text: status === 429 ? "Trop de tentatives, réessayez dans quelques minutes." : (typeof data.error === "string" ? data.error : "Échec") }); return; }
      const prof = data.profile as { displayName?: string } | null | undefined;
      const text = isPairCode ? `✓ ESP retrouvé${prof?.displayName ? ` — profil « ${prof.displayName} »` : ""}` : `✓ Accès rétabli${prof?.displayName ? ` — profil « ${prof.displayName} »` : ""}`;
      setMsg({ ok: true, text });
      setTimeout(() => { window.location.href = "/profile"; }, 900);
    } catch { setMsg({ ok: false, text: "Erreur réseau" }); }
    finally { setBusy(false); }
  }

  return (
    <div style={box}>
      <div style={{ fontWeight: 700, fontSize: "0.95rem", marginBottom: 4 }}>🔑 {title}</div>
      <p style={{ ...small, marginBottom: "0.7rem" }}>
        Collez votre <b>lien de récupération</b> (ou la clé qui commence par <code>r1.</code>), ou entrez le <b>code d&apos;appairage</b> de votre ESP (8 caractères).
        Vous retrouvez votre profil et tous vos écrans.
      </p>
      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
        <input
          value={value} onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") go(); }}
          placeholder="Lien, clé r1.… ou code ABCD-1234" aria-label="Lien de récupération, clé ou code d'appairage"
          autoComplete="off" autoCapitalize="none" spellCheck={false} style={{ ...input, flex: "1 1 240px", width: "auto" }}
        />
        <button onClick={go} disabled={busy || !value.trim()} style={{ ...btn, opacity: busy || !value.trim() ? 0.5 : 1 }}>{busy ? "…" : "Retrouver"}</button>
      </div>
      {msg && <div role="status" style={{ marginTop: "0.5rem", fontSize: "0.8rem", color: msg.ok ? "#4ade80" : "#f87171" }}>{msg.text}</div>}
    </div>
  );
}

// ─── 1. Propriétaire : lien de récupération ───────────────────────────────────

export function RecoveryBackup() {
  const [token, setToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch("/api/artist/recovery", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((j) => { if (alive && typeof j.token === "string") { setToken(j.token); lsSet(LS_TOKEN, j.token); } })
      .catch(() => { if (alive) setError("Lien indisponible pour le moment."); });
    return () => { alive = false; };
  }, []);

  const link = token && typeof window !== "undefined" ? `${window.location.origin}/retrouver#k=${token}` : "";

  async function copy() {
    try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch { /* presse-papiers indisponible */ }
  }
  async function share() {
    try { await navigator.share({ title: "Mon accès Proof of Draw", text: "Lien pour retrouver mon profil et mes écrans (à garder en lieu sûr) :", url: link }); } catch { /* annulé */ }
  }
  async function rotate() {
    if (!confirm("Créer un nouveau lien ? Les anciens liens cesseront de fonctionner (y compris celui enregistré sur vos autres appareils).")) return;
    setBusy(true); setError(null);
    try {
      const { ok, data } = await postJson("/api/artist/recovery", { action: "rotate" });
      if (ok && typeof data.token === "string") { setToken(data.token); lsSet(LS_TOKEN, data.token); }
      else setError(typeof data.error === "string" ? data.error : "Échec");
    } catch { setError("Erreur réseau"); }
    finally { setBusy(false); }
  }

  return (
    <section id="acces-recuperation" style={{ ...box, marginBottom: "1.5rem" }} aria-labelledby="rec-title">
      <div id="rec-title" style={{ fontWeight: 700, fontSize: "0.95rem", marginBottom: 4 }}>🔑 Sauvegarder mon accès</div>
      <p style={{ ...small, marginBottom: "0.7rem" }}>
        Votre accès à vos écrans est mémorisé dans ce navigateur. S&apos;il l&apos;oublie (navigation privée, nettoyage, nouveau téléphone), ce lien vous le rend en un clic —
        <b> gardez-le dans une note ou envoyez-le-vous</b>. Quiconque possède ce lien peut piloter vos écrans : ne le partagez pas.
      </p>
      {token ? (
        <>
          <input readOnly value={link} onFocus={(e) => e.currentTarget.select()} aria-label="Lien de récupération" style={input} />
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginTop: "0.6rem" }}>
            <button onClick={copy} style={btn}>{copied ? "✓ Copié" : "Copier le lien"}</button>
            {typeof navigator !== "undefined" && "share" in navigator && <button onClick={share} style={btnGhost}>Envoyer…</button>}
            <button onClick={rotate} disabled={busy} style={{ ...btnGhost, opacity: busy ? 0.5 : 1 }}>↻ Nouveau lien (révoque les anciens)</button>
          </div>
        </>
      ) : <p style={small}>{error ?? "Chargement…"}</p>}
      {token && error && <p role="alert" style={{ ...small, color: "#f87171", marginTop: "0.4rem" }}>{error}</p>}
    </section>
  );
}

// ─── 2. Garde de session : copie locale, restauration, diagnostic ─────────────

export function SessionGuard({ hasProfile, loading }: { hasProfile: boolean; loading: boolean }) {
  const [state, setState] = useState<"idle" | "restoring" | "lost">("idle");

  useEffect(() => {
    if (loading) return;
    if (hasProfile) {
      lsSet(LS_MARK, "1");
      return;
    }
    const token = lsGet(LS_TOKEN);
    const wasPaired = !!lsGet(LS_MARK) || !!token;
    if (token) {
      queueMicrotask(() => setState("restoring"));
      postJson("/api/artist/recover", { token }).then(({ ok }) => {
        if (ok) { window.location.reload(); return; }
        lsDel(LS_TOKEN);   // révoqué ou périmé : ne pas réessayer en boucle
        setState("lost");
      }).catch(() => setState("lost"));
    } else if (wasPaired) {
      queueMicrotask(() => setState("lost"));
    }
    if (wasPaired) {
      // Diagnostic anonyme, une fois par session de navigation : « ce navigateur se souvenait d'un appairage et revient sans cookie ».
      let sent = false;
      try { sent = !!sessionStorage.getItem("pod_lost_reported"); sessionStorage.setItem("pod_lost_reported", "1"); } catch { /* ignoré */ }
      if (!sent) fetch("/api/artist/session-lost", { method: "POST" }).catch(() => {});
    }
  }, [hasProfile, loading]);

  if (state === "idle") return null;
  if (state === "restoring") return <div role="status" style={{ ...box, marginBottom: "1.5rem", color: "var(--text2)", fontSize: "0.85rem" }}>Récupération de votre accès…</div>;
  return (
    <div style={{ marginBottom: "1.5rem", display: "flex", flexDirection: "column", gap: "0.8rem" }}>
      <div role="alert" style={{ ...box, borderColor: "rgba(251,146,60,0.5)" }}>
        <div style={{ fontWeight: 700, fontSize: "0.95rem", marginBottom: 4 }}>Ce navigateur a perdu le lien avec vos écrans</div>
        <p style={small}>
          Vos écrans et vos blocs ne sont pas perdus : ils sont enregistrés sur le réseau. Ce navigateur a simplement oublié qu&apos;il y avait accès
          (navigation privée, données du site effacées, autre navigateur ou nouveau téléphone). Retrouvez-les ci-dessous.
        </p>
      </div>
      <RecoverAccess />
    </div>
  );
}
