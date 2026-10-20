// The activity log as a spreadsheet-friendly CSV file.
export function activityCsv(activity) {
  const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`
  const rows = activity.map((e) => [e.at, e.action, e.patient, e.detail, e.purpose].map(cell).join(','))
  return ['"Date and time (UTC)","Action","Patient","Details","Purpose"', ...rows].join('\n') + '\n'
}
