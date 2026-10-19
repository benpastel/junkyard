import { useEffect, useRef, useState } from "react";
import type { InputState, PlayerId } from "@ja/shared";
import {
  FAST_FORWARD_SPEED,
  type ArenaInit,
  type ArenaSnapshot,
} from "@ja/shared/sim/view";
import { KeyButton } from "../ui/KeyButton";
import { loadCameraMode, saveCameraMode } from "./cameraPref";
import { ArenaRenderer, type CameraMode } from "./renderer";
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
/**
 * The camera keeps your ship pointing (roughly) up. Switching to the fixed-north view (C, or the
 * camera button) is turned off for now; set this to bring it back.
 */
const CAMERA_SWITCHING = false;

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
  const rendererRef = useRef<ArenaRenderer | null>(null);
  const [camera, setCamera] = useState<CameraMode>(() =>
    CAMERA_SWITCHING ? loadCameraMode() : "ship",
  );
  // Engine dirs your ship can push in, for greying out the on-screen arrows.
  const [engines, setEngines] = useState(15);
  const pressRef = useRef<(k: keyof InputState, down: boolean) => void>(
    () => {},
  );
  const toggleCamera = () => {
    const next: CameraMode =
      (rendererRef.current?.cameraMode ?? camera) === "ship" ? "north" : "ship";
    if (rendererRef.current) rendererRef.current.cameraMode = next;
    saveCameraMode(next);
    setCamera(next);
  };
  const toggleCameraRef = useRef(toggleCamera);
  toggleCameraRef.current = toggleCamera;

  // Latest sendInput without re-running the effects when the parent re-renders.
  const sendRef = useRef(sendInput);
  sendRef.current = sendInput;

  useEffect(() => {
    const renderer = new ArenaRenderer(init, me);
    renderer.cameraMode = CAMERA_SWITCHING ? loadCameraMode() : "ship";
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
      if (
        canvas.width !== Math.round(w * dpr) ||
        canvas.height !== Math.round(h * dpr)
      ) {
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
      setEngines(renderer.myEngineDirs);
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
      if (CAMERA_SWITCHING && e.code === CAMERA_KEY && !e.repeat)
        toggleCameraRef.current();
      set(e, true);
    };
    const onUp = (e: KeyboardEvent) => set(e, false);
    const onBlur = () => {
      for (const k of Object.keys(keys) as (keyof InputState)[])
        keys[k] = false;
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
          <span
            key={i}
            className={p.alive ? "pip" : "pip dead"}
            style={{ ["--c" as string]: p.color }}
          />
        ))}
      </div>
      {fastForward?.active && (
        <div className="arena-speed mono">{FAST_FORWARD_SPEED}×</div>
      )}
      {me && init.ships.some((s) => s.playerId === me) && (
        <ArrowPad engines={engines} press={(k, d) => pressRef.current(k, d)} />
      )}
      {(CAMERA_SWITCHING || fastForward) && (
        <div className="arena-controls">
          {CAMERA_SWITCHING && (
            <div className="arena-controls-group">
              <KeyButton
                title="Switch camera"
                keyLabel="C"
                icon={
                  <span className="cam-mode">
                    {camera === "ship" ? <ShipUpIcon /> : <FixedIcon />}
                    <span className="cam-label mono">
                      {camera === "ship" ? "Ship-up" : "Fixed"}
                    </span>
                  </span>
                }
                onClick={toggleCamera}
              />
            </div>
          )}
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

const PAD_KEYS: {
  k: keyof InputState;
  dir: number;
  area: string;
  rot: number;
}[] = [
  { k: "up", dir: 0, area: "up", rot: 0 },
  { k: "left", dir: 3, area: "left", rot: -90 },
  { k: "down", dir: 2, area: "down", rot: 180 },
  { k: "right", dir: 1, area: "right", rot: 90 },
];

/**
 * Touch screens: the cockpit's arrow keys, big, in a corner. Hold to fire those engines; several
 * fingers at once work. Arrows with no working engine behind them are greyed out.
 */
function ArrowPad({
  engines,
  press,
}: {
  engines: number;
  press: (k: keyof InputState, down: boolean) => void;
}) {
  const [held, setHeld] = useState(0);
  const set = (k: keyof InputState, dir: number, down: boolean) => {
    press(k, down);
    setHeld((h) => (down ? h | (1 << dir) : h & ~(1 << dir)));
  };
  return (
    <div className="arrow-pad">
      {PAD_KEYS.map(({ k, dir, area, rot }) => (
        <button
          key={k}
          type="button"
          aria-label={k}
          className={`arrow-key${(held >> dir) & 1 ? " held" : ""}${(engines >> dir) & 1 ? "" : " dead"}`}
          style={{ gridArea: area }}
          onPointerDown={(e) => {
            e.preventDefault();
            e.currentTarget.releasePointerCapture?.(e.pointerId);
            set(k, dir, true);
          }}
          onPointerUp={() => set(k, dir, false)}
          onPointerCancel={() => set(k, dir, false)}
          onPointerLeave={() => set(k, dir, false)}
          onContextMenu={(e) => e.preventDefault()}
        >
          <svg
            width="30"
            height="30"
            viewBox="0 0 20 20"
            style={{ transform: `rotate(${rot}deg)` }}
            aria-hidden
          >
            <path d="M10 3 L17 14 L3 14 Z" fill="currentColor" />
          </svg>
        </button>
      ))}
    </div>
  );
}

/** Fixed view: a still frame with a ship turning inside it. */
function FixedIcon() {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      aria-hidden
    >
      <rect x="2" y="2" width="16" height="16" rx="2" />
      <path
        d="M10 5.5 L13 13 L10 11.5 L7 13 Z"
        fill="currentColor"
        stroke="none"
        transform="rotate(35 10 10)"
      />
    </svg>
  );
}

/** Ship-up view: the ship stays pointing up while the frame turns round it. */
function ShipUpIcon() {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      aria-hidden
    >
      <rect
        x="2"
        y="2"
        width="16"
        height="16"
        rx="2"
        transform="rotate(-20 10 10)"
      />
      <path
        d="M10 5.5 L13 13 L10 11.5 L7 13 Z"
        fill="currentColor"
        stroke="none"
      />
    </svg>
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
/** Flips between the fixed view and the ship-up view (remembered per browser). */
const CAMERA_KEY = "KeyC";

function FastForwardIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 20 20" aria-hidden>
      <path d="M2 4 L10 10 L2 16 Z M10 4 L18 10 L10 16 Z" fill="currentColor" />
    </svg>
  );
}

const NO_KEYS: InputState = {
  up: false,
  down: false,
  left: false,
  right: false,
  laser: false,
  grapple: false,
};
