"use client";
// Page « Créer » : choisir où dessiner. Trois états explicites par liste (chargement / erreur réseau / vide) ; hors ligne = pastille, jamais confondu avec « vide ».
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { mineTargets, sharedTargets, type DrawTarget, type LoadState, type OwnedLike, type PublicLike } from "@/lib/drawTargets";
import { fetchList } from "./fetchList";

const card: React.CSSProperties = { border: "1px solid var(--border)", borderRadius: 14, background: "var(--bg2)", padding: "1.1rem 1.25rem" };
const muted: React.CSSProperties = { color: "var(--text3)", fontSize: "0.85rem", margin: 0 };

function TargetRow({ t }: { t: DrawTarget }) {
  const dev = encodeURIComponent(t.deviceId);
  return (
    <div style={{ ...card, padding: "0.85rem 1rem", display: "flex", flexDirection: "column", gap: "0.7rem" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", minWidth: 0 }}>
        <span aria-hidden style={{ width: 9, height: 9, borderRadius: "50%", flexShrink: 0, background: t.online ? "#4ade80" : "var(--text3)" }} />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 700, overflowWrap: "anywhere" }}>{t.label}</div>
          <div style={{ fontSize: "0.72rem", color: "var(--text3)" }}>{t.online ? "en ligne" : "hors ligne : l'œuvre attendra son retour"}</div>
        </div>
      </div>
      {t.screens.map((s) => (
        <div key={s.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.6rem", flexWrap: "wrap" }}>
          <span style={{ fontSize: "0.85rem", color: "var(--text2)", overflowWrap: "anywhere" }}>{s.name}</span>
          <span style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
            <Link href={`/draw/${dev}/${s.id}`} className="pod-btn pod-btn--primary" style={{ textDecoration: "none" }}>✏️ Dessiner</Link>
            {s.canAnimate && <Link href={`/animer?device=${dev}&screen=${s.id}`} className="pod-btn" style={{ textDecoration: "none" }}>🎞 Animer</Link>}
          </span>
        </div>
      ))}
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
    <div className="pod-page pod-page--narrow" style={{ display: "flex", flexDirection: "column", gap: "1.75rem" }}>
      <header>
        <h1 style={{ margin: "0 0 0.4rem", fontSize: "1.7rem" }}>Créer une œuvre</h1>
        <p style={{ margin: 0, color: "var(--text2)" }}>Choisis l’écran sur lequel ton œuvre sera validée par le réseau, puis affichée. <b>Dessiner</b> crée une image fixe ; <b>Animer</b> compose plusieurs images (disponible sur les écrans capables de les jouer).</p>
      </header>

      <section aria-labelledby="mine-h" style={{ display: "flex", flexDirection: "column", gap: "0.7rem" }}>
        <h2 id="mine-h" style={{ margin: 0, fontSize: "1.1rem" }}>Créer sur mes écrans</h2>
        <ListBlock state={owned} retry={loadOwned} targets={mine} empty={
          <>
            <p style={{ margin: "0 0 0.5rem", color: "var(--text2)" }}>Tu n’as pas encore d’écran relié à ce navigateur.</p>
            <p style={muted}>
              <Link href="/onboard" style={{ color: "var(--accent)" }}>Associer un appareil</Link> avec le code affiché dessus, ou
              {" "}<Link href="/learn?path=install#installer" style={{ color: "var(--accent)" }}>installer un appareil</Link>.
              Déjà un profil sur un autre appareil ? Utilise « Autoriser un autre équipement » dans <Link href="/profile" style={{ color: "var(--accent)" }}>Mon espace</Link>.
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
