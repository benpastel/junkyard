// Sound effects: one switch (the speaker in the top-right corner) and a volume, both remembered
// per browser. On by default.
//
// Effects are synthesized with Web Audio, a few lines each, so there is nothing to download and
// each can be tuned here. Browsers keep audio silent until the page is first tapped or a key is
// pressed; the first one anywhere wakes it.

const KEYS = { on: "ja.sound", volume: "ja.sfxVolume" } as const;

export interface SoundPrefs {
  on: boolean;
  volume: number;
}

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, v: string) {
  try {
    localStorage.setItem(key, v);
  } catch {
    // Applies for this visit only.
  }
}

function readVolume(): number {
  const raw = read(KEYS.volume);
  const v = Number(raw);
  return raw !== null && v >= 0 && v <= 1 ? v : 0.7;
}

let prefs: SoundPrefs = { on: read(KEYS.on) !== "off", volume: readVolume() };
const listeners = new Set<() => void>();

export const soundPrefs = (): SoundPrefs => prefs;

export function setSoundPrefs(patch: Partial<SoundPrefs>) {
  prefs = { ...prefs, ...patch };
  if (patch.on !== undefined) write(KEYS.on, patch.on ? "on" : "off");
  if (patch.volume !== undefined) write(KEYS.volume, String(patch.volume));
  for (const l of listeners) l();
}

export function onSoundPrefs(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

let ctx: AudioContext | null = null;

/** Starts (or resumes) audio. Refused until the page has been touched; the next touch asks again. */
export function wakeAudio() {
  if (typeof AudioContext === "undefined") return;
  ctx ??= new AudioContext();
  if (ctx.state === "suspended") ctx.resume().catch(() => {});
}

for (const ev of ["pointerdown", "keydown"] as const) {
  window.addEventListener(ev, () => prefs.on && wakeAudio(), { capture: true, passive: true });
}

function tone(out: AudioNode, freq: number, dur: number, gain: number, type: OscillatorType = "sine") {
  const t = ctx!.currentTime;
  const osc = ctx!.createOscillator();
  const env = ctx!.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  // A 3ms attack rather than none, so nothing clicks on starting.
  env.gain.setValueAtTime(0.0001, t);
  env.gain.exponentialRampToValueAtTime(gain, t + 0.003);
  env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(env).connect(out);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

const EFFECTS = {
  /** Played when the volume is set, to hear it. */
  tick: (out: AudioNode) => tone(out, 1500, 0.05, 0.25, "triangle"),
} satisfies Record<string, (out: AudioNode) => void>;

export type Sfx = keyof typeof EFFECTS;

export function sfx(name: Sfx) {
  if (!prefs.on || prefs.volume === 0) return;
  wakeAudio();
  if (!ctx || ctx.state !== "running") return;
  const out = ctx.createGain();
  out.gain.value = prefs.volume;
  out.connect(ctx.destination);
  EFFECTS[name](out);
}
