import { IconLayoutSidebarLeftExpand } from "@tabler/icons-react";
import { useCallback, useEffect, useRef } from "react";
import "./DoomHome.css";

const source = () =>
  location.protocol === "file:"
    ? "modus-game://home/doom.html"
    : new URL("/doom.html", location.href).href;

export function DoomHome({
  active = true,
  sidebarOpen,
  onToggleSidebar,
}: {
  /** The home route is on screen; false keeps the game mounted but paused. */
  active?: boolean;
  sidebarOpen: boolean;
  onToggleSidebar(): void;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const pause = useCallback(
    () => frame.current?.contentWindow?.postMessage({ type: "modus-doom-pause" }, "*"),
    [],
  );
  useEffect(() => {
    if (!active || sidebarOpen) pause();
  }, [active, sidebarOpen, pause]);
  useEffect(() => {
    const message = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow || event.data?.type !== "modus-doom")
        return;
      if (event.data.state === "focus-composer") {
        document
          .querySelector<HTMLElement>(
            '[data-home-composer] [contenteditable="true"], [data-home-composer] textarea',
          )
          ?.focus();
      }
    };
    const focus = (event: FocusEvent) => {
      if (event.target !== frame.current) pause();
    };
    window.addEventListener("message", message);
    document.addEventListener("focusin", focus);
    return () => {
      pause();
      window.removeEventListener("message", message);
      document.removeEventListener("focusin", focus);
    };
  }, [pause]);
  return (
    <div className="doom-home-stage" data-testid="doom-home">
      <iframe
        ref={frame}
        src={source()}
        title="DOOM Web Wide"
        allow="autoplay"
        className="doom-home-frame"
        sandbox="allow-scripts allow-same-origin allow-pointer-lock"
      />
      <div className="doom-home-drag app-drag" aria-hidden="true" />
      <button
        type="button"
        className="doom-home-sidebar app-no-drag"
        aria-label="Abrir navegação"
        aria-expanded={sidebarOpen}
        onClick={onToggleSidebar}
      >
        <IconLayoutSidebarLeftExpand size={21} />
      </button>
      <div className="doom-home-commands app-no-drag">
        <dl aria-label="Controles do DOOM">
          {[
            ["WASD", "Mover"],
            ["Mouse", "Mirar"],
            ["Clique", "Atirar"],
            ["Espaço", "Interagir"],
            ["Shift", "Correr"],
            ["Esc", "Liberar mouse"],
          ].map(([key, label]) => (
            <div key={key}>
              <dt>
                <kbd>{key}</kbd>
              </dt>
              <dd>{label}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}
