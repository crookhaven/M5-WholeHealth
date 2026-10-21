import { useState } from 'react'
import { useWorkspace } from '../state/WorkspaceContext'
import { parseGatewayResult, linkChecksToRecords, GatewayResultError } from '../lib/piqi/gatewayResult'
import { attributeLabel } from '../lib/piqi/checkGuidance'
import { addedValueFor } from '../lib/piqi/checkKind'
import { DATASETS, buildDatasetMessage, datasetHasData } from '../lib/datasets'
import { downloadText } from '../lib/download'

function ResultLoader({ dataset }) {
  const { sourceRecords, assertions, claimsData, setGatewayResult, logActivity } = useWorkspace()
  const info = DATASETS[dataset]
  const hasData = datasetHasData(dataset, { sourceRecords, claimsData })

  const [uniqueOnly, setUniqueOnly] = useState(false)

  function downloadMessage() {
    const message = buildDatasetMessage(dataset, { sourceRecords, assertions, claimsData, uniqueOnly })
    const name = uniqueOnly ? info.fileName.replace(/\.json$/, '-distinct.json') : info.fileName
    downloadText(JSON.stringify(message, null, 2), name)
    logActivity({ action: 'Exported', detail: `${info.label} PIQI message${uniqueOnly ? ' (distinct records)' : ''}`, purpose: 'Downloaded to score data quality' })
  }

  const [text, setText] = useState('')
  const [error, setError] = useState(null)

  function load(raw) {
    try {
      const parsed = parseGatewayResult(raw)
      const isClaims = parsed.checks.some((c) => c.claims)
      if (isClaims && dataset !== 'claims') {
        throw new GatewayResultError('This is a claims result. Load it on the Claims data set instead.')
      }
      if (!isClaims && dataset === 'claims' && parsed.checks.length > 0) {
        throw new GatewayResultError('This is not a claims result. Load it on the Clinical or IPS data set instead.')
      }
      const linked = linkChecksToRecords(parsed, sourceRecords, assertions)
      setGatewayResult(dataset, { ...linked, loadedAt: new Date().toISOString() })
      logActivity({ action: 'Imported', detail: `${info.label} PIQI score result`, purpose: 'Data quality review' })
      setText('')
      setError(null)
    } catch (err) {
      setError(err instanceof GatewayResultError ? err.message : 'Could not read that result.')
    }
  }

  function handleFile(event) {
    const file = event.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => load(String(reader.result))
    reader.onerror = () => setError('Could not read that file.')
    reader.readAsText(file)
    event.target.value = ''
  }

  return (
    <section className="import-section">
      <h2>Score your {info.label} data with PIQI</h2>
      <ol className="steps">
        <li>
          Download the {info.label} PIQI message.
          <div className="button-row">
            <button type="button" disabled={!hasData} onClick={downloadMessage}>
              Download {info.label} PIQI message
            </button>
          </div>
          {dataset !== 'claims' && (
            <label className="plan-option">
              <input type="checkbox" checked={uniqueOnly} onChange={(e) => setUniqueOnly(e.target.checked)} /> Leave
              out exact copies. Each distinct record is scored once, so the score reflects the facts in the record
              rather than how often a source repeated them. Leave it unticked to score the data exactly as it came in.
            </label>
          )}
          {!hasData && <span className="local-note"> Import some data first.</span>}
        </li>
        <li>
          In the PIQI Gateway Test Client, choose {info.rubricHint} and &quot;Audit PIQI
          File&quot;, then run the file.
        </li>
        <li>Paste the result below, or upload it as a file.</li>
      </ol>
      <p>
        Only use synthetic or sample data with the Gateway; it asks that no real patient data
        be uploaded.
      </p>
      <label className="visually-hidden" htmlFor="gateway-result-text">
        Gateway result JSON
      </label>
      <textarea
        id="gateway-result-text"
        className="result-textarea"
        rows={6}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Paste the Gateway result JSON here"
      />
      <div className="button-row">
        <button type="button" disabled={!text.trim()} onClick={() => load(text)}>
          Load pasted result
        </button>
        <label className="file-label">
          Upload result file
          <input type="file" accept="application/json,.json" onChange={handleFile} />
        </label>
      </div>
      {error && <p className="import-error">{error}</p>}
    </section>
  )
}

export default function PiqiResults({ dataset = 'clinical' }) {
  const { gatewayResults, assertions, setGatewayResult } = useWorkspace()
  const gatewayResult = gatewayResults[dataset]

  if (!gatewayResult) {
    return (
      <div className="piqi-results">
        <p className="empty-state">
          No PIQI results loaded yet. These are the official results from the PIQI Gateway,
          shown exactly as the Gateway returned them.
        </p>
        <ResultLoader dataset={dataset} />
      </div>
    )
  }

  const r = gatewayResult
  const addedCount = r.checks.filter((c) => addedValueFor(c, assertions, r.loadedAt)).length
  const byClass = new Map()
  for (const check of r.checks) {
    if (!byClass.has(check.domain)) byClass.set(check.domain, [])
    byClass.get(check.domain).push(check)
  }

  return (
    <div className="piqi-results">
      <section className="score-card" aria-label="Official PIQI score">
        <div>
          <div className="score-profile">{r.profileName}</div>
          <div className="score-meta">
            Official result from the PIQI Gateway
            {r.messageID ? ` · message ${r.messageID}` : ''}
          </div>
        </div>
        <div className="score-stats">
          <div className="stat">
            <div className="stat-value">{r.score ?? '–'}</div>
            <div className="stat-label">PIQI score (out of 100)</div>
          </div>
          <div className="stat">
            <div className="stat-value">{r.criticalFailureCount}</div>
            <div className="stat-label">Critical failures</div>
          </div>
          <div className="stat">
            <div className="stat-value">
              {r.numerator}/{r.denominator}
            </div>
            <div className="stat-label">Checks passed</div>
          </div>
        </div>
      </section>

      {addedCount > 0 && (
        <p className="local-note">
          You added {addedCount} {addedCount === 1 ? 'value' : 'values'} since this result. The
          numbers above are still the official ones. Only a new PIQI audit can change them.
        </p>
      )}

      {r.classResults.length > 0 && (
        <section>
          <h2>Score by data class</h2>
          <table className="class-table">
            <thead>
              <tr>
                <th scope="col">Data class</th>
                <th scope="col">Score</th>
                <th scope="col">Critical failures</th>
              </tr>
            </thead>
            <tbody>
              {r.classResults.map((c) => (
                <tr key={c.name}>
                  <td>{c.name}</td>
                  <td>{c.score}</td>
                  <td>{c.criticalFailureCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <section>
        <h2>Checks that did not pass ({r.checks.length})</h2>
        {r.checks.length === 0 && <p className="empty-state">Every check passed.</p>}
        {[...byClass.entries()].map(([domain, checks]) => (
          <div key={domain} className="class-group">
            <h3>
              {domain} <span className="count">({checks.length})</span>
            </h3>
            {checks.map((check) => (
              <div key={check.id} className="finding-row">
                <div className="finding-main">
                  <div className="finding-title">
                    {check.elementLabel ? `${check.elementLabel}: ` : ''}
                    {attributeLabel(check)}
                    {check.critical && <span className="route-badge critical">Critical</span>}
                  </div>
                  <div className="finding-description">{check.assessment}</div>
                  {check.reason && <div className="finding-next-step">PIQI says: {check.reason}</div>}
                </div>
              </div>
            ))}
          </div>
        ))}
        {r.skippedCount > 0 && (
          <p className="local-note">
            {r.skippedCount} other checks were skipped because the value is empty. They are
            not scored as failures.
          </p>
        )}
      </section>

      <section>
        <div className="button-row">
          <button type="button" onClick={() => setGatewayResult(dataset, null)}>
            Load a different result
          </button>
        </div>
      </section>
    </div>
  )
}
