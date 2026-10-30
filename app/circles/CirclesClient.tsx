"use client";
// Cercles privés : liste, invitations (accepter / refuser), création, et un cercle ouvert (membres, invitations en attente, messages texte).
// Toute la sécurité est CÔTÉ SERVEUR (lib/circles.ts) : cette interface ne fait que montrer ce que le serveur autorise. Aucun sondage : on recharge sur action ou sur « Actualiser ».
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";

interface Summary { id: string; name: string; ownerName: string; isOwner: boolean; memberCount: number }
interface SystemView { id: string; name: string; description: string; href: string; member: boolean }
interface Invite { circleId: string; circleName: string; fromName: string; at: number }
interface View { id: string; name: string; ownerId: string; isOwner: boolean; members: { artistId: string; name: string; isOwner: boolean }[]; pending: { artistId: string; name: string; at: number }[] | null }
interface Msg { id: string; at: number; authorId: string; authorName: string; text: string }
interface ArtistRow { artistId: string; displayName: string; implicit?: boolean }

type Res<T> = { ok: true; data: T } | { ok: false; status: number; code?: string; error: string };
async function api<T = Record<string, unknown>>(method: string, url: string, body?: unknown): Promise<Res<T>> {
  try {
    const r = await fetch(url, { method, cache: "no-store", headers: body !== undefined ? { "Content-Type": "application/json" } : undefined, body: body !== undefined ? JSON.stringify(body) : undefined });
    let j: Record<string, unknown> = {};
    try { j = await r.json(); } catch { /* corps illisible */ }
    if (!r.ok) return { ok: false, status: r.status, code: typeof j.code === "string" ? j.code : undefined, error: typeof j.error === "string" ? j.error : `Erreur ${r.status}` };
    return { ok: true, data: j as T };
  } catch { return { ok: false, status: 0, error: "Connexion impossible : vérifie ton réseau puis réessaie." }; }
}

const card: React.CSSProperties = { border: "1px solid var(--border)", borderRadius: 14, background: "var(--bg2)", padding: "1rem 1.1rem" };
const btn = (primary = false, danger = false): React.CSSProperties => ({ padding: "0.45rem 0.95rem", minHeight: 38, borderRadius: 8, cursor: "pointer", fontWeight: 600, fontSize: "0.85rem",
  border: `1px solid ${danger ? "rgba(248,113,113,0.5)" : primary ? "transparent" : "var(--border)"}`, background: primary ? "var(--accent)" : "var(--bg)", color: danger ? "#f87171" : primary ? "#fff" : "var(--text)" });
const muted: React.CSSProperties = { color: "var(--text3)", fontSize: "0.82rem", margin: 0 };
const input: React.CSSProperties = { padding: "0.55rem 0.8rem", minHeight: 40, borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)", fontSize: "0.9rem", width: "100%" };
const when = (t: number) => new Date(t).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

export function CirclesClient() {
  const [state, setState] = useState<"loading" | "error" | "noprofile" | "ready">("loading");
  const [error, setError] = useState("");
  const [circles, setCircles] = useState<Summary[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [system, setSystem] = useState<SystemView[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const r = await api<{ circles: Summary[]; invites: Invite[]; system?: SystemView[] }>("GET", "/api/circles");
    if (r.ok) { setCircles(r.data.circles); setInvites(r.data.invites); setSystem(r.data.system ?? []); setState("ready"); return; }
    if (r.status === 401 && r.code === "no_profile") { setState("noprofile"); return; }
    setError(r.error); setState("error");
  }, []);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- chargement initial
  useEffect(() => { void load(); }, [load]);

  const say = (kind: "ok" | "err", text: string) => setNotice({ kind, text });
  async function act(fn: () => Promise<Res<unknown>>, okText?: string) {
    setBusy(true);
    const r = await fn();
    setBusy(false);
    if (!r.ok) { say("err", r.error); return false; }
    if (okText) say("ok", okText);
    await load();
    return true;
  }

  if (state === "loading") return <p role="status" style={{ ...muted, padding: "2rem 0" }}>Chargement…</p>;
  if (state === "noprofile") return (
    <div style={{ maxWidth: 620, margin: "2rem auto", ...card }}>
      <h1 style={{ margin: "0 0 0.5rem", fontSize: "1.4rem" }}>Cercles privés</h1>
      <p style={{ color: "var(--text2)" }}>Les cercles sont réservés aux artistes qui ont un profil. Connecte d’abord un écran : ton profil est créé avec lui.</p>
      <Link href="/onboard" style={{ color: "var(--accent)" }}>Associer un appareil →</Link>
    </div>
  );
  if (state === "error") return (
    <div role="alert" style={{ maxWidth: 620, margin: "2rem auto", ...card, borderColor: "#f87171" }}>
      <p style={{ margin: "0 0 0.7rem", color: "var(--text2)" }}>{error}</p>
      <button type="button" style={btn()} onClick={() => { setState("loading"); void load(); }}>Réessayer</button>
    </div>
  );

  return (
    <div className="pod-page" style={{ maxWidth: 820, display: "flex", flexDirection: "column", gap: "1.4rem" }}>
      <header>
        <h1 style={{ margin: "0 0 0.4rem", fontSize: "1.7rem" }}>Cercles privés</h1>
        <p style={{ margin: 0, color: "var(--text2)", lineHeight: 1.6 }}>
          Un cercle réunit quelques artistes. On n’y entre que sur invitation <b>acceptée</b> ; ce qui s’y dit n’apparaît ni dans la galerie, ni sur la carte, ni dans les recherches, et n’entre dans aucun bloc.
          Pour l’instant : messages texte courts. Le partage d’images arrivera avec un stockage privé dédié.
        </p>
      </header>

      {notice && <div role={notice.kind === "err" ? "alert" : "status"} style={{ ...card, borderColor: notice.kind === "err" ? "#f87171" : "#4ade80", display: "flex", justifyContent: "space-between", gap: 8 }}>
        <span>{notice.text}</span><button type="button" style={btn()} onClick={() => setNotice(null)} aria-label="Fermer">✕</button></div>}

      {invites.length > 0 && (
        <section aria-labelledby="inv-h" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <h2 id="inv-h" style={{ margin: 0, fontSize: "1.1rem" }}>Invitations reçues</h2>
          {invites.map((i) => (
            <div key={i.circleId} style={{ ...card, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <div><b>{i.circleName}</b><p style={muted}>{i.fromName} t’invite · {when(i.at)}</p></div>
              <div style={{ display: "flex", gap: 8 }}>
                <button type="button" disabled={busy} style={btn(true)} onClick={() => act(() => api("POST", `/api/circles/${i.circleId}/respond`, { accept: true }), `Tu as rejoint « ${i.circleName} ».`)}>Accepter</button>
                <button type="button" disabled={busy} style={btn()} onClick={() => act(() => api("POST", `/api/circles/${i.circleId}/respond`, { accept: false }), "Invitation refusée.")}>Refuser</button>
              </div>
            </div>
          ))}
        </section>
      )}

      {system.length > 0 && (
        <section aria-labelledby="net-h" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <h2 id="net-h" style={{ margin: 0, fontSize: "1.1rem" }}>Cercles du réseau</h2>
          {system.map((c) => (
            <div key={c.id} style={{ ...card, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <div style={{ minWidth: 0, flex: "1 1 240px" }}>
                <b>{c.name}</b> <span style={{ ...muted, color: c.member ? "var(--accent)" : undefined }}>· {c.member ? "tu en fais partie" : "tu l’as quitté"}</span>
                <p style={muted}>{c.description}</p>
                {c.member && <p style={muted}><Link href={c.href} style={{ color: "var(--accent)" }}>Voir les créations →</Link></p>}
              </div>
              <button type="button" disabled={busy} style={btn(!c.member)} onClick={() => act(() => api("POST", "/api/circles/system", { id: c.id, member: !c.member }), c.member ? `Tu as quitté « ${c.name} ».` : `Tu as rejoint « ${c.name} ».`)}>{c.member ? "Quitter" : "Rejoindre"}</button>
            </div>
          ))}
        </section>
      )}

      <section aria-labelledby="mine-h" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <h2 id="mine-h" style={{ margin: 0, fontSize: "1.1rem" }}>Mes cercles</h2>
        {circles.length === 0 && <div style={{ ...card, borderStyle: "dashed" }}><p style={muted}>Tu n’es dans aucun cercle pour le moment : crée le tien ci-dessous, ou attends une invitation.</p></div>}
        {circles.map((c) => (
          <button key={c.id} type="button" onClick={() => setOpenId(openId === c.id ? null : c.id)} aria-expanded={openId === c.id}
            style={{ ...card, textAlign: "left", cursor: "pointer", color: "var(--text)", borderColor: openId === c.id ? "var(--accent)" : "var(--border)", display: "flex", justifyContent: "space-between", gap: 10 }}>
            <span><b>{c.name}</b> {c.isOwner && <span style={{ ...muted, color: "var(--accent)" }}>· propriétaire</span>}<br /><span style={muted}>{c.memberCount} membre{c.memberCount > 1 ? "s" : ""}{!c.isOwner ? ` · par ${c.ownerName}` : ""}</span></span>
            <span aria-hidden>{openId === c.id ? "▾" : "▸"}</span>
          </button>
        ))}
        {openId && circles.some((c) => c.id === openId) && (
          <CirclePanel key={openId} id={openId} say={say} onChanged={load} onClosed={() => setOpenId(null)} />
        )}
        <form onSubmit={(e) => { e.preventDefault(); if (!name.trim()) return; void act(() => api("POST", "/api/circles", { name }), "Cercle créé.").then((ok) => { if (ok) setName(""); }); }} style={{ ...card, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <label htmlFor="new-circle" style={{ ...muted, flexBasis: "100%" }}>Créer un cercle (2 à 40 caractères ; 5 cercles possédés au plus)</label>
          <input id="new-circle" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} placeholder="Nom du cercle" style={{ ...input, flex: 1, minWidth: 180 }} />
          <button type="submit" disabled={busy || name.trim().length < 2} style={btn(true)}>Créer</button>
        </form>
      </section>
    </div>
  );
}

function CirclePanel({ id, say, onChanged, onClosed }: { id: string; say: (k: "ok" | "err", t: string) => void; onChanged: () => Promise<void>; onClosed: () => void }) {
  const [view, setView] = useState<View | null>(null);
  const [loadErr, setLoadErr] = useState("");
  const [msgs, setMsgs] = useState<Msg[] | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [artists, setArtists] = useState<ArtistRow[] | null>(null);
  const [artistsErr, setArtistsErr] = useState("");
  const [q, setQ] = useState("");
  const [delName, setDelName] = useState("");

  const loadView = useCallback(async () => {
    const r = await api<{ circle: View }>("GET", `/api/circles/${id}`);
    if (r.ok) { setView(r.data.circle); setLoadErr(""); } else setLoadErr(r.error);
  }, [id]);
  const loadMsgs = useCallback(async () => {
    const r = await api<{ messages: Msg[] }>("GET", `/api/circles/${id}/messages`);
    if (r.ok) setMsgs(r.data.messages); else say("err", r.error);
  }, [id, say]);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- chargement à l'ouverture du cercle
  useEffect(() => { void loadView(); void loadMsgs(); }, [loadView, loadMsgs]);

  async function run(fn: () => Promise<Res<unknown>>, okText?: string, after?: () => void) {
    setBusy(true); const r = await fn(); setBusy(false);
    if (!r.ok) { say("err", r.error); return; }
    if (okText) say("ok", okText);
    await loadView(); await onChanged(); after?.();
  }
  async function openInvite() {
    if (artists || artistsErr) return;
    const r = await api<{ artists: ArtistRow[] }>("GET", "/api/artists");
    if (r.ok) setArtists(r.data.artists.filter((a) => !a.implicit)); else setArtistsErr(r.error);
  }
  const candidates = useMemo(() => {
    if (!artists || !view) return [];
    const taken = new Set([...view.members.map((m) => m.artistId), ...(view.pending ?? []).map((p) => p.artistId)]);
    const needle = q.trim().toLowerCase();
    return artists.filter((a) => !taken.has(a.artistId) && (!needle || a.displayName.toLowerCase().includes(needle))).slice(0, 8);
  }, [artists, view, q]);

  if (loadErr) return <div role="alert" style={{ ...card, borderColor: "#f87171" }}><p style={{ margin: "0 0 0.6rem", color: "var(--text2)" }}>{loadErr}</p><button type="button" style={btn()} onClick={() => void loadView()}>Réessayer</button></div>;
  if (!view) return <p role="status" style={muted}>Chargement du cercle…</p>;

  return (
    <div style={{ ...card, display: "flex", flexDirection: "column", gap: "1rem", borderColor: "var(--accent)" }}>
      <div>
        <h3 style={{ margin: "0 0 0.4rem", fontSize: "1rem" }}>Membres ({view.members.length})</h3>
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 6 }}>
          {view.members.map((m) => (
            <li key={m.artistId} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
              <span>{m.name}{m.isOwner ? " 👑" : ""}</span>
              {view.isOwner && !m.isOwner && <button type="button" disabled={busy} style={btn(false, true)} onClick={() => { if (window.confirm(`Retirer ${m.name} du cercle ?`)) void run(() => api("DELETE", `/api/circles/${id}/members`, { artistId: m.artistId }), `${m.name} a été retiré(e).`); }}>Retirer</button>}
            </li>
          ))}
        </ul>
      </div>

      {view.isOwner && (
        <div>
          <h3 style={{ margin: "0 0 0.4rem", fontSize: "1rem" }}>Inviter un artiste</h3>
          {view.pending && view.pending.length > 0 && (
            <ul style={{ listStyle: "none", margin: "0 0 8px", padding: 0, display: "flex", flexDirection: "column", gap: 6 }}>
              {view.pending.map((p) => (
                <li key={p.artistId} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                  <span>{p.name} <span style={muted}>· invitation en attente depuis le {when(p.at)}</span></span>
                  <button type="button" disabled={busy} style={btn()} onClick={() => void run(() => api("DELETE", `/api/circles/${id}/invite`, { artistId: p.artistId }), "Invitation annulée.")}>Annuler</button>
                </li>
              ))}
            </ul>
          )}
          <input value={q} onChange={(e) => setQ(e.target.value)} onFocus={() => void openInvite()} placeholder="Chercher un artiste par nom…" aria-label="Chercher un artiste à inviter" style={input} />
          {artistsErr && <p role="alert" style={{ ...muted, color: "#f87171" }}>{artistsErr} <button type="button" style={btn()} onClick={() => { setArtistsErr(""); void openInvite(); }}>Réessayer</button></p>}
          {artists && candidates.length === 0 && <p style={muted}>Aucun artiste à inviter ne correspond.</p>}
          <ul style={{ listStyle: "none", margin: "6px 0 0", padding: 0, display: "flex", flexDirection: "column", gap: 6 }}>
            {candidates.map((a) => (
              <li key={a.artistId} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                <span>{a.displayName}</span>
                <button type="button" disabled={busy} style={btn(true)} onClick={() => void run(() => api("POST", `/api/circles/${id}/invite`, { artistId: a.artistId }), `Invitation envoyée à ${a.displayName} : elle doit l’accepter.`)}>Inviter</button>
              </li>
            ))}
          </ul>
          <p style={{ ...muted, marginTop: 6 }}>L’invité n’entre dans le cercle que s’il accepte lui-même.</p>
        </div>
      )}

      <div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h3 style={{ margin: 0, fontSize: "1rem" }}>Messages</h3>
          <button type="button" style={btn()} onClick={() => void loadMsgs()}>Actualiser</button>
        </div>
        <form onSubmit={(e) => { e.preventDefault(); if (!text.trim()) return; void run(() => api("POST", `/api/circles/${id}/messages`, { text }), undefined, () => { setText(""); void loadMsgs(); }); }} style={{ display: "flex", gap: 8, margin: "8px 0", flexWrap: "wrap" }}>
          <input value={text} onChange={(e) => setText(e.target.value)} maxLength={280} placeholder="Écrire au cercle (280 caractères)" aria-label="Message" style={{ ...input, flex: "1 1 200px", minWidth: 0 }} />
          <button type="submit" disabled={busy || !text.trim()} style={btn(true)}>Publier</button>
        </form>
        {msgs === null ? <p style={muted}>Chargement…</p> : msgs.length === 0 ? <p style={muted}>Aucun message pour le moment.</p> : (
          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 6 }}>
            {msgs.map((m) => <li key={m.id} style={{ fontSize: "0.88rem" }}><b>{m.authorName}</b> <span style={muted}>{when(m.at)}</span><br /><span style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{m.text}</span></li>)}
          </ul>
        )}
      </div>

      <div style={{ borderTop: "1px solid var(--border)", paddingTop: "0.8rem", display: "flex", flexDirection: "column", gap: 8 }}>
        {!view.isOwner ? (
          <button type="button" disabled={busy} style={{ ...btn(false, true), alignSelf: "flex-start" }} onClick={() => { if (window.confirm(`Quitter le cercle « ${view.name} » ?`)) void run(() => api("POST", `/api/circles/${id}/leave`), "Tu as quitté le cercle.", onClosed); }}>Quitter ce cercle</button>
        ) : (
          <div>
            <p style={muted}>Supprimer le cercle (définitif : membres, invitations et messages disparaissent). Retape son nom pour confirmer.</p>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <input value={delName} onChange={(e) => setDelName(e.target.value)} placeholder={view.name} aria-label="Nom du cercle à retaper" style={{ ...input, flex: 1, minWidth: 160 }} autoComplete="off" />
              <button type="button" disabled={busy || delName.trim() !== view.name} style={btn(false, true)} onClick={() => void run(() => api("DELETE", `/api/circles/${id}`, { confirmName: delName }), "Cercle supprimé.", onClosed)}>Supprimer</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
