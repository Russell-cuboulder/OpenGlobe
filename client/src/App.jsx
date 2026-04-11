import { useState, useCallback } from 'react'
import Globe from './components/Globe.jsx'
import Toolbar from './components/Toolbar.jsx'
import AttributionPanel from './components/AttributionPanel.jsx'
import './styles/App.css'

export default function App() {
  const [features, setFeatures]               = useState([])
  const [projectName, setProjectName]         = useState('')
  const [stats, setStats]                     = useState(null)
  const [selectedFeature, setSelectedFeature] = useState(null)
  const [loading, setLoading]                 = useState(false)
  const [error, setError]                     = useState(null)
  const [terrainEnabled, setTerrainEnabled]   = useState(false)

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
      />
      <div className="globe-wrap">
        <Globe
          features={features}
          onFeatureClick={setSelectedFeature}
          terrainEnabled={terrainEnabled}
        />
        {selectedFeature && (
          <AttributionPanel
            feature={selectedFeature}
            onClose={() => setSelectedFeature(null)}
          />
        )}
      </div>
    </div>
  )
}
