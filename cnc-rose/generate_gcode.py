#!/usr/bin/env python3
"""
STL -> G-code (roughing + finishing) for a 3-axis CNC router.

Produces two grbl/Mach3-flavoured RS274 programs:

    rose_roughing.nc   — 6 mm flat end mill, Z-stepdown raster.
    rose_finishing.nc  — 3 mm ball-nose, surface-following raster.

Conventions (the operator MUST match these on the machine):
    Units      : millimetres
    Work zero  : top-centre of the stock     (X0 Y0 at centre, Z0 on top)
    Cutting    : into negative Z (down into the wood)
    Stock      : 100 x 100 x 40 mm rectangular blank
    Machinable : a 76 x 76 mm square inside the stock (12 mm clamping rim)
    Bottom     : the rose's flat disk base sits 30.54 mm below Z0 (the stock top)

Read the setup_sheet.md file before running.  Always air-cut first.
"""

from __future__ import annotations
import math
import struct
import time
from pathlib import Path

# --------------------------------------------------------------------------
# CONFIG  — change here, regenerate, re-verify in your CAM/sender of choice.
# --------------------------------------------------------------------------

HERE = Path(__file__).resolve().parent
STL_PATH = HERE / "rose.stl"

# Stock blank.
STOCK_X = 100.0
STOCK_Y = 100.0
STOCK_Z = 40.0

# Machinable window (centred on the stock; outer rim is the clamping zone).
MACHINE_X = 76.0
MACHINE_Y = 76.0

# Heightmap sampling resolution (smaller = better surface, slower & bigger NC).
GRID = 0.5  # mm

# Safety / clearance.
SAFE_Z = 8.0          # rapid height above stock (mm above Z0)
PLUNGE_CLEARANCE = 1.5 # mm above current cell before plunging

# Roughing tool — 6 mm flat end mill, 2-flute, hardwood.
ROUGH = {
    "tool": 1,
    "diameter": 6.0,
    "stepdown": 2.0,        # axial DOC per pass (mm)
    "stepover": 4.5,        # 75% of diameter for raster
    "stock_to_leave": 0.5,  # mm left on the surface for finishing
    "feed_xy": 1800.0,      # mm/min
    "feed_z": 600.0,        # mm/min plunge
    "rpm": 18000,
}

# Finishing tool — 3 mm ball nose, 2-flute, hardwood.
FINISH = {
    "tool": 2,
    "diameter": 3.0,        # ball diameter
    "stepover": 0.35,       # raster pitch (mm) — ~5% scallop on hardwood
    "feed_xy": 1500.0,      # mm/min
    "feed_z": 400.0,        # mm/min plunge
    "rpm": 20000,
}

# --------------------------------------------------------------------------
# STL reader (binary).
# --------------------------------------------------------------------------

def read_binary_stl(path: Path):
    with path.open("rb") as f:
        f.read(80)
        (n,) = struct.unpack("<I", f.read(4))
        tris = []
        for _ in range(n):
            f.read(12)  # normal — recomputed when needed
            v0 = struct.unpack("<fff", f.read(12))
            v1 = struct.unpack("<fff", f.read(12))
            v2 = struct.unpack("<fff", f.read(12))
            f.read(2)
            tris.append((v0, v1, v2))
    return tris


# --------------------------------------------------------------------------
# Build the heightmap by vertical ray-casting against the mesh.
# --------------------------------------------------------------------------

def build_heightmap(tris, x_min, x_max, y_min, y_max, step):
    nx = int(round((x_max - x_min) / step)) + 1
    ny = int(round((y_max - y_min) / step)) + 1

    # Bucket triangles by XY bounding-box for fast lookup.
    bsize = max(step * 8.0, 4.0)
    bx = int(math.ceil((x_max - x_min) / bsize)) + 1
    by = int(math.ceil((y_max - y_min) / bsize)) + 1
    buckets = [[] for _ in range(bx * by)]

    def bucket_idx(ix, iy):
        return iy * bx + ix

    # Pre-compute geometry data (XY bbox, plane coefficients) for each tri.
    tri_data = []
    for (a, b, c) in tris:
        ax, ay, az = a
        bx_, by_, bz = b
        cx, cy, cz = c
        x_lo, x_hi = min(ax, bx_, cx), max(ax, bx_, cx)
        y_lo, y_hi = min(ay, by_, cy), max(ay, by_, cy)

        # Skip triangles fully outside the heightmap window.
        if x_hi < x_min or x_lo > x_max or y_hi < y_min or y_lo > y_max:
            tri_data.append(None)
            continue

        # Plane normal — used to interpolate Z at any (x,y) inside the tri.
        ux, uy, uz = bx_ - ax, by_ - ay, bz - az
        vx, vy, vz = cx - ax, cy - ay, cz - az
        nx_, ny_, nz_ = (uy * vz - uz * vy,
                         uz * vx - ux * vz,
                         ux * vy - uy * vx)
        if abs(nz_) < 1e-9:
            # Vertical triangle — does not contribute to a top-down heightmap.
            tri_data.append(None)
            continue

        # Pre-compute barycentric denominator.
        v0x, v0y = bx_ - ax, by_ - ay
        v1x, v1y = cx - ax, cy - ay
        denom = v0x * v1y - v1x * v0y
        if abs(denom) < 1e-12:
            tri_data.append(None)
            continue
        inv_denom = 1.0 / denom

        tri_data.append((ax, ay, az, v0x, v0y, v1x, v1y, inv_denom,
                         nx_, ny_, nz_))

        ix_lo = max(0, int((x_lo - x_min) / bsize))
        ix_hi = min(bx - 1, int((x_hi - x_min) / bsize))
        iy_lo = max(0, int((y_lo - y_min) / bsize))
        iy_hi = min(by - 1, int((y_hi - y_min) / bsize))
        idx = len(tri_data) - 1
        for iy in range(iy_lo, iy_hi + 1):
            for ix in range(ix_lo, ix_hi + 1):
                buckets[bucket_idx(ix, iy)].append(idx)

    # Sample the heightmap.
    hmap = [[None] * nx for _ in range(ny)]
    for j in range(ny):
        y = y_min + j * step
        iy = min(by - 1, max(0, int((y - y_min) / bsize)))
        for i in range(nx):
            x = x_min + i * step
            ix = min(bx - 1, max(0, int((x - x_min) / bsize)))
            best = None
            for tid in buckets[bucket_idx(ix, iy)]:
                td = tri_data[tid]
                if td is None:
                    continue
                (ax, ay, az, v0x, v0y, v1x, v1y, inv_denom,
                 _nx, _ny, _nz) = td
                px, py = x - ax, y - ay
                u = (px * v1y - v1x * py) * inv_denom
                v = (v0x * py - px * v0y) * inv_denom
                if u < -1e-9 or v < -1e-9 or u + v > 1.0 + 1e-9:
                    continue
                z = az + u * (v0x * 0 + v0y * 0)  # placeholder, recompute
                # Z = az + u * (bz - az) + v * (cz - az)  — simpler:
                # We didn't store bz/cz; reconstruct from plane:
                # plane: nx_*(x-ax) + ny_*(y-ay) + nz_*(z-az) = 0 ->
                #   z = az - (nx_*(x-ax) + ny_*(y-ay)) / nz_
                _nx, _ny, _nz = td[8], td[9], td[10]
                z = az - (_nx * (x - ax) + _ny * (y - ay)) / _nz
                if best is None or z > best:
                    best = z
            hmap[j][i] = best  # may be None where the model is absent

    return hmap, nx, ny


# --------------------------------------------------------------------------
# Heightmap utilities.
# --------------------------------------------------------------------------

def fill_heightmap_floor(hmap, floor_z):
    """Replace None cells (no geometry) with the model floor Z."""
    for row in hmap:
        for i, v in enumerate(row):
            if v is None:
                row[i] = floor_z


def normalise_to_machine_z(hmap, top_of_model_z):
    """Shift Z so the highest point of the model is at machine Z=0."""
    for row in hmap:
        for i in range(len(row)):
            row[i] -= top_of_model_z


def ball_nose_envelope(hmap, nx, ny, step, radius):
    """
    For each cell, compute the Z that the *centre* of a ball-nose cutter of
    given radius must occupy so that it just touches the surface anywhere
    within its footprint:
        z_centre(x,y) = max over (x',y') in disk of
                        [h(x',y') + sqrt(r^2 - (dx)^2 - (dy)^2)]
    Returns the **tool-tip** Z (centre - radius), which is what the G-code
    issues as Z commands.
    """
    rcells = int(math.ceil(radius / step))
    # Pre-build the (di, dj, lift) kernel.
    kernel = []
    for dj in range(-rcells, rcells + 1):
        for di in range(-rcells, rcells + 1):
            dx = di * step
            dy = dj * step
            r2 = radius * radius - dx * dx - dy * dy
            if r2 >= 0.0:
                kernel.append((di, dj, math.sqrt(r2)))

    out = [[0.0] * nx for _ in range(ny)]
    for j in range(ny):
        for i in range(nx):
            best = -1e9
            for (di, dj, lift) in kernel:
                ii = i + di
                jj = j + dj
                if ii < 0 or ii >= nx or jj < 0 or jj >= ny:
                    continue
                cand = hmap[jj][ii] + lift
                if cand > best:
                    best = cand
            out[j][i] = best - radius  # tool-tip Z
    return out


# --------------------------------------------------------------------------
# G-code helpers.
# --------------------------------------------------------------------------

def fmt(x):
    return f"{x:.3f}"


def write_header(f, name, tool, rpm, comments):
    f.write(f"( {name} )\n")
    for line in comments:
        f.write(f"( {line} )\n")
    f.write("G21\n")            # mm
    f.write("G90\n")            # absolute
    f.write("G17\n")            # XY plane
    f.write("G94\n")            # feed per minute
    f.write(f"T{tool} M6\n")    # tool change
    f.write(f"S{rpm} M3\n")     # spindle on, CW
    f.write("G54\n")            # work coordinate system 1
    f.write(f"G0 Z{fmt(SAFE_Z)}\n")
    f.write(f"G0 X0 Y0\n")


def write_footer(f):
    f.write(f"G0 Z{fmt(SAFE_Z)}\n")
    f.write("G0 X0 Y0\n")
    f.write("M5\n")
    f.write("M30\n")


# --------------------------------------------------------------------------
# Roughing program.
# --------------------------------------------------------------------------

def roughing_program(out_path, hmap, nx, ny, step, x0, y0, total_depth):
    tool_dia = ROUGH["diameter"]
    stepover = ROUGH["stepover"]
    stepdown = ROUGH["stepdown"]
    stl = ROUGH["stock_to_leave"]
    feed_xy = ROUGH["feed_xy"]
    feed_z = ROUGH["feed_z"]
    rpm = ROUGH["rpm"]

    # Layer depths (negative Z), one stepdown at a time, finishing exactly at
    # -total_depth so the disk base is reached.
    layers = []
    z = -stepdown
    while z > -total_depth:
        layers.append(z)
        z -= stepdown
    layers.append(-total_depth)

    # Raster step in cells.
    j_step = max(1, int(round(stepover / step)))

    with out_path.open("w") as f:
        write_header(
            f,
            name="ROSE — ROUGHING",
            tool=ROUGH["tool"],
            rpm=rpm,
            comments=[
                f"Tool: T{ROUGH['tool']}  flat end mill  D{tool_dia} mm",
                f"Stepdown {stepdown} mm  stepover {stepover} mm  stock-to-leave {stl} mm",
                f"Feed XY {feed_xy} mm/min  plunge {feed_z} mm/min  S{rpm}",
                f"Origin X0 Y0 = top-centre of stock; Z0 = top of stock",
                f"Machinable window {MACHINE_X} x {MACHINE_Y} mm",
            ],
        )

        for layer_z in layers:
            f.write(f"\n( --- Layer Z={fmt(layer_z)} --- )\n")
            direction = +1
            j = 0
            while j < ny:
                y = y0 + j * step
                # Walk this row left-right or right-left.
                xs = range(nx) if direction > 0 else range(nx - 1, -1, -1)

                in_cut = False
                f.write(f"G0 Z{fmt(SAFE_Z)}\n")
                for i in xs:
                    x = x0 + i * step
                    # Cut to whichever is higher: the layer floor or the
                    # surface plus stock-to-leave (so we never gouge the part).
                    surface = hmap[j][i]
                    cut_z = max(layer_z, surface + stl)
                    if cut_z >= -1e-6:
                        # Above the stock top — nothing to cut here.
                        if in_cut:
                            f.write(f"G0 Z{fmt(SAFE_Z)}\n")
                            in_cut = False
                        continue
                    if not in_cut:
                        f.write(f"G0 X{fmt(x)} Y{fmt(y)}\n")
                        f.write(f"G0 Z{fmt(cut_z + PLUNGE_CLEARANCE)}\n")
                        f.write(f"G1 Z{fmt(cut_z)} F{fmt(feed_z)}\n")
                        f.write(f"G1 F{fmt(feed_xy)}\n")
                        in_cut = True
                    else:
                        f.write(f"G1 X{fmt(x)} Y{fmt(y)} Z{fmt(cut_z)}\n")

                if in_cut:
                    f.write(f"G0 Z{fmt(SAFE_Z)}\n")
                direction = -direction
                j += j_step

        write_footer(f)


# --------------------------------------------------------------------------
# Finishing program.
# --------------------------------------------------------------------------

def finishing_program(out_path, hmap_tip, nx, ny, step, x0, y0):
    tool_dia = FINISH["diameter"]
    stepover = FINISH["stepover"]
    feed_xy = FINISH["feed_xy"]
    feed_z = FINISH["feed_z"]
    rpm = FINISH["rpm"]

    j_step = max(1, int(round(stepover / step)))

    with out_path.open("w") as f:
        write_header(
            f,
            name="ROSE — FINISHING",
            tool=FINISH["tool"],
            rpm=rpm,
            comments=[
                f"Tool: T{FINISH['tool']}  ball nose  D{tool_dia} mm  (radius {tool_dia/2} mm)",
                f"Raster stepover {stepover} mm  feed {feed_xy} mm/min  S{rpm}",
                f"Heightmap is ball-nose-compensated; G-code Z = tool tip.",
                f"Origin X0 Y0 = top-centre of stock; Z0 = top of stock",
            ],
        )

        direction = +1
        j = 0
        while j < ny:
            y = y0 + j * step
            xs = list(range(nx)) if direction > 0 else list(range(nx - 1, -1, -1))

            # Skip the row entirely if every cell sits above the stock surface
            # (i.e. we would be cutting air).
            if all(hmap_tip[j][i] >= -1e-6 for i in xs):
                direction = -direction
                j += j_step
                continue

            f.write(f"\n( row Y={fmt(y)} )\n")
            f.write(f"G0 Z{fmt(SAFE_Z)}\n")

            # Find the first cell in this row where Z is below the stock top.
            i_start = None
            for i in xs:
                if hmap_tip[j][i] < -1e-6:
                    i_start = i
                    break
            if i_start is None:
                direction = -direction
                j += j_step
                continue

            x = x0 + i_start * step
            f.write(f"G0 X{fmt(x)} Y{fmt(y)}\n")
            z0 = hmap_tip[j][i_start]
            f.write(f"G0 Z{fmt(z0 + PLUNGE_CLEARANCE)}\n")
            f.write(f"G1 Z{fmt(z0)} F{fmt(feed_z)}\n")
            f.write(f"G1 F{fmt(feed_xy)}\n")

            for i in xs:
                x = x0 + i * step
                z = hmap_tip[j][i]
                if z >= 0.0:
                    z = 0.0  # never above the stock top
                f.write(f"G1 X{fmt(x)} Y{fmt(y)} Z{fmt(z)}\n")

            f.write(f"G0 Z{fmt(SAFE_Z)}\n")
            direction = -direction
            j += j_step

        write_footer(f)


# --------------------------------------------------------------------------
# Main.
# --------------------------------------------------------------------------

def main():
    print(f"Reading {STL_PATH.name} ...")
    tris = read_binary_stl(STL_PATH)
    print(f"  {len(tris):,} triangles")

    # Heightmap window: machinable square centred on the work origin.
    x_min = -MACHINE_X / 2.0
    x_max = +MACHINE_X / 2.0
    y_min = -MACHINE_Y / 2.0
    y_max = +MACHINE_Y / 2.0

    print(f"Building heightmap at {GRID} mm grid over "
          f"{MACHINE_X} x {MACHINE_Y} mm ...")
    t0 = time.time()
    hmap, nx, ny = build_heightmap(tris, x_min, x_max, y_min, y_max, GRID)
    print(f"  {nx} x {ny} cells in {time.time()-t0:.1f}s")

    # Determine model Z extents from the sampled heightmap.
    sampled = [v for row in hmap for v in row if v is not None]
    model_top = max(sampled)
    model_bot = min(sampled)
    print(f"  model Z range: {model_bot:.3f} .. {model_top:.3f} mm "
          f"(height {model_top-model_bot:.3f} mm)")

    # Cells with no geometry = the floor of the part (the disk base).
    fill_heightmap_floor(hmap, model_bot)

    # Shift so the model's highest point is at machine Z = 0
    # (all toolpath Z values become <= 0).
    normalise_to_machine_z(hmap, model_top)
    total_depth = model_top - model_bot

    # ---------------- Roughing ----------------
    rough_path = HERE / "rose_roughing.nc"
    print(f"Writing {rough_path.name} ...")
    roughing_program(rough_path, hmap, nx, ny, GRID, x_min, y_min, total_depth)
    print(f"  {rough_path.stat().st_size/1024:.1f} KB")

    # ---------------- Finishing ----------------
    print("Computing ball-nose envelope ...")
    t0 = time.time()
    hmap_tip = ball_nose_envelope(
        hmap, nx, ny, GRID, radius=FINISH["diameter"] / 2.0
    )
    print(f"  done in {time.time()-t0:.1f}s")

    finish_path = HERE / "rose_finishing.nc"
    print(f"Writing {finish_path.name} ...")
    finishing_program(finish_path, hmap_tip, nx, ny, GRID, x_min, y_min)
    print(f"  {finish_path.stat().st_size/1024:.1f} KB")

    print("\nDone.")
    print(f"  Total cut depth from stock top : {total_depth:.2f} mm")
    print(f"  Stock required (Z)             : >= {total_depth + 8:.1f} mm "
          "(includes spoilboard clearance)")


if __name__ == "__main__":
    main()
