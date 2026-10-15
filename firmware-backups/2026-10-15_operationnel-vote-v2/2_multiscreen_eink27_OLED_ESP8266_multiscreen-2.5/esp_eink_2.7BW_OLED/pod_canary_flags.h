// pod_canary_flags.h — SOURCE UNIQUE des drapeaux POD_RENDER_V1 / POD_CANARY du firmware ESP8266 e-ink 2,7″ + OLED (LOT8B2C-27 FIX2).
// Pourquoi un fichier à part : le sketch (.ino) et le pilote (epd2in7_V2.cpp) sont deux unités de compilation. Un « #define POD_CANARY 1 » écrit dans le .ino est INVISIBLE du pilote
// (erreur d'édition de liens « undefined reference to g_pcBusyCalls »). Les deux fichiers incluent donc CET en-tête.
// Dépôt : 0 / 0 (ne JAMAIS commiter 1). Canari LOCAL (IDE Arduino) : passer les DEUX valeurs à 1 ici, dans la copie ignorée par git (canary-builds/), puis compiler.
// Un build en ligne de commande peut aussi les imposer par -DPOD_RENDER_V1=1 -DPOD_CANARY=1 (le #ifndef respecte alors le -D).
#ifndef POD_RENDER_V1
#define POD_RENDER_V1 0
#endif
#ifndef POD_CANARY
#define POD_CANARY 0
#endif
