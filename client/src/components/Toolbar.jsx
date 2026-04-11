import { useState, useRef } from 'react'

// Data type colour map — matches OpenGeoLook + server palette
const TYPE_COLORS = {
  'Voxelite':    '#ff9800',
  'Elevation':   '#ffcc80',
  'Raster':      '#a5d6a7',
  'Point Cloud': '#f48fb1',
  'Vector':      '#4fc3f7',
  'CAD':         '#80cbc4',
  'Grid':        '#ce93d8',
  'Project':     '#ffe082',
}

function typeCounts(features) {
  const counts = {}
  for (const f of features) {
    const t = f.properties?.data_type || 'Unknown'
    counts[t] = (counts[t] || 0) + 1
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1])
}

export default function Toolbar({
  projectName, features, stats, loading, error, onLoadProject,
  terrainEnabled, onToggleTerrain,
}) {
  const [pathInput, setPathInput] = useState('')
  const inputRef = useRef(null)

  const handleLoad = () => {
    const p = pathInput.trim()
    if (p) onLoadProject(p)
  }

  const handleKey = (e) => {
    if (e.key === 'Enter') handleLoad()
  }

  const counts = typeCounts(features)

  return (
    <div className="toolbar">
      {/* ── Brand ── */}
      <div className="toolbar-brand">
        <span className="brand-icon">◉</span>
        <span className="brand-name">OpenGlobe</span>
        {projectName && (
          <span className="brand-project">/ {projectName}</span>
        )}
      </div>

      {/* ── Path input ── */}
      <div className="toolbar-load">
        <input
          ref={inputRef}
          className="path-input"
          type="text"
          placeholder="Path to .geolook project file…"
          value={pathInput}
          onChange={(e) => setPathInput(e.target.value)}
          onKeyDown={handleKey}
          spellCheck={false}
        />
        <button
          className="load-btn"
          onClick={handleLoad}
          disabled={loading || !pathInput.trim()}
        >
          {loading ? 'Loading…' : 'Load'}
        </button>
      </div>

      {/* ── Stats / error ── */}
      <div className="toolbar-info">
        {error && (
          <span className="toolbar-error" title={error}>
            ✗ {error}
          </span>
        )}
        {!error && stats && (
          <span className="toolbar-stats">
            {stats.visible} footprints
            {stats.skipped > 0 && (
              <span className="stats-skipped" title="Files with no spatial extent data">
                {' '}({stats.skipped} no extent)
              </span>
            )}
          </span>
        )}
      </div>

      {/* ── Type legend ── */}
      {counts.length > 0 && (
        <div className="toolbar-legend">
          {counts.map(([type, count]) => (
            <span key={type} className="legend-badge" style={{
              borderColor: TYPE_COLORS[type] || '#9e9e9e',
              color:       TYPE_COLORS[type] || '#9e9e9e',
            }}>
              <span
                className="legend-dot"
                style={{ background: TYPE_COLORS[type] || '#9e9e9e' }}
              />
              {count} {type}
            </span>
          ))}
        </div>
      )}

      {/* ── Terrain toggle ── */}
      <button
        className={`terrain-btn${terrainEnabled ? ' terrain-on' : ''}`}
        onClick={onToggleTerrain}
        title={terrainEnabled ? 'Terrain ON — click to disable' : 'Enable 3D terrain (requires MapTiler key)'}
      >
        ▲ {terrainEnabled ? 'Terrain ON' : 'Terrain'}
      </button>
    </div>
  )
}
