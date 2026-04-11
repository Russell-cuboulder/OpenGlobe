# OpenGlobe

**3D Web Globe for the Open Geospatial Suite**

Visualize every geospatial dataset from your `.geolook` project files on an interactive 3D globe — LiDAR, orthoimagery, DEMs/DSMs, Voxelites, stereo imagery, vectors, CAD, and more.

Part of the **Open Geospatial Suite**: OpenStereo · OpenLiDAR · OpenVoxelite · OpenGeoLook · **OpenGlobe**

---

## Architecture

```
OpenGeoLook (.geolook)  →  OpenGlobe Server (FastAPI)  →  OpenGlobe Client (React + CesiumJS)
```

- **Server** (`server/`) — Python FastAPI, reads `.geolook` files, reprojects extents to WGS84, serves GeoJSON
- **Client** (`client/`) — React + Vite + CesiumJS, white globe, footprint display, attribution panel

---

## Milestone 1 — Lightweight Extents Mode

- White Cesium globe (no base imagery until data is loaded)
- Load any `.geolook` project → colored footprint polygons by data type
- Click any footprint → attribution panel with full file metadata
- Works 100% locally — no cloud required

---

## Quick Start

### 1. Start the server

```bash
cd server
pip install -r requirements.txt
uvicorn main:app --reload --port 8765
```

### 2. Start the client (dev mode)

```bash
cd client
npm install
npm run dev
```

Open **http://localhost:5173** in your browser.

### 3. Load a project

Paste the full path to a `.geolook` file into the toolbar and click **Load**.

---

## Data type colours

| Type | Colour |
|---|---|
| Voxelite | Orange `#ff9800` |
| Elevation / DEM | Amber `#ffcc80` |
| Raster / Orthoimage | Green `#a5d6a7` |
| LiDAR / Point Cloud | Pink `#f48fb1` |
| Vector / GIS | Cyan `#4fc3f7` |
| CAD | Teal `#80cbc4` |
| Grid | Purple `#ce93d8` |

---

## Roadmap

- [ ] Milestone 1 — Lightweight extents mode *(current)*
- [ ] Milestone 2 — Full LiDAR point cloud streaming (3D Tiles)
- [ ] Milestone 3 — Raster/orthoimage draping (COG tile server)
- [ ] Milestone 4 — DEM/DSM terrain integration
- [ ] Milestone 5 — AWS publish mode (S3 + CloudFront)

---

## License

GPL v3 — Open source, free forever.
