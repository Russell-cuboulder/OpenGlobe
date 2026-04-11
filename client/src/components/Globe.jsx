import { useEffect, useRef } from 'react'
import * as Cesium from 'cesium'
import 'cesium/Build/Cesium/Widgets/widgets.css'

// No Cesium Ion services needed for the white globe
Cesium.Ion.defaultAccessToken = ''

const MAPTILER_KEY = import.meta.env.VITE_MAPTILER_KEY
const MAPTILER_TERRAIN_URL =
  `https://api.maptiler.com/tiles/terrain-quantized-mesh-v2/?key=${MAPTILER_KEY}`

// Country base layer styling
const COUNTRY_FILL    = Cesium.Color.fromCssColorString('#cccccc').withAlpha(0.08)
const COUNTRY_STROKE  = Cesium.Color.fromCssColorString('#999999').withAlpha(0.65)

export default function Globe({ features, onFeatureClick, terrainEnabled }) {
  const containerRef   = useRef(null)
  const viewerRef      = useRef(null)
  const handlerRef     = useRef(null)
  const entitiesRef    = useRef([])
  const countryDsRef   = useRef(null)

  // ── Initialise Cesium viewer once ──────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current || viewerRef.current) return

    const viewer = new Cesium.Viewer(containerRef.current, {
      // No imagery — white globe
      imageryProvider:       false,
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

    // White globe surface
    viewer.scene.backgroundColor            = Cesium.Color.WHITE
    viewer.scene.globe.baseColor            = Cesium.Color.WHITE
    viewer.scene.globe.showGroundAtmosphere = false
    viewer.scene.globe.enableLighting       = false
    viewer.scene.globe.showWaterEffect      = false

    // ── Load country base layer ──────────────────────────────────────────────
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

    // ── Click handler ────────────────────────────────────────────────────────
    const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas)
    handler.setInputAction((click) => {
      const picked = viewer.scene.pick(click.position)

      if (Cesium.defined(picked) && picked.id?.properties) {
        const names = picked.id.properties.propertyNames
        if (!names) { onFeatureClick?.(null); return }

        const props = {}
        for (const key of names) {
          const val = picked.id.properties[key]
          props[key] = val?.getValue?.() ?? val
        }

        // Footprint entity — has data_type set by OpenGlobe server
        if (props.data_type) {
          onFeatureClick?.(props)
          return
        }

        // Country entity — from Natural Earth GeoJSON
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
      viewer.destroy()
      viewerRef.current    = null
      handlerRef.current   = null
      countryDsRef.current = null
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Swap terrain provider when toggle changes ─────────────────────────────
  useEffect(() => {
    const viewer = viewerRef.current
    if (!viewer) return

    if (terrainEnabled) {
      if (!MAPTILER_KEY) {
        console.warn('OpenGlobe: set VITE_MAPTILER_KEY in .env.local to enable terrain')
        return
      }
      Cesium.CesiumTerrainProvider.fromUrl(MAPTILER_TERRAIN_URL, {
        requestVertexNormals: true,
      }).then(provider => {
        if (viewerRef.current) viewerRef.current.terrainProvider = provider
      }).catch(e => console.warn('OpenGlobe: terrain load failed', e))
    } else {
      viewer.terrainProvider = new Cesium.EllipsoidTerrainProvider()
    }
  }, [terrainEnabled])

  // ── Re-render footprint polygons when features change ──────────────────────
  useEffect(() => {
    const viewer = viewerRef.current
    if (!viewer) return

    // Remove old footprint entities
    for (const entity of entitiesRef.current) {
      viewer.entities.remove(entity)
    }
    entitiesRef.current = []

    if (!features?.length) return

    for (const feature of features) {
      const { geometry, properties } = feature
      if (!geometry || geometry.type !== 'Polygon') continue

      const coords = geometry.coordinates[0]
      const positions = coords.map(([lon, lat]) =>
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

    // Fly the camera to fit all loaded footprints
    viewer.flyTo(viewer.entities, { duration: 1.5 })
  }, [features])

  return (
    <div
      ref={containerRef}
      style={{ width: '100%', height: '100%' }}
    />
  )
}
