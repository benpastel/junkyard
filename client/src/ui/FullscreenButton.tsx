import { useEffect, useState } from "react";
import "./fullscreen.css";

/**
 * Enters or leaves fullscreen. Only a deliberate click toggles it (no shortcut key to hit by
 * accident); Esc, or the phone's back gesture, also leaves. Hidden where the browser can't do
 * fullscreen (iPhone Safari).
 */
export function FullscreenButton({ className }: { className?: string }) {
  const [on, setOn] = useState(() => !!document.fullscreenElement);
  useEffect(() => {
    const update = () => setOn(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", update);
    return () => document.removeEventListener("fullscreenchange", update);
  }, []);
  if (!document.fullscreenEnabled) return null;

  const toggle = () => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    else void document.documentElement.requestFullscreen({ navigationUI: "hide" }).catch(() => {});
  };

  return (
    <button
      type="button"
      className={`fullscreen-btn${className ? ` ${className}` : ""}`}
      aria-label={on ? "Exit fullscreen" : "Fullscreen"}
      title={on ? "Exit fullscreen" : "Fullscreen"}
      onMouseDown={(e) => e.preventDefault()}
      onClick={toggle}
    >
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        {on ? (
          <path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" />
        ) : (
          <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
        )}
      </svg>
    </button>
  );
}
