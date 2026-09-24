.PHONY: install env db db-down migrate generate dev build start studio test fclean

# Installe toutes les dépendances du projet (node_modules) + génère le client Prisma
install:
	npm install
	cp -n .env.example .env || true
	npm run prisma:generate

# Démarre la base Postgres locale (Docker)
db:
	docker compose up -d postgres

db-down:
	docker compose down

# Applique les migrations Prisma sur la base locale
migrate:
	npm run prisma:migrate

generate:
	npm run prisma:generate

dev: db
	npm run start:dev

build:
	npm run build

start:
	npm run start:prod

studio:
	npm run prisma:studio

test:
	npm test

# Nettoyage complet (node_modules, build, volumes de la base)
fclean:
	rm -rf node_modules dist generated
	docker compose down -v
