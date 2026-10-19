import type { HullId } from "@ja/shared";
import { cockpitCells } from "@ja/shared";
import { HULLS } from "@ja/shared/draft";

/** A hull's silhouette, with the cockpit in rust. */
export function HullOutline({ hull, size = 80 }: { hull: HullId; size?: number }) {
  const rows = HULLS[hull].rows;
  const cell = size / Math.max(rows[0]!.length, rows.length);
  const cy = rows.findIndex((r) => r.includes("C"));
  const cockpit = new Set(cockpitCells(rows[cy]!.indexOf("C"), cy).map((c) => `${c.x},${c.y}`));
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
      <g transform={`translate(${(size - rows[0]!.length * cell) / 2} ${(size - rows.length * cell) / 2})`}>
        {rows.flatMap((row, y) =>
          [...row].map((ch, x) =>
            ch === "." ? null : (
              <rect
                key={`${x},${y}`}
                x={x * cell}
                y={y * cell}
                width={cell * 0.85}
                height={cell * 0.85}
                fill={cockpit.has(`${x},${y}`) ? "var(--rust)" : "currentColor"}
              />
            ),
          ),
        )}
      </g>
    </svg>
  );
}

/** A die face, standing in for "random" wherever a hull silhouette would go. */
export function RandomHull({ size = 80 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} aria-hidden>
      <rect x={5} y={5} width={14} height={14} rx={2.5} />
      {[
        [9, 9],
        [15, 9],
        [12, 12],
        [9, 15],
        [15, 15],
      ].map(([x, y]) => (
        <circle key={`${x},${y}`} cx={x} cy={y} r={1.1} fill="currentColor" stroke="none" />
      ))}
    </svg>
  );
}
