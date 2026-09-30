"use client";
// app/draw/_studio/ui.tsx — briques d'interface : feuille, boîte de dialogue, curseur, toasts

import { useCallback, useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { BrushPreview } from "./previews";
export { BrushPreview };

/**
 * Feuille du bas (téléphone) / fenêtre flottante (grand écran).
 * Fermeture : bouton, Échap, ou tape sur le fond. Le fond ignore les 280 premières
 * millisecondes : le geste qui a ouvert la feuille ne peut jamais la refermer
 * (fin des "doubles clics" — audit B1).
 */
export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  const openedAt = useRef(0);
  useEffect(() => { openedAt.current = performance.now(); }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <>
      <div
        className="st-scrim"
        onClick={e => { if (e.target === e.currentTarget && performance.now() - openedAt.current > 280) onClose(); }}
      />
      <section className="st-sheet" role="dialog" aria-label={title}>
        <div className="st-sheet__grip" />
        <header className="st-sheet__head">
          <h2 className="st-sheet__title" style={{ margin: 0 }}>{title}</h2>
          <button type="button" className="st-btn st-btn--icon" onClick={onClose} aria-label="Fermer"><X size={20} /></button>
        </header>
        <div className="st-sheet__body">{children}</div>
      </section>
    </>
  );
}

export function Modal({ children, onClose, label }: { children: React.ReactNode; onClose?: () => void; label: string }) {
  const openedAt = useRef(0);
  useEffect(() => { openedAt.current = performance.now(); }, []);
  return (
    <div
      className="st-modal"
      onClick={e => { if (onClose && e.target === e.currentTarget && performance.now() - openedAt.current > 280) onClose(); }}
    >
      <div className="st-dialog" role="dialog" aria-modal="true" aria-label={label}>{children}</div>
    </div>
  );
}

export function ConfirmDialog(props: {
  title: string; message: string; confirmLabel: string; danger?: boolean;
  onConfirm: () => void; onCancel: () => void;
}) {
  return (
    <Modal label={props.title} onClose={props.onCancel}>
      <h3>{props.title}</h3>
      <p>{props.message}</p>
      <div className="st-dialog__actions">
        <button type="button" className="st-btn st-btn--solid" onClick={props.onCancel}>Annuler</button>
        <button type="button" className={"st-btn " + (props.danger ? "st-btn--solid st-btn--danger" : "st-btn--accent")} onClick={props.onConfirm}>{props.confirmLabel}</button>
      </div>
    </Modal>
  );
}

export function Slider(props: {
  value: number; min: number; max: number; step?: number; label: string;
  onChange: (v: number) => void; format?: (v: number) => string;
}) {
  return (
    <div className="st-slider">
      <input
        className="st-range" type="range" aria-label={props.label}
        min={props.min} max={props.max} step={props.step ?? 1} value={props.value}
        onChange={e => props.onChange(Number(e.target.value))}
      />
      <span className="st-slider__val">{props.format ? props.format(props.value) : props.value}</span>
    </div>
  );
}

// ─── Toasts ──────────────────────────────────────────────────────────────────

export interface Toast { id: number; msg: string; kind?: "ok" | "err" | "info"; action?: { label: string; run: () => void } }

export function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const next = useRef(1);
  const dismiss = useCallback((id: number) => setToasts(t => t.filter(x => x.id !== id)), []);
  const push = useCallback((msg: string, opts: { kind?: Toast["kind"]; action?: Toast["action"]; ms?: number } = {}) => {
    const id = next.current++;
    setToasts(t => [...t.slice(-1), { id, msg, kind: opts.kind, action: opts.action }]);
    window.setTimeout(() => dismiss(id), opts.ms ?? (opts.action ? 6500 : 3200));
    return id;
  }, [dismiss]);
  return { toasts, push, dismiss };
}

export function ToastHost({ toasts, dismiss, bottom }: { toasts: Toast[]; dismiss: (id: number) => void; bottom: number }) {
  if (!toasts.length) return null;
  return (
    <div className="st-toasts" style={{ bottom }} role="status" aria-live="polite">
      {toasts.map(t => (
        <div key={t.id} className={"st-toast" + (t.kind === "err" ? " st-toast--err" : t.kind === "ok" ? " st-toast--ok" : "")}>
          <span>{t.msg}</span>
          {t.action && <button type="button" onClick={() => { t.action!.run(); dismiss(t.id); }}>{t.action.label}</button>}
        </div>
      ))}
    </div>
  );
}

export function formatTime(s: number) {
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.max(0, Math.floor(s % 60))).padStart(2, "0")}`;
}
