# Fundación F2: Auth + Tenancy — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Autenticación completa (registro de empresa, login con JWT + refresh rotativo con revocación por familia, verificación de email, reset de contraseña) y contexto multi-tenant (CLS, guards de permisos, `tenantDb`), con endpoints `/me` y `/company` como primera superficie protegida.

**Architecture:** Plan 2 de 5 de la Fundación (spec `docs/superpowers/specs/2026-06-12-arquitectura-fundacion-design.md` §3–§8). Construye sobre F1: NestJS 11 CJS con `module: node16`, `AppException`/`GlobalExceptionFilter` (`{code,message,details?}`), `ENV` symbol del `ConfigModule`, `DbService` (pg Pool + drizzle), esquema `@app/db` con tablas sessions/auth_tokens/audit_logs/outbox_events ya migradas.

**Estrategia de testing (la pieza central):** los e2e levantan la app Nest real (AppModule) con `DbService` sustituido por una instancia respaldada en **PGlite** (`@app/db/testing`) y `ENV` sustituido por valores de test. Así cada flujo de auth se ejercita por HTTP (supertest) contra un Postgres real en proceso, sin Docker. El cast `PgliteDatabase → NodePgDatabase` es seguro para el subconjunto de API usado (insert/select/update/delete/transaction) y queda confinado al harness.

**Decisiones de contrato (alineadas al spec):**
- Access token: JWT HS256, 15 min, claims `{sub, companyId, role, isSuperAdmin}`. Secret `JWT_ACCESS_SECRET` (≥32 chars).
- Refresh token: **opaco** (32 bytes base64url), almacenado hasheado (sha256) en `sessions`, TTL 30 días, cookie `httpOnly; SameSite=Lax; Secure(prod); Path=/api/v1/auth`. Rotación en cada refresh; reuso de un token revocado revoca la familia completa (`family_id`).
- Tokens de email (verificación 24h / reset 1h): opacos, hasheados en `auth_tokens`, de un solo uso.
- El **envío** de emails es F3: aquí los flujos escriben el evento en `outbox_events` con el token raw en el payload; el publisher de F3 DEBE redactar el payload tras publicar (anotado ahí).
- Login no exige email verificado (el spec no lo exige); empresa suspendida bloquea login y refresh; usuario sin membership activa → 403 `no_membership`.
- `POST /auth/forgot-password` responde 200 siempre (no filtra existencia).
- Cambio de contraseña (PATCH /me o reset) revoca **todas** las sesiones del usuario.
- Errores de validación: `ZodValidationPipe` → `AppException('validation_error', …, 400, fieldErrors)`.

**Tech adicional:** `@nestjs/jwt`, `argon2` (argon2id; requiere agregarlo a `pnpm.onlyBuiltDependencies`), `nestjs-cls`, `@nestjs/throttler` (storage en memoria; Redis en F5), `cookie-parser`, `helmet`. Contratos zod compartidos en `@app/shared` (los reusará el frontend F4).

**Convenciones:** las de F1 (código/commits en inglés, TDD estricto, commit por tarea, trailer de sesión en commits). Todo test corre con `pnpm --filter @app/api test` (o `--filter @app/shared`).

---

### Task 1: Env ampliada + hardening del bootstrap (helmet, CORS, cookies)

**Files:**
- Modify: `apps/api/src/config/env.ts`
- Modify: `apps/api/src/config/env.spec.ts`
- Modify: `apps/api/src/main.ts`
- Modify: `apps/api/package.json` (deps)
- Modify: `.env.example`

- [ ] **Step 1: Tests primero** — en `apps/api/src/config/env.spec.ts`, actualizar el fixture y agregar 2 casos. El archivo queda:

```ts
import { describe, expect, it } from 'vitest';
import { loadEnv } from './env';

describe('loadEnv', () => {
  const valid = {
    DATABASE_URL: 'postgresql://app:app@localhost:5432/app',
    JWT_ACCESS_SECRET: 'x'.repeat(32),
  };

  it('parses a minimal valid environment with defaults', () => {
    const env = loadEnv(valid);
    expect(env.NODE_ENV).toBe('development');
    expect(env.API_PORT).toBe(4000);
    expect(env.DATABASE_URL).toBe(valid.DATABASE_URL);
    expect(env.REDIS_URL).toBeUndefined();
    expect(env.WEB_URL).toBe('http://localhost:3000');
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

  it('requires JWT_ACCESS_SECRET of at least 32 chars', () => {
    expect(() => loadEnv({ DATABASE_URL: valid.DATABASE_URL })).toThrow(/JWT_ACCESS_SECRET/);
    expect(() =>
      loadEnv({ DATABASE_URL: valid.DATABASE_URL, JWT_ACCESS_SECRET: 'short' }),
    ).toThrow(/JWT_ACCESS_SECRET/);
  });

  it('accepts an explicit WEB_URL', () => {
    const env = loadEnv({ ...valid, WEB_URL: 'https://app.example.com' });
    expect(env.WEB_URL).toBe('https://app.example.com');
  });
});
```

- [ ] **Step 2: Run** `pnpm --filter @app/api test` → los 2 casos nuevos FALLAN (Env no conoce las claves).

- [ ] **Step 3: Implementar** — `apps/api/src/config/env.ts`, el schema queda:

```ts
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1).optional(),
  JWT_ACCESS_SECRET: z.string().min(32),
  WEB_URL: z.string().url().default('http://localhost:3000'),
});
```
(resto del archivo igual).

- [ ] **Step 4: Run** `pnpm --filter @app/api test` → PASS (la suite completa).

- [ ] **Step 5: Deps y bootstrap.** `pnpm --filter @app/api add helmet cookie-parser && pnpm --filter @app/api add -D @types/cookie-parser`. Después `apps/api/src/main.ts` queda:

```ts
import 'reflect-metadata';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger } from 'nestjs-pino';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';
import { AppModule } from './app.module';
import { ENV } from './config/config.module';
import type { Env } from './config/env';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const env = app.get<Env>(ENV);

  app.useLogger(app.get(Logger));
  app.use(helmet());
  app.use(cookieParser());
  app.enableCors({ origin: env.WEB_URL, credentials: true });
  app.useGlobalFilters(new GlobalExceptionFilter());
  app.setGlobalPrefix('api/v1', {
    exclude: ['health/liveness', 'health/readiness'],
  });

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Platform API')
    .setVersion('0.1.0')
    .build();
  SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, swaggerConfig));

  await app.listen(env.API_PORT);
}

void bootstrap();
```

- [ ] **Step 6: `.env.example`** queda:

```
NODE_ENV=development
API_PORT=4000
DATABASE_URL=postgresql://app:app@localhost:5432/app
REDIS_URL=redis://localhost:6379
JWT_ACCESS_SECRET=dev-only-secret-change-me-0123456789abcdef
WEB_URL=http://localhost:3000
```

- [ ] **Step 7: Verificar y commitear**

Run: `pnpm --filter @app/api test && pnpm --filter @app/api typecheck && pnpm --filter @app/api build`
Expected: verde.

```bash
git add apps/api .env.example pnpm-lock.yaml
git commit -m "feat(api): extend env schema and harden bootstrap (helmet, cors, cookies)"
```

---

### Task 2: Contratos zod compartidos + ZodValidationPipe (TDD)

**Files:**
- Create: `packages/shared/src/auth-contracts.ts`
- Test: `packages/shared/src/auth-contracts.spec.ts`
- Modify: `packages/shared/src/index.ts`
- Modify: `packages/shared/package.json` (dep zod)
- Create: `apps/api/src/common/pipes/zod-validation.pipe.ts`
- Test: `apps/api/src/common/pipes/zod-validation.pipe.spec.ts`

- [ ] **Step 1: Test de contratos que falla** — `packages/shared/src/auth-contracts.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  loginSchema,
  registerSchema,
  resetPasswordSchema,
  updateMeSchema,
} from './auth-contracts';

describe('auth contracts', () => {
  it('normalizes email to lowercase and trims it', () => {
    const parsed = registerSchema.parse({
      companyName: 'Acme',
      name: 'Ana',
      email: '  Ana@ACME.cl ',
      password: 'supersecret123',
    });
    expect(parsed.email).toBe('ana@acme.cl');
  });

  it('rejects short passwords', () => {
    expect(() =>
      registerSchema.parse({
        companyName: 'Acme',
        name: 'Ana',
        email: 'ana@acme.cl',
        password: 'short',
      }),
    ).toThrow();
  });

  it('login requires email shape', () => {
    expect(() => loginSchema.parse({ email: 'not-an-email', password: 'x'.repeat(10) })).toThrow();
  });

  it('reset requires token and a valid new password', () => {
    expect(() => resetPasswordSchema.parse({ token: 'short', password: 'supersecret123' })).toThrow();
    expect(
      resetPasswordSchema.parse({ token: 't'.repeat(20), password: 'supersecret123' }),
    ).toBeTruthy();
  });

  it('updateMe requires currentPassword when newPassword is present', () => {
    expect(() => updateMeSchema.parse({ newPassword: 'supersecret123' })).toThrow();
    expect(
      updateMeSchema.parse({ currentPassword: 'oldsecret1234', newPassword: 'supersecret123' }),
    ).toBeTruthy();
    expect(updateMeSchema.parse({ name: 'Ana María' })).toBeTruthy();
  });
});
```

- [ ] **Step 2:** `pnpm --filter @app/shared add zod` (rango `^3.24.0`, igual que la api). Run `pnpm --filter @app/shared test` → FAIL (módulo inexistente).

- [ ] **Step 3: Implementar** — `packages/shared/src/auth-contracts.ts`:

```ts
import { z } from 'zod';

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email();

export const passwordSchema = z.string().min(10).max(128);

export const tokenSchema = z.string().min(20).max(128);

export const registerSchema = z.object({
  companyName: z.string().trim().min(2).max(80),
  name: z.string().trim().min(2).max(80),
  email: emailSchema,
  password: passwordSchema,
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(128),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const verifyEmailSchema = z.object({ token: tokenSchema });
export type VerifyEmailInput = z.infer<typeof verifyEmailSchema>;

export const forgotPasswordSchema = z.object({ email: emailSchema });
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;

export const resetPasswordSchema = z.object({
  token: tokenSchema,
  password: passwordSchema,
});
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

export const updateMeSchema = z
  .object({
    name: z.string().trim().min(2).max(80).optional(),
    avatarUrl: z.string().url().optional(),
    currentPassword: z.string().min(1).max(128).optional(),
    newPassword: passwordSchema.optional(),
  })
  .refine((v) => !v.newPassword || !!v.currentPassword, {
    message: 'currentPassword is required to set newPassword',
    path: ['currentPassword'],
  });
export type UpdateMeInput = z.infer<typeof updateMeSchema>;

export const updateCompanySchema = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  timezone: z.string().min(1).max(64).optional(),
  locale: z.string().min(2).max(8).optional(),
});
export type UpdateCompanyInput = z.infer<typeof updateCompanySchema>;
```

y en `packages/shared/src/index.ts` agregar `export * from './auth-contracts';`.

- [ ] **Step 4:** `pnpm --filter @app/shared test` → PASS; `pnpm --filter @app/shared build && pnpm --filter @app/shared typecheck` → verde.

- [ ] **Step 5: Test del pipe que falla** — `apps/api/src/common/pipes/zod-validation.pipe.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { AppException } from '../filters/global-exception.filter';
import { ZodValidationPipe } from './zod-validation.pipe';

describe('ZodValidationPipe', () => {
  const pipe = new ZodValidationPipe(z.object({ email: z.string().email() }));

  it('returns parsed (transformed) data on success', () => {
    expect(pipe.transform({ email: 'ana@acme.cl', extra: 'dropped' })).toEqual({
      email: 'ana@acme.cl',
    });
  });

  it('throws AppException validation_error with field details on failure', () => {
    try {
      pipe.transform({ email: 'nope' });
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(AppException);
      const appErr = err as AppException;
      expect(appErr.code).toBe('validation_error');
      expect(appErr.getStatus()).toBe(400);
      expect(appErr.details).toHaveProperty('email');
    }
  });
});
```

Run → FAIL (módulo inexistente).

- [ ] **Step 6: Implementar** — `apps/api/src/common/pipes/zod-validation.pipe.ts`:

```ts
import { HttpStatus, Injectable } from '@nestjs/common';
import type { PipeTransform } from '@nestjs/common';
import type { ZodTypeAny } from 'zod';
import { AppException } from '../filters/global-exception.filter';

@Injectable()
export class ZodValidationPipe implements PipeTransform {
  constructor(private readonly schema: ZodTypeAny) {}

  transform(value: unknown): unknown {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new AppException(
        'validation_error',
        'Invalid request payload',
        HttpStatus.BAD_REQUEST,
        result.error.flatten().fieldErrors,
      );
    }
    return result.data;
  }
}
```

- [ ] **Step 7:** Suite completa verde (`pnpm --filter @app/api test`). Commit:

```bash
git add packages/shared apps/api/src/common/pipes pnpm-lock.yaml
git commit -m "feat(shared,api): add zod auth contracts and validation pipe"
```

---

### Task 3: Harness e2e con PGlite + silenciar pino en tests

**Files:**
- Create: `apps/api/test/harness.ts`
- Test: `apps/api/test/harness.e2e-spec.ts`
- Modify: `apps/api/src/app.module.ts` (pino `enabled` en test)
- Modify: `apps/api/package.json` (devDep `@electric-sql/pglite` vía `@app/db/testing` ya resuelto por workspace — no se agrega nada aquí; sí `supertest` ya existe)

- [ ] **Step 1: AppModule** — en `LoggerModule.forRoot`, el objeto `pinoHttp` queda:

```ts
      pinoHttp: {
        enabled: process.env.NODE_ENV !== 'test',
        transport:
          process.env.NODE_ENV === 'development' ? { target: 'pino-pretty' } : undefined,
        redact: ['req.headers.authorization', 'req.headers.cookie'],
      },
```

- [ ] **Step 2: Harness** — `apps/api/test/harness.ts`:

```ts
import cookieParser from 'cookie-parser';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { createTestDb } from '@app/db/testing';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type * as schema from '@app/db';
import { AppModule } from '../src/app.module';
import { GlobalExceptionFilter } from '../src/common/filters/global-exception.filter';
import { ENV } from '../src/config/config.module';
import type { Env } from '../src/config/env';
import { DbService } from '../src/infra/db/db.service';

export const TEST_ENV: Env = {
  NODE_ENV: 'test',
  API_PORT: 0,
  DATABASE_URL: 'postgresql://unused:unused@localhost:5432/unused',
  REDIS_URL: undefined,
  JWT_ACCESS_SECRET: 'test-secret-0123456789abcdef-0123456789',
  WEB_URL: 'http://localhost:3000',
};

export interface TestApp {
  app: INestApplication;
  db: NodePgDatabase<typeof schema>;
  close: () => Promise<void>;
}

export async function createTestApp(): Promise<TestApp> {
  process.env.NODE_ENV = 'test';
  const testDb = await createTestDb();
  // PGlite's drizzle instance is structurally compatible with NodePgDatabase
  // for the query API we use (insert/select/update/delete/transaction).
  const db = testDb.db as unknown as NodePgDatabase<typeof schema>;

  const dbServiceStub: Pick<DbService, 'db' | 'ping'> = {
    db,
    ping: async () => undefined,
  };

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(ENV)
    .useValue(TEST_ENV)
    .overrideProvider(DbService)
    .useValue(dbServiceStub)
    .compile();

  const app = moduleRef.createNestApplication({ logger: false });
  app.use(cookieParser());
  app.useGlobalFilters(new GlobalExceptionFilter());
  app.setGlobalPrefix('api/v1', {
    exclude: ['health/liveness', 'health/readiness'],
  });
  await app.init();

  return {
    app,
    db,
    close: async () => {
      await app.close();
      await testDb.client.close();
    },
  };
}
```

- [ ] **Step 3: Smoke test** — `apps/api/test/harness.e2e-spec.ts`:

```ts
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { companies } from '@app/db';
import { createTestApp, type TestApp } from './harness';

describe('e2e harness (PGlite-backed app)', () => {
  let ctx: TestApp;

  afterEach(async () => {
    await ctx?.close();
  });

  it('boots the real AppModule and serves health', async () => {
    ctx = await createTestApp();
    const res = await request(ctx.app.getHttpServer()).get('/health/liveness');
    expect(res.status).toBe(200);
  });

  it('exposes a live PGlite-backed drizzle instance', async () => {
    ctx = await createTestApp();
    const [company] = await ctx.db
      .insert(companies)
      .values({ name: 'Acme', slug: 'acme' })
      .returning();
    expect(company!.slug).toBe('acme');
  });
});
```

- [ ] **Step 4:** Run `pnpm --filter @app/api test` → PASS (los 2 nuevos incluidos). Nota: `AppModule` instancia `LoggerModule` con `enabled:false` en test, sin ruido.

- [ ] **Step 5: Commit**

```bash
git add apps/api
git commit -m "test(api): add pglite-backed e2e harness booting the real app module"
```

---

### Task 4: Primitivas criptográficas — argon2 y tokens opacos (TDD)

**Files:**
- Modify: `package.json` raíz (`pnpm.onlyBuiltDependencies` += `"argon2"`)
- Modify: `apps/api/package.json` (deps `argon2`)
- Create: `apps/api/src/modules/auth/password.service.ts`
- Create: `apps/api/src/modules/auth/opaque-token.ts`
- Test: `apps/api/src/modules/auth/password.service.spec.ts`
- Test: `apps/api/src/modules/auth/opaque-token.spec.ts`

- [ ] **Step 1: Tests primero** — `password.service.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { PasswordService } from './password.service';

describe('PasswordService', () => {
  const service = new PasswordService();

  it('hashes and verifies a password (argon2id)', async () => {
    const hash = await service.hash('supersecret123');
    expect(hash).toMatch(/^\$argon2id\$/);
    expect(await service.verify(hash, 'supersecret123')).toBe(true);
    expect(await service.verify(hash, 'wrong-password')).toBe(false);
  });

  it('produces unique hashes per call (salted)', async () => {
    const a = await service.hash('supersecret123');
    const b = await service.hash('supersecret123');
    expect(a).not.toBe(b);
  });
});
```

`opaque-token.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { generateOpaqueToken, hashOpaqueToken } from './opaque-token';

describe('opaque tokens', () => {
  it('generates a url-safe raw token with its sha256 hash', () => {
    const { raw, hash } = generateOpaqueToken();
    expect(raw).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hashOpaqueToken(raw)).toBe(hash);
  });

  it('generates unique tokens', () => {
    expect(generateOpaqueToken().raw).not.toBe(generateOpaqueToken().raw);
  });
});
```

- [ ] **Step 2:** En `package.json` raíz, `pnpm.onlyBuiltDependencies` queda `["@electric-sql/pglite", "argon2", "esbuild"]`. Luego `pnpm --filter @app/api add argon2`. Run tests → FAIL (módulos inexistentes).

- [ ] **Step 3: Implementar** — `apps/api/src/modules/auth/password.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';

@Injectable()
export class PasswordService {
  hash(password: string): Promise<string> {
    return argon2.hash(password, { type: argon2.argon2id });
  }

  async verify(hash: string, password: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, password);
    } catch {
      return false;
    }
  }
}
```

`apps/api/src/modules/auth/opaque-token.ts`:

```ts
import { createHash, randomBytes } from 'node:crypto';

export interface OpaqueToken {
  raw: string;
  hash: string;
}

export function hashOpaqueToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

export function generateOpaqueToken(): OpaqueToken {
  const raw = randomBytes(32).toString('base64url');
  return { raw, hash: hashOpaqueToken(raw) };
}
```

- [ ] **Step 4:** Run `pnpm --filter @app/api test` → PASS. Commit:

```bash
git add package.json apps/api pnpm-lock.yaml
git commit -m "feat(api): add argon2 password service and opaque token primitives"
```

---

### Task 5: Access tokens JWT + SessionService con rotación por familia (TDD)

**Files:**
- Modify: `apps/api/package.json` (dep `@nestjs/jwt`)
- Create: `apps/api/src/modules/auth/auth.constants.ts`
- Create: `apps/api/src/modules/auth/access-token.service.ts`
- Create: `apps/api/src/modules/auth/session.service.ts`
- Create: `apps/api/src/infra/db/db.types.ts`
- Test: `apps/api/src/modules/auth/access-token.service.spec.ts`
- Test: `apps/api/src/modules/auth/session.service.spec.ts`

- [ ] **Step 1: Tipos de conexión** — `apps/api/src/infra/db/db.types.ts`:

```ts
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type * as schema from '@app/db';

export type Db = NodePgDatabase<typeof schema>;
/** Subconjunto estructural común entre la conexión y una transacción drizzle. */
export type DbConn = Pick<Db, 'insert' | 'select' | 'update' | 'delete'>;
```

y `apps/api/src/modules/auth/auth.constants.ts`:

```ts
export const ACCESS_TOKEN_TTL = '15m';
export const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const EMAIL_VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;
export const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000;
export const REFRESH_COOKIE = 'refresh_token';
```

- [ ] **Step 2: Tests que fallan** — `access-token.service.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { Env } from '../../config/env';
import { AccessTokenService } from './access-token.service';

const env = {
  JWT_ACCESS_SECRET: 'test-secret-0123456789abcdef-0123456789',
} as Env;

describe('AccessTokenService', () => {
  const service = new AccessTokenService(env);

  it('signs and verifies the payload round-trip', () => {
    const token = service.sign({
      sub: 'user-1',
      companyId: 'company-1',
      role: 'company_admin',
      isSuperAdmin: false,
    });
    const payload = service.verify(token);
    expect(payload).toMatchObject({
      sub: 'user-1',
      companyId: 'company-1',
      role: 'company_admin',
      isSuperAdmin: false,
    });
  });

  it('returns null for garbage tokens', () => {
    expect(service.verify('garbage.token.here')).toBeNull();
  });

  it('rejects tokens signed with another secret', () => {
    const other = new AccessTokenService({
      JWT_ACCESS_SECRET: 'another-secret-0123456789abcdef-01234',
    } as Env);
    const token = other.sign({
      sub: 'user-1',
      companyId: 'company-1',
      role: 'agent',
      isSuperAdmin: false,
    });
    expect(service.verify(token)).toBeNull();
  });
});
```

`session.service.spec.ts` (integración PGlite, sin app Nest):

```ts
import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from '@app/db/testing';
import { sessions, users } from '@app/db';
import { eq } from 'drizzle-orm';
import { AppException } from '../../common/filters/global-exception.filter';
import type { DbService } from '../../infra/db/db.service';
import type { Db } from '../../infra/db/db.types';
import { SessionService } from './session.service';

describe('SessionService', () => {
  let testDb: TestDb;
  let service: SessionService;
  let userId: string;

  beforeEach(async () => {
    testDb = await createTestDb();
    const db = testDb.db as unknown as Db;
    service = new SessionService({ db } as DbService);
    const [user] = await db
      .insert(users)
      .values({ email: 'ana@acme.cl', passwordHash: 'x', name: 'Ana' })
      .returning();
    userId = user!.id;
  });

  afterEach(async () => {
    if (testDb) {
      await testDb.client.close();
    }
  });

  it('creates a session and rotates it issuing a new token', async () => {
    const { raw } = await service.create(userId);
    const rotated = await service.rotate(raw);
    expect(rotated.raw).not.toBe(raw);
    expect(rotated.userId).toBe(userId);
  });

  it('detects reuse of a rotated token and revokes the whole family', async () => {
    const { raw } = await service.create(userId);
    const rotated = await service.rotate(raw);

    await expect(service.rotate(raw)).rejects.toMatchObject({ code: 'refresh_reused' });
    // la familia completa quedó revocada: el token vigente también muere
    await expect(service.rotate(rotated.raw)).rejects.toBeInstanceOf(AppException);
  });

  it('rejects expired refresh tokens', async () => {
    const { raw } = await service.create(userId);
    const db = testDb.db as unknown as Db;
    await db
      .update(sessions)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(sessions.userId, userId));
    await expect(service.rotate(raw)).rejects.toMatchObject({ code: 'refresh_expired' });
  });

  it('rejects unknown tokens', async () => {
    await expect(service.rotate('A'.repeat(43))).rejects.toMatchObject({
      code: 'invalid_refresh_token',
    });
  });

  it('revokeAllForUser kills every active session', async () => {
    const a = await service.create(userId);
    const b = await service.create(userId);
    await service.revokeAllForUser(userId);
    await expect(service.rotate(a.raw)).rejects.toBeInstanceOf(AppException);
    await expect(service.rotate(b.raw)).rejects.toBeInstanceOf(AppException);
  });
});
```

Run → FAIL (módulos inexistentes). `pnpm --filter @app/api add @nestjs/jwt`.

- [ ] **Step 3: Implementar** — `access-token.service.ts`:

```ts
import { Inject, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { CompanyRole } from '@app/shared';
import { ENV } from '../../config/config.module';
import type { Env } from '../../config/env';
import { ACCESS_TOKEN_TTL } from './auth.constants';

export interface AccessTokenPayload {
  sub: string;
  companyId: string;
  role: CompanyRole;
  isSuperAdmin: boolean;
}

@Injectable()
export class AccessTokenService {
  private readonly jwt: JwtService;

  constructor(@Inject(ENV) env: Env) {
    this.jwt = new JwtService({
      secret: env.JWT_ACCESS_SECRET,
      signOptions: { expiresIn: ACCESS_TOKEN_TTL },
    });
  }

  sign(payload: AccessTokenPayload): string {
    return this.jwt.sign({ ...payload });
  }

  verify(token: string): AccessTokenPayload | null {
    try {
      return this.jwt.verify<AccessTokenPayload>(token);
    } catch {
      return null;
    }
  }
}
```

`session.service.ts`:

```ts
import { HttpStatus, Injectable } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { sessions } from '@app/db';
import { AppException } from '../../common/filters/global-exception.filter';
import { DbService } from '../../infra/db/db.service';
import type { DbConn } from '../../infra/db/db.types';
import { REFRESH_TTL_MS } from './auth.constants';
import { generateOpaqueToken, hashOpaqueToken } from './opaque-token';

export interface SessionMeta {
  ip?: string;
  userAgent?: string;
}

@Injectable()
export class SessionService {
  constructor(private readonly dbService: DbService) {}

  private get db() {
    return this.dbService.db;
  }

  async create(userId: string, meta: SessionMeta = {}): Promise<{ raw: string }> {
    const { raw, hash } = generateOpaqueToken();
    await this.db.insert(sessions).values({
      userId,
      familyId: randomUUID(),
      refreshTokenHash: hash,
      expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
    return { raw };
  }

  /** Rota un refresh token. El reuso de un token ya rotado revoca la familia completa. */
  async rotate(rawToken: string, meta: SessionMeta = {}): Promise<{ raw: string; userId: string }> {
    const hash = hashOpaqueToken(rawToken);
    const [session] = await this.db
      .select()
      .from(sessions)
      .where(eq(sessions.refreshTokenHash, hash));

    if (!session) {
      throw new AppException(
        'invalid_refresh_token',
        'Invalid refresh token',
        HttpStatus.UNAUTHORIZED,
      );
    }
    if (session.revokedAt) {
      await this.revokeFamily(session.familyId);
      throw new AppException(
        'refresh_reused',
        'Refresh token reuse detected',
        HttpStatus.UNAUTHORIZED,
      );
    }
    if (session.expiresAt.getTime() <= Date.now()) {
      throw new AppException('refresh_expired', 'Refresh token expired', HttpStatus.UNAUTHORIZED);
    }

    const next = generateOpaqueToken();
    await this.db.transaction(async (tx) => {
      await tx.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.id, session.id));
      await tx.insert(sessions).values({
        userId: session.userId,
        familyId: session.familyId,
        refreshTokenHash: next.hash,
        expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
    });
    return { raw: next.raw, userId: session.userId };
  }

  async revokeByRawToken(rawToken: string): Promise<void> {
    const hash = hashOpaqueToken(rawToken);
    await this.db
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(and(eq(sessions.refreshTokenHash, hash), isNull(sessions.revokedAt)));
  }

  async revokeFamily(familyId: string): Promise<void> {
    await this.db
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(and(eq(sessions.familyId, familyId), isNull(sessions.revokedAt)));
  }

  async revokeAllForUser(userId: string, conn?: DbConn): Promise<void> {
    await (conn ?? this.db)
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)));
  }
}
```

- [ ] **Step 4:** `pnpm --filter @app/api test` → PASS (8 tests nuevos). `typecheck` limpio. Commit:

```bash
git add apps/api pnpm-lock.yaml
git commit -m "feat(api): add jwt access tokens and session rotation with family revocation"
```

---

### Task 6: Auth core — register/login/refresh/logout (e2e TDD)

**Files:**
- Create: `apps/api/src/modules/audit/audit.service.ts` + `audit.module.ts`
- Create: `apps/api/src/modules/outbox/outbox.service.ts` + `outbox.module.ts`
- Create: `apps/api/src/common/utils/slug.ts` (+ test unitario)
- Create: `apps/api/src/modules/auth/auth.service.ts`
- Create: `apps/api/src/modules/auth/auth.controller.ts`
- Create: `apps/api/src/modules/auth/auth.module.ts`
- Modify: `apps/api/src/app.module.ts` (importa AuthModule)
- Test: `apps/api/src/common/utils/slug.spec.ts`
- Test: `apps/api/test/auth.e2e-spec.ts`

- [ ] **Step 1: slug TDD** — `slug.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { slugify } from './slug';

describe('slugify', () => {
  it('lowercases, strips accents and replaces separators', () => {
    expect(slugify('Compañía Ñandú S.A.')).toBe('compania-nandu-s-a');
  });
  it('falls back when nothing survives', () => {
    expect(slugify('!!!')).toBe('company');
  });
});
```

Run → FAIL. Implementar `slug.ts`:

```ts
export function slugify(input: string): string {
  const slug = input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return slug || 'company';
}
```

Run → PASS.

- [ ] **Step 2: Servicios de soporte** — `audit.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { auditLogs } from '@app/db';
import { DbService } from '../../infra/db/db.service';
import type { DbConn } from '../../infra/db/db.types';

export interface AuditEntry {
  companyId?: string | null;
  actorUserId: string;
  action: string;
  entityType?: string;
  entityId?: string;
  metadata?: unknown;
  ip?: string;
}

@Injectable()
export class AuditService {
  constructor(private readonly dbService: DbService) {}

  async record(entry: AuditEntry, conn?: DbConn): Promise<void> {
    await (conn ?? this.dbService.db).insert(auditLogs).values({
      companyId: entry.companyId ?? null,
      actorUserId: entry.actorUserId,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      metadata: entry.metadata ?? null,
      ip: entry.ip,
    });
  }
}
```

`audit.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { AuditService } from './audit.service';

@Module({
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
```

`outbox.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { outboxEvents } from '@app/db';
import { DbService } from '../../infra/db/db.service';
import type { DbConn } from '../../infra/db/db.types';

@Injectable()
export class OutboxService {
  constructor(private readonly dbService: DbService) {}

  /**
   * Inserta un evento de dominio (patrón outbox). El publisher (F3) lo lleva a
   * BullMQ y DEBE redactar payloads que contengan tokens raw tras publicar.
   */
  async emit(
    eventType: string,
    payload: unknown,
    companyId?: string | null,
    conn?: DbConn,
  ): Promise<void> {
    await (conn ?? this.dbService.db).insert(outboxEvents).values({
      eventType,
      payload,
      companyId: companyId ?? null,
    });
  }
}
```

`outbox.module.ts` análogo a AuditModule (provee y exporta OutboxService).

- [ ] **Step 3: e2e que falla** — `apps/api/test/auth.e2e-spec.ts`:

```ts
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { auditLogs, authTokens, companies, memberships, outboxEvents, users } from '@app/db';
import { createTestApp, type TestApp } from './harness';

const REGISTER = {
  companyName: 'Acme',
  name: 'Ana',
  email: 'ana@acme.cl',
  password: 'supersecret123',
};

function refreshCookie(res: { headers: Record<string, unknown> }): string {
  const cookies = res.headers['set-cookie'] as string[] | undefined;
  const cookie = cookies?.find((c) => c.startsWith('refresh_token='));
  expect(cookie, 'expected refresh_token cookie').toBeDefined();
  return cookie!.split(';')[0]!;
}

describe('auth core (e2e)', () => {
  let ctx: TestApp;

  beforeEach(async () => {
    ctx = await createTestApp();
  });

  afterEach(async () => {
    await ctx?.close();
  });

  it('registers a company with its admin and side effects', async () => {
    const res = await request(ctx.app.getHttpServer())
      .post('/api/v1/auth/register')
      .send(REGISTER);
    expect(res.status).toBe(201);
    expect(res.body.userId).toBeDefined();
    expect(res.body.companyId).toBeDefined();

    const [company] = await ctx.db.select().from(companies);
    expect(company!.slug).toBe('acme');
    const [membership] = await ctx.db.select().from(memberships);
    expect(membership!.role).toBe('company_admin');
    const [token] = await ctx.db.select().from(authTokens);
    expect(token!.type).toBe('email_verification');
    const [event] = await ctx.db.select().from(outboxEvents);
    expect(event!.eventType).toBe('auth.email_verification_requested');
    const payload = event!.payload as { token: string };
    expect(payload.token).not.toBe(token!.tokenHash); // raw en outbox, hash en db
  });

  it('rejects duplicate emails with 409 and disambiguates company slugs', async () => {
    await request(ctx.app.getHttpServer()).post('/api/v1/auth/register').send(REGISTER);
    const dup = await request(ctx.app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ ...REGISTER, companyName: 'Acme' });
    expect(dup.status).toBe(409);
    expect(dup.body.code).toBe('email_taken');

    const other = await request(ctx.app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ ...REGISTER, email: 'otro@acme.cl' });
    expect(other.status).toBe(201);
    const rows = await ctx.db.select().from(companies);
    expect(rows.map((c) => c.slug).sort()).toEqual(['acme', 'acme-2']);
  });

  it('rejects invalid payloads with validation_error', async () => {
    const res = await request(ctx.app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ ...REGISTER, email: 'not-an-email' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('validation_error');
  });

  it('logs in returning access token, refresh cookie and audit trail', async () => {
    await request(ctx.app.getHttpServer()).post('/api/v1/auth/register').send(REGISTER);
    const res = await request(ctx.app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'ANA@acme.cl ', password: REGISTER.password });
    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBeDefined();
    expect(res.body.refreshToken).toBeUndefined();
    expect(res.body.role).toBe('company_admin');
    const cookie = refreshCookie(res);
    expect(cookie.length).toBeGreaterThan('refresh_token='.length);

    const [audit] = await ctx.db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, 'auth.login'));
    expect(audit).toBeDefined();
  });

  it('rejects bad credentials uniformly', async () => {
    await request(ctx.app.getHttpServer()).post('/api/v1/auth/register').send(REGISTER);
    const badPw = await request(ctx.app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: REGISTER.email, password: 'wrong-password-1' });
    const noUser = await request(ctx.app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'ghost@acme.cl', password: 'whatever-12345' });
    expect(badPw.status).toBe(401);
    expect(noUser.status).toBe(401);
    expect(badPw.body.code).toBe('invalid_credentials');
    expect(noUser.body.code).toBe('invalid_credentials');
  });

  it('blocks login for suspended companies', async () => {
    await request(ctx.app.getHttpServer()).post('/api/v1/auth/register').send(REGISTER);
    await ctx.db.update(companies).set({ status: 'suspended' });
    const res = await request(ctx.app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: REGISTER.email, password: REGISTER.password });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('company_suspended');
  });

  it('rotates the refresh cookie and detects reuse (family revocation)', async () => {
    const server = ctx.app.getHttpServer();
    await request(server).post('/api/v1/auth/register').send(REGISTER);
    const login = await request(server)
      .post('/api/v1/auth/login')
      .send({ email: REGISTER.email, password: REGISTER.password });
    const first = refreshCookie(login);

    const refreshed = await request(server).post('/api/v1/auth/refresh').set('Cookie', first);
    expect(refreshed.status).toBe(200);
    const second = refreshCookie(refreshed);
    expect(second).not.toBe(first);

    const reuse = await request(server).post('/api/v1/auth/refresh').set('Cookie', first);
    expect(reuse.status).toBe(401);
    expect(reuse.body.code).toBe('refresh_reused');

    const afterReuse = await request(server).post('/api/v1/auth/refresh').set('Cookie', second);
    expect(afterReuse.status).toBe(401);
  });

  it('refresh without cookie is 401', async () => {
    const res = await request(ctx.app.getHttpServer()).post('/api/v1/auth/refresh');
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('missing_refresh_token');
  });

  it('logout revokes the session and clears the cookie', async () => {
    const server = ctx.app.getHttpServer();
    await request(server).post('/api/v1/auth/register').send(REGISTER);
    const login = await request(server)
      .post('/api/v1/auth/login')
      .send({ email: REGISTER.email, password: REGISTER.password });
    const cookie = refreshCookie(login);

    const out = await request(server).post('/api/v1/auth/logout').set('Cookie', cookie);
    expect(out.status).toBe(204);

    const res = await request(server).post('/api/v1/auth/refresh').set('Cookie', cookie);
    expect(res.status).toBe(401);
  });
});
```

Run → FAIL (rutas inexistentes, 404).

- [ ] **Step 4: Implementar AuthService** — `apps/api/src/modules/auth/auth.service.ts`:

```ts
import { HttpStatus, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { authTokens, companies, memberships, users } from '@app/db';
import type { LoginInput, RegisterInput } from '@app/shared';
import type { CompanyRole } from '@app/shared';
import { AppException } from '../../common/filters/global-exception.filter';
import { slugify } from '../../common/utils/slug';
import { DbService } from '../../infra/db/db.service';
import type { DbConn } from '../../infra/db/db.types';
import { AuditService } from '../audit/audit.service';
import { OutboxService } from '../outbox/outbox.service';
import { AccessTokenService } from './access-token.service';
import { EMAIL_VERIFICATION_TTL_MS } from './auth.constants';
import { generateOpaqueToken } from './opaque-token';
import { PasswordService } from './password.service';
import { SessionService, type SessionMeta } from './session.service';

interface CompanyContext {
  companyId: string;
  role: CompanyRole;
  company: { id: string; name: string; slug: string };
}

export interface LoginResult {
  accessToken: string;
  refreshToken: string;
  user: { id: string; name: string; email: string };
  company: CompanyContext['company'];
  role: CompanyRole;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly dbService: DbService,
    private readonly passwords: PasswordService,
    private readonly accessTokens: AccessTokenService,
    private readonly sessions: SessionService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  private get db() {
    return this.dbService.db;
  }

  async register(input: RegisterInput): Promise<{ userId: string; companyId: string }> {
    const passwordHash = await this.passwords.hash(input.password);
    const verification = generateOpaqueToken();

    return this.db.transaction(async (tx) => {
      const [existing] = await tx
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, input.email));
      if (existing) {
        throw new AppException('email_taken', 'Email is already registered', HttpStatus.CONFLICT);
      }

      const slug = await this.uniqueSlug(tx, slugify(input.companyName));
      const [company] = await tx
        .insert(companies)
        .values({ name: input.companyName, slug })
        .returning();
      const [user] = await tx
        .insert(users)
        .values({ email: input.email, passwordHash, name: input.name })
        .returning();
      await tx.insert(memberships).values({
        userId: user!.id,
        companyId: company!.id,
        role: 'company_admin',
      });
      await tx.insert(authTokens).values({
        userId: user!.id,
        type: 'email_verification',
        tokenHash: verification.hash,
        expiresAt: new Date(Date.now() + EMAIL_VERIFICATION_TTL_MS),
      });
      await this.outbox.emit(
        'auth.email_verification_requested',
        { userId: user!.id, email: user!.email, token: verification.raw },
        company!.id,
        tx,
      );
      return { userId: user!.id, companyId: company!.id };
    });
  }

  private async uniqueSlug(conn: DbConn, base: string): Promise<string> {
    let candidate = base;
    for (let i = 2; ; i += 1) {
      const [row] = await conn
        .select({ id: companies.id })
        .from(companies)
        .where(eq(companies.slug, candidate));
      if (!row) {
        return candidate;
      }
      candidate = `${base}-${i}`;
    }
  }

  async login(input: LoginInput, meta: SessionMeta): Promise<LoginResult> {
    const [user] = await this.db.select().from(users).where(eq(users.email, input.email));
    if (!user || !(await this.passwords.verify(user.passwordHash, input.password))) {
      throw new AppException(
        'invalid_credentials',
        'Invalid email or password',
        HttpStatus.UNAUTHORIZED,
      );
    }
    if (user.status !== 'active') {
      throw new AppException('user_disabled', 'User is disabled', HttpStatus.FORBIDDEN);
    }
    const ctx = await this.resolveCompanyContext(user.id);
    const accessToken = this.accessTokens.sign({
      sub: user.id,
      companyId: ctx.companyId,
      role: ctx.role,
      isSuperAdmin: user.isSuperAdmin,
    });
    const { raw: refreshToken } = await this.sessions.create(user.id, meta);
    await this.audit.record({
      companyId: ctx.companyId,
      actorUserId: user.id,
      action: 'auth.login',
      ip: meta.ip,
    });
    return {
      accessToken,
      refreshToken,
      user: { id: user.id, name: user.name, email: user.email },
      company: ctx.company,
      role: ctx.role,
    };
  }

  async refresh(rawToken: string, meta: SessionMeta): Promise<LoginResult> {
    const rotated = await this.sessions.rotate(rawToken, meta);
    const [user] = await this.db.select().from(users).where(eq(users.id, rotated.userId));
    if (!user || user.status !== 'active') {
      throw new AppException('user_disabled', 'User is disabled', HttpStatus.FORBIDDEN);
    }
    const ctx = await this.resolveCompanyContext(user.id);
    const accessToken = this.accessTokens.sign({
      sub: user.id,
      companyId: ctx.companyId,
      role: ctx.role,
      isSuperAdmin: user.isSuperAdmin,
    });
    return {
      accessToken,
      refreshToken: rotated.raw,
      user: { id: user.id, name: user.name, email: user.email },
      company: ctx.company,
      role: ctx.role,
    };
  }

  async logout(rawToken: string | undefined): Promise<void> {
    if (rawToken) {
      await this.sessions.revokeByRawToken(rawToken);
    }
  }

  private async resolveCompanyContext(userId: string): Promise<CompanyContext> {
    const rows = await this.db
      .select({ membership: memberships, company: companies })
      .from(memberships)
      .innerJoin(companies, eq(memberships.companyId, companies.id))
      .where(and(eq(memberships.userId, userId), eq(memberships.status, 'active')));
    const first = rows[0];
    if (!first) {
      throw new AppException(
        'no_membership',
        'User has no active company membership',
        HttpStatus.FORBIDDEN,
      );
    }
    if (first.company.status !== 'active') {
      throw new AppException('company_suspended', 'Company is suspended', HttpStatus.FORBIDDEN);
    }
    return {
      companyId: first.company.id,
      role: first.membership.role,
      company: { id: first.company.id, name: first.company.name, slug: first.company.slug },
    };
  }
}
```

- [ ] **Step 5: Controller y módulo** — `auth.controller.ts`:

```ts
import { Body, Controller, HttpCode, HttpStatus, Inject, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import {
  loginSchema,
  registerSchema,
  type LoginInput,
  type RegisterInput,
} from '@app/shared';
import { AppException } from '../../common/filters/global-exception.filter';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { ENV } from '../../config/config.module';
import type { Env } from '../../config/env';
import { REFRESH_COOKIE, REFRESH_TTL_MS } from './auth.constants';
import { AuthService, type LoginResult } from './auth.service';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  private cookieOptions() {
    return {
      httpOnly: true,
      sameSite: 'lax' as const,
      secure: this.env.NODE_ENV === 'production',
      path: '/api/v1/auth',
      maxAge: REFRESH_TTL_MS,
    };
  }

  private sendSession(res: Response, result: LoginResult) {
    res.cookie(REFRESH_COOKIE, result.refreshToken, this.cookieOptions());
    const { refreshToken: _refreshToken, ...payload } = result;
    return payload;
  }

  private readCookie(req: Request): string | undefined {
    return (req.cookies as Record<string, string> | undefined)?.[REFRESH_COOKIE];
  }

  @Post('register')
  register(@Body(new ZodValidationPipe(registerSchema)) body: RegisterInput) {
    return this.auth.register(body);
  }

  @Post('login')
  @HttpCode(200)
  async login(
    @Body(new ZodValidationPipe(loginSchema)) body: LoginInput,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.auth.login(body, {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return this.sendSession(res, result);
  }

  @Post('refresh')
  @HttpCode(200)
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const raw = this.readCookie(req);
    if (!raw) {
      throw new AppException(
        'missing_refresh_token',
        'Missing refresh token cookie',
        HttpStatus.UNAUTHORIZED,
      );
    }
    const result = await this.auth.refresh(raw, {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return this.sendSession(res, result);
  }

  @Post('logout')
  @HttpCode(204)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(this.readCookie(req));
    res.clearCookie(REFRESH_COOKIE, { path: '/api/v1/auth' });
  }
}
```

`auth.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { OutboxModule } from '../outbox/outbox.module';
import { AccessTokenService } from './access-token.service';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { PasswordService } from './password.service';
import { SessionService } from './session.service';

@Module({
  imports: [AuditModule, OutboxModule],
  controllers: [AuthController],
  providers: [AuthService, PasswordService, AccessTokenService, SessionService],
  exports: [AccessTokenService, SessionService, PasswordService],
})
export class AuthModule {}
```

En `app.module.ts` agregar `AuthModule` a los imports.

- [ ] **Step 6:** `pnpm --filter @app/api test` → PASS (toda la suite, incluidos los 9 e2e nuevos). `typecheck` + `build` limpios. Commit:

```bash
git add apps/api
git commit -m "feat(api): add registration, login, refresh rotation and logout endpoints"
```

---

### Task 7: Verificación de email + forgot/reset password (e2e TDD)

**Files:**
- Modify: `apps/api/src/modules/auth/auth.service.ts` (3 métodos nuevos)
- Modify: `apps/api/src/modules/auth/auth.controller.ts` (3 endpoints nuevos)
- Test: `apps/api/test/auth-flows.e2e-spec.ts`

- [ ] **Step 1: e2e que falla** — `apps/api/test/auth-flows.e2e-spec.ts`:

```ts
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { desc, eq } from 'drizzle-orm';
import { authTokens, outboxEvents, users } from '@app/db';
import { createTestApp, type TestApp } from './harness';

const REGISTER = {
  companyName: 'Acme',
  name: 'Ana',
  email: 'ana@acme.cl',
  password: 'supersecret123',
};

async function latestOutboxToken(ctx: TestApp, eventType: string): Promise<string> {
  const [event] = await ctx.db
    .select()
    .from(outboxEvents)
    .where(eq(outboxEvents.eventType, eventType))
    .orderBy(desc(outboxEvents.createdAt));
  expect(event, `expected outbox event ${eventType}`).toBeDefined();
  return (event!.payload as { token: string }).token;
}

describe('auth token flows (e2e)', () => {
  let ctx: TestApp;

  beforeEach(async () => {
    ctx = await createTestApp();
    await request(ctx.app.getHttpServer()).post('/api/v1/auth/register').send(REGISTER);
  });

  afterEach(async () => {
    await ctx?.close();
  });

  it('verifies the email with the registration token, single use', async () => {
    const server = ctx.app.getHttpServer();
    const token = await latestOutboxToken(ctx, 'auth.email_verification_requested');

    const ok = await request(server).post('/api/v1/auth/verify-email').send({ token });
    expect(ok.status).toBe(200);

    const [user] = await ctx.db.select().from(users);
    expect(user!.emailVerifiedAt).not.toBeNull();

    const replay = await request(server).post('/api/v1/auth/verify-email').send({ token });
    expect(replay.status).toBe(400);
    expect(replay.body.code).toBe('invalid_token');
  });

  it('forgot-password always answers 200 and only creates tokens for real users', async () => {
    const server = ctx.app.getHttpServer();
    const ghost = await request(server)
      .post('/api/v1/auth/forgot-password')
      .send({ email: 'ghost@acme.cl' });
    expect(ghost.status).toBe(200);

    const real = await request(server)
      .post('/api/v1/auth/forgot-password')
      .send({ email: REGISTER.email });
    expect(real.status).toBe(200);

    const tokens = await ctx.db
      .select()
      .from(authTokens)
      .where(eq(authTokens.type, 'password_reset'));
    expect(tokens).toHaveLength(1);
  });

  it('resets the password, revokes sessions and consumes the token', async () => {
    const server = ctx.app.getHttpServer();
    const login = await request(server)
      .post('/api/v1/auth/login')
      .send({ email: REGISTER.email, password: REGISTER.password });
    const cookies = login.headers['set-cookie'] as unknown as string[];
    const cookie = cookies.find((c) => c.startsWith('refresh_token='))!.split(';')[0]!;

    await request(server).post('/api/v1/auth/forgot-password').send({ email: REGISTER.email });
    const token = await latestOutboxToken(ctx, 'auth.password_reset_requested');

    const reset = await request(server)
      .post('/api/v1/auth/reset-password')
      .send({ token, password: 'brand-new-secret-1' });
    expect(reset.status).toBe(200);

    const oldPw = await request(server)
      .post('/api/v1/auth/login')
      .send({ email: REGISTER.email, password: REGISTER.password });
    expect(oldPw.status).toBe(401);

    const newPw = await request(server)
      .post('/api/v1/auth/login')
      .send({ email: REGISTER.email, password: 'brand-new-secret-1' });
    expect(newPw.status).toBe(200);

    const refreshAfterReset = await request(server)
      .post('/api/v1/auth/refresh')
      .set('Cookie', cookie);
    expect(refreshAfterReset.status).toBe(401);

    const replay = await request(server)
      .post('/api/v1/auth/reset-password')
      .send({ token, password: 'another-secret-12' });
    expect(replay.status).toBe(400);
  });

  it('rejects expired tokens', async () => {
    const server = ctx.app.getHttpServer();
    await request(server).post('/api/v1/auth/forgot-password').send({ email: REGISTER.email });
    await ctx.db
      .update(authTokens)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(authTokens.type, 'password_reset'));
    const token = await latestOutboxToken(ctx, 'auth.password_reset_requested');
    const res = await request(server)
      .post('/api/v1/auth/reset-password')
      .send({ token, password: 'brand-new-secret-1' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('invalid_token');
  });
});
```

Run → FAIL (404 en los endpoints nuevos).

- [ ] **Step 2: AuthService — métodos nuevos** (agregar a la clase; imports adicionales: `hashOpaqueToken` desde `./opaque-token`, `PASSWORD_RESET_TTL_MS` desde `./auth.constants`):

```ts
  async verifyEmail(rawToken: string): Promise<void> {
    const hash = hashOpaqueToken(rawToken);
    await this.db.transaction(async (tx) => {
      const [token] = await tx.select().from(authTokens).where(eq(authTokens.tokenHash, hash));
      if (
        !token ||
        token.type !== 'email_verification' ||
        token.consumedAt ||
        token.expiresAt.getTime() <= Date.now()
      ) {
        throw new AppException(
          'invalid_token',
          'Token is invalid or expired',
          HttpStatus.BAD_REQUEST,
        );
      }
      await tx.update(authTokens).set({ consumedAt: new Date() }).where(eq(authTokens.id, token.id));
      await tx
        .update(users)
        .set({ emailVerifiedAt: new Date() })
        .where(eq(users.id, token.userId));
    });
  }

  async forgotPassword(email: string): Promise<void> {
    const [user] = await this.db.select().from(users).where(eq(users.email, email));
    if (!user) {
      return; // 200 siempre: no filtra existencia
    }
    const token = generateOpaqueToken();
    await this.db.transaction(async (tx) => {
      await tx.insert(authTokens).values({
        userId: user.id,
        type: 'password_reset',
        tokenHash: token.hash,
        expiresAt: new Date(Date.now() + PASSWORD_RESET_TTL_MS),
      });
      await this.outbox.emit(
        'auth.password_reset_requested',
        { userId: user.id, email: user.email, token: token.raw },
        null,
        tx,
      );
    });
  }

  async resetPassword(rawToken: string, password: string): Promise<void> {
    const hash = hashOpaqueToken(rawToken);
    const passwordHash = await this.passwords.hash(password);
    await this.db.transaction(async (tx) => {
      const [token] = await tx.select().from(authTokens).where(eq(authTokens.tokenHash, hash));
      if (
        !token ||
        token.type !== 'password_reset' ||
        token.consumedAt ||
        token.expiresAt.getTime() <= Date.now()
      ) {
        throw new AppException(
          'invalid_token',
          'Token is invalid or expired',
          HttpStatus.BAD_REQUEST,
        );
      }
      await tx.update(authTokens).set({ consumedAt: new Date() }).where(eq(authTokens.id, token.id));
      await tx.update(users).set({ passwordHash }).where(eq(users.id, token.userId));
      await this.sessions.revokeAllForUser(token.userId, tx);
    });
  }
```

- [ ] **Step 3: Controller — endpoints nuevos** (agregar a `AuthController`; imports de `verifyEmailSchema`, `forgotPasswordSchema`, `resetPasswordSchema` y sus tipos desde `@app/shared`):

```ts
  @Post('verify-email')
  @HttpCode(200)
  async verifyEmail(@Body(new ZodValidationPipe(verifyEmailSchema)) body: VerifyEmailInput) {
    await this.auth.verifyEmail(body.token);
    return { status: 'ok' };
  }

  @Post('forgot-password')
  @HttpCode(200)
  async forgotPassword(
    @Body(new ZodValidationPipe(forgotPasswordSchema)) body: ForgotPasswordInput,
  ) {
    await this.auth.forgotPassword(body.email);
    return { status: 'ok' };
  }

  @Post('reset-password')
  @HttpCode(200)
  async resetPassword(@Body(new ZodValidationPipe(resetPasswordSchema)) body: ResetPasswordInput) {
    await this.auth.resetPassword(body.token, body.password);
    return { status: 'ok' };
  }
```

- [ ] **Step 4:** `pnpm --filter @app/api test` → PASS. Commit:

```bash
git add apps/api
git commit -m "feat(api): add email verification and password reset flows"
```

---

### Task 8: Contexto CLS + guards + `/me` y `/company` (e2e TDD con aislamiento multi-tenant)

**Files:**
- Modify: `apps/api/package.json` (dep `nestjs-cls`)
- Modify: `apps/api/src/app.module.ts` (ClsModule global + nuevos módulos)
- Create: `apps/api/src/common/context/request-context.service.ts` + `context.module.ts`
- Create: `apps/api/src/common/guards/jwt-auth.guard.ts`
- Create: `apps/api/src/common/guards/company-context.guard.ts`
- Create: `apps/api/src/common/guards/permissions.guard.ts` (+ decorador)
- Create: `apps/api/src/infra/db/tenant-db.service.ts` (+ provider en DbModule)
- Create: `apps/api/src/modules/me/me.controller.ts` + `me.service.ts` + `me.module.ts`
- Create: `apps/api/src/modules/company/company.controller.ts` + `company.service.ts` + `company.module.ts`
- Test: `apps/api/test/tenancy.e2e-spec.ts`

- [ ] **Step 1:** `pnpm --filter @app/api add nestjs-cls`. En `app.module.ts` agregar a imports:

```ts
    ClsModule.forRoot({ global: true, middleware: { mount: true } }),
```
(import `{ ClsModule } from 'nestjs-cls'`), más `MeModule` y `CompanyModule` cuando existan (Step 5).

- [ ] **Step 2: e2e que falla** — `apps/api/test/tenancy.e2e-spec.ts`:

```ts
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { auditLogs, companies, memberships, users } from '@app/db';
import { PasswordService } from '../src/modules/auth/password.service';
import { createTestApp, type TestApp } from './harness';

async function registerAndLogin(
  ctx: TestApp,
  companyName: string,
  email: string,
): Promise<string> {
  const server = ctx.app.getHttpServer();
  await request(server)
    .post('/api/v1/auth/register')
    .send({ companyName, name: 'Admin', email, password: 'supersecret123' });
  const login = await request(server)
    .post('/api/v1/auth/login')
    .send({ email, password: 'supersecret123' });
  expect(login.status).toBe(200);
  return login.body.accessToken as string;
}

describe('tenancy, guards and profile (e2e)', () => {
  let ctx: TestApp;

  beforeEach(async () => {
    ctx = await createTestApp();
  });

  afterEach(async () => {
    await ctx?.close();
  });

  it('GET /company returns only the caller company (isolation)', async () => {
    const tokenA = await registerAndLogin(ctx, 'Empresa A', 'a@a.cl');
    await registerAndLogin(ctx, 'Empresa B', 'b@b.cl');

    const res = await request(ctx.app.getHttpServer())
      .get('/api/v1/company')
      .set('Authorization', `Bearer ${tokenA}`);
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Empresa A');
  });

  it('PATCH /company updates only the caller company and writes audit', async () => {
    const tokenA = await registerAndLogin(ctx, 'Empresa A', 'a@a.cl');
    await registerAndLogin(ctx, 'Empresa B', 'b@b.cl');

    const res = await request(ctx.app.getHttpServer())
      .patch('/api/v1/company')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ name: 'Empresa A Renovada' });
    expect(res.status).toBe(200);

    const rows = await ctx.db.select().from(companies);
    const names = rows.map((c) => c.name).sort();
    expect(names).toEqual(['Empresa A Renovada', 'Empresa B']);

    const [audit] = await ctx.db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, 'company.updated'));
    expect(audit).toBeDefined();
  });

  it('agent role gets 403 forbidden on PATCH /company', async () => {
    await registerAndLogin(ctx, 'Empresa A', 'a@a.cl');
    const [company] = await ctx.db.select().from(companies);
    const passwordHash = await new PasswordService().hash('supersecret123');
    const [agentUser] = await ctx.db
      .insert(users)
      .values({ email: 'agente@a.cl', passwordHash, name: 'Agente' })
      .returning();
    await ctx.db.insert(memberships).values({
      userId: agentUser!.id,
      companyId: company!.id,
      role: 'agent',
    });

    const login = await request(ctx.app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'agente@a.cl', password: 'supersecret123' });
    expect(login.status).toBe(200);
    expect(login.body.role).toBe('agent');

    const res = await request(ctx.app.getHttpServer())
      .patch('/api/v1/company')
      .set('Authorization', `Bearer ${login.body.accessToken}`)
      .send({ name: 'Hackeada' });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('forbidden');

    const get = await request(ctx.app.getHttpServer())
      .get('/api/v1/company')
      .set('Authorization', `Bearer ${login.body.accessToken}`);
    expect(get.status).toBe(200);
  });

  it('requests without or with garbage bearer are 401', async () => {
    const server = ctx.app.getHttpServer();
    expect((await request(server).get('/api/v1/me')).status).toBe(401);
    expect(
      (await request(server).get('/api/v1/company').set('Authorization', 'Bearer garbage')).status,
    ).toBe(401);
  });

  it('suspending a company invalidates existing access tokens for /company', async () => {
    const token = await registerAndLogin(ctx, 'Empresa A', 'a@a.cl');
    await ctx.db.update(companies).set({ status: 'suspended' });
    const res = await request(ctx.app.getHttpServer())
      .get('/api/v1/company')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('company_suspended');
  });

  it('GET /me returns profile with memberships; PATCH /me updates the name', async () => {
    const token = await registerAndLogin(ctx, 'Empresa A', 'a@a.cl');
    const me = await request(ctx.app.getHttpServer())
      .get('/api/v1/me')
      .set('Authorization', `Bearer ${token}`);
    expect(me.status).toBe(200);
    expect(me.body.email).toBe('a@a.cl');
    expect(me.body.memberships).toHaveLength(1);

    const patch = await request(ctx.app.getHttpServer())
      .patch('/api/v1/me')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Nuevo Nombre' });
    expect(patch.status).toBe(200);
    expect(patch.body.name).toBe('Nuevo Nombre');
  });

  it('PATCH /me with password change requires the current one and revokes sessions', async () => {
    const server = ctx.app.getHttpServer();
    await request(server)
      .post('/api/v1/auth/register')
      .send({ companyName: 'Empresa A', name: 'Admin', email: 'a@a.cl', password: 'supersecret123' });
    const login = await request(server)
      .post('/api/v1/auth/login')
      .send({ email: 'a@a.cl', password: 'supersecret123' });
    const token = login.body.accessToken as string;
    const cookies = login.headers['set-cookie'] as unknown as string[];
    const cookie = cookies.find((c) => c.startsWith('refresh_token='))!.split(';')[0]!;

    const wrong = await request(server)
      .patch('/api/v1/me')
      .set('Authorization', `Bearer ${token}`)
      .send({ currentPassword: 'not-the-password', newPassword: 'brand-new-secret-1' });
    expect(wrong.status).toBe(401);

    const ok = await request(server)
      .patch('/api/v1/me')
      .set('Authorization', `Bearer ${token}`)
      .send({ currentPassword: 'supersecret123', newPassword: 'brand-new-secret-1' });
    expect(ok.status).toBe(200);

    const refresh = await request(server).post('/api/v1/auth/refresh').set('Cookie', cookie);
    expect(refresh.status).toBe(401);

    const relogin = await request(server)
      .post('/api/v1/auth/login')
      .send({ email: 'a@a.cl', password: 'brand-new-secret-1' });
    expect(relogin.status).toBe(200);
  });
});
```

Run → FAIL (rutas inexistentes).

- [ ] **Step 3: Contexto y guards** — `request-context.service.ts`:

```ts
import { HttpStatus, Injectable } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import type { CompanyRole } from '@app/shared';
import { AppException } from '../filters/global-exception.filter';

export interface RequestContext {
  userId: string;
  companyId: string;
  role: CompanyRole;
  isSuperAdmin: boolean;
}

const CTX_KEY = 'requestContext';

@Injectable()
export class RequestContextService {
  constructor(private readonly cls: ClsService) {}

  set(ctx: RequestContext): void {
    this.cls.set(CTX_KEY, ctx);
  }

  get(): RequestContext {
    const ctx = this.cls.get<RequestContext | undefined>(CTX_KEY);
    if (!ctx) {
      throw new AppException(
        'missing_request_context',
        'Request context not initialized',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
    return ctx;
  }
}
```

`context.module.ts`:

```ts
import { Global, Module } from '@nestjs/common';
import { RequestContextService } from './request-context.service';

@Global()
@Module({
  providers: [RequestContextService],
  exports: [RequestContextService],
})
export class ContextModule {}
```
(agregar `ContextModule` a los imports de AppModule).

`jwt-auth.guard.ts`:

```ts
import { HttpStatus, Injectable } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import { AppException } from '../filters/global-exception.filter';
import { AccessTokenService, type AccessTokenPayload } from '../../modules/auth/access-token.service';

export type AuthedRequest = Request & { auth: AccessTokenPayload };

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly accessTokens: AccessTokenService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const header = req.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : undefined;
    const payload = token ? this.accessTokens.verify(token) : null;
    if (!payload) {
      throw new AppException(
        'unauthorized',
        'Missing or invalid access token',
        HttpStatus.UNAUTHORIZED,
      );
    }
    (req as AuthedRequest).auth = payload;
    return true;
  }
}
```

`company-context.guard.ts` (corre SIEMPRE después de JwtAuthGuard):

```ts
import { HttpStatus, Injectable } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { companies, memberships } from '@app/db';
import { AppException } from '../filters/global-exception.filter';
import { RequestContextService } from '../context/request-context.service';
import { DbService } from '../../infra/db/db.service';
import type { AuthedRequest } from './jwt-auth.guard';

@Injectable()
export class CompanyContextGuard implements CanActivate {
  constructor(
    private readonly dbService: DbService,
    private readonly ctx: RequestContextService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const auth = req.auth;
    const [row] = await this.dbService.db
      .select({ membership: memberships, company: companies })
      .from(memberships)
      .innerJoin(companies, eq(memberships.companyId, companies.id))
      .where(
        and(
          eq(memberships.userId, auth.sub),
          eq(memberships.companyId, auth.companyId),
          eq(memberships.status, 'active'),
        ),
      );
    if (!row) {
      throw new AppException(
        'no_membership',
        'No active membership for this company',
        HttpStatus.FORBIDDEN,
      );
    }
    if (row.company.status !== 'active') {
      throw new AppException('company_suspended', 'Company is suspended', HttpStatus.FORBIDDEN);
    }
    this.ctx.set({
      userId: auth.sub,
      companyId: auth.companyId,
      role: row.membership.role,
      isSuperAdmin: auth.isSuperAdmin,
    });
    return true;
  }
}
```

`permissions.guard.ts`:

```ts
import { HttpStatus, Injectable, SetMetadata } from '@nestjs/common';
import type { CanActivate, ExecutionContext, CustomDecorator } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { roleHasPermission, type Permission } from '@app/shared';
import { AppException } from '../filters/global-exception.filter';
import { RequestContextService } from '../context/request-context.service';

export const PERMISSIONS_KEY = 'required_permissions';
export const RequirePermissions = (...permissions: Permission[]): CustomDecorator =>
  SetMetadata(PERMISSIONS_KEY, permissions);

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly ctx: RequestContextService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const required =
      this.reflector.getAllAndOverride<Permission[]>(PERMISSIONS_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? [];
    if (required.length === 0) {
      return true;
    }
    const { role } = this.ctx.get();
    if (!required.every((permission) => roleHasPermission(role, permission))) {
      throw new AppException('forbidden', 'Insufficient permissions', HttpStatus.FORBIDDEN);
    }
    return true;
  }
}
```

- [ ] **Step 4: TenantDb** — `apps/api/src/infra/db/tenant-db.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import { RequestContextService } from '../../common/context/request-context.service';
import { DbService } from './db.service';
import type { Db } from './db.types';

/**
 * Acceso a datos con scoping de tenant. Contrato de la fundación (spec §4):
 * los módulos de dominio consultan a través de este servicio usando
 * `companyId`/`whereCompany`, derivados SIEMPRE del contexto autenticado.
 * El acceso sin scoping (DbService directo) queda reservado a auth y admin.
 */
@Injectable()
export class TenantDbService {
  constructor(
    private readonly dbService: DbService,
    private readonly ctx: RequestContextService,
  ) {}

  get companyId(): string {
    return this.ctx.get().companyId;
  }

  get db(): Db {
    return this.dbService.db;
  }

  whereCompany(table: { companyId: AnyPgColumn }): SQL {
    return eq(table.companyId, this.companyId);
  }
}
```
Registrar `TenantDbService` como provider+export adicional en `db.module.ts`.

- [ ] **Step 5: Módulos de superficie** — `me.service.ts`:

```ts
import { HttpStatus, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { companies, memberships, users } from '@app/db';
import type { UpdateMeInput } from '@app/shared';
import { AppException } from '../../common/filters/global-exception.filter';
import { DbService } from '../../infra/db/db.service';
import { PasswordService } from '../auth/password.service';
import { SessionService } from '../auth/session.service';

@Injectable()
export class MeService {
  constructor(
    private readonly dbService: DbService,
    private readonly passwords: PasswordService,
    private readonly sessions: SessionService,
  ) {}

  async getProfile(userId: string) {
    const db = this.dbService.db;
    const [user] = await db.select().from(users).where(eq(users.id, userId));
    if (!user) {
      throw new AppException('not_found', 'User not found', HttpStatus.NOT_FOUND);
    }
    const rows = await db
      .select({ membership: memberships, company: companies })
      .from(memberships)
      .innerJoin(companies, eq(memberships.companyId, companies.id))
      .where(eq(memberships.userId, userId));
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      avatarUrl: user.avatarUrl,
      emailVerified: user.emailVerifiedAt !== null,
      memberships: rows.map((r) => ({
        companyId: r.company.id,
        companyName: r.company.name,
        role: r.membership.role,
        status: r.membership.status,
      })),
    };
  }

  async updateProfile(userId: string, input: UpdateMeInput) {
    const db = this.dbService.db;
    const [user] = await db.select().from(users).where(eq(users.id, userId));
    if (!user) {
      throw new AppException('not_found', 'User not found', HttpStatus.NOT_FOUND);
    }

    const patch: Partial<typeof users.$inferInsert> = {};
    if (input.name !== undefined) patch.name = input.name;
    if (input.avatarUrl !== undefined) patch.avatarUrl = input.avatarUrl;

    if (input.newPassword) {
      const valid = await this.passwords.verify(user.passwordHash, input.currentPassword ?? '');
      if (!valid) {
        throw new AppException(
          'invalid_credentials',
          'Current password is incorrect',
          HttpStatus.UNAUTHORIZED,
        );
      }
      patch.passwordHash = await this.passwords.hash(input.newPassword);
    }

    if (Object.keys(patch).length > 0) {
      await db.update(users).set(patch).where(eq(users.id, userId));
    }
    if (patch.passwordHash) {
      await this.sessions.revokeAllForUser(userId);
    }
    return this.getProfile(userId);
  }
}
```

`me.controller.ts`:

```ts
import { Body, Controller, Get, Patch, Req, UseGuards } from '@nestjs/common';
import { updateMeSchema, type UpdateMeInput } from '@app/shared';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { JwtAuthGuard, type AuthedRequest } from '../../common/guards/jwt-auth.guard';
import { MeService } from './me.service';

@Controller('me')
@UseGuards(JwtAuthGuard)
export class MeController {
  constructor(private readonly me: MeService) {}

  @Get()
  get(@Req() req: AuthedRequest) {
    return this.me.getProfile(req.auth.sub);
  }

  @Patch()
  update(
    @Req() req: AuthedRequest,
    @Body(new ZodValidationPipe(updateMeSchema)) body: UpdateMeInput,
  ) {
    return this.me.updateProfile(req.auth.sub, body);
  }
}
```

`me.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { MeController } from './me.controller';
import { MeService } from './me.service';

@Module({
  imports: [AuthModule],
  controllers: [MeController],
  providers: [MeService],
})
export class MeModule {}
```

`company.service.ts`:

```ts
import { HttpStatus, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { companies } from '@app/db';
import type { UpdateCompanyInput } from '@app/shared';
import { AppException } from '../../common/filters/global-exception.filter';
import { RequestContextService } from '../../common/context/request-context.service';
import { TenantDbService } from '../../infra/db/tenant-db.service';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class CompanyService {
  constructor(
    private readonly tenantDb: TenantDbService,
    private readonly ctx: RequestContextService,
    private readonly audit: AuditService,
  ) {}

  async getCurrent() {
    const [company] = await this.tenantDb.db
      .select()
      .from(companies)
      .where(eq(companies.id, this.tenantDb.companyId));
    if (!company) {
      throw new AppException('not_found', 'Company not found', HttpStatus.NOT_FOUND);
    }
    const { id, name, slug, status, timezone, locale } = company;
    return { id, name, slug, status, timezone, locale };
  }

  async update(input: UpdateCompanyInput) {
    if (Object.keys(input).length > 0) {
      await this.tenantDb.db
        .update(companies)
        .set(input)
        .where(eq(companies.id, this.tenantDb.companyId));
      const { userId, companyId } = this.ctx.get();
      await this.audit.record({
        companyId,
        actorUserId: userId,
        action: 'company.updated',
        entityType: 'company',
        entityId: companyId,
        metadata: input,
      });
    }
    return this.getCurrent();
  }
}
```

`company.controller.ts`:

```ts
import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { updateCompanySchema, type UpdateCompanyInput } from '@app/shared';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { CompanyContextGuard } from '../../common/guards/company-context.guard';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard, RequirePermissions } from '../../common/guards/permissions.guard';
import { CompanyService } from './company.service';

@Controller('company')
@UseGuards(JwtAuthGuard, CompanyContextGuard, PermissionsGuard)
export class CompanyController {
  constructor(private readonly company: CompanyService) {}

  @Get()
  get() {
    return this.company.getCurrent();
  }

  @Patch()
  @RequirePermissions('company.update')
  update(@Body(new ZodValidationPipe(updateCompanySchema)) body: UpdateCompanyInput) {
    return this.company.update(body);
  }
}
```

`company.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { CompanyController } from './company.controller';
import { CompanyService } from './company.service';

@Module({
  imports: [AuthModule, AuditModule],
  controllers: [CompanyController],
  providers: [CompanyService],
})
export class CompanyModule {}
```

AppModule imports finales: `ConfigModule, LoggerModule.forRoot(...), ClsModule.forRoot(...), ContextModule, DbModule, HealthModule, AuthModule, MeModule, CompanyModule`.

- [ ] **Step 6:** `pnpm --filter @app/api test` → PASS (toda la suite, +7 e2e de tenancy). `typecheck`/`build` limpios. Commit:

```bash
git add apps/api pnpm-lock.yaml
git commit -m "feat(api): add cls request context, auth guards, tenant db and me/company endpoints"
```

---

### Task 9: Rate limiting en auth + cierre del plan

**Files:**
- Modify: `apps/api/package.json` (dep `@nestjs/throttler`)
- Modify: `apps/api/src/app.module.ts` (ThrottlerModule)
- Modify: `apps/api/src/modules/auth/auth.controller.ts` (guard + límites)
- Test: `apps/api/test/throttle.e2e-spec.ts`

- [ ] **Step 1:** `pnpm --filter @app/api add @nestjs/throttler`. En `app.module.ts`:

```ts
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 100 }]),
```

- [ ] **Step 2: e2e que falla** — `apps/api/test/throttle.e2e-spec.ts`:

```ts
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './harness';

describe('auth throttling (e2e)', () => {
  let ctx: TestApp;

  beforeEach(async () => {
    ctx = await createTestApp();
  });

  afterEach(async () => {
    await ctx?.close();
  });

  it('limits login attempts to 5 per minute per ip', async () => {
    const server = ctx.app.getHttpServer();
    const attempt = () =>
      request(server)
        .post('/api/v1/auth/login')
        .send({ email: 'ghost@acme.cl', password: 'wrong-password-1' });

    for (let i = 0; i < 5; i += 1) {
      const res = await attempt();
      expect(res.status).toBe(401);
    }
    const sixth = await attempt();
    expect(sixth.status).toBe(429);
  });
});
```

Run → FAIL (sexto intento devuelve 401, no 429).

- [ ] **Step 3:** En `auth.controller.ts`: `@UseGuards(ThrottlerGuard)` a nivel de clase (import desde `@nestjs/throttler`) y por endpoint:

```ts
  @Post('register')
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  ...

  @Post('login')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  ...

  @Post('forgot-password')
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  ...
```
Los demás endpoints del controller quedan bajo el default global (100/min). Storage en memoria: suficiente para una instancia; storage Redis se evalúa en F5 (multi-instancia).

- [ ] **Step 4:** `pnpm --filter @app/api test` → PASS. Gauntlet completo del monorepo:

Run: `pnpm lint && pnpm typecheck && pnpm build && pnpm test`
Expected: todo verde.

- [ ] **Step 5: Commit**

```bash
git add apps/api pnpm-lock.yaml
git commit -m "feat(api): rate-limit auth endpoints"
```

---

## Cobertura del spec (F2)

| Requisito del spec | Task |
|---|---|
| §3.2 Login JWT corto + refresh rotativo httpOnly | 5, 6 |
| §3.3 Verificación de email y reset por tokens de un solo uso | 4, 7 |
| §3.5 / §5 Roles y permisos granulares (guards) | 8 |
| §3.6 / §4 Scoping multi-tenant (CLS + tenantDb + test de aislamiento) | 8 |
| §6 Endpoints auth/me/company + reglas (suspendida bloquea, forgot no filtra) | 6, 7, 8 |
| §8 argon2id, tokens hasheados, cookies seguras, CORS/helmet, rate limiting | 1, 4, 6, 9 |
| §8 Auditoría auth.login / company.updated | 6, 8 |
| §2.3 Eventos outbox (verificación/reset) para el worker de F3 | 6, 7 |

**Diferido explícitamente:** envío real de emails + worker BullMQ + publisher outbox con redacción de payload (F3); invitaciones y gestión de equipo (F3); panel super admin (F3); mapeo fino de códigos http_error→not_found/etc. y storage Redis del throttler (F5); regla "no degradar al último company_admin" (F3, con la gestión de roles).
