/* eslint-disable @typescript-eslint/no-require-imports */
// scripts/vote-canary-elf-reach.js — LOT8B2E V4-FIX1 : PORTÉE dans l'ELF (désassemblage) du build POD_VOTE_CANARY = 1.
//   arm-none-eabi-objdump -d --no-show-raw-insn <elf> > f.dis ; node scripts/vote-canary-elf-reach.js f.dis
// Fonctions atteignables par APPELS DIRECTS (bl, b.w terminal) depuis setup() et loop(), avec les lambdas (_ZZ…clEv) rattachées à leur fonction parente quand elle est atteignable (elles sont passées à podNetRun / onSd par
// pointeur : sans cette règle l'analyse manquerait tout ce qui s'exécute sur une pile dédiée). Les appels INDIRECTS ne sont pas suivis (comptés). Sortie : familles écran / tactile / carte SD atteignables (attendu : AUCUNE), et
// fonctions atteignables depuis les constructeurs statiques (_GLOBAL__sub_I_*), qui s'exécutent avant setup() : ils ne doivent atteindre aucun accès au bus (pinMode, digitalWrite, SPI). Ce n'est PAS un argument « le linker retire ces
// familles » : c'est la preuve qu'AUCUN appel correspondant n'est atteignable depuis les points d'entrée.
const fs = require("fs");
const path = require("path");
const { parse } = require(path.join(__dirname, "stack-callgraph.js"));
const dis = process.argv[2];
const enroll = process.argv[3] === "--enroll";   // TFT28-PREVIEW-ENROLL-1 : build d'appairage (POD_PREVIEW_ENROLL = 1) : en plus, AUCUNE fonction de pull / candidat / vote / verrou ne doit être atteignable
if (!dis) { console.error("usage : vote-canary-elf-reach.js <fichier.dis> [--enroll]"); process.exit(2); }
const funcs = parse(fs.readFileSync(dis, "utf8"));
const names = [...funcs.keys()];
const plain = (n) => { const m = /^_ZL?(\d+)(.*)$/.exec(n); if (!m) return n; const len = Number(m[1]); return m[2].slice(0, len); };
const byPlain = new Map(); for (const n of names) { const p = plain(n); if (!byPlain.has(p)) byPlain.set(p, []); byPlain.get(p).push(n); }
const lambdaParent = (n) => { const m = /^_ZZL?(\d+)(.*)$/.exec(n); if (!m) return null; return m[2].slice(0, Number(m[1])); };
const children = new Map();   // parent (plain) -> lambdas
for (const n of names) { const p = lambdaParent(n); if (p) { if (!children.has(p)) children.set(p, []); children.get(p).push(n); } }

function reach(roots) {
  const seen = new Set(); const q = [...roots]; let indirect = 0;
  while (q.length) {
    const n = q.pop(); if (seen.has(n)) continue; seen.add(n);
    const f = funcs.get(n); if (!f) continue;
    indirect += f.indirect;
    for (const c of [...f.calls, ...f.tails]) if (!seen.has(c)) q.push(c);
    for (const l of children.get(plain(n)) || []) if (!seen.has(l)) q.push(l);   // lambdas du parent atteignable
  }
  return { seen, indirect };
}
const FAM = [
  ["ÉCRAN (TFT / GFX / fonctions d'affichage)", /Adafruit_ILI9341|Adafruit_SPITFT|Adafruit_GFX|tftStatus|pushRow|swapRowBytes|fastPixels|drawCartel|displayOnboardingTFT|displayKeyMaterialOnce|registerShow|FastTft/],
  ["TACTILE (STMPE610 / toucher)", /STMPE610|serviceTouch|drainTouch|waitTapOrTimeout/],
  ["CARTE SD (SD / fichiers / onSd)", /SDLib|SdFile|SdVolume|Sd2Card|SDClass|initSD|onSd|restoreRows|restoreLastFrame|toggleCartel|saveMeta|animForget|animLoadMarker|animValidateAndMark|netGetBlockClipToSd|fetchAnimToSd|runResidentAnim/],
  ["ANIMATION / BANC D'ESSAI / ACK / IMAGE", /playBenchClip|doBenchPoll|maybeFetchAnim|doFetchFrame|ackFrame|streamFrame|doObsConfirm/],
];
if (enroll) FAM.push(["PULL / CANDIDAT / VOTE / VERROU (build d'appairage)", /doPull|doValidate|voteCanaryLoop|votePhase|voteLock|voteGate|voteFinish|voteClassify|netReadCandidate|netGetBlockClipToSd|vcLockBoot|vcHalt|podCheckStream|doPullStage/]);
const entry = ["setup", "loop"].filter((n) => funcs.has(n));
const start = reach(entry);
console.log(`# portée ELF depuis ${entry.join(" + ")} : ${start.seen.size} fonctions atteignables par appels directs (+ lambdas rattachées), ${start.indirect} appels indirects non suivis`);
let bad = 0;
for (const [label, re] of FAM) {
  const hit = [...start.seen].filter((n) => re.test(n));
  console.log(`- ${label} : ${hit.length === 0 ? "AUCUNE fonction atteignable" : hit.length + " fonction(s) ATTEIGNABLE(S) : " + hit.join(", ")}`); bad += hit.length;
}
const inits = names.filter((n) => /^_GLOBAL__sub_I_/.test(n));
const ir = reach(inits);
const BUS = /^(pinMode|digitalWrite|digitalRead|_ZN8SPIClass.*|.*SPIClass5begin.*|.*transfer.*|.*SPIClass.*)$/;
const busHits = [...ir.seen].filter((n) => BUS.test(n));
const dispInit = [...ir.seen].filter((n) => /Adafruit_ILI9341|Adafruit_STMPE610|SDClass|Adafruit_SPITFT|Adafruit_GFX/.test(n));
console.log(`- constructeurs statiques (avant setup) : ${ir.seen.size} fonctions atteignables ; objets d'affichage / tactile / SD construits : ${dispInit.length ? dispInit.join(", ") : "aucun"} ; accès au bus (pinMode / digitalWrite / SPI) : ${busHits.length === 0 ? "AUCUN" : busHits.join(", ")}`);
console.log(bad === 0 && busHits.length === 0 ? "# VERDICT : aucun appel d'écran, de tactile ni de carte SD n'est atteignable depuis setup() / loop() ; les constructeurs statiques n'accèdent pas au bus" : "# VERDICT : ÉCHEC");
process.exit(bad === 0 && busHits.length === 0 ? 0 : 1);
