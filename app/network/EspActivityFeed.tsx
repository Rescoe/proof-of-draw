"use client";

// ─── Journal réseau (accueil) ────────────────────────────────────────────────
// Synthèse, côté serveur, de ce qu'un ESP afficherait sur son moniteur série
// (Serial.print) lors des échanges réels avec le serveur — agrégée pour TOUS
// les devices du réseau. Aucune donnée sensible (mac, pairCode, payload image…)
// n'est utilisée : on ne fait que reformater /api/network/activity-log (déjà
// interrogée par le terminal pod-core) au format "[TAG] message" façon Serial.
//
// Aucune requête supplémentaire n'est ajoutée : on réutilise le même hook/poll
// que GlobalTerminal/GlobalTerminalPanel.

import { useEffect, useRef, useState, useCallback } from "react";

type LogEventType = "BLOCK_MINED" | "VALIDATION_PENDING" | "VALIDATION_VOTE" | "CHAIN_EMPTY";

type LogEvent = {
  id: string;
  type: LogEventType;
  ts: number;
  screen?: string;
  blockIndex?: number;
  blockHash?: string;
  artistName?: string;
  workTitle?: string;
  drawScore?: number;
  score?: number;
  validatorCount?: number;
  poolSize?: number;
  message: string;
};

type EspLine = {
  id: string;
  ts: number;
  tag: string;
  tagColor: string;
  text: string;
};

const POLL_MS = 5000;

const TAG_COLOR: Record<string, string> = {
  PULL:       "#60a5fa",
  FETCHFRAME: "#4ade80",
  VALIDATE:   "#fbbf24",
  HTTP:       "#a2a3bb",
};

function fmtTime(ts: number): string {
  const d = new Date(ts);
  return [
    String(d.getHours()).padStart(2, "0"),
    String(d.getMinutes()).padStart(2, "0"),
    String(d.getSeconds()).padStart(2, "0"),
  ].join(":");
}

// Pseudo-identifiant d'ESP synthétique — dérivé du type d'écran, jamais du
// véritable deviceId/MAC (pas de donnée sensible exposée).
function pseudoEsp(screen?: string): string {
  return screen ? `esp-${screen}` : "esp-?";
}

// Reformate un évènement de /api/network/activity-log au format
// "[TAG] message" tel qu'il apparaîtrait dans Serial.print() côté firmware
// (cf. esp_eink_2.9BWR.ino doFetchFrame / doPull / doValidate).
function toEspLines(ev: LogEvent): EspLine[] {
  const esp = pseudoEsp(ev.screen);

  switch (ev.type) {
    case "BLOCK_MINED": {
      const hash = (ev.blockHash ?? "").slice(0, 10);
      return [
        {
          id: `${ev.id}-pull`,
          ts: ev.ts,
          tag: "PULL",
          tagColor: TAG_COLOR.PULL,
          text: `${esp} ▸ Nouveau bloc #${ev.blockIndex} hash=${hash}…`,
        },
        {
          id: `${ev.id}-fetch`,
          ts: ev.ts + 1,
          tag: "FETCHFRAME",
          tagColor: TAG_COLOR.FETCHFRAME,
          text: `${esp} ▸ ✅ affichée frameId=${ev.id.slice(0, 14)}… source=consensus`,
        },
      ];
    }

    case "VALIDATION_PENDING": {
      const cid = ev.id.replace(/^candidate-/, "").slice(0, 10);
      return [
        {
          id: `${ev.id}-pending`,
          ts: ev.ts,
          tag: "VALIDATE",
          tagColor: TAG_COLOR.VALIDATE,
          text: `${esp} ▸ candidateId=${cid}… score=${(ev.drawScore ?? 0).toFixed(3)} (${ev.validatorCount ?? 0}/${ev.poolSize ?? "?"} votes)`,
        },
      ];
    }

    case "VALIDATION_VOTE": {
      const m = ev.message.match(/score\s+(\d+)%/);
      const score = m ? `0.${m[1].padStart(2, "0")}` : "?";
      return [
        {
          id: `${ev.id}-vote`,
          ts: ev.ts,
          tag: "VALIDATE",
          tagColor: TAG_COLOR.VALIDATE,
          text: `${esp} ▸ Vote OK · score=${score}`,
        },
      ];
    }

    default:
      return [];
  }
}

function useEspLines() {
  const [lines, setLines]         = useState<EspLine[]>([]);
  const [connected, setConnected] = useState(false);
  const seenIds   = useRef<Set<string>>(new Set());
  const pausedRef = useRef(false);

  const fetchEvents = useCallback(async (paused: boolean) => {
    pausedRef.current = paused;
    try {
      // Même endpoint que pod-core — pas de requête additionnelle introduite.
      const r = await fetch("/api/network/activity-log", { cache: "no-store" });
      if (!r.ok) return;
      const data = await r.json();
      setConnected(true);
      if (pausedRef.current) return;

      const incoming: LogEvent[] = (data.events ?? []).filter(
        (e: LogEvent) => !seenIds.current.has(e.id)
      );
      if (incoming.length === 0) return;
      incoming.sort((a, b) => a.ts - b.ts);

      const nextLines: EspLine[] = [];
      for (const ev of incoming) {
        seenIds.current.add(ev.id);
        nextLines.push(...toEspLines(ev));
      }
      if (nextLines.length === 0) return;
      // 20 dernières lignes — au-delà, le journal devient un mur de texte
      // difficile à suivre (cf. retour : "trop dense")
      setLines((prev) => [...prev, ...nextLines].slice(-20));
    } catch {
      setConnected(false);
    }
  }, []);

  return { lines, connected, fetchEvents };
}

export function EspActivityFeed() {
  const [active, setActive] = useState(false);
  // Repliable — notamment sur mobile, où le journal prenait avant de la place
  // en permanence (ou disparaissait totalement). Replié par défaut sur petit
  // écran : l'utilisateur l'ouvre s'il veut le consulter ("composant extensible").
  const [expanded, setExpanded] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);
  const bodyRef      = useRef<HTMLDivElement>(null);
  const { lines, connected, fetchEvents } = useEspLines();

  useEffect(() => {
    fetchEvents(false);
    const id = setInterval(() => fetchEvents(false), POLL_MS);
    return () => clearInterval(id);
  }, [fetchEvents]);

  useEffect(() => {
    const body = bodyRef.current;
    if (body) body.scrollTop = body.scrollHeight;
  }, [lines]);

  useEffect(() => {
    if (!active) return;
    const handleOutside = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setActive(false);
    };
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, [active]);

  return (
    <div
      ref={containerRef}
      className={`esp-feed${expanded ? "" : " esp-feed--collapsed"}`}
      onClick={() => setActive(true)}
      role="region"
      aria-label="Synthèse des échanges ESP ↔ serveur"
    >
      <div className="esp-feed__bar">
        <span className="esp-feed__title">
          <span className="esp-feed__dot" style={{ background: connected ? "#4ade80" : "#475569" }} />
          journal réseau · synthèse ESP (tous devices)
        </span>
        <span className="esp-feed__bar-right">
          <span className="esp-feed__hint">simulation Serial.print agrégée · 20 dernières lignes</span>
          <button
            className="esp-feed__toggle"
            onClick={(e) => { e.stopPropagation(); setExpanded((v) => !v); }}
            aria-expanded={expanded}
            aria-label={expanded ? "Replier le journal" : "Déplier le journal"}
          >
            {expanded ? "▾ replier" : "▸ déplier"}
          </button>
        </span>
      </div>
      {expanded && (
        <div ref={bodyRef} className="esp-feed__body">
          {lines.length === 0 && (
            <div className="esp-feed__line esp-feed__line--muted">
              en attente d&apos;échanges PULL / VALIDATE…
            </div>
          )}
          {lines.map((l) => (
            <div key={l.id} className="esp-feed__line">
              <span className="esp-feed__ts">{fmtTime(l.ts)}</span>
              <span className="esp-feed__tag" style={{ color: l.tagColor, borderColor: l.tagColor }}>
                {l.tag}
              </span>
              <span className="esp-feed__text">{l.text}</span>
            </div>
          ))}
          <div className="esp-feed__line esp-feed__line--muted">
            <span className="esp-feed__cursor">█</span>
          </div>
        </div>
      )}

      <style>{`
        .esp-feed {
          display: flex;
          flex-direction: column;
          /* Pleine largeur sous la carte réseau (cf. page.tsx) — une hauteur
             modérée suffit, le journal défile en interne comme un terminal.
             L'ancienne disposition en colonne étroite (360px) tronquait
             chaque ligne ; ici la largeur disponible rend tout lisible.
             Repliable (cf. bouton "replier") : la barre seule reste visible,
             la hauteur s'adapte alors automatiquement (height: auto). */
          height: 320px;
          min-height: 0;
          background: #0b0f1a;
          border: 1px solid rgba(255,255,255,0.06);
          border-radius: 16px;
          overflow: hidden;
          font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
          color: #cbd5e1;
        }
        .esp-feed--collapsed { height: auto; }
        .esp-feed__bar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 0.5rem;
          padding: 0.6rem 0.9rem;
          border-bottom: 1px solid rgba(255,255,255,0.06);
          background: rgba(255,255,255,0.02);
          font-size: 11px;
        }
        .esp-feed__title {
          display: flex;
          align-items: center;
          gap: 0.4rem;
          color: #94a3b8;
          font-weight: 600;
          letter-spacing: 0.02em;
        }
        .esp-feed__dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; }
        .esp-feed__bar-right { display: flex; align-items: center; gap: 0.6rem; flex-shrink: 0; }
        .esp-feed__hint { color: #475569; font-style: italic; white-space: nowrap; }
        .esp-feed__toggle {
          appearance: none;
          background: rgba(255,255,255,0.04);
          border: 1px solid rgba(255,255,255,0.08);
          border-radius: 0.4rem;
          color: #94a3b8;
          font-family: inherit;
          font-size: 10px;
          padding: 0.25rem 0.5rem;
          cursor: pointer;
          white-space: nowrap;
          transition: 120ms ease;
        }
        .esp-feed__toggle:hover { background: rgba(255,255,255,0.08); color: #ececf6; }
        .esp-feed__body {
          flex: 1;
          min-height: 0;
          overflow-y: auto;
          padding: 0.6rem 0.9rem;
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        /* Colonnes en grille (largeurs fixes horodatage/tag, "align-items:
           baseline" en flex faisait varier la hauteur de chaque ligne selon
           son contenu — le tag avec bordure/padding "poussait" le texte et
           les lignes finissaient par se chevaucher = "haché"/superposé.
           La grille fixe une hauteur de ligne identique pour toutes. */
        .esp-feed__line {
          display: grid;
          grid-template-columns: 4.4em 5.6em minmax(0, 1fr);
          align-items: center;
          column-gap: 0.6rem;
          min-height: 22px;
          font-size: 12px;
          line-height: 1.5;
        }
        .esp-feed__line--muted {
          display: block;
          color: #475569;
          font-style: italic;
        }
        .esp-feed__ts {
          color: #475569;
          font-variant-numeric: tabular-nums;
          white-space: nowrap;
        }
        .esp-feed__tag {
          justify-self: start;
          text-align: center;
          font-weight: 700;
          padding: 0.12em 5px;
          border: 1px solid;
          border-radius: 4px;
          font-size: 10px;
          letter-spacing: 0.03em;
          line-height: 1.4;
          white-space: nowrap;
        }
        .esp-feed__text {
          color: #cbd5e1;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          min-width: 0;
        }
        .esp-feed__cursor { animation: esp-blink 1.1s steps(1) infinite; }
        @keyframes esp-blink { 50% { opacity: 0; } }

        @media (max-width: 640px) {
          /* Le journal reste disponible sur mobile (replié par défaut via le
             bouton ▾/▸ — "composant extensible") plutôt que d'être masqué :
             juste l'indice de simulation est retiré pour gagner de la place. */
          .esp-feed__hint { display: none; }
          .esp-feed__line { font-size: 11px; }
        }
      `}</style>
    </div>
  );
}
