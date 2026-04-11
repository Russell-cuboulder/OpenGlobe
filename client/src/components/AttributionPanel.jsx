// Attribution panel — slides in from the right when a footprint is clicked

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

export default function AttributionPanel({ feature, onClose }) {
  if (!feature) return null

  const color   = TYPE_COLORS[feature.data_type] || '#9e9e9e'
  const isLidar = feature.data_type === 'Point Cloud'
  const isRaster = ['Raster', 'Elevation', 'Voxelite'].includes(feature.data_type)
  const isVector = feature.data_type === 'Vector'
  const isStereo = !!feature.stereo_role

  return (
    <div className="attr-panel">
      {/* Header */}
      <div className="attr-header" style={{ borderLeftColor: color }}>
        <div className="attr-header-text">
          <div className="attr-filename">{feature.filename}</div>
          <div className="attr-type" style={{ color }}>
            {feature.subtype || feature.data_type}
          </div>
        </div>
        <button className="attr-close" onClick={onClose} title="Close">✕</button>
      </div>

      {/* Fields */}
      <div className="attr-body">
        <Row label="Format"      value={feature.format} />
        <Row label="CRS"         value={feature.crs_name} />
        <Row label="Size"        value={feature.size_human} />

        {/* Raster fields */}
        {isRaster && <>
          <Row label="Resolution"  value={feature.resolution} />
          <Row label="Bands"       value={feature.bands} />
          <Row label="Band Types"  value={feature.band_dtypes} />
        </>}

        {/* LiDAR fields */}
        {isLidar && <>
          <Row label="Points"      value={formatPoints(feature.point_count)} />
          <Row label="Z Range"
            value={feature.z_min != null && feature.z_max != null
              ? `${feature.z_min.toFixed(1)} – ${feature.z_max.toFixed(1)} m`
              : null}
          />
        </>}

        {/* Vector fields */}
        {isVector && <>
          <Row label="Geometry"    value={feature.geom_type} />
          <Row label="Features"    value={feature.feature_count?.toLocaleString()} />
        </>}

        {/* Stereo */}
        {isStereo && <>
          <Row label="Stereo Role" value={feature.stereo_role} />
          <Row label="Stereo Pair" value={feature.stereo_pair} />
        </>}

        {/* Path — always last */}
        <div className="attr-path" title={feature.path}>
          <span className="attr-label">Path</span>
          <span className="attr-path-value">{feature.path}</span>
        </div>

        <button
          className="attr-copy-btn"
          onClick={() => navigator.clipboard?.writeText(feature.path)}
        >
          Copy Path
        </button>
      </div>
    </div>
  )
}
