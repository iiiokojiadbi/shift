//go:build !windows

package main

import (
	"os"
	"os/exec"
	"syscall"
)

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
