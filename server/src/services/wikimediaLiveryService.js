'use strict';

const { defineDataSource } = require('./dataSource');
const liveriesModel = require('../models/liveries');

const API = 'https://commons.wikimedia.org/w/api.php';
const TTL_MS = 7 * 24 * 60 * 60 * 1000; // refresh weekly

async function searchLivery({ airlineName, airlineIata, icaoType, typeLabel }) {
  const cached = liveriesModel.get(airlineIata, icaoType);
  if (cached && Date.now() - cached.fetched_at < TTL_MS) return cached;

  const q = `${airlineName} ${typeLabel || icaoType} aircraft`;
  const url = `${API}?action=query&format=json&generator=search&gsrsearch=${encodeURIComponent(q)}` +
              `&gsrnamespace=6&gsrlimit=3&prop=imageinfo&iiprop=url|extmetadata&origin=*`;
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'himaxym.com livery lookup' } });
    if (!res.ok) throw new Error(`wikimedia ${res.status}`);
    const body = await res.json();
    const page = body?.query?.pages && Object.values(body.query.pages)[0];
    const info = page?.imageinfo?.[0];
    const imageUrl    = info?.url || null;
    const attribution = info?.extmetadata?.Artist?.value || 'Wikimedia Commons';
    liveriesModel.upsert({ airlineIata, icaoType, imageUrl, attribution });
    return { image_url: imageUrl, attribution, fetched_at: Date.now() };
  } catch (err) {
    console.warn(`[wikimedia] ${airlineIata}/${icaoType}: ${err.message}`);
    // Negative cache so we don't hammer on repeated misses.
    liveriesModel.upsert({ airlineIata, icaoType, imageUrl: null, attribution: null });
    return null;
  }
}

module.exports = defineDataSource({
  name: 'wikimedia_liveries',
  isEnabled: () => true, // no key required
  fetch: searchLivery,
});
