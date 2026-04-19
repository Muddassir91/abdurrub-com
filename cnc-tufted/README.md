# Tufted Diamond Panel - STL for CNC

Chesterfield-style tufted relief panel, parametric, CNC-ready.

## What's in the box

```
cnc-tufted/
├── tufted_panel.stl     <- the 3D model (binary STL, ~38k tri)
├── preview.html         <- self-contained viewer (STL embedded)
├── generate_tufted.py   <- source: parameters -> STL
├── build_preview.py     <- re-embeds the STL into preview.html
└── README.md            <- you are here
```

## Preview

Either:

- **Double-click `preview.html`** - the STL is embedded inside the page, so
  it works from `file://`. Internet is only needed to load three.js from the
  CDN.
- Or serve over HTTP:
  `cd cnc-tufted && python3 -m http.server 8000`
  -> <http://localhost:8000/preview.html>
- Or drag `tufted_panel.stl` into any STL viewer (PrusaSlicer, Bambu Studio,
  MeshLab, Fusion 360, Windows 3D Viewer, <https://www.viewstl.com/>).

## What the STL guarantees (CNC-ready)

| | |
|---|---|
| Units | **millimetres** |
| Dimensions | **120 (X) &times; 150 (Y) &times; 12 (Z) mm** |
| Back face | Flat at **Z = 0** (face that sits on your spoilboard) |
| Top rim | Flat at Z = 12 mm (6 mm wide border) |
| Topology | **Watertight manifold** - verified, every edge shared by exactly 2 triangles |
| Normals | All outward-facing |
| Overhangs | None - pure height-field, cuttable with any 3-axis router |
| Triangles | ~38,000 (fine enough for a 3 mm ball-nose finish) |

## Cutting it

Bring `tufted_panel.stl` into your CAM (Fusion 360, VCarve, Vectric, MeshCAM,
Aspire, Carveco) and post G-code for your specific controller.

Suggested tooling for hardwood / MDF:

| Pass | Tool | Stepdown | Stepover | Feed | RPM |
|---|---|---|---|---|---|
| Rough | **6 mm flat end mill** | 2.0 mm axial DOC | 4.5 mm (75 %) | 1800 mm/min | 18,000 |
| Finish | **3 mm ball nose**     | n/a (3D surface) | 0.30 mm | 1500 mm/min | 20,000 |

Stock: a **125 &times; 155 &times; 15 mm** blank (2.5 mm margin on X/Y for
clamping + 3 mm under the deepest valley for safety).

Work origin: X0 Y0 at **bottom-left corner of the part**, Z0 on **top of stock**.
(The STL uses the same origin, so "position at origin" in your CAM is correct.)

The smallest feature is the 1.7 mm-wide starburst arm - it will render as a
soft groove under a 3 mm ball nose, which matches the look in the reference
photo. If you want sharper arms, finish with a 1.5 mm ball nose or a V-bit
restmachining pass.

## Tweaking the design

Open `generate_tufted.py` and edit the parameters at the top:

```python
PANEL_W = 120.0       # width  (X, mm)
PANEL_H = 150.0       # height (Y, mm)
PANEL_Z = 12.0        # thickness / max relief

PITCH = 18.0          # diamond vertex-to-vertex spacing
PILLOW_HIGH = 11.8    # top of each pillow
VERTEX_LOW  = 3.0     # bottom of each tuft valley

BUTTON_RADIUS = 3.5   # dome radius
BUTTON_RISE   = 0.9

STAR_ARMS   = 8       # number of radial arms per star
STAR_RADIUS = 4.0
STAR_DEPTH  = 0.9
```

Then:

```bash
python3 generate_tufted.py     # re-writes tufted_panel.stl
python3 build_preview.py       # re-embeds into preview.html
```
