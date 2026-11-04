"use client";
// app/retrouver/page.tsx — page d'arrivée du lien de récupération (« …/retrouver#k=<clé> »). La clé est dans le FRAGMENT : jamais envoyée au serveur dans l'URL,
// ni dans les journaux, ni dans le Referer. Si elle est présente, l'accès est rétabli tout de suite ; sinon la page propose la saisie (lien, clé ou code d'appairage).

import { useEffect, useState } from "react";
import { RecoverAccess } from "@/app/profile/Recovery";

export default function RetrouverPage() {
  const [state, setState] = useState<"checking" | "ok" | "manual" | "failed">("checking");
  const [name, setName] = useState<string | null>(null);

  useEffect(() => {
    const m = /[#&]k=([A-Za-z0-9._-]+)/.exec(window.location.hash);
    if (!m) { queueMicrotask(() => setState("manual")); return; }
    const token = m[1];
    // On retire la clé de la barre d'adresse (historique, captures d'écran) dès qu'elle est lue.
    try { history.replaceState(null, "", window.location.pathname); } catch { /* ignoré */ }
    fetch("/api/artist/recover", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }) })
      .then(async (r) => {
        const j = await r.json().catch(() => ({}));
        if (r.ok) {
          try { localStorage.setItem("pod_recovery_v1", token); localStorage.setItem("pod_paired_v1", "1"); } catch { /* ignoré */ }
          setName(j?.profile?.displayName ?? null);
          setState("ok");
          setTimeout(() => { window.location.href = "/profile"; }, 1200);
        } else setState("failed");
      })
      .catch(() => setState("failed"));
  }, []);

  return (
    <main style={{ maxWidth: 520, margin: "0 auto", padding: "2rem 16px" }}>
      <h1 style={{ fontSize: "1.4rem", marginBottom: "0.8rem" }}>Retrouver mon accès</h1>
      {state === "checking" && <p style={{ color: "var(--text2)" }}>Vérification du lien…</p>}
      {state === "ok" && <p role="status" style={{ color: "#4ade80" }}>✓ Accès rétabli{name ? ` — profil « ${name} »` : ""}. Redirection vers votre profil…</p>}
      {state === "failed" && <p role="alert" style={{ color: "#f87171", marginBottom: "1rem" }}>Ce lien est invalide ou a été révoqué (un nouveau lien a peut-être été créé depuis). Essayez avec le dernier lien, ou avec le code d&apos;appairage de votre ESP.</p>}
      {(state === "manual" || state === "failed") && <RecoverAccess />}
    </main>
  );
}
