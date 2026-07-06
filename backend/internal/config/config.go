// Package config parses and validates the single Envoy-style YAML file
// that drives the whole launcher. The file is the database: platform
// branding, one or more projects (each with its nodes + applications) and
// a shared SOPS/age-encrypted `secrets:` section. Secret VALUES are opaque
// here (ENC[...] blobs); only their keys are inspected so secretRefs can
// be validated without any decryption.
package config

import (
	"fmt"
	"regexp"

	"gopkg.in/yaml.v3"
)

type Platform struct {
	Name string `yaml:"name" json:"name"`
}

type NodeAuth struct {
	Type      string `yaml:"type" json:"type"` // key | password
	SecretRef string `yaml:"secretRef" json:"secretRef"`
}

type Node struct {
	Name string   `yaml:"name" json:"name"`
	Host string   `yaml:"host" json:"host"`
	Port int      `yaml:"port,omitempty" json:"port"`
	User string   `yaml:"user" json:"user"`
	Auth NodeAuth `yaml:"auth" json:"auth"`
}

type Field struct {
	Env       string `yaml:"env" json:"env"`
	Label     string `yaml:"label,omitempty" json:"label"`
	Type      string `yaml:"type" json:"type"` // text | secret
	SecretRef string `yaml:"secretRef,omitempty" json:"secretRef"`
	Default   string `yaml:"default,omitempty" json:"default"`
}

type Check struct {
	Enabled       bool   `yaml:"enabled" json:"enabled"`
	Type          string `yaml:"type,omitempty" json:"type"` // tcp | command
	Run           string `yaml:"run,omitempty" json:"run"`
	PeriodSeconds int    `yaml:"periodSeconds,omitempty" json:"periodSeconds"`
}

// Tile is the optional board placement + styling for an application.
// X/Y are pointers so "not positioned yet" (auto-layout) is distinct from
// position (0,0); icon/color can be set without pinning a position.
type Tile struct {
	X     *int   `yaml:"x,omitempty" json:"x,omitempty"`
	Y     *int   `yaml:"y,omitempty" json:"y,omitempty"`
	W     int    `yaml:"w,omitempty" json:"w,omitempty"`
	H     int    `yaml:"h,omitempty" json:"h,omitempty"`
	Icon  string `yaml:"icon,omitempty" json:"icon,omitempty"`
	Color string `yaml:"color,omitempty" json:"color,omitempty"`
}

type Application struct {
	Name    string  `yaml:"name" json:"name"`
	Node    string  `yaml:"node" json:"node"`
	Workdir string  `yaml:"workdir,omitempty" json:"workdir"`
	Command string  `yaml:"command" json:"command"`
	Fields  []Field `yaml:"fields,omitempty" json:"fields"`
	Check   Check   `yaml:"check,omitempty" json:"check"`
	Enabled bool    `yaml:"enabled" json:"enabled"`
	Tile    *Tile   `yaml:"tile,omitempty" json:"tile,omitempty"`
}

// Project groups nodes + applications under one display name. The board,
// applications and topology screens all operate on the "current" project.
type Project struct {
	Name         string        `yaml:"name" json:"name"`
	Nodes        []Node        `yaml:"nodes" json:"nodes"`
	Applications []Application `yaml:"applications" json:"applications"`
}

type Config struct {
	Platform Platform  `yaml:"platform" json:"platform"`
	Projects []Project `yaml:"projects,omitempty" json:"projects"`

	// Legacy single-project fields (v1/v2 input). Folded into Projects by
	// normalize(); json:"-" so the frontend only ever sees Projects.
	Nodes        []Node        `yaml:"nodes,omitempty" json:"-"`
	Applications []Application `yaml:"applications,omitempty" json:"-"`

	// Secrets values are age-armored blobs (or plaintext before first
	// encryption), shared across all projects. Echoed back to the client.
	Secrets map[string]string `yaml:"secrets,omitempty" json:"secrets"`
}

var nameRe = regexp.MustCompile(`^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$`)
var envRe = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]*$`)

// Parse unmarshals the raw YAML and normalizes it so there is always a
// Projects list. Unknown top-level keys (like `sops:`) are ignored.
func Parse(raw []byte) (*Config, error) {
	var c Config
	if err := yaml.Unmarshal(raw, &c); err != nil {
		return nil, fmt.Errorf("invalid YAML: %w", err)
	}
	c.normalize()
	return &c, nil
}

// normalize folds a legacy top-level nodes/applications block into a
// single implicit project, so older v1/v2 configs load unchanged.
func (c *Config) normalize() {
	if len(c.Projects) == 0 && (len(c.Nodes) > 0 || len(c.Applications) > 0) {
		name := c.Platform.Name
		if name == "" {
			name = "Projet 1"
		}
		c.Projects = []Project{{Name: name, Nodes: c.Nodes, Applications: c.Applications}}
	}
	c.Nodes = nil
	c.Applications = nil
}

// Validate returns every problem found (not just the first one) so the
// UI can show them all at once. Always non-nil so it serializes to a JSON
// array (never null), which the frontend indexes with .length.
func (c *Config) Validate() []string {
	errs := []string{}
	if len(c.Projects) == 0 {
		errs = append(errs, "at least one project (or top-level nodes/applications) is required")
	}

	projNames := map[string]bool{}
	appNames := map[string]bool{} // globally unique so run/check can find by name alone
	for pi := range c.Projects {
		proj := &c.Projects[pi]
		pp := fmt.Sprintf("projects[%d]", pi)
		if proj.Name == "" {
			errs = append(errs, pp+": name is required")
		}
		if projNames[proj.Name] {
			errs = append(errs, pp+": duplicate project name "+proj.Name)
		}
		projNames[proj.Name] = true

		nodeNames := map[string]bool{}
		for i := range proj.Nodes {
			errs = append(errs, c.validateNode(fmt.Sprintf("%s.nodes[%d]", pp, i), &proj.Nodes[i], nodeNames)...)
		}
		for i := range proj.Applications {
			errs = append(errs, c.validateApp(fmt.Sprintf("%s.applications[%d]", pp, i), &proj.Applications[i], nodeNames, appNames)...)
		}
	}
	return errs
}

func (c *Config) validateNode(p string, n *Node, nodeNames map[string]bool) []string {
	var errs []string
	if !nameRe.MatchString(n.Name) {
		errs = append(errs, p+": name must be lowercase RFC-1123 (a-z, 0-9, '-')")
	}
	if nodeNames[n.Name] {
		errs = append(errs, p+": duplicate node name "+n.Name)
	}
	nodeNames[n.Name] = true
	if n.Host == "" {
		errs = append(errs, p+": host is required")
	}
	if n.User == "" {
		errs = append(errs, p+": user is required")
	}
	switch n.Auth.Type {
	case "key", "password":
		if n.Auth.SecretRef == "" {
			errs = append(errs, p+": auth.secretRef is required")
		} else if _, ok := c.Secrets[n.Auth.SecretRef]; !ok {
			errs = append(errs, p+": auth.secretRef '"+n.Auth.SecretRef+"' not found in secrets")
		}
	default:
		errs = append(errs, p+": auth.type must be 'key' or 'password'")
	}
	return errs
}

func (c *Config) validateApp(p string, a *Application, nodeNames, appNames map[string]bool) []string {
	var errs []string
	if !nameRe.MatchString(a.Name) {
		errs = append(errs, p+": name must be lowercase RFC-1123 (a-z, 0-9, '-')")
	}
	if appNames[a.Name] {
		errs = append(errs, p+": duplicate application name "+a.Name+" (names must be unique across projects)")
	}
	appNames[a.Name] = true
	if !nodeNames[a.Node] {
		errs = append(errs, p+": node '"+a.Node+"' is not declared in this project's nodes")
	}
	if a.Command == "" {
		errs = append(errs, p+": command is required")
	}
	for j := range a.Fields {
		f := &a.Fields[j]
		fp := fmt.Sprintf("%s.fields[%d]", p, j)
		if !envRe.MatchString(f.Env) {
			errs = append(errs, fp+": env must be a valid environment variable name")
		}
		switch f.Type {
		case "text":
		case "secret":
			if f.SecretRef == "" {
				errs = append(errs, fp+": secret fields need a secretRef")
			} else if _, ok := c.Secrets[f.SecretRef]; !ok {
				errs = append(errs, fp+": secretRef '"+f.SecretRef+"' not found in secrets")
			}
		default:
			errs = append(errs, fp+": type must be 'text' or 'secret'")
		}
	}
	if a.Check.Enabled {
		switch a.Check.Type {
		case "tcp":
		case "command":
			if a.Check.Run == "" {
				errs = append(errs, p+": check.run is required for command checks")
			}
		default:
			errs = append(errs, p+": check.type must be 'tcp' or 'command'")
		}
		if a.Check.PeriodSeconds < 5 {
			errs = append(errs, p+": check.periodSeconds must be >= 5")
		}
	}
	return errs
}

// FindApp locates an application by name across all projects, returning
// the app and its owning project (so its node can be resolved).
func (c *Config) FindApp(name string) (*Application, *Project) {
	for pi := range c.Projects {
		for ai := range c.Projects[pi].Applications {
			if c.Projects[pi].Applications[ai].Name == name {
				return &c.Projects[pi].Applications[ai], &c.Projects[pi]
			}
		}
	}
	return nil, nil
}

// FindNode returns a node by name within a project.
func (p *Project) FindNode(name string) (*Node, bool) {
	for i := range p.Nodes {
		if p.Nodes[i].Name == name {
			return &p.Nodes[i], true
		}
	}
	return nil, false
}

// AllApps flattens applications across every project.
func (c *Config) AllApps() []Application {
	var out []Application
	for pi := range c.Projects {
		out = append(out, c.Projects[pi].Applications...)
	}
	return out
}
