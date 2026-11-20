package main

import (
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"syscall"
	"time"
	"unsafe"
)

// The launcher joins a private job before creating bd. Descendants inherit it.
// The sole non-inheritable job handle closes even when the host kills this process.
func joinJob() error {
	kernel := syscall.NewLazyDLL("kernel32.dll")
	job, _, err := kernel.NewProc("CreateJobObjectW").Call(0, 0)
	if job == 0 {
		return fmt.Errorf("create task job: %w", err)
	}
	const extendedLimitInformation = 9
	const killOnJobClose = 0x2000
	// JOBOBJECT_EXTENDED_LIMIT_INFORMATION for the supported Windows amd64 ABI.
	limits := struct {
		processTime, jobTime         int64
		flags                        uint32
		minWorkingSet, maxWorkingSet uintptr
		activeProcesses              uint32
		affinity                     uintptr
		priority, scheduling         uint32
		ioCounters                   [6]uint64
		memoryLimits                 [4]uintptr
	}{flags: killOnJobClose}
	ok, _, err := kernel.NewProc("SetInformationJobObject").Call(job, extendedLimitInformation, uintptr(unsafe.Pointer(&limits)), unsafe.Sizeof(limits))
	if ok == 0 {
		return fmt.Errorf("configure task job: %w", err)
	}
	self, err := syscall.GetCurrentProcess()
	if err != nil {
		return err
	}
	ok, _, err = kernel.NewProc("AssignProcessToJobObject").Call(job, uintptr(self))
	if ok == 0 {
		return fmt.Errorf("join task job: %w", err)
	}
	return nil
}
func runChild(cmd *exec.Cmd) error {
	if err := joinJob(); err != nil {
		return err
	}
	return cmd.Run()
}
func startQuery(cmd *exec.Cmd) error {
	if err := joinJob(); err != nil {
		return err
	}
	return cmd.Start()
}

// An exclusive handle is released by the kernel when the launcher exits.
func workspaceLock(path string) (*os.File, error) {
	name, err := syscall.UTF16PtrFromString(path)
	if err != nil {
		return nil, err
	}
	deadline := time.Now().Add(20 * time.Second)
	for {
		handle, err := syscall.CreateFile(name, syscall.GENERIC_READ|syscall.GENERIC_WRITE, 0, nil, syscall.OPEN_ALWAYS, syscall.FILE_ATTRIBUTE_NORMAL, 0)
		if err == nil {
			return os.NewFile(uintptr(handle), path), nil
		}
		if err != syscall.Errno(32) || time.Now().After(deadline) {
			return nil, err
		}
		time.Sleep(25 * time.Millisecond)
	}
}

// The write lock gives each private input file one writer. A cancelled write
// can leave one file, which the next large update replaces under the same lock.
func inputFile(workspace, field, content string) (*os.File, string, error) {
	path := filepath.Join(workspace, ".task-input-"+field)
	if err := os.Remove(path); err != nil && !os.IsNotExist(err) {
		return nil, "", err
	}
	f, err := os.OpenFile(path, os.O_CREATE|os.O_EXCL|os.O_RDWR, 0600)
	if err != nil {
		return nil, "", err
	}
	if _, err := f.WriteString(content); err != nil {
		f.Close()
		os.Remove(path)
		return nil, "", err
	}
	return f, path, nil
}

func closeInput(file *os.File) {
	file.Close()
	os.Remove(file.Name())
}

func commandTooLong(err error) bool { return errors.Is(err, syscall.Errno(206)) }
