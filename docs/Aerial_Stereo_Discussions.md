# Aerial Stereo Discussions
## Open Geospatial Suite — Design Notes

*Compiled from design discussions — April 2026*

---

## 1. Geospatial Projections & Reprojection Engine

### WGS84 Versions and the Vertical Datum Problem

WGS84 has been re-realized six times since 1987. Each realization shifts the origin
and axes at centimeter level. When datasets from different WGS84 realizations are
mixed without harmonization, Z offsets appear — particularly visible in high-precision
LiDAR and HD mapping work.

| Realization | Year | Notes |
|---|---|---|
| WGS84 (original) | 1987 | — |
| WGS84 (G730) | 1994 | — |
| WGS84 (G873) | 1997 | — |
| WGS84 (G1150) | 2002 | — |
| WGS84 (G1674) | 2012 | Aligns to ITRF2008 — preferred for production |
| WGS84 (G1762) | 2013 | — |
| WGS84 (G2139) | 2021 | Current GPS broadcast |

When a CRS file simply says "WGS84" it references the ensemble (EPSG:4326) and
does not specify which realization. This is the root cause of mixing problems.

### GEOID2012B — The Vertical Model

GEOID2012B is a **geoid undulation model** published by NGS (National Geodetic Survey).
It defines the separation (N) between the WGS84 ellipsoid and the geoid
(which approximates mean sea level / NAVD88).

```
Orthometric height (H) = Ellipsoidal height (h) - Geoid undulation (N)
```

**Why it matters:** GPS gives ellipsoidal heights. Ground control surveys give
orthometric (NAVD88) heights. Without applying GEOID2012B, the two systems can
differ by 10–100+ meters depending on location. Applying the model reconciles
them to centimeter-level accuracy.

**Confirmed use case:** GEOID2012B was required to correctly align ground control
points when reprojecting HD Map data. Z offsets that appeared without the model
were resolved by applying it.

**Coverage:** US territory only — CONUS, Alaska, Hawaii, Puerto Rico/USVI,
Guam/CNMI, American Samoa.

**Current equivalent:** GEOID18 (2018) supersedes GEOID2012B for new US work
and is more accurate in regions with updated gravity data. GEOID2012B supported
for backward compatibility with existing projects.

### Global Geoid Strategy

The system must operate globally. The layered accuracy model:

```
Project bounding box centroid
        ↓
US territory?
    Yes → GEOID18 (preferred) or GEOID2012B (backward compat)  ~1–2 cm accuracy
    No  → check regional models:
            Australia  → AUSGeoid2020
            Canada     → CGG2013a
            Europe     → EGG2015 / national models
            Anywhere   → EGM2008 (global baseline)  ~10–30 cm accuracy
```

**EGM2008** — Earth Gravitational Model 2008, published by NGA.
Covers the entire globe at 2.5 arc-minute resolution (~4.5 km grid).
Native PROJ support. The correct fallback for all international work.

### ECEF — The Canonical Output

ECEF (Earth-Centered, Earth-Fixed) — X, Y, Z in meters from Earth's center.

**Why ECEF is the right long-term CRS for this suite:**
- No zone boundaries (UTM zones cause problems at edges)
- No projection distortion
- CesiumJS is natively ECEF internally — no conversion needed at render time
- Once data is in ECEF, geoid/datum distinctions disappear — it's pure geometry
- The geoid correction matters when reconciling source data; once everything
  is harmonized and converted to ECEF, vertical datum is no longer a concern

**Two canonical output CRS for the suite:**
1. UTM WGS84 G1674 — for traditional GIS/survey deliverables
2. ECEF WGS84 G1674 (EPSG:7665) — for 3D visualization and global pipelines

### The Reprojection Pipeline

```
Input: Any CRS
(UTM any zone, any WGS84 realization, any vertical datum, any units — metric only)

Step 1: Horizontal normalization
    Source UTM/geographic → WGS84 G1674 geographic
    pyproj handles Helmert shifts, NTv2 grids, plate-fixed datum transforms

Step 2: Vertical normalization
    If ellipsoidal input → apply geoid model → orthometric
    If orthometric input → validate which geoid model was used
    If unknown → flag for user confirmation (cannot safely assume)
    Select model by region (hierarchy above)

Step 3: Output
    → UTM WGS84 G1674 (auto-zone from centroid, user override available)
    → OR ECEF XYZ (no datum ambiguity, native to CesiumJS)
```

**Units:** Metric only throughout. No feet (international or US survey).

### Reprojection Engine — Scope by Data Type

| Type | Tool | Difficulty | Notes |
|---|---|---|---|
| Vector (SHP, GeoJSON, GPKG) | geopandas + pyproj | Easy | One function call |
| Raster / Orthoimage (GeoTIFF) | rasterio.warp | Easy–Medium | Handles resampling |
| DEM/DSM (GeoTIFF) | rasterio.warp | Easy–Medium | Single band |
| LiDAR (LAS/LAZ) | laspy + pyproj | Medium | Chunked streaming, header rewrite |
| CAD (DXF) | ezdxf | Hard | CRS almost never embedded |
| Stereo imagery | Custom photogrammetric | Hard | See Section 2 |
| Voxelites | Format-dependent | TBD | Grid → like raster; point → like LiDAR |

**Implementation phases:**
1. Vectors + Rasters + DEMs (most common, cleanest PROJ pipeline)
2. LiDAR (highest impact, chunked processing required)
3. CAD, Voxelites, Stereo (complex edge cases)

### Architecture Position

The reprojection engine lives inside **OpenGeoLook** as a tools module.
Reprojection is a file transformation operation — it reads raw data,
writes new files, and should be tracked in the project.

OpenGlobe receives already-reprojected data and displays it.
It does not perform reprojection at load time.

The .geolook file tracks both original and reprojected file paths.
Reprojected files land in a `<project_name>_reprojected/` output directory.

---

## 2. Extent Generation — All Data Types

OpenGeoLook must auto-generate footprint polygons for all classified data types
during the scan phase. These footprints are stored in .geolook records and
rendered in OpenGlobe.

### Extent Generation by Tier

**Tier 1 — Trivial:**
- GeoTIFF / Orthoimage / DEM / DSM / Voxelite raster grids
- `rasterio.open(path).bounds` + reproject to WGS84 = rectangle polygon

**Tier 2 — Straightforward:**
- Vector / Shapefile / GeoPackage — geometry bounds / convex hull
- CAD (DXF) — geometry bounds (CRS declaration often missing — user prompt required)

**Tier 3 — Medium:**
- LiDAR / Point Cloud strips:
  - Fast: LAS/LAZ header bounds (axis-aligned box, instant)
  - Better: XY convex hull from point sample (actual strip shape)
  - Best: ABGPS/SBET trajectory + swath width from altitude and scan angle

**Tier 4 — Complex:**
- Stereo imagery — see Section 3

---

## 3. Aerial Stereo Imagery — Sensor Types & Geometry

### Three Distinct Processing Paths

#### Path A: Digital Frame Camera — Nadir

Single exposure per image. Single IO + single EO record per image.
Ground footprint is approximately rectangular, slightly distorted by terrain.
Classical collinearity equations — well understood, clean implementation.

#### Path B: Digital Frame Camera — Oblique

Same fundamental math as nadir but geometry differs significantly:

- Ground footprint is **trapezoidal** — far edge covers far more area than near edge
- Footprint is asymmetric around camera position
- Building facades are visible — ground projection (ray-ground intersection) is
  the correct representation for globe display
- 3D camera frustum is visually distinctive — tilted image plane clearly visible

**Multi-camera oblique systems** (Pictometry-style, Vexcel Osprey, Leica RCD30,
IGI PentaCam, etc.) — typically 1 nadir + 4 oblique heads (N/S/E/W or F/B/L/R),
all firing in the same epoch.

Each camera head has:
- Its own **IO calibration** (focal length, principal point, distortion)
- A **lever arm** — XYZ offset from GPS antenna to that head's optical center
- A **boresight rotation** — fixed angular offset from IMU axes to camera axes

The EO CSV typically references the **system center** (GPS antenna / IMU center).
Per-head positions are derived by applying the lever arm and boresight correction
for each camera head. If the CSV already has per-head positions baked in, this
step is skipped.

**Epoch grouping:** 5 simultaneous images share the same epoch. Naming convention
encodes this — e.g., `F_001234.tif`, `B_001234.tif`, `L_001234.tif`, `R_001234.tif`,
`N_001234.tif` where the numeric suffix is the shared epoch. The scanner groups
images by epoch for combined rendering in OpenGlobe.

#### Path C: Leica ADS Pushbroom (ADS40 / ADS80 / ADS100)

Fundamentally different from frame cameras. No discrete exposures.

- Multiple CCD line arrays scan continuously as aircraft moves forward
- ADS100: backward (~16°), nadir, forward (~28°) look angles plus spectral channels
- "Image" is a georeferenced strip reconstructed from thousands of scan lines
- Each scan line has its own EO from the IPAS continuous trajectory

**Extent generation:** Treat like a LiDAR strip, not a frame camera.
- Footprint defined by trajectory + angular field of view per line array
- Swath width computed from altitude and scan angle extent
- Forward/backward look angles produce wider along-track coverage

**3D representation in OpenGlobe:**
- Flight trajectory line
- Swept-area polygon for ground coverage
- Cross-sectional wedge showing forward/nadir/backward look angles

---

## 4. IO / EO / ABGPS — File Formats and Parsing

### Standard CSV EO Format

```
Minimal:
ImageName, X, Y, Z, Omega, Phi, Kappa

Extended (typical AT software output):
ImageName, X, Y, Z, Omega, Phi, Kappa,
Sigma_X, Sigma_Y, Sigma_Z, Sigma_Omega, Sigma_Phi, Sigma_Kappa

Multi-camera systems may add:
CameraID, Epoch, Timestamp, GPS_Week, GPS_Seconds
```

User workflow: **CSV exports with nomenclature associated with each image.**
Image filename in the CSV links geometry to file.

### Omega/Phi/Kappa Convention Variations

| Software | Notes |
|---|---|
| Inpho / MATCH-AT | Standard photogrammetric convention |
| Agisoft Metashape | Multiple export conventions — must be declared |
| Pix4D | Similar to standard, sign differences in some versions |
| Trimble / Applanix | Sometimes roll/pitch/yaw (aircraft body frame) |
| Leica IPAS | Proprietary trajectory, EO derived separately |

Parser approach: user-selectable convention with validation check
(compute sample footprint, flag if it falls outside expected area).

### IO File Discovery

Scanner heuristic:
1. Look for IO file in same directory as EO CSV
2. Look in parent directory
3. Flag as missing and prompt user to locate

Without IO, accurate footprints cannot be computed.

### ABGPS / SBET

- Smoothed Best Estimated Trajectory (Applanix and compatible systems)
- Binary format: position + velocity + attitude at high frequency (often 200Hz)
- Interpolated to each image timestamp to produce per-image EO
- For ADS: the SBET IS the EO source — no separate per-frame records

---

## 5. Multi-Camera Trigger Timing — The Precision Problem

### The Issue

In a traditional 5-camera oblique system (e.g., Pictometry), a single trigger
pulse is sent to all camera heads. However:

- Each camera head has its own internal shutter/processing delay from
  receiving the trigger to actual exposure
- These delays differ between camera heads and can vary shot to shot
- The trigger time is recorded by the ABGPS system

**The clock precision limitation:**
Current sensor systems record trigger timestamps to **5–6 decimal places**
(10 microsecond to 1 microsecond resolution).

At typical acquisition speed (~89 m/s for a 200 mph aircraft):
- 5th decimal (10 µs): position uncertainty = 89 m/s × 0.00001 s = ~0.9 mm
- 6th decimal (1 µs): position uncertainty = 89 m/s × 0.000001 s = ~0.09 mm

At these speeds, the clock recording precision itself is acceptable.

**The real problem** is the inter-camera **mechanical timing jitter** — the
variance in actual exposure moment between camera heads relative to the
trigger pulse. This jitter can be at millisecond level:
- 1 ms timing offset: 89 m/s × 0.001 s = ~89 mm = ~9 cm position error

If clocks recorded to **9 decimal places** (nanosecond precision), the
exact trigger-to-exposure delay for each head could be precisely characterized,
cross-camera epoch matching would be unambiguous, and per-head EO interpolation
would be geometrically exact.

### The Solution — Timing Error as Geometry (Patent-Holder's Method)

**Key insight:** The inter-camera timing offsets are not truly random — they are
**consistent per camera head**. A camera head that is consistently 0.000011 seconds
slow will always appear displaced from its true lever arm position by the same
geometric amount (flight_speed × time_offset = apparent position error in meters).

**The AT solution designed for this:**

Rather than trying to measure nanosecond timing, model the entire 5-camera rig
as a single unified system in the aerial triangulation. The consistent timing
offset for each head manifests as a consistent apparent lever arm error — and
lever arm errors are exactly what AT systems are built to solve geometrically.

The AT calibrates the "system" as a whole:
- Timing offsets are absorbed into the camera calibration as apparent lever arm
  and boresight corrections (e.g., camera 5 being 0.000011 s slow appears as
  ~1mm of lever arm offset in the flight direction)
- This is solved once per system calibration flight, not per project
- Once the system is calibrated, it is treated as a rigid, known geometry

**The SBET refinement step:**

With a correct system calibration in place, the only remaining unknown per
project is the SBET itself. A final AT pass refines the single SBET file by
a few centimeters. Because the camera system model is correct, all five heads
move coherently with the SBET correction — the result is centimeter-accurate
positioning across all sensors simultaneously.

**Why this is elegant:**
- Converts an unsolvable timing problem into a solvable geometry problem
- One calibration file covers all future flights with the same rig
- The final refinement target is a single file (SBET), not 5 × N per-image corrections
- Achieves "ant's ass accuracy" — sub-centimeter geometric consistency

**Status:** This AT methodology will be rebuilt in the suite at a later phase.
It is not in scope for the current OpenGeoLook extent generation work.

### Current Scope for OpenGeoLook

**Assumption for all oblique imagery:**
Every image has a pre-computed IO + EO + timestamp in a CSV file.
The EO is taken at face value — no AT, no SBET refinement, no system calibration.
This is correct for standard production data and simplifies the immediate implementation.

AT/SBET refinement is a future module, not part of Milestone 1 extent generation.

---

## 6. What OpenGlobe Displays Per Sensor Type

| Element | Nadir frame | Oblique frame | ADS pushbroom |
|---|---|---|---|
| Camera position | Point | Point | Trajectory line |
| Camera frame | Upright frustum | Tilted frustum | Cross-section wedge |
| Ground footprint | Near-rectangle | Trapezoid | Strip polygon |
| DOF bearing | Kappa or ABGPS delta | Kappa or ABGPS delta | Trajectory direction |
| Epoch grouping | 1 image = 1 event | 5 images = 1 event | Continuous strip |
| DOF arrow on polygon | Yes | Yes | Yes |

---

## 7. Open Questions / To Be Resolved

1. **IO/EO association:** Are lever arm + boresight corrections pre-applied
   in CSV EO files, or does the engine need the raw rig geometry?
   *Answer: Must be confirmed per project — expose in UI.*

2. **Oblique camera naming conventions:** What naming patterns are used
   for epoch grouping in typical CSV exports?
   *Capture from first real project and document.*

3. **ADS trajectory format:** Is SBET the standard, or are Leica-specific
   IPAS formats also needed?
   *Both should be supported — SBET first.*

4. **Ground elevation for ray intersection:** Flat datum plane acceptable
   for footprint generation, or should the engine use the project DEM
   (GLO-30 or uploaded DEM) for terrain-accurate footprints?
   *Flat plane for initial implementation, DEM option for Phase 2.*

5. **GEOID18 vs GEOID2012B:** For new projects, default to GEOID18.
   For existing projects, preserve GEOID2012B to maintain consistency.

---

*Document status: Living design record — update as implementation decisions are made.*
