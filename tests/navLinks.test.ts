import test from "node:test";
import assert from "node:assert/strict";
import { MORE_LINKS, PRIMARY_LINKS, isActive, isMoreActive } from "../lib/navLinks";

test("quatre entrées principales, dans l'ordre Créer / Découvrir / Mes écrans / Installer", () => {
  assert.deepEqual(PRIMARY_LINKS.map((l) => l.label), ["Créer", "Découvrir", "Mes écrans", "Installer un écran"]);
});

test("« Onboard » n'apparaît plus côté utilisateur ; « Connecter mon écran » mène toujours à /onboard", () => {
  const all = [...PRIMARY_LINKS, ...MORE_LINKS];
  assert.ok(!all.some((l) => /onboard/i.test(l.label)));
  assert.equal(MORE_LINKS.find((l) => l.label === "Connecter mon écran")?.href, "/onboard");
});

test("aucune destination historique n'est perdue", () => {
  const paths = new Set([...PRIMARY_LINKS, ...MORE_LINKS].map((l) => l.href.split(/[?#]/)[0]));
  for (const p of ["/", "/draw", "/gallery", "/gallery-ana", "/artists", "/learn", "/profile", "/onboard", "/network"]) assert.ok(paths.has(p), p);
});

test("isActive : sous-chemins et préfixes de regroupement", () => {
  const [create, discover, mine, install] = PRIMARY_LINKS;
  assert.ok(isActive(create, "/draw/dev_A/tft28"));
  assert.ok(isActive(create, "/animer"));
  assert.ok(isActive(discover, "/artists/abc"));
  assert.ok(isActive(mine, "/profile"));
  assert.ok(isActive(install, "/learn"));
  assert.ok(!isActive(create, "/drawing"));
});

test("isMoreActive : réseau oui, galerie (principale) non, accueil non", () => {
  assert.equal(isMoreActive("/network"), true);
  assert.equal(isMoreActive("/onboard"), true);
  assert.equal(isMoreActive("/gallery"), false);
  assert.equal(isMoreActive("/"), false);
});
