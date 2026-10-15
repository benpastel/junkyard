// Design review: candidate looks for the draft's rotate / flip / put back / new offers buttons.
// Open with ?sandbox=buttons. Each set has a sample piece the buttons actually turn.
import { useState, type ReactNode } from "react";
import type { Dir } from "@ja/shared";
import { transformCells, type Piece } from "@ja/shared/draft";
import { PieceCanvas } from "./draft/PieceCanvas";
import { KeyButton } from "./ui/KeyButton";
import "./draft/draft.css";
import "./sandbox-buttons.css";

const SAMPLE: Piece = {
  id: "sample",
  shape: "L",
  cells: [
    { x: 0, y: 0, type: "hull", dir: 0 },
    { x: 0, y: 1, type: "hull", dir: 0 },
    { x: 0, y: 2, type: "laser", dir: 3 },
    { x: 0, y: 3, type: "hull", dir: 0 },
    { x: 1, y: 3, type: "engine", dir: 0 },
  ],
};

type Action = "ccw" | "cw" | "flip" | "back" | "deal";

interface IconSet {
  id: string;
  name: string;
  icons: Record<Action, ReactNode>;
  /** Text under each icon, for the labelled set. */
  labels?: Record<Action, string>;
  /** Rotate pair joined into one control. */
  grouped?: boolean;
  /** Bigger buttons with the keycap under them instead of over the icon's corner. */
  big?: boolean;
}

const S = { fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" } as const;
const svg = (children: ReactNode, size = 26) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...S} aria-hidden>
    {children}
  </svg>
);

// ---- current ----
const curRotate = (ccw?: boolean) => (
  <svg width={26} height={26} viewBox="0 0 24 24" {...S} style={ccw ? { transform: "scaleX(-1)" } : undefined} aria-hidden>
    <path d="M20 12a8 8 0 1 1-2.34-5.66" />
    <path d="M20 4v5h-5" />
  </svg>
);
const curFlip = svg(
  <>
    <path d="M12 3v18" strokeDasharray="2 2.5" />
    <path d="M9 7 4 12l5 5V7Z" />
    <path d="M15 7l5 5-5 5V7Z" />
  </>,
);
const curBack = svg(<path d="M6 6l12 12M18 6 6 18" />);
const hourglass = svg(
  <>
    <path d="M6 3h12M6 21h12" />
    <path d="M7 3c0 5 10 5 10 9s-10 4-10 9" />
    <path d="M17 3c0 5-10 5-10 9s10 4 10 9" />
  </>,
);

// ---- piece glyphs: a little L shows the piece before (faint) and after (solid) ----
/** Cells of a small L (2 wide, 3 tall) in a 32-unit box, turned `rot` quarter turns, optionally mirrored. */
function lCells(rot: number, mirror = false): [number, number][] {
  let pts: [number, number][] = [
    [0, 0],
    [0, 1],
    [0, 2],
    [1, 2],
  ];
  if (mirror) pts = pts.map(([x, y]) => [1 - x, y]);
  for (let i = 0; i < ((rot % 4) + 4) % 4; i++) pts = pts.map(([x, y]) => [-y, x]);
  const mx = Math.min(...pts.map((p) => p[0]));
  const my = Math.min(...pts.map((p) => p[1]));
  return pts.map(([x, y]) => [x - mx, y - my]);
}
function MiniL(props: { x: number; y: number; s?: number; rot?: number; mirror?: boolean; ghost?: boolean }) {
  const s = props.s ?? 5;
  return (
    <g opacity={props.ghost ? 0.35 : 1}>
      {lCells(props.rot ?? 0, props.mirror).map(([cx, cy]) => (
        <rect key={`${cx},${cy}`} x={props.x + cx * s} y={props.y + cy * s} width={s - 1} height={s - 1} fill="currentColor" stroke="none" rx={0.6} />
      ))}
    </g>
  );
}
const g32 = (children: ReactNode, style?: React.CSSProperties) => (
  <svg width={36} height={36} viewBox="0 0 32 32" {...S} style={style} aria-hidden>
    {children}
  </svg>
);
const glyphRotate = (ccw?: boolean) =>
  g32(
    <>
      <MiniL x={2} y={13} ghost />
      <MiniL x={15} y={16} rot={1} />
      <path d="M5 10C7 3 19 2 23 10" strokeWidth={2} />
      <path d="M24.5 5.5 23.3 10.4 18.6 9" strokeWidth={2} />
    </>,
    ccw ? { transform: "scaleX(-1)" } : undefined,
  );
const glyphFlip = g32(
  <>
    <path d="M16 2v26" strokeDasharray="2 2.5" strokeWidth={1.5} />
    <MiniL x={3} y={9} ghost />
    <MiniL x={19} y={9} mirror />
  </>,
);
const glyphBack = g32(
  <>
    <MiniL x={11} y={1} s={4.2} />
    <path d="M16 15v6" strokeWidth={2} />
    <path d="M12.8 18.2 16 21.4l3.2-3.2" strokeWidth={2} />
    <path d="M5 20v6h22v-6" strokeWidth={2.2} />
  </>,
);
const glyphDeal = g32(
  <>
    <rect x={3} y={11} width={7} height={10} rx={1.2} strokeWidth={1.8} />
    <rect x={12.5} y={11} width={7} height={10} rx={1.2} strokeWidth={1.8} />
    <rect x={22} y={11} width={7} height={10} rx={1.2} strokeWidth={1.8} />
    <path d="M6 7.5C10 2.5 22 2.5 26 7.5" strokeWidth={1.8} />
    <path d="M26.5 3.2 26.3 7.8 21.8 7.2" strokeWidth={1.8} />
    <path d="M26 24.5C22 29.5 10 29.5 6 24.5" strokeWidth={1.8} />
    <path d="M5.5 28.8 5.7 24.2 10.2 24.8" strokeWidth={1.8} />
  </>,
);

// ---- bold: bigger shapes, one strong stroke each ----
const boldRotate = (ccw?: boolean) => (
  <svg width={30} height={30} viewBox="0 0 24 24" {...S} strokeWidth={2.8} style={ccw ? { transform: "scaleX(-1)" } : undefined} aria-hidden>
    <path d="M5 17V11a5 5 0 0 1 5-5h8" />
    <path d="M14.5 2.5 18 6l-3.5 3.5" />
  </svg>
);
const boldFlip = svg(
  <>
    <path d="M12 3v18" strokeDasharray="2 2.5" strokeWidth={1.6} />
    <path d="M3 12h6M15 12h6" strokeWidth={2.6} />
    <path d="M6 9 3 12l3 3M18 9l3 3-3 3" strokeWidth={2.6} />
  </>,
  30,
);
const boldBack = svg(
  <>
    <path d="M9 14 4 9l5-5" strokeWidth={2.6} />
    <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" strokeWidth={2.6} />
  </>,
  30,
);
const dice = svg(
  <>
    <rect x={3.5} y={3.5} width={17} height={17} rx={3} strokeWidth={2.2} />
    <circle cx={8.5} cy={8.5} r={1.4} fill="currentColor" stroke="none" />
    <circle cx={15.5} cy={8.5} r={1.4} fill="currentColor" stroke="none" />
    <circle cx={12} cy={12} r={1.4} fill="currentColor" stroke="none" />
    <circle cx={8.5} cy={15.5} r={1.4} fill="currentColor" stroke="none" />
    <circle cx={15.5} cy={15.5} r={1.4} fill="currentColor" stroke="none" />
  </>,
  30,
);

// ---- extra alternatives for the per-action grid ----
const quarterRotate = svg(
  <>
    <rect x={4} y={11} width={9} height={9} rx={1} strokeWidth={1.6} strokeDasharray="2 2" />
    <rect x={11} y={4} width={9} height={9} rx={1} transform="rotate(0)" strokeWidth={2} />
    <path d="M5 8a6 6 0 0 1 4-4" strokeWidth={1.6} />
    <path d="M9.5 1.8 10 4.3 7.6 5.2" strokeWidth={1.6} />
  </>,
  30,
);
const rotateArrowOnly = svg(
  <>
    <path d="M4 12a8 8 0 0 1 14.5-4.7" strokeWidth={2.4} />
    <path d="M19.5 3v5h-5" strokeWidth={2.4} />
  </>,
  30,
);
const flipTriangles = svg(
  <>
    <path d="M12 2v20" strokeWidth={1.6} />
    <path d="M9.5 18H3.5L9.5 6Z" fill="currentColor" fillOpacity={0.25} />
    <path d="M14.5 18h6l-6-12Z" fill="currentColor" />
  </>,
  30,
);
const flipMirrorArrow = svg(
  <>
    <path d="M12 2v20" strokeDasharray="2 2.5" strokeWidth={1.4} />
    <path d="M4.5 8.5a8 8 0 0 1 15 0" strokeWidth={2} />
    <path d="M19.8 4.5v4.3h-4.3" strokeWidth={2} />
    <path d="M7 13h3v7H7zM14 13h3v7h-3z" strokeWidth={1.6} />
  </>,
  30,
);
const shuffle = svg(
  <>
    <path d="M3 7h3.5c4.5 0 6.5 10 11 10H21" strokeWidth={2.2} />
    <path d="M3 17h3.5c1.8 0 3-1.5 4-3.3M13.4 9.6C14.5 8.2 15.8 7 17.5 7H21" strokeWidth={2.2} />
    <path d="M18.5 4 21 7l-2.5 3M18.5 14l2.5 3-2.5 3" strokeWidth={2.2} />
  </>,
  30,
);
const refresh = svg(
  <>
    <path d="M20 11a8 8 0 0 0-14.3-4.3L4 9" strokeWidth={2.2} />
    <path d="M4 4v5h5" strokeWidth={2.2} />
    <path d="M4 13a8 8 0 0 0 14.3 4.3L20 15" strokeWidth={2.2} />
    <path d="M20 20v-5h-5" strokeWidth={2.2} />
  </>,
  30,
);

const SETS: IconSet[] = [
  {
    id: "A",
    name: "Current",
    icons: { ccw: curRotate(true), cw: curRotate(), flip: curFlip, back: curBack, deal: hourglass },
  },
  {
    id: "B",
    name: "Piece glyphs",
    icons: { ccw: glyphRotate(true), cw: glyphRotate(), flip: glyphFlip, back: glyphBack, deal: glyphDeal },
  },
  {
    id: "C",
    name: "Bold",
    icons: { ccw: boldRotate(true), cw: boldRotate(), flip: boldFlip, back: boldBack, deal: dice },
  },
  {
    id: "D",
    name: "Piece glyphs, grouped",
    icons: { ccw: glyphRotate(true), cw: glyphRotate(), flip: glyphFlip, back: glyphBack, deal: glyphDeal },
    grouped: true,
  },
  {
    id: "E",
    name: "Piece glyphs, big, keys below",
    icons: { ccw: glyphRotate(true), cw: glyphRotate(), flip: glyphFlip, back: glyphBack, deal: glyphDeal },
    grouped: true,
    big: true,
  },
  {
    id: "F",
    name: "Labelled",
    icons: { ccw: curRotate(true), cw: curRotate(), flip: curFlip, back: curBack, deal: hourglass },
    labels: { ccw: "Left", cw: "Right", flip: "Flip", back: "Back", deal: "New" },
  },
];

const KEYS: Record<Action, string> = { ccw: "Q", cw: "E", flip: "F", back: "Esc", deal: "R" };

export function SandboxButtons() {
  return (
    <div className="mock">
      {SETS.map((set) => (
        <SetRow key={set.id} set={set} />
      ))}
      <h2 className="mock-h">Alternatives per action</h2>
      <Alternatives
        rows={[
          ["Rotate", [curRotate(), glyphRotate(), boldRotate(), quarterRotate, rotateArrowOnly]],
          ["Flip", [curFlip, glyphFlip, boldFlip, flipTriangles, flipMirrorArrow]],
          ["Put back", [curBack, glyphBack, boldBack]],
          ["New offers", [hourglass, glyphDeal, dice, shuffle, refresh]],
        ]}
      />
    </div>
  );
}

function SetRow({ set }: { set: IconSet }) {
  const [rot, setRot] = useState<Dir>(0);
  const [flip, setFlip] = useState(false);
  const [lit, setLit] = useState<Action | null>(null);
  const press = (a: Action) => {
    setLit(a);
    setTimeout(() => setLit(null), 160);
    if (a === "ccw") setRot((r) => ((r + 3) % 4) as Dir);
    if (a === "cw") setRot((r) => ((r + 1) % 4) as Dir);
    if (a === "flip") {
      setFlip((f) => !f);
      setRot((r) => ((4 - r) % 4) as Dir);
    }
    if (a === "back" || a === "deal") {
      setRot(0);
      setFlip(false);
    }
  };
  const btn = (a: Action) => (
    <div className="mock-btn" key={a}>
      <KeyButton keyLabel={KEYS[a]} icon={set.icons[a]} onClick={() => press(a)} active={lit === a} />
      {set.labels && <span className="mock-label">{set.labels[a]}</span>}
    </div>
  );
  return (
    <section className="mock-set">
      <div className="mock-name">
        <b>{set.id}</b> {set.name}
      </div>
      <div className="mock-piece">
        <PieceCanvas cells={transformCells(SAMPLE.cells, rot, flip)} cell={22} color="#e8743b" />
      </div>
      <div className={`draft-tools mock-tools${set.grouped ? " grouped" : ""}${set.big ? " big" : ""}`}>
        {set.grouped ? (
          <>
            <div className="mock-pair">
              {btn("ccw")}
              {btn("cw")}
            </div>
            {btn("flip")}
            <span className="mock-spacer" />
            {btn("back")}
            {btn("deal")}
          </>
        ) : (
          (["ccw", "cw", "flip", "back", "deal"] as Action[]).map(btn)
        )}
      </div>
    </section>
  );
}

function Alternatives({ rows }: { rows: [string, ReactNode[]][] }) {
  return (
    <div className="mock-alts">
      {rows.map(([name, icons]) => (
        <div className="mock-alt-row" key={name}>
          <div className="mock-name">{name}</div>
          {icons.map((icon, i) => (
            <div className="mock-btn" key={i}>
              <KeyButton keyLabel={String(i + 1)} icon={icon} />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
