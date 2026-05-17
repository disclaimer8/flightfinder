'use strict';

function fmt(n) {
  return n.toLocaleString('en-US');
}

function airport(meta, data) {
  if (!data.destinations || data.destinations.length === 0) return '';
  const destCount = data.destinations.length;
  const airlineCount = data.airlines.length;
  const longest = data.destinations.reduce((a, b) => (b.km > a.km ? b : a));
  const s1 = `${meta.name || meta.city} (${meta.iata}) is served by ${airlineCount} airline${airlineCount === 1 ? '' : 's'} flying to ${destCount} non-stop destination${destCount === 1 ? '' : 's'} — <strong>${airlineCount}</strong> carrier${airlineCount === 1 ? '' : 's'} and <strong>${destCount}</strong> route${destCount === 1 ? '' : 's'} in total.`;
  const s2 = `The longest scheduled route from ${meta.iata} is to ${longest.dest_city} (${longest.dest_iata}), a distance of <strong>${fmt(longest.km)}</strong> km.`;
  return `${s1} ${s2}`;
}

function airline(meta, stats) {
  if (!stats || !stats.totalRoutes) return '';
  return `${meta.name} (${meta.iata}) operates <strong>${stats.totalRoutes}</strong> non-stop route${stats.totalRoutes === 1 ? '' : 's'} reaching <strong>${stats.totalCountries}</strong> countr${stats.totalCountries === 1 ? 'y' : 'ies'}${stats.hubCount ? ` from <strong>${stats.hubCount}</strong> hub airport${stats.hubCount === 1 ? '' : 's'}` : ''}.`;
}

function route(meta) {
  if (!meta || !meta.km) return '';
  return `${meta.origin_city || meta.origin_iata} (${meta.origin_iata}) to ${meta.dest_city || meta.dest_iata} (${meta.dest_iata}) covers <strong>${fmt(meta.km)}</strong> km and takes approximately <strong>${meta.duration_min}</strong> minutes.`;
}

module.exports = { airport, airline, route };
