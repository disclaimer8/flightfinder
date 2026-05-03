package main

import (
	"context"
	"flag"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"
)

// Aviation Safety Explorer — read-only sidecar serving the historical
// accidents database to the FLIGHT platform via HTTP at /api/*.
//
// Origin (upstream AirCrash repo at /Users/denyskolomiiets/AirCrash) keeps
// the scrapers + geocoder. This fork is intentionally trimmed to just the
// serve path — no scraper code, no headless Chrome, no go-rod dependency,
// no in-process geocoder. The DB on disk is a snapshot; refresh by running
// the upstream scrapers locally and copying the file in.
//
// All BLOCKER fixes from the code review are baked in:
//   B1/H3 — bind 127.0.0.1 explicitly, never 0.0.0.0
//   B2    — DB path is required via --db flag, no relative path defaults
//   B3    — SQLite opened with WAL + busy_timeout (see db.go)
//   H4    — DB opened in read-only mode (mode=ro)
//   M1    — http.Server with read/write/idle timeouts
//   R3    — graceful shutdown on SIGINT/SIGTERM
//   R8    — go.mod targets a Go version that actually exists
func main() {
	addr := flag.String("addr", "127.0.0.1:5003", "bind address — keep loopback so nginx is the only ingress")
	dbPath := flag.String("db", "", "absolute path to accidents.db (required)")
	flag.Parse()

	if *dbPath == "" {
		log.Fatalf("aircrash-sidecar: --db is required (e.g. --db /root/flightfinder/data/accidents.db)")
	}

	db, err := InitDB(*dbPath)
	if err != nil {
		log.Fatalf("aircrash-sidecar: db init: %v", err)
	}
	defer db.Close()

	srv := NewServer(db, *addr)

	// Graceful shutdown — PM2 sends SIGINT on reload; without Shutdown the
	// in-flight requests get torn mid-write.
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
	go func() {
		<-sigCh
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = srv.Shutdown(ctx)
	}()

	log.Printf("aircrash-sidecar listening on http://%s (db=%s, mode=ro)", *addr, *dbPath)
	if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatalf("aircrash-sidecar: serve: %v", err)
	}
}
