import { useState } from 'react'
import { useWorkspace } from '../state/WorkspaceContext'
import { createSourceRecord, validateCoveragePlan } from '../lib/sourceRecord'
import { normalizeFhirBundle } from '../lib/fhir/normalize'
import SmartConnect from './SmartConnect'
import { PasscodeSection } from './Passcode'
import { CATALOG_URL, OSP_REPO, bundleToRecords, catalogPatients, fetchFromGitHub } from '../lib/openSyntheticPatients'
import { parseShlUri, requiresPasscode } from '../lib/shl/parse'
import { isPackageOnlyLink } from '../lib/shl/packageFile'
import { REQUIRED_FIELDS, FIELD_LABELS, recordLabel, IDENTITY_FIELDS, DATE_FIELDS } from '../lib/piqi/rules'
import { wrapAssertionValue } from '../lib/piqi/engine'
import { DOMAINS } from '../lib/domains'
import { summarizeForDisplay } from '../lib/dedup'
import samplePatient from '../data/sample_fhir_bundle.json'
import samplePlan from '../data/sample_plan_data.json'

// How many raw FHIR resources actually came in, and how much of that was
// reducible noise -- useful when a source (an aggregator pulling from
// several provider/payer systems, say) hands back the same facts many
// times over. Counts only; the raw bundle itself is not kept around.
function tallyResourceTypes(bundles) {
  const counts = new Map()
  for (const bundle of bundles) {
    for (const entry of bundle?.entry ?? []) {
      const type = entry.resource?.resourceType
      if (!type) continue
      counts.set(type, (counts.get(type) ?? 0) + 1)
    }
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])
}

function countAfterCollapse(normalized) {
  const byDomain = new Map()
  for (const record of normalized) {
    if (!byDomain.has(record.domain)) byDomain.set(record.domain, [])
    byDomain.get(record.domain).push(record)
  }
  let total = 0
  for (const [domain, records] of byDomain) {
    const titled = records.filter((r) => recordLabel(domain, r.data) !== 'Untitled record')
    total += summarizeForDisplay(domain, titled, (r) => r.data, IDENTITY_FIELDS[domain], DATE_FIELDS[domain]).length
  }
  return total
}

const MAX_STORED_PDF_BYTES = 500 * 1024

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = () => reject(new Error('Could not read that file.'))
    reader.readAsDataURL(file)
  })
}

function SampleImport() {
  const { addRecords } = useWorkspace()
  const [message, setMessage] = useState(null)

  function loadSampleRecord() {
    const normalized = normalizeFhirBundle(samplePatient)
    const records = normalized.map(({ domain, data }) =>
      createSourceRecord({
        sourceType: 'sample',
        documentName: 'sample_fhir_bundle.json',
        domain,
        data,
      }),
    )
    addRecords(records)
    setMessage(`Loaded ${records.length} records from the sample health record.`)
  }

  function loadSamplePlan() {
    addRecords([
      createSourceRecord({
        sourceType: 'sample',
        documentName: 'sample_plan_data.json',
        domain: 'coverage',
        data: samplePlan,
      }),
    ])
    setMessage('Loaded the sample coverage plan.')
  }

  return (
    <section className="import-section">
      <h2>Sample data</h2>
      <p>No real data on hand yet? Load bundled samples to try the app.</p>
      <p>
        Where this data comes from: nothing is fetched from a live service.
        Both samples are static files bundled with the app. The sample health
        record is a small, hand-written FHIR Bundle for a fictional patient
        (Jordan Rivera), with a few intentional duplicates and gaps so the
        PIQI checks have something to find. The sample coverage plan is a
        public 2026 ACA Marketplace plan, saved from a CMS Marketplace API plan
        search for a made-up household. It is not anyone's own coverage and is
        for testing the display only; it is not live plan data.
      </p>
      <div className="button-row">
        <button type="button" onClick={loadSampleRecord}>
          Load sample health record
        </button>
        <button type="button" onClick={loadSamplePlan}>
          Load sample coverage plan
        </button>
      </div>
      {message && <p className="import-message">{message}</p>}
    </section>
  )
}

function CoverageImport() {
  const { addRecords } = useWorkspace()
  const [error, setError] = useState(null)

  function handleFile(event) {
    const file = event.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const parsed = validateCoveragePlan(JSON.parse(reader.result))
        addRecords([
          createSourceRecord({
            sourceType: 'file-upload',
            documentName: file.name,
            domain: 'coverage',
            data: parsed,
          }),
        ])
        setError(null)
      } catch (err) {
        setError(err.message)
      }
    }
    reader.onerror = () => setError('Could not read that file.')
    reader.readAsText(file)
    event.target.value = ''
  }

  return (
    <section className="import-section">
      <h2>Coverage plan (JSON)</h2>
      <label className="file-label">
        Choose coverage plan JSON file
        <input type="file" accept="application/json,.json" onChange={handleFile} />
      </label>
      {error && <p className="import-error">{error}</p>}
    </section>
  )
}

function OpenSyntheticPatientsImport() {
  const { addRecords, addClaims, addPatient, renamePatient, activeId, sourceRecords, claimsData } = useWorkspace()
  const [patients, setPatients] = useState(null)
  const [busy, setBusy] = useState(null)
  const [status, setStatus] = useState(null)
  const [error, setError] = useState(null)

  async function loadCatalog() {
    setBusy('catalog')
    setError(null)
    try {
      setPatients(catalogPatients(await fetchFromGitHub(CATALOG_URL)))
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(null)
    }
  }

  async function loadPatient(patient) {
    setBusy(patient.slug)
    setError(null)
    try {
      const bundle = await fetchFromGitHub(patient.url)
      const { records, claimsData: claims } = bundleToRecords(bundle, {
        sourceType: 'open-synthetic-patients',
        documentName: `${patient.slug}/bundle.json`,
      })
      // Reuse an empty patient slot; otherwise each sample becomes its own patient.
      const empty = sourceRecords.length === 0 && !claimsData
      if (empty) renamePatient(activeId, patient.name)
      else addPatient(patient.name)
      addRecords(records)
      if (claims) addClaims(claims)
      setStatus(
        `Loaded ${patient.name}${empty ? '' : ' as a new patient'}: ${records.length} records` +
          (claims ? ` and ${claims.claims.length} insurance claims` : '') +
          '.',
      )
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(null)
    }
  }

  return (
    <section className="import-section">
      <h2>Sample patients from open-synthetic-patients</h2>
      <p>
        Load a made-up test patient straight from the{' '}
        <a href={OSP_REPO} target="_blank" rel="noreferrer">
          open-synthetic-patients
        </a>{' '}
        collection on GitHub. Each one is loaded as its own patient.
      </p>
      {!patients && (
        <button type="button" onClick={loadCatalog} disabled={busy === 'catalog'}>
          {busy === 'catalog' ? 'Loading the list…' : 'Show the patients'}
        </button>
      )}
      {patients && (
        <ul className="scenario-list">
          {patients.map((p) => (
            <li key={p.slug}>
              <button type="button" onClick={() => loadPatient(p)} disabled={busy !== null}>
                {busy === p.slug ? 'Loading…' : `Load ${p.name}`}
              </button>{' '}
              {p.summary}
            </li>
          ))}
        </ul>
      )}
      {status && <p className="import-message">{status}</p>}
      {error && <p className="import-error">{error}</p>}
    </section>
  )
}

function FhirBundleImport() {
  const { addRecords, addClaims } = useWorkspace()
  const [status, setStatus] = useState(null)
  const [error, setError] = useState(null)

  function handleFile(event) {
    const file = event.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const bundle = JSON.parse(reader.result)
        const { records, claimsData } = bundleToRecords(bundle, {
          sourceType: 'fhir-bundle-upload',
          documentName: file.name,
        })
        addRecords(records)
        if (claimsData) addClaims(claimsData)
        setStatus(
          `Imported ${records.length} records from ${file.name}.` +
            (claimsData ? ` Also kept ${claimsData.claims.length} insurance claims (see My health, then Claims).` : ''),
        )
        setError(null)
      } catch (err) {
        setError(err.message)
      }
    }
    reader.onerror = () => setError('Could not read that file.')
    reader.readAsText(file)
    event.target.value = ''
  }

  return (
    <section className="import-section">
      <h2>FHIR Bundle (JSON)</h2>
      <p>
        Upload a single FHIR Bundle -- for example a per-patient sample from
        Synthea-generated test data or another synthetic dataset. This is not
        for real patient records: prefer the SMART Health Link importer above
        for those, and never upload files containing PHI to a third party.
      </p>
      <label className="file-label">
        Choose FHIR Bundle JSON file
        <input type="file" accept="application/json,.json" onChange={handleFile} />
      </label>
      {status && <p className="import-message">{status}</p>}
      {error && <p className="import-error">{error}</p>}
    </section>
  )
}

const PDF_DOMAINS = [
  'demographics',
  'allergies',
  'conditions',
  'immunizations',
  'labResults',
  'medications',
  'procedures',
  'vitalSigns',
  'medicalDevices',
  'healthAssessments',
]

function PdfImport() {
  const { addRecords } = useWorkspace()
  const [fileName, setFileName] = useState(null)
  const [text, setText] = useState('')
  const [dataUrl, setDataUrl] = useState(null)
  const [domain, setDomain] = useState('medications')
  const [fields, setFields] = useState({})
  const [error, setError] = useState(null)
  const [addedCount, setAddedCount] = useState(0)
  const [extracting, setExtracting] = useState(false)

  async function handleFile(event) {
    const file = event.target.files?.[0]
    if (!file) return
    setError(null)
    setAddedCount(0)
    setExtracting(true)
    try {
      const buffer = await file.arrayBuffer()
      const { extractPdfText } = await import('../lib/pdf/extractText')
      const extracted = await extractPdfText(buffer)
      setText(extracted)
      setFileName(file.name)
      setDataUrl(file.size <= MAX_STORED_PDF_BYTES ? await fileToDataUrl(file) : null)
    } catch {
      setError('Could not read that PDF.')
    } finally {
      setExtracting(false)
    }
    event.target.value = ''
  }

  function updateField(field, value) {
    setFields((prev) => ({ ...prev, [field]: value }))
  }

  function handleAddRecord() {
    const wrapped = Object.fromEntries(
      Object.entries(fields).map(([field, value]) => [field, wrapAssertionValue(domain, field, value)]),
    )
    addRecords([
      createSourceRecord({
        sourceType: 'pdf-upload',
        documentName: fileName,
        domain,
        data: wrapped,
        raw: { extractedText: text, fileDataUrl: dataUrl },
      }),
    ])
    setFields({})
    setAddedCount((n) => n + 1)
  }

  return (
    <section className="import-section">
      <h2>Health PDF</h2>
      <p>
        Upload a health-related PDF (visit summary, lab report, Apple Health
        export, plan document). Text is extracted automatically; structured
        fields still need your confirmation since PDFs vary too much to parse
        reliably.
      </p>
      <label className="file-label">
        Choose health PDF file
        <input
          type="file"
          accept="application/pdf,.pdf"
          onChange={handleFile}
          disabled={extracting}
        />
      </label>
      {extracting && <p className="import-message">Extracting text...</p>}
      {error && <p className="import-error">{error}</p>}

      {fileName && (
        <div className="pdf-result">
          <h3>Extracted text: {fileName}</h3>
          <textarea readOnly value={text} rows={8} />

          <h3>Add information from this document</h3>
          {addedCount > 0 && (
            <p className="import-message">Added {addedCount} record(s) so far.</p>
          )}
          <label>
            Domain
            <select value={domain} onChange={(e) => { setDomain(e.target.value); setFields({}) }}>
              {PDF_DOMAINS.map((d) => (
                <option key={d} value={d}>
                  {DOMAINS[d]?.label ?? d}
                </option>
              ))}
            </select>
          </label>
          <div className="pdf-field-grid">
            {(REQUIRED_FIELDS[domain] ?? []).map((field) => (
              <label key={field}>
                {FIELD_LABELS[field] ?? field}
                <input
                  type="text"
                  value={fields[field] ?? ''}
                  onChange={(e) => updateField(field, e.target.value)}
                />
              </label>
            ))}
          </div>
          <button type="button" onClick={handleAddRecord}>
            Add record
          </button>
        </div>
      )}
    </section>
  )
}

function ShlImport() {
  const { addRecords } = useWorkspace()
  const [url, setUrl] = useState('')
  const [passcode, setPasscode] = useState('')
  const [needsPasscode, setNeedsPasscode] = useState(false)
  const [status, setStatus] = useState(null)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [importSummary, setImportSummary] = useState(null)

  async function handleRetrieve() {
    setBusy(true)
    setError(null)
    setStatus(null)
    setImportSummary(null)
    try {
      const { retrieveShl, extractFhirBundlesWithBase } = await import('../lib/shl/retrieve')
      const payload = parseShlUri(url)
      if (isPackageOnlyLink(payload)) {
        throw new Error(
          'This link was made by M5 Whole Health and has no online copy. Upload the package file that came with it (m5-whole-health-shl-package.json) below.',
        )
      }
      if (requiresPasscode(payload)) setNeedsPasscode(true)
      const { manifest, files } = await retrieveShl(payload, {
        passcode: passcode || undefined,
      })
      const withBase = await extractFhirBundlesWithBase(files)
      const bundles = withBase.map((b) => b.bundle)
      // Imaging studies with their own DICOM files need to know where the
      // files are: beside the Bundle they came in.
      const normalized = withBase.flatMap(({ bundle, baseUrl }) =>
        normalizeFhirBundle(bundle).map((n) =>
          n.data?.dicom ? { ...n, data: { ...n.data, dicom: { ...n.data.dicom, baseUrl } } } : n,
        ),
      )
      const records = normalized.map(({ domain, data }) =>
        createSourceRecord({
          sourceType: 'smart-health-link',
          documentName: payload.label || payload.url,
          domain,
          data,
          raw: { shlUri: url, manifest },
        }),
      )
      addRecords(records)
      const studies = normalized.filter((n) => n.data?.dicom)
      setStatus(
        `Retrieved and imported ${records.length} records.` +
          (studies.length
            ? ` ${studies.length} imaging ${studies.length === 1 ? 'study came' : 'studies came'} with images; open them from Imaging.`
            : ''),
      )
      setImportSummary({
        rawTally: tallyResourceTypes(bundles),
        rawTotal: bundles.reduce((n, b) => n + (b?.entry?.length ?? 0), 0),
        recordTotal: records.length,
        afterCollapse: countAfterCollapse(normalized),
      })
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  // A package file from M5's "Create SMART Health Link package": decrypted with
  // the key in the pasted link (older packages carry their own key).
  async function handlePackageFile(event) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setBusy(true)
    setError(null)
    setStatus(null)
    try {
      const { openPackageFile, recordsFromShareContent } = await import('../lib/shl/packageFile')
      const { label, contents } = await openPackageFile(await file.text(), url)
      const found = []
      for (const content of contents) {
        if (content?.records) found.push(...recordsFromShareContent(content))
        else found.push(...normalizeFhirBundle(content))
      }
      if (found.length === 0) throw new Error('The package opened, but it has no records in it.')
      addRecords(
        found.map(({ domain, data }) =>
          createSourceRecord({ sourceType: 'smart-health-link', documentName: label || file.name, domain, data, raw: { packageFile: file.name } }),
        ),
      )
      setStatus(`Opened the package and imported ${found.length} records.`)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function handleQrFile(event) {
    const file = event.target.files?.[0]
    if (!file) return
    setError(null)
    try {
      const { decodeQrFromImageFile } = await import('../lib/qr/decodeImage')
      const decoded = await decodeQrFromImageFile(file)
      setUrl(decoded)
    } catch (err) {
      setError(err.message)
    }
    event.target.value = ''
  }

  return (
    <section className="import-section">
      <h2>SMART Health Link</h2>
      <p>Paste an SHL URL, or upload an image of its QR code.</p>
      <label className="file-label">
        SMART Health Link URL
        <input
          type="text"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="shlink:/... or https://...#shlink:/..."
        />
      </label>
      <label className="file-label">
        Upload QR code image
        <input type="file" accept="image/*" onChange={handleQrFile} />
      </label>
      {needsPasscode && (
        <label className="file-label">
          Passcode
          <input
            type="password"
            value={passcode}
            onChange={(e) => setPasscode(e.target.value)}
            placeholder="Passcode"
          />
        </label>
      )}
      <button type="button" onClick={handleRetrieve} disabled={!url || busy}>
        {busy ? 'Retrieving...' : 'Retrieve'}
      </button>
      <p>
        Got a link from M5 Whole Health together with a package file? Paste the link above, then upload
        the package file here.
      </p>
      <label className="file-label">
        Upload SHL package file
        <input type="file" accept="application/json,.json" onChange={handlePackageFile} disabled={busy} />
      </label>
      {status && <p className="import-message">{status}</p>}
      {importSummary && (
        <details className="import-summary">
          <summary>
            {importSummary.rawTotal.toLocaleString()} FHIR resources came in as {importSummary.recordTotal.toLocaleString()} records
            {importSummary.afterCollapse < importSummary.recordTotal && (
              <> &mdash; your Dashboard will show about {importSummary.afterCollapse.toLocaleString()} of those
                (exact duplicates merged, and things reaffirmed at nearly every visit -- an ongoing condition, a
                tobacco-use status -- condensed down to the latest one). Every instance is still in Clinical view</>
            )}
            . What came in, by type:
          </summary>
          <ul className="import-tally">
            {importSummary.rawTally.map(([type, count]) => (
              <li key={type}>
                {type}: {count.toLocaleString()}
              </li>
            ))}
          </ul>
        </details>
      )}
      {error && <p className="import-error">{error}</p>}
    </section>
  )
}

export default function ImportPanel() {
  return (
    <div className="import-panel">
      <p className="local-note">
        <strong>Your records stay in this browser.</strong> M5 has no server and doesn&apos;t send your data
        anywhere unless you choose to: scoring with the PIQI Gateway (an outside service), sharing a link or
        PDF, or pasting a summary into Claude. See the <a href="terms.html">terms</a> and{' '}
        <a href="privacy.html">privacy policy</a>.
      </p>
      <PasscodeSection />
      <SmartConnect />
      <SampleImport />
      <OpenSyntheticPatientsImport />
      <CoverageImport />
      <FhirBundleImport />
      <PdfImport />
      <ShlImport />
    </div>
  )
}
