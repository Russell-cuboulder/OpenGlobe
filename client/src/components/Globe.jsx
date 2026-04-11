import { useEffect, useRef } from 'react'
import * as Cesium from 'cesium'
import 'cesium/Build/Cesium/Widgets/widgets.css'

// No Cesium Ion services needed for the white globe
Cesium.Ion.defaultAccessToken = ''

export default function Globe({ features, onFeatureClick }) {
  const containerRef = useRef(null)
  const viewerRef    = useRef(null)
  const handlerRef   = useRef(null)
  const entitiesRef  = useRef([])

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

    // Subtle grid lines so the globe surface isn't completely featureless
    viewer.scene.globe.showWaterEffect = false

    // Click handler — pick entity and fire onFeatureClick
    const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas)
    handler.setInputAction((click) => {
      const picked = viewer.scene.pick(click.position)
      if (Cesium.defined(picked) && picked.id?.properties) {
        const props = {}
        for (const key of picked.id.properties.propertyNames) {
          props[key] = picked.id.properties[key]?.getValue?.() ?? picked.id.properties[key]
        }
        onFeatureClick?.(props)
      } else {
        onFeatureClick?.(null)
      }
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK)

    viewerRef.current  = viewer
    handlerRef.current = handler

    return () => {
      handler.destroy()
      viewer.destroy()
      viewerRef.current  = null
      handlerRef.current = null
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Re-render footprint polygons when features change ──────────────────────
  useEffect(() => {
    const viewer = viewerRef.current
    if (!viewer) return

    // Remove old entities
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
