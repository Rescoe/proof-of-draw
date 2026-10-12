// tests/tft28AnimStream.test.ts — LOT8B2E ANIM-STREAM-FIX1 : preuves STATIQUES de l'animation EN FLUX du firmware UNO R4 + TFT 2,8″ (le comportement exécuté : tests/animStream.test.ts pour le lecteur,
// tests/tft28Host.test.ts section « 15b » pour le firmware complet sur un tas fragmenté). Chaque propriété a son mutant : la régression est REFUSÉE.
import test from "node:test";
import assert from "node:assert/strict";
import { INO, effective, fnBody, readText, stripBlock, stripHooks, stripLine } from "./helpers/tft28Source";

const hdrText = readText("arduino_uno_r4/pod_uno_r4/pod_bench_stream.h");
const code = (s: string) => stripBlock(stripLine(s));
const prodOf = (s: string) => stripHooks(effective(s, false));
const canOf = (s: string) => stripHooks(effective(s, true));
const src = readText(INO);

function violations(ino: string, hdr: string): string[] {
  const v: string[] = [];
  const c = code(ino), h = code(hdr);
  // 1. en-tête : tampon fixe, aucune allocation
  if (!/#define PODBENCH_STREAM_BUF 1024u/.test(h)) v.push("PODBENCH_STREAM_BUF != 1024");
  if (/\bmalloc\b|\bnew\b|std::vector|\bString\b|\bcalloc\b|\brealloc\b/.test(h)) v.push("l'en-tête alloue");
  // 2. bus SPI partagé : dans stepStream, TOUTE lecture précède tft.startWrite() du lot
  const step = fnBody(h, "inline bool stepStream(");
  const iStart = step.indexOf("tft.startWrite()"), iEnd = step.indexOf("tft.endWrite();\n    done += nb;");
  const iFill = step.indexOf("s.read(buf + used, 3)"), iFillData = step.indexOf("s.read(buf + used + 3, len)");
  if (!(iFill > 0 && iFillData > 0 && iFill < iStart && iFillData < iStart && iStart < iEnd)) v.push("stepStream : lecture de la carte pendant (ou après) tft.startWrite()");
  if (/s\.read\(/.test(step.slice(iStart, iEnd))) v.push("stepStream : lecture de la carte dans la transaction TFT");
  // 3. firmware : inclusion, tampon, plus de clip entier en RAM dans les chemins carte
  if (!/#include "pod_bench\.h"\n#include "pod_bench_stream\.h"/.test(ino)) v.push("pod_bench_stream.h non inclus après pod_bench.h");
  if (!/#define ANIM_WORK_BYTES \(BENCH_FRAME \+ PODBENCH_STREAM_BUF\)/.test(c)) v.push("ANIM_WORK_BYTES != image courante + tampon");
  const fa = fnBody(c, "static bool fetchAnimToSd("), ra = fnBody(c, "static AnimEnd __attribute__((noinline)) runResidentAnim("), dl = fnBody(c, "static bool __attribute__((noinline)) netGetBlockClipToSd("), va = fnBody(c, "static bool __attribute__((noinline)) animValidateAndMark(");
  for (const [n, b] of [["fetchAnimToSd", fa], ["runResidentAnim", ra], ["netGetBlockClipToSd", dl], ["animValidateAndMark", va]] as const) {
    if (!b) { v.push(`${n} introuvable`); continue; }
    if (/malloc\((announced|n|BENCH_MAX_CLIP)\)/.test(b)) v.push(`${n} : allocation du clip entier`);
    if (/podbench::parse\(/.test(b)) v.push(`${n} : validation en RAM (podbench::parse) au lieu du flux`);
  }
  // 4. téléchargement : écrit au fil de l'eau, par blocs de ROW_BYTES dans g_row, échec d'écriture = refus
  if (!/uint8_t\* raw = \(uint8_t\*\)g_row;[\s\S]*readBody\(raw, k\) != k[\s\S]*f\.write\(raw, k\) != k\) \{ ok = false; writeFailed = true;/.test(dl)) v.push("netGetBlockClipToSd : écriture au fil de l'eau avec échec d'écriture fatal");
  if (!/got = ok && c\.rd\.complete\(\) && c\.client\.fault\(\) == 0;/.test(dl)) v.push("netGetBlockClipToSd : réception complète et sans défaut collant exigée");
  // 5. ordre : marqueurs supprimés -> réseau -> validation -> marqueur ; échec = tout supprimer
  const iRm = fa.indexOf("animRemoveFiles();"), iNet = fa.indexOf("netGetBlockClipToSd(hash, announced, writeFailed)"), iVal = fa.indexOf("animValidateAndMark(hash, announced, work, frames)");
  if (!(iRm >= 0 && iRm < iNet && iNet < iVal)) v.push("fetchAnimToSd : ordre attendu suppression -> téléchargement -> validation");
  if (!/if \(!ok\) \{ animRemoveFiles\(\); return false; \}/.test(fa)) v.push("fetchAnimToSd : un échec doit supprimer clip et marqueur");
  if (!/if \(!got\) logf\(/.test(fa) || !/else ok = animValidateAndMark\(/.test(fa)) v.push("fetchAnimToSd : la validation ne doit suivre qu'un téléchargement complet");
  const iValid = va.indexOf("podbench::validateStream("), iOk = va.indexOf("if (e != podbench::OK) return;"), iMark = va.indexOf("SD.open(SD_ANIM_META, FILE_WRITE)");
  if (!(iValid > 0 && iOk > iValid && iMark > iOk)) v.push("animValidateAndMark : le marqueur doit suivre une validation réussie");
  if (!/src\.f\.size\(\) != announced/.test(va)) v.push("animValidateAndMark : taille rangée == taille annoncée");
  if (!/free\(work\);\s*if \(!ok\)/.test(fa)) v.push("fetchAnimToSd : le tampon de travail doit être libéré sur tous les chemins");
  // 6. lecture : un tampon de travail, UNE pile dédiée, validation avant tout dessin, aucun accès SD hors pile dédiée
  if (!/onSd\("animPlay", play\)/.test(ra)) v.push("runResidentAnim : lecture hors pile dédiée");
  const iPv = ra.indexOf("podbench::validateStream("), iPf = ra.indexOf("tft.fillScreen(si.bg)"), iPl = ra.indexOf("podbench::playStream(");
  if (!(iPv > 0 && iPv < iPf && iPf < iPl)) v.push("runResidentAnim : validation avant le premier dessin");
  if (!/if \(perr != podbench::OK\) \{ st = 3; src\.f\.close\(\); return; \}/.test(ra)) v.push("runResidentAnim : un clip refusé ne doit pas être joué");
  if (!/free\(work\);\s*if \(!ran\) return AE_ERROR;/.test(ra)) v.push("runResidentAnim : libération du tampon avant tout retour");
  if (!/pe == podbench::PLAY_IO\) st = 4;/.test(ra)) v.push("runResidentAnim : lecture de la carte interrompue non traitée");
  if (/\bSD\.(open|exists|remove)\(/.test(ra.replace(/auto play = \[&\]\(\) \{[\s\S]*?\n  \};\n/, ""))) v.push("runResidentAnim : accès à la carte hors de la pile dédiée");
  return v;
}

test("ANIM-STREAM-FIX1 (production et canari) : tampon fixe, aucune allocation du clip entier, bus SPI partagé respecté, ordre et échec fermé", () => {
  assert.deepEqual(violations(prodOf(src), hdrText), []);
  assert.deepEqual(violations(canOf(src), hdrText), []);
});

test("ANIM-STREAM-FIX1 : MUTANTS — chaque régression est REFUSÉE", () => {
  const p = prodOf(src);
  const mutIno: Array<[string, string, string]> = [
    ["clip entier réalloué à la lecture", 'uint8_t* work = (uint8_t*)malloc(ANIM_WORK_BYTES);\n  if (!work) { logf("[ANIM] mémoire insuffisante pour la lecture', 'uint8_t* work = (uint8_t*)malloc(ANIM_WORK_BYTES); size_t n = 9216; uint8_t* clip = (uint8_t*)malloc(n);\n  if (!work) { logf("[ANIM] mémoire insuffisante pour la lecture'],
    ["lecture hors pile dédiée", 'const bool ran = onSd("animPlay", play);', "play(); const bool ran = true;"],
    ["marqueur écrit avant la validation", "    podbench::StreamInfo si;\n    const podbench::Err e = podbench::validateStream(src, announced, si, work, work + BENCH_FRAME);", "    File mm = SD.open(SD_ANIM_META, FILE_WRITE); if (mm) { mm.println(hash); mm.close(); }\n    podbench::StreamInfo si;\n    const podbench::Err e = podbench::validateStream(src, announced, si, work, work + BENCH_FRAME);"],
    ["validation ignorée (marqueur même si refusé)", "    if (e != podbench::OK) return;\n", ""],
    ["échec sans suppression du clip", "if (!ok) { animRemoveFiles(); return false; }", "if (!ok) return false;"],
    ["téléchargement incomplet validé quand même", "  else ok = animValidateAndMark(hash, announced, work, frames);", "  ok = animValidateAndMark(hash, announced, work, frames);"],
    ["écriture sur la carte non vérifiée", "if (f.write(raw, k) != k) { ok = false; writeFailed = true; break; }", "f.write(raw, k);"],
    ["défaut collant du client TLS ignoré", "got = ok && c.rd.complete() && c.client.fault() == 0;", "got = ok;"],
    ["taille rangée non comparée à la taille annoncée", "if (src.f.size() != announced) { err = 0xFD; src.f.close(); return; }", ""],
    ["clip refusé joué quand même", "if (perr != podbench::OK) { st = 3; src.f.close(); return; }", "if (perr != podbench::OK) { st = 3; }"],
    ["tampon de travail non libéré", "  const bool ran = onSd(\"animPlay\", play);\n  free(work);", "  const bool ran = onSd(\"animPlay\", play);"],
    ["validation en RAM (podbench::parse)", "perr = podbench::validateStream(src, n, si, work, work + BENCH_FRAME);", "podbench::Clip pc; perr = podbench::parse(work, n, pc, work);"],
  ];
  for (const [label, from, to] of mutIno) {
    assert.ok(p.includes(from), `motif obsolète pour le mutant « ${label} »`);
    assert.notDeepEqual(violations(p.replace(from, to), hdrText), [], `mutant NON refusé : ${label}`);
  }
  const mutHdr: Array<[string, string, string]> = [
    ["tampon agrandi", "#define PODBENCH_STREAM_BUF 1024u", "#define PODBENCH_STREAM_BUF 4096u"],
    ["lecture dans la transaction TFT", "    tft.startWrite();                                                                // une transaction par lot", "    tft.startWrite(); { uint8_t z[1]; s.read(z, 0); }"],
    ["allocation dans l'en-tête", "inline uint32_t crcBegin() {", "inline void* leak() { return malloc(10); }\ninline uint32_t crcBegin() {"],
  ];
  for (const [label, from, to] of mutHdr) {
    assert.ok(hdrText.includes(from), `motif obsolète pour le mutant « ${label} »`);
    assert.notDeepEqual(violations(p, hdrText.replace(from, to)), [], `mutant NON refusé : ${label}`);
  }
  // le mutant « lecture avant startWrite supprimée » : startWrite avant le remplissage
  const swapped = hdrText.replace("    while (done + nb < runs && used + 3u + 255u <= PODBENCH_STREAM_BUF) {", "    tft.startWrite();\n    while (done + nb < runs && used + 3u + 255u <= PODBENCH_STREAM_BUF) {");
  assert.notEqual(swapped, hdrText);
  assert.notDeepEqual(violations(p, swapped), [], "mutant NON refusé : startWrite avant le remplissage du lot");
});

test("ANIM-STREAM-FIX1 : l'en-tête de flux n'existe que dans le dossier TFT 2,8″ et pod_bench.h reste inchangé (copies identiques des autres firmwares)", () => {
  assert.ok(hdrText.includes('#include "pod_bench.h"'));
  for (const d of ["pod_uno_r4_eink29", "pod_uno_r4_eink27", "pod_uno_r4_tft18"]) {
    try { readText(`arduino_uno_r4/${d}/pod_bench_stream.h`); assert.fail(`${d} ne doit pas recevoir pod_bench_stream.h`); } catch (e) { assert.match(String(e), /ENOENT|ne doit pas/); }
  }
});
