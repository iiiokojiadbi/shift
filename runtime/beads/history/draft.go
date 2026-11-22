package history

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

var revisionName = regexp.MustCompile("^r-[a-f0-9]{16}$")

// The caller supplies a record identity. Filesystem paths never come from
// tool arguments. Keep drafts per project, record, chat and base revision.
func draftOperation(db string, r Request) (any, error) {
	if !validRecord(r.File) || r.Session == "" {
		return nil, errors.New("a record name and session are required")
	}
	if r.Revision != "" && !revisionName.MatchString(r.Revision) {
		return nil, errors.New("invalid working revision")
	}
	root := filepath.Join(filepath.Dir(db), "drafts")
	if err := os.Mkdir(root, 0700); err != nil && !errors.Is(err, os.ErrExist) {
		return nil, err
	}
	info, err := os.Lstat(root)
	if err != nil || !info.IsDir() {
		return nil, errors.New("expected a private drafts directory")
	}
	key := sha256.Sum256([]byte(r.Session + "\x00" + r.File))
	prefix := hex.EncodeToString(key[:]) + "-"
	revision := r.Revision
	if revision == "" {
		revision = "new"
	}
	path := filepath.Join(root, prefix+revision+".md")
	if r.Action == "draft-list" {
		names, err := os.ReadDir(root)
		paths := map[string]string{}
		for _, n := range names {
			if n.Type().IsRegular() && strings.HasPrefix(n.Name(), prefix) && strings.HasSuffix(n.Name(), ".md") {
				rev := strings.TrimSuffix(strings.TrimPrefix(n.Name(), prefix), ".md")

				paths[rev] = filepath.Join(root, n.Name())
			}
		}
		return paths, err
	}
	if r.Action == "draft-open" {
		tmp, err := os.CreateTemp(root, ".draft-")
		if err != nil {
			return nil, err
		}
		defer os.Remove(tmp.Name())
		_, err = tmp.WriteString(r.Text)
		if err = errors.Join(err, tmp.Close()); err != nil {
			return nil, err
		}
		if err = os.Link(tmp.Name(), path); err != nil && !errors.Is(err, os.ErrExist) {
			return nil, err
		}
	}
	info, err = os.Lstat(path)
	if err != nil || !info.Mode().IsRegular() {
		return nil, errors.New("draft unavailable; use drafts to locate it")
	}
	switch r.Action {
	case "draft-open":
		return path, nil
	case "draft-read":
		body, err := os.ReadFile(path)
		return string(body), err
	case "draft-remove":
		// Claim this directory entry before comparing. An editor can replace
		// the original path during cleanup; only remove the claimed file.
		claimed := strings.TrimSuffix(path, ".md") + ".recovery-" + rand.Text() + ".md"
		if err := os.Rename(path, claimed); err != nil {
			return nil, err
		}
		return "", finishDraftRemoval(path, claimed, r.Text)
	}
	return nil, fmt.Errorf("unknown draft operation %q", r.Action)
}

func finishDraftRemoval(path, claimed, expected string) error {
	info, err := os.Lstat(claimed)
	if err == nil && info.Mode().IsRegular() {
		body, err := os.ReadFile(claimed)
		if err == nil && string(body) == expected {
			return os.Remove(claimed)
		}
	}
	// Never overwrite a replacement. Both paths are discoverable by draft-list
	// even if the process is interrupted while restoring the original name.
	if err := os.Link(claimed, path); err != nil {
		return fmt.Errorf("draft changed; recover its contents at %s: %w", claimed, err)
	}
	if err := os.Remove(claimed); err != nil {
		return err
	}
	return errors.New("draft changed; kept its file")
}
