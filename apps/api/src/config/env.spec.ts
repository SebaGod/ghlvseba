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

  it('fails fast naming every missing variable', () => {
    expect(() => loadEnv({})).toThrow(/DATABASE_URL/);
    expect(() => loadEnv({})).toThrow(/JWT_ACCESS_SECRET/);
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

  it('rejects a non-URL WEB_URL', () => {
    expect(() => loadEnv({ ...valid, WEB_URL: 'not-a-url' })).toThrow(/WEB_URL/);
  });
});
