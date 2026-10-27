"use client";
// Point de départ d'une feuille : Remix d'un bloc miné (?remix={blockHash}) ou reprise d'un dessin rejeté (?resume={candidateId}). Charge l'image SOURCE (jamais modifiée) ;
// le studio la copie dans une nouvelle feuille. Aucune navigation automatique sur erreur : l'artiste choisit (réessayer / feuille blanche).
import { useCallback, useEffect, useState } from "react";
import type { ScreenId } from "@/lib/screenProfiles";
import { DERIVED_HASH_RE } from "@/lib/derivation";
import { payloadToStudioRGBA, toScreenPayload } from "@/lib/remixSeed";

export type SeedRequest = { kind: "remix"; blockHash: string } | { kind: "resume"; candidateId: string };

/** Paramètres d'adresse → demande ; strict : hash 64 hex pour un Remix, identifiant simple pour une reprise ; rien d'autre n'est interprété. */
export function parseSeedRequest(search: string): SeedRequest | null {
  const sp = new URLSearchParams(search);
  const remix = (sp.get("remix") ?? "").trim().toLowerCase();
  if (remix) return DERIVED_HASH_RE.test(remix) ? { kind: "remix", blockHash: remix } : null;
  const resume = (sp.get("resume") ?? "").trim();
  return /^[0-9A-Za-z-]{8,64}$/.test(resume) ? { kind: "resume", candidateId: resume } : null;
}

export interface StudioSeed {
  /** suffixe de la clé de brouillon : le Remix a SON brouillon, il n'écrase jamais celui de la feuille ordinaire */
  key: string;
  rgba: Uint8ClampedArray;
  /** texte affiché : « Remix du bloc #12 · Titre » ou « Reprise d'un dessin rejeté » */
  label: string;
  titleSuggestion: string;
  derivedFromBlockHash?: string;
  /** lien vers l'original (Remix) */
  originHref?: string;
}

export type SeedState = { state: "none" } | { state: "loading" } | { state: "error"; message: string; href?: string; hrefLabel?: string } | { state: "ready"; seed: StudioSeed };

/** Erreur qui propose un AUTRE endroit où ouvrir l'œuvre (ex. une animation rejetée → l'atelier d'animation) : jamais de navigation automatique. */
export class SeedElsewhereError extends Error {
  constructor(message: string, readonly href: string, readonly hrefLabel: string) { super(message); }
}

async function getJson(url: string): Promise<{ ok: boolean; status: number; body: Record<string, unknown> | null }> {
  const res = await fetch(url, { cache: "no-store" });
  let body: Record<string, unknown> | null = null;
  try { body = await res.json(); } catch { /* corps illisible */ }
  return { ok: res.ok, status: res.status, body };
}

export async function loadSeed(req: SeedRequest, screenId: ScreenId): Promise<StudioSeed> {
  if (req.kind === "remix") {
    const [meta, img] = await Promise.all([getJson(`/api/block-meta?hash=${req.blockHash}`), getJson(`/api/block-image?hash=${req.blockHash}`)]);
    if (meta.status === 404 || img.status === 404) throw new Error("Le bloc d'origine est introuvable.");
    if (!meta.ok || !img.ok || !meta.body || !img.body) throw new Error("Impossible de charger le bloc d'origine (erreur réseau ou serveur).");
    if (meta.body.kind === "animation") throw new SeedElsewhereError("Ce bloc est une animation : l'ouvrir ici ne donnerait que son affiche. L'atelier d'animation la rouvre en entier, toutes les images.", `/animer?remix=${req.blockHash}`, "Ouvrir l'animation entière dans l'atelier");
    if (meta.body.poolScreen !== screenId) throw new Error("Cet écran n'est pas du même type que le bloc d'origine : choisis un écran du même type.");
    const payload = toScreenPayload(img.body.imagePayload, screenId);
    if (!payload) throw new Error("L'image du bloc d'origine est illisible.");
    const idx = typeof meta.body.blockIndex === "number" ? meta.body.blockIndex : null;
    const title = typeof meta.body.workTitle === "string" ? meta.body.workTitle : "";
    return {
      key: `remix:${req.blockHash.slice(0, 16)}`, rgba: payloadToStudioRGBA(payload), derivedFromBlockHash: req.blockHash,
      label: `Remix du bloc ${idx !== null ? `#${idx}` : req.blockHash.slice(0, 8)}${title ? ` · « ${title} »` : ""}`,
      titleSuggestion: title ? `Remix — ${title}`.slice(0, 80) : "Remix", originHref: `/gallery?q=${idx !== null ? idx : req.blockHash}`,
    };
  }
  const r = await getJson(`/api/rejected-image?id=${encodeURIComponent(req.candidateId)}`);
  if (r.status === 404) throw new Error("La copie de ce dessin rejeté n'est plus conservée.");
  if (!r.ok || !r.body) throw new Error("Impossible de charger le dessin rejeté (erreur réseau ou serveur).");
  if (r.body.animation === true) throw new SeedElsewhereError("Ce rejet est une animation : l'ouvrir ici ne donnerait que son affiche (une seule image). L'atelier d'animation la rouvre en entier, toutes les images.", `/animer?resume=${encodeURIComponent(req.candidateId)}`, "Ouvrir l'animation entière dans l'atelier");
  const payload = toScreenPayload(r.body.payload, screenId);
  if (!payload) throw new Error("Ce dessin rejeté ne correspond pas au type de cet écran, ou son image est illisible.");
  return { key: `resume:${req.candidateId.slice(0, 16)}`, rgba: payloadToStudioRGBA(payload), label: "Reprise d'un dessin rejeté (l'archive reste intacte)", titleSuggestion: "" };
}

/** Charge le point de départ demandé (si l'adresse en porte un). `retry` relance ; `skip` abandonne la demande (feuille blanche). */
export function useSeed(search: string, screenId: ScreenId): { seed: SeedState; retry: () => void; skip: () => void } {
  const req = parseSeedRequest(search);
  const reqKey = req ? (req.kind === "remix" ? `r:${req.blockHash}` : `u:${req.candidateId}`) : "";
  const [seed, setSeed] = useState<SeedState>(() => (reqKey ? { state: "loading" } : { state: "none" }));
  const [attempt, setAttempt] = useState(0);
  const [skipped, setSkipped] = useState(false);
  useEffect(() => {
    if (!reqKey || skipped) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- (re)chargement quand la demande ou la tentative change
    setSeed({ state: "loading" });
    loadSeed(req as SeedRequest, screenId)
      .then((s) => { if (!cancelled) setSeed({ state: "ready", seed: s }); })
      .catch((e) => { if (!cancelled) setSeed({ state: "error", message: e instanceof Error ? e.message : "Chargement impossible.", ...(e instanceof SeedElsewhereError ? { href: e.href, hrefLabel: e.hrefLabel } : {}) }); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `req` est dérivé de reqKey
  }, [reqKey, screenId, attempt, skipped]);
  const retry = useCallback(() => setAttempt((a) => a + 1), []);
  const skip = useCallback(() => { setSkipped(true); setSeed({ state: "none" }); }, []);
  return { seed: skipped ? { state: "none" } : seed, retry, skip };
}
