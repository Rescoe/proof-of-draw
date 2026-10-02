"use client";

// app/profile/InlineEdit.tsx — champ de texte modifiable « au clic » (nom d'artiste, bio, nom d'un appareil).
// Extrait de page.tsx : un fichier page.tsx ne peut pas exporter autre chose que sa page (routes typées de Next).

import { useEffect, useRef, useState } from "react";

export function InlineEdit({
  value, placeholder, onSave, multiline = false, maxLength = 60, style,
}: {
  value: string; placeholder: string; onSave: (v: string) => Promise<void>;
  multiline?: boolean; maxLength?: number; style?: React.CSSProperties;
}) {
  const [editing, setEditing] = useState(false);
  const [draft,   setDraft]   = useState(value);
  const [saving,  setSaving]  = useState(false);
  const ref = useRef<HTMLInputElement & HTMLTextAreaElement>(null);

  useEffect(() => { if (editing && ref.current) ref.current.focus(); }, [editing]);

  async function save() {
    if (draft.trim() === value) { setEditing(false); return; }
    setSaving(true);
    try { await onSave(draft.trim()); setEditing(false); }
    finally { setSaving(false); }
  }

  if (!editing) {
    return (
      <span
        onClick={() => { setDraft(value); setEditing(true); }}
        title="Cliquer pour modifier"
        style={{ cursor: "text", borderBottom: "1px dashed var(--border)", paddingBottom: 1, ...style }}
      >
        {value || <span style={{ color: "var(--text3)" }}>{placeholder}</span>}
      </span>
    );
  }

  const commonProps = {
    value: draft, maxLength, disabled: saving,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setDraft(e.target.value),
    onKeyDown: (e: React.KeyboardEvent) => {
      if (!multiline && e.key === "Enter") { e.preventDefault(); save(); }
      if (e.key === "Escape") { setDraft(value); setEditing(false); }
    },
    style: {
      border: "1px solid var(--accent)", borderRadius: 6,
      padding: "0.25rem 0.5rem", background: "var(--bg)",
      color: "var(--text)", fontSize: "inherit", fontFamily: "inherit",
      fontWeight: "inherit", width: "100%", outline: "none",
      resize: multiline ? ("vertical" as const) : ("none" as const), ...style,
    },
  };

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: "0.5rem", width: "100%" }}>
      {multiline
        ? <textarea ref={ref as React.RefObject<HTMLTextAreaElement>} rows={3} {...commonProps} />
        : <input    ref={ref as React.RefObject<HTMLInputElement>}             {...commonProps} />}
      <button
        onClick={save} disabled={saving}
        style={{
          padding: "0.2rem 0.6rem", borderRadius: 5, border: "none",
          background: "var(--accent)", color: "#fff", fontSize: "0.75rem",
          cursor: "pointer", flexShrink: 0, opacity: saving ? 0.6 : 1,
        }}
      >
        {saving ? "…" : "✓"}
      </button>
    </span>
  );
}
