// pod_sd_stack.h — LOT8B2D (SD-STACK-FIX1) : exécution d'une opération carte SD / TFT sur une PILE DÉDIÉE (POD_SD_STACK_TOTAL o au tas : garde 64 o, filigrane, marge >= 128 o, effacée avant free, jamais imbriquée, échec fermé).
//
// POURQUOI UN EN-TÊTE. Le générateur de prototypes d'Arduino (arduino-ctags) traite le sketch .ino : un TEMPLATE défini dans le .ino reçoit un prototype sans sa ligne « template <…> » et la compilation échoue
// (« error: 'F' is not a type », arduino-cli 1.4.1, cœur Renesas 1.6.0). Les en-têtes ne passent pas par ce générateur : les deux gabarits vivent donc ici, inclus par pod_uno_r4.ino APRÈS sdStackFailed, POD_CANARY_SD et
// les macros de pile (PodNet, podNetOnMainStack, POD_SD_STACK_TOTAL). Logique et tailles de pile INCHANGÉES par rapport à la version précédemment définie dans le .ino.
// Contrat de l'inclusion : sdStackFailed(const char*, const PodNetInfo&) et POD_CANARY_SD(what, ni, ran) sont déjà définis ; podNetStack.h est déjà inclus.
#pragma once

template <typename F> static void __attribute__((noinline)) onSdDirect(F& f) { f(); }   // branche « déjà sur une pile dédiée » : fonction à part pour que l'analyse statique de la pile PRINCIPALE ne la suive pas (tft28-stack-report.js : barrière)
template <typename F> static bool onSd(const char* what, F& f) {
  if (!podNetOnMainStack()) { onSdDirect(f); return true; }                 // déjà sur une pile dédiée (transaction réseau, pile de travail) : pas d'imbrication
  PodNetInfo ni;
  const bool ran = PodNet::runSized([](void* p) { (*static_cast<F*>(p))(); }, &f, POD_SD_STACK_TOTAL, &ni);
  POD_CANARY_SD(what, ni, ran);
  if (!ran) sdStackFailed(what, ni);
  return ran;
}
