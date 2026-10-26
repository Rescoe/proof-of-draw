// scripts/smoke-circles.mjs — smoke test RÉEL des cercles privés (Upstash) avec DEUX profils et un non-membre. Ne touche qu'aux routes /api/circles (+ GET /api/artist pour l'identifiant du 2e profil).
// Usage : COOKIE_A='esp_session=…' COOKIE_B='esp_session=…' [COOKIE_C='esp_session=…'] node scripts/smoke-circles.mjs https://proof-of-draw.vercel.app
//   A = propriétaire, B = invité (autre profil), C = non-membre (facultatif ; sinon une requête SANS cookie vérifie seulement le 401).
// Les cookies viennent de l'environnement et ne sont JAMAIS affichés. Le script supprime son propre cercle à la fin (aucun nettoyage global, aucun FLUSH).
const base = (process.argv[2] ?? "").replace(/\/$/, "");
const { COOKIE_A, COOKIE_B, COOKIE_C } = process.env;
if (!base || !COOKIE_A || !COOKIE_B) { console.error("usage : COOKIE_A=… COOKIE_B=… [COOKIE_C=…] node scripts/smoke-circles.mjs <url>"); process.exit(2); }

let failures = 0;
const ok = (cond, label, extra = "") => { console.log(`${cond ? "✓" : "✗"} ${label}${extra ? ` — ${extra}` : ""}`); if (!cond) failures++; };
async function call(cookie, method, path, body) {
  const r = await fetch(base + path, { method, headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  let j = {}; try { j = await r.json(); } catch {}
  return { status: r.status, body: j };
}

(async () => {
  const profB = await call(COOKIE_B, "GET", "/api/artist");
  const idB = profB.body?.profile?.artistId;
  ok(!!idB, "profil B lisible (artistId)", idB ? "" : "GET /api/artist sans profil");
  if (!idB) process.exit(1);

  const name = `smoke-${Date.now().toString(36)}`;
  const created = await call(COOKIE_A, "POST", "/api/circles", { name });
  const id = created.body?.circle?.id;
  ok(created.status === 201 && /^[0-9a-f]{20}$/.test(id ?? ""), "A crée le cercle", `id ${id ?? "?"}`);
  if (!id) process.exit(1);
  try {
    const inv = await call(COOKIE_A, "POST", `/api/circles/${id}/invite`, { artistId: idB });
    ok(inv.status === 201, "A invite B", `statut ${inv.status}`);
    const before = await call(COOKIE_B, "GET", `/api/circles/${id}`);
    ok(before.status === 404, "B n'est PAS membre avant d'accepter (404)");
    const mine = await call(COOKIE_B, "GET", "/api/circles");
    ok(mine.body?.invites?.some((i) => i.circleId === id), "B voit l'invitation reçue");
    const acc = await call(COOKIE_B, "POST", `/api/circles/${id}/respond`, { accept: true });
    ok(acc.status === 200, "B accepte lui-même", `statut ${acc.status}`);
    const view = await call(COOKIE_A, "GET", `/api/circles/${id}`);
    ok(view.body?.circle?.members?.length === 2, "A voit 2 membres");
    const msg = await call(COOKIE_B, "POST", `/api/circles/${id}/messages`, { text: "bonjour (smoke test)" });
    ok(msg.status === 201, "B publie un message");
    const list = await call(COOKIE_A, "GET", `/api/circles/${id}/messages`);
    ok(list.body?.messages?.some((m) => m.text.startsWith("bonjour")), "A lit le message de B");

    // non-membre : MÊME réponse qu'un cercle inexistant
    const ghost = "f".repeat(20);
    const outsider = COOKIE_C ?? "";
    const real = await call(outsider, "GET", `/api/circles/${id}`);
    const none = await call(outsider, "GET", `/api/circles/${ghost}`);
    if (COOKIE_C) ok(real.status === 404 && JSON.stringify(real.body) === JSON.stringify(none.body), "non-membre : 404 identique à un cercle inexistant");
    else ok(real.status === 401, "sans cookie : 401 (fournir COOKIE_C pour le test de non-membre)");
    if (COOKIE_C) {
      const m = await call(COOKIE_C, "GET", `/api/circles/${id}/messages`);
      ok(m.status === 404, "non-membre ne lit pas les messages (404)");
    }

    const left = await call(COOKIE_B, "POST", `/api/circles/${id}/leave`);
    ok(left.status === 200, "B quitte le cercle");
    const after = await call(COOKIE_B, "GET", `/api/circles/${id}`);
    ok(after.status === 404, "B n'a plus accès (404)");
  } finally {
    const del = await call(COOKIE_A, "DELETE", `/api/circles/${id}`, { confirmName: name });
    ok(del.status === 200, "A supprime le cercle de test");
    const gone = await call(COOKIE_A, "GET", `/api/circles/${id}`);
    ok(gone.status === 404, "le cercle n'existe plus (404)");
    const minea = await call(COOKIE_A, "GET", "/api/circles");
    ok(!minea.body?.circles?.some((c) => c.id === id), "retiré de la liste de A");
  }
  console.log(failures ? `\n${failures} échec(s)` : "\nTout est passé. Vérifier ensuite les clés Redis (docs/SMOKE_TEST_CERCLES_UPSTASH.md).");
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error("erreur :", e.message); process.exit(2); });
