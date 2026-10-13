import { useEffect, useState } from "react";

/** Seconds since page load, re-rendering ~30 times a second while `enabled` (e.g. a saw is on screen). */
export function useClock(enabled: boolean): number {
  const [t, setT] = useState(() => performance.now() / 1000);
  useEffect(() => {
    if (!enabled) return;
    let raf = 0;
    let last = 0;
    const tick = (now: number) => {
      if (now - last > 33) {
        last = now;
        setT(now / 1000);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [enabled]);
  return t;
}
