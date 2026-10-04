import { describe, expect, it } from 'vitest'

import { grantedPermissions, grants, roleLabelOf } from '../granted-permissions'
import { rolesGrant } from '../authorize'

describe('granted permissions', () => {
  it('lets an accountant reconcile but not manage bank connections', () => {
    const accountant = grantedPermissions(['accountant'], false)
    expect(grants(accountant, { banking: ['read', 'reconcile'] })).toBe(true)
    expect(grants(accountant, { banking: ['manage'] })).toBe(false)
    expect(grants(accountant, { settings: ['update'] })).toBe(false)
    expect(grants(accountant, { entries: ['validate'] })).toBe(true)
  })

  it('gives a company administrator and an instance administrator everything', () => {
    for (const granted of [grantedPermissions(['companyAdmin'], false), grantedPermissions([], true)]) {
      expect(grants(granted, { banking: ['manage'], settings: ['update'], members: ['manage'] })).toBe(true)
    }
  })

  it('mirrors the server check for every role and action', () => {
    const actions = {
      entries: ['read', 'create', 'update', 'delete', 'validate'],
      ledger: ['manage'],
      closing: ['execute'],
      banking: ['read', 'reconcile', 'manage'],
      reports: ['read', 'export'],
      settings: ['read', 'update'],
      members: ['manage'],
      expenses: ['submit', 'validate'],
      budgets: ['manage'],
    } as const
    for (const role of ['owner', 'companyAdmin', 'accountant', 'viewer']) {
      const granted = grantedPermissions([role], false)
      for (const [resource, list] of Object.entries(actions)) {
        for (const action of list) {
          const request = { [resource]: [action] }
          expect(grants(granted, request), `${role} ${resource}:${action}`).toBe(rolesGrant([role], request))
        }
      }
    }
  })

  it('lets administrators and accountants manage budgets, never a viewer', () => {
    expect(grants(grantedPermissions(['companyAdmin'], false), { budgets: ['manage'] })).toBe(true)
    expect(grants(grantedPermissions(['accountant'], false), { budgets: ['manage'] })).toBe(true)
    expect(grants(grantedPermissions(['viewer'], false), { budgets: ['manage'] })).toBe(false)
    expect(grants(grantedPermissions(['viewer'], false), { reports: ['read'] })).toBe(true)
  })

  it('names the roles with ROLE_LABELS', () => {
    expect(roleLabelOf(['accountant'], false)).toBe('Comptable')
    expect(roleLabelOf([], true)).toBe("Administrateur de l'instance")
  })
})
