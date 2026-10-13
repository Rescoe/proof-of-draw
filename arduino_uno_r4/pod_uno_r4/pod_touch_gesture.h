// pod_touch_gesture.h — LOT8B2E-ANIM-TOUCH-GESTURES-1 : appui COURT / appui LONG sur le TFT 2,8″ tactile (STMPE610), classificateur PUR sans allocation.
//
// Un contact donne exactement UNE action :
//   - relâché avant POD_TOUCH_LONG_MS (650 ms)                      -> PG_SHORT (au relâchement stable) ;
//   - maintenu au moins POD_TOUCH_LONG_MS                           -> PG_LONG (dès que le seuil est atteint, contact encore posé) ; le relâchement qui suit ne produit RIEN ;
//   - contact plus court que POD_TOUCH_MIN_MS, ou rebond du capteur -> PG_NONE (bruit).
// Anti-rebond : un relâchement n'est pris en compte que s'il dure au moins POD_TOUCH_RELEASE_STABLE_MS ; un nouvel appui plus tôt prolonge le MÊME contact.
// Aucune dépendance Arduino, aucun String, aucune allocation, aucun état global : l'état tient dans PodTouchClassifier (12 o, posé par l'appelant, p. ex. sur la pile).
// Le temps est lu par l'appelant (millis()) ; l'arithmétique est non signée sur 32 bits (le dépassement de millis() est sans effet).
// Testé sur l'hôte (tests/touchGesture.test.ts) : seuils exacts, une seule action par contact, rebonds, cadences d'interrogation de 5 à 50 ms, dépassement de millis().
#ifndef POD_TOUCH_GESTURE_H
#define POD_TOUCH_GESTURE_H

#include <stdint.h>

#define POD_TOUCH_LONG_MS            650u    // appui long : maintenu au moins 650 ms
#define POD_TOUCH_MIN_MS             20u     // contact plus court : bruit, ignoré
#define POD_TOUCH_RELEASE_STABLE_MS  30u     // un relâchement doit durer au moins 30 ms (rebond du capteur)
#define POD_TOUCH_POLL_MS            20u     // cadence d'interrogation recommandée (lecture d'un registre du STMPE610)

enum PodGesture : uint8_t { PG_NONE = 0, PG_SHORT = 1, PG_LONG = 2 };

struct PodTouchClassifier {
  uint32_t downAt;      // instant du premier échantillon « posé » du contact
  uint32_t lastSeen;    // instant du dernier échantillon « posé »
  bool down;            // un contact est en cours
  bool fired;           // l'appui long a déjà produit son action : le relâchement ne produit rien
};

inline void podTouchReset(PodTouchClassifier& c) { c.downAt = 0; c.lastSeen = 0; c.down = false; c.fired = false; }

/** Un échantillon : `pressed` = le capteur voit un contact à l'instant `now` (ms). Retourne l'action à exécuter MAINTENANT (au plus une par contact). */
inline PodGesture podTouchStep(PodTouchClassifier& c, bool pressed, uint32_t now) {
  if (pressed) {
    if (!c.down) { c.down = true; c.downAt = now; c.lastSeen = now; c.fired = false; return PG_NONE; }
    c.lastSeen = now;
    if (!c.fired && (uint32_t)(now - c.downAt) >= POD_TOUCH_LONG_MS) { c.fired = true; return PG_LONG; }
    return PG_NONE;
  }
  if (!c.down) return PG_NONE;
  if ((uint32_t)(now - c.lastSeen) < POD_TOUCH_RELEASE_STABLE_MS) return PG_NONE;   // rebond : on attend un relâchement stable
  c.down = false;
  if (c.fired) return PG_NONE;                                                       // l'appui long a déjà agi : jamais de second geste
  const uint32_t dur = (uint32_t)(c.lastSeen - c.downAt);
  return dur >= POD_TOUCH_MIN_MS ? PG_SHORT : PG_NONE;
}

/** VERROU DE RELÂCHEMENT après un appui long : tant que le doigt reste posé, ou que son relâchement n'est pas STABLE, aucun nouveau geste n'est pris en compte (jamais d'appui court fantôme).
 *  « Stable » = deux échantillons « relâché » consécutifs séparés d'au moins POD_TOUCH_RELEASE_STABLE_MS, sans échantillon « posé » entre eux (29 ms : insuffisant, 30 ms : accepté). 8 o ; arithmétique uint32_t (dépassement de millis() sans effet). */
struct PodTouchLatch {
  uint32_t relAt;       // instant du PREMIER échantillon « relâché » de la série en cours
  bool on;              // verrou armé
  bool rel;             // une série de relâchements est en cours
};
inline void podTouchLatchArm(PodTouchLatch& l) { l.on = true; l.rel = false; l.relAt = 0; }
/** Un échantillon : retourne true tant que le verrou RETIENT les gestes (y compris cet échantillon) ; le verrou se lève sur l'échantillon qui complète un relâchement stable. */
inline bool podTouchLatchBlocked(PodTouchLatch& l, bool pressed, uint32_t now) {
  if (!l.on) return false;
  if (pressed) { l.rel = false; return true; }                                       // doigt posé (ou rebond) : la série de relâchements recommence
  if (!l.rel) { l.rel = true; l.relAt = now; return true; }                          // premier échantillon relâché
  if ((uint32_t)(now - l.relAt) >= POD_TOUCH_RELEASE_STABLE_MS) { l.on = false; return false; }
  return true;
}

/** Ce que fait chaque geste, selon l'état de l'animation. */
enum PodTouchAction : uint8_t {
  PTA_NONE = 0,
  PTA_TOGGLE_STATIC,      // image fixe (pas d'animation) : affiche / masque le cartel (court ou long : UNE seule bascule)
  PTA_TOGGLE_PLAYING,     // animation en lecture, appui court : affiche / masque le cartel, la lecture CONTINUE
  PTA_PAUSE,              // animation en lecture, appui long : pause sur l'affiche fixe, cartel affiché
  PTA_TOGGLE_PAUSED,      // animation en pause, appui court : affiche / masque le cartel SANS reprendre
  PTA_RESUME              // animation en pause, appui long : reprise, cartel masqué
};
inline PodTouchAction podTouchAction(PodGesture g, bool animOn, bool animPaused) {
  if (g == PG_NONE) return PTA_NONE;
  if (!animOn) return PTA_TOGGLE_STATIC;
  if (animPaused) return g == PG_LONG ? PTA_RESUME : PTA_TOGGLE_PAUSED;
  return g == PG_LONG ? PTA_PAUSE : PTA_TOGGLE_PLAYING;
}

#endif  // POD_TOUCH_GESTURE_H
