package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/spf13/cobra"

	"github.com/multica-ai/multica/server/internal/cli"
	"github.com/multica-ai/multica/server/internal/daemon"
)

var statusCmd = &cobra.Command{
	Use:   "status",
	Short: "Check server and daemon status",
	RunE:  runStatus,
}

func init() {
	statusCmd.Flags().String("output", "table", "Output format: table or json")
}

func runStatus(cmd *cobra.Command, _ []string) error {
	client, err := newAPIClient(cmd)
	if err != nil {
		return err
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	// Check server health.
	serverStatus := "unreachable"
	body, err := client.HealthCheck(ctx)
	if err == nil {
		serverStatus = strings.TrimSpace(body)
	}

	// Check local daemon via its health endpoint.
	daemonHealth := checkDaemonHealth(ctx)

	output, _ := cmd.Flags().GetString("output")
	if output == "json" {
		result := map[string]any{
			"server": map[string]any{
				"url":    client.BaseURL,
				"status": serverStatus,
			},
			"daemon": daemonHealth,
		}
		return cli.PrintJSON(os.Stdout, result)
	}

	fmt.Fprintf(os.Stdout, "Server:  %s (%s)\n", serverStatus, client.BaseURL)
	if daemonHealth["status"] == "running" {
		fmt.Fprintf(os.Stdout, "Daemon:  running (pid %v, uptime %v)\n", daemonHealth["pid"], daemonHealth["uptime"])
		if agents, ok := daemonHealth["agents"].([]any); ok && len(agents) > 0 {
			parts := make([]string, len(agents))
			for i, a := range agents {
				parts[i] = fmt.Sprint(a)
			}
			fmt.Fprintf(os.Stdout, "  Agents:     %s\n", strings.Join(parts, ", "))
		}
		if ws, ok := daemonHealth["workspaces"].([]any); ok {
			fmt.Fprintf(os.Stdout, "  Workspaces: %d\n", len(ws))
		}
	} else {
		fmt.Fprintf(os.Stdout, "Daemon:  stopped\n")
	}
	return nil
}

// checkDaemonHealth calls the daemon's local health endpoint.
func checkDaemonHealth(ctx context.Context) map[string]any {
	addr := fmt.Sprintf("http://127.0.0.1:%d/health", daemon.DefaultHealthPort)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, addr, nil)
	if err != nil {
		return map[string]any{"status": "stopped"}
	}

	httpClient := &http.Client{Timeout: 2 * time.Second}
	resp, err := httpClient.Do(req)
	if err != nil {
		return map[string]any{"status": "stopped"}
	}
	defer resp.Body.Close()

	var result map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return map[string]any{"status": "stopped"}
	}
	return result
}
