'use strict';

const MONTH_MAP = {
  Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06',
  Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12',
};

function slugify(s, maxLen) {
  if (s == null) return '';
  return String(s)
    .normalize('NFKD').replace(/[\u0300-\u036F]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, maxLen);
}

function buildAccidentSlugCandidate({ normalized_date, aircraft_model, operator, location }) {
  const parts = [];

  if (/^\d{4}-\d{2}-\d{2}$/.test(normalized_date)) {
    parts.push(normalized_date);
  } else {
    const m = String(normalized_date || '').match(/^xx (\w{3}) (\d{4})$/);
    const mm = m ? MONTH_MAP[m[1]] : null;
    if (mm) parts.push(`${m[2]}-${mm}-xx`);
    else parts.push('unknown-date');
  }

  const a = slugify(aircraft_model, 20);
  const o = slugify(operator, 20);
  const l = slugify(location, 25);
  if (a) parts.push(a);
  if (o) parts.push(o);
  if (l) parts.push(l);

  return parts.join('-').slice(0, 80).replace(/-+$/, '');
}

module.exports = { slugify, buildAccidentSlugCandidate, MONTH_MAP };
