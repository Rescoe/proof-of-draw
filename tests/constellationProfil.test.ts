// Constellation : la fiche d'un artiste avec profil renvoie vers sa page publique (profil + capteurs).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("ArtistPanel : lien vers /artists/<id> seulement pour une clé de profil « a: »", () => {
  const s = fs.readFileSync("app/network/ArtistPanel.tsx", "utf8").replace(/\r\n/g, "\n");
  assert.ok(s.includes('artist.artistKey.startsWith("a:")'));
  assert.ok(s.includes("/artists/${encodeURIComponent(artist.artistKey.slice(2))}"));
});
