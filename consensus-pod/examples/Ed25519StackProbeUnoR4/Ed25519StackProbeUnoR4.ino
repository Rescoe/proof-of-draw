// Ed25519StackProbeUnoR4 — MICRO-CANARI du correctif de pile Ed25519 (lot 8B-2B-2-STACK-FIX1).   ⚠ NE PAS DÉPLOYER.   ⚠ COMPILÉ seulement : JAMAIS essayé sur la carte.
// UNO R4 WiFi seul : ni écran, ni Wi-Fi, ni réseau, ni EEPROM, ni secrets.h, ni identité de l'appareil. Aucune clé réelle : le vecteur 1 de la RFC 8032 (clé de test PUBLIQUE) est la seule clé utilisée.
// Rôle : prouver, sur la carte, que podEdStack.h exécute dérivation / signature / vérification Ed25519 SUR LA PILE DÉDIÉE, sans toucher la pile principale de 1 024 o ni le haut du tas, avec des octets identiques à la RFC.
//   • Compiler : arduino-cli compile --fqbn arduino:renesas_uno:unor4wifi --library consensus-pod consensus-pod/examples/Ed25519StackProbeUnoR4   (bibliothèque « Crypto » 0.4.0 installée ; aucun cœur modifié)
//   • Moniteur série 115200 : toutes les lignes commencent par [PROBE] ; la dernière dit « RÉSULTAT : OK » ou « RÉSULTAT : ÉCHEC » et pourquoi. Procédure et critères d'arrêt : docs/LOT_8B2B2_PILE_ED25519_R4_2026_10_08.md § 8.
#include <Arduino.h>
#include <malloc.h>
#include "consensusPoD.h"            // en premier : résout la bibliothèque ConsensusPoD (dossier src) pour l'include relatif suivant
#include "adapters/podEdStack.h"

extern "C" char* sbrk(int incr);
extern char __StackLimit, __StackTop, __HeapLimit;   // symboles du script d'édition de liens du cœur R4 (__HeapLimit == __StackLimit)

// RFC 8032 § 7.1, TEST 1 (message vide) — clé de test PUBLIQUE
static const uint8_t K_SEED[32] = { 0x9d, 0x61, 0xb1, 0x9d, 0xef, 0xfd, 0x5a, 0x60, 0xba, 0x84, 0x4a, 0xf4, 0x92, 0xec, 0x2c, 0xc4, 0x44, 0x49, 0xc5, 0x69, 0x7b, 0x32, 0x69, 0x19, 0x70, 0x3b, 0xac, 0x03, 0x1c, 0xae, 0x7f, 0x60 };
static const uint8_t K_PUB[32]  = { 0xd7, 0x5a, 0x98, 0x01, 0x82, 0xb1, 0x0a, 0xb7, 0xd5, 0x4b, 0xfe, 0xd3, 0xc9, 0x64, 0x07, 0x3a, 0x0e, 0xe1, 0x72, 0xf3, 0xda, 0xa6, 0x23, 0x25, 0xaf, 0x02, 0x1a, 0x68, 0xf7, 0x07, 0x51, 0x1a };
static const uint8_t K_SIG[64]  = { 0xe5, 0x56, 0x43, 0x00, 0xc3, 0x60, 0xac, 0x72, 0x90, 0x86, 0xe2, 0xcc, 0x80, 0x6e, 0x82, 0x8a, 0x84, 0x87, 0x7f, 0x1e, 0xb8, 0xe5, 0xd9, 0x74, 0xd8, 0x73, 0xe0, 0x65, 0x22, 0x49, 0x01, 0x55,
                                    0x5f, 0xb8, 0x82, 0x15, 0x90, 0xa3, 0x3b, 0xac, 0xc6, 0x1e, 0x39, 0x70, 0x1c, 0xf9, 0xb4, 0x6b, 0xd2, 0x5b, 0xf5, 0xf0, 0x59, 0x5b, 0xbe, 0x24, 0x65, 0x51, 0x41, 0x43, 0x8e, 0x7a, 0x10, 0x0b };

static const uint8_t PAINT_MAIN = 0x5A, PAINT_HEAPTOP = 0xA7;
static const uint32_t HEAPTOP_BYTES = 1024;            // 1 Ko sous __StackLimit (haut du tas) : c'est là que le débordement de pile ÉCRIVAIT (≈ 700 o au démarrage du canari du 08/10/2026)
static const uint32_t MAIN_SAFETY = 160;               // octets sous SP laissés hors de la peinture (cadres de setup() et de ses appels)

static void line(const char* s) { Serial.print(F("[PROBE] ")); Serial.println(s); }
static unsigned long heapFree() { struct mallinfo mi = mallinfo(); return (unsigned long)mi.fordblks + (unsigned long)((char*)&__HeapLimit - (char*)sbrk(0)); }

// peint la pile principale (de __StackLimit jusqu'à SP - MAIN_SAFETY) et le haut du tas
static void paint() {
  volatile uint8_t* lo = (volatile uint8_t*)&__StackLimit;
  volatile uint8_t* hi = (volatile uint8_t*)__builtin_frame_address(0) - MAIN_SAFETY;
  for (volatile uint8_t* p = lo; p < hi; p++) *p = PAINT_MAIN;
  for (volatile uint8_t* p = lo - HEAPTOP_BYTES; p < lo; p++) *p = PAINT_HEAPTOP;
}
// octets INTACTS depuis le bas de la pile principale, et nombre d'octets écrasés dans le haut du tas
static uint32_t mainUntouched() { volatile uint8_t* p = (volatile uint8_t*)&__StackLimit; uint32_t n = 0; while (p + n < (volatile uint8_t*)__builtin_frame_address(0) - MAIN_SAFETY && p[n] == PAINT_MAIN) n++; return n; }
static uint32_t heapTopSmashed() { volatile uint8_t* lo = (volatile uint8_t*)&__StackLimit - HEAPTOP_BYTES; uint32_t bad = 0; for (uint32_t i = 0; i < HEAPTOP_BYTES; i++) if (lo[i] != PAINT_HEAPTOP) bad++; return bad; }

static bool g_fail = false;
static void check(bool ok, const char* what) { if (!ok) { g_fail = true; Serial.print(F("[PROBE] ÉCHEC : ")); Serial.println(what); } }

static void report(const char* tag, const PodEdInfo& i) {
  Serial.print(F("[PROBE] ")); Serial.print(tag); Serial.print(F(" : pile dédiée utilisée ")); Serial.print(i.used); Serial.print(F(" o, marge ")); Serial.print(i.margin);
  Serial.print(F(" o, erreur ")); Serial.print(i.err); Serial.print(F(" | tas libre ")); Serial.println(heapFree());
}

void setup() {
  Serial.begin(115200);
  while (!Serial && millis() < 3000) {}
  line("===== MICRO-CANARI Ed25519 / pile dédiée — NE PAS DÉPLOYER — compilé seulement, jamais essayé sur la carte =====");
  Serial.print(F("[PROBE] pile principale [0x")); Serial.print((unsigned long)&__StackLimit, HEX); Serial.print(F(", 0x")); Serial.print((unsigned long)&__StackTop, HEX);
  Serial.print(F("] SP=0x")); Serial.print((unsigned long)__builtin_frame_address(0), HEX); Serial.print(F(" ; pile dédiée ")); Serial.print((unsigned)POD_ED_STACK_TOTAL);
  Serial.print(F(" o (garde ")); Serial.print((unsigned)POD_ED_GUARD_BYTES); Serial.print(F(" o, marge minimale ")); Serial.print((unsigned)POD_ED_MARGIN_MIN); Serial.println(F(" o)"));
  Serial.print(F("[PROBE] SPMON de MSP (R_MPU_SPMON->SP[0].CTL) = ")); Serial.print((unsigned)R_MPU_SPMON->SP[0].CTL); Serial.println(F(" (attendu 0 : protection de pile désactivée par arduino_main(), sinon SP hors plage déclencherait un NMI)"));
  check(R_MPU_SPMON->SP[0].CTL == 0, "SPMON actif : le déplacement de SP sur la pile dédiée déclencherait un NMI");
  Serial.print(F("[PROBE] tas libre au départ : ")); Serial.println(heapFree());
  paint();

  PodEdInfo info; uint8_t pub[32], sig[64];
  // 1) dérivation
  memset(&info, 0, sizeof(info));
  check(PodEd::derivePublicKey(pub, K_SEED, &info), "derivePublicKey a échoué");  report("derivePublicKey", info);
  check(memcmp(pub, K_PUB, 32) == 0, "clé publique != RFC 8032 test 1");
  // 2) signature
  memset(&info, 0, sizeof(info));
  check(PodEd::sign(sig, K_SEED, K_PUB, "", 0, &info), "sign a échoué");  report("sign", info);
  check(memcmp(sig, K_SIG, 64) == 0, "signature != RFC 8032 test 1 (octet par octet)");
  // 3) vérification : vraie, puis falsifiée (message, signature, clé)
  memset(&info, 0, sizeof(info));
  check(PodEd::verify(K_SIG, K_PUB, "", 0, &info), "verify a rejeté la signature RFC");  report("verify", info);
  check(!PodEd::verify(K_SIG, K_PUB, "x", 1, &info) && info.err == POD_ED_OK, "verify a accepté un message falsifié");
  { uint8_t bad[64]; memcpy(bad, K_SIG, 64); bad[10] ^= 1; check(!PodEd::verify(bad, K_PUB, "", 0, &info) && info.err == POD_ED_OK, "verify a accepté une signature falsifiée"); }
  { uint8_t pk[32]; memcpy(pk, K_PUB, 32); pk[3] ^= 1; check(!PodEd::verify(K_SIG, pk, "", 0, &info) && info.err == POD_ED_OK, "verify a accepté une clé publique falsifiée"); }
  // 4) quatre cycles consécutifs : mêmes octets, tas stable
  const unsigned long heap0 = heapFree();
  uint16_t worstUsed = 0, worstMargin = 0xFFFF;
  for (int c = 0; c < 4; c++) {
    PodEdInfo a, b;
    const bool s = PodEd::sign(sig, K_SEED, K_PUB, "", 0, &a);
    const bool v = PodEd::verify(sig, K_PUB, "", 0, &b);
    check(s && v && memcmp(sig, K_SIG, 64) == 0, "cycle sign+verify incohérent");
    if (a.used > worstUsed) worstUsed = a.used;
    if (b.used > worstUsed) worstUsed = b.used;
    if (a.margin < worstMargin) worstMargin = a.margin;
    if (b.margin < worstMargin) worstMargin = b.margin;
    Serial.print(F("[PROBE] cycle ")); Serial.print(c + 1); Serial.print(F(" : sign ")); Serial.print(a.used); Serial.print('/'); Serial.print(a.margin); Serial.print(F(", verify ")); Serial.print(b.used); Serial.print('/'); Serial.print(b.margin);
    Serial.print(F(" | tas libre ")); Serial.println(heapFree());
  }
  check(heapFree() == heap0, "le tas a dérivé après 4 cycles");
  Serial.print(F("[PROBE] pire cas sur 4 cycles : pile dédiée utilisée ")); Serial.print(worstUsed); Serial.print(F(" o, marge minimale ")); Serial.print(worstMargin); Serial.println(F(" o (exigé >= 128, objectif >= 256)"));
  check(worstMargin >= 128, "marge de la pile dédiée < 128 o");
  // 5) la pile principale et le haut du tas n'ont PAS été touchés
  const uint32_t untouched = mainUntouched(), smashed = heapTopSmashed();
  const uint32_t mainSpan = (uint32_t)((char*)__builtin_frame_address(0) - MAIN_SAFETY - &__StackLimit);
  Serial.print(F("[PROBE] pile principale : ")); Serial.print(untouched); Serial.print(F(" o intacts depuis le bas (sur ")); Serial.print(mainSpan); Serial.print(F(" o peints ; les interruptions peuvent en consommer quelques centaines) ; haut du tas : ")); Serial.print(smashed); Serial.println(F(" o écrasés sous __StackLimit (attendu 0)"));
  check(untouched >= 128, "marge de la pile principale < 128 o");
  check(smashed == 0, "écriture SOUS __StackLimit (haut du tas)");
  line(g_fail ? "RÉSULTAT : ÉCHEC — ne pas poursuivre ; reflasher le firmware stable" : "RÉSULTAT : OK — Ed25519 sur pile dédiée, pile principale et haut du tas intacts, octets identiques à la RFC 8032");
}

void loop() { delay(2000); line(g_fail ? "terminé : ÉCHEC" : "terminé : OK"); }
