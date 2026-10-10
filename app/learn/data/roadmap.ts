// app/learn/data/roadmap.ts — feuille de route de Proof-of-Draw (travail accompli / en cours / à faire), affichée à la FIN de la page Apprendre.
//
// RÈGLE : un statut ne monte jamais sans preuve (vocabulaire honnête, CLAUDE.md « Chantier validation réelle »).
//   done  = livré ET vérifié (tests, essai matériel ou usage réel — la note le précise quand c'est un essai matériel)
//   doing = en cours de réalisation
//   todo  = décidé ou proposé, pas commencé
// Source de vérité détaillée : docs/NOTE_CLAUDE_AUDIT_VALIDATION_CONSENSUS_OTA_2026_10_06.md, docs/AUDIT_GPT_CONSENSUS_POD_IOT_2026_10_06.md, docs/CHANTIER_VALIDATION_REELLE.md.
// À mettre à jour à chaque jalon (tests/learnRoadmap.test.ts garde la forme des données).

export type RoadmapStatus = "done" | "doing" | "todo";

export interface RoadmapItem {
  id: string;
  title: string;
  status: RoadmapStatus;
  /** Précision courte : preuve, limite ou prochaine étape. */
  note?: string;
}

export interface RoadmapPhase {
  id: string;
  title: string;
  summary: string;
  items: RoadmapItem[];
}

export const STATUS_LABEL: Record<RoadmapStatus, string> = { done: "Fait", doing: "En cours", todo: "À faire" };

export const ROADMAP: RoadmapPhase[] = [
  {
    id: "fondations",
    title: "1 · Fondations",
    summary: "Le produit fonctionne de bout en bout : dessiner, valider, miner, afficher.",
    items: [
      { id: "pipeline", title: "Pipeline complet dessin → candidat → votes → bloc → écrans", status: "done", note: "Architecture pull : aucun ESP n’est contacté directement." },
      { id: "studio", title: "Pod Studio : page de dessin pixel-exacte (Essentiel / Studio / Pro)", status: "done", note: "Moteur pur, replay identique à l’image, brouillon local." },
      { id: "chain", title: "Chaîne de blocs liée par SHA-256, conservée sans expiration", status: "done", note: "Registre unique dans Redis (voir « Décentralisation »)." },
      { id: "screens", title: "Écrans : OLED, e-ink 2,7″ / 2,9″, TFT 1,8″ / 2,8″", status: "done", note: "Le TFT 2,8″ tactile est encore à essayer pour le vote." },
      { id: "boards", title: "Cartes : ESP8266 et UNO R4 WiFi", status: "done", note: "Mêmes protocoles, firmwares par famille." },
      { id: "profile", title: "Profils d’artistes, appairage des écrans, autorisation d’un autre équipement", status: "done" },
      { id: "network-view", title: "Page Réseau en direct (constellation, flux observés ou reconstitués)", status: "done", note: "Les flux reconstitués sont signalés par une astérisque." },
      { id: "merge", title: "Outil « Ancien ➜ Nouveau » pour migrer les blocs d’une carte reflashée", status: "done" },
    ],
  },
  {
    id: "animations",
    title: "2 · Animations",
    summary: "Une animation est un bloc comme un autre, avec son atelier de création.",
    items: [
      { id: "anim-pipeline", title: "Animations dans le consensus (clip PBC1, bloc kind: animation, galerie)", status: "done" },
      { id: "anim-play", title: "Lecture sur TFT 2,8″, TFT 1,8″ et OLED", status: "done", note: "Multiscreen : animation sur l’OLED, image fixe sur l’e-ink, vérifié." },
      { id: "anim-studio", title: "Atelier d’animation refait : plein écran, 3 modes, 7 brosses, fantôme, retour/annuler", status: "done", note: "Vérifié dans l’aperçu ; essai sur téléphone réel à faire." },
      { id: "anim-master", title: "Canvas maître 256×128 exporté par écran avec trame", status: "todo", note: "Sans reflash. Étape suivante de l’atelier." },
      { id: "anim-v2", title: "Animations VALIDÉES par calcul (racine, empreinte et métriques par image)", status: "todo", note: "Spécification relue par l’audit et référence de calcul livrée (TypeScript et C++ identiques sur plus de 200 clips) ; l’automate de lecture du clip est aussi compilé pour l’ESP8266 et l’UNO R4 (moins de 2 Ko de RAM, jamais essayé sur carte) ; aucun firmware ne l’utilise encore : aujourd’hui les animations sont encore votées en v1, écho du score serveur." },
    ],
  },
  {
    id: "validation",
    title: "3 · Validation réelle par les appareils",
    summary: "Les cartes recalculent l’image et signent : fini l’écho du score du serveur (images fixes).",
    items: [
      { id: "metrics", title: "Métriques entières « pod-metrics-2 » (entropie, transitions, runs)", status: "done", note: "Identiques sur serveur, ESP8266 et R4 au ppm près (test différentiel C++/TypeScript)." },
      { id: "vote-v2", title: "Vote v2 : SHA-256 du contenu + métriques + verdict, signé Ed25519", status: "done" },
      { id: "atomic", title: "Votes atomiques (script Redis) et refus v2 non bloquants pendant le canari", status: "done" },
      { id: "fw-tested", title: "Vote v2 sur ESP8266 (e-ink 2,9″, multiscreen, TFT 1,8″) et R4 (e-ink 2,9″, 2,7″, 2,7″+OLED, TFT 1,8″)", status: "done", note: "Essai réel à 4 appareils, 06/10/2026." },
      { id: "fw-27solo", title: "Vote v2 sur l’ESP8266 e-ink 2,7″ « seul »", status: "doing", note: "Firmware eink27bw-2.1 compilé ; essai sur la carte à faire." },
      { id: "fw-tft28", title: "Vote v2 sur R4 + TFT 2,8″ tactile", status: "doing", note: "Code livré (r4tft28-2.5), essai matériel à faire." },
      { id: "r4-stack", title: "Ed25519 sur les cartes UNO R4 : calcul sur une pile dédiée", status: "doing", note: "Le premier démarrage d’un canari a montré que la pile principale (1 024 o) était dépassée par la signature Ed25519 (≈ 1,4 Ko requis). Correctif compilé et vérifié sur l’hôte ; micro-canari sur la carte à faire." },
      { id: "r4-net-stack", title: "Réseau sécurisé (TLS) des cartes UNO R4 : transactions sur une pile dédiée", status: "doing", note: "Mesuré sur la carte : la connexion TLS dépasse de 456 o la pile principale (défaut ancien, masqué tant que la mémoire voisine était libre). Pile dédiée validée sur la carte (1 172 o utilisés sur 2 048). Un dépassement de 24 o subsiste pourtant, avant toute transaction : la carte a prouvé qu’il vient de l’appel qui lit l’adresse MAC du module Wi-Fi. Tous les appels directs à ce module passent désormais par une courte pile dédiée, avec arrêt sûr en cas d’échec ; la carte a confirmé que ces piles courtes tiennent largement (marges de plus de 800 octets) ; l’essai suivant a localisé un dernier dépassement : le décodage de la réponse du serveur (JSON) ; il passe désormais sur sa propre pile dédiée, après la fermeture de la connexion sécurisée, avec un résultat borné et sans aucun effet tant que la réponse n’est pas validée. Correctif compilé et vérifié sur l’hôte contre la vraie bibliothèque ; un second décodeur du même type, celui de la réponse d’inscription, a été déplacé de la même façon après un essai qui s’est arrêté par précaution (76 octets de marge au lieu de 128) ; il reste à refaire un essai sans image sur la carte, avant tout essai de rendu." },
      { id: "traces", title: "Archiver une trace série par variante (octets, hash, métriques, verdict)", status: "todo", note: "Preuve reproductible à joindre aux notes de canari." },
    ],
  },
  {
    id: "preuves",
    title: "4 · Preuves vérifiables hors du serveur",
    summary: "Rendre un bloc vérifiable par n’importe qui, sans faire confiance au serveur.",
    items: [
      { id: "receipts", title: "Conserver les votes signés dans le bloc, liés au parentHash", status: "doing", note: "Code livré derrière un interrupteur, éteint par défaut, pas encore essayé sur le réseau réel : aujourd’hui les votes sont supprimés après le minage. La liaison au parentHash attend le vote v3 (firmware)." },
      { id: "verifier", title: "Vérificateur public (recalcule hash, métriques, signatures, comité)", status: "doing", note: "Vérificateur et outil en ligne de commande livrés (hash, reçus, signatures, contenu) ; le comité et un second vérificateur indépendant restent à faire." },
      { id: "eligibility", title: "Un vote par profil, auteur exclu, appairage exigé pour voter", status: "doing", note: "Code livré derrière un interrupteur, éteint par défaut ; à essayer en mode « ombre » avant de l’activer. Aujourd’hui un appareil non appairé peut encore voter." },
      { id: "register-proof", title: "Preuve de possession de la clé à l’enregistrement, épinglage et récupération par le profil", status: "todo" },
      { id: "committee", title: "Comité déterministe de 7 profils, seuil 2/3, mineur rejouable", status: "doing", note: "Code livré derrière un interrupteur, éteint par défaut, pas encore essayé sur le réseau réel ; remplacera le quorum de 51 % et le tirage aléatoire. Verrouillé deux fois (un accusé explicite du risque est exigé) : la tolérance aux profils malhonnêtes ne doit pas être annoncée tant que le tirage reste calculable à l’avance par l’auteur." },
      { id: "rules", title: "Règles N2 versionnées, motif de refus signé, revérifiées par le serveur", status: "todo" },
      { id: "reputation", title: "Réputation par profil sur mensonges objectivement prouvables", status: "doing", note: "Compteurs livrés derrière l’interrupteur du comité (observation seulement, aucun effet bloquant) ; aucun taux de menteurs n’est affiché ni annoncé." },
      { id: "simulation", title: "Simulation avec une fraction d’appareils malhonnêtes (taux de tolérance mesuré)", status: "doing", note: "Simulateur en mémoire livré ; il montre qu’un auteur peut choisir son comité si la graine est calculable à l’avance : la tolérance ne doit pas être annoncée avant une balise aléatoire postérieure à la soumission." },
      { id: "anchor", title: "Ancrage périodique de la tête de chaîne (dépôt public ou horodatage)", status: "todo" },
    ],
  },
  {
    id: "consensus-lib",
    title: "5 · Noyau de consensus réutilisable (consensusPoD)",
    summary: "Séparer la gestion des écrans du consensus, pour que d’autres appareils puissent participer.",
    items: [
      { id: "core-extract", title: "Extraire un noyau portable sans écran ni réseau (flux → hash + métriques + message de vote)", status: "doing", note: "Noyau C++ livré (règles, hash salé, vote v3, reçus, comité, mineur, bloc) et identique à la référence TypeScript ; aucun firmware ne l’utilise encore, l’adoption se fera au grand reflash." },
      { id: "vectors", title: "Vecteurs de test officiels exécutés sur TypeScript, ESP8266, R4 et PC", status: "doing", note: "Plus de mille vérifications générées par la référence TypeScript et retrouvées à l’identique par le noyau C++ sur PC ; ESP8266 et R4 : l’auto-test compile, il n’a jamais tourné sur une carte." },
      { id: "adapters", title: "Adaptateurs ESP8266, R4, ESP32 et PC/Raspberry Pi", status: "doing", note: "Adaptateurs de calcul SHA-256 pour PC, ESP8266 et R4 livrés (compilés, jamais essayés sur carte) ; l’automate d’animation y est compilé avec ses budgets mémoire mesurés à la compilation ; ESP32 et Raspberry Pi natif restent à faire." },
      { id: "headless", title: "Nœuds de validation sans écran (rôle validator)", status: "todo" },
      { id: "publish", title: "Publication ouverte (spécification, licence, exemples) en version expérimentale", status: "todo", note: "Après gel du protocole v3." },
    ],
  },
  {
    id: "firmware",
    title: "6 · Firmware : mises à jour et finitions",
    summary: "Un seul reflash groupé, puis des mises à jour à distance signées.",
    items: [
      { id: "wifi-portal", title: "Identifiants Wi-Fi hors du binaire (portail de configuration)", status: "todo", note: "Condition d’un binaire unique par famille de carte." },
      { id: "ota", title: "Mises à jour à distance signées (manifeste dans /api/pull, anti-retour arrière, déploiement par vagues)", status: "todo", note: "Faisable sur ESP8266 et R4 ; fabrication du fichier R4 et sécurité à vérifier." },
      { id: "cartel", title: "Cartels e-ink : zone sûre puis réglage par appareil (superposé / cadre / masqué)", status: "doing", note: "Livré : l’éditeur hachure les bandes du cartel (ce que l’écran efface) et prévient avant l’envoi. Reste le réglage par appareil (superposé / cadre / masqué), qui demande le grand flash." },
      { id: "keys", title: "Génération des clés avec une source d’aléa matérielle (ESP8266)", status: "todo" },
      { id: "tls", title: "Connexions TLS authentifiées (empreinte ou certificat)", status: "todo" },
      { id: "salted", title: "Hash salé par appareil et signature spatiale de l’image", status: "todo", note: "Recherche : détecter copies et réponses recopiées." },
    ],
  },
  {
    id: "decentralisation",
    title: "7 · Réseau décentralisé et PoDScan",
    summary: "Passer d’une chaîne centralisée à témoins signés à un réseau de nœuds qui la répliquent.",
    items: [
      { id: "pi-nodes", title: "Nœuds Raspberry Pi : miroir de la chaîne, vérification complète, validateurs puissants", status: "todo" },
      { id: "audit-n3", title: "Auditeurs de geste : rejouer le dessin pour vérifier qu’il est fait à la main", status: "todo" },
      { id: "cosign", title: "Co-signature de la tête de chaîne par le comité", status: "todo" },
      { id: "podscan", title: "PoDScan : explorateur public de blocs, de votes signés et de validateurs", status: "todo", note: "Équivalent d’un explorateur de chaîne." },
      { id: "replication", title: "Réplication de la chaîne au-delà d’un registre unique", status: "todo" },
    ],
  },
];

export interface PhaseProgress { done: number; doing: number; todo: number; total: number }

export function phaseProgress(phase: RoadmapPhase): PhaseProgress {
  const done = phase.items.filter((i) => i.status === "done").length;
  const doing = phase.items.filter((i) => i.status === "doing").length;
  return { done, doing, todo: phase.items.length - done - doing, total: phase.items.length };
}

export function roadmapProgress(phases: readonly RoadmapPhase[] = ROADMAP): PhaseProgress {
  return phases.reduce<PhaseProgress>(
    (acc, p) => { const q = phaseProgress(p); return { done: acc.done + q.done, doing: acc.doing + q.doing, todo: acc.todo + q.todo, total: acc.total + q.total }; },
    { done: 0, doing: 0, todo: 0, total: 0 },
  );
}
