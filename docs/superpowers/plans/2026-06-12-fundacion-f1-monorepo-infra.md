# Fundación F1: Monorepo + Infraestructura Base — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Levantar el monorepo completo con el esquema de datos de la fundación, el esqueleto de la API NestJS (config validada, logging, errores, health checks) y CI verde.

**Architecture:** Monolito modular TypeScript según el spec `docs/superpowers/specs/2026-06-12-arquitectura-fundacion-design.md`. Este plan es el 1 de 5 de la Fundación: F1 monorepo+infra (este), F2 auth+tenancy, F3 equipo/invitaciones/emails/admin, F4 frontend, F5 E2E+deploy. Los tests de integración usan PGlite (Postgres embebido en proceso) porque el entorno de ejecución no tiene Docker; Docker Compose queda para desarrollo local humano.

**Tech Stack:** pnpm 10 workspaces + Turborepo 2, TypeScript 5 estricto, NestJS 11 (CJS), Drizzle ORM + drizzle-kit, PostgreSQL 16/pgvector (prod) y PGlite (tests), Vitest en todos los paquetes (con unplugin-swc para decoradores Nest), zod, nestjs-pino, tsup para packages.

**Convenciones globales:**
- Scope npm de los paquetes internos: `@app/` (`@app/shared`, `@app/db`, `@app/ui`).
- Código, identificadores y mensajes de commit en inglés; UI en español (sub-proyecto F4).
- Commits frecuentes con prefijos `feat:`, `chore:`, `test:`.

---

### Task 1: Scaffold raíz del monorepo

**Files:**
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `turbo.json`
- Create: `tsconfig.base.json`
- Create: `.gitignore`
- Create: `.nvmrc`
- Create: `.prettierrc`
- Create: `.prettierignore`

- [x] **Step 1: Crear `package.json` raíz**

```json
{
  "name": "ghlvseba",
  "private": true,
  "packageManager": "pnpm@10.33.0",
  "engines": {
    "node": ">=22"
  },
  "scripts": {
    "build": "turbo run build",
    "dev": "turbo run dev",
    "lint": "turbo run lint",
    "typecheck": "turbo run typecheck",
    "test": "turbo run test",
    "format": "prettier --write ."
  },
  "devDependencies": {
    "prettier": "^3.5.3",
    "turbo": "^2.5.0"
  }
}
```

(Nota: `lint` se redefine como `eslint .` en la Task 6; aquí queda apuntando a turbo de forma transitoria.)

- [x] **Step 2: Crear `pnpm-workspace.yaml`**

```yaml
packages:
  - apps/*
  - packages/*
```

- [x] **Step 3: Crear `turbo.json`**

```json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**", ".next/**"]
    },
    "typecheck": {
      "dependsOn": ["^build"]
    },
    "test": {
      "dependsOn": ["^build"]
    },
    "lint": {},
    "dev": {
      "cache": false,
      "persistent": true
    }
  }
}
```

- [x] **Step 4: Crear `tsconfig.base.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "forceConsistentCasingInFileNames": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "isolatedModules": true
  }
}
```

(Los `apps/api` y paquetes que lo necesiten sobreescriben `module`/`moduleResolution`.)

- [x] **Step 5: Crear `.gitignore`**

```
node_modules/
dist/
.next/
.turbo/
coverage/
*.tsbuildinfo
.env
.env.*
!.env.example
*.log
```

- [x] **Step 6: Crear `.nvmrc`, `.prettierrc` y `.prettierignore`**

`.nvmrc`:

```
22
```

`.prettierrc`:

```json
{
  "singleQuote": true,
  "semi": true,
  "printWidth": 100,
  "trailingComma": "all"
}
```

`.prettierignore`:

```
pnpm-lock.yaml
dist/
.next/
.turbo/
coverage/
packages/db/drizzle/
```

- [x] **Step 7: Instalar y verificar**

Run: `pnpm install`
Expected: termina sin errores y crea `pnpm-lock.yaml`.

Run: `pnpm exec turbo --version`
Expected: imprime una versión 2.x.

- [x] **Step 8: Commit**

```bash
git add package.json pnpm-workspace.yaml turbo.json tsconfig.base.json .gitignore .nvmrc .prettierrc .prettierignore pnpm-lock.yaml
git commit -m "chore: scaffold pnpm + turborepo monorepo"
```

---

### Task 2: Entorno de desarrollo local (Docker Compose + .env.example)

**Files:**
- Create: `docker-compose.yml`
- Create: `.env.example`

- [x] **Step 1: Crear `docker-compose.yml`**

```yaml
services:
  postgres:
    image: pgvector/pgvector:pg16
    environment:
      POSTGRES_USER: app
      POSTGRES_PASSWORD: app
      POSTGRES_DB: app
    ports:
      - '5432:5432'
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -U app']
      interval: 5s
      timeout: 3s
      retries: 10

  redis:
    image: redis:7-alpine
    ports:
      - '6379:6379'

  mailpit:
    image: axllent/mailpit:latest
    ports:
      - '1025:1025'
      - '8025:8025'

volumes:
  pgdata:
```

- [x] **Step 2: Crear `.env.example`**

```
NODE_ENV=development
API_PORT=4000
DATABASE_URL=postgres://app:app@localhost:5432/app
REDIS_URL=redis://localhost:6379
```

- [x] **Step 3: Verificar**

Si hay Docker disponible: `docker compose config -q` → exit 0.
Si NO hay Docker (este entorno): verificación visual de indentación YAML; el archivo se valida de verdad en el dev local del usuario.

- [x] **Step 4: Commit**

```bash
git add docker-compose.yml .env.example
git commit -m "chore: add local dev environment (postgres+pgvector, redis, mailpit)"
```

---

### Task 3: Paquete `@app/shared` con roles y permisos (TDD)

Implementa el mapa de roles/permisos del spec §5. Es la fuente de verdad que la API (F2) y el frontend (F4) consumirán.

**Files:**
- Create: `packages/shared/package.json`
- Create: `packages/shared/tsconfig.json`
- Create: `packages/shared/vitest.config.ts`
- Create: `packages/shared/src/index.ts`
- Create: `packages/shared/src/permissions.ts`
- Test: `packages/shared/src/permissions.spec.ts`

- [x] **Step 1: Crear `packages/shared/package.json`**

```json
{
  "name": "@app/shared",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js",
      "require": "./dist/index.cjs"
    }
  },
  "scripts": {
    "build": "tsup src/index.ts --format esm,cjs --dts --clean",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "tsup": "^8.4.0",
    "typescript": "^5.8.0",
    "vitest": "^3.1.0"
  }
}
```

- [x] **Step 2: Crear `packages/shared/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src"]
}
```

- [x] **Step 3: Crear `packages/shared/vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.spec.ts'],
  },
});
```

- [x] **Step 4: Escribir el test que falla** — `packages/shared/src/permissions.spec.ts`

```ts
import { describe, expect, it } from 'vitest';
import {
  COMPANY_ROLES,
  PERMISSIONS,
  roleHasPermission,
  type CompanyRole,
} from './permissions';

describe('roleHasPermission', () => {
  it('grants company_admin every permission', () => {
    for (const permission of PERMISSIONS) {
      expect(roleHasPermission('company_admin', permission)).toBe(true);
    }
  });

  it('grants manager only members.view', () => {
    expect(roleHasPermission('manager', 'members.view')).toBe(true);
    expect(roleHasPermission('manager', 'members.invite')).toBe(false);
    expect(roleHasPermission('manager', 'members.manage')).toBe(false);
    expect(roleHasPermission('manager', 'company.update')).toBe(false);
    expect(roleHasPermission('manager', 'audit.view')).toBe(false);
  });

  it('grants agent no foundation permissions', () => {
    for (const permission of PERMISSIONS) {
      expect(roleHasPermission('agent', permission)).toBe(false);
    }
  });

  it('exposes the three membership roles', () => {
    expect(COMPANY_ROLES).toEqual(['company_admin', 'manager', 'agent']);
    const role: CompanyRole = 'manager';
    expect(role).toBe('manager');
  });
});
```

- [x] **Step 5: Instalar deps y verificar que el test falla**

Run: `pnpm install` (desde la raíz, registra el nuevo workspace)
Run: `pnpm --filter @app/shared test`
Expected: FAIL — `Cannot find module './permissions'` (o equivalente).

- [x] **Step 6: Implementar** — `packages/shared/src/permissions.ts`

```ts
export const COMPANY_ROLES = ['company_admin', 'manager', 'agent'] as const;
export type CompanyRole = (typeof COMPANY_ROLES)[number];

export const PERMISSIONS = [
  'company.update',
  'members.view',
  'members.invite',
  'members.manage',
  'audit.view',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const ROLE_PERMISSIONS: Record<CompanyRole, readonly Permission[]> = {
  company_admin: PERMISSIONS,
  manager: ['members.view'],
  agent: [],
};

export function roleHasPermission(role: CompanyRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}
```

y `packages/shared/src/index.ts`:

```ts
export * from './permissions';
```

- [x] **Step 7: Verificar que pasa**

Run: `pnpm --filter @app/shared test`
Expected: PASS (4 tests).

Run: `pnpm --filter @app/shared build && pnpm --filter @app/shared typecheck`
Expected: genera `dist/` con `.js`, `.cjs` y `.d.ts`; typecheck sin errores.

- [x] **Step 8: Commit**

```bash
git add packages/shared pnpm-lock.yaml
git commit -m "feat(shared): add company roles and permissions map"
```

---

### Task 4: Paquete `@app/db` — esquema Drizzle, migraciones y tests con PGlite

Implementa el modelo de datos del spec §4. PKs uuid v7 generadas en aplicación. `email` se guarda en minúsculas con índice único (la normalización a lowercase la hace la capa de servicio en F2; aquí solo el contrato de esquema).

**Files:**
- Create: `packages/db/package.json`
- Create: `packages/db/tsconfig.json`
- Create: `packages/db/vitest.config.ts`
- Create: `packages/db/drizzle.config.ts`
- Create: `packages/db/src/schema.ts`
- Create: `packages/db/src/index.ts`
- Create: `packages/db/src/testing.ts`
- Create: `packages/db/src/migrate.ts`
- Create: `packages/db/drizzle/` (migraciones generadas)
- Test: `packages/db/src/schema.spec.ts`

- [x] **Step 1: Crear `packages/db/package.json`**

```json
{
  "name": "@app/db",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js",
      "require": "./dist/index.cjs"
    },
    "./testing": {
      "types": "./dist/testing.d.ts",
      "import": "./dist/testing.js",
      "require": "./dist/testing.cjs"
    }
  },
  "scripts": {
    "build": "tsup src/index.ts src/testing.ts --format esm,cjs --dts --clean --shims",
    "test": "vitest run",
    "typecheck": "tsc --noEmit",
    "db:generate": "drizzle-kit generate",
    "db:migrate": "tsx src/migrate.ts"
  },
  "dependencies": {
    "drizzle-orm": "^0.44.0",
    "pg": "^8.16.0",
    "uuidv7": "^1.0.0"
  },
  "devDependencies": {
    "@electric-sql/pglite": "^0.3.0",
    "@types/pg": "^8.15.0",
    "drizzle-kit": "^0.31.0",
    "tsup": "^8.4.0",
    "tsx": "^4.19.0",
    "typescript": "^5.8.0",
    "vitest": "^3.1.0"
  }
}
```

(`--shims` hace que `import.meta.url` funcione también en el build CJS.)

- [x] **Step 2: Crear `tsconfig.json`, `vitest.config.ts` y `drizzle.config.ts`**

`packages/db/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src", "drizzle.config.ts"]
}
```

`packages/db/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.spec.ts'],
    testTimeout: 30000,
  },
});
```

`packages/db/drizzle.config.ts`:

```ts
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
});
```

- [x] **Step 3: Escribir el esquema** — `packages/db/src/schema.ts`

```ts
import {
  boolean,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { uuidv7 } from 'uuidv7';

const id = () =>
  uuid('id')
    .primaryKey()
    .$defaultFn(() => uuidv7());

const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

export const companies = pgTable(
  'companies',
  {
    id: id(),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    status: text('status', { enum: ['active', 'suspended'] })
      .notNull()
      .default('active'),
    timezone: text('timezone').notNull().default('America/Santiago'),
    locale: text('locale').notNull().default('es'),
    ...timestamps,
  },
  (t) => [uniqueIndex('companies_slug_idx').on(t.slug)],
);

export const users = pgTable(
  'users',
  {
    id: id(),
    email: text('email').notNull(),
    passwordHash: text('password_hash').notNull(),
    name: text('name').notNull(),
    avatarUrl: text('avatar_url'),
    status: text('status', { enum: ['active', 'disabled'] })
      .notNull()
      .default('active'),
    emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
    isSuperAdmin: boolean('is_super_admin').notNull().default(false),
    ...timestamps,
  },
  (t) => [uniqueIndex('users_email_idx').on(t.email)],
);

export const memberships = pgTable(
  'memberships',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    role: text('role', { enum: ['company_admin', 'manager', 'agent'] }).notNull(),
    status: text('status', { enum: ['active', 'removed'] })
      .notNull()
      .default('active'),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('memberships_user_company_idx').on(t.userId, t.companyId),
    index('memberships_company_idx').on(t.companyId),
  ],
);

export const invitations = pgTable(
  'invitations',
  {
    id: id(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    email: text('email').notNull(),
    role: text('role', { enum: ['company_admin', 'manager', 'agent'] }).notNull(),
    tokenHash: text('token_hash').notNull(),
    invitedByUserId: uuid('invited_by_user_id')
      .notNull()
      .references(() => users.id),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('invitations_token_hash_idx').on(t.tokenHash),
    index('invitations_company_idx').on(t.companyId),
  ],
);

export const sessions = pgTable(
  'sessions',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    familyId: uuid('family_id').notNull(),
    refreshTokenHash: text('refresh_token_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    ip: text('ip'),
    userAgent: text('user_agent'),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('sessions_refresh_token_hash_idx').on(t.refreshTokenHash),
    index('sessions_user_idx').on(t.userId),
  ],
);

export const authTokens = pgTable(
  'auth_tokens',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    type: text('type', { enum: ['email_verification', 'password_reset'] }).notNull(),
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [uniqueIndex('auth_tokens_token_hash_idx').on(t.tokenHash)],
);

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: id(),
    companyId: uuid('company_id').references(() => companies.id),
    actorUserId: uuid('actor_user_id')
      .notNull()
      .references(() => users.id),
    action: text('action').notNull(),
    entityType: text('entity_type'),
    entityId: text('entity_id'),
    metadata: jsonb('metadata'),
    ip: text('ip'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('audit_logs_company_created_idx').on(t.companyId, t.createdAt)],
);

export const outboxEvents = pgTable(
  'outbox_events',
  {
    id: id(),
    companyId: uuid('company_id').references(() => companies.id),
    eventType: text('event_type').notNull(),
    payload: jsonb('payload').notNull(),
    status: text('status', { enum: ['pending', 'published', 'failed'] })
      .notNull()
      .default('pending'),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('outbox_events_status_created_idx').on(t.status, t.createdAt)],
);
```

- [x] **Step 4: Crear `src/index.ts`, `src/testing.ts` y `src/migrate.ts`**

`packages/db/src/index.ts`:

```ts
export * from './schema';
```

`packages/db/src/testing.ts` (solo para suites de test; usa PGlite):

```ts
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { fileURLToPath } from 'node:url';
import * as schema from './schema';

export type TestDb = Awaited<ReturnType<typeof createTestDb>>;

export async function createTestDb() {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  const migrationsFolder = fileURLToPath(new URL('../drizzle', import.meta.url));
  await migrate(db, { migrationsFolder });
  return { db, client };
}
```

`packages/db/src/migrate.ts` (runner para Postgres real, usado en deploy y dev local):

```ts
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL is required');
  }
  const pool = new Pool({ connectionString: url });
  const db = drizzle(pool);
  const migrationsFolder = fileURLToPath(new URL('../drizzle', import.meta.url));
  await migrate(db, { migrationsFolder });
  await pool.end();
  console.log('migrations applied');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [x] **Step 5: Instalar y generar la migración inicial**

Run: `pnpm install`
Run: `pnpm --filter @app/db db:generate`
Expected: crea `packages/db/drizzle/0000_*.sql` con los CREATE TABLE de las 8 tablas + carpeta `meta/`.

- [x] **Step 6: Escribir el test de integración** — `packages/db/src/schema.spec.ts`

```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from './testing';
import { companies, memberships, users } from './schema';

describe('foundation schema', () => {
  let testDb: TestDb;

  beforeEach(async () => {
    testDb = await createTestDb();
  });

  afterEach(async () => {
    await testDb.client.close();
  });

  it('applies migrations and inserts a company with defaults', async () => {
    const [company] = await testDb.db
      .insert(companies)
      .values({ name: 'Acme', slug: 'acme' })
      .returning();

    expect(company).toBeDefined();
    expect(company!.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(company!.status).toBe('active');
    expect(company!.timezone).toBe('America/Santiago');
    expect(company!.locale).toBe('es');
  });

  it('rejects duplicate company slugs', async () => {
    await testDb.db.insert(companies).values({ name: 'Acme', slug: 'acme' });
    await expect(
      testDb.db.insert(companies).values({ name: 'Other', slug: 'acme' }),
    ).rejects.toThrow();
  });

  it('links users to companies through memberships and enforces uniqueness', async () => {
    const [company] = await testDb.db
      .insert(companies)
      .values({ name: 'Acme', slug: 'acme' })
      .returning();
    const [user] = await testDb.db
      .insert(users)
      .values({ email: 'ana@acme.cl', passwordHash: 'x', name: 'Ana' })
      .returning();

    const [membership] = await testDb.db
      .insert(memberships)
      .values({ userId: user!.id, companyId: company!.id, role: 'company_admin' })
      .returning();

    expect(membership!.status).toBe('active');

    await expect(
      testDb.db
        .insert(memberships)
        .values({ userId: user!.id, companyId: company!.id, role: 'agent' }),
    ).rejects.toThrow();
  });

  it('rejects duplicate user emails', async () => {
    await testDb.db.insert(users).values({ email: 'ana@acme.cl', passwordHash: 'x', name: 'Ana' });
    await expect(
      testDb.db.insert(users).values({ email: 'ana@acme.cl', passwordHash: 'y', name: 'Ana B' }),
    ).rejects.toThrow();
  });
});
```

- [x] **Step 7: Ejecutar tests**

Run: `pnpm --filter @app/db test`
Expected: PASS (4 tests). La primera ejecución descarga el WASM de PGlite ya instalado vía npm; no requiere red ni Docker.

- [x] **Step 8: Build y typecheck**

Run: `pnpm --filter @app/db build && pnpm --filter @app/db typecheck`
Expected: `dist/` con entradas `index` y `testing` en ESM+CJS+d.ts; typecheck limpio.

- [x] **Step 9: Commit**

```bash
git add packages/db pnpm-lock.yaml
git commit -m "feat(db): add foundation schema, migrations and pglite test harness"
```

---

### Task 5: Esqueleto de `apps/api` — NestJS con config validada, pino, filtro de errores y health (TDD)

**Files:**
- Create: `apps/api/package.json`
- Create: `apps/api/tsconfig.json`
- Create: `apps/api/tsconfig.build.json`
- Create: `apps/api/nest-cli.json`
- Create: `apps/api/vitest.config.ts`
- Create: `apps/api/.swcrc`
- Create: `apps/api/src/main.ts`
- Create: `apps/api/src/app.module.ts`
- Create: `apps/api/src/config/env.ts`
- Create: `apps/api/src/config/config.module.ts`
- Create: `apps/api/src/common/filters/global-exception.filter.ts`
- Create: `apps/api/src/infra/db/db.module.ts`
- Create: `apps/api/src/infra/db/db.service.ts`
- Create: `apps/api/src/modules/health/health.module.ts`
- Create: `apps/api/src/modules/health/health.controller.ts`
- Test: `apps/api/src/config/env.spec.ts`
- Test: `apps/api/test/health.e2e-spec.ts`

- [x] **Step 1: Crear `apps/api/package.json`**

```json
{
  "name": "@app/api",
  "version": "0.0.0",
  "private": true,
  "scripts": {
    "build": "nest build",
    "dev": "nest start --watch",
    "start": "node dist/main.js",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@app/db": "workspace:*",
    "@app/shared": "workspace:*",
    "@nestjs/common": "^11.0.0",
    "@nestjs/core": "^11.0.0",
    "@nestjs/platform-express": "^11.0.0",
    "@nestjs/swagger": "^11.0.0",
    "drizzle-orm": "^0.44.0",
    "nestjs-pino": "^4.4.0",
    "pg": "^8.16.0",
    "pino-http": "^10.4.0",
    "reflect-metadata": "^0.2.2",
    "rxjs": "^7.8.0",
    "zod": "^3.24.0"
  },
  "devDependencies": {
    "@nestjs/cli": "^11.0.0",
    "@nestjs/testing": "^11.0.0",
    "@swc/core": "^1.11.0",
    "@types/express": "^5.0.0",
    "@types/node": "^22.0.0",
    "@types/pg": "^8.15.0",
    "@types/supertest": "^6.0.0",
    "pino-pretty": "^13.0.0",
    "supertest": "^7.1.0",
    "typescript": "^5.8.0",
    "unplugin-swc": "^1.5.0",
    "vitest": "^3.1.0"
  }
}
```

- [x] **Step 2: Configs de compilación y test**

`apps/api/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "module": "commonjs",
    "moduleResolution": "node",
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true,
    "isolatedModules": false,
    "outDir": "dist",
    "baseUrl": "./"
  },
  "include": ["src", "test"]
}
```

`apps/api/tsconfig.build.json`:

```json
{
  "extends": "./tsconfig.json",
  "exclude": ["node_modules", "dist", "test", "**/*.spec.ts"]
}
```

`apps/api/nest-cli.json`:

```json
{
  "$schema": "https://json.schemastore.org/nest-cli",
  "collection": "@nestjs/schematics",
  "sourceRoot": "src",
  "compilerOptions": {
    "deleteOutDir": true,
    "tsConfigPath": "tsconfig.build.json"
  }
}
```

`apps/api/.swcrc`:

```json
{
  "$schema": "https://swc.rs/schema.json",
  "jsc": {
    "parser": {
      "syntax": "typescript",
      "decorators": true
    },
    "transform": {
      "legacyDecorator": true,
      "decoratorMetadata": true
    },
    "target": "es2022"
  }
}
```

`apps/api/vitest.config.ts`:

```ts
import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.spec.ts', 'test/**/*.e2e-spec.ts'],
    testTimeout: 30000,
  },
  plugins: [
    swc.vite({
      module: { type: 'es6' },
    }),
  ],
});
```

- [x] **Step 3: Test de config que falla** — `apps/api/src/config/env.spec.ts`

```ts
import { describe, expect, it } from 'vitest';
import { loadEnv } from './env';

describe('loadEnv', () => {
  const valid = {
    DATABASE_URL: 'postgres://app:app@localhost:5432/app',
  };

  it('parses a minimal valid environment with defaults', () => {
    const env = loadEnv(valid);
    expect(env.NODE_ENV).toBe('development');
    expect(env.API_PORT).toBe(4000);
    expect(env.DATABASE_URL).toBe(valid.DATABASE_URL);
    expect(env.REDIS_URL).toBeUndefined();
  });

  it('coerces API_PORT to number', () => {
    const env = loadEnv({ ...valid, API_PORT: '8080' });
    expect(env.API_PORT).toBe(8080);
  });

  it('fails fast naming the missing variable', () => {
    expect(() => loadEnv({})).toThrow(/DATABASE_URL/);
  });

  it('rejects an invalid NODE_ENV', () => {
    expect(() => loadEnv({ ...valid, NODE_ENV: 'staging' })).toThrow(/NODE_ENV/);
  });
});
```

- [x] **Step 4: Instalar deps y verificar que falla**

Run: `pnpm install`
Run: `pnpm --filter @app/api test`
Expected: FAIL — `Cannot find module './env'`.

- [x] **Step 5: Implementar config** — `apps/api/src/config/env.ts`

```ts
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1).optional(),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid environment configuration -> ${issues}`);
  }
  return result.data;
}
```

y `apps/api/src/config/config.module.ts`:

```ts
import { Global, Module } from '@nestjs/common';
import { loadEnv } from './env';

export const ENV = Symbol('ENV');

@Global()
@Module({
  providers: [{ provide: ENV, useFactory: () => loadEnv() }],
  exports: [ENV],
})
export class ConfigModule {}
```

- [x] **Step 6: Verificar que el test de config pasa**

Run: `pnpm --filter @app/api test`
Expected: PASS los 4 tests de `env.spec.ts` (aún no existe el e2e).

- [x] **Step 7: Filtro global de excepciones** — `apps/api/src/common/filters/global-exception.filter.ts`

```ts
import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';

export class AppException extends HttpException {
  constructor(
    readonly code: string,
    message: string,
    status: HttpStatus,
    readonly details?: unknown,
  ) {
    super(message, status);
  }
}

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();

    if (exception instanceof AppException) {
      res.status(exception.getStatus()).json({
        code: exception.code,
        message: exception.message,
        ...(exception.details !== undefined ? { details: exception.details } : {}),
      });
      return;
    }

    if (exception instanceof HttpException) {
      res.status(exception.getStatus()).json({
        code: 'http_error',
        message: exception.message,
      });
      return;
    }

    this.logger.error(exception);
    res
      .status(HttpStatus.INTERNAL_SERVER_ERROR)
      .json({ code: 'internal_error', message: 'Internal server error' });
  }
}
```

- [x] **Step 8: Infra de base de datos** — `apps/api/src/infra/db/db.service.ts`

```ts
import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from '@app/db';
import { ENV } from '../../config/config.module';
import type { Env } from '../../config/env';

@Injectable()
export class DbService implements OnModuleDestroy {
  readonly pool: Pool;
  readonly db: NodePgDatabase<typeof schema>;

  constructor(@Inject(ENV) env: Env) {
    this.pool = new Pool({ connectionString: env.DATABASE_URL });
    this.db = drizzle(this.pool, { schema });
  }

  async ping(): Promise<void> {
    await this.db.execute(sql`select 1`);
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}
```

y `apps/api/src/infra/db/db.module.ts`:

```ts
import { Global, Module } from '@nestjs/common';
import { DbService } from './db.service';

@Global()
@Module({
  providers: [DbService],
  exports: [DbService],
})
export class DbModule {}
```

- [x] **Step 9: Test e2e de health que falla** — `apps/api/test/health.e2e-spec.ts`

```ts
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GlobalExceptionFilter } from '../src/common/filters/global-exception.filter';
import { DbService } from '../src/infra/db/db.service';
import { HealthModule } from '../src/modules/health/health.module';

async function createApp(dbStub: Pick<DbService, 'ping'>): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [HealthModule],
  })
    .overrideProvider(DbService)
    .useValue(dbStub)
    .compile();

  const app = moduleRef.createNestApplication();
  app.useGlobalFilters(new GlobalExceptionFilter());
  await app.init();
  return app;
}

describe('health endpoints (e2e)', () => {
  let app: INestApplication;

  afterEach(async () => {
    await app.close();
  });

  it('GET /health/liveness returns 200 ok', async () => {
    app = await createApp({ ping: vi.fn().mockResolvedValue(undefined) });
    const res = await request(app.getHttpServer()).get('/health/liveness');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  it('GET /health/readiness returns 200 when the database responds', async () => {
    app = await createApp({ ping: vi.fn().mockResolvedValue(undefined) });
    const res = await request(app.getHttpServer()).get('/health/readiness');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok', db: 'up' });
  });

  it('GET /health/readiness returns 503 with uniform error shape when the database is down', async () => {
    app = await createApp({ ping: vi.fn().mockRejectedValue(new Error('boom')) });
    const res = await request(app.getHttpServer()).get('/health/readiness');
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ code: 'not_ready', message: 'Database unreachable' });
  });
});
```

Run: `pnpm --filter @app/api test`
Expected: FAIL — `Cannot find module '../src/modules/health/health.module'`.

- [x] **Step 10: Implementar health** — `apps/api/src/modules/health/health.controller.ts`

```ts
import { Controller, Get, HttpStatus } from '@nestjs/common';
import { AppException } from '../../common/filters/global-exception.filter';
import { DbService } from '../../infra/db/db.service';

@Controller('health')
export class HealthController {
  constructor(private readonly db: DbService) {}

  @Get('liveness')
  liveness() {
    return { status: 'ok' };
  }

  @Get('readiness')
  async readiness() {
    try {
      await this.db.ping();
    } catch {
      throw new AppException('not_ready', 'Database unreachable', HttpStatus.SERVICE_UNAVAILABLE);
    }
    return { status: 'ok', db: 'up' };
  }
}
```

y `apps/api/src/modules/health/health.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { DbModule } from '../../infra/db/db.module';
import { HealthController } from './health.controller';

@Module({
  imports: [DbModule],
  controllers: [HealthController],
})
export class HealthModule {}
```

- [x] **Step 11: Verificar que todos los tests pasan**

Run: `pnpm --filter @app/api test`
Expected: PASS (7 tests: 4 de env + 3 de health e2e).

- [x] **Step 12: Bootstrap de la app** — `apps/api/src/app.module.ts`

```ts
import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { ConfigModule } from './config/config.module';
import { DbModule } from './infra/db/db.module';
import { HealthModule } from './modules/health/health.module';

@Module({
  imports: [
    ConfigModule,
    LoggerModule.forRoot({
      pinoHttp: {
        transport:
          process.env.NODE_ENV === 'development' ? { target: 'pino-pretty' } : undefined,
        redact: ['req.headers.authorization', 'req.headers.cookie'],
      },
    }),
    DbModule,
    HealthModule,
  ],
})
export class AppModule {}
```

y `apps/api/src/main.ts`:

```ts
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger } from 'nestjs-pino';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';
import { AppModule } from './app.module';
import { ENV } from './config/config.module';
import type { Env } from './config/env';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  app.useGlobalFilters(new GlobalExceptionFilter());
  app.setGlobalPrefix('api/v1', {
    exclude: ['health/liveness', 'health/readiness'],
  });

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Platform API')
    .setVersion('0.1.0')
    .build();
  SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, swaggerConfig));

  const env = app.get<Env>(ENV);
  await app.listen(env.API_PORT);
}

void bootstrap();
```

- [x] **Step 13: Build y typecheck**

Run: `pnpm --filter @app/api build && pnpm --filter @app/api typecheck`
Expected: `apps/api/dist/main.js` generado; typecheck limpio.

(El arranque real `node dist/main.js` requiere Postgres corriendo; en este entorno sin Docker se valida con los tests e2e. En dev local: `docker compose up -d && pnpm --filter @app/db db:migrate && pnpm --filter @app/api dev`.)

- [x] **Step 14: Commit**

```bash
git add apps/api pnpm-lock.yaml
git commit -m "feat(api): add nestjs skeleton with validated config, pino, error filter and health checks"
```

---

### Task 6: Lint + typecheck del monorepo

**Files:**
- Create: `eslint.config.mjs`
- Modify: `package.json` (script `lint` y devDependencies)

- [x] **Step 1: Crear `eslint.config.mjs`**

```js
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/.next/**',
      '**/node_modules/**',
      '**/.turbo/**',
      'packages/db/drizzle/**',
      'coverage/**',
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
);
```

- [x] **Step 2: Actualizar la raíz**

En `package.json` raíz, reemplazar el script `lint` y agregar devDependencies:

```json
"scripts": {
  "build": "turbo run build",
  "dev": "turbo run dev",
  "lint": "eslint .",
  "typecheck": "turbo run typecheck",
  "test": "turbo run test",
  "format": "prettier --write ."
}
```

```json
"devDependencies": {
  "@eslint/js": "^9.25.0",
  "eslint": "^9.25.0",
  "prettier": "^3.5.3",
  "turbo": "^2.5.0",
  "typescript": "^5.8.0",
  "typescript-eslint": "^8.30.0"
}
```

Y eliminar `lint` del objeto `tasks` de `turbo.json` (queda `build`, `typecheck`, `test`, `dev`).

- [x] **Step 3: Instalar y verificar todo el monorepo**

Run: `pnpm install`
Run: `pnpm lint`
Expected: exit 0 (corregir cualquier hallazgo real que reporte; no silenciar reglas sin causa).

Run: `pnpm typecheck && pnpm build && pnpm test`
Expected: turbo ejecuta los tres pipelines en `@app/shared`, `@app/db` y `@app/api` sin errores (18 tests en total: 4 shared + 4 db + 10 api, contando los 3 tests del filtro agregados en review).

- [x] **Step 4: Commit**

```bash
git add eslint.config.mjs package.json turbo.json pnpm-lock.yaml
git commit -m "chore: add eslint flat config and wire monorepo lint/typecheck"
```

---

### Task 7: CI en GitHub Actions + README

**Files:**
- Create: `.github/workflows/ci.yml`
- Create: `README.md`

- [x] **Step 1: Crear `.github/workflows/ci.yml`**

```yaml
name: CI

on:
  push:
    branches: [main, 'claude/**']
  pull_request:

jobs:
  ci:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm lint
      - run: pnpm typecheck
      - run: pnpm build
      - run: pnpm test
```

(`pnpm/action-setup@v4` toma la versión del campo `packageManager`. `typecheck`/`test` dependen de `build` vía turbo, pero se ejecuta `build` explícito antes para logs claros.)

- [x] **Step 2: Crear `README.md`**

````markdown
# Plataforma SaaS — CRM + IA + Omnicanalidad

Monorepo del producto. Arquitectura y roadmap: ver
`docs/superpowers/specs/2026-06-12-arquitectura-fundacion-design.md`.

## Estructura

- `apps/api` — API NestJS (monolito modular)
- `apps/web` — Frontend Next.js (sub-proyecto F4)
- `packages/db` — Esquema Drizzle + migraciones (PostgreSQL)
- `packages/shared` — Tipos, permisos y contratos compartidos
- `packages/ui` — Design system (sub-proyecto F4)

## Desarrollo local

Requisitos: Node 22+, pnpm 10+, Docker.

```bash
pnpm install
docker compose up -d          # postgres (pgvector), redis, mailpit
cp .env.example .env
pnpm --filter @app/db db:migrate
pnpm dev
```

- API: http://localhost:4000 — OpenAPI en `/api/docs`, health en `/health/liveness`
- Mailpit (emails locales): http://localhost:8025

## Calidad

```bash
pnpm lint && pnpm typecheck && pnpm test
```

Los tests de integración usan PGlite (Postgres embebido): no requieren Docker.
````

- [x] **Step 3: Commit y push**

```bash
git add .github/workflows/ci.yml README.md
git commit -m "ci: add github actions pipeline and project readme"
git push -u origin claude/relaxed-newton-km7yxh
```

Expected: push exitoso; el workflow corre en GitHub sobre la rama y queda verde.

---

## Cobertura del spec (F1)

| Requisito del spec | Task |
|---|---|
| §2.1 Monorepo pnpm+Turborepo | 1 |
| §2.2 Compose dev (postgres/redis/mailpit) | 2 |
| §5 Mapa de roles/permisos en `packages/shared` | 3 |
| §4 Modelo de datos completo + migraciones | 4 |
| §8/§10 Config validada, logging estructurado, errores uniformes | 5 |
| §6 `GET /health` liveness/readiness + OpenAPI base | 5 |
| §9 Vitest + tests de integración sin Docker (PGlite) | 4, 5 |
| §9 CI bloqueante | 7 |

**Queda para planes siguientes:** F2 auth+tenancy (CLS, `tenantDb`, guards, endpoints `/auth/*`, `/me`), F3 equipo/invitaciones/emails (BullMQ + worker + outbox publisher + Mailpit, audit, `/admin/*`), F4 frontend completo, F5 Playwright E2E + Dockerfiles + deploy.

---

## Registro de ejecución (2026-06-12) — COMPLETADO ✅

Ejecutado con subagent-driven-development (implementador + revisión de spec +
revisión de calidad por tarea, más revisión final holística). Rango de
commits: `4fe4c02..6cc7eaa` (14 commits). CI verde en GitHub Actions (run #1,
41s). Suite final: 18/18 tests, lint/typecheck/build limpios, cero drift de
migraciones.

### Enmiendas aprobadas en review durante la ejecución

- `turbo.json`: `globalDependencies` (tsconfig.base.json) y `globalEnv` (NODE_ENV).
- Compose: mailpit pineado a v1.21, healthcheck de redis, esquema `postgresql://`.
- `@app/shared` y `@app/db`: exports maps anidados por condición
  (`import`/`require` con types `.d.ts`/`.d.cts`) + fallbacks `main`/`types`.
- `@app/db`: índices para F2 (`sessions_family_idx`, `auth_tokens_user_type_idx`,
  `invitations_company_email_idx`); `ON DELETE CASCADE` en sessions/auth_tokens
  (resto de FKs: NO ACTION deliberado por soft-delete); assert de uuid v7.
- `apps/api`: tsconfig `module`/`moduleResolution` **node16** (en vez de
  commonjs/node) para honrar exports maps; `.swcrc` eliminado (inerte);
  handler de `error` del Pool de pg + `connectionTimeoutMillis`;
  `import 'reflect-metadata'` explícito; 3 tests unit del filtro (camino 500).
- ESLint: `varsIgnorePattern`/`caughtErrorsIgnorePattern` `^_`; ignore de `.claude/`.
- CI: bloque `concurrency` + `timeout-minutes: 15`.
- README: `apps/web`/`packages/ui` marcados como pendientes; `pnpm dev`
  acotado a la API.
- Raíz: `pnpm.onlyBuiltDependencies` (esbuild, pglite) requerido por pnpm 10.

### Pendientes diferidos a F2 (anotados en review)

- Mapeo de códigos de error por status (404→not_found, etc.) y normalización
  de throws no-Error en el filtro global.
- Evaluar `recommendedTypeChecked` de typescript-eslint cuando el código crezca.
