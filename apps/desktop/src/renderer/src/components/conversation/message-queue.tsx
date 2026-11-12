"use client";

import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { Menu } from "@base-ui/react/menu";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "cn";
import {
  Forward as Forward2Icon,
  Ellipsis as MoreIcon,
  ListEnd as QueueIcon,
  Trash2 as TrashIcon,
} from "lucide-react";
import { AnimatePresence, Reorder, useDragControls, useReducedMotion } from "motion/react";
import * as React from "react";
import { reducedFade } from "../../lib/motion";

const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-md border border-transparent bg-clip-padding text-sm font-medium whitespace-nowrap transition-all outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/80",
        outline:
          "border-border bg-background hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:border-input dark:bg-input/30 dark:hover:bg-input/50",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_5%)] aria-expanded:bg-secondary aria-expanded:text-secondary-foreground",
        ghost:
          "hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:hover:bg-muted/50",
        destructive:
          "bg-destructive/10 text-destructive hover:bg-destructive/20 focus-visible:border-destructive/40 focus-visible:ring-destructive/20 dark:bg-destructive/20 dark:hover:bg-destructive/30 dark:focus-visible:ring-destructive/40",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default:
          "h-8 gap-1.5 px-2.5 pb-0.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        xs: "h-6 gap-1 rounded-[min(var(--radius-md),10px)] px-2 pb-0.5 text-xs in-data-[slot=button-group]:rounded-md has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-7 gap-1 rounded-[min(var(--radius-md),12px)] px-2.5 pb-0.5 text-[0.8rem] in-data-[slot=button-group]:rounded-md has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-9 gap-1.5 px-2.5 pb-0.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        icon: "size-8",
        "icon-xs":
          "size-6 rounded-[min(var(--radius-md),10px)] in-data-[slot=button-group]:rounded-md [&_svg:not([class*='size-'])]:size-3",
        "icon-sm":
          "size-7 rounded-[min(var(--radius-md),12px)] in-data-[slot=button-group]:rounded-md",
        "icon-lg": "size-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

function Button({
  className,
  variant = "default",
  size = "default",
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

interface QueuedMessage {
  attachments?: number | undefined;
  content: string;
  id: string;
  status?: "queued" | "sending";
}

interface MessageQueueProps extends React.ComponentProps<"section"> {
  items: QueuedMessage[];
  onRemove?: (id: string) => void;
  onSendNow?: (id: string, origin: DOMRect | undefined) => void;
  onMoveToTop?: (id: string) => void;
  onReorder?: (items: QueuedMessage[]) => void;
}

function QueueRow({
  item,
  enabled,
  onMove,
  children,
}: {
  item: QueuedMessage;
  enabled: boolean;
  onMove: (direction: number) => void;
  children: React.ReactNode;
}) {
  const controls = useDragControls();
  const reducedMotion = useReducedMotion();
  return (
    <Reorder.Item
      value={item}
      dragListener={false}
      dragControls={controls}
      className="group/queue-row relative flex items-center gap-2 rounded-md py-0.5"
      whileDrag={{ zIndex: 10 }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{
        default: reducedMotion ? reducedFade : { type: "spring", stiffness: 500, damping: 40 },
        opacity: reducedMotion ? reducedFade : { duration: 0.15, ease: [0.23, 1, 0.32, 1] },
      }}
    >
      <button
        type="button"
        disabled={!enabled}
        aria-label={`Reorder message: ${item.content}`}
        title="Drag to reorder, or use Up and Down arrow keys"
        className="relative flex h-7 w-4 shrink-0 touch-none items-center justify-center rounded-sm text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing enabled:cursor-grab"
        onPointerDown={(event) => {
          if (enabled) controls.start(event);
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowUp" || event.key === "ArrowDown") {
            event.preventDefault();
            onMove(event.key === "ArrowUp" ? -1 : 1);
          }
        }}
      >
        <QueueIcon
          aria-hidden="true"
          className={cn(
            "absolute size-4 opacity-100 transition-opacity duration-150 ease-out",
            enabled && "group-focus-within/queue-row:opacity-0 group-hover/queue-row:opacity-0",
          )}
        />
        <svg
          className={cn(
            "absolute size-4 opacity-0 transition-opacity duration-150 ease-out",
            enabled && "group-focus-within/queue-row:opacity-100 group-hover/queue-row:opacity-100",
          )}
          aria-hidden="true"
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="currentColor"
        >
          {[4, 8, 12].map((y) => (
            <React.Fragment key={y}>
              <circle cx="5" cy={y} r="1" />
              <circle cx="11" cy={y} r="1" />
            </React.Fragment>
          ))}
        </svg>
      </button>
      {children}
    </Reorder.Item>
  );
}

function MessageQueue({
  className,
  items,
  onRemove,
  onSendNow,
  onMoveToTop,
  onReorder,
  ...props
}: MessageQueueProps) {
  return (
    <section
      aria-label="Queued messages"
      data-slot="message-queue"
      className={cn(
        "rounded-[16px] bg-card p-3 font-sans text-sm font-[450] tracking-[-0.05px] text-muted-foreground shadow-card",
        className,
      )}
      {...props}
    >
      <Reorder.Group as="ol" axis="y" values={items} onReorder={(next) => onReorder?.(next)}>
        <AnimatePresence initial={false}>
          {items.map((item, index) => (
            <QueueRow
              key={item.id}
              item={item}
              enabled={!!onReorder}
              onMove={(direction) => {
                const target = index + direction;
                if (target < 0 || target >= items.length) return;
                const next = [...items];
                [next[index], next[target]] = [next[target]!, next[index]!];
                onReorder?.(next);
              }}
            >
              <p className="line-clamp-2 min-w-0 flex-1 text-sm leading-5 font-[450] text-muted-foreground">
                {item.content}
              </p>
              {item.attachments ? (
                <span className="shrink-0 text-xs leading-5 font-[450] text-muted-foreground">
                  {item.attachments} {item.attachments === 1 ? "image" : "images"}
                </span>
              ) : null}
              <div className="flex shrink-0 items-center gap-1">
                {onSendNow && (
                  <Button
                    type="button"
                    disabled={item.status === "sending"}
                    onClick={(event) =>
                      onSendNow?.(
                        item.id,
                        event.currentTarget
                          .closest("li")
                          ?.querySelector("p")
                          ?.getBoundingClientRect(),
                      )
                    }
                    size="sm"
                    variant="ghost"
                    className="gap-1.5 text-sm font-[450] tracking-[-0.05px] text-muted-foreground"
                  >
                    <Forward2Icon className="size-4" />
                    {item.status === "sending" ? "Enviando…" : "Enviar agora"}
                  </Button>
                )}
                <Button
                  type="button"
                  aria-label={`Remove queued message: ${item.content}`}
                  onClick={() => onRemove?.(item.id)}
                  size="icon-sm"
                  variant="ghost"
                >
                  <TrashIcon className="size-4" />
                </Button>
                <Menu.Root>
                  <Menu.Trigger
                    render={
                      <Button
                        type="button"
                        aria-label={`Mais ações para: ${item.content}`}
                        size="icon-sm"
                        variant="ghost"
                      />
                    }
                  >
                    <MoreIcon className="size-4" />
                  </Menu.Trigger>
                  <Menu.Portal>
                    <Menu.Positioner side="bottom" align="end" sideOffset={6} className="z-50">
                      <Menu.Popup className="min-w-36 origin-(--transform-origin) rounded-[16px] bg-card p-1 font-sans text-sm font-[450] tracking-[-0.05px] text-muted-foreground shadow-card transition-[opacity,scale] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] outline-none data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0 motion-reduce:transition-opacity">
                        <Menu.Item
                          className="cursor-pointer rounded-[12px] px-3 py-2 outline-none data-highlighted:bg-muted"
                          onClick={() => navigator.clipboard.writeText(item.content)}
                        >
                          Copy message
                        </Menu.Item>
                        {onMoveToTop && (
                          <Menu.Item
                            disabled={index === 0}
                            className="cursor-pointer rounded-[12px] px-3 py-2 outline-none data-highlighted:bg-muted data-disabled:opacity-40"
                            onClick={() => onMoveToTop(item.id)}
                          >
                            Move to top
                          </Menu.Item>
                        )}
                      </Menu.Popup>
                    </Menu.Positioner>
                  </Menu.Portal>
                </Menu.Root>
              </div>
            </QueueRow>
          ))}
        </AnimatePresence>
      </Reorder.Group>
      {!items.length && (
        <p className="px-2 py-3 text-xs leading-5 font-[450] text-muted-foreground">
          Nenhuma mensagem na fila.
        </p>
      )}
    </section>
  );
}

export type { MessageQueueProps, QueuedMessage };
export { MessageQueue };
export default MessageQueue;
