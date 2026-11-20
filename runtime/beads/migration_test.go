package main

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	"shift.local/runtime/history"
)

type fields = map[string]any

func transferCall(root string, args fields) (string, error) {
	data, err := json.Marshal(args)
	if err != nil {
		return "", err
	}
	var out bytes.Buffer
	err = migrate(root, bytes.NewReader(data), &out)
	return out.String(), err
}

func mustTransfer(t *testing.T, root string, args fields) string {
	t.Helper()
	out, err := transferCall(root, args)
	if err != nil {
		t.Fatal(err)
	}
	return out
}
func marker(t *testing.T, root string) transfer {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join(root, "migration.json"))
	if err != nil {
		t.Fatal(err)
	}
	var state transfer
	if err = json.Unmarshal(raw, &state); err != nil {
		t.Fatal(err)
	}
	return state
}
func put(t *testing.T, path, body string) {
	t.Helper()
	if err := os.WriteFile(path, []byte(body), 0600); err != nil {
		t.Fatal(err)
	}
}
func content(t *testing.T, path string) string {
	t.Helper()
	b, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

func TestInterruptedTransfer(t *testing.T) {
	root := t.TempDir()
	list := filepath.Join(root, "TASKS.md")
	put(t, list, "original")
	if err := os.Mkdir(filepath.Join(root, "archive"), 0700); err != nil {
		t.Fatal(err)
	}
	mustTransfer(t, root, fields{"action": "start"})
	old := marker(t, root)
	var results [2]error
	var wg sync.WaitGroup
	for i, name := range []string{"a", "b"} {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, results[i] = transferCall(root, fields{"action": "confirm", "task": name, "target": "shift-one", "generation": old.Backup})
		}()
	}
	wg.Wait()
	if (results[0] == nil) == (results[1] == nil) {
		t.Fatal(results)
	}
	old = marker(t, root)
	if _, err := transferCall(root, fields{"action": "cleanup", "expected": []revision{{ID: "wrong", Revision: "1"}}, "generation": old.Backup}); err == nil || !strings.Contains(err.Error(), "destination") {
		t.Fatal(err)
	}
	stage, err := os.MkdirTemp(root, "legacy-backup-")
	if err != nil {
		t.Fatal(err)
	}
	old.Staging = filepath.Base(stage)
	if err = writeTransfer(filepath.Join(root, "migration.json"), old); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"TASKS.md", "archive"} {
		if err = renameExclusive(filepath.Join(root, name), filepath.Join(stage, name)); err != nil {
			t.Fatal(err)
		}
	}
	put(t, list, "concurrent")
	if err = renameExclusive(filepath.Join(stage, "TASKS.md"), list); !os.IsExist(err) {
		t.Fatalf("replaced concurrent document: %v", err)
	}
	notice := mustTransfer(t, root, fields{"action": "start"})
	state := marker(t, root)
	if !strings.Contains(notice, old.Staging) || state.Backup == old.Backup || len(state.Confirmed) != 0 {
		t.Fatal(notice, state)
	}
	if content(t, list) != "concurrent" || content(t, filepath.Join(root, state.Backup, "TASKS.md")) != "concurrent" || content(t, filepath.Join(stage, "TASKS.md")) != "original" || content(t, filepath.Join(root, old.Backup, "TASKS.md")) != "original" {
		t.Fatal("lost a version")
	}
	if _, err = os.Stat(filepath.Join(root, "archive")); err != nil {
		t.Fatal(err)
	}
	if _, err = transferCall(root, fields{"action": "confirm", "task": "a", "target": "b", "generation": old.Backup}); err == nil {
		t.Fatal("accepted obsolete backup generation")
	}
}

func TestMigrationWithoutOpenTasks(t *testing.T) {
	root := t.TempDir()
	path := filepath.Join(root, "TASKS.md")
	put(t, path, "none")
	mustTransfer(t, root, fields{"action": "start"})
	state := marker(t, root)
	db := filepath.Join(root, "history.db")
	save := func(args fields) string {
		t.Helper()
		b, err := json.Marshal(args)
		if err != nil {
			t.Fatal(err)
		}
		var out bytes.Buffer
		if err = history.Run(db, bytes.NewReader(b), &out); err != nil {
			t.Fatal(err)
		}
		var result string
		if err = json.Unmarshal(out.Bytes(), &result); err != nil {
			t.Fatal(err)
		}
		return result
	}
	id := save(fields{"action": "begin", "key": "test", "about": "test", "files": map[string]string{"letter.md": "letter", "board.md": "board"}})
	save(fields{"action": "finish", "id": id, "about": "ok", "state": "complete", "limit": 30})
	args := fields{"action": "cleanup", "previous": id, "generation": state.Backup, "confirmed": map[string]string{}, "receipt": "wrong"}
	if _, err := transferCall(root, args); err == nil {
		t.Fatal("accepted invalid receipt")
	}
	args["receipt"] = restoreReceipt(state, id)
	handle, err := os.OpenFile(path, os.O_WRONLY, 0600)
	if err != nil {
		t.Fatal(err)
	}
	defer handle.Close()
	mustTransfer(t, root, args)
	if _, err = handle.WriteAt([]byte("late"), 0); err != nil {
		t.Fatal(err)
	}
	if content(t, filepath.Join(root, state.Backup, "TASKS.md")) != "none" {
		t.Fatal("old handle changed backup")
	}
	if out := mustTransfer(t, root, args); !strings.Contains(out, "already finished") {
		t.Fatal(out)
	}
	put(t, path, "new task list")
	mustTransfer(t, root, fields{"action": "start", "previous": id})
	next := marker(t, root)
	if next.Done || next.Previous != id || next.Backup == state.Backup || content(t, filepath.Join(root, next.Backup, "TASKS.md")) != "new task list" || content(t, filepath.Join(root, state.Backup, "TASKS.md")) != "none" {
		t.Fatal("did not preserve both migration generations")
	}
}
