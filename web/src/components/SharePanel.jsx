import { useState } from 'react'
import { DOMAIN_ORDER, DOMAINS, isDisplayOnly } from '../lib/domains'
import { useWorkspace } from '../state/WorkspaceContext'
import {
  selectedDomains,
  buildPdfSections,
  buildSharePackageBundle,
} from '../lib/exportData'
import { buildPiqiMessage } from '../lib/piqi/message'
import { downloadBlob, downloadText } from '../lib/download'
import { packageFileContent } from '../lib/shl/packageFile'
import ActivityLog from './ActivityLog'

export default function SharePanel({ sourceRecords }) {
  const { assertions, sharingSelection, setSharing, logActivity } = useWorkspace()
  const [shlResult, setShlResult] = useState(null)
  const [shlError, setShlError] = useState(null)
  const [building, setBuilding] = useState(false)

  const domainsWithData = DOMAIN_ORDER.filter((d) =>
    sourceRecords.some((r) => r.domain === d),
  )
  const domains = selectedDomains(sourceRecords, sharingSelection)
  const piqiDomains = domains.filter((d) => d !== 'coverage' && !isDisplayOnly(d))
  const sectionNames = (list) => list.map((d) => DOMAINS[d]?.label ?? d).join(', ')

  function handleExportPiqiMessage() {
    const message = buildPiqiMessage(sourceRecords, assertions, { domains: piqiDomains })
    downloadText(JSON.stringify(message, null, 2), 'm5-whole-health-piqi-message.json')
    logActivity({ action: 'Exported', detail: `PIQI message: ${sectionNames(piqiDomains)}`, purpose: 'Downloaded to score data quality' })
  }

  async function handleExportPdf() {
    const { buildPdfSummary } = await import('../lib/export/pdfExport')
    const sections = buildPdfSections(domains, sourceRecords, assertions)
    const blob = buildPdfSummary({ sections })
    downloadBlob(blob, 'm5-whole-health-summary.pdf')
    logActivity({ action: 'Exported', detail: `PDF summary: ${sectionNames(domains)}`, purpose: 'Downloaded by you' })
  }

  async function handleExportShl() {
    setBuilding(true)
    setShlError(null)
    setShlResult(null)
    try {
      const { buildShlPackage } = await import('../lib/shl/buildPackage')
      const { generateQrDataUrl } = await import('../lib/qr/generate')
      const bundle = buildSharePackageBundle(domains, sourceRecords, assertions)
      const pkg = await buildShlPackage(bundle, { label: 'M5 Whole Health export' })
      const qr = await generateQrDataUrl(pkg.shlUri)
      setShlResult({ ...pkg, qr, bundle })
      logActivity({ action: 'Shared', detail: `SMART Health Link created: ${sectionNames(domains)}`, purpose: 'Sharing with someone you choose' })
    } catch (err) {
      setShlError(err.message)
    } finally {
      setBuilding(false)
    }
  }

  function handleDownloadPackage() {
    if (!shlResult) return
    downloadText(JSON.stringify(packageFileContent(shlResult), null, 2), 'm5-whole-health-shl-package.json')
    logActivity({ action: 'Exported', detail: 'SMART Health Link package (encrypted)', purpose: 'Sharing with someone you choose' })
  }

  if (domainsWithData.length === 0) {
    return (
      <div className="share-panel">
        <div className="empty-state">
          Nothing to share yet. Import some health information first.
        </div>
        <ActivityLog />
      </div>
    )
  }

  return (
    <div className="share-panel">
      <section>
        <h2>Select information to share</h2>
        <div className="sharing-checkboxes">
          {domainsWithData.map((domain) => (
            <label key={domain}>
              <input
                type="checkbox"
                checked={sharingSelection[domain] !== false}
                onChange={(e) => setSharing(domain, e.target.checked)}
              />
              {DOMAINS[domain].label}
            </label>
          ))}
        </div>
      </section>

      <section>
        <h2>Export</h2>
        <div className="export-actions">
          <button type="button" onClick={handleExportPdf} disabled={domains.length === 0}>
            Export PDF summary
          </button>
          <button
            type="button"
            onClick={handleExportShl}
            disabled={domains.length === 0 || building}
          >
            {building ? 'Building...' : 'Create SMART Health Link package'}
          </button>
          <button
            type="button"
            onClick={handleExportPiqiMessage}
            disabled={piqiDomains.length === 0}
          >
            Export PIQI message (.json)
          </button>
        </div>
        {piqiDomains.length === 0 && domains.length > 0 && (
          <p className="import-message">
            Only Coverage is selected, which isn't part of the PIQI Clinical
            Data Model, so there's nothing to include in a PIQI message.
          </p>
        )}

        {shlError && <p className="import-error">{shlError}</p>}

        {shlResult && (
          <div className="shl-result">
            <p>
              M5 Whole Health has no server to host the encrypted record, so share two
              things together: this link (or its QR code) and the package file
              below. The package holds the encrypted record and the link holds
              the key; neither can be read alone. The recipient opens them in M5
              Health under Import, SMART Health Link: paste the link, then upload
              the package file. Other SMART Health Link apps can't open it.
            </p>
            <img src={shlResult.qr} alt="QR code for the generated SMART Health Link" />
            <code className="shl-uri">{shlResult.shlUri}</code>
            <button type="button" onClick={handleDownloadPackage}>
              Download package (.json)
            </button>
          </div>
        )}
      </section>
      <ActivityLog />
    </div>
  )
}
