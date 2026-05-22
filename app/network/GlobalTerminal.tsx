"use client";

import { useEffect, useRef, useState, useCallback } from "react";

type LogEventType = "BLOCK_MINED" | "VALIDATION_PENDING" | "VALIDATION_VOTE" | "CHAIN_EMPTY";

type LogEvent = {
  id: string;
  type: LogEventType;
  ts: number;
  screen?: string;
  // Champs structurés pour un rendu propre
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

const TYPE_COLOR: Record<LogEventType, string> = {
  BLOCK_MINED:        "#4ade80",
  VALIDATION_PENDING: "#fbbf24",
  VALIDATION_VOTE:    "#a78bfa",
  CHAIN_EMPTY:        "#475569",
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
          {ev.artistName && (
            <span className="gterm__seg">{ev.artistName}</span>
          )}
          {ev.workTitle && ev.workTitle !== "Sans titre" && (
            <span className="gterm__seg gterm__seg--muted">&quot;{ev.workTitle}&quot;</span>
          )}
          {ev.drawScore !== undefined && (
            <span className="gterm__seg gterm__seg--dim">
              PoD&nbsp;{(ev.drawScore * 100).toFixed(0)}%
            </span>
          )}
          {ev.validatorCount !== undefined && (
            <span className="gterm__seg gterm__seg--dim">
              {ev.validatorCount}&nbsp;validateurs
            </span>
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
            <span className="gterm__seg gterm__seg--dim">
              PoD&nbsp;{(ev.drawScore * 100).toFixed(0)}%
            </span>
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

export function GlobalTerminal() {
  const [events, setEvents]       = useState<LogEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const [paused, setPaused]       = useState(false);
  const seenIds   = useRef<Set<string>>(new Set());
  const pausedRef = useRef(false);
  pausedRef.current = paused;

  const fetchEvents = useCallback(async () => {
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
      incoming.forEach((e) => seenIds.current.add(e.id));
      setEvents((prev) => [...incoming, ...prev].slice(0, 200));
    } catch {
      setConnected(false);
    }
  }, []);

  useEffect(() => {
    fetchEvents();
    const id = setInterval(fetchEvents, POLL_MS);
    return () => clearInterval(id);
  }, [fetchEvents]);

  return (
    <div className="gterm">
      {/* Barre de titre */}
      <div className="gterm__bar">
        <div className="gterm__bar-dots">
          <span className="gterm__dot gterm__dot--red" />
          <span className="gterm__dot gterm__dot--yellow" />
          <span className="gterm__dot gterm__dot--green" />
        </div>
        <span className="gterm__title">proof-of-draw — global event log</span>
        <div className="gterm__bar-actions">
          <span className={`gterm__status${connected ? " gterm__status--on" : ""}`}>
            {connected ? "● LIVE" : "○ CONNECTING"}
          </span>
          <button className="gterm__btn" onClick={() => setPaused((v) => !v)}>
            {paused ? "▶ resume" : "⏸ pause"}
          </button>
          <button className="gterm__btn" onClick={() => { seenIds.current.clear(); setEvents([]); fetchEvents(); }}>
            clear
          </button>
        </div>
      </div>

      {/* Corps */}
      <div className="gterm__body">
        <div className="gterm__line gterm__line--prompt">
          <span className="gterm__cursor">█</span>
          <span className="gterm__seg gterm__seg--dim">
            {connected ? (paused ? "paused" : "listening…") : "connecting to redis core…"}
          </span>
        </div>

        {events.length === 0 && connected && !paused && (
          <div className="gterm__line gterm__line--muted">
            <span className="gterm__ts">[--:--:--]</span>
            <span className="gterm__line-body">
              <span className="gterm__seg gterm__seg--dim">waiting for network events…</span>
            </span>
          </div>
        )}

        {events.map((ev) => <EventLine key={ev.id} ev={ev} />)}
      </div>
    </div>
  );
}
