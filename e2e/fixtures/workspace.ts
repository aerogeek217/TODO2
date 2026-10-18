import { expect, type Locator, type Page } from '@playwright/test'
import { createTab, WIDGET_KINDS, type LayoutTab, type WidgetKind } from '../../src/models/workspace-layout'
import { DB_NAME, readStore } from './db'
import { box, pointIn, type Point } from './geometry'

export interface WsTabSeed {
  id: string
  kind: WidgetKind
  /** Lens tabs: index into `listDefinitions`. */
  listDefIdx?: number
  /** Calendar tabs: date types shown (default both). */
  dateTypes?: { due: boolean; followup: boolean }
  /** Calendar tabs: view state. */
  view?: 'month' | 'week'
  offset?: number
  /** Eisenhower tabs: collapsed sections (view state). */
  collapsed?: Array<'do' | 'schedule' | 'delegate' | 'drop'>
  /** List / Eisenhower / dashboard tabs: the task rows' details width (view state). */
  detailsWidth?: number
  /** Dashboard tabs: the config (defaults: the app's — `createTab`). */
  dashboard?: {
    tiles?: string[]
    /** List tiles as indexes into `listDefinitions`. */
    listTileIdxs?: number[]
    sections?: Array<{ id: string; options?: Record<string, unknown> }>
  }
}

export interface WsCellSeed {
  id: string
  weight?: number
  tabs: WsTabSeed[]
  activeTabId?: string
  collapsed?: boolean
}

export interface WsColumnSeed {
  id: string
  weight?: number
  cells: WsCellSeed[]
}

export interface WsBandSeed {
  id: string
  /** Height in px (default 160). */
  height?: number
  tabs: WsTabSeed[]
  activeTabId?: string
  collapsed?: boolean
}

export interface WsLayoutSeed {
  name: string
  columns: WsColumnSeed[]
  /** The full-width band above / below the columns. */
  top?: WsBandSeed
  bottom?: WsBandSeed
}

export interface WorkspaceSeed {
  /** The first layout is opened. */
  layouts: WsLayoutSeed[]
  /** Names, or a name with initials / colour / email. */
  people?: Array<string | { name: string; initials?: string; color?: string; email?: string }>
  tags?: string[]
  /** Status names, added after the app's own. */
  statuses?: string[]
  listDefinitions?: Array<{
    name: string
    grouping?: string
    sort?: string
    /** Merged over the empty predicate; `personIds` by name via `people`. */
    predicate?: Record<string, unknown>
    /** Names of people for the predicate's `personIds`. */
    people?: string[]
    runtimeFilter?: { field: 'person' | 'status' | 'tag' }
  }>
  tasks?: Array<{
    title: string
    people?: string[]
    tags?: string[]
    isCompleted?: boolean
    /** Days from today. */
    dueInDays?: number
    followupInDays?: number
    /** Hour of the due date (default midnight). */
    dueHour?: number
    recurrence?: 'daily' | 'weekly' | 'biweekly' | 'monthly' | 'quarterly' | 'yearly'
    /** Name of a status from `statuses`. */
    status?: string
    /** Task notes (Markdown). */
    notes?: string
    /** Progress text. */
    progress?: string
    /** A fixed uid (default: a random UUID). */
    uid?: string
    /** Last modified (default: now), as a local date-time string, e.g. `2026-10-10T15:30`. */
    modifiedAt?: string
    /** Marker flags. */
    urgent?: boolean
    important?: boolean
    focus?: boolean
  }>
}

/** Mirrors `emptyPredicate()` in `models/filter-predicate`. */
export function emptyPredicate(): Record<string, unknown> {
  return {
    showCompleted: false,
    personIds: null,
    statusIds: null,
    searchText: '',
    dates: {},
    markers: null,
    tags: null,
  }
}

/**
 * Seeds layouts (replacing the app's own), list definitions, people, tags and
 * tasks straight into IndexedDB, then reloads on the workspace. The app must
 * have booted once (Dexie upgraded) — this opens the workspace (`/#/`) first.
 */
export async function seedWorkspace(page: Page, seed: WorkspaceSeed): Promise<void> {
  await page.goto('/#/')
  await page.locator('[data-ws-area]').waitFor({ state: 'visible' })
  // Every kind's new tab, as the app makes it: the seeded tabs start from these.
  const newTabs = Object.fromEntries(WIDGET_KINDS.map((kind) => [kind, createTab(kind, '')])) as Record<WidgetKind, LayoutTab>
  const payload = { ...seed, predicate: emptyPredicate(), newTabs }
  await page.evaluate(async ({ db, seed }) => {
    const idb = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(db)
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
    const add = (store: IDBObjectStore, value: unknown) => new Promise<number>((resolve, reject) => {
      const r = store.add(value)
      r.onsuccess = () => resolve(r.result as number)
      r.onerror = () => reject(r.error)
    })
    const tx = idb.transaction(['layouts', 'settings', 'listDefinitions', 'people', 'tags', 'statuses', 'todos', 'todoPeople', 'todoTags'], 'readwrite')
    const done = new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
      tx.onabort = () => reject(tx.error ?? new Error('seed aborted'))
    })
    const now = new Date()
    const personIds = new Map<string, number>()
    for (const entry of seed.people ?? []) {
      const p = typeof entry === 'string' ? { name: entry } : entry
      const row: Record<string, unknown> = { name: p.name, initials: p.initials ?? p.name.slice(0, 2).toUpperCase() }
      if (p.color) row.color = p.color
      if (p.email) row.email = p.email
      personIds.set(p.name, await add(tx.objectStore('people'), row))
    }
    const tagIds = new Map<string, number>()
    for (const name of seed.tags ?? []) {
      tagIds.set(name, await add(tx.objectStore('tags'), { name, color: '#7ec4bc' }))
    }
    const statusIds = new Map<string, number>()
    let statusOrder = 100
    for (const name of seed.statuses ?? []) {
      statusIds.set(name, await add(tx.objectStore('statuses'), { name, color: '#4caf50', icon: 'circle', sortOrder: ++statusOrder }))
    }
    const defIds: number[] = []
    let defOrder = 0
    for (const def of seed.listDefinitions ?? []) {
      const predicate: Record<string, unknown> = { ...seed.predicate, ...(def.predicate ?? {}) }
      if (def.people) predicate.personIds = def.people.map((n) => personIds.get(n))
      defIds.push(await add(tx.objectStore('listDefinitions'), {
        name: def.name,
        sortOrder: ++defOrder,
        membership: { kind: 'custom', predicate },
        sort: def.sort ?? 'manual',
        grouping: def.grouping ?? 'none',
        ...(def.runtimeFilter ? { runtimeFilter: def.runtimeFilter } : {}),
      }))
    }
    let taskOrder = 0
    for (const task of seed.tasks ?? []) {
      const day = (n: number) => new Date(now.getFullYear(), now.getMonth(), now.getDate() + n)
      const todoId = await add(tx.objectStore('todos'), {
        uid: task.uid ?? crypto.randomUUID(),
        title: task.title,
        isCompleted: task.isCompleted ?? false,
        ...(task.isCompleted ? { completedAt: now } : {}),
        ...(task.dueInDays != null ? { dueDate: new Date(day(task.dueInDays).setHours(task.dueHour ?? 0)) } : {}),
        ...(task.recurrence ? { recurrenceRule: { type: task.recurrence } } : {}),
        ...(task.followupInDays != null ? { nextFollowupAt: day(task.followupInDays) } : {}),
        ...(task.status != null ? { statusId: statusIds.get(task.status) } : {}),
        ...(task.urgent ? { urgent: true } : {}),
        ...(task.important ? { important: true } : {}),
        ...(task.focus ? { focus: true } : {}),
        ...(task.notes ? { notes: task.notes } : {}),
        ...(task.progress ? { progress: task.progress } : {}),
        createdAt: now,
        modifiedAt: task.modifiedAt ? new Date(task.modifiedAt) : now,
        sortOrder: ++taskOrder,
      })
      for (const p of task.people ?? []) await add(tx.objectStore('todoPeople'), { todoId, personId: personIds.get(p) })
      for (const t of task.tags ?? []) await add(tx.objectStore('todoTags'), { todoId, tagId: tagIds.get(t) })
    }
    tx.objectStore('layouts').clear()
    let firstId: number | null = null
    type TabSeed = (typeof seed.layouts)[number]['columns'][number]['cells'][number]['tabs'][number]
    const buildTab = (tab: TabSeed) => {
      const base = structuredClone(seed.newTabs[tab.kind])
      const out: Record<string, unknown> = { ...base, id: tab.id }
      const config = { ...(base.config as Record<string, unknown>) }
      if (tab.kind === 'lens' && tab.listDefIdx != null) {
        const listDefinitionId = defIds[tab.listDefIdx]
        if (listDefinitionId != null) config.listDefinitionId = listDefinitionId
      }
      if (tab.kind === 'calendar') {
        if (tab.dateTypes) config.dateTypes = tab.dateTypes
        if (tab.view != null || tab.offset != null) out.viewState = { view: tab.view ?? 'month', offset: tab.offset ?? 0 }
      }
      if (tab.kind === 'dashboard' && tab.dashboard) {
        const d = tab.dashboard
        if (d.tiles) config.tiles = d.tiles
        if (d.listTileIdxs) config.listTiles = d.listTileIdxs.map((i) => defIds[i]).filter((id) => id != null)
        if (d.sections) config.sections = d.sections
      }
      if (tab.kind === 'eisenhower' && tab.collapsed) out.viewState = { collapsed: tab.collapsed }
      if (tab.detailsWidth != null) out.viewState = { ...(out.viewState as object | undefined), detailsWidth: tab.detailsWidth }
      out.config = config
      return out
    }
    for (const layout of seed.layouts) {
      const columns = layout.columns.map((col) => ({
        id: col.id,
        weight: col.weight ?? 1,
        cells: col.cells.map((cell) => ({
          id: cell.id,
          weight: cell.weight ?? 1,
          activeTabId: cell.activeTabId ?? cell.tabs[0]?.id,
          ...(cell.collapsed ? { collapsed: true } : {}),
          tabs: cell.tabs.map(buildTab),
        })),
      }))
      const bands: Record<string, unknown> = {}
      for (const edge of ['top', 'bottom'] as const) {
        const band = layout[edge]
        if (!band) continue
        bands[edge] = {
          id: band.id,
          height: band.height ?? 160,
          activeTabId: band.activeTabId ?? band.tabs[0]?.id,
          ...(band.collapsed ? { collapsed: true } : {}),
          tabs: band.tabs.map(buildTab),
        }
      }
      const id = await add(tx.objectStore('layouts'), { name: layout.name, columns, ...bands, createdAt: now, modifiedAt: now })
      firstId ??= id
    }
    if (firstId != null) tx.objectStore('settings').put({ key: 'activeLayoutId', value: String(firstId) })
    await done
    idb.close()
  }, { db: DB_NAME, seed: payload })
  await page.reload()
  await page.locator('[data-ws-area]').waitFor({ state: 'visible' })
}

/** Tab id of the list widget `seedTaskList` opens. */
export const TASK_LIST_TAB = 'tasks'

type ListDefinitionSeed = NonNullable<WorkspaceSeed['listDefinitions']>[number]

/**
 * Seeds people / tags / statuses / tasks and opens one layout with a single
 * list widget (tab `TASK_LIST_TAB`) over a list named "Tasks" that shows
 * every open task in manual order — a host for task-row specs. `list`
 * overrides the list definition (grouping, predicate, runtime filter, …).
 * Returns the list widget.
 */
export async function seedTaskList(
  page: Page,
  seed: Omit<WorkspaceSeed, 'layouts' | 'listDefinitions'> & { list?: Partial<ListDefinitionSeed> },
): Promise<Locator> {
  const { list, ...rest } = seed
  await seedWorkspace(page, {
    ...rest,
    listDefinitions: [{ name: 'Tasks', ...list }],
    layouts: [{ name: 'Main', columns: [{ id: 'col', cells: [{ id: 'cell', tabs: [{ id: TASK_LIST_TAB, kind: 'lens', listDefIdx: 0 }] }] }] }],
  })
  const widget = wsListWidget(page, TASK_LIST_TAB)
  await widget.waitFor({ state: 'visible' })
  return widget
}

export function wsCell(page: Page, cellId: string): Locator {
  return page.locator(`[data-ws-cell="${cellId}"]`)
}

export function wsTab(page: Page, tabId: string): Locator {
  return page.locator(`[data-ws-tab="${tabId}"]`)
}

/** Tab ids per cell per column, read from the rendered workspace. */
export async function wsShape(page: Page): Promise<string[][][]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-ws-column]')).map((col) =>
      Array.from(col.querySelectorAll('[data-ws-cell]')).map((cell) =>
        Array.from(cell.querySelectorAll<HTMLElement>('[data-ws-tab]')).map((t) => t.dataset.wsTab ?? ''),
      ),
    ),
  )
}

/**
 * Lets go of a dnd-kit drag and waits until the page takes clicks again.
 * After a drag, dnd-kit stops every click at the document for 50 ms (so the
 * release isn't a click); a test that clicks a drop prompt sooner than any
 * person could would lose that click. Probes with a click on a scratch
 * element (stopped there, so no app listener sees it) until one gets through.
 */
export async function releaseDrag(page: Page): Promise<void> {
  await page.mouse.up()
  await page.waitForFunction(() => {
    const probe = document.createElement('div')
    let reached = false
    probe.addEventListener('click', (e) => { reached = true; e.stopPropagation() })
    document.body.appendChild(probe)
    probe.click()
    probe.remove()
    return reached
  })
}

/**
 * A trusted-mouse drag from `from` to `to` (viewport points): presses at
 * `from`, moves 8 px down in two steps — past dnd-kit's 5 px activation
 * distance — and checks `lifted` (if given), travels to `to` in 12 steps,
 * checks `during` (if given), then lets go (`releaseDrag`).
 */
export async function drag(
  page: Page,
  from: Point,
  to: Point,
  { lifted, during }: { lifted?: () => Promise<void>; during?: () => Promise<void> } = {},
): Promise<void> {
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(from.x, from.y + 8, { steps: 2 })
  if (lifted) await lifted()
  await page.mouse.move(to.x, to.y, { steps: 12 })
  if (during) await during()
  await releaseDrag(page)
}

/** A panel's header handle: the empty space between its tabs and its buttons. */
export function wsPanelHandle(page: Page, panelId: string): Locator {
  return page.locator(`[data-ws-panel-handle="${panelId}"]`)
}

/** The band at an edge. */
export function wsBand(page: Page, edge: 'top' | 'bottom'): Locator {
  return page.locator(`[data-ws-band="${edge}"]`)
}

/** Tab ids of the band at `edge` (empty when there is none). */
export async function wsBandTabs(page: Page, edge: 'top' | 'bottom'): Promise<string[]> {
  return page.evaluate((e) =>
    Array.from(document.querySelectorAll<HTMLElement>(`[data-ws-band="${e}"] [data-ws-tab]`)).map((t) => t.dataset.wsTab ?? ''),
  edge)
}

/**
 * Drags a whole panel by its header's empty space (grabbed at its centre)
 * to `to`, checking `lifted` / `during` (if given) before releasing.
 */
export async function dragPanel(
  page: Page,
  panelId: string,
  to: Point,
  checks: { lifted?: () => Promise<void>; during?: () => Promise<void> } = {},
): Promise<void> {
  await drag(page, await pointIn(wsPanelHandle(page, panelId)), to, checks)
}

/** Drags a tab (grabbed at its centre) to (x, y), checking `during` (if given) before releasing. */
export async function dragTab(page: Page, tab: Locator, to: Point, during?: () => Promise<void>): Promise<void> {
  await drag(page, await pointIn(tab), to, { during })
}

export function wsListWidget(page: Page, tabId: string): Locator {
  return page.locator(`[data-list-widget="${tabId}"]`)
}

/** The stored list definitions. */
export async function readListDefinitions(page: Page): Promise<Array<Record<string, unknown>>> {
  return readStore(page, 'listDefinitions')
}

/** The stored manual list order (`listOrders` rows). */
export async function readListOrders(page: Page): Promise<Array<{ listDefinitionId: number; todoId: number; rank: number }>> {
  return readStore(page, 'listOrders')
}

/**
 * Drags a list widget row by its left edge (the grip) to viewport y `toY`,
 * checking `during` (if given) before releasing.
 */
export async function dragRow(page: Page, row: Locator, toY: number, during?: () => Promise<void>): Promise<void> {
  const b = await box(row)
  await drag(page, { x: b.x + 10, y: b.y + b.height / 2 }, { x: b.x + 10, y: toY }, { during })
}

/**
 * Follows the `#/settings` deep link and waits for what it does on desktop:
 * the Settings modal opens (from an effect, after the route renders) and the
 * URL goes back to `#/`. From a loaded page this is a same-document hash
 * change, so `goto` returns before the modal is there — callers must not
 * look for it (or click the gear) until this resolves.
 */
export async function gotoSettingsDeepLink(page: Page): Promise<Locator> {
  await page.goto('/#/settings')
  const dialog = page.getByRole('dialog', { name: 'Settings', exact: true })
  await expect(dialog).toBeVisible()
  await expect(page).toHaveURL(/#\/$/)
  return dialog
}

/** The headed parts of the merged Settings sections, by label: their section. */
const SETTINGS_PART_SECTION: Readonly<Record<string, string>> = {
  'Task defaults': 'Tasks',
  'Completed tasks': 'Tasks',
  'File storage': 'Database',
  Backups: 'Database',
  'Import / Export': 'Database',
  'Data integrity': 'Database',
}

/**
 * The Settings modal, opened with the top bar's gear unless it is already
 * open (e.g. after `gotoSettingsDeepLink`); optionally switched to a section
 * by its label — or to a merged section's part (`Backups` → Database,
 * scrolled to its heading).
 */
export async function openSettings(page: Page, section?: string): Promise<Locator> {
  const dialog = page.getByRole('dialog', { name: 'Settings', exact: true })
  if (!(await dialog.isVisible())) await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await expect(dialog).toBeVisible()
  if (section) {
    const nav = SETTINGS_PART_SECTION[section] ?? section
    await dialog.getByRole('navigation', { name: 'Settings sections' }).getByRole('button', { name: nav, exact: true }).click()
    await expect(dialog.getByRole('heading', { level: 2, name: nav })).toBeVisible()
    if (nav !== section) await dialog.getByRole('heading', { level: 3, name: section, exact: true }).scrollIntoViewIfNeeded()
  }
  return dialog
}
