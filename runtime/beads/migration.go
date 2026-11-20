package main

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"reflect"
	"runtime"
	"shift.local/runtime/history"
	"strings"
)

var legacyRoots = []string{"TASKS.md", "tasks", "archive", "shifts"}

type transfer struct {
	Backup    string            `json:"backup"`
	Files     map[string]string `json:"files"`
	Confirmed map[string]string `json:"confirmed"`
	Previous  string            `json:"previous"`
	Recovery  string            `json:"recovery,omitempty"`
	Nonce     string            `json:"nonce"`
	Staging   string            `json:"staging,omitempty"`
	Done      bool              `json:"done"`
}

// Include empty directories and refuse links and special files. Stream file contents
// when checking a backup so old snapshots do not need to fit in process memory.
func inventory(root string) (map[string]string, error) {
	out := map[string]string{}
	for _, name := range legacyRoots {
		base := filepath.Join(root, name)
		if _, err := os.Lstat(base); errors.Is(err, os.ErrNotExist) {
			continue
		}
		err := filepath.WalkDir(base, func(path string, d fs.DirEntry, err error) error {
			if err != nil {
				return err
			}
			rel, err := filepath.Rel(root, path)
			if err != nil {
				return err
			}
			rel = filepath.ToSlash(rel)
			if d.IsDir() {
				out[rel] = "/"
				return nil
			}
			if !d.Type().IsRegular() {
				return fmt.Errorf("backup needs a regular file: %s", rel)
			}
			f, err := os.Open(path)
			if err != nil {
				return err
			}
			defer f.Close()
			h := sha256.New()
			if _, err = io.Copy(h, f); err != nil {
				return err
			}
			out[rel] = hex.EncodeToString(h.Sum(nil))
			return nil
		})
		if err != nil {
			return nil, err
		}
	}
	return out, nil
}
func writeTransfer(path string, state transfer) error {
	f, err := os.CreateTemp(filepath.Dir(path), ".migration-*")
	if err != nil {
		return err
	}
	defer os.Remove(f.Name())
	err = json.NewEncoder(f).Encode(state)
	if err == nil {
		err = f.Sync()
	}
	err = errors.Join(err, f.Close())
	if err != nil {
		return err
	}
	if err := os.Rename(f.Name(), path); err != nil {
		return err
	}
	return syncDir(filepath.Dir(path))
}
func copyLegacy(root, backup string, files map[string]string) error {
	for name, digest := range files {
		path := filepath.Join(backup, filepath.FromSlash(name))
		if digest == "/" {
			if err := os.MkdirAll(path, 0700); err != nil {
				return err
			}
			continue
		}
		if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
			return err
		}
		err := func() error {
			f, err := os.Open(filepath.Join(root, filepath.FromSlash(name)))
			if err != nil {
				return err
			}
			defer f.Close()
			out, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
			if err != nil {
				return err
			}
			_, err = io.Copy(out, f)
			if err == nil {
				err = out.Sync()
			}
			return errors.Join(err, out.Close())
		}()
		if err != nil {
			return err
		}
	}
	return nil
}

func syncDir(path string) error {
	if runtime.GOOS == "windows" {
		return nil
	}
	d, err := os.Open(path)
	if err != nil {
		return err
	}
	defer d.Close()
	return d.Sync()
}

func makeBackup(root string, files map[string]string, previous string) (transfer, error) {
	var state transfer
	backup, err := os.MkdirTemp(root, "legacy-backup-")
	if err != nil {
		return state, err
	}
	ready := false
	defer func() {
		if !ready {
			os.RemoveAll(backup)
		}
	}()
	if err := copyLegacy(root, backup, files); err != nil {
		return state, err
	}
	check, err := inventory(backup)
	if err != nil {
		return state, err
	}
	if !reflect.DeepEqual(files, check) {
		return state, errors.New("legacy files changed during backup; rerun start")
	}
	for name, digest := range files {
		if digest == "/" {
			if err := syncDir(filepath.Join(backup, name)); err != nil {
				return state, err
			}
		}
	}
	if err := syncDir(backup); err != nil {
		return state, err
	}
	var nonce [16]byte
	if _, err := rand.Read(nonce[:]); err != nil {
		return state, err
	}
	state = transfer{Backup: filepath.Base(backup), Confirmed: map[string]string{}, Files: files, Previous: previous, Nonce: hex.EncodeToString(nonce[:])}
	ready = true
	return state, nil
}

func restoreReceipt(state transfer, id string) string {
	sum := sha256.Sum256([]byte(state.Nonce + "/" + id))
	return hex.EncodeToString(sum[:12])
}

// Compare path components on volumes where case aliases can refer to the same owner file.
func matchesLegacyPath(path, prefix string) bool {
	path = filepath.ToSlash(filepath.Clean(path))
	if runtime.GOOS == "windows" || runtime.GOOS == "darwin" {
		path = strings.ToLower(path)
		prefix = strings.ToLower(prefix)
	}
	return path == prefix || strings.HasPrefix(path, prefix+"/")
}

// Resolve existing ancestors too when a configured file has not been created yet.
func resolveConfiguredPath(path string) (string, error) {
	_, err := os.Lstat(path)
	if !errors.Is(err, os.ErrNotExist) {
		if err != nil {
			return "", err
		}
		return filepath.EvalSymlinks(path)
	}
	parent, err := resolveConfiguredPath(filepath.Dir(path))
	if err != nil {
		return "", err
	}
	return filepath.Join(parent, filepath.Base(path)), nil
}

func migrate(root string, input io.Reader, output io.Writer) error {
	var req struct {
		Expected   []revision
		Action     string
		Previous   string
		Task       string
		Target     string
		Settings   *string
		Protected  []string
		Generation string
		Receipt    string
		Confirmed  map[string]string
	}
	if err := json.NewDecoder(input).Decode(&req); err != nil {
		return err
	}
	if err := privateDir(root); err != nil {
		return err
	}
	lock, err := workspaceLock(filepath.Join(root, "migration.lock"))
	if err != nil {
		return err
	}
	defer lock.Close()
	path := filepath.Join(root, "migration.json")
	var state transfer
	raw, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		if req.Action != "start" {
			return errors.New("start the legacy transfer first")
		}
		files, err := inventory(root)
		if err != nil {
			return err
		}
		if len(files) == 0 {
			return errors.New("no legacy records to transfer")
		}
		state, err = makeBackup(root, files, req.Previous)
		if err != nil {
			return err
		}
		if err := writeTransfer(path, state); err != nil {
			return err
		}
	} else if err != nil {
		return err
	} else if err = json.Unmarshal(raw, &state); err != nil {
		return err
	}
	if filepath.Base(state.Backup) != state.Backup || !strings.HasPrefix(state.Backup, "legacy-backup-") {
		return errors.New("invalid backup location")
	}
	if state.Files == nil || state.Confirmed == nil || len(state.Nonce) != 32 {
		return errors.New("invalid migration record; preserve the legacy files and recover migration.json")
	}
	backup := filepath.Join(root, state.Backup)
	info, err := os.Lstat(backup)
	if err != nil {
		return err
	}
	if !info.IsDir() {
		return errors.New("invalid backup directory")
	}
	if state.Staging != "" && (filepath.Base(state.Staging) != state.Staging || !strings.HasPrefix(state.Staging, "legacy-backup-") || state.Staging == state.Backup) {
		return errors.New("invalid staging directory")
	}
	if state.Done {
		live, err := inventory(root)
		if err != nil {
			return err
		}
		if len(live) == 0 {
			return json.NewEncoder(output).Encode("Migration already finished. Backup: " + state.Backup)
		}
		if req.Action != "start" {
			return errors.New("legacy records reappeared; start their transfer")
		}
		next, err := makeBackup(root, live, req.Previous)
		if err != nil {
			return err
		}
		if err := writeTransfer(path, next); err != nil {
			return err
		}
		return json.NewEncoder(output).Encode("Verified new legacy backup: " + next.Backup)
	}
	if req.Action != "start" && req.Generation != state.Backup {
		return errors.New("backup generation changed; reread migration status")
	}
	switch req.Action {
	case "receipt":
		return json.NewEncoder(output).Encode(restoreReceipt(state, req.Previous))
	case "start":
		check, err := inventory(backup)
		if err != nil {
			return err
		}
		if !reflect.DeepEqual(check, state.Files) {
			return errors.New("backup verification failed; legacy records retained")
		}
		// A restart explicitly reconciles an interrupted move. Restore each missing
		// root. If another writer recreated it, keep that writer's root live and
		// preserve the displaced version in staging for manual reconciliation.
		interrupted := state.Staging != ""
		recovery := ""
		if interrupted {
			staged := filepath.Join(root, state.Staging)
			info, err := os.Lstat(staged)
			if err != nil || !info.IsDir() {
				return errors.New("cannot recover migration staging directory")
			}
			for _, name := range legacyRoots {
				from := filepath.Join(staged, name)
				if _, err := os.Lstat(from); errors.Is(err, os.ErrNotExist) {
					continue
				} else if err != nil {
					return err
				}
				to := filepath.Join(root, name)
				if _, err := os.Lstat(to); errors.Is(err, os.ErrNotExist) {
					if err := renameExclusive(from, to); errors.Is(err, os.ErrExist) {
						recovery = " Reconcile the overlapping originals in " + state.Staging + " before confirming tasks."
					} else if err != nil {
						return err
					}
				} else if err != nil {
					return err
				} else {
					recovery = " Reconcile the overlapping originals in " + state.Staging + " before confirming tasks."
				}
			}
			if err := syncDir(staged); err != nil {
				return err
			}
			if err := syncDir(root); err != nil {
				return err
			}
		}
		current, err := inventory(root)
		if err != nil {
			return err
		}
		if interrupted || !reflect.DeepEqual(current, state.Files) {
			state, err = makeBackup(root, current, req.Previous)
			if err != nil {
				return err
			}
			state.Recovery = recovery
			if err := writeTransfer(path, state); err != nil {
				return err
			}
		}
		return json.NewEncoder(output).Encode("Verified legacy backup: " + state.Backup + state.Recovery)
	case "confirm":
		if req.Task == "" || req.Target == "" {
			return errors.New("missing transfer identity")
		}
		if state.Confirmed == nil {
			return errors.New("invalid transfer state")
		}
		if state.Staging != "" {
			return errors.New("cleanup in progress")
		}
		for task, id := range state.Confirmed {
			if task == req.Task && id != req.Target {
				return errors.New("task already confirmed with another ID")
			}
			if task != req.Task && id == req.Target {
				return errors.New("each task needs its own stable ID")
			}
		}
		state.Confirmed[req.Task] = req.Target
	case "cleanup":
		check, err := inventory(backup)
		if err != nil {
			return err
		}
		if !reflect.DeepEqual(check, state.Files) {
			return errors.New("backup verification failed; legacy records retained")
		}
		// Keep destination revisions and the recovered archive entry stable through cleanup.
		if len(req.Expected) != len(state.Confirmed) {
			return errors.New("transfer destinations changed; retry")
		}
		remaining := make(map[string]bool, len(state.Confirmed))
		for _, id := range state.Confirmed {
			remaining[id] = true
		}
		for _, item := range req.Expected {
			if !remaining[item.ID] {
				return errors.New("unconfirmed or duplicate destination; retry cleanup")
			}
			delete(remaining, item.ID)
		}
		if len(req.Expected) > 0 {
			workspace := filepath.Join(root, "beads")
			for _, dir := range []string{workspace, filepath.Join(workspace, ".beads"), filepath.Join(workspace, "profile")} {
				info, err := os.Lstat(dir)
				if err != nil || !info.IsDir() {
					return errors.New("invalid private task workspace")
				}
			}
			if _, err := os.Lstat(filepath.Join(workspace, ".beads", "redirect")); !errors.Is(err, os.ErrNotExist) {
				return errors.New("invalid private workspace redirect")
			}
			graphLock, err := workspaceLock(filepath.Join(workspace, "write.lock"))
			if err != nil {
				return err
			}
			defer graphLock.Close()
			bd, err := binary()
			if err != nil {
				return err
			}
			if err := verifyTasks(taskCommand(bd, workspace, nil), req.Expected); err != nil {
				return err
			}
		}
		if !reflect.DeepEqual(req.Confirmed, state.Confirmed) {
			return errors.New("confirmed tasks changed; retry cleanup")
		}
		if req.Previous == "" || req.Previous <= state.Previous || req.Receipt != restoreReceipt(state, req.Previous) {
			return errors.New("complete and restore a new shift after starting migration")
		}
		return history.WithComplete(filepath.Join(root, "history.db"), req.Previous, func() error {
			settings, err := os.ReadFile(filepath.Join(root, "settings.toml"))
			if !(errors.Is(err, os.ErrNotExist) && req.Settings == nil) &&
				(err != nil || req.Settings == nil || string(settings) != *req.Settings) {
				return errors.New("project settings changed or cannot be read; retry cleanup after checking settings.toml")
			}
			projectDir, err := filepath.EvalSymlinks(filepath.Dir(root))
			if err != nil {
				return err
			}
			for _, p := range req.Protected {
				resolved, err := resolveConfiguredPath(filepath.Join(projectDir, filepath.FromSlash(p)))
				if err != nil {
					return err
				}
				rel, err := filepath.Rel(projectDir, resolved)
				if err != nil {
					return err
				}
				for _, name := range legacyRoots {
					prefix := ".shift/" + name
					if matchesLegacyPath(p, prefix) || matchesLegacyPath(rel, prefix) {
						return fmt.Errorf("configured project file in %s; move it before cleanup", prefix)
					}
				}
			}
			current, err := inventory(root)
			if err != nil {
				return err
			}
			if state.Staging == "" {
				if !reflect.DeepEqual(current, state.Files) {
					return errors.New("legacy files changed; rerun start and confirm the refreshed backup")
				}
				stage, err := os.MkdirTemp(root, "legacy-backup-")
				if err != nil {
					return err
				}
				state.Staging = filepath.Base(stage)
				if err := writeTransfer(path, state); err != nil {
					return err
				}
			}
			original := filepath.Join(root, state.Staging)
			info, err := os.Lstat(original)
			if err != nil {
				return err
			}
			if !info.IsDir() {
				return errors.New("invalid staging directory")
			}
			moved, err := inventory(original)
			if err != nil {
				return err
			}
			union := map[string]string{}
			for k, v := range current {
				union[k] = v
			}
			for k, v := range moved {
				if _, ok := union[k]; ok {
					return fmt.Errorf("legacy root reappeared: %s", k)
				}
				union[k] = v
			}
			if !reflect.DeepEqual(union, state.Files) {
				return errors.New("legacy records changed during cleanup; both copies retained")
			}
			for _, name := range legacyRoots {
				if _, ok := current[name]; !ok {
					continue
				}
				dst := filepath.Join(original, name)
				if _, err := os.Lstat(dst); !errors.Is(err, os.ErrNotExist) {
					return fmt.Errorf("legacy root reappeared: %s", name)
				}
				if err := renameExclusive(filepath.Join(root, name), dst); err != nil {
					return err
				}
			}
			check, err = inventory(original)
			if err != nil {
				return err
			}
			if !reflect.DeepEqual(check, state.Files) {
				return errors.New("moved records differ from verified backup; both copies retained")
			}
			if err := syncDir(original); err != nil {
				return err
			}
			// Keep the independent verified backup. Open file descriptors in old
			// clients still refer to the moved originals and can write after this call.
			state.Done = true
			if err := writeTransfer(path, state); err != nil {
				return err
			}
			return json.NewEncoder(output).Encode("Migration finished. Verified backup: " + state.Backup + ". Moved originals: " + state.Staging)

		})
	default:
		return errors.New("unknown migration action")
	}
	if err := writeTransfer(path, state); err != nil {
		return err
	}
	return json.NewEncoder(output).Encode("Migration " + req.Action + " recorded. Backup: " + state.Backup)
}
