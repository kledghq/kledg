/**
 * Dashboard widget registry and layouts (lib/dashboard/widgets.ts,
 * lib/dashboard/layout.ts): definitions are complete, layouts are cleaned
 * of unknown or forbidden widgets and of unsupported sizes, and each role
 * gets its default.
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import { rolesGrant } from '@/lib/rbac/authorize'
import {
  DashboardLayoutBody,
  defaultLayout,
  LAYOUT_VERSION,
  moveItem,
  parseStoredLayout,
  sanitizeLayout,
  toStoredLayout,
} from '../layout'
import {
  DEFAULT_LAYOUTS,
  getWidget,
  profileOf,
  SOURCE_PERMISSIONS,
  WIDGET_SIZES,
  WIDGET_SOURCES,
  WIDGETS,
  widgetPermission,
  type DashboardProfile,
  type WidgetDefinition,
} from '../widgets'

const everything = () => true
const forRoles = (roles: string[]) => (widget: WidgetDefinition) => rolesGrant(roles, widgetPermission(widget))
const ids = (items: Array<{ id: string }>) => items.map((i) => i.id)

describe('widget registry', () => {
  it('has unique ids, a French title and description without dashes, and a supported default size', () => {
    expect(new Set(WIDGETS.map((w) => w.id)).size).toBe(WIDGETS.length)
    for (const widget of WIDGETS as readonly WidgetDefinition[]) {
      expect(widget.id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/)
      expect(widget.title.length, widget.id).toBeGreaterThan(0)
      expect(widget.description, widget.id).toMatch(/\.$/)
      expect(`${widget.title} ${widget.description}`, widget.id).not.toMatch(/[–—]/)
      // French typography: a no-break space before a colon.
      expect(widget.description, widget.id).not.toMatch(/ :/)
      expect(widget.sizes.length, widget.id).toBeGreaterThan(0)
      expect(widget.sizes.every((s) => WIDGET_SIZES.includes(s)), widget.id).toBe(true)
      expect(widget.sizes, widget.id).toContain(widget.defaultSize)
      expect(WIDGET_SOURCES, widget.id).toContain(widget.source)
    }
  })

  it('gives every source a permission', () => {
    for (const source of WIDGET_SOURCES) expect(Object.keys(SOURCE_PERMISSIONS[source]).length, source).toBeGreaterThan(0)
  })

  it('has a renderer for every widget and no renderer without a widget', () => {
    const source = readFileSync(path.resolve(__dirname, '../../../components/features/dashboard/widgets/index.ts'), 'utf8')
    const rendered = [...source.matchAll(/^\s+'([a-z0-9-]+)':/gm)].map((m) => m[1])
    expect(rendered.sort()).toEqual(WIDGETS.map((w) => w.id).sort())
  })

  it('shows the checklist only to members who keep the books', () => {
    const guide = getWidget('guide-demarrer') as WidgetDefinition
    expect(rolesGrant(['companyAdmin'], widgetPermission(guide))).toBe(true)
    expect(rolesGrant(['accountant'], widgetPermission(guide))).toBe(true)
    expect(rolesGrant(['viewer'], widgetPermission(guide))).toBe(false)
  })
})

describe('layout validation', () => {
  it('ignores unknown ids, so layouts saved by another version still load', () => {
    expect(sanitizeLayout([{ id: 'kpi-resultat', size: 'S' }, { id: 'widget-futur', size: 'M' }, { id: '' }], everything)).toEqual([
      { id: 'kpi-resultat', size: 'S' },
    ])
  })

  it('keeps the first occurrence of a widget listed twice', () => {
    expect(
      sanitizeLayout(
        [
          { id: 'kpi-resultat', size: 'M' },
          { id: 'kpi-tva', size: 'S' },
          { id: 'kpi-resultat', size: 'S' },
        ],
        everything,
      ),
    ).toEqual([
      { id: 'kpi-resultat', size: 'M' },
      { id: 'kpi-tva', size: 'S' },
    ])
  })

  it('replaces a size the widget does not support by its default size', () => {
    expect(
      sanitizeLayout(
        [
          { id: 'kpi-resultat', size: 'L' },
          { id: 'guide-demarrer', size: 'S' },
          { id: 'chart-produits-charges', size: 'XL' },
          { id: 'list-brouillons' },
        ],
        everything,
      ),
    ).toEqual([
      { id: 'kpi-resultat', size: 'S' },
      { id: 'guide-demarrer', size: 'L' },
      { id: 'chart-produits-charges', size: 'M' },
      { id: 'list-brouillons', size: 'M' },
    ])
  })

  it('drops the widgets the user may not see', () => {
    const items = [{ id: 'guide-demarrer' }, { id: 'kpi-resultat' }]
    expect(ids(sanitizeLayout(items, forRoles(['viewer'])))).toEqual(['kpi-resultat'])
    expect(ids(sanitizeLayout(items, forRoles(['accountant'])))).toEqual(['guide-demarrer', 'kpi-resultat'])
  })

  it('reads a stored row of the current version only, and round trips', () => {
    const items = [{ id: 'kpi-tva' as const, size: 'M' as const }]
    const stored = toStoredLayout(items)
    expect(stored).toEqual({ version: LAYOUT_VERSION, items })
    expect(parseStoredLayout(JSON.parse(JSON.stringify(stored)), everything)).toEqual(items)
    expect(parseStoredLayout({ version: 99, items }, everything)).toBeNull()
    expect(parseStoredLayout('corrupted', everything)).toBeNull()
    expect(parseStoredLayout({ version: LAYOUT_VERSION, items: 'x' }, everything)).toBeNull()
    expect(parseStoredLayout({ version: LAYOUT_VERSION, items: [] }, everything)).toEqual([])
  })

  it('validates request bodies: sizes S, M or L, a bounded list', () => {
    expect(DashboardLayoutBody.safeParse({ items: [{ id: 'kpi-tva', size: 'S' }] }).success).toBe(true)
    expect(DashboardLayoutBody.safeParse({ items: [{ id: 'kpi-tva' }] }).success).toBe(true)
    // Unknown ids pass validation and are dropped by sanitizeLayout.
    expect(DashboardLayoutBody.safeParse({ items: [{ id: 'widget-futur', size: 'M' }] }).success).toBe(true)
    expect(DashboardLayoutBody.safeParse({ items: [{ id: 'kpi-tva', size: 'XL' }] }).success).toBe(false)
    expect(DashboardLayoutBody.safeParse({ items: [{ id: 'x'.repeat(65) }] }).success).toBe(false)
    expect(DashboardLayoutBody.safeParse({ items: Array.from({ length: 51 }, () => ({ id: 'kpi-tva' })) }).success).toBe(false)
    expect(DashboardLayoutBody.safeParse({}).success).toBe(false)
  })

  it('moves an item, clamping the target', () => {
    expect(moveItem(['a', 'b', 'c'], 0, 2)).toEqual(['b', 'c', 'a'])
    expect(moveItem(['a', 'b', 'c'], 2, 0)).toEqual(['c', 'a', 'b'])
    expect(moveItem(['a', 'b', 'c'], 1, 9)).toEqual(['a', 'c', 'b'])
    expect(moveItem(['a', 'b', 'c'], 5, 0)).toEqual(['a', 'b', 'c'])
  })
})

describe('default layouts', () => {
  it('maps roles to profiles, the role with the most rights first', () => {
    expect(profileOf(['admin'])).toBe('owner')
    expect(profileOf(['owner'])).toBe('owner')
    expect(profileOf(['companyAdmin'])).toBe('owner')
    expect(profileOf(['accountant', 'companyAdmin'])).toBe('owner')
    expect(profileOf(['accountant'])).toBe('accountant')
    expect(profileOf(['viewer'])).toBe('viewer')
    expect(profileOf([])).toBe('viewer')
  })

  it('only lists known widgets, each once, at a supported size', () => {
    for (const profile of Object.keys(DEFAULT_LAYOUTS) as DashboardProfile[]) {
      expect(sanitizeLayout(DEFAULT_LAYOUTS[profile], everything), profile).toEqual(DEFAULT_LAYOUTS[profile])
    }
  })

  it('leads with the four numbers of a small company owner, then the work waiting', () => {
    expect(ids(defaultLayout('owner', forRoles(['companyAdmin'])))).toEqual([
      'guide-demarrer',
      'kpi-chiffre-affaires',
      'kpi-resultat',
      'kpi-tresorerie',
      'kpi-a-rapprocher',
      'chart-produits-charges',
      'chart-tresorerie',
      'list-a-rapprocher',
      'list-echeances',
      'list-brouillons',
      'list-creances-dettes-echues',
      'list-comptes-bancaires',
    ])
  })

  it('offers the overdue receivables and payables of the aged balance to whoever reads the reports', () => {
    const widget = getWidget('list-creances-dettes-echues') as WidgetDefinition
    expect(widget).toMatchObject({ title: 'Créances et dettes échues', source: 'aged-balance' })
    expect(widgetPermission(widget)).toEqual({ reports: ['read'] })
    expect(ids(defaultLayout('accountant', forRoles(['accountant'])))).toContain('list-creances-dettes-echues')
  })

  it('puts the work of the accountant first: brouillons, à rapprocher, TVA', () => {
    expect(ids(defaultLayout('accountant', forRoles(['accountant']))).slice(0, 4)).toEqual([
      'guide-demarrer',
      'list-brouillons',
      'list-a-rapprocher',
      'kpi-tva',
    ])
  })

  it('gives the owner and the accountant the coming deadlines, every role may add them', () => {
    expect(ids(defaultLayout('owner', forRoles(['companyAdmin'])))).toContain('list-echeances')
    expect(ids(defaultLayout('accountant', forRoles(['accountant'])))).toContain('list-echeances')
    expect(DEFAULT_LAYOUTS.viewer.map((i) => i.id)).not.toContain('list-echeances')
    const deadlines = getWidget('list-echeances') as WidgetDefinition
    expect(deadlines.source).toBe('deadlines')
    expect(SOURCE_PERMISSIONS.deadlines).toEqual({ reports: ['read'] })
    for (const role of ['companyAdmin', 'accountant', 'viewer']) expect(rolesGrant([role], widgetPermission(deadlines)), role).toBe(true)
  })

  it('keeps a layout saved before the deadlines widget existed as it was', () => {
    const saved = { version: LAYOUT_VERSION, items: [{ id: 'kpi-resultat', size: 'S' }, { id: 'list-brouillons', size: 'M' }] }
    expect(parseStoredLayout(saved, everything)).toEqual([
      { id: 'kpi-resultat', size: 'S' },
      { id: 'list-brouillons', size: 'M' },
    ])
    // And a layout that holds it at a size it supports.
    expect(sanitizeLayout([{ id: 'list-echeances', size: 'S' }], everything)).toEqual([{ id: 'list-echeances', size: 'S' }])
  })

  it('shows viewers indicators and charts only, nothing to act on', () => {
    const items = defaultLayout('viewer', forRoles(['viewer']))
    expect(items.length).toBeGreaterThan(0)
    for (const item of items) expect(['kpi', 'chart'], item.id).toContain(getWidget(item.id)?.category)
    expect(ids(items)).not.toContain('guide-demarrer')
  })

  it('every widget of a default layout is visible to the role of that layout', () => {
    const roleOf: Record<DashboardProfile, string> = { owner: 'companyAdmin', accountant: 'accountant', viewer: 'viewer' }
    for (const profile of Object.keys(DEFAULT_LAYOUTS) as DashboardProfile[]) {
      expect(defaultLayout(profile, forRoles([roleOf[profile]])), profile).toEqual(DEFAULT_LAYOUTS[profile])
    }
  })
})
