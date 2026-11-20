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
