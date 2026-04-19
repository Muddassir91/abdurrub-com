# CNC Setup Sheet — 3D Rose

Everything the operator needs to load a wooden blank, zero the machine, and
run the two G-code programs in this folder.

---

## 1. Part summary

| | |
|---|---|
| Part | Parametric 3D rose (head only) |
| Source model | `rose.stl` (binary STL, 35 k triangles) |
| Part footprint | 72 × 72 mm |
| Part height (Z) | 26.30 mm above the disk base |
| Material | Hardwood (cherry, walnut, hard maple). Avoid soft pine — the petal tips will tear out. |
| Machine | 3-axis CNC router with at least 200 × 200 × 80 mm travel |

---

## 2. Stock

| | |
|---|---|
| Size | **100 × 100 × 40 mm** |
| Grain | Long grain along **Y** (helps petal-tip strength) |
| Surface prep | Faces planed flat & parallel; top face scuffed with 180-grit so it shows pencil marks |

The machinable area is a 76 × 76 mm square centred on the stock. The outer
**12 mm rim** is left untouched and is the clamping zone.

---

## 3. Workholding

Choose **one** of:

1. **Four-corner toe clamps** sitting on the 12 mm rim. Set the clamp screws so
   the clamp pads are at least 5 mm clear of the machinable square.
2. **Double-sided carpet tape** + a perimeter bead of hot-glue on the bottom face.
   Recommended for hardwood ≤ 80 mm square. Press for 60 s under a flat caul.
3. **Vacuum table** with a 90 × 90 mm gasket — works if you have one.

The bottom face of the rose disk ends **30.30 mm below the stock top**, so the
cutter never reaches the spoilboard. There are **9.7 mm of stock left under
the deepest cut** for tape/clamp adhesion.

---

## 4. Work coordinate system (G54)

| Axis | Zero position |
|---|---|
| **X0** | Geometric centre of the stock (left-right) |
| **Y0** | Geometric centre of the stock (front-back) |
| **Z0** | **Top surface** of the stock |

Z+ is up (away from the work). Cutting moves are negative Z.

### How to zero

1. Use an edge finder or a centring probe to find each X & Y stock face, then
   drive to the centre and `G92` / set G54 to X0 Y0.
2. For Z, use a paper / cigarette-paper feeler against the **top of the stock**
   with the **roughing cutter installed**. Set G54 Z0 there.
3. Repeat the Z touch-off after the tool change to the finishing cutter — the
   finishing program assumes Z0 is the stock top with the new tool already
   touched off.

---

## 5. Tools

| Slot | Tool | Diameter | Geometry | Flutes | Stick-out |
|---|---|---|---|---|---|
| **T1** | Flat end mill — roughing | 6.0 mm | flat / square end | 2 (hardwood) or up-cut | ≥ 28 mm |
| **T2** | Ball nose — finishing | 3.0 mm | full radius (1.5 mm ball) | 2 | ≥ 32 mm |

Both tools must protrude past the collet by at least the values above so the
collet body cannot collide with the part at full depth.

### Spindle & feeds (already in the G-code; tune to your machine)

| | T1 Roughing | T2 Finishing |
|---|---|---|
| RPM | 18 000 | 20 000 |
| Feed XY | 1 800 mm/min | 1 500 mm/min |
| Plunge | 600 mm/min | 400 mm/min |
| Stepdown | 2.0 mm axial | n/a (3D surface) |
| Stepover | 4.5 mm (75 %) | 0.35 mm |
| Stock-to-leave | 0.5 mm | 0 |

---

## 6. Run order

```
  1. Mount stock, square it, set X/Y/Z zeros with T1.
  2. Load and run  rose_roughing.nc      (~ 8 – 12 min, dust collection ON)
  3. Vacuum chips. Inspect — there should be a uniform 0.5 mm offset shell.
  4. Tool change to T2. Re-touch Z0 on the stock top (NOT on the part!).
  5. Load and run  rose_finishing.nc     (~ 35 – 50 min)
  6. Spindle off. Lift Z to safe.  Vacuum.
  7. Release work-holding. Pop the rose from the rim with a thin chisel along
     the disk edge. Sand the disk underside flat.
```

The first time, **air-cut** both programs: jog Z up by +30 mm with `G92 Z30`
and run the file. Confirm the spindle never tries to travel outside ±50 mm in
X or Y, and that no Z value drops below `-26.5 mm` from your offset.

---

## 7. Safety / sanity checks

- Maximum cutter Z depth in the program: **−26.30 mm**. If your sender shows
  anything more negative than `Z-27` you have the wrong file or the wrong zero.
- Max XY travel from origin: ±38 mm. Make sure your soft-limits allow it.
- The roughing program retracts to **Z+8 mm** between segments. Confirm the
  collet nut clears any clamps at that height.
- Dust collection should be running for both programs. Hardwood dust is a
  significant lung & fire hazard.
- Wear ANSI Z87 safety glasses and ear protection. Do not reach over the
  spindle while it is moving.

---

## 8. Files

| File | Purpose |
|---|---|
| `rose.stl` | The 3D model. Open in any STL viewer / slicer / CAM. |
| `preview.html` | Browser preview (three.js). Serve over `http://`. |
| `rose_roughing.nc` | T1 roughing program. |
| `rose_finishing.nc` | T2 finishing program. |
| `generate_rose.py` | Source: parametric rose → STL. Edit & re-run to change the design. |
| `generate_gcode.py` | Source: STL → roughing + finishing G-code. Re-run if you change tools, stock, or stepover. |

---

## 9. Tweaking the design

Open `generate_rose.py` and edit the `layers` recipe in `build_rose()`:

```python
layers = [
    # (n_petals, length, width, cup, curl, twist, base_off, z, tilt, yaw0)
    (7, 28.0, 14.0, 4.5, 0.55, 0.10, 6.0,  4.0,  0.55, 0.0),
    ...
]
```

- `n_petals` — count per layer.
- `length` / `width` — petal size in mm.
- `cup` — depth of the concave dish across the petal width.
- `curl` — how far the tip leans toward the bud.
- `tilt` — layer-wide tilt back from horizontal.

After editing, run:

```
python3 generate_rose.py
python3 generate_gcode.py
```

and re-run the air-cut before machining.
