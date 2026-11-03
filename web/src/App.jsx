import { useState } from 'react'
import logo from './assets/logo.svg'
import { WorkspaceProvider, useWorkspace } from './state/WorkspaceContext'
import ImportPanel from './components/ImportPanel'
import Dashboard from './components/Dashboard'
import ClinicalView from './components/ClinicalView'
import ClaimsPanel from './components/ClaimsPanel'
import IpsView from './components/IpsView'
import PiqiResults from './components/PiqiResults'
import WhatToDo from './components/WhatToDo'
import PatientBar from './components/PatientBar'
import PolicyNotice from './components/PolicyNotice'
import { LockScreen } from './components/Passcode'
import CheckinWallet from './components/CheckinWallet'
import { isCheckinMode } from './lib/checkin/session'
import FamilyOverview from './components/FamilyOverview'
import ComparePlans from './components/ComparePlans'
import SharePanel from './components/SharePanel'
import ConnectathonPanel from './components/ConnectathonPanel'
import RtbPanel from './components/RtbPanel'
import { MEDICAL_RTB, PHARMACY_RTB } from './lib/rtb/useCases'
import { DATASETS, DATASET_ORDER } from './lib/datasets'
import './App.css'

const TABS = [
  { key: 'import', label: 'Import' },
  { key: 'family', label: 'Family' },
  { key: 'data', label: 'My health' },
  { key: 'clinical', label: 'Clinical view' },
  { key: 'compare', label: 'Compare plans' },
  { key: 'share', label: 'Share & Export' },
  { key: 'connectathon', label: 'Connectathon' },
  { key: 'rtb-medical', label: 'Medical RTB' },
  { key: 'rtb-pharmacy', label: 'Pharmacy RTB' },
]

const DATA_VIEWS = [
  { key: 'view', label: 'View' },
  { key: 'score', label: 'PIQI score' },
  { key: 'todo', label: 'What to do' },
]

const ALL_RAW_KEY = 'all'

// The un-scored 4th option next to Clinical/IPS/Claims: every record from
// every data set, exactly as imported, with none of My health's dedup or
// grouping applied. Clinical view already does this for the clinical
// domains (which cover everything IPS draws from) and ClaimsPanel already
// does it for claims, so this is just the two side by side -- the point is
// to show the real scale and duplication of what actually came in.
function AllRawView({ sourceRecords, assertions }) {
  return (
    <div className="all-raw-view">
      <p className="section-help">
        Every record from every data set -- all clinical domains (which
        covers what IPS draws from too), plus insurance claims -- exactly as
        imported. Nothing merged, grouped, or filtered out. This is the real
        scale and duplication of what came in; see My health for the cleaned-
        up summary.
      </p>
      <ClinicalView sourceRecords={sourceRecords} assertions={assertions} />
      <ClaimsPanel />
    </div>
  )
}

// One data set (Clinical, IPS or Claims) with the same three screens each:
// see the data, see its PIQI score, and see what can be done about
// failures. A 4th, un-scored "All (raw)" option sits alongside them.
function DataArea({ sourceRecords, assertions }) {
  const [dataset, setDataset] = useState('clinical')
  const [view, setView] = useState('view')
  const isAllRaw = dataset === ALL_RAW_KEY

  return (
    <div className="data-area">
      <div className="dataset-switcher" role="group" aria-label="Data set">
        {DATASET_ORDER.map((key) => (
          <button
            key={key}
            type="button"
            aria-pressed={dataset === key}
            className={dataset === key ? 'active' : ''}
            onClick={() => setDataset(key)}
          >
            {DATASETS[key].label}
          </button>
        ))}
        <button
          type="button"
          aria-pressed={isAllRaw}
          className={isAllRaw ? 'active' : ''}
          onClick={() => setDataset(ALL_RAW_KEY)}
        >
          All (raw)
        </button>
      </div>
      {!isAllRaw && (
        <div className="data-tabs" role="tablist" aria-label={`${DATASETS[dataset].label} screens`}>
          {DATA_VIEWS.map((v) => (
            <button
              key={v.key}
              type="button"
              role="tab"
              aria-selected={view === v.key}
              className={view === v.key ? 'active' : ''}
              onClick={() => setView(v.key)}
            >
              {v.label}
            </button>
          ))}
        </div>
      )}
      {isAllRaw && <AllRawView sourceRecords={sourceRecords} assertions={assertions} />}
      {!isAllRaw && view === 'view' && dataset === 'clinical' && (
        <Dashboard sourceRecords={sourceRecords} assertions={assertions} />
      )}
      {!isAllRaw && view === 'view' && dataset === 'ips' && (
        <IpsView sourceRecords={sourceRecords} assertions={assertions} />
      )}
      {!isAllRaw && view === 'view' && dataset === 'claims' && <ClaimsPanel />}
      {!isAllRaw && view === 'score' && <PiqiResults key={dataset} dataset={dataset} />}
      {!isAllRaw && view === 'todo' && <WhatToDo key={dataset} dataset={dataset} />}
    </div>
  )
}

function AppContent() {
  const { sourceRecords, assertions, activePatient, security } = useWorkspace()
  const [tab, setTab] = useState('import')

  if (security.locked) {
    return (
      <div className="app-shell">
        <header className="app-header">
          <div className="app-header-title">
            <img src={logo} alt="" width="32" height="32" />
            <h1>M5 Whole Health</h1>
          </div>
          <p>Your patient-controlled health data workspace</p>
        </header>
        <main className="app-main">
          {isCheckinMode() && (
            <p className="import-message">A check-in website is waiting. Unlock M5 to choose what to share with it.</p>
          )}
          <LockScreen />
        </main>
      </div>
    )
  }

  if (isCheckinMode()) {
    return (
      <div className="app-shell">
        <header className="app-header">
          <div className="app-header-title">
            <img src={logo} alt="" width="32" height="32" />
            <h1>M5 Whole Health</h1>
          </div>
          <p>Check-in: choose what to share</p>
        </header>
        <PolicyNotice />
        <main className="app-main">
          <CheckinWallet />
        </main>
      </div>
    )
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="app-header-title">
          <img src={logo} alt="" width="32" height="32" />
          <h1>M5 Whole Health</h1>
        </div>
        <p>Your patient-controlled health data workspace</p>
      </header>
      <PolicyNotice />
      <PatientBar />
      <nav className="app-tabs" role="tablist" aria-label="Sections">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            id={`tab-${t.key}`}
            aria-selected={tab === t.key}
            aria-controls={`panel-${t.key}`}
            className={tab === t.key ? 'active' : ''}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </nav>
      <main
        className="app-main"
        role="tabpanel"
        id={`panel-${tab}`}
        aria-labelledby={`tab-${tab}`}
        tabIndex={-1}
      >
        {tab === 'import' && <ImportPanel />}
        {tab === 'family' && <FamilyOverview onOpen={() => setTab('data')} />}
        {tab === 'data' && (
          <>
            <h2 className="patient-heading">{activePatient?.name}</h2>
            <DataArea key={activePatient?.id} sourceRecords={sourceRecords} assertions={assertions} />
          </>
        )}
        {tab === 'clinical' && (
          <>
            <h2 className="patient-heading">{activePatient?.name}</h2>
            <p className="section-help">
              Provider view: every section as a table with codes, dates, all recorded details and sources.
            </p>
            <ClinicalView key={activePatient?.id} sourceRecords={sourceRecords} assertions={assertions} />
          </>
        )}
        {tab === 'compare' && <ComparePlans />}
        {tab === 'share' && (
          <SharePanel sourceRecords={sourceRecords} />
        )}
        {tab === 'connectathon' && <ConnectathonPanel />}
        {tab === 'rtb-medical' && <RtbPanel program={MEDICAL_RTB} />}
        {tab === 'rtb-pharmacy' && <RtbPanel program={PHARMACY_RTB} />}
      </main>
    </div>
  )
}

export default function App() {
  return (
    <WorkspaceProvider>
      <AppContent />
    </WorkspaceProvider>
  )
}
