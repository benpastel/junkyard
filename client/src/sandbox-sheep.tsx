// Preview of the spacesuit sheep at several sizes: ?sandbox=sheep
import { useEffect, useRef } from "react";
import { drawSheep } from "./art/sheep";

const SIZES = [10, 14, 20, 32, 64, 128];

export function SandboxSheep() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current!;
    const ctx = canvas.getContext("2d")!;
    let raf = 0;
    const frame = (ms: number) => {
      const t = ms / 1000;
      const dpr = window.devicePixelRatio || 1;
      const w = window.innerWidth;
      const h = window.innerHeight;
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = "#0b0d10";
      ctx.fillRect(0, 0, w, h);

      // size ladder
      let x = 40;
      SIZES.forEach((r, i) => {
        x += r;
        ctx.save();
        ctx.translate(x, 200);
        ctx.strokeStyle = "rgba(255,255,255,0.08)";
        ctx.beginPath();
        ctx.arc(0, 0, r, 0, Math.PI * 2);
        ctx.stroke();
        drawSheep(ctx, r, { t, variant: i });
        ctx.restore();
        x += r + 40;
      });

      // as in play: small, drifting and spinning
      for (let v = 0; v < 8; v++) {
        ctx.save();
        ctx.translate(80 + v * 90 + Math.sin(t * 0.4 + v) * 20, 460 + Math.cos(t * 0.3 + v * 2) * 20);
        ctx.rotate(t * 0.3 * (v % 2 ? 1 : -1) + v);
        drawSheep(ctx, 12, { t, variant: v });
        ctx.restore();
      }
      // the same at 2x, still in play size, to compare variants
      for (let v = 0; v < 8; v++) {
        ctx.save();
        ctx.translate(80 + v * 90, 600);
        drawSheep(ctx, 24, { t, variant: v });
        ctx.restore();
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div style={{ position: "fixed", inset: 0, background: "#0b0d10" }}>
      <canvas ref={ref} style={{ width: "100%", height: "100%", display: "block" }} />
    </div>
  );
}
