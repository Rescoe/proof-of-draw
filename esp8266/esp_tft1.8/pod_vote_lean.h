// pod_vote_lean.h — vote v2 « léger en pile » du TFT 1,8″ (inclus par esp_tft1.8.ino quand POD_VOTE_LEAN = 1, qui REMPLACE doValidateV2 d'origine). Même comportement, mêmes messages, mêmes octets signés.
// Pourquoi (constat carte du 18/10/2026, docs/RAPPORT_VOTE_PILE_2026_10_18.md) : la pile « cont » de l'ESP8266 ne fait que 4 096 o ; le pire cadre statique du chemin de vote était doValidateV2 (592 o) posé sous doValidate (400 o) et loop (288 o)
// PENDANT la requête TLS de candidate-frame. Le vote est donc coupé en deux cadres SÉQUENTIELS : la récupération (cadre mince + podFetchAndCheck) puis la décision/signature/envoi (voteDecideAndPost, noinline) — ce dernier n'existe plus pendant le TLS de lecture.
// Le résultat de la récupération (PodCheck, ≈ 112 o) vit en BSS ; le contexte SHA-256 et le feeder aussi (POD_VOTE_STATIC_WORK, pod_vote_esp.h).
// ÉCHEC FERMÉ : si la pile cont libre (point bas depuis le démarrage) tombe sous POD_VOTE_STACK_MIN après la lecture, le vote n'est NI signé NI envoyé. Seuil 512 o : plus qu'un cadre d'interruption (≈ 100 o), un Serial.printf (≈ 250 o) et la marge d'un rappel lwip (≈ 150 o) ;
// la valeur observée AVANT ce lot était 416 o (insuffisante). Le seuil est une CONSTANTE de sécurité, pas une mesure : la mesure matérielle est imprimée sur chaque ligne [VOTE-NET].
#pragma once
#ifndef POD_VOTE_STACK_MIN
#define POD_VOTE_STACK_MIN 512u
#endif

static PodCheck g_voteChk;   // BSS : hors de la pile cont

/** Seconde moitié du vote : verdict, message signé, signature Ed25519, POST. Appelée APRÈS la fermeture de la connexion TLS de lecture. */
static bool __attribute__((noinline)) voteDecideAndPost(const String& candidateId, const String& screenName, const String& announcedHash) {
  const PodCheck& chk = g_voteChk;
  bool accept = false;
  const char* reason = podVerdict(chk, announcedHash, &accept);
  Serial.printf_P(PSTR("[VALIDATE2] %s %u o en %lu ms | e=%lu t=%lu r=%lu s=%lu | verdict=%s %s\n"), screenName.c_str(), (unsigned)chk.bytes, (unsigned long)chk.ms,
                (unsigned long)chk.m.e, (unsigned long)chk.m.t, (unsigned long)chk.m.r, (unsigned long)chk.m.s, accept ? "accept" : "reject", reason);
  Serial.println(String("[VALIDATE2] hash=") + chk.hash);

  String msg = podVoteMessage(deviceId, candidateId, chk.hash, chk.m, accept);
  uint8_t sig[64];
  Ed25519::sign(sig, privateKey, publicKey, (const uint8_t*)msg.c_str(), msg.length());

  String body = String("{\"v\":2,\"deviceId\":\"") + deviceId + "\",\"candidateId\":\"" + candidateId + "\",\"rawHash\":\"" + chk.hash + "\","
                "\"e\":" + String((unsigned long)chk.m.e) + ",\"t\":" + String((unsigned long)chk.m.t) + ",\"r\":" + String((unsigned long)chk.m.r) + ","
                "\"verdict\":\"" + (accept ? "accept" : "reject") + "\"" + (accept ? String("") : String(",\"reason\":\"") + reason + "\"") +
                ",\"signature\":\"" + bytesToHex(sig, 64) + "\"}";

  String vResp;
  bool vOk = httpPost("/api/validation-result", body, vResp);
  bool mined = false;
  if (vOk) {
    Serial.println(F("[VALIDATE2] Vote OK"));
    if (vResp.indexOf("\"blockMined\":true") >= 0) { Serial.println(F("[VALIDATE2] BLOC MINE")); mined = true; }
    if (vResp.indexOf("\"rejectObserved\":true") >= 0) Serial.println(F("[VALIDATE2] refus enregistré par le serveur (non bloquant)"));
  } else {
    Serial.println("[VALIDATE2] Echec vote (403 signature, 422 hash/métriques différents du serveur) : " + vResp);
    // 403 Signature invalide → clé publique désynchronisée : on se ré-enregistre pour la renvoyer (comme le chemin v1), le prochain cycle votera.
    if (vResp.indexOf("Signature") >= 0) { Serial.println(F("[VALIDATE2] Re-register pour resynchroniser publicKey...")); doRegister(); }
  }
  logHeapState("VALIDATE2-AFTER");
  return mined;
}

/** Première moitié : récupère et recalcule le contenu (TLS), puis passe la main. Cadre mince : aucun String volumineux, aucun PodCheck, aucune signature. */
bool doValidateV2(const String& candidateId, const String& screenName, size_t bytes, const String& announcedHash) {
  PodScreenKind kind;
  if (!podKindFromName(screenName, &kind)) { Serial.println("[VALIDATE2] écran inconnu: " + screenName); return false; }
  uint8_t* scratch = nullptr;
  size_t scratchLen = 0;
  if (kind == POD_OLED096 || kind == POD_EINK29BWR) {
    scratchLen = POD_SCRATCH_BYTES;
    scratch = (uint8_t*)malloc(scratchLen);
    if (!scratch) { Serial.println(F("[VALIDATE2] malloc scratch impossible")); return false; }
  }
  logHeapState("VALIDATE2-BEFORE");
  bool ok = podFetchAndCheck(String(SERVER_URL) + "/api/candidate-frame?candidateId=" + candidateId, kind, bytes, scratch, scratchLen, &g_voteChk);
  free(scratch);
  if (!ok) {
    Serial.printf_P(PSTR("[VALIDATE2] lecture/calcul impossible (http=%d, %u/%u octets)\n"), g_voteChk.http, (unsigned)g_voteChk.bytes, (unsigned)bytes);
    return false;
  }
  const uint32_t stackFree = ESP.getFreeContStack();
  if (stackFree < POD_VOTE_STACK_MIN) {   // échec FERMÉ : aucune signature, aucun envoi
    Serial.printf_P(PSTR("[VOTE-NET] pile cont insuffisante (%u o < %u o) : vote NON signé, NON envoyé\n"), (unsigned)stackFree, (unsigned)POD_VOTE_STACK_MIN);
    return false;
  }
  return voteDecideAndPost(candidateId, screenName, announcedHash);
}
