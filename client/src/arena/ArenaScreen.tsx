import { useEffect, useRef, useState, type ReactNode } from "react";
import type { InputState, PlayerId } from "@ja/shared";
import type { ArenaInit, ArenaSnapshot } from "@ja/shared/sim/view";
import { KeyButton } from "../ui/KeyButton";
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
  const [held, setHeld] = useState<InputState>(NO_KEYS);
  const pressRef = useRef<(k: keyof InputState, down: boolean) => void>(() => {});
  const flying = !!me && init.ships.some((s) => s.playerId === me);

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
    const keys: InputState = { ...NO_KEYS };
    const send = () => sendRef.current({ ...keys });
    // Keyboard and the on-screen buttons both land here.
    const press = (k: keyof InputState, down: boolean) => {
      if (keys[k] === down) return;
      keys[k] = down;
      setHeld({ ...keys });
      send();
    };
    pressRef.current = press;
    const set = (e: KeyboardEvent, down: boolean) => {
      const k = KEYMAP[e.code];
      if (!k) return;
      e.preventDefault();
      press(k, down);
    };
    const onDown = (e: KeyboardEvent) => set(e, true);
    const onUp = (e: KeyboardEvent) => set(e, false);
    const onBlur = () => {
      for (const k of Object.keys(keys) as (keyof InputState)[]) keys[k] = false;
      setHeld({ ...keys });
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
      {flying && (
        <div className="arena-controls">
          {CONTROLS.map((group, i) => (
            <div key={i} className="arena-controls-group">
              {group.map((c) => (
                <KeyButton
                  key={c.input}
                  title={c.title}
                  keyLabel={c.keyLabel}
                  icon={c.icon}
                  active={held[c.input]}
                  onHold={(down) => pressRef.current(c.input, down)}
                />
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const NO_KEYS: InputState = { up: false, down: false, left: false, right: false, laser: false, grapple: false };

/** Engine arrow matching the engine cell art, rotated to the direction it pushes. */
function EngineIcon({ deg }: { deg: number }) {
  return (
    <svg width="22" height="22" viewBox="0 0 20 20" style={{ transform: `rotate(${deg}deg)` }} aria-hidden>
      <path d="M10 2 L17 10 L13 10 L13 13 L7 13 L7 10 L3 10 Z" fill="#ff8a2a" />
      <path d="M6 15 L14 15 L16 19 L4 19 Z" fill="#ff8a2a" opacity="0.5" />
    </svg>
  );
}

function LaserIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 20 20" aria-hidden>
      <rect x="5" y="12" width="10" height="6" fill="#55585f" />
      <rect x="8" y="1" width="4" height="12" fill="#f2ea3c" />
      <rect x="6" y="1" width="8" height="2" fill="#f2ea3c" />
    </svg>
  );
}

function GrappleIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 20 20" fill="none" strokeLinecap="round" aria-hidden>
      <path d="M10 18 L10 4" stroke="#7d838b" strokeWidth="2" />
      <path d="M4 9 L10 2 L16 9" stroke="#c9ced4" strokeWidth="2.2" />
    </svg>
  );
}

const CONTROLS: { input: keyof InputState; keyLabel: string; title: string; icon: ReactNode }[][] = [
  [
    { input: "left", keyLabel: "←", title: "Fire left-pushing engines", icon: <EngineIcon deg={-90} /> },
    { input: "up", keyLabel: "↑", title: "Fire forward-pushing engines", icon: <EngineIcon deg={0} /> },
    { input: "down", keyLabel: "↓", title: "Fire backward-pushing engines", icon: <EngineIcon deg={180} /> },
    { input: "right", keyLabel: "→", title: "Fire right-pushing engines", icon: <EngineIcon deg={90} /> },
  ],
  [
    { input: "laser", keyLabel: "Z", title: "Fire lasers", icon: <LaserIcon /> },
    { input: "grapple", keyLabel: "X", title: "Grapple", icon: <GrappleIcon /> },
  ],
];
