// Pure function — turn raw safety data into a risk badge.
//
// Inputs:
//   counts: NTSB recent (90d) counts { fatal, hull_loss, serious_incident,
//     incident, minor, unknown, total } from /api/safety/operators/:code,
//     or null when unavailable.
//   globalMatch: AirCrash historical row { name, count, fatalities }, or null.
//
// Output: { level: 'green' | 'yellow' | 'red' | 'none', label, summary }
// where label is the headline ("Clean record", "1 fatal incident in 90d") and
// summary is supporting context for tooltips ("12 historical accidents on file").

const HISTORICAL_WARN_THRESHOLD = 50;

function num(v) { return Number.isFinite(Number(v)) ? Number(v) : 0; }

export function getRiskLevel({ counts, globalMatch } = {}) {
  const fatal = num(counts?.fatal);
  const serious = num(counts?.serious_incident);
  const total = num(counts?.total);
  const histCount = num(globalMatch?.count);
  const histFatalities = num(globalMatch?.fatalities);

  // No data at all.
  if (!counts && !globalMatch) {
    return { level: 'none', label: '', summary: '' };
  }

  // Recent fatal — most severe signal regardless of history.
  if (fatal > 0) {
    return {
      level: 'red',
      label: fatal === 1 ? '1 fatal incident · 90d' : `${fatal} fatal incidents · 90d`,
      summary: histCount > 0 ? `${histCount} on historical file` : '',
    };
  }

  // Recent serious — yellow.
  if (serious > 0) {
    return {
      level: 'yellow',
      label: serious === 1 ? '1 serious incident · 90d' : `${serious} serious incidents · 90d`,
      summary: histCount > 0 ? `${histCount} on historical file` : '',
    };
  }

  // Any recent incidents at all — yellow.
  if (total > 0) {
    return {
      level: 'yellow',
      label: total === 1 ? '1 incident · 90d' : `${total} incidents · 90d`,
      summary: histCount > 0 ? `${histCount} on historical file` : '',
    };
  }

  // No recent activity. History tips us yellow if it's significant, else green.
  if (histCount >= HISTORICAL_WARN_THRESHOLD) {
    const fatalNote = histFatalities > 0 ? ` · ${histFatalities} fatalities` : '';
    return {
      level: 'yellow',
      label: 'Significant historical record',
      summary: `${histCount} accidents on file${fatalNote}`,
    };
  }

  return {
    level: 'green',
    label: 'Clean recent record',
    summary: histCount > 0 ? `${histCount} on historical file` : '',
  };
}
