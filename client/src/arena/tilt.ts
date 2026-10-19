// Tilt steering for phones: lean the phone to fire engines. Off by default; see TouchFlight.
import type { InputState } from "@ja/shared";

/** Degrees of lean before an engine group fires. */
export const TILT_DEAD_ZONE = 8;
/** Degrees of lean drawn at the edge of the tilt gauge. */
export const TILT_FULL = 25;

type Dirs = Pick<InputState, "up" | "down" | "left" | "right">;

/** iPhones ask permission before a page can read tilt; it has to be asked from a tap. */
export async function requestTiltPermission(): Promise<boolean> {
  const D = window.DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> } | undefined;
  if (!D) return false;
  if (typeof D.requestPermission !== "function") return true;
  try {
    // Safari answers "granted"; Chrome may answer "prompt" and still deliver readings.
    return (await D.requestPermission()) !== "denied";
  } catch {
    return false;
  }
}

/**
 * Follows the phone's tilt relative to how it was held when started, in screen terms (x right,
 * y down, degrees), whichever way round the screen is. `onChange` gets the lean and the arrow
 * keys it presses.
 */
export function watchTilt(onChange: (lean: { x: number; y: number }, keys: Dirs) => void): () => void {
  let base: { x: number; y: number } | null = null;
  const handler = (e: DeviceOrientationEvent) => {
    if (e.beta === null || e.gamma === null) return;
    // Device axes (portrait): gamma leans right, beta tips the top toward you.
    const angle = ((screen.orientation?.angle ?? 0) * Math.PI) / 180;
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    const raw = { x: e.gamma * c + e.beta * s, y: -e.gamma * s + e.beta * c };
    base ??= raw;
    const lean = { x: raw.x - base.x, y: raw.y - base.y };
    onChange(lean, {
      // Tip the top away from you to go forward.
      up: lean.y < -TILT_DEAD_ZONE,
      down: lean.y > TILT_DEAD_ZONE,
      left: lean.x < -TILT_DEAD_ZONE,
      right: lean.x > TILT_DEAD_ZONE,
    });
  };
  window.addEventListener("deviceorientation", handler);
  return () => window.removeEventListener("deviceorientation", handler);
}
