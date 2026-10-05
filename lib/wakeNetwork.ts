// lib/wakeNetwork.ts — côté navigateur : prévient le serveur qu'on ouvre l'atelier (POST /api/hot), au plus une fois par 10 min et par onglet.
// Les écrans au repos passent alors de 15 à 5 min de pull : ils verront le dessin plus vite. Jamais bloquant, jamais d'erreur visible.

export function wakeNetwork(): void {
  try {
    const KEY = "pod-wake-at";
    const last = Number(sessionStorage.getItem(KEY) ?? 0);
    if (Date.now() - last < 10 * 60_000) return;
    sessionStorage.setItem(KEY, String(Date.now()));
    void fetch("/api/hot", { method: "POST", keepalive: true }).catch(() => {});
  } catch { /* stockage indisponible : on réessaiera à la prochaine ouverture */ }
}
