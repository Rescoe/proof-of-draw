// pod_ota_keys_test.h — CLÉS PUBLIQUES DE TEST (OTA-4A, 15/10/2026). NE SONT PAS DES CLÉS DE PUBLICATION.
// Les moitiés privées ont été DÉTRUITES à la génération (jamais écrites sur disque) : un firmware compilé avec POD_OTA=1 SANS pod_ota_keys.h ne peut donc accepter AUCUNE image (échec fermé).
// Les vraies clés publiques vont dans pod_ota_keys.h (ignoré par git, généré hors ligne). Créneaux : A = active (ota-a), B = secours (ota-b). RSA-2048, SPKI PEM, en flash (PROGMEM).
#pragma once
#include <pgmspace.h>
#define POD_OTA_KEYS_ARE_TEST 1
static const char POD_OTA_KEY_A_PEM[] PROGMEM =
  "-----BEGIN PUBLIC KEY-----\n"
  "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA0WANHScT3S5lOJCThyK9\n"
  "yyqzF0LjZ+8Y2XOdWK1aWH7NvdbDOBnxKcBwhcwAI6N6UXu0Oxp5a1ZUtf8/dcg6\n"
  "bpDlye5dJnAPt1p6fMFYTNx7KPscIQLWyYXJe8PAhT5DQGaLmjQHAXl1er8AZXEK\n"
  "SAlqX5CGg7EGXfoOAC9WYYCF7pHerW+oOZwqfEHgUHsjQSaDtL5ZsQUrtEpLO5Tz\n"
  "TR5LBrHYDrD6Tn8Erd/oUNsqdbesHqojrsCu1OPYvVVuUAQIv3PGPtHsbl3jScHr\n"
  "zADXYKZGzByYh8N96HhZ13KVbIAMJ82gtTC64lb3oYASDrZZK74p6EQE0dcO3C2J\n"
  "mQIDAQAB\n"
  "-----END PUBLIC KEY-----\n";
static const char POD_OTA_KEY_B_PEM[] PROGMEM =
  "-----BEGIN PUBLIC KEY-----\n"
  "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA2oUae41eOG44+3MIcpDr\n"
  "Vqq4iqMFtVeEWNl1mM1bJZdPhFvBNLApy66Ys94LyjFzSCa2PiAYKBwgOMwYkpe1\n"
  "APwdtlpf1SubdwqDP9fljNr7spTMXRZMnAYx5n/0R/GWM0PgFJB/3c8Ys1ywGldO\n"
  "Du2gy+20HoGccFqCB1gIni4BmCAufYGBinzn+RRMdjw4SObdMYZaSctcG1a0qh9L\n"
  "cON9Qq9ygdM6yn78350yqM8iIerimHPbiUXGcWodX6tu4w7VMBEaEPHdwNZdB9Qt\n"
  "oeBxIq9t6Gmy1KrXeZWUC08IaV4yISPzXcVUz5dei8JyvwHMAyNa++ld3btl+LPR\n"
  "oQIDAQAB\n"
  "-----END PUBLIC KEY-----\n";
