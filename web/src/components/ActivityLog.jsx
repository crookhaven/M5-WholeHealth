import { useWorkspace } from '../state/WorkspaceContext'
import { downloadText } from '../lib/download'
import { activityCsv } from '../lib/activityCsv'

function when(iso) {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString()
}


// Every import, change, export and share, with when and why, newest first.
export default function ActivityLog() {
  const { activity } = useWorkspace()
  const recent = [...activity].reverse()
  return (
    <section>
      <h2>Activity log</h2>
      <p className="section-help">
        What was done with the records in this browser: imports, changes, exports and shares, with the date, time and
        purpose. It&apos;s kept with your records (encrypted with them when you set a passcode) and never leaves this
        browser unless you download it.
      </p>
      {recent.length === 0 ? (
        <p className="section-help">Nothing yet.</p>
      ) : (
        <>
          <div className="table-scroll">
            <table className="activity-log">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Action</th>
                  <th>Patient</th>
                  <th>Details</th>
                  <th>Purpose</th>
                </tr>
              </thead>
              <tbody>
                {recent.slice(0, 200).map((e, i) => (
                  <tr key={`${e.at}-${i}`}>
                    <td>{when(e.at)}</td>
                    <td>{e.action}</td>
                    <td>{e.patient ?? ''}</td>
                    <td>{e.detail ?? ''}</td>
                    <td>{e.purpose ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button type="button" onClick={() => downloadText(activityCsv(activity), 'm5-activity-log.csv', 'text/csv')}>
            Download activity log (.csv)
          </button>
        </>
      )}
    </section>
  )
}
