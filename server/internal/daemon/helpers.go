package daemon

import (
	"context"
	"fmt"
	"os"
	"strings"
	"time"
)

// EnvOrDefault returns the trimmed value of the environment variable key,
// falling back to fallback if empty.
func EnvOrDefault(key, fallback string) string {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback
	}
	return value
}

// DurationFromEnv parses a duration from an environment variable,
// returning fallback if the variable is empty.
func DurationFromEnv(key string, fallback time.Duration) (time.Duration, error) {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback, nil
	}
	d, err := time.ParseDuration(value)
	if err != nil {
		return 0, fmt.Errorf("%s: invalid duration %q: %w", key, value, err)
	}
	return d, nil
}

// SleepWithContext blocks for the given duration or until the context is cancelled.
func SleepWithContext(ctx context.Context, d time.Duration) error {
	timer := time.NewTimer(d)
	defer timer.Stop()

	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}
