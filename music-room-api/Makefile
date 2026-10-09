COMPOSE = docker compose
NODE_IMAGE = node:22.23.3-alpine
# Windows shells have no portable id command. Docker Desktop maps bind mounts.
ifeq ($(OS),Windows_NT)
RUN_AS =
else
RUN_AS = --user "$$(id -u):$$(id -g)"
endif
# A double leading slash prevents Git Bash from rewriting the container workdir.
SECRETS_RUN = docker run --rm $(RUN_AS) -v "$(CURDIR):/usr/src/app" -w //usr/src/app $(NODE_IMAGE) node scripts/generate-jwt-secrets.cjs

.PHONY: all up down logs ps migration test lint typecheck secrets shell db-shell fclean re

all: up

# First run only: never overwrites an existing .env
.env:
	$(SECRETS_RUN) --init

# Explicit rotation only: invalidates existing tokens when backend is recreated.
secrets:
	$(SECRETS_RUN) --write

up: .env
	$(COMPOSE) up --build -d --renew-anon-volumes

down:
	$(COMPOSE) down

logs:
	$(COMPOSE) logs -f backend

ps:
	$(COMPOSE) ps

# After a schema change (make up alone won't migrate): make migration name=add_x
migration:
	$(if $(name),,$(error usage: make migration name=<migration_name>))
	$(COMPOSE) exec backend npx prisma migrate dev --name $(name)

test:
	$(COMPOSE) exec backend npm test

lint:
	$(COMPOSE) exec backend npm run lint

typecheck:
	$(COMPOSE) exec backend npm run typecheck

shell:
	$(COMPOSE) exec backend sh

db-shell:
	$(COMPOSE) exec postgres sh -c 'psql -U "$$POSTGRES_USER" -d "$$POSTGRES_DB"'

fclean:
	$(COMPOSE) down -v --rmi local

re: fclean all
