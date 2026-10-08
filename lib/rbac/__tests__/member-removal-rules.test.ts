/**
 * Who may remove whom from a company (lib/rbac/member-removal-rules.ts), the
 * pure decision shared by the removal service and the Membres page.
 */

import { describe, expect, it } from 'vitest'
import { allPermissions, grantedPermissions } from '@/lib/rbac/granted-permissions'
import {
  ABOVE_ACTOR_MESSAGE,
  INSTANCE_ADMIN_TARGET_MESSAGE,
  LAST_MANAGER_MESSAGE,
  LAST_MANAGER_SELF_MESSAGE,
  NOT_A_MANAGER_MESSAGE,
  managesMembers,
  removalRefusal,
} from '@/lib/rbac/member-removal-rules'

const actor = (userId: string, roles: string[]) => ({ userId, isInstanceAdmin: false, permissions: grantedPermissions(roles, false) })
const member = (userId: string, roles: string[], isInstanceAdmin = false) => ({ userId, roles, isInstanceAdmin })

describe('member removal rules', () => {
  it('knows who manages the members', () => {
    expect(managesMembers(member('a', ['companyAdmin']))).toBe(true)
    expect(managesMembers(member('a', ['owner']))).toBe(true)
    expect(managesMembers(member('a', ['accountant']))).toBe(false)
    expect(managesMembers(member('a', ['viewer'], true))).toBe(true)
  })

  it('lets a company administrator remove a member with no more rights than theirs', () => {
    const admin = actor('a', ['companyAdmin'])
    expect(removalRefusal(admin, member('b', ['accountant']), 1)).toBeNull()
    expect(removalRefusal(admin, member('b', ['viewer']), 1)).toBeNull()
    expect(removalRefusal(admin, member('b', ['companyAdmin']), 1)).toBeNull()
  })

  it('refuses a member without members:manage, except to leave', () => {
    const accountant = actor('a', ['accountant'])
    expect(removalRefusal(accountant, member('b', ['viewer']), 1)).toBe(NOT_A_MANAGER_MESSAGE)
    expect(removalRefusal(accountant, member('a', ['accountant']), 1)).toBeNull()
  })

  it('never removes a member holding a right the actor lacks', () => {
    // A role managing members with an accountant's rights (a fork's custom role)
    const limited = { userId: 'a', isInstanceAdmin: false, permissions: { ...grantedPermissions(['accountant'], false), members: ['manage'] } }
    expect(removalRefusal(limited, member('b', ['viewer']), 1)).toBeNull()
    expect(removalRefusal(limited, member('b', ['accountant']), 1)).toBeNull()
    expect(removalRefusal(limited, member('b', ['companyAdmin']), 1)).toBe(ABOVE_ACTOR_MESSAGE)
  })

  it('never lets a company member remove an instance administrator', () => {
    expect(removalRefusal(actor('a', ['companyAdmin']), member('b', ['viewer'], true), 1)).toBe(INSTANCE_ADMIN_TARGET_MESSAGE)
  })

  it('never removes the last member able to manage the members, nor lets them leave', () => {
    expect(removalRefusal(actor('a', ['companyAdmin']), member('a', ['companyAdmin']), 0)).toBe(LAST_MANAGER_SELF_MESSAGE)
    expect(removalRefusal(actor('a', ['companyAdmin']), member('a', ['companyAdmin']), 1)).toBeNull()
    // A custom manager role removing the only company administrator
    const custom = { userId: 'a', isInstanceAdmin: false, permissions: allPermissions() }
    expect(removalRefusal(custom, member('b', ['companyAdmin']), 0)).toBe(LAST_MANAGER_MESSAGE)
    // Members who do not manage leave freely
    expect(removalRefusal(actor('a', ['viewer']), member('a', ['viewer']), 0)).toBeNull()
  })

  it('lets an instance administrator remove anyone', () => {
    const admin = { userId: 'x', isInstanceAdmin: true, permissions: allPermissions() }
    expect(removalRefusal(admin, member('b', ['companyAdmin']), 0)).toBeNull()
    expect(removalRefusal(admin, member('b', ['viewer'], true), 0)).toBeNull()
  })

  it('writes French messages with non-breaking spaces and no dashes', () => {
    for (const message of [NOT_A_MANAGER_MESSAGE, INSTANCE_ADMIN_TARGET_MESSAGE, ABOVE_ACTOR_MESSAGE, LAST_MANAGER_MESSAGE, LAST_MANAGER_SELF_MESSAGE]) {
      expect(message).not.toMatch(/[\u2013\u2014]/)
      expect(message).not.toMatch(/ [:;?!]/)
    }
  })
})
