// VoteLockErase.ino — LOT8B2E V4 — OUTIL MANUEL, JAMAIS DÉPLOYÉ AVEC LE FIRMWARE : remet à zéro le verrou persistant du canari de vote (POD_VOTE_CANARY) du UNO R4 WiFi.
//
// Le verrou occupe deux blocs de 1 Ko de la flash de données (octets 5120 et 6144 de l'EEPROM). Le firmware ne l'efface JAMAIS ; seul cet outil le fait, et seulement si l'opérateur tape exactement
//   ERASE-VOTE-LOCK
// (puis Entrée) dans le moniteur série à 115200 bauds. Les clés de l'appareil (octets 0 à 96) et les autres données ne sont PAS touchées (autres blocs).
// À utiliser UNIQUEMENT avant un nouvel essai, après avoir relevé le journal du précédent. NE PAS DÉPLOYER, NE PAS LAISSER FLASHÉ.
#include <EEPROM.h>

static const uint32_t LOCK_A = 5120, LOCK_B = 6144;

static bool blank(uint32_t off) {
  for (uint32_t i = 0; i < 1024; i++) if (EEPROM.read((int)(off + i)) != 0xFF) return false;
  return true;
}

void setup() {
  Serial.begin(115200);
  while (!Serial && millis() < 3000) {}
  Serial.println(F("[VoteLockErase] verrou du canari de vote : bloc A (5120) et bloc B (6144)"));
  Serial.print(F("[VoteLockErase] etat : A ")); Serial.print(blank(LOCK_A) ? F("vierge") : F("NON vierge"));
  Serial.print(F(", B ")); Serial.println(blank(LOCK_B) ? F("vierge") : F("NON vierge"));
  Serial.println(F("[VoteLockErase] tapez ERASE-VOTE-LOCK puis Entree pour effacer ; toute autre saisie est ignoree"));
}

void loop() {
  static String line;
  while (Serial.available()) {
    const char c = (char)Serial.read();
    if (c == '\r') continue;
    if (c != '\n') { if (line.length() < 40) line += c; continue; }
    if (line == "ERASE-VOTE-LOCK") {
      const bool a = veeprom::getInstance().erase_block(LOCK_A), b = veeprom::getInstance().erase_block(LOCK_B);
      Serial.print(F("[VoteLockErase] effacement A=")); Serial.print(a ? F("ok") : F("ECHEC"));
      Serial.print(F(" B=")); Serial.print(b ? F("ok") : F("ECHEC"));
      Serial.print(F(" -> A ")); Serial.print(blank(LOCK_A) ? F("vierge") : F("NON vierge"));
      Serial.print(F(", B ")); Serial.println(blank(LOCK_B) ? F("vierge") : F("NON vierge"));
    } else if (line.length()) {
      Serial.println(F("[VoteLockErase] saisie ignoree (rien n'est efface)"));
    }
    line = "";
  }
}
