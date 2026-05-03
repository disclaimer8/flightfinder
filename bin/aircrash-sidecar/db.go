package main

import (
	"database/sql"
	"fmt"
	"log"
	"strings"

	_ "github.com/mattn/go-sqlite3"
)

// Accident is a single row from the accidents table, as returned by /api/accidents.
type Accident struct {
	ID            int     `json:"id"`
	Date          string  `json:"date"`
	AircraftModel string  `json:"aircraft_model"`
	Operator      string  `json:"operator"`
	Fatalities    string  `json:"fatalities"`
	Location      string  `json:"location"`
	SourceURL     string  `json:"source_url"`
	Lat           float64 `json:"lat"`
	Lon           float64 `json:"lon"`
}

// InitDB opens the accidents database in read-only mode.
//
// Read-only mode is non-negotiable here: the upstream AirCrash binary opens
// the same file read-write to run scrapers + geocoder; that codepath is the
// largest attack surface (UPDATE statements reachable from process state),
// so we slam it shut.
//
// SQLite PRAGMAs that mutate the journal mode (`_journal_mode=WAL`) or
// synchronous setting are silently rejected on a `mode=ro` connection — the
// driver returns `attempt to write a readonly database` on Ping. So the
// DSN is bare `mode=ro` and the only contention story is "we never write".
// Concurrent writes from the upstream scraper happen out of process and
// out of band (file is atomically replaced via `mv` during deploy). The
// server holds the old inode until it is reloaded by PM2 — `deploy.yml`
// triggers `pm2 reload aircrash-sidecar` whenever the seed file's hash
// changes so readers pick up the new dataset cleanly.
func InitDB(filepath string) (*sql.DB, error) {
	dsn := fmt.Sprintf("file:%s?mode=ro", filepath)
	db, err := sql.Open("sqlite3", dsn)
	if err != nil {
		return nil, err
	}
	// One reader connection is enough — SQLite handles concurrent SELECTs
	// fine, but more connections just means more file handles for no win.
	db.SetMaxOpenConns(4)
	if err := db.Ping(); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("db ping: %w", err)
	}
	return db, nil
}

// GetAccidents returns paginated accident rows, ordered most-recent first.
// limit and offset are clamped at the handler layer — db.go trusts callers.
func GetAccidents(db *sql.DB, limit, offset int) ([]Accident, error) {
	const query = `
		SELECT id, date, aircraft_model, operator, fatalities, location, source_url,
		       COALESCE(lat, 0), COALESCE(lon, 0)
		FROM accidents
		ORDER BY normalized_date DESC, id DESC
		LIMIT ? OFFSET ?`
	rows, err := db.Query(query, limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]Accident, 0, limit)
	for rows.Next() {
		var a Accident
		if err := rows.Scan(&a.ID, &a.Date, &a.AircraftModel, &a.Operator, &a.Fatalities,
			&a.Location, &a.SourceURL, &a.Lat, &a.Lon); err != nil {
			log.Printf("aircrash-sidecar: scan accident: %v", err)
			continue
		}
		out = append(out, a)
	}
	return out, rows.Err()
}

// StatResult is one bucket of an aggregation (top aircraft / top operator).
type StatResult struct {
	Name       string `json:"name"`
	Count      int    `json:"count"`
	Fatalities int    `json:"fatalities"`
}

// GetAircraftStats returns the top aircraft families by recorded accident count.
//
// SUM(CAST(fatalities AS INTEGER)) is intentionally lossy: SQLite parses the
// leading digits and ignores the rest, so "15+2" → 15 and "Unknown" → 0.
// Acceptable for ranking; the absolute total is illustrative, not audit-grade.
//
// commercialOnly limits to scheduled/charter/regional carriers (NTSB Part
// 121/125/129/135 + brand-prefix matched non-NTSB rows). Without it, top-10
// is dominated by U.S. general aviation (Cessna 172, Piper PA-18) — true
// but irrelevant to a flight-search audience that only books on commercial
// equipment. See migrate-commercial.py for the heuristic.
//
// Grouping is by aircraft_canonical (populated by migrate-canonical.py) so
// "BOEING 737 800" / "BOEING 737-800" / "Boeing 737-800" — three free-text
// variants of the same physical model — collapse into one row. The display
// name comes from aircraft_display, which stores the most-frequent original
// spelling per canonical group so the API returns something human readable.
func GetAircraftStats(db *sql.DB, commercialOnly bool) ([]StatResult, error) {
	where := "a.aircraft_canonical IS NOT NULL AND a.aircraft_canonical != ''"
	if commercialOnly {
		where += " AND a.is_commercial = 1"
	}
	return runStat(db, `
		SELECT COALESCE(d.display_name, a.aircraft_canonical) AS name,
		       COUNT(a.id) AS c,
		       SUM(CAST(a.fatalities AS INTEGER)) AS f
		FROM accidents a
		LEFT JOIN aircraft_display d ON d.canonical = a.aircraft_canonical
		WHERE `+where+`
		GROUP BY a.aircraft_canonical
		ORDER BY c DESC
		LIMIT 10`)
}

// GetOperatorStats — top operators by accident count, grouped by
// operator_canonical so e.g. "Delta Air Lines" / "DELTA AIR LINES INC" /
// "Delta Air Lines, Inc." all collapse into a single row.
func GetOperatorStats(db *sql.DB, commercialOnly bool) ([]StatResult, error) {
	where := "a.operator_canonical IS NOT NULL AND a.operator_canonical != ''"
	if commercialOnly {
		where += " AND a.is_commercial = 1"
	}
	return runStat(db, `
		SELECT COALESCE(d.display_name, a.operator_canonical) AS name,
		       COUNT(a.id) AS c,
		       SUM(CAST(a.fatalities AS INTEGER)) AS f
		FROM accidents a
		LEFT JOIN operator_display d ON d.canonical = a.operator_canonical
		WHERE `+where+`
		GROUP BY a.operator_canonical
		ORDER BY c DESC
		LIMIT 10`)
}

func runStat(db *sql.DB, query string) ([]StatResult, error) {
	rows, err := db.Query(query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]StatResult, 0, 10)
	for rows.Next() {
		var s StatResult
		if err := rows.Scan(&s.Name, &s.Count, &s.Fatalities); err != nil {
			continue
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

// MapPoint is a row in /map_data — only the fields a Leaflet marker needs.
// `Year` is parsed from `normalized_date` so the FE era slider can filter
// without an extra fetch; `null` when the upstream date couldn't be normalised
// (records like "xx Oct 2024" that the parser left unchanged).
type MapPoint struct {
	ID         int     `json:"id"`
	Model      string  `json:"model"`
	Fatalities string  `json:"fatalities"`
	Year       *int    `json:"year"`
	Lat        float64 `json:"lat"`
	Lon        float64 `json:"lon"`
}

// MapFilters carries the optional server-side filters for /map_data.
// All fields are optional: empty values mean "no filter on this dimension".
// Operator is a free-text contains-match (case-insensitive); Category is
// matched exactly against the aircraft_category column populated by
// migrate-category.py (wide-body / narrow-body / regional / turboprop /
// helicopter / ga / other).
type MapFilters struct {
	Operator string
	Category string
}

// GetMapPoints returns geocoded accident points for map rendering, capped to
// at most `limit` rows (the controller enforces an upper bound). The 0.000001
// sentinel is used by the upstream geocoder to mark "tried, not found"; we
// filter those out here so the map doesn't have a cluster pinned at (0, 0).
//
// `substr(normalized_date, 1, 4)` extracts the YYYY portion when the parser
// successfully normalised the date; for unparseable strings normalized_date
// echoes the original ("xx Oct 2024") and the cast fails, leaving year NULL.
//
// Filters: when MapFilters.Operator or .Category is set, narrow the result.
// Pre-filtering server-side avoids shipping the full 30K rows just to drop
// 95% in the browser. Both columns are indexed (idx_accidents_operator,
// idx_accidents_category) by migrate-category.py.
func GetMapPoints(db *sql.DB, limit int, filters MapFilters) ([]MapPoint, error) {
	where := []string{"lat IS NOT NULL", "lat != 0", "lat != 0.000001"}
	args := []interface{}{}
	if filters.Category != "" {
		where = append(where, "aircraft_category = ?")
		args = append(args, filters.Category)
	}
	if filters.Operator != "" {
		// Match against operator_canonical (UPPER, suffix-stripped) so a
		// query of "delta" finds rows whose original operator was
		// "DELTA AIR LINES INC" without us having to enumerate all
		// spelling variants. Falls back to a free-text LIKE on the
		// original operator field if the canonical column is empty
		// (legacy rows pre-migrate-canonical.py).
		where = append(where, "(operator_canonical LIKE ? OR operator LIKE ? COLLATE NOCASE)")
		upper := strings.ToUpper(filters.Operator)
		args = append(args, "%"+upper+"%", "%"+filters.Operator+"%")
	}
	args = append(args, limit)

	query := `
		SELECT id,
		       aircraft_model,
		       fatalities,
		       CAST(NULLIF(substr(normalized_date, 1, 4), '') AS INTEGER) AS year,
		       lat,
		       lon
		FROM accidents
		WHERE ` + strings.Join(where, " AND ") + `
		ORDER BY normalized_date DESC, id DESC
		LIMIT ?`

	rows, err := db.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]MapPoint, 0, limit)
	for rows.Next() {
		var p MapPoint
		var year sql.NullInt64
		if err := rows.Scan(&p.ID, &p.Model, &p.Fatalities, &year, &p.Lat, &p.Lon); err != nil {
			continue
		}
		if year.Valid {
			y := int(year.Int64)
			// Reject obvious garbage (e.g. CAST returns 2024 for "2024-12-15"
			// but also for "2024-bogus" — clamp to the dataset's plausible
			// 1900-2100 window so the FE slider isn't poisoned).
			if y >= 1900 && y <= 2100 {
				p.Year = &y
			}
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// GetOperators returns the top operators (by accident count) optionally
// filtered by a free-text contains-match. Powers the operator typeahead
// on the safety map. commercialOnly mirrors the /stats/operators contract
// — when true, restricts to scheduled/charter carriers (Part 121/125/129/
// 135 + brand-prefix-matched non-NTSB rows) so the suggestion list isn't
// dominated by one-off GA flying clubs.
//
// Grouped by operator_canonical (populated by migrate-canonical.py) so the
// dropdown shows distinct *carriers*, not five spellings of "Delta Air
// Lines". The match is also against operator_canonical so "delta" matches
// rows whose original spelling was uppercase, hyphenated, or otherwise
// stylistically different. operator_canonical is uppercased + suffix-
// stripped, so we uppercase the query for the LIKE comparison.
func GetOperators(db *sql.DB, q string, commercialOnly bool, limit int) ([]string, error) {
	where := []string{"a.operator_canonical IS NOT NULL", "a.operator_canonical != ''"}
	args := []interface{}{}
	if commercialOnly {
		where = append(where, "a.is_commercial = 1")
	}
	if q != "" {
		where = append(where, "a.operator_canonical LIKE ?")
		args = append(args, "%"+strings.ToUpper(q)+"%")
	}
	args = append(args, limit)

	query := `
		SELECT COALESCE(d.display_name, a.operator_canonical) AS name
		FROM accidents a
		LEFT JOIN operator_display d ON d.canonical = a.operator_canonical
		WHERE ` + strings.Join(where, " AND ") + `
		GROUP BY a.operator_canonical
		ORDER BY COUNT(*) DESC
		LIMIT ?`

	rows, err := db.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]string, 0, limit)
	for rows.Next() {
		var op string
		if err := rows.Scan(&op); err != nil {
			continue
		}
		out = append(out, op)
	}
	return out, rows.Err()
}

// GetAccidentByID returns one full accident record by primary key, or
// (nil, sql.ErrNoRows) if not found. Used by the /accidents/:id detail
// endpoint that powers the side-panel popup on the global safety map.
func GetAccidentByID(db *sql.DB, id int) (*Accident, error) {
	const query = `
		SELECT id, date, aircraft_model, operator, fatalities, location, source_url,
		       COALESCE(lat, 0), COALESCE(lon, 0)
		FROM accidents
		WHERE id = ?
		LIMIT 1`
	row := db.QueryRow(query, id)
	var a Accident
	if err := row.Scan(&a.ID, &a.Date, &a.AircraftModel, &a.Operator, &a.Fatalities,
		&a.Location, &a.SourceURL, &a.Lat, &a.Lon); err != nil {
		return nil, err
	}
	return &a, nil
}
