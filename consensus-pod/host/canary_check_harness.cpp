// host/canary_check_harness.cpp — LOT8B2B2-CANARY-BOOT-FIX2 : exécute, sur l'hôte, le CODE RÉEL de l'instrument de canari (podCanaryPaint / podCanaryCheck / paintStack / stackDepthBytes / freeHeapBytes)
// extrait mot pour mot du sketch arduino_uno_r4/pod_uno_r4_eink29/pod_uno_r4_eink29.ino par tests/canaryBootFix2.test.ts (fichier « canary_extract.inc »), contre une mémoire simulée :
//   g_mem[0, 2048[ = haut du tas réservé (zone peinte 0xA5 par paintStack, SOUS __StackLimit) ; g_mem[2048, 3072[ = pile principale de 1 024 o ; __StackLimit = g_mem+2048, __StackTop = g_mem+3072.
// Sortie : une ligne « Sn <statut> » par scénario, lue par le test. Ce que l'hôte PROUVE : la logique de détection (marqueur, marge, écriture sous la limite, SP hors pile), le caractère NON destructif des
// points de contrôle, le silence des points silencieux et le VERROU FATAL (la fonction ne revient jamais). Ce qu'il NE PROUVE PAS : l'état réel de la pile sur la carte.
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <cstdarg>
#include <cstdint>
#include <string>

struct Halted { int prints; };
struct __FlashStringHelper;
#define F(x) (reinterpret_cast<const __FlashStringHelper*>(x))
static const int HEX = 16;
static std::string g_out;
static int g_fatalPrints = 0;
struct SerialShim {
  void print(const char* s) { g_out += s; if (std::strstr(s, "ARRET FATAL") && ++g_fatalPrints >= 3) throw Halted{g_fatalPrints}; }
  void print(const __FlashStringHelper* s) { print(reinterpret_cast<const char*>(s)); }
  void print(unsigned long v) { g_out += std::to_string(v); }
  void print(unsigned v) { g_out += std::to_string(v); }
  void print(int v) { g_out += std::to_string(v); }
  void print(long v) { g_out += std::to_string(v); }
  void print(char c) { g_out += c; }
  void print(unsigned v, int base) { char b[16]; std::snprintf(b, sizeof(b), base == 16 ? "%X" : "%u", v); g_out += b; }
  void println() { g_out += "\n"; }
  void println(const char* s) { print(s); g_out += "\n"; }
  void println(const __FlashStringHelper* s) { print(s); g_out += "\n"; }
} Serial;

static uint8_t g_mem[3072 + 64];
static long g_spoff = 3072 - 300;                       // SP simulé (profondeur courante : 300 o)
static unsigned long g_ms = 0;
static unsigned long millis() { g_ms += 5000; return g_ms; }
struct mallinfo { int arena; int uordblks; int fordblks; };
static struct mallinfo mallinfo() { struct mallinfo m = { 4096, 164, 8532 }; return m; }
static char* sbrk(int) { return reinterpret_cast<char*>(g_mem + 200); }

#define __StackLimit (reinterpret_cast<char*>(g_mem)[2048])
#define __StackTop (reinterpret_cast<char*>(g_mem)[3072])
#define __HeapBase (reinterpret_cast<char*>(g_mem)[100])
#define __HeapLimit (reinterpret_cast<char*>(g_mem)[2048])
#define __builtin_frame_address(x) (static_cast<void*>(g_mem + g_spoff))

#include "../src/adapters/podNetStack.h"   // PodNetInfo / POD_NET_OK, utilisés par podCanaryNet (NETSTACK-FIX1)

// NETSTACK-FIX3-R1 : String minimal (podCanaryMacPhase et macString l'utilisent) ; g_macDestroyAt = sous-phase de macString où le « code fautif » détruit le marqueur (1 appel au module, 2 snprintf, 3 construction du String).
static int g_macDestroyAt = 0;
static void destroyMarker() { std::memset(g_mem + 2048, 0, 4); }
struct String {
  std::string s;
  String() {}
  String(const char* c) : s(c) { if (g_macDestroyAt == 3) destroyMarker(); }
  unsigned length() const { return (unsigned)s.size(); }
  char charAt(unsigned i) const { return i < s.size() ? s[i] : 0; }
  void setCharAt(unsigned i, char c) { if (i < s.size()) s[i] = c; }
};
#include "canary_extract.inc"
// le CODE RÉEL de macHexDigit() et macString() (extrait du sketch, blocs de canari activés) ; le module Wi-Fi (wifiMac, sur pile dédiée dans le sketch) est SIMULÉ : il rend des octets choisis, peut échouer, et détruit le marqueur à la
// sous-phase demandée (1 = juste après l'appel au module). La sous-phase 2 (encodage hexadécimal) est simulée par MAC_TEST_HOOK(), une ligne que le TEST insère dans la boucle d'encodage de la copie extraite.
static bool g_wifiMacFail = false;
static uint8_t g_macBytes[6] = { 0xA0, 0xA1, 0xA2, 0xA3, 0xA4, 0xA5 };
static bool wifiMac(uint8_t* m) { if (g_wifiMacFail) { std::memset(m, 0, 6); return false; } for (int i = 0; i < 6; i++) m[i] = g_macBytes[i]; if (g_macDestroyAt == 1) destroyMarker(); return true; }
#define MAC_TEST_HOOK() do { if (g_macDestroyAt == 2) destroyMarker(); } while (0)
#include "mac_extract.inc"

static void fresh(long sp) { std::memset(g_mem, 0, sizeof(g_mem)); g_out.clear(); g_fatalPrints = 0; g_spoff = sp; paintStack(); podCanaryPaint(); }
// exécute un point de contrôle ; retourne "halt" si le verrou fatal s'est posé (la fonction ne revient pas), "ret" sinon
static const char* check(const char* tag, bool verbose) { try { podCanaryCheck(tag, verbose); } catch (const Halted&) { return "halt"; } return "ret"; }
static bool has(const char* s) { return g_out.find(s) != std::string::npos; }

int main() {
  int n = 0;
  auto line = [&](const char* name, bool ok, const char* extra) { std::printf("S%d %s %s%s%s\n", ++n, ok ? "OK" : "ECART", name, *extra ? " | " : "", extra); };
  // S1 : pile saine, point verbeux : une ligne « pile », pas d'alerte, retour normal, marge = zone peinte
  fresh(3072 - 300);
  { const char* r = check("boot", true); line("pile saine : retour normal + ligne de mesure + marge 532", !std::strcmp(r, "ret") && has("[CANARY] boot : pile utilisee au plus 492 o / 1024 (marge 532 o)") && !has("ALERTE") && !has("ARRET FATAL"), g_out.c_str()); }
  // S2 : point silencieux, tout va bien : aucune sortie
  fresh(3072 - 300);
  { const char* r = check("silencieux", false); line("point silencieux sain : aucune sortie", !std::strcmp(r, "ret") && g_out.empty(), g_out.c_str()); }
  // S3 : non destructif : la mémoire est identique avant/après N points de contrôle (jamais de repeint)
  fresh(3072 - 300);
  { uint8_t snap[sizeof(g_mem)]; std::memcpy(snap, g_mem, sizeof(g_mem)); check("a", true); check("b", false); check("c", true); line("aucun repeint : mémoire identique après 3 points", !std::memcmp(snap, g_mem, sizeof(g_mem)), ""); }
  // S4 : usage cumulatif : 700 o écrits puis un 2e point après un usage MOINS profond : le maximum est conservé (700), pas remis à zéro
  fresh(3072 - 300);
  { g_mem[3072 - 700] = 0x11; check("profond", true); const std::string first = g_out; g_out.clear(); g_mem[3072 - 200] = 0x22; check("moins profond", true);
    line("maximum cumulatif conservé (700 o puis toujours 700 o)", first.find("utilisee au plus 700 o") != std::string::npos && g_out.find("utilisee au plus 700 o") != std::string::npos && g_out.find("ALERTE") == std::string::npos, ""); }
  // S5 : marge insuffisante (900 o → marge 124 < 128) : alerte + diagnostic + VERROU FATAL
  fresh(3072 - 300);
  { g_mem[3072 - 900] = 0x33; const char* r = check("trop profond", true);
    line("marge 124 o : alerte, diagnostic complet, verrou fatal (ne revient jamais)", !std::strcmp(r, "halt") && has("ALERTE PILE utilisee au plus 900 o") && has("marqueur=0x434E5259 (OK)") && has("mallinfo : arene=4096") && has("octets [__StackLimit-8, +24[") && has("ARRET FATAL (verrou) apres 'trop profond'"), ""); }
  // S6 : marqueur détruit mais peinture intacte au-dessus : alerte, « AUCUN » (écriture isolée, pas une descente de la pile)
  fresh(3072 - 300);
  { g_mem[2048 + 1] = 0x00; const char* r = check("marqueur seul", false);
    line("marqueur détruit seul : alerte + AUCUN octet modifié au-dessus + verrou", !std::strcmp(r, "halt") && has("DETRUIT") && has("AUCUN (la peinture est intacte"), ""); }
  // S7 : écriture SOUS __StackLimit (zone peinte 0xA5 du haut du tas) : alerte (débordement)
  fresh(3072 - 300);
  { g_mem[2048 - 10] = 0x77; const char* r = check("sous la limite", false);
    line("écriture sous __StackLimit : alerte + verrou (pile max 1034)", !std::strcmp(r, "halt") && has("ALERTE PILE") && has("ecrit sous la limite ou pile max 1034"), ""); }
  // S8 : SP hors de la pile
  fresh(3072 - 300);
  { g_spoff = 100; const char* r = check("sp", false); line("SP hors de la pile : alerte + verrou", !std::strcmp(r, "halt") && has("HORS de la pile"), ""); }
  // S9 : longueur peinte détruite
  fresh(3072 - 300);
  { g_mem[2048 + 4] = 0; g_mem[2048 + 5] = 0; g_mem[2048 + 6] = 0; g_mem[2048 + 7] = 0; const char* r = check("longueur", false); line("longueur peinte détruite : alerte INCOHERENTE + verrou", !std::strcmp(r, "halt") && has("INCOHERENTE"), ""); }
  // S10 : le verrou se répète (boucle sans fin) : au moins 3 messages avant l'arrêt du harnais
  fresh(3072 - 300);
  { g_mem[3072 - 1000] = 0x44; const char* r = check("boucle", false); line("verrou persistant : message répété dans une boucle sans fin", !std::strcmp(r, "halt") && g_fatalPrints >= 3, ""); }
  // S11 : un point silencieux n'imprime RIEN et ne compte pas comme appel de bibliothèque tant que tout va bien, même profond mais sain (800 o, marge 224)
  fresh(3072 - 300);
  { g_mem[3072 - 800] = 0x55; const char* r = check("profond sain silencieux", false); line("profond mais sain (marge 224) : silencieux", !std::strcmp(r, "ret") && g_out.empty(), ""); }
  // S12-S15 : rapport de la pile réseau dédiée (NETSTACK-FIX1) — une ligne par transaction ; l'échec de la pile dédiée pose le verrou fatal
  fresh(3072 - 300);
  { PodNetInfo ni = { 800, 1000, POD_NET_OK, 0, {0, 0} }; try { podCanaryNet("http", ni, true); } catch (const Halted&) { g_out += "HALT"; }
    line("pile réseau saine : une ligne, pas de verrou", has("[CANARY] net http : pile reseau dediee utilisee 800 o, marge 1000 o (objectif >= 256 : OK), erreur 0") && !has("HALT") && !has("ECHEC"), ""); }
  fresh(3072 - 300);
  { PodNetInfo ni = { 1800, 200, POD_NET_OK, 1, {0, 0} }; try { podCanaryNet("pull-frame", ni, true); } catch (const Halted&) { g_out += "HALT"; }
    line("pile réseau sous l'objectif de 256 o mais >= 128 o : signalée, pas de verrou", has("SOUS L'OBJECTIF") && !has("HALT"), ""); }
  fresh(3072 - 300);
  { PodNetInfo ni = { 1900, 100, POD_NET_MARGIN, 1, {0, 0} }; try { podCanaryNet("candidate-frame", ni, false); } catch (const Halted&) { g_out += "HALT"; }
    line("pile réseau échouée (marge < 128 o) : ECHEC + verrou fatal", has("ECHEC de la pile reseau dediee (ALERTE)") && has("HALT") && has("ARRET FATAL (verrou) apres 'candidate-frame'"), ""); }
  fresh(3072 - 300);
  { PodNetInfo ni = { 0, 0, POD_NET_NOMEM, 0, {0, 0} }; try { podCanaryNet("http", ni, false); } catch (const Halted&) { g_out += "HALT"; }
    line("malloc impossible : ECHEC + verrou fatal (aucun redémarrage en boucle)", has("ECHEC") && has("HALT"), ""); }
  // S16 : sonde de la pile de journal (NETSTACK-FIX2) — la ligne de 250 caractères est écrite, l'utilisation et la marge de la pile de journal sont imprimées
  fresh(3072 - 300);
  { podCanaryLogProbe();
    line("sonde de la pile de journal : ligne de 250 caractères écrite + mesure imprimée", has("[CANARY] sonde journal: 1234567890") && has("[CANARY] pile de journal (ligne de 250 caracteres) : utilisee 0 o, marge 1472 o, erreur 0 (OK)"), ""); }
  // S17-S18 : phase fautive de PodNet (NETSTACK-FIX3) — 0 = silence ; non nulle = diagnostic de la phase puis verrou fatal
  fresh(3072 - 300);
  { podCanaryPhase(0); line("phase 0 (aucune) : silence, retour", g_out.empty(), ""); }
  fresh(3072 - 300);
  { try { podCanaryPhase(3); g_out += "RETURNED"; } catch (const Halted&) { g_out += "HALT"; }
    line("phase fautive 3 : diagnostic + verrou fatal", has("PREMIERE phase fautive = 3") && has("HALT") && !has("RETURNED") && has("ARRET FATAL (verrou) apres 'phase PodNet'"), ""); }
  // S19-S23 : sous-phases de macString (NETSTACK-FIX3-R1) — code RÉEL de macString(), marqueur détruit à la sous-phase d ; la PREMIÈRE est inscrite « !d », rapportée par podCanaryMacPhase APRÈS le retour
  {
    const struct { int d; const char* name; } cases[] = { { 0, "aucune destruction" }, { 1, "destruction juste apres l'appel au module" }, { 2, "destruction pendant snprintf" }, { 3, "destruction pendant la construction du String" } };
    for (const auto& cs : cases) {
      fresh(3072 - 300); g_macDestroyAt = cs.d;
      const String mac = macString();
      g_macDestroyAt = 0;
      const size_t before = g_out.size();                      // les sondes de macString n'écrivent RIEN sur la sortie
      bool halted = false; try { podCanaryMacPhase(mac); } catch (const Halted&) { halted = true; }
      if (cs.d == 0) line("macString sans destruction : adresse intacte, rapport muet, retour", mac.s == "a0:a1:a2:a3:a4:a5" && g_out.empty() && !halted && before == 0, mac.s.c_str());
      else {
        char want[64]; std::snprintf(want, sizeof(want), "PREMIERE sous-phase fautive = %d", cs.d);
        line(cs.name, before == 0 && mac.charAt(0) == '!' && mac.charAt(1) == (char)('0' + cs.d) && halted && has(want) && has("ARRET FATAL (verrou) apres 'macString sous-phase'"), mac.s.c_str());
      }
    }
    // formatage : chiffres hexadécimaux minuscules, bornes des quartets, jamais de dépassement de char[18]
    fresh(3072 - 300); { const uint8_t sample[6] = { 0x00, 0x0f, 0x10, 0x9a, 0xab, 0xff }; std::memcpy(g_macBytes, sample, 6); }
    { const String fm = macString(); line("macString : format minuscule aa:bb exact (00:0f:10:9a:ab:ff), 17 caracteres", fm.s == "00:0f:10:9a:ab:ff" && fm.s.size() == 17, fm.s.c_str()); }
    { const uint8_t back[6] = { 0xA0, 0xA1, 0xA2, 0xA3, 0xA4, 0xA5 }; std::memcpy(g_macBytes, back, 6); }
    // échec fermé : le module Wi-Fi échoue (NOMEM, NESTED, GUARD ou MARGIN) → chaîne VIDE, aucune sous-phase, aucun rapport
    fresh(3072 - 300); g_wifiMacFail = true;
    { const String em = macString(); g_wifiMacFail = false; bool h = false; try { podCanaryMacPhase(em); } catch (const Halted&) { h = true; } line("module Wi-Fi en echec : macString vide (echec ferme), aucun rapport", em.s.empty() && !h && g_out.empty(), em.s.c_str()); }
    fresh(3072 - 300); destroyMarker();                         // marqueur DÉJÀ détruit à l'entrée : la sous-phase 1 le désigne (« à cette sous-phase OU AVANT »)
    const String pre = macString(); bool halted = false; try { podCanaryMacPhase(pre); } catch (const Halted&) { halted = true; }
    line("marqueur deja detruit a l'entree de macString : sous-phase 1", halted && pre.charAt(1) == '1' && has("PREMIERE sous-phase fautive = 1"), pre.s.c_str());
  }
  // S26-S30 : relevé de la pile Wi-Fi dédiée (NETSTACK-WIFI-CALLS-FIX1) — ligne utilisé/marge/erreur ; silencieux si sain et non verbeux ; échec (NOMEM/NESTED/GUARD/MARGIN) ou phase fautive → verrou ; pile PRINCIPALE contrôlée après l'appel
  {
    PodNetInfo ok; std::memset(&ok, 0, sizeof(ok)); ok.used = 612; ok.margin = 860; ok.err = POD_NET_OK; ok.low = 0;
    fresh(3072 - 300);
    { podCanaryWifi("macAddress", ok, true, true);
      line("pile Wi-Fi saine, verbeux : ligne utilisé/marge/erreur imprimée, retour", has("[CANARY] wifi macAddress : pile Wi-Fi dediee utilisee 612 o, marge 860 o (objectif >= 256 : OK), erreur 0") && !has("ALERTE") && !has("ARRET FATAL"), ""); }
    fresh(3072 - 300);
    { podCanaryWifi("status", ok, true, false); line("pile Wi-Fi saine, non verbeux (statut en boucle) : AUCUNE sortie", g_out.empty(), g_out.c_str()); }
    fresh(3072 - 300);
    { PodNetInfo bad = ok; bad.err = POD_NET_MARGIN; bad.margin = 100; bool h = false; try { podCanaryWifi("RSSI", bad, true, false); } catch (const Halted&) { h = true; }
      line("pile Wi-Fi MARGIN : ligne + ECHEC + verrou fatal (même non verbeux)", h && has("erreur 4") && has("ECHEC de la pile Wi-Fi dediee (ALERTE)") && has("ARRET FATAL (verrou) apres 'RSSI'"), ""); }
    fresh(3072 - 300);
    { PodNetInfo ph = ok; ph.pad[0] = 6; bool h = false; try { podCanaryWifi("begin", ph, true, true); } catch (const Halted&) { h = true; }
      line("phase fautive de PodNet pendant un appel Wi-Fi : diagnostic de phase + verrou", h && has("PREMIERE phase fautive = 6") && has("ARRET FATAL (verrou) apres 'phase PodNet'"), ""); }
    fresh(3072 - 300); destroyMarker();                         // la pile PRINCIPALE doit être saine après l'appel : marqueur détruit → alerte
    { bool h = false; try { podCanaryWifi("localIP", ok, true, false); } catch (const Halted&) { h = true; }
      line("pile principale contrôlée après l'appel Wi-Fi : marqueur détruit → ALERTE + verrou", h && has("[CANARY] localIP : ALERTE PILE") && has("ARRET FATAL (verrou) apres 'localIP'"), ""); }
  }
  return 0;
}
