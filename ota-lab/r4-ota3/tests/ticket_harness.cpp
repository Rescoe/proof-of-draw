// tests/ticket_harness.cpp — exerce ota3Ticket() (même fichier que la sonde) sur une table de cas ; chaque ligne imprime « nom code ».
#include <cstdio>
#include <cstring>
#include "ota3_ticket.h"

struct Case { const char* name; uint32_t size; int shaFlip; uint32_t sp, rst; bool verifyOk, dirty, expSet; uint32_t expSize; };

int main() {
  Ota3Expect e; e.set = true; e.size = 72800; for (int i = 0; i < 32; i++) e.sha[i] = (uint8_t)(i * 7 + 1);
  const Case cases[] = {
    {"ok",            72800, -1, 0x20007F00u, 0x0000A98Du, true,  false, true,  72800},
    {"noexpect",      72800, -1, 0x20007F00u, 0x0000A98Du, true,  false, false, 72800},
    {"dirty",         72800, -1, 0x20007F00u, 0x0000A98Du, true,  true,  true,  72800},
    {"noverify",      72800, -1, 0x20007F00u, 0x0000A98Du, false, false, true,  72800},
    {"zero",          0,     -1, 0x20007F00u, 0x0000A98Du, true,  false, true,  0},
    {"toobig",        0x3C001u, -1, 0x20007F00u, 0x0000A98Du, true, false, true, 0x3C001u},
    {"size-differs",  72801, -1, 0x20007F00u, 0x0000A98Du, true,  false, true,  72800},
    {"sha-differs",   72800, 5,  0x20007F00u, 0x0000A98Du, true,  false, true,  72800},
    {"sha-last-byte", 72800, 31, 0x20007F00u, 0x0000A98Du, true, false, true, 72800},
    {"short",         4,     -1, 0x20007F00u, 0x0000A98Du, true,  false, true,  4},
    {"sp-low",        72800, -1, 0x1FFFFFFCu, 0x0000A98Du, true,  false, true,  72800},
    {"sp-high",       72800, -1, 0x20008004u, 0x0000A98Du, true,  false, true,  72800},
    {"sp-edge-ok",    72800, -1, 0x20008000u, 0x0000A98Du, true,  false, true,  72800},
    {"reset-even",    72800, -1, 0x20007F00u, 0x0000A98Cu, true,  false, true,  72800},
    {"reset-boot",    72800, -1, 0x20007F00u, 0x00000101u, true,  false, true,  72800},
    {"reset-base",    72800, -1, 0x20007F00u, 0x00004001u + 0u, true, false, true, 72800},   // 0x4001 > base : accepté (bit Thumb, dans l'image)
    {"reset-base-eq", 72800, -1, 0x20007F00u, 0x00004000u, true,  false, true,  72800},   // pair + égal à la base : refusé
    {"reset-beyond",  72800, -1, 0x20007F00u, 0x00004000u + 72800u + 1u, true, false, true, 72800},   // juste après l'image
    {"reset-at-end", 72801, -1, 0x20007F00u, 0x00004000u + 72801u, true, false, true, 72801},   // taille impaire : base+taille est impair, juste APRES l image : refuse
    {"reset-last",    72800, -1, 0x20007F00u, 0x00004000u + 72800u - 1u, true, false, true, 72800},   // dernier octet de l'image (impair)
  };
  for (const Case& c : cases) {
    Ota3Expect ee = e; ee.set = c.expSet; ee.size = c.expSize;
    uint8_t sha[32]; memcpy(sha, e.sha, 32); if (c.shaFlip >= 0) sha[c.shaFlip] ^= 1;
    uint8_t head[8]; for (int i = 0; i < 4; i++) { head[i] = (uint8_t)(c.sp >> (8 * i)); head[4 + i] = (uint8_t)(c.rst >> (8 * i)); }
    std::printf("%s %d\n", c.name, (int)ota3Ticket(ee, c.size, sha, head, c.verifyOk, c.dirty));
  }
  // OTA3-AUTO1 : consommation du ticket
  {
    Ota3Expect ee = e; bool v = true; uint8_t head[8] = { 0x00, 0x7F, 0x00, 0x20, 0x8D, 0xA9, 0x00, 0x00 };
    ota3Consume(ee, v);
    std::printf("consumed-v %d\n", v ? 1 : 0);
    std::printf("consumed-expect %d\n", (int)ota3Ticket(ee, 72800, e.sha, head, true, false));
    Ota3Expect again = e; std::printf("consumed-reset-expect %d\n", (int)ota3Ticket(again, 72800, e.sha, head, v, false));
    std::printf("consumed-size %u\n", (unsigned)ee.size); std::printf("consumed-sha0 %d\n", (int)ee.sha[0] + (int)ee.sha[31]);
  }
  return 0;
}
