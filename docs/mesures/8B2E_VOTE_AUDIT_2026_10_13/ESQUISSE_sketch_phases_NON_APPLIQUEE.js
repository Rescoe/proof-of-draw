// ESQUISSE DE MESURE (copie jetable, jamais appliquée au dépôt) : doValidateV2 en phases noinline + doValidate noinline.
const fs = require("fs");
const f = process.argv[2];
let t = fs.readFileSync(f, "utf8").replace(/\r\n/g, "\n");
const start = t.indexOf("static bool __attribute__((noinline)) doValidateV2(");
const end = t.indexOf("// ─── VALIDATION ───");
if (start < 0 || end < 0) { console.error("bornes"); process.exit(1); }
const neu = `
struct VoteWork { PodCheck chk; bool accept; char reason[8]; };      // au TAS (new nothrow) : sort du cadre de la voie vote
static bool __attribute__((noinline)) votePhaseRead(const String& candidateId, const String& screenName, size_t bytes, const String& announcedHash, VoteWork* w) {
  PodScreenKind kind;
  if (!podKindFromName(screenName.c_str(), &kind)) { logf("[VALIDATE2] écran inconnu : %s", screenName.c_str()); return false; }
  memset(&w->chk, 0, sizeof(w->chk));
  netReadCandidate(candidateId, kind, bytes, w->chk);
  if (!w->chk.ok) { logf("[VALIDATE2] lecture/calcul impossible (http=%d, %u/%u octets)", w->chk.http, (unsigned)w->chk.bytes, (unsigned)bytes); return false; }
  const char* reason = podVerdict(w->chk, announcedHash, &w->accept);
  strncpy(w->reason, reason, sizeof(w->reason) - 1); w->reason[sizeof(w->reason) - 1] = 0;
  logf("[VALIDATE2] hash=%s verdict=%s", w->chk.hash, w->accept ? "accept" : "reject");
  return true;
}
static bool __attribute__((noinline)) votePhaseSign(const String& candidateId, const VoteWork* w, uint8_t sig[64]) {
  const String msg = podVoteMessage(deviceId, candidateId, w->chk.hash, w->chk.m, w->accept);
  if (!PodEd::sign(sig, privateKey, publicKey, (const uint8_t*)msg.c_str(), msg.length())) { logf("[VALIDATE2] signature impossible — vote NON envoyé"); return false; }
  return true;
}
static int __attribute__((noinline)) votePhasePost(const String& candidateId, const VoteWork* w, const uint8_t sig[64], bool& mined) {
  const String body = String("{\\"v\\":2,\\"deviceId\\":\\"") + deviceId + "\\",\\"candidateId\\":\\"" + candidateId + "\\",\\"rawHash\\":\\"" + w->chk.hash + "\\"," +
                      "\\"e\\":" + String((unsigned long)w->chk.m.e) + ",\\"t\\":" + String((unsigned long)w->chk.m.t) + ",\\"r\\":" + String((unsigned long)w->chk.m.r) + "," +
                      "\\"verdict\\":\\"" + (w->accept ? "accept" : "reject") + "\\"" + (w->accept ? String("") : String(",\\"reason\\":\\"") + w->reason + "\\"") +
                      ",\\"signature\\":\\"" + bytesToHex(sig, 64) + "\\"}";
  String vResp;
  const int vCode = httpCall("POST", "/api/validation-result", &body, vResp);
  if (vCode == 200 && vResp.indexOf("\\"blockMined\\":true") >= 0) mined = true;
  if (vCode != 200 && vResp.indexOf("Signature") >= 0) registered = false;
  return vCode;
}
static bool __attribute__((noinline)) doValidateV2(const String& candidateId, const String& screenName, size_t bytes, const String& announcedHash) {
  VoteWork* const w = new (std::nothrow) VoteWork();
  if (!w) { logf("[VALIDATE2] mémoire insuffisante : pas de vote"); return false; }
  bool mined = false;
  uint8_t sig[64];
  if (votePhaseRead(candidateId, screenName, bytes, announcedHash, w) && votePhaseSign(candidateId, w, sig)) {
    const int code = votePhasePost(candidateId, w, sig, mined);
    logf("[VALIDATE2] vote -> %d", code);
  }
  delete w;
  return mined;
}

`;
t = t.slice(0, start) + neu + t.slice(end);
// (variante A : doValidate reste inline)
fs.writeFileSync(f, t);
console.log("ok");
