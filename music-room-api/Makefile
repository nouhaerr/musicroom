COMPOSE = docker compose

.PHONY: all up down logs ps migration test shell db-shell fclean re

all: up

# First run only: never overwrites an existing .env
.env:
	cp .env.example .env

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

shell:
	$(COMPOSE) exec backend sh

db-shell:
	$(COMPOSE) exec postgres sh -c 'psql -U "$$POSTGRES_USER" -d "$$POSTGRES_DB"'

fclean:
	$(COMPOSE) down -v --rmi local

re: fclean all
