"use client";
// app/ui/useDialog.ts — comportement COMMUN des fenêtres modales (UX jalon 5, 29/10/2026) : Échap ferme, focus piégé (Tab / Maj+Tab), premier élément focalisé à l'ouverture, focus rendu au déclencheur
// à la fermeture, défilement de la page verrouillé. Un dialogue imbriqué (ex. l'agrandissement d'un graphique) porte `data-nested-dialog` : Échap ne ferme alors que lui.
import { useEffect, useRef } from "react";

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function useDialog(open: boolean, onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; }, [onClose]);   // le gestionnaire garde la dernière fonction sans se réinstaller

  useEffect(() => {
    if (!open) return;
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const node = ref.current;
    (node?.querySelector<HTMLElement>(FOCUSABLE) ?? node)?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (document.querySelector("[data-nested-dialog]")) return;   // un dialogue imbriqué gère son propre Échap
        e.preventDefault(); closeRef.current(); return;
      }
      if (e.key !== "Tab" || !ref.current) return;
      const items = Array.from(ref.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((x) => x.offsetParent !== null || x === document.activeElement);
      if (items.length === 0) { e.preventDefault(); ref.current.focus(); return; }
      const first = items[0], last = items[items.length - 1], cur = document.activeElement;
      if (e.shiftKey && (cur === first || !ref.current.contains(cur))) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && (cur === last || !ref.current.contains(cur))) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      if (trigger && document.contains(trigger)) trigger.focus();
    };
  }, [open]);

  return ref;
}
