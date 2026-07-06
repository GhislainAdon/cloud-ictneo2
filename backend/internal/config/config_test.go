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
	app, proj := c.FindApp("tf-apply")
	if app == nil || proj == nil {
		t.Fatal("tf-apply not found")
	}
	if _, ok := proj.FindNode("node-01"); !ok {
		t.Fatal("node-01 not found in project")
	}
	if a, _ := c.FindApp("nope"); a != nil {
		t.Fatal("unexpected app")
	}
}

// Legacy v1/v2 configs (top-level nodes/applications, no `projects:`) must
// normalize into one implicit project so they keep loading unchanged.
func TestLegacyNormalizesToOneProject(t *testing.T) {
	c, _ := Parse([]byte(good))
	if len(c.Projects) != 1 {
		t.Fatalf("expected 1 normalized project, got %d", len(c.Projects))
	}
	if c.Projects[0].Name != "Demo DC" {
		t.Fatalf("project name should come from platform.name, got %q", c.Projects[0].Name)
	}
	if len(c.Projects[0].Applications) != 1 || c.Projects[0].Applications[0].Name != "tf-apply" {
		t.Fatal("legacy applications not folded into the project")
	}
}

// A multi-project file validates and both apps are findable across projects.
func TestMultiProject(t *testing.T) {
	const multi = `
platform: { name: Workspace }
projects:
  - name: dc-a
    nodes:
      - { name: node-a, host: 10.0.0.1, user: root, auth: { type: key, secretRef: k } }
    applications:
      - { name: app-a, node: node-a, command: "echo a", check: { enabled: false }, enabled: true }
  - name: dc-b
    nodes:
      - { name: node-b, host: 10.0.0.2, user: root, auth: { type: key, secretRef: k } }
    applications:
      - { name: app-b, node: node-b, command: "echo b", check: { enabled: false }, enabled: true }
secrets:
  k: PLAINTEXT
`
	c, err := Parse([]byte(multi))
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	if errs := c.Validate(); len(errs) != 0 {
		t.Fatalf("expected valid, got %v", errs)
	}
	if len(c.Projects) != 2 {
		t.Fatalf("expected 2 projects, got %d", len(c.Projects))
	}
	appB, projB := c.FindApp("app-b")
	if appB == nil || projB.Name != "dc-b" {
		t.Fatal("app-b should resolve to project dc-b")
	}
	if _, ok := projB.FindNode("node-b"); !ok {
		t.Fatal("node-b not found in dc-b")
	}
}
