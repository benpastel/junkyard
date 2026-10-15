import { useEffect, useRef, useState, type ReactNode } from "react";
import type { InputState, PlayerId } from "@ja/shared";
import { FAST_FORWARD_SPEED, type ArenaInit, type ArenaSnapshot } from "@ja/shared/sim/view";
import { KeyButton } from "../ui/KeyButton";
import { loadCameraMode } from "./cameraPref";
import { ArenaRenderer } from "./renderer";
import "./arena.css";

/** Keyboard layout. Arrow keys fire engines facing that way; letters fire weapons. Lasers fire on their own. */
export const KEYMAP: Record<string, keyof InputState> = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
  KeyX: "grapple",
};

const RESEND_MS = 100;

export function ArenaScreen(props: {
  init: ArenaInit;
  me: PlayerId | null;
  subscribe: (cb: (s: ArenaSnapshot) => void) => () => void;
  sendInput: (i: InputState) => void;
  /** Fast-forward vote; omitted when this viewer has no vote. */
  fastForward?: FastForward;
}) {
  const { init, me, subscribe, sendInput, fastForward } = props;
  const ffRef = useRef(fastForward);
  ffRef.current = fastForward;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [pips, setPips] = useState<{ color: string; alive: boolean }[]>([]);
  const [held, setHeld] = useState<InputState>(NO_KEYS);
  const pressRef = useRef<(k: keyof InputState, down: boolean) => void>(() => {});
  const rendererRef = useRef<ArenaRenderer | null>(null);
  const flying = !!me && init.ships.some((s) => s.playerId === me);

  // Latest sendInput without re-running the effects when the parent re-renders.
  const sendRef = useRef(sendInput);
  sendRef.current = sendInput;

  useEffect(() => {
    const renderer = new ArenaRenderer(init, me);
    renderer.cameraMode = loadCameraMode();
    rendererRef.current = renderer;
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
      rendererRef.current?.setPan(keys);
      send();
    };
    pressRef.current = press;
    const set = (e: KeyboardEvent, down: boolean) => {
      const k = KEYMAP[e.code];
      if (!k) return;
      e.preventDefault();
      press(k, down);
    };
    const onDown = (e: KeyboardEvent) => {
      if (e.code === FAST_FORWARD_KEY && !e.repeat) ffRef.current?.toggle();
      set(e, true);
    };
    const onUp = (e: KeyboardEvent) => set(e, false);
    const onBlur = () => {
      for (const k of Object.keys(keys) as (keyof InputState)[]) keys[k] = false;
      setHeld({ ...keys });
      rendererRef.current?.setPan(keys);
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
      {fastForward?.active && <div className="arena-speed mono">{FAST_FORWARD_SPEED}×</div>}
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
          {fastForward && (
            <div className="arena-controls-group">
              <KeyButton
                title="Fast-forward"
                keyLabel="F"
                icon={
                  <span className="ff-icon">
                    <FastForwardIcon />
                    {fastForward.needed > 1 && (
                      <span className="ff-votes mono">
                        {fastForward.votes}/{fastForward.needed}
                      </span>
                    )}
                  </span>
                }
                active={fastForward.voted || fastForward.active}
                onClick={fastForward.toggle}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export interface FastForward {
  /** This viewer has voted. */
  voted: boolean;
  votes: number;
  needed: number;
  /** Everyone's in: the fight is running at FAST_FORWARD_SPEED. */
  active: boolean;
  toggle: () => void;
}

const FAST_FORWARD_KEY = "KeyF";

function FastForwardIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 20 20" aria-hidden>
      <path d="M2 4 L10 10 L2 16 Z M10 4 L18 10 L10 16 Z" fill="currentColor" />
    </svg>
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
    { input: "grapple", keyLabel: "X", title: "Grapple", icon: <GrappleIcon /> },
  ],
];
