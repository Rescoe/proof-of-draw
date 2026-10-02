"use client";

// app/gallery-ana/AnaWorkDetail.tsx
// Détail d'une œuvre d'agent IA — remplace BlockDetail (Détails/Actions/Replay,
// pensé pour un dessin humain avec séquence d'actions) par des onglets adaptés :
//   Écrans      → la conversion du même dessin pour chaque type d'écran
//   Œuvre       → cartel de l'agent, brief, proposition
//   Provenance  → agent, burns honorés, vote de modération, traces on-chain

import { useEffect, useRef, useState, useCallback } from "react";
import { BlockFrameCanvas } from "../BlockFrameCanvas";
import { SendToScreen } from "../SendToScreen";
import type { AnaWork } from "@/lib/anaChain";
import { ScenePreview } from "./ScenePreview";

const SCREEN_LABELS: Record<string, string> = {
  eink29bwr: 'E-Ink 2.9" BWR',
  eink27bw:  'E-Ink 2.7" BW',
  oled096:   'OLED 0.96"',
  tft18:     'TFT 1.8" RGB',
  tft28:     'TFT 2.8" tactile',
};

const KIND_LABELS: Record<string, string> = {
  celebration: "Mémorial de burn",
  spontaneous: "Dessin spontané",
};

const MEMORIAL_KIND_LABELS: Record<string, string> = {
  batch:     "Lot de burns",
  requested: "Mémorial demandé",
  milestone: "Monument (palier)",
};

type Tab = "screens" | "scene" | "work" | "provenance";

function formatDate(ts: number): string {
  return new Date(ts).toLocaleString("fr-FR", {
    day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="aw-row">
      <span className="aw-row__label">{label}</span>
      <span className="aw-row__value">{children}</span>
    </div>
  );
}

function ScreensTab({ work }: { work: AnaWork }) {
  return (
    <div>
      <p className="aw-note">
        Un seul dessin source, converti au format de chaque type d&apos;écran (recadrage sans déformation,
        encre noire ; ANA ne produit pas de couleur). Chaque conversion est un bloc distinct.
      </p>
      <div className="aw-screens">
        {work.screens.map((s) => (
          <div key={s.blockHash} className="aw-screen">
            <div className="aw-screen__label">{SCREEN_LABELS[s.screen] ?? s.screen}</div>
            <div className="aw-screen__canvas">
              {s.imagePayload ? (
                <BlockFrameCanvas
                  payload={s.imagePayload}
                  blockHash={s.blockHash}
                  blockIndex={s.blockIndex}
                  showDownload
                />
              ) : (
                <span className="aw-muted">Image indisponible</span>
              )}
            </div>
            <code className="aw-screen__hash">#{s.blockIndex} · {s.blockHash.slice(0, 12)}…</code>
          </div>
        ))}
      </div>
      {work.screens.length > 0 && <SendToScreen source="ana" blockHash={work.screens[0].blockHash} />}
    </div>
  );
}

/** Visage 40×40 du Normie auteur (200 octets MSB-first, base64 ; 1 = encre), agrandi sans lissage. */
function NormieFace({ packed, name }: { packed: string; name: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current; if (!c) return;
    const bin = atob(packed), ctx = c.getContext("2d"); if (!ctx) return;
    const img = ctx.createImageData(40, 40);
    for (let i = 0; i < 1600; i++) {
      const on = (bin.charCodeAt(i >> 3) >> (7 - (i & 7))) & 1;
      const v = on ? 20 : 240;
      img.data[i * 4] = v; img.data[i * 4 + 1] = v; img.data[i * 4 + 2] = v; img.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  }, [packed]);
  return <canvas ref={ref} width={40} height={40} aria-label={`Portrait de ${name}`}
    style={{ width: 80, height: 80, imageRendering: "pixelated", borderRadius: 8, border: "1px solid var(--border)", flexShrink: 0 }} />;
}

function WorkTab({ work }: { work: AnaWork }) {
  const m = work.meta;
  if (!m) {
    return <p className="aw-muted">Le contexte de cette œuvre (cartel, brief…) n&apos;a pas encore été récupéré depuis l&apos;ANA — il apparaîtra après la prochaine vérification.</p>;
  }
  const hasAny = m.text || m.cartelText || m.brief || m.proposal || m.decisionNote;
  return (
    <div className="aw-work">
      <div style={{ display: "flex", gap: "0.9rem", alignItems: "center" }}>
        {m.avatar && <NormieFace packed={m.avatar} name={work.agentName} />}
        <h3 className="aw-work__title" style={{ margin: 0 }}>{m.title}</h3>
      </div>
      {m.text && (
        <section>
          <div className="aw-section-title">{m.artForm ? `Poème (${m.artForm})` : "Poème"}</div>
          <p className="aw-text" style={{ whiteSpace: "pre-wrap" }}>{m.text}</p>
        </section>
      )}
      {m.cartelText && (
        <section>
          <div className="aw-section-title">Cartel de l&apos;agent</div>
          <blockquote className="aw-quote">{m.cartelText}</blockquote>
        </section>
      )}
      {m.brief && (
        <section>
          <div className="aw-section-title">Brief artistique</div>
          <p className="aw-text">{m.brief}</p>
        </section>
      )}
      {m.proposal && (
        <section>
          <div className="aw-section-title">Proposition</div>
          <p className="aw-text">{m.proposal}</p>
        </section>
      )}
      {m.decisionNote && (
        <section>
          <div className="aw-section-title">Note de modération</div>
          <p className="aw-text">{m.decisionNote}</p>
        </section>
      )}
      {!hasAny && <p className="aw-muted">Aucun texte associé à cette œuvre.</p>}
    </div>
  );
}

function ProvenanceTab({ work }: { work: AnaWork }) {
  const m = work.meta;
  const totalVotes = m ? (m.yesCount ?? 0) + (m.noCount ?? 0) + (m.absCount ?? 0) : 0;
  return (
    <div className="aw-meta">
      <Row label="Agent">{work.agentName} · Normie #{work.agentTokenId}</Row>
      <Row label="Type">{m ? KIND_LABELS[m.kind] ?? m.kind : "—"}</Row>
      {m?.memorialKind && <Row label="Mémorial">{MEMORIAL_KIND_LABELS[m.memorialKind] ?? m.memorialKind}</Row>}
      {m?.burnedTokenIds && m.burnedTokenIds.length > 0 && (
        <Row label={m.memorialKind === "milestone" ? "Burns (échantillon)" : "Normies honorés"}>
          {m.burnedTokenIds.map((id) => `#${id}`).join(", ")}
        </Row>
      )}
      {m?.totalBurnedHonored != null && <Row label="Burns honorés">{m.totalBurnedHonored}</Row>}
      <Row label="Publié le">{formatDate(work.publishedAt)}</Row>
      {m?.voteResult && (
        <Row label="Modération (vote)">
          {m.voteResult === "passed" ? "✓ Approuvée" : "✗ Rejetée"}
          {totalVotes > 0 && ` — ${m.yesCount ?? 0} pour · ${m.noCount ?? 0} contre · ${m.absCount ?? 0} abst.`}
        </Row>
      )}
      {m?.revisionCount ? <Row label="Révisions">{m.revisionCount}</Row> : null}
      {m?.onChainWorkId != null && <Row label="WorkRegistry">#{m.onChainWorkId}</Row>}
      {m?.txHash && (
        <Row label="Transaction">
          <a className="aw-link" href={`https://basescan.org/tx/${m.txHash}`} target="_blank" rel="noreferrer">
            {m.txHash.slice(0, 12)}…
          </a>
        </Row>
      )}
      {m?.collectionAddress && (
        <Row label="Collection">
          <a className="aw-link" href={`https://basescan.org/address/${m.collectionAddress}`} target="_blank" rel="noreferrer">
            {m.collectionAddress.slice(0, 10)}…
          </a>
        </Row>
      )}
      {m?.sourceId && <Row label="ID ANA"><code>{m.sourceId}</code></Row>}
      <Row label="Blocs">
        {work.screens.map((s) => `${SCREEN_LABELS[s.screen] ?? s.screen} #${s.blockIndex}`).join(" · ")}
      </Row>
    </div>
  );
}

export function AnaWorkDetail({ groupKey, initial, onClose }: {
  groupKey: string;
  initial: AnaWork;          // version liste (aperçu seulement) affichée pendant le chargement
  onClose: () => void;
}) {
  const [work, setWork]   = useState<AnaWork>(initial);
  const [loading, setLoading] = useState(true);
  const [tab, setTab]     = useState<Tab>("screens");

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/blocks-ana/work?key=${encodeURIComponent(groupKey)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (!cancelled && d?.work) setWork(d.work); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [groupKey]);

  const onKey = useCallback((e: KeyboardEvent) => { if (e.key === "Escape") onClose(); }, [onClose]);
  useEffect(() => {
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onKey]);

  const tabs: { id: Tab; label: string }[] = [
    { id: "screens",    label: `Écrans (${work.screens.length})` },
    ...(work.meta?.scene ? [{ id: "scene" as Tab, label: work.meta.scene.status === "ok" ? "Scène" : "Scène ⚠" }] : []),
    { id: "work",       label: "Œuvre" },
    { id: "provenance", label: "Provenance" },
  ];

  return (
    <div className="aw-backdrop" onClick={onClose} role="dialog" aria-modal="true">
      <div className="aw-modal" onClick={(e) => e.stopPropagation()}>
        <div className="aw-head">
          <div>
            <div className="aw-head__title">{work.title && work.title !== "Sans titre" ? work.title : "Œuvre sans titre"}</div>
            <div className="aw-head__sub">{work.agentName} · {formatDate(work.publishedAt)}</div>
          </div>
          <button className="aw-close" onClick={onClose} aria-label="Fermer">✕</button>
        </div>

        <div className="aw-tabs" role="tablist">
          {tabs.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              className={`aw-tab${tab === t.id ? " aw-tab--on" : ""}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="aw-body">
          {loading && tab === "screens" && work.screens.every((s) => !s.imagePayload) && (
            <p className="aw-muted">Chargement des conversions…</p>
          )}
          {tab === "screens"    && <ScreensTab work={work} />}
          {tab === "scene"      && work.meta?.scene && <ScenePreview scene={work.meta.scene} />}
          {tab === "work"       && <WorkTab work={work} />}
          {tab === "provenance" && <ProvenanceTab work={work} />}
        </div>
      </div>

      <style>{`
        .aw-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,0.65); z-index: 100; display: flex; align-items: center; justify-content: center; padding: 16px; }
        .aw-modal { background: var(--bg2, #1e2533); border: 1px solid rgba(124,107,255,0.25); border-radius: 14px; width: 100%; max-width: 720px; max-height: 90dvh; display: flex; flex-direction: column; overflow: hidden; }
        .aw-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; padding: 16px 18px 10px; }
        .aw-head__title { font-size: 17px; font-weight: 700; color: var(--text1, #f1f5f9); }
        .aw-head__sub { font-size: 12px; color: var(--text3, #64748b); margin-top: 2px; }
        .aw-close { background: none; border: none; color: var(--text3, #64748b); font-size: 16px; cursor: pointer; padding: 4px 8px; }
        .aw-tabs { display: flex; gap: 4px; padding: 0 14px; border-bottom: 1px solid rgba(255,255,255,0.07); }
        .aw-tab { background: none; border: none; border-bottom: 2px solid transparent; color: var(--text3, #64748b); font-size: 13px; font-weight: 600; padding: 8px 12px; cursor: pointer; }
        .aw-tab--on { color: var(--text1, #f1f5f9); border-bottom-color: var(--accent, #7c6bff); }
        .aw-body { padding: 16px 18px 20px; overflow-y: auto; }
        .aw-note { font-size: 12px; color: var(--text3, #64748b); line-height: 1.6; margin: 0 0 14px; }
        .aw-muted { font-size: 12px; color: var(--text3, #64748b); }
        .aw-screens { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 14px; }
        .aw-screen { background: var(--bg3, #151c2c); border: 1px solid rgba(255,255,255,0.06); border-radius: 10px; padding: 10px; display: flex; flex-direction: column; align-items: center; gap: 8px; }
        .aw-screen__label { font-size: 12px; font-weight: 700; color: var(--text1, #f1f5f9); align-self: flex-start; }
        .aw-screen__canvas { display: flex; align-items: center; justify-content: center; min-height: 64px; max-width: 100%; }
        .aw-screen__hash { font-size: 10px; color: var(--text3, #64748b); align-self: flex-start; }
        .aw-work { display: flex; flex-direction: column; gap: 16px; }
        .aw-work__title { margin: 0; font-size: 16px; color: var(--text1, #f1f5f9); }
        .aw-section-title { font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text3, #64748b); margin-bottom: 6px; }
        .aw-quote { margin: 0; padding: 4px 0 4px 12px; border-left: 2px solid var(--accent, #7c6bff); font-style: italic; color: var(--text2, #94a3b8); font-size: 13px; line-height: 1.65; white-space: pre-wrap; }
        .aw-text { margin: 0; font-size: 13px; color: var(--text2, #94a3b8); line-height: 1.65; white-space: pre-wrap; }
        .aw-meta { display: flex; flex-direction: column; }
        .aw-row { display: flex; gap: 14px; padding: 7px 0; border-bottom: 1px solid rgba(255,255,255,0.05); font-size: 13px; }
        .aw-row__label { flex: 0 0 150px; color: var(--text3, #64748b); }
        .aw-row__value { color: var(--text1, #f1f5f9); min-width: 0; overflow-wrap: anywhere; }
        .aw-row__value code { font-size: 11px; }
        .aw-link { color: var(--accent, #7c6bff); text-decoration: none; }
        @media (max-width: 520px) { .aw-row { flex-direction: column; gap: 2px; } .aw-row__label { flex: none; } }
      `}</style>
    </div>
  );
}
