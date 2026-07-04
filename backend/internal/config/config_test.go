package config

import "testing"

const good = `
platform:
  name: Demo DC
nodes:
  - name: node-01
    host: 10.0.0.5
    user: admin
    auth: { type: key, secretRef: ssh_key }
applications:
  - name: tf-apply
    node: node-01
    command: terraform apply
    fields:
      - { env: TF_VAR_pw, type: secret, secretRef: tf_pw }
      - { env: TF_VAR_region, type: text, default: eu-west-1 }
    check: { enabled: true, type: command, run: "echo ok", periodSeconds: 30 }
    enabled: true
secrets:
  ssh_key: PLAINTEXT
  tf_pw: PLAINTEXT
`

func TestValidateGood(t *testing.T) {
	c, err := Parse([]byte(good))
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	if errs := c.Validate(); len(errs) != 0 {
		t.Fatalf("expected no errors, got %v", errs)
	}
}

// Regression: ISSUE-002 — a valid config crashed the UI because Go's nil
// []string serialized to JSON null, and the template did null.length.
// Validate() must return a non-nil slice even when there are no errors.
// Found by /qa on 2026-07-04.
func TestValidateNeverReturnsNil(t *testing.T) {
	c, _ := Parse([]byte(good))
	errs := c.Validate()
	if errs == nil {
		t.Fatal("Validate() returned nil; must be a non-nil empty slice so it serializes to a JSON array, not null")
	}
}

func TestValidateCatchesProblems(t *testing.T) {
	bad := `
platform: {}
nodes:
  - name: Node_Bad
    host: ""
    user: ""
    auth: { type: nope }
applications:
  - name: a1
    node: ghost
    command: ""
    fields:
      - { env: "1bad", type: secret }
      - { env: OK, type: wat }
    check: { enabled: true, type: bogus }
  - name: a1
    node: ghost
    command: x
`
	c, err := Parse([]byte(bad))
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	errs := c.Validate()
	// platform.name, node name, host, user, auth.type, node-ref, command,
	// env name, secretRef missing, field type, check.type, duplicate app...
	if len(errs) < 8 {
		t.Fatalf("expected many errors, got %d: %v", len(errs), errs)
	}
}

func TestFindHelpers(t *testing.T) {
	c, _ := Parse([]byte(good))
	if _, ok := c.FindNode("node-01"); !ok {
		t.Fatal("node-01 not found")
	}
	if _, ok := c.FindApp("tf-apply"); !ok {
		t.Fatal("tf-apply not found")
	}
	if _, ok := c.FindApp("nope"); ok {
		t.Fatal("unexpected app")
	}
}
