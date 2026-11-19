import { useEffect, useRef } from "react";
import type { BrowserFrameEvent, BrowserInputEvent } from "../../../../shared/contracts";

const MODIFIER_BITS = { alt: 1, ctrl: 2, meta: 4, shift: 8 } as const;

function modifiersOf(event: {
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}): number {
  return (
    (event.altKey ? MODIFIER_BITS.alt : 0) |
    (event.ctrlKey ? MODIFIER_BITS.ctrl : 0) |
    (event.metaKey ? MODIFIER_BITS.meta : 0) |
    (event.shiftKey ? MODIFIER_BITS.shift : 0)
  );
}

function mouseButtonName(button: number): "left" | "middle" | "right" | "none" {
  if (button === 0) return "left";
  if (button === 1) return "middle";
  if (button === 2) return "right";
  return "none";
}

/**
 * Canvas that renders `browser:frame` screencast JPEGs for a remote
 * (headless-CDP) tab and forwards DOM input back through `browser:input`.
 * Only mounted when the app runs over the WS transport (Tauri mode): under
 * Electron the native WebContentsView paints into the same host hole.
 */
export function RemoteBrowserSurface({ tabId }: { tabId: string }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const tabIdRef = useRef(tabId);
  tabIdRef.current = tabId;
  const pointerDownRef = useRef(false);

  useEffect(() => {
    const off = window.modus.browser.onFrame((frame: BrowserFrameEvent) => {
      if (frame.tabId !== tabIdRef.current) return;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const img = new Image();
      img.onload = () => {
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        if (canvas.width !== img.naturalWidth || canvas.height !== img.naturalHeight) {
          canvas.width = img.naturalWidth;
          canvas.height = img.naturalHeight;
        }
        ctx.drawImage(img, 0, 0);
      };
      img.src = `data:image/jpeg;base64,${frame.data}`;
    });
    return off;
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;

    const scalePoint = (clientX: number, clientY: number) => {
      const rect = canvas.getBoundingClientRect();
      const sx = rect.width > 0 ? canvas.width / rect.width : 1;
      const sy = rect.height > 0 ? canvas.height / rect.height : 1;
      return { x: (clientX - rect.left) * sx, y: (clientY - rect.top) * sy };
    };

    const send = (event: BrowserInputEvent): void => {
      void window.modus.browser.sendInput({ tabId: tabIdRef.current, event });
    };

    const onMouse = (dom: MouseEvent): void => {
      const { x, y } = scalePoint(dom.clientX, dom.clientY);
      const type =
        dom.type === "mousedown"
          ? "mousePressed"
          : dom.type === "mouseup"
            ? "mouseReleased"
            : "mouseMoved";
      if (dom.type === "mousedown") pointerDownRef.current = true;
      if (dom.type === "mouseup") pointerDownRef.current = false;
      send({
        kind: "mouse",
        type,
        x,
        y,
        button: mouseButtonName(dom.button),
        clickCount: dom.type === "mousemove" ? 0 : 1,
        modifiers: modifiersOf(dom),
      });
      dom.preventDefault();
    };

    const onWheel = (dom: WheelEvent): void => {
      const { x, y } = scalePoint(dom.clientX, dom.clientY);
      send({
        kind: "mouse",
        type: "mouseWheel",
        x,
        y,
        deltaX: dom.deltaX,
        deltaY: dom.deltaY,
        modifiers: modifiersOf(dom),
      });
      dom.preventDefault();
    };

    const onKey = (dom: KeyboardEvent): void => {
      const down = dom.type === "keydown";
      const modifiers = modifiersOf(dom);
      send({
        kind: "key",
        type: down ? "keyDown" : "keyUp",
        key: dom.key,
        code: dom.code,
        modifiers,
      });
      if (down && dom.key.length === 1 && !dom.ctrlKey && !dom.metaKey && !dom.altKey) {
        send({ kind: "key", type: "char", key: dom.key, text: dom.key, modifiers });
      }
      // Let browser UI shortcuts reach the app; consume plain typing.
      if (!dom.ctrlKey && !dom.metaKey) dom.preventDefault();
    };

    canvas.addEventListener("mousedown", onMouse);
    canvas.addEventListener("mouseup", onMouse);
    canvas.addEventListener("mousemove", onMouse);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    canvas.addEventListener("keydown", onKey);
    canvas.addEventListener("keyup", onKey);
    return () => {
      canvas.removeEventListener("mousedown", onMouse);
      canvas.removeEventListener("mouseup", onMouse);
      canvas.removeEventListener("mousemove", onMouse);
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("keydown", onKey);
      canvas.removeEventListener("keyup", onKey);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      tabIndex={0}
      className="absolute inset-0 h-full w-full cursor-text bg-white outline-none"
      style={{ imageRendering: "auto" }}
    />
  );
}
