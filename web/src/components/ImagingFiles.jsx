import { useState } from 'react'
import { downloadBlob } from '../lib/download'
import { useActivityLogger } from '../state/WorkspaceContext'

const MAX_DOWNLOAD_BYTES = 1.5 * 1024 ** 3 // a browser holds the whole study in memory
const MAX_ZIP_ENTRIES = 65535

function size(bytes) {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  return `${Math.max(1, Math.round(bytes / 1024))} KB`
}

// The original DICOM images of a study that came in a SMART Health Link for
// imaging (shlink-dicom): what's there, a link to view them, and a download.
export default function ImagingFiles({ record }) {
  const dicom = record.data?.dicom
  const [busy, setBusy] = useState(null)
  const logActivity = useActivityLogger()
  const [error, setError] = useState(null)
  if (record.data?.dicomError) {
    return <p className="record-source">Images were included, but their index could not be read: {record.data.dicomError}</p>
  }
  if (!dicom) return null

  const shlUri = record.raw?.shlUri
  const tooBig = dicom.totalBytes > MAX_DOWNLOAD_BYTES || dicom.instanceCount > MAX_ZIP_ENTRIES

  async function download() {
    setError(null)
    setBusy(0)
    try {
      const { studyInstances, zipStore } = await import('../lib/shl/dicomFiles')
      const files = await studyInstances(dicom, dicom.baseUrl, { onProgress: (p) => setBusy(p) })
      const name = (record.data.title ?? 'imaging-study').replace(/[^\w.-]+/g, '-').slice(0, 60)
      downloadBlob(zipStore(files), `${name}-dicom.zip`)
      logActivity({ action: 'Exported', detail: `Imaging files: ${record.data.title ?? 'imaging study'}`, purpose: 'Downloaded by you' })
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(null)
    }
  }

  async function openViewer() {
    const { viewerUrl } = await import('../lib/shl/dicomFiles')
    window.open(viewerUrl(shlUri), '_blank', 'noopener,noreferrer')
  }

  return (
    <div className="imaging-files">
      <p>
        <strong>Images included:</strong> {dicom.series.length} series, {dicom.instanceCount} images,{' '}
        {size(dicom.totalBytes)}. The original DICOM files, encrypted; each piece is checked as it is decrypted.
      </p>
      <details>
        <summary>Series</summary>
        <ul>
          {dicom.series.map((s, i) => (
            <li key={s.uid ?? i}>
              {[s.number !== null ? `#${s.number}` : null, s.modality, s.description].filter(Boolean).join(' · ') || `Series ${i + 1}`}
              : {s.lengths.length} {s.lengths.length === 1 ? 'image' : 'images'}, {size(s.bytes)}
            </li>
          ))}
        </ul>
      </details>
      <div className="button-row">
        {shlUri && (
          <button type="button" onClick={openViewer}>
            View images
          </button>
        )}
        {dicom.baseUrl && (
          <button type="button" onClick={download} disabled={busy !== null || tooBig}>
            {busy !== null ? `Downloading… ${Math.round(busy * 100)}%` : 'Download images (DICOM .zip)'}
          </button>
        )}
      </div>
      {shlUri && (
        <p className="record-source">
          View images opens the shlink-dicom viewer (shlink-dicom.exe.xyz) in a new tab with this link. The viewer
          decrypts in your browser; the link&apos;s key is after the # in the address, which browsers never send to a
          server.
        </p>
      )}
      {tooBig && dicom.baseUrl && <p className="record-source">This study is too large to download in the browser; use the viewer&apos;s download.</p>}
      {!dicom.baseUrl && (
        <p className="record-source">This link delivered its data inline, so its image files can&apos;t be located. Ask for a link made with shlink-dicom.</p>
      )}
      {error && <p className="import-error">{error}</p>}
    </div>
  )
}
