package history

import (
	"os"
	"path/filepath"
	"testing"
)

func TestWorkingRevisionAndSnapshot(t *testing.T) {
	db := filepath.Join(t.TempDir(), "history.db")
	read := func(session string) map[string]WorkingRecord {
		return must[map[string]WorkingRecord](t, db, Request{Action: "working-list", Session: session})
	}
	write := func(session, name, revision, text string) Request {
		return Request{Action: "working-write", Session: session, Changes: map[string]WorkingChange{name: {Revision: revision, Text: text}}}
	}
	if len(read("a")) != 0 {
		t.Fatal("fresh archive has records")
	}
	records := must[map[string]WorkingRecord](t, db, write("", "letter.md", "", "imported"))
	must[map[string]WorkingRecord](t, db, write("a", "letter.md", records["letter.md"].Revision, "a"))
	if read("b")["letter.md"].Text != "imported" || read("a")["letter.md"].Text != "a" {
		t.Fatal("letters overlap")
	}
	board := must[map[string]WorkingRecord](t, db, write("", "board.md", "", "original"))["board.md"]
	req := begin("first")
	req.Session = "a"
	req.Files["board.md"] = board.Text
	req.Files["letter.md"] = "a"
	req.Expected = map[string]string{"board.md": board.Revision, "letter.md": read("a")["letter.md"].Revision}
	id := must[string](t, db, req)
	must[string](t, db, finish(id, 1))
	race := make(chan error, 2)
	for _, v := range []string{"one", "two"} {
		go func() { _, err := call(db, write("", "board.md", board.Revision, v)); race <- err }()
	}
	if (<-race == nil) == (<-race == nil) {
		t.Fatal("expected exactly one winner")
	}
	req.Key = "later"
	if _, err := call(db, req); err == nil {
		t.Fatal("accepted stale snapshot")
	}
	if must[Entry](t, db, Request{Action: "read", ID: id}).Files["board.md"] != "original" {
		t.Fatal("snapshot changed")
	}
	must[string](t, db, Request{Action: "delete", ID: id})
	if len(read("a")) != 2 {
		t.Fatal("lost current records with snapshot")
	}
}

func TestDraftLifecycle(t *testing.T) {
	db := filepath.Join(t.TempDir(), "history.db")
	r := Request{Action: "draft-open", File: "letter.md", Session: "branch", Text: "original"}
	path := must[string](t, db, r)
	if err := os.WriteFile(path, []byte("edited"), 0600); err != nil {
		t.Fatal(err)
	}
	if must[string](t, db, r) != path {
		t.Fatal("checkout lost earlier draft")
	}
	r.Action = "draft-read"
	if got := must[string](t, db, r); got != "edited" {
		t.Fatal(got)
	}
	r.Action = "draft-remove"
	if _, err := call(db, r); err == nil {
		t.Fatal("cleaned a changed draft")
	}
	r.Text = "edited"
	must[string](t, db, r)
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Fatal("draft survived cleanup", err)
	}
}

func TestDraftRemovalPreservesReplacement(t *testing.T) {
	for _, claimedText := range []string{"applied", "edited before cleanup"} {
		dir := t.TempDir()
		path := filepath.Join(dir, "draft.md")
		claimed := filepath.Join(dir, "recovery.md")
		for file, text := range map[string]string{claimed: claimedText, path: "replacement"} {
			if err := os.WriteFile(file, []byte(text), 0600); err != nil {
				t.Fatal(err)
			}
		}
		err := finishDraftRemoval(path, claimed, "applied")
		if (err == nil) != (claimedText == "applied") {
			t.Fatal("unexpected cleanup result", err)
		}
		if body, err := os.ReadFile(path); err != nil || string(body) != "replacement" {
			t.Fatal("lost replacement", err)
		}
		if claimedText != "applied" {
			if body, err := os.ReadFile(claimed); err != nil || string(body) != claimedText {
				t.Fatal("lost concurrent edit", err)
			}
		}
	}
}
