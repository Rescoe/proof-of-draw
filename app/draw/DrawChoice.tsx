"use client";
// Page « Créer » : choisir où dessiner. Trois états explicites par liste (chargement / erreur réseau / vide) ; hors ligne = pastille, jamais confondu avec « vide ».
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  classifyList, mineTargets, sharedTargets, NETWORK_ERROR_MESSAGE,
  type DrawTarget, type LoadState, type OwnedLike, type PublicLike,
} from "@/lib/drawTargets";

async function fetchList<T>(url: string, field: string): Promise<LoadState<T[]>> {
  try {
    const res = await fetch(url, { cache: "no-store" });
    let body: unknown = null;
    try { body = await res.json(); } catch { /* corps illisible : classifyList le traite en erreur */ }
    return classifyList<T>(res.ok, res.status, body, field);
  } catch {
    return { kind: "error", message: NETWORK_ERROR_MESSAGE };
  }
}

const card: React.CSSProperties = { border: "1px solid var(--border)", borderRadius: 14, background: "var(--bg2)", padding: "1.1rem 1.25rem" };
const muted: React.CSSProperties = { color: "var(--text3)", fontSize: "0.85rem", margin: 0 };

function TargetRow({ t }: { t: DrawTarget }) {
  return (
    <div style={{ ...card, padding: "0.85rem 1rem", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.75rem", flexWrap: "wrap" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", minWidth: 0 }}>
        <span aria-hidden style={{ width: 9, height: 9, borderRadius: "50%", flexShrink: 0, background: t.online ? "#4ade80" : "var(--text3)" }} />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 700, overflowWrap: "anywhere" }}>{t.label}</div>
          <div style={{ fontSize: "0.72rem", color: "var(--text3)" }}>{t.online ? "en ligne" : "hors ligne : l'œuvre attendra son retour"}</div>
        </div>
      </div>
      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
        {t.screens.map((s) => (
          <Link key={s.id} href={`/draw/${encodeURIComponent(t.deviceId)}/${s.id}`}
            style={{ padding: "0.5rem 1rem", minHeight: 40, display: "inline-flex", alignItems: "center", borderRadius: 8, background: "var(--accent)", color: "#fff", textDecoration: "none", fontWeight: 600, fontSize: "0.85rem" }}>
            ✏️ {s.name}
          </Link>
        ))}
      </div>
    </div>
  );
}

function ListBlock({ state, empty, retry, targets }: { state: LoadState<unknown>; empty: React.ReactNode; retry: () => void; targets: DrawTarget[] }) {
  if (state.kind === "loading") return <p style={muted} role="status">Chargement…</p>;
  if (state.kind === "error") {
    return (
      <div role="alert" style={{ ...card, borderColor: "#f87171" }}>
        <p style={{ margin: "0 0 0.6rem", color: "var(--text2)" }}>{state.message}</p>
        <button type="button" onClick={retry} style={{ padding: "0.45rem 1rem", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)", cursor: "pointer" }}>Réessayer</button>
      </div>
    );
  }
  if (targets.length === 0) return <div style={{ ...card, borderStyle: "dashed" }}>{empty}</div>;
  return <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>{targets.map((t) => <TargetRow key={t.deviceId} t={t} />)}</div>;
}

export function DrawChoice() {
  const [owned, setOwned] = useState<LoadState<OwnedLike[]>>({ kind: "loading" });
  const [pub, setPub] = useState<LoadState<PublicLike[]>>({ kind: "loading" });
  const loadOwned = useCallback(() => { setOwned({ kind: "loading" }); void fetchList<OwnedLike>("/api/devices?mine=1", "devices").then(setOwned); }, []);
  const loadPub = useCallback(() => { setPub({ kind: "loading" }); void fetchList<PublicLike>("/api/public-screens", "devices").then(setPub); }, []);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- chargement initial des deux listes
  useEffect(() => { loadOwned(); loadPub(); }, [loadOwned, loadPub]);

  const mine = owned.kind === "ready" ? mineTargets(owned.data) : [];
  const shared = pub.kind === "ready" ? sharedTargets(pub.data, owned.kind === "ready" ? owned.data.map((d) => d.deviceId) : []) : [];

  return (
    <div style={{ maxWidth: 760, margin: "0 auto", padding: "1.5rem 0 3rem", display: "flex", flexDirection: "column", gap: "1.75rem" }}>
      <header>
        <h1 style={{ margin: "0 0 0.4rem", fontSize: "1.7rem" }}>Créer une œuvre</h1>
        <p style={{ margin: 0, color: "var(--text2)" }}>Choisis l’écran sur lequel ton dessin sera validé par le réseau, puis affiché.</p>
      </header>

      <section aria-labelledby="mine-h" style={{ display: "flex", flexDirection: "column", gap: "0.7rem" }}>
        <h2 id="mine-h" style={{ margin: 0, fontSize: "1.1rem" }}>Dessiner sur mes écrans</h2>
        <ListBlock state={owned} retry={loadOwned} targets={mine} empty={
          <>
            <p style={{ margin: "0 0 0.5rem", color: "var(--text2)" }}>Tu n’as pas encore d’écran relié à ce navigateur.</p>
            <p style={muted}>
              <Link href="/onboard" style={{ color: "var(--accent)" }}>Connecter mon écran</Link> avec le code affiché dessus, ou
              {" "}<Link href="/learn?path=install#installer" style={{ color: "var(--accent)" }}>installer un écran</Link>.
              Déjà un profil sur un autre appareil ? Utilise « Autoriser un autre équipement » dans <Link href="/profile" style={{ color: "var(--accent)" }}>Mes écrans</Link>.
            </p>
          </>
        } />
      </section>

      <section aria-labelledby="shared-h" style={{ display: "flex", flexDirection: "column", gap: "0.7rem" }}>
        <h2 id="shared-h" style={{ margin: 0, fontSize: "1.1rem" }}>Dessiner sur un écran partagé</h2>
        <p style={muted}>Des artistes prêtent leurs écrans : tu n’as pas besoin de matériel pour participer.</p>
        <ListBlock state={pub} retry={loadPub} targets={shared} empty={
          <>
            <p style={{ margin: "0 0 0.5rem", color: "var(--text2)" }}>Aucun écran n’est partagé pour le moment.</p>
            <p style={muted}>
              Reviens plus tard, ou <Link href="/gallery" style={{ color: "var(--accent)" }}>découvre les œuvres déjà affichées</Link>.
              Tu peux aussi <Link href="/learn?path=no-esp#sans-esp" style={{ color: "var(--accent)" }}>voir comment participer sans matériel</Link>.
            </p>
          </>
        } />
      </section>
    </div>
  );
}
