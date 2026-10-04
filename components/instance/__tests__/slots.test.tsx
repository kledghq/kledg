import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { CompanyOverlay, filterUserMenu, InstanceBanner, LoginExtra } from '../slots'
import { USER_MENU_ITEMS } from '@/components/layout/user-menu'
import { visibleSettingsGroups, settingsNavGroups } from '@/components/layout/settings-nav-config'

const user = { id: 'u1', email: 'admin@example.com', role: 'admin' }

describe('default instance slots', () => {
  it('render nothing', () => {
    expect(render(<InstanceBanner user={user} />).container.innerHTML).toBe('')
    expect(render(<LoginExtra redirectTo="/" />).container.innerHTML).toBe('')
    expect(render(<CompanyOverlay user={user} />).container.innerHTML).toBe('')
  })

  it('keep every user menu entry', async () => {
    const items = [...USER_MENU_ITEMS]
    expect(await filterUserMenu(items, user)).toEqual(items)
  })
})

describe('user menu filtering of the settings navigation', () => {
  it('keeps every entry without a filter or when the whole menu is visible', () => {
    expect(visibleSettingsGroups(true)).toEqual(settingsNavGroups)
    expect(visibleSettingsGroups(true, USER_MENU_ITEMS.map((i) => i.id))).toEqual(settingsNavGroups)
  })

  it('hides the settings links of hidden menu entries and empty groups', () => {
    const groups = visibleSettingsGroups(true, ['api-keys'])
    const urls = groups.flatMap((g) => g.items.map((i) => i.url))
    expect(urls).toEqual(['/companies', '/settings/api-keys'])
    expect(groups.map((g) => g.label)).not.toContain('Instance')
  })
})

describe('user menu entries of a customised instance', () => {
  it('carry the action they lead to, so a fork can hide refused ones', async () => {
    // The filter of docs/extension-points.md, with a policy refusing user management.
    const refused = new Set(['manage-users'])
    const filter = (items: typeof USER_MENU_ITEMS) => items.filter((i) => !i.action || !refused.has(i.action))
    const visible = filter(USER_MENU_ITEMS).map((i) => i.id)
    const urls = visibleSettingsGroups(true, visible).flatMap((g) => g.items.map((i) => i.url))
    expect(urls).toContain('/settings/profile')
    expect(urls).toContain('/settings/updates')
    expect(urls).not.toContain('/settings/users/new')
  })

  it('show only the account settings entry in the menu, every page in the sidebar', () => {
    expect(USER_MENU_ITEMS.filter((i) => i.inMenu).map((i) => i.href)).toEqual(['/settings/profile'])
    const sidebarUrls = settingsNavGroups.flatMap((g) => g.items.map((i) => i.url))
    for (const item of USER_MENU_ITEMS) expect(sidebarUrls).toContain(item.href)
  })
})
