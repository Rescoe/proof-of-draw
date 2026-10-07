// lib/animV3Mode.ts — interrupteur ANIM_V3_MODE (Lot 6B-2, docs/SPEC_PODANIM_V3.md § 8) : deux modes SEULEMENT.
//
//   off     (défaut, variable absente ou vide) : AUCUN effet — comportement actuel strict (candidat v1, quorum historique).
//   shadow  : le serveur calcule la référence v3 d'un candidat animation (framesRoot, animRoot, E/T/R/S, règle A1) et la JOURNALISE ; la route /api/candidate-clip devient active (si CLIP_TICKET_SECRET existe).
//             Aucun vote v3 n'est accepté, rien n'est écrit dans Redis, aucun comportement de vote ou de bloc ne change.
// « enforce » N'EXISTE PAS dans le code de ce lot : la valeur « enforce » est ramenée à « shadow » (avec un avertissement journalisé par l'appelant) ; il ne sera écrit qu'au lot 8, quand les firmwares
// DÉCLARERONT réellement leurs capacités (`caps` dans /api/register). Toute autre valeur (faute de frappe comprise) = « off » : la prudence va vers le comportement actuel.

export type AnimV3Mode = "off" | "shadow";

const raw = (env: NodeJS.ProcessEnv) => (env.ANIM_V3_MODE ?? "").trim().toLowerCase();

export const animV3ModeFromEnv = (env: NodeJS.ProcessEnv = process.env): AnimV3Mode => { const v = raw(env); return v === "shadow" || v === "enforce" ? "shadow" : "off"; };

/** « enforce » a été DEMANDÉ : impossible en 6B (ramené à shadow) — l'appelant journalise un avertissement. */
export const animV3EnforceRequested = (env: NodeJS.ProcessEnv = process.env): boolean => raw(env) === "enforce";
