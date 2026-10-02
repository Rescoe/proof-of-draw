// tests/linkCode.test.ts — code d'appairage (format, aléa, saisie) et droit de contrôle d'un ESP par un navigateur appairé.
import test from "node:test";
import assert from "node:assert/strict";
import { generateLinkCode, normalizeLinkCode, canControlDevice, LINK_CODE_ALPHABET } from "../lib/linkCode";

test("format XXXX-XXXX, alphabet sans caractères ambigus (I, O, 0, 1)", () => {
  for (let i = 0; i < 200; i++) {
    const code = generateLinkCode();
    assert.match(code, /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
  }
  assert.equal(LINK_CODE_ALPHABET.length, 32);
  assert.ok(!/[IO01]/.test(LINK_CODE_ALPHABET));
});

test("aléa cryptographique : deux codes consécutifs diffèrent, aucun doublon sur 2000 tirages", () => {
  const seen = new Set<string>();
  for (let i = 0; i < 2000; i++) seen.add(generateLinkCode());
  assert.equal(seen.size, 2000);
});

test("aucun biais de modulo : les 256 valeurs d'octet se répartissent exactement 8 par caractère", () => {
  const counts = new Map<string, number>();
  for (let v = 0; v < 256; v++) {
    const code = generateLinkCode(() => new Uint8Array(8).fill(v));
    const ch = code[0];
    counts.set(ch, (counts.get(ch) ?? 0) + 1);
  }
  assert.equal(counts.size, 32);
  assert.ok([...counts.values()].every((n) => n === 8));
});

test("l'aléa est injectable et le mapping déterministe", () => {
  assert.equal(generateLinkCode(() => Uint8Array.from([0, 1, 2, 3, 4, 5, 6, 7])), "ABCD-EFGH");
  assert.equal(generateLinkCode(() => Uint8Array.from([31, 31, 31, 31, 32, 32, 32, 32])), "9999-AAAA");
});

test("saisie : tolère minuscules, espaces et tiret absent ; refuse tout le reste", () => {
  assert.equal(normalizeLinkCode("abcd-efgh"), "ABCD-EFGH");
  assert.equal(normalizeLinkCode("abcdefgh"), "ABCD-EFGH");
  assert.equal(normalizeLinkCode("  ab cd - ef gh "), "ABCD-EFGH");
  for (const bad of ["", "ABCD", "ABCD-EFG", "ABCD-EFGHI", "ABCD-EFG0", "ABCD-EFGI", "ÀBCD-EFGH", "ABCD_EFGH", null, undefined, 12345678, {}, []]) {
    assert.equal(normalizeLinkCode(bad), null, JSON.stringify(bad));
  }
});

test("un code généré passe toujours la normalisation (aller-retour)", () => {
  for (let i = 0; i < 100; i++) {
    const code = generateLinkCode();
    assert.equal(normalizeLinkCode(code), code);
    assert.equal(normalizeLinkCode(code.toLowerCase().replace("-", "")), code);
  }
});

test("droits : cookie historique, OU profil porté par le cookie auquel l'ESP est rattaché", () => {
  const phone = { deviceIds: ["dev_AAAA1111"], artistId: "artist_1" };
  const pc    = { deviceIds: [], artistId: "artist_1" };           // PC appairé : cookie sans ESP, mais le profil
  const stranger = { deviceIds: [], artistId: "artist_2" };

  assert.equal(canControlDevice(phone, "dev_AAAA1111", "artist_1"), true, "ESP du cookie");
  assert.equal(canControlDevice(pc, "dev_AAAA1111", "artist_1"), true, "PC appairé : ESP du profil");
  assert.equal(canControlDevice(pc, "dev_NEW00001", "artist_1"), true, "ESP ajouté APRÈS l'appairage depuis le téléphone");
  assert.equal(canControlDevice(stranger, "dev_AAAA1111", "artist_1"), false, "autre profil : refusé");
  assert.equal(canControlDevice(pc, "dev_FREE0001", null), false, "ESP sans profil : refusé");
  assert.equal(canControlDevice({ deviceIds: [] }, "dev_AAAA1111", "artist_1"), false, "aucun profil dans le cookie");
});

test("droits : un ESP détaché du profil (don) n'est plus contrôlable via le profil", () => {
  const pc = { deviceIds: [], artistId: "artist_1" };
  assert.equal(canControlDevice(pc, "dev_GIVEN001", "artist_1"), true);
  assert.equal(canControlDevice(pc, "dev_GIVEN001", null), false, "plus de lien inverse → plus de droit");
  assert.equal(canControlDevice(pc, "dev_GIVEN001", "artist_9"), false, "rattaché à un autre profil → refusé");
});
