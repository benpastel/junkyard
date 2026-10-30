import { useEffect, useRef, useState, type ReactNode } from "react";
import type { InputState, PlayerId } from "@ja/shared";
import {
  FAST_FORWARD_SPEED,
  KEY_BITS,
  type ArenaInit,
  type ArenaSnapshot,
} from "@ja/shared/sim/view";
import { KeyButton } from "../ui/KeyButton";
import { loadCameraMode, saveCameraMode } from "./cameraPref";
import { ArenaRenderer, COMPASS_MARGIN, COMPASS_RADIUS, COMPASS_TOP, type CameraMode } from "./renderer";
import { TILT_DEAD_ZONE, TILT_FULL, requestTiltPermission, watchTilt } from "./tilt";
import "./arena.css";

/**
 * Keyboard layout. Arrow keys or WASD push the ship that way, Q and E turn it (the engines to
 * fire are worked out in the sim); X fires the grapple. Lasers fire on their own.
 */
export const KEYMAP: Record<string, keyof InputState> = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
  KeyW: "up",
  KeyS: "down",
  KeyA: "left",
  KeyD: "right",
  KeyQ: "rotLeft",
  KeyE: "rotRight",
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
  /** Extra overlay (tutorials: sheep counter, clock, result card). */
  hud?: ReactNode;
}) {
  const { init, me, subscribe, sendInput, fastForward, hud } = props;
  const ffRef = useRef(fastForward);
  ffRef.current = fastForward;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [pips, setPips] = useState<{ color: string; alive: boolean }[]>([]);
  const rendererRef = useRef<ArenaRenderer | null>(null);
  const [camera, setCamera] = useState<CameraMode>(() =>
    CAMERA_SWITCHING ? loadCameraMode() : "ship",
  );
  // Steering keys your ship's engines can answer (KEY_BITS), for greying out the on-screen keys.
  const [engines, setEngines] = useState(63);
  const pressRef = useRef<Press>(() => {});
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
      setEngines(renderer.mySteerKeys);
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
    // What's holding each input down (key codes, on-screen buttons): an arrow and its WASD twin
    // both count, and letting go of one leaves the other held.
    const holders = new Map<keyof InputState, Set<string>>();
    const send = () => sendRef.current({ ...keys });
    // Keyboard and the on-screen buttons both land here.
    const press: Press = (k, down, by) => {
      const set = holders.get(k) ?? new Set<string>();
      holders.set(k, set);
      if (down) set.add(by);
      else set.delete(by);
      if (keys[k] === set.size > 0) return;
      keys[k] = set.size > 0;
      rendererRef.current?.setPan(keys);
      send();
    };
    pressRef.current = press;
    const set = (e: KeyboardEvent, down: boolean) => {
      const k = KEYMAP[e.code];
      if (!k) return;
      e.preventDefault();
      press(k, down, e.code);
    };
    const onDown = (e: KeyboardEvent) => {
      if (e.code === FAST_FORWARD_KEY && !e.repeat) ffRef.current?.toggle();
      if (CAMERA_SWITCHING && e.code === CAMERA_KEY && !e.repeat)
        toggleCameraRef.current();
      set(e, true);
    };
    const onUp = (e: KeyboardEvent) => set(e, false);
    const onBlur = () => {
      holders.clear();
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
      {hud}
      <button
        type="button"
        className={`arena-compass${camera === "north" ? " on" : ""}`}
        aria-label={camera === "north" ? "Turn the view with your ship" : "Fix the view"}
        aria-pressed={camera === "north"}
        style={{ top: COMPASS_TOP, right: COMPASS_MARGIN, width: COMPASS_RADIUS * 2, height: COMPASS_RADIUS * 2 }}
        onMouseDown={(e) => e.preventDefault()}
        onClick={toggleCamera}
      />
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
        <TouchFlight engines={engines} press={(k, d, by) => pressRef.current(k, d, by)} />
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

/** Sets an input held or not, saying what's holding it (a key code, or an on-screen button). */
type Press = (k: keyof InputState, down: boolean, by: string) => void;

/**
 * Touch screens: the flying keys, or (toggled with the phone button) tilt steering with a gauge
 * showing the lean and the two turn keys beside it. Turning tilt on takes the current angle as level.
 */
function TouchFlight({ engines, press }: { engines: number; press: Press }) {
  // Starts the way you flew last time.
  const [tilt, setTilt] = useState(loadTiltPref);
  const [lean, setLean] = useState({ x: 0, y: 0 });
  const [held, setHeld] = useState(0);
  const pressRef = useRef(press);
  pressRef.current = press;

  useEffect(() => {
    if (!tilt) return;
    const last: Record<string, boolean> = {};
    // Remembered tilt can't ask for permission without a tap (iPhone): if no readings come,
    // fall back to the pad for now; the button asks again.
    let heard = false;
    const fallback = setTimeout(() => {
      if (!heard) setTilt(false);
    }, 1500);
    const stop = watchTilt((l, keys) => {
      heard = true;
      setLean(l);
      let mask = 0;
      for (const { k, bit } of MOVE_KEYS) {
        const on = keys[k as "up" | "down" | "left" | "right"];
        if (on) mask |= bit;
        if (last[k] !== on) {
          last[k] = on;
          pressRef.current(k, on, "tilt");
        }
      }
      setHeld(mask);
    });
    return () => {
      clearTimeout(fallback);
      stop();
      for (const { k } of MOVE_KEYS) pressRef.current(k, false, "tilt");
      setHeld(0);
      setLean({ x: 0, y: 0 });
    };
  }, [tilt]);

  const toggle = async () => {
    if (!tilt && !(await requestTiltPermission())) return;
    saveTiltPref(!tilt);
    setTilt(!tilt);
  };

  const g = (v: number) => Math.max(-1, Math.min(1, v / TILT_FULL)) * 40;
  return (
    <div className="touch-flight">
      <button type="button" className={`tilt-toggle${tilt ? " on" : ""}`} aria-label="Tilt to steer" aria-pressed={tilt} onClick={toggle}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <rect x="8" y="3" width="9" height="16" rx="2" transform="rotate(18 12 12)" />
          <path d="M3 17a9 9 0 0 0 4 4M21 7a9 9 0 0 0-4-4" />
        </svg>
      </button>
      {tilt ? (
        <>
          <div className="tilt-gauge">
            <div className="tilt-zone" style={{ width: (TILT_DEAD_ZONE / TILT_FULL) * 80, height: (TILT_DEAD_ZONE / TILT_FULL) * 80 }} />
            {MOVE_KEYS.map(({ k, bit, rot }) => (
              <svg
                key={k}
                className={`tilt-arrow${held & bit ? " held" : ""}${engines & bit ? "" : " dead"}`}
                width="18"
                height="18"
                viewBox="0 0 20 20"
                style={{ transform: `translate(-50%, -50%) rotate(${rot}deg) translateY(-46px)` }}
                aria-hidden
              >
                <path d="M10 3 L17 14 L3 14 Z" fill="currentColor" />
              </svg>
            ))}
            <div className="tilt-dot" style={{ transform: `translate(calc(-50% + ${g(lean.x)}px), calc(-50% + ${g(lean.y)}px))` }} />
          </div>
          <KeyPad className="turn-pad" keys={TURN_KEYS} engines={engines} press={press} />
        </>
      ) : (
        <KeyPad className="arrow-pad" keys={[...TURN_KEYS, ...MOVE_KEYS]} engines={engines} press={press} />
      )}
    </div>
  );
}

const TILT_PREF = "ja.tilt";

function loadTiltPref(): boolean {
  try {
    return localStorage.getItem(TILT_PREF) === "1";
  } catch {
    return false;
  }
}

function saveTiltPref(on: boolean) {
  try {
    localStorage.setItem(TILT_PREF, on ? "1" : "0");
  } catch {
    // Just won't be remembered.
  }
}

interface PadKey {
  k: keyof InputState;
  /** KEY_BITS */
  bit: number;
  area: string;
  /** Arrow rotation in degrees; turn keys get a turning arrow instead (spin: -1 left, 1 right). */
  rot: number;
  spin?: 1 | -1;
}

const MOVE_KEYS: PadKey[] = [
  { k: "up", bit: KEY_BITS.up, area: "up", rot: 0 },
  { k: "left", bit: KEY_BITS.left, area: "left", rot: -90 },
  { k: "down", bit: KEY_BITS.down, area: "down", rot: 180 },
  { k: "right", bit: KEY_BITS.right, area: "right", rot: 90 },
];

const TURN_KEYS: PadKey[] = [
  { k: "rotLeft", bit: KEY_BITS.rotLeft, area: "rotl", rot: 0, spin: -1 },
  { k: "rotRight", bit: KEY_BITS.rotRight, area: "rotr", rot: 0, spin: 1 },
];

/**
 * Touch screens: the cockpit's keys, big, in a corner (Q W E over A S D). Hold to fly; several
 * fingers at once work. Keys the engines can't answer are greyed out.
 */
function KeyPad({ className, keys, engines, press }: { className: string; keys: PadKey[]; engines: number; press: Press }) {
  const [held, setHeld] = useState(0);
  const set = (k: keyof InputState, bit: number, down: boolean) => {
    press(k, down, "pad");
    setHeld((h) => (down ? h | bit : h & ~bit));
  };
  return (
    <div className={className}>
      {keys.map(({ k, bit, area, rot, spin }) => (
        <button
          key={k}
          type="button"
          aria-label={k}
          className={`arrow-key${held & bit ? " held" : ""}${engines & bit ? "" : " dead"}`}
          style={{ gridArea: area }}
          onPointerDown={(e) => {
            e.preventDefault();
            e.currentTarget.releasePointerCapture?.(e.pointerId);
            set(k, bit, true);
          }}
          onPointerUp={() => set(k, bit, false)}
          onPointerCancel={() => set(k, bit, false)}
          onPointerLeave={() => set(k, bit, false)}
          onContextMenu={(e) => e.preventDefault()}
        >
          {spin ? (
            <svg width="30" height="30" viewBox="0 0 20 20" style={{ transform: spin < 0 ? "scaleX(-1)" : undefined }} aria-hidden>
              <path d="M5.8 14.2 A6 6 0 1 1 15.7 11.9" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
              <path d="M14.6 15.3 L18.9 12.3 L12.8 10.3 Z" fill="currentColor" />
            </svg>
          ) : (
            <svg width="30" height="30" viewBox="0 0 20 20" style={{ transform: `rotate(${rot}deg)` }} aria-hidden>
              <path d="M10 3 L17 14 L3 14 Z" fill="currentColor" />
            </svg>
          )}
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
  rotLeft: false,
  rotRight: false,
  laser: false,
  grapple: false,
};
