package main

import (
	"fmt"
	"log"
	"os"
	"os/signal"
	"syscall"
)

func main() {
	serverURL := os.Getenv("MULTICA_SERVER_URL")
	if serverURL == "" {
		port := os.Getenv("PORT")
		if port == "" {
			port = "8080"
		}
		serverURL = "ws://localhost:" + port + "/ws"
	}

	fmt.Println("Multica Daemon starting...")
	fmt.Printf("Connecting to server: %s\n", serverURL)

	// TODO: Implement daemon connection, heartbeat, and task runner
	log.Println("Daemon is running. Press Ctrl+C to stop.")

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	log.Println("Daemon stopped")
}
