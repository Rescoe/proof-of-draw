// lib/keyPinning.ts — épinglage de la clé publique d'un appareil (chantier « validation réelle », phase P0, menace T2 : usurpation par re-register).
//
// Avant : /api/register écrasait la clé publique à chaque appel (la MAC n'est pas secrète) → n'importe qui pouvait prendre l'identité d'un appareil.
// Règle (si PIN_DEVICE_KEY=true) : la première clé enregistrée est FIXÉE ; une clé différente est refusée. Désactivé par défaut : un propriétaire qui
// efface l'EEPROM de sa carte génère une nouvelle clé et serait bloqué tant que la réinitialisation par le profil (P0 suite) n'existe pas.

export type KeyDecision = "set" | "same" | "refuse";

export function decideKeyUpdate(existing: string | undefined, incoming: string, pinEnabled: boolean): KeyDecision {
  if (!existing) return "set";
  if (existing === incoming) return "same";
  return pinEnabled ? "refuse" : "set";
}

export const pinEnabledFromEnv = (): boolean => process.env.PIN_DEVICE_KEY === "true";
