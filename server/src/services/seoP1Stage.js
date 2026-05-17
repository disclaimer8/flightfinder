'use strict';

// Stage gate for P1 SEO sitemap. Set FF_SEO_P1_STAGE='all' in env once full
// rollout starts (Week 4+). Default 'top50' limits enumerators to the top-50
// hub airports — Google sees ~100 strong pages first instead of ~7800 thin
// pages, which improves crawl budget allocation and index-quality signal.

const STAGE = process.env.FF_SEO_P1_STAGE || 'top50';

// Manually curated top-50 hub IATAs (by 2025 passenger volume per Wikipedia
// "List of busiest airports"). Intentionally hand-edited so we don't pivot
// Google's perception of our top pages over weekly Jonty data refreshes.
const TOP_50_HUBS = [
  'ATL','PEK','DXB','LAX','HND','ORD','LHR','CDG','DFW','PVG',
  'AMS','FRA','HKG','DEN','CAN','ICN','BKK','SIN','SFO','JFK',
  'LGW','MAD','SEA','MIA','MEL','SYD','MUC','PHX','IAH','BCN',
  'LAS','MCO','EWR','CLT','FCO','IST','BOM','DEL','SVO','SHA',
  'NRT','KMG','SZX','CTU','HAN','SGN','MNL','CGK','KUL','DOH',
];

function shouldEnumerate(iata) {
  if (STAGE === 'all') return true;
  if (STAGE === 'top50') return TOP_50_HUBS.includes(String(iata).toUpperCase());
  return true;
}

function filterAirports(iatas) {
  if (STAGE === 'all') return iatas;
  if (STAGE === 'top50') {
    const set = new Set(TOP_50_HUBS);
    return iatas.filter(i => set.has(String(i).toUpperCase()));
  }
  return iatas;
}

module.exports = { STAGE, TOP_50_HUBS, shouldEnumerate, filterAirports };
