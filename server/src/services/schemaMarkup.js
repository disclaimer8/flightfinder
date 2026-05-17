'use strict';

const SITE = 'https://himaxym.com';
const PUBLISHER = {
  '@type': 'Organization',
  name: 'FlightFinder',
  url: SITE,
};

function airport(a) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Airport',
    name: a.name,
    iataCode: a.iata,
    icaoCode: a.icao || undefined,
    url: `${SITE}/flights-from/${a.iata}`,
    address: {
      '@type': 'PostalAddress',
      addressLocality: a.city,
      addressCountry: a.country_code,
    },
    geo: (a.latitude != null && a.longitude != null) ? {
      '@type': 'GeoCoordinates',
      latitude: a.latitude,
      longitude: a.longitude,
      elevation: a.elevation || undefined,
    } : undefined,
  };
}

function breadcrumb(items) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((it, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: it.name,
      item: it.url,
    })),
  };
}

function faqPage(qaPairs) {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: qaPairs.map(p => ({
      '@type': 'Question',
      name: p.question,
      acceptedAnswer: { '@type': 'Answer', text: p.answer },
    })),
  };
}

function aircraftType(t) {
  // memory trap — use Thing, NOT Vehicle (Google rejects aircraft as Vehicle)
  return {
    '@context': 'https://schema.org',
    '@type': 'Thing',
    name: t.name,
    identifier: t.code,
  };
}

function route(r) {
  // memory trap — no Offer on flight schema (we don't sell tickets)
  return {
    '@context': 'https://schema.org',
    '@type': 'Trip',
    name: `${r.origin_iata} to ${r.dest_iata}`,
    itinerary: {
      '@type': 'ItemList',
      itemListElement: [
        { '@type': 'Place', name: r.origin_iata },
        { '@type': 'Place', name: r.dest_iata },
      ],
    },
    additionalProperty: [
      { '@type': 'PropertyValue', name: 'distance_km', value: r.km },
      { '@type': 'PropertyValue', name: 'duration_min', value: r.duration_min },
    ],
  };
}

function organization() {
  return { ...PUBLISHER, '@context': 'https://schema.org' };
}

function toScriptTags(...objs) {
  return objs
    .filter(o => o)
    .map(o => `<script type="application/ld+json">${JSON.stringify(o)}</script>`)
    .join('\n');
}

module.exports = {
  airport, breadcrumb, faqPage, aircraftType, route, organization, toScriptTags,
};
