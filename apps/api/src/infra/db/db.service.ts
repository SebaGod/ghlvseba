import { Inject, Injectable, Logger } from '@nestjs/common';
import type { OnModuleDestroy } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from '@app/db';
import { ENV } from '../../config/config.module';
import type { Env } from '../../config/env';

@Injectable()
export class DbService implements OnModuleDestroy {
  private readonly logger = new Logger(DbService.name);
  readonly pool: Pool;
  readonly db: NodePgDatabase<typeof schema>;

  constructor(@Inject(ENV) env: Env) {
    this.pool = new Pool({
      connectionString: env.DATABASE_URL,
      connectionTimeoutMillis: 5000,
    });
    // node-postgres emits 'error' on idle clients (e.g. server restarts);
    // without a listener that is an unhandled 'error' event and kills the process.
    this.pool.on('error', (err) => {
      this.logger.error(err, 'idle postgres client error');
    });
    this.db = drizzle(this.pool, { schema });
  }

  async ping(): Promise<void> {
    await this.db.execute(sql`select 1`);
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}
