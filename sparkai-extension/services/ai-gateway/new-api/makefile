WEB_DIR = ./web/default
API_DIR = .
DEV_WEB_DEFAULT_PORT ?= 5173
DEV_COMPOSE_FILE = docker-compose.dev.yml
DEV_POSTGRES_SERVICE = postgres
DEV_API_SERVICE = new-api
DEV_POSTGRES_DB = new-api
DEV_POSTGRES_USER = root
DEV_SQLITE_PATH ?= one-api.db

.PHONY: all build-web build-all-web start-api dev dev-api dev-api-rebuild dev-web reset-setup

all: build-all-web start-api

build-web:
	@echo "Building default web..."
	@cd ./web && bun install --frozen-lockfile
	@cd $(WEB_DIR) && DISABLE_ESLINT_PLUGIN='true' VITE_REACT_APP_VERSION=$(cat ../../VERSION) bun run build

build-all-web: build-web

start-api:
	@echo "Starting api dev server..."
	@cd $(API_DIR) && go run main.go &

dev-api:
	@echo "Starting api services (docker)..."
	@docker compose -f $(DEV_COMPOSE_FILE) up -d

dev-api-rebuild:
	@echo "Rebuilding and starting api service (docker)..."
	@docker compose -f $(DEV_COMPOSE_FILE) up -d --build $(DEV_API_SERVICE)

dev-web:
	@echo "Starting default web dev server..."
	@echo "Default web: http://localhost:$(DEV_WEB_DEFAULT_PORT)"
	@cd ./web && bun install --filter ./default
	@cd $(WEB_DIR) && bun run dev -- --host 0.0.0.0 --port $(DEV_WEB_DEFAULT_PORT)

dev: dev-api dev-web

reset-setup:
	@echo "Resetting setup state..."
	@docker compose -f $(DEV_COMPOSE_FILE) up -d $(DEV_POSTGRES_SERVICE)
	@docker compose -f $(DEV_COMPOSE_FILE) exec $(DEV_POSTGRES_SERVICE) psql -U $(DEV_POSTGRES_USER) -d $(DEV_POSTGRES_DB) -c "UPDATE options SET value='false' WHERE key='SystemIsInitialized';"
	@echo "Setup state reset. Open http://localhost:3000/setup to run the setup wizard again."

reset-setup-sqlite:
	@echo "Resetting SQLite setup state..."
	@sqlite3 $(DEV_SQLITE_PATH) "UPDATE options SET value='false' WHERE key='SystemIsInitialized';"
	@echo "Setup state reset. Open http://localhost:3000/setup to run the setup wizard again."
