package main

import (
	"database/sql"
	"encoding/json"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"
)

// NewServer wires the read-only API and returns a configured http.Server
// with timeouts that prevent Slowloris-style attacks. No /static, no `/`
// dashboard handler — the upstream AirCrash binary serves an HTML SPA at
// the root, but rendering scraped fields via innerHTML is a stored-XSS
// vector (Wikidata operators are user-editable on Wikipedia). nginx
// proxies only `/api/safety/global/*` to this binary, so even if a
// compromised origin existed, no HTML is reachable.
func NewServer(db *sql.DB, addr string) *http.Server {
	// Routes are at root (no /api/ prefix). nginx mounts this sidecar under
	// /api/safety/global/ via `proxy_pass http://127.0.0.1:5003/`, so the
	// internal `/accidents` becomes the public `/api/safety/global/accidents`.
	// Avoiding a duplicate /api/ in the public URL ("/api/safety/global/api/
	// accidents") keeps the contract clean and matches the existing
	// google-flights-sidecar convention of root-mounted handlers.
	mux := http.NewServeMux()
	mux.HandleFunc("/health", healthHandler)
	mux.HandleFunc("/accidents/", accidentByIDHandler(db)) // /accidents/123 — must be registered before /accidents
	mux.HandleFunc("/accidents", accidentsHandler(db))
	mux.HandleFunc("/stats/aircrafts", statsHandler(db, GetAircraftStats))
	mux.HandleFunc("/stats/operators", statsHandler(db, GetOperatorStats))
	mux.HandleFunc("/map_data", mapDataHandler(db))

	return &http.Server{
		Addr:              addr,
		Handler:           mux,
		ReadHeaderTimeout: 5 * time.Second,  // Slowloris guard
		ReadTimeout:       10 * time.Second, // body must arrive within 10s
		WriteTimeout:      30 * time.Second, // largest response is /api/map_data
		IdleTimeout:       60 * time.Second,
		MaxHeaderBytes:    8 * 1024,
	}
}

// healthHandler — PM2 + nginx healthcheck endpoint. Same shape as the
// google-flights-sidecar so any monitoring on either binary is uniform.
func healthHandler(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

// accidentsHandler — paginated raw accident list. limit clamped to [1, 500],
// offset clamped to [0, 1_000_000] so a malicious caller can't trigger an
// unbounded JSON marshal that OOMs the process.
func accidentsHandler(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		limit := clampInt(r.URL.Query().Get("limit"), 100, 1, 500)
		offset := clampInt(r.URL.Query().Get("offset"), 0, 0, 1_000_000)
		rows, err := GetAccidents(db, limit, offset)
		if err != nil {
			writeError(w, "fetch accidents", err)
			return
		}
		w.Header().Set("Cache-Control", "public, max-age=60")
		writeJSON(w, http.StatusOK, map[string]interface{}{
			"data":   rows,
			"limit":  limit,
			"offset": offset,
		})
	}
}

// statsHandler — generic top-N aggregator, parameterized by the stats query
// fn so /api/stats/aircrafts and /api/stats/operators share a single body.
func statsHandler(db *sql.DB, fetch func(*sql.DB) ([]StatResult, error)) http.HandlerFunc {
	return func(w http.ResponseWriter, _ *http.Request) {
		stats, err := fetch(db)
		if err != nil {
			writeError(w, "fetch stats", err)
			return
		}
		w.Header().Set("Cache-Control", "public, max-age=300")
		writeJSON(w, http.StatusOK, stats)
	}
}

// mapDataHandler — geocoded points for Leaflet markers. Hard-capped at
// 30 000 rows: the dataset jumped from ~2.3K to ~29.5K geocoded entries
// after the NTSB CAROL bulk import (almost every NTSB record carries
// lat/lon). 30K canvas circleMarkers stay smooth at world zoom; if we
// ever push past that, switch to server-side spatial bucketing rather
// than bumping this further. wire size at 30K ≈ 4 MB raw / 600 KB
// brotli — acceptable for a once-per-page payload backed by the FE
// era/severity/model filters that immediately cull most of it.
func mapDataHandler(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, _ *http.Request) {
		points, err := GetMapPoints(db, 30000)
		if err != nil {
			writeError(w, "fetch map_data", err)
			return
		}
		w.Header().Set("Cache-Control", "public, max-age=300")
		writeJSON(w, http.StatusOK, points)
	}
}

// accidentByIDHandler — /accidents/:id detail endpoint that powers the
// side-panel popup on the safety map. Only matches numeric ids; anything
// else is rejected as 404 to keep the endpoint signature tight (e.g.
// `/accidents/foo` shouldn't fall through to the list handler at /accidents).
//
// Path parsing is hand-rolled because we use net/http (not Gin) and Go's
// stdlib mux doesn't support path params. r.URL.Path will be e.g.
// "/accidents/1445" — strip the prefix and Atoi the remainder.
func accidentByIDHandler(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		const prefix = "/accidents/"
		if !strings.HasPrefix(r.URL.Path, prefix) {
			http.NotFound(w, r)
			return
		}
		idStr := strings.TrimPrefix(r.URL.Path, prefix)
		// Reject empty + paths with extra slashes (e.g. /accidents/1/foo).
		if idStr == "" || strings.ContainsRune(idStr, '/') {
			http.NotFound(w, r)
			return
		}
		id, err := strconv.Atoi(idStr)
		if err != nil || id <= 0 {
			http.NotFound(w, r)
			return
		}
		acc, err := GetAccidentByID(db, id)
		if err == sql.ErrNoRows {
			http.NotFound(w, r)
			return
		}
		if err != nil {
			writeError(w, "fetch accident by id", err)
			return
		}
		w.Header().Set("Cache-Control", "public, max-age=3600")
		writeJSON(w, http.StatusOK, acc)
	}
}

// clampInt parses an optional query-string integer and constrains it to
// [min, max]. Invalid input — including negative numbers, non-numeric, and
// Atoi overflow — falls back to def.
func clampInt(s string, def, min, max int) int {
	if s == "" {
		return def
	}
	n, err := strconv.Atoi(s)
	if err != nil {
		return def
	}
	if n < min {
		return min
	}
	if n > max {
		return max
	}
	return n
}

func writeJSON(w http.ResponseWriter, status int, body interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

// writeError logs the real error server-side and returns a generic message
// to the client. SQLite errors leak schema details that aren't useful to
// legitimate callers and are useful to attackers.
func writeError(w http.ResponseWriter, op string, err error) {
	log.Printf("aircrash-sidecar: %s: %v", op, err)
	writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "internal"})
}
