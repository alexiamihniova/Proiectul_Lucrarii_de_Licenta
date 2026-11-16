# One entry point for every routine task. `make help` lists the targets.
#
# Two ways to run the project (see README.md):
#   with Docker:     make up                                  -> everything in containers
#   without Docker:  make install db-create migrate seed dev  -> uses a local PostgreSQL
#
# migrate / seed / test / lint run on the host by default. Add DOCKER=1 to run migrate and
# seed inside the running backend container instead:  make migrate DOCKER=1

SHELL := /bin/sh
COMPOSE := docker compose --project-directory . --env-file .env -f infra/docker-compose.yml
BACKEND := npm --prefix backend
FRONTEND := npm --prefix frontend

ifdef DOCKER
BACKEND_RUN := $(COMPOSE) exec backend npm
else
BACKEND_RUN := $(BACKEND)
endif

.DEFAULT_GOAL := help
.PHONY: help install env up down logs ps dev dev-backend dev-worker dev-frontend db-create \
        migrate migrate-down migrate-status seed test test-backend test-frontend test-auth lint format \
        typecheck openapi check-generated

help: ## Show this help
	@grep -E '^[a-zA-Z_.-]+:.*## ' $(MAKEFILE_LIST) | awk -F ':.*## ' '{printf "  %-16s %s\n", $$1, $$2}'

.env: ## Create .env from .env.example with a random SESSION_SECRET (only if missing)
	@secret=$$(openssl rand -hex 32) && sed "s|^SESSION_SECRET=.*|SESSION_SECRET=$$secret|" .env.example > .env
	@echo "created .env (edit it to set the LLM and SMTP values)"

env: .env ## Make sure .env exists

install: ## Install backend and frontend dependencies (host)
	$(BACKEND) ci
	$(FRONTEND) ci

# --- Docker ---------------------------------------------------------------------------------

up: .env ## Start db, backend, worker and frontend in Docker; waits until healthy
	$(COMPOSE) up --build --detach --wait
	@echo "frontend: http://localhost:5173   health: http://localhost:3001/health   API docs: http://localhost:3001/docs"

down: ## Stop the Docker stack (the database volume is kept)
	$(COMPOSE) down

logs: ## Follow the logs of the Docker stack
	$(COMPOSE) logs --follow

ps: ## Show the state of the Docker stack
	$(COMPOSE) ps

# --- Without Docker -------------------------------------------------------------------------

db-create: ## Create the local databases recap_dev and recap_test (needs createdb on PATH)
	-createdb recap_dev
	-createdb recap_test

dev: .env ## Run backend, worker and frontend on the host (needs a local PostgreSQL)
	$(MAKE) -j3 dev-backend dev-worker dev-frontend

dev-backend:
	$(BACKEND) run dev

dev-worker:
	$(BACKEND) run dev:worker

dev-frontend:
	$(FRONTEND) run dev

# --- Database -------------------------------------------------------------------------------

migrate: .env ## Apply pending migrations (DOCKER=1: inside the backend container)
	$(BACKEND_RUN) run db:migrate

migrate-down: .env ## Revert the last migration (DOCKER=1: inside the backend container)
	$(BACKEND_RUN) run db:migrate:down

migrate-status: .env ## List migrations and whether they are applied
	$(BACKEND_RUN) run db:migrate:status

seed: .env ## Insert the default settings that are missing (idempotent)
	$(BACKEND_RUN) run db:seed

# --- Quality --------------------------------------------------------------------------------

test: test-backend test-frontend ## Run all tests (backend tests use TEST_DATABASE_URL)

test-backend: .env
	$(BACKEND) test

test-frontend:
	$(FRONTEND) test

test-auth: .env ## TEMPORARY: the auth specification (fails until Segment 1B; then part of `make test`)
	$(BACKEND) run test:auth

lint: ## ESLint, Prettier and the TypeScript compiler, backend and frontend
	$(BACKEND) run lint
	$(BACKEND) run typecheck
	$(FRONTEND) run lint
	$(FRONTEND) run typecheck

typecheck: ## TypeScript only
	$(BACKEND) run typecheck
	$(FRONTEND) run typecheck

format: ## Rewrite files with Prettier
	$(BACKEND) run format
	$(FRONTEND) run format

openapi: ## Regenerate docs/openapi.json and the frontend API types from the route schemas
	$(BACKEND) run openapi:export
	$(FRONTEND) run api:types

check-generated: ## Fail if openapi.json, the API types or the migrations are out of date
	$(BACKEND) run openapi:export -- --check
	$(BACKEND) run db:generate
	$(FRONTEND) run api:types
	git diff --exit-code -- docs/openapi.json frontend/src/api/schema.d.ts backend/drizzle
	@test -z "$$(git status --porcelain -- backend/drizzle)" || (echo "uncommitted migration files in backend/drizzle" && exit 1)
