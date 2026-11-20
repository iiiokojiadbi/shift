//go:build !windows

package main

import (
	"errors"
	"fmt"
	"golang.org/x/sys/unix"
	"os"
	"os/exec"
	"syscall"
)

func startQuery(cmd *exec.Cmd) error { return cmd.Start() }

func runChild(cmd *exec.Cmd) error {
	if cmd.Dir != "" {
		if err := os.Chdir(cmd.Dir); err != nil {
			return err
		}
	}
	return syscall.Exec(cmd.Path, cmd.Args, cmd.Env)
}

// Keep the lock across exec so every adapter sees one check-and-write operation.
func workspaceLock(path string) (*os.File, error) {
	f, err := os.OpenFile(path, os.O_CREATE|os.O_RDWR, 0600)
	if err != nil {
		return nil, err
	}
	fd := f.Fd()
	if err = syscall.Flock(int(fd), syscall.LOCK_EX); err == nil {
		_, _, code := syscall.Syscall(syscall.SYS_FCNTL, fd, syscall.F_SETFD, 0)
		if code != 0 {
			err = code
		}
	}
	if err != nil {
		f.Close()
		return nil, err
	}
	return f, nil
}

// bd reads large fields from files. An inherited, unlinked descriptor survives exec
// and is reclaimed by the kernel even when the host cancels the operation.
func inputFile(workspace, field, content string) (*os.File, string, error) {
	f, err := os.CreateTemp(workspace, ".task-input-")
	if err != nil {
		return nil, "", err
	}
	if err = os.Remove(f.Name()); err == nil {
		_, err = f.WriteString(content)
	}
	if err == nil {
		_, err = f.Seek(0, 0)
	}
	if err == nil {
		_, err = unix.FcntlInt(f.Fd(), unix.F_SETFD, 0)
	}
	if err != nil {
		f.Close()
		return nil, "", err
	}
	return f, fmt.Sprintf("/dev/fd/%d", f.Fd()), nil
}

func closeInput(file *os.File) { file.Close() }

func commandTooLong(err error) bool { return errors.Is(err, syscall.E2BIG) }
