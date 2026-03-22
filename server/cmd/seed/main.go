package main

import (
	"context"
	"fmt"
	"log"
	"os"

	"github.com/jackc/pgx/v5/pgxpool"
)

func main() {
	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		dbURL = "postgres://multica:multica@localhost:5432/multica?sslmode=disable"
	}

	ctx := context.Background()
	pool, err := pgxpool.New(ctx, dbURL)
	if err != nil {
		log.Fatalf("Unable to connect to database: %v", err)
	}
	defer pool.Close()

	// Create seed user
	var userID string
	err = pool.QueryRow(ctx, `
		INSERT INTO "user" (name, email, avatar_url)
		VALUES ('Jiayuan Zhang', 'jiayuan@multica.ai', NULL)
		ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name
		RETURNING id
	`).Scan(&userID)
	if err != nil {
		log.Fatalf("Failed to create user: %v", err)
	}
	fmt.Printf("User created: %s\n", userID)

	// Create seed workspace
	var workspaceID string
	err = pool.QueryRow(ctx, `
		INSERT INTO workspace (name, slug, description)
		VALUES ('Multica', 'multica', 'AI-native task management')
		ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
		RETURNING id
	`).Scan(&workspaceID)
	if err != nil {
		log.Fatalf("Failed to create workspace: %v", err)
	}
	fmt.Printf("Workspace created: %s\n", workspaceID)

	// Add user as owner
	_, err = pool.Exec(ctx, `
		INSERT INTO member (workspace_id, user_id, role)
		VALUES ($1, $2, 'owner')
		ON CONFLICT (workspace_id, user_id) DO NOTHING
	`, workspaceID, userID)
	if err != nil {
		log.Fatalf("Failed to create member: %v", err)
	}
	fmt.Println("Member created")

	// Create some agents
	agents := []struct {
		name        string
		runtimeMode string
		status      string
	}{
		{"Claude-1", "cloud", "idle"},
		{"Claude-2", "cloud", "working"},
		{"Local Agent", "local", "offline"},
		{"Code Review Bot", "cloud", "idle"},
	}

	for _, a := range agents {
		var agentID string
		// Check if agent already exists
		err = pool.QueryRow(ctx, `
			SELECT id FROM agent WHERE workspace_id = $1 AND name = $2
		`, workspaceID, a.name).Scan(&agentID)
		if err == nil {
			fmt.Printf("Agent exists: %s (%s)\n", a.name, agentID)
			continue
		}
		err = pool.QueryRow(ctx, `
			INSERT INTO agent (workspace_id, name, runtime_mode, status, owner_id)
			VALUES ($1, $2, $3, $4, $5)
			RETURNING id
		`, workspaceID, a.name, a.runtimeMode, a.status, userID).Scan(&agentID)
		if err != nil {
			log.Printf("Failed to create agent %s: %v", a.name, err)
			continue
		}
		fmt.Printf("Agent created: %s (%s)\n", a.name, agentID)
	}

	// Create seed issues
	issues := []struct {
		title       string
		description string
		status      string
		priority    string
		position    float64
	}{
		{"Add multi-workspace support", "Users should be able to create and switch between multiple workspaces.", "backlog", "medium", 1},
		{"Agent long-term memory persistence", "Agents need persistent memory across sessions for better context.", "backlog", "low", 2},
		{"Design the agent config UI", "Create a configuration interface for agent settings and capabilities.", "todo", "high", 3},
		{"Implement issue list API endpoint", "Build the REST API for listing, filtering, and paginating issues.", "in_progress", "urgent", 4},
		{"Implement OAuth login flow", "Set up OAuth 2.0 with Google for user authentication.", "in_progress", "high", 5},
		{"Add WebSocket reconnection logic", "Handle disconnections gracefully with exponential backoff.", "in_review", "medium", 6},
		{"Set up CI/CD pipeline", "Configure GitHub Actions for automated testing and deployment.", "done", "high", 7},
		{"Design database schema", "Create the initial PostgreSQL schema for all entities.", "done", "urgent", 8},
		{"Implement real-time notifications", "Push notifications to users via WebSocket when issues change.", "todo", "medium", 9},
		{"Agent task queue management", "Build the task dispatching and queue management system for agents.", "todo", "high", 10},
	}

	for _, iss := range issues {
		var issueID string
		// Check if issue already exists
		err = pool.QueryRow(ctx, `
			SELECT id FROM issue WHERE workspace_id = $1 AND title = $2
		`, workspaceID, iss.title).Scan(&issueID)
		if err == nil {
			fmt.Printf("Issue exists: %s (%s)\n", iss.title, issueID)
			continue
		}
		err = pool.QueryRow(ctx, `
			INSERT INTO issue (workspace_id, title, description, status, priority, creator_type, creator_id, position)
			VALUES ($1, $2, $3, $4, $5, 'member', $6, $7)
			RETURNING id
		`, workspaceID, iss.title, iss.description, iss.status, iss.priority, userID, iss.position).Scan(&issueID)
		if err != nil {
			log.Printf("Failed to create issue %s: %v", iss.title, err)
			continue
		}
		fmt.Printf("Issue created: %s (%s)\n", iss.title, issueID)
	}

	// Create seed comment (only if not already present)
	var commentExists bool
	_ = pool.QueryRow(ctx, `
		SELECT EXISTS(
			SELECT 1 FROM comment c
			JOIN issue i ON c.issue_id = i.id
			WHERE i.workspace_id = $1 AND i.title = 'Implement issue list API endpoint'
			AND c.content = 'This is a high priority item for Q2.'
		)
	`, workspaceID).Scan(&commentExists)
	if !commentExists {
		_, err = pool.Exec(ctx, `
			INSERT INTO comment (issue_id, author_type, author_id, content, type)
			SELECT i.id, 'member', $2, 'This is a high priority item for Q2.', 'comment'
			FROM issue i WHERE i.workspace_id = $1 AND i.title = 'Implement issue list API endpoint'
		`, workspaceID, userID)
		if err != nil {
			log.Printf("Failed to create comment: %v", err)
		}
	}

	fmt.Println("\nSeed data created successfully!")
	fmt.Printf("\nUser ID: %s\n", userID)
	fmt.Printf("Workspace ID: %s\n", workspaceID)
}
