package daemon

import (
	"context"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/multica-ai/multica/server/internal/cli"
	"github.com/multica-ai/multica/server/internal/daemon/execenv"
	"github.com/multica-ai/multica/server/pkg/agent"
)

// cliConfigData holds the fields we need from the CLI config.
type cliConfigData struct {
	Token       string
	WorkspaceID string
}

func loadCLIConfig() (cliConfigData, error) {
	cfg, err := cli.LoadCLIConfig()
	if err != nil {
		return cliConfigData{}, err
	}
	return cliConfigData{
		Token:       cfg.Token,
		WorkspaceID: cfg.WorkspaceID,
	}, nil
}

// Daemon is the local agent runtime that polls for and executes tasks.
type Daemon struct {
	cfg    Config
	client *Client
	logger *slog.Logger
}

// New creates a new Daemon instance.
func New(cfg Config, logger *slog.Logger) *Daemon {
	return &Daemon{
		cfg:    cfg,
		client: NewClient(cfg.ServerBaseURL),
		logger: logger,
	}
}

// Run starts the daemon: resolves auth, registers runtimes, then polls for tasks.
func (d *Daemon) Run(ctx context.Context) error {
	agentNames := make([]string, 0, len(d.cfg.Agents))
	for name := range d.cfg.Agents {
		agentNames = append(agentNames, name)
	}
	d.logger.Info("starting daemon", "agents", agentNames, "server", d.cfg.ServerBaseURL)

	// Resolve auth token and workspace from CLI config.
	if err := d.resolveAuth(ctx); err != nil {
		return err
	}

	runtimes, err := d.registerRuntimes(ctx)
	if err != nil {
		return err
	}
	runtimeIDs := make([]string, 0, len(runtimes))
	for _, rt := range runtimes {
		d.logger.Info("registered runtime", "id", rt.ID, "provider", rt.Provider, "status", rt.Status)
		runtimeIDs = append(runtimeIDs, rt.ID)
	}

	go d.heartbeatLoop(ctx, runtimeIDs)
	return d.pollLoop(ctx, runtimeIDs)
}

// resolveAuth loads the CLI auth token and workspace ID.
// If not authenticated, it waits and retries periodically until the user logs in.
func (d *Daemon) resolveAuth(ctx context.Context) error {
	// If workspace ID is already set via flag/env, just need a token.
	if d.cfg.WorkspaceID != "" {
		if d.cfg.Token != "" {
			d.client.SetToken(d.cfg.Token)
			d.logger.Info("authenticated", "workspace_id", d.cfg.WorkspaceID)
			return nil
		}
	}

	// Try loading from CLI config.
	cfg, _ := loadCLIConfig()
	if cfg.Token != "" {
		d.client.SetToken(cfg.Token)
		if d.cfg.WorkspaceID == "" && cfg.WorkspaceID != "" {
			d.cfg.WorkspaceID = cfg.WorkspaceID
		}
	}

	if d.cfg.Token == "" && cfg.Token == "" {
		d.logger.Warn("not authenticated — run 'multica auth login' to authenticate, then restart the daemon")
		return fmt.Errorf("not authenticated: run 'multica auth login' first")
	}

	// If we have a token but no workspace ID, fetch the user's workspaces.
	if d.cfg.WorkspaceID == "" {
		ws, err := d.client.ListWorkspaces(ctx)
		if err != nil {
			return fmt.Errorf("failed to fetch workspaces: %w (is your token valid? try 'multica auth login')", err)
		}
		if len(ws) == 0 {
			return fmt.Errorf("no workspaces found for this account")
		}
		d.cfg.WorkspaceID = ws[0].ID
		d.logger.Info("using workspace", "workspace_id", ws[0].ID, "name", ws[0].Name)
	}

	return nil
}

func (d *Daemon) registerRuntimes(ctx context.Context) ([]Runtime, error) {
	var runtimes []map[string]string
	for name, entry := range d.cfg.Agents {
		version, err := agent.DetectVersion(ctx, entry.Path)
		if err != nil {
			d.logger.Warn("skip registering runtime", "name", name, "error", err)
			continue
		}
		runtimes = append(runtimes, map[string]string{
			"name":    fmt.Sprintf("Local %s", strings.ToUpper(name[:1])+name[1:]),
			"type":    name,
			"version": version,
			"status":  "online",
		})
	}
	if len(runtimes) == 0 {
		return nil, fmt.Errorf("no agent runtimes could be registered")
	}

	req := map[string]any{
		"workspace_id": d.cfg.WorkspaceID,
		"daemon_id":    d.cfg.DaemonID,
		"device_name":  d.cfg.DeviceName,
		"runtimes":     runtimes,
	}

	rts, err := d.client.Register(ctx, req)
	if err != nil {
		return nil, fmt.Errorf("register runtimes: %w", err)
	}
	if len(rts) == 0 {
		return nil, fmt.Errorf("register runtimes: empty response")
	}
	return rts, nil
}


func (d *Daemon) heartbeatLoop(ctx context.Context, runtimeIDs []string) {
	ticker := time.NewTicker(d.cfg.HeartbeatInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			for _, rid := range runtimeIDs {
				if err := d.client.SendHeartbeat(ctx, rid); err != nil {
					d.logger.Warn("heartbeat failed", "runtime_id", rid, "error", err)
				}
			}
		}
	}
}

func (d *Daemon) pollLoop(ctx context.Context, runtimeIDs []string) error {
	pollOffset := 0
	pollCount := 0
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}

		claimed := false
		n := len(runtimeIDs)
		for i := 0; i < n; i++ {
			rid := runtimeIDs[(pollOffset+i)%n]
			task, err := d.client.ClaimTask(ctx, rid)
			if err != nil {
				d.logger.Warn("claim task failed", "runtime_id", rid, "error", err)
				continue
			}
			if task != nil {
				d.logger.Info("task received", "task_id", task.ID, "issue_id", task.IssueID, "title", task.Context.Issue.Title)
				d.handleTask(ctx, *task)
				claimed = true
				pollOffset = (pollOffset + i + 1) % n
				break
			}
		}

		if !claimed {
			pollCount++
			if pollCount%20 == 1 {
				d.logger.Debug("poll: no tasks", "runtimes", runtimeIDs, "cycle", pollCount)
			}
			pollOffset = (pollOffset + 1) % n
			if err := sleepWithContext(ctx, d.cfg.PollInterval); err != nil {
				return err
			}
		} else {
			pollCount = 0
		}
	}
}

func (d *Daemon) handleTask(ctx context.Context, task Task) {
	provider := task.Context.Runtime.Provider
	d.logger.Info("picked task", "task_id", task.ID, "issue_id", task.IssueID, "provider", provider, "title", task.Context.Issue.Title)

	if err := d.client.StartTask(ctx, task.ID); err != nil {
		d.logger.Error("start task failed", "task_id", task.ID, "error", err)
		return
	}

	_ = d.client.ReportProgress(ctx, task.ID, fmt.Sprintf("Launching %s", provider), 1, 2)

	result, err := d.runTask(ctx, task)
	if err != nil {
		d.logger.Error("task failed", "task_id", task.ID, "error", err)
		if failErr := d.client.FailTask(ctx, task.ID, err.Error()); failErr != nil {
			d.logger.Error("fail task callback failed", "task_id", task.ID, "error", failErr)
		}
		return
	}

	_ = d.client.ReportProgress(ctx, task.ID, "Finishing task", 2, 2)

	switch result.Status {
	case "blocked":
		if err := d.client.FailTask(ctx, task.ID, result.Comment); err != nil {
			d.logger.Error("report blocked task failed", "task_id", task.ID, "error", err)
		}
	default:
		d.logger.Info("task completed", "task_id", task.ID, "status", result.Status)
		if err := d.client.CompleteTask(ctx, task.ID, result.Comment, result.BranchName); err != nil {
			d.logger.Error("complete task failed", "task_id", task.ID, "error", err)
		}
	}
}

func (d *Daemon) runTask(ctx context.Context, task Task) (TaskResult, error) {
	provider := task.Context.Runtime.Provider
	entry, ok := d.cfg.Agents[provider]
	if !ok {
		return TaskResult{}, fmt.Errorf("no agent configured for provider %q", provider)
	}

	// Prepare isolated execution environment.
	taskCtx := execenv.TaskContextForEnv{
		IssueTitle:         task.Context.Issue.Title,
		IssueDescription:   task.Context.Issue.Description,
		AcceptanceCriteria: task.Context.Issue.AcceptanceCriteria,
		ContextRefs:        task.Context.Issue.ContextRefs,
		WorkspaceContext:   task.Context.WorkspaceContext,
		AgentName:          task.Context.Agent.Name,
		AgentSkills:        convertSkillsForEnv(task.Context.Agent.Skills),
	}
	env, err := execenv.Prepare(execenv.PrepareParams{
		WorkspacesRoot: d.cfg.WorkspacesRoot,
		RepoPath:       task.Context.RepoPath,
		TaskID:         task.ID,
		AgentName:      task.Context.Agent.Name,
		Task:           taskCtx,
	}, d.logger)
	if err != nil {
		return TaskResult{}, fmt.Errorf("prepare execution environment: %w", err)
	}

	// Inject runtime-specific config (meta skill) so the agent discovers .agent_context/.
	if err := execenv.InjectRuntimeConfig(env.WorkDir, provider, taskCtx); err != nil {
		d.logger.Warn("execenv: inject runtime config failed (non-fatal)", "error", err)
	}
	defer func() {
		if cleanupErr := env.Cleanup(!d.cfg.KeepEnvAfterTask); cleanupErr != nil {
			d.logger.Warn("cleanup env failed", "task_id", task.ID, "error", cleanupErr)
		}
	}()

	prompt := BuildPrompt(task)

	backend, err := agent.New(provider, agent.Config{
		ExecutablePath: entry.Path,
		Logger:         d.logger,
	})
	if err != nil {
		return TaskResult{}, fmt.Errorf("create agent backend: %w", err)
	}

	d.logger.Info("starting agent", "provider", provider, "task_id", task.ID, "workdir", env.WorkDir, "branch", env.BranchName, "env_type", env.Type, "model", entry.Model, "timeout", d.cfg.AgentTimeout.String())

	session, err := backend.Execute(ctx, prompt, agent.ExecOptions{
		Cwd:     env.WorkDir,
		Model:   entry.Model,
		Timeout: d.cfg.AgentTimeout,
	})
	if err != nil {
		return TaskResult{}, err
	}

	// Drain message channel (log tool uses, ignore text since Result has output)
	go func() {
		for msg := range session.Messages {
			switch msg.Type {
			case agent.MessageToolUse:
				d.logger.Debug("tool-use", "provider", provider, "tool", msg.Tool, "call_id", msg.CallID)
			case agent.MessageError:
				d.logger.Error("agent error", "provider", provider, "content", msg.Content)
			}
		}
	}()

	result := <-session.Result

	switch result.Status {
	case "completed":
		if result.Output == "" {
			return TaskResult{}, fmt.Errorf("%s returned empty output", provider)
		}
		return TaskResult{
			Status:     "completed",
			Comment:    result.Output,
			BranchName: env.BranchName,
			EnvType:    string(env.Type),
		}, nil
	case "timeout":
		return TaskResult{}, fmt.Errorf("%s timed out after %s", provider, d.cfg.AgentTimeout)
	default:
		errMsg := result.Error
		if errMsg == "" {
			errMsg = fmt.Sprintf("%s execution %s", provider, result.Status)
		}
		return TaskResult{Status: "blocked", Comment: errMsg}, nil
	}
}

func convertSkillsForEnv(skills []SkillData) []execenv.SkillContextForEnv {
	if len(skills) == 0 {
		return nil
	}
	result := make([]execenv.SkillContextForEnv, len(skills))
	for i, s := range skills {
		result[i] = execenv.SkillContextForEnv{
			Name:    s.Name,
			Content: s.Content,
		}
		for _, f := range s.Files {
			result[i].Files = append(result[i].Files, execenv.SkillFileContextForEnv{
				Path:    f.Path,
				Content: f.Content,
			})
		}
	}
	return result
}
