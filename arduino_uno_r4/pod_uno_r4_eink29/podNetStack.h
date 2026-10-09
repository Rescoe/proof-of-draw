// adapters/podNetStack.h — TOUTE une transaction réseau/TLS exécutée sur une PILE DÉDIÉE, pour UNO R4 WiFi.   ⚠ COMPILÉ seulement : jamais essayé sur une carte (canari sans frame exigé, docs/LOT_8B2B2_NETSTACK_FIX1_2026_10_09.md).
//
// POURQUOI. Mesuré sur la carte le 09/10/2026 (BOOT-FIX2) : avant le réseau, la pile principale (1 024 o) est à 864 o (marge 160) ; après WiFiSSLClient::connect(), « pile max réelle = 1480 o » : la connexion TLS
// (connect → getSocket → ModemClass::begin/write → vsnprintf) descend de 456 o SOUS __StackLimit, dans le haut du tas. Défaut PRÉEXISTANT du firmware stable (le haut du tas est vide en pratique). Corriger le seul connect()
// ne suffit pas : l'envoi, la lecture des en-têtes, du corps et stop() appellent le même modem (available/read/write → vsnprintf). Toute la transaction passe donc ici.
//
// PRINCIPE (identique à PodEd, validé sur la carte le 09/10/2026 : sign 1316/924, verify 1532/708, erreurs 0/0). PodNet::run(fn, ctx) alloue un instant un espace au tas (garde basse 64 o peinte 0xC3 + pile peinte 0xA5),
// déplace SP dessus par un trampoline Thumb de 8 instructions (les interruptions s'y empilent donc aussi : leur coût est MESURÉ dans la marge), appelle fn(ctx), rétablit SP, puis :
//   • garde basse intacte, sinon GUARD ; marge (octets de pile jamais touchés) >= POD_NET_MARGIN_MIN (128 o), sinon MARGIN ; objectif POD_NET_MARGIN_GOAL (256 o), signalé par PodNetInfo ;
//   • tout l'espace est ÉCRASÉ de zéros (requêtes, réponses) puis rendu au tas ;
//   • ÉCHEC FERMÉ : run() retourne false (NOMEM, NESTED, GUARD ou MARGIN) et l'appelant doit traiter la transaction comme ÉCHOUÉE (aucun résultat partiel présenté comme réussi, ni vote, ni ACK, ni affichage).
// RÈGLES : (1) tout ce qui est produit par la transaction doit vivre dans des objets de l'APPELANT (variables capturées par référence, tampons existants) — jamais de pointeur ni de référence vers une variable automatique
// créée sur la pile dédiée ; (2) JAMAIS imbriquée, ni dans PodEd, ni dans elle-même (détecté : SP hors de la pile principale → NESTED) ; la connexion doit être fermée (stop()) AVANT de quitter fn ;
// (3) jamais depuis une interruption ; (4) SPMON désactivé (cœur 1.5.3 : R_MPU_SPMON->SP[0].CTL = 0).
// Aucune variable globale (marge statique du R4 e-ink 2,9″ : 528 o). Distribution : fichier du dossier du sketch (scripts/sync-bench-header.js), sans toucher au cœur ni aux bibliothèques.
// Hôte (tests) : même logique sans déplacement de SP ; POD_NET_HOST_TEST ajoute des crochets (pile profonde simulée, garde écrasée, malloc impossible, imbrication).
#pragma once
#include <stdint.h>
#include <stddef.h>
#include <stdlib.h>
#include <string.h>

#ifndef POD_NET_STACK_TOTAL
#define POD_NET_STACK_TOTAL 2048u      // octets alloués au total (garde + pile) — justification : docs/LOT_8B2B2_NETSTACK_FIX1_2026_10_09.md § 4
#endif
#define POD_NET_GUARD_BYTES 64u        // garde basse (motif 0xC3), doit rester intacte
#define POD_NET_PAINT 0xA5u
#define POD_NET_GUARD_PAINT 0xC3u
#ifndef POD_NET_MARGIN_MIN
#define POD_NET_MARGIN_MIN 128u        // marge minimale exigée : en dessous, la transaction est déclarée ÉCHOUÉE
#endif
#define POD_NET_MARGIN_GOAL 256u       // objectif : en dessous, PodNetInfo::low est vrai (journalisé par le canari)
// NETSTACK-FIX2 : pile de JOURNAL. Le formatage (vsnprintf) et l'écriture USB (Serial) descendent d'environ 450 o sous leur appelant ; appelés depuis les couches profondes (setup → doRegister → httpCall : 608 o de cadres)
// ils dépassent les 1 024 o de la pile principale (canari du 09/10/2026 : 24 o sous __StackLimit, au retour de la transaction). logf() les exécute donc sur une petite pile dédiée : 1 536 o = garde 64 +
// chaîne vsnprintf pire cas statique 736 (avec la branche flottante jamais exécutée) + cadre d'exception 104 + 256 de marge visée + réserve pour la chaîne USB mesurée (≈ 270 – 450).
#ifndef POD_LOG_STACK_TOTAL
#define POD_LOG_STACK_TOTAL 1536u
#endif
static_assert(POD_LOG_STACK_TOTAL >= POD_NET_GUARD_BYTES + 736u + 104u + POD_NET_MARGIN_GOAL, "pile de journal trop petite");
static_assert(POD_NET_STACK_TOTAL >= POD_NET_GUARD_BYTES + 1024u + POD_NET_MARGIN_MIN, "pile réseau dédiée trop petite");

#if defined(__arm__)
  #if !defined(__ARM_ARCH_7EM__)
    #error "podNetStack.h : trampoline écrit pour Cortex-M4 (UNO R4) ; autre coeur ARM non pris en charge"
  #endif
  #define POD_NET_SWITCH_STACK 1
#else
  #define POD_NET_SWITCH_STACK 0
#endif

// NETSTACK-FIX3 : SONDES de phase, SANS entrée/sortie. POD_NET_PROBE(info, n) est un no-op par défaut ; le build de canari (sketch e-ink 2,9″) la définit AVANT l'inclusion pour mémoriser, dans info->pad[0], le numéro de
// la PREMIÈRE phase où le marqueur de pile est trouvé détruit (lecture d'un mot déjà posé : aucune profondeur ajoutée, aucun appel de bibliothèque). Phases : 1 entrée de runSized · 2 après malloc + peinture ·
// 3 juste après le trampoline · 4 après le scan garde/filigrane · 5 après le calcul de marge · 6 après l'effacement · 7 après free · 8 retour de podNetRun. (Le retour de netHttpRaw est le point A du sketch.)
#ifndef POD_NET_PROBE
#define POD_NET_PROBE(I, n) ((void)0)
#endif

enum PodNetErr : uint8_t {
  POD_NET_OK = 0,
  POD_NET_NOMEM = 1,    // malloc() impossible : rien n'a été exécuté
  POD_NET_NESTED = 2,   // déjà sur une pile dédiée (PodEd ou réseau) : rien n'a été exécuté
  POD_NET_GUARD = 3,    // garde basse écrasée : débordement réel, transaction ÉCHOUÉE
  POD_NET_MARGIN = 4    // marge < POD_NET_MARGIN_MIN : transaction ÉCHOUÉE
};

struct PodNetInfo {     // mesures de la dernière transaction (à placer par l'appelant ; 8 o)
  uint16_t used;        // octets de pile dédiée réellement utilisés (interruptions comprises)
  uint16_t margin;      // octets restants avant la garde
  uint8_t err;          // PodNetErr
  uint8_t low;          // 1 si margin < POD_NET_MARGIN_GOAL (réussie mais sous l'objectif)
  uint8_t pad[2];
};

/** true si la transaction a RÉELLEMENT été exécutée alors que son résultat local est rejeté (GUARD, MARGIN : détectés APRÈS coup) — un POST, un vote ou un ACK a pu atteindre le serveur ;
 *  false si elle n'a jamais démarré (NOMEM, NESTED). */
static inline bool podNetExecuted(const PodNetInfo& ni) { return ni.err == POD_NET_GUARD || ni.err == POD_NET_MARGIN; }
/** Formulation honnête de l'échec, pour les journaux. */
static inline const char* podNetWhy(const PodNetInfo& ni) { return podNetExecuted(ni) ? "transaction EXÉCUTÉE mais résultat local REJETÉ (garde/marge)" : "transaction NON exécutée (mémoire/imbrication)"; }

#if POD_NET_SWITCH_STACK
extern char __StackLimit, __StackTop;   // symboles de l'éditeur de liens du cœur R4 (pile principale = [__StackLimit, __StackTop])
// vrai si SP est dans la pile PRINCIPALE ; faux sur une pile dédiée (PodEd ou réseau) → imbrication refusée
static inline bool podNetOnMainStack() {
  const uint32_t sp = (uint32_t)(uintptr_t)__builtin_frame_address(0);
  return sp > (uint32_t)(uintptr_t)&__StackLimit && sp <= (uint32_t)(uintptr_t)&__StackTop;
}
// Trampoline : SP := top, appelle fn(arg), puis rétablit l'ancien SP. r4/r5 sont préservés par l'appelée (AAPCS) ; r5 garde l'ancien SP pendant l'appel.
// MÊMES 8 instructions que podEdCallOnStack (validé sur la carte) : une interruption entre deux instructions est sans danger, SP désigne à tout instant une pile valide.
extern "C" __attribute__((naked, noinline, used)) void podNetCallOnStack(__attribute__((unused)) void (*fn)(void*), __attribute__((unused)) void* arg, __attribute__((unused)) uint32_t top) {
  __asm volatile(
    "push {r4, r5, lr}      \n"
    "mov  r4, r0            \n"   // r4 = fn
    "mov  r5, sp            \n"   // r5 = ancien SP (pile principale)
    "mov  r0, r1            \n"   // r0 = arg
    "mov  sp, r2            \n"   // SP = sommet de la pile dédiée (aligné sur 8 o)
    "blx  r4                \n"   // fn(arg) s'exécute sur la pile dédiée
    "mov  sp, r5            \n"   // retour sur la pile principale
    "pop  {r4, r5, pc}      \n");
}
#else
#ifdef POD_NET_HOST_TEST
static int podNetTestNested = 0;
static inline bool podNetOnMainStack() { return podNetTestNested == 0; }
#else
static inline bool podNetOnMainStack() { return true; }
#endif
#endif

#ifdef POD_NET_HOST_TEST
// crochets de test hôte : appelé après fn avec (début de la pile, taille de la pile, début de la garde) ; peut « salir » la pile
static void (*podNetTestHook)(uint8_t* stackLow, size_t stackBytes, uint8_t* guard) = nullptr;
static int podNetTestFailAlloc = 0;
static void (*podNetTestAfterWipe)(const uint8_t* blk, size_t total) = nullptr;
#endif

namespace podnetimpl {
  static void wipe(volatile uint8_t* p, size_t n) { while (n--) *p++ = 0; }
}

class PodNet {
 public:
  /** Exécute fn(ctx) sur une pile dédiée. true = fn a tourné ET garde + marge sont saines (les résultats écrits par fn dans les objets de l'appelant sont exploitables).
   *  false = ÉCHEC FERMÉ : traiter la transaction comme échouée, ignorer tout résultat partiel. info->err donne la cause. */
  static bool run(void (*fn)(void*), void* ctx, PodNetInfo* info = nullptr) { return runSized(fn, ctx, POD_NET_STACK_TOTAL, info); }
  /** Même chose avec une taille choisie (garde comprise), p. ex. POD_LOG_STACK_TOTAL pour le journal. Moins de 512 o utilisables : refusé (NOMEM, fn non appelée). */
  static bool runSized(void (*fn)(void*), void* ctx, size_t total, PodNetInfo* info = nullptr) {
    PodNetInfo local; PodNetInfo* I = info ? info : &local;
    I->used = 0; I->margin = 0; I->err = POD_NET_OK; I->low = 0; I->pad[0] = I->pad[1] = 0;
    POD_NET_PROBE(I, 1);
    if (!podNetOnMainStack()) { I->err = POD_NET_NESTED; return false; }
    if (total < POD_NET_GUARD_BYTES + 512u) { I->err = POD_NET_NOMEM; return false; }
    uint8_t* blk =
#ifdef POD_NET_HOST_TEST
      podNetTestFailAlloc ? nullptr :
#endif
      (uint8_t*)malloc(total);
    if (!blk) { I->err = POD_NET_NOMEM; return false; }
    uint8_t* guard = blk;
    uint8_t* low = blk + POD_NET_GUARD_BYTES;
    const size_t stackBytes = total - POD_NET_GUARD_BYTES;
    memset(guard, POD_NET_GUARD_PAINT, POD_NET_GUARD_BYTES);
    memset(low, POD_NET_PAINT, stackBytes);
    POD_NET_PROBE(I, 2);
#if POD_NET_SWITCH_STACK
    podNetCallOnStack(fn, ctx, ((uint32_t)(uintptr_t)(low + stackBytes)) & ~7u);
#else
    fn(ctx);
#endif
    POD_NET_PROBE(I, 3);
#ifdef POD_NET_HOST_TEST
    if (podNetTestHook) podNetTestHook(low, stackBytes, guard);
#endif
    bool guardOk = true;
    for (size_t i = 0; i < POD_NET_GUARD_BYTES; i++) if (guard[i] != POD_NET_GUARD_PAINT) { guardOk = false; break; }
    size_t untouched = 0; while (untouched < stackBytes && low[untouched] == POD_NET_PAINT) untouched++;   // octets intacts depuis le BAS de la pile
    POD_NET_PROBE(I, 4);
    I->margin = (uint16_t)untouched; I->used = (uint16_t)(stackBytes - untouched);
    I->low = (untouched < POD_NET_MARGIN_GOAL) ? 1 : 0;
    bool good = true;
    if (!guardOk) { I->err = POD_NET_GUARD; good = false; }
    else if (untouched < POD_NET_MARGIN_MIN) { I->err = POD_NET_MARGIN; good = false; }
    POD_NET_PROBE(I, 5);
    podnetimpl::wipe(blk, total);   // requêtes et réponses ont transité par cette pile
#ifdef POD_NET_HOST_TEST
    if (podNetTestAfterWipe) podNetTestAfterWipe(blk, total);
#endif
    POD_NET_PROBE(I, 6);
    free(blk);
    POD_NET_PROBE(I, 7);
    return good;
  }
};

/** Confort : exécute un objet appelable sans argument (typiquement une lambda [&]) sur la pile dédiée. L'objet appelable vit sur la pile de l'APPELANT ; il peut lire et écrire les variables de l'appelant. */
template <typename F> static bool podNetRun(F& f, PodNetInfo* info = nullptr) {
  const bool ok = PodNet::run([](void* p) { (*static_cast<F*>(p))(); }, &f, info);
  if (info) { POD_NET_PROBE(info, 8); }
  return ok;
}
