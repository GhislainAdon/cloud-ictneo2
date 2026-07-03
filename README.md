# cloud-ictneo2 — Launcher console (white-label)

Console web **sans état** pour déclarer et lancer des applications ou
scripts (**shell, Ansible, Terraform**) sur des nœuds distants via SSH.
Interface **Angular**, backend **Go** en un seul binaire. Aucune donnée
n'est stockée : tout l'état vit dans **votre fichier YAML** et la **clé
age** que vous importez au démarrage. Le nom de la plateforme affiché est
**personnalisable** (champ `platform.name`).

## Principe

```
Angular (statique)  ──HTTP / SSE──▶  binaire Go (127.0.0.1:9876)
  config.yaml + clé age en mémoire navigateur          │ SSH
  (rien de persisté — un refresh efface tout)          ▼
                                                  nœuds distants
```

- **3 fichiers portables**, import/export : le `config.yaml` (la « base
  de données »), la **clé age** (import seul, jamais persistée), et le
  `config.yaml` exporté après modifications.
- **Secrets chiffrés age/SOPS** : les champs de type `secret` sont
  chiffrés côté backend avec votre clé age, en RAM. Ils sont injectés
  dans la commande comme **variables d'environnement** (jamais en argv —
  invisibles dans `ps aux`).
- **Heartbeat** par application : `tcp` (nœud joignable) ou `command`
  (commande de check custom, ex. `systemctl is-active`), avec période
  configurable, activable/désactivable.

## Écrans

1. **Configuration** — importer/coller `config.yaml` + clé age, exporter.
2. **Applications** — CRUD applications, champs de saisie (text/secret),
   nœuds et secrets (chiffrement à la volée).
3. **Dashboard** — état / heartbeat par app, bouton ▶ Run avec saisie des
   champs et **sortie live** (SSE).

## Démarrer (Docker, recommandé)

```bash
docker compose up --build      # UI + API sur http://127.0.0.1:9876
```

Puis ouvrez `http://127.0.0.1:9876`, importez `examples/config.yaml` et
une clé age (`examples/gen-demo.sh` en génère une).

## Développement

Tout se fait en conteneurs — rien à installer sur le poste.

```bash
# Backend : tests + build
docker run --rm -v "$PWD/backend:/src" -w /src golang:1.24 \
  sh -c "go test ./... && go build ./..."

# Frontend : dev server (proxy /api vers :9876)
docker run --rm -it -v "$PWD/frontend:/app" -w /app -p 4200:4200 node:22 \
  sh -c "npm install && npx ng serve --host 0.0.0.0 --proxy-config proxy.conf.json"
```

## Schéma du `config.yaml`

Voir [examples/config.yaml](examples/config.yaml). Sections : `platform`
(nom affiché), `nodes` (host/port/user/auth par `secretRef`),
`applications` (command, `fields[]` text|secret, `check`), `secrets`
(valeurs age-armored).

## Sécurité — à lire

- **Aucune authentification** : positionnement dashboard local, comme la
  console d'origine. Le backend bind `127.0.0.1` par défaut — **ne pas
  exposer** sans proxy d'auth devant.
- La **clé age** n'est jamais écrite sur disque ni en `localStorage` —
  seulement en mémoire de l'onglet. Un rafraîchissement la supprime.
- Les secrets ne sont **jamais loggés ni passés en argv**.
- La clé d'hôte SSH n'est pas épinglée (nœuds déclarés par l'opérateur) —
  limitation assumée pour un outil local.

## Conception

Spec validée : [docs/specs/2026-07-03-launcher-design.md](docs/specs/2026-07-03-launcher-design.md).
Plan : [docs/plans/2026-07-03-launcher-implementation.md](docs/plans/2026-07-03-launcher-implementation.md).
