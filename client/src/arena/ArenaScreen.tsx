import { useEffect, useRef, useState } from "react";
import type { InputState, PlayerId } from "@ja/shared";
import type { ArenaInit, ArenaSnapshot } from "@ja/shared/sim/view";
import { ArenaRenderer } from "./renderer";
import "./arena.css";

/** Keyboard layout. Arrow keys fire engines facing that way; letters fire weapons. */
export const KEYMAP: Record<string, keyof InputState> = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
  KeyZ: "laser",
  KeyX: "grapple",
};

const RESEND_MS = 100;

export function ArenaScreen(props: {
  init: ArenaInit;
  me: PlayerId | null;
  subscribe: (cb: (s: ArenaSnapshot) => void) => () => void;
  sendInput: (i: InputState) => void;
}) {
  const { init, me, subscribe, sendInput } = props;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [pips, setPips] = useState<{ color: string; alive: boolean }[]>([]);

  // Latest sendInput without re-running the effects when the parent re-renders.
  const sendRef = useRef(sendInput);
  sendRef.current = sendInput;

  useEffect(() => {
    const renderer = new ArenaRenderer(init, me);
    const unsub = subscribe((s) => renderer.push(s));
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;
    let raf = 0;
    let lastPips = "";

    const frame = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
      }
      renderer.draw(ctx, w, h, dpr);
      const p = renderer.shipPips();
      const key = p.map((x) => (x.alive ? "1" : "0")).join("");
      if (key !== lastPips) {
        lastPips = key;
        setPips(p);
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      unsub();
    };
  }, [init, me, subscribe]);

  useEffect(() => {
    const keys: InputState = { up: false, down: false, left: false, right: false, laser: false, grapple: false };
    const send = () => sendRef.current({ ...keys });
    const set = (e: KeyboardEvent, down: boolean) => {
      const k = KEYMAP[e.code];
      if (!k) return;
      e.preventDefault();
      if (keys[k] === down) return;
      keys[k] = down;
      send();
    };
    const onDown = (e: KeyboardEvent) => set(e, true);
    const onUp = (e: KeyboardEvent) => set(e, false);
    const onBlur = () => {
      for (const k of Object.keys(keys) as (keyof InputState)[]) keys[k] = false;
      send();
    };
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    window.addEventListener("blur", onBlur);
    const timer = setInterval(send, RESEND_MS);
    return () => {
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
      window.removeEventListener("blur", onBlur);
      clearInterval(timer);
    };
  }, []);

  return (
    <div className="arena">
      <canvas ref={canvasRef} className="arena-canvas" />
      <div className="arena-pips">
        {pips.map((p, i) => (
          <span key={i} className={p.alive ? "pip" : "pip dead"} style={{ ["--c" as string]: p.color }} />
        ))}
      </div>
    </div>
  );
}
