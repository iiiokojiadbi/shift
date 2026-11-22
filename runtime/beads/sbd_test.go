package main

import (
	"crypto/sha256"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func TestProjectLauncherSetup(t *testing.T) {
	root := t.TempDir()
	rel, err := installSBD(root)
	if err != nil {
		t.Fatal(err)
	}
	target := filepath.Join(root, rel)
	before, err := os.Stat(target)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := installSBD(root); err != nil {
		t.Fatal(err)
	}
	after, err := os.Stat(target)
	if err != nil || !os.SameFile(before, after) {
		t.Fatal("setup replaced an identical launcher", err)
	}
	if _, err := os.Stat(filepath.Join(root, ".shift", "beads")); !os.IsNotExist(err) {
		t.Fatal("setup touched the task workspace", err)
	}
	if err := os.WriteFile(target, []byte("unrelated"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := installSBD(root); err == nil {
		t.Fatal("overwrote an unrelated executable")
	}
	if runtime.GOOS != "windows" {
		if err := os.Remove(target); err != nil {
			t.Fatal(err)
		}
		if err := os.Symlink(filepath.Join(root, "elsewhere"), target); err != nil {
			t.Fatal(err)
		}
		if _, err := installSBD(root); err == nil {
			t.Fatal("accepted redirected project command")
		}
	}
}

func TestConcurrentProjectLauncherSetup(t *testing.T) {
	root := t.TempDir()
	start := make(chan struct{})
	results := make(chan error, 4)
	for range cap(results) {
		go func() {
			<-start
			_, err := installSBD(root)
			results <- err
		}()
	}
	close(start)
	for range cap(results) {
		if err := <-results; err != nil {
			t.Fatal(err)
		}
	}
}

func TestSBDWorkspaceOptions(t *testing.T) {
	for _, args := range [][]string{{"--json", "init"}, {"--actor", "someone", "--json", "init"}, {"--actor=someone", "init"}} {
		if got, err := sbdCommand(args); err != nil || got != "init" {
			t.Fatalf("%v: %q, %v", args, got, err)
		}
	}
	for _, args := range [][]string{{"--db", "/other", "list"}, {"list", "--database=other"}, {"--global", "ready"}} {
		if _, err := sbdCommand(args); err == nil {
			t.Fatalf("accepted %v", args)
		}
	}
	if got, err := sbdCommand([]string{"comments", "add", "id", "--", "--global"}); err != nil || got != "comments" {
		t.Fatal(got, err)
	}
}

func TestTaskGuideUpgrade(t *testing.T) {
	data := t.TempDir()
	path := filepath.Join(data, "PRIME.md")
	old := "Older shared workflow.\n"
	marked := fmt.Sprintf("%s<!-- shift-task guide %x -->\n", old, sha256.Sum256([]byte(old)))
	for _, before := range []string{marked, "Project-specific instructions.", "Local additions\n" + marked} {
		if err := os.WriteFile(path, []byte(before), 0600); err != nil {
			t.Fatal(err)
		}
		if err := prepareTaskGuide(data); err != nil {
			t.Fatal(err)
		}
		after, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		if before == marked {
			if !strings.HasPrefix(string(after), taskGuide) {
				t.Fatal("previous shared guide was not updated")
			}
		} else if string(after) != before {
			t.Fatal("project guide was overwritten")
		}
	}
}
