#!/usr/bin/env bash
# Generate a fresh age keypair for local testing.
#   ./gen-demo.sh
# Prints the private key (import it in the UI) and the public recipient.
set -euo pipefail

if ! command -v age-keygen >/dev/null 2>&1; then
  echo "age-keygen not found. Install age (https://github.com/FiloSottile/age)." >&2
  echo "Or run it in Docker:" >&2
  echo "  docker run --rm alpine sh -c 'apk add -q age && age-keygen'" >&2
  exit 1
fi

age-keygen
echo >&2
echo "Copy the 'AGE-SECRET-KEY-...' line into the console's Configuration screen." >&2
echo "Then add secrets in Applications ▸ Secrets — they are encrypted with this key." >&2
