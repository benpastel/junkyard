// Best times for tutorials, kept per browser.
const KEY = (id: string) => `ja.best.${id}`;

export function loadBest(id: string): number | null {
  try {
    const v = Number(localStorage.getItem(KEY(id)));
    return v > 0 ? v : null;
  } catch {
    return null;
  }
}

/** Records a finish; returns true if it beat the old best. */
export function saveBest(id: string, seconds: number): boolean {
  const old = loadBest(id);
  if (old !== null && old <= seconds) return false;
  try {
    localStorage.setItem(KEY(id), String(seconds));
  } catch {
    // Just won't be remembered.
  }
  return true;
}

/** m:ss.t */
export function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds - m * 60;
  return `${m}:${s < 10 ? "0" : ""}${s.toFixed(1)}`;
}
