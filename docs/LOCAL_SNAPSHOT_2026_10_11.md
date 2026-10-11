# Instantané du travail local — 11 octobre 2026

Cet instantané conserve les fichiers locaux qui n'étaient pas encore suivis par Git avant la remise à niveau du checkout `main`.

## Canari R4 e-ink 2,9 pouces

Le fichier `arduino_uno_r4/pod_uno_r4_eink29/pod_uno_r4_eink29.ino` avait localement les deux options suivantes activées pour les essais matériels :

- `POD_RENDER_V1 = 1` ;
- `POD_CANARY = 1`.

Ces deux changements volontaires de compilation n'ont pas été commités : le dépôt doit conserver les valeurs sûres `0/0`. Ils peuvent être réappliqués localement pour reproduire le canari.

## Sonde Ed25519 UNO R4

Le dossier `consensus-pod/examples/Ed25519StackProbeUnoR4/` contient les copies locales nécessaires à l'ouverture et à la compilation autonome de la sonde depuis l'IDE Arduino. Le fichier `secrets.h` réel est volontairement exclu de Git et de cet instantané.

## Notes et journal conservés

Les notes de recherche, d'audit, d'internationalisation et le journal matériel non suivis au moment de l'instantané sont conservés sur cette branche d'archive. Leur intégration éventuelle dans `main` devra faire l'objet d'un tri ou d'un cherry-pick explicite.
