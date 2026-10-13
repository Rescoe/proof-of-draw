// consensus-pod/host/touch_gesture_harness.cpp — LOT8B2E ANIM-TOUCH-GESTURES-1 : preuve EXHAUSTIVE du classificateur pur arduino_uno_r4/pod_uno_r4/pod_touch_gesture.h.
// Sortie : « PASS <n> » (code 0) ou la liste des écarts (code 1). Le modèle de référence ci-dessous est écrit INDÉPENDAMMENT du code testé (il raisonne sur la liste des échantillons « posés »).
#include "pod_touch_gesture.h"
#include <cstdio>
#include <string>
#include <vector>

static int g_checks = 0; static std::vector<std::string> g_fail;
#define CHECK(cond, msg) do { g_checks++; if (!(cond)) g_fail.push_back(std::string(msg) + " [" #cond "]"); } while (0)

struct Sample { uint32_t t; bool pressed; };
struct Out { int actions = 0; PodGesture first = PG_NONE; PodGesture second = PG_NONE; uint32_t firstAt = 0; };

static Out run(const std::vector<Sample>& s) {
  PodTouchClassifier c; podTouchReset(c); Out o;
  for (const Sample& x : s) {
    const PodGesture g = podTouchStep(c, x.pressed, x.t);
    if (g != PG_NONE) { o.actions++; if (o.actions == 1) { o.first = g; o.firstAt = x.t; } else if (o.actions == 2) o.second = g; }
  }
  return o;
}
// Contact [start, start+dur) interrogé toutes les `period` ms depuis `base` ; on poursuit `tail` ms après la fin (relâchement stable observable).
static std::vector<Sample> contact(uint32_t base, uint32_t period, uint32_t start, uint32_t dur, uint32_t tail, const std::vector<std::pair<uint32_t, uint32_t>>& gaps = {}) {
  std::vector<Sample> v;
  for (uint32_t t = 0; t <= start + dur + tail; t += period) {
    bool p = t >= start && t < start + dur;
    for (auto& g : gaps) if (t >= g.first && t < g.second) p = false;
    v.push_back({ (uint32_t)(base + t), p });
  }
  return v;
}
// Modèle : durée mesurée = dernier échantillon posé − premier échantillon posé ; LONG si ≥ 650, SHORT si ≥ 20, sinon rien.
static PodGesture model(const std::vector<Sample>& s, uint32_t* at = nullptr) {
  bool any = false; uint32_t first = 0, last = 0;
  for (const Sample& x : s) if (x.pressed) { if (!any) { any = true; first = x.t; } last = x.t; }
  if (!any) return PG_NONE;
  const uint32_t d = (uint32_t)(last - first);
  if (d >= 650u) { if (at) { for (const Sample& x : s) if (x.pressed && (uint32_t)(x.t - first) >= 650u) { *at = x.t; break; } } return PG_LONG; }   // constantes de la SPÉCIFICATION, indépendantes de l'en-tête testé
  return d >= 20u ? PG_SHORT : PG_NONE;
}

int main() {
  CHECK(POD_TOUCH_LONG_MS == 650u && POD_TOUCH_MIN_MS == 20u && POD_TOUCH_RELEASE_STABLE_MS == 30u && POD_TOUCH_POLL_MS == 20u, "constantes de la spécification : 650 / 20 / 30 / 20 ms");
  const uint32_t periods[] = { 5, 10, 20, 25, 33, 50 };
  const uint32_t bases[] = { 0, 1000, 0xFFFFFFFFu - 300u, 0xFFFFFFFFu - 1u, 0xFFFFFFF0u };      // dont le dépassement de millis() en plein contact
  // P1 : contact simple, toutes durées 0..2500 ms, plusieurs phases : UNE action au plus, égale au modèle ; un appui long agit pendant le contact, jamais au relâchement
  for (uint32_t base : bases) for (uint32_t period : periods) for (uint32_t start : { 0u, 3u, 17u }) for (uint32_t dur = 0; dur <= 2500; dur += 1) {
    const auto s = contact(base, period, start, dur, 200);
    const Out o = run(s); uint32_t at = 0; const PodGesture m = model(s, &at);
    if (o.actions > 1 || o.first != m) { CHECK(false, "contact simple base=" + std::to_string(base) + " période=" + std::to_string(period) + " début=" + std::to_string(start) + " durée=" + std::to_string(dur) + " : " + std::to_string(o.actions) + " action(s), première=" + std::to_string(o.first) + " attendu=" + std::to_string(m)); break; }
    if (m == PG_LONG) { if (o.firstAt != at) { CHECK(false, "l'appui long doit agir DÈS le seuil (pendant le contact), durée=" + std::to_string(dur)); break; } }
  }
  CHECK(true, "P1 contact simple balayé");
  // P2 : seuil EXACT, échantillonnage à 1 ms
  { std::vector<Sample> a = { { 0, true }, { 649, true }, { 700, false }, { 740, false } }; Out o = run(a); CHECK(o.actions == 1 && o.first == PG_SHORT, "649 ms entre le premier et le dernier échantillon posé : COURT"); }
  { std::vector<Sample> a = { { 0, true }, { 650, true }, { 700, false }, { 740, false } }; Out o = run(a); CHECK(o.actions == 1 && o.first == PG_LONG && o.firstAt == 650, "650 ms : LONG, déclenché à 650 ms (contact encore posé)"); }
  { std::vector<Sample> a = { { 0, true }, { 650, true }, { 800, true }, { 1500, true }, { 1600, false }, { 1700, false } }; Out o = run(a); CHECK(o.actions == 1 && o.first == PG_LONG, "appui long maintenu 1,5 s : UNE action, le relâchement ne produit RIEN"); }
  // P3 : rebond (relâchement < 30 ms) : le MÊME contact ; relâchement ≥ 60 ms : DEUX contacts
  for (uint32_t base : bases) for (uint32_t period : { 5u, 10u, 20u }) {
    { auto s = contact(base, period, 0, 300, 200, { { 100, 100 + 20 } }); Out o = run(s); CHECK(o.actions == 1 && o.first == PG_SHORT, "rebond de 20 ms : un seul COURT (période " + std::to_string(period) + ")"); }
    { auto s = contact(base, period, 0, 300, 200, { { 100, 100 + 15 }, { 200, 200 + 15 } }); Out o = run(s); CHECK(o.actions == 1 && o.first == PG_SHORT, "deux rebonds : un seul COURT"); }
    { auto s = contact(base, period, 0, 400, 300, { { 150, 150 + 100 } }); Out o = run(s); CHECK(o.actions == 2 && o.first == PG_SHORT && o.second == PG_SHORT, "relâchement de 100 ms : DEUX appuis courts (période " + std::to_string(period) + ")"); }
  }
  // P4 : bruit — un seul échantillon posé, ou 10 ms : aucune action
  for (uint32_t period : periods) { auto s = contact(0, period, 0, 1, 200); Out o = run(s); CHECK(o.actions == 0, "parasite d'un échantillon : AUCUNE action (période " + std::to_string(period) + ")"); }
  { std::vector<Sample> a = { { 0, true }, { 5, false }, { 40, false }, { 80, false } }; CHECK(run(a).actions == 0, "contact de 0 ms : rien"); }
  // P5 : après un appui long puis relâchement, un nouveau contact fonctionne (état remis à zéro)
  { auto a = contact(0, 20, 0, 900, 100); auto b = contact(2000, 20, 0, 120, 200); a.insert(a.end(), b.begin(), b.end()); Out o = run(a); CHECK(o.actions == 2 && o.first == PG_LONG && o.second == PG_SHORT, "long puis, après relâchement, un court : deux actions distinctes"); }
  // P6 : jamais rien sans contact
  { std::vector<Sample> a; for (uint32_t t = 0; t < 5000; t += 20) a.push_back({ t, false }); CHECK(run(a).actions == 0, "aucun contact : aucune action"); }
  // P7 : table des actions (12 combinaisons)
  CHECK(podTouchAction(PG_NONE, false, false) == PTA_NONE && podTouchAction(PG_NONE, true, true) == PTA_NONE, "aucun geste : aucune action");
  CHECK(podTouchAction(PG_SHORT, false, false) == PTA_TOGGLE_STATIC && podTouchAction(PG_LONG, false, false) == PTA_TOGGLE_STATIC, "image fixe : court ET long = UNE bascule du cartel");
  CHECK(podTouchAction(PG_SHORT, true, false) == PTA_TOGGLE_PLAYING && podTouchAction(PG_LONG, true, false) == PTA_PAUSE, "lecture : court = cartel sur place, long = pause");
  CHECK(podTouchAction(PG_SHORT, true, true) == PTA_TOGGLE_PAUSED && podTouchAction(PG_LONG, true, true) == PTA_RESUME, "pause : court = cartel sans reprendre, long = reprise");
  CHECK(podTouchAction(PG_SHORT, false, true) == PTA_TOGGLE_STATIC, "pause sans animation (état incohérent) : traité comme image fixe");
  // P8 : taille de l'état et absence de dépendances
  CHECK(sizeof(PodTouchClassifier) <= 16 && sizeof(PodTouchLatch) <= 8, "états <= 16 et <= 8 octets");
  // P9 (FIX1) : frontière EXACTE du relâchement stable de 30 ms — classificateur : 29 ms ne suffisent pas, 30 ms oui
  for (uint32_t base : bases) {
    { std::vector<Sample> a = { { base + 0, true }, { base + 100, true }, { base + 129, false } }; CHECK(run(a).actions == 0, "classificateur : relâché depuis 29 ms : rien encore"); }
    { std::vector<Sample> a = { { base + 0, true }, { base + 100, true }, { base + 130, false } }; Out o = run(a); CHECK(o.actions == 1 && o.first == PG_SHORT, "classificateur : relâché depuis 30 ms : COURT"); }
    { std::vector<Sample> a = { { base + 0, true }, { base + 100, true }, { base + 129, false }, { base + 131, true }, { base + 300, true }, { base + 400, false }, { base + 440, false } }; Out o = run(a); CHECK(o.actions == 1 && o.first == PG_SHORT, "classificateur : relâchement de 29 ms puis reprise : MÊME contact, un seul court"); }
  }
  // P10 (FIX1) : verrou de relâchement après un appui long — frontière 29 / 30 ms, rebonds, dépassement de millis()
  auto lat = [&](uint32_t base, const std::vector<Sample>& s) { PodTouchLatch l; podTouchLatchArm(l); std::vector<int> blocked; for (const Sample& x : s) blocked.push_back(podTouchLatchBlocked(l, x.pressed, (uint32_t)(base + x.t)) ? 1 : 0); return blocked; };
  for (uint32_t base : bases) {
    { auto b = lat(base, { { 0, true }, { 40, true }, { 80, false }, { 109, false } }); CHECK(b == std::vector<int>({ 1, 1, 1, 1 }), "verrou : 29 ms de relâchement INSUFFISANTS (toujours retenu)"); }
    { auto b = lat(base, { { 0, true }, { 40, true }, { 80, false }, { 110, false } }); CHECK(b == std::vector<int>({ 1, 1, 1, 0 }), "verrou : 30 ms de relâchement ACCEPTÉS (levé sur l'échantillon qui complète)"); }
    { auto b = lat(base, { { 0, true }, { 40, false }, { 60, true }, { 100, false }, { 129, false } }); CHECK(b == std::vector<int>({ 1, 1, 1, 1, 1 }), "verrou : un rebond (relâché puis reposé) remet la série à zéro"); }
    { auto b = lat(base, { { 0, true }, { 40, false }, { 60, true }, { 100, false }, { 130, false } }); CHECK(b == std::vector<int>({ 1, 1, 1, 1, 0 }), "verrou : 30 ms comptés depuis le dernier premier relâchement"); }
    { auto b = lat(base, { { 0, false }, { 5, false } }); CHECK(b == std::vector<int>({ 1, 1 }), "verrou : relâché depuis le début mais < 30 ms : retenu"); }
    { PodTouchLatch l; CHECK(!podTouchLatchBlocked(l = PodTouchLatch{ 0, false, false }, true, base) , "verrou désarmé : ne retient rien"); }
    // un doigt maintenu des heures ne lève JAMAIS le verrou
    { PodTouchLatch l; podTouchLatchArm(l); bool any = false; for (uint32_t t = 0; t < 100000; t += 20) if (!podTouchLatchBlocked(l, true, (uint32_t)(base + t))) any = true; CHECK(!any, "verrou : doigt maintenu = jamais levé"); }
    // lever ET ne plus jamais retenir ensuite
    { PodTouchLatch l; podTouchLatchArm(l); (void)podTouchLatchBlocked(l, false, base); (void)podTouchLatchBlocked(l, false, base + 40); CHECK(!podTouchLatchBlocked(l, true, base + 50), "verrou levé : un nouveau contact n'est plus retenu"); }
  }

  if (!g_fail.empty()) { for (auto& f : g_fail) std::printf("ECART : %s\n", f.c_str()); return 1; }
  std::printf("PASS %d\n", g_checks);
  return 0;
}
