"use client";

import { useEffect, useRef, useState, useCallback } from "react";

type LogEventType = "BLOCK_MINED" | "VALIDATION_PENDING" | "VALIDATION_VOTE" | "CHAIN_EMPTY";

type LogEvent = {
  id: string;
  type: LogEventType;
  ts: number;
  screen?: string;
  blockIndex?: number;
  artistName?: string;
  workTitle?: string;
  drawScore?: number;
  score?: number;
  validatorCount?: number;
  poolSize?: number;
  message: string;
};

const POLL_MS = 5000;

const SCREEN_COLOR: Record<string, string> = {
  eink29bwr: "#f87171",
  eink27bw:  "#94a3b8",
  oled096:   "#60a5fa",
  tft18:     "#fbbf24",
};

function fmtTime(ts: number): string {
  const d = new Date(ts);
  return [
    String(d.getHours()).padStart(2, "0"),
    String(d.getMinutes()).padStart(2, "0"),
    String(d.getSeconds()).padStart(2, "0"),
  ].join(":");
}

function EventLine({ ev }: { ev: LogEvent }) {
  const sc = ev.screen ? (SCREEN_COLOR[ev.screen] ?? "#a2a3bb") : null;

  let content: React.ReactNode;

  switch (ev.type) {
    case "BLOCK_MINED":
      content = (
        <>
          <span className="gterm__tag" style={{ color: "#4ade80" }}>MINED</span>
          {ev.screen && <span className="gterm__tag" style={{ color: sc! }}>{ev.screen}</span>}
          {ev.blockIndex !== undefined && (
            <span className="gterm__seg gterm__seg--accent">#{ev.blockIndex}</span>
          )}
          {ev.artistName && <span className="gterm__seg">{ev.artistName}</span>}
          {ev.workTitle && ev.workTitle !== "Sans titre" && (
            <span className="gterm__seg gterm__seg--muted">&quot;{ev.workTitle}&quot;</span>
          )}
          {ev.drawScore !== undefined && (
            <span className="gterm__seg gterm__seg--dim">PoD&nbsp;{(ev.drawScore * 100).toFixed(0)}%</span>
          )}
          {ev.validatorCount !== undefined && (
            <span className="gterm__seg gterm__seg--dim">{ev.validatorCount}&nbsp;validateurs</span>
          )}
        </>
      );
      break;

    case "VALIDATION_PENDING":
      content = (
        <>
          <span className="gterm__tag" style={{ color: "#fbbf24" }}>VALIDATE</span>
          {ev.screen && <span className="gterm__tag" style={{ color: sc! }}>{ev.screen}</span>}
          {ev.artistName && <span className="gterm__seg">{ev.artistName}</span>}
          {ev.workTitle && ev.workTitle !== "Sans titre" && (
            <span className="gterm__seg gterm__seg--muted">&quot;{ev.workTitle}&quot;</span>
          )}
          <span className="gterm__seg gterm__seg--dim">
            {ev.validatorCount ?? 0}/{ev.poolSize ?? "?"}&nbsp;votes
          </span>
          {ev.drawScore !== undefined && (
            <span className="gterm__seg gterm__seg--dim">PoD&nbsp;{(ev.drawScore * 100).toFixed(0)}%</span>
          )}
        </>
      );
      break;

    case "VALIDATION_VOTE":
      content = (
        <>
          <span className="gterm__tag" style={{ color: "#a78bfa" }}>VOTE</span>
          {ev.screen && <span className="gterm__tag" style={{ color: sc! }}>{ev.screen}</span>}
          <span className="gterm__seg gterm__seg--dim">{ev.message.replace(/^VOTE\s*·?\s*/, "")}</span>
        </>
      );
      break;

    default:
      content = <span className="gterm__seg gterm__seg--dim">{ev.message}</span>;
  }

  return (
    <div className="gterm__line">
      <span className="gterm__ts">[{fmtTime(ev.ts)}]</span>
      <span className="gterm__line-body">{content}</span>
    </div>
  );
}

// ─── Hook partagé pour les events (peut être instancié plusieurs fois) ─────

function useTerminalEvents() {
  const [events, setEvents]       = useState<LogEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const seenIds   = useRef<Set<string>>(new Set());
  const pausedRef = useRef(false);

  const fetchEvents = useCallback(async (paused: boolean) => {
    pausedRef.current = paused;
    try {
      const r = await fetch("/api/network/activity-log", { cache: "no-store" });
      if (!r.ok) return;
      const data = await r.json();
      setConnected(true);
      if (pausedRef.current) return;

      const incoming: LogEvent[] = (data.events ?? []).filter(
        (e: LogEvent) => !seenIds.current.has(e.id)
      );
      if (incoming.length === 0) return;
      // Tri par timestamp croissant → affichage en ordre chronologique (plus récent en bas)
      incoming.sort((a, b) => a.ts - b.ts);
      incoming.forEach((e) => seenIds.current.add(e.id));
      setEvents((prev) => [...prev, ...incoming].slice(-200));
    } catch {
      setConnected(false);
    }
  }, []);

  return { events, connected, seenIds, fetchEvents };
}

// ─── Terminal standalone (pleine largeur, sous la carte réseau) ─────────────

export function GlobalTerminal() {
  const [paused, setPaused]   = useState(false);
  const [active, setActive]   = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const bodyRef      = useRef<HTMLDivElement>(null);
  const { events, connected, seenIds, fetchEvents } = useTerminalEvents();

  // Polling
  useEffect(() => {
    fetchEvents(false);
    const id = setInterval(() => fetchEvents(paused), POLL_MS);
    return () => clearInterval(id);
  }, [fetchEvents, paused]);

  // Auto-scroll vers le bas uniquement quand actif et pas en pause
  useEffect(() => {
    if (!active || paused) return;
    const body = bodyRef.current;
    if (body) body.scrollTop = body.scrollHeight;
  }, [events, active, paused]);

  // Clic en dehors ou ESC → désactiver
  useEffect(() => {
    if (!active) return;
    const handleOutside = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setActive(false);
    };
    const handleEsc = (e: KeyboardEvent) => { if (e.key === "Escape") setActive(false); };
    document.addEventListener("mousedown", handleOutside);
    document.addEventListener("keydown",   handleEsc);
    return () => {
      document.removeEventListener("mousedown", handleOutside);
      document.removeEventListener("keydown",   handleEsc);
    };
  }, [active]);

  const handleClear = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    seenIds.current.clear();
    // reset events via fetchEvents → on vide et refetch
    fetchEvents(false);
  }, [fetchEvents, seenIds]);

  return (
    <div
      ref={containerRef}
      className={`gterm${active ? " gterm--active" : ""}`}
      onClick={() => !active && setActive(true)}
      tabIndex={0}
      onFocus={() => !active && setActive(true)}
      title={active ? undefined : "Cliquer pour interagir"}
      role="region"
      aria-label="Journal des événements réseau"
    >
      {/* Barre de titre — style terminal Linux */}
      <div className="gterm__bar">
        <span className="gterm__prompt">
          <span className="gterm__prompt-user">pod</span>
          <span className="gterm__prompt-sep">@</span>
          <span className="gterm__prompt-host">core</span>
          <span className="gterm__prompt-cmd">:~$ event-log</span>
        </span>
        <div className="gterm__bar-right">
          <span className={`gterm__live${connected ? " gterm__live--on" : ""}`}>
            {connected ? "● LIVE" : "○ CONNECTING"}
          </span>
          {active && (
            <>
              <button
                className="gterm__btn"
                onClick={(e) => { e.stopPropagation(); setPaused((v) => !v); }}
                title={paused ? "Reprendre" : "Pause"}
              >
                {paused ? "▶ resume" : "⏸ pause"}
              </button>
              <button className="gterm__btn" onClick={handleClear}>clr</button>
              <button
                className="gterm__btn gterm__btn--close"
                onClick={(e) => { e.stopPropagation(); setActive(false); }}
                title="Déverrouiller (ESC)"
              >
                esc
              </button>
            </>
          )}
        </div>
      </div>

      {/* Corps */}
      <div
        ref={bodyRef}
        className="gterm__body"
        style={{ overflowY: active ? "auto" : "hidden", pointerEvents: active ? "auto" : "none" }}
      >
        {events.length === 0 && (
          <div className="gterm__line gterm__line--muted">
            <span className="gterm__ts">[--:--:--]</span>
            <span className="gterm__line-body">
              <span className="gterm__seg gterm__seg--dim">waiting for network events…</span>
            </span>
          </div>
        )}
        {events.slice(-40).map((ev) => <EventLine key={ev.id} ev={ev} />)}

        {/* Curseur clignotant */}
        <div className="gterm__line gterm__line--prompt">
          <span className="gterm__seg gterm__seg--dim">
            {paused ? "⏸" : connected ? "⠿" : "○"}&nbsp;{paused ? "paused" : connected ? "listening…" : "connecting to redis core…"}
          </span>
          <span className="gterm__cursor">█</span>
        </div>
      </div>

      {/* Hint de déverrouillage — visible quand inactif */}
      {!active && (
        <div className="gterm__lock-hint" aria-hidden="true">
          ⏎ cliquer pour interagir
        </div>
      )}
    </div>
  );
}

// ─── Terminal compact (intégré dans le side panel) ──────────────────────────
export function GlobalTerminalPanel() {
  const [paused, setPaused]   = useState(false);
  const [active, setActive]   = useState(false);
  const [showAll, setShowAll] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const bodyRef      = useRef<HTMLDivElement>(null);
  const { events, connected, fetchEvents } = useTerminalEvents();

  const visibleEvents = showAll ? events.slice(-200) : events.slice(-10);

  useEffect(() => {
    fetchEvents(false);
    const id = setInterval(() => fetchEvents(paused), POLL_MS);
    return () => clearInterval(id);
  }, [fetchEvents, paused]);

  useEffect(() => {
    if (!active || paused) return;
    const body = bodyRef.current;
    if (body) body.scrollTop = body.scrollHeight;
  }, [visibleEvents, active, paused]);

  useEffect(() => {
    if (!active) return;
    const handleOutside = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setActive(false);
    };
    const handleEsc = (e: KeyboardEvent) => { if (e.key === "Escape") setActive(false); };
    document.addEventListener("mousedown", handleOutside);
    document.addEventListener("keydown", handleEsc);
    return () => {
      document.removeEventListener("mousedown", handleOutside);
      document.removeEventListener("keydown", handleEsc);
    };
  }, [active]);

  return (
    <div
      ref={containerRef}
      className={`gterm gterm--panel${active ? " gterm--active" : ""}`}
      onClick={() => !active && setActive(true)}
      tabIndex={0}
      onFocus={() => !active && setActive(true)}
      title={active ? undefined : "Cliquer pour interagir"}
    >
      <div className="gterm__bar">
        <span className="gterm__prompt">
          <span className="gterm__prompt-user">pod</span>
          <span className="gterm__prompt-sep">@</span>
          <span className="gterm__prompt-host">core</span>
          <span className="gterm__prompt-cmd">:~$ events</span>
        </span>
        <div className="gterm__bar-right">
          <span className={`gterm__live${connected ? " gterm__live--on" : ""}`}>
            {connected ? "●" : "○"}
          </span>
          {/* Bascule "10 derniers / tout" — dans la barre de titre plutôt qu'en
              pied de composant : un bouton sous le corps faisait grandir le
              terminal et le décalait par rapport à la topologie réseau (même
              hauteur visée, cf. align-items:stretch côté NetworkMap). Ici, la
              hauteur du composant ne change jamais. */}
          {events.length > 10 && (
            <button
              className="gterm__btn gterm__btn--more"
              onClick={(e) => {
                e.stopPropagation();
                setShowAll((v) => !v);
              }}
              title={showAll ? "Afficher seulement les 10 derniers" : `Afficher tout (${events.length})`}
            >
              {showAll ? "▴ 10" : `▾ ${events.length}`}
            </button>
          )}
          {active && (
            <button
              className="gterm__btn"
              onClick={(e) => {
                e.stopPropagation();
                setPaused((v) => !v);
              }}
            >
              {paused ? "▶" : "⏸"}
            </button>
          )}
        </div>
      </div>

      <div
        ref={bodyRef}
        className="gterm__body"
        style={{ overflowY: active ? "auto" : "hidden", pointerEvents: active ? "auto" : "none" }}
      >
        {events.length === 0 && (
          <div className="gterm__line gterm__line--muted">
            <span className="gterm__ts">[--:--:--]</span>
            <span className="gterm__line-body">
              <span className="gterm__seg gterm__seg--dim">en attente…</span>
            </span>
          </div>
        )}

        {visibleEvents.map((ev) => <EventLine key={ev.id} ev={ev} />)}

        <div className="gterm__line gterm__line--prompt">
          <span className="gterm__cursor">█</span>
        </div>
      </div>

      {!active && (
        <div className="gterm__lock-hint" aria-hidden="true">⏎</div>
      )}
    </div>
  );

}
