// Which arena camera this browser uses. A per-player preference set in the lobby (prototype).
import type { CameraMode } from "./renderer";

const STORAGE = "ja.camera";

export function loadCameraMode(): CameraMode {
  try {
    return localStorage.getItem(STORAGE) === "ship" ? "ship" : "north";
  } catch {
    return "north";
  }
}

export function saveCameraMode(mode: CameraMode) {
  try {
    localStorage.setItem(STORAGE, mode);
  } catch {
    // Just won't be remembered.
  }
}
