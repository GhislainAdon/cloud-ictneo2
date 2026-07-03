# cloud-ictneo2 — Launcher console white-label · Design

Validé le 2026-07-03 avec l'utilisateur (brainstorming + questions/réponses).

## Vision

Console web **CRUD sans état** pour déclarer et lancer des *applications*
(script shell, `ansible-playbook`, `terraform apply`, …) sur des *nodes*
(node managers) via SSH, avec secrets chiffrés **SOPS/age** et un
**fichier YAML unique façon Envoy** faisant office de base de données.
Le nom de la plateforme est personnalisable (white-label — pas de
"cloud-ictneo" en dur dans l'UI).

## Décisions actées

| Question | Décision |
|---|---|
| Exécution des commandes | Backend **Go stateless** (un binaire : sert le front + SSH + checks) |
| Déchiffrement SOPS | **Backend, en RAM uniquement**, au moment de l'exécution |
| Fichier d'état | **Un seul `config.yaml`** structuré (à la Envoy), section `secrets:` chiffrée SOPS ; + la clé age importée à part. Export/import = 2 fichiers |
| Heartbeat | **Node joignable (TCP)** et/ou **commande de check custom** par application |
| Injection des secrets | **Variables d'environnement** (jamais en argv — visibles dans `ps aux`) |
| Environnement de dev | **Docker uniquement** comme sandbox (Go, Node, Angular CLI en conteneurs — rien d'installé sur le poste) |

## Architecture

```
Angular (statique)  ──HTTP──▶  Go backend (un binaire, 127.0.0.1:9876)
   │  config.yaml + clé age chargés en mémoire navigateur     │
   │  (clé JAMAIS persistée — refresh ⇒ ré-import)            │ SSH (x/crypto/ssh)
   └── timers de check pendant que l'écran est ouvert         ▼
                                                        node managers
```

Le backend ne stocke **rien** (ni disque, ni session) : chaque requête
transporte ce dont elle a besoin (config + clé age), tout est déchiffré
et utilisé en RAM puis oublié.

### Endpoints backend

| Endpoint | Rôle |
|---|---|
| `GET /` + statiques | Sert le front Angular buildé |
| `POST /api/validate` | Parse + valide un `config.yaml` (schéma, refs secrets, unicité des noms) |
| `POST /api/run` | `{config, ageKey, appName, fieldValues}` → déchiffre SOPS en RAM, SSH vers le node, secrets en env vars, **stream SSE** de la sortie |
| `POST /api/check` | `{config, ageKey?, appNames[]}` → heartbeat TCP et/ou commande custom, résultats par app |
| `POST /api/secrets` | `{config, ageKey, name, value}` → re-chiffre via SOPS et retourne le YAML mis à jour (CRUD des secrets ; la clé publique age vient des métadonnées `sops:` du fichier) |

### Schéma du fichier unique `config.yaml`

```yaml
platform:
  name: "Mon Datacenter"          # affiché dans l'UI (white-label)
nodes:
  - name: node-mgr-01
    host: 10.0.0.5
    port: 22                      # défaut 22
    user: admin
    auth: { type: key, secretRef: ssh_key_nm01 }   # ou type: password
applications:
  - name: terraform-apply-core    # identifiant unique
    node: node-mgr-01
    workdir: /opt/infra
    command: "terraform apply -auto-approve"
    fields:
      - { env: TF_VAR_password, label: "Mot de passe", type: secret, secretRef: tf_pass }
      - { env: TF_VAR_region,   label: "Région",       type: text, default: eu-west-1 }
    check:
      enabled: true
      type: command               # tcp | command
      run: "systemctl is-active myapp"
      periodSeconds: 60
    enabled: true
secrets:                          # seule section chiffrée (encrypted_regex: ^secrets$)
  tf_pass: ENC[AES256_GCM,...]
  ssh_key_nm01: ENC[AES256_GCM,...]
sops: { ... métadonnées SOPS ... }
```

Les credentials SSH des nodes vivent dans `secrets:` — le fichier est
autosuffisant.

### Écrans Angular

1. **Chargement / Export** — import du `config.yaml` (upload ou collage),
   import de la clé age (mémoire JS uniquement), export du YAML modifié.
   Bandeau au nom de la plateforme (`platform.name`).
2. **Applications (CRUD)** — lister / ajouter / éditer / supprimer,
   éditeur de champs (env, label, type text|secret, secretRef/défaut),
   gestion des nodes et des secrets (saisie → `/api/secrets`).
3. **Dashboard** — par app : état activé/désactivé (toggle), résultat du
   dernier check, heartbeat périodique (timer front, period configurable),
   bouton ▶ Run → modal de saisie des champs → sortie live (SSE).

## Sécurité

- Backend bindé `127.0.0.1` par défaut (flag `--listen` pour changer).
- Clé age : jamais dans localStorage/cookie/disque — variable mémoire.
- Secrets : jamais loggés, jamais en argv, transmis uniquement en HTTPS
  local backend→node via env vars de session SSH.
- Pas d'authentification (même positionnement dev-dashboard que
  console-ictneo) — ne pas exposer au-delà de localhost sans proxy auth.
- Docker : image multi-stage, user non-root dès le départ.

## Stack

- **Backend** : Go ≥1.24, `github.com/getsops/sops/v3` (decrypt),
  `filippo.io/age` (encrypt), `golang.org/x/crypto/ssh`, `gopkg.in/yaml.v3`.
- **Frontend** : Angular (dernière LTS via `ng new` en conteneur node).
- **Build/test** : 100 % Docker (golang / node), Dockerfile final
  multi-stage non-root, docker-compose bindé 127.0.0.1.

## Hors périmètre (YAGNI)

- Multi-utilisateur, RBAC, audit log.
- Scheduler serveur (les checks ne tournent que l'écran ouvert — assumé).
- Historique des exécutions (rien n'est persisté).
