package history

import (
	"encoding/json"
	"errors"
	"fmt"
	"path"
	"strings"

	bolt "go.etcd.io/bbolt"
)

// Working records have their own bucket. Snapshot rotation only owns the
// content-addressed archive; editing or deleting either cannot affect the other.
var working = []byte("working-v1")

type WorkingRecord struct {
	Revision string `json:"revision"`
	Text     string `json:"text"`
}

type WorkingChange struct {
	Revision string `json:"revision"`
	Text     string `json:"text"`
}

func validRecord(name string) bool {
	switch name {
	case "board.md", "letter.md", "OWNER.md", "GLOSSARY.md", "SHIFT.md":
		return true
	}
	short, ok := strings.CutPrefix(name, "knowledge/")
	return ok && short != ".md" && path.Base(short) == short && strings.HasSuffix(short, ".md") && !strings.ContainsAny(short, "\\\x00")
}

func recordKey(name, session string) string {
	if name == "letter.md" && session != "" {
		return "session/" + contentID(session) + "/letter.md"
	}
	return name
}

// A shared letter can be imported from a pre-existing project. A session's
// first edit forks that text; subsequent reads see only that session's draft.
func currentRecords(tx *bolt.Tx, session string) (map[string]WorkingRecord, error) {
	records := map[string]WorkingRecord{}
	b := tx.Bucket(working)
	if b == nil {
		return records, nil
	}
	decode := func(name string, value []byte) error {
		var r WorkingRecord
		if err := json.Unmarshal(value, &r); err != nil {
			return err
		}
		records[name] = r
		return nil
	}
	c := b.Cursor()
	for k, v := c.First(); k != nil; k, v = c.Next() {
		if strings.HasPrefix(string(k), "session/") {
			break
		}
		if err := decode(string(k), v); err != nil {
			return nil, err
		}
	}
	if session != "" {
		if v := b.Get([]byte(recordKey("letter.md", session))); v != nil {
			if err := decode("letter.md", v); err != nil {
				return nil, err
			}
		}
	}
	return records, nil
}

func workingOperation(tx *bolt.Tx, r Request) (any, error) {
	records, err := currentRecords(tx, r.Session)
	if err != nil || r.Action == "working-list" {
		return records, err
	}
	if len(r.Changes) == 0 {
		return nil, errors.New("no working record changes")
	}
	b, err := tx.CreateBucketIfNotExists(working)
	if err != nil {
		return nil, err
	}
	for name, change := range r.Changes {
		if !validRecord(name) {
			return nil, fmt.Errorf("unknown working record %q", name)
		}
		current := records[name]
		if current.Revision != change.Revision {
			return nil, fmt.Errorf("%s changed; read its current revision and retry", name)
		}
		if current.Revision != "" && current.Text == change.Text {
			continue
		}
		seq, err := b.NextSequence()
		if err != nil {
			return nil, err
		}
		next := WorkingRecord{Revision: fmt.Sprintf("r-%016x", seq), Text: change.Text}
		v, err := json.Marshal(next)
		if err != nil {
			return nil, err
		}
		if err = b.Put([]byte(recordKey(name, r.Session)), v); err != nil {
			return nil, err
		}
		records[name] = next
	}
	return records, nil
}
