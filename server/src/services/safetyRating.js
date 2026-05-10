// server/src/services/safetyRating.js

/**
 * Pure helpers for the SEO safety color band and event lists.
 *
 * Color buckets reflect time since the most recent fatal hull loss.
 * They are not a numeric safety score and do not normalise for
 * utilisation — see the disclaimer baked next to every band by the
 * builder.
 */

// Average year in ms, including leap-year fractional days. We accept ~2.5
// day drift at bucket boundaries (e.g. an event exactly 5 calendar years
// ago lands in 'orange' rather than 'yellow') because: real accident dates
// almost never fall within 2.5 days of a boundary, and calendar-relative
// arithmetic (Date.setFullYear) would add complexity with no SEO benefit.
const YEAR_MS = 365.25 * 24 * 60 * 60 * 1000;

function _toMs(val) {
  if (typeof val === 'number') return val;
  if (val == null) return NaN;
  return Date.parse(val);
}

function colorBand(events, now = Date.now()) {
  if (!Array.isArray(events) || events.length === 0) {
    return { bucket: 'green', label: 'No fatal hull losses on record', lastFatalDate: null };
  }
  // Find the most recent occurred_at.
  let mostRecent = -Infinity;
  for (const e of events) {
    const t = _toMs(e.occurred_at);
    if (Number.isFinite(t) && t > mostRecent) mostRecent = t;
  }
  if (!Number.isFinite(mostRecent)) {
    return { bucket: 'green', label: 'No fatal hull losses on record', lastFatalDate: null };
  }
  const ageYears = (now - mostRecent) / YEAR_MS;
  const lastFatalDate = new Date(mostRecent).toISOString().slice(0, 10);
  const lastFatalYear = lastFatalDate.slice(0, 4);

  if (ageYears > 20) {
    return { bucket: 'light-green', label: 'No fatal hull losses in 20+ years', lastFatalDate };
  }
  if (ageYears >= 5) {
    return { bucket: 'yellow', label: `Last fatal hull loss: ${lastFatalYear}`, lastFatalDate };
  }
  if (ageYears >= 1) {
    return { bucket: 'orange', label: `Last fatal hull loss: ${lastFatalYear}`, lastFatalDate };
  }
  return { bucket: 'red', label: `Recent fatal hull loss: ${lastFatalDate}`, lastFatalDate };
}

function topNotable(events, n = 5) {
  if (!Array.isArray(events) || events.length === 0) return [];
  if (typeof n !== 'number' || n <= 0) return [];
  const sorted = [...events].sort((a, b) => {
    if ((b.fatalities || 0) !== (a.fatalities || 0)) return (b.fatalities || 0) - (a.fatalities || 0);
    const at = _toMs(a.occurred_at);
    const bt = _toMs(b.occurred_at);
    return (bt || 0) - (at || 0);
  });
  return sorted.slice(0, n);
}

function groupByDecade(events) {
  const out = {};
  for (const e of events) {
    const t = _toMs(e.occurred_at);
    if (!Number.isFinite(t)) continue;
    const year = new Date(t).getUTCFullYear();
    const decade = `${Math.floor(year / 10) * 10}s`;
    (out[decade] = out[decade] || []).push(e);
  }
  return out;
}

function breakdownByVariant(events) {
  const out = {};
  for (const e of events) {
    const k = e.aircraft_icao_type;
    if (!k) continue;
    out[k] = (out[k] || 0) + 1;
  }
  return out;
}

module.exports = { colorBand, topNotable, groupByDecade, breakdownByVariant };
