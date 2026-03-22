package main

import (
	"context"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"
)

func main() {
	if len(os.Args) < 2 {
		fmt.Println("Usage: go run ./cmd/migrate <up|down>")
		os.Exit(1)
	}

	direction := os.Args[1]
	if direction != "up" && direction != "down" {
		fmt.Println("Usage: go run ./cmd/migrate <up|down>")
		os.Exit(1)
	}

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

	if err := pool.Ping(ctx); err != nil {
		log.Fatalf("Unable to ping database: %v", err)
	}

	// Create migrations tracking table
	_, err = pool.Exec(ctx, `
		CREATE TABLE IF NOT EXISTS schema_migrations (
			version TEXT PRIMARY KEY,
			applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
		)
	`)
	if err != nil {
		log.Fatalf("Failed to create migrations table: %v", err)
	}

	// Find migration files
	migrationsDir := "migrations"
	if _, err := os.Stat(migrationsDir); os.IsNotExist(err) {
		// Try from server/ directory
		migrationsDir = "server/migrations"
	}

	suffix := "." + direction + ".sql"
	files, err := filepath.Glob(filepath.Join(migrationsDir, "*"+suffix))
	if err != nil {
		log.Fatalf("Failed to find migration files: %v", err)
	}

	if direction == "up" {
		sort.Strings(files)
	} else {
		sort.Sort(sort.Reverse(sort.StringSlice(files)))
	}

	for _, file := range files {
		version := extractVersion(file)

		if direction == "up" {
			// Check if already applied
			var exists bool
			err := pool.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM schema_migrations WHERE version = $1)", version).Scan(&exists)
			if err != nil {
				log.Fatalf("Failed to check migration status: %v", err)
			}
			if exists {
				fmt.Printf("  skip  %s (already applied)\n", version)
				continue
			}
		} else {
			// Check if applied (only rollback applied ones)
			var exists bool
			err := pool.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM schema_migrations WHERE version = $1)", version).Scan(&exists)
			if err != nil {
				log.Fatalf("Failed to check migration status: %v", err)
			}
			if !exists {
				fmt.Printf("  skip  %s (not applied)\n", version)
				continue
			}
		}

		sql, err := os.ReadFile(file)
		if err != nil {
			log.Fatalf("Failed to read %s: %v", file, err)
		}

		_, err = pool.Exec(ctx, string(sql))
		if err != nil {
			log.Fatalf("Failed to run %s: %v", file, err)
		}

		if direction == "up" {
			_, err = pool.Exec(ctx, "INSERT INTO schema_migrations (version) VALUES ($1)", version)
		} else {
			_, err = pool.Exec(ctx, "DELETE FROM schema_migrations WHERE version = $1", version)
		}
		if err != nil {
			log.Fatalf("Failed to record migration %s: %v", version, err)
		}

		fmt.Printf("  %s  %s\n", direction, version)
	}

	fmt.Println("Done.")
}

func extractVersion(filename string) string {
	base := filepath.Base(filename)
	// Remove .up.sql or .down.sql
	base = strings.TrimSuffix(base, ".up.sql")
	base = strings.TrimSuffix(base, ".down.sql")
	return base
}
