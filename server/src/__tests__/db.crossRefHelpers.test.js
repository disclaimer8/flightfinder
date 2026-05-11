const db = require('../models/db');

describe('cross-ref DB helpers', () => {
  beforeAll(() => {
    db.db.prepare("DELETE FROM observed_routes WHERE source = 'test-crossref'").run();
    db.db.prepare("DELETE FROM safety_events WHERE source = 'test-crossref'").run();
    const seedRoute = (from, to, n) => {
      for (let i = 0; i < n; i++) {
        db.upsertObservedRoute({
          depIata: from, arrIata: to,
          aircraftIcao: `T${i.toString().padStart(3,'0')}`,
          airlineIata: 'XX', source: 'test-crossref',
        });
      }
    };
    seedRoute('JFK', 'LHR', 5);  // top from JFK and to LHR
    seedRoute('JFK', 'CDG', 3);
    seedRoute('JFK', 'FRA', 2);
    seedRoute('BOS', 'LHR', 4);
    seedRoute('ORD', 'LHR', 3);
  });

  afterAll(() => {
    db.db.prepare("DELETE FROM observed_routes WHERE source = 'test-crossref'").run();
    db.db.prepare("DELETE FROM safety_events WHERE source = 'test-crossref'").run();
  });

  describe('getTopRoutesFromAirport', () => {
    it('returns top routes from JFK ordered desc', () => {
      const out = db.getTopRoutesFromAirport('JFK', 10);
      const triplet = out
        .filter((r) => ['JFK-LHR', 'JFK-CDG', 'JFK-FRA'].includes(`${r.from}-${r.to}`))
        .map((r) => `${r.from}-${r.to}`);
      expect(triplet).toEqual(['JFK-LHR', 'JFK-CDG', 'JFK-FRA']);
      const top = out.find((r) => r.from === 'JFK' && r.to === 'LHR');
      expect(top.count).toBe(5);
    });

    it('respects the limit parameter', () => {
      const out = db.getTopRoutesFromAirport('JFK', 2);
      expect(out.length).toBeLessThanOrEqual(2);
    });

    it('returns [] for unknown IATA', () => {
      expect(db.getTopRoutesFromAirport('ZZZ', 10)).toEqual([]);
    });

    it('returns [] for empty/invalid input', () => {
      expect(db.getTopRoutesFromAirport('', 10)).toEqual([]);
      expect(db.getTopRoutesFromAirport(null, 10)).toEqual([]);
      expect(db.getTopRoutesFromAirport('JFK', 0)).toEqual([]);
      expect(db.getTopRoutesFromAirport('JFK', -1)).toEqual([]);
    });
  });

  describe('getTopRoutesToAirport', () => {
    it('returns top routes to LHR ordered desc', () => {
      const out = db.getTopRoutesToAirport('LHR', 10);
      const triplet = out
        .filter((r) => ['JFK-LHR', 'BOS-LHR', 'ORD-LHR'].includes(`${r.from}-${r.to}`))
        .map((r) => `${r.from}-${r.to}`);
      expect(triplet).toEqual(['JFK-LHR', 'BOS-LHR', 'ORD-LHR']);
      const top = out.find((r) => r.from === 'JFK' && r.to === 'LHR');
      expect(top.count).toBe(5);
    });

    it('returns [] for empty/invalid input', () => {
      expect(db.getTopRoutesToAirport('', 10)).toEqual([]);
      expect(db.getTopRoutesToAirport('LHR', 0)).toEqual([]);
    });
  });

  describe('getTopAircraftBySafetyEventCount', () => {
    beforeAll(() => {
      const seedEvent = (icao, n) => {
        for (let i = 0; i < n; i++) {
          db.db.prepare(`
            INSERT INTO safety_events (
              source, source_event_id, occurred_at, severity, fatalities, injuries,
              hull_loss, operator_name, aircraft_icao_type, location_country,
              cictt_category, phase_of_flight, ingested_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            'test-crossref', `crossref-${icao}-${i}`,
            Date.now(), 'incident', 0, 0, 0,
            'Test', icao, 'US', null, null, Date.now(), Date.now()
          );
        }
      };
      seedEvent('B789', 5);
      seedEvent('B738', 3);
      seedEvent('A320', 1);
    });

    it('returns top aircraft types by event count desc', () => {
      const out = db.getTopAircraftBySafetyEventCount(10);
      const triplet = out
        .filter((r) => ['B789', 'B738', 'A320'].includes(r.aircraft_icao_type))
        .map((r) => r.aircraft_icao_type);
      expect(triplet).toEqual(['B789', 'B738', 'A320']);
      const top = out.find((r) => r.aircraft_icao_type === 'B789');
      expect(top.count).toBe(5);
    });

    it('returns [] for invalid limit', () => {
      expect(db.getTopAircraftBySafetyEventCount(0)).toEqual([]);
      expect(db.getTopAircraftBySafetyEventCount(-1)).toEqual([]);
    });
  });
});
