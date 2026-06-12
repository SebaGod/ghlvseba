import { describe, expect, it } from 'vitest';
import {
  COMPANY_ROLES,
  PERMISSIONS,
  roleHasPermission,
  type CompanyRole,
} from './permissions';

describe('roleHasPermission', () => {
  it('grants company_admin every permission', () => {
    for (const permission of PERMISSIONS) {
      expect(roleHasPermission('company_admin', permission)).toBe(true);
    }
  });

  it('grants manager only members.view', () => {
    expect(roleHasPermission('manager', 'members.view')).toBe(true);
    expect(roleHasPermission('manager', 'members.invite')).toBe(false);
    expect(roleHasPermission('manager', 'members.manage')).toBe(false);
    expect(roleHasPermission('manager', 'company.update')).toBe(false);
    expect(roleHasPermission('manager', 'audit.view')).toBe(false);
  });

  it('grants agent no foundation permissions', () => {
    for (const permission of PERMISSIONS) {
      expect(roleHasPermission('agent', permission)).toBe(false);
    }
  });

  it('exposes the three membership roles', () => {
    expect(COMPANY_ROLES).toEqual(['company_admin', 'manager', 'agent']);
    const role: CompanyRole = 'manager';
    expect(role).toBe('manager');
  });
});
