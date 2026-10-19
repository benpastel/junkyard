# procedural space-backdrop toolkit. world coords: [-1,1]^2, centre = arena centre, y down.
# everything is emissive-ish linear rgb in 0..~1, tone-mapped to a 30% cap at the end.
import numpy as np
from PIL import Image
from scipy.ndimage import map_coordinates, gaussian_filter

N = 2048  # working res; upscaled to OUT (everything is soft, so this is invisible)
OUT = 4096
_iy, _ix = np.mgrid[0:N, 0:N].astype(np.float32)
X = (_ix + 0.5) / N * 2 - 1
Y = (_iy + 0.5) / N * 2 - 1
PX = 2.0 / N  # one working pixel in world units

# desaturated palette (direction + rough level); player colours deliberately avoided
TEAL = np.array([0.27, 0.40, 0.41], np.float32)
RUST = np.array([0.50, 0.37, 0.30], np.float32)
SAND = np.array([0.47, 0.43, 0.36], np.float32)
SLATE = np.array([0.34, 0.37, 0.41], np.float32)
GREY = np.array([0.40, 0.40, 0.40], np.float32)
BONE = np.array([0.50, 0.50, 0.48], np.float32)


def polar(deg, r):
    a = np.radians(deg)
    return float(r * np.cos(a)), float(r * np.sin(a))


def sstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


def light(L):
    L = np.asarray(L, np.float32)
    return L / np.linalg.norm(L)


def rot(u, v, a):
    c, s = np.cos(a), np.sin(a)
    return u * c + v * s, -u * s + v * c


def unrot(p, q, a):
    c, s = np.cos(a), np.sin(a)
    return p * c - q * s, p * s + q * c


def fbm(seed, shape, base=3, octaves=7, pers=0.55):
    """value-noise fbm, normalised to ~0..1"""
    h, w = shape
    m = max(h, w)
    r = np.random.default_rng(seed)
    out = np.zeros(shape, np.float32)
    amp, tot, s = 1.0, 0.0, base
    for _ in range(octaves):
        gh = int(np.ceil(s * h / m)) + 2
        gw = int(np.ceil(s * w / m)) + 2
        g = r.random((gh, gw)).astype(np.float32)
        out += amp * np.asarray(Image.fromarray(g, "F").resize((w, h), Image.BICUBIC))
        tot += amp
        amp *= pers
        s *= 2
    out /= tot
    lo, hi = np.percentile(out, 0.5), np.percentile(out, 99.5)
    return np.clip((out - lo) / (hi - lo + 1e-6), 0, 1)


def warp(f, dx, dy, mode="reflect"):
    h, w = f.shape
    iy, ix = np.mgrid[0:h, 0:w].astype(np.float32)
    return map_coordinates(f, [iy + dy, ix + dx], order=1, mode=mode)


def crop(cx, cy, ext):
    x0 = max(0, int(((cx - ext) + 1) / 2 * N))
    x1 = min(N, int(((cx + ext) + 1) / 2 * N) + 1)
    y0 = max(0, int(((cy - ext) + 1) / 2 * N))
    y1 = min(N, int(((cy + ext) + 1) / 2 * N) + 1)
    return (slice(y0, y1), slice(x0, x1)), X[y0:y1, x0:x1], Y[y0:y1, x0:x1]


def add(img, sl, f, col):
    img[sl] += f[..., None] * np.asarray(col, np.float32)


def over(img, sl, a, rgb):
    a = np.clip(a, 0, 1)[..., None]
    img[sl] = img[sl] * (1 - a) + np.asarray(rgb, np.float32) * a


def base(seed, col=SLATE, lvl=0.010):
    img = np.zeros((N, N, 3), np.float32)
    n = fbm(seed, (N, N), 2, 5, 0.5)
    img += (lvl * (0.3 + 1.0 * n))[..., None] * col
    return img


# ---------------- landmarks ----------------

def ring_profile(seed, n=1024):
    r = np.random.default_rng(seed)
    t = np.linspace(0, 1, n)
    fine = gaussian_filter(r.random(n), 2.5)
    fine = (fine - fine.min()) / (np.ptp(fine) + 1e-6)
    coarse = gaussian_filter(r.random(n), 30)
    coarse = (coarse - coarse.min()) / (np.ptp(coarse) + 1e-6)
    p = (0.35 + 0.65 * fine) * (0.3 + 0.7 * coarse)
    for g, w in ((0.58, 0.025), (0.83, 0.012)):  # a cassini-ish gap or two
        p *= 1 - 0.92 * np.exp(-((t - g) / w) ** 2)
    return p.astype(np.float32)


def planet(img, cx, cy, R, L, col, seed, band=(9, 0.3, 0.35), alt=None, storm=None,
           rings=None, atmo=0.0, atmo_col=None, night=0.010):
    ext = R * (rings["rout"] if rings else 1.0) * 1.05 + 6 * PX
    sl, x, y = crop(cx, cy, ext)
    u = (x - cx) / R
    v = (y - cy) / R
    d = np.sqrt(u * u + v * v)
    nz = np.sqrt(np.clip(1 - d * d, 0, 1))
    L = light(L)
    lam = np.clip(u * L[0] + v * L[1] + nz * L[2], 0, 1)
    freq, ang, amt = band
    n = fbm(seed, u.shape, 4, 6)
    p, q = rot(u, v, ang)
    n2 = fbm(seed + 3, u.shape, 6, 6, 0.6)
    qw = q + 0.06 * (n - 0.5) + 0.025 * (n2 - 0.5)
    rr = np.random.default_rng(seed)
    prof = gaussian_filter(rr.random(400), 400 / (freq * 6))
    prof = (prof - prof.min()) / (np.ptp(prof) + 1e-6)
    fine = gaussian_filter(rr.random(400), 1.5)
    fine = (fine - fine.min()) / (np.ptp(fine) + 1e-6)
    cprof = gaussian_filter(rr.random(400), 400 / (freq * 3))
    cprof = (cprof - cprof.min()) / (np.ptp(cprof) + 1e-6)
    t = np.clip((qw + 1.1) / 2.2, 0, 1).ravel()
    xs_ = np.linspace(0, 1, 400)
    b = (np.interp(t, xs_, prof) * 0.8 + np.interp(t, xs_, fine) * 0.2).reshape(u.shape)
    cm = np.interp(t, xs_, cprof).reshape(u.shape)
    tex = (1 - amt + amt * b) * (0.92 + 0.16 * n2)
    rgb = np.asarray(col)[None, None, :] * tex[..., None]
    if alt is not None:
        m = sstep(0.45, 0.85, cm)[..., None]
        rgb = rgb * (1 - m) + np.asarray(alt) * tex[..., None] * m
    if storm:
        su, sv, sr, sk = storm
        s = np.exp(-(((p - su) / sr) ** 2 + ((q - sv) / (sr * 0.5)) ** 2))
        swirl = 0.5 + 0.5 * np.sin(np.arctan2((q - sv) / 0.5, p - su) * 3 + np.hypot(p - su, (q - sv) / 0.5) * 30)
        rgb = rgb * (1 + sk * s * (0.7 + 0.3 * swirl))[..., None]
    shade = (lam ** 0.85) * (0.45 + 0.55 * nz ** 0.35)
    rgb = rgb * shade[..., None] + night
    a = np.clip((1 - d) * R / PX, 0, 1)

    if rings:
        p2, q2 = rot(u, v, rings["ang"])
        rho = np.sqrt(p2 ** 2 + (q2 / rings["tilt"]) ** 2)
        prof = ring_profile(seed + 7)
        t = (rho - rings["rin"]) / (rings["rout"] - rings["rin"])
        dens = np.interp(t.ravel(), np.linspace(0, 1, len(prof)), prof).reshape(t.shape)
        dens *= sstep(0, 0.02, t) * sstep(1, 0.98, t)
        # ring in the planet's shadow: crude, darken the far side opposite the light
        sh = np.clip(0.55 + 0.45 * (p2 * L[0] + q2 * L[1]) / (rho + 1e-3), 0.25, 1)
        ra = dens * rings["op"]
        rcol = np.asarray(rings["col"])[None, None, :] * ((0.5 + 0.5 * dens) * sh)[..., None]
        front = (q2 > 0).astype(np.float32)
        over(img, sl, ra * (1 - front), rcol)
        over(img, sl, a, rgb)
        over(img, sl, ra * front, rcol)
    else:
        over(img, sl, a, rgb)
    if atmo > 0:
        rim = np.exp(-((d - 1) / 0.035) ** 2) * np.clip(u * L[0] + v * L[1] + 0.35, 0, 1)
        add(img, sl, rim * atmo, atmo_col if atmo_col is not None else col)


def galaxy(img, cx, cy, R, ang, tilt, seed, core, armc, bright=0.7, arms=2, wind=2.2):
    sl, x, y = crop(cx, cy, R * 1.05)
    u = (x - cx) / R
    v = (y - cy) / R
    p, q = rot(u, v, ang)
    q = q / tilt
    r = np.sqrt(p * p + q * q) + 1e-4
    th = np.arctan2(q, p)
    n = fbm(seed, u.shape, 6, 7, 0.6)
    sp = arms * (th - wind * np.log(r))
    arm = (0.5 + 0.5 * np.cos(sp + 1.4 * (n - 0.5))) ** 2.5
    disk = np.exp(-r / 0.42) * sstep(1.0, 0.55, r)
    body = disk * (0.12 + 1.1 * arm * (0.35 + 0.95 * n))
    lane = (0.5 + 0.5 * np.cos(sp + 0.9)) ** 6 * sstep(0.04, 0.2, r)
    bulge = np.exp(-(r / 0.07) ** 2) * 1.0 + np.exp(-(r / 0.2) ** 2) * 0.3
    add(img, sl, body * bright * (1 - 0.7 * lane), armc)
    add(img, sl, bulge * bright, core)


def edge_galaxy(img, cx, cy, R, ang, seed, core, body, bright=0.7):
    sl, x, y = crop(cx, cy, R * 1.05)
    u = (x - cx) / R
    v = (y - cy) / R
    p, q = rot(u, v, ang)
    n = fbm(seed, u.shape, 8, 7, 0.6)
    q = q + 0.025 * p * p  # slight warp of the disc, like real ones
    disk = np.exp(-np.abs(q) / 0.04) * np.exp(-np.abs(p) / 0.3) * sstep(1.0, 0.7, np.abs(p))
    halo = np.exp(-((p / 0.5) ** 2 + (q / 0.16) ** 2)) * 0.12
    bulge = np.exp(-((p / 0.12) ** 2 + (q / 0.085) ** 2))
    lane = 1 - 0.88 * np.exp(-((q - 0.006) / 0.012) ** 2) * sstep(0.95, 0.15, np.abs(p)) * (0.55 + 0.6 * n)
    add(img, sl, (disk * (0.6 + 0.7 * n) + halo) * bright * lane, body)
    add(img, sl, bulge * bright * 0.9 * lane, core)


def nebula(img, cx, cy, R, ang, elong, seed, colA, colB, bright=0.6, dust=0.5, warpk=0.45,
           sharp=1.8, lobes=3, lo=0.02, hi=0.9):
    sl, x, y = crop(cx, cy, R * 1.3)
    u = (x - cx) / R
    v = (y - cy) / R
    sh = u.shape
    n2 = fbm(seed + 1, sh, 3, 6)
    n3 = fbm(seed + 2, sh, 3, 6)
    du = warpk * (n2 - 0.5) * 2
    dv = warpk * (n3 - 0.5) * 2
    uu, vv = u + du, v + dv
    p, q = rot(uu, vv, ang)
    mask = np.exp(-(p ** 2 + (q / elong) ** 2) * 2.6)
    rr = np.random.default_rng(seed)
    for _ in range(lobes):
        ox, oy = rr.normal(0, 0.32, 2)
        s = rr.uniform(0.22, 0.42)
        mask += 0.55 * np.exp(-(((uu - ox) ** 2 + (vv - oy) ** 2) / (s * s)) * 1.5)
    mask *= sstep(1.3, 0.95, np.sqrt(u * u + v * v))
    pxw = R / PX
    n1 = warp(fbm(seed, sh, 4, 8, 0.6), du * pxw * 0.25, dv * pxw * 0.25)
    dens = sstep(lo, hi, np.clip(mask, 0, 1.6) * n1 ** sharp)
    m = fbm(seed + 3, sh, 2, 4)[..., None]
    col = np.asarray(colA)[None, None, :] * (1 - m) + np.asarray(colB)[None, None, :] * m
    img[sl] += dens[..., None] * col * bright
    if dust > 0:
        n5 = warp(fbm(seed + 4, sh, 5, 7), du * pxw * 0.45, dv * pxw * 0.45)
        dd = sstep(0.55, 0.78, n5) * np.clip(mask, 0, 1) * dust
        img[sl] *= (1 - dd[..., None])


def rock(img, cx, cy, R, L, col, seed):
    sl, x, y = crop(cx, cy, R * 1.5)
    u = (x - cx) / R
    v = (y - cy) / R
    if u.size < 16:
        return
    th = np.arctan2(v, u)
    rr = np.random.default_rng(seed)
    rad = np.ones_like(u)
    for k in range(2, 7):
        rad += (0.24 / k) * rr.uniform(0.5, 1) * np.cos(k * th + rr.uniform(0, 6.28))
    d = np.sqrt(u * u + v * v) / rad
    nz = np.sqrt(np.clip(1 - d * d, 0, 1))
    L = light(L)
    lam = np.clip((u / rad) * L[0] + (v / rad) * L[1] + nz * L[2], 0, 1)
    n = fbm(seed, u.shape, 3, 4)
    shade = lam ** 1.2 * (0.75 + 0.5 * (n - 0.5))
    a = np.clip((1 - d) * R / PX, 0, 1)
    over(img, sl, a, np.asarray(col)[None, None, :] * shade[..., None] + 0.008)


def belt(img, ang0, span, r0, width, seed, L, col, nrocks, rmin, rmax, haze=0.07):
    rr = np.random.default_rng(seed)
    Rr = np.sqrt(X * X + Y * Y)
    A = np.arctan2(Y, X)
    da = (A - np.radians(ang0) + np.pi) % (2 * np.pi) - np.pi
    m = np.exp(-((Rr - r0) / width) ** 2) * np.exp(-(da / np.radians(span)) ** 2)
    n = fbm(seed, (N, N), 8, 6)
    add(img, (slice(None), slice(None)), m * n ** 2 * haze, col)
    for i in range(nrocks):
        a = np.radians(ang0) + np.clip(rr.normal(0, np.radians(span) * 0.55), -np.radians(span) * 1.4, np.radians(span) * 1.4)
        r = r0 + rr.normal(0, width * 0.45)
        size = rmin + (rmax - rmin) * rr.random() ** 2.2
        rock(img, r * np.cos(a), r * np.sin(a), size, L, np.asarray(col) * rr.uniform(0.8, 1.2), seed + 100 + i)


def ring_nebula(img, cx, cy, R, ang, tilt, seed, inner, outer, bright=0.6):
    sl, x, y = crop(cx, cy, R * 1.6)
    u = (x - cx) / R
    v = (y - cy) / R
    p, q = rot(u, v, ang)
    q = q / tilt
    n = fbm(seed, u.shape, 5, 7, 0.6)
    n2 = fbm(seed + 1, u.shape, 3, 5)
    rho = np.sqrt(p * p + q * q) * (1 + 0.2 * (n2 - 0.5))
    shell = np.exp(-((rho - 0.62) / 0.12) ** 2) * (0.35 + 0.9 * n)
    fill = np.exp(-(rho / 0.55) ** 4) * 0.3 * (0.5 + 0.7 * n)
    halo = np.exp(-((rho - 1.0) / 0.3) ** 2) * 0.22 * n ** 1.5
    mid = (np.asarray(inner) + np.asarray(outer)) / 2
    add(img, sl, fill * bright, inner)
    add(img, sl, shell * bright, mid)
    add(img, sl, halo * bright, outer)
    star = np.exp(-(np.sqrt(u * u + v * v) / 0.04) ** 2)
    add(img, sl, star * bright * 1.4, BONE)


def black_hole(img, cx, cy, rh, ang, tilt, seed, col, bright=0.6):
    sl, x, y = crop(cx, cy, rh * 5)
    u = (x - cx) / rh
    v = (y - cy) / rh
    p, q = rot(u, v, ang)
    qq = q / tilt
    r = np.sqrt(p * p + qq * qq)
    th = np.arctan2(qq, p)
    pol = fbm(seed, (128, 1024), 6, 6, 0.6)
    ri = np.clip((r - 1) / 4 * 127, 0, 127)
    ci = (th + np.pi) / (2 * np.pi) * 1023
    streak = map_coordinates(pol, [ri, ci], order=1, mode="grid-wrap")
    disk = sstep(1.5, 2.1, r) * sstep(4.8, 3.2, r) * (2.0 / np.maximum(r, 1)) ** 1.6 * (0.35 + 0.9 * streak)
    disk *= 1 + 0.6 * np.cos(th - 0.4)  # doppler: one side brighter
    front = (q > 0).astype(np.float32)
    add(img, sl, disk * (1 - front) * bright, col)
    rc = np.sqrt(u * u + v * v)
    tc = (np.arctan2(v, u) + np.pi) / (2 * np.pi) * 1023
    hs = map_coordinates(pol, [np.full_like(rc, 30), tc], order=1, mode="grid-wrap")
    halo = np.exp(-((rc - 1.65) / 0.3) ** 2) * 0.55 * (0.5 + 0.6 * hs)
    add(img, sl, halo * bright, col)
    glow = np.exp(-rc / 2.2) * 0.12 * sstep(5.0, 3.0, rc)
    add(img, sl, glow * bright, col)
    photon = np.exp(-((rc - 1.08) / 0.06) ** 2) * 0.45
    add(img, sl, photon * bright, (np.asarray(col) + BONE) / 2)
    a = np.clip((1 - rc) * rh / PX, 0, 1)
    over(img, sl, a, (0, 0, 0))
    add(img, sl, disk * front * bright, col)


def comet(img, cx, cy, dirdeg, length, width, seed, head, dustc, ionc, bright=0.6, curve=0.22):
    a = np.radians(dirdeg)
    d = np.array([np.cos(a), np.sin(a)])
    nrm = np.array([-np.sin(a), np.cos(a)])
    mx, my = cx + d[0] * length * 0.45, cy + d[1] * length * 0.45
    sl, x, y = crop(mx, my, length * 0.62 + width * 2)
    rx, ry = x - cx, y - cy
    s = (rx * d[0] + ry * d[1]) / length
    l = rx * nrm[0] + ry * nrm[1]
    sp = np.clip(s, 0, None)
    gate = sstep(-0.03, 0.02, s)
    nb = fbm(seed, (48, 600), 5, 5, 0.6)
    lc = l - curve * length * sp ** 2
    w = width * (0.35 + 2.4 * np.clip(s, 0, 1))
    st = map_coordinates(nb, [np.clip(s, 0, 1) * 47, np.clip((lc / w + 2.5) / 5, 0, 1) * 599], order=1, mode="nearest")
    dust = np.exp(-(lc / w) ** 2) * np.exp(-sp * 2.6) * gate * (0.45 + 0.8 * st)
    w2 = width * (0.12 + 0.6 * np.clip(s, 0, 1))
    st2 = map_coordinates(nb, [np.clip(s, 0, 1) * 47, np.clip((l / w2 + 2.5) / 5, 0, 1) * 599], order=1, mode="nearest")
    ion = np.exp(-(l / w2) ** 2) * np.exp(-sp * 1.8) * gate * (0.3 + 0.9 * st2 ** 2)
    rh = np.sqrt(rx * rx + ry * ry)
    coma = np.exp(-(rh / (width * 1.5)) ** 2) * 0.9 + np.exp(-(rh / (width * 0.35)) ** 2) * 0.9
    add(img, sl, dust * bright, dustc)
    add(img, sl, ion * bright * 0.8, ionc)
    add(img, sl, coma * bright, head)


def shattered(img, cx, cy, R, L, col, seed, k=7, spread=0.13, gap=0.035, core=RUST, missing=(), spin=0.35):
    """a moon broken into drifting, slightly rotated chunks with ragged fracture lines"""
    rr = np.random.default_rng(seed)
    pts = []
    while len(pts) < k:
        pnt = rr.uniform(-0.8, 0.8, 2)
        if np.hypot(*pnt) < 0.8:
            pts.append(pnt)
    pts = np.array(pts)
    offs = pts / (np.linalg.norm(pts, axis=1, keepdims=True) + 1e-3) * spread * rr.uniform(0.4, 1.0, (k, 1))
    rots = rr.uniform(-spin, spin, k)
    sl, x, y = crop(cx, cy, R * (1.1 + spread * 1.6))
    U = (x - cx) / R
    V = (y - cy) / R
    L = light(L)
    pxw = R / PX
    tex_s = fbm(seed + 1, (512, 512), 6, 6, 0.55)  # surface, in pre-break moon coords
    tex_r = fbm(seed + 2, (512, 512), 5, 5, 0.6)   # fracture raggedness

    def samp(t, a, b):
        return map_coordinates(t, [np.clip((b + 1.2) / 2.4, 0, 1) * 511, np.clip((a + 1.2) / 2.4, 0, 1) * 511], order=1)

    def rag(a, b):
        return 0.12 * (samp(tex_r, a, b) - 0.5)

    def surf(a, b):
        return samp(tex_s, a, b)

    for i in range(k):
        if i in missing:
            continue
        c = pts[i]
        cs, sn = np.cos(rots[i]), np.sin(rots[i])
        dx = U - c[0] - offs[i, 0]
        dy = V - c[1] - offs[i, 1]
        u = c[0] + dx * cs + dy * sn  # back to where this bit of rock was before the break
        v = c[1] - dx * sn + dy * cs
        d = np.sqrt(u * u + v * v)
        D = np.stack([np.hypot(u - sx, v - sy) + rag(u + j * 0.37, v - j * 0.23) for j, (sx, sy) in enumerate(pts)])
        idx = np.argmin(D, 0)
        srt = np.sort(D, 0)
        margin = srt[1] - srt[0]
        nz = np.sqrt(np.clip(1 - d * d, 0, 1))
        lam = np.clip(u * L[0] + v * L[1] + nz * L[2], 0, 1)
        shade = lam * (0.45 + 0.55 * nz ** 0.3) * (0.8 + 0.4 * (surf(u, v) - 0.5))
        a_ = (idx == i) * np.clip((1 - d) * pxw, 0, 1) * np.clip((margin - gap) * pxw, 0, 1)
        rgb = np.asarray(col)[None, None, :] * shade[..., None] + 0.008
        edge = np.exp(-((margin - gap) / 0.05) ** 2) * 0.35 * (d < 1)  # hot fracture faces
        rgb = rgb + edge[..., None] * np.asarray(core)
        over(img, sl, a_, rgb)
    return pts, offs


def station(img, cx, cy, R, ang, tilt, seed, L, col, gap=(0.5, 1.15)):
    sl, x, y = crop(cx, cy, R * 1.2)
    u = (x - cx) / R
    v = (y - cy) / R
    p, q = rot(u, v, ang)
    qq = q / tilt
    rho = np.sqrt(p * p + qq * qq)
    th = np.arctan2(qq, p)
    L = light(L)
    n = fbm(seed, u.shape, 6, 6)
    pxw = R / PX * tilt  # conservative px scale for antialiasing

    def tube_shade(s, dirx, diry):
        # s in -1..1 across the tube; dir = radial direction in image space
        nrm = np.sqrt(np.clip(1 - s * s, 0, 1))
        return np.clip(0.25 + 0.75 * (s * (dirx * L[0] + diry * L[1]) + nrm * L[2]), 0, 1)

    # rim (with a broken section whose edges are ragged)
    tw = 0.1
    s = (rho - 1) / tw
    rdx, rdy = unrot(np.cos(th), np.sin(th) * tilt, ang)
    nrm = np.sqrt(rdx ** 2 + rdy ** 2) + 1e-4
    rdx, rdy = rdx / nrm, rdy / nrm
    rag = 0.12 * (n - 0.5)
    g0, g1 = gap
    broken = ((th > g0 + rag) & (th < g1 - rag)).astype(np.float32)
    panels = 0.8 + 0.2 * np.sign(np.sin(th * 46)) * sstep(0.6, 0.9, 1 - np.abs(s))
    rim_a = np.clip((1 - np.abs(s)) * tw * pxw, 0, 1) * (1 - broken)
    rim_rgb = np.asarray(col)[None, None, :] * (tube_shade(s, rdx, rdy) * panels * (0.85 + 0.3 * (n - 0.5)))[..., None]

    # spokes + hub
    spoke_a = np.zeros_like(u)
    spoke_rgb = np.zeros(u.shape + (3,), np.float32)
    for k, phi in enumerate((0.3, 0.3 + 2.094, 0.3 + 4.189)):
        along = rho * np.cos(th - phi)
        across = rho * np.sin(th - phi)
        reach = 0.62 if k == 1 else 0.93  # one spoke snapped off
        sw = 0.05
        sa = np.clip((1 - np.abs(across) / sw) * sw * pxw, 0, 1) * sstep(0.1, 0.14, along) * sstep(reach, reach - 0.03, along)
        ddx, ddy = unrot(-np.sin(phi) * np.ones_like(u), np.cos(phi) * tilt * np.ones_like(u), ang)
        dn = np.sqrt(ddx ** 2 + ddy ** 2) + 1e-4
        sr = tube_shade(np.clip(across / sw, -1, 1), ddx / dn, ddy / dn)
        spoke_rgb = spoke_rgb * (1 - sa[..., None]) + np.asarray(col) * (sr * 0.85)[..., None] * sa[..., None]
        spoke_a = np.maximum(spoke_a, sa)
    hub_r = 0.17
    hd = rho / hub_r
    hz = np.sqrt(np.clip(1 - hd * hd, 0, 1))
    hl = np.clip(0.2 + 0.8 * (u / (hub_r) * L[0] + v / (hub_r) * L[1] + hz * L[2]) * 0.6 + 0.3 * hz, 0, 1)
    hub_a = np.clip((1 - hd) * hub_r * pxw, 0, 1)
    hub_rgb = np.asarray(col)[None, None, :] * (hl * (0.9 + 0.2 * (n - 0.5)))[..., None]

    back = (qq < 0).astype(np.float32)
    over(img, sl, rim_a * back, rim_rgb)
    over(img, sl, spoke_a, spoke_rgb)
    over(img, sl, hub_a, hub_rgb)
    over(img, sl, rim_a * (1 - back), rim_rgb)
    # wreckage drifting out of the break
    rr = np.random.default_rng(seed)
    gm = (g0 + g1) / 2
    for i in range(9):
        t = gm + rr.uniform(-0.35, 0.35)
        rd = 1 + rr.normal(0, 0.06) + rr.uniform(0, 0.25)
        pp, qp = rd * np.cos(t), rd * np.sin(t) * tilt
        ux, vy = unrot(pp, qp, ang)
        rock(img, cx + ux * R, cy + vy * R, R * rr.uniform(0.025, 0.06), L, np.asarray(col) * 0.9, seed + 50 + i)


def ember(img, cx, cy, R, seed, col, bright=0.7):
    sl, x, y = crop(cx, cy, R * 2.8)
    u = (x - cx) / R
    v = (y - cy) / R
    d = np.sqrt(u * u + v * v)
    n = fbm(seed, u.shape, 10, 7, 0.6)
    n2 = fbm(seed + 1, u.shape, 3, 5)
    nz = np.sqrt(np.clip(1 - d * d, 0, 1))
    disc = (0.3 + 0.7 * nz ** 0.7) * (0.72 + 0.56 * (n - 0.5))
    a = np.clip((1 - d) * R / PX, 0, 1)
    corona = np.exp(-np.clip(d - 1, 0, None) / 0.45) * 0.28 * (0.6 + 0.7 * n2) * (1 - a)
    add(img, sl, corona * bright, col)
    over(img, sl, a, np.asarray(col)[None, None, :] * (disc * bright)[..., None])


def shell(img, cx, cy, R, seed, colA, colB, bright=0.6, arc=(0.0, 4.6)):
    sl, x, y = crop(cx, cy, R * 1.35)
    u = (x - cx) / R
    v = (y - cy) / R
    n = fbm(seed, u.shape, 3, 6)
    n2 = warp(fbm(seed + 1, u.shape, 4, 7, 0.55), (n - 0.5) * 40, (n - 0.5) * 40)
    n3 = fbm(seed + 2, u.shape, 6, 6, 0.55)
    th = np.arctan2(v, u)
    rho = np.sqrt(u * u + v * v) * (1 + 0.28 * (n - 0.5))
    ridge = (1 - np.abs(2 * n2 - 1)) ** 4
    ridge2 = (1 - np.abs(2 * n3 - 1)) ** 6
    sh = np.exp(-((rho - 0.85) / 0.17) ** 2)
    a0, a1 = arc
    t = (th - a0) % (2 * np.pi)
    win = sstep(0, 0.6, t) * sstep(a1 - a0, a1 - a0 - 0.6, t)
    f = sh * win * (0.3 + 0.9 * ridge + 0.5 * ridge2) * (0.6 + 0.6 * n)
    m = sstep(0.7, 1.0, rho)[..., None]
    col = np.asarray(colA)[None, None, :] * (1 - m) + np.asarray(colB)[None, None, :] * m
    img[sl] += (f * bright)[..., None] * col
    inner = np.exp(-(rho / 0.7) ** 2) * 0.08 * n * win
    add(img, sl, inner * bright, colA)


def pillars(img, cx, cy, R, ang, seed, glowc, bright=0.6):
    """dark dust columns rising out of a cloud bank, rim-lit by a glow behind them; pillars point to -q"""
    sl, x, y = crop(cx, cy, R * 1.5)
    u = (x - cx) / R
    v = (y - cy) / R
    p, q = rot(u, v, ang)
    n = fbm(seed, u.shape, 4, 7, 0.6)
    n2 = fbm(seed + 1, u.shape, 6, 6, 0.6)
    glow = np.exp(-((p / 0.8) ** 2 + ((q + 0.1) / 0.65) ** 2) * 2.0) * (0.4 + 0.9 * n) * sstep(1.45, 1.1, np.sqrt(u * u + v * v))
    n3 = fbm(seed + 2, u.shape, 14, 5, 0.6)
    pw = p + 0.10 * (n2 - 0.5) + 0.04 * (n3 - 0.5)
    qw = q + 0.06 * (n - 0.5) + 0.03 * (n3 - 0.5)
    dark = sstep(0.35, 0.7, qw + 0.1 * (n2 - 0.5))  # the cloud bank
    for k, (px_, top, w) in enumerate(((-0.36, -0.12, 0.15), (0.02, -0.5, 0.2), (0.38, 0.08, 0.12))):
        lean = 0.15 * (qw - 0.6) * (1 if k == 0 else -0.6)
        cxq = px_ + lean + 0.025 * np.sin(qw * 6 + k)
        t = sstep(top, 0.75, qw)
        width = w * (0.12 + 0.95 * t ** 0.6)
        body = sstep(0.0, 0.02, width - np.abs(pw - cxq)) * sstep(top - 0.01, top + 0.03, qw)
        dark = np.maximum(dark, body)
    dark = np.clip(dark * (0.9 + 0.2 * n2), 0, 1)
    sig = max(2.0, 0.015 * R / PX)
    rim = np.clip(gaussian_filter(dark, sig) - dark, 0, 1)
    tot = glow * (1 - 0.94 * dark) + rim * 2.5 * glow
    add(img, sl, tot * bright, glowc)


def fan(img, cx, cy, R, ang, spread, seed, col, bright=0.6):
    d = np.array([np.cos(ang), np.sin(ang)])
    sl, x, y = crop(cx + d[0] * R * 0.3, cy + d[1] * R * 0.3, R * 1.1)
    u = (x - cx) / R
    v = (y - cy) / R
    p, q = rot(u, v, ang)
    r = np.sqrt(p * p + q * q) + 1e-3
    th = np.arctan2(q, p)
    win = np.exp(-(th / spread) ** 2)
    rad = sstep(0.0, 0.06, r) * np.exp(-r / 0.6) * sstep(1.05, 0.75, r)
    nb = fbm(seed, (64, 700), 5, 6, 0.6)
    st = map_coordinates(nb, [np.clip(r, 0, 1) * 63, np.clip((th / spread + 2.5) / 5, 0, 1) * 699], order=1, mode="nearest")
    n = fbm(seed + 1, u.shape, 4, 7)
    f = win * rad * (0.3 + 1.1 * st ** 1.5) * (0.55 + 0.7 * n)
    add(img, sl, f * bright, col)
    star = np.exp(-(np.sqrt(u * u + v * v) / 0.05) ** 2) * 0.35 + np.exp(-(np.sqrt(u * u + v * v) / 0.15) ** 2) * 0.15
    add(img, sl, star * bright, BONE)


# ---------------- output ----------------

CAP = 0.30


def tonemap(img):
    img = np.clip(img, 0, None)
    Lm = img.max(axis=2)
    scale = np.where(Lm > 1e-6, CAP * (1 - np.exp(-Lm / CAP)) / np.maximum(Lm, 1e-6), 1.0)
    out = img * scale[..., None]
    R = np.sqrt(X * X + Y * Y)
    return out * sstep(1.0, 0.88, R)[..., None]


def export(img, path, seed=0):
    out = tonemap(img)
    chans = [np.asarray(Image.fromarray(np.ascontiguousarray(out[..., c]), "F").resize((OUT, OUT), Image.LANCZOS)) for c in range(3)]
    big = np.stack(chans, -1) * 255
    r = np.random.default_rng(seed)
    dith = (r.random((OUT, OUT), dtype=np.float32) - r.random((OUT, OUT), dtype=np.float32))[..., None] * 0.9
    big = np.clip(np.round(big + dith), 0, 255).astype(np.uint8)
    im = Image.fromarray(big, "RGB")
    im.save(path, "WEBP", quality=95, method=5)
    return out, im
