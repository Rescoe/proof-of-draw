// scripts/verify-block.ts — vérifie un bloc Proof-of-Draw SANS faire confiance au serveur (lib/podVerify.ts). Lot 3.
//
// Usage :
//   node --import tsx scripts/verify-block.ts --base https://proof-of-draw.vercel.app --hash <blockHash64>      (récupère la preuve, le bloc précédent et l'image)
//   node --import tsx scripts/verify-block.ts --file proof.json                                                  (hors ligne : { block, receipts, parent?, content?: { screen, rawHex } })
// Sortie : un contrôle par ligne (✔ ok · ✘ échec · ⚠ avertissement · – non vérifiable) et le NIVEAU atteint. Code de sortie 0 si aucun contrôle n'échoue, 1 sinon, 2 si usage incorrect.
// Le script ne parle qu'à /api/block-proof et /api/block-image (lecture publique, en cache CDN) ; il n'écrit rien.
import fs from "node:fs";
import { LEVEL_LABEL, verifyBlock, type VerifyInput } from "../lib/podVerify";
import { isPodScreen, rawContent } from "../lib/podMetrics";

const arg = (name: string) => { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : undefined; };
const SIGN = { ok: "✔", fail: "✘", warn: "⚠", na: "–" } as const;

async function getJson(url: string): Promise<unknown> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url} → HTTP ${r.status}`);
  return r.json();
}

async function load(): Promise<VerifyInput> {
  const file = arg("file");
  if (file) {
    const j = JSON.parse(fs.readFileSync(file, "utf8"));
    return { block: j.block, receipts: j.receipts ?? null, parent: j.parent ?? null, content: j.content ? { screen: j.content.screen, raw: new Uint8Array(Buffer.from(j.content.rawHex, "hex")) } : null };
  }
  const base = arg("base")?.replace(/\/$/, ""), hash = arg("hash");
  if (!base || !hash) { console.error("usage : --base <url> --hash <blockHash>  |  --file <proof.json>"); process.exit(2); }
  const proof = (await getJson(`${base}/api/block-proof?hash=${hash}`)) as { block: VerifyInput["block"]; receipts: VerifyInput["receipts"] };
  let parent: VerifyInput["parent"] = null;
  if (/^0+$/.test(proof.block.parentHash)) parent = { blockHash: proof.block.parentHash };   // bloc genèse : parent fictif de zéros
  else { try { parent = ((await getJson(`${base}/api/block-proof?hash=${proof.block.parentHash}`)) as { block: { blockHash: string } }).block; } catch { parent = null; } }
  let content: VerifyInput["content"] = null;
  try {
    const img = ((await getJson(`${base}/api/block-image?hash=${hash}`)) as { imagePayload?: { screen: string; buffer?: string; black?: string; red?: string } }).imagePayload;
    if (img && isPodScreen(img.screen)) content = { screen: img.screen, raw: rawContent(img.screen, img) };
  } catch { content = null; }
  return { block: proof.block, receipts: proof.receipts, parent, content };
}

(async () => {
  const input = await load();
  const report = verifyBlock(input);
  console.log(`Bloc ${report.blockHash}  (format v${report.blockVersion})`);
  for (const c of report.checks) console.log(`  ${SIGN[c.status]} ${c.label}${c.detail ? `  — ${c.detail}` : ""}`);
  console.log(`\nReçus : ${report.stats.receipts} · approbations v2 recalculées : ${report.stats.v2Accepts} · votes hérités (écho) : ${report.stats.v1Echoes} · refus : ${report.stats.rejects} · signatures invalides : ${report.stats.invalidSignatures}`);
  console.log(`NIVEAU ATTEINT : ${LEVEL_LABEL[report.level]}`);
  console.log("Ce vérificateur ne prouve PAS l'identité des appareils, la complétude des profils éligibles ni que le geste est humain.");
  process.exit(report.ok ? 0 : 1);
})().catch((e) => { console.error("erreur :", e instanceof Error ? e.message : e); process.exit(2); });
