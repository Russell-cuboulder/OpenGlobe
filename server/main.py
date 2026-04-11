"""
OpenGlobe — Local tile server

Serves .geolook project manifests as GeoJSON for the Cesium frontend.
Reprojects extent bounding boxes to WGS84 (EPSG:4326) so the globe
can display footprints regardless of the source CRS.

Run with:
    uvicorn main:app --reload --port 8765
"""

import json
import os
import uuid
from pathlib import Path
from typing import Optional

import httpx
import numpy as np
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# pyproj is optional — extents in projected CRS won't reproject without it
try:
    from pyproj import Transformer, CRS
    PYPROJ_AVAILABLE = True
except ImportError:
    PYPROJ_AVAILABLE = False

# rasterio is optional — needed for local DEM heightmap serving
try:
    import rasterio
    RASTERIO_AVAILABLE = True
except ImportError:
    RASTERIO_AVAILABLE = False

# ── Terrain / DEM config ──────────────────────────────────────────────────────
OPENTOPO_KEY  = os.environ.get("OPENTOPO_KEY", "")
OPENTOPO_URL  = "https://portal.opentopography.org/API/globaldem"
TERRAIN_DIR   = Path(__file__).parent / "terrain"
TERRAIN_INDEX = TERRAIN_DIR / "index.json"
TERRAIN_DIR.mkdir(exist_ok=True)

# In-process cache of open rasterio datasets (avoid re-opening on every tile)
_dem_cache: dict[str, "rasterio.DatasetReader"] = {}

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


# ── Terrain / DEM endpoints ───────────────────────────────────────────────────

class DownloadRequest(BaseModel):
    west:  float
    south: float
    east:  float
    north: float
    name:  Optional[str] = None


def _terrain_index() -> dict:
    if TERRAIN_INDEX.exists():
        with open(TERRAIN_INDEX) as f:
            return json.load(f)
    return {}


def _save_terrain_index(index: dict):
    with open(TERRAIN_INDEX, "w") as f:
        json.dump(index, f, indent=2)


def _format_bytes(n: int) -> str:
    if n >= 1_073_741_824:
        return f"{n / 1_073_741_824:.1f} GB"
    if n >= 1_048_576:
        return f"{n / 1_048_576:.1f} MB"
    return f"{n / 1024:.0f} KB"


def _get_dem_dataset(dem_id: str, path: str):
    """Return a cached rasterio dataset, opening it if needed."""
    if dem_id not in _dem_cache:
        _dem_cache[dem_id] = rasterio.open(path)
    return _dem_cache[dem_id]


@app.get("/terrain/list")
def terrain_list():
    """Return all downloaded DEMs."""
    return list(_terrain_index().values())


@app.post("/terrain/download")
async def terrain_download(req: DownloadRequest):
    """
    Download a Copernicus GLO-30 DEM tile from OpenTopography for the given bbox.
    Saves a GeoTIFF to server/terrain/ and returns the DEM metadata.
    """
    if not RASTERIO_AVAILABLE:
        raise HTTPException(status_code=500,
                            detail="rasterio is not installed — run: pip install rasterio")

    # Clamp and validate
    west  = max(-180.0, min(180.0, req.west))
    east  = max(-180.0, min(180.0, req.east))
    south = max(-90.0,  min(90.0,  req.south))
    north = max(-90.0,  min(90.0,  req.north))

    if east <= west or north <= south:
        raise HTTPException(status_code=400, detail="Invalid bounding box")

    area_deg2 = (east - west) * (north - south)
    if area_deg2 > 100:
        raise HTTPException(status_code=400,
                            detail="Bounding box too large (max ~10°×10°). "
                                   "Select a smaller area.")

    params: dict = {
        "demtype":      "COP30",
        "south":        south,
        "north":        north,
        "west":         west,
        "east":         east,
        "outputFormat": "GTiff",
    }
    if OPENTOPO_KEY:
        params["API_Key"] = OPENTOPO_KEY

    dem_id   = uuid.uuid4().hex[:8]
    dem_name = req.name or f"GLO30_{south:.2f}_{west:.2f}"
    dem_path = TERRAIN_DIR / f"{dem_id}.tif"

    try:
        async with httpx.AsyncClient(timeout=600) as client:
            response = await client.get(OPENTOPO_URL, params=params)

        if response.status_code != 200:
            # OpenTopography returns plain-text errors
            detail = response.text[:300] if response.text else f"HTTP {response.status_code}"
            raise HTTPException(status_code=502,
                                detail=f"OpenTopography error: {detail}")

        # Validate it's a GeoTIFF (starts with TIFF magic bytes)
        content = response.content
        if content[:4] not in (b"II*\x00", b"MM\x00*", b"II+\x00", b"MM\x00+"):
            raise HTTPException(status_code=502,
                                detail=f"OpenTopography did not return a GeoTIFF. "
                                       f"Response: {content[:200]}")

        dem_path.write_bytes(content)

    except httpx.TimeoutException:
        raise HTTPException(status_code=504,
                            detail="Download timed out — try a smaller area")

    size_bytes = dem_path.stat().st_size

    entry = {
        "id":         dem_id,
        "name":       dem_name,
        "path":       str(dem_path),
        "bbox":       {"west": west, "south": south, "east": east, "north": north},
        "size_bytes": size_bytes,
        "size_human": _format_bytes(size_bytes),
    }

    index = _terrain_index()
    index[dem_id] = entry
    _save_terrain_index(index)

    return entry


@app.get("/terrain/{dem_id}/tile")
def terrain_tile(dem_id: str,
                 x: int = Query(...),
                 y: int = Query(...),
                 z: int = Query(...)):
    """
    Return a 32×32 heightmap grid for a Cesium geographic tile (x, y, level).
    Heights are in metres above the WGS84 ellipsoid.
    """
    if not RASTERIO_AVAILABLE:
        raise HTTPException(status_code=500, detail="rasterio not available")

    index = _terrain_index()
    if dem_id not in index:
        raise HTTPException(status_code=404, detail="DEM not found")

    entry    = index[dem_id]
    dem_path = entry["path"]

    # Cesium geographic tiling scheme
    # Level 0: 2×1 tiles; level N: 2^(N+1) × 2^N tiles
    num_x = 2 ** (z + 1)
    num_y = 2 ** z
    lon_min = x / num_x * 360.0 - 180.0
    lon_max = (x + 1) / num_x * 360.0 - 180.0
    lat_min = y / num_y * 180.0 - 90.0
    lat_max = (y + 1) / num_y * 180.0 - 90.0

    bbox     = entry["bbox"]
    GRID     = 32
    FLAT     = [0.0] * (GRID * GRID)

    # Skip tiles that don't intersect the DEM coverage
    if (lon_max < bbox["west"] or lon_min > bbox["east"] or
            lat_max < bbox["south"] or lat_min > bbox["north"]):
        return {"heights": FLAT}

    try:
        ds = _get_dem_dataset(dem_id, dem_path)
        nodata = ds.nodata

        # Build sample grid: top-to-bottom (Cesium expects row-major, N→S)
        lons = np.linspace(lon_min, lon_max, GRID)
        lats = np.linspace(lat_max, lat_min, GRID)
        lon_grid, lat_grid = np.meshgrid(lons, lats)

        coords = list(zip(lon_grid.flatten().tolist(),
                          lat_grid.flatten().tolist()))

        heights = []
        for val in ds.sample(coords, indexes=1):
            h = float(val[0])
            if nodata is not None and h == nodata:
                h = 0.0
            elif np.isnan(h) or np.isinf(h):
                h = 0.0
            heights.append(h)

        return {"heights": heights}

    except Exception as exc:
        raise HTTPException(status_code=500,
                            detail=f"Failed to sample DEM: {exc}")


@app.delete("/terrain/{dem_id}")
def terrain_delete(dem_id: str):
    """Remove a downloaded DEM file and its index entry."""
    index = _terrain_index()
    if dem_id not in index:
        raise HTTPException(status_code=404, detail="DEM not found")

    # Close and evict from cache
    if dem_id in _dem_cache:
        try:
            _dem_cache[dem_id].close()
        except Exception:
            pass
        del _dem_cache[dem_id]

    dem_path = Path(index[dem_id]["path"])
    if dem_path.exists():
        dem_path.unlink()

    del index[dem_id]
    _save_terrain_index(index)

    return {"status": "deleted", "id": dem_id}
