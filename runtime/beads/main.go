// Build with bundle-beads.ts. The payload is the complete verified upstream archive.
package main

import (
	"archive/tar"
	"archive/zip"
	"bytes"
	"compress/gzip"
	"crypto/sha256"
	_ "embed"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
)

//go:embed payload
var payload []byte

// Set by the packaging step from the pinned archive digest.
var digest, binaryDigest string

func unpack(dir string) error {
	write := func(name string, r io.Reader) error {
		switch name {
		case "bd", "bd.exe", "LICENSE", "README.md", "CHANGELOG.md":
		default:
			return fmt.Errorf("unexpected Beads archive member %q", name)
		}
		mode := os.FileMode(0600)
		if name == "bd" || name == "bd.exe" {
			mode = 0700
		}
		f, err := os.OpenFile(filepath.Join(dir, name), os.O_CREATE|os.O_EXCL|os.O_WRONLY, mode)
		if err != nil {
			return err
		}
		_, err = io.Copy(f, r)
		return errors.Join(err, f.Close())
	}
	if runtime.GOOS == "windows" {
		z, err := zip.NewReader(bytes.NewReader(payload), int64(len(payload)))
		if err != nil {
			return err
		}
		for _, f := range z.File {
			r, err := f.Open()
			if err != nil {
				return err
			}
			if err = errors.Join(write(f.Name, r), r.Close()); err != nil {
				return err
			}
		}
		return nil
	}
	gz, err := gzip.NewReader(bytes.NewReader(payload))
	if err != nil {
		return err
	}
	defer gz.Close()
	tr := tar.NewReader(gz)
	for {
		h, err := tr.Next()
		if err == io.EOF {
			return nil
		}
		if err != nil {
			return err
		}
		if h.Typeflag == tar.TypeDir && h.Name == "./" {
			continue
		}
		if err = write(strings.TrimPrefix(h.Name, "./"), tr); err != nil {
			return err
		}
	}
}

func binary() (string, error) {
	cache, err := os.UserCacheDir()
	if err != nil {
		return "", err
	}
	parent := filepath.Join(cache, "shift", "beads")
	final := filepath.Join(parent, digest)
	name := "bd"
	if runtime.GOOS == "windows" {
		name += ".exe"
	}
	path := filepath.Join(final, name)
	verify := func(dir string) error {
		path := filepath.Join(dir, name)
		fi, err := os.Lstat(dir)
		if err != nil {
			return err
		}
		if !fi.IsDir() {
			return fmt.Errorf("invalid Beads cache directory %s", final)
		}
		fi, err = os.Lstat(path)
		if err != nil || !fi.Mode().IsRegular() {
			return fmt.Errorf("invalid cached Beads binary %s", path)
		}
		f, err := os.Open(path)
		if err != nil {
			return err
		}
		defer f.Close()
		h := sha256.New()
		if _, err := io.Copy(h, f); err != nil {
			return err
		}
		if fmt.Sprintf("%x", h.Sum(nil)) != binaryDigest {
			return fmt.Errorf("invalid cached Beads checksum at %s; remove this cache directory and retry", final)
		}
		return nil
	}
	if err = verify(final); err == nil {
		return path, nil
	} else if !errors.Is(err, os.ErrNotExist) {
		return "", err
	}
	if err = os.MkdirAll(parent, 0700); err != nil {
		return "", err
	}
	tmp, err := os.MkdirTemp(parent, ".install-")
	if err != nil {
		return "", err
	}
	defer os.RemoveAll(tmp)
	if err = unpack(tmp); err != nil {
		return "", err
	}
	if err = verify(tmp); err != nil {
		return "", err
	}
	if err = os.Rename(tmp, final); err != nil {
		if other := verify(final); other != nil {
			return "", errors.Join(err, other)
		}
	}
	return path, nil
}

func privateDir(path string) error {
	if err := os.Mkdir(path, 0700); err != nil && !errors.Is(err, os.ErrExist) {
		return err
	}
	st, err := os.Lstat(path)
	if err != nil {
		return err
	}
	if !st.IsDir() {
		return fmt.Errorf("expected a private directory at %s", path)
	}
	return nil
}

func run(args []string) error {
	if len(args) < 2 || !filepath.IsAbs(args[0]) {
		return errors.New("usage: shift-bd ABSOLUTE_PROJECT command [args]")
	}
	bd, err := binary()
	if err != nil {
		return err
	}
	root := filepath.Clean(args[0])
	workspace := filepath.Join(root, ".shift", "beads")
	profile := filepath.Join(workspace, "profile")
	data := filepath.Join(workspace, ".beads")
	if len(args) == 2 && args[1] == "version" {
		cmd := exec.Command(bd, "version")
		cmd.Env = []string{"BD_DISABLE_METRICS=1", "SYSTEMROOT=" + os.Getenv("SYSTEMROOT")}
		cmd.Stdout, cmd.Stderr = os.Stdout, os.Stderr
		return runChild(cmd)
	}
	for _, dir := range []string{filepath.Dir(workspace), workspace, profile, data} {
		if err := privateDir(dir); err != nil {
			return err
		}
	}
	redirect := filepath.Join(data, "redirect")
	if _, err := os.Lstat(redirect); !errors.Is(err, os.ErrNotExist) {
		return fmt.Errorf("cannot use a redirected or unreadable private workspace: %s", redirect)
	}
	var expected []struct {
		ID       string `json:"id"`
		Revision string `json:"revision"`
	}
	commands := args[1:]
	if commands[0] == "shift-checked" {
		if len(commands) < 3 {
			return errors.New("missing checked task operation")
		}
		if err := json.Unmarshal([]byte(commands[1]), &expected); err != nil {
			return err
		}
		commands = commands[2:]
	}
	switch commands[0] {
	case "list", "ready", "show", "history":
	default:
		lock, err := workspaceLock(filepath.Join(workspace, "write.lock"))
		if err != nil {
			return err
		}
		defer lock.Close()
	}
	cmd := exec.Command(bd, commands...)
	cmd.Dir = workspace
	cmd.Env = []string{"HOME=" + profile, "USERPROFILE=" + profile, "BEADS_DIR=" + data, "BD_DISABLE_METRICS=1", "GIT_CEILING_DIRECTORIES=" + filepath.Dir(workspace), "GIT_CONFIG_NOSYSTEM=1", "DOLT_ROOT_PATH=" + profile}
	for _, key := range []string{"PATH", "SYSTEMROOT", "WINDIR", "TMP", "TEMP", "TMPDIR", "LANG", "LC_ALL"} {
		if v, ok := os.LookupEnv(key); ok {
			cmd.Env = append(cmd.Env, key+"="+v)
		}
	}
	if len(expected) > 0 {
		lookup := []string{"show", "--brief-deps", "--json"}
		for _, entry := range expected {
			lookup = append(lookup, "--id="+entry.ID)
		}
		probe := exec.Command(bd, lookup...)
		probe.Dir, probe.Env, probe.Stderr = cmd.Dir, cmd.Env, os.Stderr
		out, err := probe.Output()
		if err != nil {
			return err
		}
		var issues []struct {
			ID       string `json:"id"`
			Revision string `json:"revision"`
		}
		if err = json.Unmarshal(out, &issues); err != nil {
			return err
		}
		current := map[string]string{}
		for _, entry := range issues {
			current[entry.ID] = entry.Revision
		}
		for _, entry := range expected {
			if entry.Revision == "" || current[entry.ID] != entry.Revision {
				return errors.New("a task changed during this operation; reread it and retry")
			}
		}
	}
	cmd.Stdin, cmd.Stdout, cmd.Stderr = os.Stdin, os.Stdout, os.Stderr
	return runChild(cmd)
}

func main() {
	if err := run(os.Args[1:]); err != nil {
		var exit *exec.ExitError
		if errors.As(err, &exit) {
			os.Exit(exit.ExitCode())
		}
		fmt.Fprintln(os.Stderr, strings.TrimSpace(err.Error()))
		os.Exit(1)
	}
}
