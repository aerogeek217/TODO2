import { beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../data/database'
import { prepareImportText } from '../../data/import-pipeline'
import { rowFixes, validateRow } from '../../data/import-validation'
import { layoutRepository } from '../../data/layout-repository'
import { BREAKDOWN_PRESETS, BREAKDOWN_SPLITS, breakdownPreset, type BreakdownColumn, type BreakdownConfig, type PivotConfig } from '../../models/chart-widgets'
import { emptyPredicate, type TodoPredicate } from '../../models/filter-predicate'
import { NUMBER_NAME_MAX, type NumberConfig, type TrendTabConfig } from '../../models/glance-widgets'
import type { IconValue } from '../../models/icon'
import type { PulseTabConfig } from '../../models/pulse-config'
import { REVIEW_SORTS } from '../../models/review'
import {
  HUE_NAMES, LENS_SWITCH_KINDS, LIST_ZOOMS, TAB_NAME_MAX, WIDGET_KINDS,
  type PersistedWorkspaceLayout, type TabConfigOf, type WidgetKind, type WorkspaceLayout,
} from '../../models/workspace-layout'
import { buildJsonExport } from '../../services/data-files'
import { useListDefinitionStore } from '../../stores/list-definition-store'
import { useSettingsStore } from '../../stores/settings-store'
import { useTagStore } from '../../stores/tag-store'
import { useUndoStore } from '../../stores/undo-store'
import { settleLayoutWrites, useWorkspaceStore } from '../../stores/workspace-store'
import { configPatch } from '../../utils/config-patch'
import { getTab, layoutTabs } from '../../utils/workspace-layout-queries'
import { resetDb } from '../helpers'
import { emptyBody } from '../helpers/layout-builders'
import { resetStores } from '../store-tracking'

/**
 * Every layout row the workspace store writes is one the import accepts
 * (cr34 T2): after each action that writes a layout, the stored row passes
 * the layout check with nothing to fix, and a full export of the data
 * imports back with no warning. One row that didn't made every export,
 * backup and the sync file unreadable (cr34 D1: a Number renamed past 80
 * characters) — the import repairs such a row now, but a row the app wrote
 * should never need it.
 *
 * The actions are the store's own, called as the components call them: Add
 * widget for every kind at every kind of place, Name and icon…, Change
 * widget, each editor's Save (a patch of the keys that changed) with its
 * fields at their longest, the ⋯ menus' settings, view state, and the cell
 * and layout edits.
 */

const T0 = new Date('2026-09-01T09:00:00.000Z')
const ws = () => useWorkspaceStore.getState()
const working = (): PersistedWorkspaceLayout => {
  const layout = ws().working
  if (!layout) throw new Error('no open layout')
  return layout
}
const tabOf = (id: string) => {
  const tab = getTab(working(), id)
  if (!tab) throw new Error(`no tab ${id}`)
  return tab
}
const firstCell = () => working().cells[0]!.id

/** Opens a new, empty layout; returns its id. */
async function open(): Promise<number> {
  const layout: Omit<WorkspaceLayout, 'id'> = { sortOrder: 0, name: 'Daily', createdAt: T0, modifiedAt: T0, ...emptyBody() }
  const id = await layoutRepository.insert(layout)
  await layoutRepository.setActiveId(id)
  await ws().init()
  return id
}

/** Every stored layout row passes the layout check with nothing to fix. */
async function expectStoredValid(after: string): Promise<void> {
  await settleLayoutWrites()
  expect(ws().writeFailed, after).toBe(false)
  for (const row of await db.layouts.toArray()) {
    expect(validateRow('layouts', row), `${after}: layout “${row.name}”`).toBe(true)
    expect(rowFixes('layouts', row), `${after}: layout “${row.name}”`).toEqual([])
  }
}

/** A full export of the data imports back, with no warning. */
async function expectExportImports(after: string): Promise<void> {
  await settleLayoutWrites()
  const prepared = prepareImportText(await buildJsonExport())
  if (!prepared.ok) throw new Error(`${after}: ${prepared.error}`)
  expect(prepared.warnings, after).toEqual([])
}

/** Adds a widget of `kind` as a tab of the first cell (a list tab with a new list of this layout's); returns the tab's id. */
async function add(kind: WidgetKind, layoutId: number): Promise<string> {
  const target = working().cells.length === 0 ? { kind: 'layout' as const } : { kind: 'cell' as const, cellId: firstCell() }
  const seed = kind === 'lens'
    ? { listDefinitionId: await useListDefinitionStore.getState().add({ name: `List ${layoutTabs(working()).length + 1}`, owner: { layoutId } }) }
    : undefined
  const id = ws().addWidget(kind, target, seed)
  if (!id) throw new Error(`no ${kind} tab added`)
  return id
}

/** An editor's Save: the keys of `edited` that differ from the stored config, as one config patch. */
function save<K extends WidgetKind>(tabId: string, kind: K, edit: (config: TabConfigOf<K>) => TabConfigOf<K>): void {
  const tab = tabOf(tabId)
  if (tab.kind !== kind) throw new Error(`tab ${tabId} is a ${tab.kind}`)
  const stored = tab.config as TabConfigOf<K>
  ws().patchTabConfig(tabId, kind, configPatch<TabConfigOf<K>>(stored, edit(stored)))
}

/** `config` without `keys` (an editor dropping a setting: the patch then holds the key as `undefined`). */
function without<C extends object, K extends keyof C>(config: C, ...keys: K[]): Omit<C, K> {
  return Object.fromEntries(Object.entries(config).filter(([k]) => !(keys as PropertyKey[]).includes(k))) as Omit<C, K>
}

/** The longest text a name field of a Number / chart editor takes. */
const LONGEST = 'N'.repeat(NUMBER_NAME_MAX)
/** A filter with a chip of every sort, as the Graphical editor writes it. */
const CHIPS: TodoPredicate = {
  ...emptyPredicate(), personIds: [1, 0], statusIds: [2], tags: [3], searchText: 'invoice',
  markers: [{ values: ['urgent'] }, { values: ['focus'], not: true }],
  dates: { deadline: { match: 'range', start: null, end: { kind: 'offset', days: 7 }, includeNoDate: true }, modified: { match: 'range', start: { kind: 'offset', days: -30 }, end: null, not: true } },
  negate: { tags: true },
}
/** A filter as the Expression editor writes it. */
const EXPRESSION: TodoPredicate = {
  ...emptyPredicate(),
  expression: { kind: 'and', items: [{ kind: 'or', items: [{ kind: 'person', id: 1 }, { kind: 'tag', id: 3 }] }, { kind: 'not', item: { kind: 'status', id: 2 } }, { kind: 'text', text: 'q4' }] },
}

beforeEach(async () => {
  await resetDb()
  resetStores()
  useUndoStore.getState().clear()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

describe('every layout write path of the workspace store stores rows import accepts', () => {
  it('Add widget: every kind, as the first cell, a tab, a split on each side and a row or column at each edge', async () => {
    const layoutId = await open()
    for (const kind of WIDGET_KINDS) {
      await add(kind, layoutId)
      await expectStoredValid(`added ${kind} as a tab`)
    }
    for (const [i, kind] of WIDGET_KINDS.entries()) {
      const side = (['left', 'right', 'top', 'bottom'] as const)[i % 4]!
      const seed = kind === 'lens' ? { listDefinitionId: await useListDefinitionStore.getState().add({ name: `Split ${i}`, owner: { layoutId } }) } : undefined
      expect(ws().addWidget(kind, { kind: 'split', cellId: firstCell(), side }, seed), `${kind} split ${side}`).not.toBeNull()
      await expectStoredValid(`added ${kind} in a split ${side}`)
      expect(ws().addWidget(kind === 'lens' ? 'notes' : kind, { kind: 'insert', edge: side }), `${kind} insert ${side}`).not.toBeNull()
      await expectStoredValid(`added ${kind} in a new track at the ${side}`)
    }
    await expectExportImports('every kind added')
  })

  it('Add widget with what its defaults read from: Settings’ badge ranges at each value, Project tags, every Breakdown preset', async () => {
    const layoutId = await open()
    const projects = [await useTagStore.getState().add('Project: Atlas'), await useTagStore.getState().add('Project: Borealis')]
    expect(projects.every((id) => typeof id === 'number')).toBe(true)
    for (const tabBadges of [{ due: 3, followup: 0 }, { due: 'off', followup: 'overdue' }, { due: 'overdue', followup: 'off' }, { due: 'off', followup: 'off' }, { due: 30, followup: 30 }] as const) {
      useSettingsStore.setState({ tabBadges })
      for (const preset of BREAKDOWN_PRESETS) {
        expect(ws().addWidget('breakdown', { kind: 'layout' }, { breakdown: breakdownPreset(preset) })).not.toBeNull()
      }
      for (const kind of ['neglect', 'pulse', 'number', 'pivot'] as const) await add(kind, layoutId)
      await expectStoredValid(`added with badge ranges ${JSON.stringify(tabBadges)}`)
    }
    await expectExportImports('added with every default')
  })

  // The names Name and icon… takes: its field holds up to `TAB_NAME_MAX` characters, for every kind.
  const NAMES = ['', '   ', 'Inbox', '  padded  ', 'Emoji 🚀 name', 'x'.repeat(NUMBER_NAME_MAX), 'x'.repeat(NUMBER_NAME_MAX + 1), 'x'.repeat(120), 'x'.repeat(TAB_NAME_MAX)]
  /** The kinds whose name is their config's (`NUMBER_NAME_MAX` / `CHART_NAME_MAX`, 80), not the tab's own (200). */
  const CONFIG_NAMED: readonly WidgetKind[] = ['number', 'breakdown', 'pivot', 'trend']

  it.each(WIDGET_KINDS.filter((k) => !CONFIG_NAMED.includes(k)))('Name and icon…: a %s tab renamed with every name its field takes', async (kind) => {
    const layoutId = await open()
    const id = await add(kind, layoutId)
    for (const name of NAMES) {
      await ws().renameTab(id, name)
      await expectStoredValid(`${kind} renamed to ${name.length} characters`)
    }
    await expectExportImports(`${kind} renamed`)
  })

  it.each(CONFIG_NAMED)('Name and icon…: a %s tab renamed with a name of up to 80 characters', async (kind) => {
    const layoutId = await open()
    const id = await add(kind, layoutId)
    for (const name of NAMES.filter((n) => n.length <= NUMBER_NAME_MAX)) {
      await ws().renameTab(id, name)
      await expectStoredValid(`${kind} renamed to ${name.length} characters`)
    }
    await expectExportImports(`${kind} renamed`)
  })

  // cr34 D1, batch C: `renameTab` writes the field's text into `config.name` unclamped, so a
  // name of 81 – 200 characters stores a row the layout check rejects. Batch C clamps it where
  // it is written (`stores/workspace-store.ts`, not this batch's file): once that is merged
  // this test passes, `it.fails` then reports it — make it a plain `it.each`.
  it.fails.each(CONFIG_NAMED)('Name and icon…: a %s tab renamed with a name of 81 – 200 characters [fails until batch C clamps the name in renameTab]', async (kind) => {
    const layoutId = await open()
    const id = await add(kind, layoutId)
    for (const name of NAMES.filter((n) => n.length > NUMBER_NAME_MAX)) {
      await ws().renameTab(id, name)
      await expectStoredValid(`${kind} renamed to ${name.length} characters`)
    }
  })

  it('Name and icon…: every kind of icon on every kind of tab, and none again', async () => {
    const layoutId = await open()
    const icons: Array<IconValue | null> = [{ kind: 'none' }, { kind: 'line', key: 'flag' }, { kind: 'emoji', emoji: '🚀' }, { kind: 'emoji', emoji: '👩‍👩‍👧‍👦', show: 'color' }, null]
    for (const kind of WIDGET_KINDS) {
      const id = await add(kind, layoutId)
      for (const icon of icons) {
        ws().setTabIcon(id, icon)
        await expectStoredValid(`${kind} icon ${JSON.stringify(icon)}`)
      }
    }
    await expectExportImports('icons set')
  })

  it('Change widget: every kind to every other kind and back, keeping its name and icon', async () => {
    const layoutId = await open()
    const listId = await useListDefinitionStore.getState().add({ name: 'Kept', owner: { layoutId } })
    const seedFor = (kind: WidgetKind) => (kind === 'lens' ? { listDefinitionId: listId } : undefined)
    const id = await add('notes', layoutId)
    await ws().renameTab(id, 'Scratch')
    ws().setTabIcon(id, { kind: 'emoji', emoji: '📌' })
    for (const from of WIDGET_KINDS) {
      for (const to of WIDGET_KINDS) {
        if (from === to) continue
        ws().changeTabKind(id, from, seedFor(from))
        ws().changeTabKind(id, to, seedFor(to))
        await expectStoredValid(`changed ${from} to ${to}`)
      }
    }
    await expectExportImports('kinds changed')
  })

  it('a Number editor’s Save: every shape, its fields at their longest, both filter forms', async () => {
    const layoutId = await open()
    const listId = await useListDefinitionStore.getState().add({ name: 'Followed', owner: { layoutId } })
    await add('lens', layoutId)
    const id = await add('number', layoutId)
    const edits: Array<[string, (c: NumberConfig) => NumberConfig]> = [
      ['a long name, colors, lit above', (c) => ({ ...c, name: LONGEST, color: '#7ec4bc', unlitColor: '#ABC', litWhen: 'above', litAt: 1_000_000, filter: CHIPS })],
      ['lit below 0, compared with last week, a breakdown', (c) => ({ ...c, litWhen: 'below', litAt: 0, compare: 'lastWeek', breakdown: 'priority', filter: EXPRESSION })],
      ['never lit, no comparison', (c) => ({ ...without(c, 'litAt', 'color', 'unlitColor'), litWhen: 'never', compare: 'none', breakdown: 'none', name: '' })],
      ['a share of a second filter', (c) => ({ ...c, show: 'share', of: CHIPS })],
      ['a share of every open task', (c) => ({ ...without(c, 'of'), show: 'share' })],
      ['the oldest by due date', (c) => ({ ...without(c, 'of'), show: 'oldest', oldestBy: 'deadline' })],
      ['a goal: at most, by the week', (c) => ({ ...without(c, 'oldestBy'), show: 'goal', goal: { atMost: 1_000_000, period: 'week' } })],
      ['a goal: at least', (c) => ({ ...c, goal: { atLeast: 0 } })],
      ['a group of six, each named at the limit', (c) => ({ ...without(c, 'goal'), show: 'group',
        items: Array.from({ length: 6 }, (_, i) => ({ name: LONGEST, filter: i % 2 ? CHIPS : EXPRESSION, ...(i % 3 ? { color: '#f5c842' } : {}) })),
      })],
      ['a group of one', (c) => ({ ...c, items: [{ name: '', filter: emptyPredicate() }] })],
      ['following a list not yet picked', (c) => ({ ...without(c, 'items'), show: 'list' })],
      ['following a list', (c) => ({ ...c, show: 'list', list: { listDefinitionId: listId } })],
      ['a count again', (c) => ({ ...without(c, 'list'), show: 'count', name: 'Open' })],
    ]
    for (const [what, edit] of edits) {
      save(id, 'number', edit)
      await expectStoredValid(`a Number saved as ${what}`)
    }
    await expectExportImports('a Number edited')
  })

  it('a chart editor’s Save: a Breakdown’s split, style and columns; a Pivot; Created vs completed', async () => {
    const layoutId = await open()
    const breakdown = await add('breakdown', layoutId)
    const column = (i: number): BreakdownColumn => (
      { id: `col-${i}abcde`, name: LONGEST, color: '#e86bf0', filter: i % 2 ? CHIPS : EXPRESSION, ...(i % 2 ? { litWhen: 'above', litAt: 1_000_000 } : { litWhen: 'never' }) }
    )
    const breakdownEdits: Array<[string, (c: BreakdownConfig) => BreakdownConfig]> = [
      ...BREAKDOWN_SPLITS.map((splitBy): [string, (c: BreakdownConfig) => BreakdownConfig] => [`split by ${splitBy}`, (c) => ({ ...c, splitBy })]),
      ['a long name, a donut, the oldest by due date', (c) => ({ ...c, name: LONGEST, style: 'donut', show: 'oldest', oldestBy: 'due', showNone: false, filter: CHIPS })],
      ['counts again, stacked', (c) => ({ ...without(c, 'oldestBy'), show: 'count', style: 'stacked', filter: EXPRESSION })],
      ['four columns, each named at the limit', (c) => ({ ...c, columns: [0, 1, 2, 3].map(column) })],
      ['no columns', (c) => ({ ...c, columns: [], name: '' })],
    ]
    for (const [what, edit] of breakdownEdits) {
      save(breakdown, 'breakdown', edit)
      await expectStoredValid(`a Breakdown saved as ${what}`)
    }
    const pivot = await add('pivot', layoutId)
    for (const rows of BREAKDOWN_SPLITS) {
      save(pivot, 'pivot', (c: PivotConfig) => ({ ...c, name: LONGEST, rows, cols: BREAKDOWN_SPLITS[(BREAKDOWN_SPLITS.indexOf(rows) + 1) % BREAKDOWN_SPLITS.length]!, filter: rows === 'people' ? CHIPS : EXPRESSION }))
      await expectStoredValid(`a Pivot saved with rows by ${rows}`)
    }
    const trend = await add('trend', layoutId)
    const trendEdits: Array<(c: TrendTabConfig) => TrendTabConfig> = [
      (c) => ({ ...c, name: LONGEST, show: 'burndown', range: '12w', filter: CHIPS }),
      (c) => ({ ...c, show: 'cumulative', range: '4w', filter: EXPRESSION }),
      (c) => ({ ...without(c, 'name', 'filter'), show: 'bars', range: '14d' }),
    ]
    for (const edit of trendEdits) {
      save(trend, 'trend', edit)
      await expectStoredValid('Created vs completed saved')
    }
    await expectExportImports('charts edited')
  })

  it('Project pulse’s editor and tag picks, the Calendar’s date types and the Neglect map’s settings', async () => {
    const layoutId = await open()
    const pulse = await add('pulse', layoutId)
    const pulseEdits: Array<(c: PulseTabConfig) => PulseTabConfig> = [
      (c) => ({ ...c, tagIds: [3, 1, 2], late: { name: LONGEST, filter: CHIPS }, stale: { name: LONGEST, filter: EXPRESSION } }),
      (c) => ({ ...c, late: { name: 'behind' }, stale: { name: '' } }),
      (c) => ({ ...without(c, 'late', 'stale'), tagIds: [] }),
    ]
    for (const edit of pulseEdits) {
      save(pulse, 'pulse', edit)
      await expectStoredValid('Project pulse saved')
    }
    const calendar = await add('calendar', layoutId)
    for (const dateTypes of [{ due: false, followup: true }, { due: false, followup: false }, { due: true, followup: true }]) {
      ws().patchTabConfig(calendar, 'calendar', { dateTypes })
      await expectStoredValid('Calendar date types')
    }
    const neglect = await add('neglect', layoutId)
    for (const patch of [{ colourBy: { kind: 'people' as const } }, { colourBy: { kind: 'tags' as const, tagIds: [2, 9] } }, { colourBy: { kind: 'none' as const } }, { untouchedDays: 7 }, { untouchedDays: 30 }]) {
      ws().patchTabConfig(neglect, 'neglect', patch)
      await expectStoredValid(`Neglect map ${JSON.stringify(patch)}`)
    }
    await expectExportImports('settings changed')
  })

  it('view state: the lens switch of every kind that has one, a list’s zoom and width, the Calendar’s view, the sorts', async () => {
    const layoutId = await open()
    const ids = new Map<WidgetKind, string>()
    for (const kind of WIDGET_KINDS) ids.set(kind, await add(kind, layoutId))
    const id = (kind: WidgetKind) => ids.get(kind)!
    for (const kind of LENS_SWITCH_KINDS) {
      for (const ignoreLens of [true, false]) {
        await ws().patchTabViewState(id(kind), kind, { ignoreLens })
        await expectStoredValid(`${kind} lens switch ${ignoreLens}`)
      }
    }
    for (const zoom of LIST_ZOOMS) await ws().patchTabViewState(id('lens'), 'lens', { zoom })
    for (const detailsWidth of [0, 262.4, 4000, 9000]) await ws().patchTabViewState(id('lens'), 'lens', { detailsWidth })
    await expectStoredValid('a list’s zoom and details width')
    for (const patch of [{ view: 'week' as const }, { view: 'month' as const, offset: 500 }, { offset: -500 }, { titles: true }, { titles: false, offset: 0 }]) {
      await ws().patchTabViewState(id('calendar'), 'calendar', patch)
      await expectStoredValid(`Calendar view ${JSON.stringify(patch)}`)
    }
    for (const { sort } of REVIEW_SORTS) await ws().patchTabViewState(id('review'), 'review', { sort })
    await expectStoredValid('the Review widget’s sort')
    for (const split of BREAKDOWN_SPLITS) {
      await ws().patchTabViewState(id('breakdown'), 'breakdown', { sorts: { [split]: { by: 'due', reversed: true }, people: { by: 'name' } } })
    }
    await ws().patchTabViewState(id('pivot'), 'pivot', { sort: { by: 'person-12', reversed: true } })
    await ws().patchTabViewState(id('pivot'), 'pivot', { sort: { by: 'total' } })
    await expectStoredValid('the charts’ sorts')
    await expectExportImports('view state changed')
  })

  it('the cell and layout edits: split, insert, merge, move, collapse, resize, close; rename, hue, icon, duplicate, new', async () => {
    const layoutId = await open()
    for (const kind of ['notes', 'calendar', 'number', 'number'] as const) await add(kind, layoutId)
    const [notes, calendar, numberA, numberB] = layoutTabs(working()).map((t) => t.id) as [string, string, string, string]
    const steps: Array<[string, () => unknown]> = [
      ['split right', () => ws().splitCell(firstCell(), 'right')],
      ['split below', () => ws().splitCell(firstCell(), 'bottom')],
      ['split above', () => ws().splitCell(firstCell(), 'top')],
      ['split left', () => ws().splitCell(firstCell(), 'left')],
      ['insert a row at the top', () => ws().insertTrack('top')],
      ['insert a row at the bottom', () => ws().insertTrack('bottom')],
      ['insert a column at the left', () => ws().insertTrack('left')],
      ['insert a column at the right', () => ws().insertTrack('right')],
      // A Number alone in a full-width row: a fit row, then given a height and cleared.
      ['move a Number to its own row', () => ws().moveTab(numberA, { kind: 'insert', edge: 'top' })],
      ['move a tab into a split', () => ws().moveTab(calendar, { kind: 'split', cellId: working().cells.at(-1)!.id, side: 'right' })],
      ['move a tab to a new column', () => ws().moveTab(numberB, { kind: 'insert', edge: 'right' })],
      ['move a cell to the layout’s end', () => ws().movePanel(working().cells[0]!.id, { kind: 'layout' })],
      ['switch the active tab', () => ws().setActiveTab(notes)],
      ['collapse every row', () => ws().setTrackCollapsed(working().grid.rows.map((r) => r.id), true)],
      ['expand them', () => ws().setTrackCollapsed(working().grid.rows.map((r) => r.id), false)],
      ['resize every track', () => ws().setTrackSizes(Object.fromEntries([...working().grid.columns, ...working().grid.rows].map((t, i) => [t.id, 100 + i * 37.5])))],
      ['a live resize and its end', async () => {
        await ws().setTrackSizes({ [working().grid.columns[0]!.id]: 412.25 }, { live: true })
        await ws().endResize()
      }],
      ['give a row a height (fitPx) and clear it', async () => {
        const row = working().grid.rows[0]!
        await ws().copyTrackSizes({ ...working(), grid: { ...working().grid, rows: working().grid.rows.map((r) => (r.id === row.id ? { ...r, fitPx: 96 } : r)) } }, ['rows'])
        await settleLayoutWrites()
        await ws().clearTrackFitPx(row.id)
      }],
      ['merge two cells that make a rectangle', () => {
        const cells = working().cells
        for (const a of cells) for (const b of cells) if (a !== b && ws().mergeCells(a.id, b.id)) return
      }],
      ['close a tab', () => ws().closeTab(calendar)],
      ['close every cell but one', () => { while (working().cells.length > 1) ws().closeCell(working().cells.at(-1)!.id) }],
      ['rename the layout, with a hue and an icon', () => ws().rename(layoutId, `  ${'L'.repeat(150)}  `, HUE_NAMES[0], { kind: 'emoji', emoji: '🗂️' })],
      ['rename it with a custom hue and no icon', () => ws().rename(layoutId, 'Daily', '#7ec4bc', { kind: 'none' })],
      ['clear its hue', () => ws().rename(layoutId, 'Daily', null)],
    ]
    for (const [what, step] of steps) {
      await step()
      await expectStoredValid(what)
    }
    expect(await ws().duplicateLayout('Copy of Daily')).not.toBeNull()
    await expectStoredValid('Duplicate layout')
    expect(await ws().createLayout('Fresh')).not.toBeNull()
    await add('pivot', ws().activeLayoutId!)
    await expectStoredValid('New layout')
    await expectExportImports('the cell and layout edits')
  })

  it('undo and redo of layout edits write valid rows too', async () => {
    const layoutId = await open()
    const number = await add('number', layoutId)
    await add('lens', layoutId)
    save(number, 'number', (c) => ({ ...c, show: 'group', items: [{ name: LONGEST, filter: CHIPS }] }))
    ws().splitCell(firstCell(), 'right')
    ws().closeTab(number)
    await settleLayoutWrites()
    const undo = useUndoStore.getState()
    for (let i = 0; i < 4; i++) {
      await undo.undo()
      await expectStoredValid(`undo ${i + 1}`)
    }
    for (let i = 0; i < 4; i++) {
      await undo.redo()
      await expectStoredValid(`redo ${i + 1}`)
    }
    await expectExportImports('undo and redo')
  })
})
