package api

import (
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

// spaFileServer serves the built Angular app, falling back to index.html
// for client-side routes (anything without a file extension).
func spaFileServer(dir string) http.Handler {
	fs := http.FileServer(http.Dir(dir))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		clean := filepath.Clean(r.URL.Path)
		full := filepath.Join(dir, clean)
		if _, err := os.Stat(full); err == nil || strings.Contains(filepath.Base(clean), ".") {
			fs.ServeHTTP(w, r)
			return
		}
		http.ServeFile(w, r, filepath.Join(dir, "index.html"))
	})
}
