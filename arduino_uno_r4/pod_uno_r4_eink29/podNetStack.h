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
static_assert(POD_NET_STACK_TOTAL >= POD_NET_GUARD_BYTES + 1024u + POD_NET_MARGIN_MIN, "pile réseau dédiée trop petite");

#if defined(__arm__)
  #if !defined(__ARM_ARCH_7EM__)
    #error "podNetStack.h : trampoline écrit pour Cortex-M4 (UNO R4) ; autre coeur ARM non pris en charge"
  #endif
  #define POD_NET_SWITCH_STACK 1
#else
  #define POD_NET_SWITCH_STACK 0
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
  static bool run(void (*fn)(void*), void* ctx, PodNetInfo* info = nullptr) {
    PodNetInfo local; PodNetInfo* I = info ? info : &local;
    I->used = 0; I->margin = 0; I->err = POD_NET_OK; I->low = 0; I->pad[0] = I->pad[1] = 0;
    if (!podNetOnMainStack()) { I->err = POD_NET_NESTED; return false; }
    uint8_t* blk =
#ifdef POD_NET_HOST_TEST
      podNetTestFailAlloc ? nullptr :
#endif
      (uint8_t*)malloc(POD_NET_STACK_TOTAL);
    if (!blk) { I->err = POD_NET_NOMEM; return false; }
    uint8_t* guard = blk;
    uint8_t* low = blk + POD_NET_GUARD_BYTES;
    const size_t stackBytes = POD_NET_STACK_TOTAL - POD_NET_GUARD_BYTES;
    memset(guard, POD_NET_GUARD_PAINT, POD_NET_GUARD_BYTES);
    memset(low, POD_NET_PAINT, stackBytes);
#if POD_NET_SWITCH_STACK
    podNetCallOnStack(fn, ctx, ((uint32_t)(uintptr_t)(low + stackBytes)) & ~7u);
#else
    fn(ctx);
#endif
#ifdef POD_NET_HOST_TEST
    if (podNetTestHook) podNetTestHook(low, stackBytes, guard);
#endif
    bool guardOk = true;
    for (size_t i = 0; i < POD_NET_GUARD_BYTES; i++) if (guard[i] != POD_NET_GUARD_PAINT) { guardOk = false; break; }
    size_t untouched = 0; while (untouched < stackBytes && low[untouched] == POD_NET_PAINT) untouched++;   // octets intacts depuis le BAS de la pile
    I->margin = (uint16_t)untouched; I->used = (uint16_t)(stackBytes - untouched);
    I->low = (untouched < POD_NET_MARGIN_GOAL) ? 1 : 0;
    bool good = true;
    if (!guardOk) { I->err = POD_NET_GUARD; good = false; }
    else if (untouched < POD_NET_MARGIN_MIN) { I->err = POD_NET_MARGIN; good = false; }
    podnetimpl::wipe(blk, POD_NET_STACK_TOTAL);   // requêtes et réponses ont transité par cette pile
#ifdef POD_NET_HOST_TEST
    if (podNetTestAfterWipe) podNetTestAfterWipe(blk, POD_NET_STACK_TOTAL);
#endif
    free(blk);
    return good;
  }
};

/** Confort : exécute un objet appelable sans argument (typiquement une lambda [&]) sur la pile dédiée. L'objet appelable vit sur la pile de l'APPELANT ; il peut lire et écrire les variables de l'appelant. */
template <typename F> static bool podNetRun(F& f, PodNetInfo* info = nullptr) {
  return PodNet::run([](void* p) { (*static_cast<F*>(p))(); }, &f, info);
}
