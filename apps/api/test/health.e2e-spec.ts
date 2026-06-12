import type { INestApplication } from '@nestjs/common';
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
    await app?.close();
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
