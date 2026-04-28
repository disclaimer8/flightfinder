package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"strconv"
	"time"

	"github.com/gilby125/google-flights-api/flights"
	"golang.org/x/text/currency"
	"golang.org/x/text/language"
)

type errBody struct {
	Error string `json:"error"`
}

func writeErr(w http.ResponseWriter, status int, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(errBody{Error: msg})
}

func searchHandler(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	from := q.Get("from")
	to := q.Get("to")
	dateStr := q.Get("date")
	returnStr := q.Get("return")
	adultsStr := q.Get("adults")
	if adultsStr == "" {
		adultsStr = "1"
	}

	if from == "" || to == "" || dateStr == "" {
		writeErr(w, http.StatusBadRequest, "from, to, date are required")
		return
	}

	depDate, err := time.Parse("2006-01-02", dateStr)
	if err != nil {
		writeErr(w, http.StatusBadRequest, "date must be YYYY-MM-DD")
		return
	}
	var retDate time.Time
	if returnStr != "" {
		retDate, err = time.Parse("2006-01-02", returnStr)
		if err != nil {
			writeErr(w, http.StatusBadRequest, "return must be YYYY-MM-DD")
			return
		}
	}
	adults, err := strconv.Atoi(adultsStr)
	if err != nil || adults < 1 {
		writeErr(w, http.StatusBadRequest, "adults must be a positive integer")
		return
	}

	session, err := flights.New()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, fmt.Sprintf("session init: %v", err))
		return
	}

	args := flights.Args{
		Date:        depDate,
		ReturnDate:  retDate,
		SrcAirports: []string{from},
		DstAirports: []string{to},
		Options: flights.Options{
			Travelers: flights.Travelers{Adults: adults},
			Currency:  currency.EUR,
			Stops:     flights.AnyStops,
			Class:     flights.Economy,
			TripType:  ternaryTripType(retDate.IsZero()),
			Lang:      language.English,
		},
	}

	ctx, cancel := context.WithTimeout(r.Context(), 12*time.Second)
	defer cancel()

	offers, _, err := session.GetOffers(ctx, args)
	if err != nil {
		writeErr(w, http.StatusBadGateway, fmt.Sprintf("upstream: %v", err))
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"offers":     offers,
		"queriedAt":  time.Now().UTC().Format(time.RFC3339),
		"upstreamMs": 0,
	})
}

func ternaryTripType(oneWay bool) flights.TripType {
	if oneWay {
		return flights.OneWay
	}
	return flights.RoundTrip
}

func healthHandler(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
}

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "5002"
	}
	mux := http.NewServeMux()
	mux.HandleFunc("/health", healthHandler)
	mux.HandleFunc("/search", searchHandler)

	srv := &http.Server{
		Addr:              "127.0.0.1:" + port,
		Handler:           mux,
		ReadHeaderTimeout: 5 * time.Second,
	}
	log.Printf("google-flights-sidecar listening on %s", srv.Addr)
	log.Fatal(srv.ListenAndServe())
}
