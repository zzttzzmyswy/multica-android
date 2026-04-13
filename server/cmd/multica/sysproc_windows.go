//go:build windows

package main

import (
	"context"
	"os"
	"os/signal"
	"syscall"
)

func daemonSysProcAttr() *syscall.SysProcAttr {
	return &syscall.SysProcAttr{
		HideWindow:    true,
		CreationFlags: syscall.CREATE_NEW_PROCESS_GROUP,
	}
}

func daemonNotifyContext(parent context.Context) (context.Context, context.CancelFunc) {
	return signal.NotifyContext(parent, os.Interrupt)
}

func daemonStopSignal() os.Signal {
	return os.Interrupt
}
