package main

import (
	"context"
	"fmt"
	"os"
	"text/tabwriter"
	"time"

	"github.com/spf13/cobra"

	"github.com/multica-ai/multica/server/internal/cli"
)

var workspaceCmd = &cobra.Command{
	Use:   "workspace",
	Short: "Manage watched workspaces for the daemon",
}

var workspaceWatchCmd = &cobra.Command{
	Use:   "watch <workspace-id>",
	Short: "Add a workspace to the daemon watch list",
	Args:  cobra.ExactArgs(1),
	RunE:  runWorkspaceWatch,
}

var workspaceUnwatchCmd = &cobra.Command{
	Use:   "unwatch <workspace-id>",
	Short: "Remove a workspace from the daemon watch list",
	Args:  cobra.ExactArgs(1),
	RunE:  runWorkspaceUnwatch,
}

var workspaceListCmd = &cobra.Command{
	Use:   "list",
	Short: "List watched workspaces",
	RunE:  runWorkspaceList,
}

func init() {
	workspaceCmd.AddCommand(workspaceWatchCmd)
	workspaceCmd.AddCommand(workspaceUnwatchCmd)
	workspaceCmd.AddCommand(workspaceListCmd)
}

func runWorkspaceWatch(cmd *cobra.Command, args []string) error {
	workspaceID := args[0]

	// Validate the workspace exists by calling the API.
	serverURL := resolveServerURL(cmd)
	token := resolveToken()
	if token == "" {
		return fmt.Errorf("not authenticated: run 'multica auth login' first")
	}

	client := cli.NewAPIClient(serverURL, "", token)
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	var ws struct {
		ID   string `json:"id"`
		Name string `json:"name"`
	}
	if err := client.GetJSON(ctx, "/api/workspaces/"+workspaceID, &ws); err != nil {
		return fmt.Errorf("workspace not found: %w", err)
	}

	cfg, err := cli.LoadCLIConfig()
	if err != nil {
		return err
	}

	if !cfg.AddWatchedWorkspace(ws.ID, ws.Name) {
		fmt.Fprintf(os.Stderr, "Already watching workspace %s (%s)\n", ws.ID, ws.Name)
		return nil
	}

	// Also set as default workspace_id if none is set.
	if cfg.WorkspaceID == "" {
		cfg.WorkspaceID = ws.ID
	}

	if err := cli.SaveCLIConfig(cfg); err != nil {
		return err
	}

	fmt.Fprintf(os.Stderr, "Watching workspace %s (%s)\n", ws.ID, ws.Name)
	return nil
}

func runWorkspaceUnwatch(_ *cobra.Command, args []string) error {
	workspaceID := args[0]

	cfg, err := cli.LoadCLIConfig()
	if err != nil {
		return err
	}

	if !cfg.RemoveWatchedWorkspace(workspaceID) {
		return fmt.Errorf("workspace %s is not being watched", workspaceID)
	}

	if err := cli.SaveCLIConfig(cfg); err != nil {
		return err
	}

	fmt.Fprintf(os.Stderr, "Stopped watching workspace %s\n", workspaceID)
	return nil
}

func runWorkspaceList(_ *cobra.Command, _ []string) error {
	cfg, err := cli.LoadCLIConfig()
	if err != nil {
		return err
	}

	if len(cfg.WatchedWorkspaces) == 0 {
		fmt.Fprintln(os.Stderr, "No watched workspaces. Run 'multica workspace watch <id>' to add one.")
		return nil
	}

	w := tabwriter.NewWriter(os.Stdout, 0, 4, 2, ' ', 0)
	fmt.Fprintln(w, "ID\tNAME")
	for _, ws := range cfg.WatchedWorkspaces {
		name := ws.Name
		if name == "" {
			name = "-"
		}
		fmt.Fprintf(w, "%s\t%s\n", ws.ID, name)
	}
	return w.Flush()
}
