package history

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"testing"

	bolt "go.etcd.io/bbolt"
)

func call(path string, r Request) ([]byte, error) {
	raw, err := json.Marshal(r)
	if err != nil {
		return nil, err
	}
	var result bytes.Buffer
	err = Run(path, bytes.NewReader(raw), &result)
	return result.Bytes(), err
}
func must[T any](t *testing.T, path string, r Request) T {
	t.Helper()
	raw, err := call(path, r)
	if err != nil {
		t.Fatal(err)
	}
	var result T
	if err := json.Unmarshal(raw, &result); err != nil {
		t.Fatal(err)
	}
	return result
}
func begin(key string) Request {
	return Request{Action: "begin", Key: key, About: key, Files: map[string]string{"letter.md": "letter " + key, "board.md": "same board"}}
}
func finish(id string, limit int) Request {
	return Request{Action: "finish", ID: id, State: "complete", Limit: limit, About: "shifted", Files: map[string]string{"summary.md": "same digest"}}
}
func TestRetentionAndRecovery(t *testing.T) {
	db := filepath.Join(t.TempDir(), "history.db")
	pending := must[string](t, db, begin("pending"))
	for i := 1; i <= 31; i++ {
		req := begin(fmt.Sprint(i))
		id := must[string](t, db, req)
		if id != must[string](t, db, req) {
			t.Fatal("duplicate acceptance")
		}
		ack := finish(id, 30)
		must[string](t, db, ack)
		must[string](t, db, ack)
	}
	list := must[[]Entry](t, db, Request{Action: "list"})
	if len(list) != 31 || list[0].ID != pending {
		t.Fatal("rotation removed the pending shift or exceeded the bound")
	}
	read := func(id string) Entry { return must[Entry](t, db, Request{Action: "read", ID: id}) }
	if read(list[1].ID).Files["letter.md"] != "letter 2" {
		t.Fatal("wrong oldest completed letter")
	}
	if _, err := call(db, Request{Action: "delete", ID: pending}); err == nil {
		t.Fatal("deleted pending letter")
	}
	invalid := finish(pending, 1)
	invalid.Files["board.md"] = "overwrite"
	if _, err := call(db, invalid); err == nil {
		t.Fatal("accepted invalid completion")
	}
	if read(pending).State != "pending" || len(must[[]Entry](t, db, Request{Action: "list"})) != 31 {
		t.Fatal("failed completion changed history")
	}
	must[string](t, db, finish(pending, 2))
	list = must[[]Entry](t, db, Request{Action: "list"})
	if len(list) != 2 {
		t.Fatal(list)
	}
	must[string](t, db, Request{Action: "delete", ID: list[0].ID})
	remaining := read(list[1].ID)
	if remaining.Files["board.md"] != "same board" {
		t.Fatal("lost shared blob")
	}
	store, err := bolt.Open(db, 0600, nil)
	if err != nil {
		t.Fatal(err)
	}
	err = store.View(func(tx *bolt.Tx) error {
		if n := tx.Bucket(contents).Stats().KeyN; n != 3 {
			t.Fatalf("expected only the three live blobs, got %d", n)
		}
		return nil
	})
	store.Close()
	if err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(db)
	if err != nil {
		t.Fatal(err)
	}
	copyPath := filepath.Join(t.TempDir(), "history.db")
	if err := os.WriteFile(copyPath, data, 0600); err != nil {
		t.Fatal(err)
	}
	if must[Entry](t, copyPath, Request{Action: "read", ID: list[1].ID}).Files["letter.md"] != remaining.Files["letter.md"] {
		t.Fatal("transferred archive changed")
	}
}
func TestConcurrentAcceptance(t *testing.T) {
	db := filepath.Join(t.TempDir(), "history.db")
	var wg sync.WaitGroup
	for i := 0; i < 6; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, err := call(db, begin("shared"))
			if err != nil {
				t.Error(err)
			}
		}()
	}
	wg.Wait()
	if n := len(must[[]Entry](t, db, Request{Action: "list"})); n != 1 {
		t.Fatal(n)
	}
}

func TestCompletionOrderAndWaitingReceipt(t *testing.T) {
	db := filepath.Join(t.TempDir(), "history.db")
	a := must[string](t, db, begin("first"))
	b := must[string](t, db, begin("second"))
	held := finish(b, 1)
	held.Session, held.Wait = "reader", true
	must[string](t, db, held)
	must[string](t, db, finish(a, 1))
	if _, err := call(db, Request{Action: "delete", ID: b}); err == nil {
		t.Fatal("deleted a waiting letter")
	}
	if current := must[string](t, db, Request{Action: "received", Session: "reader", ID: a, Limit: 1}); current != b {
		t.Fatal("acknowledged a different letter")
	}
	must[string](t, db, Request{Action: "received", Session: "reader", ID: b, Limit: 1})
	if left := must[[]Entry](t, db, Request{Action: "list"}); len(left) != 1 || left[0].ID != a {
		t.Fatal("rotation used creation order", left)
	}
	if _, err := call(db, Request{Action: "finish", ID: a, State: "failed", Limit: 1, About: "failed"}); err == nil {
		t.Fatal("rewrote completed shift")
	}
}

func TestHandBackListsOnlyRetainedShifts(t *testing.T) {
	db := filepath.Join(t.TempDir(), "history.db")
	makeShift := func(key, session string) string {
		id := must[string](t, db, begin(key))
		outcome := finish(id, 1)
		outcome.Session, outcome.Wait = session, session != ""
		must[string](t, db, outcome)
		return id
	}
	other := makeShift("held by another chat", "other")
	previous := makeShift("previous", "writer")
	checkUpcoming := must[[]Entry](t, db, Request{Action: "list", Upcoming: true, Limit: 1, Session: "writer"})
	if len(checkUpcoming) != 1 || checkUpcoming[0].ID != other {
		t.Fatalf("prospective retention: %v", checkUpcoming)
	}
	current := must[string](t, db, begin("current"))
	preview := Request{Action: "list", ID: current, Session: "writer", Limit: 1}
	check := func(req Request, ids ...string) {
		t.Helper()
		entries := must[[]Entry](t, db, req)
		if len(entries) != len(ids) {
			t.Fatalf("wanted %v, got %v", ids, entries)
		}
		for i, e := range entries {
			if e.ID != ids[i] {
				t.Fatalf("wanted %v, got %v", ids, entries)
			}
		}
	}
	check(preview, other, current)
	check(Request{Action: "list"}, other, previous, current)
	outcome := finish(current, 1)
	outcome.Session, outcome.Wait = "writer", true
	must[string](t, db, outcome)
	check(preview, other, current)
	must[string](t, db, Request{Action: "received", ID: current, Session: "writer", Limit: 1})
	check(Request{Action: "list"}, other, current)
}

func TestChangedLetterCountsAsProgress(t *testing.T) {
	db := filepath.Join(t.TempDir(), "history.db")
	first := begin("first")
	id := must[string](t, db, first)
	must[string](t, db, finish(id, 10))

	replay := first
	replay.Key = "unchanged"
	replay.Compare = id
	if got := must[string](t, db, replay); got != "" {
		t.Fatalf("unchanged records accepted as %s", got)
	}
	replay.Files["letter.md"] = "Updated result and next action."
	if got := must[string](t, db, replay); got == "" {
		t.Fatal("updated letter refused")
	}
}
