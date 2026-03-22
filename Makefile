.PHONY: dev daemon build test migrate-up migrate-down sqlc seed clean setup start stop

# ---------- One-click commands ----------

# First-time setup: install deps, start DB, run migrations, seed data
setup:
	@echo "==> Installing dependencies..."
	pnpm install
	@echo "==> Starting PostgreSQL..."
	docker compose up -d
	@echo "==> Waiting for PostgreSQL to be ready..."
	@until docker compose exec -T postgres pg_isready -U multica > /dev/null 2>&1; do \
		sleep 1; \
	done
	@echo "==> Running migrations..."
	cd server && go run ./cmd/migrate up
	@echo "==> Seeding data..."
	cd server && go run ./cmd/seed
	@echo ""
	@echo "✓ Setup complete! Run 'make start' to launch the app."

# Start all services (backend + frontend)
start:
	@docker compose up -d
	@until docker compose exec -T postgres pg_isready -U multica > /dev/null 2>&1; do \
		sleep 1; \
	done
	@echo "Starting backend and frontend..."
	@trap 'kill 0' EXIT; \
		(cd server && go run ./cmd/server) & \
		pnpm dev:web & \
		wait

# Stop all services
stop:
	@echo "Stopping services..."
	@-lsof -ti:8080 | xargs kill -9 2>/dev/null
	@-lsof -ti:3000 | xargs kill -9 2>/dev/null
	docker compose down
	@echo "✓ All services stopped."

# ---------- Individual commands ----------

# Go server
dev:
	cd server && go run ./cmd/server

daemon:
	cd server && go run ./cmd/daemon

build:
	cd server && go build -o bin/server ./cmd/server
	cd server && go build -o bin/daemon ./cmd/daemon

test:
	cd server && go test ./...

# Database
migrate-up:
	cd server && go run ./cmd/migrate up

migrate-down:
	cd server && go run ./cmd/migrate down

sqlc:
	cd server && sqlc generate

seed:
	cd server && go run ./cmd/seed

# Cleanup
clean:
	rm -rf server/bin server/tmp
