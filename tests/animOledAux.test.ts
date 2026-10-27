// 29/10/2026 — OLED AUXILIAIRE d'un e-ink BWR 2,9″ : le pointeur d'animation n'est livré QU'À une carte eink29bwr qui a DÉCLARÉ « anim-oled » avec un firmware >= eink29bwr-2.13 ; l'affiche BWR est déduite du clip.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { animOledAuxCapable, animPullMeta, animCapable, supportsAnimPointer } from "../lib/anim/pointer";
import { animOledAuxTargets } from "../lib/anim/targets";
import { posterBwr } from "../lib/anim/block";
import { parseVoteCaps, participatesInVoteNetwork } from "../lib/voteCapability";

const HASH = "a".repeat(64);
const payload = { black: "x", red: "y", anim: { hash: HASH, bytes: 1500, frames: 6 } };
const dev = (over: Record<string, unknown> = {}) => ({ screens: ["eink29bwr"], firmware: "eink29bwr-2.13", caps: ["vote-static-v2", "anim-oled"], ...over });

test("capacité : écran eink29bwr + « anim-oled » déclarée + firmware >= 2.13 — chacune des trois conditions est nécessaire", () => {
  assert.equal(animOledAuxCapable(dev()), true);
  assert.equal(animOledAuxCapable(dev({ firmware: "eink29bwr-2.14" })), true);
  assert.equal(animOledAuxCapable(dev({ firmware: "eink29bwr-3.0" })), true);
  assert.equal(animOledAuxCapable(dev({ firmware: "eink29bwr-2.12" })), false, "2.12 ne sait pas lire le clip");
  assert.equal(animOledAuxCapable(dev({ firmware: "multiscreen-2.8" })), false, "autre famille");
  assert.equal(animOledAuxCapable(dev({ firmware: null })), false);
  assert.equal(animOledAuxCapable(dev({ caps: ["vote-static-v2"] })), false, "pas de déclaration : jamais de pointeur (BWR sans OLED)");
  assert.equal(animOledAuxCapable(dev({ caps: undefined })), false);
  assert.equal(animOledAuxCapable(dev({ screens: ["tft18"] })), false);
  assert.equal(animOledAuxCapable(null), false);
});

test("/api/pull : le pointeur n'est repris de la frame que pour une carte capable ; les autres e-ink et les écrans dynamiques sont inchangés", () => {
  assert.deepEqual(animPullMeta(dev(), "eink29bwr", payload), { hash: HASH, bytes: 1500, frames: 6 });
  assert.equal(animPullMeta(dev({ caps: ["vote-static-v2"] }), "eink29bwr", payload), undefined);
  assert.equal(animPullMeta(dev({ firmware: "eink29bwr-2.12" }), "eink29bwr", payload), undefined);
  assert.equal(animPullMeta(dev(), "eink29bwr", { black: "x" }), undefined, "frame sans pointeur");
  assert.equal(animPullMeta(dev(), "eink29bwr", { anim: { hash: "zz", bytes: 1, frames: 1 } }), undefined, "pointeur mal formé");
  // inchangé pour les écrans dynamiques
  assert.deepEqual(animPullMeta({ screens: ["tft18"], firmware: "tft18-2.4" }, "tft18", { anim: { hash: HASH, bytes: 10, frames: 2 } }), { hash: HASH, bytes: 10, frames: 2 });
  assert.equal(animPullMeta({ screens: ["eink27bw"], firmware: "multiscreen-2.8" }, "eink27bw", payload), undefined);
  // les listes de l'atelier « Animer » ne changent pas : l'e-ink BWR n'est PAS un écran dynamique
  assert.equal(animCapable(dev(), "eink29bwr"), false);
  assert.equal(supportsAnimPointer(["eink29bwr"], "eink29bwr-2.13"), false);
});

test("cibles : seuls les membres de la pool eink29bwr capables, non bannis, une seule fois", () => {
  const devices: Record<string, ReturnType<typeof dev> | null> = {
    a: dev(), b: dev({ caps: ["vote-static-v2"] }), c: dev({ firmware: "eink29bwr-2.12" }), d: dev(), e: null,
  };
  const out = animOledAuxTargets(["a", "b", "c", "d", "e", "a"], (id) => id === "d", (id) => devices[id] ?? null);
  assert.deepEqual(out, [{ deviceId: "a", screen: "eink29bwr" }]);
});

test("caps : « anim-oled » est acceptée dans la liste fermée mais ne rend JAMAIS un appareil votant", () => {
  assert.deepEqual(parseVoteCaps(["anim-oled"]), ["anim-oled"]);
  assert.equal(parseVoteCaps(["anim-oled", "autre"]), undefined);
  // un BWR 2.13 participe au vote comme avant (voteV2Capable sur sa famille), la capacité d'animation n'y change rien
  assert.equal(participatesInVoteNetwork({ screens: ["eink29bwr"], firmware: "eink29bwr-2.13", caps: ["anim-oled"] } as never), participatesInVoteNetwork({ screens: ["eink29bwr"], firmware: "eink29bwr-2.13" } as never));
});

test("affiche BWR : clip ×2 centré (x = 20) en noir sur blanc, par la conversion validée — un pixel (0,0) du clip noircit le bit attendu et rien d'autre", () => {
  const frame = new Uint8Array(1024); frame[0] = 0x80;                                   // pixel (0,0) allumé
  const p = posterBwr(frame);
  assert.equal(p.screen, "eink29bwr");
  const black = Buffer.from(p.black, "base64"), red = Buffer.from(p.red, "base64");
  assert.equal(black.length, 4736); assert.equal(red.length, 4736);
  assert.ok(red.every((b) => b === 0xff), "aucun rouge");
  // canvas (20..21, 0..1) : bufRow = x, bufCol = 127 - y -> octets 20*16+15 et 21*16+15 : bits 0 (y=0) et 1 (y=1) à zéro
  assert.equal(black[20 * 16 + 15], 0xfc);
  assert.equal(black[21 * 16 + 15], 0xfc);
  const dark = [...black].filter((b) => b !== 0xff).length;
  assert.equal(dark, 2, "deux octets seulement portent de l'encre");
  // une image pleine noircit 256×128 pixels (x = 20 .. 275) et laisse 20 colonnes blanches de chaque côté
  const full = posterBwr(new Uint8Array(1024).fill(0xff));
  const fb = Buffer.from(full.black, "base64");
  for (let row = 0; row < 296; row++) for (let c = 0; c < 16; c++) assert.equal(fb[row * 16 + c], row >= 20 && row < 276 ? 0x00 : 0xff, `ligne ${row} octet ${c}`);
});

const HEAD = { blockHash: HASH, kind: "animation", anim: { bytes: 1500, frames: 6 } };
test("/api/pull, livraison par POINTEUR SEUL : sans frame en attente, le dernier bloc d'animation est annoncé à la carte capable — et à elle seule ; une frame fixe en attente supprime le pointeur", () => {
  assert.deepEqual(animPullMeta(dev(), null, undefined, HEAD), { hash: HASH, bytes: 1500, frames: 6 });
  assert.equal(animPullMeta(dev(), null, undefined, { blockHash: HASH, kind: undefined }), undefined, "dernier bloc = dessin : rien");
  assert.equal(animPullMeta(dev(), null, undefined, null), undefined);
  assert.equal(animPullMeta(dev({ caps: ["vote-static-v2"] }), null, undefined, HEAD), undefined, "BWR sans OLED déclaré : jamais");
  assert.equal(animPullMeta(dev({ firmware: "eink29bwr-2.12" }), null, undefined, HEAD), undefined);
  assert.equal(animPullMeta({ screens: ["eink27bw"], firmware: "multiscreen-2.8" }, null, undefined, HEAD), undefined, "autre e-ink : jamais");
  assert.equal(animPullMeta(dev(), "eink29bwr", { black: "x", red: "y" }, HEAD), undefined, "une nouvelle image fixe est en attente : pas d'animation");
  assert.deepEqual(animPullMeta(dev(), "eink29bwr", payload, HEAD), { hash: HASH, bytes: 1500, frames: 6 }, "ancienne frame porteuse du pointeur : honorée");
});

test("câblage : la diffusion N'ÉCRIT PLUS rien pour un e-ink (il garde son image) ; le pull passe la tête de chaîne à animPullMeta", () => {
  const b = fs.readFileSync(path.join(__dirname, "..", "lib/anim/broadcast.ts"), "utf8");
  assert.doesNotMatch(b, /posterBwr|animOledAuxTargets|bwrIds/, "aucune frame e-ink pour une animation");
  assert.match(fs.readFileSync(path.join(__dirname, "..", "app/api/pull/route.ts"), "utf8"), /as Record<string, unknown> \| undefined, chainHead\);/);
  const r = fs.readFileSync(path.join(__dirname, "..", "app/api/register/route.ts"), "utf8");
  assert.match(r, /parseVoteCaps\(body\.caps\)/);
});
