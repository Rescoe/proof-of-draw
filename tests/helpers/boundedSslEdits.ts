// tests/helpers/boundedSslEdits.ts — PULLFRAME-BOUNDED-SSL-FIX1 : les modifications EXACTES du sketch UNO R4 e-ink 2,9″ (quatre fragments), et leur annulation.
// Les tests « le sketch d'avant au texte près » des lots précédents annulent ces fragments en premier : ils continuent ainsi de prouver que le reste n'a pas bougé.
export const BOUNDED_SSL_BACKUP = "firmware-backups/2026-10-11_avant-pullframe-bounded-ssl-fix1/pod_uno_r4_eink29.ino";

export const BOUNDED_SSL_EDITS: { id: string; neu: string; old: string }[] = [
  {
    id: "include",
    neu: '#include "pod_http.h"\n#include "pod_ssl_bounded.h"   // PULLFRAME-BOUNDED-SSL-FIX1 : client TLS dont la commande AT _SSLCLIENTRECEIVE est BORNÉE (240 o) — docs/LOT_8B2B2_PULLFRAME_BOUNDED_SSL_FIX1_2026_10_11.md\n',
    old: '#include "pod_http.h"\n',
  },
  {
    id: "define",
    neu: "// ─── HTTP (WiFiSSLClient + pod_http.h) ─────────────────────────────────────\n// PULLFRAME-BOUNDED-SSL-FIX1 : à partir d'ici le nom WiFiSSLClient désigne PodBoundedSSL (pod_ssl_bounded.h, dérivé du vrai WiFiSSLClient, réception modem bornée) ; le canari le redirige ensuite vers son client espion (dérivé de PodBoundedSSL).\n#define WiFiSSLClient PodBoundedSSL\n",
    old: "// ─── HTTP (WiFiSSLClient + pod_http.h) ─────────────────────────────────────\n",
  },
  { id: "undef", neu: "#undef WiFiSSLClient\n#define WiFiSSLClient FfSSL\n", old: "#define WiFiSSLClient FfSSL\n" },
  {
    id: "fault",
    neu: "      got = (b == BUF_SIZE && r == BUF_SIZE && c.client.fault() == 0);   // défaut collant du client TLS borné : frame refusée (ni affichage, ni ACK)\n",
    old: "      got = (b == BUF_SIZE && r == BUF_SIZE);\n",
  },
];

/** Annule les quatre fragments (sans effet sur un sketch qui ne les porte pas). */
export function undoBoundedSsl(src: string): string {
  let out = src;
  for (const e of BOUNDED_SSL_EDITS) if (out.includes(e.neu)) out = out.replace(e.neu, e.old);
  return out;
}
