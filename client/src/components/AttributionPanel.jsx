// Attribution panel — slides in from the right when a footprint or country is clicked
import { useState } from 'react'

const TYPE_COLORS = {
  'Voxelite':    '#ff9800',
  'Elevation':   '#ffcc80',
  'Raster':      '#a5d6a7',
  'Point Cloud': '#f48fb1',
  'Vector':      '#4fc3f7',
  'CAD':         '#80cbc4',
  'Grid':        '#ce93d8',
  'Project':     '#ffe082',
  'Country':     '#90caf9',
}

function Row({ label, value }) {
  if (value === null || value === undefined || value === '' || value === '—') return null
  return (
    <div className="attr-row">
      <span className="attr-label">{label}</span>
      <span className="attr-value">{String(value)}</span>
    </div>
  )
}

function formatPoints(n) {
  if (!n) return null
  return n >= 1_000_000
    ? `${(n / 1_000_000).toFixed(2)}M pts`
    : `${n.toLocaleString()} pts`
}

function formatPop(n) {
  if (!n) return null
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)}B`
  if (n >= 1_000_000)     return `${(n / 1_000_000).toFixed(1)}M`
  return n.toLocaleString()
}

function formatGdp(n) {
  if (!n) return null
  // GDP_MD is in millions USD
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}T`
  if (n >= 1_000)     return `$${(n / 1_000).toFixed(1)}B`
  return `$${n.toLocaleString()}M`
}

const TOOL_LABEL = {
  'Point Cloud': 'OpenLiDAR',
  'Voxelite':   'OpenVoxelite',
}

function pickTool(data_type, stereo_role) {
  if (stereo_role)              return 'OpenStereo'
  return TOOL_LABEL[data_type] || 'OpenGeoLook'
}

export default function AttributionPanel({ feature, onClose, onLoadData }) {
  const [launching, setLaunching] = useState(false)
  const [launchMsg, setLaunchMsg] = useState(null)

  if (!feature) return null

  const color     = TYPE_COLORS[feature.data_type] || '#9e9e9e'
  const isLidar   = feature.data_type === 'Point Cloud'
  const isRaster  = ['Raster', 'Elevation', 'Voxelite'].includes(feature.data_type)
  const isVector  = feature.data_type === 'Vector'
  const isStereo  = !!feature.stereo_role
  const isCountry = feature.data_type === 'Country'
  const toolName  = pickTool(feature.data_type, feature.stereo_role)

  const handleOpenInSuite = async () => {
    setLaunching(true)
    setLaunchMsg(null)
    try {
      const res = await fetch('/api/open', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          path:        feature.path,
          data_type:   feature.data_type  || '',
          stereo_role: feature.stereo_role || '',
        }),
      })
      const data = await res.json()
      if (data.launched) {
        setLaunchMsg(`✓ Opened in ${data.tool}`)
      } else {
        setLaunchMsg(`${data.tool} not installed`)
      }
    } catch (e) {
      setLaunchMsg('Launch failed')
    } finally {
      setLaunching(false)
      setTimeout(() => setLaunchMsg(null), 3000)
    }
  }

  return (
    <div className="attr-panel">
      {/* Header */}
      <div className="attr-header" style={{ borderLeftColor: color }}>
        <div className="attr-header-text">
          <div className="attr-filename">{feature.filename}</div>
          <div className="attr-type" style={{ color }}>
            {isCountry ? 'Country' : (feature.subtype || feature.data_type)}
          </div>
        </div>
        <button className="attr-close" onClick={onClose} title="Close">✕</button>
      </div>

      {/* Fields */}
      <div className="attr-body">

        {/* ── Country fields ── */}
        {isCountry && <>
          {feature.sovereignt && feature.sovereignt !== feature.filename && (
            <Row label="Sovereign"  value={feature.sovereignt} />
          )}
          <Row label="ISO A2"     value={feature.iso_a2} />
          <Row label="ISO A3"     value={feature.iso_a3} />
          <Row label="Continent"  value={feature.continent} />
          <Row label="Region"     value={feature.region} />
          <Row label="Population" value={formatPop(feature.pop_est)} />
          <Row label="GDP"        value={formatGdp(feature.gdp_md)} />
          <Row label="Economy"    value={feature.economy} />
          <Row label="Income"     value={feature.income_grp} />
        </>}

        {/* ── Dataset fields ── */}
        {!isCountry && <>
          <Row label="Format"      value={feature.format} />
          <Row label="CRS"         value={feature.crs_name} />
          <Row label="Size"        value={feature.size_human} />

          {isRaster && <>
            <Row label="Resolution"  value={feature.resolution} />
            <Row label="Bands"       value={feature.bands} />
            <Row label="Band Types"  value={feature.band_dtypes} />
          </>}

          {isLidar && <>
            <Row label="Points"      value={formatPoints(feature.point_count)} />
            <Row label="Z Range"
              value={feature.z_min != null && feature.z_max != null
                ? `${feature.z_min.toFixed(1)} – ${feature.z_max.toFixed(1)} m`
                : null}
            />
          </>}

          {isVector && <>
            <Row label="Geometry"    value={feature.geom_type} />
            <Row label="Features"    value={feature.feature_count?.toLocaleString()} />
          </>}

          {isStereo && <>
            <Row label="Stereo Role" value={feature.stereo_role} />
            <Row label="Stereo Pair" value={feature.stereo_pair} />
          </>}

          {/* Path — always last for dataset features */}
          <div className="attr-path" title={feature.path}>
            <span className="attr-label">Path</span>
            <span className="attr-path-value">{feature.path}</span>
          </div>

          <div className="attr-actions">
            <button
              className="attr-copy-btn"
              onClick={() => navigator.clipboard?.writeText(feature.path)}
            >
              Copy Path
            </button>
            <button
              className="attr-open-btn"
              onClick={handleOpenInSuite}
              disabled={launching}
              title={`Open this file in ${toolName} on the desktop`}
            >
              {launching ? 'Launching…' : `Open in ${toolName}`}
            </button>
          </div>
          {launchMsg && (
            <div className="attr-launch-msg">{launchMsg}</div>
          )}
          {!isCountry && (
            <button
              className="attr-load-btn"
              onClick={() => onLoadData?.(feature)}
              title="Stream actual geometry onto the globe"
            >
              ⬡ Load on Globe
            </button>
          )}
        </>}

      </div>
    </div>
  )
}
