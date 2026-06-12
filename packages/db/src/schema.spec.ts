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
