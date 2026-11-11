"use client";

// React Bits Prompt Bar (TS + CSS), adapted for the Modus composer.
// License and upstream attribution are in THIRD_PARTY_NOTICES.md.

import {
  ArrowDown01Icon,
  Attachment01Icon,
  Calendar03Icon,
  Cancel01Icon,
  ChartLineData01Icon,
  File02Icon,
  Globe02Icon,
  HelpCircleIcon,
  Mail01Icon,
  Mic01Icon,
  PlusSignIcon,
  SparklesIcon,
  Tick02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import { animate, useMotionValue, useMotionValueEvent, useReducedMotion } from "motion/react";
import React, {
  type ComponentPropsWithRef,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import "./PromptBar.css";

export interface PromptBarSource {
  key: string;
  name: string;
  description?: string;
  icon?: ReactNode | IconSvgElement;
  attach?: boolean;
}

export interface PromptBarCommand {
  key: string;
  name: string;
  description?: string;
}

export interface PromptBarModel {
  key: string;
  name: string;
  tag?: string;
}

export interface PromptBarSendDetail {
  attachments: string[];
  model?: PromptBarModel;
  effort?: string;
}

export interface PromptBarProps {
  /** Integration slots for hosts with a rich editor and their own toolbar actions. */
  editor?: ReactNode;
  focusEditor?: () => void;
  accessory?: ReactNode;
  toolbar?: ReactNode;
  toolbarTrailing?: ReactNode;
  attachControl?: ReactNode;
  toolbarProps?: ComponentPropsWithRef<"div"> & Record<`data-${string}`, string>;
  canSend?: boolean;
  sendDisabled?: boolean;
  sendIndicator?: ReactNode;
  placeholder?: string;
  sources?: PromptBarSource[];
  commands?: PromptBarCommand[];
  models?: PromptBarModel[];
  defaultModel?: string;
  selectedModel?: string;
  modelLabel?: string;
  onModelChange?: (model: string) => void;
  efforts?: string[];
  defaultEffort?: string;
  selectedEffort?: string;
  effortLabel?: (effort: string) => string;
  selectorsDisabled?: boolean;
  selectorsDisabledReason?: string;
  onEffortChange?: (effort: string) => void;
  busy?: boolean;
  onSend?: (text: string, detail: PromptBarSendDetail) => void;
  onStop?: () => void;
  onAttach?: () => string | string[] | undefined | Promise<string | string[] | undefined>;
  onDictate?: () => string | undefined | Promise<string | undefined>;
  background?: string;
  color?: string;
  menuBackground?: string;
  sparkColor?: string;
  sparkBoost?: number;
  width?: number;
  radius?: number | string;
  maxRows?: number;
  morphDuration?: number;
  squash?: number;
  tilt?: number;
  pressScale?: number;
  className?: string;
}

type Row = {
  key: string;
  name: string;
  description?: string;
  tag?: string;
  icon?: ReactNode | IconSvgElement;
  attach?: boolean;
};
type Token = { kind: "at" | "slash"; query: string; start: number };
type Spark = {
  x: number;
  y: number;
  r: number;
  vy: number;
  sway: number;
  phase: number;
  life: number;
  span: number;
};

interface SendGlyphProps {
  busy: boolean;
  morphDuration: number;
  squash: number;
  tilt: number;
}

const ARROW_UP = [12, 4.5, 18.5, 11, 14.25, 11, 14.25, 19.5, 9.75, 19.5, 9.75, 11, 5.5, 11];
const SQUARE = [12, 6, 18, 6, 18, 12, 18, 18, 6, 18, 6, 12, 6, 6];
const EASE_IN_OUT: [number, number, number, number] = [0.77, 0, 0.175, 1];
const LINE = 22;
const EDGE = 11;

const DEFAULT_SOURCES: PromptBarSource[] = [
  {
    key: "files",
    name: "Photos & files",
    description: "Upload from this device",
    icon: Attachment01Icon,
    attach: true,
  },
  { key: "web", name: "Web search", description: "Live results", icon: Globe02Icon },
  { key: "sales", name: "Sales data", description: "Revenue and churn", icon: ChartLineData01Icon },
  { key: "docs", name: "Documents", description: "Specs, notes, briefs", icon: File02Icon },
  { key: "mail", name: "Mail", description: "Read and draft mail", icon: Mail01Icon },
  {
    key: "calendar",
    name: "Calendar",
    description: "Events and availability",
    icon: Calendar03Icon,
  },
];
const DEFAULT_COMMANDS: PromptBarCommand[] = [
  { key: "summarize", name: "/summarize", description: "Digest the thread so far" },
  { key: "compare", name: "/compare", description: "Two options side by side" },
  { key: "draft", name: "/draft", description: "Write a first version" },
  { key: "explain", name: "/explain", description: "A plain-language walkthrough" },
  { key: "tasks", name: "/tasks", description: "Turn this into a to-do list" },
];
const DEFAULT_MODELS: PromptBarModel[] = [
  { key: "nova-3", name: "Nova 3", tag: "Flagship" },
  { key: "nova-mini", name: "Nova Mini", tag: "Fast" },
  { key: "nova-2", name: "Nova 2", tag: "Legacy" },
];
const DEFAULT_EFFORTS = ["Low", "Medium", "High", "Extra", "Max"];

const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const pathAt = (a: number[], b: number[], t: number) => {
  let d = "";
  for (let i = 0; i < a.length; i += 2) {
    const x = mix(a[i] ?? 0, b[i] ?? 0, t);
    const y = mix(a[i + 1] ?? 0, b[i + 1] ?? 0, t);
    d += `${i ? "L" : "M"}${x.toFixed(2)} ${y.toFixed(2)}`;
  }
  return `${d}Z`;
};

const parseToken = (draft: string): Token | null => {
  const m = /(^|\s)([@/])([\w-]*)$/.exec(draft);
  if (!m || m[1] === undefined || m[3] === undefined) return null;
  return {
    kind: m[2] === "@" ? "at" : "slash",
    query: m[3].toLowerCase(),
    start: m.index + m[1].length,
  };
};

const renderIcon = (icon: ReactNode | IconSvgElement, size: number) =>
  Array.isArray(icon) &&
  icon.every((item) => Array.isArray(item) && typeof item[0] === "string") ? (
    <HugeiconsIcon icon={icon as IconSvgElement} size={size} strokeWidth={1.8} />
  ) : (
    (icon as ReactNode)
  );

function SendGlyph({ busy, morphDuration, squash, tilt }: SendGlyphProps) {
  const reduce = useReducedMotion();
  const svgRef = useRef<SVGSVGElement>(null);
  const pathRef = useRef<SVGPathElement>(null);
  const dir = useRef(busy ? 1 : -1);
  const t = useMotionValue(busy ? 1 : 0);

  useEffect(() => {
    const target = busy ? 1 : 0;
    dir.current = busy ? 1 : -1;
    if (t.get() === target) return undefined;
    const controls = animate(
      t,
      target,
      reduce
        ? { duration: 0.12, ease: "linear" }
        : { duration: morphDuration / 1000, ease: EASE_IN_OUT },
    );
    return () => controls.stop();
  }, [busy, morphDuration, reduce, t]);

  useMotionValueEvent(t, "change", (v) => {
    pathRef.current?.setAttribute("d", pathAt(ARROW_UP, SQUARE, v));
    const goo = reduce ? 0 : Math.sin(v * Math.PI);
    const sx = 1 - squash * goo;
    if (svgRef.current) {
      svgRef.current.style.transform = goo
        ? `rotate(${dir.current * tilt * goo}deg) scale(${sx}, ${1 / sx})`
        : "";
    }
  });

  return (
    <svg
      ref={svgRef}
      className="prompt-bar__glyph"
      viewBox="0 0 24 24"
      aria-hidden="true"
      fill="currentColor"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinejoin="round"
    >
      <path ref={pathRef} d={pathAt(ARROW_UP, SQUARE, t.get())} />
    </svg>
  );
}

const PromptBar: React.FC<PromptBarProps> = ({
  editor,
  focusEditor,
  accessory,
  toolbar,
  toolbarTrailing,
  attachControl,
  toolbarProps,
  canSend: canSendOverride,
  sendDisabled,
  sendIndicator,
  placeholder = "Ask anything",
  sources = DEFAULT_SOURCES,
  commands = DEFAULT_COMMANDS,
  models = DEFAULT_MODELS,
  defaultModel = "",
  selectedModel,
  modelLabel,
  onModelChange,
  efforts = DEFAULT_EFFORTS,
  defaultEffort = "",
  selectedEffort,
  effortLabel,
  selectorsDisabled = false,
  selectorsDisabledReason,
  onEffortChange,
  busy = false,
  onSend,
  onStop,
  onAttach,
  onDictate,
  background = "#27272a",
  color = "#f5f5f5",
  menuBackground = "#323236",
  sparkColor = "#b39dff",
  sparkBoost = 1,
  width = 400,
  radius = 16,
  maxRows = 5,
  morphDuration = 240,
  squash = 0.12,
  tilt = 8,
  pressScale = 0.96,
  className = "",
}) => {
  const reduce = useReducedMotion();
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const glowRef = useRef<HTMLSpanElement>(null);
  const effortTrackRef = useRef<HTMLDivElement>(null);
  const sparkRef = useRef<HTMLCanvasElement>(null);
  const typing = useRef({ energy: 0, strokes: 0 });
  const boost = useRef(sparkBoost);
  boost.current = sparkBoost;
  const rowRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const lastOpen = useRef<string | null>(null);
  const dictation = useRef(0);
  const latest = useRef({ onSend, onStop, onAttach, onDictate, onEffortChange });
  latest.current = { onSend, onStop, onAttach, onDictate, onEffortChange };

  const [draft, setDraft] = useState("");
  const [attachments, setAttachments] = useState<string[]>([]);
  const [modelKey, setModelKey] = useState(defaultModel);
  const [plusOpen, setPlusOpen] = useState(false);
  const [modelOpen, setModelOpen] = useState(false);
  const [effortOpen, setEffortOpen] = useState(false);
  const [uncontrolledEffortIndex, setEffortIndex] = useState(() => {
    const i = efforts.indexOf(defaultEffort);
    return i >= 0 ? i : Math.max(0, Math.floor((efforts.length - 1) / 2));
  });
  const [dismissed, setDismissed] = useState(false);
  const [active, setActive] = useState(0);
  const [listening, setListening] = useState(false);
  const [pressed, setPressed] = useState(false);
  const [effortPreview, setEffortPreview] = useState<number>();

  const model =
    selectedModel === undefined
      ? (models.find((m) => m.key === modelKey) ?? models[0])
      : models.find((m) => m.key === selectedModel);
  const effortIndex =
    selectedEffort === undefined
      ? uncontrolledEffortIndex
      : Math.max(0, efforts.indexOf(selectedEffort));
  const token = dismissed ? null : parseToken(draft);
  const open = plusOpen
    ? "at"
    : (token?.kind ?? (modelOpen ? "model" : effortOpen ? "effort" : null));
  const query = plusOpen ? "" : (token?.query ?? "");
  const list = useMemo<Row[]>(() => {
    if (open === "at") return sources.filter((s) => s.name.toLowerCase().includes(query));
    if (open === "slash")
      return commands.filter((c) => c.name.replace(/^\//, "").toLowerCase().startsWith(query));
    if (open === "model") return models;
    return [];
  }, [open, query, sources, commands, models]);
  const cursor = Math.min(active, Math.max(0, list.length - 1));
  const canSend = canSendOverride ?? (draft.trim().length > 0 || attachments.length > 0);
  const armed = !sendDisabled && (busy || canSend);
  const displayedEffortIndex = effortPreview ?? effortIndex;
  const level = efforts[displayedEffortIndex] ?? "";
  const levelLabel = effortLabel?.(level) ?? level;
  const maxed = efforts.length > 1 && displayedEffortIndex === efforts.length - 1;

  const focusInput = () => {
    if (focusEditor) focusEditor();
    else inputRef.current?.focus({ preventScroll: true });
  };
  const closeMenus = useCallback(() => {
    setPlusOpen(false);
    setModelOpen(false);
    setEffortOpen(false);
  }, []);

  useEffect(() => {
    if (selectorsDisabled) {
      setModelOpen(false);
      setEffortOpen(false);
      setEffortPreview(undefined);
    }
  }, [selectorsDisabled]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: remeasure when filtering changes the rendered rows.
  useLayoutEffect(() => {
    const glow = glowRef.current;
    if (!glow || !open) return;
    const row = rowRefs.current[cursor];
    if (!row) {
      glow.style.opacity = "0";
      return;
    }
    const fresh = lastOpen.current !== open;
    lastOpen.current = open;
    if (fresh) glow.style.transition = "none";
    glow.style.top = `${row.offsetTop}px`;
    glow.style.height = `${row.offsetHeight}px`;
    glow.style.opacity = "1";
    if (fresh) {
      void glow.offsetHeight;
      glow.style.transition = "";
    }
  }, [open, cursor, list]);
  useEffect(() => {
    if (!open) lastOpen.current = null;
  }, [open]);

  useLayoutEffect(() => {
    if (open === "effort") effortTrackRef.current?.focus({ preventScroll: true });
  }, [open]);

  useEffect(() => {
    if (!plusOpen && !modelOpen && !effortOpen) return undefined;
    const onDown = (e: globalThis.PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) closeMenus();
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [plusOpen, modelOpen, effortOpen, closeMenus]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: remeasure the textarea after its draft changes.
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "0px";
    const max = LINE * maxRows;
    el.style.height = `${Math.min(el.scrollHeight, max)}px`;
    el.style.overflowY = el.scrollHeight > max ? "auto" : "hidden";
  }, [draft, maxRows]);

  useEffect(
    () => () => {
      dictation.current += 1;
    },
    [],
  );

  useEffect(() => {
    const canvas = sparkRef.current;
    if (!maxed || reduce || !canvas) return undefined;
    const ctx = canvas.getContext("2d");
    if (!ctx) return undefined;
    typing.current.strokes = 0;
    let raf = 0;
    let last = performance.now();
    let w = 0;
    let h = 0;
    let due = 0;
    let speed = 1;
    let pulse = 0;
    const parts: Spark[] = [];
    let resizePending = false;
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      w = rect.width;
      h = rect.height;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    const spawn = (burst: boolean) => {
      parts.push({
        x: Math.random() * w,
        y: burst ? h * (0.2 + Math.random() * 0.8) : h + 3,
        r: 0.9 + Math.random() * 1.1,
        vy: -(7 + Math.random() * 9),
        sway: (Math.random() - 0.5) * 10,
        phase: Math.random() * Math.PI * 2,
        life: burst ? Math.random() * 1.2 : 0,
        span: 2.4 + Math.random() * 2.4,
      });
    };
    const tick = (now: number) => {
      if (resizePending) {
        resizePending = false;
        resize();
      }
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const typed = typing.current;
      const gain = boost.current;
      typed.energy *= Math.exp(-dt / 0.8);
      pulse *= Math.exp(-dt / 0.16);
      if (typed.strokes > 0) {
        typed.strokes = 0;
        if (gain > 0) pulse = 1;
      }
      const energy = typed.energy * gain;
      speed += (1 + energy * 6 - speed) * (1 - Math.exp(-dt / 0.15));
      due += dt;
      while (due > 0.14) {
        due -= 0.14;
        if (parts.length < 30) spawn(false);
      }
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = sparkColor;
      ctx.shadowColor = sparkColor;
      ctx.shadowBlur = 6 + energy * 10 + pulse * 6;
      for (let i = parts.length - 1; i >= 0; i -= 1) {
        const p = parts[i];
        if (!p) continue;
        p.life += dt;
        if (p.life > p.span) {
          parts.splice(i, 1);
          continue;
        }
        const k = p.life / p.span;
        const twinkle = 0.7 + 0.3 * Math.sin((now / 160) * (1 + energy) + p.phase);
        p.y += p.vy * dt * speed;
        if (p.y < -4) {
          p.y = h + 3;
          p.x = Math.random() * w;
        }
        const edge = Math.min(1, Math.max(0, p.y / 14), Math.max(0, (h - p.y) / 14));
        ctx.globalAlpha =
          Math.min(1, Math.sin(k * Math.PI) * (0.9 + energy * 0.25) * twinkle) * edge;
        ctx.beginPath();
        ctx.arc(
          p.x + Math.sin((now / 900) * (1 + energy * 0.8) + p.phase) * p.sway,
          p.y,
          p.r * twinkle * (1 + energy * 0.35),
          0,
          Math.PI * 2,
        );
        ctx.fill();
      }
      raf = requestAnimationFrame(tick);
    };
    resize();
    for (let i = 0; i < 26; i += 1) spawn(true);
    const ro = new ResizeObserver(() => {
      resizePending = true;
    });
    ro.observe(canvas);
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      ctx.clearRect(0, 0, w, h);
    };
  }, [maxed, reduce, sparkColor]);

  const setEffort = (i: number) => {
    const next = Math.max(0, Math.min(efforts.length - 1, i));
    const effort = efforts[next];
    if (selectorsDisabled || next === effortIndex || effort === undefined) return;
    setEffortIndex(next);
    latest.current.onEffortChange?.(effort);
  };
  const effortFromPointer = (e: PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const k = (e.clientX - rect.left - EDGE) / Math.max(1, rect.width - 2 * EDGE);
    return Math.max(0, Math.min(efforts.length - 1, Math.round(k * (efforts.length - 1))));
  };
  const onEffortKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const step =
      e.key === "ArrowRight" || e.key === "ArrowUp"
        ? 1
        : e.key === "ArrowLeft" || e.key === "ArrowDown"
          ? -1
          : 0;
    if (step) {
      e.preventDefault();
      setEffort(effortIndex + step);
    } else if (e.key === "Home") {
      e.preventDefault();
      setEffort(0);
    } else if (e.key === "End") {
      e.preventDefault();
      setEffort(efforts.length - 1);
    } else if (e.key === "Escape") {
      setEffortOpen(false);
      focusInput();
    }
  };
  const stepAt = (i: number) =>
    `calc(${EDGE}px + (100% - ${EDGE * 2}px) * ${i / Math.max(1, efforts.length - 1)})`;
  const fillAt = (i: number) => (i === efforts.length - 1 ? "100%" : `calc(${stepAt(i)} + 7px)`);

  const pick = (row: Row) => {
    if (open === "model") {
      if (selectorsDisabled) return;
      setModelKey(row.key);
      onModelChange?.(row.key);
      setModelOpen(false);
      focusInput();
      return;
    }
    const head = token ? draft.slice(0, token.start) : draft;
    if (row.attach) {
      setDraft(head);
      Promise.resolve(latest.current.onAttach?.()).then((files) => {
        if (!files) return;
        setAttachments((a) => [...a, ...(Array.isArray(files) ? files : [files])]);
      });
    } else if (open === "at") {
      setDraft(`${head}@${row.name} `);
    } else {
      setDraft(`${head}${row.name} `);
    }
    setPlusOpen(false);
    setDismissed(false);
    focusInput();
  };

  const send = () => {
    if (!armed || busy) return;
    latest.current.onSend?.(draft.trim(), {
      attachments,
      ...(model ? { model } : {}),
      effort: level,
    });
    if (!editor) {
      setDraft("");
      setAttachments([]);
    }
    setDismissed(false);
    closeMenus();
    focusInput();
  };

  const toggleListen = () => {
    if (listening) {
      dictation.current += 1;
      setListening(false);
      return;
    }
    const seq = ++dictation.current;
    setListening(true);
    Promise.resolve(latest.current.onDictate?.()).then(
      (text) => {
        if (seq !== dictation.current) return;
        setListening(false);
        if (text) setDraft((d) => (d.trim() ? `${d.trimEnd()} ${text}` : text));
        focusInput();
      },
      () => {
        if (seq === dictation.current) setListening(false);
      },
    );
  };

  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    const currentRow = list[cursor];
    if (open && currentRow) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const next = (cursor + (e.key === "ArrowDown" ? 1 : list.length - 1)) % list.length;
        setActive(next);
        if (open === "model") rowRefs.current[next]?.scrollIntoView?.({ block: "nearest" });
        return;
      }
      if ((e.key === "Enter" && !e.shiftKey) || e.key === "Tab") {
        e.preventDefault();
        pick(currentRow);
        return;
      }
    }
    if (e.key === "Escape") {
      if (open) {
        e.preventDefault();
        setDismissed(true);
        closeMenus();
      }
      return;
    }
    if (!editor && e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send();
    }
  };

  const down = (e: PointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0 || !armed) return;
    setPressed(true);
  };
  const up = () => setPressed(false);

  return (
    <div
      ref={rootRef}
      className={`prompt-bar${className ? ` ${className}` : ""}`}
      data-busy={busy ? "" : undefined}
      data-max={maxed ? "" : undefined}
      style={
        {
          "--pb-bg": background,
          "--pb-ink": color,
          "--pb-menu": menuBackground,
          "--pb-w": `${width}px`,
          "--pb-radius": typeof radius === "number" ? `${radius}px` : radius,
          "--pb-spark": sparkColor,
          "--pb-press": pressScale,
        } as CSSProperties
      }
    >
      {open ? (
        // biome-ignore lint/a11y/useAriaPropsSupportedByRole: both dialog and listbox support an accessible name.
        <div
          className="prompt-bar__menu"
          role={open === "effort" ? "dialog" : "listbox"}
          aria-label={
            open === "at"
              ? "Sources"
              : open === "slash"
                ? "Commands"
                : open === "model"
                  ? "Models"
                  : "Effort"
          }
          data-kind={open}
        >
          {open === "effort" ? (
            <>
              <div className="prompt-bar__effort-head">
                <span className="prompt-bar__effort-title">Effort</span>
                <span className="prompt-bar__effort-level">{levelLabel}</span>
                <span
                  className="prompt-bar__effort-help"
                  title="Higher effort thinks longer before answering"
                >
                  <HugeiconsIcon icon={HelpCircleIcon} size={14} strokeWidth={1.8} />
                </span>
              </div>
              <div className="prompt-bar__effort-ends">
                <span>Faster</span>
                <span>Smarter</span>
              </div>
              <div
                className="prompt-bar__effort-track"
                ref={effortTrackRef}
                role="slider"
                tabIndex={0}
                aria-label="Effort"
                aria-valuemin={0}
                aria-valuemax={efforts.length - 1}
                aria-valuenow={displayedEffortIndex}
                aria-valuetext={levelLabel}
                style={
                  {
                    "--pb-effort-x": stepAt(displayedEffortIndex),
                    "--pb-effort-fill": fillAt(displayedEffortIndex),
                  } as CSSProperties
                }
                onPointerDown={(e) => {
                  if (e.button !== 0) return;
                  try {
                    e.currentTarget.setPointerCapture(e.pointerId);
                  } catch {}
                  e.currentTarget.focus({ preventScroll: true });
                  setEffortPreview(effortFromPointer(e));
                }}
                onPointerMove={(e) => {
                  if (e.buttons & 1) setEffortPreview(effortFromPointer(e));
                }}
                onPointerUp={(e) => {
                  if (e.button !== 0) return;
                  setEffortPreview(undefined);
                  setEffort(effortFromPointer(e));
                }}
                onPointerCancel={() => setEffortPreview(undefined)}
                onKeyDown={onEffortKey}
              >
                <span className="prompt-bar__effort-fill" />
                {efforts.map((label, i) => (
                  <i key={label} className="prompt-bar__effort-dot" style={{ left: stepAt(i) }} />
                ))}
                <span className="prompt-bar__effort-thumb" />
              </div>
            </>
          ) : (
            <>
              <span ref={glowRef} className="prompt-bar__glow" aria-hidden="true" />
              {list.map((row, i) => (
                <button
                  key={row.key}
                  ref={(el) => {
                    rowRefs.current[i] = el;
                  }}
                  type="button"
                  role="option"
                  aria-label={row.name}
                  aria-selected={i === cursor}
                  className="prompt-bar__row"
                  onMouseDown={(e) => e.preventDefault()}
                  onPointerEnter={() => setActive(i)}
                  onClick={() => pick(row)}
                >
                  {open === "at" ? (
                    <span className="prompt-bar__row-icon">{renderIcon(row.icon, 15)}</span>
                  ) : null}
                  <span className="prompt-bar__row-name">{row.name}</span>
                  {row.description ? (
                    <span className="prompt-bar__row-desc">{row.description}</span>
                  ) : null}
                  {open === "model" ? (
                    <>
                      <span className="prompt-bar__row-tag">{row.tag}</span>
                      <span
                        className="prompt-bar__row-check"
                        data-on={row.key === model?.key ? "" : undefined}
                      >
                        <HugeiconsIcon icon={Tick02Icon} size={13} strokeWidth={2.5} />
                      </span>
                    </>
                  ) : null}
                </button>
              ))}
              {list.length === 0 ? (
                <div className="prompt-bar__empty">No matches for “{query}”</div>
              ) : null}
            </>
          )}
        </div>
      ) : null}

      {/* biome-ignore lint/a11y/noStaticElementInteractions: clicking the field padding focuses the keyboard-accessible editor. */}
      <div
        className="prompt-bar__field"
        role="presentation"
        data-max={maxed ? "" : undefined}
        onPointerDown={(e) => {
          if (e.target === e.currentTarget || e.target === inputRef.current) closeMenus();
        }}
        onKeyDownCapture={(e) => {
          if (
            !editor ||
            !open ||
            !(e.target instanceof HTMLElement) ||
            !e.target.closest('[contenteditable="true"]') ||
            e.nativeEvent.isComposing
          )
            return;
          onKeyDown(e);
          if (e.defaultPrevented) e.stopPropagation();
        }}
        onClick={(e) => {
          if (!editor || e.target === e.currentTarget) focusInput();
        }}
      >
        {maxed && !reduce ? (
          <canvas ref={sparkRef} className="prompt-bar__sparks" aria-hidden="true" tabIndex={-1} />
        ) : null}
        {attachments.length > 0 ? (
          <div className="prompt-bar__chips">
            {attachments.map((file, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: chips are stateless and attachment names can repeat.
              <span key={`${file}-${i}`} className="prompt-bar__chip">
                <HugeiconsIcon icon={File02Icon} size={12} strokeWidth={2} />
                <span className="prompt-bar__chip-name">{file}</span>
                <button
                  type="button"
                  className="prompt-bar__chip-x"
                  aria-label={`Remove ${file}`}
                  onClick={() => setAttachments((a) => a.filter((_, j) => j !== i))}
                >
                  <HugeiconsIcon icon={Cancel01Icon} size={10} strokeWidth={2.5} />
                </button>
              </span>
            ))}
          </div>
        ) : null}

        {editor ?? (
          <textarea
            ref={inputRef}
            className="prompt-bar__input"
            rows={1}
            value={draft}
            placeholder={listening ? "Listening…" : placeholder}
            aria-label="Prompt"
            onChange={(e) => {
              setDraft(e.target.value);
              typing.current.energy = Math.min(1.6, typing.current.energy + 0.22);
              typing.current.strokes = Math.min(4, typing.current.strokes + 1);
              setDismissed(false);
              closeMenus();
              setActive(0);
            }}
            onFocus={closeMenus}
            onKeyDown={onKeyDown}
          />
        )}
        {accessory}

        <div {...toolbarProps} className={`prompt-bar__bar ${toolbarProps?.className ?? ""}`}>
          {attachControl ??
            (sources.length > 0 ? (
              <button
                type="button"
                className="prompt-bar__tool"
                aria-label="Add files and sources"
                aria-expanded={plusOpen}
                data-on={plusOpen ? "" : undefined}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  setModelOpen(false);
                  setEffortOpen(false);
                  setActive(0);
                  setPlusOpen((v) => !v);
                  focusInput();
                }}
              >
                <HugeiconsIcon icon={PlusSignIcon} size={16} strokeWidth={2} />
              </button>
            ) : null)}
          {models.length > 0 || modelLabel ? (
            <button
              type="button"
              className="prompt-bar__pick"
              aria-label="Choose model"
              aria-description={selectorsDisabledReason}
              data-testid="model-picker-trigger"
              disabled={selectorsDisabled}
              aria-expanded={modelOpen}
              data-on={modelOpen ? "" : undefined}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                setPlusOpen(false);
                setEffortOpen(false);
                setActive(model ? Math.max(0, models.indexOf(model)) : 0);
                setModelOpen((v) => !v);
                focusInput();
              }}
            >
              <span>{modelLabel ?? model?.name ?? "Choose model"}</span>
              <HugeiconsIcon icon={ArrowDown01Icon} size={12} strokeWidth={2.4} />
            </button>
          ) : null}
          {efforts.length > 0 ? (
            <button
              type="button"
              className="prompt-bar__pick"
              aria-label="Choose effort"
              aria-description={selectorsDisabledReason}
              disabled={selectorsDisabled}
              aria-expanded={effortOpen}
              data-on={effortOpen ? "" : undefined}
              data-max={maxed ? "" : undefined}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                setPlusOpen(false);
                setModelOpen(false);
                setEffortOpen((v) => !v);
                focusInput();
              }}
            >
              <HugeiconsIcon icon={SparklesIcon} size={13} strokeWidth={2} />
              <span>{levelLabel}</span>
            </button>
          ) : null}
          {toolbar}
          <span className="prompt-bar__spacer" />
          {toolbarTrailing}
          {onDictate ? (
            <button
              type="button"
              className="prompt-bar__tool"
              aria-label={listening ? "Stop dictation" : "Dictate"}
              aria-pressed={listening}
              data-on={listening ? "" : undefined}
              onMouseDown={(e) => e.preventDefault()}
              onClick={toggleListen}
            >
              {listening ? (
                <span className="prompt-bar__eq" aria-hidden="true">
                  <i />
                  <i />
                  <i />
                </span>
              ) : (
                <HugeiconsIcon icon={Mic01Icon} size={15} strokeWidth={2} />
              )}
            </button>
          ) : null}
          <button
            type="button"
            className="prompt-bar__send"
            disabled={!armed}
            aria-label={busy ? "Stop" : "Send"}
            data-armed={armed ? "" : undefined}
            data-pressed={pressed ? "" : undefined}
            onMouseDown={(e) => e.preventDefault()}
            onPointerDown={down}
            onPointerUp={up}
            onPointerCancel={up}
            onPointerLeave={up}
            onClick={() => {
              if (busy) latest.current.onStop?.();
              else send();
            }}
          >
            {sendIndicator ?? (
              <SendGlyph busy={busy} morphDuration={morphDuration} squash={squash} tilt={tilt} />
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default PromptBar;
