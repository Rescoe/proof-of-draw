// esp_eink_2.9BWR_v2.ino
// Proof-of-Draw — Firmware v2.0
//
// NOUVEAUTÉS vs v1.5 :
//   1. Génération d'une paire de clés ED25519 au premier boot
//      → clé privée stockée en EEPROM (offset 0, 32 bytes)
//      → clé publique affichée UNE SEULE FOIS sur l'e-ink (cold save)
//      → les boots suivants chargent la clé depuis EEPROM
//
//   2. Boucle de validation distribuée
//      → après chaque pull, vérifie si un candidat attend validation
//      → si oui : fetch le candidat, calcule métriques locales, vote
//      → métriques : entropie Shannon, transitions pixels, RLE complexity
//
//   3. Mode personal frame
//      → le pull reçoit maintenant frameSource (consensus | personal | none)
//      → le firmware gère les deux modes d'affichage
//
//   4. Synchronisation état chaîne
//      → le pull retourne chain_summary : blockHash, displayTime, blockIndex
//      → le firmware stocke le blockHash courant en EEPROM (offset 32, 32 bytes)
//
//   5. Signature simplifiée V1
//      → "deviceId:candidateId:score" — pas encore de vraie crypto asymétrique
//      → V2 : remplacé par ED25519 sign avec la clé privée EEPROM
//
// CONTRAINTES MÉMOIRE (inchangées) :
//   → L'écran e-ink n'est init qu'APRÈS le register TLS
//   → Les buffers sont free/malloc autour de chaque requête HTTPS
//   → Heap disponible avant pull : ~47KB

#include <Arduino.h>
#include <ESP8266WiFi.h>
#include <ESP8266HTTPClient.h>
#include <WiFiClientSecure.h>
#include <ArduinoJson.h>
#include <qrcode.h>
#include <EEPROM.h>
#include "epd2in9b_V4.h"
#include "epdif.h"
#include <Ed25519.h>       // Bibliothèque Crypto (rhempel) — ED25519 réel // Crypto by Rhys Weatherley
#include "pod_vote_esp.h"  // validation réelle (vote v2) : SHA-256 + métriques entières en flux — ⚠ NON TESTÉ sur le matériel

// POD_RENDER_V1_BEGIN
// ─── Rendu v1 EN FLUX (lot 8B-2A) — INACTIF PAR DÉFAUT ────────────────────────────────────────────────────────────────────────────────────────────
// 0 (défaut) : comportement d'avant, octet pour octet (cartel gravé par burnEinkCartel_29, Display() des plans complets).
// 1 : l'image reçue (blackBuf / redBuf, JAMAIS modifiés) est rendue par le noyau gelé consensus-pod/src/podRenderStream.h (layoutVersion 1 : cartel, fit) et remise au pilote PAR MORCEAUX de 32 octets
//     (Epd::DisplayStream) ; frameHash (octets reçus) et renderHash (octets remis) sont CALCULÉS et seulement journalisés — l'ACK, les routes et le rapport de rendu ne sont PAS modifiés.
// ⚠ NON ESSAYÉ SUR LA CARTE. Ne pas activer sans le lot 8B-2B (canari) : docs/LOT_8B2A_INTEGRATION_CANARIS_2026_10_08.md.
#ifndef POD_RENDER_V1
#define POD_RENDER_V1 0
#endif
#ifndef POD_RENDER_MODE_DEFAULT
#define POD_RENDER_MODE_DEFAULT POD_R_FIT   // constante de compilation : le réglage cartelMode n'est PAS exposé (pas d'interface, pas de réglage serveur)
#endif
#ifndef POD_CANARY
#define POD_CANARY 0   // 1 = BUILD LOCAL TEMPORAIRE de CANARI (-DPOD_RENDER_V1=1 -DPOD_CANARY=1) : frame personnelle -> rendu -> ACK instrumentés, AUCUN vote ; sans effet si POD_RENDER_V1 = 0. NE JAMAIS COMMITER 1 (docs/LOT_8B2C_ESP8266_EINK29_CANARY_2026_10_12.md).
#endif
#if POD_RENDER_V1
#include "podRenderStream.h"
#include "crypto_esp8266.h"
#endif
// POD_RENDER_V1_END

// ─── CONFIG ────────────────────────────────────────────────────────────────
// Wi-Fi : copier secrets.h.example en secrets.h (ignoré par git : les identifiants ne doivent JAMAIS être commités), puis renseigner SSID / mot de passe (2,4 GHz).
#if __has_include("secrets.h")
  #include "secrets.h"
  const char* WIFI_SSID     = SECRET_WIFI_SSID;
  const char* WIFI_PASSWORD = SECRET_WIFI_PASSWORD;
#else
  const char* WIFI_SSID     = "";            // ← renseigner (ou créer secrets.h)
  const char* WIFI_PASSWORD = "";
#endif


#define SERVER_URL      "https://proof-of-draw.vercel.app"
#define SCREEN_TYPE     "eink29bwr"
#define PULL_INTERVAL   60000UL  // 1min
#define VALIDATE_INTERVAL 30000UL // 30s — check si candidat en attente
#define EINK_MIN_REFRESH_MS 10000UL

// ─── EEPROM layout ─────────────────────────────────────────────────────────
// [0..31]   : clé privée ED25519 (32 bytes)
// [32..63]  : blockHash courant (32 hex chars = première moitié du hash 64 chars)
// [64]      : keyGenerated flag
// [65..96]  : clé publique (32 bytes)
// [97]      : onboarding shown flag
// [98]      : owned_head   — index de tête du ring buffer (0-9)
// [99]      : owned_count  — nombre de slots valides (0-10)
// [100..419]: owned slots  — 10 × 32 bytes = 320 bytes (hashes de blocs possédés)
// [420..511]: réservé
#define EEPROM_SIZE           512
#define EEPROM_PRIVKEY_OFF    0
#define EEPROM_BLOCKHASH_OFF  32
#define EEPROM_FLAG_OFF       64
#define EEPROM_PUBKEY_OFF     65
#define KEY_GENERATED_FLAG    0xED   // 0xED = ED25519 réel (0x01 = ancienne V1 fake)
#define EEPROM_ONBOARDING_OFF 97
#define ONBOARDING_SHOWN_FLAG 0x01
// Slots de blocs possédés
#define EEPROM_OWNED_HEAD_OFF  98
#define EEPROM_OWNED_COUNT_OFF 99
#define EEPROM_OWNED_SLOTS_OFF 100
#define OWNED_SLOTS_MAX        10
#define OWNED_HASH_LEN         32   // 32 premiers chars du hash hex (suffisant pour ID unique)

// ─── ÉCRAN ─────────────────────────────────────────────────────────────────
#define IMG_W    296
#define IMG_H    128
#define BUF_SIZE ((IMG_H * IMG_W) / 8)   // 4736

Epd epd;
unsigned long lastRefreshMs = 0;
bool einkReady = false;

uint8_t* blackBuf = nullptr;
uint8_t* redBuf   = nullptr;

// ─── STATE ─────────────────────────────────────────────────────────────────
String deviceId, pairCode, canvasUrl;
bool   registered        = false;
bool   paired            = false;
bool   frameReady        = false;
String lastFrameId       = "";
bool   hasDisplayedFrame = false;

// Clés (V1 : seed aléatoire 32 bytes, pas de vraie ED25519)
uint8_t privateKey[32];
uint8_t publicKey[32];   // V1 : dérivé simplement du private (XOR + hash maison)
bool    keysLoaded = false;

// État chaîne
String currentBlockHash = "";
int    currentBlockIndex = -1;
unsigned long displayTimeRemaining = 0;

// Validation
String pendingCandidateId = "";
unsigned long lastValidateMs    = 0;
unsigned long lastPullMs        = 0;
unsigned long nextPullIntervalMs = PULL_INTERVAL;  // adapté par retryAfter serveur

bool lastFrameWasConsensus = false;

// Métadonnées cartel (lues depuis cartelMeta du pull)
String pendingWorkTitle  = "";
String pendingArtistName = "";
String pendingDisplayTs  = "";

// Ré-validation (Axe 3)
String pendingObsHashes  = "";   // JSON array de hashes en attente
String pendingObsTarget  = "";   // targetBlockHash (hash du bloc portant les revalidated[])

#if POD_RENDER_V1 && POD_CANARY
// ─── CANARI ESP8266 e-ink 2,9″ (LOT8B2C-ESP8266-EINK29-CANARY-1) ─────────────────────────────────────────────────────────────────────────────────────────────
// Valide UNIQUEMENT : démarrage -> Wi-Fi -> register -> pull sans frame -> frame PERSONNELLE (9 472 o) -> TLS fermé -> frameHash -> rendu v1 en flux -> remise au pilote -> ACK. Aucun vote, aucune animation, aucun OTA.
//  • AUCUN VOTE : doValidate() oublie localement le candidat annoncé (UNE ligne) avant tout réseau ; doObsConfirm() n'envoie rien. Pas de validation-result, pas de signature, pas de bloc.
//  • Trace de PHASES en mémoire RTC utilisateur (survit à un reset logiciel, de chien de garde ou d'exception, pas à une coupure d'alimentation) : relue au démarrage suivant avec la CAUSE du reset.
//    Deux redémarrages ANORMAUX consécutifs (chien de garde / exception) => ARRÊT (le canari ne boucle jamais sur le serveur).
//  • Mesures : tas libre, plus grand bloc libre, fragmentation, pile « cont » libre, durée de chaque étape ; pile « cont » minimale et temps entre deux yield() PENDANT le flux vers le pilote.
//  • Pré-vol TLS : si le tas ne permet pas BearSSL (iobuf 16 384 + 512, pile de poussée 6 200, contextes) on refuse AVANT de construire WiFiClientSecure (le cœur abort() si la pile de poussée ne peut pas être allouée).
//  • Corps : Content-Length connu et != 9 472, ou octets en trop disponibles => lecture refusée (aucun rendu, aucun ACK).
// RAM : chaînes en flash (F / PSTR), statiques < 100 o. Tout est ABSENT quand POD_CANARY = 0.
#define PCR_MAGIC 0x50434E52UL                 // « PCNR »
#define POD_CANARY_TLS_MIN_HEAP  24000UL      // iobuf 16 384 + 512 + pile de poussée 6 200 = 23 096 o + 900 o de contextes
#define POD_CANARY_TLS_MIN_BLOCK 17000UL      // iobuf d'entrée (16 384) contigu + en-tête
#define POD_CANARY_YIELD_ALERT_US 500000UL    // plus de 0,5 s entre deux appels du producteur : le chien de garde logiciel (≈ 3,2 s) approche
struct PodCanaryRtc { uint32_t magic, seq, phase, abn; };   // 16 o
enum PodCanaryPhase : uint8_t { PCP_NONE = 0, PCP_BOOT, PCP_WIFI, PCP_REGISTER, PCP_PULL, PCP_FETCH, PCP_PLANES, PCP_TLS_OPEN, PCP_BODY, PCP_TLS_CLOSED, PCP_FRAMEHASH, PCP_PANEL, PCP_STREAM, PCP_FINISH, PCP_ACK, PCP_DONE };
static PodCanaryRtc g_pcRtc = { 0, 0, 0, 0 };
static uint32_t g_pcStepMs = 0, g_pcHeapPre = 0, g_pcMinHeap = 0xFFFFFFFFUL, g_pcCalls = 0, g_pcEnterUs = 0, g_pcLastEndUs = 0, g_pcMaxCallUs = 0, g_pcMaxGapUs = 0;
static uint16_t g_pcMinStack = 0xFFFF;
// BALLAST DE REPRÉSENTATIVITÉ : le canari ÉLIMINE le chemin de vote (doValidate retourne avant tout) ; le compilateur retire alors ≈ 1,2 Ko de RAM statique que le build POD_RENDER_V1=1 NON canari conserve.
// Sans ballast, le tas mesuré serait ≈ 1,2 Ko trop OPTIMISTE pour la configuration à valider. Valeur mesurée (cœur 3.1.2, gcc 10.3, ArduinoJson 7.4.3) : ON 35 056 o − canari 33 820 o = 1 236 o ; le démarrage
// affiche la RAM statique réelle pour la comparer à la référence ON.
static volatile uint8_t g_pcBallast[1284];
extern "C" { extern char _data_start; extern char _bss_end; }
static const __FlashStringHelper* canaryPhaseName(uint32_t p) {
  switch (p) {
    case PCP_BOOT: return F("BOOT"); case PCP_WIFI: return F("WIFI"); case PCP_REGISTER: return F("REGISTER"); case PCP_PULL: return F("PULL"); case PCP_FETCH: return F("FETCH");
    case PCP_PLANES: return F("PLANES"); case PCP_TLS_OPEN: return F("TLS_OUVERT"); case PCP_BODY: return F("CORPS_LU"); case PCP_TLS_CLOSED: return F("TLS_FERME"); case PCP_FRAMEHASH: return F("FRAMEHASH");
    case PCP_PANEL: return F("PANNEAU_INIT"); case PCP_STREAM: return F("FLUX_PILOTE"); case PCP_FINISH: return F("RENDERHASH"); case PCP_ACK: return F("ACK"); case PCP_DONE: return F("TERMINE");
    default: return F("AUCUNE");
  }
}
/** Inscrit la phase en RTC (écrit AVANT l'étape, relu après un reset) puis journalise : durée depuis l'étape précédente, tas, plus grand bloc, fragmentation, pile « cont » libre. */
static void canaryStep(uint8_t phase, const __FlashStringHelper* label) {
  g_pcRtc.magic = PCR_MAGIC; g_pcRtc.seq++; g_pcRtc.phase = phase;
  ESP.rtcUserMemoryWrite(0, (uint32_t*)&g_pcRtc, sizeof(g_pcRtc));
  const uint32_t now = millis(), h = ESP.getFreeHeap();
  if (h < g_pcMinHeap) g_pcMinHeap = h;
  Serial.print(F("[CANARY] ")); Serial.print(label);
  Serial.printf_P(PSTR(" : +%lums tas=%u maxBloc=%u frag=%u%% pile=%u t=%lu\n"), (unsigned long)(now - g_pcStepMs), h, ESP.getMaxFreeBlockSize(), ESP.getHeapFragmentation(), ESP.getFreeContStack(), (unsigned long)now);
  g_pcStepMs = now;
}
static void canaryBoot() {
  Serial.println(F("[CANARY] BUILD LOT8B2C-ESP8266-EINK29-CANARY-1 | base 3239d2e | POD_RENDER_V1=1 POD_CANARY=1 | AUCUN VOTE | compile " __DATE__ " " __TIME__));
  const uint32_t reason = ESP.getResetInfoPtr()->reason;   // 0 alim · 1 chien de garde MATÉRIEL · 2 exception · 3 chien de garde LOGICIEL · 4 redémarrage logiciel · 5 réveil · 6 reset externe
  PodCanaryRtc prev = { 0, 0, 0, 0 };
  ESP.rtcUserMemoryRead(0, (uint32_t*)&prev, sizeof(prev));
  const bool valid = prev.magic == PCR_MAGIC;
  const bool abnormal = reason == 1 || reason == 2 || reason == 3;
  Serial.printf_P(PSTR("[CANARY] cause du dernier reset = %u (%s) | RTC %s derniere phase=%u"), (unsigned)reason, ESP.getResetReason().c_str(), valid ? "valide" : "absente", valid ? (unsigned)prev.phase : 0u);
  if (valid) { Serial.print(F(" (")); Serial.print(canaryPhaseName(prev.phase)); Serial.printf_P(PSTR(") seq=%u anormaux=%u"), (unsigned)prev.seq, (unsigned)prev.abn); }
  Serial.println();
  g_pcRtc.abn = abnormal ? (valid ? prev.abn : 0) + 1 : 0;
  if (abnormal) Serial.println(F("[CANARY] ALERTE : redemarrage ANORMAL (chien de garde ou exception) — la derniere phase ci-dessus localise la faute"));
  if (g_pcRtc.abn >= 2) {
    g_pcRtc.magic = PCR_MAGIC; ESP.rtcUserMemoryWrite(0, (uint32_t*)&g_pcRtc, sizeof(g_pcRtc));
    Serial.println(F("[CANARY] ARRET : deux redemarrages anormaux consecutifs — aucun reseau (couper l'alimentation pour rearmer)"));
    for (;;) delay(1000);
  }
  g_pcBallast[0] = 0xA5;   // référencé : sinon --gc-sections retire le ballast
  Serial.printf_P(PSTR("[CANARY] RAM statique=%u o (reference ON non-canari : 35056 o ; ballast %u o)\n"), (unsigned)(&_bss_end - &_data_start), (unsigned)sizeof(g_pcBallast));
  g_pcStepMs = millis();
  canaryStep(PCP_BOOT, F("demarrage"));
}
/** Pré-vol AVANT de construire un WiFiClientSecure (téléchargement ET ACK : les deux plans de 9 472 o sont encore vivants dans les deux cas) : false = pas assez de tas pour BearSSL ;
 *  aucune allocation, aucun TLS ouvert. `consequence` dit ce qui arrive à l'appelant (le journal ne ment jamais sur l'état de l'écran ni de l'ACK). */
static bool canaryTlsPreflight(uint8_t phase, const __FlashStringHelper* label, const __FlashStringHelper* consequence) {
  g_pcHeapPre = ESP.getFreeHeap();
  canaryStep(phase, label);
  if (g_pcHeapPre < POD_CANARY_TLS_MIN_HEAP || ESP.getMaxFreeBlockSize() < POD_CANARY_TLS_MIN_BLOCK) {
    Serial.printf_P(PSTR("[CANARY] REFUS pre-vol TLS : tas=%u (min %lu) maxBloc=%u (min %lu) — "), g_pcHeapPre, POD_CANARY_TLS_MIN_HEAP, ESP.getMaxFreeBlockSize(), POD_CANARY_TLS_MIN_BLOCK);
    Serial.println(consequence);
    return false;
  }
  return true;
}
/** Après la fermeture du scope TLS : le tas doit être revenu au niveau d'avant la connexion (à 1 Ko près). Rapport seulement (une fragmentation transitoire de lwIP n'est pas une faute). */
static void canaryAfterTls() {
  canaryStep(PCP_TLS_CLOSED, F("TLS FERME (client detruit)"));
  const uint32_t h = ESP.getFreeHeap();
  if (h + 1024UL < g_pcHeapPre) Serial.printf_P(PSTR("[CANARY] ALERTE tas non restitue apres la fermeture TLS : %u < %u (avant) — fuite possible\n"), h, g_pcHeapPre);
  else Serial.printf_P(PSTR("[CANARY] tas restitue apres la fermeture TLS : %u (avant %u, minimum observe %u)\n"), h, g_pcHeapPre, g_pcMinHeap);
}
static void canaryProduceEnter() {
  g_pcEnterUs = micros();
  if (g_pcLastEndUs != 0) { const uint32_t gap = g_pcEnterUs - g_pcLastEndUs; if (gap > g_pcMaxGapUs) g_pcMaxGapUs = gap; }
  const uint32_t st = ESP.getFreeContStack(); if (st < g_pcMinStack) g_pcMinStack = (uint16_t)st;
}
static void canaryProduceLeave() {
  g_pcLastEndUs = micros(); g_pcCalls++;
  const uint32_t d = g_pcLastEndUs - g_pcEnterUs; if (d > g_pcMaxCallUs) g_pcMaxCallUs = d;
}
static void canaryStreamReport() {
  Serial.printf_P(PSTR("[CANARY] flux pilote : %lu appels du producteur, plus long appel=%luus, plus long intervalle entre appels=%luus%s, pile cont minimale=%u o\n"),
                  (unsigned long)g_pcCalls, (unsigned long)g_pcMaxCallUs, (unsigned long)g_pcMaxGapUs, g_pcMaxGapUs > POD_CANARY_YIELD_ALERT_US ? " (ALERTE chien de garde)" : "", (unsigned)g_pcMinStack);
}
#endif
// ─── EEPROM helpers ────────────────────────────────────────────────────────

bool onboardingAlreadyShown() {
  return EEPROM.read(EEPROM_ONBOARDING_OFF) == ONBOARDING_SHOWN_FLAG;
}

void setOnboardingShown() {
  EEPROM.write(EEPROM_ONBOARDING_OFF, ONBOARDING_SHOWN_FLAG);
  EEPROM.commit();
}

void eepromInit() {
  EEPROM.begin(EEPROM_SIZE);
}

bool keysAlreadyGenerated() {
  return EEPROM.read(EEPROM_FLAG_OFF) == KEY_GENERATED_FLAG;
}

void saveKeysToEEPROM() {
  for (int i = 0; i < 32; i++) EEPROM.write(EEPROM_PRIVKEY_OFF + i, privateKey[i]);
  for (int i = 0; i < 32; i++) EEPROM.write(EEPROM_PUBKEY_OFF  + i, publicKey[i]);
  EEPROM.write(EEPROM_FLAG_OFF, KEY_GENERATED_FLAG);
  EEPROM.commit();
}

void loadKeysFromEEPROM() {
  for (int i = 0; i < 32; i++) privateKey[i] = EEPROM.read(EEPROM_PRIVKEY_OFF + i);
  for (int i = 0; i < 32; i++) publicKey[i]  = EEPROM.read(EEPROM_PUBKEY_OFF  + i);

  // Validation cohérence : si commit interrompu (watchdog/power cut) entre
  // l'écriture privKey et pubKey, on se retrouve avec pubKey = 0xFF corrompue.
  // Re-dériver depuis privKey et corriger en EEPROM si nécessaire.
  uint8_t derived[32];
  Ed25519::derivePublicKey(derived, privateKey);
  if (memcmp(derived, publicKey, 32) != 0) {
    Serial.println("[KEYS] Clé publique EEPROM incohérente → recalcul depuis clé privée");
    memcpy(publicKey, derived, 32);
    for (int i = 0; i < 32; i++) EEPROM.write(EEPROM_PUBKEY_OFF + i, publicKey[i]);
    EEPROM.commit();
    Serial.println("[KEYS] Clé publique corrigée et sauvegardée");
  }
  keysLoaded = true;
}

void saveBlockHashToEEPROM(const String& hash) {
  // Stocke les 16 premiers bytes du hash (32 hex chars)
  String h = hash.length() >= 32 ? hash.substring(0, 32) : hash;
  h += String(' ', 32);  // padding
  for (int i = 0; i < 32; i++) {
    EEPROM.write(EEPROM_BLOCKHASH_OFF + i, (uint8_t)h[i]);
  }
  EEPROM.commit();
}

String loadBlockHashFromEEPROM() {
  String hash = "";
  for (int i = 0; i < 32; i++) {
    char c = (char)EEPROM.read(EEPROM_BLOCKHASH_OFF + i);
    if (c == ' ' || c == '\0') break;
    hash += c;
  }
  return hash;
}

// ─── Blocs possédés (EEPROM ring buffer) ───────────────────────────────────

// Sauvegarde un hash de bloc possédé dans le ring buffer EEPROM.
// Écrit les 32 premiers chars du hash hex (suffisant pour identification unique).
// Ring buffer circulaire : déborde proprement sur les plus vieux slots.
void saveOwnedBlockHash(const String& fullHash) {
  if (fullHash.length() < 16) return;  // hash trop court, ignore

  // Tronque ou complète à OWNED_HASH_LEN chars
  String h = fullHash.length() >= OWNED_HASH_LEN
             ? fullHash.substring(0, OWNED_HASH_LEN)
             : fullHash;
  while ((int)h.length() < OWNED_HASH_LEN) h += ' ';

  uint8_t head  = EEPROM.read(EEPROM_OWNED_HEAD_OFF);
  uint8_t count = EEPROM.read(EEPROM_OWNED_COUNT_OFF);
  if (head  >= OWNED_SLOTS_MAX) head  = 0;
  if (count >  OWNED_SLOTS_MAX) count = 0;

  // Vérifie si ce hash est déjà stocké (évite les doublons après re-notification)
  for (uint8_t i = 0; i < count; i++) {
    uint8_t slot = (head - count + i + OWNED_SLOTS_MAX) % OWNED_SLOTS_MAX;
    int off = EEPROM_OWNED_SLOTS_OFF + slot * OWNED_HASH_LEN;
    bool match = true;
    for (int j = 0; j < OWNED_HASH_LEN && match; j++) {
      if ((char)EEPROM.read(off + j) != h[j]) match = false;
    }
    if (match) {
      Serial.println("[OWNED] Hash déjà stocké, skip");
      return;
    }
  }

  // Écriture dans le slot de tête
  int slotOff = EEPROM_OWNED_SLOTS_OFF + head * OWNED_HASH_LEN;
  for (int i = 0; i < OWNED_HASH_LEN; i++)
    EEPROM.write(slotOff + i, (uint8_t)h[i]);

  head  = (head + 1) % OWNED_SLOTS_MAX;
  count = min((int)count + 1, (int)OWNED_SLOTS_MAX);

  EEPROM.write(EEPROM_OWNED_HEAD_OFF,  head);
  EEPROM.write(EEPROM_OWNED_COUNT_OFF, count);
  EEPROM.commit();

  Serial.printf("[OWNED] Bloc sauvegardé: %s... (%u/%u slots)\n",
                h.substring(0, 8).c_str(), count, OWNED_SLOTS_MAX);
}

// Retourne un JSON array des hashes possédés stockés en EEPROM.
// Du plus récent au plus ancien (lecture depuis la tête vers l'arrière).
String loadOwnedHashesJson() {
  uint8_t head  = EEPROM.read(EEPROM_OWNED_HEAD_OFF);
  uint8_t count = EEPROM.read(EEPROM_OWNED_COUNT_OFF);
  if (head  >= OWNED_SLOTS_MAX) head  = 0;
  if (count  > OWNED_SLOTS_MAX) count = 0;
  if (count == 0) return "[]";

  String json = "[";
  bool first = true;
  // Du plus récent (head-1) au plus ancien
  for (uint8_t i = 0; i < count; i++) {
    uint8_t slot = (head - 1 - i + OWNED_SLOTS_MAX) % OWNED_SLOTS_MAX;
    int off = EEPROM_OWNED_SLOTS_OFF + slot * OWNED_HASH_LEN;
    String h = "";
    for (int j = 0; j < OWNED_HASH_LEN; j++) {
      char c = (char)EEPROM.read(off + j);
      if (c == ' ' || c == '\0') break;
      h += c;
    }
    if (h.length() >= 8) {
      if (!first) json += ",";
      json += "\"" + h + "\"";
      first = false;
    }
  }
  json += "]";
  return json;
}

// ─── Génération de clés ED25519 réelle ───────────────────────────────────────
// Utilise la bibliothèque Crypto (rhempel) : Ed25519::derivePublicKey()
// Clé privée = seed 32 bytes entropiques (ADC bruit + millis + WiFi RSSI)
// Clé publique = point sur la courbe Ed25519 — vraie cryptographie asymétrique

void generateKeys() {
  Serial.println("[KEYS] Génération paire ED25519...");

  // Seed multi-sources pour maximiser l'entropie sur ESP8266
  randomSeed(analogRead(A0) ^ millis() ^ (uint32_t)WiFi.RSSI());

  for (int i = 0; i < 32; i++) {
    privateKey[i] = (uint8_t)(random(256) ^ (analogRead(A0) & 0xFF));
    delayMicroseconds(100);
  }

  // Dérivation réelle : calcul sur la courbe Ed25519
  Ed25519::derivePublicKey(publicKey, privateKey);
  keysLoaded = true;

  saveKeysToEEPROM();
  Serial.println("[KEYS] Paire ED25519 générée et sauvegardée");
  Serial.println("[KEYS] PubKey: " + bytesToHex(publicKey, 32));
}

// Convertit un buffer de bytes en hex string
String bytesToHex(const uint8_t* buf, size_t len) {
  String hex = "";
  hex.reserve(len * 2);
  for (size_t i = 0; i < len; i++) {
    if (buf[i] < 16) hex += "0";
    hex += String(buf[i], HEX);
  }
  return hex;
}

// ─── Signature ED25519 ───────────────────────────────────────────────────────
// Message signé : "deviceId:candidateId:score" (3 décimales)
// Signature : 64 bytes → 128 chars hex envoyés au serveur

String signED25519(const String& candidateId, float score) {
  char scoreStr[8];
  dtostrf(score, 1, 3, scoreStr);
  String message = deviceId + ":" + candidateId + ":" + String(scoreStr);

  uint8_t sig[64];
  Ed25519::sign(sig, privateKey, publicKey,
                (const uint8_t*)message.c_str(), message.length());

  String sigHex = bytesToHex(sig, 64);

  // Debug : imprime pubKey + message + signature pour vérification manuelle
  // avec /api/debug/verify-sig?secret=X&pubKey=...&msg=...&sig=...
  Serial.println("[SIGN] PUBKEY: " + bytesToHex(publicKey, 32));
  Serial.println("[SIGN] MSG: " + message);
  Serial.println("[SIGN] SIG: " + sigHex);

  return sigHex;
}

// ─── MÉTRIQUES DE COMPLEXITÉ (calculées sur les buffers e-ink bruts) ───────

// Entropie de Shannon sur un buffer 1-bit (0=blanc, 1=noir)
// Retourne [0,1] — 1.0 = 50/50 noir/blanc, 0 = uniforme
float computeEntropy(const uint8_t* buf, size_t byteCount) {
  long ones = 0;
  long total = byteCount * 8;

  for (size_t i = 0; i < byteCount; i++) {
    uint8_t b = buf[i];
    // Compte les bits à 0 (pixels noirs dans convention e-ink : 0=actif)
    for (int bit = 0; bit < 8; bit++) {
      if (!((b >> bit) & 1)) ones++;
    }
  }

  if (ones == 0 || ones == total) return 0.0f;

  float p1 = (float)ones / total;
  float p0 = 1.0f - p1;

  // log2(x) ≈ ln(x) / ln(2)
  return -(p1 * (log(p1) / log(2.0f)) + p0 * (log(p0) / log(2.0f)));
}

// Densité de transitions horizontales (bords dans l'image)
// Opère directement sur les bytes — compare bits adjacents entre bytes
float computeTransitions(const uint8_t* buf, int width, int height) {
  // Dans le buffer e-ink, chaque byte contient 8 pixels MSB first
  // On compte les changements de bit entre pixels consécutifs sur chaque ligne
  long transitions = 0;
  int bytesPerRow  = width / 8;
  long total       = (long)(width - 1) * height;  // adjacences horizontales

  for (int y = 0; y < height; y++) {
    for (int x = 0; x < width - 1; x++) {
      // Pixel x dans le buffer
      int byteIdx1 = y * bytesPerRow + x / 8;
      int bitIdx1  = 7 - (x % 8);
      int p1       = (buf[byteIdx1] >> bitIdx1) & 1;

      // Pixel x+1
      int byteIdx2 = y * bytesPerRow + (x + 1) / 8;
      int bitIdx2  = 7 - ((x + 1) % 8);
      int p2       = (buf[byteIdx2] >> bitIdx2) & 1;

      if (p1 != p2) transitions++;
    }
    yield();  // évite watchdog sur lignes longues
  }

  return total > 0 ? (float)transitions / total : 0.0f;
}

// RLE complexity : ratio runs/pixels, normalisé
// Opère sur les pixels extraits séquentiellement (row-major)
float computeRLE(const uint8_t* buf, size_t byteCount) {
  if (byteCount == 0) return 0.0f;

  long runs = 1;
  long total = byteCount * 8;
  int  prevBit = (buf[0] >> 7) & 1;

  for (size_t i = 0; i < byteCount; i++) {
    uint8_t b = buf[i];
    for (int bit = 6; bit >= 0; bit--) {  // commence à bit 6 (on a déjà pris bit 7)
      int curBit = (b >> bit) & 1;
      if (curBit != prevBit) { runs++; prevBit = curBit; }
    }
    if (i < byteCount - 1) {
      // Transition entre bytes
      int nextFirstBit = (buf[i + 1] >> 7) & 1;
      if (nextFirstBit != prevBit) { runs++; prevBit = nextFirstBit; }
      // On recommence à bit 6 pour le prochain byte
    }
    yield();
  }

  return sqrt((float)runs / total);  // sqrt pour linéariser
}

// Score composite : entropie 40% + transitions 40% + RLE 20%
float computeComplexityScore(const uint8_t* blackBufPtr, const uint8_t* redBufPtr, size_t bufSize) {
  // Merge black + red : pixel actif = noir OU rouge (OR logique sur les bits)
  // Note : en convention e-ink, 0=actif, 1=blanc — on inversera pour les métriques
  static uint8_t merged[BUF_SIZE];  // static pour ne pas empiler sur la stack

  for (size_t i = 0; i < bufSize; i++) {
    // 0=actif dans e-ink → on inverse pour avoir 1=actif dans nos métriques
    // merged[i] = ~(blackBufPtr[i] & redBufPtr[i])  // 1 = pixel actif (noir ou rouge)
    // En pratique on calcule sur les buffers tels quels — la symétrie ne change pas l'entropie
    merged[i] = blackBufPtr[i] & redBufPtr[i];  // 0 = actif (logique e-ink)
  }

  float entropy     = computeEntropy(merged, bufSize);
  float transitions = computeTransitions(merged, IMG_W, IMG_H);
  float rle         = computeRLE(merged, bufSize);

  float score = entropy * 0.4f + transitions * 0.4f + rle * 0.2f;
  if (score > 1.0f) score = 1.0f;

  Serial.printf("[METRICS] entropy=%.3f transitions=%.3f rle=%.3f score=%.3f\n",
                entropy, transitions, rle, score);

  return score;
}

// ─── HTTP HELPERS ───────────────────────────────────────────────────────────


bool httpPost(const String& path, const String& body, String& resp) {
  WiFiClientSecure client;
  client.setInsecure();

  HTTPClient http;
  String url = String(SERVER_URL) + path;

  Serial.println("[HTTP POST] URL: " + url);
  Serial.println("[HTTP POST] body len: " + String(body.length()));

  if (!http.begin(client, url)) {
    Serial.println("[HTTP POST] begin() failed");
    return false;
  }

  http.addHeader("Content-Type", "application/json");
  http.setTimeout(15000);

  int code = http.POST(body);
  resp = (code > 0) ? http.getString() : "";

  Serial.printf("[HTTP POST] %s → %d\n", path.c_str(), code);
  if (code > 0) Serial.println("[HTTP POST] resp: " + resp);

  http.end();
  return code == 200;
}

bool httpGet(const String& path, String& resp, int* codeOut = nullptr) {
  WiFiClientSecure client;
  client.setInsecure();

  HTTPClient http;
  if (!http.begin(client, String(SERVER_URL) + path)) {
    Serial.println("[HTTP GET] begin() failed");
    return false;
  }

  http.setTimeout(20000);

  int code = http.GET();
  if (codeOut) *codeOut = code;

  resp = "";
  if (code > 0) {
    resp = http.getString();
  }

  http.end();

  Serial.printf("[HTTP GET] %s → %d (%u bytes)\n", path.c_str(), code, resp.length());
  return code == 200 || code == 429;
}

// ─── PIXEL HELPERS (inchangés vs v1.5) ─────────────────────────────────────

inline void setPixel(uint8_t* buf, int x, int y) {
  if (x < 0 || x >= IMG_W || y < 0 || y >= IMG_H) return;
  int xr = y;
  int yr = IMG_W - 1 - x;
  yr = IMG_W - 1 - yr;  // = x
  int byteIndex = (yr * (IMG_H / 8)) + (xr / 8);
  int bitMask   = 0x80 >> (xr & 7);
  buf[byteIndex] &= ~bitMask;
}

// ─── FONT 5×7 (identique v1.5) ─────────────────────────────────────────────
static const uint8_t FONT_5x7[][5] PROGMEM = {
  {0x3E,0x51,0x49,0x45,0x3E},{0x00,0x42,0x7F,0x40,0x00},{0x42,0x61,0x51,0x49,0x46},
  {0x21,0x41,0x45,0x4B,0x31},{0x18,0x14,0x12,0x7F,0x10},{0x27,0x45,0x45,0x45,0x39},
  {0x3C,0x4A,0x49,0x49,0x30},{0x01,0x71,0x09,0x05,0x03},{0x36,0x49,0x49,0x49,0x36},
  {0x06,0x49,0x49,0x29,0x1E},{0x7C,0x12,0x11,0x12,0x7C},{0x7F,0x49,0x49,0x49,0x36},
  {0x3E,0x41,0x41,0x41,0x22},{0x7F,0x41,0x41,0x22,0x1C},{0x7F,0x49,0x49,0x49,0x41},
  {0x7F,0x09,0x09,0x09,0x01},{0x3E,0x41,0x49,0x49,0x7A},{0x7F,0x08,0x08,0x08,0x7F},
  {0x00,0x41,0x7F,0x41,0x00},{0x20,0x40,0x41,0x3F,0x01},{0x7F,0x08,0x14,0x22,0x41},
  {0x7F,0x40,0x40,0x40,0x40},{0x7F,0x02,0x0C,0x02,0x7F},{0x7F,0x04,0x08,0x10,0x7F},
  {0x3E,0x41,0x41,0x41,0x3E},{0x7F,0x09,0x09,0x09,0x06},{0x3E,0x41,0x51,0x21,0x5E},
  {0x7F,0x09,0x19,0x29,0x46},{0x46,0x49,0x49,0x49,0x31},{0x01,0x01,0x7F,0x01,0x01},
  {0x3F,0x40,0x40,0x40,0x3F},{0x1F,0x20,0x40,0x20,0x1F},{0x3F,0x40,0x38,0x40,0x3F},
  {0x63,0x14,0x08,0x14,0x63},{0x07,0x08,0x70,0x08,0x07},{0x61,0x51,0x49,0x45,0x43},
  {0x00,0x36,0x36,0x00,0x00},{0x00,0x60,0x60,0x00,0x00},{0x08,0x08,0x08,0x08,0x08},
  {0x02,0x01,0x02,0x04,0x02},{0x00,0x00,0x00,0x00,0x00},
};

int charIndex(char c) {
  if (c >= '0' && c <= '9') return c - '0';
  if (c >= 'A' && c <= 'Z') return c - 'A' + 10;
  if (c >= 'a' && c <= 'z') return c - 'a' + 10;
  if (c == ':') return 36; if (c == '.') return 37;
  if (c == '-') return 38; if (c == '/') return 39;
  return 40;
}

void drawChar(uint8_t* buf, int x, int y, char c) {
  int idx = charIndex(c);
  for (int col = 0; col < 5; col++) {
    uint8_t bits = pgm_read_byte(&FONT_5x7[idx][col]);
    for (int row = 0; row < 7; row++) {
      if (bits & (0x40 >> row)) setPixel(buf, x + col, y + row);
    }
  }
}

void drawText(uint8_t* buf, int x, int y, const String& text) {
  int cx = x;
  for (unsigned int i = 0; i < text.length(); i++) { drawChar(buf, cx, y, text[i]); cx += 6; }
}

int textWidth(const String& t) { return t.length() * 6; }

// ─── CARTEL HELPERS (E-Ink 2.9" BWR — 296×128, colonnes-majeures) ──────────

// Mettre des lignes horizontales à blanc (e-ink: 1=blanc) dans le buffer colonne-major.
// Coordonnées logiques : x=0..295, y=0..127.
// byteIndex = x*(IMG_H/8) + y/8 ; bit = 0x80 >> (y & 7)
void clearRows29(uint8_t* buf, int yStart, int yEnd) {
  for (int x = 0; x < IMG_W; x++) {
    for (int y = yStart; y <= yEnd && y < IMG_H; y++) {
      buf[x * (IMG_H / 8) + (y / 8)] |= (0x80 >> (y & 7));
    }
  }
}

// Ligne horizontale pleine (noire) à la hauteur logique y.
void drawHLine29(uint8_t* buf, int y) {
  for (int x = 0; x < IMG_W; x++) setPixel(buf, x, y);
}

// Cartel paysage pour E-Ink 2.9" BWR (296×128) :
//   Bande haute  y=0..12   → timestamp + "Bloc #N"
//   Séparateur   y=13
//   Bande basse  y=114
//   Séparateur   y=115..127 → artiste + titre
void burnEinkCartel_29(uint8_t* bBuf, uint8_t* rBuf,
                       const String& workTitle, const String& artistName,
                       const String& ts, int blockIndex) {
  const int BAND = 13;  // hauteur des bandes en pixels

  // ── Bande haute ──────────────────────────────────────────────────────────
  clearRows29(bBuf, 0, BAND - 1);
  if (rBuf) clearRows29(rBuf, 0, BAND - 1);
  drawHLine29(bBuf, BAND);   // séparateur

  String topLine = ts.length() > 0 ? ts : "PROOF-OF-DRAW";
  if (blockIndex >= 0) topLine += " #" + String(blockIndex);
  while (topLine.length() > 0 && textWidth(topLine) > IMG_W - 4)
    topLine.remove(topLine.length() - 1);
  int topX = max(0, (IMG_W - textWidth(topLine)) / 2);
  drawText(bBuf, topX, 2, topLine);

  // ── Bande basse ──────────────────────────────────────────────────────────
  int botSep = IMG_H - BAND - 1;   // = 114
  clearRows29(bBuf, botSep + 1, IMG_H - 1);
  if (rBuf) clearRows29(rBuf, botSep + 1, IMG_H - 1);
  drawHLine29(bBuf, botSep);       // séparateur

  String botLine = "";
  if (artistName.length() > 0 && workTitle.length() > 0)
    botLine = artistName + " - " + workTitle;
  else if (artistName.length() > 0)
    botLine = artistName;
  else if (workTitle.length() > 0)
    botLine = workTitle;
  if (botLine.length() == 0) botLine = "Proof-of-Draw";

  while (botLine.length() > 0 && textWidth(botLine) > IMG_W - 4)
    botLine.remove(botLine.length() - 1);
  int botX = max(0, (IMG_W - textWidth(botLine)) / 2);
  drawText(bBuf, botX, botSep + 2, botLine);
}

// ─── OBS-CONFIRM (Axe 3) ─────────────────────────────────────────────────────

bool doObsConfirm() {
#if POD_RENDER_V1 && POD_CANARY
  // LOT8B2C : aucune requête serveur hors register, pull, pull-frame et ack.
  if (pendingObsHashes.length() > 0) {
    Serial.println(F("[CANARY] tache d'observation annoncee : IGNOREE en build canari (aucune requete obs-confirm)"));
    pendingObsHashes = "";
    pendingObsTarget = "";
  }
  return true;
#endif
  if (pendingObsHashes.length() == 0) return true;

  String body = "{\"deviceId\":\"" + deviceId
              + "\",\"blockHashes\":" + pendingObsHashes;
  if (pendingObsTarget.length() == 64)
    body += ",\"targetBlockHash\":\"" + pendingObsTarget + "\"";
  body += "}";

  String resp;
  bool ok = httpPost("/api/obs-confirm", body, resp);
  Serial.printf("[OBS-CONFIRM] ok=%d resp=%s\n", ok, resp.c_str());
  pendingObsHashes = "";
  pendingObsTarget = "";
  return ok;
}

// ─── BASE64 (identique v1.5) ────────────────────────────────────────────────
static const int8_t B64_TABLE[256] PROGMEM = {
  -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
  -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,62,-1,-1,-1,63,52,53,54,55,56,57,58,59,60,61,-1,-1,-1,0,-1,-1,
  -1,0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,-1,-1,-1,-1,-1,
  -1,26,27,28,29,30,31,32,33,34,35,36,37,38,39,40,41,42,43,44,45,46,47,48,49,50,51,-1,-1,-1,-1,-1,
  -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
  -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
  -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
  -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1
};

size_t base64Decode(const char* src, size_t srcLen, uint8_t* dst, size_t dstMax) {
  size_t out = 0; int buf = 0, bits = 0;
  for (size_t i = 0; i < srcLen && out < dstMax; i++) {
    int8_t val = (int8_t)pgm_read_byte(&B64_TABLE[(uint8_t)src[i]]);
    if (val < 0) continue;
    buf = (buf << 6) | val; bits += 6;
    if (bits >= 8) { bits -= 8; dst[out++] = (buf >> bits) & 0xFF; }
  }
  return out;
}

// ─── AFFICHAGE E-INK ────────────────────────────────────────────────────────

bool initDisplayForRefresh() {
  unsigned long elapsed = millis() - lastRefreshMs;
  if (elapsed < EINK_MIN_REFRESH_MS) {
    unsigned long wait = EINK_MIN_REFRESH_MS - elapsed;
    Serial.printf("[EINK] attente refresh %lums\n", wait);
    delay(wait);
  }
  // Nourrir le watchdog avant les boucles busy du driver e-paper (jusqu'à ~3s)
  ESP.wdtFeed();
  if (epd.Init() != 0) {
    Serial.println("[EINK] Init failed");
    return false;
  }
  return true;
}

bool refreshDisplay() {
  if (!initDisplayForRefresh()) return false;
  epd.Display(blackBuf, redBuf);
  epd.Sleep();
  lastRefreshMs = millis();
  return true;
}

bool clearDisplayWhite() {
  unsigned long elapsed = millis() - lastRefreshMs;
  if (elapsed < EINK_MIN_REFRESH_MS) delay(EINK_MIN_REFRESH_MS - elapsed);

  if (epd.Init() != 0) {
    Serial.println("[EINK] clearDisplayWhite: Init failed, skip");
    lastRefreshMs = millis();
    return false;
  }

  uint8_t* tmpBlack = (uint8_t*)malloc(BUF_SIZE);
  uint8_t* tmpRed   = (uint8_t*)malloc(BUF_SIZE);
  if (!tmpBlack || !tmpRed) {
    free(tmpBlack); free(tmpRed);
    Serial.println("[EINK] clearDisplayWhite: malloc failed, skip");
    lastRefreshMs = millis();
    return false;
  }
  memset(tmpBlack, 0xFF, BUF_SIZE);
  memset(tmpRed,   0xFF, BUF_SIZE);
  epd.Display(tmpBlack, tmpRed);
  epd.Sleep();
  free(tmpBlack);
  free(tmpRed);
  lastRefreshMs = millis();
  return true;
}


// ─── AFFICHAGE CLÉ PUBLIQUE (unique au premier boot) ───────────────────────
void displayPublicKey() {
  memset(blackBuf, 0xFF, BUF_SIZE);
  memset(redBuf,   0xFF, BUF_SIZE);

  String pubHex = bytesToHex(publicKey, 32);
  String title  = "PROOF-OF-DRAW WALLET";
  String warn1  = "NOTE YOUR PUBLIC KEY - ONE TIME DISPLAY";
  String warn2  = "THIS SCREEN WILL NOT SHOW AGAIN";

  // Centrage
  auto center = [](const String& s, int maxX = IMG_W) {
    return max(0, (maxX - (int)(s.length() * 6)) / 2);
  };

  drawText(blackBuf, center(title), 4, title);

  // Ligne de séparation
  for (int x = 10; x < IMG_W - 10; x++) setPixel(blackBuf, x, 14);

  // Clé publique sur 4 lignes de 16 hex chars chacune
  for (int line = 0; line < 4; line++) {
    String chunk = pubHex.substring(line * 16, line * 16 + 16);
    drawText(blackBuf, center(chunk), 20 + line * 16, chunk);
  }

  // Ligne de séparation
  for (int x = 10; x < IMG_W - 10; x++) setPixel(blackBuf, x, 88);

  // Warnings en rouge
  drawText(redBuf, center(warn1), 96, warn1);
  drawText(redBuf, center(warn2), 108, warn2);

  drawText(blackBuf, center(String("DEVICE: ") + deviceId), 120, String("DEVICE: ") + deviceId);

  refreshDisplay();

  Serial.println("[KEYS] Clé publique affichée. L'utilisateur a 60s pour noter.");
  Serial.print("[KEYS] Public key: "); Serial.println(pubHex);

  // On attend que l'utilisateur note la clé
  delay(60000);
  Serial.println("[KEYS] Délai écoulé, suite du boot...");
}

// ─── QR CODE (identique v1.5 avec adaptation) ──────────────────────────────
void displayQR(const String& onboardUrl, const String& code, const String& mac) {
  memset(blackBuf, 0xFF, BUF_SIZE);
  memset(redBuf,   0xFF, BUF_SIZE);

  QRCode qrcode;
  uint8_t qrcodeData[qrcode_getBufferSize(5)];
  if (qrcode_initText(&qrcode, qrcodeData, 4, ECC_MEDIUM, onboardUrl.c_str()) < 0)
    if (qrcode_initText(&qrcode, qrcodeData, 5, ECC_MEDIUM, onboardUrl.c_str()) < 0) return;

  String title   = "PROOF-OF-DRAW";
  String macShort = mac; macShort.replace(":", ""); macShort.toUpperCase();
  String macLine  = "MAC:" + macShort;
  String codeLine = "CODE:" + code;

  const int qzQZ = 2, topPad = 4, sidePad = 6, bottomPad = 4;
  const int titleBlockH = 7 + 2 + 7, infoBlockH = 7 + 3 + 7;
  const int gapT = 6, gapB = 6;

  int total = qrcode.size + qzQZ * 2;
  int usableW = IMG_W - sidePad * 2;
  int usableH = IMG_H - topPad - titleBlockH - gapT - gapB - infoBlockH - bottomPad;
  int scale = min(usableW / total, usableH / total); if (scale < 1) scale = 1;
  int qrPx = total * scale;

  int titleY1 = topPad, titleY2 = titleY1 + 9;
  int qrX0 = (IMG_W - qrPx) / 2, qrY0 = topPad + titleBlockH + gapT;
  int textY1 = qrY0 + qrPx + gapB, textY2 = textY1 + 10;

  auto c = [](const String& s) { return max(0, (IMG_W - (int)(s.length() * 6)) / 2); };

  drawText(blackBuf, c(title), titleY1, title);
  drawText(blackBuf, c(String("SCAN TO PAIR")), titleY2, "SCAN TO PAIR");

  for (int my = 0; my < qrcode.size; my++) {
    for (int mx = 0; mx < qrcode.size; mx++) {
      if (!qrcode_getModule(&qrcode, mx, my)) continue;
      for (int dy = 0; dy < scale; dy++)
        for (int dx = 0; dx < scale; dx++)
          setPixel(blackBuf, qrX0 + (mx + qzQZ) * scale + dx, qrY0 + (my + qzQZ) * scale + dy);
    }
  }

  drawText(blackBuf, c(macLine), textY1, macLine);
  drawText(blackBuf, c(codeLine), textY2, codeLine);

  refreshDisplay();
}

bool ackFrame(const String& frameId) {
  String body = "{\"deviceId\":\"" + deviceId + "\",\"frameId\":\"" + frameId + "\"}";
  String resp;
  return httpPost("/api/ack-frame", body, resp);
}

void displayKeyMaterialOnce() {
  memset(blackBuf, 0xFF, BUF_SIZE);
  memset(redBuf,   0xFF, BUF_SIZE);

  String pubHex = bytesToHex(publicKey, 32);
  String privHex = bytesToHex(privateKey, 32);

  // NE PAS imprimer la clé privée sur Serial — reste strictement dans l'EEPROM
  Serial.println("[KEYS] Affichage clé publique (une seule fois)");
  Serial.println("[KEYS] PubKey: " + pubHex);

  String title = "PROOF-OF-DRAW KEYS";
  String warn1 = "SAVE THESE KEYS NOW";
  String warn2 = "PRIVATE KEY SHOWN ONCE";

  auto center = [](const String& s, int maxX = IMG_W) {
    return max(0, (maxX - (int)(s.length() * 6)) / 2);
  };

  drawText(blackBuf, center(title), 4, title);
  for (int x = 10; x < IMG_W - 10; x++) setPixel(blackBuf, x, 14);

  drawText(blackBuf, 4, 22, "PUB:");
  for (int line = 0; line < 4; line++) {
    String chunk = pubHex.substring(line * 16, line * 16 + 16);
    drawText(blackBuf, 30, 22 + line * 10, chunk);
  }

  drawText(blackBuf, 4, 68, "PRIV:");
  for (int line = 0; line < 4; line++) {
    String chunk = privHex.substring(line * 16, line * 16 + 16);
    drawText(redBuf, 30, 68 + line * 10, chunk);
  }

  for (int x = 10; x < IMG_W - 10; x++) setPixel(blackBuf, x, 114);
  drawText(redBuf, center(warn1), 118, warn1);
  drawText(redBuf, center(warn2), 128 - 10, warn2);

  refreshDisplay();
  delay(60000);
}


// ─── REGISTER ───────────────────────────────────────────────────────────────
bool doRegister() {
  String mac = WiFi.macAddress();
  mac.toLowerCase();

  String pubHex     = keysLoaded ? bytesToHex(publicKey, 32) : "";
  String ownedHashes = loadOwnedHashesJson();  // ex: ["abc...","def..."] ou []
  String body = "{\"mac\":\"" + mac + "\",\"screens\":[\"" + SCREEN_TYPE + "\"],"
                "\"firmware\":\"eink29bwr-2.3\",\"publicKey\":\"" + pubHex + "\","
                "\"ownedHashes\":" + ownedHashes + "}";
  String resp;

  Serial.printf("[REGISTER] heap avant: %u\n", ESP.getFreeHeap());

  if (!httpPost("/api/register", body, resp)) {
    Serial.println("[REGISTER] Echec HTTP");
    return false;
  }

  Serial.printf("[REGISTER] heap après: %u\n", ESP.getFreeHeap());
  Serial.println("[REGISTER] resp: " + resp);

  DynamicJsonDocument doc(768);
  DeserializationError err = deserializeJson(doc, resp);
  if (err) {
    Serial.print("[REGISTER] JSON error: ");
    Serial.println(err.c_str());
    return false;
  }

  deviceId   = doc["deviceId"].as<String>();
  pairCode   = doc["pairCode"].as<String>();
  canvasUrl  = doc["canvasUrl"].as<String>();
  paired     = doc["paired"] | false;
  registered = true;

  Serial.println("[REGISTER] deviceId: " + deviceId);
  Serial.println("[REGISTER] paired: " + String(paired ? "oui" : "non"));

  if (!einkReady) {
    Serial.printf("[HEAP] avant malloc: %u bytes\n", ESP.getFreeHeap());
    blackBuf = (uint8_t*)malloc(BUF_SIZE);
    redBuf   = (uint8_t*)malloc(BUF_SIZE);
    if (!blackBuf || !redBuf) {
      Serial.println("[EINK] ERREUR malloc — heap insuffisant");
      registered = false;
      return false;
    }
    memset(blackBuf, 0xFF, BUF_SIZE);
    memset(redBuf,   0xFF, BUF_SIZE);
    einkReady = true;
    Serial.printf("[HEAP] après malloc: %u bytes\n", ESP.getFreeHeap());
  }

  if (!paired && !onboardingAlreadyShown()) {
    // Premier boot non appairé : affiche clé publique + QR, mémorise le flag, redémarre
    // Les clés sont déjà générées dans setup() — pas de génération ici
    displayKeyMaterialOnce();
    String onboardUrl = String(SERVER_URL) + "/onboard?code=" + pairCode;
    displayQR(onboardUrl, pairCode, mac);

    setOnboardingShown();

    Serial.println("[REGISTER] Restart dans 3s pour libérer heap TLS...");
    delay(3000);
    ESP.restart();
  } else if (!paired) {
    // Boots suivants non appairés : ré-afficher le QR (clé publique déjà vue, pas besoin de la reafficher)
    Serial.println("[REGISTER] Non appairé — ré-affichage QR code...");
    String onboardUrl = String(SERVER_URL) + "/onboard?code=" + pairCode;
    displayQR(onboardUrl, pairCode, mac);
  } else {
    Serial.println("[REGISTER] Déjà appairé, pas de QR");
  }

  return true;
}

// ─── PULL ───────────────────────────────────────────────────────────────────











// ─── DEBUG HEAP ─────────────────────────────────────────────────────────────
void logHeapState(const char* tag) {
  Serial.printf("[%s] heap=%u maxBlock=%u frag=%u%%\n",
                tag,
                ESP.getFreeHeap(),
                ESP.getMaxFreeBlockSize(),
                ESP.getHeapFragmentation());
}





#if POD_RENDER_V1
// ─── Rendu v1 en flux : calcul ET remise au pilote ───────────────────────────────────────────────────────────────────────────────────────────────
// Ordre exact de la mémoire (ESP8266, TLS FERMÉ à l'entrée) :
//   TAS    blackBuf 4 736 o + redBuf 4 736 o   (alloués AVANT le TLS par doFetchFrame, comme avant : ce sont les tampons de réception) — jamais modifiés ici
//   PILE   PodFrameHasher (128 o, libéré avant la suite) puis PodEinkRenderer (264 o) + 32 o de morceau dans le pilote ; AUCUNE allocation, aucun tampon final, aucune grille
// Pic ajouté par ce chemin : ≈ 300 o de pile. Retour : 0 = échec AVANT la fin de la remise · 1 = données remises mais confirmation incomplète · 2 = rendu calculé ET remis au pilote (seul 2 est un succès : sinon AUCUN ACK, le serveur réessaiera).
// ⚠ État de l'écran après un échec : il n'est PAS garanti inchangé. clearDisplayWhite() peut avoir affiché une page BLANCHE juste avant (si une image était déjà affichée) ; une production interrompue laisse la RAM du panneau
//   partiellement écrite SANS lancer le rafraîchissement (l'écran garde alors son état physique du moment, éventuellement blanc). Sans ACK il reste blanc / ancien jusqu'au prochain pull réussi.
#if POD_RENDER_V1 && POD_CANARY
#define podRenderProduce podRenderProduceInner
#endif
static unsigned int podRenderProduce(void* ctx, unsigned char* out, unsigned int cap) { return ((PodEinkRenderer<PodSha256Br>*)ctx)->read(out, cap); }
#if POD_RENDER_V1 && POD_CANARY
#undef podRenderProduce
static unsigned int podRenderProduce(void* ctx, unsigned char* out, unsigned int cap) { canaryProduceEnter(); const unsigned int n = podRenderProduceInner(ctx, out, cap); canaryProduceLeave(); return n; }
#endif

static uint8_t podRenderAndShow() {
  const PodRenderSpec spec = pod_render_spec(POD_R_EINK29);
  const PodRenderMeta meta = { (const uint8_t*)pendingDisplayTs.c_str(), (size_t)pendingDisplayTs.length(), (int32_t)currentBlockIndex,
                               (const uint8_t*)pendingArtistName.c_str(), (size_t)pendingArtistName.length(), (const uint8_t*)pendingWorkTitle.c_str(), (size_t)pendingWorkTitle.length() };
  static char frameHex[65], renderHex[65];   // statiques (130 o de BSS) : la pile de la tâche reste libre
  {
    PodFrameHasher<PodSha256Br> fh;
    if (!fh.begin(spec) || !fh.update(blackBuf, BUF_SIZE) || !fh.update(redBuf, BUF_SIZE) || !fh.finish(frameHex)) { Serial.println(F("[RENDER] frameHash impossible — abandon")); return 0; }
  }
#if POD_RENDER_V1 && POD_CANARY
  canaryStep(PCP_FRAMEHASH, F("frameHash calcule"));
#endif
  PodEinkRenderer<PodSha256Br> r;
  if (!r.begin(spec, POD_RENDER_MODE_DEFAULT, meta, blackBuf, redBuf, BUF_SIZE)) { Serial.println(F("[RENDER] paramètres refusés — abandon")); return 0; }
  if (!initDisplayForRefresh()) { Serial.println(F("[RENDER] panneau non initialisé — abandon, aucune donnée envoyée (l'écran peut être resté blanc)")); return 0; }
#if POD_RENDER_V1 && POD_CANARY
  canaryStep(PCP_PANEL, F("panneau initialise, flux vers le pilote"));
#endif
  const bool delivered = epd.DisplayStream(podRenderProduce, &r);
#if POD_RENDER_V1 && POD_CANARY
  canaryStep(PCP_STREAM, F("flux remis au pilote (DisplayStream retourne)"));
  canaryStreamReport();
#endif
  epd.Sleep();
  lastRefreshMs = millis();
  if (!delivered) { Serial.println(F("[RENDER] production interrompue — rafraîchissement NON lancé (RAM du panneau partiellement écrite ; l'écran garde son état physique, éventuellement blanc)")); return 0; }
#if POD_RENDER_V1 && POD_CANARY
  canaryStep(PCP_FINISH, F("renderHash"));
#endif
  if (!r.finish(renderHex)) { Serial.println(F("[RENDER] renderHash incomplet — abandon")); return 1; }
  Serial.printf_P(PSTR("[RENDER] calculé ET remis au pilote — mode=%u frameHash=%s renderHash=%s\n"), (unsigned)POD_RENDER_MODE_DEFAULT, frameHex, renderHex);
  return 2;
}
#endif

// ─── FETCH FRAME (route séparée, heap propre après pull léger) ──────────────
// ─── FETCH FRAME ─────────────────────────────────────────────────────────────
bool doFetchFrame(const String& frameId, const String& frameSource) {
  logHeapState("FETCHFRAME-BEFORE");
#if POD_RENDER_V1 && POD_CANARY
  canaryStep(PCP_FETCH, F("frame: debut du telechargement"));
#endif

  blackBuf = (uint8_t*)malloc(BUF_SIZE);
  redBuf   = (uint8_t*)malloc(BUF_SIZE);
  if (!blackBuf || !redBuf) {
    Serial.println("[FETCHFRAME] malloc pixel failed");
    free(blackBuf); blackBuf = nullptr;
    free(redBuf);   redBuf   = nullptr;
    return false;
  }
  memset(blackBuf, 0xFF, BUF_SIZE);
  memset(redBuf,   0xFF, BUF_SIZE);
#if POD_RENDER_V1 && POD_CANARY
  if (!canaryTlsPreflight(PCP_PLANES, F("planes allouees (9472 o), avant TLS"), F("tampons liberes, pas d'ACK, nouvel essai au prochain pull"))) {
    free(blackBuf); blackBuf = nullptr;
    free(redBuf);   redBuf   = nullptr;
    return false;
  }
#endif

  {
    WiFiClientSecure client;
    client.setInsecure();
    HTTPClient http;

    String url = String(SERVER_URL) + "/api/pull-frame?deviceId=" + deviceId + "&fmt=bin";
    if (!http.begin(client, url)) {
      Serial.println("[FETCHFRAME] begin() failed");
      free(blackBuf); blackBuf = nullptr;
      free(redBuf);   redBuf   = nullptr;
      return false;
    }
    http.setTimeout(20000);
    http.useHTTP10(true);

    int code = http.GET();
    Serial.printf("[HTTP GET] /api/pull-frame → %d\n", code);
#if POD_RENDER_V1 && POD_CANARY
    canaryStep(PCP_TLS_OPEN, F("TLS ouvert (BearSSL alloue)"));
#endif

    if (code == 404) {
      http.end();
      Serial.println("[FETCHFRAME] Pas de frame");
      free(blackBuf); blackBuf = nullptr;
      free(redBuf);   redBuf   = nullptr;
      return true;
    }

    if (code != 200) {
      http.end();
      Serial.printf("[FETCHFRAME] HTTP error: %d\n", code);
      free(blackBuf); blackBuf = nullptr;
      free(redBuf);   redBuf   = nullptr;
      return false;
    }

    auto readFull = [](WiFiClient* s, uint8_t* dst, size_t len) -> size_t {
      size_t total = 0;
      unsigned long t0 = millis();
      while (total < len && millis() - t0 < 15000) {
        if (s->available()) {
          size_t got = s->readBytes(dst + total, len - total);
          if (got > 0) total += got;
        } else {
          delay(10);
        }
      }
      return total;
    };

    WiFiClient* stream = http.getStreamPtr();
    size_t bRead = readFull(stream, blackBuf, BUF_SIZE);
    size_t rRead = readFull(stream, redBuf,   BUF_SIZE);
#if POD_RENDER_V1 && POD_CANARY
    {
      const int canaryClen = http.getSize();            // en-têtes HTTP/1.0 : Content-Length (−1 = inconnu)
      const int canarySurplus = stream->available();    // octets déjà disponibles APRÈS les 9 472 attendus (http.end() les VIDE sans rien dire)
      Serial.printf_P(PSTR("[CANARY] corps : Content-Length=%d lus noir=%u rouge=%u surplus=%d\n"), canaryClen, (unsigned)bRead, (unsigned)rRead, canarySurplus);
      if ((canaryClen >= 0 && canaryClen != (int)(2 * BUF_SIZE)) || canarySurplus > 0) {
        Serial.println(F("[CANARY] REFUS : corps de taille inattendue (tronque, trop long ou surplus) — aucun rendu, aucun ACK"));
        bRead = 0;   // retombe dans la branche « lecture incomplète » : tampons libérés, aucun ACK
      }
      canaryStep(PCP_BODY, F("corps lu (TLS encore ouvert)"));
    }
#endif
    http.end();

    Serial.printf("[FETCHFRAME] lu black=%u red=%u expected=%u\n", bRead, rRead, BUF_SIZE);

    if (bRead != BUF_SIZE || rRead != BUF_SIZE) {
      Serial.println("[FETCHFRAME] lecture incomplète");
      free(blackBuf); blackBuf = nullptr;
      free(redBuf);   redBuf   = nullptr;
      return false;
    }
  }
  // TLS fermé ici — le panel a eu le temps de finir son refresh précédent
#if POD_RENDER_V1 && POD_CANARY
  canaryAfterTls();
#endif

#if POD_RENDER_V1
  // ── Rendu v1 en flux : cartel + fit calculés par le noyau, remis au pilote par morceaux (aucune gravure en place) ──
  if (hasDisplayedFrame) clearDisplayWhite();
  if (podRenderAndShow() != 2) {   // 2 = rendu calculé ET remis au pilote
#else
  // ── Cartel (bandes de métadonnées en haut et bas) ────────────────────────
  burnEinkCartel_29(blackBuf, redBuf,
                    pendingWorkTitle, pendingArtistName,
                    pendingDisplayTs, currentBlockIndex);

  if (hasDisplayedFrame) {
    clearDisplayWhite();
    // Pas de delay(3000) ici : initDisplayForRefresh() dans refreshDisplay()
    // attend déjà EINK_MIN_REFRESH_MS depuis lastRefreshMs
  }

  if (!refreshDisplay()) {
#endif
#if POD_RENDER_V1 && POD_CANARY
    Serial.println(F("[CANARY] ECHEC rendu/affichage : AUCUN ACK, tampons liberes, nouvel essai au prochain pull (pas de polling accelere)"));
#endif
    Serial.println("[FETCHFRAME] refreshDisplay failed — frame conservée côté serveur");
    free(blackBuf); blackBuf = nullptr;
    free(redBuf);   redBuf   = nullptr;
    frameReady = false;
    return false;
  }

#if POD_RENDER_V1 && POD_CANARY
  // LOT8B2C-FIX1 : en canari le RÉSULTAT de l'ACK décide du succès. L'écran a PU être affiché (hasDisplayedFrame), mais la frame n'est « terminée » (lastFrameId, frameReady, PCP_DONE, retour true) QU'APRÈS
  // un ACK HTTP 200 ; sinon retour false : le serveur reproposera la frame au prochain pull (≥ 60 s, jamais de polling accéléré). Pré-vol BearSSL aussi pour l'ACK : les plans (9 472 o) sont encore vivants.
  hasDisplayedFrame = true;
  if (!canaryTlsPreflight(PCP_ACK, F("rendu OK, pre-vol TLS avant l'ACK (plans encore vivants)"), F("AUCUN ACK envoye : l'ecran a PU etre affiche mais la frame N'EST PAS acquittee (retentee au prochain pull)"))) {
    free(blackBuf); blackBuf = nullptr;
    free(redBuf);   redBuf   = nullptr;
    frameReady = false;
    return false;
  }
  if (!ackFrame(frameId)) {
    Serial.println(F("[CANARY] ECHEC ACK : refuse ou impossible — l'ecran a PU etre affiche mais la frame N'EST PAS acquittee (lastFrameId et frameReady inchanges), retentee au prochain pull"));
    free(blackBuf); blackBuf = nullptr;
    free(redBuf);   redBuf   = nullptr;
    frameReady = false;
    return false;
  }
  lastFrameId           = frameId;
  frameReady            = true;
  lastFrameWasConsensus = (frameSource == "consensus");
  pendingCandidateId    = "";
  canaryStep(PCP_DONE, F("ACK recu (HTTP 200) : frame acquittee"));
  Serial.printf_P(PSTR("[FETCHFRAME] ✅ affichée et acquittée frameId=%s source=%s\n"), frameId.c_str(), frameSource.c_str());
  logHeapState("FETCHFRAME-AFTER");
  canaryStreamReport();
  g_pcRtc.abn = 0;
  return true;
#endif
  hasDisplayedFrame     = true;
  lastFrameId           = frameId;
  frameReady            = true;
  ackFrame(frameId);
  lastFrameWasConsensus = (frameSource == "consensus");
  pendingCandidateId    = "";

  Serial.printf("[FETCHFRAME] ✅ affichée frameId=%s source=%s\n",
                frameId.c_str(), frameSource.c_str());
  logHeapState("FETCHFRAME-AFTER");
  return true;
}




// ─── PULL LÉGER ──────────────────────────────────────────────────────────────
bool doPull() {
  free(blackBuf); blackBuf = nullptr;
  free(redBuf);   redBuf   = nullptr;

  logHeapState("PULL-BEFORE");
#if POD_RENDER_V1 && POD_CANARY
  canaryStep(PCP_PULL, F("pull: debut"));
#endif

  String newBlockHash   = "";
  int    newBlockIndex  = -1;
  String newCandId      = "";
  String newFrameId     = "";
  String newFrameSource = "none";
  int    pullRetryAfter = 60;  // valeur par défaut, remplacée par doc["retryAfter"]

  {
    WiFiClientSecure client;
    client.setInsecure();
    HTTPClient http;

    String url = String(SERVER_URL) + "/api/pull?deviceId=" + deviceId;
    if (!http.begin(client, url)) {
      Serial.println("[PULL] begin() failed");
      return false;
    }
    http.setTimeout(20000);
    http.useHTTP10(true);

    int code = http.GET();
    Serial.printf("[HTTP GET] /api/pull → %d\n", code);

    if (code == 429) {
      String rresp = http.getString();
      http.end();
      int retrySec = 60;
      DynamicJsonDocument rateDoc(256);
      if (deserializeJson(rateDoc, rresp) == DeserializationError::Ok) {
        retrySec = rateDoc["retryAfter"] | 60;
        if (retrySec <= 0) retrySec = 60;
      }
      Serial.printf("[PULL] 429 rate limit, retryAfter=%d s\n", retrySec);
      unsigned long retryMs = (unsigned long)retrySec * 1000UL;
      if (retryMs > PULL_INTERVAL) retryMs = PULL_INTERVAL;
      lastPullMs = millis() - (PULL_INTERVAL - retryMs);
      return true;
    }

    if (code != 200) {
      http.end();
      Serial.printf("[PULL] HTTP error: %d\n", code);
      return false;
    }

    DynamicJsonDocument doc(2048);
    DeserializationError err = deserializeJson(doc, http.getStream());
    http.end();

    if (err) {
      Serial.print("[PULL] JSON error: ");
      Serial.println(err.c_str());
      logHeapState("PULL-JSON-ERR");
      return false;
    }

    JsonObject chain = doc["chain"];
    if (!chain.isNull()) {
      newBlockHash  = chain["blockHash"]  | "";
      newBlockIndex = chain["blockIndex"] | -1;
    }

    JsonObject pend = doc["pendingValidation"];
    if (!pend.isNull()) {
      newCandId = pend["candidateId"] | "";
    }

    newFrameSource = doc["frameSource"] | "none";
    newFrameId     = doc["frameId"]     | "";
    pullRetryAfter = doc["retryAfter"]  | 60;
    if (pullRetryAfter <= 0) pullRetryAfter = 60;
    if (newFrameId.length() == 0) {
      JsonObject frameObj = doc["frame"];
      if (!frameObj.isNull()) newFrameId = frameObj["frameId"] | "";
    }

    // ── Métadonnées cartel ────────────────────────────────────────────────
    JsonObject cm = doc["cartelMeta"];
    if (!cm.isNull()) {
      pendingWorkTitle  = cm["workTitle"]      | "";
      pendingArtistName = cm["drawArtistName"] | "";
      pendingDisplayTs  = cm["displayTs"]      | "";
      currentBlockIndex = cm["blockIndex"]     | currentBlockIndex;
      Serial.printf("[PULL] cartel: title=%s artist=%s ts=%s bloc=%d\n",
                    pendingWorkTitle.c_str(), pendingArtistName.c_str(),
                    pendingDisplayTs.c_str(), currentBlockIndex);
    }

    // ── Tâche d'observation (Axe 3) ───────────────────────────────────────
    JsonObject obsObj = doc["pendingObservation"];
    if (!obsObj.isNull()) {
      JsonArray hArr = obsObj["blockHashes"];
      if (!hArr.isNull() && hArr.size() > 0) {
        pendingObsHashes = "[";
        for (size_t i = 0; i < hArr.size(); i++) {
          if (i > 0) pendingObsHashes += ",";
          pendingObsHashes += "\"";
          pendingObsHashes += hArr[i].as<String>();
          pendingObsHashes += "\"";
        }
        pendingObsHashes += "]";
        pendingObsTarget = obsObj["targetBlockHash"] | "";
        Serial.printf("[PULL] obsTask hashes=%u target=%s\n",
                      hArr.size(), pendingObsTarget.c_str());
      }
    }

    // ── Bloc nouvellement possédé (one-shot, posé par finalizeBlock) ──────
    // Présent uniquement le premier pull qui suit le minage de ce device.
    // On sauvegarde en EEPROM ring buffer pour survivre aux redémarrages.
    String newlyOwned = doc["ownedBlock"] | "";
    if (newlyOwned.length() >= 16) {
      Serial.println("[OWNED] Nouveau bloc possédé: " + newlyOwned.substring(0, 12) + "...");
      saveOwnedBlockHash(newlyOwned);
    }
  }

  // Ajuste l'intervalle de pull selon l'activité réseau signalée par le serveur
  // Frame déjà affichée (même frameId) sans candidat : rien à faire → retryAfter, comme « aucune frame »
  // (sinon une frame personnelle acquittée, qui reste dans /api/pull, imposait un pull toutes les 60 s).
  bool sameFrameIdle = newFrameId.length() > 0 && newFrameId == lastFrameId;
  if ((newFrameSource == "none" || sameFrameIdle) && newCandId.length() == 0) {
    // Réseau idle → on respecte le retryAfter du serveur (typiquement 300s)
    nextPullIntervalMs = (unsigned long)pullRetryAfter * 1000UL;
  } else {
    // Activité détectée (frame ou candidat) → retour au rythme nominal
    nextPullIntervalMs = PULL_INTERVAL;
  }
  Serial.printf("[PULL] nextInterval=%lus (retryAfter=%d)\n",
                nextPullIntervalMs / 1000UL, pullRetryAfter);

  if (newBlockHash.length() > 0 && newBlockHash != currentBlockHash) {
    currentBlockHash  = newBlockHash;
    currentBlockIndex = newBlockIndex;
    saveBlockHashToEEPROM(currentBlockHash);
    Serial.printf("[PULL] Nouveau bloc #%d hash=%s...\n",
                  currentBlockIndex, currentBlockHash.substring(0, 12).c_str());
  }

  if (newCandId.length() > 0) {
    pendingCandidateId = newCandId;
    Serial.println("[PULL] Candidat en attente: " + pendingCandidateId);
  }

  if (newFrameSource == "none" || newFrameId.length() == 0) {
    Serial.println("[PULL] Aucune frame");
    logHeapState("PULL-DONE-NONE");
    return true;
  }

  if (newFrameId == lastFrameId) {
    Serial.println("[PULL] Frame déjà affichée (frameId identique)");
    frameReady = true;
    return true;
  }

  Serial.printf("[PULL] Nouvelle frame frameId=%s source=%s → fetch\n",
                newFrameId.c_str(), newFrameSource.c_str());

  bool fetchOk = doFetchFrame(newFrameId, newFrameSource);

  // CRITIQUE : même si le fetch/display échoue, on retourne true
  // pour que lastPullMs soit mis à jour dans le loop et éviter la
  // boucle infinie pull → échec → pull immédiat → échec → ...
  // La prochaine tentative sera dans PULL_INTERVAL (60s).
  if (!fetchOk) {
    Serial.println("[PULL] doFetchFrame failed — prochaine tentative dans 60s");
  }
  return true;
}










// ─── VALIDATION RÉELLE (vote v2) ─────────────────────────────────────────────
// ⚠ NON TESTÉ sur le matériel (docs/CHANTIER_VALIDATION_REELLE.md, P3). Le serveur annonce le candidat (écran, taille, SHA-256) ; ici l'ESP lit le contenu BRUT en
// flux, recalcule le hash et les métriques entières, décide d'un verdict objectif, le signe (Ed25519) et vote. Aucune image n'est gardée en mémoire.
// Les tampons pixel (blackBuf/redBuf) sont déjà libérés par doValidate() : seul un tampon de 4 736 o est alloué pendant la lecture.
bool doValidateV2(const String& candidateId, const String& screenName, size_t bytes, const String& announcedHash) {
  PodScreenKind kind;
  if (!podKindFromName(screenName, &kind)) { Serial.println("[VALIDATE2] écran inconnu: " + screenName); return false; }

  uint8_t* scratch = (uint8_t*)malloc(POD_SCRATCH_BYTES);
  if (!scratch) { Serial.println("[VALIDATE2] malloc scratch impossible"); return false; }
  logHeapState("VALIDATE2-BEFORE");
  PodCheck chk;
  bool ok = podFetchAndCheck(String(SERVER_URL) + "/api/candidate-frame?candidateId=" + candidateId, kind, bytes, scratch, POD_SCRATCH_BYTES, &chk);
  free(scratch);
  if (!ok) {
    Serial.printf("[VALIDATE2] lecture/calcul impossible (http=%d, %u/%u octets)\n", chk.http, (unsigned)chk.bytes, (unsigned)bytes);
    return false;
  }

  bool accept = false;
  const char* reason = podVerdict(chk, announcedHash, &accept);
  Serial.printf("[VALIDATE2] %s %u o en %lu ms | e=%lu t=%lu r=%lu s=%lu | verdict=%s %s\n", screenName.c_str(), (unsigned)chk.bytes, (unsigned long)chk.ms,
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
  if (vOk) {
    Serial.println("[VALIDATE2] Vote OK");
    if (vResp.indexOf("\"blockMined\":true") >= 0) { Serial.println("[VALIDATE2] BLOC MINE"); frameReady = true; }
    if (vResp.indexOf("\"rejectObserved\":true") >= 0) Serial.println("[VALIDATE2] refus enregistré par le serveur (non bloquant)");
  } else {
    Serial.println("[VALIDATE2] Echec vote (403 signature, 422 hash/métriques différents du serveur) : " + vResp);
    // 403 Signature invalide → clé publique désynchronisée : on se ré-enregistre pour la renvoyer (comme le chemin v1), le prochain cycle votera.
    if (vResp.indexOf("Signature") >= 0) { Serial.println("[VALIDATE2] Re-register pour resynchroniser publicKey..."); doRegister(); }
  }
  logHeapState("VALIDATE2-AFTER");
  return vOk;
}

// ─── VALIDATION ─────────────────────────────────────────────────────────────
bool doValidate() {
#if POD_RENDER_V1 && POD_CANARY
  // LOT8B2C : le canari ne teste PAS le consensus. Aucun réseau, aucune signature, aucune requete validation-result, aucun re-register : le candidat est oublié localement (le serveur le ré-annoncera au pull suivant).
  if (pendingCandidateId.length() > 0) {
    Serial.println(F("[CANARY] candidat annonce : AUCUN vote en build canari — candidat oublie localement (le canari ne teste pas le consensus)"));
    pendingCandidateId = "";
  }
  return true;
#endif
  if (pendingCandidateId.length() == 0) return true;

  // ← SUPPRIME ces lignes qui bloquent la validation après un consensus :
  // if (consensusJustDisplayed) {
  //   pendingCandidateId = "";
  //   consensusJustDisplayed = false;
  //   return true;
  // }

  Serial.println("[VALIDATE] Debut: " + pendingCandidateId);
  logHeapState("VALIDATE-BEFORE");

  free(blackBuf); blackBuf = nullptr;
  free(redBuf);   redBuf   = nullptr;

  String resp;
  bool ok = httpGet("/api/validate-candidate?deviceId=" + deviceId, resp);

  if (!ok || resp.length() == 0) {
    Serial.println("[VALIDATE] Echec HTTP");
    pendingCandidateId = "";
    goto validate_realloc;
  }

  {
    DynamicJsonDocument doc(768);   // 512 avant la validation réelle : la réponse porte aussi { v2: écran, taille, hash } (≈ 110 o)
    DeserializationError err = deserializeJson(doc, resp);
    resp = "";

    if (err) {
      Serial.print("[VALIDATE] JSON err: ");
      Serial.println(err.c_str());
      pendingCandidateId = "";
      goto validate_realloc;
    }

    if (doc["alreadyVoted"] | false) {
      Serial.println("[VALIDATE] Deja vote");
      pendingCandidateId = "";
      goto validate_realloc;
    }

    if (doc["candidate"].isNull()) {
      Serial.println("[VALIDATE] Pas de candidat actif");
      pendingCandidateId = "";
      goto validate_realloc;
    }

    JsonObject cand    = doc["candidate"];
    String candidateId = cand["candidateId"] | "";

    if (candidateId.length() == 0) {
      Serial.println("[VALIDATE] candidateId absent");
      pendingCandidateId = "";
      goto validate_realloc;
    }

    // Validation RÉELLE : si le serveur annonce { v2 }, on revérifie le contenu au lieu de recopier son score (anciens serveurs : chemin v1 ci-dessous).
    if (!cand["v2"].isNull()) {
      String v2screen = cand["v2"]["screen"] | "";
      size_t v2bytes  = cand["v2"]["bytes"] | 0;
      String v2hash   = cand["v2"]["hash"] | "";
      pendingCandidateId = "";
      doc.clear();
      doValidateV2(candidateId, v2screen, v2bytes, v2hash);
      goto validate_realloc;
    }

    float score = cand["score_server"] | 0.5f;
    Serial.printf("[VALIDATE] candidateId=%s score=%.3f\n", candidateId.c_str(), score);

    String signature = signED25519(candidateId, score);
    char scoreStr[8];
    dtostrf(score, 1, 3, scoreStr);

    String body = String("{\"deviceId\":\"") + deviceId + "\","
                  "\"candidateId\":\"" + candidateId + "\","
                  "\"entropy\":" + scoreStr + ","
                  "\"transitions\":" + scoreStr + ","
                  "\"rle\":" + scoreStr + ","
                  "\"score\":" + scoreStr + ","
                  "\"signature\":\"" + signature + "\"}";

    pendingCandidateId = "";

    String vResp;
    bool vOk = httpPost("/api/validation-result", body, vResp);

    if (vOk) {
      Serial.println("[VALIDATE] Vote OK");
      if (vResp.indexOf("\"blockMined\":true") >= 0) {
        Serial.println("[VALIDATE] BLOC MINE");
        frameReady = true;
      }
    } else {
      Serial.println("[VALIDATE] Echec vote");
      // 403 Signature invalide → clé publique désynchronisée sur le serveur.
      // blackBuf/redBuf déjà libérés → heap disponible pour re-register (TLS).
      if (vResp.indexOf("Signature") >= 0) {
        Serial.println("[VALIDATE] Re-register pour resynchroniser publicKey...");
        doRegister();
        Serial.println("[VALIDATE] Re-register terminé — retry au prochain cycle");
      }
    }
  }

validate_realloc:
  blackBuf = (uint8_t*)malloc(BUF_SIZE);
  redBuf   = (uint8_t*)malloc(BUF_SIZE);
  if (!blackBuf || !redBuf) {
    Serial.println("[VALIDATE] malloc fail — restart");
    ESP.restart();
  }
  memset(blackBuf, 0xFF, BUF_SIZE);
  memset(redBuf,   0xFF, BUF_SIZE);

  logHeapState("VALIDATE-AFTER");
  return true;
}













// ─── SETUP / LOOP ───────────────────────────────────────────────────────────
void setup() {
  Serial.begin(115200);
  Serial.println("\n[BOOT] Proof-of-Draw ESP v2.0");
#if POD_RENDER_V1 && POD_CANARY
  canaryBoot();
#endif

  eepromInit();

  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  Serial.print("[WIFI] Connexion");
  int i = 0;
  while (WiFi.status() != WL_CONNECTED && i++ < 40) {
    delay(500);
    Serial.print(".");
  }
  Serial.println();
  Serial.println("[WIFI] IP: " + WiFi.localIP().toString());
  Serial.printf("[HEAP] après WiFi: %u bytes\n", ESP.getFreeHeap());
#if POD_RENDER_V1 && POD_CANARY
  canaryStep(PCP_WIFI, F("wifi connecte"));
#endif

  // Migration V1 → ED25519 réel : ancien flag 0x01 = clés fake, forcer régénération
  if (EEPROM.read(EEPROM_FLAG_OFF) == 0x01) {
    Serial.println("[KEYS] Clés V1 détectées — migration vers ED25519 réel");
    EEPROM.write(EEPROM_FLAG_OFF,       0x00);  // invalide flag V1
    EEPROM.write(EEPROM_ONBOARDING_OFF, 0x00);  // force ré-affichage onboarding + nouvelles clés
    EEPROM.commit();
  }

  // ── Clés ED25519 : générer ou charger AVANT tout register/TLS ────────────
  // CRITIQUE : générer ici (pas dans doRegister) pour garantir que l'EEPROM.commit()
  // se fait dans un contexte stable, avant les opérations e-paper qui peuvent
  // déclencher un watchdog reset et corrompre un commit en cours.
  if (!keysAlreadyGenerated()) {
    generateKeys();   // génère, sauvegarde en EEPROM, set keysLoaded=true
  } else {
    loadKeysFromEEPROM();
    Serial.println("[KEYS] Clés ED25519 chargées depuis EEPROM");
    Serial.println("[KEYS] PubKey: " + bytesToHex(publicKey, 32));
  }

  // ── BlockHash EEPROM : valider avant utilisation ──────────────────────────
  // EEPROM vierge = 0xFF sur chaque octet → caractères garbage, rejeter
  currentBlockHash = loadBlockHashFromEEPROM();
  {
    bool validHex = currentBlockHash.length() >= 8;
    for (unsigned int i = 0; i < currentBlockHash.length() && validHex; i++) {
      char c = currentBlockHash[i];
      if (!((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F')))
        validHex = false;
    }
    if (!validHex) currentBlockHash = "";
  }
  if (currentBlockHash.length() > 0) {
    Serial.println("[CHAIN] BlockHash restauré: " + currentBlockHash);
  }

  while (!registered) {
    if (doRegister()) break;
    delay(5000);
  }
#if POD_RENDER_V1 && POD_CANARY
  canaryStep(PCP_REGISTER, F("register OK"));
#endif

  Serial.println("[BOOT] Premier pull immédiat...");
  doPull();

  lastPullMs     = millis();
  // Délai de sécurité : même si le pull de boot a reçu un candidat,
  // on attend VALIDATE_INTERVAL avant la première validation pour ne
  // pas enchaîner deux connexions TLS back-to-back.
  lastValidateMs = millis();
  Serial.println("[BOOT] Pret. Pull dans " + String(PULL_INTERVAL / 1000) + "s");
}


// ─── LOOP ────────────────────────────────────────────────────────────────────
void loop() {
  unsigned long now = millis();

  // ─── Re-registration si perdu ──────────────────────────────────────────
  if (!registered) {
    if (!doRegister()) { delay(5000); return; }
  }

  // ─── Pull périodique ───────────────────────────────────────────────────
  if (now - lastPullMs >= nextPullIntervalMs) {
    String prevCandidateId = pendingCandidateId;
    doPull();
    lastPullMs = millis();

    // Si un nouveau candidat est apparu, on reset le timer de validation
    // pour lui laisser VALIDATE_INTERVAL avant de voter
    if (pendingCandidateId.length() > 0 && pendingCandidateId != prevCandidateId) {
      Serial.println("[LOOP] Nouveau candidat détecté, reset timer validation");
      lastValidateMs = millis();
    }
  }

  // ─── Ré-validation (Axe 3) ────────────────────────────────────────────
  if (pendingObsHashes.length() > 0) {
    doObsConfirm();
  }

  // ─── Validation d'un candidat en attente ───────────────────────────────
  if (pendingCandidateId.length() > 0 &&
      millis() - lastValidateMs >= VALIDATE_INTERVAL) {

    doValidate();
    lastValidateMs = millis();

    // Si un bloc vient d'être miné, on pull immédiatement pour récupérer
    // la nouvelle frame sans attendre PULL_INTERVAL
    if (frameReady) {
      Serial.println("[LOOP] Bloc miné — pull immédiat");
      delay(2000);  // laisse BearSSL libérer ses buffers TLS
      doPull();
      lastPullMs = millis();
    }
  }

  delay(100);
}