# Plan d'implémentation — launcher console

Réf : [../specs/2026-07-03-launcher-design.md](../specs/2026-07-03-launcher-design.md)
Contrainte : build/test 100 % Docker (aucun toolchain installé sur le poste).

1. **Scaffold frontend** — `ng new` dans un conteneur `node`, copie du
   workspace dans `frontend/` (sans node_modules ni .git).
2. **Backend Go** (`backend/`) :
   - `internal/config` — modèle YAML + parse + validation (noms uniques,
     secretRefs résolus, RFC-1123 sur les noms).
   - `internal/secrets` — déchiffrement SOPS en RAM (clé age fournie par
     requête), re-chiffrement d'une valeur via age + réécriture SOPS.
   - `internal/sshx` — exécution SSH (auth clé/password), env vars,
     stream stdout/stderr, check TCP + check commande.
   - `internal/api` — handlers `/api/validate`, `/api/run` (SSE),
     `/api/check`, `/api/secrets` ; static serve du front.
   - `cmd/launcher/main.go` — flags `--listen` (défaut 127.0.0.1:9876),
     `--static`.
   - Tests unitaires : config (parse/validate), secrets (round-trip
     age), api/validate.
3. **Frontend Angular** : service API + store signal en mémoire
   (config + clé age), écrans Chargement/Export, CRUD Applications,
   Dashboard (checks périodiques, run SSE).
4. **Packaging** : Dockerfile multi-stage (node build → go build →
   distroless/slim non-root uid 10001), docker-compose 127.0.0.1:9876,
   `examples/config.yaml` + script `examples/gen-demo.sh`.
5. **Vérification** : `go test` + `go vet` en conteneur, build compose,
   smoke test HTTP (UI 200, /api/validate sur l'exemple), push GitHub.
