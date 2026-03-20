.PHONY: dev daemon build test migrate-up migrate-down sqlc seed clean

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
