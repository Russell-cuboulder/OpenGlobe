import { useState, useCallback, useEffect } from 'react'
import Globe from './components/Globe.jsx'
import Toolbar from './components/Toolbar.jsx'
import AttributionPanel from './components/AttributionPanel.jsx'
import DemPanel from './components/DemPanel.jsx'
import './styles/App.css'

export default function App() {
  const [features, setFeatures]               = useState([])
  const [projectName, setProjectName]         = useState('')
  const [stats, setStats]                     = useState(null)
  const [selectedFeature, setSelectedFeature] = useState(null)
  const [loading, setLoading]                 = useState(false)
  const [error, setError]                     = useState(null)
  const [terrainEnabled, setTerrainEnabled]   = useState(false)

  // BBox draw + DEM state
  const [drawMode, setDrawMode]       = useState(false)
  const [drawnBbox, setDrawnBbox]     = useState(null)   // {west,south,east,north}
  const [demList, setDemList]         = useState([])      // downloaded DEMs
  const [activeDemId, setActiveDemId] = useState(null)   // which DEM is live terrain
  const [loadedLayers, setLoadedLayers] = useState([])   // {id, name, geojson, color}

  // Auto-load from ?project= URL param on first mount
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const projectPath = params.get('project')
    if (projectPath) {
      loadProject(projectPath)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const loadProject = useCallback(async (geolookPath) => {
    setLoading(true)
    setError(null)
    setSelectedFeature(null)
    try {
      const res = await fetch(`/api/manifest?path=${encodeURIComponent(geolookPath)}`)
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.detail || 'Failed to load project')
      }
      const data = await res.json()
      setProjectName(data.project_name)
      setFeatures(data.geojson.features)
      setStats({
        total:   data.total_records,
        visible: data.visible_extents,
        skipped: data.skipped_no_extent,
      })
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  const handleLoadData = useCallback((feature) => {
    const id = feature.path
    setLoadedLayers(prev => {
      if (prev.find(l => l.id === id)) return prev.filter(l => l.id !== id)
      return [...prev, {
        id,
        name:  feature.filename,
        url:   `/api/data?path=${encodeURIComponent(feature.path)}`,
        color: feature.color,
      }]
    })
  }, [])

  // Called by Globe when user completes a bbox draw
  const handleBboxDrawn = useCallback((bbox) => {
    setDrawMode(false)
    setDrawnBbox(bbox)
  }, [])

  // Called by DemPanel after a successful download
  const handleDemDownloaded = useCallback((dem) => {
    setDemList(prev => [...prev, dem])
    setDrawnBbox(null)
    setActiveDemId(dem.id)           // auto-activate the new DEM
  }, [])

  // Toggle a DEM on/off
  const handleToggleDem = useCallback((id) => {
    setActiveDemId(prev => prev === id ? null : id)
  }, [])

  // Delete a DEM
  const handleDeleteDem = useCallback(async (id) => {
    await fetch(`/api/terrain/${id}`, { method: 'DELETE' })
    setDemList(prev => prev.filter(d => d.id !== id))
    if (activeDemId === id) setActiveDemId(null)
  }, [activeDemId])

  // Load saved DEMs from server on first mount
  // (so DEMs survive page refresh)
  useState(() => {
    fetch('/api/terrain/list')
      .then(r => r.ok ? r.json() : [])
      .then(list => { if (list.length) setDemList(list) })
      .catch(() => {})
  })

  const showDemPanel = drawMode === false && (drawnBbox || demList.length > 0)

  return (
    <div className="app">
      <Toolbar
        projectName={projectName}
        features={features}
        stats={stats}
        loading={loading}
        error={error}
        onLoadProject={loadProject}
        terrainEnabled={terrainEnabled}
        onToggleTerrain={() => setTerrainEnabled(t => !t)}
        drawMode={drawMode}
        onToggleDrawMode={() => {
          setDrawMode(m => !m)
          if (!drawMode) setDrawnBbox(null)
        }}
        demList={demList}
        activeDemId={activeDemId}
        onToggleDem={handleToggleDem}
      />
      <div className="globe-wrap">
        <Globe
          features={features}
          onFeatureClick={setSelectedFeature}
          terrainEnabled={terrainEnabled}
          drawMode={drawMode}
          onBboxDrawn={handleBboxDrawn}
          activeDemId={activeDemId}
          loadedLayers={loadedLayers}
        />
        {selectedFeature && (
          <AttributionPanel
            feature={selectedFeature}
            onClose={() => setSelectedFeature(null)}
            onLoadData={handleLoadData}
          />
        )}
        {showDemPanel && (
          <DemPanel
            drawnBbox={drawnBbox}
            demList={demList}
            activeDemId={activeDemId}
            onDownloaded={handleDemDownloaded}
            onToggleDem={handleToggleDem}
            onDeleteDem={handleDeleteDem}
            onClose={() => setDrawnBbox(null)}
          />
        )}
      </div>
    </div>
  )
}
