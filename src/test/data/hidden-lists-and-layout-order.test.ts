import { describe, it, expect, beforeEach } from 'vitest'
import { db } from '../../data/database'
import { rowFixes, sanitizeRow, validateImportData, validateRow } from '../../data/import-validation'
import { layoutRepository } from '../../data/layout-repository'
import { listDefinitionRepository } from '../../data/list-definition-repository'
import { auditData, cleanupIssues } from '../../data/audit'
import { readListDrafts, writeListDrafts } from '../../data/draft-storage'
import { emptyPredicate } from '../../models/filter-predicate'
import type { ListDefinition, PersistedListDefinition } from '../../models/list-definition'
import type { WorkspaceLayout } from '../../models/workspace-layout'
import { resetDb } from '../helpers'

const AT = new Date('2026-10-01T09:00:00.000Z')
const LATER = new Date('2026-10-05T09:00:00.000Z')

const list = (id: number, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  id, name: `List ${id}`, sortOrder: 0, sort: 'manual', grouping: 'none',
  membership: { kind: 'custom', predicate: emptyPredicate() }, ...extra,
})
const layoutRow = (id: number, extra: Record<string, unknown> = {}): Record<string, unknown> =>
  ({ id, name: `L${id}`, sortOrder: 0, columns: [], createdAt: AT, modifiedAt: AT, ...extra })

beforeEach(async () => {
  await resetDb()
})

describe('import: a list’s owner, its filter-line switch, the Priority grouping', () => {
  it('keeps a layout’s or the Eisenhower’s owner, the hidden filter line and the Priority grouping', () => {
    const rows = [
      list(1, { owner: { layoutId: 4 }, showFilterLine: false, grouping: 'priority' }),
      list(2, { owner: { eisenhower: true } }),
    ]
    const res = validateImportData({ todos: [], settings: [], listDefinitions: rows })
    if (!res.ok) throw new Error(res.error)
    expect(res.warnings).toEqual([])
    expect(res.data.listDefinitions).toEqual(rows)
  })

  it.each([
    [{ layoutId: 0 }], [{ layoutId: 1.5 }], [{ layoutId: '3' }], [{ eisenhower: false }],
    [{ layoutId: 3, eisenhower: true }], [{ layoutId: 3, extra: 1 }], ['eisenhower'], [7],
  ])('an owner it can’t read (%j) is dropped with a warning: a list with no owner (the audit gives it a layout)', (owner) => {
    const row = list(1, { owner })
    expect(validateRow('listDefinitions', row)).toBe(true)
    expect(rowFixes('listDefinitions', row)).toEqual(['unknown owner dropped'])
    expect('owner' in sanitizeRow('listDefinitions', row)).toBe(false)
  })

  it('a shown filter line is the default: `true` is dropped silently, another value with a warning', () => {
    expect(rowFixes('listDefinitions', list(1, { showFilterLine: true }))).toEqual([])
    expect('showFilterLine' in sanitizeRow('listDefinitions', list(1, { showFilterLine: true }))).toBe(false)
    expect(rowFixes('listDefinitions', list(1, { showFilterLine: 'no' }))).toEqual(['unknown filter line setting dropped'])
    expect(rowFixes('listDefinitions', list(1, { owner: null, showFilterLine: null }))).toEqual([])
  })

  it('a grouping it doesn’t know still fails the row', () => {
    expect(validateRow('listDefinitions', list(1, { grouping: 'mood' }))).toBe('grouping')
  })
})

describe('import: a layout’s order and the new-task follow-up setting', () => {
  it('a layout needs an order; the repair puts one without it last', () => {
    expect(validateRow('layouts', layoutRow(1))).toBe(true)
    const { sortOrder: _o, ...noOrder } = layoutRow(1)
    void _o
    expect(validateRow('layouts', noOrder)).toBe('sortOrder')
    expect(validateRow('layouts', { ...noOrder, sortOrder: 'first' })).toBe('sortOrder')
    expect(rowFixes('layouts', noOrder)).toEqual(['order reset'])
    expect(sanitizeRow('layouts', noOrder).sortOrder).toBe(Number.MAX_SAFE_INTEGER)
    expect(validateImportData({ todos: [], settings: [], layouts: [noOrder] }).ok).toBe(false)
  })

  it.each([['true', true], ['false', true], ['no', false], ['', false]])('newTaskFollowup %j reads: %s', (value, ok) => {
    expect(validateRow('settings', { key: 'newTaskFollowup', value }) === true).toBe(ok)
  })
})

describe('layoutRepository: the layout order', () => {
  it('getAll is in the picker’s order: by sortOrder, then oldest first, then id', async () => {
    await db.layouts.bulkAdd([
      layoutRow(1, { sortOrder: 2 }), layoutRow(2, { sortOrder: 0, createdAt: LATER }),
      layoutRow(3, { sortOrder: 1 }), layoutRow(4, { sortOrder: 0 }),
    ] as unknown as WorkspaceLayout[])
    expect((await layoutRepository.getAll()).map((r) => r.layout.id)).toEqual([4, 2, 3, 1])
  })

  it('insert puts a layout after the others, whatever order it carries', async () => {
    await db.layouts.bulkAdd([layoutRow(1, { sortOrder: 3 }), layoutRow(2, { sortOrder: 1 })] as unknown as WorkspaceLayout[])
    // A row that still carries an order (e.g. a stored layout spread into it).
    const carried = { name: 'New', sortOrder: 0, columns: [], createdAt: AT, modifiedAt: AT }
    const id = await layoutRepository.insert(carried)
    expect((await db.layouts.get(id))?.sortOrder).toBe(4)
    await db.layouts.clear()
    const first = await layoutRepository.insert({ name: 'First', columns: [], createdAt: AT, modifiedAt: AT })
    expect((await db.layouts.get(first))?.sortOrder).toBe(0)
  })

  it('put keeps the stored order (a save never undoes a reorder)', async () => {
    await db.layouts.add(layoutRow(1, { sortOrder: 5 }) as unknown as WorkspaceLayout)
    await layoutRepository.put({ ...(layoutRow(1, { sortOrder: 0, name: 'Renamed' }) as unknown as WorkspaceLayout), id: 1 })
    expect(await db.layouts.get(1)).toMatchObject({ name: 'Renamed', sortOrder: 5 })
    // A row stored without one takes the given order.
    await layoutRepository.put({ ...(layoutRow(2, { sortOrder: 3 }) as unknown as WorkspaceLayout), id: 2 })
    expect((await db.layouts.get(2))?.sortOrder).toBe(3)
  })

  it('reorder numbers the given ids in order; a missing id is skipped', async () => {
    await db.layouts.bulkAdd([layoutRow(1), layoutRow(2), layoutRow(3)] as unknown as WorkspaceLayout[])
    await layoutRepository.reorder([3, 99, 1, 2])
    expect((await layoutRepository.getAll()).map((r) => [r.layout.id, r.layout.sortOrder])).toEqual([[3, 0], [1, 2], [2, 3]])
  })

  it('ensureDefault makes the first layout with order 0', async () => {
    await layoutRepository.ensureDefault()
    expect((await db.layouts.toArray()).map((l) => l.sortOrder)).toEqual([0])
  })
})

describe('listDefinitionRepository.ensureEisenhowerList', () => {
  const sourceValue = async () => (await db.settings.get('eisenhowerSource'))?.value

  it('makes the Eisenhower’s list when there is none (no filter, after the others) and names it in the setting', async () => {
    await db.listDefinitions.add(list(1, { sortOrder: 4 }) as unknown as ListDefinition)
    const id = await listDefinitionRepository.ensureEisenhowerList()
    expect(await db.listDefinitions.get(id)).toEqual({
      id, name: 'Eisenhower', sortOrder: 5, membership: { kind: 'custom', predicate: emptyPredicate() },
      sort: 'manual', grouping: 'none', owner: { eisenhower: true },
    })
    expect(await sourceValue()).toBe(`list:${id}`)
    // Again: the same list, nothing made.
    expect(await listDefinitionRepository.ensureEisenhowerList()).toBe(id)
    expect(await db.listDefinitions.count()).toBe(2)
  })

  it('a setting naming another list (or nothing) is pointed at the Eisenhower’s list that exists', async () => {
    await db.listDefinitions.bulkAdd([list(1), list(2, { owner: { eisenhower: true } })] as unknown as ListDefinition[])
    await db.settings.put({ key: 'eisenhowerSource', value: 'list:1' })
    expect(await listDefinitionRepository.ensureEisenhowerList()).toBe(2)
    expect(await sourceValue()).toBe('list:2')
    expect(await db.listDefinitions.count()).toBe(2)
  })

  it('callers at the same time make one list', async () => {
    const ids = await Promise.all([listDefinitionRepository.ensureEisenhowerList(), listDefinitionRepository.ensureEisenhowerList()])
    expect(ids[0]).toBe(ids[1])
    expect(await db.listDefinitions.count()).toBe(1)
  })
})

describe('audit: lists that belong to no layout', () => {
  it('reports them; cleanup gives each the first layout that shows it, the rest a new layout “Recovered lists” (never deletes one); a live layout’s and the Eisenhower’s are fine', async () => {
    const shows4 = [{ id: 'c', weight: 1, cells: [{ id: 'k', weight: 1, tabs: [{ id: 't', kind: 'lens', config: { listDefinitionId: 4 } }] }] }]
    await db.layouts.bulkAdd([layoutRow(1), layoutRow(2, { sortOrder: 1, columns: shows4 }), layoutRow(3, { sortOrder: 2, columns: shows4 })] as unknown as WorkspaceLayout[])
    await db.listDefinitions.bulkAdd([
      list(1, { owner: { layoutId: 1 } }), list(2, { owner: { layoutId: 9 }, sortOrder: 3 }), list(3, { owner: { eisenhower: true } }),
      list(4), list(5, { sortOrder: 1 }),
    ] as unknown as ListDefinition[])
    const report = await auditData()
    expect(report.issues).toEqual([expect.objectContaining({
      table: 'listDefinitions', fix: 'adopt-lists', field: 'owner', count: 3, ids: [2, 4, 5],
    })])
    expect(report.issues[0]!.samples!.map((x) => x.note)).toEqual(['owner layout 9 not in layouts', 'no owner', 'no owner'])
    expect(await cleanupIssues(report.issues)).toBe(3)
    const lists = await db.listDefinitions.orderBy('id').toArray()
    expect(lists.map((d) => d.owner)).toEqual([{ layoutId: 1 }, { layoutId: 4 }, { eisenhower: true }, { layoutId: 2 }, { layoutId: 4 }])
    const recovered = await db.layouts.get(4)
    expect(recovered).toMatchObject({ name: 'Recovered lists', sortOrder: 3 })
    // One cell of list tabs, in the list order.
    expect(recovered!.columns[0]!.cells[0]!.tabs).toEqual([
      { id: 'tab-1', kind: 'lens', config: { listDefinitionId: 5 } },
      { id: 'tab-2', kind: 'lens', config: { listDefinitionId: 2 } },
    ])
    expect((await auditData()).issues).toEqual([])
  })

  it('an unreadable new-task follow-up setting is reported (cleanup deletes it: the default)', async () => {
    await db.settings.put({ key: 'newTaskFollowup', value: 'maybe' })
    const report = await auditData()
    expect(report.issues).toEqual([expect.objectContaining({ table: 'settings', keys: ['newTaskFollowup'], fix: 'delete' })])
  })
})

describe('kept list drafts carry the new parts', () => {
  it('a draft with an owner, a hidden filter line and the Priority grouping is read back as it was kept', () => {
    const base = list(4, { owner: { layoutId: 2 } }) as unknown as PersistedListDefinition
    const draft = { ...base, grouping: 'priority', showFilterLine: false } as PersistedListDefinition
    writeListDrafts(new Map([[4, { draft, base }]]))
    expect(readListDrafts().get(4)).toEqual({ draft, base })
  })
})
