"use client";
// app/draw/_studio/DrawStudio.tsx
// Pod Studio — l'éditeur de dessin. Orchestre le moteur (lib/drawEngine), la scène
// tactile, les barres d'outils, les panneaux, le brouillon et le flux d'envoi.
//
// Le composant ne connaît ni l'API ni le routeur : la page qui l'embarque lui
// fournit `onSend`, `onExit` et l'état de cooldown. Il fonctionne donc aussi hors
// ligne (le dessin n'est jamais perdu) et se teste sans serveur.

import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from "react";
import { RotateCw, ScanLine, X, ZoomIn, ZoomOut, Rotate3d, PanelRightClose, PanelRightOpen, Move } from "lucide-react";
import "./studio.css";
import { SCREEN_PROFILES, ScreenId } from "@/lib/screenProfiles";
import {
  DrawSession, MAT_FLIP_H, MAT_FLIP_V, MAT_IDENTITY, MAT_ROT_CW, matMul, modeForProfile, paletteForMode,
  podHints, craftProfile, scoreBreakdown, ACHIEVEMENTS, Pt, isCustomBrush,
} from "@/lib/drawEngine";
import {
  DEFAULT_SETTINGS, GridSettings, ModelImage, PanelId, StudioSendInput, StudioSendResult, TOOLS_BY_BOX,
  TOOL_KEY, ToolId, ToolSettings, Toolbox,
} from "./types";
import {
  DraftData, SessionClock, StudioPrefs, deleteDraft, loadDraft, loadPrefs, saveDraft, savePrefs,
} from "./storage";
import { Stage, StageApi } from "./Stage";
import { Dock, TopBar, ToolOptions, ToolStrip, SelectionUi } from "./Toolbars";
import {
  BrushAtelier, BrushSection, ColorSection, HelpSection, MenuSection, ModelSection, ScoreSection,
  SymmetrySection, TextureEditor, TextureSection,
} from "./panels";
import { ConfirmDialog, Modal, Sheet, ToastHost, formatTime, useToasts } from "./ui";
import { SendFlow } from "./SendFlow";
import { textSettings } from "./settings";

export interface DrawStudioProps {
  screenId: ScreenId;
  deviceId: string;
  deviceLabel: string;
  isGuest: boolean;
  artistPrefill?: string;
  cooldownRemaining: number;
  onSend: (input: StudioSendInput) => Promise<StudioSendResult>;
  onCooldownStart: (seconds: number) => void;
  onExit: () => void;
  /** Bandeau d'information non bloquant (ex. connexion instable) — jamais de redirection. */
  notice?: { kind: "warn" | "err"; text: string; action?: { label: string; run: () => void } } | null;
}

const sheetTitle: Record<Exclude<PanelId, null>, string> = {
  color: "Couleurs", brush: "Brosses", texture: "Textures & opacité", sym: "Symétrie",
  model: "Image modèle", score: "Points & techniques", menu: "Menu", help: "Gestes et raccourcis",
};

const snapTo = (v: number, list: number[]) => list.reduce((best, x) => (Math.abs(x - v) < Math.abs(best - v) ? x : best), list[0]);
/** En boîte Essentiel, les tailles sont 3 pastilles : on aligne les réglages dessus. */
function essentialSizes(s: ToolSettings): ToolSettings {
  return { ...s, size: snapTo(s.size, [2, 4, 8]), eraserSize: snapTo(s.eraserSize, [4, 8, 16]), shapeSize: snapTo(s.shapeSize, [1, 3, 6]), textScale: Math.min(3, s.textScale) };
}

function initialSettings(prefs: StudioPrefs, mode: ReturnType<typeof modeForProfile>, W: number, H: number): ToolSettings {
  const palette = paletteForMode(mode);
  // la symétrie est un mode transitoire : on ne la remet jamais d'office à l'ouverture
  const s: ToolSettings = { ...DEFAULT_SETTINGS, ...prefs.settings, sym: "", symCx: W / 2, symCy: H / 2 };
  if (palette.length) {
    if (!palette.map(c => c.toLowerCase()).includes(s.color.toLowerCase())) s.color = "#000000";
    if (!palette.map(c => c.toLowerCase()).includes(s.color2.toLowerCase())) s.color2 = "#FFFFFF";
  }
  if (mode !== "rgb565") s.opacity = 100;
  return prefs.toolbox === "essential" ? essentialSizes(s) : s;
}

export default function DrawStudio(props: DrawStudioProps) {
  const { screenId, deviceId } = props;
  const profile = SCREEN_PROFILES[screenId];
  const mode = modeForProfile(profile);
  const W = profile.width, H = profile.height;
  const draftKey = `${deviceId}:${screenId}`;

  // ── Préférences, réglages, session ────────────────────────────────────────
  const [prefs, setPrefs] = useState<StudioPrefs>(() => loadPrefs());
  const [toolbox, setToolboxState] = useState<Toolbox>(prefs.toolbox);
  const [cfg, setCfg] = useState<ToolSettings>(() => initialSettings(prefs, mode, W, H));
  const cfgRef = useRef(cfg);
  useLayoutEffect(() => { cfgRef.current = cfg; }, [cfg]);
  const [tool, setToolState] = useState<ToolId>("brush");
  const prevTool = useRef<ToolId>("brush");

  const [session, setSession] = useState(() => new DrawSession({ width: W, height: H, mode }));
  const [clock] = useState(() => new SessionClock(0));
  const [, force] = useReducer((n: number) => n + 1, 0);

  const [title, setTitle] = useState("");
  const [guestName, setGuestName] = useState(props.artistPrefill ?? "");
  const guestTouched = useRef(false);
  useEffect(() => { if (!guestTouched.current && props.artistPrefill) setGuestName(props.artistPrefill); }, [props.artistPrefill]);

  const [panel, setPanel] = useState<PanelId>(null);
  const [sendOpen, setSendOpen] = useState(false);
  const [confirm, setConfirm] = useState<null | "clear" | "new">(null);
  const [atelier, setAtelier] = useState(false);
  const [texEditor, setTexEditor] = useState(false);
  const [titleFlash, setTitleFlash] = useState(false);
  const [scorePop, setScorePop] = useState(0);
  const [polyCount, setPolyCount] = useState(0);
  const [textDraft, setTextDraft] = useState<{ p: Pt; str: string } | null>(null);
  const [viewInfo, setViewInfo] = useState({ scale: 1, fitted: true, rot: 0 });
  const [hoverPt, setHoverPt] = useState<Pt | null>(null);
  const [draftPrompt, setDraftPrompt] = useState<DraftData | null>(null);
  const [draftSaved, setDraftSaved] = useState<"idle" | "saved" | "error">("idle");
  const [hintDismissed, setHintDismissed] = useState(false);
  const [model, setModel] = useState<ModelImage | null>(null);
  const [modelEdit, setModelEdit] = useState(false);
  const [isFs, setIsFs] = useState(false);
  const [noticeHiddenFor, setNoticeHiddenFor] = useState<string | null>(null);
  const noticeHidden = !!props.notice && noticeHiddenFor === props.notice.text;
  const [sideHidden, setSideHidden] = useState(false);
  const { toasts, push, dismiss } = useToasts();

  const rootRef = useRef<HTMLDivElement>(null);
  const stageApi = useRef<StageApi>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const lastSent = useRef<ReturnType<DrawSession["snapshot"]> | null>(null);
  const seenAch = useRef<Set<string> | null>(null);
  const sentRef = useRef(false);

  // ── Disposition : pilotée par la taille réelle du conteneur ───────────────
  const [lay, setLay] = useState({ side: false, dense: false });
  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const measure = () => {
      const w = el.clientWidth, h = el.clientHeight;
      const dense = h < 560;
      const side = (w >= 900 && h >= 480) || (h < 560 && w > h && w >= 560);
      setLay(l => (l.side === side && l.dense === dense ? l : { side, dense }));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Clavier virtuel / barres du navigateur : la hauteur suit le viewport visuel
  useEffect(() => {
    const el = rootRef.current, vv = window.visualViewport;
    if (!el || !vv) return;
    const sync = () => { el.style.setProperty("--st-vvh", vv.height + "px"); el.style.top = vv.offsetTop + "px"; };
    sync();
    vv.addEventListener("resize", sync);
    vv.addEventListener("scroll", sync);
    return () => { vv.removeEventListener("resize", sync); vv.removeEventListener("scroll", sync); };
  }, []);

  // Verrou de défilement UNIQUE (audit D : trois effets concurrents)
  useEffect(() => {
    const html = document.documentElement, body = document.body;
    const prev = { o: body.style.overflow, ob: html.style.overscrollBehavior };
    body.style.overflow = "hidden";
    html.style.overscrollBehavior = "none";
    return () => { body.style.overflow = prev.o; html.style.overscrollBehavior = prev.ob; };
  }, []);

  useEffect(() => {
    const onFs = () => setIsFs(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

  // Horloge de session : le temps s'arrête quand l'onglet est caché
  useEffect(() => {
    const onVis = () => { if (document.hidden) clock.pause(); else clock.resume(); };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  // ── Abonnement à la session (score, annuler/rétablir, sélection) ─────────
  const lastScore = useRef(0);
  useEffect(() => {
    lastScore.current = session.score;
    return session.subscribe(() => {
      const s = session.score;
      if (s > lastScore.current) setScorePop(n => n + 1);
      lastScore.current = s;
      force();
    });
  }, [session]);

  // ── Brouillon : proposition de reprise au chargement ──────────────────────
  useEffect(() => {
    let cancelled = false;
    loadDraft(draftKey).then(d => {
      if (cancelled || !d) return;
      if (d.snapshot.width !== W || d.snapshot.height !== H || d.snapshot.mode !== mode) return;
      if (d.score > 0 || d.snapshot.entries.length > 0) setDraftPrompt(d);
    });
    return () => { cancelled = true; };
  }, [draftKey, W, H, mode]);

  const restoreDraft = (d: DraftData) => {
    const s = DrawSession.restore(d.snapshot);
    clock.reset(d.elapsedMs + 1000);
    seenAch.current = null;
    setSession(s);
    setTitle(d.title);
    if (d.guestName) { guestTouched.current = true; setGuestName(d.guestName); }
    setDraftPrompt(null);
    push("Brouillon repris", { kind: "ok" });
  };

  // Sauvegarde continue (après chaque geste, en quittant l'onglet)
  const saveTimer = useRef<number | null>(null);
  const persist = useCallback(async () => {
    const s = session;
    if (s.busy) return;
    if (s.appliedCount === 0 && s.actionCount === 0 && !title.trim()) return;
    const ok = await saveDraft(draftKey, {
      v: 1, savedAt: Date.now(), snapshot: s.snapshot(), title, guestName,
      elapsedMs: clock.now(), score: s.score,
    });
    setDraftSaved(ok ? "saved" : "error");
  }, [session, draftKey, title, guestName]);

  useEffect(() => {
    if (draftPrompt) return;
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => { void persist(); }, 900);
    return () => { if (saveTimer.current) window.clearTimeout(saveTimer.current); };
  }, [persist, draftPrompt, session.revision, session.appliedCount, session.actionCount]);

  useEffect(() => {
    const flush = () => { if (!draftPrompt) void persist(); };
    const onVis = () => { if (document.hidden) flush(); };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("pagehide", flush);
    return () => { document.removeEventListener("visibilitychange", onVis); window.removeEventListener("pagehide", flush); };
  }, [persist, draftPrompt]);

  // ── Préférences persistantes ───────────────────────────────────────────────
  useEffect(() => {
    const id = window.setTimeout(() => {
      const { symCx: _a, symCy: _b, ...rest } = cfg;
      void _a; void _b;
      savePrefs({ ...prefs, toolbox, settings: rest });
    }, 500);
    return () => window.clearTimeout(id);
  }, [cfg, toolbox, prefs]);

  const patchPrefs = (p: Partial<StudioPrefs>) => setPrefs(cur => ({ ...cur, ...p }));

  useEffect(() => {
    if (prefs.introSeen) return;
    const id = window.setTimeout(() => {
      push("Deux doigts pour zoomer · ☰ pour choisir Essentiel, Studio ou Pro", { ms: 6000 });
      patchPrefs({ introSeen: true });
    }, 900);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Réglages ───────────────────────────────────────────────────────────────
  const set = useCallback((patch: Partial<ToolSettings>) => setCfg(c => ({ ...c, ...patch })), []);

  const setColor = useCallback((hex: string) => {
    setCfg(c => ({ ...c, color: hex }));
    if (mode === "rgb565") setPrefs(p => ({ ...p, recents: [hex, ...p.recents.filter(x => x.toLowerCase() !== hex.toLowerCase())].slice(0, 12) }));
  }, [mode]);

  const swapColors = useCallback(() => setCfg(c => ({ ...c, color: c.color2, color2: c.color })), []);

  // ── Éléments en attente (texte, polygone, sélection flottante) ────────────
  const endPending = useCallback((how: "commit" | "cancel") => {
    const t = clock.now();
    if (session.hasText) { if (how === "commit") session.commitText(t); else session.cancelText(); }
    setTextDraft(null);
    if (session.hasShape && cfgRef.current.shape === "poly") {
      if (how === "commit" && polyCount >= 2) session.commitShape(t); else session.cancelShape();
      setPolyCount(0);
    }
    if (session.floating) {
      const desc = session.selection?.desc;
      const b = session.floating.bounds;
      if (how === "commit") {
        session.floatCommit(t);
        if (desc?.t === "rect") session.selectRegion({ t: "rect", x: b.x, y: b.y, w: b.w, h: b.h });
      } else { session.floatCancel(); }
    }
    stageApi.current?.invalidate();
    force();
  }, [session, polyCount]);

  const setTool = useCallback((t: ToolId) => {
    if (t === tool) return;
    endPending("commit");
    if (t !== "select") session.clearSelection();
    if (tool !== "eyedropper") prevTool.current = tool;
    setToolState(t);
    setPanel(null);
  }, [tool, session, endPending]);

  const setToolbox = (b: Toolbox) => {
    setToolboxState(b);
    if (!TOOLS_BY_BOX[b].includes(tool)) setTool("brush");
    // les réglages avancés inutilisables dans une boîte plus simple sont neutralisés
    if (b === "essential") setCfg(c => essentialSizes({ ...c, sym: "", fillGradient: false, texture: "solid", opacity: 100, stabilizer: 0, brush: c.brush === "square" ? "square" : "round", shape: c.shape === "poly" ? "line" : c.shape }));
    if (b === "studio") setCfg(c => ({ ...c, fillGradient: false, stabilizer: 0, selectKind: c.selectKind === "lasso" ? "rect" : c.selectKind, shape: c.shape === "poly" ? "line" : c.shape, brush: c.brush === "spray" || isCustomBrush(c.brush) ? "round" : c.brush, sym: c.sym.startsWith("r") ? "" : c.sym }));
    setPrefs(p => ({ ...p, toolbox: b }));
    push(`Boîte à outils : ${b === "essential" ? "Essentiel" : b === "studio" ? "Studio" : "Pro"}`);
  };

  const pickedColor = useCallback((hex: string) => {
    setColor(hex);
    // la pipette est un outil "de passage" : on revient à l'outil précédent après avoir pris la couleur
    setToolState(t => (t === "eyedropper" ? (prevTool.current === "eyedropper" ? "brush" : prevTool.current) : t));
  }, [setColor]);

  // ── Historique ─────────────────────────────────────────────────────────────
  const undo = useCallback(() => {
    endPending("cancel");
    session.undo(clock.now());
    stageApi.current?.invalidate();
  }, [session, endPending]);
  const redo = useCallback(() => {
    endPending("cancel");
    session.redo(clock.now());
    stageApi.current?.invalidate();
  }, [session, endPending]);

  const doClear = () => {
    endPending("cancel");
    session.clearSelection();
    if (session.clear(clock.now())) {
      push("Dessin effacé", { action: { label: "Annuler", run: () => { session.undo(clock.now()); stageApi.current?.invalidate(); } }, ms: 7000 });
    }
    setConfirm(null);
    setPanel(null);
    stageApi.current?.invalidate();
  };

  const startNew = useCallback((keepMemo = true) => {
    if (keepMemo && session.appliedCount > 0) lastSent.current = session.snapshot();
    void deleteDraft(draftKey);
    clock.reset(0);
    seenAch.current = null;
    setSession(new DrawSession({ width: W, height: H, mode }));
    setTitle("");
    setTextDraft(null); setPolyCount(0); setModelEdit(false);
    setConfirm(null); setPanel(null);
  }, [session, draftKey, W, H, mode]);

  const reopen = (snap: NonNullable<typeof lastSent.current>) => {
    seenAch.current = null;
    setSession(DrawSession.restore(snap));
  };

  // ── Sélection ──────────────────────────────────────────────────────────────
  const selUi: SelectionUi = {
    has: !!session.selection || !!session.floating,
    floating: !!session.floating,
    copy: !!session.floating?.copy,
  };
  const selOp = (fn: (m: [number, number, number, number]) => [number, number, number, number]) => {
    if (!session.selection && !session.floating) return;
    const cur = session.floating?.m ?? MAT_IDENTITY;
    session.floatUpdate({ m: fn(cur) });
    stageApi.current?.invalidate(); force();
  };
  const selCommit = () => { endPending("commit"); if (!session.floating) session.clearSelection(); force(); };
  const selCancel = () => { endPending("cancel"); session.clearSelection(); force(); };
  const selDelete = () => { endPending("cancel"); session.deleteSelection(clock.now()); session.clearSelection(); stageApi.current?.invalidate(); force(); };

  // ── Texte ──────────────────────────────────────────────────────────────────
  const onTextPoint = useCallback((p: Pt) => setTextDraft(d => ({ p, str: d?.str ?? "" })), []);
  useEffect(() => {
    if (!textDraft) return;
    if (textDraft.str) session.previewText(textDraft.p, textDraft.str, textSettings(cfg));
    else session.cancelText();
    stageApi.current?.invalidate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [textDraft, cfg.textScale, cfg.color, cfg.texture, cfg.opacity]);
  const textOk = () => {
    if (session.hasText) session.commitText(clock.now());
    setTextDraft(null); stageApi.current?.invalidate();
  };
  const textCancel = () => { session.cancelText(); setTextDraft(null); stageApi.current?.invalidate(); };

  // ── Modèle (image de référence, jamais envoyée) ────────────────────────────
  const loadModel = (file: File) => {
    if (!file.type.startsWith("image/")) { push("Ce fichier n'est pas une image", { kind: "err" }); return; }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const k = Math.min(W / img.naturalWidth, H / img.naturalHeight);
      const w = img.naturalWidth * k, h = img.naturalHeight * k;
      setModel(m => { if (m) URL.revokeObjectURL(m.url); return { url, x: (W - w) / 2, y: (H - h) / 2, w, h, opacity: 0.4, gray: true, visible: true }; });
      setModelEdit(true);
      push("Modèle chargé — place-le, il ne sera jamais envoyé", { ms: 4200 });
    };
    img.onerror = () => { URL.revokeObjectURL(url); push("Image illisible", { kind: "err" }); };
    img.src = url;
  };
  const removeModel = () => { setModel(m => { if (m) URL.revokeObjectURL(m.url); return null; }); setModelEdit(false); };
  useEffect(() => () => { if (model) URL.revokeObjectURL(model.url); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  // ── Ouverture des panneaux ─────────────────────────────────────────────────
  const inlineable: PanelId[] = ["color", "brush", "texture", "sym", "model"];
  const open = useCallback((p: PanelId) => {
    if (p && lay.side && inlineable.includes(p)) {
      document.getElementById("st-sec-" + p)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
      return;
    }
    setPanel(cur => (cur === p ? null : p));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lay.side]);

  // ── Envoi ──────────────────────────────────────────────────────────────────
  const cooldown = props.cooldownRemaining;
  const logKey = session.actionCount * 100003 + session.appliedCount;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const actionsNow = useMemo(() => session.getActions(), [session, logKey]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const replay = useMemo(() => session.getReplay(), [session, logKey]);
  const score = session.score;
  const bd = useMemo(() => scoreBreakdown(actionsNow), [actionsNow]);
  const hints = useMemo(() => podHints(replay, W, H), [replay, W, H]);
  const craft = useMemo(() => craftProfile(actionsNow), [actionsNow]);

  // ── Récompenses : chaque technique découverte est saluée ; suggestion de boîte à outils ──
  useEffect(() => {
    const cur = new Set(craft.achievements);
    if (seenAch.current === null) { seenAch.current = cur; return; }
    for (const id of cur) {
      if (!seenAch.current.has(id)) {
        const a = ACHIEVEMENTS.find(x => x.id === id);
        if (a) push(`Technique débloquée : ${a.label} ✨`, { ms: 3200 });
      }
    }
    seenAch.current = cur;
  }, [craft.achievements, push]);

  const nudged = useRef(prefs.nudges);
  useEffect(() => {
    if (draftPrompt || sendOpen) return;
    let nudge: null | { key: "studio" | "pro"; msg: string; label: string; to: Toolbox } = null;
    if (toolbox === "essential" && score >= 6 && !nudged.current.studio)
      nudge = { key: "studio", msg: "Tu prends de l'assurance ! Studio ajoute pipette, sélection, texte et textures.", label: "Essayer Studio", to: "studio" };
    else if (toolbox === "studio" && craft.achievements.length >= 5 && !nudged.current.pro)
      nudge = { key: "pro", msg: "Tu maîtrises Studio. Pro ajoute dégradés, polygones, lasso et brosses perso.", label: "Essayer Pro", to: "pro" };
    if (!nudge) return;
    const n = nudge;
    nudged.current = { ...nudged.current, [n.key]: true };
    const id = window.setTimeout(() => {
      setPrefs(p => ({ ...p, nudges: { ...p.nudges, [n.key]: true } }));
      push(n.msg, { ms: 9000, action: { label: n.label, run: () => setToolbox(n.to) } });
    }, 0);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [score, craft.achievements.length, toolbox, draftPrompt, sendOpen]);

  const sendKind = cooldown > 0 ? "wait" : score <= 0 ? "empty" : "ready";
  const openSend = () => {
    endPending("commit");
    if (score <= 0 && cooldown <= 0) { push("Dessine d'abord : au moins 1 point est nécessaire", { kind: "err" }); return; }
    if (!title.trim() && cooldown <= 0) { setTitleFlash(true); window.setTimeout(() => setTitleFlash(false), 600); }
    setPanel(null);
    setSendOpen(true);
  };

  // ── Clavier (ordinateur) ───────────────────────────────────────────────────
  useEffect(() => {
    const typing = (t: EventTarget | null) => t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || (t instanceof HTMLElement && t.isContentEditable);
    const onKey = (e: KeyboardEvent) => {
      if (typing(e.target)) return;
      if (sendOpen || atelier || texEditor || confirm || draftPrompt) return;
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if (mod && k === "z" && !e.shiftKey) { e.preventDefault(); undo(); return; }
      if (mod && (k === "y" || (k === "z" && e.shiftKey))) { e.preventDefault(); redo(); return; }
      if (mod || e.altKey) return;   // Ctrl+R, Ctrl+F, Alt+… restent au navigateur (audit B8)
      if (e.key === "Escape") {
        if (panel) setPanel(null); else if (textDraft || polyCount || session.floating || session.selection) { endPending("cancel"); session.clearSelection(); force(); }
        return;
      }
      if (e.key === "Enter") { if (textDraft) textOk(); else if (polyCount >= 2) { stageApi.current?.polyCommit(); } else if (session.floating) selCommit(); return; }
      if (e.key === "Delete" || e.key === "Backspace") { if (session.selection || session.floating) { e.preventDefault(); selDelete(); } return; }
      // raccourcis historiques : L ligne · R rectangle · O ellipse · V déplacer (= sélection)
      const shapeKey = ({ l: "line", r: "rect", o: "ellipse" } as const)[k as "l" | "r" | "o"];
      if (shapeKey) { setTool("shape"); set({ shape: shapeKey }); return; }
      const entry = k === "v" ? "select" : (Object.keys(TOOL_KEY) as ToolId[]).find(t => TOOL_KEY[t].toLowerCase() === k);
      if (entry && TOOLS_BY_BOX[toolbox].includes(entry)) { setTool(entry); return; }
      if (k === "x") { swapColors(); return; }
      if (k === "h") { patchPrefs({ grid: { ...prefs.grid, show: !prefs.grid.show } }); return; }
      if (k === "0") { stageApi.current?.fit(); return; }
      if (k === "[" || k === "]") {
        const d = k === "]" ? 1 : -1;
        if (tool === "eraser") set({ eraserSize: Math.max(1, Math.min(40, cfg.eraserSize + d)) });
        else set({ size: Math.max(1, Math.min(32, cfg.size + d)) });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sendOpen, atelier, texEditor, confirm, draftPrompt, panel, textDraft, polyCount, toolbox, tool, cfg.size, cfg.eraserSize, prefs.grid, undo, redo, endPending]);

  // Coller / déposer une image → modèle
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (typing(e.target)) return;
      const f = [...(e.clipboardData?.files ?? [])].find(x => x.type.startsWith("image/"));
      if (f) { e.preventDefault(); loadModel(f); }
    };
    const typing = (t: EventTarget | null) => t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement;
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Dérivés d'affichage ────────────────────────────────────────────────────
  const palette = useMemo(() => (mode === "rgb565" ? profile.colors : paletteForMode(mode)), [mode, profile.colors]);
  const customBrushSelection = () => {
    const sel = session.selection?.sel;
    if (!sel) return null;
    if (sel.w > 32 || sel.h > 32) return null;
    return { w: sel.w, h: sel.h, bits: sel.mask };
  };

  const sendLabel = sendKind === "wait" ? formatTime(cooldown) : "Envoyer";
  const isPortraitPhone = !lay.side;
  const showRotateHint = !modelEdit && isPortraitPhone && W / H > 1.5 && viewInfo.fitted && viewInfo.scale < 2.6 && !hintDismissed && !sendOpen && !draftPrompt && viewInfo.rot === 0;

  const frameLabel = `${profile.name} · ${W}×${H}`;

  // ── Sections (partagées feuille / panneau latéral) ────────────────────────
  const colorSection = (
    <ColorSection
      mode={mode} palette={palette} color={cfg.color} color2={cfg.color2} recents={prefs.recents} favorites={prefs.favorites}
      onColor={setColor} onColor2={hex => set({ color2: hex })} onSwap={swapColors}
      onFav={hex => patchPrefs({ favorites: prefs.favorites.map(f => f.toLowerCase()).includes(hex.toLowerCase()) ? prefs.favorites.filter(f => f.toLowerCase() !== hex.toLowerCase()) : [hex, ...prefs.favorites].slice(0, 24) })}
      onEyedropper={() => { setPanel(null); setTool("eyedropper"); }}
    />
  );
  const brushSection = (
    <BrushSection
      toolbox={toolbox} brush={cfg.brush} size={cfg.size} texture={cfg.texture} customBrushes={prefs.customBrushes}
      onBrush={id => { set({ brush: id }); setPanel(null); }} onAtelier={() => setAtelier(true)}
      onDeleteCustom={id => { patchPrefs({ customBrushes: prefs.customBrushes.filter(b => b !== id) }); if (cfg.brush === id) set({ brush: "round" }); }}
    />
  );
  const textureSection = (
    <TextureSection
      mode={mode} toolbox={toolbox} texture={cfg.texture} opacity={cfg.opacity} customTextures={prefs.customTextures}
      onTexture={id => set({ texture: id })} onOpacity={v => set({ opacity: v })} onEditor={() => setTexEditor(true)}
      onDeleteCustom={id => { patchPrefs({ customTextures: prefs.customTextures.filter(b => b !== id) }); if (cfg.texture === id) set({ texture: "solid" }); }}
    />
  );
  const symSection = (
    <SymmetrySection
      toolbox={toolbox} sym={cfg.sym} cx={cfg.symCx} cy={cfg.symCy} W={W} H={H}
      onSym={m => { set({ sym: m }); }} onCenter={(cx, cy) => set({ symCx: cx, symCy: cy })}
    />
  );
  const modelSection = (
    <ModelSection model={model} editing={modelEdit} onLoad={() => fileRef.current?.click()} onChange={setModel} onRemove={removeModel} onEdit={setModelEdit} />
  );

  const optionsEl = (
    <ToolOptions
      tool={tool} toolbox={toolbox} mode={mode} cfg={cfg} set={set} open={open}
      polyCount={polyCount} onPolyDone={() => stageApi.current?.polyCommit()} onPolyCancel={() => stageApi.current?.polyCancel()}
      sel={selUi}
      onSelCommit={selCommit} onSelCancel={selCancel}
      onSelCopy={() => { session.floatUpdate({ copy: !session.floating?.copy }); stageApi.current?.invalidate(); force(); }}
      onSelFlipH={() => selOp(m => matMul(MAT_FLIP_H, m))} onSelFlipV={() => selOp(m => matMul(MAT_FLIP_V, m))} onSelRot={() => selOp(m => matMul(MAT_ROT_CW, m))}
      onSelDelete={selDelete}
      text={{ active: !!textDraft, value: textDraft?.str ?? "", onChange: v => setTextDraft(d => (d ? { ...d, str: v } : d)), onOk: textOk, onCancel: textCancel }}
      hasColorB
    />
  );

  const cls = ["studio", lay.side ? "st--side" : "st--stack", lay.dense ? "st--dense" : "", sideHidden && lay.side ? "st--noside" : "", "st--" + toolbox].join(" ");

  return (
    <div ref={rootRef} className={cls} data-screen={screenId}>
      <input ref={fileRef} type="file" accept="image/*" hidden onChange={e => { const f = e.target.files?.[0]; if (f) loadModel(f); e.target.value = ""; }} />

      <TopBar
        title={title} onTitle={setTitle} titleFlash={titleFlash}
        score={score} scorePop={scorePop} onScore={() => setPanel("score")}
        canUndo={session.canUndo} canRedo={session.canRedo} onUndo={undo} onRedo={redo}
        onMenu={() => setPanel("menu")} onBack={props.onExit}
        onSend={openSend} send={{ kind: sendKind, label: sendLabel }}
      />

      <div
        className="st-stagewrap"
        onDragOver={e => e.preventDefault()}
        onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) loadModel(f); }}
      >
        <Stage
          ref={stageApi}
          session={session} clock={clock} tool={tool} cfgRef={cfgRef} grid={prefs.grid}
          frameLabel={frameLabel} model={model} modelEdit={modelEdit} onModelChange={setModel}
          panelOpen={!!panel && !lay.side} onDismissPanel={() => setPanel(null)} penOnly={prefs.penOnly}
          onPickColor={pickedColor} onSelectionChange={force} onFloatCommit={() => endPending("commit")}
          onTextPoint={onTextPoint} textDraft={textDraft ? { p: textDraft.p, str: textDraft.str, scale: cfg.textScale } : null}
          onPolyCount={setPolyCount} onViewChange={setViewInfo} onHover={p => setHoverPt(prev => (prev && p && prev.x === p.x && prev.y === p.y ? prev : p))}
          onHint={msg => push(msg)}
        />
        <div className="st-hud">
          <span className="st-hud__chip">{W}×{H} · ×{viewInfo.scale.toFixed(viewInfo.scale < 10 ? 1 : 0)}</span>
          {hoverPt && lay.side && <span className="st-hud__chip">x {hoverPt.x} · y {hoverPt.y}</span>}
          {modelEdit && <span className="st-hud__chip" style={{ color: "var(--st-accent-hi)" }}>Placement du modèle</span>}
        </div>
        <div className="st-viewctl">
          <button type="button" className="st-btn st-zoom" onClick={() => stageApi.current?.zoomBy(1.4)} aria-label="Zoom avant"><ZoomIn size={19} /></button>
          <button type="button" className="st-btn st-zoom" onClick={() => stageApi.current?.zoomBy(1 / 1.4)} aria-label="Zoom arrière"><ZoomOut size={19} /></button>
          {!viewInfo.fitted && <button type="button" className="st-btn" onClick={() => stageApi.current?.fit()} aria-label="Ajuster la vue"><ScanLine size={19} /></button>}
          {lay.side && <button type="button" className="st-btn" onClick={() => stageApi.current?.rotate()} aria-label="Pivoter la vue"><Rotate3d size={19} /></button>}
          {lay.side && (
            <button type="button" className="st-btn" onClick={() => setSideHidden(v => !v)} aria-label={sideHidden ? "Afficher les réglages" : "Masquer les réglages"} aria-pressed={sideHidden} title={sideHidden ? "Afficher les réglages" : "Masquer les réglages (plus de place pour dessiner)"}>
              {sideHidden ? <PanelRightOpen size={19} /> : <PanelRightClose size={19} />}
            </button>
          )}
        </div>
        {props.notice && !noticeHidden && (
          <div className={"st-notice st-notice--" + props.notice.kind} role="status">
            <span>{props.notice.text}</span>
            {props.notice.action && <button type="button" onClick={props.notice.action.run}>{props.notice.action.label}</button>}
            <button type="button" onClick={() => setNoticeHiddenFor(props.notice?.text ?? null)} aria-label="Masquer" style={{ width: 28, padding: 0 }}><X size={14} /></button>
          </div>
        )}
        {modelEdit && model && (
          <div className="st-rotatehint" role="status">
            <Move size={16} /> Place le modèle : glisse, pince pour agrandir
            <button type="button" onClick={() => setModelEdit(false)}>Terminer</button>
          </div>
        )}
        {showRotateHint && (
          <div className="st-rotatehint" role="note">
            <RotateCw size={16} /> Tourne ton téléphone pour dessiner plus grand
            <button type="button" onClick={() => stageApi.current?.rotate()}>Pivoter la vue</button>
            <button type="button" onClick={() => setHintDismissed(true)} aria-label="Masquer" style={{ padding: 0, width: 28 }}><X size={14} /></button>
          </div>
        )}
        <ToastHost toasts={toasts} dismiss={dismiss} bottom={lay.side ? 16 : 14} />
      </div>

      {!lay.side ? (
        <>
          <div className="st-optsrow">{optionsEl}</div>
          <ToolStrip toolbox={toolbox} tool={tool} onTool={setTool} />
          <Dock
            mode={mode} palette={palette} recents={prefs.recents} color={cfg.color} color2={cfg.color2}
            onColor={setColor} onOpenColors={() => open("color")}
            canUndo={session.canUndo} canRedo={session.canRedo} onUndo={undo} onRedo={redo}
          />
        </>
      ) : (
        <>
          <ToolStrip toolbox={toolbox} tool={tool} onTool={setTool} />
          <aside className="st-side" aria-label="Réglages">
            <div className="st-sect st-sect--opts">{optionsEl}</div>
            <div id="st-sec-color" className="st-sect"><div className="st-secthead">Couleurs</div>{colorSection}</div>
            {toolbox !== "essential" && tool === "brush" && <div id="st-sec-brush" className="st-sect"><div className="st-secthead">Brosse</div>{brushSection}</div>}
            {toolbox !== "essential" && <div id="st-sec-texture" className="st-sect"><div className="st-secthead">{mode === "rgb565" ? "Textures & opacité" : "Densité & motifs"}</div>{textureSection}</div>}
            {toolbox !== "essential" && <div id="st-sec-sym" className="st-sect"><div className="st-secthead">Symétrie</div>{symSection}</div>}
            {toolbox !== "essential" && <div id="st-sec-model" className="st-sect"><div className="st-secthead">Image modèle</div>{modelSection}</div>}
          </aside>
        </>
      )}

      {/* ── Feuilles ─────────────────────────────────────────────────────── */}
      {panel && (lay.side ? ["menu", "score", "help"].includes(panel) : true) && (
        <Sheet title={sheetTitle[panel]} onClose={() => setPanel(null)}>
          {panel === "color" && colorSection}
          {panel === "brush" && brushSection}
          {panel === "texture" && textureSection}
          {panel === "sym" && symSection}
          {panel === "model" && modelSection}
          {panel === "score" && <ScoreSection score={score} hints={hints} achievements={craft.achievements} toolbox={toolbox} transforms={bd.transforms} credited={bd.credited} />}
          {panel === "help" && <HelpSection />}
          {panel === "menu" && (
            <MenuSection
              toolbox={toolbox} onToolbox={setToolbox}
              grid={prefs.grid} onGrid={(g: GridSettings) => patchPrefs({ grid: g })}
              precision={cfg.precision} onPrecision={v => set({ precision: v })}
              penOnly={prefs.penOnly} onPenOnly={v => patchPrefs({ penOnly: v })}
              canFullscreen={typeof document !== "undefined" && !!document.fullscreenEnabled} isFullscreen={isFs}
              onFullscreen={() => { if (document.fullscreenElement) void document.exitFullscreen(); else void document.documentElement.requestFullscreen().catch(() => {}); }}
              onFit={() => { stageApi.current?.fit(); setPanel(null); }} onRotate={() => { stageApi.current?.rotate(); setPanel(null); }}
              onClear={() => setConfirm("clear")} onNew={() => setConfirm("new")}
              onModel={() => setPanel("model")} onHelp={() => setPanel("help")} onScore={() => setPanel("score")}
              onExit={props.onExit} hasContent={score > 0} draftSaved={draftSaved}
              showTexture={toolbox !== "essential"} onTexture={() => setPanel("texture")} showSym={toolbox !== "essential"} onSym={() => setPanel("sym")}
            />
          )}
        </Sheet>
      )}

      {atelier && (
        <BrushAtelier
          capture={customBrushSelection} onClose={() => setAtelier(false)}
          onSave={id => { patchPrefs({ customBrushes: [...prefs.customBrushes.filter(b => b !== id), id].slice(-16) }); set({ brush: id }); setAtelier(false); setPanel(null); push("Brosse créée", { kind: "ok" }); }}
        />
      )}
      {texEditor && (
        <TextureEditor
          initial={cfg.texture} onClose={() => setTexEditor(false)}
          onSave={id => { patchPrefs({ customTextures: [...prefs.customTextures.filter(b => b !== id), id].slice(-16) }); set({ texture: id }); setTexEditor(false); push("Motif créé", { kind: "ok" }); }}
        />
      )}

      {confirm === "clear" && (
        <ConfirmDialog
          title="Effacer tout le dessin ?" message="Tu pourras annuler juste après avec le bouton « Annuler »." confirmLabel="Tout effacer" danger
          onConfirm={doClear} onCancel={() => setConfirm(null)}
        />
      )}
      {confirm === "new" && (
        <ConfirmDialog
          title="Commencer un nouveau dessin ?" message="Le dessin actuel sera remplacé par une feuille blanche. Tu pourras le récupérer juste après." confirmLabel="Nouveau dessin" danger
          onConfirm={() => { startNew(true); push("Nouvelle feuille", { action: lastSent.current ? { label: "Récupérer l'ancien", run: () => { const snap = lastSent.current; if (snap) reopen(snap); } } : undefined, ms: 8000 }); }}
          onCancel={() => setConfirm(null)}
        />
      )}

      {sendOpen && (
        <SendFlow
          session={session} screenId={screenId} deviceLabel={props.deviceLabel} isGuest={props.isGuest}
          title={title} onTitle={setTitle} guestName={guestName} onGuestName={v => { guestTouched.current = true; setGuestName(v); }}
          cooldown={cooldown} hints={hints}
          onSend={props.onSend}
          onSent={r => { props.onCooldownStart(r.nextDrawIn); void deleteDraft(draftKey); lastSent.current = session.snapshot(); sentRef.current = true; }}
          onCooldown={secs => props.onCooldownStart(secs)}
          onClose={() => {
            setSendOpen(false);
            // après un envoi réussi : on repart d'une feuille blanche, l'œuvre envoyée reste récupérable
            if (sentRef.current) {
              sentRef.current = false;
              const snap = lastSent.current;
              startNew(false);
              push("Dessin envoyé ✓ — nouvelle feuille prête", {
                kind: "ok", ms: 8000,
                action: snap ? { label: "Rouvrir", run: () => reopen(snap) } : undefined,
              });
            }
          }}
        />
      )}

      {draftPrompt && (
        <div className="st-draft">
          <div className="st-dialog" role="dialog" aria-label="Brouillon trouvé">
            <h3>Reprendre ton brouillon ?</h3>
            <p>
              Un dessin non envoyé a été sauvegardé {timeAgo(draftPrompt.savedAt)}
              {draftPrompt.title ? <> — « {draftPrompt.title} »</> : null} · {draftPrompt.score} point{draftPrompt.score > 1 ? "s" : ""}.
            </p>
            <div className="st-dialog__actions">
              <button type="button" className="st-btn st-btn--solid" onClick={() => { void deleteDraft(draftKey); setDraftPrompt(null); }}>Repartir de zéro</button>
              <button type="button" className="st-btn st-btn--accent" onClick={() => restoreDraft(draftPrompt)}>Reprendre le brouillon</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function timeAgo(ts: number) {
  const m = Math.round((Date.now() - ts) / 60000);
  if (m < 1) return "à l'instant";
  if (m < 60) return `il y a ${m} min`;
  const h = Math.round(m / 60);
  if (h < 48) return `il y a ${h} h`;
  return `il y a ${Math.round(h / 24)} j`;
}
