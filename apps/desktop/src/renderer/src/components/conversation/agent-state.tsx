"use client";

import { X } from "lucide-react";
import { motion, useInView, useReducedMotion } from "motion/react";
import { Dialog } from "radix-ui";
// Adapted from Agent state by Cojeev (000h), MIT: https://cojeev.com/ui/docs/agent-state/
import * as React from "react";
import { cn } from "../../lib/cn";

export type AgentStatus = "idle" | "thinking" | "working" | "needs-input" | "complete" | "error";
export type AgentStateProps = Omit<React.ComponentProps<"div">, "children"> & {
  status?: AgentStatus;
  size?: "sm" | "md" | "lg";
  label?: string | undefined;
  description?: string | undefined;
};

const stateLabels: Record<AgentStatus, string> = {
  idle: "Ready when you are",
  thinking: "Thinking",
  working: "Working",
  "needs-input": "Your decision",
  complete: "Complete",
  error: "Needs attention",
};
const statusLabels: Record<AgentStatus, string> = {
  idle: "Inativo",
  thinking: "Pensando",
  working: "Trabalhando",
  "needs-input": "Aguardando sua resposta",
  complete: "Concluído",
  error: "Com erro",
};

// Matching cubic topology keeps the sculpted silhouette morph smooth between states.
const silhouettes: Record<AgentStatus, string> = {
  idle: "M90 24C116 17 151 32 153 60C157 84 139 96 124 116C111 135 81 141 59 126C34 113 22 85 32 61C43 36 65 31 90 24Z",
  thinking:
    "M90 18C120 27 132 19 148 51C163 78 141 92 135 116C127 146 94 137 68 129C40 123 18 98 30 70C40 48 66 7 90 18Z",
  working:
    "M90 17C114 11 156 41 151 65C146 85 165 110 134 123C106 140 85 121 61 131C34 140 17 94 30 71C44 47 68 25 90 17Z",
  "needs-input":
    "M90 27C121 20 147 29 145 61C143 82 162 111 134 125C108 138 91 114 65 127C35 140 28 101 31 76C34 48 62 33 90 27Z",
  complete:
    "M90 24C118 24 145 36 150 63C155 91 134 116 112 125C87 137 63 128 47 113C29 95 25 69 40 47C53 28 66 24 90 24Z",
  error:
    "M90 30C113 7 131 35 147 54C167 77 135 93 139 117C142 142 105 128 83 132C55 139 18 117 28 89C37 65 60 40 90 30Z",
};

export function AgentState({
  status = "idle",
  size = "md",
  label,
  description,
  className,
  ...props
}: AgentStateProps) {
  const id = React.useId().replace(/:/g, "");
  const ref = React.useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { margin: "40px" });
  const reduceMotion = useReducedMotion();
  const [visible, setVisible] = React.useState(
    () => typeof document === "undefined" || document.visibilityState !== "hidden",
  );
  React.useEffect(() => {
    const update = () => setVisible(document.visibilityState !== "hidden");
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);
  const active =
    !reduceMotion && visible && inView && (status === "thinking" || status === "working");
  const contour = silhouettes[status];
  const alternate = silhouettes[status === "thinking" ? "working" : "thinking"];
  const morph = active ? { d: [contour, alternate, contour] } : { d: contour };
  const fieldTransition = active
    ? { duration: status === "working" ? 5 : 7, repeat: Infinity, ease: "easeInOut" as const }
    : { duration: reduceMotion ? 0 : 0.45 };

  return (
    <div
      ref={ref}
      data-slot="agent-state"
      data-status={status}
      data-size={size}
      className={cn("agent-state", className)}
      role="status"
      aria-live="polite"
      aria-atomic="true"
      {...props}
    >
      <svg
        className="agent-state__field"
        viewBox="0 0 180 160"
        fill="none"
        aria-hidden="true"
        focusable="false"
      >
        <defs>
          <radialGradient id={`${id}-body`} cx=".3" cy=".2" r=".85">
            <stop stopColor="var(--agent-light)" />
            <stop offset=".5" stopColor="var(--agent-base)" />
            <stop offset="1" stopColor="var(--agent-deep)" />
          </radialGradient>
          <radialGradient id={`${id}-fold`} cx=".65" cy=".22" r=".8">
            <stop stopColor="var(--agent-cream)" stopOpacity=".84" />
            <stop offset=".4" stopColor="var(--agent-light)" stopOpacity=".7" />
            <stop offset="1" stopColor="var(--agent-deep)" stopOpacity=".2" />
          </radialGradient>
          <linearGradient
            id={`${id}-rim`}
            x1="30"
            y1="30"
            x2="138"
            y2="134"
            gradientUnits="userSpaceOnUse"
          >
            <stop stopColor="var(--agent-cream)" stopOpacity=".92" />
            <stop offset=".48" stopColor="var(--agent-light)" stopOpacity=".2" />
            <stop offset="1" stopColor="var(--agent-deep)" stopOpacity=".8" />
          </linearGradient>
          <clipPath id={`${id}-clip`}>
            <motion.path initial={false} d={contour} animate={morph} transition={fieldTransition} />
          </clipPath>
        </defs>
        <ellipse cx="92" cy="139" rx="43" ry="5" fill="var(--agent-deep)" opacity=".12" />
        <motion.path
          initial={false}
          d={contour}
          animate={morph}
          transition={fieldTransition}
          fill={`url(#${id}-body)`}
        />
        <g clipPath={`url(#${id}-clip)`}>
          <motion.g
            initial={false}
            animate={active ? { rotate: [0, 12, -6, 0], x: [0, 5, -3, 0] } : { rotate: 0, x: 0 }}
            transition={
              active ? { duration: 10, repeat: Infinity, ease: "easeInOut" } : fieldTransition
            }
            style={{ transformOrigin: "90px 80px" }}
          >
            <path
              d="M15 61C51 32 81 110 128 89C165 72 142 24 105 14C163 7 181 113 125 142C74 168 20 125 15 61Z"
              fill={`url(#${id}-fold)`}
            />
            <path
              d="M26 48C64 18 59 134 119 110C147 99 132 71 155 47"
              stroke={`url(#${id}-rim)`}
              strokeWidth="1.2"
            />
            <path
              d="M30 44C69 19 58 139 125 111C151 99 136 69 159 43"
              stroke={`url(#${id}-rim)`}
              strokeWidth=".65"
              opacity=".75"
            />
            <path
              d="M35 42C74 26 64 143 131 109C154 97 141 65 162 40"
              stroke={`url(#${id}-rim)`}
              strokeWidth=".5"
              opacity=".5"
            />
            <path
              d="M24 92C47 78 93 148 139 118"
              stroke="var(--agent-deep)"
              strokeOpacity=".25"
              strokeWidth="14"
            />
          </motion.g>
        </g>
        <motion.path
          initial={false}
          d={contour}
          animate={morph}
          transition={fieldTransition}
          stroke={`url(#${id}-rim)`}
          strokeWidth="1.2"
        />
        <g
          className="agent-state__mark"
          stroke="var(--agent-ink)"
          strokeWidth="2.3"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          {status === "complete" ? (
            <path d="m77 79 9 9 19-21" />
          ) : status === "error" ? (
            <>
              <path d="M90 66v16" />
              <path d="M90 91h.01" />
            </>
          ) : status === "needs-input" ? (
            <>
              <path d="M84 72a7 7 0 0 1 14 0c0 5-8 6-8 11" />
              <path d="M90 92h.01" />
            </>
          ) : (
            <>
              <path d="M77 77v5M101 77v5" />
              <path d={status === "idle" ? "M84 91q6 4 12 0" : "M85 91h10"} />
            </>
          )}
        </g>
      </svg>
      <div className="agent-state__copy">
        <span className="agent-state__label">{label ?? stateLabels[status]}</span>
        {description && <span className="agent-state__description">{description}</span>}
      </div>
      <span className="sr-only">Estado: {statusLabels[status]}</span>
    </div>
  );
}

export type AgentStateDetailsData = {
  name: string;
  status: AgentStatus;
  activity?: string | undefined;
  details?: string | undefined;
};

export function AgentStateDetails({ event }: { event: AgentStateDetailsData | null }) {
  if (!event) return null;

  return (
    <Dialog.Root>
      <Dialog.Trigger asChild>
        <button
          type="button"
          className="agent-state-trigger"
          aria-label={`${event.name}, ${statusLabels[event.status]}; abrir detalhes`}
        >
          <AgentState
            status={event.status}
            size="sm"
            label={event.name}
            description={event.activity}
          />
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="agent-dialog-overlay" />
        <Dialog.Content
          className="agent-dialog"
          aria-describedby={
            event.activity || event.details ? "agent-dialog-description" : undefined
          }
        >
          <Dialog.Close className="agent-dialog-close" aria-label="Fechar detalhes">
            <X size={17} aria-hidden="true" />
          </Dialog.Close>
          <AgentState status={event.status} size="sm" aria-hidden="true" />
          <Dialog.Title className="agent-dialog-title">{event.name}</Dialog.Title>
          <p className="agent-dialog-description">Estado: {statusLabels[event.status]}</p>
          {(event.activity || event.details) && (
            <Dialog.Description id="agent-dialog-description" className="agent-dialog-description">
              {event.activity}
              {event.activity && event.details ? " — " : ""}
              {event.details}
            </Dialog.Description>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
