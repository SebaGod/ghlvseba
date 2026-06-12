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
