//go:build !windows

package main

import (
	"context"
	"os"
	"os/signal"
	"syscall"
)

func daemonSysProcAttr() *syscall.SysProcAttr {
	return &syscall.SysProcAttr{Setsid: true}
}

func daemonNotifyContext(parent context.Context) (context.Context, context.CancelFunc) {
	return signal.NotifyContext(parent, syscall.SIGINT, syscall.SIGTERM)
}

func daemonStopSignal() os.Signal {
	return syscall.SIGTERM
}
