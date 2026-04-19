#!/usr/bin/env python3
"""
Parametric Chesterfield-style tufted diamond panel -> binary STL.

Produces a CNC-ready 3D relief panel mimicking a tufted leather/vinyl
back-rest: a rounded diamond-lattice of "pillows" with alternating button
and starburst tufts at every vertex, surrounded by a flat rectangular rim.

Key guarantees for CNC:
    * Flat rectangular base at Z = 0         (the face that sits on the spoilboard)
    * Flat outer rim at Z = PANEL_Z          (gives the operator square stock)
    * Watertight mesh                        (top + bottom + four side walls seamed)
    * Outward-pointing triangle normals      (correct for most CAM packages)
    * Units in millimetres
    * No overhangs (pure height-map surface), so any 3-axis router can cut it
      with a ball-nose finisher in one top-down pass.

Dimensions:
    X (width)   = 120 mm
    Y (height)  = 150 mm
    Z (thick)   =  12 mm           (user-requested)
"""

from __future__ import annotations
import math
import struct
from pathlib import Path

# --------------------------------------------------------------------------
# Parameters — edit then re-run the script to regenerate rose/panel.stl
# --------------------------------------------------------------------------

PANEL_W = 120.0          # X extent (mm)
PANEL_H = 150.0          # Y extent (mm)
PANEL_Z = 12.0           # total thickness (mm)  <-- user's "12 mm height"

GRID = 1.0               # heightmap sample spacing (mm)
                         # 1.0 mm gives ~38k triangles / ~1.9 MB STL and is
                         # finer than the smallest feature (star arm ~1.7 mm).
                         # Drop to 0.6 for a super-fine finish if you need it.

# Outer rim (flat border).
RIM_W = 6.0              # rim width (mm)
RIM_Z = PANEL_Z          # rim top is flush with the panel top

# Tuft lattice.
PITCH = 18.0             # vertex-to-vertex spacing in both axes (mm)
PILLOW_HIGH = PANEL_Z - 0.2   # pillow peaks at 11.8 mm (just below rim)
VERTEX_LOW = 3.0         # bottom of the "cinched" tuft valley (mm)

# Button (round tuft).
BUTTON_RADIUS = 3.5      # visible radius of the button (mm)
BUTTON_RISE = 0.9        # dome height above VERTEX_LOW (mm)

# Starburst tuft.
STAR_ARMS = 8
STAR_RADIUS = 4.0        # radial reach of the starburst pattern (mm)
STAR_DEPTH = 0.9         # max groove depth below VERTEX_LOW (mm)
STAR_ARM_WIDTH = 0.22    # angular half-width of each arm (radians fraction)

# Edge-to-interior blend (mm over which rim smooths into tufts).
BLEND_W = 8.0

OUT_PATH = Path(__file__).resolve().parent / "tufted_panel.stl"


# --------------------------------------------------------------------------
# Height-field -- continuous scalar z(x, y) on the panel top surface.
# --------------------------------------------------------------------------

def smoothstep(a: float, b: float, x: float) -> float:
    if x <= a:
        return 0.0
    if x >= b:
        return 1.0
    t = (x - a) / (b - a)
    return t * t * (3.0 - 2.0 * t)


def pillow_field(x: float, y: float) -> float:
    """
    Smooth diamond-pillow surface:  minima at every lattice vertex,
    maxima at every diamond centre, continuous everywhere.
    """
    # Lattice-normalised coordinates (integer = vertex, half-integer = centre).
    u = (x - PANEL_W / 2.0) / PITCH
    v = (y - PANEL_H / 2.0) / PITCH
    # Fractional offset from the *nearest* vertex, in mm.
    du = (u - round(u)) * PITCH
    dv = (v - round(v)) * PITCH

    # Distance from the nearest vertex, normalised so that the diamond
    # centre (at mm-distance PITCH*sqrt(2)/2 in L2, but PITCH/2 in L-infinity)
    # maps to t = 1.  Use an L-infinity-ish blend so pillow valleys align
    # with the diagonal diamond edges, not circles.
    dmax = PITCH / 2.0
    t = max(abs(du), abs(dv)) / dmax           # 0 at vertex, 1 at diamond edge
    # Then round toward a smooth bell using cosine.
    t = min(1.0, t)
    bell = 0.5 - 0.5 * math.cos(math.pi * t)    # 0 at t=0, 1 at t=1
    return VERTEX_LOW + (PILLOW_HIGH - VERTEX_LOW) * bell


def tuft_delta(x: float, y: float) -> float:
    """
    Local feature at the nearest lattice vertex:
      (i+j) even  -> round button dome  (adds +Z)
      (i+j) odd   -> starburst pit       (subtracts -Z)
    """
    u = (x - PANEL_W / 2.0) / PITCH
    v = (y - PANEL_H / 2.0) / PITCH
    i = round(u)
    j = round(v)
    du = (u - i) * PITCH
    dv = (v - j) * PITCH
    r = math.sqrt(du * du + dv * dv)

    if ((i + j) & 1) == 0:
        # Button: cosine-squared dome.
        if r >= BUTTON_RADIUS:
            return 0.0
        return BUTTON_RISE * (math.cos(math.pi * r / (2.0 * BUTTON_RADIUS)) ** 2)

    # Starburst pit.
    if r >= STAR_RADIUS:
        return 0.0
    # Central dish.
    dish = 0.35 * STAR_DEPTH * (1.0 - (r / STAR_RADIUS) ** 2)
    # Radial arms at every 2*pi/STAR_ARMS.
    angle = math.atan2(dv, du)
    a = angle * STAR_ARMS / (2.0 * math.pi)
    arm_frac = abs(a - round(a))
    # smoothstep gives a soft-edged groove so the ball nose can follow it.
    arm = max(0.0, 1.0 - smoothstep(STAR_ARM_WIDTH * 0.2,
                                    STAR_ARM_WIDTH,
                                    arm_frac))
    groove = STAR_DEPTH * arm * (1.0 - r / STAR_RADIUS)
    return -(dish + groove)


def panel_z(x: float, y: float) -> float:
    """
    Top-surface height at (x, y).  Returns a value in [0, PANEL_Z].

    Outside the panel rectangle should never be queried.
    """
    # Distance to the nearest panel edge (mm).
    edge = min(x, PANEL_W - x, y, PANEL_H - y)

    # Flat rim.
    if edge <= RIM_W:
        return RIM_Z

    # Blend from rim to tufted interior.
    interior = pillow_field(x, y) + tuft_delta(x, y)
    blend = smoothstep(RIM_W, RIM_W + BLEND_W, edge)
    z = RIM_Z * (1.0 - blend) + interior * blend

    # Safety clamp -- must never exceed stock top or drop through the base.
    if z > PANEL_Z:
        z = PANEL_Z
    if z < 0.1:
        z = 0.1
    return z


# --------------------------------------------------------------------------
# Mesh builder -- watertight prism: top height-field + flat bottom + walls.
# --------------------------------------------------------------------------

Vec3 = tuple[float, float, float]
Tri = tuple[Vec3, Vec3, Vec3]


def vsub(a: Vec3, b: Vec3) -> Vec3:
    return (a[0] - b[0], a[1] - b[1], a[2] - b[2])


def vcross(a: Vec3, b: Vec3) -> Vec3:
    return (a[1] * b[2] - a[2] * b[1],
            a[2] * b[0] - a[0] * b[2],
            a[0] * b[1] - a[1] * b[0])


def vnorm(v: Vec3) -> Vec3:
    n = math.sqrt(v[0] ** 2 + v[1] ** 2 + v[2] ** 2)
    if n == 0:
        return (0.0, 0.0, 1.0)
    return (v[0] / n, v[1] / n, v[2] / n)


def build_mesh() -> list[Tri]:
    nx = int(round(PANEL_W / GRID)) + 1
    ny = int(round(PANEL_H / GRID)) + 1
    dx = PANEL_W / (nx - 1)
    dy = PANEL_H / (ny - 1)

    # Sample the top height-field.
    grid: list[list[Vec3]] = []
    for j in range(ny):
        y = j * dy
        row: list[Vec3] = []
        for i in range(nx):
            x = i * dx
            z = panel_z(x, y)
            row.append((x, y, z))
        grid.append(row)

    tris: list[Tri] = []

    # --- Top surface (normals pointing +Z-ish).
    for j in range(ny - 1):
        for i in range(nx - 1):
            a = grid[j][i]
            b = grid[j][i + 1]
            c = grid[j + 1][i + 1]
            d = grid[j + 1][i]
            tris.append((a, b, c))
            tris.append((a, c, d))

    # --- Bottom face at Z=0 (normals pointing -Z).
    # Fan-triangulate from the panel centre, with boundary vertices placed at
    # the SAME grid spacing as the side walls -- that's what guarantees a
    # watertight seam between the walls and the floor.  Walking the boundary
    # clockwise when viewed from above produces -Z normals.
    boundary: list[Vec3] = []
    # left edge  (x=0)     going +Y
    for j in range(ny):
        boundary.append((0.0, j * dy, 0.0))
    # top edge   (y=H)     going +X  (skip first corner, already added)
    for i in range(1, nx):
        boundary.append((i * dx, PANEL_H, 0.0))
    # right edge (x=W)     going -Y
    for j in range(ny - 2, -1, -1):
        boundary.append((PANEL_W, j * dy, 0.0))
    # bottom edge(y=0)     going -X  (skip last corner, already wraps)
    for i in range(nx - 2, 0, -1):
        boundary.append((i * dx, 0.0, 0.0))

    centre = (PANEL_W / 2.0, PANEL_H / 2.0, 0.0)
    n = len(boundary)
    for k in range(n):
        p1 = boundary[k]
        p2 = boundary[(k + 1) % n]
        tris.append((centre, p1, p2))

    # --- Side walls.  Quad per grid segment along each edge:
    # top edge vertex -> next top edge vertex -> matching corner on the base.

    # y = 0 wall  (normal -Y): walk along +X.
    for i in range(nx - 1):
        t1 = grid[0][i]
        t2 = grid[0][i + 1]
        b1p = (t1[0], 0.0, 0.0)
        b2p = (t2[0], 0.0, 0.0)
        tris.append((t1, b1p, t2))
        tris.append((t2, b1p, b2p))

    # y = PANEL_H wall (normal +Y): walk along +X, but wind reversed.
    for i in range(nx - 1):
        t1 = grid[ny - 1][i]
        t2 = grid[ny - 1][i + 1]
        b1p = (t1[0], PANEL_H, 0.0)
        b2p = (t2[0], PANEL_H, 0.0)
        tris.append((t1, t2, b1p))
        tris.append((t2, b2p, b1p))

    # x = 0 wall (normal -X): walk along +Y.
    for j in range(ny - 1):
        t1 = grid[j][0]
        t2 = grid[j + 1][0]
        b1p = (0.0, t1[1], 0.0)
        b2p = (0.0, t2[1], 0.0)
        tris.append((t1, t2, b1p))
        tris.append((t2, b2p, b1p))

    # x = PANEL_W wall (normal +X): walk along +Y, reversed.
    for j in range(ny - 1):
        t1 = grid[j][nx - 1]
        t2 = grid[j + 1][nx - 1]
        b1p = (PANEL_W, t1[1], 0.0)
        b2p = (PANEL_W, t2[1], 0.0)
        tris.append((t1, b1p, t2))
        tris.append((t2, b1p, b2p))

    return tris


# --------------------------------------------------------------------------
# Binary STL writer.
# --------------------------------------------------------------------------

def write_binary_stl(path: Path, tris: list[Tri]) -> None:
    with path.open("wb") as f:
        header = b"tufted panel - generate_tufted.py"
        f.write(header.ljust(80, b"\0"))
        f.write(struct.pack("<I", len(tris)))
        for (a, b, c) in tris:
            n = vnorm(vcross(vsub(b, a), vsub(c, a)))
            f.write(struct.pack("<fff", *n))
            f.write(struct.pack("<fff", *a))
            f.write(struct.pack("<fff", *b))
            f.write(struct.pack("<fff", *c))
            f.write(struct.pack("<H", 0))


# --------------------------------------------------------------------------
# Mesh self-check (edge count == 2 * triangle count / 3 * 2 for closed meshes).
# --------------------------------------------------------------------------

def check_watertight(tris: list[Tri]) -> None:
    edges: dict[tuple, int] = {}
    for (a, b, c) in tris:
        for (p, q) in ((a, b), (b, c), (c, a)):
            key = tuple(sorted((tuple(round(v, 4) for v in p),
                                tuple(round(v, 4) for v in q))))
            edges[key] = edges.get(key, 0) + 1
    odd = [k for k, v in edges.items() if v != 2]
    if odd:
        print(f"  WARN: {len(odd)} non-manifold edges")
    else:
        print(f"  watertight OK  ({len(edges)} shared edges, all count=2)")


def main() -> None:
    print(f"Panel: {PANEL_W} x {PANEL_H} x {PANEL_Z} mm  grid={GRID} mm")
    tris = build_mesh()
    write_binary_stl(OUT_PATH, tris)

    xs = [v[0] for t in tris for v in t]
    ys = [v[1] for t in tris for v in t]
    zs = [v[2] for t in tris for v in t]
    size = OUT_PATH.stat().st_size
    print(f"Wrote {OUT_PATH.name}  ({len(tris):,} tri, {size/1024:.1f} KB)")
    print(f"  X: {min(xs):+7.2f} .. {max(xs):+7.2f} mm")
    print(f"  Y: {min(ys):+7.2f} .. {max(ys):+7.2f} mm")
    print(f"  Z: {min(zs):+7.2f} .. {max(zs):+7.2f} mm")
    check_watertight(tris)


if __name__ == "__main__":
    main()
