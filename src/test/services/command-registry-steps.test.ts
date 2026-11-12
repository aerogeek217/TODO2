import { beforeEach, describe, it, expect, vi } from 'vitest'
import { createCommands, type Command, type CommandContext } from '../../services/command-registry'
import { emptyPredicate } from '../../models/filter-predicate'
import { createTab } from '../../models/workspace-layout'
import { useUIStore } from '../../stores/ui-store'
import { useSettingsStore } from '../../stores/settings-store'
import { useListWidgetStore } from '../../stores/list-widget-store'
import { useWorkspaceStore } from '../../stores/workspace-store'
import { makePerson } from '../helpers'
import { cell, grid } from '../helpers/layout-builders'
import type { Lens } from '../../utils/lens'

/**
 * The palette's second steps (3B): Go to Layout ›, Add Widget ›, New /
 * Duplicate Layout…, Lens ›, Review With ›, Theme › — what each lists, what
 * it marks, and what a leaf does.
 */

function makeContext(overrides: Partial<CommandContext> = {}): CommandContext {
  return {
    shortcuts: { openPalette: vi.fn(), closePalette: vi.fn(), openSettings: vi.fn() },
    selectionCount: 0,
    bulkSetCompleted: vi.fn(), bulkSetStatus: vi.fn(), bulkRemove: vi.fn(), getSelectedIds: () => [],
    clearAllFilters: vi.fn(), setShowCompleted: vi.fn(), getShowCompleted: () => false, setDateRange: vi.fn(),
    getTodos: () => [], focusTask: vi.fn(),
    ...overrides,
  }
}

const find = (commands: Command[], id: string) => commands.find((c) => c.id === id)
const leaves = (commands: Command[], id: string) => (find(commands, id)?.step ?? []).map((c) => ({ id: c.id, name: c.name, current: c.current === true }))

const layouts = { layouts: [{ id: 1, name: 'Daily' }, { id: 2, name: 'Planning' }], activeLayoutId: 2, stored: true }

describe('Go to Layout ›, New Layout…, Duplicate Layout…', () => {
  it('none before a layout is open', () => {
    const ids = createCommands(makeContext({ getLayouts: () => null })).map((c) => c.id)
    expect(ids).not.toContain('go-to-layout')
    expect(ids).not.toContain('layout-new')
  })

  it('each layout by name in its order, the open one marked; a pick asks LayoutControls to switch', () => {
    const commands = createCommands(makeContext({ getLayouts: () => layouts }))
    const go = find(commands, 'go-to-layout')
    expect(go).toMatchObject({ name: 'Go to Layout', category: 'layout' })
    expect(leaves(commands, 'go-to-layout')).toEqual([
      { id: 'go-to-layout-1', name: 'Daily', current: false },
      { id: 'go-to-layout-2', name: 'Planning', current: true },
    ])
    go?.step?.[0]?.action()
    expect(useUIStore.getState().layoutRequest).toEqual({ kind: 'switch', layoutId: 1 })
  })

  it('New Layout… and Duplicate Layout… ask for their name dialogs', () => {
    const commands = createCommands(makeContext({ getLayouts: () => layouts }))
    find(commands, 'layout-new')?.action()
    expect(useUIStore.getState().layoutRequest).toEqual({ kind: 'new' })
    find(commands, 'layout-duplicate')?.action()
    expect(useUIStore.getState().layoutRequest).toEqual({ kind: 'duplicate' })
    expect(commands.filter((c) => c.category === 'layout').map((c) => c.name)).toEqual(['Go to Layout', 'New Layout…', 'Duplicate Layout…'])
  })
})

describe('Add Widget ›', () => {
  it('only with a way to add one; every kind, Tasks then Insights, as the Add widget menu groups them', () => {
    expect(find(createCommands(makeContext({ getLayouts: () => layouts })), 'add-widget')).toBeUndefined()
    const addWidget = vi.fn()
    const commands = createCommands(makeContext({ getLayouts: () => layouts, addWidget }))
    const step = find(commands, 'add-widget')?.step ?? []
    expect(step.map((c) => [c.group, c.name])).toEqual([
      ['Tasks', 'List'], ['Tasks', 'Calendar'], ['Tasks', 'Review'], ['Tasks', 'Notes'],
      ['Insights', 'Number'], ['Insights', 'Breakdown'], ['Insights', 'Pivot'],
      ['Insights', 'Created vs completed'], ['Insights', 'Project pulse'], ['Insights', 'Neglect map'],
    ])
    step.find((c) => c.name === 'Number')?.action()
    expect(addWidget).toHaveBeenCalledWith('number')
    expect(commands.filter((c) => c.category === 'layout').map((c) => c.name)).toEqual(['Go to Layout', 'Add Widget', 'New Layout…', 'Duplicate Layout…'])
  })

  it('no List while the open layout isn’t stored (it can’t own a list yet)', () => {
    const commands = createCommands(makeContext({ getLayouts: () => ({ ...layouts, stored: false }), addWidget: vi.fn() }))
    expect((find(commands, 'add-widget')?.step ?? []).map((c) => c.name)).not.toContain('List')
  })
})

describe('Lens ›', () => {
  const lenses: Lens[] = [
    { id: 'l1', name: 'Mine', predicate: emptyPredicate() },
    { id: 'l2', name: 'Work', predicate: emptyPredicate() },
  ]

  it('none while no lens is defined', () => {
    expect(find(createCommands(makeContext({ getLenses: () => ({ lenses: [], activeLensId: null }) })), 'lens-pick')).toBeUndefined()
  })

  it('No lens, then each lens, the pick marked; a pick is the top bar’s, the lens put back on', async () => {
    const commands = createCommands(makeContext({ getLenses: () => ({ lenses, activeLensId: 'l2' }) }))
    expect(find(commands, 'lens-pick')).toMatchObject({ name: 'Lens', category: 'filter' })
    expect(leaves(commands, 'lens-pick')).toEqual([
      { id: 'lens-none', name: 'No lens', current: false },
      { id: 'lens-l1', name: 'Mine', current: false },
      { id: 'lens-l2', name: 'Work', current: true },
    ])
    useSettingsStore.setState({ lenses })
    useUIStore.getState().setLensLifted(true)
    find(commands, 'lens-pick')?.step?.[1]?.action()
    expect(useUIStore.getState().lensLifted).toBe(false)
    await vi.waitFor(() => expect(useSettingsStore.getState().activeLensId).toBe('l1'))
  })

  it('No lens is marked while nothing (or a lens that is gone) is picked', () => {
    const commands = createCommands(makeContext({ getLenses: () => ({ lenses, activeLensId: 'gone' }) }))
    expect(leaves(commands, 'lens-pick')[0]).toMatchObject({ name: 'No lens', current: true })
  })
})

describe('Theme ›', () => {
  it('Light / Dark / System, the current one marked; a pick sets the theme', async () => {
    const commands = createCommands(makeContext({ getThemeMode: () => 'dark' }))
    expect(find(commands, 'theme')).toMatchObject({ name: 'Theme', category: 'navigation' })
    expect(leaves(commands, 'theme')).toEqual([
      { id: 'theme-light', name: 'Light', current: false },
      { id: 'theme-dark', name: 'Dark', current: true },
      { id: 'theme-system', name: 'System', current: false },
    ])
    find(commands, 'theme')?.step?.[0]?.action()
    await vi.waitFor(() => expect(useSettingsStore.getState().themeMode).toBe('light'))
  })
})

describe('Review With ›', () => {
  const ada = makePerson({ id: 1, name: 'Ada Lovelace' })
  const zoe = makePerson({ id: 2, name: 'Zoe Park' })
  const idle = makePerson({ id: 3, name: 'Idle Person' })
  const ctx = () => makeContext({
    getPeople: () => [zoe, idle, ada],
    getOpenTaskCounts: () => new Map([[1, 2], [2, 1]]),
  })
  const T0 = new Date(0)
  const withReviewWidget = (has: boolean) => {
    const layout = { id: 1, name: 'Main', sortOrder: 0, createdAt: T0, modifiedAt: T0, ...grid([[cell('a', [createTab(has ? 'review' : 'notes', 'rv')])]]) }
    useWorkspaceStore.setState({ working: layout, saved: layout, layouts: [layout], activeLayoutId: 1 })
  }

  beforeEach(() => withReviewWidget(true))

  it('each person with open tasks, by name, their count the hint', () => {
    const step = find(createCommands(ctx()), 'review-with')?.step ?? []
    expect(find(createCommands(ctx()), 'review-with')).toMatchObject({ name: 'Review With', category: 'task' })
    expect(step.map((c) => [c.name, c.hint])).toEqual([['Ada Lovelace', '2 open tasks'], ['Zoe Park', '1 open task']])
  })

  it('a pick jumps to the Review widget with @<name> as its filter', async () => {
    find(createCommands(ctx()), 'review-with')?.step?.[0]?.action()
    await vi.waitFor(() => expect(useListWidgetStore.getState().reviewFilters.rv).toEqual({ expression: { kind: 'person', id: 1 }, showCompleted: false }))
  })

  it('not offered while no layout has a Review widget', () => {
    withReviewWidget(false)
    expect(find(createCommands(ctx()), 'review-with')).toBeUndefined()
  })

  it('none without a person who has open tasks', () => {
    expect(find(createCommands(makeContext({ getPeople: () => [idle], getOpenTaskCounts: () => new Map() })), 'review-with')).toBeUndefined()
  })
})
