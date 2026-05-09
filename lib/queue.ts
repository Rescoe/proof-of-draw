import type { ScreenPayload } from "@/lib/canvasToScreen";

export interface QueueEntry {
  id: string;
  deviceId: string;
  screen: string;
  dataB64: string;
  addedAt: number;
  status: "pending" | "sent" | "error";
  error?: string;
}

// In-memory queue for MVP — replace with persistent queue (Redis/BullMQ)
const queue: QueueEntry[] = [];
const QUEUE_INTERVAL_MS = 15 * 60 * 1000; // 15 min between sends

let processing = false;

export function enqueue(entry: Omit<QueueEntry, "addedAt" | "status">): QueueEntry {
  const e: QueueEntry = { ...entry, addedAt: Date.now(), status: "pending" };
  queue.push(e);
  if (!processing) processQueue();
  return e;
}

export function getQueue(): QueueEntry[] {
  return [...queue];
}

async function processQueue() {
  processing = true;
  while (true) {
    const pending = queue.filter((e) => e.status === "pending");
    if (pending.length === 0) break;

    const entry = pending[0];
    entry.status = "sent"; // optimistic - real impl would await send

    // Respect 15-min inter-send delay
    await new Promise((r) => setTimeout(r, QUEUE_INTERVAL_MS));
  }
  processing = false;
}

/** Immediate send (bypasses queue rate-limit) — for MVP testing */
// frameQueue.ts — corriger sendFrameNow pour supporter black/red

export async function sendFrameNow(
  ip: string,
  port: number,
  payload: ScreenPayload  // ← passer le payload complet, pas screen+buffer
): Promise<{ ok: boolean; status?: number; error?: string }> {
  try {
    const res = await fetch(`http://${ip}:${port}/frame`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),  // ← payload direct, pas reconstruit
      signal: AbortSignal.timeout(10000),
    });
    return { ok: res.ok, status: res.status };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}
