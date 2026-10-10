import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { encodeGrid, patternGrid } from "../lib/renderLayout";
import { verifyRender } from "../scripts/canary-verify-render";

// LOT8B2B2-CANARY-PREP — préparation du canari UNO R4 e-ink 2,9″ BWR (rendu v1). Rien n'est flashé ici ; ces tests gardent : (1) le script de vérification hors carte contre les vecteurs d'or,
// (2) l'isolement du build de canari (POD_CANARY = 0 par défaut, aucun appel réseau, aucune variable globale), (3) la procédure documentée (lignes série, critères d'arrêt, retour arrière).
const root = path.join(__dirname, "..");
const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8").replace(/\r\n/g, "\n");
const hex = (s: string) => (s === "-" ? new Uint8Array() : Uint8Array.from(Buffer.from(s, "hex")));
const INO = "arduino_uno_r4/pod_uno_r4_eink29/pod_uno_r4_eink29.ino";
const DOC = "docs/CANARY_R4_EINK29_RENDU_V1_2026_10_08.md";

test("canary-verify-render : retrouve EXACTEMENT les frameHash / renderHash des vecteurs d'or (3 modes × plusieurs textes) à partir des plans bruts + des métadonnées de la ligne [CANARY] meta", () => {
  const lines = read("consensus-pod/test-vectors/render-vectors.txt").split("\n").filter((l) => l.startsWith("rvec eink29bwr "));
  assert.ok(lines.length >= 40);
  let checked = 0;
  for (const l of lines) {
    const t = l.split(" ");   // rvec écran motif graine mode bloc ts artiste titre frameHash renderHash
    const [, , pattern, seed, mode, block, ts, artist, title, fh, rh] = t;
    const planes = encodeGrid("eink29bwr", patternGrid("eink29bwr", pattern as never, Number(seed)));
    const dec = new TextDecoder();
    const out = verifyRender({ screen: "eink29bwr", planes: Uint8Array.from([...planes[0], ...planes[1]]), ts: dec.decode(hex(ts)), artist: dec.decode(hex(artist)), title: dec.decode(hex(title)), block: Number(block), mode: mode as never });
    // texte non UTF-8 valide : la ligne série ne peut pas le porter tel quel — on ne compare que les cas UTF-8 propres (le décodage perdrait des octets sinon)
    const clean = [ts, artist, title].every((h) => h === "-" || Buffer.from(h, "hex").equals(Buffer.from(dec.decode(hex(h)), "utf8")));
    if (!clean) continue;
    assert.equal(out.frameHash, fh, l.slice(0, 60)); assert.equal(out.renderHash, rh, l.slice(0, 60)); checked++;
  }
  assert.ok(checked >= 30, `vecteurs comparés : ${checked}`);
});

test("canary-verify-render : ligne de commande — même résultat, et refus clair d'un fichier de mauvaise taille", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "canaryverify-"));
  const planes = encodeGrid("eink29bwr", patternGrid("eink29bwr", "noise", 7));
  const f = path.join(tmp, "planes.bin"); fs.writeFileSync(f, Buffer.concat([planes[0], planes[1]]));
  const bin = process.execPath, base = ["--import", "tsx", path.join(root, "scripts", "canary-verify-render.ts")];
  const ok = spawnSync(bin, [...base, "--planes", f, "--ts", "07/10/2026 20:37", "--artist", "Léa", "--title", "Le Chat Noir", "--block", "42", "--mode", "fit"], { encoding: "utf8", cwd: root });
  assert.equal(ok.status, 0, ok.stderr);
  const expected = verifyRender({ screen: "eink29bwr", planes: Uint8Array.from([...planes[0], ...planes[1]]), ts: "07/10/2026 20:37", artist: "Léa", title: "Le Chat Noir", block: 42, mode: "fit" });
  assert.equal(ok.stdout.trim(), `frameHash=${expected.frameHash} renderHash=${expected.renderHash}`);
  const short = path.join(tmp, "short.bin"); fs.writeFileSync(short, Buffer.alloc(9471));
  const bad = spawnSync(bin, [...base, "--planes", short], { encoding: "utf8", cwd: root });
  assert.equal(bad.status, 1); assert.match(bad.stderr, /9472 octets attendus/);
});

test("build de canari : POD_CANARY = 0 par défaut, jamais actif sans POD_RENDER_V1, uniquement dans le firmware R4 e-ink 2,9″, sans réseau, sans variable globale, sans modification de ce que le serveur voit", () => {
  const src = read(INO);
  assert.match(src, /#ifndef POD_CANARY\n#define POD_CANARY 0 /);
  assert.equal((src.match(/#define POD_CANARY\b/g) ?? []).length, 1);
  // tout code de canari est sous « #if POD_RENDER_V1 && POD_CANARY »
  const stripped = src.replace(/#if POD_RENDER_V1 && POD_CANARY\n[\s\S]*?\n#endif\n/g, "").replace(/\/\/.*$/gm, "");   // hors blocs gardés et hors commentaires
  assert.doesNotMatch(stripped, /podCanary|\[CANARY\]|CANARY_PAINT|CANARY_MAGIC/, "du code de canari existe hors des blocs gardés");
  const blocks = [...src.matchAll(/#if POD_RENDER_V1 && POD_CANARY\n([\s\S]*?)\n#endif\n/g)].map((m) => m[1]).join("\n");
  assert.ok((src.match(/#if POD_RENDER_V1 && POD_CANARY/g) ?? []).length >= 15, "les points de contrôle de BOOT-FIX2 sont chacun dans un bloc gardé (tests/canaryBootFix2.test.ts)");
  const code = blocks.replace(/\/\/.*$/gm, "");
  assert.doesNotMatch(code, /ackFrame\(|httpCall\(|Conn\b|WiFi|\.request\(|persistFrameId|EEPROM|NVIC_SystemReset|delay\(/, "le canari ne touche ni réseau, ni EEPROM, ni redémarrage");
  // DOPULL-PHASE-AUDIT1 : deux SEULES exceptions, canari seulement et documentées (+16 o de RAM statique mesurés, marge 528 o → 512 o) : la longueur peinte initiale et la première phase fautive de doPull
  assert.doesNotMatch(code, /^static (?!void|const|inline void|(?:bool|uint32_t) __attribute__\(\(noinline\)\) \w+\(|volatile uint32_t g_podPaintLen = 0;|volatile uint8_t g_podDpPhase = 0;)/m, "aucune autre variable globale dans l'instrumentation (marge statique du 2,9″ : 528 o)");
  assert.equal((code.match(/^static volatile (?:uint32_t|uint8_t) g_pod\w+ = 0;/gm) ?? []).length, 2, "exactement deux statiques de canari");
  assert.match(code, /extern char __StackLimit, __StackTop, __HeapBase;/);
  // le firmware annoncé au serveur ne change pas (le canari se reconnaît au moniteur série, pas côté serveur)
  assert.equal((src.match(/#define FIRMWARE_VERSION\s+"r4eink29-1\.1"/g) ?? []).length, 1);
  // aucun autre firmware ne porte l'instrumentation
  for (const other of ["esp8266/esp_eink_2.9BWR/esp_eink_2.9BWR.ino", "esp8266/esp_tft1.8/esp_tft1.8.ino", "arduino_uno_r4/pod_uno_r4_tft18/pod_uno_r4_tft18.ino", "arduino_uno_r4/pod_uno_r4_eink27/pod_uno_r4_eink27.ino"]) assert.doesNotMatch(read(other), /POD_CANARY/, other);
});

test("les binaires de canari ne peuvent PAS être commités : /canary-builds/ est ignoré par git (ils embarquent les identifiants Wi-Fi de secrets.h)", () => {
  assert.match(read(".gitignore"), /^\/canary-builds\/$/m);
  const r = spawnSync("git", ["check-ignore", "canary-builds/stable/pod_uno_r4_eink29.ino.bin", "canary-builds/canary/pod_uno_r4_eink29.ino.bin"], { encoding: "utf8", cwd: root });
  if (r.error) return;   // git absent de cet environnement : la règle .gitignore ci-dessus suffit
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

test("procédure documentée : build, frame réellement nouvelle sans effacer l'EEPROM, lignes série attendues (exactes), critères d'arrêt, retour immédiat au stable", () => {
  const doc = read(DOC);
  const heads = doc.split("\n").filter((l) => /^#{1,2} /.test(l));
  assert.equal(heads.filter((h) => h.startsWith("# ")).length, 1);
  assert.deepEqual(heads.slice(1).map((h) => h.slice(0, 5)), ["## 1.", "## 2.", "## 3.", "## 4.", "## 5.", "## 6.", "## 7.", "## 8."]);
  // chaque ligne série citée existe BIEN dans le firmware (chaîne exacte, sans les arguments)
  const src = read(INO);
  const quoted = [...doc.matchAll(/^\| `(\[[^\]`]+\][^`]*)` \|/gm)].map((m) => m[1].replace(/\\\|/g, "|"));
  assert.ok(quoted.length >= 25, `lignes série documentées : ${quoted.length}`);
  const flat = src.split("\n").join("").replace(/\\"/g, '"');
  for (const line of quoted) {
    // les parties FIXES de la ligne (entre les <variables>) doivent exister, dans l'ordre, dans le firmware
    let from = 0;
    for (const seg of line.split(/<[^>]*>/).map((s) => s.trim()).filter((s) => s.length >= 3)) {
      const i = flat.indexOf(seg.replace(/\\"/g, '"'), from);
      assert.ok(i >= 0, `segment « ${seg} » de la ligne « ${line} » absent du firmware`);
      from = i;
    }
  }
  for (const needle of ["/api/send-to-screen", "UUID", "frameId", "EEPROM", "n'est PAS effacée", "canary-builds/stable", "canary-builds/canary", "POD_RENDER_V1=0", "-DPOD_RENDER_V1=1 -DPOD_CANARY=1", "Critères d'arrêt",
    "redémarrage", "BUSY", "ACK", "marge < 128", "canary-verify-render", "pull-frame", "boucle", "10 s", "aucun polling", "jamais commité", "retour immédiat"]) assert.ok(doc.includes(needle), needle);
  assert.ok(doc.includes("22 768"), "RAM statique attendue");
});
