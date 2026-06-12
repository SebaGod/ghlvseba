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
