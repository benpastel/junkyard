import sys, os, time
import numpy as np
from PIL import Image
from bglib import *

OUTDIR = "/home/claude/bg/out"
os.makedirs(OUTDIR, exist_ok=True)


def s1_four_landmarks():
    """the brief, played straight: ringed planet / nebula / spiral galaxy / asteroid belt"""
    img = base(11, SLATE, 0.010)
    L = (-0.8, -0.35, 0.35)
    cx, cy = polar(-40, 0.6)
    planet(img, cx, cy, 0.15, L, SAND, 12, band=(8, -0.35, 0.28), alt=(SAND + RUST) / 2,
           rings=dict(ang=-0.35, tilt=0.30, rin=1.35, rout=2.2, col=BONE * 0.95, op=0.7), atmo=0.3)
    cx, cy = polar(165, 0.58)
    nebula(img, cx, cy, 0.36, 0.8, 0.6, 13, TEAL, SLATE, bright=0.8, dust=0.55, sharp=1.3, hi=0.7, lobes=4)
    cx, cy = polar(72, 0.6)
    galaxy(img, cx, cy, 0.34, 1.1, 0.55, 14, SAND * 1.05, SLATE * 1.05, bright=0.95)
    belt(img, 245, 26, 0.66, 0.05, 15, L, GREY * 0.95, 55, 0.008, 0.032, haze=0.14)
    return img


def s2_gas_giant():
    """one huge banded giant looming off one edge, a small moon opposite, a ring nebula, a dark cloud"""
    img = base(21, SLATE, 0.009)
    L = (-0.75, 0.35, 0.45)
    cx, cy = polar(15, 0.70)
    planet(img, cx, cy, 0.30, L, RUST * 1.05, 22, band=(14, 0.25, 0.42), alt=SAND,
           storm=(-0.25, 0.32, 0.13, 0.5), atmo=0.3, atmo_col=SAND)
    cx, cy = polar(200, 0.62)
    planet(img, cx, cy, 0.085, L, GREY, 23, band=(3, 0.0, 0.08), atmo=0.0)
    cx, cy = polar(110, 0.62)
    ring_nebula(img, cx, cy, 0.16, 0.6, 0.75, 24, TEAL, RUST, bright=0.8)
    # dark cloud: dim rust glow with dusty lanes eating into it
    cx, cy = polar(290, 0.6)
    nebula(img, cx, cy, 0.34, -0.4, 0.65, 25, RUST * 0.9, SAND * 0.8, bright=0.75, dust=0.9, sharp=1.2, hi=0.7, lobes=5)
    return img


def s3_black_hole():
    """black hole with accretion disc / comet / shattered moon + debris / teal nebula"""
    img = base(31, SLATE, 0.009)
    L = (0.5, -0.6, 0.55)
    cx, cy = polar(330, 0.6)
    black_hole(img, cx, cy, 0.05, 0.3, 0.28, 32, RUST * 1.05, bright=0.85)
    hx, hy = polar(150, 0.47)
    comet(img, hx, hy, 150, 0.45, 0.028, 33, BONE, SAND * 0.9, TEAL, bright=0.75, curve=0.2)
    cx, cy = polar(62, 0.62)
    shattered(img, cx, cy, 0.12, L, GREY * 0.95, 34, k=8, spread=0.3, gap=0.012, core=RUST * 0.8, missing=(3,), spin=0.3)
    # debris trail curling away from the moon
    rr = np.random.default_rng(35)
    for i in range(30):
        t = i / 30
        a = np.radians(62 + 4 + t * 32)
        r = 0.62 + 0.14 + t * 0.07 + rr.normal(0, 0.012)
        size = 0.016 * (1 - t) ** 1.3 + 0.004
        rock(img, r * np.cos(a), r * np.sin(a), size * rr.uniform(0.6, 1.2), L, GREY * 0.9, 300 + i)
    cx, cy = polar(240, 0.6)
    nebula(img, cx, cy, 0.33, 2.2, 0.55, 36, TEAL, TEAL * 0.8 + SLATE * 0.2, bright=0.7, dust=0.5, lobes=4)
    return img


def s4_derelict():
    """on-theme: wrecked ring station / dying ember star / edge-on galaxy / filament nebula"""
    img = base(41, SLATE, 0.009)
    L = (0.65, 0.55, 0.5)  # lit roughly from the ember
    cx, cy = polar(225, 0.6)
    station(img, cx, cy, 0.22, 0.35, 0.5, 42, L, GREY * 1.05, gap=(0.6, 1.25))
    cx, cy = polar(45, 0.64)
    ember(img, cx, cy, 0.15, 43, RUST, bright=0.75)
    cx, cy = polar(135, 0.62)
    edge_galaxy(img, cx, cy, 0.33, 0.5, 44, SAND, SLATE * 1.05, bright=0.8)
    cx, cy = polar(318, 0.6)
    shell(img, cx, cy, 0.28, 45, TEAL, RUST, bright=0.7, arc=(1.2, 1.2 + 4.0))
    return img


def s5_nebula_compass():
    """four nebulae with four different silhouettes: cloud / shell / pillars / fan"""
    img = base(51, SLATE, 0.009)
    cx, cy = polar(270, 0.6)
    nebula(img, cx, cy, 0.34, 0.1, 0.55, 52, TEAL, SLATE, bright=0.75, dust=0.5, lobes=4)
    cx, cy = polar(0, 0.6)
    shell(img, cx, cy, 0.28, 53, RUST * 1.05, SAND, bright=0.75, arc=(2.4, 2.4 + 4.4))
    cx, cy = polar(90, 0.6)
    pillars(img, cx, cy, 0.3, 0.0, 54, SAND * 0.95, bright=0.65)
    cx, cy = polar(180, 0.47)
    fan(img, cx, cy, 0.5, np.radians(180), 0.85, 55, SLATE * 1.1, bright=0.7)
    return img


SCENES = {
    "1-four-landmarks": s1_four_landmarks,
    "2-gas-giant": s2_gas_giant,
    "3-black-hole": s3_black_hole,
    "4-derelict-station": s4_derelict,
    "5-nebula-compass": s5_nebula_compass,
}

if __name__ == "__main__":
    names = sys.argv[1:] or list(SCENES)
    for name in names:
        key = [k for k in SCENES if k.startswith(name)][0]
        t = time.time()
        img = SCENES[key]()
        out, im = export(img, f"{OUTDIR}/{key}.webp")
        sz = os.path.getsize(f"{OUTDIR}/{key}.webp") / 1e6
        v = out.max(axis=2)
        mx = out.max(axis=2)
        mn = out.min(axis=2)
        sat = np.where(mx > 0.05, (mx - mn) / np.maximum(mx, 1e-6), 0)
        print(f"{key}: {time.time()-t:.0f}s, {sz:.2f}MB, maxV={v.max():.3f} p99.9V={np.percentile(v,99.9):.3f}, "
              f"sat p99={np.percentile(sat[mx>0.05],99) if (mx>0.05).any() else 0:.2f}")
        prev = Image.fromarray(np.clip(np.asarray(im.resize((1024, 1024), Image.LANCZOS)).astype(np.float32) * 3.0, 0, 255).astype(np.uint8))
        prev.save(f"{OUTDIR}/{key}-preview-3x.jpg", quality=88)
        im.resize((1024, 1024), Image.LANCZOS).save(f"{OUTDIR}/{key}-preview.jpg", quality=92)
