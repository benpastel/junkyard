import { useRef, type ReactNode } from "react";
import "./keybutton.css";

/** Icon button with a small keycap in the corner naming its keyboard shortcut. */
export function KeyButton(props: {
  icon: ReactNode;
  keyLabel: string;
  onClick?: () => void;
  /** For hold-to-use buttons: called with true on press and false on release. */
  onHold?: (down: boolean) => void;
  disabled?: boolean;
  /** Pressed / lit look, e.g. while the key is held or a toggle is on. */
  active?: boolean;
  title?: string;
}) {
  // A touch fires on press, not on click: a tap with a second finger (flipping the piece while
  // another finger drags it) doesn't always get a click. The click that may follow is skipped.
  const touched = useRef(false);
  return (
    <button
      type="button"
      className={`key-button${props.active ? " active" : ""}`}
      aria-label={props.title}
      aria-pressed={props.active}
      title={props.title}
      disabled={props.disabled}
      // Keep focus off the button so Space/Enter never re-trigger it.
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => {
        if (!touched.current) props.onClick?.();
        touched.current = false;
      }}
      onPointerDown={(e) => {
        touched.current = e.pointerType === "touch";
        if (touched.current && !props.disabled) props.onClick?.();
        props.onHold?.(true);
      }}
      onPointerUp={props.onHold && (() => props.onHold!(false))}
      onPointerLeave={props.onHold && (() => props.onHold!(false))}
    >
      {props.icon}
      <kbd>{props.keyLabel}</kbd>
    </button>
  );
}
