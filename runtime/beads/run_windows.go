package main

import (
	"fmt"
	"os/exec"
	"syscall"
	"unsafe"
)

// The launcher joins a private job before creating bd. Descendants inherit it.
// The sole non-inheritable job handle closes even when the host kills this process.
func runChild(cmd *exec.Cmd) error {
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
	return cmd.Run()
}
