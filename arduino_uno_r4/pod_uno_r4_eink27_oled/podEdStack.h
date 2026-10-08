// adapters/podEdStack.h — Ed25519 (bibliothèque « Crypto » 0.4.0, rweather) exécuté sur une PILE DÉDIÉE, pour UNO R4 WiFi.   ⚠ COMPILÉ seulement : jamais essayé sur une carte (micro-canari exigé, voir docs/LOT_8B2B2_PILE_ED25519_R4_2026_10_08.md).
//
// POURQUOI. Le cœur UNO R4 ne réserve que 1 024 o à la pile principale (setup()/loop() s'y exécutent, protection SPMON désactivée dans arduino_main()). Ed25519::verify() demande à elle seule 1 364 o de pile (sign 1 148 o,
// derivePublicKey 1 004 o : analyse statique de l'ELF, scripts/stack-callgraph.js) ; avec setup (176 o) + arduino_main + hal_entry le démarrage atteint 1 564 o — plus les interruptions : la mesure matérielle du 08/10/2026
// montrait « pile max ~1732 o », soit ≈ 700 o écrits SOUS la limite, dans le haut du tas. Rien n'était détecté avant l'instrumentation du canari.
//
// PRINCIPE. La bibliothèque n'est PAS modifiée (format Ed25519 standard, octets identiques). Chaque opération s'exécute sur un espace de pile alloué un instant par malloc() (2 304 o : garde basse de 64 o + 2 240 o de pile),
// via un trampoline Thumb de 8 instructions qui déplace SP (donc MSP : le fil principal tourne sur MSP, aucune bascule PSP/CONTROL, aucune dépendance au mode privilégié) sur cet espace, appelle l'opération, puis rétablit SP.
// Les interruptions qui arrivent pendant le calcul s'empilent donc AUSSI sur la pile dédiée (cadre matériel 32 ou 104 o + gestionnaire) : leur coût est MESURÉ dans la marge au lieu de ronger la pile principale. Après l'appel :
//   • la garde basse doit être INTACTE, sinon l'opération échoue (GUARD) ;
//   • la profondeur réellement utilisée est mesurée (pile peinte à 0xA5) et la marge doit rester ≥ POD_ED_MARGIN_MIN (128 o), sinon l'opération échoue (MARGIN) ;
//   • tout l'espace est ÉCRASÉ de zéros (il a contenu des résidus de la clé) puis rendu au tas ;
//   • en cas d'échec la sortie est mise à zéro et le code d'erreur est rendu : JAMAIS de signature ou de clé publique inventée, JAMAIS « valide » par défaut.
// Contraintes : appel depuis loop()/setup() seulement (jamais depuis une interruption, jamais imbriqué) ; SPMON désactivé (c'est le cas du cœur 1.5.3) ; pas de RTOS qui exploite SP.
// Aucune variable globale (la R4 e-ink 2,9″ n'a que 528 o de marge statique) : les mesures sont rendues par un PodEdInfo que l'appelant place où il veut.
// Distribution : fichier du dossier du sketch (copié par scripts/sync-bench-header.js) — fonctionne avec l'IDE Arduino et arduino-cli, sans toucher au cœur installé ni aux bibliothèques.
// Hôte (tests) : même logique, sans déplacement de SP (la pile de l'hôte est grande) ; POD_ED_HOST_TEST ajoute des crochets pour simuler une pile profonde / une garde écrasée / un malloc impossible.
#pragma once
#include <stdint.h>
#include <stddef.h>
#include <stdlib.h>
#include <string.h>
#include <Ed25519.h>

#ifndef POD_ED_STACK_TOTAL
#define POD_ED_STACK_TOTAL 2304u       // octets alloués au total (garde + pile)
#endif
#define POD_ED_GUARD_BYTES 64u         // garde basse (motif 0xC3), doit rester intacte
#define POD_ED_PAINT 0xA5u
#define POD_ED_GUARD_PAINT 0xC3u
#ifndef POD_ED_MARGIN_MIN
#define POD_ED_MARGIN_MIN 128u         // marge minimale exigée entre la profondeur utilisée et la garde
#endif
// verify = 1 388 o (cadre de run() compris) + un cadre matériel d'exception (104 o avec contexte FPU) + la marge exigée
static_assert(POD_ED_STACK_TOTAL >= POD_ED_GUARD_BYTES + 1388u + 104u + POD_ED_MARGIN_MIN, "pile dédiée trop petite pour Ed25519::verify + une interruption + la marge");

#if defined(__arm__)
  #if !defined(__ARM_ARCH_7EM__)
    #error "podEdStack.h : trampoline écrit pour Cortex-M4 (UNO R4) ; autre coeur ARM non pris en charge"
  #endif
  #define POD_ED_SWITCH_STACK 1
#else
  #define POD_ED_SWITCH_STACK 0
#endif

enum PodEdErr : uint8_t {
  POD_ED_OK = 0,
  POD_ED_NOMEM = 1,    // malloc() impossible : rien n'a été calculé
                       // 2 : réservé (ancienne bascule PSP, supprimée)
  POD_ED_GUARD = 3,    // garde basse écrasée : débordement réel de la pile dédiée, résultat REJETÉ
  POD_ED_MARGIN = 4    // marge < POD_ED_MARGIN_MIN : résultat REJETÉ (alerte, jamais relâchée)
};

struct PodEdInfo {     // mesures de la dernière opération (à placer par l'appelant, ex. local ; 8 o)
  uint16_t used;       // octets de pile dédiée réellement utilisés (interruptions comprises)
  uint16_t margin;     // octets restants avant la garde
  uint8_t err;         // PodEdErr
  uint8_t pad[3];
};

#if POD_ED_SWITCH_STACK
// Trampoline : SP := top, appelle fn(arg), puis rétablit l'ancien SP. r4/r5 sont préservés par l'appelée (AAPCS) ; r5 garde l'ancien SP pendant l'appel.
// Une interruption entre deux instructions est sans danger : SP désigne à tout instant soit l'ancienne pile, soit la pile dédiée, toutes deux valides.
extern "C" __attribute__((naked, noinline, used)) void podEdCallOnStack(__attribute__((unused)) void (*fn)(void*), __attribute__((unused)) void* arg, __attribute__((unused)) uint32_t top) {
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
#endif

#ifdef POD_ED_HOST_TEST
// crochets de test hôte : appelé après le calcul avec (début de la zone de pile, taille de la pile, début de la garde) ; il peut « salir » la pile pour simuler un usage profond ou un débordement
static void (*podEdTestHook)(uint8_t* stackLow, size_t stackBytes, uint8_t* guard) = nullptr;
static int podEdTestFailAlloc = 0;
static void (*podEdTestAfterWipe)(const uint8_t* blk, size_t total) = nullptr;   // crochet : appelé après l'effacement, avant free()
#endif

namespace podedimpl {
  enum Op : uint8_t { DERIVE = 0, SIGN = 1, VERIFY = 2 };
  struct Job { uint8_t op; bool ok; uint8_t* out; const uint8_t* a; const uint8_t* b; const uint8_t* c; const void* msg; size_t len; };
  static void run(void* p) {
    Job* j = (Job*)p;
    switch (j->op) {
      case DERIVE: Ed25519::derivePublicKey(j->out, j->a); j->ok = true; break;
      case SIGN:   Ed25519::sign(j->out, j->a, j->b, j->msg, j->len); j->ok = true; break;
      default:     j->ok = Ed25519::verify(j->a, j->b, j->msg, j->len); break;
    }
  }
  static void wipe(volatile uint8_t* p, size_t n) { while (n--) *p++ = 0; }
  // Exécute le travail sur une pile dédiée ; retourne true si le calcul a eu lieu ET que garde + marge sont saines. Le résultat (job->ok) n'est exploitable que dans ce cas.
  static bool execute(Job* job, PodEdInfo* info) {
    PodEdInfo local; PodEdInfo* I = info ? info : &local;
    I->used = 0; I->margin = 0; I->err = POD_ED_OK; I->pad[0] = I->pad[1] = I->pad[2] = 0;
    uint8_t* blk =
#ifdef POD_ED_HOST_TEST
      podEdTestFailAlloc ? nullptr :
#endif
      (uint8_t*)malloc(POD_ED_STACK_TOTAL);
    if (!blk) { I->err = POD_ED_NOMEM; return false; }
    uint8_t* guard = blk;
    uint8_t* low = blk + POD_ED_GUARD_BYTES;
    const size_t stackBytes = POD_ED_STACK_TOTAL - POD_ED_GUARD_BYTES;
    memset(guard, POD_ED_GUARD_PAINT, POD_ED_GUARD_BYTES);
    memset(low, POD_ED_PAINT, stackBytes);
#if POD_ED_SWITCH_STACK
    podEdCallOnStack(run, job, ((uint32_t)(uintptr_t)(low + stackBytes)) & ~7u);
#else
    run(job);
#endif
#ifdef POD_ED_HOST_TEST
    if (podEdTestHook) podEdTestHook(low, stackBytes, guard);
#endif
    bool guardOk = true;
    for (size_t i = 0; i < POD_ED_GUARD_BYTES; i++) if (guard[i] != POD_ED_GUARD_PAINT) { guardOk = false; break; }
    size_t untouched = 0; while (untouched < stackBytes && low[untouched] == POD_ED_PAINT) untouched++;   // octets intacts depuis le BAS de la pile
    I->margin = (uint16_t)untouched; I->used = (uint16_t)(stackBytes - untouched);
    bool good = true;
    if (!guardOk) { I->err = POD_ED_GUARD; good = false; }
    else if (untouched < POD_ED_MARGIN_MIN) { I->err = POD_ED_MARGIN; good = false; }
    wipe(blk, POD_ED_STACK_TOTAL);   // la pile dédiée a porté des résidus de la clé privée
#ifdef POD_ED_HOST_TEST
    if (podEdTestAfterWipe) podEdTestAfterWipe(blk, POD_ED_STACK_TOTAL);
#endif
    free(blk);
    return good;
  }
}

// Même signature que les méthodes statiques de Ed25519, plus un retour d'état. Aucune ne laisse de valeur plausible en cas d'échec.
class PodEd {
 public:
  /** pub = clé publique de priv. false (et pub = 0) si l'opération n'a pas pu être menée sainement. */
  static bool derivePublicKey(uint8_t pub[32], const uint8_t priv[32], PodEdInfo* info = nullptr) {
    podedimpl::Job j = { podedimpl::DERIVE, false, pub, priv, nullptr, nullptr, nullptr, 0 };
    if (podedimpl::execute(&j, info) && j.ok) return true;
    memset(pub, 0, 32); return false;
  }
  /** sig = signature Ed25519 standard (64 o). false (et sig = 0) si l'opération n'a pas pu être menée sainement. */
  static bool sign(uint8_t sig[64], const uint8_t priv[32], const uint8_t pub[32], const void* msg, size_t len, PodEdInfo* info = nullptr) {
    podedimpl::Job j = { podedimpl::SIGN, false, sig, priv, pub, nullptr, msg, len };
    if (podedimpl::execute(&j, info) && j.ok) return true;
    memset(sig, 0, 64); return false;
  }
  /** true seulement si le calcul a été mené sainement ET que la signature est valide. Sinon false : distinguer un échec technique d'une signature fausse par info->err. */
  static bool verify(const uint8_t sig[64], const uint8_t pub[32], const void* msg, size_t len, PodEdInfo* info = nullptr) {
    podedimpl::Job j = { podedimpl::VERIFY, false, nullptr, sig, pub, nullptr, msg, len };
    return podedimpl::execute(&j, info) && j.ok;
  }
};
