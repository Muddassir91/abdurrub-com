#!/usr/bin/env python3
"""
Parametric 3D rose -> binary STL.

Rose head only (no stem) so it sits flat on a CNC blank and machines
top-down with a 3-axis router. Coordinates are in millimetres; the model
is centred on the XY origin and rests on Z = 0 (the top face of the
finished surface is the highest point).

Run:
    python3 generate_rose.py
Outputs:
    rose.stl  (binary STL, ~30k triangles)
"""

from __future__ import annotations
import math
import struct
from pathlib import Path

# ---------- Geometry helpers ----------------------------------------------

Vec3 = tuple[float, float, float]


def vsub(a: Vec3, b: Vec3) -> Vec3:
    return (a[0] - b[0], a[1] - b[1], a[2] - b[2])


def vcross(a: Vec3, b: Vec3) -> Vec3:
    return (
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    )


def vnorm(v: Vec3) -> Vec3:
    n = math.sqrt(v[0] ** 2 + v[1] ** 2 + v[2] ** 2)
    if n == 0:
        return (0.0, 0.0, 1.0)
    return (v[0] / n, v[1] / n, v[2] / n)


def rotz(p: Vec3, a: float) -> Vec3:
    c, s = math.cos(a), math.sin(a)
    return (c * p[0] - s * p[1], s * p[0] + c * p[1], p[2])


def roty(p: Vec3, a: float) -> Vec3:
    c, s = math.cos(a), math.sin(a)
    return (c * p[0] + s * p[2], p[1], -s * p[0] + c * p[2])


def translate(p: Vec3, t: Vec3) -> Vec3:
    return (p[0] + t[0], p[1] + t[1], p[2] + t[2])


# ---------- Petal surface --------------------------------------------------

def petal_point(u: float, v: float, length: float, width: float,
                cup: float, curl: float, twist: float) -> Vec3:
    """
    A single petal as a parametric surface.

    u in [0,1] : base -> tip along the petal
    v in [-1,1]: across the petal width

    Returns a point in the petal-local frame
    (x along length, y across, z up at the cup).
    """
    # Tear-drop width profile: 0 at base, peak ~u=0.55, narrowing to tip.
    width_factor = (4.0 * u * (1.0 - u)) ** 0.6
    x = u * length
    y = v * width * width_factor

    # Cup (concavity) across the width, deeper toward tip.
    z_cup = cup * (u ** 0.5) * (v ** 2)

    # Soft wave at the petal edge (frilly look).
    z_cup += 0.12 * cup * math.sin(2.0 * math.pi * v) * (u ** 1.4)

    # Curl: rotate the petal forward around its base axis as u grows
    # (so the tip leans inward / upward).
    a = curl * (u ** 1.2)
    cos_a, sin_a = math.cos(a), math.sin(a)
    x_c = x * cos_a - z_cup * sin_a
    z_c = x * sin_a + z_cup * cos_a

    # Twist: small rotation around the petal's long axis to add asymmetry.
    t = twist * u
    cos_t, sin_t = math.cos(t), math.sin(t)
    y_t = y * cos_t - z_c * sin_t
    z_t = y * sin_t + z_c * cos_t

    return (x_c, y_t, z_t)


def make_petal(length: float, width: float, cup: float, curl: float,
               twist: float, base_offset: float, layer_z: float,
               yaw: float, tilt: float,
               nu: int = 24, nv: int = 16) -> list[tuple[Vec3, Vec3, Vec3]]:
    """
    Build a closed petal (top + bottom skin, sealed at the rim) and place it
    in the flower.  Returns a list of triangles.
    """
    # Sample top surface.
    top: list[list[Vec3]] = []
    for i in range(nu + 1):
        u = i / nu
        row: list[Vec3] = []
        for j in range(nv + 1):
            v = -1.0 + 2.0 * j / nv
            p = petal_point(u, v, length, width, cup, curl, twist)
            # Offset along petal length so the petal grows from the bud,
            # not from the dead centre.
            p = (p[0] + base_offset, p[1], p[2])
            # Tilt the whole petal back (open the flower).
            p = roty(p, tilt)
            # Yaw around the flower axis.
            p = rotz(p, yaw)
            # Lift to the layer's vertical position.
            p = translate(p, (0.0, 0.0, layer_z))
            row.append(p)
        top.append(row)

    # Bottom surface = top mirrored downward in the petal-local frame.
    # Easiest correct way: regenerate with a small negative thickness.
    thickness = 0.6  # mm
    bottom: list[list[Vec3]] = []
    for i in range(nu + 1):
        u = i / nu
        row: list[Vec3] = []
        for j in range(nv + 1):
            v = -1.0 + 2.0 * j / nv
            p = petal_point(u, v, length, width, cup, curl, twist)
            # push down in petal-local Z to give the petal real thickness.
            p = (p[0] + base_offset, p[1], p[2] - thickness)
            p = roty(p, tilt)
            p = rotz(p, yaw)
            p = translate(p, (0.0, 0.0, layer_z))
            row.append(p)
        bottom.append(row)

    tris: list[tuple[Vec3, Vec3, Vec3]] = []

    # Top skin (CCW when viewed from above the petal).
    for i in range(nu):
        for j in range(nv):
            a = top[i][j]
            b = top[i + 1][j]
            c = top[i + 1][j + 1]
            d = top[i][j + 1]
            tris.append((a, b, c))
            tris.append((a, c, d))

    # Bottom skin (reversed winding so normals point down).
    for i in range(nu):
        for j in range(nv):
            a = bottom[i][j]
            b = bottom[i + 1][j]
            c = bottom[i + 1][j + 1]
            d = bottom[i][j + 1]
            tris.append((a, c, b))
            tris.append((a, d, c))

    # Side rim: stitch top and bottom along all four boundary edges.
    def stitch(top_edge: list[Vec3], bot_edge: list[Vec3], flip: bool) -> None:
        for k in range(len(top_edge) - 1):
            a, b = top_edge[k], top_edge[k + 1]
            c, d = bot_edge[k + 1], bot_edge[k]
            if flip:
                tris.append((a, b, c))
                tris.append((a, c, d))
            else:
                tris.append((a, c, b))
                tris.append((a, d, c))

    stitch([top[0][j] for j in range(nv + 1)],
           [bottom[0][j] for j in range(nv + 1)], flip=False)
    stitch([top[nu][j] for j in range(nv + 1)],
           [bottom[nu][j] for j in range(nv + 1)], flip=True)
    stitch([top[i][0] for i in range(nu + 1)],
           [bottom[i][0] for i in range(nu + 1)], flip=True)
    stitch([top[i][nv] for i in range(nu + 1)],
           [bottom[i][nv] for i in range(nu + 1)], flip=False)

    return tris


# ---------- Bud (closed sphere-ish core) -----------------------------------

def make_bud(radius: float, z_center: float,
             nu: int = 24, nv: int = 16) -> list[tuple[Vec3, Vec3, Vec3]]:
    """A slightly squashed sphere that fills the flower's centre."""
    tris: list[tuple[Vec3, Vec3, Vec3]] = []
    grid: list[list[Vec3]] = []
    for i in range(nu + 1):
        phi = math.pi * i / nu          # 0..pi
        row: list[Vec3] = []
        for j in range(nv + 1):
            theta = 2.0 * math.pi * j / nv
            x = radius * math.sin(phi) * math.cos(theta)
            y = radius * math.sin(phi) * math.sin(theta)
            z = radius * 1.15 * math.cos(phi)  # slightly tall
            row.append((x, y, z + z_center))
        grid.append(row)
    for i in range(nu):
        for j in range(nv):
            a = grid[i][j]
            b = grid[i + 1][j]
            c = grid[i + 1][j + 1]
            d = grid[i][j + 1]
            tris.append((a, b, c))
            tris.append((a, c, d))
    return tris


# ---------- Disk base (gives the model a flat machinable underside) --------

def make_base(radius: float, z: float = 0.0,
              segments: int = 64) -> list[tuple[Vec3, Vec3, Vec3]]:
    """Flat circular disk at z=0 acting as the foot of the rose."""
    tris: list[tuple[Vec3, Vec3, Vec3]] = []
    centre = (0.0, 0.0, z)
    for k in range(segments):
        a1 = 2.0 * math.pi * k / segments
        a2 = 2.0 * math.pi * (k + 1) / segments
        p1 = (radius * math.cos(a1), radius * math.sin(a1), z)
        p2 = (radius * math.cos(a2), radius * math.sin(a2), z)
        # Wind so normal points down (-Z) — it's the bottom of the part.
        tris.append((centre, p2, p1))
    return tris


# ---------- Whole rose -----------------------------------------------------

def build_rose() -> list[tuple[Vec3, Vec3, Vec3]]:
    tris: list[tuple[Vec3, Vec3, Vec3]] = []

    # Layer recipe: outer petals open and slightly drooping, inner petals
    # tighter and more vertical, ending at a closed bud.
    layers = [
        # (n_petals, length, width, cup,  curl, twist, base_off, z, tilt, yaw0)
        (7, 28.0, 14.0, 4.5, 0.55, 0.10,  6.0,  4.0,  0.55, 0.0),
        (6, 22.0, 12.0, 5.0, 0.85, 0.15,  4.5,  7.0,  0.35, 0.45),
        (5, 17.0, 10.0, 5.5, 1.15, 0.20,  3.5, 10.0,  0.15, 0.90),
        (4, 12.0,  8.0, 5.5, 1.45, 0.25,  2.5, 12.5, -0.05, 1.30),
        (3,  8.0,  6.0, 5.0, 1.70, 0.30,  1.5, 14.5, -0.20, 1.70),
    ]

    for (n, L, W, cup, curl, tw, off, z, tilt, yaw0) in layers:
        for k in range(n):
            yaw = yaw0 + 2.0 * math.pi * k / n
            tris.extend(
                make_petal(
                    length=L, width=W, cup=cup, curl=curl, twist=tw,
                    base_offset=off, layer_z=z, yaw=yaw, tilt=tilt,
                    nu=22, nv=14,
                )
            )

    # Centre bud, sized to fill the gap at the top of the flower.
    tris.extend(make_bud(radius=4.5, z_center=15.5, nu=20, nv=18))

    # Flat foot disk — defines the bottom of the part for the CNC.
    # Radius slightly larger than the outer petal reach so the rim is solid.
    tris.extend(make_base(radius=36.0, z=0.0, segments=96))

    return tris


# ---------- Binary STL writer ---------------------------------------------

def write_binary_stl(path: Path, triangles: list[tuple[Vec3, Vec3, Vec3]]) -> None:
    with path.open("wb") as f:
        header = b"parametric rose - generated by generate_rose.py"
        f.write(header.ljust(80, b"\0"))
        f.write(struct.pack("<I", len(triangles)))
        for (a, b, c) in triangles:
            n = vnorm(vcross(vsub(b, a), vsub(c, a)))
            f.write(struct.pack("<fff", *n))
            f.write(struct.pack("<fff", *a))
            f.write(struct.pack("<fff", *b))
            f.write(struct.pack("<fff", *c))
            f.write(struct.pack("<H", 0))


def main() -> None:
    out = Path(__file__).resolve().parent / "rose.stl"
    tris = build_rose()

    # Shift the whole model up so its lowest point is exactly Z = 0.
    # That makes the flat disk the true bottom of the part — the face that
    # sits on the spoilboard / inside the stock.
    min_z = min(v[2] for tri in tris for v in tri)
    if min_z != 0.0:
        dz = -min_z
        tris = [tuple((p[0], p[1], p[2] + dz) for p in tri) for tri in tris]

    write_binary_stl(out, tris)

    # Quick stats for the operator.
    xs = [v[0] for tri in tris for v in tri]
    ys = [v[1] for tri in tris for v in tri]
    zs = [v[2] for tri in tris for v in tri]
    print(f"Wrote {out} : {len(tris):,} triangles")
    print(f"  X: {min(xs):+7.2f} .. {max(xs):+7.2f}  ({max(xs)-min(xs):.2f} mm)")
    print(f"  Y: {min(ys):+7.2f} .. {max(ys):+7.2f}  ({max(ys)-min(ys):.2f} mm)")
    print(f"  Z: {min(zs):+7.2f} .. {max(zs):+7.2f}  ({max(zs)-min(zs):.2f} mm)")


if __name__ == "__main__":
    main()
