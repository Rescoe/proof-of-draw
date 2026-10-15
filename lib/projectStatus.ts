// lib/projectStatus.ts — SOURCE DE VÉRITÉ des faits publics courants de Proof-of-Draw (vérifiés le 15/10/2026, `main` à f6f648e).
//
// Pourquoi : l'état du projet avance vite et avait été recopié à la main dans plusieurs pages et documents, qui se contredisaient.
// Ce module est PUR (aucune API navigateur, aucun Redis, aucune requête) : il est relu par /llms.txt, la métadonnée globale, le JSON-LD, la page Apprendre et les tests
// (`tests/publicState.test.ts`), qui refusent les anciennes affirmations. Pour changer un fait public : modifier CE fichier, ajouter la preuve datée dans `docs/`, relancer les tests.
// RÈGLE : un fait n'entre ici qu'avec une preuve citée ; une famille d'appareils n'est « validée » que si son vote v2 a été observé sur la carte réelle.

export const SITE_URL = "https://proof-of-draw.vercel.app";
export const REPOSITORY_URL = "https://github.com/Rescoe/proof-of-draw";

/** Date de la dernière vérification de CE fichier contre la production et le dépôt. */
export const VERIFIED_AT = "2026-10-15";
export const VERIFIED_COMMIT = "f6f648e";

export interface ProofBlock {
  index: number;
  votesV2: number;
  votesV1: number;
  rejects: number;
  /** Familles d'appareils dont le vote a été observé dans ce bloc. */
  validators: string[];
  note?: string;
}

/** Blocs réels minés par quorum multi-appareils avec au moins un vote v2 signé (preuves : docs/SYNTHESE_VOTE_REEL_ET_PRODUCTION_DIRECTE_2026_10_14.md, docs/mesures/TFT28_ACK_BLOC104_2026_10_15/). */
export const PROOF_BLOCKS: readonly ProofBlock[] = [
  { index: 100, votesV2: 2, votesV1: 0, rejects: 0, validators: ["UNO R4 e-ink 2,9″", "UNO R4 TFT 2,8″"] },
  { index: 101, votesV2: 2, votesV1: 1, rejects: 0, validators: ["UNO R4 e-ink 2,9″", "ESP8266 e-ink 2,9″"], note: "un vote v1 (écho) d'un ancien appareil a aussi été compté : c'était avant le correctif qui refuse les votes v1" },
  { index: 103, votesV2: 3, votesV1: 0, rejects: 0, validators: ["UNO R4 TFT 2,8″", "UNO R4 e-ink 2,9″", "ESP8266 multiscreen (e-ink 2,7″ + OLED)"] },
  { index: 104, votesV2: 2, votesV1: 0, rejects: 0, validators: ["UNO R4 TFT 2,8″", "ESP8266 e-ink 2,9″"] },
];

/** Familles dont le vote v2 a été observé sur la carte réelle. */
export const HARDWARE_VALIDATED: readonly string[] = [
  "UNO R4 WiFi + e-ink 2,9″ BWR",
  "UNO R4 WiFi + TFT 2,8″ tactile + microSD (l'ACK décide du succès local : validé sur la carte le 15/10/2026)",
  "ESP8266 + e-ink 2,9″ BWR",
  "ESP8266 multiscreen e-ink 2,7″ + OLED 0,96″",
];

/** Qualifications matérielles restantes : le code existe et compile, aucun vote n'a encore été observé sur la carte réelle. Ce n'est PAS une absence de consensus. */
export const HARDWARE_PENDING: readonly string[] = [
  "ESP8266 e-ink 2,7″ seul",
  "ESP8266 TFT 1,8″",
  "UNO R4 WiFi + e-ink 2,7″ seul",
  "UNO R4 WiFi + e-ink 2,7″ + OLED",
  "UNO R4 WiFi + TFT 1,8″",
];

export const VOTE = {
  operational: true,
  protocol: "pod-vote-v2",
  summary:
    "Le vote v2 réel est opérationnel. Chaque appareil capable relit le contenu brut du candidat, recalcule son SHA-256 et trois métriques entières, décide d'un verdict objectif puis signe son vote en Ed25519. Le serveur vérifie la signature (mode strict) et compare hash et métriques à ses propres valeurs.",
  quorum: "⌈ 0,51 × appareils appairés, actifs et capables de voter en v2 ⌉, avec au moins un vote v2 (un vote v1 « écho » ne suffit plus).",
  nonVoting:
    "Un appareil dont le firmware ne sait pas voter en v2 continue de recevoir les œuvres (images, blocs), mais ne reçoit jamais de pendingValidation, ne vote pas et ne compte pas dans le quorum.",
  ack:
    "L'ACK du TFT 2,8″ décide désormais du succès local (aucun état local acquitté tant que le serveur n'a pas répondu 200) ; ce firmware a été validé sur la carte le 15/10/2026. L'ACK est une preuve applicative de traitement par le firmware, pas une preuve optique des pixels.",
  animations:
    "Les animations suivent le même parcours qu'un dessin (candidat, votes, bloc de type animation) mais sont encore votées en v1 (écho du score du serveur) : la validation par calcul des animations (pod-anim-v3) n'est pas active.",
} as const;

/** Formulation canonique du modèle de confiance — à reproduire telle quelle. */
export const TRUST_MODEL =
  "Proof-of-Draw fournit une preuve applicative et cryptographique orchestrée par le serveur et les appareils. Les votes v2 sont réellement signés en Ed25519 et vérifiés côté serveur. Les clés sont toutefois stockées dans l'EEPROM ou la flash et ne sont pas protégées par un secure element. La chaîne est liée par hashes et stockée dans l'infrastructure Proof-of-Draw ; elle n'est pas encore une blockchain publique autonome. L'ACK constitue une preuve applicative de traitement par le firmware, pas une preuve optique indépendante des pixels.";

/** Limites affichées publiquement. */
export const LIMITS: readonly string[] = [
  "Chaîne centralisée liée par hachage : un registre unique (Redis) ; ce n'est pas une blockchain publique, autonome ou décentralisée.",
  "Clés Ed25519 en EEPROM ou en flash, sans secure element : pas de signature matérielle inviolable.",
  "L'ACK est une preuve applicative, pas une preuve optique des pixels affichés.",
  "Le vote est compté par appareil, pas par profil ; l'auteur peut voter pour son propre dessin (éligibilité éteinte).",
  "Les votes signés complets ne sont pas encore conservés dans le bloc (seul un résumé l'est).",
  "Les animations sont encore votées en v1 ; leur validation par calcul n'est pas active.",
  "Les mises à jour à distance (OTA) ne sont ni généralisées ni validées sur la flotte : les cartes se reflashent par câble.",
  "Cinq familles d'appareils attendent leur qualification matérielle (vote v2 jamais observé sur la carte).",
  "Proof-of-Display Duration est une piste de recherche, pas une fonctionnalité disponible.",
  "Le dépôt est public pour transparence : aucune licence logicielle générale n'est accordée, tous droits réservés ; le régime des œuvres soumises reste à décider.",
];

/** Ce que le projet ne doit JAMAIS annoncer comme existant (garde-fou des tests). */
export const NEVER_CLAIM: readonly string[] = [
  "blockchain autonome ou décentralisée",
  "signature matérielle inviolable",
  "preuve optique des pixels",
  "OTA universelle",
  "validation matérielle de toutes les cartes",
];

export const LICENCE = {
  code: "Aucune licence logicielle générale n'est accordée ; tous droits réservés (voir README).",
  works:
    "Le régime des œuvres soumises n'est pas fixé : aucun consentement explicite à une licence (CC0 ou autre) n'est recueilli par le parcours de soumission actuel. Décision à prendre par le porteur avant toute affirmation publique.",
} as const;

export const PUBLIC_PAGES = [
  { path: "/", label: "Accueil", priority: 1 },
  { path: "/learn", label: "Apprendre : fonctionnement, installation et feuille de route", priority: 0.9 },
  { path: "/network", label: "Réseau en direct : constellation et topologie", priority: 0.8 },
  { path: "/gallery", label: "Galerie des œuvres minées", priority: 0.8 },
  { path: "/artists", label: "Artistes", priority: 0.7 },
  { path: "/draw", label: "Dessiner", priority: 0.7 },
  { path: "/animer", label: "Atelier d'animation", priority: 0.6 },
  { path: "/gallery-ana", label: "Galerie ANA", priority: 0.4 },
] as const;

export const DESCRIPTION =
  "Proof-of-Draw : un réseau artistique expérimental où des dessins et animations tracés dans le navigateur sont validés par des appareils ESP8266 et Arduino UNO R4 WiFi (SHA-256, métriques entières, votes signés Ed25519), enregistrés dans une chaîne liée par hachage, puis affichés sur des écrans e-ink, OLED et TFT.";

export function proofBlockLine(b: ProofBlock): string {
  return `#${b.index} : ${b.votesV2} vote(s) v2, ${b.votesV1} vote(s) v1, ${b.rejects} rejet(s) — ${b.validators.join(", ")}${b.note ? ` (${b.note})` : ""}`;
}
