import { useEffect, useRef, useState } from "react";
import { onSoundPrefs, setSoundPrefs, sfx, soundPrefs, wakeAudio } from "../sound";
import "./prefs.css";

// Fullscreen. iPhone Safari offers none for a page, so there the button is never shown.
const canFullscreen = !!document.fullscreenEnabled;
const isFullscreen = () => !!document.fullscreenElement;

function toggleFullscreen() {
  if (isFullscreen()) void document.exitFullscreen().catch(() => {});
  else void document.documentElement.requestFullscreen({ navigationUI: "hide" }).catch(() => {});
}

/** Buttons don't take focus, so Space and the arrows keep flying the ship. */
const keepFocus = (e: React.MouseEvent) => e.preventDefault();

/** The top-right corner of every screen: sound on/off, settings (effects volume), fullscreen. */
export function Prefs() {
  const [sound, setSound] = useState(soundPrefs);
  const [open, setOpen] = useState(false);
  const [full, setFull] = useState(isFullscreen);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => onSoundPrefs(() => setSound(soundPrefs())), []);

  // Kept in step with the browser, which also leaves fullscreen on Esc or a swipe.
  useEffect(() => {
    const sync = () => setFull(isFullscreen());
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, []);

  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", down);
    window.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", down);
      window.removeEventListener("keydown", key);
    };
  }, [open]);

  return (
    <div className="prefs" ref={ref}>
      <button
        type="button"
        className="prefs-btn"
        onMouseDown={keepFocus}
        aria-label="Sound"
        aria-pressed={sound.on}
        onClick={() => {
          if (!sound.on) wakeAudio();
          setSoundPrefs({ on: !sound.on });
        }}
      >
        <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
          <path d="M3 7.5h3l4-3.5v12l-4-3.5H3z" fill="currentColor" />
          {sound.on ? (
            <path d="M13 7.5a3.5 3.5 0 0 1 0 5M15.2 5.3a6.6 6.6 0 0 1 0 9.4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          ) : (
            <path d="M13 8l4 4M17 8l-4 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          )}
        </svg>
      </button>
      <button type="button" className="prefs-btn"
        onMouseDown={keepFocus} aria-label="Settings" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
          <path d="M3 6h14M3 14h14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          <circle cx="7" cy="6" r="2.6" fill="currentColor" />
          <circle cx="13" cy="14" r="2.6" fill="currentColor" />
        </svg>
      </button>
      {canFullscreen && (
        <button type="button" className="prefs-btn"
        onMouseDown={keepFocus} aria-label={full ? "Exit fullscreen" : "Fullscreen"} aria-pressed={full} onClick={toggleFullscreen}>
          <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
            <path
              d={full ? "M7.5 3v4.5H3M12.5 3v4.5H17M7.5 17v-4.5H3M12.5 17v-4.5H17" : "M3 7.5V3h4.5M17 7.5V3h-4.5M3 12.5V17h4.5M17 12.5V17h-4.5"}
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      )}
      {open && (
        <div className="prefs-pop panel">
          <label className="prefs-setting">
            <span>Effects</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={sound.volume}
              disabled={!sound.on}
              onChange={(e) => setSoundPrefs({ volume: Number(e.target.value) })}
              onPointerUp={() => sfx("place")}
              onKeyUp={() => sfx("place")}
            />
          </label>
        </div>
      )}
    </div>
  );
}
