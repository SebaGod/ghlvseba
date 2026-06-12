# Spec: Blueprint de arquitectura + Fundación multi-tenant

- **Fecha:** 2026-06-12
- **Estado:** Aprobado en brainstorming; pendiente plan de implementación
- **Sub-proyecto:** 1 de 7 (ver roadmap al final)

## 1. Contexto

Plataforma SaaS multi-tenant tipo CRM + IA + omnicanalidad (inspirada en
GoHighLevel/HubSpot/Pipedrive/Make): inbox omnicanal (WhatsApp/IG/Messenger),
CRM con Kanban de leads, automatizaciones visuales, agentes IA con RAG,
calendarios/reservas, integraciones Meta y Google, dashboards, roles y UX
premium. El repositorio parte vacío.

El proyecto completo es demasiado grande para un solo spec, por lo que se
descompone en sub-proyectos. Este spec cubre el primero: el blueprint técnico
global y la fundación multi-tenant sobre la que se construye todo lo demás.

### Decisiones ya tomadas (con el usuario)

| Decisión | Elección |
|---|---|
| Primer sub-proyecto | Blueprint de arquitectura + fundación multi-tenant |
| Hosting | PaaS con contenedores (Railway/Fly/Render) + Postgres y Redis gestionados |
| Modelo de tenancy | Empresas directas, plano (tipo HubSpot); sin jerarquía agencia→sub-cuentas |
| Arquitectura | Monolito modular TypeScript (Enfoque A) |

## 2. Blueprint global

### 2.1 Monorepo

pnpm workspaces + Turborepo:

```
apps/api        → NestJS 11 (monolito modular) — un módulo por dominio
apps/web        → Next.js 15 (App Router)
packages/db     → esquema Drizzle ORM + migraciones (PostgreSQL)
packages/shared → tipos, schemas zod, mapa de permisos, constantes
packages/ui     → design system (Tailwind CSS + shadcn/ui)
```

Node 22 LTS, TypeScript estricto en todo el stack.

### 2.2 Topología de despliegue

| Pieza | Qué es |
|---|---|
| `api` | Contenedor NestJS: REST + WebSockets + webhooks |
| `worker` | Mismo build de la API arrancado en modo cola (BullMQ). En la fundación procesa emails; después automatizaciones, webhooks Meta e indexación RAG |
| `web` | Contenedor Next.js |
| PostgreSQL 16 | Base única con extensión **pgvector** (RAG futuro). Gestionado por el PaaS |
| Redis 7 | BullMQ (colas) + pub/sub (tiempo real) + rate limiting |

Desarrollo local: `docker compose up` levanta Postgres, Redis y Mailpit
(captura de emails locales).

### 2.3 Módulos de dominio (mapa para los siguientes sub-proyectos)

```
tenancy/auth (fundación, este spec)
   ↑ depende todo lo demás
crm ← inbox ← ai-agents ← automations
calendar ← integrations-google
inbox ← integrations-meta
dashboards ← (lee de todos)
```

Los módulos se comunican mediante **eventos de dominio internos** con patrón
outbox (tabla `outbox_events` → publicación a BullMQ). Esto da entrega
confiable y es la columna vertebral que después alimenta los triggers del
motor de automatizaciones. La tabla outbox y el publicador se crean en la
fundación con el primer caso de uso real: envío de emails transaccionales.

Si el volumen lo exige más adelante, el primer módulo extraíble a servicio
independiente es la ingesta de webhooks de Meta; los límites de módulo se
diseñan para permitirlo sin reescritura.

## 3. Alcance de la fundación

### Incluye

1. Registro de empresa: crea `company` + primer usuario con rol Company Admin.
2. Login email+contraseña: JWT de acceso (15 min) + refresh token rotativo
   (30 días) en cookie httpOnly; logout con revocación.
3. Verificación de email y reset de contraseña por tokens de un solo uso.
4. Invitaciones de usuarios por email con rol asignado (expiran a los 7 días).
5. Roles y permisos granulares (ver §5).
6. Scoping multi-tenant automático en la capa de datos (ver §4).
7. Panel Super Admin mínimo: listar empresas, ver detalle, suspender/reactivar.
8. Shell de UI premium: sidebar, dark/light, responsive, settings de
   perfil/empresa/equipo, módulos futuros visibles como "próximamente".
9. Auditoría básica (`audit_logs`) de acciones sensibles.
10. Infraestructura: logging estructurado (pino), health checks, config por
    env vars validada con zod, emails transaccionales vía cola, CI. Los
    emails salen por una abstracción `EmailProvider` con driver SMTP:
    Resend (o cualquier SMTP) en producción, Mailpit en local.

### Excluye (sub-proyectos siguientes)

CRM, inbox omnicanal, automatizaciones, agentes IA/RAG, calendarios,
integraciones Meta/Google, dashboards, facturación/planes de pago (no está en
el master prompt; se decidirá después).

## 4. Modelo de datos

Convención global: PKs `uuid` v7, timestamps `created_at`/`updated_at`,
soft-delete solo donde se indique. **Toda tabla de dominio lleva `company_id`**
con índice compuesto `(company_id, ...)`.

```
companies        id, name, slug (único), status (active|suspended),
                 timezone (default America/Santiago), locale (default es)

users            id, email (único, normalizado a minúsculas), password_hash (argon2id),
                 name, avatar_url, status (active|disabled),
                 email_verified_at, is_super_admin (bool, default false)

memberships      id, user_id, company_id, role (company_admin|manager|agent),
                 status (active|removed) — único (user_id, company_id).
                 Permite a futuro un usuario en varias empresas sin migración.

invitations      id, company_id, email, role, token_hash, invited_by_user_id,
                 expires_at, accepted_at

sessions         id, user_id, family_id, refresh_token_hash, expires_at, ip,
                 user_agent, revoked_at — rotación: cada refresh emite token
                 nuevo y revoca el anterior; reuso de un token revocado revoca
                 toda la familia (family_id).

auth_tokens      id, user_id, type (email_verification|password_reset),
                 token_hash, expires_at, consumed_at

audit_logs       id, company_id (null para acciones globales),
                 actor_user_id, action, entity_type, entity_id,
                 metadata jsonb, ip, created_at

outbox_events    id, company_id (null para eventos globales), event_type,
                 payload jsonb, status, published_at — patrón outbox para
                 eventos de dominio
```

### Enforcement del scoping

El contexto de request (`userId`, `companyId`, `role`) se resuelve del JWT +
membership y viaja en CLS (`nestjs-cls`). El acceso a datos de dominio pasa
por un wrapper `tenantDb` que inyecta el filtro `company_id` automáticamente;
el acceso sin scoping (`db` crudo) queda reservado a auth y Super Admin y debe
ser explícito. Un test de integración dedicado verifica que la empresa B no
puede leer ni mutar datos de la empresa A por ningún endpoint de la fundación.

## 5. Roles y permisos

`super_admin` es un flag sobre `users` (acceso global, no es membership).
Roles de membership y su mapa de permisos (vive en `packages/shared`, los
módulos futuros agregan los suyos):

| Permiso | company_admin | manager | agent |
|---|---|---|---|
| `company.update` | ✓ | — | — |
| `members.view` | ✓ | ✓ | — |
| `members.invite` | ✓ | — | — |
| `members.manage` (rol/remover) | ✓ | — | — |
| `audit.view` | ✓ | — | — |

Cadena de guards en la API: `JwtAuthGuard → CompanyContextGuard →
PermissionsGuard(permiso)`. Los permisos se chequean siempre en el backend;
el frontend solo los usa para ocultar UI.

## 6. API

REST versionada bajo `/api/v1`, OpenAPI generado con `@nestjs/swagger`.
Validación zod en el borde. Errores con formato uniforme
`{ code, message, details? }`. Rate limiting respaldado en Redis:
login 5/min/IP, registro 3/min/IP, forgot-password 3/min/IP.

```
POST   /auth/register            crea company + admin; envía verificación
POST   /auth/login               → access token + cookie refresh
POST   /auth/refresh             rotación de refresh token
POST   /auth/logout              revoca sesión
POST   /auth/verify-email        consume token
POST   /auth/forgot-password     siempre responde 200 (no filtra existencia)
POST   /auth/reset-password      consume token, revoca sesiones activas

GET    /me                       perfil + memberships
PATCH  /me                       nombre, avatar, contraseña (pide la actual)

GET    /company                  empresa actual
PATCH  /company                  [company.update]

GET    /company/members          [members.view]
PATCH  /company/members/:id      cambiar rol [members.manage]
DELETE /company/members/:id      remover [members.manage]
GET    /company/invitations      [members.invite]
POST   /company/invitations      [members.invite]
DELETE /company/invitations/:id  [members.invite]
GET    /invitations/:token       público: preview de invitación
POST   /invitations/:token/accept  crea usuario o agrega membership

GET    /company/audit-logs       [audit.view], paginado

GET    /admin/companies          solo super_admin
GET    /admin/companies/:id
PATCH  /admin/companies/:id      suspender/reactivar

GET    /health                   liveness/readiness
```

Reglas de negocio destacadas: una empresa suspendida bloquea el login de sus
miembros (excepto super admin); no se puede remover ni degradar al último
`company_admin`; aceptar una invitación con email ya registrado agrega
membership en lugar de crear usuario.

## 7. Frontend

Next.js App Router con route groups:

```
(auth)   /login /register /verify-email /forgot-password /reset-password
         /invitations/[token]
(app)    /dashboard (placeholder con módulos "próximamente")
         /settings/profile /settings/company /settings/team
(admin)  /admin/companies
```

- **Design system** en `packages/ui`: Tailwind + shadcn/ui, theming por CSS
  vars con dark/light (next-themes), tipografía Inter. Estética objetivo:
  Linear/Stripe — limpia, densa, rápida.
- **Datos:** TanStack Query + cliente fetch tipado contra los schemas zod de
  `packages/shared`. El access token vive en memoria; el refresh, en cookie
  httpOnly (el cliente reintenta en 401 vía `/auth/refresh`).
- **i18n:** next-intl, español por defecto, archivos de mensajes listos para
  inglés. Sin selector de idioma en esta fase.
- Responsive / mobile-first; navegación por teclado y command palette quedan
  para un sub-proyecto de UX posterior.

## 8. Seguridad y manejo de errores

- Contraseñas con argon2id; todos los tokens (refresh, invitación,
  verificación, reset) se almacenan hasheados (SHA-256) y son de un solo uso.
- Cookies `httpOnly; Secure; SameSite=Lax`. Helmet + CORS estricto al origen
  del frontend.
- Respuestas de auth no filtran existencia de cuentas.
- `companyId` jamás se acepta del cliente: siempre se deriva del contexto
  autenticado.
- Excepciones de dominio tipadas mapeadas a HTTP por un exception filter
  global; errores inesperados → 500 genérico + log estructurado con request id.
- Auditoría mínima: `auth.login`, `member.invited`, `member.role_changed`,
  `member.removed`, `company.updated`, `admin.company_suspended`.

## 9. Testing

- **API (Vitest + unplugin-swc):** unit en servicios de auth/permisos;
  integración con PGlite (Postgres embebido en proceso — funciona sin Docker,
  tanto en CI como en entornos de agente) cubriendo el flujo completo de
  auth, reglas de negocio (último admin, empresa suspendida) y el test
  crítico de aislamiento multi-tenant (§4).
- **Web (Vitest + Testing Library):** componentes del design system y
  formularios de auth.
- **E2E (Playwright, smoke):** registrar → verificar email (vía Mailpit) →
  invitar → aceptar → login → cambiar rol.
- Implementación con TDD. CI en GitHub Actions: install → lint → typecheck →
  test → build, bloqueante.

## 10. Criterio de éxito

1. Una empresa se registra, verifica email, invita usuarios con roles
   distintos y administra su equipo desde el shell.
2. Un Super Admin lista y suspende empresas; la suspensión bloquea el acceso.
3. El test de aislamiento entre tenants pasa, junto con el resto de la suite.
4. `docker compose up` + seeds deja el entorno local funcionando en minutos.
5. CI verde y contenedores desplegables a Railway/Fly sin cambios de código.

## 11. Roadmap de sub-proyectos (cada uno con su propio spec)

1. **Fundación multi-tenant** ← este spec
2. CRM: contactos + pipeline Kanban de leads
3. Inbox omnicanal (WhatsApp Cloud API primero; infraestructura webhooks Meta)
4. Agentes IA + base de conocimiento RAG (pgvector, Claude API)
5. Motor de automatizaciones (builder visual + ejecución sobre outbox/BullMQ)
6. Calendarios/reservas + integraciones Google
7. Dashboards y reportes
