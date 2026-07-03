// Package secrets encrypts and decrypts individual secret values entirely
// in RAM using age — the same encryption backend SOPS uses. Each value in
// the config's `secrets:` map is a self-contained age-armored blob, so the
// model round-trips cleanly with a single age identity (the platform key).
// The age private key is supplied per request by the caller and is never
// persisted anywhere.
package secrets

import (
	"bytes"
	"fmt"
	"io"
	"strings"

	"filippo.io/age"
	"filippo.io/age/armor"
)

func identity(ageKey string) (*age.X25519Identity, error) {
	id, err := age.ParseX25519Identity(strings.TrimSpace(ageKey))
	if err != nil {
		return nil, fmt.Errorf("invalid age key: %w", err)
	}
	return id, nil
}

// Encrypt armors a single secret value for the given age key's recipient.
func Encrypt(value, ageKey string) (string, error) {
	id, err := identity(ageKey)
	if err != nil {
		return "", err
	}
	var buf bytes.Buffer
	aw := armor.NewWriter(&buf)
	w, err := age.Encrypt(aw, id.Recipient())
	if err != nil {
		return "", err
	}
	if _, err := io.WriteString(w, value); err != nil {
		return "", err
	}
	if err := w.Close(); err != nil {
		return "", err
	}
	if err := aw.Close(); err != nil {
		return "", err
	}
	return buf.String(), nil
}

// Decrypt reverses Encrypt for one armored blob.
func Decrypt(blob, ageKey string) (string, error) {
	id, err := identity(ageKey)
	if err != nil {
		return "", err
	}
	ar := armor.NewReader(strings.NewReader(strings.TrimSpace(blob)))
	r, err := age.Decrypt(ar, id)
	if err != nil {
		return "", fmt.Errorf("decrypt failed (wrong age key or corrupt secret?): %w", err)
	}
	out, err := io.ReadAll(r)
	if err != nil {
		return "", err
	}
	return string(out), nil
}

// DecryptMap decrypts every entry in a secrets map, tolerating plaintext
// entries (values that are not age-armored are returned as-is, so a
// freshly authored config still works before first encryption).
func DecryptMap(m map[string]string, ageKey string) (map[string]string, error) {
	out := make(map[string]string, len(m))
	for k, v := range m {
		if !strings.HasPrefix(strings.TrimSpace(v), "-----BEGIN AGE ENCRYPTED FILE-----") {
			out[k] = v // plaintext, not yet encrypted
			continue
		}
		dec, err := Decrypt(v, ageKey)
		if err != nil {
			return nil, fmt.Errorf("secret %q: %w", k, err)
		}
		out[k] = dec
	}
	return out, nil
}
