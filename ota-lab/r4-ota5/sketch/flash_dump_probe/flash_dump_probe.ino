// flash_dump_probe.ino — SONDE STRICTEMENT EN LECTURE SEULE de la data flash (8 192 o) d'une UNO R4 WiFi (30/10/2026).
// N'écrit, n'efface et ne programme JAMAIS la data flash : seulement EEPROM.read() (lecture mappée). Aucun Wi-Fi, aucun réseau, aucune clé affichée en clair par ce programme au-delà du vidage hexadécimal
// qui est écrit sur le port série de l'ordinateur branché : le fichier produit CONTIENT la clé privée de l'appareil -> à garder HORS de Git, hors conversation.
// Format (115 200 bauds), répété toutes les 20 s tant que la carte est alimentée :
//   FD BEGIN 8192
//   FD <adresse hex 4> <64 hex = 32 octets> <crc32 hex 8 des 32 octets>      (256 lignes)
//   FD END
// Décodage et vérification : ota-lab/r4-ota5/tools/flash-dump-decode.mjs. Le téléversement de cette sonde remplace le PROGRAMME (flash de code) de la carte mais jamais la data flash.
#include <Arduino.h>
#include <EEPROM.h>

static uint32_t crc32(const uint8_t* d, size_t n) {
  uint32_t c = 0xFFFFFFFFu;
  for (size_t i = 0; i < n; i++) { c ^= d[i]; for (int k = 0; k < 8; k++) c = (c >> 1) ^ (0xEDB88320u & (uint32_t)(-(int32_t)(c & 1u))); }
  return ~c;
}

static void dumpOnce() {
  static const char H[] = "0123456789abcdef";
  uint8_t row[32]; char hex[65], line[96];
  Serial.println("FD BEGIN 8192");
  for (int a = 0; a < 8192; a += 32) {
    for (int i = 0; i < 32; i++) row[i] = (uint8_t)EEPROM.read(a + i);
    for (int i = 0; i < 32; i++) { hex[2 * i] = H[row[i] >> 4]; hex[2 * i + 1] = H[row[i] & 15]; }
    hex[64] = 0;
    snprintf(line, sizeof line, "FD %04x %s %08lx", a, hex, (unsigned long)crc32(row, 32));
    Serial.println(line);
    delay(3);                                           // laisse le tampon USB se vider
  }
  Serial.println("FD END");
}

void setup() {
  Serial.begin(115200);
  while (!Serial && millis() < 4000) {}
  delay(500);
  Serial.println("FLASH-DUMP-PROBE 1 : lecture seule de la data flash (aucune ecriture)");
}

void loop() {
  dumpOnce();
  delay(20000);
}
