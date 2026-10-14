// pod_uno_r4.ino
// Proof-of-Draw — Firmware UNO R4 WiFi + shield « 2.8" TFT Touch » (ILI9341 240×320 + STMPE610 + microSD)
//
// Même protocole que les firmwares ESP8266 (register → pull → image → ACK, validation Ed25519, observation, blocs possédés),
// porté sur l'UNO R4 WiFi :
//   • le Wi-Fi/TLS passe par le coprocesseur ESP32-S3 (WiFiSSLClient) : plus de BearSSL dans la RAM du microcontrôleur ;
//   • l'appareil se déclare « tft28 » (240×320 RGB565, 153 600 o) : l'œuvre occupe TOUT l'écran. Pas de scene-v1 sur cet écran :
//     une œuvre ANA arrive comme image fixe (son aperçu), comme sur les écrans e-ink ;
//   • tactile (STMPE610) : un toucher AFFICHE ou CACHE le cartel — bande haute « RESCOE · #bloc », bande basse « titre · artiste » —
//     par-dessus l'œuvre en plein écran ;
//   • microSD : la dernière image y est gardée (/pod/frame.bin). Elle sert à cacher le cartel (on redessine les deux bandes depuis la
//     carte, sans re-télécharger) et à réafficher l'œuvre au redémarrage. Sans carte : l'œuvre reste en plein écran, sans cartel.
//
// Câblage : le shield s'enfiche tel quel sur l'UNO R4 WiFi (TFT CS 10 / DC 9, tactile CS 8, microSD CS 4).
// Bibliothèques : Adafruit ILI9341, Adafruit GFX, Adafruit BusIO, Adafruit STMPE610, ArduinoJson (≥ 6, testé 7.4), QRCode, Crypto, SD.
// Carte : « Arduino UNO R4 WiFi ». Moniteur série : 115200.
//
// ⚠ Débit : la liaison RA4M1 ↔ ESP32-S3 est à 115200 bauds → une image complète (153 600 o) met une vingtaine de secondes à arriver
//   (elle se dessine de haut en bas pendant ce temps). Les temps réels sont affichés au Serial ([FRAME]).
// ⚠ TLS : le coprocesseur vérifie le certificat avec son lot de certificats racine. Si « connexion TLS impossible » s'affiche,
//   mettre à jour le firmware du module Wi-Fi (IDE → Outils → Updater le firmware) et/ou ajouter le certificat racine du serveur.

// ─── DRAPEAUX DU LOT 8B2D (canari TFT 2,8″) ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
// POD_RENDER_V1 : SANS EFFET sur ce firmware. Le TFT 2,8″ n'a pas de cartel gravé : l'œuvre est affichée telle que reçue (RGB565 → ILI9341) et le cartel est dessiné PAR-DESSUS au toucher ; aucun rasteriseur v1 n'est inclus. Le drapeau
//   existe seulement pour que la ligne de compilation des canaris soit commune aux autres cartes (-DPOD_RENDER_V1=1 -DPOD_CANARY=1).
// POD_CANARY : 1 = BUILD LOCAL TEMPORAIRE de CANARI, SANS VOTE : le code de vote (/api/validate-candidate, /api/candidate-frame, /api/validation-result, /api/obs-confirm, signature de vote) n'est PAS COMPILÉ ; tout candidat annoncé est
//   oublié localement ; le banc d'essai est ignoré ; instrument de pile / tas ; ACK honnête. NE JAMAIS COMMITER 1 (testé). Sans effet sur la production (0).
#ifndef POD_RENDER_V1
#define POD_RENDER_V1 0
#endif
#ifndef POD_CANARY
#define POD_CANARY 0
#endif
// POD_VOTE_V1 (LOT8B2E V2, R-H2) : 0 = la voie de vote v1 (écho du score du serveur, signature et formatage flottant) est RETIRÉE du binaire : un candidat v1 ne produit ni lecture, ni signature, ni POST.
//   Un vote v1 ne doit jamais valider une animation v3. NE JAMAIS METTRE À 1 (testé).
#ifndef POD_VOTE_V1
#define POD_VOTE_V1 0
#endif
// POD_VOTE_CANARY (LOT8B2E V4) : 1 = BUILD LOCAL de CANARI DE VOTE, distinct du canari d'affichage et de la production : au plus UNE tentative de vote, même après reset ou coupure (verrou EEPROM écrit AVANT le POST),
//   candidat strictement ÉPINGLÉ (identifiant, écran tft28, taille, hash), backend ISOLÉ obligatoire (jamais la production), aucun affichage / ACK / toucher / animation, arrêt définitif après l'unique issue.
//   Désactivé (0) dans le dépôt : NE JAMAIS COMMITER 1 (testé). Voir docs/LOT_8B2E_R4_TFT28_VOTE_V4_CANARY_2026_10_13.md.
#ifndef POD_VOTE_CANARY
#define POD_VOTE_CANARY 0
#endif
#if POD_VOTE_CANARY
  #if __has_include("pod_vote_pins.h")
    #include "pod_vote_pins.h"   // LOCAL (ignoré par git) : POD_VOTE_BACKEND_HOST, POD_VOTE_PIN_ID, POD_VOTE_PIN_HASH — voir pod_vote_pins.h.example
  #endif
  #if POD_CANARY || POD_VOTE_V1
    #error "POD_VOTE_CANARY exige POD_CANARY = 0 et POD_VOTE_V1 = 0 : voie de vote v2 seule, build distinct du canari d'affichage"
  #endif
  #if !defined(POD_VOTE_BACKEND_HOST) || !defined(POD_VOTE_PIN_ID) || !defined(POD_VOTE_PIN_HASH)
    #error "POD_VOTE_CANARY exige POD_VOTE_BACKEND_HOST (hote du backend ISOLE), POD_VOTE_PIN_ID (candidateId) et POD_VOTE_PIN_HASH (SHA-256 hexadecimal, 64 caracteres), chacun entre guillemets"
  #endif
  #define POD_VOTE_PIN_SCREEN "tft28"
  #define POD_VOTE_PIN_BYTES  153600
  static_assert(sizeof(POD_VOTE_PIN_HASH) == 65, "POD_VOTE_PIN_HASH doit faire exactement 64 caracteres hexadecimaux");
  static_assert(sizeof(POD_VOTE_PIN_ID) >= 9 && sizeof(POD_VOTE_PIN_ID) <= 65, "POD_VOTE_PIN_ID : 8 a 64 caracteres");
#endif

// POD_PREVIEW_ENROLL (LOT TFT28-PREVIEW-ENROLL-1) : 1 = BUILD LOCAL d'APPAIRAGE sur un backend Preview isolé : Wi-Fi puis /api/register UNIQUEMENT ; journal série du deviceId et du pairCode ; arrêt définitif. Aucun écran, tactile ni carte SD,
//   aucun pull, aucune lecture de candidat, aucun vote, aucun ACK. Hôte fourni par le fichier LOCAL pod_preview_host.h (ignoré par git, distinct de pod_vote_pins.h) ; la production est refusée. Désactivé (0) dans le dépôt : NE JAMAIS COMMITER 1 (testé).
#ifndef POD_PREVIEW_ENROLL
#define POD_PREVIEW_ENROLL 0
#endif
#if POD_PREVIEW_ENROLL
  #if __has_include("pod_preview_host.h")
    #include "pod_preview_host.h"   // LOCAL (ignoré par git) : POD_PREVIEW_HOST — voir pod_preview_host.h.example
  #endif
  #if POD_CANARY || POD_VOTE_V1 || POD_VOTE_CANARY
    #error "POD_PREVIEW_ENROLL exige POD_CANARY = 0, POD_VOTE_V1 = 0 et POD_VOTE_CANARY = 0 : build d'appairage distinct de tous les canaris"
  #endif
  #ifndef POD_PREVIEW_HOST
    #error "POD_PREVIEW_ENROLL exige POD_PREVIEW_HOST (hote du deploiement Preview, entre guillemets) : copier pod_preview_host.h.example en pod_preview_host.h"
  #endif
  // AUCUNE fonction avant les #include : le générateur de prototypes de l'IDE Arduino y insérerait tous les prototypes (comme pour les types, voir plus bas).
  static_assert(__builtin_strcmp(POD_PREVIEW_HOST, "proof-of-draw.vercel.app") != 0, "POD_PREVIEW_HOST = PRODUCTION : refuse");
  static_assert(sizeof(POD_PREVIEW_HOST) >= 5 && sizeof(POD_PREVIEW_HOST) <= 65, "POD_PREVIEW_HOST : 4 a 64 caracteres");
#endif
#if POD_VOTE_CANARY || POD_PREVIEW_ENROLL
#define POD_NOHW 1   // aucun écran, tactile ni carte SD : ni initialisation ni dessin (builds de vote et d'appairage)
#else
#define POD_NOHW 0
#endif

#include <Arduino.h>
#include <malloc.h>
#include <stdarg.h>
#include <WiFiS3.h>
#include <SPI.h>
#include <SD.h>
#include <EEPROM.h>
#include <ArduinoJson.h>
#include <Adafruit_GFX.h>
#include <Adafruit_ILI9341.h>
#include <Adafruit_STMPE610.h>
#include <qrcode.h>
#include <Ed25519.h>
#include "podEdStack.h"   // POD_ED_STACK : Ed25519 sur PILE DÉDIÉE (la pile principale de la R4 n'a que 1 024 o) — docs/LOT_8B2B2_PILE_ED25519_R4_2026_10_08.md
#include "podNetStack.h"   // POD_NET_STACK : transactions réseau/TLS ET journal sur PILE DÉDIÉE (connect() déborde de 456 o sous __StackLimit) — docs/LOT_8B2B2_NETSTACK_FIX1_2026_10_09.md, docs/LOT_8B2B2_NETSTACK_FIX2_2026_10_09.md
#include <SHA256.h>
#include "pod_http.h"
#include "pod_ssl_bounded.h"   // PULLFRAME-BOUNDED-SSL-FIX1 (porté au TFT 2,8″ : LOT8B2D) : client TLS dont la commande AT _SSLCLIENTRECEIVE est BORNÉE (240 o) — docs/LOT_8B2B2_PULLFRAME_BOUNDED_SSL_FIX1_2026_10_11.md
#include <new>
#include "pod_bench.h"
#include "pod_bench_stream.h"   // ANIM-STREAM-FIX1 (LOT8B2E) : validation et lecture du clip EN FLUX depuis la carte SD (plus de clip entier en RAM)
#if !POD_CANARY
#include "pod_vote_r4.h"       // validation réelle (vote v2) : SHA-256 + métriques entières en flux — ⚠ NON TESTÉ sur la carte
#endif

// ─── CONFIG ────────────────────────────────────────────────────────────────
// Wi-Fi : copier secrets.h.example en secrets.h (ignoré par git) puis renseigner SSID / mot de passe (2,4 GHz).
#if __has_include("secrets.h")
  #include "secrets.h"
  const char* WIFI_SSID     = SECRET_WIFI_SSID;
  const char* WIFI_PASSWORD = SECRET_WIFI_PASSWORD;
#else
  const char* WIFI_SSID     = "";            // ← créer secrets.h (voir secrets.h.example)
  const char* WIFI_PASSWORD = "";
#endif

#if POD_VOTE_CANARY
#define SERVER_HOST       POD_VOTE_BACKEND_HOST   // V4 : backend ISOLE (la production est refusee par la porte de vote)
#else
#if POD_PREVIEW_ENROLL
#define SERVER_HOST       POD_PREVIEW_HOST        // appairage Preview : backend ISOLE (la production est refusee)
#else
#define SERVER_HOST       "proof-of-draw.vercel.app"
#endif
#endif
#define SCREEN_TYPE       "tft28"            // profil serveur 240×320 RGB565 (lib/screenProfiles.ts)
#define FIRMWARE_VERSION  "r4tft28-2.5"
#define TOUCH_ENABLED     1                  // toucher = afficher / cacher le cartel
#define PULL_INTERVAL     60000UL
#define VALIDATE_INTERVAL 30000UL
#define HTTP_TIMEOUT_MS   20000UL

// Banc d'essai d'animation (voir docs/BENCH_ANIMATION.md) : le propriétaire l'active depuis l'app ; l'appareil le découvre dans /api/pull
// ("benchMode") puis interroge /api/bench/poll toutes les 3 s pendant au plus 31 min.
#define BENCH_POLL_MS      3000UL
#define BENCH_MODE_MAX_MS  (31UL * 60UL * 1000UL)
#define BENCH_MAX_CLIP     9216        // octets : le clip + la copie 1 Ko de l'image courante vivent dans le tas pendant la lecture
#define BENCH_FRAME        1024        // = podbench::FRAME_BYTES (les macros FRAME_BYTES / ROW_BYTES de ce sketch masquent les constantes de pod_bench.h)
#define BENCH_HDR          20          // = podbench::HEADER_BYTES
static_assert(podbench::W * podbench::H / 8 == BENCH_FRAME && podbench::HEADER_BYTES == BENCH_HDR, "pod_bench.h : constantes désynchronisées");

// ─── PINS (shield Adafruit 2.8" TFT Touch) ─────────────────────────────────
#define TFT_CS    10
#define TFT_DC    9
#define STMPE_CS  8
#define SD_CS     4

// ─── GÉOMÉTRIE : écran 240×320 portrait, l'œuvre en occupe la totalité ─────
#define SCR_W         240
#define SCR_H         320
#define ROW_BYTES     (SCR_W * 2)                 // 480
#define FRAME_BYTES   (SCR_W * SCR_H * 2)         // 153 600
#define BAND_TOP_H    40                          // cartel haut : y 0..39
#define BAND_BOT_Y    272                         // cartel bas : y 272..319 (48 px)
#define BAND_BOT_H    (SCR_H - BAND_BOT_Y)

// Couleurs RGB565
#define C_BLACK  0x0000
#define C_WHITE  0xFFFF
#define C_NAVY   0x08C5
#define C_GOLD   0xFEA0
#define C_DARK   0x10C4
#define C_GREY   0x7BEF
#define C_RED    0xF800

// ─── EEPROM (flash de données de la R4 : 8 Ko, pas de commit) — même carte mémoire que les firmwares ESP ─────────────
#define EEPROM_PRIVKEY_OFF     0
#define EEPROM_BLOCKHASH_OFF   32
#define EEPROM_FLAG_OFF        64
#define EEPROM_PUBKEY_OFF      65
#define KEY_GENERATED_FLAG     0xED
#define EEPROM_ONBOARDING_OFF  97
#define ONBOARDING_SHOWN_FLAG  0x01
#define EEPROM_OWNED_HEAD_OFF  98
#define EEPROM_OWNED_COUNT_OFF 99
#define EEPROM_OWNED_SLOTS_OFF 100
#define OWNED_SLOTS_MAX        10
#define OWNED_HASH_LEN         32

// ─── microSD : dernière image + son cartel ─────────────────────────────────
#define SD_DIR    "/pod"
#define SD_FRAME  "/pod/frame.bin"                // 153 600 o RGB565 little-endian, tel que reçu du serveur
#define SD_META   "/pod/meta.txt"                 // 4 lignes : frameId, n° de bloc, titre, artiste (écrit APRÈS l'image complète)
#define SD_ANIM   "/pod/anim.bin"                 // clip PBC1 de l'animation affichée (≤ 9 216 o), joué en boucle sans rien demander au serveur
#define SD_ANIM_META "/pod/anim.txt"              // 2 lignes : hash du bloc, frameId de l'affiche (écrit APRÈS le clip complet)

#if ARDUINOJSON_VERSION_MAJOR >= 7
  #define JSON_DOC(name, cap) JsonDocument name
#else
  #define JSON_DOC(name, cap) DynamicJsonDocument name(cap)
#endif

// ─── OBJETS ────────────────────────────────────────────────────────────────
Adafruit_ILI9341  tft(TFT_CS, TFT_DC);
Adafruit_STMPE610 ts(STMPE_CS);
bool touchOk = false;
bool sdOk = false;                                // carte lisible
bool sdFrameValid = false;                        // /pod/frame.bin complet = l'image affichée → cartel masquable
bool cartelVisible = false;                       // les bandes sont dessinées par-dessus l'œuvre
const char* sdWhy = "SD absente";                 // raison affichée dans le cartel quand il ne peut pas être masqué ("" = tout va bien)

// ─── ÉTAT ──────────────────────────────────────────────────────────────────
String deviceId, pairCode;
bool   registered = false, paired = false;
String lastFrameId = "";
bool   lastFrameWasConsensus = false;

uint8_t privateKey[32], publicKey[32];
bool    keysLoaded = false;
#if !POD_CANARY
static bool g_edSelfTestOk = false;   // LOT8B2E V2 (R-H1) : résultat de l'auto-test Ed25519 du boot (porte du vote) ; faux tant qu'il n'a pas réussi ; jamais refait à chaque vote
// LOT8B2E V2 : l'énumération est déclarée ICI (avant toute fonction) : le générateur de prototypes de l'IDE Arduino place les prototypes avant sa définition sinon (erreur « VoteOutcome was not declared »).
enum VoteOutcome : uint8_t { VOTE_NOT_SENT = 0, VOTE_SENT_UNKNOWN = 1, VOTE_ACCEPTED = 2, VOTE_REFUSED_BY_SERVER = 3, VOTE_SIGNATURE_REFUSED = 4, VOTE_HASH_REFUSED = 5 };
#if POD_VOTE_CANARY
// V4 : types du verrou, déclarés ICI pour la même raison (prototypes générés par l'IDE).
struct VoteLockRec { uint32_t magic; uint8_t ver, state, outcome, seq; uint32_t pin; uint32_t crc; };
static_assert(sizeof(VoteLockRec) == 16, "VoteLockRec : 16 octets");
enum VlSlot : uint8_t { VL_BLANK = 0, VL_VALID = 1, VL_INVALID = 2 };
enum VlStatus : uint8_t { VLS_FREE = 0, VLS_HELD = 1, VLS_UNAVAILABLE = 2 };
static void vcHalt(const char* why);   // arrêt définitif (défini plus bas)
#endif
#endif

String currentBlockHash = "";
int    currentBlockIndex = -1;
String pendingCandidateId = "";
unsigned long lastPullMs = 0, lastValidateMs = 0, nextPullIntervalMs = PULL_INTERVAL;

String pendingWorkTitle = "", pendingArtistName = "";
String pendingObsHashes = "", pendingObsTarget = "";

bool benchMode = false;                           // mode banc d'essai actif (annoncé par /api/pull)
unsigned long benchModeSince = 0, lastBenchPollMs = 0;
String lastBenchClipId = "";
static bool g_quietHttp = false;                  // pas de ligne [HTTP] pour chaque poll réussi (toutes les 3 s)

// Animation RÉSIDENTE (r4tft28-2.4) : /api/pull annonce un pointeur `anim` (hash du bloc) ; le clip est téléchargé UNE fois (/api/block-clip, mis en
// cache par le CDN), rangé sur la carte microSD, puis joué EN BOUCLE sans AUCUNE requête (coût Redis nul entre deux pulls). L'affiche (image fixe) reste
// la repli : toucher = pause + cartel, re-toucher (ou 60 s) = reprise. Redémarrage : l'animation reprend depuis la carte.
enum AnimEnd : uint8_t { AE_TIME = 0, AE_TOUCH, AE_ERROR };   // déclaré ici : les prototypes que l'IDE génère passent AVANT le reste du code
bool   animOn = false;                            // un clip est sur la carte et correspond à l'œuvre affichée
bool   animPaused = false;                        // en pause (toucher) : l'affiche et le cartel sont à l'écran
unsigned long animPausedSince = 0;
String animHash = "";                             // bloc dont le clip est sur la carte
String pendingAnimHash = "";                      // pointeur reçu par le dernier pull
size_t pendingAnimBytes = 0;

static char     g_body[3072];                   // corps JSON des réponses
static uint16_t g_row[SCR_W];                   // une ligne d'image (octets little-endian reçus, puis big-endian pour le bus)
static void fastPixels(const uint16_t* colors, uint32_t len);   // envoi d'un bloc de pixels par le cœur SPI (défini avec le banc d'essai)

// ─── LOG ───────────────────────────────────────────────────────────────────
// POD_LOG_STACK (NETSTACK-FIX2) : le formatage (vsnprintf) et l'écriture USB (Serial) descendent d'environ 450 o sous leur appelant ; appelés depuis setup → doRegister → httpCall (608 o de cadres) ils dépassent
// les 1 024 o de la pile principale (canari du 09/10/2026 : 24 o sous __StackLimit). Sur la pile PRINCIPALE, logf s'exécute donc sur une petite pile dédiée (POD_LOG_STACK_TOTAL) ; sur une pile dédiée (dans une
// transaction réseau), directement. Échec (malloc, garde, marge) : la ligne est ABANDONNÉE — un journal ne doit jamais arrêter le firmware.
// NETSTACK-FIX3 : GUARD = la garde de la pile de journal a été écrasée → le voisin au tas est corrompu : faute persistante, ARRÊT SÛR SILENCIEUX (aucun pull, vote, ACK ni affichage ; la carte se tait), jamais « une ligne perdue ».
// MARGIN (garde intacte, marge < 128 o) : fatal dans le build de canari seulement ; en production la ligne a été écrite et on continue (NOMEM : ligne abandonnée).
#if POD_CANARY
static uint16_t g_canLogMin = 0xFFFF;              // marge minimale observée de la pile de journal (canari)
#define POD_CANARY_LOGINFO(li) do { if ((li).margin < g_canLogMin) g_canLogMin = (li).margin; } while (0)
#define POD_CANARY_LOG_FATAL(li) ((li).err == POD_NET_MARGIN)
#else
#define POD_CANARY_LOGINFO(li) ((void)0)
#define POD_CANARY_LOG_FATAL(li) (false)
#endif
static void __attribute__((noinline, noreturn)) logfSafeStop() {
  for (;;) { __asm volatile("nop"); }              // NETSTACK-FIX3-R1 : AUCUNE E/S, AUCUNE allocation, AUCUN retour (appelée depuis un cadre quelconque de la pile principale : un Serial.println ici peut lui-même la déborder)
}
struct LogJob { const char* fmt; va_list* ap; };
static void logfEmit(void* p) {
  static char b[256];                              // statique : la pile du cœur R4 ne fait que 1 Ko
  LogJob* j = static_cast<LogJob*>(p);
  vsnprintf(b, sizeof(b), j->fmt, *j->ap);
  Serial.println(b);
}
static void logf(const char* fmt, ...) {
  va_list ap; va_start(ap, fmt);
  LogJob j = { fmt, &ap };
  if (podNetOnMainStack()) {
    PodNetInfo li;
    PodNet::runSized(logfEmit, &j, POD_LOG_STACK_TOTAL, &li);
    POD_CANARY_LOGINFO(li);
    if (li.err == POD_NET_GUARD || POD_CANARY_LOG_FATAL(li)) logfSafeStop();
  } else logfEmit(&j);
  va_end(ap);
}

// ─── MÉMOIRE : 32 Ko de RAM, PILE PRINCIPALE DE 1 Ko SEULEMENT (cœur Arduino R4, BSP_CFG_STACK_MAIN_BYTES = 0x400) ─────────
// Le cœur désactive la protection de pile (MSPLIM = 0) : une pile qui dépasse 1 Ko descend dans le HAUT du tas (zone libre tant que
// le tas est peu rempli). Ed25519 a besoin d'environ 1,4 Ko : il s'exécute désormais sur une PILE DÉDIÉE (podEdStack.h), plus dans le haut du tas (POD_ED_STACK).
// Règle de ce firmware : aucun gros bloc ni gros tableau local (tampons statiques). Les diagnostics [MEM] affichent le tas libre et
// la profondeur de pile atteinte : à relever au premier essai.
extern "C" char* sbrk(int incr);
extern char __HeapLimit;                    // symbole de l'éditeur de liens : fin du tas = bas de la pile principale
static const uint32_t STACK_PAINT_BYTES = 2048;
static uint32_t freeHeapBytes() {
  struct mallinfo mi = mallinfo();
  return (uint32_t)mi.fordblks + (uint32_t)(&__HeapLimit - (char*)sbrk(0));
}
static void paintStack() { for (volatile uint8_t* p = (volatile uint8_t*)&__HeapLimit - STACK_PAINT_BYTES; p < (volatile uint8_t*)&__HeapLimit; p++) *p = 0xA5; }
/** Profondeur de pile maximale atteinte depuis paintStack() : 1 Ko de pile propre + ce qui a débordé dans le haut du tas. */
static uint32_t stackDepthBytes() {
  const uint8_t* lo = (const uint8_t*)&__HeapLimit - STACK_PAINT_BYTES;
  const uint8_t* p = lo;
  while (p < (const uint8_t*)&__HeapLimit && *p == 0xA5) p++;
  return 1024 + (uint32_t)((const uint8_t*)&__HeapLimit - p);
}
static void reportMem(const char* tag) { logf("[MEM] %s: tas libre %lu o, zone 0xA5 sous la pile %lu o (INDICATIF : NON fiable des la 1re pile temporaire)", tag, (unsigned long)freeHeapBytes(), (unsigned long)stackDepthBytes()); }

#if POD_CANARY
// ─── CANARI (LOT8B2D) — build local SANS VOTE ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Instrument de la pile PRINCIPALE (1 024 o) : marqueur « CNRY » au fond + zone peinte 0x5A (comme le canari du e-ink 2,9″), contrôlé APRÈS le retour des étapes (jamais depuis le corps d'une fonction de rapport : un contrôle
// appelé depuis un cadre vivant ajoute son propre cadre à la mesure). Toute sortie passe par la pile de JOURNAL dédiée quand l'appelant est sur la pile principale. Critères FATALS : marqueur ou longueur détruits, SP hors pile,
// marge principale < 128 o, ou erreur d'une pile dédiée (réseau, Wi-Fi, travail, Ed25519, journal) : verrou fatal (plus aucun pull, ACK ni affichage). Objectif de marge : >= 256 o (en dessous : « SOUS L'OBJECTIF », sans arrêt).
// Aucun polling n'est accéléré, aucune requête n'est ajoutée : l'instrument n'émet que sur le port série.
extern char __StackLimit, __StackTop;
static const uint8_t CANARY_PAINT = 0x5A;
static const uint32_t CANARY_MAGIC = 0x434E5259UL;   // « CNRY »
static volatile uint32_t g_podPaintLen = 0;
// LEST : le canari ne compile pas le vote, donc perd ses tampons statiques (g_voteChunk 256 o + g_voteScratch 4 736 o). Sans lest, le TAS du canari serait plus grand que celui de la production (≈ 5,4 Ko de plus) et les mesures de tas seraient
// optimistes. Le lest rend la RAM statique du canari égale à celle du firmware de production (relevé : voir docs/LOT_8B2D_R4_TFT28_CANARY_2026_10_12.md).
static volatile uint8_t g_canBallast[5416];
static void podCanaryNum(const __FlashStringHelper* label, unsigned long v) { Serial.print(label); Serial.print(v); }
static void podCanaryEmit(void (*fn)(void*), void* ctx) {
  if (podNetOnMainStack()) PodNet::runSized(fn, ctx, POD_LOG_STACK_TOTAL);
  else fn(ctx);
}
// VERROU FATAL : aucun appel réseau, aucune EEPROM, aucun delay(). Le message n'est écrit que s'il reste de la place dans le tampon USB (le cœur R4 boucle sans limite sur SerialUSB::write quand l'hôte ne le vide pas).
static void __attribute__((noinline, noreturn)) podCanaryHalt(const char* tag) {
  unsigned long t = millis() - 10000UL;
  for (;;) if (millis() - t >= 10000UL) {
    t = millis();
    if (Serial.availableForWrite() >= 120) { Serial.print(F("[CANARY] ARRET FATAL (verrou) apres '")); Serial.print(tag); Serial.println(F("' : plus aucun pull, ACK ni affichage. Debrancher la carte, reflasher le firmware stable.")); }
  }
}
static void podCanaryPaint() {
  volatile uint8_t* lo = (volatile uint8_t*)&__StackLimit;
  volatile uint8_t* hi = (volatile uint8_t*)__builtin_frame_address(0) - 192;
  if (hi <= lo + 16) return;
  for (volatile uint8_t* p = lo + 8; p < hi; p++) *p = CANARY_PAINT;
  *(volatile uint32_t*)lo = CANARY_MAGIC;
  *(volatile uint32_t*)(lo + 4) = (uint32_t)(hi - lo);
  g_podPaintLen = (uint32_t)(hi - lo);
}
// plus grand bloc libre : sonde par dichotomie malloc/free (le cœur R4 n'expose pas la plus grande plage de l'arène) ; fragmentation = 100 − (plus grand bloc / tas libre)
static uint32_t podCanaryMaxBlock() {
  uint32_t lo = 0, hi = freeHeapBytes();
  if (hi > 30000UL) hi = 30000UL;
  while (lo < hi) { const uint32_t mid = (lo + hi + 1) / 2; void* q = malloc(mid); if (q) { free(q); lo = mid; } else hi = mid - 1; }
  return lo;
}
struct PodCanaryHeapCtx { const char* tag; };
static void podCanaryPrintHeap(void* v) {
  const PodCanaryHeapCtx& c = *static_cast<const PodCanaryHeapCtx*>(v);
  const uint32_t fr = freeHeapBytes(), mb = podCanaryMaxBlock();
  Serial.print(F("[CANARY] tas ")); Serial.print(c.tag); podCanaryNum(F(" : libre "), fr); podCanaryNum(F(" o, plus grand bloc "), mb); podCanaryNum(F(" o, fragmentation "), fr ? 100UL - (100UL * mb) / fr : 0UL); Serial.println(F(" %"));
}
static void __attribute__((noinline)) podCanaryHeap(const char* tag) { PodCanaryHeapCtx c = { tag }; podCanaryEmit(podCanaryPrintHeap, &c); }
struct PodCanaryCtx { const char* tag; uint32_t magic, painted, used, sp; long margin; bool alert, magicOk, paintedOk, spOk; };
static void podCanaryPrint(void* v) {
  const PodCanaryCtx& c = *static_cast<const PodCanaryCtx*>(v);
  Serial.print(F("[CANARY] ")); Serial.print(c.tag); Serial.print(c.alert ? F(" : ALERTE PILE principale utilisee au plus ") : F(" : pile principale utilisee au plus "));
  Serial.print(c.used); podCanaryNum(F(" o / 1024 (marge "), (unsigned long)(c.margin < 0 ? 0 : c.margin));
  Serial.print(c.margin < 0 ? F(" o, NEGATIVE)") : (c.margin < 256 && !c.alert) ? F(" o, SOUS L'OBJECTIF 256)") : F(" o)"));
  podCanaryNum(F(" | tas libre "), freeHeapBytes()); Serial.println();
  if (!c.alert) return;
  Serial.print(F("[CANARY]   marqueur=0x")); Serial.print(c.magic, HEX); Serial.print(c.magicOk ? F(" (OK)") : F(" (DETRUIT, attendu 0x434E5259)"));
  Serial.print(F(" longueur peinte=")); Serial.print(c.painted); Serial.print(c.paintedOk ? F(" (OK)") : F(" (INCOHERENTE)")); Serial.print(F(" SP=0x")); Serial.print(c.sp, HEX); Serial.println(c.spOk ? F(" dans la pile") : F(" HORS de la pile"));
  podCanaryHalt(c.tag);
}
static void __attribute__((noinline)) podCanaryCheck(const char* tag, bool verbose) {
  volatile uint8_t* lo = (volatile uint8_t*)&__StackLimit;
  const uint32_t magic = *(volatile uint32_t*)lo, painted = *(volatile uint32_t*)(lo + 4);
  const bool magicOk = (magic == CANARY_MAGIC), paintedOk = (painted >= 16 && painted <= 1024 && painted == g_podPaintLen);
  volatile uint8_t* end = lo + (paintedOk ? painted : 512);
  volatile uint8_t* q = lo + 8; while (q < end && *q == CANARY_PAINT) q++;          // plus bas octet modifié AU-DESSUS du marqueur
  const uint32_t used = (uint32_t)((uint8_t*)&__StackTop - (uint8_t*)q);
  const long margin = 1024L - (long)used;
  const uint32_t sp = (uint32_t)(uintptr_t)__builtin_frame_address(0);
  const bool spOk = sp > (uint32_t)(uintptr_t)&__StackLimit && sp <= (uint32_t)(uintptr_t)&__StackTop;
  const bool alert = !magicOk || !paintedOk || margin < 128 || !spOk;
  if (!alert && !verbose) return;
  PodCanaryCtx c = { tag, magic, painted, used, sp, margin, alert, magicOk, paintedOk, spOk };
  podCanaryEmit(podCanaryPrint, &c);
  if (alert) for (;;) { __asm volatile("nop"); }                                     // l'impression a échoué (mémoire) : verrou SILENCIEUX
}
// Une pile dédiée (réseau, Wi-Fi, travail, Ed25519) : utilisée / marge / erreur ; toute erreur pose le verrou fatal.
struct PodCanaryStackCtx { const char* kind; const char* tag; const PodNetInfo* ni; bool ran; uint8_t status; };
static void podCanaryPrintStack(void* v) {
  const PodCanaryStackCtx& c = *static_cast<const PodCanaryStackCtx*>(v);
  const PodNetInfo& ni = *c.ni;
  Serial.print(F("[CANARY] pile ")); Serial.print(c.kind); Serial.print(' '); Serial.print(c.tag); podCanaryNum(F(" : utilisee "), ni.used); podCanaryNum(F(" o, marge "), ni.margin);
  Serial.print(ni.low ? F(" o (objectif >= 256 : SOUS L'OBJECTIF)") : F(" o (objectif >= 256 : OK)")); podCanaryNum(F(", erreur "), ni.err); podCanaryNum(F(", statut "), c.status);
  podCanaryNum(F(" | tas libre "), freeHeapBytes()); Serial.println();
  if (!c.ran || ni.err != POD_NET_OK) { Serial.println(F("[CANARY] ECHEC d'une pile dediee (ALERTE)")); podCanaryHalt(c.tag); }
}
static void __attribute__((noinline)) podCanaryStack(const char* kind, const char* tag, const PodNetInfo& ni, bool ran, uint8_t status, bool statusBad, bool verbose) {
  const bool bad = !ran || ni.err != POD_NET_OK || statusBad;
  if (!verbose && !bad) return;
  PodCanaryStackCtx c = { kind, tag, &ni, ran, status };
  podCanaryEmit(podCanaryPrintStack, &c);
  if (bad) for (;;) { __asm volatile("nop"); }                                        // l'impression a échoué : verrou SILENCIEUX
}
#define POD_CANARY_JSON(tag, ni, ran, status, okA, okB) podCanaryStack("travail", tag " JSON", ni, ran, (uint8_t)(status), !((status) == (okA) || (status) == (okB)), true)
#define POD_CANARY_NET(tag, ni, ran) podCanaryStack("reseau", tag, ni, ran, 0, false, true)
// ANIM-STREAM-FIX1 : les deux piles SD NOUVELLEMENT chargées (validation et lecture du clip en flux) rapportent leur marge à chaque passage (les autres : seulement en cas d'anomalie)
static bool podCanarySdVerbose(const char* tag) { return strcmp(tag, "animPlay") == 0 || strcmp(tag, "animValidate") == 0; }
#define POD_CANARY_SD(tag, ni, ran) podCanaryStack("sd/tft", tag, ni, ran, 0, false, podCanarySdVerbose(tag))
#define POD_CANARY_WIFI(tag, ni, ran, verbose) podCanaryStack("wifi", tag, ni, ran, 0, false, verbose)
// PodEdInfo (used / margin / err) → PodNetInfo, pour le même rapport ; marge < 256 = « sous l'objectif »
static void __attribute__((noinline)) podCanaryEd(const char* tag, const PodEdInfo& ei) {
  PodNetInfo ni; memset(&ni, 0, sizeof(ni));
  ni.used = ei.used; ni.margin = ei.margin; ni.err = ei.err; ni.low = ei.margin < POD_NET_MARGIN_GOAL ? 1 : 0;
  podCanaryStack("ed25519", tag, ni, true, 0, false, true);
}
#define POD_CANARY_ED(tag, ei) podCanaryEd(tag, ei)
#define POD_CANARY_CHECK(tag) podCanaryCheck(tag, true)
#define POD_CANARY_HEAP(tag) podCanaryHeap(tag)
#define POD_CANARY_NO_BENCH(flag) do { if (flag) { logf("[CANARY] banc d'essai annonce par le serveur : IGNORE en canari"); flag = false; } } while (0)
#define POD_CANARY_CANDIDATE(candId) do { if ((candId).length() > 0) logf("[CANARY] candidat annonce : AUCUN vote en build canari (oublie localement)"); } while (0)
#endif
// Crochets du CANARI : sans effet hors canari (POD_CANARY = 0) ; les macros n'évaluent leurs arguments qu'en canari.
#ifndef POD_CANARY_JSON
#define POD_CANARY_JSON(tag, ni, ran, status, okA, okB) ((void)0)
#define POD_CANARY_NET(tag, ni, ran) ((void)0)
#define POD_CANARY_SD(tag, ni, ran) ((void)0)
#define POD_CANARY_WIFI(tag, ni, ran, verbose) ((void)0)
#define POD_CANARY_ED(tag, ni) ((void)0)
#define POD_CANARY_CHECK(tag) ((void)0)
#define POD_CANARY_HEAP(tag) ((void)0)
#define POD_CANARY_NO_BENCH(flag) ((void)0)
#define POD_CANARY_CANDIDATE(candId) do { if ((candId).length() > 0) pendingCandidateId = (candId); } while (0)
#endif

// ─── microSD / TFT SUR PILE DÉDIÉE (LOT8B2D, SD-STACK-FIX1) ───────────────────────────────────────────────────────────────────────────────────────────────
// ANALYSE STATIQUE du firmware d'avant le lot (scripts/tft28-stack-report.js, ELF des cœurs 1.5.3 et 1.6.0) : les accès à la carte SD faits depuis la pile PRINCIPALE (1 024 o) descendent de 650 à 700 o sous leur appelant
// (SD.open → getParentDir → SdFile::open → … → Sd2Card::cardCommand → ArduinoSPI::beginTransaction → configSpiSci → R_SCI_SPI_CalculateBitrate → __aeabi_ldivmod) : depuis loop (280 o) restoreRows laissait 24 o de marge, depuis setup
// la création du clip d'animation (maybeFetchAnim → SD.open) dépassait 1 024 o (−160 o, en théorie). Toutes les opérations SD / TFT de haut niveau exécutées depuis la pile principale passent donc par onSd() : une pile dédiée de
// POD_SD_STACK_TOTAL o pris un instant au tas (garde 64 o, filigrane, marge >= 128 o, objectif 256 o, effacée avant free, jamais imbriquée — déjà sur une pile dédiée : exécution directe). ÉCHEC FERMÉ : l'opération n'est pas faite
// (ou son résultat est rejeté) et le journal le dit ; GUARD => arrêt sûr silencieux. Comportement fonctionnel inchangé (mêmes appels SD / TFT, même ordre, mêmes octets).
#define POD_SD_STACK_TOTAL 1536u
static void __attribute__((noinline)) sdStackFailed(const char* what, const PodNetInfo& ni) {
  if (ni.err == POD_NET_GUARD) logfSafeStop();
  logf("[SD] pile dédiée (%s) : %s (erreur %u, marge %u o) — opération NON faite ou résultat rejeté", what, podNetWhy(ni), (unsigned)ni.err, (unsigned)ni.margin);
}
#include "pod_sd_stack.h"   // onSd / onSdDirect (gabarits) : hors du .ino, voir l'en-tête (générateur de prototypes d'Arduino)

// ─── Texte : ASCII seulement (police 5×7 de GFX) — replie les accents UTF-8 ─────────────────
static String asciiFold(const String& in) {
  static const char* L1 = "AAAAAAACEEEEIIIIDNOOOOO*OUUUUYTsaaaaaaaceeeeiiiidnooooo/ouuuuyty";   // U+00C0..U+00FF
  String out; out.reserve(in.length());
  for (unsigned i = 0; i < in.length(); i++) {
    const uint8_t c = (uint8_t)in[i];
    if (c < 0x80) { out += (char)(c >= 32 && c < 127 ? c : ' '); continue; }
    if (c == 0xC3 && i + 1 < in.length()) { const uint8_t d = (uint8_t)in[++i]; out += (d >= 0x80 && d < 0xC0) ? L1[d - 0x80] : '?'; continue; }
    if (c >= 0xC0) { out += '?'; while (i + 1 < in.length() && ((uint8_t)in[i + 1] & 0xC0) == 0x80) i++; }
  }
  return out;
}

// ─── EEPROM ────────────────────────────────────────────────────────────────
static String bytesToHex(const uint8_t* buf, size_t len) {
  String hex; hex.reserve(len * 2);
  for (size_t i = 0; i < len; i++) { if (buf[i] < 16) hex += "0"; hex += String(buf[i], HEX); }
  return hex;
}
static bool keysAlreadyGenerated()   { return EEPROM.read(EEPROM_FLAG_OFF) == KEY_GENERATED_FLAG; }
static bool onboardingAlreadyShown() { return EEPROM.read(EEPROM_ONBOARDING_OFF) == ONBOARDING_SHOWN_FLAG; }
static void setOnboardingShown()     { EEPROM.update(EEPROM_ONBOARDING_OFF, ONBOARDING_SHOWN_FLAG); }

static void saveKeysToEEPROM() {
  for (int i = 0; i < 32; i++) EEPROM.update(EEPROM_PRIVKEY_OFF + i, privateKey[i]);
  for (int i = 0; i < 32; i++) EEPROM.update(EEPROM_PUBKEY_OFF + i, publicKey[i]);
  EEPROM.update(EEPROM_FLAG_OFF, KEY_GENERATED_FLAG);
}
static void loadKeysFromEEPROM() {
  for (int i = 0; i < 32; i++) privateKey[i] = EEPROM.read(EEPROM_PRIVKEY_OFF + i);
  for (int i = 0; i < 32; i++) publicKey[i]  = EEPROM.read(EEPROM_PUBKEY_OFF + i);
  uint8_t derived[32];
  if (!PodEd::derivePublicKey(derived, privateKey)) logf("[KEYS] cohérence NON vérifiée : calcul Ed25519 impossible (pile dédiée) — clé publique de l'EEPROM conservée");   // POD_ED_STACK
  else if (memcmp(derived, publicKey, 32) != 0) {   // écriture interrompue entre clé privée et publique
    logf("[KEYS] Clé publique incohérente -> recalcul depuis la clé privée");
    memcpy(publicKey, derived, 32);
    for (int i = 0; i < 32; i++) EEPROM.update(EEPROM_PUBKEY_OFF + i, publicKey[i]);
  }
  keysLoaded = true;
}
static void saveBlockHashToEEPROM(const String& hash) {
  String h = hash.length() >= 32 ? hash.substring(0, 32) : hash;
  while (h.length() < 32) h += ' ';
  for (int i = 0; i < 32; i++) EEPROM.update(EEPROM_BLOCKHASH_OFF + i, (uint8_t)h[i]);
}
static String loadBlockHashFromEEPROM() {
  String hash = "";
  for (int i = 0; i < 32; i++) { char c = (char)EEPROM.read(EEPROM_BLOCKHASH_OFF + i); if (c == ' ' || c == '\0') break; hash += c; }
  return hash;
}

// Anneau des blocs possédés (10 × 32 caractères), identique aux autres firmwares
static void saveOwnedBlockHash(const String& fullHash) {
  if (fullHash.length() < 16) return;
  String h = fullHash.length() >= OWNED_HASH_LEN ? fullHash.substring(0, OWNED_HASH_LEN) : fullHash;
  while ((int)h.length() < OWNED_HASH_LEN) h += ' ';
  uint8_t head = EEPROM.read(EEPROM_OWNED_HEAD_OFF), count = EEPROM.read(EEPROM_OWNED_COUNT_OFF);
  if (head >= OWNED_SLOTS_MAX) head = 0;
  if (count > OWNED_SLOTS_MAX) count = 0;
  for (uint8_t i = 0; i < count; i++) {
    const uint8_t slot = (head - count + i + OWNED_SLOTS_MAX) % OWNED_SLOTS_MAX;
    const int off = EEPROM_OWNED_SLOTS_OFF + slot * OWNED_HASH_LEN;
    bool match = true;
    for (int j = 0; j < OWNED_HASH_LEN && match; j++) if ((char)EEPROM.read(off + j) != h[j]) match = false;
    if (match) { logf("[OWNED] déjà présent"); return; }
  }
  const int slotOff = EEPROM_OWNED_SLOTS_OFF + head * OWNED_HASH_LEN;
  for (int i = 0; i < OWNED_HASH_LEN; i++) EEPROM.update(slotOff + i, (uint8_t)h[i]);
  head = (head + 1) % OWNED_SLOTS_MAX;
  count = (count + 1 > OWNED_SLOTS_MAX) ? OWNED_SLOTS_MAX : count + 1;
  EEPROM.update(EEPROM_OWNED_HEAD_OFF, head);
  EEPROM.update(EEPROM_OWNED_COUNT_OFF, count);
  logf("[OWNED] %s... (%u/%u)", h.substring(0, 8).c_str(), count, OWNED_SLOTS_MAX);
}
static String loadOwnedHashesJson() {
  uint8_t head = EEPROM.read(EEPROM_OWNED_HEAD_OFF), count = EEPROM.read(EEPROM_OWNED_COUNT_OFF);
  if (head >= OWNED_SLOTS_MAX) head = 0;
  if (count > OWNED_SLOTS_MAX) count = 0;
  if (count == 0) return "[]";
  String json = "["; bool first = true;
  for (uint8_t i = 0; i < count; i++) {
    const uint8_t slot = (head - 1 - i + OWNED_SLOTS_MAX) % OWNED_SLOTS_MAX;
    const int off = EEPROM_OWNED_SLOTS_OFF + slot * OWNED_HASH_LEN;
    String h = "";
    for (int j = 0; j < OWNED_HASH_LEN; j++) { char c = (char)EEPROM.read(off + j); if (c == ' ' || c == '\0') break; h += c; }
    if (h.length() >= 8) { if (!first) json += ","; json += "\"" + h + "\""; first = false; }
  }
  return json + "]";
}

// ─── MODULE Wi-Fi sur PILE DÉDIÉE (NETSTACK-WIFI-CALLS-FIX1, 09/10/2026) ──────────────────────────────────
// Canari FIX3-R1 (matériel) : WiFi.macAddress() appelé depuis doRegister détruit le marqueur de pile (24 o sous __StackLimit) : chaque appel au module (ModemClass → vsnprintf) pose une feuille de 400 – 600 o sur le cadre
// de l'appelant. TOUT appel direct au module hors transaction PodNet passe donc par ces fonctions : il s'exécute sur POD_WIFI_STACK_TOTAL o pris un instant au tas (garde 64 o, filigrane, marge >= 128 o, objectif 256 o).
// Résultats chez l'APPELANT (variables captées par référence) ; jamais imbriqué (NESTED : un appel déjà sur une pile dédiée n'est pas ré-enveloppé) ; ÉCHEC FERMÉ : valeur « inconnue », chaîne vide ou false — jamais un résultat
// partiel (NOMEM, NESTED, GUARD, MARGIN). Les appels faits PAR une transaction PodNet (WiFiSSLClient dans podNetRun) restent sur la pile réseau.
#define POD_WIFI_UNKNOWN 0xFEu                         // état Wi-Fi inconnu (appel en échec) : ni WL_CONNECTED ni WL_NO_MODULE
static void __attribute__((noinline)) wifiFailed(const char* what, const PodNetInfo& ni) {   // attribut : le générateur de prototypes de l IDE placerait sinon le prototype AVANT la définition de PodNetInfo
  if (ni.err == POD_NET_GUARD) logfSafeStop();             // garde écrasée : le voisin au tas est corrompu — arrêt sûr silencieux, AVANT tout journal (logf alloue au tas)
  logf("[WIFI] %s : pile Wi-Fi dédiée : %s (erreur %u, marge %u o) — résultat IGNORÉ", what, podNetWhy(ni), (unsigned)ni.err, (unsigned)ni.margin);
}
static uint8_t __attribute__((noinline)) wifiStatusT(const char* tag) {
  uint8_t st = POD_WIFI_UNKNOWN; PodNetInfo ni; (void)tag;           // tag : seulement pour le relevé du canari
  auto wx = [&]() { st = (uint8_t)WiFi.status(); };
  const bool ran = podWifiRun(wx, &ni);
  POD_CANARY_WIFI("status", ni, ran, false);
  if (!ran) { wifiFailed("status", ni); return POD_WIFI_UNKNOWN; }
  return st;
}
static uint8_t wifiStatus() { return wifiStatusT(nullptr); }
static String __attribute__((noinline)) wifiFirmware() {
  String fw; PodNetInfo ni;
  auto wx = [&]() { fw = String(WiFi.firmwareVersion()); };
  const bool ran = podWifiRun(wx, &ni);
  POD_CANARY_WIFI("firmwareVersion", ni, ran, true);
  if (!ran) { wifiFailed("firmwareVersion", ni); return String("?"); }
  return fw;
}
static void __attribute__((noinline)) wifiBegin() {
  PodNetInfo ni;
  auto wx = [&]() { WiFi.begin(WIFI_SSID, WIFI_PASSWORD); };
  const bool ran = podWifiRun(wx, &ni);
  POD_CANARY_WIFI("begin", ni, ran, true);
  if (!ran) wifiFailed("begin", ni);
}
static bool __attribute__((noinline)) wifiMac(uint8_t m[6]) {
  PodNetInfo ni;
  auto wx = [&]() { WiFi.macAddress(m); };
  const bool ran = podWifiRun(wx, &ni);
  POD_CANARY_WIFI("macAddress", ni, ran, true);
  if (!ran) { memset(m, 0, 6); wifiFailed("macAddress", ni); return false; }
  return true;
}
static bool __attribute__((noinline)) wifiRssi(int32_t& rssi) {
  PodNetInfo ni; int32_t r = 0;
  auto wx = [&]() { r = (int32_t)WiFi.RSSI(); };
  const bool ran = podWifiRun(wx, &ni);
  POD_CANARY_WIFI("RSSI", ni, ran, true);
  if (!ran) { rssi = 0; wifiFailed("RSSI", ni); return false; }
  rssi = r;
  return true;
}
static String __attribute__((noinline)) wifiIpString() {
  String ip; PodNetInfo ni;                  // la chaîne « a.b.c.d » est formée SUR la pile dédiée (IPAddress::toString → sniprintf : jamais sur la pile principale)
  auto wx = [&]() { ip = WiFi.localIP().toString(); };
  const bool ran = podWifiRun(wx, &ni);
  POD_CANARY_WIFI("localIP", ni, ran, true);
  if (!ran) { wifiFailed("localIP", ni); return String("?"); }
  return ip;
}

// ─── Clés Ed25519 ──────────────────────────────────────────────────────────
// Entropie : bruit des entrées analogiques flottantes + gigue d'horloge + MAC + RSSI, condensés par SHA-256.
// (Même niveau que les firmwares ESP : suffisant pour identifier un écran, PAS un générateur certifié.)
static bool gatherEntropy(uint8_t out[32]) {
  SHA256 h; h.reset();
  uint8_t mac[6] = {0}; int32_t rssi = 0;
  if (!wifiMac(mac) || !wifiRssi(rssi)) { memset(out, 0, 32); return false; }   // NETSTACK-WIFI-CALLS-FIX1 : échec fermé — aucune entropie partielle
  h.update(mac, 6);
  h.update(&rssi, sizeof(rssi));
  for (int i = 0; i < 384; i++) {
    const uint16_t v = (uint16_t)analogRead(A0 + (i % 6));
    const uint32_t m = micros();
    h.update(&v, sizeof(v)); h.update(&m, sizeof(m));
    delayMicroseconds(29 + (v & 15));
  }
  h.finalize(out, 32);
  return true;
}
static void generateKeys() {
  logf("[KEYS] Génération de la paire Ed25519...");
  if (!gatherEntropy(privateKey)) { logf("[KEYS] génération ANNULÉE : module Wi-Fi indisponible (pile dédiée) — aucune clé enregistrée"); memset(privateKey, 0, 32); return; }
  if (!PodEd::derivePublicKey(publicKey, privateKey)) { logf("[KEYS] génération ANNULÉE : calcul Ed25519 impossible (pile dédiée) — aucune clé enregistrée"); memset(privateKey, 0, 32); return; }   // POD_ED_STACK
  keysLoaded = true;
  saveKeysToEEPROM();
  logf("[KEYS] PubKey: %s", bytesToHex(publicKey, 32).c_str());
}
// CANARI SANS VOTE : la signature d'un vote n'existe pas dans le binaire
#if !POD_CANARY
#if POD_VOTE_V1
static String signED25519(const String& candidateId, float score) {
  const int m = (int)(score * 1000.0f + 0.5f);               // « 0.543 » : 3 décimales, comme toFixed(3) côté serveur
  char scoreStr[12]; snprintf(scoreStr, sizeof(scoreStr), "%d.%03d", m / 1000, m % 1000);
  const String message = deviceId + ":" + candidateId + ":" + scoreStr;
  uint8_t sig[64];
  if (!PodEd::sign(sig, privateKey, publicKey, (const uint8_t*)message.c_str(), message.length())) { logf("[VOTE] signature impossible (pile Ed25519 dédiée) — vote NON envoyé"); return String(); }   // POD_ED_STACK
  return bytesToHex(sig, 64);
}
#endif
#endif

// ─── HTTP (WiFiSSLClient + pod_http.h) ─────────────────────────────────────
// PULLFRAME-BOUNDED-SSL-FIX1 : à partir d'ici le nom WiFiSSLClient désigne PodBoundedSSL (pod_ssl_bounded.h, dérivé du vrai WiFiSSLClient, réception modem bornée à 240 o). Toute lecture TLS de ce firmware (image, clips, candidat) passe par lui.
// LOT8B2E V3 : ajout CONTRÔLÉ à une String. Une String qui ne peut plus grandir (tas épuisé) tronque EN SILENCE : on compare la longueur obtenue à la longueur attendue (tout ou rien).
static bool __attribute__((noinline)) strAppendChecked(String& s, const char* p) {
  const unsigned n = s.length();
  s += p;
  return s.length() == n + (unsigned)strlen(p);
}
static bool __attribute__((noinline)) strAppendNumChecked(String& s, unsigned long v) {
  char b[12]; int i = 11; b[i] = '\0';
  do { b[--i] = (char)('0' + (v % 10)); v /= 10; } while (v != 0);
  return strAppendChecked(s, b + i);
}
#define WiFiSSLClient PodBoundedSSL
struct Conn {
  WiFiSSLClient client;
  podhttp::Reader<WiFiSSLClient> rd;
  explicit Conn(uint32_t timeoutMs) : rd(client, timeoutMs) {}
  /** Construit la requête EN TOUT OU RIEN, se connecte, l'envoie, lit les en-têtes. Retourne le code HTTP, -2 = connexion TLS impossible, -1 = réponse illisible, -7 = écriture PARTIELLE de la requête (connexion ouverte : des octets ont PU partir), -6 = requête NON construite (mémoire) : RIEN n'est émis
   *  (V3 : une requête tronquée en silence — corps de vote absent ou coupé — n'est jamais envoyée). */
  int request(const char* method, const String& path, const String* body) {
    String req;
    bool ok = req.reserve(path.length() + (body ? body->length() : 0) + 224) != 0
              && strAppendChecked(req, method) && strAppendChecked(req, " ") && strAppendChecked(req, path.c_str())
              && strAppendChecked(req, " HTTP/1.1\r\nHost: " SERVER_HOST "\r\nUser-Agent: pod-r4/" FIRMWARE_VERSION "\r\nAccept: */*\r\nConnection: close\r\n");
    if (ok && body) ok = strAppendChecked(req, "Content-Type: application/json\r\nContent-Length: ") && strAppendNumChecked(req, body->length()) && strAppendChecked(req, "\r\n");
    ok = ok && strAppendChecked(req, "\r\n");
    if (ok && body) ok = strAppendChecked(req, body->c_str());
    if (!ok) return -6;
    if (!client.connect(SERVER_HOST, 443)) return -2;
    const size_t sent = client.print(req);
    if (sent != (size_t)req.length()) return -7;   // V3-FIX1 : écriture PARTIELLE — la connexion est OUVERTE, des octets ont PU partir : jamais « non émise » (-7 => SENT_UNKNOWN pour un vote)
    return rd.readHeaders();
  }
};

/** POD_NET_STACK : la transaction TLS COMPLÈTE (connect, requête, en-têtes, corps, stop) dans une fonction à part (noinline) : sa fermeture, son PodNetInfo et son cadre ont DISPARU avant le journal et le traitement
 *  de la réponse. Résultats dans les variables de l'APPELANT ; client.stop() est TOUJOURS appelé, même si request() échoue après l'ouverture du client. */
static bool __attribute__((noinline)) netHttpRaw(const char* method, const String& path, const String* body, int& code, bool& complete, PodNetInfo& ni) {
  auto tx = [&]() {
    Conn c(HTTP_TIMEOUT_MS);
    code = c.request(method, path, body);
    if (code >= 0) { size_t len = 0; complete = c.rd.readBodyString(g_body, sizeof(g_body), &len); }
    c.client.stop();
  };
  return podNetRun(tx, &ni);
}

/** R-M1 (LOT8B2E V2) : gestionnaire COMMUN des échecs de la pile réseau dédiée (httpCall, doFetchFrame, netReadCandidate, clip du banc d'essai, netGetBlockClipToSd). GUARD = garde basse écrasée : le tas voisin
 *  peut être corrompu (logf alloue) => arrêt sûr SILENCIEUX d'abord, avant tout journal, String ou allocation. Les autres erreurs (NOMEM, NESTED, MARGIN) restent FERMÉES et sont décrites. */
static void __attribute__((noinline)) netStackFailed(const char* tag, const char* arg, const PodNetInfo& ni, const char* tail) {
  if (ni.err == POD_NET_GUARD) logfSafeStop();
  logf("[%s%s] pile réseau dédiée : %s (erreur %u, marge %u o)%s", tag, arg, podNetWhy(ni), (unsigned)ni.err, (unsigned)ni.margin, tail);
}

/** Appel JSON : retourne le code HTTP (>0) et le corps dans resp ; <0 = échec réseau/lecture/corps incomplet ; -4 = pile dédiée indisponible, transaction NON exécutée ; -5 = transaction EXÉCUTÉE mais résultat local REJETÉ (garde/marge). */
static int httpCall(const char* method, const String& path, const String* body, String& resp) {
  resp = "";
  int code = -4; bool complete = false; PodNetInfo ni;
  const bool ran = netHttpRaw(method, path, body, code, complete, ni);
  POD_CANARY_NET("http", ni, ran);
  if (!ran) { netStackFailed("HTTP ", method, ni, podNetExecuted(ni) ? " — la requête a PU atteindre le serveur (POST, vote ou ACK possibles)" : ""); return podNetExecuted(ni) ? -5 : -4; }
  if (!(g_quietHttp && code == 200)) logf("[HTTP %s] %s -> %d", method, path.length() > 60 ? (path.substring(0, 60) + "...").c_str() : path.c_str(), code);
  if (code < 0) { if (code == -2) logf("[HTTP] connexion TLS impossible (voir l'en-tête du sketch)"); return code; }
  if (!complete) { logf("[HTTP] corps incomplet ou > %u octets", (unsigned)sizeof(g_body) - 1); return -3; }
  resp = String(g_body);
  return code;
}

// ─── Affichage ─────────────────────────────────────────────────────────────
static void tftStatus(const String& line1, const String& line2 = "", uint16_t bg = C_NAVY) {
  tft.setRotation(0);
  tft.fillScreen(bg);
  tft.fillRect(0, 0, SCR_W, 28, C_DARK);
  tft.drawFastHLine(0, 28, SCR_W, C_GOLD);
  tft.setTextSize(2); tft.setTextColor(C_GOLD, C_DARK); tft.setCursor(8, 7); tft.print("RESCOE");
  tft.setTextColor(C_WHITE, bg); tft.setCursor(8, 140); tft.print(asciiFold(line1));
  if (line2.length()) { tft.setTextSize(1); tft.setTextColor(C_GREY, bg); tft.setCursor(8, 168); tft.print(asciiFold(line2)); }
}

/** Pousse g_row (déjà en octets BIG-endian) sur la ligne y : fenêtre d'une ligne, puis 240 pixels. */
static void pushRow(int y) {
  tft.startWrite();
  tft.setAddrWindow(0, y, SCR_W, 1);
  fastPixels(g_row, SCR_W);                  // envoi par bloc (voir « BANC D'ESSAI » plus bas) au lieu de deux appels SPI par pixel
  tft.endWrite();
}
static void swapRowBytes() {
  uint8_t* b = (uint8_t*)g_row;
  for (int i = 0; i < ROW_BYTES; i += 2) { const uint8_t t = b[i]; b[i] = b[i + 1]; b[i + 1] = t; }
}

/** Cartel PAR-DESSUS l'œuvre : « RESCOE #bloc » en haut, titre + artiste en bas. Redessiné à chaque toucher « afficher ». */
static void drawCartel() {
  tft.fillRect(0, 0, SCR_W, BAND_TOP_H - 1, C_DARK);
  tft.drawFastHLine(0, BAND_TOP_H - 1, SCR_W, C_GOLD);
  tft.setTextSize(2); tft.setTextColor(C_GOLD, C_DARK); tft.setCursor(8, 12); tft.print("RESCOE");
  if (currentBlockIndex >= 0) {
    const String blk = "#" + String(currentBlockIndex);
    tft.setTextColor(C_GREY, C_DARK); tft.setCursor(SCR_W - 8 - (int)blk.length() * 12, 12); tft.print(blk);
  }
  tft.fillRect(0, BAND_BOT_Y + 1, SCR_W, BAND_BOT_H - 1, C_DARK);
  tft.drawFastHLine(0, BAND_BOT_Y, SCR_W, C_GOLD);
  String title = asciiFold(pendingWorkTitle), artist = asciiFold(pendingArtistName);
  if (title.length() == 0) title = "Proof-of-Draw";
  if (title.length() > 19) title = title.substring(0, 19);
  if (artist.length() > 26) artist = artist.substring(0, 26);
  tft.setTextSize(2); tft.setTextColor(C_WHITE, C_DARK); tft.setCursor(8, BAND_BOT_Y + 8); tft.print(title);
  if (artist.length()) { tft.setTextSize(1); tft.setTextColor(C_GREY, C_DARK); tft.setCursor(8, BAND_BOT_Y + 32); tft.print(artist); }
  // Pastille d'état de la carte SD (bas droite) : « SD ok » = le cartel pourra être masqué ; sinon la raison, en rouge
  const String badge = sdFrameValid ? String("SD ok") : String(sdWhy);
  tft.setTextSize(1); tft.setTextColor(sdFrameValid ? C_GREY : C_RED, C_DARK);
  tft.setCursor(SCR_W - 8 - (int)badge.length() * 6, BAND_BOT_Y + 32); tft.print(badge);
}

// ─── microSD ───────────────────────────────────────────────────────────────
static void initSDImpl() {
  digitalWrite(TFT_CS, HIGH); digitalWrite(STMPE_CS, HIGH);
  for (int attempt = 0; attempt < 3 && !sdOk; attempt++) { sdOk = SD.begin(SD_CS); if (!sdOk) delay(250); }   // certaines cartes ne répondent qu'au 2e essai
  if (sdOk && !SD.exists(SD_DIR)) SD.mkdir(SD_DIR);
  sdWhy = sdOk ? "SD sans image" : "SD absente";
  logf("[SD] %s", sdOk ? "carte lisible (cache de l'image + cartel masquable)" : "carte absente, non formatée FAT/FAT32 ou illisible -> œuvre en plein écran SANS cartel masquable");
}
static void initSD() {
  auto w = [&]() { initSDImpl(); };
  if (!onSd("initSD", w)) { sdOk = false; sdWhy = "SD pile"; }
}

/** Redessine les lignes y0..y0+n-1 depuis /pod/frame.bin (lues séquentiellement, converties LE -> BE). */
static bool restoreRowsImpl(int y0, int n) {
  File f = SD.open(SD_FRAME, FILE_READ);
  if (!f) return false;
  if (f.size() != (unsigned long)FRAME_BYTES) { f.close(); return false; }
  bool ok = f.seek((uint32_t)y0 * ROW_BYTES);
  for (int i = 0; ok && i < n; i++) {
    ok = f.read((uint8_t*)g_row, ROW_BYTES) == ROW_BYTES;
    if (!ok) break;
    swapRowBytes();
    pushRow(y0 + i);
  }
  f.close();
  return ok;
}
static bool restoreRows(int y0, int n) {
  bool ok = false;
  auto w = [&]() { ok = restoreRowsImpl(y0, n); };
  return onSd("restoreRows", w) && ok;
}

static void saveMetaImpl(const String& frameId) {
  if (!sdOk) return;
  if (SD.exists(SD_META)) SD.remove(SD_META);
  File f = SD.open(SD_META, FILE_WRITE);
  if (!f) return;
  f.println(frameId);
  f.println(currentBlockIndex);
  f.println(pendingWorkTitle);
  f.println(pendingArtistName);
  f.close();
}
static void saveMeta(const String& frameId) {
  auto w = [&]() { saveMetaImpl(frameId); };
  onSd("saveMeta", w);
}

static void animLoadMarker();
/** Au démarrage : réaffiche la dernière œuvre depuis la carte (sans attendre le réseau) et retrouve son cartel. */
static void restoreLastFrameImpl() {
  if (!sdOk || !SD.exists(SD_META) || !SD.exists(SD_FRAME)) return;
  File m = SD.open(SD_META, FILE_READ);
  if (!m) return;
  String id = m.readStringUntil('\n'); id.trim();
  String blk = m.readStringUntil('\n'); blk.trim();
  String title = m.readStringUntil('\n'); title.trim();
  String artist = m.readStringUntil('\n'); artist.trim();
  m.close();
  if (id.length() == 0) return;
  const unsigned long t0 = millis();
  if (!restoreRows(0, SCR_H)) { logf("[SD] image enregistrée illisible"); return; }
  lastFrameId = id; currentBlockIndex = blk.toInt(); pendingWorkTitle = title; pendingArtistName = artist;
  sdFrameValid = true; cartelVisible = false;
  logf("[SD] dernière œuvre réaffichée en %lu ms (frameId=%s)", millis() - t0, id.c_str());
  animLoadMarker();                                          // c'était une animation ? elle reprend depuis la carte
}
static void restoreLastFrame() {
  auto w = [&]() { restoreLastFrameImpl(); };
  onSd("restoreLastFrame", w);
}

// ─── Image : flux 153 600 o RGB565 little-endian, ligne par ligne, plein écran ──
/** Lit 320 lignes, les range sur la carte (si présente) ET les affiche au fur et à mesure. true = image complète. */
static bool streamFrame(podhttp::Reader<WiFiSSLClient>& rd) {
  bool ok = true;
  File f;
  bool saving = false;
  if (sdOk) {
    if (SD.exists(SD_FRAME)) SD.remove(SD_FRAME);
    f = SD.open(SD_FRAME, FILE_WRITE);
    saving = (bool)f;
    if (!saving) { sdWhy = "SD ouverture"; logf("[SD] impossible d'ouvrir %s en écriture", SD_FRAME); }
  } else logf("[SD] pas de carte : l'image ne sera pas conservée");
  uint8_t* raw = (uint8_t*)g_row;
  for (int y = 0; y < SCR_H; y++) {
    if (rd.readBody(raw, ROW_BYTES) != (size_t)ROW_BYTES) { logf("[FRAME] ligne %d incomplète", y); ok = false; break; }
    if (saving && f.write(raw, ROW_BYTES) != (size_t)ROW_BYTES) { saving = false; sdWhy = "SD ecriture"; logf("[SD] écriture interrompue ligne %d (carte pleine / protégée ?)", y); }
    swapRowBytes();                                          // LE serveur -> BE bus SPI
    pushRow(y);
    if ((y % 80) == 79) logf("[FRAME] %d/%d lignes", y + 1, SCR_H);
  }
  if (f) f.close();
  sdFrameValid = ok && saving;                               // copie complète : le cartel pourra être masqué
  if (sdFrameValid) sdWhy = "";
  if (sdOk && !sdFrameValid && SD.exists(SD_FRAME)) SD.remove(SD_FRAME);
  return ok;
}

static bool ackFrame(const String& frameId) {
  if (frameId.length() == 0) return false;
  const String body = "{\"deviceId\":\"" + deviceId + "\",\"frameId\":\"" + frameId + "\"}";
  String resp;
  const bool ok = httpCall("POST", "/api/ack-frame", &body, resp) == 200;
  logf("[ACK] %s -> %s", frameId.c_str(), ok ? "OK" : "FAIL");
  return ok;
}

#if POD_CANARY
// Fin de doFetchFrame en CANARI : l'ACK DÉCIDE du succès (comme le canari ESP8266 FIX1). L'image est complète à l'écran ; le serveur doit la confirmer. ACK refusé ou impossible (réponse ≠ 200, pile réseau indisponible, frameId vide) :
// journal explicite, la frame N'EST PAS marquée acquittée (lastFrameId inchangé, métadonnées SD non écrites : le prochain pull la re-proposera), retour false. Sur succès seulement : état, métadonnées SD, ACK confirmé.
static bool __attribute__((noinline)) doFetchTailCanary(const String& frameId, const String& frameSource, unsigned long t0) {
  const bool acked = ackFrame(frameId);
  POD_CANARY_CHECK("ACK : retour de la requete");
  POD_CANARY_HEAP("apres l'ACK");
  if (!acked) { logf("[CANARY] ECHEC ACK : l'image est COMPLETE a l'ecran (cache SD: %s) mais le serveur n'a pas confirme ; frame NON marquee acquittee, nouvel essai au prochain pull", sdFrameValid ? "oui" : "non"); return false; }
  lastFrameId = frameId;
  lastFrameWasConsensus = (frameSource == "consensus");
  pendingCandidateId = "";
  if (sdFrameValid) saveMeta(frameId);
  logf("[FRAME] OK en %lu ms (frameId=%s source=%s, cache SD: %s) — ACK recu (HTTP 200)", millis() - t0, frameId.c_str(), frameSource.c_str(), sdFrameValid ? "oui" : "non");
  return true;
}
#endif

static bool doFetchFrame(const String& frameId, const String& frameSource) {
  const unsigned long t0 = millis();
  bool shown = false, noFrame = false;
  PodNetInfo ni;                                     // POD_NET_STACK : la transaction tourne sur la pile réseau dédiée
  auto tx = [&]() {
    Conn c(HTTP_TIMEOUT_MS);
    const int code = c.request("GET", "/api/pull-frame?deviceId=" + deviceId + "&screen=" SCREEN_TYPE "&fmt=bin", nullptr);
    logf("[HTTP GET] /api/pull-frame -> %d (contenu %ld)", code, c.rd.contentLength());
    if (code == 404) noFrame = true;
    else if (code == 200 && (c.rd.contentLength() < 0 || c.rd.contentLength() == FRAME_BYTES)) {
      cartelVisible = false;                                 // une nouvelle image remplace tout, cartel compris
      shown = streamFrame(c.rd) && c.rd.complete() && c.client.fault() == 0;   // défaut collant du client TLS borné : image refusée (ni affichage annoncé, ni ACK)
    } else if (code == 200) {
      logf("[FRAME] taille annoncée %ld != %d (le serveur sert-il bien tft28 ?)", c.rd.contentLength(), FRAME_BYTES);
    }
    c.client.stop();
  };
  const bool ran = podNetRun(tx, &ni);
  POD_CANARY_NET("pull-frame (reseau + SD + TFT)", ni, ran);
  POD_CANARY_CHECK("pull-frame/affichage : retour de la transaction");
  POD_CANARY_HEAP("apres la transaction pull-frame");
  if (!ran) { shown = false; noFrame = false; netStackFailed("FRAME", "", ni, " — pas d'ACK ; l'écran a pu être partiellement ou totalement redessiné"); }
  if (noFrame) { logf("[FRAME] pas de frame disponible"); return true; }
  if (!shown) { logf("[FRAME] image incomplète — pas d'ACK, nouvel essai au prochain pull"); sdFrameValid = false; return false; }
#if POD_CANARY
  return doFetchTailCanary(frameId, frameSource, t0);
#else
  lastFrameId = frameId;
  lastFrameWasConsensus = (frameSource == "consensus");
  pendingCandidateId = "";
  if (sdFrameValid) saveMeta(frameId);
  logf("[FRAME] OK en %lu ms (frameId=%s source=%s, cache SD: %s)", millis() - t0, frameId.c_str(), frameSource.c_str(), sdFrameValid ? "oui" : "non");
  ackFrame(frameId);
  return true;
#endif
}

// ─── Tactile : un toucher affiche / cache le cartel ────────────────────────
static void drainTouch() {
  while (!ts.bufferEmpty()) ts.getPoint();
  ts.writeRegister8(STMPE_INT_STA, 0xFF);
}
static void toggleCartelImpl() {
  if (lastFrameId.length() == 0) return;                     // rien d'affiché : rien à habiller
  // Sans carte SD le cartel s'AFFICHE quand même, mais ne peut pas être masqué (la R4 n'a pas la RAM pour garder les pixels qu'il
  // recouvre) : il reste jusqu'à la prochaine image. La pastille rouge « SD absente » le dit à l'écran ; avec une carte, tout est automatique.
  if (!cartelVisible) {
    drawCartel();
    cartelVisible = true;
    logf("[TOUCH] cartel affiché");
    return;
  }
  // Masquer : on redessine les deux bandes depuis la copie sur la carte (pas de re-téléchargement)
  if (!sdFrameValid && sdOk && SD.exists(SD_FRAME)) {        // l'indicateur a pu être perdu : on revalide d'après la taille du fichier
    File chk = SD.open(SD_FRAME, FILE_READ);
    if (chk) { sdFrameValid = (chk.size() == (unsigned long)FRAME_BYTES); chk.close(); if (sdFrameValid) sdWhy = ""; }
  }
  if (!sdFrameValid) {
    logf("[TOUCH] cartel NON masquable : %s (voir les lignes [SD] ci-dessus)", sdWhy);
    drawCartel();                                            // rafraîchit la pastille rouge pour montrer pourquoi
    return;
  }
  const unsigned long t0 = millis();
  if (restoreRows(0, BAND_TOP_H) && restoreRows(BAND_BOT_Y, BAND_BOT_H)) {
    cartelVisible = false; logf("[TOUCH] cartel masqué en %lu ms", millis() - t0);
    if (animOn && animPaused) { animPaused = false; logf("[ANIM] reprise"); }
  }
  else { sdFrameValid = false; sdWhy = "SD lecture"; logf("[TOUCH] lecture de /pod/frame.bin impossible : cartel conservé"); drawCartel(); }
}
static void toggleCartel() {
  auto w = [&]() { toggleCartelImpl(); };
  onSd("toggleCartel", w);
}
static void serviceTouch() {
  if (!touchOk || !ts.touched()) return;
  const unsigned long t0 = millis();
  while (ts.touched() && millis() - t0 < 1500UL) { delay(5); }   // attend le relâchement (anti-rebond)
  drainTouch();
  delay(120);
  toggleCartel();
  drainTouch();
}
static bool waitTapOrTimeout(unsigned long ms) {   // pour l'écran des clés : touché = continuer
  const unsigned long t0 = millis();
  while (millis() - t0 < ms) { if (touchOk && ts.touched()) { drainTouch(); return true; } delay(50); }
  return false;
}

// ─── Onboarding ────────────────────────────────────────────────────────────
static void displayKeyMaterialOnce() {
  const String pubHex = bytesToHex(publicKey, 32), privHex = bytesToHex(privateKey, 32);
  logf("[KEYS] PubKey: %s", pubHex.c_str());   // la clé privée n'est JAMAIS écrite au Serial
  tft.setRotation(0);
  tft.fillScreen(C_WHITE);
  tft.setTextColor(C_BLACK, C_WHITE); tft.setTextSize(2); tft.setCursor(8, 6); tft.print("PROOF-OF-DRAW");
  tft.drawFastHLine(0, 28, SCR_W, C_BLACK);
  tft.setTextSize(1);
  tft.setCursor(8, 40); tft.print("CLE PUBLIQUE :");
  for (int l = 0; l < 2; l++) { tft.setCursor(8, 54 + l * 12); tft.print(pubHex.substring(l * 32, l * 32 + 32)); }
  tft.setTextColor(C_RED, C_WHITE);
  tft.setCursor(8, 100); tft.print("CLE PRIVEE (UNE SEULE FOIS) :");
  for (int l = 0; l < 2; l++) { tft.setCursor(8, 114 + l * 12); tft.print(privHex.substring(l * 32, l * 32 + 32)); }
  tft.setTextColor(C_BLACK, C_WHITE);
  tft.setCursor(8, 160); tft.print("Notez la cle privee MAINTENANT.");
  tft.setCursor(8, 176); tft.print("Touchez l'ecran pour continuer");
  tft.setCursor(8, 188); tft.print("(sinon suite automatique dans 60 s).");
  logf("[KEYS] Clés affichées — 60 s (ou toucher)");
  waitTapOrTimeout(60000UL);
}

static void displayOnboardingTFT(const String& onboardUrl, const String& code, const String& macStr) {
  tft.setRotation(0);
  tft.fillScreen(C_NAVY);
  tft.fillRect(0, 0, SCR_W, 28, C_DARK);
  tft.drawFastHLine(0, 28, SCR_W, C_GOLD);
  tft.setTextSize(2); tft.setTextColor(C_GOLD, C_DARK); tft.setCursor(8, 7); tft.print("RESCOE");
  tft.setTextSize(1); tft.setTextColor(C_GREY, C_DARK); tft.setCursor(110, 12); tft.print("proof-of-draw");

  QRCode qr; uint8_t qrData[qrcode_getBufferSize(7)];
  memset(qrData, 0, sizeof(qrData));
  int res = -1;
  for (int ver = 3; ver <= 7 && res < 0; ver++) res = qrcode_initText(&qr, qrData, ver, ECC_LOW, onboardUrl.c_str());
  if (res >= 0) {
    int scale = 190 / qr.size; if (scale < 1) scale = 1;
    const int px = qr.size * scale, x0 = (SCR_W - px) / 2, y0 = 40;
    tft.fillRect(x0 - 6, y0 - 6, px + 12, px + 12, C_WHITE);
    for (int qy = 0; qy < qr.size; qy++) for (int qx = 0; qx < qr.size; qx++)
      tft.fillRect(x0 + qx * scale, y0 + qy * scale, scale, scale, qrcode_getModule(&qr, qx, qy) ? C_BLACK : C_WHITE);
  } else {
    tft.setTextSize(1); tft.setTextColor(C_WHITE, C_NAVY); tft.setCursor(8, 50); tft.print("Ouvrez : " + onboardUrl.substring(0, 28));
  }
  const int cs = ((int)code.length() * 24 <= 224) ? 4 : 3;
  tft.setTextSize(cs); tft.setTextColor(C_GOLD, C_NAVY);
  int cx = (SCR_W - (int)code.length() * 6 * cs) / 2; if (cx < 0) cx = 0;
  tft.setCursor(cx, 252); tft.print(code);
  String m = macStr; m.replace(":", ""); m.toUpperCase();
  tft.setTextSize(1); tft.setTextColor(C_GREY, C_NAVY); tft.setCursor(8, 300); tft.print("MAC:" + m);
  tft.setCursor(8, 288); tft.print("Scannez le QR ou entrez le code sur le site");
}

#if !POD_CANARY
// ─── OBS-CONFIRM ───────────────────────────────────────────────────────────
static bool doObsConfirm() {
  if (pendingObsHashes.length() == 0) return true;
  String body = "{\"deviceId\":\"" + deviceId + "\",\"blockHashes\":" + pendingObsHashes;
  if (pendingObsTarget.length() == 64) body += ",\"targetBlockHash\":\"" + pendingObsTarget + "\"";
  body += "}";
  String resp;
  const bool ok = httpCall("POST", "/api/obs-confirm", &body, resp) == 200;
  logf("[OBS-CONFIRM] ok=%d", ok);
  pendingObsHashes = ""; pendingObsTarget = "";
  return ok;
}
#else
// CANARI : la confirmation d'observation (POST) n'existe pas dans le binaire ; une tâche annoncée par le pull est oubliée localement.
static bool doObsConfirm() {
  if (pendingObsHashes.length() == 0) return true;
  pendingObsHashes = ""; pendingObsTarget = "";
  logf("[CANARY] observation annoncee : AUCUNE confirmation en build canari (oubliee localement)");
  return true;
}
#endif

// ─── REGISTER ──────────────────────────────────────────────────────────────
// NETSTACK-WIFI-CALLS-FIX1 : chiffre hexadécimal minuscule (MAC « aa:bb:cc:dd:ee:ff » dans un char[18], sans snprintf)
static char macHexDigit(uint8_t v) { return (char)(v < 10 ? '0' + v : 'a' + (v - 10)); }
// L'adresse MAC vient du module Wi-Fi (pile dédiée, wifiMac) ; échec → chaîne VIDE : doRegister n'inscrit pas.
static String macString() {
  uint8_t m[6] = {0};
  if (!wifiMac(m)) return String();
  char b[18];
  for (uint8_t i = 0; i < 6; i++) { b[3 * i] = macHexDigit(m[i] >> 4); b[3 * i + 1] = macHexDigit(m[i] & 15); b[3 * i + 2] = (i < 5) ? ':' : '\0'; }
  return String(b);
}

// REGISTER-JSON-STACK-FIX1 (porté au TFT 2,8″) : la réponse de /api/register est décodée sur la pile de TRAVAIL dédiée (podWorkRun : 2 048 o au tas, garde 64 o, marge >= 128 o, échec fermé), APRÈS le retour complet de httpCall
// (TLS fermé, jamais imbriquée avec PodNet). Sortie : RegisterParsed, structure BORNÉE (28 o) allouée au TAS ; AUCUN changement de deviceId, pairCode, paired, registered avant un résultat COMPLET et VALIDE.
// CONTRAT du serveur (lib/deviceStore.ts) : deviceId = « dev_ » + 8 caractères [A-Z0-9] ; pairCode = 8 caractères de l'alphabet ABCDEFGHJKLMNPQRSTUVWXYZ23456789 (obligatoire si l'appareil n'est pas appairé, facultatif sinon) ;
// toute autre valeur est REFUSÉE — jamais tronquée. paired absent ou non booléen => false (comme avant). Échec (NOMEM, NESTED, GUARD, MARGIN, JSON invalide, valeur refusée) : doRegister retourne false, rien n'est inscrit.
enum RegisterStatus : uint8_t { REG_P_NONE = 0, REG_P_OK = 1, REG_P_JSON = 2, REG_P_INVALID = 3 };
struct RegisterParsed {
  uint8_t status;                  // RegisterStatus : exploitable seulement pour REG_P_OK
  bool paired;
  const char* jsonErr;             // texte statique de DeserializationError (REG_P_JSON)
  char deviceId[13];               // 12 caractères + NUL
  char pairCode[9];                // 8 caractères + NUL, ou vide (appairé, code absent)
  RegisterParsed() : status(REG_P_NONE), paired(false), jsonErr(nullptr) { deviceId[0] = 0; pairCode[0] = 0; }
};
static bool __attribute__((noinline)) regDeviceIdOk(const char* s) {
  if (strlen(s) != 12 || s[0] != 'd' || s[1] != 'e' || s[2] != 'v' || s[3] != '_') return false;
  for (uint8_t i = 4; i < 12; i++) if (!((s[i] >= 'A' && s[i] <= 'Z') || (s[i] >= '0' && s[i] <= '9'))) return false;
  return true;
}
static bool __attribute__((noinline)) regPairCodeOk(const char* s) {
  static const char* const ALPHA = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  if (strlen(s) != 8) return false;
  for (uint8_t i = 0; i < 8; i++) if (strchr(ALPHA, s[i]) == nullptr) return false;
  return true;
}
// Exécutée SUR LA PILE DE TRAVAIL (voir registerParseOnWorkStack). Ne touche à AUCUN état global : tout va dans r.
static void __attribute__((noinline)) registerParseWork(const String& resp, RegisterParsed& r) {
  JSON_DOC(doc, 768);
  const DeserializationError err = deserializeJson(doc, resp, DeserializationOption::NestingLimit(POD_WORK_JSON_NESTING));
  if (err) { r.jsonErr = err.c_str(); r.status = REG_P_JSON; return; }
  const char* id = doc["deviceId"] | "";
  const char* pc = doc["pairCode"] | "";
  const bool isPaired = doc["paired"] | false;
  if (!regDeviceIdOk(id)) { r.status = REG_P_INVALID; return; }
  if (pc[0] != '\0' ? !regPairCodeOk(pc) : !isPaired) { r.status = REG_P_INVALID; return; }
  memcpy(r.deviceId, id, 12); r.deviceId[12] = '\0';
  if (pc[0] != '\0') { memcpy(r.pairCode, pc, 8); r.pairCode[8] = '\0'; }
  r.paired = isPaired;
  r.status = REG_P_OK;
}
static bool __attribute__((noinline)) registerParseOnWorkStack(const String& resp, RegisterParsed& r, PodNetInfo& ni) {
  auto rk = [&]() { registerParseWork(resp, r); };
  return podWorkRun(rk, &ni);
}
// Échec de la pile de travail : rien n'est inscrit. GUARD => le tas voisin peut être corrompu (logf alloue) : arrêt sûr silencieux AVANT tout journal.
static void __attribute__((noinline)) registerWorkFailed(const PodNetInfo& ni) {
  if (ni.err == POD_NET_GUARD) logfSafeStop();
  logf("[REGISTER] analyse JSON sur la pile de travail ECHOUEE (err %u) : %s ; inscription rejetée, rien n'est inscrit", (unsigned)ni.err, podNetWhy(ni));
}
// Décodage + inscription de l'état, dans cet ordre, APRÈS le retour de httpCall. Retour : true = réponse complète et valide, état inscrit ; false = rien n'a changé.
static bool __attribute__((noinline)) doRegisterDecode(const String& resp) {
  RegisterParsed* const r = new (std::nothrow) RegisterParsed();
  if (!r) { logf("[REGISTER] réponse rejetée : mémoire insuffisante"); return false; }
  PodNetInfo ni;
  const bool ran = registerParseOnWorkStack(resp, *r, ni);
  POD_CANARY_JSON("register", ni, ran, r->status, REG_P_OK, REG_P_OK);
  bool ok = false;
  if (!ran) registerWorkFailed(ni);
  else if (r->status == REG_P_JSON) logf("[REGISTER] JSON illisible: %s", r->jsonErr);
  else if (r->status != REG_P_OK) logf("[REGISTER] réponse rejetée : deviceId ou code d'appairage absent, trop court, trop long ou invalide");
  else { deviceId = r->deviceId; pairCode = r->pairCode; paired = r->paired; registered = true; ok = true; }
  delete r;
  return ok;
}

// REGISTER-STACK-FIX2 (LOT8B2D) : le canari matériel a mesuré 916 / 1 024 o (marge 108 o < 128) au retour de doRegister d'un appareil déjà appairé. L'inscription est découpée en PHASES noinline dont les cadres
// et les objets (mac, corps, réponse, temporaires de la concaténation) MEURENT avant la phase suivante ; le dessin de l'écran « Connecte » ne se fait plus depuis la pile principale mais sur la pile dédiée
// (onSd : jamais imbriquée, échec fermé = écran non redessiné, l'inscription reste valide). Le parcours NON appairé (clés / QR) garde son propre chemin, inchangé.
//   1. registerExchange : MAC -> corps -> transaction -> décodage (état inscrit par doRegisterDecode SEULEMENT sur réponse complète), puis retour : mac / corps / réponse détruits ;
//   2. (retour) ; 3. registerLog : journal [REGISTER] ; 4. registerShow : TFT (appairé : pile dédiée ; non appairé : onboarding, chemin d'avant).
enum RegisterExchange : uint8_t { REGX_OK = 0, REGX_NO_MAC = 1, REGX_HTTP = 2, REGX_DECODE = 3 };
static char g_regMac[18];                                   // MAC de l'inscription en cours (l'onboarding l'affiche) : tampon statique de 18 o, vidé si l'inscription échoue
// Phase 1a : lecture de la MAC (module Wi-Fi, pile dédiée). Le String de macString() meurt au retour ; seul g_regMac survit.
static bool __attribute__((noinline)) registerReadMac() {
  g_regMac[0] = '\0';
  const String mac = macString();
  if (mac.length() == 0) return false;
  strncpy(g_regMac, mac.c_str(), sizeof(g_regMac) - 1); g_regMac[sizeof(g_regMac) - 1] = '\0';
  return true;
}
// Phase 1b : corps JSON par ajouts SUCCESSIFS (réservation unique, aucun temporaire de concaténation). Même texte, octet pour octet, que l'ancienne expression « a + b + c… ».
static void __attribute__((noinline)) registerBuildBody(String& body) {
  body.reserve(320);
  body += "{\"mac\":\""; body += g_regMac;
  body += "\",\"screens\":[\"" SCREEN_TYPE "\"],\"firmware\":\"" FIRMWARE_VERSION "\",\"publicKey\":\"";
  if (keysLoaded) { const String pk = bytesToHex(publicKey, 32); body += pk; }
  body += "\",\"ownedHashes\":";
  { const String owned = loadOwnedHashesJson(); body += owned; }
  body += "}";
}
// Phase 1c : corps + transaction. Le corps MEURT au retour (il n'est plus utile une fois la requête partie) ; la réponse vit chez l'appelant.
static int __attribute__((noinline)) registerPost(String& resp) {
  String body;
  registerBuildBody(body);
  return httpCall("POST", "/api/register", &body, resp);
}
static uint8_t __attribute__((noinline)) registerExchange() {
  if (!registerReadMac()) { logf("[REGISTER] adresse MAC indisponible (module Wi-Fi, pile dédiée) : inscription ANNULÉE"); return REGX_NO_MAC; }
  // Pas de « sceneCapability » : cet écran n'est pas un lecteur de scènes, le serveur lui sert toujours une image fixe.
  String resp;
  if (registerPost(resp) != 200) return REGX_HTTP;
  if (!doRegisterDecode(resp)) return REGX_DECODE;
  return REGX_OK;
}
static void __attribute__((noinline)) registerLog() { logf("[REGISTER] deviceId=%s paired=%s", deviceId.c_str(), paired ? "oui" : "non"); }
#if POD_PREVIEW_ENROLL
static bool g_enrollHalted = false;
static void __attribute__((noinline)) enrollHalt(const char* why) { g_enrollHalted = true; logf("[ENROLL] ARRET DEFINITIF : %s — plus aucun reseau, aucun pull, aucun vote, aucun ACK", why); }
static void __attribute__((noinline)) enrollReport() {
  if (paired) logf("[ENROLL] appareil DEJA appaire sur %s : deviceId=%s (rien a faire)", SERVER_HOST, deviceId.c_str());
  else logf("[ENROLL] NON appaire sur %s : deviceId=%s pairCode=%s -> ouvrir https://%s/onboard?code=%s avec la session Preview", SERVER_HOST, deviceId.c_str(), pairCode.c_str(), SERVER_HOST, pairCode.c_str());
}
#endif
// Écran d'état sur la pile dédiée : si elle est indisponible, l'écran n'est PAS redessiné (journal), l'inscription reste valable.
static void __attribute__((noinline)) registerStatusOnDedicatedStack(const char* l1, const char* l2, uint16_t bg) {
  auto w = [&]() { tftStatus(String(l1), String(l2), bg); };
  onSd("registerStatus", w);
}
static void __attribute__((noinline)) registerShowOnboarding() {
  const String mac(g_regMac);
  if (!onboardingAlreadyShown()) {
    displayKeyMaterialOnce();
    displayOnboardingTFT(String("https://" SERVER_HOST "/onboard?code=") + pairCode, pairCode, mac);
    setOnboardingShown();
  } else {
    displayOnboardingTFT(String("https://" SERVER_HOST "/onboard?code=") + pairCode, pairCode, mac);
  }
}
static void __attribute__((noinline)) registerShowFailure() { registerStatusOnDedicatedStack("Register echoue", "Nouvel essai dans 5 s...", C_RED); }
static void __attribute__((noinline)) registerShowConnected() {
  auto w = [&]() { tftStatus(String("Connecte"), deviceId); };
  onSd("registerConnected", w);
}
static bool doRegister() {
  const uint8_t x = registerExchange();
#if POD_NOHW
  if (x == REGX_HTTP) { logf("[REGISTER] echec HTTP (journal seulement, aucun dessin) : nouvel essai dans 5 s"); return false; }
  if (x != REGX_OK) return false;
  registerLog();
#if POD_PREVIEW_ENROLL
  enrollReport();
#else
  if (!paired) vcHalt("appareil NON appaire : le canari de vote exige une carte DEJA appairee (aucun QR, aucun ecran d'onboarding)");
#endif
  return true;
#else
  if (x == REGX_HTTP) { registerShowFailure(); return false; }
  if (x != REGX_OK) return false;
  registerLog();
  if (!paired) registerShowOnboarding(); else registerShowConnected();
  return true;
#endif
}

// ─── PULL ──────────────────────────────────────────────────────────────────
static void maybeFetchAnim(const String& frameId);
static void animForget();
// DOPULL-JSON-STACK-FIX1 (porté au TFT 2,8″) : TOUT le décodage de la réponse /api/pull s'exécute sur une pile de TRAVAIL dédiée (podWorkRun : POD_WORK_STACK_TOTAL o pris au tas, garde 64 o, marge >= 128 o, objectif 256 o, échec fermé),
// APRÈS la fermeture de la transaction TLS (httpCall est revenu : la connexion est stop()ée). Vivent ensemble sur la pile de travail : le document JSON, deserializeJson, toutes les lectures et conversions JsonVariant -> String,
// la branche pendingObservation et ownedBlock ; le document est DÉTRUIT avant le retour sur la pile principale. Le JSON n'est JAMAIS traité pendant que TLS est vivant.
// Sortie : PullParsed, structure BORNÉE appartenant à l'appelant ; AUCUN effet de bord (état global, EEPROM, affichage, ACK) avant un retour VALIDE (PULL_P_OK ou PULL_P_RATE, pile saine).
// BORNES (contrat écrit) : identifiants et empreintes <= 64 car., source de frame <= 16 car., observation <= 8 empreintes : trop long ou trop nombreux => REFUSÉ (pull rejeté, RIEN n'est appliqué, aucune frame, aucun ACK).
// Les deux textes du cartel (titre <= 255 o, artiste <= 127 o ; le serveur n'en envoie jamais plus : 80 / 40 car.) sont TRONQUÉS à une frontière de caractère UTF-8 ; aucune autre troncature.
// Échec fermé : NOMEM, NESTED, GUARD, MARGIN (pile), JSON invalide, champ hors bornes, mémoire insuffisante pour une chaîne => doPull retourne false sans rien appliquer.
#define PULL_ID_MAX     64
#define PULL_SRC_MAX    16
#define PULL_TITLE_MAX  255
#define PULL_ARTIST_MAX 127
#define PULL_OBS_MAX    8
enum PullStatus : uint8_t { PULL_P_NONE = 0, PULL_P_OK = 1, PULL_P_RATE = 2, PULL_P_JSON = 3, PULL_P_BOUNDS = 4, PULL_P_HEAP = 5 };
struct PullParsed {
  uint8_t status;                  // PullStatus : le résultat n'est exploitable que pour PULL_P_OK et PULL_P_RATE
  bool hasCartel, hasObs, benchMode;
  int blockIndex, retryAfter, cartelBlockIndex, rateRetrySec, animBytes;
  const char* jsonErr;             // texte statique de DeserializationError (PULL_P_JSON)
  String blockHash, candId, frameSource, frameId, workTitle, artistName, obsHashes, obsTarget, owned, animHash;
  PullParsed() : status(PULL_P_NONE), hasCartel(false), hasObs(false), benchMode(false), blockIndex(-1), retryAfter(60), cartelBlockIndex(-1), rateRetrySec(60), animBytes(0), jsonErr(nullptr) {}
};
// copie bornée d'un identifiant : au-delà de max => PULL_P_BOUNDS ; copie incomplète (tas) => PULL_P_HEAP
static bool __attribute__((noinline)) pullSetId(String& dst, const char* src, size_t max, PullParsed& r) {
  const size_t n = strlen(src);
  if (n > max) { r.status = PULL_P_BOUNDS; return false; }
  dst = "";
  if (n > 0 && !dst.concat(src, (unsigned int)n)) { r.status = PULL_P_HEAP; return false; }
  if (dst.length() != n) { r.status = PULL_P_HEAP; return false; }
  return true;
}
// copie d'un texte de cartel, TRONQUÉE à une frontière de caractère UTF-8 au-delà de max
static bool __attribute__((noinline)) pullSetText(String& dst, const char* src, size_t max, PullParsed& r) {
  size_t n = strlen(src);
  if (n > max) { n = max; while (n > 0 && (((uint8_t)src[n]) & 0xC0) == 0x80) n--; }
  dst = "";
  if (n > 0 && !dst.concat(src, (unsigned int)n)) { r.status = PULL_P_HEAP; return false; }
  if (dst.length() != n) { r.status = PULL_P_HEAP; return false; }
  return true;
}
// Exécutée SUR LA PILE DE TRAVAIL (voir pullParseOnWorkStack). Ne touche à AUCUN état global : tout va dans r.
static void __attribute__((noinline)) pullParseWork(const String& resp, int code, PullParsed& r) {
  if (code == 429) {
    JSON_DOC(rate, 256);
    r.rateRetrySec = 60;
    if (deserializeJson(rate, resp, DeserializationOption::NestingLimit(POD_WORK_JSON_NESTING)) == DeserializationError::Ok) r.rateRetrySec = max(1, (int)(rate["retryAfter"] | 60));
    r.status = PULL_P_RATE;
    return;
  }
  JSON_DOC(doc, 2048);
  const DeserializationError err = deserializeJson(doc, resp, DeserializationOption::NestingLimit(POD_WORK_JSON_NESTING));
  if (err) { r.jsonErr = err.c_str(); r.status = PULL_P_JSON; return; }

  JsonObject chain = doc["chain"];
  if (!chain.isNull()) { if (!pullSetId(r.blockHash, chain["blockHash"] | "", PULL_ID_MAX, r)) return; r.blockIndex = chain["blockIndex"] | -1; }
  JsonObject pend = doc["pendingValidation"];
  if (!pend.isNull() && !pullSetId(r.candId, pend["candidateId"] | "", PULL_ID_MAX, r)) return;

  if (!pullSetId(r.frameSource, doc["frameSource"] | "none", PULL_SRC_MAX, r)) return;
  if (!pullSetId(r.frameId, doc["frameId"] | "", PULL_ID_MAX, r)) return;
  r.retryAfter = doc["retryAfter"] | 60;
  r.benchMode = doc["benchMode"] | false;
  JsonObject an = doc["anim"];                                // pointeur d'animation (écran à firmware >= 2.4 seulement)
  if (!an.isNull()) { if (!pullSetId(r.animHash, an["hash"] | "", PULL_ID_MAX, r)) return; r.animBytes = an["bytes"] | 0; if (r.animBytes < 0) r.animBytes = 0; }
  if (r.retryAfter <= 0) r.retryAfter = 60;
  if (r.frameId.length() == 0) { JsonObject fo = doc["frame"]; if (!fo.isNull() && !pullSetId(r.frameId, fo["frameId"] | "", PULL_ID_MAX, r)) return; }

  JsonObject cm = doc["cartelMeta"];
  if (!cm.isNull()) {
    r.hasCartel = true;
    if (!pullSetText(r.workTitle, cm["workTitle"] | "", PULL_TITLE_MAX, r)) return;
    if (!pullSetText(r.artistName, cm["drawArtistName"] | "", PULL_ARTIST_MAX, r)) return;
    r.cartelBlockIndex = cm["blockIndex"] | -1;
  }
  JsonObject obs = doc["pendingObservation"];
  if (!obs.isNull()) {
    JsonArray hArr = obs["blockHashes"].as<JsonArray>();
    if (hArr.size() > 0) {
      if (hArr.size() > PULL_OBS_MAX) { r.status = PULL_P_BOUNDS; return; }
      String arr = "[";
      size_t want = 1;
      for (size_t i = 0; i < hArr.size(); i++) {
        const String h = hArr[i].as<String>();                 // conversion JsonVariant -> String : la chaîne la plus profonde (584 o), sur la pile de travail
        if (h.length() > PULL_ID_MAX) { r.status = PULL_P_BOUNDS; return; }
        if (i) { arr += ","; want += 1; }
        arr += "\""; arr += h; arr += "\"";
        want += h.length() + 2;
      }
      arr += "]"; want += 1;
      if (arr.length() != want) { r.status = PULL_P_HEAP; return; }
      r.obsHashes = arr;
      if (r.obsHashes.length() != want) { r.status = PULL_P_HEAP; return; }
      if (!pullSetId(r.obsTarget, obs["targetBlockHash"] | "", PULL_ID_MAX, r)) return;
      r.hasObs = true;
    }
  }
  if (!pullSetId(r.owned, doc["ownedBlock"] | "", PULL_ID_MAX, r)) return;
  r.status = PULL_P_OK;
}
// Lanceur : la fermeture et son PodNetInfo ne vivent que le temps de l'appel (noinline : cadre rendu avant la suite de doPull)
static bool __attribute__((noinline)) pullParseOnWorkStack(const String& resp, int code, PullParsed& r, PodNetInfo& ni) {
  auto wk = [&]() { pullParseWork(resp, code, r); };
  return podWorkRun(wk, &ni);
}
// Échec de la pile de travail (NOMEM, NESTED, GUARD, MARGIN) : rien n'est appliqué. GUARD = garde écrasée => le tas voisin peut être corrompu (logf alloue) : arrêt sûr silencieux AVANT tout journal.
static void __attribute__((noinline)) pullWorkFailed(const PodNetInfo& ni) {
  if (ni.err == POD_NET_GUARD) logfSafeStop();
  logf("[PULL] analyse JSON sur la pile de travail ECHOUEE (err %u) : %s ; pull rejeté, rien n'est appliqué", (unsigned)ni.err, podNetWhy(ni));
}

// Analyse + application, dans cet ordre (la réponse est DÉJÀ reçue, TLS fermé). Retour : 0 = pull ÉCHOUÉ (rien d'appliqué) ; 1 = pull appliqué, décision de frame à prendre ; 2 = terminé (429, rien d'autre à faire).
// Ordre des effets = celui du firmware d'avant (pointeur d'animation, observation, bloc possédé, mode banc d'essai, intervalle, bloc, candidat), puis le cartel SI le pull apporte une nouvelle image.
static int __attribute__((noinline)) doPullApply(PullParsed& r, const String& resp, int code, String& frameId, String& frameSource) {
  PodNetInfo ni;
  const bool ran = pullParseOnWorkStack(resp, code, r, ni);
  POD_CANARY_JSON("pull", ni, ran, r.status, PULL_P_OK, PULL_P_RATE);
  if (!ran) { pullWorkFailed(ni); return 0; }
  if (r.status == PULL_P_RATE) {
    unsigned long retryMs = (unsigned long)r.rateRetrySec * 1000UL;
    if (retryMs > PULL_INTERVAL) retryMs = PULL_INTERVAL;
    lastPullMs = millis() - (PULL_INTERVAL - retryMs);
    logf("[PULL] 429 retryAfter=%ds", r.rateRetrySec);
    return 2;
  }
  if (r.status == PULL_P_JSON) { logf("[PULL] JSON: %s", r.jsonErr); return 0; }
  if (r.status != PULL_P_OK) { logf("[PULL] réponse rejetée : %s", r.status == PULL_P_BOUNDS ? "champ hors bornes" : "mémoire insuffisante"); return 0; }

  pendingAnimHash = r.animHash; pendingAnimBytes = (size_t)r.animBytes;
  if (r.hasObs) { pendingObsHashes = r.obsHashes; pendingObsTarget = r.obsTarget; }
  if (r.owned.length() >= 16) saveOwnedBlockHash(r.owned);

  bool newBenchMode = r.benchMode;
  POD_CANARY_NO_BENCH(newBenchMode);
  if (newBenchMode && !benchMode) { benchModeSince = millis(); lastBenchPollMs = 0; logf("[BENCH] mode banc d'essai ACTIVÉ par l'app (poll toutes les %lu s)", BENCH_POLL_MS / 1000UL); }
  if (!newBenchMode && benchMode) logf("[BENCH] mode banc d'essai désactivé");
  benchMode = newBenchMode;
  nextPullIntervalMs = (r.frameSource == "none" && r.candId.length() == 0) ? (unsigned long)r.retryAfter * 1000UL : PULL_INTERVAL;
  if (r.blockHash.length() > 0 && r.blockHash != currentBlockHash) {
    currentBlockHash = r.blockHash;                          // currentBlockIndex = bloc de l'IMAGE AFFICHÉE : il ne suit pas la tête de chaîne
    saveBlockHashToEEPROM(currentBlockHash);
    logf("[PULL] nouveau bloc #%d", r.blockIndex);
  }
  POD_CANARY_CANDIDATE(r.candId);

  frameId = r.frameId; frameSource = r.frameSource;
  if (frameSource == "none" || frameId.length() == 0 || frameId == lastFrameId) return 1;
  // Le cartel appartient à l'image : sur un pull sans nouvelle image, le serveur répond avec la tête de chaîne, qui n'est pas forcément
  // l'œuvre affichée (image renvoyée depuis une galerie, par exemple). On ne l'applique donc qu'ici.
  if (r.hasCartel) {
    pendingWorkTitle = r.workTitle; pendingArtistName = r.artistName;
    if (r.cartelBlockIndex >= 0) currentBlockIndex = r.cartelBlockIndex;
    logf("[PULL] cartel: %s / %s (bloc %d)", asciiFold(pendingWorkTitle).c_str(), asciiFold(pendingArtistName).c_str(), currentBlockIndex);
  }
  return 1;
}
// La grosse structure PullParsed vit au TAS (pile principale : 1 024 o), le temps d'un pull ; échec de l'allocation => pull rejeté. Aucune structure volumineuse dans les cadres de doPull ni de doFetchFrame.
static int __attribute__((noinline)) doPullStage(const String& resp, int code, String& frameId, String& frameSource) {
  PullParsed* const r = new (std::nothrow) PullParsed();
  if (!r) { logf("[PULL] réponse rejetée : mémoire insuffisante"); return 0; }
  const int rc = doPullApply(*r, resp, code, frameId, frameSource);
  delete r;
  return rc;
}

static bool doPull() {
  String newFrameId = "", newFrameSource = "none";
  int st = 0;
  {
    String resp;
    const int code = httpCall("GET", "/api/pull?deviceId=" + deviceId, nullptr, resp);
    if (code != 429 && code != 200) { logf("[PULL] erreur HTTP %d", code); return false; }
    st = doPullStage(resp, code, newFrameId, newFrameSource);
  }                                                          // resp libérée ici, avant toute image
  if (st == 0) return false;
  if (st == 2) return true;
#if POD_NOHW
  return true;                                               // V4 : frame, animation et banc d'essai IGNORÉS (aucun affichage, aucun ACK) ; seul le candidat annoncé est retenu
#else

  if (newFrameSource == "none" || newFrameId.length() == 0) { logf("[PULL] aucune frame"); return true; }
  if (newFrameId == lastFrameId) { logf("[PULL] frame déjà affichée"); maybeFetchAnim(newFrameId); return true; }
  logf("[PULL] nouvelle frame %s (%s)", newFrameId.c_str(), newFrameSource.c_str());

  const bool fetched = doFetchFrame(newFrameId, newFrameSource) && lastFrameId == newFrameId;
  if (fetched) {
    if (pendingAnimHash.length() == 64) maybeFetchAnim(newFrameId);   // l'affiche est à l'écran : on rapatrie le clip sur la carte
    else animForget();                                                // nouvelle image fixe : l'animation précédente s'arrête
  }
  reportMem("après pull");
  return true;
#endif
}

#if !POD_CANARY
// ─── VALIDATION RÉELLE (vote v2) — ⚠ NON TESTÉE SUR LA CARTE ─────────────
// Le serveur annonce le candidat (écran, taille, SHA-256) ; la R4 lit le contenu BRUT en flux, recalcule le hash et les métriques entières, décide d'un verdict objectif,
// le signe (Ed25519) et vote. Elle relit un candidat de N'IMPORTE QUEL écran (le serveur ne l'oblige pas à voter pour son type) ; le tampon que demandent l'OLED (1 024 o)
// et l'e-ink 2,9" (4 736 o) est statique (la pile de la R4 est petite). Un candidat tft28 (153 600 o) est lu en flux, sans tampon d'image.
static uint8_t g_voteChunk[256];
#if !POD_VOTE_CANARY
static uint8_t g_voteScratch[4736];
#endif

// ─── LOT8B2E V2 (sécurité du vote, hôte seulement) ───────────────────────────────────────────────────────────────────────────────────────────────
// Issue TYPÉE d'un vote (R-H4) : plus aucune interprétation d'un code ou d'une sous-chaîne ambiguë.
//   NOT_SENT              la requête n'a PAS été émise (porte fermée, lecture/signature impossible, abstention, httpCall -4 pile indisponible, -2 connexion TLS impossible, -6 requête non construite)
//   SENT_UNKNOWN          la requête a PU atteindre le serveur et l'issue est INDÉTERMINÉE (-1 réponse illisible, -3 corps incomplet, -5 exécutée mais rejetée localement, HTTP >= 500)
//   ACCEPTED              HTTP 200
//   REFUSED_BY_SERVER     refus du serveur sans motif de signature ni de hash (autres HTTP 4xx/3xx)
//   SIGNATURE_REFUSED     HTTP 403 ET corps « Signature » (seul cas qui déclenche une ré-inscription différée)
//   HASH_REFUSED          HTTP 422 (hash ou métriques différents de ceux du serveur)
// Tout sauf NOT_SENT « dépense » le candidat : aucune nouvelle tentative automatique (verrou RAM ci-dessous ; le verrou persistant en EEPROM est le lot V4).
static const char* voteOutcomeName(VoteOutcome o) {
  switch (o) {
    case VOTE_NOT_SENT: return "NOT_SENT";
    case VOTE_SENT_UNKNOWN: return "SENT_UNKNOWN";
    case VOTE_ACCEPTED: return "ACCEPTED";
    case VOTE_REFUSED_BY_SERVER: return "REFUSED_BY_SERVER";
    case VOTE_SIGNATURE_REFUSED: return "SIGNATURE_REFUSED";
    default: return "HASH_REFUSED";
  }
}
static VoteOutcome __attribute__((noinline)) voteClassify(int code, const String& resp) {
  if (code == -4 || code == -2 || code == -6) return VOTE_NOT_SENT;
  if (code == 200) return VOTE_ACCEPTED;
  if (code < 0) return VOTE_SENT_UNKNOWN;                 // -1 illisible, -3 incomplet, -5 exécuté/rejeté, -7 écriture PARTIELLE (connexion ouverte : des octets ont pu partir) — JAMAIS NOT_SENT
  if (code == 403 && resp.indexOf("Signature") >= 0) return VOTE_SIGNATURE_REFUSED;
  if (code == 422) return VOTE_HASH_REFUSED;
  if (code >= 500) return VOTE_SENT_UNKNOWN;
  return VOTE_REFUSED_BY_SERVER;
}
// Verrou RAM « candidat dépensé » : un candidat dont le vote a PU partir n'est jamais revoté automatiquement (même ré-annoncé par un pull). Perdu à un reset : le verrou EEPROM est le lot V4.
static char g_voteSpentId[65] = "";
static bool voteSpent(const String& id) { return g_voteSpentId[0] != '\0' && id == g_voteSpentId; }
static void voteMarkSpent(const String& id) { strncpy(g_voteSpentId, id.c_str(), sizeof(g_voteSpentId) - 1); g_voteSpentId[sizeof(g_voteSpentId) - 1] = '\0'; }
#if POD_VOTE_CANARY
// ─── LOT8B2E V4 — CANARI DE VOTE (au plus UNE tentative) ───────────────────────────────────────────────────────────────────────────────────
static bool g_vcHalted = false, g_vcAttempted = false;
static uint8_t g_vcPasses = 0;
static const char* g_vcStopWhy = nullptr;       // arrêt définitif demandé par une phase (abstention définitive)
// Épinglage : identifiant, écran, taille ET hash annoncés doivent être exactement ceux de la compilation ; toute divergence => abstention SANS POST.
static bool votePinMatches(const char* id, const char* screen, size_t bytes, const char* hash) {
  return strcmp(id, POD_VOTE_PIN_ID) == 0 && strcmp(screen, POD_VOTE_PIN_SCREEN) == 0 && bytes == (size_t)POD_VOTE_PIN_BYTES && strcmp(hash, POD_VOTE_PIN_HASH) == 0;
}
// VERROU PERSISTANT. Deux emplacements de 16 o dans DEUX blocs de 1 Ko distincts de la flash de données (le pilote réécrit le bloc entier : une coupure ne peut pas détruire les deux), loin des clés (bloc 0).
//   enregistrement : magic « VLK1 », version, état (ATTEMPTED / COMPLETED), issue, séquence, empreinte de l'épinglage, CRC-32. Octet vierge = 0xFF.
//   LIBRE  = les deux emplacements ENTIÈREMENT vierges. TOUT autre contenu (valide, corrompu, tronqué, version inconnue, un seul emplacement) = PRIS (échec fermé). Aucun effacement automatique : seul l'outil
//   manuel consensus-pod/examples/VoteLockErase le remet à zéro.
static const uint32_t VL_MAGIC = 0x564C4B31UL;
static const uint8_t VL_VER = 1, VL_ATTEMPTED = 0x5A, VL_COMPLETED = 0xC3;
static const int VL_OFF_A = 5120, VL_OFF_B = 6144, VL_NEED = 7168;
static uint32_t vlCrc(const VoteLockRec& r) {
  const uint8_t* q = (const uint8_t*)&r; uint32_t c = 0xFFFFFFFFUL;
  for (size_t i = 0; i < 12; i++) { c ^= q[i]; for (int k = 0; k < 8; k++) c = (c >> 1) ^ (0xEDB88320UL & (0u - (c & 1u))); }
  return ~c;
}
static uint32_t vlPin() {   // FNV-1a de l'épinglage complet (lie le verrou à ce candidat, pour le diagnostic)
  uint32_t h = 2166136261UL; const char* parts[4] = { POD_VOTE_PIN_ID, POD_VOTE_PIN_SCREEN, "153600", POD_VOTE_PIN_HASH };
  for (int i = 0; i < 4; i++) { for (const char* c = parts[i]; *c; c++) { h ^= (uint8_t)*c; h *= 16777619UL; } h ^= '|'; h *= 16777619UL; }
  return h;
}
static VlSlot vlReadSlot(int off, VoteLockRec& r) {
  uint8_t* q = (uint8_t*)&r; bool blank = true;
  for (size_t i = 0; i < sizeof(r); i++) { q[i] = EEPROM.read(off + (int)i); if (q[i] != 0xFF) blank = false; }
  if (blank) return VL_BLANK;
  if (r.magic == VL_MAGIC && r.ver == VL_VER && (r.state == VL_ATTEMPTED || r.state == VL_COMPLETED) && r.crc == vlCrc(r)) return VL_VALID;
  return VL_INVALID;
}
static VlStatus voteLockStatus() {
  if (EEPROM.length() < VL_NEED) return VLS_UNAVAILABLE;
  VoteLockRec a, b;
  const VlSlot sa = vlReadSlot(VL_OFF_A, a), sb = vlReadSlot(VL_OFF_B, b);
  return (sa == VL_BLANK && sb == VL_BLANK) ? VLS_FREE : VLS_HELD;
}
static void vlMake(VoteLockRec& r, uint8_t state, uint8_t outcome, uint8_t seq) {
  memset(&r, 0, sizeof(r)); r.magic = VL_MAGIC; r.ver = VL_VER; r.state = state; r.outcome = outcome; r.seq = seq; r.pin = vlPin(); r.crc = vlCrc(r);
}
// Écrit puis RELIT : `put` du cœur ne dit rien si la page de 1 Ko ne peut pas être allouée (read_block => UNABLE_TO_ALLOC) ; seule la relecture prouve l'écriture.
static bool vlWriteVerified(int off, const VoteLockRec& want) {
  EEPROM.put(off, want);
  VoteLockRec got;
  return vlReadSlot(off, got) == VL_VALID && memcmp(&got, &want, sizeof(got)) == 0;
}
// ATTEMPTED dans LES DEUX emplacements, chacun relu et vérifié, AVANT toute ouverture de connexion du POST. Vrai seulement si tout est prouvé ; sinon AUCUN POST.
static bool voteLockCommitAttempt() {
  if (voteLockStatus() != VLS_FREE) return false;
  VoteLockRec r; vlMake(r, VL_ATTEMPTED, 0xFF, 1);
  if (!vlWriteVerified(VL_OFF_A, r)) return false;
  return vlWriteVerified(VL_OFF_B, r);
}
// Issue finale (meilleur effort, emplacement A seulement : une coupure ici laisse B = ATTEMPTED valide, donc le verrou reste PRIS).
static void voteLockRecordOutcome(uint8_t outcome) { VoteLockRec r; vlMake(r, VL_COMPLETED, outcome, 2); (void)vlWriteVerified(VL_OFF_A, r); }

// Instrument de pile PRINCIPALE (peinture 0x5A + marqueur « VOTE ») et de tas ; verrou silencieux si la marge descend sous 128 o. Appelé APRÈS le retour des phases (jamais depuis un corps de rapport).
extern char __StackLimit, __StackTop;
static const uint8_t VC_PAINT = 0x5A;
static const uint32_t VC_MAGIC = 0x564F5445UL;
static volatile uint32_t g_vcPaintLen = 0;
static void vcPaint() {
  volatile uint8_t* lo = (volatile uint8_t*)&__StackLimit;
  volatile uint8_t* hi = (volatile uint8_t*)__builtin_frame_address(0) - 192;
  if (hi <= lo + 16) return;
  for (volatile uint8_t* q = lo + 8; q < hi; q++) *q = VC_PAINT;
  *(volatile uint32_t*)lo = VC_MAGIC;
  *(volatile uint32_t*)(lo + 4) = (uint32_t)(hi - lo);
  g_vcPaintLen = (uint32_t)(hi - lo);
}
static uint32_t vcMaxBlock() {   // sonde par dichotomie malloc/free (le cœur R4 n'expose pas la plus grande plage libre)
  uint32_t lo = 0, hi = freeHeapBytes();
  if (hi > 30000UL) hi = 30000UL;
  while (lo < hi) { const uint32_t mid = (lo + hi + 1) / 2; void* q = malloc(mid); if (q) { free(q); lo = mid; } else hi = mid - 1; }
  return lo;
}
static void __attribute__((noinline)) vcCheck(const char* tag) {
  volatile uint8_t* lo = (volatile uint8_t*)&__StackLimit;
  const uint32_t magic = *(volatile uint32_t*)lo, painted = *(volatile uint32_t*)(lo + 4);
  const bool magicOk = (magic == VC_MAGIC), paintedOk = (painted >= 16 && painted <= 1024 && painted == g_vcPaintLen);
  volatile uint8_t* end = lo + (paintedOk ? painted : 512);
  volatile uint8_t* q = lo + 8; while (q < end && *q == VC_PAINT) q++;
  const uint32_t used = (uint32_t)((uint8_t*)&__StackTop - (uint8_t*)q);
  const long margin = 1024L - (long)used;
  const uint32_t sp = (uint32_t)(uintptr_t)__builtin_frame_address(0);
  const bool spOk = sp > (uint32_t)(uintptr_t)&__StackLimit && sp <= (uint32_t)(uintptr_t)&__StackTop;
  const bool alert = !magicOk || !paintedOk || margin < 128 || !spOk;
  const uint32_t fr = freeHeapBytes(), mb = vcMaxBlock();
  logf("[VOTE-CANARY] %s : pile principale %lu/1024 (marge %ld)%s | tas libre %lu, plus grand bloc %lu", tag, (unsigned long)used, margin, alert ? " ALERTE" : (margin < 256 ? " SOUS L'OBJECTIF 256" : ""), (unsigned long)fr, (unsigned long)mb);
  if (alert) { g_vcHalted = true; for (;;) { __asm volatile("nop"); } }   // marge < 128 o ou marqueur détruit : verrou SILENCIEUX (jamais de suite)
}
static void vcHalt(const char* why) { g_vcHalted = true; logf("[VOTE-CANARY] ARRET DEFINITIF : %s — plus aucun reseau, aucun affichage, aucun ACK", why); }
static void vcAbstain(const char* why) {   // abstention sans POST ; trois passages sans tentative arrêtent le canari
  logf("[VOTE-CANARY] ABSTENTION : %s", why);
  if (++g_vcPasses >= 3) vcHalt("trois passages sans tentative");
}
static void vcLockBoot() {
  const VlStatus st = voteLockStatus();
  logf("[VOTE-CANARY] verrou EEPROM au demarrage : %s", st == VLS_FREE ? "LIBRE (les deux emplacements vierges)" : st == VLS_HELD ? "PRIS" : "INDISPONIBLE");
  if (st != VLS_FREE) vcHalt(st == VLS_HELD ? "verrou deja pris (tentative unique deja consommee ou etat non vierge) — aucun reseau" : "EEPROM indisponible — aucun reseau");
}
static void vcAfterVote() {
  vcCheck("fin du vote");
  if (g_vcAttempted) vcHalt("tentative unique effectuee");
  else if (g_vcStopWhy) vcHalt(g_vcStopWhy);
  else if (++g_vcPasses >= 3) vcHalt("trois passages sans tentative");
}
static const char* voteCanaryGateWhy() {
  if (strcmp(SERVER_HOST, "proof-of-draw.vercel.app") == 0) return "hote = PRODUCTION (backend isole obligatoire)";
  const VlStatus st = voteLockStatus();
  if (st == VLS_UNAVAILABLE) return "EEPROM indisponible pour le verrou";
  if (st != VLS_FREE) return "verrou de vote deja pris ou non vierge (tentative unique)";
  return nullptr;
}
#endif
// Porte de sécurité (R-H1) : clés chargées ET auto-test Ed25519 du boot réussi ET appareil enregistré ET appairé. Sinon : aucune lecture de candidat, aucune signature, aucun POST (journal borné).
static bool __attribute__((noinline)) voteGate() {
  const char* why = !keysLoaded ? "cles non chargees" : !g_edSelfTestOk ? "auto-test Ed25519 non reussi" : !registered ? "appareil non enregistre" : !paired ? "appareil non appaire" : nullptr;
#if POD_VOTE_CANARY
  if (!why) why = voteCanaryGateWhy();
#endif
  if (why) logf("[VOTE] porte FERMEE : %s — aucune lecture, aucune signature, aucun POST", why);
  return why == nullptr;
}

// POD_NET_STACK : lecture du candidat sur la pile réseau dédiée. Fonction à part (noinline) : ses variables ne vivent que pendant la transaction, FERMÉE avant la signature (jamais imbriquée dans PodEd),
// et ne gonflent pas le cadre de doValidate, qui porte ensuite l'appel de signature. FERMÉ EN CAS D'ERREUR (R-H3) : le candidat n'est accepté que si l'échec de la pile dédiée est absent (garde, marge), si le lecteur
// HTTP est COMPLET et si le défaut collant du client TLS est NUL — en plus du nombre d'octets exact ; sinon chk est remis à zéro (chk.ok = false) : « calcul impossible », ni signature ni POST.
static void __attribute__((noinline)) netReadCandidate(const String& candidateId, PodScreenKind kind, size_t bytes, PodCheck& chk) {
  PodNetInfo ni;
  bool rdComplete = false; int rdFault = -1;      // -1 = jamais lu (réponse autre que 200)
  auto tx = [&]() {
    Conn c(HTTP_TIMEOUT_MS);
    const int code = c.request("GET", String("/api/candidate-frame?candidateId=") + candidateId, nullptr);
    chk.http = code;
    logf("[HTTP GET] /api/candidate-frame -> %d", code);
    if (code == 200) {
#if POD_VOTE_CANARY
      podCheckStream(c.rd, kind, bytes, nullptr, 0, g_voteChunk, sizeof(g_voteChunk), &chk);   // V4 : candidat épinglé tft28 => aucun tampon de travail (PodFeeder::need_ = 0), vérifié par les tests
#else
      podCheckStream(c.rd, kind, bytes, g_voteScratch, sizeof(g_voteScratch), g_voteChunk, sizeof(g_voteChunk), &chk);
#endif
      rdComplete = c.rd.complete(); rdFault = (int)c.client.fault();
    }
    c.client.stop();
  };
  const bool ran = podNetRun(tx, &ni);
  if (!ran) { memset(&chk, 0, sizeof(chk)); netStackFailed("VALIDATE2", "", ni, " — pas de vote"); }
  else if (chk.ok && !(rdComplete && rdFault == 0)) { memset(&chk, 0, sizeof(chk)); logf("[VALIDATE2] lecture du candidat REFUSEE : lecteur %s, defaut TLS %d — pas de vote", rdComplete ? "complet" : "INCOMPLET", rdFault); }
}

static bool g_voteMined = false;   // renseigné par voteFinish (vote ACCEPTED avec blockMined:true) ; lu par doValidate
// Classe l'issue du POST, la journalise HONNÊTEMENT et applique ses seules conséquences (blocMined, ré-inscription différée). Fonction à part (noinline) : ses String et son journal ne gonflent pas le cadre de doValidateV2.
static VoteOutcome __attribute__((noinline)) voteFinish(int vCode, const String& vResp) {
  const VoteOutcome out = voteClassify(vCode, vResp);
  logf("[VALIDATE2] issue du vote : %s (code %d)", voteOutcomeName(out), vCode);
  switch (out) {
    case VOTE_ACCEPTED:
      logf("[VALIDATE2] Vote OK");
      if (vResp.indexOf("\"blockMined\":true") >= 0) { logf("[VALIDATE2] BLOC MINÉ"); g_voteMined = true; }
      if (vResp.indexOf("\"rejectObserved\":true") >= 0) logf("[VALIDATE2] refus enregistré par le serveur (non bloquant)");
      break;
    case VOTE_NOT_SENT: logf("[VALIDATE2] vote NON envoyé : la requête n'a pas été émise"); break;
    case VOTE_SENT_UNKNOWN: logf("[VALIDATE2] vote a PU atteindre le serveur, issue INDÉTERMINÉE — aucune nouvelle tentative automatique de ce candidat"); break;
    case VOTE_SIGNATURE_REFUSED:
      // 403 « Signature » = clé publique désynchronisée côté serveur : on se ré-enregistre (au tour de loop() suivant) pour préparer les PROCHAINS candidats. Le candidat COURANT reste DÉPENSÉ (voteMarkSpent) : il n'est JAMAIS revoté. SD-STACK-FIX1 : jamais de doRegister() imbriqué (cadre de doValidate).
      logf("[VALIDATE2] signature refusée par le serveur — resynchronisation de la clé publique (re-register au prochain tour de loop ; CE candidat reste dépensé, il ne sera pas revoté)"); registered = false; break;
    case VOTE_HASH_REFUSED: logf("[VALIDATE2] hash ou métriques refusés par le serveur (422)"); break;
    default: logf("[VALIDATE2] vote refusé par le serveur (%d)", vCode); break;
  }
  return out;
}
// ─── LOT8B2E V3 : la voie de vote en PHASES `noinline` + structure de travail AU TAS ─────────────────────────────────────────────────────────────────
// Objectif : marge de la pile PRINCIPALE (1 024 o) >= 256 o sur toutes les voies du vote (V2 : 152 o). Chaque phase est une fonction à part : ses String, son journal et ses temporaires disparaissent à son retour ; les
// gros objets (PodCheck, signature, hexadécimal) vivent dans VoteWork, alloué UNE fois au tas (new nothrow) par doValidateV2 et libéré sur TOUS les chemins. Si VoteWork ne peut pas être alloué : NOT_SENT, AUCUNE
// lecture, AUCUNE signature, AUCUN POST, nouvelle tentative permise plus tard. Aucune allocation sur la pile principale, aucun snprintf. g_voteScratch / g_voteChunk restent STATIQUES (voir docs/LOT_8B2E_R4_TFT28_VOTE_V3_*.md § 5).
struct VoteWork {
  PodCheck    chk;              // lecture + métriques + hash (≈ 120 o)
  uint8_t     sig[64];
  char        sigHex[129];
  bool        accept;
  const char* reason;           // littéral statique de podVerdict (jamais libéré)
  VoteWork() { memset(this, 0, sizeof(*this)); }
};
// Ajoute p à s ; vrai seulement si TOUT a été ajouté (une String qui ne peut plus grandir tronque en silence : on le détecte par la longueur).
static inline bool voteAppend(String& s, const char* p) { return strAppendChecked(s, p); }
static inline bool voteAppendNum(String& s, unsigned long v) { return strAppendNumChecked(s, v); }
static unsigned voteDigits(unsigned long v) { unsigned d = 1; while (v >= 10) { v /= 10; d++; } return d; }

// Phase 1 : lecture FERMÉE du candidat (pile réseau fermée au retour), abstention sur hash divergent (D-V2), verdict. Retour vrai = on peut signer.
static bool __attribute__((noinline)) votePhaseRead(VoteWork& w, const String& candidateId, const String& screenName, size_t bytes, const String& announcedHash) {
  PodScreenKind kind;
  if (!podKindFromName(screenName.c_str(), &kind)) { logf("[VALIDATE2] écran inconnu : %s", screenName.c_str()); return false; }
#if POD_VOTE_CANARY
  if (kind != POD_TFT28 || bytes != (size_t)POD_VOTE_PIN_BYTES) { logf("[VOTE-CANARY] profil / taille != epinglage : aucune lecture"); return false; }   // g_voteScratch absent : seul tft28 est lisible
#endif
  netReadCandidate(candidateId, kind, bytes, w.chk);
  if (!w.chk.ok) { logf("[VALIDATE2] lecture/calcul impossible (http=%d, %u/%u octets)", w.chk.http, (unsigned)w.chk.bytes, (unsigned)bytes); return false; }
#if POD_VOTE_CANARY
  if (strcmp(announcedHash.c_str(), w.chk.hash) != 0) g_vcStopWhy = "abstention definitive : hash recu != hash epingle";
#endif
  // D-V2 (gelée) : hash reçu ≠ hash annoncé => ABSTENTION locale (aucune signature, aucun POST) : ce n'est PAS un refus signé.
  if (strcmp(announcedHash.c_str(), w.chk.hash) != 0) { logf("[VALIDATE2] hash reçu != hash annoncé : ABSTENTION (aucun vote signé, aucun POST)"); return false; }
  w.reason = podVerdict(w.chk, announcedHash, &w.accept);
  logf("[VALIDATE2] %s %u o en %lu ms | e=%lu t=%lu r=%lu s=%lu | verdict=%s %s", screenName.c_str(), (unsigned)w.chk.bytes, (unsigned long)w.chk.ms,
       (unsigned long)w.chk.m.e, (unsigned long)w.chk.m.t, (unsigned long)w.chk.m.r, (unsigned long)w.chk.m.s, w.accept ? "accept" : "reject", w.reason);
  logf("[VALIDATE2] hash=%s", w.chk.hash);
  return true;
}

// Phase 2 : message signé + signature Ed25519 sur la pile dédiée (jamais imbriquée). Le message est contrôlé par sa LONGUEUR EXACTE (aucune troncature silencieuse). Échec => rien n'est envoyé.
static bool __attribute__((noinline)) votePhaseSign(VoteWork& w, const String& candidateId) {
  const unsigned long ts = millis();
  {
    const String msg = podVoteMessage(deviceId, candidateId, w.chk.hash, w.chk.m, w.accept);
    const unsigned want = 12 + deviceId.length() + 1 + candidateId.length() + 1 + 64 + 1 + voteDigits(POD_METRICS_VERSION) + 1 + voteDigits(w.chk.m.e) + 1 + voteDigits(w.chk.m.t) + 1 + voteDigits(w.chk.m.r) + 1 + 6;
    if (msg.length() != want) { logf("[VALIDATE2] message de vote incomplet (mémoire) — vote NON envoyé"); return false; }
    if (!PodEd::sign(w.sig, privateKey, publicKey, (const uint8_t*)msg.c_str(), msg.length())) { logf("[VALIDATE2] signature impossible (pile Ed25519 dédiée) — vote NON envoyé"); return false; }   // POD_ED_STACK
  }
  static const char HX[] = "0123456789abcdef";
  for (int i = 0; i < 64; i++) { w.sigHex[2 * i] = HX[w.sig[i] >> 4]; w.sigHex[2 * i + 1] = HX[w.sig[i] & 15]; }
  w.sigHex[128] = '\0';
  logf("[VALIDATE2] signature en %lu ms", millis() - ts);
  return true;
}

// Phase 3 : corps JSON (construit par ajouts CONTRÔLÉS, sans temporaire ni formatage printf), POST, classement et journal de l'issue. Corps incomplet (mémoire) => NOT_SENT, rien n'est envoyé.
static VoteOutcome __attribute__((noinline)) votePhasePost(VoteWork& w, const String& candidateId) {
  String body;
  bool ok = body.reserve(512) != 0;
  ok = ok && voteAppend(body, "{\"v\":2,\"deviceId\":\"") && voteAppend(body, deviceId.c_str()) && voteAppend(body, "\",\"candidateId\":\"") && voteAppend(body, candidateId.c_str())
          && voteAppend(body, "\",\"rawHash\":\"") && voteAppend(body, w.chk.hash) && voteAppend(body, "\",\"e\":") && voteAppendNum(body, (unsigned long)w.chk.m.e)
          && voteAppend(body, ",\"t\":") && voteAppendNum(body, (unsigned long)w.chk.m.t) && voteAppend(body, ",\"r\":") && voteAppendNum(body, (unsigned long)w.chk.m.r)
          && voteAppend(body, ",\"verdict\":\"") && voteAppend(body, w.accept ? "accept" : "reject") && voteAppend(body, "\"");
  if (ok && !w.accept) ok = voteAppend(body, ",\"reason\":\"") && voteAppend(body, w.reason) && voteAppend(body, "\"");
  ok = ok && voteAppend(body, ",\"signature\":\"") && voteAppend(body, w.sigHex) && voteAppend(body, "\"}");
  if (!ok) { logf("[VALIDATE2] corps du vote incomplet (mémoire) — vote NON envoyé"); return VOTE_NOT_SENT; }
#if POD_VOTE_CANARY
  vcCheck("avant persistance ATTEMPTED");
  if (!voteLockCommitAttempt()) { logf("[VOTE-CANARY] persistance ATTEMPTED impossible ou non verifiee : AUCUN POST"); return VOTE_NOT_SENT; }
  g_vcAttempted = true;                                   // à partir d'ici la tentative est CONSOMMÉE (verrou prouvé dans les deux emplacements)
  vcCheck("apres persistance ATTEMPTED (verrou verifie)");
#endif
  String vResp;
  const int vCode = httpCall("POST", "/api/validation-result", &body, vResp);
#if POD_VOTE_CANARY
  const VoteOutcome vo = voteFinish(vCode, vResp);
  voteLockRecordOutcome((uint8_t)vo);
  vcCheck("apres POST et classement");
  return vo;
#else
  return voteFinish(vCode, vResp);
#endif
}

static VoteOutcome __attribute__((noinline)) doValidateV2(const String& candidateId, const String& screenName, size_t bytes, const String& announcedHash) {
  g_voteMined = false;
#if POD_VOTE_CANARY
  vcCheck("avant VoteWork");
#endif
  VoteWork* const w = new (std::nothrow) VoteWork();
#if POD_VOTE_CANARY
  if (!w) vcAbstain("VoteWork non allouable (nouvelle tentative permise)");
#endif
  if (!w) { logf("[VALIDATE2] mémoire insuffisante (VoteWork) — aucune lecture, aucune signature, aucun POST ; nouvelle tentative permise"); return VOTE_NOT_SENT; }
  reportMem("VALIDATE2-avant");
  VoteOutcome out = VOTE_NOT_SENT;
#if POD_VOTE_CANARY
  vcCheck("apres VoteWork (alloue)");
  if (votePhaseRead(*w, candidateId, screenName, bytes, announcedHash)) {
    vcCheck("apres lecture du candidat");
    if (votePhaseSign(*w, candidateId)) { vcCheck("apres signature"); out = votePhasePost(*w, candidateId); }
  }
#else
  if (votePhaseRead(*w, candidateId, screenName, bytes, announcedHash) && votePhaseSign(*w, candidateId)) out = votePhasePost(*w, candidateId);
#endif
  memset(w, 0, sizeof(*w));            // efface signature, hash et métriques avant la libération
  delete w;                            // libéré sur TOUS les chemins (lecture, abstention, signature, corps, POST)
  reportMem("VALIDATE2-après");
#if POD_VOTE_CANARY
  vcAfterVote();
#endif
  return out;
}

// ─── VALIDATION ────────────────────────────────────────────────────────────
// DOVALIDATE-JSON-STACK-FIX1 (porté au TFT 2,8″) : la réponse de /api/validate-candidate est décodée sur la pile de TRAVAIL dédiée (podWorkRun : la même que le pull et le register — 2 048 o au tas, garde 64 o, marge >= 128 o,
// échec fermé), APRÈS le retour complet de httpCall (TLS fermé, jamais imbriquée avec PodNet ni PodEd), et AVANT la lecture du candidat, la signature et le vote. Sortie : ValidateParsed, structure BORNÉE (≈ 170 o) allouée au TAS ;
// les paramètres de sortie de doValidateDecode ne sont écrits qu'avec un résultat COMPLET et VALIDE ; sinon rien n'est voté (doValidate efface le candidat, comme avant). CONTRAT (serveur : app/api/validate-candidate/route.ts) :
// candidateId = 8 à 64 caractères [0-9A-Za-z-] (UUID) ; écran = 1 à 16 caractères [a-z0-9_] ; hash annoncé = EXACTEMENT 64 caractères hexadécimaux (SHA-256) ; taille = 1 à 262 144 ; score_server absent = 0,5.
// Toute autre valeur est REFUSÉE — jamais tronquée. « Déjà voté » ou « pas de candidat » : rien à faire, silencieux (comme avant).
enum ValidateStatus : uint8_t { VAL_P_NONE = 0, VAL_P_OK = 1, VAL_P_JSON = 2, VAL_P_INVALID = 3 };
struct ValidateParsed {
  uint8_t status;                  // ValidateStatus : exploitable seulement pour VAL_P_OK
  bool skip, hasV2;                // skip = déjà voté / pas de candidat / identifiant vide (rien à faire)
  int bytes;
  float score;
  const char* jsonErr;             // texte statique de DeserializationError (VAL_P_JSON)
  char candidateId[65];
  char screen[17];
  char hash[65];
  ValidateParsed() : status(VAL_P_NONE), skip(false), hasV2(false), bytes(0), score(0.5f), jsonErr(nullptr) { candidateId[0] = 0; screen[0] = 0; hash[0] = 0; }
};
static bool __attribute__((noinline)) valCharsOk(const char* s, size_t minLen, size_t maxLen, const char* alphabetKind) {
  const size_t n = strlen(s);
  if (n < minLen || n > maxLen) return false;
  for (size_t i = 0; i < n; i++) {
    const char c = s[i];
    const bool digit = (c >= '0' && c <= '9'), lower = (c >= 'a' && c <= 'z'), upper = (c >= 'A' && c <= 'Z');
    switch (alphabetKind[0]) {
      case 'i': if (!(digit || lower || upper || c == '-')) return false; break;      // identifiant : [0-9A-Za-z-]
      case 'e': if (!(digit || lower || c == '_')) return false; break;               // écran : [a-z0-9_]
      default:  if (!(digit || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F'))) return false; break;   // hexadécimal
    }
  }
  return true;
}
// Exécutée SUR LA PILE DE TRAVAIL (voir validateParseOnWorkStack). Ne touche à AUCUN état global : tout va dans r.
static void __attribute__((noinline)) validateParseWork(const String& resp, ValidateParsed& r) {
  JSON_DOC(doc, 768);   // 512 avant la validation réelle : la réponse porte aussi { v2: écran, taille, hash } (≈ 110 o)
  const DeserializationError err = deserializeJson(doc, resp, DeserializationOption::NestingLimit(POD_WORK_JSON_NESTING));
  if (err) { r.jsonErr = err.c_str(); r.status = VAL_P_JSON; return; }
  if ((doc["alreadyVoted"] | false) || doc["candidate"].isNull()) { r.skip = true; r.status = VAL_P_OK; return; }
  JsonObject cand = doc["candidate"];
  const char* cid = cand["candidateId"] | "";
  if (cid[0] == '\0') { r.skip = true; r.status = VAL_P_OK; return; }
  if (!valCharsOk(cid, 8, 64, "i")) { r.status = VAL_P_INVALID; return; }
  if (!cand["v2"].isNull()) {
    const char* sc = cand["v2"]["screen"] | "";
    const int b = cand["v2"]["bytes"] | 0;
    const char* h = cand["v2"]["hash"] | "";
    if (!valCharsOk(sc, 1, 16, "e") || !valCharsOk(h, 64, 64, "h") || b < 1 || b > 262144) { r.status = VAL_P_INVALID; return; }
    memcpy(r.screen, sc, strlen(sc) + 1); memcpy(r.hash, h, 65); r.bytes = b; r.hasV2 = true;
  } else {
    r.score = cand["score_server"] | 0.5f;
  }
  memcpy(r.candidateId, cid, strlen(cid) + 1);
  r.status = VAL_P_OK;
}
static bool __attribute__((noinline)) validateParseOnWorkStack(const String& resp, ValidateParsed& r, PodNetInfo& ni) {
  auto vk = [&]() { validateParseWork(resp, r); };
  return podWorkRun(vk, &ni);
}
// Échec de la pile de travail : aucun vote. GUARD => le tas voisin peut être corrompu (logf alloue) : arrêt sûr silencieux AVANT tout journal.
static void __attribute__((noinline)) validateWorkFailed(const PodNetInfo& ni) {
  if (ni.err == POD_NET_GUARD) logfSafeStop();
  logf("[VALIDATE] analyse JSON sur la pile de travail ECHOUEE (err %u) : %s ; aucun vote", (unsigned)ni.err, podNetWhy(ni));
}
// Décodage de la réponse, APRÈS le retour de httpCall. Retour : 0 = rien à voter (déjà voté, pas de candidat, réponse refusée, échec de pile) ; 1 = validation RÉELLE (v2) ; 2 = ancien chemin (v1, score du serveur).
// Les paramètres de sortie ne sont écrits QUE dans les deux branches valides.
static int __attribute__((noinline)) doValidateDecode(const String& resp, String& candidateId, String& v2screen, size_t& v2bytes, String& v2hash, float& score) {
  ValidateParsed* const r = new (std::nothrow) ValidateParsed();
  if (!r) { logf("[VALIDATE] réponse rejetée : mémoire insuffisante"); return 0; }
  PodNetInfo ni;
  const bool ran = validateParseOnWorkStack(resp, *r, ni);
  int mode = 0;
  if (!ran) validateWorkFailed(ni);
  else if (r->status == VAL_P_JSON) logf("[VALIDATE] JSON illisible: %s", r->jsonErr);
  else if (r->status != VAL_P_OK) logf("[VALIDATE] réponse rejetée : identifiant, écran, hash ou taille absent, hors bornes ou invalide");
  else if (r->skip) mode = 0;
  else if (r->hasV2) { candidateId = r->candidateId; v2screen = r->screen; v2hash = r->hash; v2bytes = (size_t)r->bytes; mode = 1; }
  else { candidateId = r->candidateId; score = r->score; mode = 2; }
  delete r;
  return mode;
}

#if POD_VOTE_V1
static bool doValidateV1(const String& candidateId, float score);
#endif
static bool doValidate() {
  if (pendingCandidateId.length() == 0) return false;
  // LOT8B2E V2 : porte de sécurité AVANT toute requête (R-H1) ; candidat déjà dépensé => aucune nouvelle tentative automatique. pendingCandidateId n'est effacé qu'APRÈS le classement de l'issue.
#if POD_VOTE_CANARY
  if (g_vcHalted) { pendingCandidateId = ""; return false; }
#endif
  if (!voteGate()) { pendingCandidateId = ""; return false; }
  if (voteSpent(pendingCandidateId)) { logf("[VALIDATE] candidat déjà traité : son vote a PU partir — aucune nouvelle tentative automatique"); pendingCandidateId = ""; return false; }
#if POD_VOTE_CANARY
  if (pendingCandidateId != POD_VOTE_PIN_ID) { vcAbstain("candidat annonce != candidat epingle (aucune requete)"); pendingCandidateId = ""; return false; }
#endif
  String candidateId, v2screen, v2hash;
  size_t v2bytes = 0;
  float score = 0.5f;
  int mode = 0;
  {
    String resp;
    if (httpCall("GET", "/api/validate-candidate?deviceId=" + deviceId, nullptr, resp) != 200 || resp.length() == 0) { pendingCandidateId = ""; return false; }
    mode = doValidateDecode(resp, candidateId, v2screen, v2bytes, v2hash, score);
  }                                                          // resp libérée ici, avant la lecture du candidat, la signature et le vote
  if (mode == 0) { pendingCandidateId = ""; return false; }
  // Validation RÉELLE : si le serveur annonce { v2 }, on revérifie le contenu au lieu de recopier son score (anciens serveurs / animations : chemin v1).
  if (mode == 1) {
    if (voteSpent(candidateId)) { logf("[VALIDATE] candidat déjà traité : son vote a PU partir — aucune nouvelle tentative automatique"); pendingCandidateId = ""; return false; }
#if POD_VOTE_CANARY
    if (!votePinMatches(candidateId.c_str(), v2screen.c_str(), v2bytes, v2hash.c_str())) { vcAbstain("identifiant / ecran / taille / hash annonces != epinglage (aucune lecture, aucun POST)"); pendingCandidateId = ""; return false; }
#endif
    const VoteOutcome out = doValidateV2(candidateId, v2screen, v2bytes, v2hash);
    if (out != VOTE_NOT_SENT) voteMarkSpent(candidateId);   // la requête a PU partir : jamais de seconde tentative automatique
    pendingCandidateId = "";                                // effacé APRÈS le classement de l'issue
    return g_voteMined;
  }
#if POD_VOTE_V1
  return doValidateV1(candidateId, score);
#else
#if POD_VOTE_CANARY
  vcAbstain("candidat v1 annonce (voie v1 retiree)");
#endif
  (void)score;
  logf("[VALIDATE] candidat v1 (écho du score du serveur) : AUCUN vote (POD_VOTE_V1 = 0)");
  pendingCandidateId = "";
  return false;
#endif
}
#if POD_VOTE_V1
// Ancien chemin (v1 : le score du serveur est recopié, signé et voté) dans sa propre fonction : sa signature, son corps JSON et son vote ne gonflent plus le cadre de doValidate (SD-STACK-FIX1, texte inchangé).
// LOT8B2E V2 : RETIRÉ du binaire (POD_VOTE_V1 = 0) — un vote v1 ne doit jamais valider une animation v3 et son formatage flottant pèse 384 o de pile.
static bool __attribute__((noinline)) doValidateV1(const String& candidateId, float score) {
  const String signature = signED25519(candidateId, score);
  if (signature.length() == 0) { pendingCandidateId = ""; return false; }   // POD_ED_STACK : signature impossible → pas de vote
  const int m = (int)(score * 1000.0f + 0.5f);
  char sc[12]; snprintf(sc, sizeof(sc), "%d.%03d", m / 1000, m % 1000);
  const String body = String("{\"deviceId\":\"") + deviceId + "\",\"candidateId\":\"" + candidateId + "\","
                      "\"entropy\":" + sc + ",\"transitions\":" + sc + ",\"rle\":" + sc + ",\"score\":" + sc + ","
                      "\"signature\":\"" + signature + "\"}";
  pendingCandidateId = "";

  String vResp;
  const int vCode = httpCall("POST", "/api/validation-result", &body, vResp);
  bool blockMined = false;
  if (vCode == 200) {
    logf("[VALIDATE] vote OK");
    if (vResp.indexOf("\"blockMined\":true") >= 0) { logf("[VALIDATE] BLOC MINÉ"); blockMined = true; }
  } else {
    logf("[VALIDATE] vote refusé (%d)", vCode);
    if (vResp.indexOf("Signature") >= 0) { logf("[VALIDATE] resynchronisation de la clé publique (re-register au prochain tour de loop)"); registered = false; }   // SD-STACK-FIX1 : voir doValidateV2
  }
  return blockMined;
}
#endif
#else
// CANARI SANS VOTE : ni lecture du candidat, ni calcul de métriques, ni signature, ni /api/validate-candidate, ni /api/validation-result, ni re-register depuis ce chemin. Un candidat annoncé par le pull n'est jamais retenu
// (POD_CANARY_CANDIDATE) ; ce stub n'est qu'une ceinture : il oublie tout candidat et ne fait aucune requête.
static bool doValidate() {
  pendingCandidateId = "";
  return false;
}
#endif

// ─── BANC D'ESSAI D'ANIMATION ───────────────────────────────────────────────
// Envoi des pixels PAR BLOCS. Adafruit_SPITFT::writePixels envoie, sur la R4, chaque pixel par deux appels SPI.transfer(octet) séparés (≈ 4,3 µs par
// pixel mesuré au banc d'essai). Le cœur R4 sait envoyer un bloc en mots de 32 bits : on l'appelle directement. transfer(buf, n) écrase le tampon
// avec la réception, d'où la copie dans g_tx32 (alignée 32 bits). La fenêtre d'adressage reste posée par la bibliothèque (DC déjà haut après RAMWR).
static uint32_t g_tx32[SCR_W / 2];                  // 480 o : une ligne de 240 pixels RGB565
static void fastPixels(const uint16_t* colors, uint32_t len) {
  if (!len || len > (uint32_t)SCR_W) return;
  const uint32_t bytes = len * 2;
  memcpy(g_tx32, colors, bytes);
  SPI.transfer((void*)g_tx32, bytes);
}
/** Même interface que Adafruit_ILI9341 pour pod_bench.h, mais writePixels passe par fastPixels. */
struct FastTft {
  void startWrite() { tft.startWrite(); }
  void endWrite() { tft.endWrite(); }
  void setAddrWindow(int x, int y, int w, int h) { tft.setAddrWindow(x, y, w, h); }
  void writePixels(uint16_t* c, uint32_t len, bool, bool) { fastPixels(c, len); }
};

static void postBenchResult(const String& clipId, uint32_t frames, unsigned long expectedMs, unsigned long elapsedMs, unsigned long workSumUs,
                            unsigned long workMaxUs, uint32_t overruns, unsigned long maxLateMs, long minSlackMs, unsigned long downloadMs,
                            size_t bytes, bool stopped, const char* error) {
  String body = "{\"deviceId\":\"" + deviceId + "\",\"clipId\":\"" + clipId + "\",\"frames\":" + String(frames)
              + ",\"expectedMs\":" + String(expectedMs) + ",\"elapsedMs\":" + String(elapsedMs)
              + ",\"avgWorkUs\":" + String(frames ? workSumUs / frames : 0UL) + ",\"maxWorkUs\":" + String(workMaxUs)
              + ",\"overruns\":" + String(overruns) + ",\"maxLateMs\":" + String(maxLateMs) + ",\"minSlackMs\":" + String(minSlackMs)
              + ",\"downloadMs\":" + String(downloadMs)
              + ",\"bytes\":" + String((unsigned long)bytes) + ",\"heapFree\":" + String((unsigned long)freeHeapBytes())
              + ",\"stopped\":" + (stopped ? "true" : "false");
  if (error) body += String(",\"error\":\"") + error + "\"";
  body += "}";
  String resp;
  httpCall("POST", "/api/bench/result", &body, resp);
}

// BENCH-JSON-STACK (porté au TFT 2,8″) : la réponse de /api/bench/poll est décodée, elle aussi, sur la pile de TRAVAIL dédiée (podWorkRun), après le retour de httpCall. Sortie BORNÉE : clipId <= 64 car. [0-9A-Za-z-_] (UUID),
// taille <= 262 144 ; valeur hors bornes ou JSON invalide => le sondage est ABANDONNÉ (rien n'est modifié : mode, clipId, bytes inchangés).
struct BenchPollParsed { uint8_t status; bool mode; int bytes; char clipId[65]; BenchPollParsed() : status(0), mode(false), bytes(0) { clipId[0] = 0; } };
static void __attribute__((noinline)) benchPollParseWork(const String& resp, BenchPollParsed& r) {
  JSON_DOC(doc, 384);
  if (deserializeJson(doc, resp, DeserializationOption::NestingLimit(POD_WORK_JSON_NESTING))) return;
  r.mode = doc["mode"] | false;
  JsonObject c = doc["clip"];
  if (!c.isNull()) {
    const char* id = c["clipId"] | "";
    const int b = c["bytes"] | 0;
    const size_t n = strlen(id);
    if (n > 64 || b < 0 || b > 262144) return;
    for (size_t i = 0; i < n; i++) { const char ch = id[i]; if (!((ch >= '0' && ch <= '9') || (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || ch == '-' || ch == '_')) return; }
    memcpy(r.clipId, id, n + 1); r.bytes = b;
  }
  r.status = 1;
}
static bool __attribute__((noinline)) benchPollDecode(const String& resp, bool& mode, String& clipId, size_t& bytes) {
  BenchPollParsed* const r = new (std::nothrow) BenchPollParsed();
  if (!r) return false;
  PodNetInfo ni;
  auto bk = [&]() { benchPollParseWork(resp, *r); };
  const bool ran = podWorkRun(bk, &ni);
  if (!ran && ni.err == POD_NET_GUARD) logfSafeStop();
  const bool ok = ran && r->status == 1;
  if (ok) { mode = r->mode; clipId = r->clipId; bytes = (size_t)r->bytes; }
  delete r;
  return ok;
}

/** Un contrôle rapide : mode actif ? quel clip ? Retourne 1 = lu, 0 = échec réseau/lecture (429 compris). */
static int benchPollOnce(bool& mode, String& clipId, size_t& bytes) {
  String resp;
  g_quietHttp = true;
  const int code = httpCall("GET", "/api/bench/poll?deviceId=" + deviceId, nullptr, resp);
  g_quietHttp = false;
  if (code == 429) return 0;
  if (code != 200) { logf("[BENCH] poll en erreur (%d)", code); return 0; }
  return benchPollDecode(resp, mode, clipId, bytes) ? 1 : 0;
}

enum BenchStop : uint8_t { BS_DONE = 0, BS_TOUCH, BS_CHECK, BS_CAP };
#define BENCH_LOOP_CHECK_MS 20000UL                 // clip en boucle : on vérifie auprès du serveur toutes les 20 s (l'animation se fige ~2 s)
#define BENCH_LOOP_MAX_MS   (60UL * 60UL * 1000UL)  // et on s'arrête de toute façon au bout d'une heure

/** Télécharge le clip (TLS fermé ensuite), le valide entièrement, le joue en mesurant, renvoie les mesures, puis remet l'œuvre (carte SD). */
// POD_NET_STACK : téléchargement du clip sur la pile réseau dédiée (fonction à part, noinline : ses variables ne gonflent pas le cadre de loop(), où ce code est inliné)
static bool __attribute__((noinline)) netGetBenchClip(const String& clipId, uint8_t* clip, size_t announced) {
  bool got = false;
  PodNetInfo ni;
  auto tx = [&]() {
    Conn c(HTTP_TIMEOUT_MS);
    const int code = c.request("GET", "/api/bench/clip?deviceId=" + deviceId + "&clipId=" + clipId, nullptr);
    if (code == 200 && (c.rd.contentLength() < 0 || (size_t)c.rd.contentLength() == announced))
      got = c.rd.readBody(clip, announced) == announced && c.rd.complete() && c.client.fault() == 0;
    c.client.stop();
  };
  const bool ran = podNetRun(tx, &ni);
  if (!ran) { got = false; netStackFailed("BENCH", "", ni, " — clip NON retenu"); }
  return got;
}

static void playBenchClip(const String& clipId, size_t announced) {
  logf("[BENCH] clip %s : %u octets annoncés", clipId.c_str(), (unsigned)announced);
  lastBenchClipId = clipId;                                   // jamais rejoué en boucle, même en cas d'échec
  if (announced < (size_t)(BENCH_HDR + 5 + BENCH_FRAME) || announced > BENCH_MAX_CLIP) {
    logf("[BENCH] taille refusée (%u)", (unsigned)announced);
    postBenchResult(clipId, 0, 0, 0, 0, 0, 0, 0, 0, 0, announced, false, "taille refusee");
    return;
  }
  uint8_t* clip = (uint8_t*)malloc(announced);
  uint8_t* cur = (uint8_t*)malloc(BENCH_FRAME);
  if (!clip || !cur) {
    free(clip); free(cur);
    logf("[BENCH] mémoire insuffisante");
    postBenchResult(clipId, 0, 0, 0, 0, 0, 0, 0, 0, 0, announced, false, "memoire");
    return;
  }

  const unsigned long tDl = millis();
  bool got = netGetBenchClip(clipId, clip, announced);
  const unsigned long downloadMs = millis() - tDl;
  podbench::Clip pc;
  podbench::Err perr = got ? podbench::parse(clip, announced, pc, cur) : podbench::ERR_SIZE;
  if (!got || perr != podbench::OK) {
    logf("[BENCH] clip refusé (%s)", got ? podbench::errName(perr) : "téléchargement incomplet");
    free(clip); free(cur);
    postBenchResult(clipId, 0, 0, 0, 0, 0, 0, 0, 0, downloadMs, announced, false, got ? "clip invalide" : "telechargement");
    return;
  }
  const bool infinite = (pc.loops == 0);
  logf("[BENCH] reçu en %lu ms — %u images, %s, lecture", downloadMs, (unsigned)pc.frames, infinite ? "EN BOUCLE (toucher = arrêt)" : (String((unsigned)pc.loops) + " boucle(s)").c_str());

  tft.setRotation(0);
  tft.fillScreen(pc.bg);
  cartelVisible = false;                                      // l'écran est désormais celui du banc d'essai
  FastTft ft;
  uint32_t frames = 0, overruns = 0;
  unsigned long workSum = 0, workMax = 0, maxLate = 0, expectedMs = 0, elapsedMs = 0, lastTouchChk = millis();
  long minSlack = 0x7FFFFFFF;
  bool stopped = false;
  const unsigned long tStart = millis();
  unsigned long lastCheck = tStart;
  BenchStop why = BS_DONE;
  for (;;) {
    const unsigned long segStart = millis();
    unsigned long target = segStart;                          // instant où l'image courante DOIT commencer à apparaître
    unsigned long startedMs = segStart;                       // instant où sa peinture a réellement commencé
    unsigned long workStartUs = micros();
    why = BS_DONE;
    podbench::play(pc, cur, ft, g_row, [&](uint32_t, uint16_t delayMs) -> bool {
      const unsigned long workUs = micros() - workStartUs;     // appliquer la différence + peindre
      const long late = (long)(startedMs - target);            // RETARD DE DÉMARRAGE : > 0 seulement si l'image précédente a débordé sur son délai
      if (late > 5) { overruns++; if ((unsigned long)late > maxLate) maxLate = (unsigned long)late; }
      workSum += workUs; if (workUs > workMax) workMax = workUs;
      frames++; expectedMs += delayMs;
      target += delayMs;                                       // horloge ABSOLUE : pas de dérive cumulée
      const long slack = (long)(target - millis());            // marge restante avant l'image suivante (négative = en retard)
      if (slack < minSlack) minSlack = slack;
      while ((long)(millis() - target) < 0) {
        if (touchOk && millis() - lastTouchChk > 200UL) { lastTouchChk = millis(); if (ts.touched()) { drainTouch(); stopped = true; why = BS_TOUCH; return false; } }
        delay(1);
      }
      if (infinite && millis() - lastCheck >= BENCH_LOOP_CHECK_MS) { why = BS_CHECK; return false; }
      if (infinite && millis() - tStart > BENCH_LOOP_MAX_MS) { why = BS_CAP; return false; }
      startedMs = millis(); workStartUs = micros();
      return true;
    });
    elapsedMs += millis() - segStart;
    if (why != BS_CHECK) break;
    // Clip en boucle : le serveur veut-il toujours CE clip ? (un nouvel envoi ou l'arrêt du mode interrompt la boucle)
    bool mode = true; String id; size_t b = 0;
    const int ok = benchPollOnce(mode, id, b);
    lastCheck = millis();
    if (ok && !mode) { benchMode = false; logf("[BENCH] mode terminé côté serveur : fin de la boucle"); break; }
    if (ok && id.length() > 0 && id != clipId) { logf("[BENCH] nouveau clip %s : fin de la boucle", id.c_str()); break; }
  }
  logf("[BENCH] lecture %s : %lu images en %lu ms (prévu %lu) — travail moy %lu us, max %lu us, retards de démarrage %lu (max %lu ms), marge min %ld ms",
       why == BS_TOUCH ? "INTERROMPUE (toucher)" : "terminée", (unsigned long)frames, elapsedMs, expectedMs, frames ? workSum / frames : 0UL, workMax,
       (unsigned long)overruns, maxLate, minSlack == 0x7FFFFFFF ? 0L : minSlack);
  free(clip); free(cur);                                      // libérés AVANT d'ouvrir une connexion TLS pour les mesures
  postBenchResult(clipId, frames, expectedMs, elapsedMs, workSum, workMax, overruns, maxLate, minSlack == 0x7FFFFFFF ? 0L : minSlack, downloadMs, announced, stopped, nullptr);
  if (sdFrameValid) {                                         // l'œuvre revient depuis la carte SD
    const unsigned long tr = millis();
    if (restoreRows(0, SCR_H)) logf("[BENCH] œuvre remise en place depuis la carte SD en %lu ms", millis() - tr);
  }
}

static void doBenchPoll() {
  bool mode = false; String id; size_t bytes = 0;
  if (!benchPollOnce(mode, id, bytes)) return;
  if (!mode) { benchMode = false; logf("[BENCH] mode terminé côté serveur"); return; }
  if (id.length() > 0 && id != lastBenchClipId) playBenchClip(id, bytes);
}

// ─── Animation résidente : clip sur la microSD, lecture en boucle ───────────
/** L'œuvre affichée n'est plus une animation : on oublie le clip (et le marqueur) pour qu'un redémarrage n'affiche pas l'ancienne. */
static void animForgetImpl() {
  if (animOn) logf("[ANIM] arrêt : nouvelle image fixe");
  animOn = false; animPaused = false; animHash = "";
  if (!sdOk) return;
  if (SD.exists(SD_ANIM_META)) SD.remove(SD_ANIM_META);
  if (SD.exists(SD_ANIM)) SD.remove(SD_ANIM);
}
static void animForget() {
  auto w = [&]() { animForgetImpl(); };
  onSd("animForget", w);
}

/** Au démarrage : si la carte porte le clip de l'œuvre qui vient d'être réaffichée, l'animation reprend. */
static void animLoadMarkerImpl() {
  if (!sdOk || !SD.exists(SD_ANIM_META) || !SD.exists(SD_ANIM)) return;
  File m = SD.open(SD_ANIM_META, FILE_READ);
  if (!m) return;
  String hash = m.readStringUntil('\n'); hash.trim();
  String fid = m.readStringUntil('\n'); fid.trim();
  m.close();
  if (hash.length() != 64 || fid != lastFrameId) { logf("[ANIM] clip de la carte ne correspond pas à l'œuvre : ignoré"); return; }
  animOn = true; animPaused = false; animHash = hash;
  logf("[ANIM] clip trouvé sur la carte (bloc %s…) : lecture en boucle", hash.substring(0, 12).c_str());
}
static void animLoadMarker() {
  auto w = [&]() { animLoadMarkerImpl(); };
  onSd("animLoadMarker", w);
}

// ANIM-STREAM-FIX1 (LOT8B2E) — ANIMATION EN FLUX. Canari matériel FIX2 : `[ANIM] mémoire insuffisante` (tas libre ≈ 8 Ko mais plus grand bloc ≈ 4,9 Ko ; l'ancien code allouait le clip ENTIER, jusqu'à 9 216 o, + 1 024 o).
// Désormais : (1) le clip est écrit sur la carte AU FIL DE LA RÉCEPTION (blocs de 480 o dans g_row, comme l'image : aucune allocation), (2) il est validé EN FLUX depuis la carte (mêmes règles et mêmes codes
// que podbench::parse, pod_bench_stream.h), (3) il est joué EN FLUX : seuls 2 048 o de travail sont alloués (image courante 1 024 o + tampon 1 024 o), quelle que soit la taille du clip.
// Ordre d'écriture inchangé : clip COMPLET et valide d'abord, marqueur ensuite ; tout échec supprime le clip (l'affiche reste). Le bus SPI est partagé : jamais de lecture de la carte pendant une transaction TFT.
struct SdClipSource {
  File f;
  bool read(uint8_t* d, size_t n) { return n == 0 || f.read(d, n) == (int)n; }
  bool seek(uint32_t p) { return f.seek(p); }
};
#define ANIM_WORK_BYTES (BENCH_FRAME + PODBENCH_STREAM_BUF)

/** Reçoit le clip du bloc et l'écrit sur la carte AU FIL DE L'EAU (pile réseau dédiée ; la carte est utilisée dans la transaction, comme le cache d'image). true = `announced` octets reçus ET écrits. */
static bool __attribute__((noinline)) netGetBlockClipToSd(const String& hash, size_t announced, bool& writeFailed) {
  bool got = false;
  PodNetInfo ni;
  auto tx = [&]() {
    Conn c(HTTP_TIMEOUT_MS);
    const int code = c.request("GET", "/api/block-clip?hash=" + hash, nullptr);
    logf("[HTTP GET] /api/block-clip -> %d (contenu %ld)", code, c.rd.contentLength());
    if (code == 200 && (c.rd.contentLength() < 0 || (size_t)c.rd.contentLength() == announced)) {
      File f = SD.open(SD_ANIM, FILE_WRITE);
      if (!f) writeFailed = true;
      else {
        uint8_t* raw = (uint8_t*)g_row;
        size_t left = announced; bool ok = true;
        while (left > 0) {
          const size_t k = left < (size_t)ROW_BYTES ? left : (size_t)ROW_BYTES;
          if (c.rd.readBody(raw, k) != k) { ok = false; break; }
          if (f.write(raw, k) != k) { ok = false; writeFailed = true; break; }
          left -= k;
        }
        f.close();
        got = ok && c.rd.complete() && c.client.fault() == 0;
      }
    }
    c.client.stop();
  };
  const bool ran = podNetRun(tx, &ni);
  POD_CANARY_NET("block-clip (reseau + SD)", ni, ran);
  POD_CANARY_CHECK("block-clip : retour de la transaction");
  if (!ran) { got = false; netStackFailed("ANIM", "", ni, " — clip NON retenu"); }
  return got;
}

static void __attribute__((noinline)) animRemoveFiles() {
  auto rm = [&]() { if (SD.exists(SD_ANIM_META)) SD.remove(SD_ANIM_META); if (SD.exists(SD_ANIM)) SD.remove(SD_ANIM); };
  onSd("animRemove", rm);
}

/** Valide le clip rangé (en flux, depuis la carte) puis écrit le marqueur. true = clip valide ET marqueur écrit. work : ANIM_WORK_BYTES. */
static bool __attribute__((noinline)) animValidateAndMark(const String& hash, size_t announced, uint8_t* work, uint16_t& frames) {
  uint8_t err = 0xFF;                                         // 0xFF : non exécuté
  frames = 0;
  auto chk = [&]() {
    SdClipSource src;
    src.f = SD.open(SD_ANIM, FILE_READ);
    if (!src.f) { err = 0xFE; return; }
    if (src.f.size() != announced) { err = 0xFD; src.f.close(); return; }
    podbench::StreamInfo si;
    const podbench::Err e = podbench::validateStream(src, announced, si, work, work + BENCH_FRAME);
    src.f.close();
    err = (uint8_t)e;
    if (e != podbench::OK) return;
    frames = si.frames;
    File m = SD.open(SD_ANIM_META, FILE_WRITE);
    if (m) { m.println(hash); m.println(lastFrameId); m.close(); } else err = 0xFC;
  };
  if (!onSd("animValidate", chk)) { logf("[ANIM] validation du clip NON faite (pile dédiée)"); return false; }
  if (err == podbench::OK) return true;
  if (err == 0xFE) logf("[ANIM] clip illisible après écriture");
  else if (err == 0xFD) logf("[ANIM] taille du clip rangé différente de la taille annoncée");
  else if (err == 0xFC) logf("[ANIM] écriture du marqueur impossible");
  else logf("[ANIM] clip refusé (%s)", podbench::errNameStream((podbench::Err)err));
  return false;
}

static bool fetchAnimToSd(const String& hash, size_t announced) {
  if (!sdOk) { logf("[ANIM] pas de carte SD : animation non lue (l'affiche reste à l'écran)"); return false; }
  if (announced < (size_t)(BENCH_HDR + 5 + BENCH_FRAME) || announced > BENCH_MAX_CLIP) { logf("[ANIM] taille refusée (%u)", (unsigned)announced); return false; }
  const unsigned long t0 = millis();
  animRemoveFiles();                                          // marqueur d'abord : un arrêt en cours d'écriture ne laisse jamais un clip à moitié « actif »
  bool writeFailed = false;
  const bool got = netGetBlockClipToSd(hash, announced, writeFailed);   // ANIM-STREAM-FIX2 : le retour complet = client TLS détruit ET pile réseau libérée ; AUCUN tampon de validation n'existe avant ce point
  uint16_t frames = 0;
  bool ok = false;
  if (!got) logf("[ANIM] clip refusé (%s)", writeFailed ? "écriture sur la carte impossible" : "téléchargement incomplet");
  else {
    uint8_t* work = (uint8_t*)malloc(ANIM_WORK_BYTES);        // alloué SEULEMENT après le téléchargement (pic de tas : jamais tampon de travail + pile réseau ensemble)
    if (!work) logf("[ANIM] mémoire insuffisante (%u o de travail) après le téléchargement : clip supprimé, animation non activée", (unsigned)ANIM_WORK_BYTES);
    else { ok = animValidateAndMark(hash, announced, work, frames); free(work); }
  }
  if (!ok) { animRemoveFiles(); return false; }
  animOn = true; animPaused = false; animHash = hash;
  logf("[ANIM] clip reçu en %lu ms, %u images, rangé sur la carte (%u o) : lecture en boucle", millis() - t0, (unsigned)frames, (unsigned)announced);
  return true;
}

static void maybeFetchAnim(const String& frameId) {
  if (pendingAnimHash.length() != 64) return;
  if (animOn && animHash == pendingAnimHash) return;         // déjà sur la carte
  if (frameId != lastFrameId) return;                        // l'affiche doit être ce qui est à l'écran
  fetchAnimToSd(pendingAnimHash, pendingAnimBytes);
}

/** Joue le clip de la carte EN BOUCLE pendant au plus `budgetMs` (le temps avant la prochaine tâche réseau), puis rend la main. Lecture EN FLUX : 2 048 o de travail, jamais le clip entier. */
static AnimEnd __attribute__((noinline)) runResidentAnim(unsigned long budgetMs) {
  uint8_t* work = (uint8_t*)malloc(ANIM_WORK_BYTES);
  if (!work) { logf("[ANIM] mémoire insuffisante pour la lecture (%u o de travail)", (unsigned)ANIM_WORK_BYTES); return AE_ERROR; }
  AnimEnd why = AE_TIME;
  uint8_t st = 0;                                             // 0 lecture faite ; 1 ouverture ; 2 taille ; 3 clip refusé ; 4 lecture de la carte interrompue
  podbench::Err perr = podbench::OK;
  // Tout l'accès à la carte ET au TFT se fait sur la pile dédiée (SD-STACK-FIX1) ; le clip est validé en flux (même contrôle qu'avant, 2 passes) puis joué.
  auto play = [&]() {
    SdClipSource src;
    src.f = SD.open(SD_ANIM, FILE_READ);
    if (!src.f) { st = 1; return; }
    const size_t n = src.f.size();
    if (n < (size_t)(BENCH_HDR + 5 + BENCH_FRAME) || n > BENCH_MAX_CLIP) { st = 2; src.f.close(); return; }
    podbench::StreamInfo si;
    perr = podbench::validateStream(src, n, si, work, work + BENCH_FRAME);
    if (perr != podbench::OK) { st = 3; src.f.close(); return; }
    tft.setRotation(0);
    tft.fillScreen(si.bg);
    cartelVisible = false;
    FastTft ft;
    const unsigned long tEnd = millis() + budgetMs;
    unsigned long target = millis(), lastTouchChk = millis();
    const podbench::PlayEnd pe = podbench::playStream(src, si, work, work + BENCH_FRAME, ft, g_row, [&](uint32_t, uint16_t delayMs) -> bool {
      target += delayMs;                                      // horloge ABSOLUE : pas de dérive cumulée
      while ((long)(millis() - target) < 0) {
        if (touchOk && millis() - lastTouchChk > 200UL) { lastTouchChk = millis(); if (ts.touched()) { drainTouch(); why = AE_TOUCH; return false; } }
        if ((long)(millis() - tEnd) >= 0) return false;
        delay(1);
      }
      return (long)(millis() - tEnd) < 0;
    });
    if (pe == podbench::PLAY_IO) st = 4;
    src.f.close();
  };
  const bool ran = onSd("animPlay", play);
  free(work);
  if (!ran) return AE_ERROR;
  if (st == 1) { logf("[ANIM] clip illisible"); return AE_ERROR; }
  if (st == 2) { logf("[ANIM] taille de clip invalide"); return AE_ERROR; }
  if (st == 3) { logf("[ANIM] clip de la carte refusé (%s)", podbench::errNameStream(perr)); return AE_ERROR; }
  if (st == 4) { logf("[ANIM] lecture de la carte interrompue"); return AE_ERROR; }
  return why;
}

/** Un toucher pendant l'animation : pause sur l'affiche, avec le cartel. */
static void onAnimTouchImpl() {
  animPaused = true; animPausedSince = millis();
  if (!(sdFrameValid && restoreRows(0, SCR_H))) tft.fillScreen(C_BLACK);
  drawCartel(); cartelVisible = true;
  logf("[ANIM] pause (toucher) : re-toucher ou attendre 60 s pour reprendre");
}
static void onAnimTouch() {
  auto w = [&]() { onAnimTouchImpl(); };
  onSd("onAnimTouch", w);
}

/** Temps avant la prochaine tâche réseau (pull, vote, ré-validation) : l'animation ne la retarde jamais. */
static unsigned long msUntilNextTask() {
  long r = (long)(lastPullMs + nextPullIntervalMs - millis());
  if (pendingCandidateId.length() > 0) { const long v = (long)(lastValidateMs + VALIDATE_INTERVAL - millis()); if (v < r) r = v; }
  if (pendingObsHashes.length() > 0) r = 0;
  return r < 0 ? 0UL : (unsigned long)r;
}

// ─── AUTO-TEST Ed25519 (au boot) : signature + vérification sur la pile dédiée (podEdStack.h), garde et marge mesurées (POD_ED_STACK) ────────────
static void selfTestEd25519() {
  static const char msg[] = "pod-r4-selftest";
  uint8_t sig[64];
  unsigned long t = millis();
  PodEdInfo infoS, infoV; memset(&infoV, 0, sizeof(infoV));   // POD_ED_STACK
  const bool signedOk = PodEd::sign(sig, privateKey, publicKey, msg, strlen(msg), &infoS);
  const unsigned long tSign = millis() - t;
  t = millis();
  const bool ok = signedOk && PodEd::verify(sig, publicKey, msg, strlen(msg), &infoV);   // POD_ED_STACK
  const unsigned long tVerify = millis() - t;
  POD_CANARY_ED("sign", infoS);
  POD_CANARY_ED("verify", infoV);
  logf("[SELFTEST] Ed25519 signature %lu ms, vérification %lu ms -> %s", tSign, tVerify, ok ? "OK" : "ECHEC");
#if !POD_CANARY
  g_edSelfTestOk = ok;                                 // LOT8B2E V2 : état exploitable par la porte du vote
#endif
  reportMem("après Ed25519");
  logf("[ED25519] pile dédiée (utilisé/marge, o) : sign %u/%u, verify %u/%u ; erreurs sign=%u verify=%u (0 = aucune) ; alloué %u o (garde %u o, marge minimale exigée %u o)", (unsigned)infoS.used, (unsigned)infoS.margin, (unsigned)infoV.used, (unsigned)infoV.margin, (unsigned)infoS.err, (unsigned)infoV.err, (unsigned)POD_ED_STACK_TOTAL, (unsigned)POD_ED_GUARD_BYTES, (unsigned)POD_ED_MARGIN_MIN);   // POD_ED_STACK
}

// ─── SETUP / LOOP ──────────────────────────────────────────────────────────
#if POD_VOTE_CANARY
// Boucle du canari de vote : enregistrement, pull (candidat seulement), validation. Rien d'autre : ni toucher, ni animation, ni banc d'essai, ni observation, ni ACK. Arrêt définitif après l'unique issue.
static void voteCanaryLoop() {
  if (g_vcHalted) { delay(1000); return; }
  const unsigned long now = millis();
  if (!registered) { if (!doRegister()) { delay(5000); return; } }
  if (!paired) { delay(1000); return; }                     // l'appairage se fait AVANT le canari (pas de redémarrage automatique)
  if (now - lastPullMs >= nextPullIntervalMs) {
    const String prevCand = pendingCandidateId;
    doPull();
    lastPullMs = millis();
    if (pendingCandidateId.length() > 0 && pendingCandidateId != prevCand) lastValidateMs = millis();
  }
  if (pendingCandidateId.length() > 0 && millis() - lastValidateMs >= VALIDATE_INTERVAL) {
    doValidate();
    lastValidateMs = millis();
  }
  delay(40);
}
#endif
void setup() {
  paintStack();                                         // avant tout : permet de mesurer la profondeur de pile
#if POD_VOTE_CANARY
  vcPaint();                                            // V4 : pile principale peinte + marqueur
#endif
#if POD_CANARY
  podCanaryPaint();                                     // marqueur + zone peinte de la pile principale (instrument du canari)
  g_canBallast[0] = 0xA5;                               // référencé : sinon --gc-sections retire le lest
#endif
  Serial.begin(115200);
  while (!Serial && millis() < 2500) {}
  logf("\n[BOOT] Proof-of-Draw UNO R4 WiFi + TFT 2.8\" tactile — %s", FIRMWARE_VERSION);
#if POD_CANARY
  logf("[CANARY] BUILD LOT8B2D-R4-TFT28-CANARY-1 | base 3239d2e | POD_CANARY=1 | AUCUN VOTE | compile %s %s", __DATE__, __TIME__);
  logf("[CANARY] validate : routes de vote ABSENTES du binaire (canari sans vote) ; seule signature restante = auto-test Ed25519 du boot (message fixe, aucun vote)");
  POD_CANARY_CHECK("boot : avant tout");
  POD_CANARY_HEAP("au boot");
#endif
  reportMem("boot");
#if POD_PREVIEW_ENROLL
  logf("[ENROLL] BUILD TFT28-PREVIEW-ENROLL-1 | POD_PREVIEW_ENROLL=1 | hote %s | AUCUN vote, aucun pull, aucun affichage | compile %s %s", SERVER_HOST, __DATE__, __TIME__);
  if (strcasecmp(SERVER_HOST, "proof-of-draw.vercel.app") == 0) { enrollHalt("hote = PRODUCTION (refuse)"); return; }
#endif
#if POD_VOTE_CANARY
  logf("[VOTE-CANARY] BUILD LOT8B2E-V4 | POD_VOTE_CANARY=1 | hote %s | candidat epingle %s | ecran %s | taille %lu | compile %s %s", SERVER_HOST, POD_VOTE_PIN_ID, POD_VOTE_PIN_SCREEN, (unsigned long)POD_VOTE_PIN_BYTES, __DATE__, __TIME__);
  vcCheck("boot");
  vcLockBoot();
  if (g_vcHalted) return;                               // verrou pris / EEPROM indisponible : AUCUN réseau, jamais
#endif

  pinMode(TFT_CS, OUTPUT);   digitalWrite(TFT_CS, HIGH);
  pinMode(STMPE_CS, OUTPUT); digitalWrite(STMPE_CS, HIGH);
  pinMode(SD_CS, OUTPUT);    digitalWrite(SD_CS, HIGH);

#if POD_NOHW
#if POD_PREVIEW_ENROLL
  logf("[ENROLL] ecran, tactile et carte SD NON initialises (les trois CS restent a HIGH) : aucun dessin, aucun acces SD");
#else
  logf("[VOTE-CANARY] ecran, tactile et carte SD NON initialises (les trois CS restent a HIGH) : aucun dessin, aucun acces SD");
#endif
#else
  tft.begin();
  tft.setRotation(0);
#if TOUCH_ENABLED
  touchOk = ts.begin();
  logf("[TOUCH] STMPE610 %s", touchOk ? "détecté (toucher = afficher / cacher le cartel)" : "NON détecté (toucher désactivé)");
#else
  logf("[TOUCH] désactivé (TOUCH_ENABLED 0)");
#endif
  tftStatus("Proof-of-Draw", "Connexion WiFi...");
  initSD();
#endif

#if POD_NOHW
  if (wifiStatusT("status (module present ?)") == WL_NO_MODULE) { logf("[WIFI] module absent : arret (aucun dessin)"); while (true) delay(1000); }
#else
  if (wifiStatusT("status (module present ?)") == WL_NO_MODULE) { tftStatus("Module WiFi absent", "", C_RED); while (true) delay(1000); }
#endif
  logf("[WIFI] firmware du module: %s", wifiFirmware().c_str());
  int tries = 0;
  while (wifiStatus() != WL_CONNECTED && tries++ < 4) {
    wifiBegin();
    for (int i = 0; i < 20 && wifiStatus() != WL_CONNECTED; i++) delay(500);
  }
#if POD_NOHW
  if (wifiStatus() != WL_CONNECTED) { logf("[WIFI] échec (aucun dessin) : redemarrage"); delay(3000); NVIC_SystemReset(); }
#else
  if (wifiStatus() != WL_CONNECTED) { logf("[WIFI] échec"); tftStatus("WiFi FAIL", "Redemarrage...", C_RED); delay(3000); NVIC_SystemReset(); }
#endif
  logf("[WIFI] IP: %s", wifiIpString().c_str());
#if !POD_NOHW
  tftStatus("WiFi OK", wifiIpString());
#endif
  POD_CANARY_CHECK("wifi : connecte");
  POD_CANARY_HEAP("apres le Wi-Fi");

  if (!keysAlreadyGenerated()) generateKeys();
  else { loadKeysFromEEPROM(); logf("[KEYS] clés chargées: %s", bytesToHex(publicKey, 32).c_str()); }
  selfTestEd25519();
  POD_CANARY_CHECK("auto-test Ed25519 : retour");
#if POD_VOTE_CANARY
  vcCheck("apres auto-test Ed25519");
#endif

  currentBlockHash = loadBlockHashFromEEPROM();
  {
    bool ok = currentBlockHash.length() >= 8;
    for (unsigned i = 0; i < currentBlockHash.length() && ok; i++) { const char c = currentBlockHash[i]; ok = (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F'); }
    if (!ok) currentBlockHash = "";
  }

#if POD_PREVIEW_ENROLL
  for (int att = 0; !registered && att < 6; att++) { if (doRegister()) break; delay(15000); }   // 6 essais espaces de 15 s : sous la limite de 5 register / min / IP du serveur
  enrollHalt(registered ? "appairage a faire ou deja fait : lire la ligne [ENROLL] ci-dessus" : "register impossible apres 6 essais (voir les lignes [REGISTER] et [HTTP])");
#else   // build d'appairage : la suite de setup() (pull, restauration, faux « [BOOT] pret ») N'EXISTE PAS
  while (!registered) { if (doRegister()) break; delay(5000); }
#if POD_VOTE_CANARY
  if (g_vcHalted) return;                               // V4-FIX2 : carte non appairee = arret definitif ; ni pull, ni faux « [BOOT] pret »
#endif
  POD_CANARY_CHECK("register : retour");
  POD_CANARY_HEAP("apres le register");
  if (paired) {
#if !POD_VOTE_CANARY
    restoreLastFrame();                                 // la dernière œuvre revient tout de suite depuis la carte SD
#endif
    POD_CANARY_CHECK("restauration SD : retour");
    logf("[BOOT] premier pull immédiat");
    doPull();
    POD_CANARY_CHECK("pull : retour (premier pull)");
    POD_CANARY_HEAP("apres le premier pull");
  }
  lastPullMs = millis(); lastValidateMs = millis();
  logf("[BOOT] prêt — pull toutes les %lu s", PULL_INTERVAL / 1000UL);
#endif   // POD_PREVIEW_ENROLL
}

void loop() {
#if POD_VOTE_CANARY
  voteCanaryLoop();
#else
#if POD_PREVIEW_ENROLL
  delay(1000);                                          // arret definitif : ni reseau, ni peripherique
#else
  const unsigned long now = millis();

  if (!registered) { if (!doRegister()) { delay(5000); return; } }

  if (!paired) {
    if (now - lastPullMs >= 60000UL) {
      const bool wasPaired = paired;
      doRegister();
      lastPullMs = millis();
      if (!wasPaired && paired) { logf("[PAIRING] appairé -> redémarrage"); delay(1000); NVIC_SystemReset(); }
    }
    delay(250);
    return;
  }

  serviceTouch();

  // Animation résidente : lue depuis la carte, en boucle, entre deux tâches réseau (jamais de requête pour elle)
  if (animOn && animPaused && millis() - animPausedSince > 60000UL) { animPaused = false; logf("[ANIM] reprise (60 s)"); }
  if (animOn && !animPaused && !benchMode) {
    const unsigned long budget = msUntilNextTask();
    if (budget > 400UL) {
      const AnimEnd e = runResidentAnim(budget);
      if (e == AE_TOUCH) onAnimTouch();
      else if (e == AE_ERROR) { animOn = false; logf("[ANIM] lecture impossible : animation abandonnée (l'affiche reste)"); if (sdFrameValid) restoreRows(0, SCR_H); }
      return;                                                 // `now` est périmé : on repart d'une horloge fraîche
    }
  }

  if (benchMode) {
    if (millis() - benchModeSince > BENCH_MODE_MAX_MS) { benchMode = false; logf("[BENCH] mode expiré (31 min)"); }
    else if (millis() - lastBenchPollMs >= BENCH_POLL_MS) { lastBenchPollMs = millis(); doBenchPoll(); }
  }

  if (now - lastPullMs >= nextPullIntervalMs) {
    const String prevCand = pendingCandidateId;
    doPull();
    POD_CANARY_CHECK("pull : retour");
    POD_CANARY_HEAP("apres le pull");
    lastPullMs = millis();
    if (pendingCandidateId.length() > 0 && pendingCandidateId != prevCand) lastValidateMs = millis();
  }

  if (pendingObsHashes.length() > 0) doObsConfirm();

  if (pendingCandidateId.length() > 0 && millis() - lastValidateMs >= VALIDATE_INTERVAL) {
    const bool mined = doValidate();
    lastValidateMs = millis();
    if (mined) { delay(2000); doPull(); lastPullMs = millis(); }
  }
  delay(40);
#endif
#endif
}
#if POD_NOHW
// V4-FIX1 : les fonctions d'affichage, de toucher, de SD, d'animation et d'ACK ne sont PAS atteignables dans ce build (tests/tft28VoteCanary.test.ts et scripts/vote-canary-elf-reach.js) : elles restent définies mais jamais appelées.
// GCC 7 ignore le pragma -Wunused-function pour cet avertissement (émis en fin d'unité) : cette fonction JAMAIS APPELÉE (ni depuis setup(), ni depuis loop() : elle n'est donc pas « atteignable ») prend leur adresse pour ne pas ajouter d'avertissement au build de vote ;
// statique et sans appelant, elle est éliminée à l'édition de liens. La preuve de non-atteignabilité est faite sur les points d'entrée, pas sur cette fonction.
static void __attribute__((unused)) voteCanaryNeverCalledRefs() {
  (void)&runResidentAnim;
  (void)&doFetchFrame;
  (void)&doObsConfirm;
  (void)&msUntilNextTask;
  (void)&animForget;
  (void)&doBenchPoll;
  (void)&initSD;
  (void)&maybeFetchAnim;
  (void)&onAnimTouch;
  (void)&registerShowConnected;
  (void)&registerShowFailure;
  (void)&registerShowOnboarding;
  (void)&restoreLastFrame;
  (void)&serviceTouch;
#if POD_PREVIEW_ENROLL
  (void)&doPull;       // build d'appairage : jamais appelés (setup() s'arrête après le register, loop() n'a que delay())
  (void)&doValidate;
#endif
}
#endif
