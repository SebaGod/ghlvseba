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
