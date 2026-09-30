// lib/drawEngine/replay.ts
// Rejeu d'une séquence d'événements produite par le moteur v2 : reconstruit
// l'image pixel pour pixel avec les MÊMES opérations que la session interactive.
// Utilisé par la galerie (BlockDetail) et par les tests de cohérence
// "image reconstruite depuis le replay == image envoyée".

import type { ReplayEvent } from "@/lib/types/actions";
import { Bitmap, Txn } from "./bitmap";
import { ColorMode, WHITE, fromHex, snapColor, Color } from "./color";
import {
  EngineCfg, StrokeRunner, Surface, clearAll, drawShape, fillRegion, gradientRegion, inkFromEvent,
  makeInk, shapeCfgFromEvent, strokeCfgFromEvent,
} from "./ops";
import { MAT_IDENTITY, resolveSelection, transformSelection } from "./selection";
import { drawText } from "./text";

/** Vrai si la séquence a été produite par le moteur v2 (elle se rejoue pixel-exact). */
export function isReplayV2(events: ReplayEvent[]): boolean {
  return events.length > 0 && events[0].v === 2;
}

export class Replayer {
  readonly cfg: EngineCfg;
  readonly bmp: Bitmap;
  private runners = new Map<number, { txn: Txn; runner: StrokeRunner }>();

  constructor(cfg: { width: number; height: number; mode: ColorMode; background?: Color }) {
    this.cfg = { width: cfg.width, height: cfg.height, mode: cfg.mode, background: cfg.background ?? WHITE };
    this.bmp = new Bitmap(cfg.width, cfg.height, this.cfg.background);
  }

  private surface(txn: Txn): Surface {
    return { bmp: this.bmp, txn, mode: this.cfg.mode };
  }

  private oneShot(fn: (s: Surface) => void) {
    const txn = new Txn(this.bmp);
    fn(this.surface(txn));
    txn.commit(0);
  }

  apply(ev: ReplayEvent) {
    const cfg = this.cfg;
    switch (ev.kind) {
      case "down": {
        const id = ev.id ?? -1;
        this.finish(id);
        const txn = new Txn(this.bmp);
        const runner = new StrokeRunner(this.surface(txn), strokeCfgFromEvent(ev, cfg));
        runner.down({ x: ev.x, y: ev.y });
        this.runners.set(id, { txn, runner });
        break;
      }
      case "move": {
        this.runners.get(ev.id ?? -1)?.runner.move({ x: ev.x, y: ev.y });
        break;
      }
      case "up": {
        const r = this.runners.get(ev.id ?? -1);
        if (r) r.runner.move({ x: ev.x, y: ev.y });
        this.finish(ev.id ?? -1);
        break;
      }
      case "clear":
        this.oneShot(s => clearAll(s, cfg.background));
        break;
      case "fill":
        this.oneShot(s => fillRegion(s, inkFromEvent(ev, cfg), ev.x, ev.y, ev.gl === 1));
        break;
      case "grad":
        this.oneShot(s => gradientRegion(
          s, cfg.mode, snapColor(fromHex(ev.color ?? "#000000"), cfg.mode), snapColor(fromHex(ev.c2 ?? "#FFFFFF"), cfg.mode),
          { x: ev.x, y: ev.y }, { x: ev.x2 ?? ev.x, y: ev.y2 ?? ev.y }, ev.gl === 1,
        ));
        break;
      case "shape":
        this.oneShot(s => drawShape(s, shapeCfgFromEvent(ev, cfg)));
        break;
      case "sel": {
        if (!ev.sel) break;
        const sel = resolveSelection(this.bmp, ev.sel);
        if (!sel) break;
        this.oneShot(s => transformSelection(s, sel, cfg.background, {
          m: ev.m ?? MAT_IDENTITY, dx: ev.dx ?? 0, dy: ev.dy ?? 0, copy: ev.cp === 1, del: ev.dl === 1,
        }));
        break;
      }
      case "text":
        this.oneShot(s => drawText(s, makeInk(ev.color ?? "#000000", cfg.mode, ev.op ?? 100, ev.tx ?? "solid"), { x: ev.x, y: ev.y }, ev.s ?? "", ev.sc ?? 1));
        break;
    }
  }

  private finish(id: number) {
    const r = this.runners.get(id);
    if (!r) return;
    r.runner.finish();
    r.txn.commit(0);
    this.runners.delete(id);
  }

  /** Termine les traits restés ouverts (séquence tronquée). */
  flush() {
    for (const id of [...this.runners.keys()]) this.finish(id);
  }

  static reconstruct(events: ReplayEvent[], cfg: { width: number; height: number; mode: ColorMode; background?: Color }): Bitmap {
    const r = new Replayer(cfg);
    for (const ev of events) r.apply(ev);
    r.flush();
    return r.bmp;
  }
}
