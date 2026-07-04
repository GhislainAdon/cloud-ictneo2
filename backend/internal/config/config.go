// Package config parses and validates the single Envoy-style YAML file
// that drives the whole launcher. The file is the database: platform
// branding, nodes, applications and a SOPS-encrypted `secrets:` section.
// Secret VALUES are opaque here (ENC[...] blobs); only their keys are
// inspected so secretRefs can be validated without any decryption.
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

type Application struct {
	Name    string  `yaml:"name" json:"name"`
	Node    string  `yaml:"node" json:"node"`
	Workdir string  `yaml:"workdir,omitempty" json:"workdir"`
	Command string  `yaml:"command" json:"command"`
	Fields  []Field `yaml:"fields,omitempty" json:"fields"`
	Check   Check   `yaml:"check,omitempty" json:"check"`
	Enabled bool    `yaml:"enabled" json:"enabled"`
}

type Config struct {
	Platform     Platform      `yaml:"platform" json:"platform"`
	Nodes        []Node        `yaml:"nodes" json:"nodes"`
	Applications []Application `yaml:"applications" json:"applications"`
	// Secrets values are age-armored blobs (or plaintext before first
	// encryption). Echoed back to the same client that sent them.
	Secrets map[string]string `yaml:"secrets,omitempty" json:"secrets"`
}

var nameRe = regexp.MustCompile(`^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$`)
var envRe = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]*$`)

// Parse unmarshals the raw YAML. Unknown top-level keys (like `sops:`)
// are ignored on purpose: the raw bytes stay authoritative.
func Parse(raw []byte) (*Config, error) {
	var c Config
	if err := yaml.Unmarshal(raw, &c); err != nil {
		return nil, fmt.Errorf("invalid YAML: %w", err)
	}
	return &c, nil
}

// Validate returns every problem found (not just the first one) so the
// UI can show them all at once. Always non-nil so it serializes to a JSON
// array (never null), which the frontend indexes with .length.
func (c *Config) Validate() []string {
	errs := []string{}
	if c.Platform.Name == "" {
		errs = append(errs, "platform.name is required (white-label display name)")
	}

	nodeNames := map[string]bool{}
	for i, n := range c.Nodes {
		p := fmt.Sprintf("nodes[%d]", i)
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
	}

	appNames := map[string]bool{}
	for i, a := range c.Applications {
		p := fmt.Sprintf("applications[%d]", i)
		if !nameRe.MatchString(a.Name) {
			errs = append(errs, p+": name must be lowercase RFC-1123 (a-z, 0-9, '-')")
		}
		if appNames[a.Name] {
			errs = append(errs, p+": duplicate application name "+a.Name)
		}
		appNames[a.Name] = true
		if !nodeNames[a.Node] {
			errs = append(errs, p+": node '"+a.Node+"' is not declared in nodes")
		}
		if a.Command == "" {
			errs = append(errs, p+": command is required")
		}
		for j, f := range a.Fields {
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
	}
	return errs
}

// FindNode returns the node declaration for an application.
func (c *Config) FindNode(name string) (*Node, bool) {
	for i := range c.Nodes {
		if c.Nodes[i].Name == name {
			return &c.Nodes[i], true
		}
	}
	return nil, false
}

// FindApp returns an application by name.
func (c *Config) FindApp(name string) (*Application, bool) {
	for i := range c.Applications {
		if c.Applications[i].Name == name {
			return &c.Applications[i], true
		}
	}
	return nil, false
}
