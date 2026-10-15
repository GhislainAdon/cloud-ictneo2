// Package sshx runs commands on nodes over SSH. Secret field values are
// injected as environment variables (never as argv, which would show up
// in `ps aux`). Output is streamed line by line through a callback so the
// API layer can forward it as Server-Sent Events.
package sshx

import (
	"bufio"
	"errors"
	"fmt"
	"io"
	"net"
	"strings"
	"time"

	"golang.org/x/crypto/ssh"
)

// Node carries the resolved connection details (secrets already decrypted).
type Node struct {
	Host        string
	Port        int
	User        string
	AuthType    string // key | password
	KeyOrSecret string // private key PEM (key) or password (password)
}

func (n Node) addr() string {
	port := n.Port
	if port == 0 {
		port = 22
	}
	return net.JoinHostPort(n.Host, fmt.Sprintf("%d", port))
}

func (n Node) clientConfig() (*ssh.ClientConfig, error) {
	cfg := &ssh.ClientConfig{
		User: n.User,
		// Host key is not pinned: this is a localhost dev dashboard and
		// nodes are operator-declared. Documented as a known limitation.
		HostKeyCallback: ssh.InsecureIgnoreHostKey(),
		Timeout:         10 * time.Second,
	}
	switch n.AuthType {
	case "password":
		cfg.Auth = []ssh.AuthMethod{ssh.Password(n.KeyOrSecret)}
	case "key":
		signer, err := ssh.ParsePrivateKey([]byte(n.KeyOrSecret))
		if err != nil {
			return nil, fmt.Errorf("bad private key: %w", err)
		}
		cfg.Auth = []ssh.AuthMethod{ssh.PublicKeys(signer)}
	default:
		return nil, fmt.Errorf("unknown auth type %q", n.AuthType)
	}
	return cfg, nil
}

// Run executes command in workdir with the given env vars, streaming each
// output line to onLine. It returns the remote exit status.
func Run(n Node, workdir, command string, env map[string]string, onLine func(string)) (int, error) {
	cfg, err := n.clientConfig()
	if err != nil {
		return -1, err
	}
	client, err := ssh.Dial("tcp", n.addr(), cfg)
	if err != nil {
		return -1, fmt.Errorf("ssh dial %s: %w", n.addr(), err)
	}
	defer func() { _ = client.Close() }()

	sess, err := client.NewSession()
	if err != nil {
		return -1, err
	}
	defer func() { _ = sess.Close() }()

	// Prefix env exports rather than SetEnv, which most sshd configs
	// reject (AcceptEnv allowlist). This keeps secrets out of argv.
	var b strings.Builder
	b.WriteString("set -a; ")
	for k, v := range env {
		fmt.Fprintf(&b, "%s=%s; ", k, shellQuote(v))
	}
	b.WriteString("set +a; ")
	if workdir != "" {
		fmt.Fprintf(&b, "cd %s && ", shellQuote(workdir))
	}
	b.WriteString(command)

	stdout, err := sess.StdoutPipe()
	if err != nil {
		return -1, err
	}
	stderr, err := sess.StderrPipe()
	if err != nil {
		return -1, err
	}
	if err := sess.Start(b.String()); err != nil {
		return -1, err
	}

	done := make(chan struct{}, 2)
	go streamLines(stdout, onLine, done)
	go streamLines(stderr, onLine, done)
	<-done
	<-done

	err = sess.Wait()
	if err == nil {
		return 0, nil
	}
	var ee *ssh.ExitError
	if errors.As(err, &ee) {
		return ee.ExitStatus(), nil
	}
	return -1, err
}

func streamLines(r io.Reader, onLine func(string), done chan<- struct{}) {
	sc := bufio.NewScanner(r)
	sc.Buffer(make([]byte, 0, 64*1024), 1024*1024)
	for sc.Scan() {
		onLine(sc.Text())
	}
	done <- struct{}{}
}

// CheckTCP dials the node's SSH port and reports reachability.
func CheckTCP(n Node) error {
	c, err := net.DialTimeout("tcp", n.addr(), 5*time.Second)
	if err != nil {
		return err
	}
	_ = c.Close()
	return nil
}

// CheckCommand runs a check command and returns its trimmed output plus
// whether it exited 0.
func CheckCommand(n Node, command string) (string, bool, error) {
	var out strings.Builder
	code, err := Run(n, "", command, nil, func(line string) {
		out.WriteString(line)
		out.WriteByte('\n')
	})
	if err != nil {
		return "", false, err
	}
	return strings.TrimSpace(out.String()), code == 0, nil
}

// shellQuote single-quotes a value safely for POSIX shells.
func shellQuote(s string) string {
	return "'" + strings.ReplaceAll(s, "'", `'\''`) + "'"
}
