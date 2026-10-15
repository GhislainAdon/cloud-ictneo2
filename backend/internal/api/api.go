// Package api wires the stateless HTTP surface: config validation, secret
// (re)encryption, periodic checks and streaming command execution. No
// request state is retained — every call carries its own config + age key.
package api

import (
	"encoding/json"
	"fmt"
	"net/http"

	"github.com/GhislainAdon/cloud-ictneo2/backend/internal/config"
	"github.com/GhislainAdon/cloud-ictneo2/backend/internal/secrets"
	"github.com/GhislainAdon/cloud-ictneo2/backend/internal/sshx"
)

// Handler returns the fully-wired mux. staticDir may be empty (API only).
func Handler(staticDir string) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/api/health", health)
	mux.HandleFunc("/api/validate", validate)
	mux.HandleFunc("/api/secrets", secretsCRUD)
	mux.HandleFunc("/api/check", check)
	mux.HandleFunc("/api/run", run)
	if staticDir != "" {
		mux.Handle("/", spaFileServer(staticDir))
	}
	return mux
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}

func health(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, 200, map[string]string{"status": "ok", "service": "cloud-ictneo2"})
}

type configReq struct {
	Config string `json:"config"` // raw YAML text
	AgeKey string `json:"ageKey"`
}

func parseConfig(raw string) (*config.Config, []string, error) {
	c, err := config.Parse([]byte(raw))
	if err != nil {
		return nil, nil, err
	}
	return c, c.Validate(), nil
}

func validate(w http.ResponseWriter, r *http.Request) {
	var req configReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, 400, map[string]string{"error": err.Error()})
		return
	}
	c, problems, err := parseConfig(req.Config)
	if err != nil {
		writeJSON(w, 200, map[string]any{"valid": false, "errors": []string{err.Error()}})
		return
	}
	writeJSON(w, 200, map[string]any{
		"valid":  len(problems) == 0,
		"errors": problems,
		"config": c,
	})
}

type secretReq struct {
	AgeKey string `json:"ageKey"`
	Name   string `json:"name"`
	Value  string `json:"value"`
}

// secretsCRUD encrypts a single value and returns the age-armored blob the
// frontend places into the secrets map before export.
func secretsCRUD(w http.ResponseWriter, r *http.Request) {
	var req secretReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, 400, map[string]string{"error": err.Error()})
		return
	}
	if req.AgeKey == "" || req.Name == "" {
		writeJSON(w, 400, map[string]string{"error": "ageKey and name are required"})
		return
	}
	blob, err := secrets.Encrypt(req.Value, req.AgeKey)
	if err != nil {
		writeJSON(w, 400, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, 200, map[string]string{"name": req.Name, "encrypted": blob})
}

type checkReq struct {
	Config string   `json:"config"`
	AgeKey string   `json:"ageKey"`
	Apps   []string `json:"apps"`
}

func check(w http.ResponseWriter, r *http.Request) {
	var req checkReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, 400, map[string]string{"error": err.Error()})
		return
	}
	c, problems, err := parseConfig(req.Config)
	if err != nil || len(problems) > 0 {
		writeJSON(w, 400, map[string]any{"error": "invalid config", "details": problems})
		return
	}
	plain, err := secrets.DecryptMap(c.Secrets, req.AgeKey)
	if err != nil {
		writeJSON(w, 400, map[string]string{"error": err.Error()})
		return
	}

	results := map[string]any{}
	want := map[string]bool{}
	for _, a := range req.Apps {
		want[a] = true
	}
	for _, app := range c.AllApps() {
		if len(want) > 0 && !want[app.Name] {
			continue
		}
		if !app.Check.Enabled {
			results[app.Name] = map[string]any{"state": "disabled"}
			continue
		}
		_, proj := c.FindApp(app.Name)
		node, ok := proj.FindNode(app.Node)
		if !ok {
			results[app.Name] = map[string]any{"state": "error", "detail": "node not found"}
			continue
		}
		n := resolveNode(node, plain)
		switch app.Check.Type {
		case "tcp":
			if err := sshx.CheckTCP(n); err != nil {
				results[app.Name] = map[string]any{"state": "down", "detail": err.Error()}
			} else {
				results[app.Name] = map[string]any{"state": "up"}
			}
		case "command":
			out, ok, err := sshx.CheckCommand(n, app.Check.Run)
			switch {
			case err != nil:
				results[app.Name] = map[string]any{"state": "error", "detail": err.Error()}
			case ok:
				results[app.Name] = map[string]any{"state": "up", "detail": out}
			default:
				results[app.Name] = map[string]any{"state": "down", "detail": out}
			}
		}
	}
	writeJSON(w, 200, map[string]any{"results": results})
}

type runReq struct {
	Config string            `json:"config"`
	AgeKey string            `json:"ageKey"`
	App    string            `json:"app"`
	Fields map[string]string `json:"fields"` // text field env -> value
}

// run streams command output as Server-Sent Events.
func run(w http.ResponseWriter, r *http.Request) {
	var req runReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, 400, map[string]string{"error": err.Error()})
		return
	}
	c, problems, err := parseConfig(req.Config)
	if err != nil || len(problems) > 0 {
		writeJSON(w, 400, map[string]any{"error": "invalid config", "details": problems})
		return
	}
	app, proj := c.FindApp(req.App)
	if app == nil {
		writeJSON(w, 404, map[string]string{"error": "application not found"})
		return
	}
	node, ok := proj.FindNode(app.Node)
	if !ok {
		writeJSON(w, 400, map[string]string{"error": "node not found"})
		return
	}
	plain, err := secrets.DecryptMap(c.Secrets, req.AgeKey)
	if err != nil {
		writeJSON(w, 400, map[string]string{"error": err.Error()})
		return
	}

	env := map[string]string{}
	for _, f := range app.Fields {
		switch f.Type {
		case "secret":
			env[f.Env] = plain[f.SecretRef]
		case "text":
			if v, ok := req.Fields[f.Env]; ok {
				env[f.Env] = v
			} else {
				env[f.Env] = f.Default
			}
		}
	}

	flusher, ok := w.(http.Flusher)
	if !ok {
		writeJSON(w, 500, map[string]string{"error": "streaming unsupported"})
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")

	send := func(event, data string) {
		_, _ = fmt.Fprintf(w, "event: %s\ndata: %s\n\n", event, jsonString(data))
		flusher.Flush()
	}
	send("start", app.Name)

	n := resolveNode(node, plain)
	code, err := sshx.Run(n, app.Workdir, app.Command, env, func(line string) {
		send("output", line)
	})
	if err != nil {
		send("error", err.Error())
		return
	}
	send("exit", fmt.Sprintf("%d", code))
}

func resolveNode(node *config.Node, plain map[string]string) sshx.Node {
	return sshx.Node{
		Host:        node.Host,
		Port:        node.Port,
		User:        node.User,
		AuthType:    node.Auth.Type,
		KeyOrSecret: plain[node.Auth.SecretRef],
	}
}

func jsonString(s string) string {
	b, _ := json.Marshal(s)
	return string(b)
}
