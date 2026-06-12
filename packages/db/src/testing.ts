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
