"""
OpenGlobe — Local tile server

Serves .geolook project manifests as GeoJSON for the Cesium frontend.
Reprojects extent bounding boxes to WGS84 (EPSG:4326) so the globe
can display footprints regardless of the source CRS.

Run with:
    uvicorn main:app --reload --port 8765
"""

import json
from pathlib import Path

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

# pyproj is optional — extents in projected CRS won't reproject without it
try:
    from pyproj import Transformer, CRS
    PYPROJ_AVAILABLE = True
except ImportError:
    PYPROJ_AVAILABLE = False

app = FastAPI(title="OpenGlobe Server", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)

# ── Colour map — matches OpenGeoLook palette ───────────────────────────────────
TYPE_COLORS: dict[str, str] = {
    "Voxelite":    "#ff9800",
    "Elevation":   "#ffcc80",
    "Raster":      "#a5d6a7",
    "Point Cloud": "#f48fb1",
    "Vector":      "#4fc3f7",
    "CAD":         "#80cbc4",
    "Grid":        "#ce93d8",
    "Project":     "#ffe082",
    "Style":       "#b0bec5",
}

# ── Coordinate helpers ────────────────────────────────────────────────────────

def _looks_geographic(xmin: float, xmax: float,
                       ymin: float, ymax: float) -> bool:
    """Return True if the bbox values are plausibly WGS84 lon/lat."""
    return (-181 < xmin < 181 and -181 < xmax < 181
            and -91  < ymin < 91  and -91  < ymax < 91)


def _reproject_bbox(xmin: float, ymin: float,
                    xmax: float, ymax: float,
                    crs_wkt: str) -> tuple[float, float, float, float] | None:
    """
    Reproject a bounding box from crs_wkt to WGS84.
    Returns (lon_min, lat_min, lon_max, lat_max) or None on failure.
    """
    if not PYPROJ_AVAILABLE or not crs_wkt:
        return None
    try:
        src_crs = CRS.from_wkt(crs_wkt)
        t = Transformer.from_crs(src_crs, CRS.from_epsg(4326), always_xy=True)
        # Transform all four corners to handle rotated projections
        corners = [
            t.transform(xmin, ymin),
            t.transform(xmax, ymin),
            t.transform(xmax, ymax),
            t.transform(xmin, ymax),
        ]
        lons = [c[0] for c in corners]
        lats = [c[1] for c in corners]
        return min(lons), min(lats), max(lons), max(lats)
    except Exception:
        return None


def _bbox_to_wgs84(rec: dict) -> tuple[float, float, float, float] | None:
    """Return (lon_min, lat_min, lon_max, lat_max) in WGS84 or None."""
    bbox = rec.get("extent_bbox")
    if not bbox:
        return None

    xmin = bbox.get("xmin", 0)
    ymin = bbox.get("ymin", 0)
    xmax = bbox.get("xmax", 0)
    ymax = bbox.get("ymax", 0)

    if xmin == xmax or ymin == ymax:
        return None

    if _looks_geographic(xmin, xmax, ymin, ymax):
        return xmin, ymin, xmax, ymax

    # Try reprojecting from the record's CRS
    reprojected = _reproject_bbox(xmin, ymin, xmax, ymax,
                                   rec.get("crs_wkt", ""))
    return reprojected


# ── GeoJSON conversion ────────────────────────────────────────────────────────

def records_to_geojson(records: list[dict],
                        included_paths: list[str] | None) -> dict:
    """Convert .geolook records to a GeoJSON FeatureCollection."""
    included = set(included_paths) if included_paths else None
    features = []
    skipped  = 0

    for rec in records:
        if included and rec.get("path") not in included:
            continue

        wgs84 = _bbox_to_wgs84(rec)
        if wgs84 is None:
            skipped += 1
            continue

        lon_min, lat_min, lon_max, lat_max = wgs84

        polygon_coords = [[
            [lon_min, lat_min],
            [lon_max, lat_min],
            [lon_max, lat_max],
            [lon_min, lat_max],
            [lon_min, lat_min],
        ]]

        data_type = rec.get("data_type", "Unknown")
        color     = TYPE_COLORS.get(data_type, "#9e9e9e")

        # Build a clean properties dict for the attribution panel
        props: dict = {
            "path":          rec.get("path", ""),
            "filename":      rec.get("filename", ""),
            "directory":     rec.get("directory", ""),
            "data_type":     data_type,
            "subtype":       rec.get("subtype", ""),
            "format":        rec.get("format", ""),
            "crs_name":      rec.get("crs_name") or "—",
            "resolution":    rec.get("resolution") or "—",
            "size_human":    rec.get("size_human", ""),
            "size_bytes":    rec.get("size_bytes", 0),
            "color":         color,
        }

        # Type-specific fields
        if data_type == "Point Cloud":
            props["point_count"] = rec.get("point_count")
            props["z_min"]       = rec.get("z_min")
            props["z_max"]       = rec.get("z_max")
        elif data_type in ("Raster", "Elevation", "Voxelite"):
            props["bands"]       = rec.get("bands")
            props["band_dtypes"] = rec.get("band_dtypes", "")
        elif data_type == "Vector":
            props["feature_count"] = rec.get("feature_count")
            props["geom_type"]     = rec.get("geom_type", "")

        if rec.get("stereo_role"):
            props["stereo_role"] = rec.get("stereo_role", "")
            props["stereo_pair"] = rec.get("stereo_pair", "")

        features.append({
            "type":     "Feature",
            "geometry": {"type": "Polygon", "coordinates": polygon_coords},
            "properties": props,
        })

    return {
        "type":     "FeatureCollection",
        "features": features,
        "_skipped": skipped,
    }


# ── API endpoints ─────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    return {
        "status":           "ok",
        "service":          "OpenGlobe",
        "pyproj_available": PYPROJ_AVAILABLE,
    }


@app.get("/manifest")
def get_manifest(
    path: str = Query(..., description="Absolute path to a .geolook project file")
):
    """
    Load a .geolook file and return its dataset footprints as GeoJSON.

    All extent bounding boxes are reprojected to WGS84 so the globe can
    display them regardless of the source coordinate reference system.
    """
    geolook_path = Path(path)

    if not geolook_path.exists():
        raise HTTPException(status_code=404,
                            detail=f"File not found: {path}")
    if geolook_path.suffix.lower() != ".geolook":
        raise HTTPException(status_code=400,
                            detail="File must be a .geolook project file")

    try:
        with open(geolook_path, "r", encoding="utf-8") as f:
            data = json.load(f)
    except Exception as exc:
        raise HTTPException(status_code=500,
                            detail=f"Failed to read project file: {exc}")

    records        = data.get("records", [])
    included_paths = data.get("included_paths") or None
    project_name   = data.get("name", "Untitled Project")

    geojson = records_to_geojson(records, included_paths)

    return {
        "project_name":   project_name,
        "total_records":  len(records),
        "visible_extents": len(geojson["features"]),
        "skipped_no_extent": geojson.pop("_skipped", 0),
        "geojson":        geojson,
    }
