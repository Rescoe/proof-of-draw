"use client";
// Bouton « Remix » / « Reprendre » : choisir l'écran (du même type que l'œuvre d'origine) puis ouvrir le studio existant avec le point de départ demandé.
// Aucune requête tant que le panneau est fermé ; à l'ouverture : les deux listes déjà lues par /draw (mes écrans, écrans partagés). Échec = message + « Réessayer », jamais « aucun écran ».
import { useCallback, useState } from "react";
import Link from "next/link";
import { mineTargets, sharedTargets, type DrawTarget, type LoadState, type OwnedLike, type PublicLike } from "@/lib/drawTargets";
import { SCREEN_PROFILES, type ScreenId } from "@/lib/screenProfiles";
import { fetchList } from "./draw/fetchList";

export interface DrawLauncherProps {
  /** type d'écran de l'œuvre d'origine : on ne propose que des écrans de ce type */
  screen: ScreenId;
  param: "remix" | "resume";
  value: string;
  label: string;
  hint?: string;
}

const btn: React.CSSProperties = { padding: "0.45rem 0.9rem", minHeight: 40, borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg2)", color: "var(--text)", cursor: "pointer", fontWeight: 600, fontSize: "0.85rem" };

export function DrawLauncher({ screen, param, value, label, hint }: DrawLauncherProps) {
  const [open, setOpen] = useState(false);
  const [owned, setOwned] = useState<LoadState<OwnedLike[]>>({ kind: "loading" });
  const [pub, setPub] = useState<LoadState<PublicLike[]>>({ kind: "loading" });
  const load = useCallback(() => {
    setOwned({ kind: "loading" }); setPub({ kind: "loading" });
    void fetchList<OwnedLike>("/api/devices?mine=1", "devices").then(setOwned);
    void fetchList<PublicLike>("/api/public-screens", "devices").then(setPub);
  }, []);
  const toggle = () => { const next = !open; setOpen(next); if (next) load(); };

  const ofType = (list: DrawTarget[]) => list.filter((t) => t.screens.some((s) => s.id === screen));
  const mine = owned.kind === "ready" ? ofType(mineTargets(owned.data)) : [];
  const shared = pub.kind === "ready" ? ofType(sharedTargets(pub.data, owned.kind === "ready" ? owned.data.map((d) => d.deviceId) : [])) : [];
  const href = (t: DrawTarget) => `/draw/${encodeURIComponent(t.deviceId)}/${screen}?${param}=${encodeURIComponent(value)}`;
  const row = (t: DrawTarget) => (
    <Link key={t.deviceId} href={href(t)} style={{ ...btn, display: "inline-flex", alignItems: "center", gap: 8, textDecoration: "none", background: "var(--accent)", color: "#fff", borderColor: "transparent" }}>
      <span aria-hidden style={{ width: 8, height: 8, borderRadius: "50%", background: t.online ? "#4ade80" : "rgba(255,255,255,0.45)" }} />{t.label}{t.online ? "" : " (hors ligne)"}
    </Link>
  );
  const loading = owned.kind === "loading" || pub.kind === "loading";
  const failed = [owned, pub].find((s) => s.kind === "error") as { kind: "error"; message: string } | undefined;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <button type="button" style={btn} aria-expanded={open} onClick={toggle}>{label}</button>
      {open && (
        <div role="region" aria-label="Choisir l'écran" style={{ border: "1px solid var(--border)", borderRadius: 12, padding: "0.8rem", background: "var(--bg)", display: "flex", flexDirection: "column", gap: 8 }}>
          {hint && <p style={{ margin: 0, color: "var(--text3)", fontSize: "0.8rem" }}>{hint}</p>}
          <p style={{ margin: 0, color: "var(--text2)", fontSize: "0.82rem" }}>Choisis un écran <b>{SCREEN_PROFILES[screen].name}</b> :</p>
          {loading && <p role="status" style={{ margin: 0, color: "var(--text3)", fontSize: "0.82rem" }}>Chargement…</p>}
          {failed && (
            <div role="alert" style={{ color: "var(--text2)", fontSize: "0.82rem" }}>{failed.message} <button type="button" style={{ ...btn, minHeight: 32, padding: "0.2rem 0.7rem" }} onClick={load}>Réessayer</button></div>
          )}
          {!loading && mine.length > 0 && <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>{mine.map(row)}</div>}
          {!loading && shared.length > 0 && (
            <>
              <p style={{ margin: "4px 0 0", color: "var(--text3)", fontSize: "0.75rem" }}>Écrans partagés par d’autres artistes</p>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>{shared.map(row)}</div>
            </>
          )}
          {!loading && !failed && mine.length === 0 && shared.length === 0 && (
            <p style={{ margin: 0, color: "var(--text2)", fontSize: "0.82rem" }}>
              Aucun écran {SCREEN_PROFILES[screen].name} n’est disponible pour toi pour le moment. <Link href="/draw" style={{ color: "var(--accent)" }}>Voir tous les écrans</Link> ou <Link href="/onboard" style={{ color: "var(--accent)" }}>connecter mon écran</Link>.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
