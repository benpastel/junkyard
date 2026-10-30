// Sound effects: one switch (the speaker in the top-right corner) and a volume, both remembered
// per browser. On by default.
//
// Effects are synthesized with Web Audio, a few lines each, so there is nothing to download and
// each can be tuned here (the "Scrap" set: metal and machinery). Each has a loudness (LEVELS);
// when audio starts, every effect is rendered once offline and scaled to it, so an effect can be
// reworked without re-balancing the others by ear. Browsers keep audio silent until the page is
// first tapped or a key is pressed; the first one anywhere wakes it.

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
  syncThrust();
}

export function onSoundPrefs(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

let ctx: AudioContext | null = null;

/** Starts (or resumes) audio. Refused until the page has been touched; the next touch asks again. */
export function wakeAudio() {
  if (typeof AudioContext === "undefined") return;
  if (!ctx) {
    ctx = new AudioContext();
    void levelAll();
  }
  if (ctx.state === "suspended") ctx.resume().catch(() => {});
}

if (typeof window !== "undefined") {
  for (const ev of ["pointerdown", "keydown"] as const) {
    window.addEventListener(ev, () => prefs.on && wakeAudio(), { capture: true, passive: true });
  }
}

// ------------------------------------------------------------------------------ synth helpers

type Ctx = BaseAudioContext;
const rr = (a: number, b: number) => a + Math.random() * (b - a);
/** A note, in semitones from A4. The pitched effects sit in D minor. */
const N = (n: number) => 440 * 2 ** (n / 12);
const [D4, A4, D5, F5, A5, D6, F6, A6] = [-7, 0, 5, 8, 12, 17, 20, 24].map(N) as [number, number, number, number, number, number, number, number];

interface Env {
  a?: number;
  hold?: number;
  d: number;
  g: number;
}

/** A gain envelope into o: silent → g over a, held, then down to silence over d. */
function env(c: Ctx, o: AudioNode, t: number, { a = 0.003, hold = 0, d, g }: Env) {
  const e = c.createGain();
  e.gain.setValueAtTime(0.0001, t);
  e.gain.exponentialRampToValueAtTime(g, t + a);
  if (hold) e.gain.setValueAtTime(g, t + a + hold);
  e.gain.exponentialRampToValueAtTime(0.0001, t + a + hold + d);
  e.connect(o);
  return { node: e, end: t + a + hold + d };
}

/** Low-frequency wobble on a parameter (vibrato, tremolo). */
function lfo(c: Ctx, param: AudioParam, t: number, end: number, rate: number, depth: number, type: OscillatorType = "sine") {
  const l = c.createOscillator();
  const g = c.createGain();
  l.type = type;
  l.frequency.value = rate;
  g.gain.value = depth;
  l.connect(g).connect(param);
  l.start(t);
  l.stop(end + 0.05);
  return l;
}

interface Tone extends Env {
  f: number;
  /** Pitch slides to this over `glide` (default: the whole tone). */
  f2?: number;
  glide?: number;
  type?: OscillatorType;
  /** [rate, depth as a fraction of f]. */
  vib?: [number, number];
  detune?: number;
}

function tone(c: Ctx, o: AudioNode, t: number, { f, f2, glide, type = "sine", vib, detune = 0, ...e }: Tone) {
  const { node, end } = env(c, o, t, e);
  const osc = c.createOscillator();
  osc.type = type;
  osc.detune.value = detune;
  osc.frequency.setValueAtTime(f, t);
  if (f2) osc.frequency.exponentialRampToValueAtTime(f2, t + (glide ?? end - t));
  if (vib) lfo(c, osc.frequency, t, end, vib[0], vib[1] * f);
  osc.connect(node);
  osc.start(t);
  osc.stop(end + 0.05);
}

const buffers = new WeakMap<Ctx, Map<number, AudioBuffer>>();
/** White noise, or "crushed" (each value held for `crush` samples: grittier). */
function noiseBuffer(c: Ctx, crush = 1): AudioBuffer {
  let m = buffers.get(c);
  if (!m) buffers.set(c, (m = new Map()));
  let b = m.get(crush);
  if (!b) {
    b = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
    const d = b.getChannelData(0);
    let v = 0;
    for (let i = 0; i < d.length; i++) {
      if (i % crush === 0) v = Math.random() * 2 - 1;
      d[i] = v;
    }
    m.set(crush, b);
  }
  return b;
}

interface Noise extends Env {
  type?: BiquadFilterType;
  f?: number;
  f2?: number;
  glide?: number;
  q?: number;
  crush?: number;
  /** Level flutter: [rate, depth 0..1, wave]. */
  am?: [number, number, OscillatorType?];
  /** Filter wobble: [rate, Hz]. */
  fmod?: [number, number];
}

/** Filtered noise with an envelope. */
function noise(c: Ctx, o: AudioNode, t: number, { type = "bandpass", f = 1000, f2, glide, q = 1, crush = 1, am, fmod, ...e }: Noise) {
  const { node, end } = env(c, o, t, e);
  let out: AudioNode = node;
  if (am) {
    const tr = c.createGain();
    tr.gain.value = 1 - am[1] / 2;
    lfo(c, tr.gain, t, end, am[0], am[1] / 2, am[2] ?? "square");
    tr.connect(node);
    out = tr;
  }
  const flt = c.createBiquadFilter();
  flt.type = type;
  flt.Q.value = q;
  flt.frequency.setValueAtTime(f, t);
  if (f2) flt.frequency.exponentialRampToValueAtTime(f2, t + (glide ?? end - t));
  if (fmod) lfo(c, flt.frequency, t, end, fmod[0], fmod[1]);
  const src = c.createBufferSource();
  src.buffer = noiseBuffer(c, crush);
  src.loop = true;
  src.connect(flt).connect(out);
  src.start(t, Math.random() * 1.5);
  src.stop(end + 0.05);
}

/** Struck metal: sine partials [ratio, level, ring time]. */
function modal(c: Ctx, o: AudioNode, t: number, f: number, parts: [number, number, number][], g = 1) {
  for (const [ratio, lvl, dec] of parts) tone(c, o, t, { f: f * ratio, a: 0.001, d: dec, g: g * lvl });
}
const plate = (c: Ctx, o: AudioNode, t: number, f: number, g = 1, dec = 0.2) =>
  modal(c, o, t, f, [[1, 1, dec], [1.59, 0.6, dec * 0.8], [2.14, 0.45, dec * 0.6], [2.65, 0.35, dec * 0.5], [3.9, 0.2, dec * 0.3]], g);
const bar = (c: Ctx, o: AudioNode, t: number, f: number, g = 1, dec = 0.08) =>
  modal(c, o, t, f, [[1, 1, dec], [2.756, 0.5, dec * 0.6], [5.404, 0.25, dec * 0.35]], g);
/** A low knock, with faint overtones so small speakers still give the low note. */
function thump(c: Ctx, o: AudioNode, t: number, f: number, f2: number, d: number, g = 1) {
  tone(c, o, t, { f, f2, d, g });
  tone(c, o, t, { f: f * 2, f2: f2 * 2, d: d * 0.8, g: g * 0.25 });
  tone(c, o, t, { f: f * 3, f2: f2 * 3, d: d * 0.6, g: g * 0.1 });
}
/** n little metal pings scattered over [from, to] seconds. */
function clinks(c: Ctx, o: AudioNode, t: number, n: number, from: number, to: number, fmin: number, fmax: number, g = 0.3) {
  for (let i = 0; i < n; i++) bar(c, o, t + rr(from, to), rr(fmin, fmax), g * rr(0.4, 1), rr(0.03, 0.08));
}

/** Soft clipping, for grit. Returns the node to connect into. */
function drive(c: Ctx, o: AudioNode, amount = 3): AudioNode {
  const ws = c.createWaveShaper();
  const k = new Float32Array(1024);
  for (let i = 0; i < k.length; i++) {
    const x = (i / (k.length - 1)) * 2 - 1;
    k[i] = Math.tanh(x * amount) / Math.tanh(amount);
  }
  ws.curve = k;
  ws.connect(o);
  return ws;
}

function filter(c: Ctx, o: AudioNode, type: BiquadFilterType, f: number, q = 0.7, sweep?: { to: number; t: number; dur: number }): AudioNode {
  const b = c.createBiquadFilter();
  b.type = type;
  b.Q.value = q;
  b.frequency.value = f;
  if (sweep) {
    b.frequency.setValueAtTime(f, sweep.t);
    b.frequency.exponentialRampToValueAtTime(sweep.to, sweep.t + sweep.dur);
  }
  b.connect(o);
  return b;
}

const irs = new WeakMap<Ctx, AudioBuffer>();
/** A roomy tail: dry plus `wet` of a decaying-noise reverb. Returns the node to connect into. */
function verb(c: Ctx, o: AudioNode, wet = 0.3): AudioNode {
  let ir = irs.get(c);
  if (!ir) {
    ir = c.createBuffer(2, Math.round(c.sampleRate * 1.4), c.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 3);
    }
    irs.set(c, ir);
  }
  const input = c.createGain();
  const conv = c.createConvolver();
  conv.buffer = ir;
  const w = c.createGain();
  w.gain.value = wet;
  input.connect(o);
  input.connect(conv).connect(w).connect(o);
  return input;
}

// ------------------------------------------------------------------------------------ effects

/** Plays into o from time t; v is the effect's own setting where it has one (see each). */
type Effect = (c: Ctx, o: AudioNode, t: number, v: number) => void;

const EFFECTS = {
  // ---- tables
  /** Any menu button. */
  click: (c, o, t) => {
    modal(c, o, t, rr(2300, 2500), [[1, 1, 0.03], [2.3, 0.4, 0.015]], 0.6);
    noise(c, o, t, { type: "highpass", f: 5000, d: 0.008, g: 0.4 });
  },
  /** Someone joins the table: an airlock hiss, then the hatch shuts. */
  join: (c, o, t) => {
    noise(c, o, t, { f: 3500, f2: 700, q: 2, a: 0.03, d: 0.22, g: 0.5 });
    thump(c, o, t + 0.22, 140, 60, 0.12, 0.8);
    plate(c, o, t + 0.22, 260, 0.45, 0.18);
  },
  /** A chat message from someone else: radio squelch and a chirp. */
  chat: (c, o, t) => {
    noise(c, o, t, { f: 1800, q: 3, d: 0.06, g: 0.8, crush: 3 });
    tone(c, o, t + 0.05, { f: 1800, f2: 2600, d: 0.05, g: 0.3 });
    tone(c, o, t + 0.11, { f: 2600, d: 0.05, g: 0.3 });
  },
  /** Building starts: a clunk, a machine spinning up, a latch. */
  launch: (c, o, t) => {
    plate(c, o, t, 200, 0.6, 0.25);
    thump(c, o, t, 120, 50, 0.15);
    const lp = filter(c, o, "lowpass", 300, 2, { to: 2500, t, dur: 0.7 });
    tone(c, lp, t + 0.05, { f: 50, f2: 220, glide: 0.7, type: "sawtooth", a: 0.4, hold: 0.25, d: 0.08, g: 0.5 });
    noise(c, o, t + 0.05, { f: 400, f2: 3000, glide: 0.7, a: 0.5, hold: 0.15, d: 0.08, g: 0.12 });
    noise(c, o, t + 0.78, { type: "highpass", f: 3000, d: 0.01, g: 0.5 });
    bar(c, o, t + 0.78, 1400, 0.4, 0.05);
  },

  // ---- build
  /** Picking up a piece: a crane magnet catching it. */
  pickup: (c, o, t) => {
    thump(c, o, t, 110, 70, 0.08, 0.7);
    plate(c, o, t, 520, 0.3, 0.06);
    const lp = filter(c, o, "lowpass", 450);
    tone(c, lp, t + 0.01, { f: 100, type: "sawtooth", a: 0.01, hold: 0.06, d: 0.1, g: 0.35 });
  },
  /** A ratchet; v is the way it turns (1 right, -1 left), each with its own pitch. */
  rotate: (c, o, t, v) => {
    for (let i = 0; i < 3; i++) {
      const tt = t + i * 0.022;
      noise(c, o, tt, { type: "highpass", f: 3000, d: 0.006, g: 0.4 });
      modal(c, o, tt, v > 0 ? 3200 : 2600, [[1, 1, 0.015], [2.4, 0.3, 0.01]], 0.3);
    }
  },
  /** A swoosh and a plate clacking down. */
  flip: (c, o, t) => {
    noise(c, o, t, { f: 900, f2: 2400, q: 1.2, a: 0.03, d: 0.04, g: 0.3 });
    plate(c, o, t + 0.06, 700, 0.5, 0.07);
    noise(c, o, t + 0.06, { type: "highpass", f: 2500, d: 0.01, g: 0.4 });
  },
  /** A heavy clank, then a burst of the bolt gun. */
  place: (c, o, t) => {
    const r = rr(0.94, 1.06);
    thump(c, o, t, 160, 55, 0.16);
    plate(c, o, t, 330 * r, 0.6, 0.22);
    noise(c, o, t, { f: 2200, d: 0.02, g: 0.5 });
    noise(c, o, t + 0.07, { f: 2600, q: 2, a: 0.005, hold: 0.05, d: 0.04, g: 0.35, am: [45, 1] });
  },
  /** A dull knock and a short buzzer. */
  nofit: (c, o, t) => {
    plate(c, o, t, 150, 0.6, 0.08);
    thump(c, o, t, 120, 90, 0.08, 0.6);
    const lp = filter(c, o, "lowpass", 700);
    tone(c, lp, t + 0.02, { f: 92, type: "sawtooth", a: 0.005, hold: 0.1, d: 0.05, g: 0.5 });
  },
  /** Dropped back on the pile. */
  putback: (c, o, t) => {
    bar(c, o, t, 1100, 0.5, 0.06);
    bar(c, o, t + 0.05, 850, 0.35, 0.07);
    noise(c, o, t, { type: "highpass", f: 4000, d: 0.01, g: 0.3 });
  },
  /** Junk rattled in a can. */
  reroll: (c, o, t) => {
    clinks(c, o, t, 10, 0, 0.35, 900, 2400, 0.35);
    noise(c, o, t, { f: 3000, a: 0.05, hold: 0.2, d: 0.1, g: 0.15, am: [18, 1] });
  },
  /** Three offers landing. */
  deal: (c, o, t) => {
    [600, 700, 820].forEach((f, i) => {
      plate(c, o, t + i * 0.08, f * rr(0.97, 1.03), 0.4, 0.08);
      thump(c, o, t + i * 0.08, 150, 90, 0.05, 0.4);
    });
  },
  /** A clock in the last seconds; v is the second left (tick and tock alternate). */
  lastsecs: (c, o, t, v) => {
    const f = v % 2 ? 1900 : 2500;
    noise(c, o, t, { f, q: 4, d: 0.02, g: 0.6 });
    bar(c, o, t, f * 0.72, 0.4, 0.03);
  },
  /** Time's up: the end-of-shift steam whistle. */
  buildover: (c, o, t) => {
    for (const f of [523, 659, 784]) tone(c, o, t, { f: f * 0.97, f2: f, glide: 0.15, a: 0.08, hold: 0.45, d: 0.25, g: 0.18, vib: [5, 0.004] });
    noise(c, o, t, { f: 1500, q: 0.8, a: 0.08, hold: 0.45, d: 0.25, g: 0.12 });
  },
  /** A latch thrown. */
  done: (c, o, t) => {
    noise(c, o, t, { type: "highpass", f: 3000, d: 0.008, g: 0.5 });
    plate(c, o, t, 1200, 0.3, 0.03);
    noise(c, o, t + 0.06, { type: "highpass", f: 2000, d: 0.012, g: 0.6 });
    plate(c, o, t + 0.06, 800, 0.4, 0.05);
    thump(c, o, t + 0.06, 130, 80, 0.06, 0.5);
  },
  /** Ship full: hydraulics, a hatch sealing, a latch. */
  full: (c, o, t) => {
    noise(c, o, t, { f: 4000, f2: 1500, q: 1.5, a: 0.02, hold: 0.22, d: 0.12, g: 0.35 });
    plate(c, o, t + 0.3, 220, 0.6, 0.3);
    thump(c, o, t + 0.3, 100, 45, 0.18);
    noise(c, o, t + 0.45, { type: "highpass", f: 3000, d: 0.01, g: 0.4 });
    bar(c, o, t + 0.45, 1500, 0.3, 0.04);
  },

  // ---- fight
  /** Each of 3, 2, 1: a relay clunk and a low hum. */
  count: (c, o, t) => {
    thump(c, o, t, 90, 60, 0.12);
    plate(c, o, t, 300, 0.45, 0.1);
    const lp = filter(c, o, "lowpass", 900);
    tone(c, lp, t, { f: N(-19), type: "sawtooth", a: 0.005, hold: 0.12, d: 0.15, g: 0.25 });
  },
  /** Go: ignition. */
  go: (c, o, t) => {
    thump(c, o, t, 120, 40, 0.4);
    const dr = drive(c, o, 3);
    noise(c, dr, t, { type: "lowpass", f: 300, f2: 3000, glide: 0.15, a: 0.02, hold: 0.1, d: 0.7, g: 0.6 });
    const lp = filter(c, o, "lowpass", 600);
    tone(c, lp, t, { f: 45, f2: 90, glide: 0.3, type: "sawtooth", a: 0.02, hold: 0.1, d: 0.7, g: 0.4 });
  },
  /** One burn of the engine rumble, for levelling the loop (see setThrust). */
  thrust: (c, o, t) => {
    const g = c.createGain();
    g.gain.setValueAtTime(1, t);
    g.gain.setValueAtTime(0, t + 1.2);
    g.connect(o);
    thrustGraph(c, g, t, t + 1.2);
  },
  /** Your laser charging (the sim's 0.25s): a capacitor whine. */
  charge: (c, o, t) => {
    tone(c, o, t, { f: 400, f2: 2600, glide: 0.25, a: 0.03, hold: 0.2, d: 0.04, g: 0.3 });
    const lp = filter(c, o, "lowpass", 500);
    tone(c, lp, t, { f: 60, type: "square", a: 0.08, hold: 0.15, d: 0.04, g: 0.15 });
  },
  /** A crackly electric zap. */
  laser: (c, o, t) => {
    const r = rr(0.93, 1.07);
    const dr = drive(c, o, 4);
    tone(c, dr, t, { f: 2200 * r, f2: 240 * r, glide: 0.12, type: "sawtooth", d: 0.14, g: 0.35 });
    noise(c, o, t, { f: 3500, q: 1.5, d: 0.05, g: 0.4, crush: 2 });
    thump(c, o, t, 140, 70, 0.05, 0.4);
  },
  /** Hot metal sizzling where a beam lands. */
  hit: (c, o, t) => {
    noise(c, o, t, { type: "highpass", f: 3500, a: 0.002, hold: 0.03, d: 0.15, g: 0.5, am: [70, 0.8] });
    bar(c, o, t, rr(2200, 2600), 0.3, 0.05);
  },
  /** A beam glancing off a mirror: a bright ringing ping that bends upward, with a glassy shimmer. */
  ricochet: (c, o, t) => {
    const r = rr(0.95, 1.05);
    modal(c, o, t, 2100 * r, [[1, 1, 0.35], [2.32, 0.45, 0.22], [4.25, 0.2, 0.12]], 0.5);
    tone(c, o, t, { f: 1800 * r, f2: 3400 * r, glide: 0.12, d: 0.16, g: 0.18 });
    for (const dt of [-12, 12]) tone(c, o, t + 0.02, { f: 3500 * r, a: 0.01, d: 0.3, g: 0.05, detune: dt, vib: [9, 0.006] });
    noise(c, o, t, { type: "highpass", f: 6000, d: 0.03, g: 0.25 });
  },
  /** A cell blown off: a short boom with a crunch and a crackle (a ship's death is the big one). */
  break: (c, o, t) => {
    const r = rr(0.9, 1.1);
    thump(c, o, t, 120 * r, 38, 0.3);
    const dr = drive(c, o, 3);
    noise(c, dr, t, { type: "lowpass", f: 3200, f2: 280, glide: 0.35, d: 0.4, g: 0.8 });
    noise(c, o, t, { f: 900 * r, q: 0.7, d: 0.12, g: 0.5 });
    noise(c, o, t + 0.03, { type: "highpass", f: 2500, d: 0.12, g: 0.2, am: [45, 0.7] });
  },
  /** A ship wrecked: boom, roar, and debris clattering down. */
  death: (c, o, t) => {
    const v = verb(c, o, 0.25);
    thump(c, v, t, 90, 28, 1.2);
    const dr = drive(c, v, 3);
    noise(c, dr, t, { type: "lowpass", f: 4000, f2: 180, glide: 1.2, d: 1.3, g: 0.8 });
    noise(c, v, t, { f: 700, f2: 300, q: 0.8, d: 0.9, g: 0.4 });
    clinks(c, v, t, 10, 0.2, 1.2, 800, 3500, 0.3);
  },
  /** One bite of a saw: a dark rasp, no grind. */
  saw: (c, o, t) => {
    const lp = filter(c, o, "lowpass", 1400);
    tone(c, lp, t, { f: 150, f2: 135, type: "sawtooth", a: 0.01, hold: 0.07, d: 0.1, g: 0.35 });
    noise(c, o, t, { f: 1800, q: 0.8, a: 0.01, hold: 0.07, d: 0.1, g: 0.3, am: [40, 0.4, "sine"] });
  },
  /** A saw glancing off armor: a short ring and a knock as the ships part. */
  skid: (c, o, t) => {
    bar(c, o, t, rr(1600, 1800), 0.4, 0.18);
    tone(c, o, t, { f: 1500, f2: 1100, d: 0.18, g: 0.12 });
    noise(c, o, t, { type: "highpass", f: 3500, d: 0.14, g: 0.15 });
    thump(c, o, t, 150, 90, 0.08, 0.4);
  },
  /** Ships colliding: a clang. */
  impact: (c, o, t) => {
    plate(c, o, t, rr(160, 185), 0.8, 0.35);
    thump(c, o, t, 110, 45, 0.2);
    noise(c, o, t, { f: 1500, d: 0.04, g: 0.5 });
  },
  /** Off the rubber ring: a boing. */
  bounce: (c, o, t) => {
    const lp = filter(c, o, "lowpass", 1200);
    tone(c, lp, t, { f: 110, f2: 180, glide: 0.06, type: "triangle", d: 0.35, g: 0.9, vib: [11, 0.12] });
    thump(c, o, t, 80, 50, 0.08, 0.6);
  },
  /** The orb taken: a rising charge and a glassy shimmer. */
  powerup: (c, o, t) => {
    const lp = filter(c, o, "lowpass", 3000);
    [D5, F5, A5, D6, F6, A6].forEach((f, i) => tone(c, lp, t + i * 0.035, { f, type: "sawtooth", d: 0.1, g: 0.15 }));
    for (const f of [2350, 2800, 3500]) tone(c, o, t + 0.2, { f, a: 0.05, hold: 0.1, d: 0.5, g: 0.1, vib: [7, 0.01] });
    noise(c, o, t, { type: "highpass", f: 2000, f2: 8000, glide: 0.4, a: 0.1, d: 0.4, g: 0.1 });
  },
  /** Mirror skin fizzling out. */
  mirroroff: (c, o, t) => {
    for (const dt of [-15, 15]) tone(c, o, t, { f: 3500, f2: 1200, glide: 0.4, d: 0.45, g: 0.15, detune: dt });
    noise(c, o, t, { type: "highpass", f: 4000, d: 0.4, g: 0.25, am: [37, 1] });
  },
  /** A key with nothing behind it: a dead clunk. */
  deadkey: (c, o, t) => {
    thump(c, o, t, 140, 110, 0.05);
    noise(c, o, t, { f: 600, d: 0.03, g: 0.5 });
    plate(c, o, t, 400, 0.3, 0.03);
  },
  /** You won: a brassy horn as the screws rain down. */
  win: (c, o, t) => {
    const v = verb(c, o, 0.2);
    for (const [f, at, hold] of [[D4, 0, 0.12], [A4, 0.15, 0.12], [D5, 0.3, 0.55]] as const) {
      const lp = filter(c, v, "lowpass", 400, 1, { to: 2400, t: t + at, dur: 0.08 });
      tone(c, lp, t + at, { f, type: "sawtooth", a: 0.02, hold, d: 0.25, g: 0.35 });
      tone(c, lp, t + at, { f, type: "sawtooth", a: 0.02, hold, d: 0.25, g: 0.2, detune: 8 });
    }
    clinks(c, v, t, 16, 0.4, 1.9, 2000, 5000, 0.2);
  },
  /** Someone else won: a machine winding down. */
  lose: (c, o, t) => {
    const lp = filter(c, o, "lowpass", 1800, 1, { to: 150, t, dur: 1.2 });
    tone(c, lp, t, { f: 220, f2: 35, glide: 1.2, type: "sawtooth", a: 0.02, hold: 0.9, d: 0.35, g: 0.5 });
    thump(c, o, t + 1.15, 100, 45, 0.2, 0.8);
    plate(c, o, t + 1.15, 120, 0.5, 0.25);
  },
  /** Fast-forward: tape spinning up. */
  ff: (c, o, t) => {
    const lp = filter(c, o, "lowpass", 3000);
    tone(c, lp, t, { f: 90, f2: 700, glide: 0.35, type: "sawtooth", a: 0.02, hold: 0.2, d: 0.2, g: 0.3 });
    noise(c, o, t, { f: 800, f2: 3000, glide: 0.35, a: 0.02, hold: 0.2, d: 0.2, g: 0.2 });
  },
  /** A sheep collected: a bleat over its helmet radio. */
  sheep: (c, o, t) => {
    const radio = filter(c, filter(c, o, "lowpass", 3000), "highpass", 300);
    const vowel = c.createGain();
    for (const [f, q] of [[750, 5], [1250, 6], [2600, 8]] as const) vowel.connect(filter(c, radio, "bandpass", f, q));
    const tr = c.createGain();
    tr.gain.value = 0.6;
    lfo(c, tr.gain, t, t + 0.5, 26, 0.4);
    tr.connect(vowel);
    tone(c, tr, t, { f: 330 * rr(0.92, 1.08), f2: 290, type: "sawtooth", a: 0.04, hold: 0.22, d: 0.15, g: 1, vib: [6, 0.03] });
    noise(c, o, t, { type: "highpass", f: 2500, d: 0.015, g: 0.2 });
  },

  // ---- results
  /** A star token; v is its place in the run, each a step higher. */
  star: (c, o, t, v) => bar(c, o, t, N(17 + Math.min(v, 7) * 2), 0.5, 0.12),
  /** A kill token: a small crunch. */
  kill: (c, o, t) => {
    const dr = drive(c, o, 3);
    noise(c, dr, t, { f: 1200, q: 0.8, d: 0.1, g: 0.6 });
    thump(c, o, t, 130, 60, 0.1, 0.6);
  },
} satisfies Record<string, Effect>;

export type Sfx = keyof typeof EFFECTS;

/** How loud each effect plays at full volume, in dB (its loudest 46ms, RMS). */
const LEVELS: Record<Sfx, number> = {
  click: -27, join: -22, chat: -23, launch: -18,
  pickup: -22, rotate: -26, flip: -26, place: -16, nofit: -22, putback: -25, reroll: -20, deal: -25,
  lastsecs: -22, buildover: -18, done: -22, full: -20,
  count: -19, go: -16, thrust: -25, charge: -29, laser: -19, hit: -21, ricochet: -19, break: -17, death: -13,
  saw: -21, skid: -21, impact: -17, bounce: -19, powerup: -17, mirroroff: -23, deadkey: -25,
  win: -15, lose: -17, ff: -22, sheep: -20,
  star: -21, kill: -21,
};

const gains = new Map<Sfx, number>();

/** Renders every effect once, offline, and finds the gain that puts it at its level. */
async function levelAll() {
  if (typeof OfflineAudioContext === "undefined") return;
  const SR = 22050;
  for (const name of Object.keys(EFFECTS) as Sfx[]) {
    try {
      const c = new OfflineAudioContext(1, SR * 2.5, SR);
      (EFFECTS[name] as Effect)(c, c.destination, 0.01, 1);
      const d = (await c.startRendering()).getChannelData(0);
      let peak = 0;
      let loud = 0;
      for (let w = 0; w + 1024 <= d.length; w += 512) {
        let sum = 0;
        for (let k = w; k < w + 1024; k++) {
          sum += d[k]! * d[k]!;
          peak = Math.max(peak, Math.abs(d[k]!));
        }
        loud = Math.max(loud, Math.sqrt(sum / 1024));
      }
      if (loud > 1e-6) gains.set(name, Math.min(10 ** ((LEVELS[name] - 20 * Math.log10(loud)) / 20), 0.95 / peak));
    } catch {
      // Leaves the default for this one.
    }
  }
  syncThrust();
  if (import.meta.env.DEV) (window as unknown as { __sfxGains?: object }).__sfxGains = Object.fromEntries(gains);
}

const lastPlayed = new Map<Sfx, number>();
/** The same effect this soon after itself is dropped (a volley of lasers shouldn't stack up). */
const MIN_GAP_S = 0.03;

export interface SfxOptions {
  /** 0..1 on top of the volume (distance, how hard). */
  gain?: number;
  /** -1 (left) .. 1 (right). */
  pan?: number;
  /** The effect's own setting (see EFFECTS). */
  v?: number;
  /** Seconds from now. */
  delay?: number;
}

export function sfx(name: Sfx, { gain = 1, pan = 0, v = 0, delay = 0 }: SfxOptions = {}) {
  if (!prefs.on || prefs.volume === 0 || gain <= 0.01) return;
  wakeAudio();
  if (!ctx || ctx.state !== "running") return;
  const t = ctx.currentTime + delay;
  if (!delay) {
    if (t - (lastPlayed.get(name) ?? -1) < MIN_GAP_S) return;
    lastPlayed.set(name, t);
  }
  const out = ctx.createGain();
  out.gain.value = prefs.volume * gain * (gains.get(name) ?? 0.3);
  if (pan) {
    const p = ctx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    out.connect(p).connect(ctx.destination);
  } else out.connect(ctx.destination);
  (EFFECTS[name] as Effect)(ctx, out, t, v);
  if (import.meta.env.DEV) ((window as unknown as { __sfx?: string[] }).__sfx ??= []).push(name);
}

// ------------------------------------------------------------------------------- engine loop

/** The engine rumble: low noise with a flutter, a mid band, and a low sawtooth hum. */
function thrustGraph(c: Ctx, o: AudioNode, t: number, end: number): () => void {
  const src = c.createBufferSource();
  src.buffer = noiseBuffer(c);
  src.loop = true;
  const low = c.createBiquadFilter();
  low.type = "lowpass";
  low.frequency.value = 380;
  low.Q.value = 0.7;
  const flutter = lfo(c, low.frequency, t, end, 7, 80);
  const mid = c.createBiquadFilter();
  mid.type = "bandpass";
  mid.frequency.value = 600;
  mid.Q.value = 1.2;
  const midGain = c.createGain();
  midGain.gain.value = 0.35;
  src.connect(low).connect(o);
  src.connect(mid).connect(midGain).connect(o);
  const hum = c.createOscillator();
  hum.type = "sawtooth";
  hum.frequency.value = 52;
  const wobble = lfo(c, hum.frequency, t, end, 5, 52 * 0.03);
  const humLp = c.createBiquadFilter();
  humLp.type = "lowpass";
  humLp.frequency.value = 200;
  const humGain = c.createGain();
  humGain.gain.value = 0.4;
  hum.connect(humLp).connect(humGain).connect(o);
  src.start(t, Math.random() * 1.5);
  hum.start(t);
  src.stop(end);
  hum.stop(end);
  return () => {
    for (const n of [src, hum, flutter, wobble]) n.stop();
  };
}

let thrustLevel = 0;
let thrustLoop: { gain: GainNode; stop: () => void } | null = null;

/** How hard your engines are firing, 0..1; the rumble follows it, and 0 stops it. */
export function setThrust(level: number) {
  thrustLevel = level;
  syncThrust();
}

function syncThrust() {
  if (!ctx) return;
  const want = prefs.on ? thrustLevel * prefs.volume * (gains.get("thrust") ?? 0.3) : 0;
  if (!thrustLoop && want > 0 && ctx.state === "running") {
    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.connect(ctx.destination);
    thrustLoop = { gain, stop: thrustGraph(ctx, gain, ctx.currentTime, ctx.currentTime + 24 * 3600) };
  }
  if (!thrustLoop) return;
  // A quick swell in, a slightly slower fade out, like the flames.
  thrustLoop.gain.gain.setTargetAtTime(want, ctx.currentTime, want > thrustLoop.gain.gain.value ? 0.03 : 0.08);
}

/** Leaving the fight: the loop goes. */
export function stopThrust() {
  thrustLevel = 0;
  thrustLoop?.stop();
  thrustLoop = null;
}
