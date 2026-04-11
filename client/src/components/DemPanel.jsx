// DemPanel — bottom-left panel for downloading and managing local DEMs

import { useState } from 'react'

function fmtCoord(n) { return n.toFixed(4) + '°' }

function estimateSize(bbox) {
  const area = (bbox.east - bbox.west) * (bbox.north - bbox.south)
  const mb   = Math.round(area * 5)
  return mb < 1 ? '< 1 MB' : `~${mb} MB`
}

export default function DemPanel({
  drawnBbox, demList, activeDemId,
  onDownloaded, onToggleDem, onDeleteDem, onClose,
}) {
  const [downloading, setDownloading] = useState(false)
  const [dlError, setDlError]         = useState(null)

  const handleDownload = async () => {
    if (!drawnBbox) return
    setDownloading(true)
    setDlError(null)
    try {
      const res = await fetch('/api/terrain/download', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(drawnBbox),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.detail || 'Download failed')
      onDownloaded?.(data)
    } catch (e) {
      setDlError(e.message)
    } finally {
      setDownloading(false)
    }
  }

  return (
    <div className="dem-panel">

      {/* ── Pending bbox — ready to download ── */}
      {drawnBbox && (
        <div className="dem-section">
          <div className="dem-section-header">
            <span className="dem-section-title">New DEM Area</span>
            <button className="attr-close" onClick={onClose} title="Discard area">✕</button>
          </div>

          <div className="dem-bbox-grid">
            <span className="dem-bbox-label">N</span>
            <span className="dem-bbox-val">{fmtCoord(drawnBbox.north)}</span>
            <span className="dem-bbox-label">S</span>
            <span className="dem-bbox-val">{fmtCoord(drawnBbox.south)}</span>
            <span className="dem-bbox-label">W</span>
            <span className="dem-bbox-val">{fmtCoord(drawnBbox.west)}</span>
            <span className="dem-bbox-label">E</span>
            <span className="dem-bbox-val">{fmtCoord(drawnBbox.east)}</span>
          </div>

          <div className="dem-size-hint">
            GLO-30 · {estimateSize(drawnBbox)}
          </div>

          {dlError && (
            <div className="dem-error">{dlError}</div>
          )}

          <button
            className="dem-download-btn"
            onClick={handleDownload}
            disabled={downloading}
          >
            {downloading ? 'Downloading…' : '↓ Download GLO-30'}
          </button>
        </div>
      )}

      {/* ── Downloaded DEMs list ── */}
      {demList.length > 0 && (
        <div className="dem-section">
          {drawnBbox && <div className="dem-divider" />}
          <div className="dem-section-title" style={{ marginBottom: 6 }}>
            Downloaded DEMs
          </div>
          {demList.map(dem => {
            const active = dem.id === activeDemId
            return (
              <div key={dem.id} className={`dem-row${active ? ' dem-row-active' : ''}`}>
                <div className="dem-row-info">
                  <span className="dem-row-name">{dem.name}</span>
                  <span className="dem-row-meta">{dem.size_human}</span>
                </div>
                <div className="dem-row-actions">
                  <button
                    className={`dem-toggle-btn${active ? ' active' : ''}`}
                    onClick={() => onToggleDem?.(dem.id)}
                    title={active ? 'Deactivate terrain' : 'Use as terrain'}
                  >
                    {active ? '▲ ON' : '▲'}
                  </button>
                  <button
                    className="dem-delete-btn"
                    onClick={() => onDeleteDem?.(dem.id)}
                    title="Delete DEM"
                  >
                    ✕
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

    </div>
  )
}
