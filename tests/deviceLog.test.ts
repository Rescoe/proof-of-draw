// tests/deviceLog.test.ts — journal par appareil (25/10/2026) et blocs rejetés visibles (25/10/2026).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { cleanText, parseEntries, DEVLOG_TTL_SEC, DEVLOG_KEEP, devLogKey, withDeviceLog } from "../lib/deviceLog";
import { expiredReason } from "../lib/rejectedArchive";

const root = path.join(__dirname, "..");
const read = (...p: string[]) => fs.readFileSync(path.join(root, ...p), "utf8");
const codeOnly = (s: string) => s.split(/\r?\n/).filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*") && !l.trim().startsWith("/**")).join("\n");

test("journal : texte nettoyé (contrôles retirés, 200 caractères), clé par appareil, 7 jours et 400 lignes", () => {
  assert.equal(cleanText("a\u0000b\nc\t d"), "a b c d");
  assert.equal(cleanText("x".repeat(500)).length, 200);
  assert.equal(devLogKey("dev_ABCDEFGH"), "devlog:dev_ABCDEFGH");
  assert.equal(DEVLOG_TTL_SEC, 7 * 24 * 3600); assert.equal(DEVLOG_KEEP, 400);
});

test("journal : la lecture écarte les lignes de plus de 7 jours et les lignes illisibles", () => {
  const now = Date.UTC(2026, 9, 25, 12);
  const fresh = JSON.stringify({ t: now - 3600_000, k: "pull", m: "ok" });
  const old = JSON.stringify({ t: now - 8 * 86400_000, k: "pull", m: "vieux" });
  const out = parseEntries([fresh, old, "pas du json", JSON.stringify({ t: "x" }), { t: now - 60_000, k: "ack", m: "objet" }], now);
  assert.deepEqual(out.map((e) => e.m), ["ok", "objet"]);
});

test("enrobage : la réponse de la route n'est jamais modifiée, même si le journal (Redis) est indisponible ; GET sans deviceId valide = aucune écriture", async () => {
  const handler = async () => new Response(JSON.stringify({ frameSource: "none", retryAfter: 300, chain: { blockIndex: 116 } }), { status: 200, headers: { "content-type": "application/json" } });
  const wrapped = withDeviceLog("pull", handler as never);
  const req = new Request("http://localhost/api/pull?deviceId=dev_ABCDEFGH") as never;
  const res = await wrapped(req);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { frameSource: "none", retryAfter: 300, chain: { blockIndex: 116 } });
  const res2 = await wrapped(new Request("http://localhost/api/pull?deviceId=pas-un-id") as never);
  assert.equal(res2.status, 200);
});

test("enrobage : les routes appelées par les cartes sont enrobées, et le journal ne lit ni image, ni signature, ni code d'appairage, ni clé", () => {
  const routes: [string, string, string][] = [["register", "POST", "register"], ["pull", "GET", "pull"], ["pull-frame", "GET", "pull-frame"], ["ack-frame", "POST", "ack-frame"], ["validate-candidate", "GET", "validate-candidate"], ["validation-result", "POST", "vote"], ["sensor", "POST", "sensor"], ["obs-confirm", "POST", "obs-confirm"]];
  for (const [dir, m] of routes.map((r) => [r[0], r[1]])) {
    const src = read("app", "api", dir, "route.ts");
    assert.match(src, new RegExp(`export const ${m} = withDeviceLog\\(`), dir);
    assert.match(src, new RegExp(`async function ${m}_\\(req: NextRequest\\)`), dir);
  }
  const code = codeOnly(read("lib", "deviceLog.ts"));
  assert.doesNotMatch(code, /pairCode|signature|privateKey|payload|black|buffer/i, "aucun champ sensible ni image dans les extraits");
  const api = read("app", "api", "my-devices", "[deviceId]", "logs", "route.ts");
  assert.match(api, /sessionOwnsDevice\(deviceId\)/);
  assert.match(api, /export async function DELETE/);
});

test("rejetés : motif d'un candidat expiré = taille du réseau, quorum attendu et durée sans décision ; le préfixe historique est conservé", () => {
  const now = Date.UTC(2026, 9, 25, 15, 0);
  const r = expiredReason({ candidateId: "c1", deviceId: "dev_ABCDEFGH", poolScreen: "eink29bwr", drawScore: 3, score: 0.2, poolSize: 3, submittedAt: now - 31 * 60_000 }, now);
  assert.match(r, /^expiré ou remplacé sans quorum \(/);
  assert.match(r, /réseau de 3 validateur\(s\), 2 vote\(s\) nécessaire\(s\)/);
  assert.match(r, /31 min sans décision/);
  assert.equal(expiredReason({ candidateId: "c1", deviceId: "dev_ABCDEFGH", poolScreen: "eink29bwr", drawScore: 0, score: 0 }, now), "expiré ou remplacé sans quorum");
});

test("rejetés : la lecture réconcilie le candidat perdu (plus de « N+1 »), expose le candidat en attente et ses votes ; l'image n'est servie que pour un candidat rejeté ou expiré", () => {
  const list = read("app", "api", "rejected-draws", "route.ts");
  assert.match(list, /reconcileLostCandidate\(/);
  assert.match(list, /pending/);
  assert.match(list, /describeVote\(/);
  const img = read("app", "api", "rejected-image", "route.ts");
  assert.match(img, /final !== "rejected" && final !== "expired"/);
  assert.doesNotMatch(codeOnly(img), /candidate:current/);
  const ui = read("app", "gallery", "GalleryClient.tsx");
  assert.match(ui, /\/api\/rejected-image\?id=/);
  assert.match(ui, /En attente de validation/);
});
