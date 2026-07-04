#!/usr/bin/env bash
# Produce a ready-to-load encrypted config for a 30-second local demo.
#
#   ./examples/encrypt-demo.sh
#
# It generates a THROWAWAY age key (written to examples/age-demo.key, which
# is gitignored), encrypts the two demo secrets, and writes
# examples/config.encrypted.yaml. Load BOTH files in the console:
#   - config.yaml  -> examples/config.encrypted.yaml
#   - age key      -> the AGE-SECRET-KEY-... line printed below
#
# Never reuse this key for anything real. Regenerate your own for real use.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
KEY_FILE="$HERE/age-demo.key"
OUT="$HERE/config.encrypted.yaml"

# age-keygen / age via Docker so nothing is installed on the host.
run_age() { docker run --rm -i alpine sh -c "apk add -q age && $1"; }

echo "[1/3] Generating throwaway age key -> $KEY_FILE" >&2
run_age "age-keygen" 2>/dev/null | grep -E 'AGE-SECRET-KEY|public key' > "$KEY_FILE"
SECRET_KEY="$(grep AGE-SECRET-KEY "$KEY_FILE")"
PUB="$(grep -oE 'age1[0-9a-z]+' "$KEY_FILE" | head -1)"

# Encrypt one value into an armored blob for the given recipient.
encrypt() { printf '%s' "$1" | run_age "age -a -r '$PUB'"; }

echo "[2/3] Encrypting demo secrets for recipient $PUB" >&2
SSH_BLOB="$(encrypt 'demo-ssh-private-key-not-real')"
PW_BLOB="$(encrypt 'demo-terraform-password')"

indent() { sed 's/^/    /'; }

echo "[3/3] Writing $OUT" >&2
{
  cat <<'YAML'
# DEMO encrypted config — secrets below are age-armored ciphertext (safe to
# read). Load this together with the key printed by examples/encrypt-demo.sh.
platform:
  name: "Mon Datacenter"
nodes:
  - name: node-01
    host: 10.0.0.5
    user: admin
    auth: { type: key, secretRef: ssh_key }
applications:
  - name: terraform-apply
    node: node-01
    workdir: /opt/infra
    command: "terraform apply -auto-approve"
    fields:
      - { env: TF_VAR_password, label: "Mot de passe", type: secret, secretRef: tf_pass }
      - { env: TF_VAR_region,   label: "Région",       type: text,   default: eu-west-1 }
    check: { enabled: true, type: tcp, periodSeconds: 30 }
    enabled: true
secrets:
YAML
  echo "  ssh_key: |"
  printf '%s\n' "$SSH_BLOB" | indent
  echo "  tf_pass: |"
  printf '%s\n' "$PW_BLOB" | indent
} > "$OUT"

echo >&2
echo "Done. Load in the console:" >&2
echo "  - config.yaml : $OUT" >&2
echo "  - age key     : $SECRET_KEY" >&2
