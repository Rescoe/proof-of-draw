// lib/validationWording.ts — libellé HONNÊTE du niveau d'indépendance des votants d'un bloc (champ `Block.validation`, Lot 2, ELIGIBILITY_MODE=enforce).
// RÈGLE (R5 du plan de collaboration) : « bootstrap » = réseau trop petit, les profils de l'AUTEUR étaient admis : on dit « partielle », jamais « validé par le réseau ».
// Coût Redis : AUCUN (libellés seulement).

export interface BlockValidationInfo { eligibility: "enforce"; plan: "independent" | "bootstrap" | "none"; independentProfiles: number; distinctProfiles: number }

export function validationLabel(v: BlockValidationInfo): { value: string; note: string } {
  const plural = (n: number, w: string) => `${n} ${w}${n > 1 ? "s" : ""}`;
  if (v.plan === "independent") return { value: `${plural(v.distinctProfiles, "profil")} distinct${v.distinctProfiles > 1 ? "s" : ""}, auteur exclu`, note: "Une voix par profil, quel que soit le nombre de cartes ; les appareils de l’auteur n’ont pas voté." };
  if (v.plan === "bootstrap") return { value: "Partielle — réseau trop petit", note: `Moins de 3 profils indépendants de l’auteur (${v.independentProfiles}) : ses propres profils ont été admis. Ce bloc n’est pas validé par un réseau indépendant.` };
  return { value: "Aucun profil éligible", note: "Aucun profil n’était éligible au moment du dépôt." };
}
