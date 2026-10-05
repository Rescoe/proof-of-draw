// app/learn/data/powerProfiles.ts — consommation électrique ESTIMÉE de chaque montage branché 24 h/24 (page Apprendre, parcours « Consommation »).
//
// MÉTHODE. Rien ici n'est mesuré sur le matériel du porteur : ce sont des courants TYPIQUES de fiches techniques et de mesures publiées pour chaque
// composant, assemblés selon le COMPORTEMENT RÉEL des firmwares de ce dépôt :
//   • aucun firmware n'utilise le deep-sleep : la carte est allumée et connectée au Wi-Fi 24 h/24 (c'est le poste dominant) ;
//   • le serveur n'est contacté que par pull (HTTPS) : toutes les 5 min quand le réseau est actif, 15 min sinon (lib/pullBudget.ts, `retryAfter`),
//     60 s au pire (PULL_INTERVAL des firmwares) ; chaque pull est une courte rafale radio + TLS ;
//   • l'e-ink ne consomme que pendant un rafraîchissement (bistable) ; le TFT et l'OLED sont allumés en permanence (rétroéclairage relié au 3,3 V).
// Tous les courants sont ramenés au rail 5 V USB (les régulateurs linéaires des cartes tirent le même courant en 5 V qu'en 3,3 V), puis divisés par
// le rendement du chargeur USB pour obtenir la puissance prise sur la prise murale.
// À CONFIRMER avec un wattmètre USB (≈ 10 €) : relever les mA sur une heure. Les fourchettes min/max encadrent l'incertitude.

export const SUPPLY_VOLTS = 5;
export const HOURS_PER_YEAR = 8760;
/** Rendement d'un petit chargeur USB bon marché (min = mauvais chargeur, max = bon chargeur). */
export const CHARGER_EFFICIENCY = { min: 0.85, typ: 0.75, max: 0.65 } as const;   // min/max = scénario le plus/moins favorable
/** Tarif d'électricité utilisé par défaut (€/kWh TTC), à adapter à son contrat. */
export const DEFAULT_TARIFF_EUR_PER_KWH = 0.20;

export interface CurrentRange { min: number; typ: number; max: number }   // mA au rail 5 V

export interface PowerComponent {
  id: string;
  label: string;
  /** Pourquoi cette valeur. */
  basis: string;
  ma: CurrentRange;
}

/** Rafale radio d'un pull HTTPS : courant supplémentaire × durée, répartie sur l'intervalle de pull. */
export const PULL_BURST = { extraMa: 90, seconds: 1.5, intervalHotS: 300, intervalDormantS: 900, intervalWorstS: 60 };

export function pullAverageMa(intervalS: number): number {
  return (PULL_BURST.extraMa * PULL_BURST.seconds) / intervalS;
}

export const COMPONENTS: Record<string, PowerComponent> = {
  esp8266: {
    id: "esp8266",
    label: "Carte ESP8266 (NodeMCU / D1 mini) connectée au Wi-Fi",
    basis: "ESP8266 connecté ≈ 70 mA + convertisseur USB-série ≈ 8 mA + régulateur ≈ 5 mA ; jamais en deep-sleep dans nos firmwares",
    ma: { min: 50, typ: 80, max: 110 },
  },
  unoR4: {
    id: "unoR4",
    label: "Arduino UNO R4 WiFi connectée",
    basis: "RA4M1 ≈ 15 mA + ESP32-S3 Wi-Fi connecté ≈ 85 mA + USB/régulation ; valeur estimée, à mesurer",
    ma: { min: 80, typ: 120, max: 160 },
  },
  eink: {
    id: "eink",
    label: "Écran e-ink (2,9″ BWR ou 2,7″ BW)",
    basis: "bistable : ≈ 0 en veille ; rafraîchissement ≈ 8 mA pendant 4 à 15 s, quelques dizaines d'images par jour",
    ma: { min: 0.05, typ: 0.1, max: 0.5 },
  },
  oled: {
    id: "oled",
    label: "OLED 0,96″ SSD1306 (allumé en permanence)",
    basis: "≈ 4 mA peu allumé, 20 mA plein blanc ; l'affichage d'informations réseau est surtout sombre",
    ma: { min: 4, typ: 10, max: 20 },
  },
  tft18: {
    id: "tft18",
    label: "TFT 1,8″ ST7735 (rétroéclairage toujours allumé)",
    basis: "rétroéclairage ≈ 15 à 40 mA (BLK relié au 3,3 V, voir câblage) + contrôleur ≈ 3 mA",
    ma: { min: 18, typ: 28, max: 43 },
  },
  tft18Anim: {
    id: "tft18Anim",
    label: "Surcoût de la lecture d'animation en boucle (TFT 1,8″)",
    basis: "bus SPI et lecture de la flash en continu : ≈ +10 mA",
    ma: { min: 5, typ: 10, max: 15 },
  },
  tft28: {
    id: "tft28",
    label: "TFT 2,8″ ILI9341 tactile + lecteur microSD (rétroéclairage toujours allumé)",
    basis: "module 2,8″ : 4 LED de rétroéclairage ≈ 60 à 120 mA + contrôleur, tactile et lecteur SD ≈ 5 mA",
    ma: { min: 70, typ: 100, max: 140 },
  },
  tft28Anim: {
    id: "tft28Anim",
    label: "Surcoût de la lecture d'animation en boucle (TFT 2,8″, carte SD)",
    basis: "lectures SD et envois SPI en continu : ≈ +10 mA",
    ma: { min: 5, typ: 10, max: 20 },
  },
  sd: {
    id: "sd",
    label: "Lecteur microSD (facultatif)",
    basis: "≈ 1 mA au repos ; pointes de 20 à 60 mA pendant l'écriture seulement",
    ma: { min: 0.2, typ: 1, max: 3 },
  },
};

export type PowerSetupId = "eink29bwr" | "eink27bw" | "eink27bwOled" | "tft18" | "tft28" | "r4eink29";

export interface PowerSetup {
  id: PowerSetupId;
  name: string;
  board: string;
  /** Identifiants de COMPONENTS (hors rafale de pull, ajoutée selon l'intervalle). */
  parts: string[];
  /** Variante avec animation en boucle (écrans dynamiques seulement). */
  animationPart?: string;
  note: string;
  /** Firmware non validé sur le matériel : à signaler. */
  untested?: boolean;
}

export const POWER_SETUPS: PowerSetup[] = [
  { id: "eink29bwr", name: "E-ink 2,9″ BWR", board: "ESP8266", parts: ["esp8266", "eink"], note: "La carte ESP8266 fait presque toute la consommation : l'e-ink ne consomme qu'en rafraîchissement." },
  { id: "eink27bw", name: "E-ink 2,7″ BW (seul)", board: "ESP8266", parts: ["esp8266", "eink"], note: "Même profil que l'e-ink 2,9″." },
  { id: "eink27bwOled", name: "E-ink 2,7″ BW + OLED 0,96″", board: "ESP8266", parts: ["esp8266", "eink", "oled"], animationPart: undefined, note: "L'OLED allumé en permanence ajoute ≈ 10 %. Les animations jouent sur l'OLED sans surcoût significatif (écran déjà actif)." },
  { id: "tft18", name: "TFT 1,8″ couleur", board: "ESP8266", parts: ["esp8266", "tft18"], animationPart: "tft18Anim", note: "Le rétroéclairage représente environ le quart du total. Lecteur SD facultatif : ≈ +1 mA." },
  { id: "tft28", name: "TFT 2,8″ tactile", board: "UNO R4 WiFi", parts: ["unoR4", "tft28"], animationPart: "tft28Anim", note: "Le plus gourmand : carte R4 plus un rétroéclairage puissant toujours allumé (≈ 45 % du total)." },
  { id: "r4eink29", name: "E-ink 2,9″ BWR sur UNO R4", board: "UNO R4 WiFi", parts: ["unoR4", "eink"], untested: true, note: "Firmware non testé sur la carte à ce jour. La R4 consomme plus qu'un ESP8266 seul." },
];

export interface PowerEstimate {
  /** Courant au rail 5 V (mA). */
  ma: number;
  /** Puissance au rail 5 V (W). */
  watts5v: number;
  /** Puissance prise sur la prise murale (W), rendement du chargeur compris. */
  wattsWall: number;
  kwhYear: number;
  eurosYear: number;
}

function sum(parts: string[], key: keyof CurrentRange): number {
  return parts.reduce((t, id) => t + COMPONENTS[id].ma[key], 0);
}

/** Estimation 24 h/24. `case` : scénario bas, typique ou haut. `withAnimation` : lecture d'animation en boucle en permanence. */
export function estimateSetup(
  setup: PowerSetup,
  opts: { scenario?: "min" | "typ" | "max"; withAnimation?: boolean; tariff?: number } = {},
): PowerEstimate {
  const scenario = opts.scenario ?? "typ";
  const tariff = opts.tariff ?? DEFAULT_TARIFF_EUR_PER_KWH;
  const parts = opts.withAnimation && setup.animationPart ? [...setup.parts, setup.animationPart] : setup.parts;
  const interval = scenario === "min" ? PULL_BURST.intervalDormantS : scenario === "max" ? PULL_BURST.intervalWorstS : PULL_BURST.intervalHotS;
  const ma = sum(parts, scenario) + pullAverageMa(interval);
  const watts5v = (ma / 1000) * SUPPLY_VOLTS;
  const wattsWall = watts5v / CHARGER_EFFICIENCY[scenario];
  const kwhYear = (wattsWall * HOURS_PER_YEAR) / 1000;
  return { ma, watts5v, wattsWall, kwhYear, eurosYear: kwhYear * tariff };
}

/** Part du courant due à chaque poste (hors rafales de pull), pour dire « le rétroéclairage fait X % du total ». */
export function shareByPart(setup: PowerSetup): { id: string; label: string; share: number }[] {
  const total = sum(setup.parts, "typ") + pullAverageMa(PULL_BURST.intervalHotS);
  return [...setup.parts, "__pull"].map((id) => id === "__pull"
    ? { id, label: "Rafales de pull (HTTPS)", share: pullAverageMa(PULL_BURST.intervalHotS) / total }
    : { id, label: COMPONENTS[id].label, share: COMPONENTS[id].ma.typ / total });
}

/** Coût annuel d'un parc : somme d'un nombre d'exemplaires par montage. */
export function fleetEstimate(counts: Partial<Record<PowerSetupId, number>>, tariff = DEFAULT_TARIFF_EUR_PER_KWH): { kwhYear: number; eurosYear: number } {
  let kwhYear = 0;
  for (const setup of POWER_SETUPS) kwhYear += (counts[setup.id] ?? 0) * estimateSetup(setup, { tariff }).kwhYear;
  return { kwhYear, eurosYear: kwhYear * tariff };
}
