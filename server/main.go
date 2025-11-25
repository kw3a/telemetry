package main

import (
	"encoding/json"
	"log"
	"net/http"
	"strings"
	"sync"

	"github.com/rs/cors"
)

type Keystroke struct {
	Key      string  `json:"key"`
	DownTime float64 `json:"pressed_at"`
	UpTime   float64 `json:"released_at"`
}

type TelemetryPayload struct {
	UserID string      `json:"user_id"`
	Events []Keystroke `json:"events"`
}

type UserProfile struct {
	mu          sync.Mutex
	DwellTimes  []float64
	FlightTimes []float64
	LastKeyUp   float64
	LastKeyDown float64
}

var profiles = map[string]*UserProfile{}
var profilesMu sync.Mutex

func main() {
	mux := http.NewServeMux()

	mux.HandleFunc("/telemetry", telemetryHandler)
	mux.HandleFunc("/profile/", profileHandler)

	c := cors.New(cors.Options{
		AllowedOrigins:   []string{"http://localhost:3000"},
		AllowedHeaders:   []string{"Content-Type"},
		AllowedMethods:   []string{"POST", "GET", "OPTIONS"},
		AllowCredentials: true,
	})

	log.Println("Backend running on :8080")
	http.ListenAndServe(":8080", c.Handler(mux))
}

func telemetryHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var payload TelemetryPayload
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}

	profilesMu.Lock()
	profile, exists := profiles[payload.UserID]
	if !exists {
		profile = &UserProfile{}
		profiles[payload.UserID] = profile
	} else if len(payload.Events) > 0 && payload.Events[0].DownTime < profile.LastKeyDown {
		profile.DwellTimes = []float64{}
		profile.FlightTimes = []float64{}
		profile.LastKeyUp = 0
		profile.LastKeyDown = 0
	}
	profilesMu.Unlock()

	profile.mu.Lock()
	defer profile.mu.Unlock()

	for i, k := range payload.Events {
		dwell := k.UpTime - k.DownTime
		if dwell > 0 {
			profile.DwellTimes = append(profile.DwellTimes, dwell)
		}

		if i == 0 && profile.LastKeyUp > 0 {
			flight := k.DownTime - profile.LastKeyUp
			if flight > 0 {
				profile.FlightTimes = append(profile.FlightTimes, flight)
			}
		} else if i > 0 {
			flight := k.DownTime - payload.Events[i-1].UpTime
			if flight > 0 {
				profile.FlightTimes = append(profile.FlightTimes, flight)
			}
		}
	}

	if len(payload.Events) > 0 {
		profile.LastKeyDown = payload.Events[len(payload.Events)-1].DownTime
		profile.LastKeyUp = payload.Events[len(payload.Events)-1].UpTime
	}

	w.Header().Set("Content-Type", "application/json")
	w.Write([]byte(`{"status":"ok"}`))
}

func profileHandler(w http.ResponseWriter, r *http.Request) {
	parts := strings.Split(r.URL.Path, "/")
	if len(parts) != 3 {
		http.NotFound(w, r)
		return
	}

	userID := parts[2]
	profilesMu.Lock()
	profile, ok := profiles[userID]
	profilesMu.Unlock()

	if !ok {
		http.Error(w, "profile not found", http.StatusNotFound)
		return
	}

	profile.mu.Lock()
	defer profile.mu.Unlock()

	resp := map[string]interface{}{
		"dwell_times":  profile.DwellTimes,
		"flight_times": profile.FlightTimes,
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)
}

