"use client";

import { useEffect, useRef, useState, useCallback } from "react";

type LogEventType = "BLOCK_MINED" | "VALIDATION_PENDING" | "VALIDATION_VOTE" | "CHAIN_EMPTY";

type LogEvent = {
  id: string;
  type: LogEventType;
  ts: number;
  screen?: string;
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

const TYPE_LABEL: Record<LogEventType, string> = {
  BLOCK_MINED:        "MINED    ",
  VALIDATION_PENDING: "VALIDATE ",
  VALIDATION_VOTE:    "VOTE     ",
  CHAIN_EMPTY:        "EMPTY    ",
};

function fmtTime(ts: number): string {
  const d = new Date(ts);
  return [
    String(d.getHours()).padStart(2, "0"),
    String(d.getMinutes()).padStart(2, "0"),
    String(d.getSeconds()).padStart(2, "0"),
  ].join(":");
}

export function GlobalTerminal() {
  const [events, setEvents]       = useState<LogEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const [paused, setPaused]       = useState(false);
  const seenIds   = useRef<Set<string>>(new Set());
  const listRef   = useRef<HTMLDivElement>(null);
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

      setEvents((prev) => {
        const next = [...incoming, ...prev].slice(0, 200);
        return next;
      });
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
          <button
            className="gterm__btn"
            onClick={() => setPaused((v) => !v)}
            title={paused ? "Reprendre" : "Pause"}
          >
            {paused ? "▶ resume" : "⏸ pause"}
          </button>
          <button
            className="gterm__btn"
            onClick={() => { seenIds.current.clear(); setEvents([]); fetchEvents(); }}
            title="Effacer"
          >
            clear
          </button>
        </div>
      </div>

      {/* Corps terminal */}
      <div className="gterm__body" ref={listRef}>
        {/* Curseur clignotant */}
        <div className="gterm__line gterm__line--prompt">
          <span className="gterm__cursor">█</span>
        </div>

        {events.length === 0 && connected && (
          <div className="gterm__line gterm__line--muted">
            {"> waiting for network events…"}
          </div>
        )}
        {!connected && (
          <div className="gterm__line gterm__line--muted">
            {"> connecting to redis core…"}
          </div>
        )}

        {events.map((ev) => (
          <div key={ev.id} className="gterm__line">
            <span className="gterm__ts">[{fmtTime(ev.ts)}]</span>
            {" "}
            <span className="gterm__type" style={{ color: TYPE_COLOR[ev.type] }}>
              {TYPE_LABEL[ev.type]}
            </span>
            {" "}
            {ev.screen && (
              <>
                <span className="gterm__screen" style={{ color: SCREEN_COLOR[ev.screen] ?? "#a2a3bb" }}>
                  {ev.screen}
                </span>
                {"  "}
              </>
            )}
            <span className="gterm__msg">{ev.message.replace(/^[A-Z_]+\s*·?\s*/, "")}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
