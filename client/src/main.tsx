import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { Prefs } from "./ui/Prefs";
import { sfx } from "./sound";
import "./theme.css";
import "./screens/screens.css";

// Menu buttons click; the build and the fight have sounds of their own.
document.addEventListener(
  "click",
  (e) => {
    const b = e.target instanceof Element ? e.target.closest("button") : null;
    if (b && !b.disabled && !b.closest(".draft, .arena, .prefs")) sfx("click");
  },
  true,
);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
    <Prefs />
  </StrictMode>,
);
