// tests/helpers/animSelfTestHeader.ts — construit consensus-pod/src/podAnimV3_selftest.h : les clips et les VALEURS ATTENDUES de l'auto-test embarqué du lot 6C, produits par la RÉFÉRENCE TypeScript (lib/animV3.ts).
// Voir scripts/gen-anim-selftest.ts. Le même en-tête est compilé pour l'ESP8266, l'UNO R4 et le PC (tests hôte) : la logique d'auto-test (src/podAnimSelfTest.h) est UNIQUE.
import { analyzeClip, animVoteMessage, parseAnimVoteMessage, evaluateAnimRules, type AnimVote } from "../../lib/animV3";
import { saltNonce, saltedHash } from "../../lib/podProtocolV3";
import { buildAnimClips, fixCrc } from "./animV3Vectors";

export const SELFTEST = {
  deviceId: "dev_AB12CD34",
  candidateId: "123e4567-e89b-42d3-a456-426614174000",
  parentHash: "5e2f0c1b7a9d4e3f8a6b1c0d9e8f7a6b5c4d3e2f1a0b9c8d7e6f5a4b3c2d1e0f",
  vclass: "C0" as const,
  /** découpages du flux : 1 octet, 7 (impair), 61 (premier), 256 (maximum du tampon de fragment) */
  fragments: [1, 7, 61, 256],
};

interface Case { name: string; data: Uint8Array; corruptAnnounce: boolean; announcedOf: Uint8Array; why: string }

export function selfTestCases(): Case[] {
  const clips = new Map(buildAnimClips().map((c) => [c.name, c.bin]));
  const get = (n: string) => { const b = clips.get(n); if (!b) throw new Error(`clip introuvable : ${n}`); return b; };
  const valid2 = get("scène-0-n2"), valid64 = get("scène-7-n64"), stat = get("statique-scène-n3"), alt = get("alternance-nb-n6"), noise = get("damier-n3");
  const crc = Uint8Array.from(valid2); crc[crc.length - 1] ^= 0xff;                // CRC altérée (dernier octet)
  const body = Uint8Array.from(valid2); body[600] ^= 0x01;                          // octet du corps altéré, CRC inchangée
  const trunc = valid2.slice(0, 600);                                               // tronqué en plein corps
  return [
    { name: "valide-2-images", data: valid2, corruptAnnounce: false, announcedOf: valid2, why: "clip valide de 2 images" },
    { name: "valide-64-images", data: valid64, corruptAnnounce: false, announcedOf: valid64, why: "clip valide de 64 images (maximum)" },
    { name: "statique", data: stat, corruptAnnounce: false, announcedOf: stat, why: "toutes les images identiques" },
    { name: "alternance-noir-blanc", data: alt, corruptAnnounce: false, announcedOf: alt, why: "images uniformes qui diffèrent : acceptée" },
    { name: "bruit", data: noise, corruptAnnounce: false, announcedOf: noise, why: "damier alterné : bruit pur refusé" },
    { name: "crc-altérée", data: crc, corruptAnnounce: false, announcedOf: valid2, why: "dernier octet (CRC) modifié" },
    { name: "corps-altéré", data: body, corruptAnnounce: false, announcedOf: valid2, why: "un octet du corps modifié, CRC d'origine" },
    { name: "tronqué", data: trunc, corruptAnnounce: false, announcedOf: valid2, why: "flux coupé à 600 octets" },
    { name: "racine-annoncée-fausse", data: valid2, corruptAnnounce: true, announcedOf: valid2, why: "racine d'animation annoncée avec un caractère modifié" },
  ];
}

const flipLast = (hex: string) => hex.slice(0, -1) + (hex.endsWith("0") ? "1" : "0");

/** Ligne attendue : rule|frames|E|T|R|S|poster|same|clipHash|framesRoot|animRoot|message (même construction que le C++ : podAnimSelfTest.h). */
export function expectedFor(c: Case) {
  const a = analyzeClip(c.data), ann = analyzeClip(c.announcedOf);
  const annClip = ann.clipHash, annRoot = c.corruptAnnounce ? flipLast(ann.animRoot) : ann.animRoot;
  const hashOk = a.formatOk ? a.clipHash === annClip && a.animRoot === annRoot : false;
  const rule = evaluateAnimRules({ formatOk: a.formatOk, hashOk, allIdentical: a.allIdentical, E: a.E, T: a.T }).ruleCode;
  const noCalc = rule === "format" || rule === "hash";
  const salted = saltedHash(saltNonce(SELFTEST.candidateId, SELFTEST.parentHash, SELFTEST.deviceId), c.data);
  const vote: AnimVote = {
    deviceId: SELFTEST.deviceId, candidateId: SELFTEST.candidateId, parentHash: SELFTEST.parentHash, metricsVersion: 2, rulesVersion: 2, clipHash: a.clipHash, animRoot: annRoot, saltedHash: salted,
    frames: rule === "format" ? 0 : a.N, E: noCalc ? 0 : a.E, T: noCalc ? 0 : a.T, R: noCalc ? 0 : a.R, S: noCalc ? 0 : a.S, verdict: rule === "ok" ? "accept" : "reject", ruleCode: rule, vclass: SELFTEST.vclass,
  };
  const message = animVoteMessage(vote);
  if (!parseAnimVoteMessage(message)) throw new Error(`message non canonique pour ${c.name}`);
  const f = a.formatOk;
  const line = [rule, f ? a.N : 0, f ? a.E : 0, f ? a.T : 0, f ? a.R : 0, f ? a.S : 0, f ? a.posterIndex : 0, f && a.allIdentical ? 1 : 0, a.clipHash, f ? a.framesRoot : "", f ? a.animRoot : "", message].join("|");
  return { line, annClip, annRoot: ann.animRoot, rule, a };
}

const bytesLiteral = (b: Uint8Array) => { const rows: string[] = []; for (let i = 0; i < b.length; i += 24) rows.push("  " + Array.from(b.subarray(i, i + 24), (x) => `0x${x.toString(16).padStart(2, "0")}`).join(",")); return rows.join(",\n"); };

export function buildSelfTestHeader(): string {
  const cases = selfTestCases();
  const L: string[] = [
    "// podAnimV3_selftest.h — clips et valeurs attendues de l'auto-test du lot 6C (docs/LOT_6C_COMPILATION_ANIMATION_2026_10_07.md). GÉNÉRÉ par scripts/gen-anim-selftest.ts depuis lib/animV3.ts : NE PAS ÉDITER.",
    "// Les données sont en FLASH (PROGMEM sur ESP8266 ; const sur UNO R4, où la flash est adressable). ⚠ Auto-test : COMPILÉ seulement, JAMAIS essayé sur une carte.",
    "#pragma once",
    "#include <stdint.h>",
    "#ifndef PROGMEM",
    "#define PROGMEM",
    "#endif",
    "",
    `#define POD_ANIMTEST_DEVICE    "${SELFTEST.deviceId}"`,
    `#define POD_ANIMTEST_CANDIDATE "${SELFTEST.candidateId}"`,
    `#define POD_ANIMTEST_PARENT    "${SELFTEST.parentHash}"`,
    `#define POD_ANIMTEST_VCLASS    "${SELFTEST.vclass}"`,
    `#define POD_ANIMTEST_COUNT     ${cases.length}`,
    "",
  ];
  // données distinctes (les clips identiques ne sont stockés qu'UNE fois)
  const stored = new Map<string, number>(); const arrays: string[] = [];
  const store = (b: Uint8Array) => { const key = Buffer.from(b).toString("hex"); let id = stored.get(key); if (id === undefined) { id = stored.size; stored.set(key, id); arrays.push(`static const uint8_t POD_ANIMTEST_CLIP_${id}[] PROGMEM = {\n${bytesLiteral(b)}\n};`); } return id; };
  const caseRows: string[] = [], strings: string[] = [];
  cases.forEach((c, i) => {
    const e = expectedFor(c);
    // le 4ᵉ cas « tronqué » réutilise les données du clip valide (longueur plus courte) ; les autres clips sont stockés une fois
    const id = store(c.name === "tronqué" ? c.announcedOf : c.data);
    strings.push(`static const char POD_ANIMTEST_EXPECT_${i}[] PROGMEM = "${e.line}";`, `static const char POD_ANIMTEST_ANNCLIP_${i}[] PROGMEM = "${e.annClip}";`, `static const char POD_ANIMTEST_ANNROOT_${i}[] PROGMEM = "${e.annRoot}";`);
    caseRows.push(`  { POD_ANIMTEST_CLIP_${id}, ${c.data.length}, POD_ANIMTEST_EXPECT_${i}, POD_ANIMTEST_ANNCLIP_${i}, POD_ANIMTEST_ANNROOT_${i}, ${c.corruptAnnounce ? 1 : 0} },   // c${i} ${c.name} : ${c.why} → ${e.rule}`);
  });
  L.push(...arrays, "", ...strings, "",
    "struct PodAnimTestCase { const uint8_t* clip; uint16_t len; const char* expect; const char* annClip; const char* annRoot; uint8_t corruptAnnounce; };",
    "static const PodAnimTestCase POD_ANIMTEST_CASES[POD_ANIMTEST_COUNT] PROGMEM = {", ...caseRows, "};", "");
  return L.join("\n");
}

export { fixCrc };
