# Plataforma SaaS — CRM + IA + Omnicanalidad

Monorepo del producto. Arquitectura y roadmap: ver
`docs/superpowers/specs/2026-06-12-arquitectura-fundacion-design.md`.

## Estructura

- `apps/api` — API NestJS (monolito modular)
- `apps/web` — Frontend Next.js (sub-proyecto F4, aún no existe)
- `packages/db` — Esquema Drizzle + migraciones (PostgreSQL)
- `packages/shared` — Tipos, permisos y contratos compartidos
- `packages/ui` — Design system (sub-proyecto F4, aún no existe)

## Desarrollo local

Requisitos: Node 22+, pnpm 10+, Docker.

```bash
pnpm install
docker compose up -d          # postgres (pgvector), redis, mailpit
cp .env.example .env
pnpm --filter @app/db db:migrate
pnpm --filter @app/api dev   # por ahora solo existe la API
```

- API: http://localhost:4000 — OpenAPI en `/api/docs`, health en `/health/liveness`
- Mailpit (emails locales): http://localhost:8025

## Calidad

```bash
pnpm lint && pnpm typecheck && pnpm test
```

Los tests de integración usan PGlite (Postgres embebido): no requieren Docker.
