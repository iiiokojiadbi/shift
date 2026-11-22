// Package history owns completed and pending shifts independently of the task database.
package history

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"maps"
	"os"
	"sort"
	"strings"
	"time"

	bolt "go.etcd.io/bbolt"
)

type Request struct {
	Text     string                   `json:"text"`
	Revision string                   `json:"revision"`
	Changes  map[string]WorkingChange `json:"changes"`
	Expected map[string]string        `json:"expected"`
	Upcoming bool                     `json:"upcoming"`
	File     string                   `json:"file"`
	Compare  string                   `json:"compare"`
	Session  string                   `json:"session"`
	Wait     bool                     `json:"wait"`
	Query    string                   `json:"query"`
	Action   string                   `json:"action"`
	ID       string                   `json:"id"`
	Key      string                   `json:"key"`
	About    string                   `json:"about"`
	Files    map[string]string        `json:"files"`
	Limit    int                      `json:"limit"`
	State    string                   `json:"state"`
}
type Entry struct {
	Initial    string            `json:"initial,omitempty"`
	Completion uint64            `json:"completion,omitempty"`
	ID         string            `json:"id"`
	Key        string            `json:"key"`
	About      string            `json:"about"`
	State      string            `json:"state"`
	Files      map[string]string `json:"files"`
}

var shifts = []byte("shifts-v1")
var waiting = []byte("waiting-v1")
var contents = []byte("contents-v1")

func load(v []byte) (Entry, error) {
	var e Entry
	if v == nil {
		return e, errors.New("unknown shift")
	}
	err := json.Unmarshal(v, &e)
	return e, err
}

func contentID(s string) string {
	sum := sha256.Sum256([]byte(s))
	return hex.EncodeToString(sum[:])
}

func save(entries, blobs *bolt.Bucket, e Entry, files map[string]string) error {
	for key, s := range files {
		id := contentID(s)
		if blobs.Get([]byte(id)) == nil {
			if err := blobs.Put([]byte(id), []byte(s)); err != nil {
				return err
			}
		}
		e.Files[key] = id
	}
	v, err := json.Marshal(e)
	if err != nil {
		return err
	}
	return entries.Put([]byte(e.ID), v)
}

// For a hand-back prepared before settlement, count the pending shift as the newest
// completion and release this session's hold, just as finish and its receipt will.
func expiredEntries(entries *bolt.Bucket, limit int, releaseSession string) ([]Entry, error) {
	protected := map[string]bool{}
	if queue := entries.Tx().Bucket(waiting); queue != nil {
		if err := queue.ForEach(func(session, id []byte) error {
			if string(session) != releaseSession {
				protected[string(id)] = true
			}
			return nil
		}); err != nil {
			return nil, err
		}
	}
	var completed []Entry
	if err := entries.ForEach(func(k, v []byte) error {
		e, err := load(v)
		if err != nil {
			return err
		}
		if e.State == "complete" && !protected[e.ID] {
			completed = append(completed, e)
		}
		return nil
	}); err != nil {
		return nil, err
	}
	sort.Slice(completed, func(i, j int) bool { return completed[i].Completion < completed[j].Completion })
	return completed[:max(0, len(completed)-limit)], nil
}

func rotate(entries, blobs *bolt.Bucket, limit int) error {
	expired, err := expiredEntries(entries, limit, "")
	if err != nil {
		return err
	}
	for _, e := range expired {
		if err := entries.Delete([]byte(e.ID)); err != nil {
			return err
		}
	}
	referenced := map[string]bool{}
	if err := entries.ForEach(func(_, v []byte) error {
		e, err := load(v)
		if err != nil {
			return err
		}
		for _, id := range e.Files {
			referenced[id] = true
		}
		return nil
	}); err != nil {
		return err
	}
	var unused [][]byte
	if err := blobs.ForEach(func(k, _ []byte) error {
		if !referenced[string(k)] {
			unused = append(unused, append([]byte(nil), k...))
		}
		return nil
	}); err != nil {
		return err
	}
	for _, k := range unused {
		if err := blobs.Delete(k); err != nil {
			return err
		}
	}
	return nil
}

func transact(tx *bolt.Tx, r Request) (any, error) {
	if r.Action == "waiting" || r.Action == "received" {
		if r.Session == "" {
			return nil, errors.New("session is required")
		}
		queue := tx.Bucket(waiting)
		if queue == nil {
			return "", nil
		}
		current := string(queue.Get([]byte(r.Session)))
		if r.Action == "received" && current == r.ID {
			if r.Limit < 1 {
				return nil, errors.New("missing retention limit")
			}
			if err := queue.Delete([]byte(r.Session)); err != nil {
				return nil, err
			}
			return current, rotate(tx.Bucket(shifts), tx.Bucket(contents), r.Limit)
		}
		return current, nil
	}
	b := tx.Bucket(shifts)
	blobs := tx.Bucket(contents)
	if b == nil || blobs == nil {
		if empty, _ := tx.Cursor().First(); empty != nil {
			return nil, errors.New("unrecognized shift archive")
		}
		if r.Action == "working-list" {
			return map[string]WorkingRecord{}, nil
		}
		if r.Action == "list" {
			return []Entry{}, nil
		}
		if !tx.Writable() || (r.Action != "begin" && r.Action != "working-write") {
			return nil, errors.New("no saved shift")
		}
		var err error
		b, err = tx.CreateBucketIfNotExists(shifts)
		if err != nil {
			return nil, err
		}
		blobs, err = tx.CreateBucketIfNotExists(contents)
		if err != nil {
			return nil, err
		}
	}
	switch r.Action {
	case "working-list", "working-write", "working-delete":
		return workingOperation(tx, r)
	case "begin":
		if r.Key == "" || r.Files["letter.md"] == "" || r.Files["board.md"] == "" || r.About == "" {
			return nil, errors.New("missing shift records")
		}
		stable := strings.Split(r.About, "\n")
		for i, line := range stable {
			if strings.HasPrefix(line, "at: ") {
				stable[i] = "at:"
				break
			}
		}
		input, err := json.Marshal(struct {
			About string
			Files map[string]string
		}{strings.Join(stable, "\n"), r.Files})
		if err != nil {
			return nil, err
		}
		initial := contentID(string(input))
		c := b.Cursor()
		for _, v := c.Last(); v != nil; _, v = c.Prev() {
			e, err := load(v)
			if err != nil {
				return nil, err
			}
			if e.Key == r.Key || (e.State == "pending" && e.Initial == initial) {
				if e.Initial != initial {
					return nil, errors.New("shift request key already used for different records")
				}
				return e.ID, nil
			}
		}
		if r.Expected != nil {
			records, err := currentRecords(tx, r.Session)
			if err != nil {
				return nil, err
			}
			revisions := map[string]string{}
			for name, record := range records {
				revisions[name] = record.Revision
			}
			if !maps.Equal(revisions, r.Expected) {
				return nil, errors.New("working records changed before saving; read them and retry")
			}
		}
		if r.Compare != "" && b.Get([]byte(r.Compare)) != nil {
			prior, err := load(b.Get([]byte(r.Compare)))
			if err != nil {
				return nil, err
			}
			// The completion adds its digest after acceptance. Compare all records
			// originally supplied by the agent, including the letter.
			delete(prior.Files, "summary.md")
			current := make(map[string]string, len(r.Files))
			for name, body := range r.Files {
				current[name] = contentID(body)
			}
			if maps.Equal(prior.Files, current) {
				return "", nil
			}
		}
		seq, err := b.NextSequence()
		if err != nil {
			return nil, err
		}
		id := fmt.Sprintf("s-%016x", seq)
		e := Entry{ID: id, Key: r.Key, Initial: initial, State: "pending", About: r.About, Files: map[string]string{}}
		return id, save(b, blobs, e, r.Files)
	case "finish":
		if r.Limit < 1 || (r.State != "complete" && r.State != "failed" && r.State != "unsettled") || r.About == "" {
			return nil, errors.New("invalid shift outcome")
		}
		e, err := load(b.Get([]byte(r.ID)))
		if err != nil {
			return nil, err
		}
		if e.State == "complete" || e.State == "failed" {
			if r.State != e.State || e.About != r.About {
				return nil, errors.New("completed shift is immutable")
			}
			for k, v := range r.Files {
				if e.Files[k] != contentID(v) {
					return nil, errors.New("completed shift is immutable")
				}
			}
			return e.ID, nil
		}
		if e.State == "unsettled" && r.State == "failed" {
			return nil, errors.New("cannot discard an unsettled letter")
		}
		if r.State == "complete" {
			order, err := b.NextSequence()
			if err != nil {
				return nil, err
			}
			e.Completion = order
		}
		for k := range r.Files {
			if k != "summary.md" {
				return nil, errors.New("only the digest can be added on completion")
			}
		}
		e.About = r.About
		e.State = r.State
		if err := save(b, blobs, e, r.Files); err != nil {
			return nil, err
		}
		if r.State == "complete" {
			if r.Session != "" {
				queue, err := tx.CreateBucketIfNotExists(waiting)
				if err != nil {
					return nil, err
				}
				if r.Wait {
					err = queue.Put([]byte(r.Session), []byte(e.ID))
				} else {
					err = queue.Delete([]byte(r.Session))
				}
				if err != nil {
					return nil, err
				}
			}
			err = rotate(b, blobs, r.Limit)
		}
		return e.ID, err
	case "search":
		query := strings.ToLower(strings.TrimSpace(r.Query))
		if query == "" || r.Limit < 1 || r.Limit > 50 {
			return nil, errors.New("pass search text and a limit between 1 and 50")
		}
		matches := []string{}
		cursor := b.Cursor()
		for _, v := cursor.Last(); v != nil && len(matches) < r.Limit; _, v = cursor.Prev() {
			e, err := load(v)
			if err != nil {
				return nil, err
			}
			names := []string{"about.md"}
			for n := range e.Files {
				names = append(names, n)
			}
			sort.Strings(names)
			for _, n := range names {
				body := e.About
				if n != "about.md" {
					raw := blobs.Get([]byte(e.Files[n]))
					if raw == nil {
						return nil, fmt.Errorf("missing content for %s", n)
					}
					body = string(raw)
				}
				if strings.Contains(strings.ToLower(body), query) {
					matches = append(matches, e.ID+" · "+n)
					if len(matches) == r.Limit {
						break
					}
				}
			}
		}
		return matches, nil
	case "list":
		skip := map[string]bool{}
		if r.Limit > 0 && (r.ID != "" || r.Upcoming) {
			current := Entry{}
			if v := b.Get([]byte(r.ID)); v != nil {
				var err error
				current, err = load(v)
				if err != nil {
					return nil, err
				}
			}
			queue := tx.Bucket(waiting)
			reserve := r.Upcoming || current.State == "pending" || current.State == "unsettled"
			held := current.ID != "" && queue != nil && string(queue.Get([]byte(r.Session))) == current.ID
			if reserve || held {
				limit := r.Limit
				if reserve {
					limit--
				}
				expired, err := expiredEntries(b, limit, r.Session)
				if err != nil {
					return nil, err
				}
				for _, e := range expired {
					skip[e.ID] = true
				}
			}
		}
		result := []Entry{}
		err := b.ForEach(func(k, v []byte) error {
			if skip[string(k)] {
				return nil
			}
			e, err := load(v)
			if err == nil {
				e.Files = nil
				e.Key = ""
				e.Initial = ""
				result = append(result, e)
			}
			return err
		})
		return result, err
	case "read":
		e, err := load(b.Get([]byte(r.ID)))
		if err != nil {
			return nil, err
		}
		for k, v := range e.Files {
			if r.File != "" && r.File != k {
				delete(e.Files, k)
				continue
			}
			raw := blobs.Get([]byte(v))
			if raw == nil || contentID(string(raw)) != v {
				return nil, fmt.Errorf("damaged content for %s", k)
			}
			e.Files[k] = string(raw)
		}
		return e, nil
	case "delete":
		e, err := load(b.Get([]byte(r.ID)))
		if err != nil {
			return nil, err
		}
		if queue := tx.Bucket(waiting); queue != nil {
			err := queue.ForEach(func(_, id []byte) error {
				if string(id) == e.ID {
					return errors.New("the waiting letter is protected")
				}
				return nil
			})
			if err != nil {
				return nil, err
			}
		}
		if e.State == "pending" || e.State == "unsettled" {
			return nil, errors.New("the pending letter is protected")
		}
		if err = b.Delete([]byte(r.ID)); err != nil {
			return nil, err
		}
		return r.ID, rotate(b, blobs, int(^uint(0)>>1))
	}
	return nil, errors.New("unknown archive operation")
}

func Run(path string, in io.Reader, out io.Writer) error {
	var r Request
	if err := json.NewDecoder(in).Decode(&r); err != nil {
		return err
	}
	if strings.HasPrefix(r.Action, "draft-") {
		result, err := draftOperation(path, r)
		if err != nil {
			return err
		}
		return json.NewEncoder(out).Encode(result)
	}
	readOnly := r.Action == "working-list" || r.Action == "list" || r.Action == "read" || r.Action == "waiting" || r.Action == "search"
	st, err := os.Lstat(path)
	if err == nil && !st.Mode().IsRegular() {
		return errors.New("expected a regular shift archive")
	}
	if errors.Is(err, os.ErrNotExist) && readOnly {
		if r.Action == "working-list" {
			return json.NewEncoder(out).Encode(map[string]WorkingRecord{})
		}
		if r.Action == "list" {
			return json.NewEncoder(out).Encode([]Entry{})
		}
		return errors.New("no saved shifts")
	}
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	if errors.Is(err, os.ErrNotExist) && r.Action != "working-write" && (r.Action != "begin" || r.Key == "" || r.About == "" || r.Files["letter.md"] == "" || r.Files["board.md"] == "") {
		return errors.New("no saved shift or missing initial records")
	}
	db, err := bolt.Open(path, 0600, &bolt.Options{ReadOnly: readOnly, Timeout: 5 * time.Second})
	if err != nil {
		return err
	}
	defer db.Close()
	var result any
	op := db.Update
	if readOnly {
		op = db.View
	}
	err = op(func(tx *bolt.Tx) error { var err error; result, err = transact(tx, r); return err })
	if err != nil {
		return err
	}
	return json.NewEncoder(out).Encode(result)
}
