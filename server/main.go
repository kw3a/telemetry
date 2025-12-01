package main

import (
	"encoding/json"
	"log"
	"net/http"
	"strings"
	"sync"

	"github.com/rs/cors"
)

type FeatureStats struct {
	Mean   float64 `json:"mean"`
	StdDev float64 `json:"std_dev"`
}

type WindowStats struct {
	UD  FeatureStats `json:"ud"`
	DU1 FeatureStats `json:"du1"`
	DU2 FeatureStats `json:"du2"`
	DD  FeatureStats `json:"dd"`
	UU  FeatureStats `json:"uu"`
}

type TelemetryPayload struct {
	UserID string      `json:"user_id"`
	Stats  WindowStats `json:"stats"`
}

type UserProfile struct {
	mu      sync.Mutex
	Windows []WindowStats
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
	}
	profilesMu.Unlock()

	profile.mu.Lock()
	defer profile.mu.Unlock()

	profile.Windows = append(profile.Windows, payload.Stats)

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

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(profile.Windows)
}
