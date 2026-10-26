"use client";
// Lecture d'une liste d'API avec trois issues DISTINCTES (chargé / erreur / vide traité par l'appelant) : jamais d'échec présenté comme une liste vide (lib/drawTargets.ts).
import { classifyList, NETWORK_ERROR_MESSAGE, type LoadState } from "@/lib/drawTargets";

export async function fetchList<T>(url: string, field: string): Promise<LoadState<T[]>> {
  try {
    const res = await fetch(url, { cache: "no-store" });
    let body: unknown = null;
    try { body = await res.json(); } catch { /* corps illisible : classifyList le traite en erreur */ }
    return classifyList<T>(res.ok, res.status, body, field);
  } catch {
    return { kind: "error", message: NETWORK_ERROR_MESSAGE };
  }
}
