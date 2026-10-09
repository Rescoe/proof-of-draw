// host/net_stack_harness.cpp — LOT8B2B2-NETSTACK-FIX1 : logique de consensus-pod/src/adapters/podNetStack.h (transaction réseau sur pile dédiée) exécutée sur l'hôte.
//   net_stack_harness  →  « PASS <n> » (code 0) ou la liste des écarts (code 1).
// Ce que l'hôte PROUVE : fn est appelée exactement une fois et ses résultats vivent dans les objets de l'APPELANT ; marge 127 o refusée / 128 o acceptée / objectif 256 o signalé ; garde écrasée refusée ;
// malloc impossible ou imbrication → fn N'EST PAS appelée ; effacement complet avant free() ; aucune fuite de tas (même après un échec) ; échec fermé (run() == false ⇒ l'appelant ignore les résultats partiels).
// Ce qu'il NE PROUVE PAS : le déplacement réel de SP et la profondeur de la chaîne Wi-Fi/TLS sur la carte (canari sans frame).
#define POD_NET_HOST_TEST 1
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <functional>
#include "../src/adapters/podNetStack.h"

static int g_pass = 0, g_fail = 0;
static void expect(const std::string& name, bool ok) { if (ok) g_pass++; else { g_fail++; std::printf("ÉCART : %s\n", name.c_str()); } }

static size_t g_wipeChecked = 0; static bool g_wipeAllZero = true;
static void afterWipe(const uint8_t* blk, size_t total) { g_wipeChecked++; for (size_t i = 0; i < total; i++) if (blk[i]) g_wipeAllZero = false; }
static size_t g_touchAt = 0;
static void touch(uint8_t* low, size_t, uint8_t*) { low[g_touchAt] = 0x00; }
static void smashGuard(uint8_t*, size_t, uint8_t* guard) { guard[3] = 0x00; }
static void smashGuardLast(uint8_t*, size_t, uint8_t* guard) { guard[POD_NET_GUARD_BYTES - 1] = 0x01; }

struct Ctx { int calls; int code; char body[16]; };
static void fnSimple(void* p) { Ctx* c = static_cast<Ctx*>(p); c->calls++; c->code = 200; std::strcpy(c->body, "ok"); }

int main() {
  podNetTestAfterWipe = afterWipe;
  // 1) résultats dans les objets de l'appelant, un seul appel, mesures pleines côté hôte
  { Ctx c = {0, 0, ""}; PodNetInfo ni; std::memset(&ni, 0xEE, sizeof(ni));
    const bool ok = PodNet::run(fnSimple, &c, &ni);
    expect("run réussit", ok); expect("fn appelée exactement une fois", c.calls == 1); expect("résultats dans l'objet de l'appelant", c.code == 200 && !std::strcmp(c.body, "ok"));
    expect("info OK, marge pleine, objectif atteint", ni.err == POD_NET_OK && ni.used == 0 && ni.margin == POD_NET_STACK_TOTAL - POD_NET_GUARD_BYTES && ni.low == 0); }
  // 2) lambda capturant des variables de l'appelant
  { int code = -4; std::string body; PodNetInfo ni; auto tx = [&]() { code = 200; body = "hello"; };
    expect("podNetRun(lambda) réussit et écrit chez l'appelant", podNetRun(tx, &ni) && code == 200 && body == "hello"); }
  // 3) effacement complet avant free(), une zone par transaction
  g_wipeChecked = 0; g_wipeAllZero = true;
  { Ctx c = {0, 0, ""}; PodNet::run(fnSimple, &c); PodNet::run(fnSimple, &c); }
  expect("effacement : 2 transactions → 2 zones effacées, entièrement à zéro", g_wipeChecked == 2 && g_wipeAllZero);
  // 4) 4 cycles : aucune dérive du tas (même bloc réutilisé)
  { void* before = std::malloc(POD_NET_STACK_TOTAL); std::free(before); Ctx c = {0, 0, ""}; bool ok = true;
    for (int i = 0; i < 4; i++) ok = ok && PodNet::run(fnSimple, &c);
    void* after = std::malloc(POD_NET_STACK_TOTAL); std::free(after);
    expect("4 transactions réussies", ok && c.calls == 4); expect("4 transactions : aucune dérive du tas", before == after); }
  // 5) marge : 700 acceptée ; 256 → objectif atteint ; 255 → réussie mais « low » ; 128 acceptée ; 127 REFUSÉE (MARGIN) ; pile entièrement consommée refusée
  podNetTestHook = touch;
  { Ctx c = {0, 0, ""}; PodNetInfo ni;
    g_touchAt = 700; bool ok = PodNet::run(fnSimple, &c, &ni);
    expect("marge 700 : saine, mesures exactes", ok && ni.err == POD_NET_OK && ni.margin == 700 && ni.used == POD_NET_STACK_TOTAL - POD_NET_GUARD_BYTES - 700 && ni.low == 0);
    g_touchAt = POD_NET_MARGIN_GOAL; ok = PodNet::run(fnSimple, &c, &ni); expect("marge 256 (objectif) : saine, low = 0", ok && ni.margin == 256 && ni.low == 0);
    g_touchAt = POD_NET_MARGIN_GOAL - 1; ok = PodNet::run(fnSimple, &c, &ni); expect("marge 255 : réussie mais SOUS l'objectif (low = 1)", ok && ni.err == POD_NET_OK && ni.low == 1);
    g_touchAt = POD_NET_MARGIN_MIN; ok = PodNet::run(fnSimple, &c, &ni); expect("marge 128 (seuil) : acceptée", ok && ni.err == POD_NET_OK && ni.margin == 128 && ni.low == 1);
    g_touchAt = POD_NET_MARGIN_MIN - 1; ok = PodNet::run(fnSimple, &c, &ni); expect("marge 127 : REFUSÉE (MARGIN) → run() == false", !ok && ni.err == POD_NET_MARGIN);
    g_touchAt = 0; ok = PodNet::run(fnSimple, &c, &ni); expect("pile entièrement consommée : refusée (MARGIN)", !ok && ni.err == POD_NET_MARGIN); }
  // 6) garde écrasée (premier et dernier octets) : refusée
  podNetTestHook = smashGuard;
  { Ctx c = {0, 0, ""}; PodNetInfo ni; expect("garde écrasée : refusée (GUARD)", !PodNet::run(fnSimple, &c, &ni) && ni.err == POD_NET_GUARD); }
  podNetTestHook = smashGuardLast;
  { Ctx c = {0, 0, ""}; PodNetInfo ni; expect("garde écrasée sur son dernier octet : refusée", !PodNet::run(fnSimple, &c, &ni) && ni.err == POD_NET_GUARD); }
  podNetTestHook = nullptr;
  // 7) échec fermé : l'appelant qui respecte la règle (ignorer les résultats si run() == false) n'expose rien
  { podNetTestHook = touch; g_touchAt = 10; int shown = 0; Ctx c = {0, 0, ""}; PodNetInfo ni;
    if (PodNet::run(fnSimple, &c, &ni)) shown = c.code;   // schéma de tous les sites du firmware
    expect("échec fermé : rien n'est présenté comme réussi", shown == 0 && ni.err == POD_NET_MARGIN); podNetTestHook = nullptr; }
  // 8) malloc impossible : fn N'EST PAS appelée
  podNetTestFailAlloc = 1;
  { Ctx c = {0, 0, ""}; PodNetInfo ni; expect("malloc impossible : NOMEM, fn non appelée", !PodNet::run(fnSimple, &c, &ni) && ni.err == POD_NET_NOMEM && c.calls == 0); }
  podNetTestFailAlloc = 0;
  // 9) imbrication : refusée AVANT toute allocation, fn non appelée ; aussi quand elle est tentée depuis fn
  podNetTestNested = 1;
  { Ctx c = {0, 0, ""}; PodNetInfo ni; expect("déjà sur une pile dédiée : NESTED, fn non appelée", !PodNet::run(fnSimple, &c, &ni) && ni.err == POD_NET_NESTED && c.calls == 0); }
  podNetTestNested = 0;
  { Ctx inner = {0, 0, ""}; PodNetInfo innerInfo; bool innerRan = true;
    auto outer = [&]() { podNetTestNested = 1; innerRan = PodNet::run(fnSimple, &inner, &innerInfo); podNetTestNested = 0; };   // simule « SP est sur la pile dédiée » pendant fn
    PodNetInfo ni;
    expect("imbrication depuis fn refusée, la transaction externe reste saine", podNetRun(outer, &ni) && !innerRan && innerInfo.err == POD_NET_NESTED && inner.calls == 0); }
  // 10) aucune fuite après un échec (le bloc est rendu) : même adresse réutilisée
  { podNetTestHook = touch; g_touchAt = 0; void* before = std::malloc(POD_NET_STACK_TOTAL); std::free(before); Ctx c = {0, 0, ""}; PodNet::run(fnSimple, &c);
    void* after = std::malloc(POD_NET_STACK_TOTAL); std::free(after); expect("échec (MARGIN) : aucun bloc perdu", before == after); podNetTestHook = nullptr; }
  // 11) l'information est facultative
  { Ctx c = {0, 0, ""}; expect("PodNetInfo facultatif", PodNet::run(fnSimple, &c) && c.calls == 1); }

  if (g_fail) std::printf("FAIL %d écarts / %d vérifications\n", g_fail, g_pass + g_fail); else std::printf("PASS %d\n", g_pass);
  return g_fail ? 1 : 0;
}
