import { useEffect, useRef } from 'react'
import * as Cesium from 'cesium'
import 'cesium/Build/Cesium/Widgets/widgets.css'

// Disable Cesium Ion — we use no cloud services
Cesium.Ion.defaultAccessToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJqdGkiOiJlYWE1OWUxNy1mMWZiLTQzYjYtYTQ0OS1kMWFjYmFkNjc5YzciLCJpZCI6NTc3MzMsImlhdCI6MTYyMjY0NjQ5NH0.XcKpgANiY19MC4bdFUXMVEBToBmqS8kuYpUlxJHYZxk'

const MAPTILER_KEY = import.meta.env.VITE_MAPTILER_KEY
const MAPTILER_TERRAIN_URL =
  `https://api.maptiler.com/tiles/terrain-quantized-mesh-v2/?key=${MAPTILER_KEY}`

// Country base layer styling
const COUNTRY_FILL   = Cesium.Color.fromCssColorString('#cccccc').withAlpha(0.08)
const COUNTRY_STROKE = Cesium.Color.fromCssColorString('#999999').withAlpha(0.65)

// BBox draw styling
const DRAW_FILL   = Cesium.Color.YELLOW.withAlpha(0.15)
const DRAW_STROKE = Cesium.Color.YELLOW.withAlpha(0.9)

export default function Globe({
  features, onFeatureClick,
  terrainEnabled,
  drawMode, onBboxDrawn,
  activeDemId,
}) {
  const containerRef   = useRef(null)
  const viewerRef      = useRef(null)
  const handlerRef     = useRef(null)
  const entitiesRef    = useRef([])
  const countryDsRef   = useRef(null)

  // Draw mode state — all in refs to avoid stale closures in event handlers
  const drawRef        = useRef({ corner1: null, rectCoords: null, rectEntity: null })
  const drawModeRef    = useRef(false)
  const drawHandlerRef = useRef(null)

  // Active DEM ref — stable reference for the tile callback
  const activeDemIdRef = useRef(activeDemId)
  useEffect(() => { activeDemIdRef.current = activeDemId }, [activeDemId])

  // ── Initialise Cesium viewer once ──────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current || viewerRef.current) return

    // 1×1 white PNG — gives Cesium a ready imagery layer with zero network requests
    const WHITE_TILE = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVQI12NgAAIABQAABjE+ibYAAAAASUVORK5CYII='
    const whiteImagery = new Cesium.SingleTileImageryProvider({
      url:       WHITE_TILE,
      rectangle: Cesium.Rectangle.MAX_VALUE,
    })

    const viewer = new Cesium.Viewer(containerRef.current, {
      baseLayer:             new Cesium.ImageryLayer(whiteImagery),
      terrainProvider:       new Cesium.EllipsoidTerrainProvider(),
      baseLayerPicker:       false,
      geocoder:              false,
      homeButton:            true,
      sceneModePicker:       true,
      navigationHelpButton:  true,
      animation:             false,
      timeline:              false,
      fullscreenButton:      true,
      infoBox:               false,
      selectionIndicator:    false,
      skyBox:                false,
      skyAtmosphere:         false,
    })

    viewer.scene.backgroundColor            = Cesium.Color.WHITE
    viewer.scene.globe.baseColor            = Cesium.Color.WHITE
    viewer.scene.globe.showGroundAtmosphere = false
    viewer.scene.globe.enableLighting       = false
    viewer.scene.globe.showWaterEffect      = false

    // ── Country base layer ───────────────────────────────────────────────────
    const loadCountries = async () => {
      try {
        const ds = await Cesium.GeoJsonDataSource.load('/geo/ne_110m_countries.geojson', {
          stroke:        COUNTRY_STROKE,
          fill:          COUNTRY_FILL,
          strokeWidth:   1,
          clampToGround: true,
        })
        ds.name = 'countries'
        await viewer.dataSources.add(ds)
        countryDsRef.current = ds
      } catch (e) {
        console.warn('OpenGlobe: could not load country base layer', e)
      }
    }
    loadCountries()

    // ── Feature/country click handler ────────────────────────────────────────
    const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas)
    handler.setInputAction((click) => {
      // Ignore clicks while drawing
      if (drawModeRef.current) return

      const picked = viewer.scene.pick(click.position)
      if (Cesium.defined(picked) && picked.id?.properties) {
        const names = picked.id.properties.propertyNames
        if (!names) { onFeatureClick?.(null); return }

        const props = {}
        for (const key of names) {
          const val = picked.id.properties[key]
          props[key] = val?.getValue?.() ?? val
        }

        if (props.data_type) { onFeatureClick?.(props); return }

        if (props.ADMIN || props.NAME) {
          onFeatureClick?.({
            data_type:  'Country',
            filename:   props.ADMIN || props.NAME,
            iso_a2:     props.ISO_A2,
            iso_a3:     props.ISO_A3,
            continent:  props.CONTINENT,
            region:     props.SUBREGION,
            pop_est:    props.POP_EST,
            gdp_md:     props.GDP_MD,
            economy:    props.ECONOMY,
            income_grp: props.INCOME_GRP,
            sovereignt: props.SOVEREIGNT,
          })
          return
        }
      }
      onFeatureClick?.(null)
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK)

    viewerRef.current  = viewer
    handlerRef.current = handler

    return () => {
      handler.destroy()
      if (drawHandlerRef.current) {
        drawHandlerRef.current.destroy()
        drawHandlerRef.current = null
      }
      viewer.destroy()
      viewerRef.current  = null
      handlerRef.current = null
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Activate / deactivate bbox draw mode ───────────────────────────────────
  useEffect(() => {
    const viewer = viewerRef.current
    if (!viewer) return

    drawModeRef.current = drawMode

    if (drawMode) {
      // Change cursor
      viewer.canvas.style.cursor = 'crosshair'
      // Disable globe rotate/translate so clicks don't spin the globe
      viewer.scene.screenSpaceCameraController.enableRotate    = false
      viewer.scene.screenSpaceCameraController.enableTranslate = false

      // Reset draw state
      const ds = drawRef.current
      if (ds.rectEntity) { viewer.entities.remove(ds.rectEntity); ds.rectEntity = null }
      ds.corner1 = null
      ds.rectCoords = { west: 0, south: 0, east: 0, north: 0 }

      // Create persistent preview rectangle (driven by rectCoords ref)
      const rectEntity = viewer.entities.add({
        rectangle: {
          coordinates: new Cesium.CallbackProperty(() => {
            const c = drawRef.current.rectCoords
            if (!c || !drawRef.current.corner1) return undefined
            return Cesium.Rectangle.fromDegrees(c.west, c.south, c.east, c.north)
          }, false),
          material:     DRAW_FILL,
          outline:      true,
          outlineColor: DRAW_STROKE,
          outlineWidth: 2,
          height:       0,
        },
      })
      drawRef.current.rectEntity = rectEntity

      // Draw handler
      const dh = new Cesium.ScreenSpaceEventHandler(viewer.canvas)

      // MOUSE_MOVE → update preview
      dh.setInputAction((evt) => {
        if (!drawRef.current.corner1) return
        const pos = _pickGlobe(viewer, evt.endPosition)
        if (!pos) return
        const c1 = drawRef.current.corner1
        drawRef.current.rectCoords = {
          west:  Math.min(c1.lon, pos.lon),
          east:  Math.max(c1.lon, pos.lon),
          south: Math.min(c1.lat, pos.lat),
          north: Math.max(c1.lat, pos.lat),
        }
      }, Cesium.ScreenSpaceEventType.MOUSE_MOVE)

      // LEFT_CLICK → set corner1 then confirm
      dh.setInputAction((evt) => {
        const pos = _pickGlobe(viewer, evt.position)
        if (!pos) return
        if (!drawRef.current.corner1) {
          drawRef.current.corner1 = pos
        } else {
          // Second click — confirm bbox
          const c1 = drawRef.current.corner1
          const bbox = {
            west:  Math.min(c1.lon, pos.lon),
            east:  Math.max(c1.lon, pos.lon),
            south: Math.min(c1.lat, pos.lat),
            north: Math.max(c1.lat, pos.lat),
          }
          // Keep the rectangle drawn on the globe
          drawRef.current.corner1 = null
          dh.destroy()
          drawHandlerRef.current = null
          onBboxDrawn?.(bbox)
        }
      }, Cesium.ScreenSpaceEventType.LEFT_CLICK)

      // RIGHT_CLICK → cancel draw
      dh.setInputAction(() => {
        if (drawRef.current.rectEntity) {
          viewer.entities.remove(drawRef.current.rectEntity)
          drawRef.current.rectEntity = null
        }
        drawRef.current.corner1 = null
        dh.destroy()
        drawHandlerRef.current = null
        onBboxDrawn?.(null)
      }, Cesium.ScreenSpaceEventType.RIGHT_CLICK)

      drawHandlerRef.current = dh

    } else {
      // Exiting draw mode — restore camera, remove any incomplete rectangle
      viewer.canvas.style.cursor = ''
      viewer.scene.screenSpaceCameraController.enableRotate    = true
      viewer.scene.screenSpaceCameraController.enableTranslate = true

      if (drawHandlerRef.current) {
        drawHandlerRef.current.destroy()
        drawHandlerRef.current = null
      }
      // Leave completed rectangle on globe (shows the downloaded area)
    }
  }, [drawMode]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Swap terrain provider (MapTiler, local DEM, or flat) ───────────────────
  useEffect(() => {
    const viewer = viewerRef.current
    if (!viewer) return

    if (activeDemId) {
      // Local DEM takes priority — use CustomHeightmapTerrainProvider
      viewer.terrainProvider = new Cesium.CustomHeightmapTerrainProvider({
        width:  32,
        height: 32,
        callback: async (x, y, level) => {
          const id = activeDemIdRef.current
          if (!id) return new Float32Array(32 * 32).fill(0)
          try {
            const res = await fetch(`/api/terrain/${id}/tile?x=${x}&y=${y}&z=${level}`)
            if (!res.ok) return new Float32Array(32 * 32).fill(0)
            const data = await res.json()
            return new Float32Array(data.heights)
          } catch {
            return new Float32Array(32 * 32).fill(0)
          }
        },
      })
    } else if (terrainEnabled) {
      if (!MAPTILER_KEY) {
        console.warn('OpenGlobe: set VITE_MAPTILER_KEY in .env.local to enable terrain')
        return
      }
      Cesium.CesiumTerrainProvider.fromUrl(MAPTILER_TERRAIN_URL, {
        requestVertexNormals: true,
      }).then(p => { if (viewerRef.current) viewerRef.current.terrainProvider = p })
        .catch(e => console.warn('OpenGlobe: terrain load failed', e))
    } else {
      viewer.terrainProvider = new Cesium.EllipsoidTerrainProvider()
    }
  }, [activeDemId, terrainEnabled])

  // ── Re-render footprint polygons when features change ──────────────────────
  useEffect(() => {
    const viewer = viewerRef.current
    if (!viewer) return

    for (const entity of entitiesRef.current) viewer.entities.remove(entity)
    entitiesRef.current = []

    if (!features?.length) return

    for (const feature of features) {
      const { geometry, properties } = feature
      if (!geometry || geometry.type !== 'Polygon') continue

      const positions = geometry.coordinates[0].map(([lon, lat]) =>
        Cesium.Cartesian3.fromDegrees(lon, lat)
      )
      const hex       = properties.color || '#9e9e9e'
      const fillColor = Cesium.Color.fromCssColorString(hex).withAlpha(0.30)
      const lineColor = Cesium.Color.fromCssColorString(hex).withAlpha(0.90)

      const entity = viewer.entities.add({
        polygon: {
          hierarchy:          new Cesium.PolygonHierarchy(positions),
          material:           fillColor,
          outline:            true,
          outlineColor:       lineColor,
          outlineWidth:       2,
          heightReference:    Cesium.HeightReference.CLAMP_TO_GROUND,
          classificationType: Cesium.ClassificationType.TERRAIN,
        },
        properties: new Cesium.PropertyBag(properties),
      })
      entitiesRef.current.push(entity)
    }

    viewer.flyTo(viewer.entities, { duration: 1.5 })
  }, [features])

  return (
    <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
  )
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function _pickGlobe(viewer, windowPos) {
  const ray = viewer.camera.getPickRay(windowPos)
  if (!ray) return null
  const pos = viewer.scene.globe.pick(ray, viewer.scene)
  if (!pos) return null
  const carto = Cesium.Cartographic.fromCartesian(pos)
  return {
    lon: Cesium.Math.toDegrees(carto.longitude),
    lat: Cesium.Math.toDegrees(carto.latitude),
  }
}
