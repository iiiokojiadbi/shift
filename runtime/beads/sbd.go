package main

import (
	"bytes"
	"crypto/sha256"
	"debug/buildinfo"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"runtime"
	"strings"
)

func prepareWorkspace(workspace string) error {
	data := filepath.Join(workspace, ".beads")
	for _, dir := range []string{filepath.Dir(workspace), workspace, filepath.Join(workspace, "profile"), data} {
		if err := privateDir(dir); err != nil {
			return err
		}
	}
	redirect := filepath.Join(data, "redirect")
	if _, err := os.Lstat(redirect); !errors.Is(err, os.ErrNotExist) {
		return fmt.Errorf("cannot use a redirected or unreadable private workspace: %s", redirect)
	}
	return nil
}

const sbdScriptHeader = "#!/bin/sh\n# Project command managed by Shift.\n"

func installSBD(root string) (string, error) {
	installed, err := os.Executable()
	if err != nil {
		return "", err
	}
	bin := filepath.Join(root, ".shift", "bin")
	for _, dir := range []string{filepath.Dir(bin), bin} {
		if err := privateDir(dir); err != nil {
			return "", err
		}
	}
	// A Windows reader can otherwise hold the old executable open during another
	// session's upgrade. Installation must work even when the task DB is offline.
	lock, err := workspaceLock(filepath.Join(bin, "sbd-install.lock"))
	if err != nil {
		return "", err
	}
	defer lock.Close()
	name := "sbd"
	var contents io.Reader
	var script string
	var source *os.File
	if runtime.GOOS == "windows" {
		// An executable preserves Unicode and argv without cmd.exe interpolation.
		name += ".exe"
		source, err = os.Open(installed)
		if err != nil {
			return "", err
		}
		defer source.Close()
		contents = source
	} else {
		script = sbdScriptHeader + `set -eu
root=$(CDPATH= cd -P "$(dirname -- "$0")/../.." && pwd -P)
exec ` + shellLiteral(installed) + ` "$root" shift-sbd "$@"
`
		contents = strings.NewReader(script)
	}
	rel := "./.shift/bin/" + name
	target := filepath.Join(bin, name)
	existing, err := os.Lstat(target)
	if err == nil {
		if !existing.Mode().IsRegular() {
			return "", fmt.Errorf("expected a regular project command at %s", target)
		}
		equal, err := checkSBD(target, root, script, source)
		if err != nil {
			return "", err
		}
		if equal && (runtime.GOOS == "windows" || existing.Mode().Perm()&0100 != 0) {
			return rel, nil
		}
	} else if !errors.Is(err, os.ErrNotExist) {
		return "", err
	}
	tmp, err := os.CreateTemp(bin, ".sbd-")
	if err != nil {
		return "", err
	}
	defer os.Remove(tmp.Name())
	_, err = io.Copy(tmp, contents)
	if err == nil {
		err = tmp.Chmod(0700)
	}
	err = errors.Join(err, tmp.Close())
	if err != nil {
		return "", err
	}
	if existing == nil {
		if err = renameExclusive(tmp.Name(), target); err != nil {
			return "", err
		}
		return rel, nil
	}
	current, err := os.Lstat(target)
	if err != nil || !os.SameFile(existing, current) {
		return "", fmt.Errorf("project command changed during setup: %s; retry setup", target)
	}
	if err = os.Rename(tmp.Name(), target); err != nil {
		return "", err
	}
	return rel, nil
}

func runSBD(bd, workspace string, args []string) error {
	lock, err := workspaceLock(filepath.Join(workspace, "write.lock"))
	if err != nil {
		return err
	}
	defer lock.Close()
	command, err := sbdCommand(args)
	if err != nil {
		return err
	}
	explicitInit := command == "init"
	if _, err := os.Stat(filepath.Join(workspace, ".beads", "metadata.json")); errors.Is(err, os.ErrNotExist) && !explicitInit {
		if err := prepareChildren(); err != nil {
			return err
		}
		init := taskCommand(bd, workspace, []string{"init", "--init-if-missing", "--non-interactive", "--skip-hooks", "--skip-agents", "--prefix", "shift"})
		if output, err := init.CombinedOutput(); err != nil {
			return fmt.Errorf("initialize bundled Beads: %w: %s", err, output)
		}
	} else if err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	cmd := taskCommand(bd, workspace, args)
	// Native paths (e.g. --body-file) are relative to the agent's shell.
	if !explicitInit {
		cmd.Dir = ""
	}
	cmd.Stdin, cmd.Stdout, cmd.Stderr = os.Stdin, os.Stdout, os.Stderr
	return runChild(cmd)
}

func shellLiteral(arg string) string { return "'" + strings.ReplaceAll(arg, "'", "'\"'\"'") + "'" }

func checkSBD(target, root, script string, source *os.File) (bool, error) {
	refusal := fmt.Errorf("existing %s is not a Shift launcher", target)
	old, err := os.Open(target)
	if err != nil {
		return false, err
	}
	defer old.Close()
	if source != nil {
		a, b := sha256.New(), sha256.New()
		if _, err = io.Copy(a, source); err != nil {
			return false, err
		}
		if _, err = source.Seek(0, 0); err != nil {
			return false, err
		}
		if _, err = io.Copy(b, old); err != nil {
			return false, err
		}
		if bytes.Equal(a.Sum(nil), b.Sum(nil)) {
			return true, nil
		}
		info, err := buildinfo.ReadFile(target)
		if err != nil || info.Path != "shift.local/runtime" {
			return false, refusal
		}
		return false, nil
	}
	body, err := io.ReadAll(io.LimitReader(old, 16384))
	if err != nil {
		return false, err
	}
	if strings.HasPrefix(string(body), sbdScriptHeader) {
		return string(body) == script, nil
	}
	// The local preview used shlex.quote only for paths containing shell
	// metacharacters. Match its exact two-line shape without executing it.
	cmd, ok := strings.CutPrefix(string(body), "#!/bin/sh\nexec ")
	if ok && strings.Count(cmd, "\n") == 1 {
		for _, arg := range []string{root, shellLiteral(root)} {
			path, ok := strings.CutSuffix(cmd, " "+arg+" \"$@\"\n")
			path = strings.Trim(path, "'")
			if ok && filepath.IsAbs(path) && strings.HasPrefix(filepath.Base(path), "shift-bd-") {
				return false, nil
			}
		}
	}
	return false, refusal
}

// Only root flags affect workspace selection or the position of an explicit init.
// Everything after the command is forwarded verbatim except database overrides.
func sbdCommand(args []string) (string, error) {
	name := ""
	for i := 0; i < len(args); i++ {
		arg := args[i]
		if arg == "--" {
			break
		}
		key, _, hasValue := strings.Cut(arg, "=")
		switch key {
		case "--global", "--db", "--database":
			return "", fmt.Errorf("sbd selects this project's private Beads database; omit %s", key)
		}
		if name != "" {
			continue
		}
		switch key {
		case "--actor", "-C", "--directory", "--dolt-auto-commit", "--mem-profile":
			if !hasValue {
				i++
			}
		default:
			if !strings.HasPrefix(arg, "-") {
				name = arg
			}
		}
	}
	return name, nil
}
