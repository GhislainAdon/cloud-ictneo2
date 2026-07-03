package secrets

import (
	"strings"
	"testing"

	"filippo.io/age"
)

func newKey(t *testing.T) string {
	t.Helper()
	id, err := age.GenerateX25519Identity()
	if err != nil {
		t.Fatal(err)
	}
	return id.String()
}

func TestRoundTrip(t *testing.T) {
	key := newKey(t)
	blob, err := Encrypt("s3cr3t-p@ss", key)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(blob, "BEGIN AGE ENCRYPTED FILE") {
		t.Fatalf("not armored: %q", blob)
	}
	got, err := Decrypt(blob, key)
	if err != nil {
		t.Fatal(err)
	}
	if got != "s3cr3t-p@ss" {
		t.Fatalf("got %q", got)
	}
}

func TestWrongKeyFails(t *testing.T) {
	blob, _ := Encrypt("x", newKey(t))
	if _, err := Decrypt(blob, newKey(t)); err == nil {
		t.Fatal("expected decrypt failure with wrong key")
	}
}

func TestDecryptMapToleratesPlaintext(t *testing.T) {
	key := newKey(t)
	enc, _ := Encrypt("real", key)
	out, err := DecryptMap(map[string]string{"a": enc, "b": "plain"}, key)
	if err != nil {
		t.Fatal(err)
	}
	if out["a"] != "real" || out["b"] != "plain" {
		t.Fatalf("got %v", out)
	}
}
