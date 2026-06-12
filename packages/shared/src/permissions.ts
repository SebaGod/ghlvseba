export const COMPANY_ROLES = ['company_admin', 'manager', 'agent'] as const;
export type CompanyRole = (typeof COMPANY_ROLES)[number];

export const PERMISSIONS = [
  'company.update',
  'members.view',
  'members.invite',
  'members.manage',
  'audit.view',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const ROLE_PERMISSIONS: Record<CompanyRole, readonly Permission[]> = {
  company_admin: PERMISSIONS,
  manager: ['members.view'],
  agent: [],
};

export function roleHasPermission(role: CompanyRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}
