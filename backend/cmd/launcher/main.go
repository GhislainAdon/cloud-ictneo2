// Command launcher is the single stateless binary: it serves the Angular
// UI and the JSON/SSE API. It stores nothing — all state lives in the
// user's YAML config and the age key they import at runtime.
package main

import (
	"flag"
	"log"
	"net/http"
	"time"

	"github.com/GhislainAdon/cloud-ictneo2/backend/internal/api"
)

func main() {
	listen := flag.String("listen", "127.0.0.1:9876", "address to bind")
	static := flag.String("static", "/app/static", "directory of built Angular assets (empty = API only)")
	flag.Parse()

	srv := &http.Server{
		Addr:              *listen,
		Handler:           api.Handler(*static),
		ReadHeaderTimeout: 10 * time.Second,
	}
	log.Printf("cloud-ictneo2 launcher listening on %s (static=%q)", *listen, *static)
	log.Fatal(srv.ListenAndServe())
}
