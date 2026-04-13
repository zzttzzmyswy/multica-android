//go:build windows

package main

import (
	"context"
	"fmt"
	"io"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"
)

func daemonSysProcAttr() *syscall.SysProcAttr {
	return &syscall.SysProcAttr{CreationFlags: 0x00000200} // CREATE_NEW_PROCESS_GROUP
}

func stopDaemonProcess(process *os.Process) error {
	return process.Kill()
}

func notifyShutdownContext(parent context.Context) (context.Context, context.CancelFunc) {
	return signal.NotifyContext(parent, os.Interrupt)
}

func tailLogFile(logPath string, lines int, follow bool) error {
	content, err := os.ReadFile(logPath)
	if err != nil {
		return err
	}

	allLines := strings.Split(string(content), "\n")
	if len(allLines) > 0 && allLines[len(allLines)-1] == "" {
		allLines = allLines[:len(allLines)-1]
	}

	start := 0
	if len(allLines) > lines {
		start = len(allLines) - lines
	}
	for i := start; i < len(allLines); i++ {
		fmt.Println(allLines[i])
	}

	if !follow {
		return nil
	}

	f, err := os.Open(logPath)
	if err != nil {
		return err
	}
	defer f.Close()

	if _, err := f.Seek(int64(len(content)), io.SeekStart); err != nil {
		return err
	}

	buf := make([]byte, 4096)
	for {
		time.Sleep(500 * time.Millisecond)
		n, readErr := f.Read(buf)
		if n > 0 {
			os.Stdout.Write(buf[:n])
		}
		if readErr != nil && readErr != io.EOF {
			return readErr
		}
	}
}
