import { expect, type Locator, type Page } from '@playwright/test'
import { createTab, WIDGET_KINDS, type LayoutTab, type WidgetKind } from '../../src/models/workspace-layout'
import { DB_NAME, readStore } from './db'
import { box, pointIn, type Point } from './geometry'

export interface WsTabSeed {
  id: string
  kind: WidgetKind
  /** List tabs: index into `listDefinitions`. (The Eisenhower's list is a setting: `WorkspaceSeed.eisenhower`.) */
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

/** The app-wide Eisenhower panes (a filter is merged over the empty predicate). */
export type EisenhowerPanesSeed = Partial<Record<'do' | 'schedule' | 'delegate' | 'drop', { name?: string; filter?: Record<string, unknown> }>>

export interface WorkspaceSeed {
  /** The first layout is opened. */
  layouts: WsLayoutSeed[]
  /**
   * The app-wide Eisenhower settings (every Eisenhower tab and the dashboard
   * section): its own list (index into `listDefinitions` — that list is
   * made the Eisenhower's, a hidden list; none = the one the app made, with
   * no filter) and its custom panes.
   */
  eisenhower?: { listDefIdx?: number; panes?: EisenhowerPanesSeed }
  /** Names, or a name with initials / colour / email. */
  people?: Array<string | { name: string; initials?: string; color?: string; email?: string }>
  tags?: string[]
  /** Status names, added after the app's own. */
  statuses?: string[]
  listDefinitions?: Array<{
    name: string
    grouping?: string
    sort?: string
    sortDirection?: 'asc' | 'desc'
    /** Merged over the empty predicate; `personIds` by name via `people`. */
    predicate?: Record<string, unknown>
    /** Names of people for the predicate's `personIds`. */
    people?: string[]
    runtimeFilter?: { field: 'person' | 'status' | 'tag' }
    /** `false` hides the list's filter line. */
    showFilterLine?: false
    /** The layout (index into `layouts`) that owns the list; default: the first that shows it, else the first. */
    layoutIdx?: number
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
    /** Last modified this many days from now (negative = ago), at the current time of day. */
    modifiedInDays?: number
    /** Completed this many days from now (negative = ago), at the current time of day; implies `isCompleted`. */
    completedInDays?: number
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
 * Seeds layouts and list definitions (replacing the app's own), people, tags and
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
    const get = (store: IDBObjectStore, key: number) => new Promise<Record<string, unknown>>((resolve, reject) => {
      const r = store.get(key)
      r.onsuccess = () => resolve(r.result as Record<string, unknown>)
      r.onerror = () => reject(r.error)
    })
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
    // The seed's lists replace the app's own (the Eisenhower's list it made
    // at launch): the app makes that again on the reload unless the seed
    // names one (`eisenhower.listDefIdx`).
    tx.objectStore('listDefinitions').clear()
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
        ...(def.sortDirection ? { sortDirection: def.sortDirection } : {}),
        grouping: def.grouping ?? 'none',
        ...(def.runtimeFilter ? { runtimeFilter: def.runtimeFilter } : {}),
        ...(def.showFilterLine === false ? { showFilterLine: false } : {}),
        ...(seed.eisenhower?.listDefIdx === defIds.length ? { owner: { eisenhower: true } } : {}),
      }))
    }
    let taskOrder = 0
    for (const task of seed.tasks ?? []) {
      const day = (n: number) => new Date(now.getFullYear(), now.getMonth(), now.getDate() + n)
      const atDay = (n: number) => {
        const d = new Date(now)
        d.setDate(d.getDate() + n)
        return d
      }
      const completed = task.isCompleted === true || task.completedInDays != null
      const modifiedAt = task.modifiedInDays != null ? atDay(task.modifiedInDays) : task.modifiedAt ? new Date(task.modifiedAt) : now
      const todoId = await add(tx.objectStore('todos'), {
        uid: task.uid ?? crypto.randomUUID(),
        title: task.title,
        isCompleted: completed,
        ...(completed ? { completedAt: task.completedInDays != null ? atDay(task.completedInDays) : now } : {}),
        ...(task.dueInDays != null ? { dueDate: new Date(day(task.dueInDays).setHours(task.dueHour ?? 0)) } : {}),
        ...(task.recurrence ? { recurrenceRule: { type: task.recurrence } } : {}),
        ...(task.followupInDays != null ? { nextFollowupAt: day(task.followupInDays) } : {}),
        ...(task.status != null ? { statusId: statusIds.get(task.status) } : {}),
        ...(task.urgent ? { urgent: true } : {}),
        ...(task.important ? { important: true } : {}),
        ...(task.focus ? { focus: true } : {}),
        ...(task.notes ? { notes: task.notes } : {}),
        ...(task.progress ? { progress: task.progress } : {}),
        // A task changed days ago was created no later than that.
        createdAt: task.modifiedInDays != null && modifiedAt < now ? modifiedAt : now,
        modifiedAt,
        sortOrder: ++taskOrder,
      })
      for (const p of task.people ?? []) await add(tx.objectStore('todoPeople'), { todoId, personId: personIds.get(p) })
      for (const t of task.tags ?? []) await add(tx.objectStore('todoTags'), { todoId, tagId: tagIds.get(t) })
    }
    tx.objectStore('layouts').clear()
    let firstId: number | null = null
    const layoutIds: number[] = []
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
      const id = await add(tx.objectStore('layouts'), { name: layout.name, sortOrder: seed.layouts.indexOf(layout), columns, ...bands, createdAt: now, modifiedAt: now })
      firstId ??= id
      layoutIds.push(id)
    }
    // Every list belongs to a layout (now that it has an id): `layoutIdx`'s,
    // else the first layout whose tabs or tiles show it, else the first one.
    const shownBy = (i: number) => seed.layouts.findIndex((layout) => {
      const panels = [...layout.columns.flatMap((col) => col.cells), ...(layout.top ? [layout.top] : []), ...(layout.bottom ? [layout.bottom] : [])]
      return panels.some((p) => p.tabs.some((t) => t.listDefIdx === i || (t.dashboard?.listTileIdxs ?? []).includes(i)))
    })
    for (const [i, def] of (seed.listDefinitions ?? []).entries()) {
      const listId = defIds[i]
      if (seed.eisenhower?.listDefIdx === i) continue
      const layoutId = layoutIds[def.layoutIdx ?? Math.max(0, shownBy(i))]
      if (listId == null || layoutId == null) continue
      const store = tx.objectStore('listDefinitions')
      store.put({ ...(await get(store, listId)), owner: { layoutId } })
    }
    if (firstId != null) tx.objectStore('settings').put({ key: 'activeLayoutId', value: String(firstId) })
    const eis = seed.eisenhower
    const eisListId = eis?.listDefIdx != null ? defIds[eis.listDefIdx] : undefined
    if (eisListId != null) tx.objectStore('settings').put({ key: 'eisenhowerSource', value: `list:${eisListId}` })
    if (eis?.panes) {
      const panes = Object.fromEntries(Object.entries(eis.panes).map(([q, p]) => [q, {
        ...(p?.name != null ? { name: p.name } : {}),
        ...(p?.filter ? { filter: { ...seed.predicate, ...p.filter } } : {}),
      }]))
      tx.objectStore('settings').put({ key: 'eisenhowerPanes', value: JSON.stringify(panes) })
    }
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

/** A layout's tab in the top bar, by its exact name. */
export function layoutTab(page: Page, name: string): Locator {
  const exact = new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`)
  return page.getByTestId('layout-tab').filter({ hasText: exact })
}

/** The open layout's tab in the top bar. */
export function openLayoutTab(page: Page): Locator {
  return page.locator('[data-testid="layout-tab"][aria-selected="true"]')
}

/** The layouts' names as the top bar's tabs show them, in order. */
export async function layoutTabNames(page: Page): Promise<string[]> {
  return page.getByTestId('layout-tab').allTextContents()
}

/** Opens a layout tab's menu (right-click; the open layout's when no name is given). */
export async function openLayoutTabMenu(page: Page, name?: string): Promise<Locator> {
  await (name != null ? layoutTab(page, name) : openLayoutTab(page)).click({ button: 'right' })
  const menu = page.getByRole('menu', { name: /^Layout / })
  await menu.waitFor({ state: 'visible' })
  return menu
}

/**
 * `seed` with `n` more (empty) layouts with long names after its own: their
 * tabs take the top bar's room, so a narrow window folds the filters (and
 * the tabs) whatever else the bar shows.
 */
export function withSpareLayouts(seed: WorkspaceSeed, n = 3): WorkspaceSeed {
  const spare = Array.from({ length: n }, (_, i) => ({ name: `A layout with a long name, number ${i + 1}`, columns: [] }))
  return { ...seed, layouts: [...seed.layouts, ...spare] }
}

/** Opens layout `name` from its top-bar tab, or from the picker when the tabs are folded. */
export async function switchLayout(page: Page, name: string): Promise<void> {
  if (await page.getByTestId('layout-picker').isVisible()) {
    await page.getByTestId('layout-picker').click()
    await page.getByRole('menuitemradio', { name, exact: true }).click()
  } else {
    await layoutTab(page, name).click()
  }
}

/**
 * Picks an action for the open layout (Save as new layout…, Rename…,
 * Delete layout…, Discard changes, …): from its tab's menu, or the picker's
 * when the tabs are folded.
 */
export async function openLayoutAction(page: Page, item: string): Promise<void> {
  const menu = await page.getByTestId('layout-picker').isVisible()
    ? (await page.getByTestId('layout-picker').click(), page.getByRole('menu', { name: 'Layouts' }))
    : await openLayoutTabMenu(page)
  await menu.getByRole('menuitem', { name: item, exact: true }).click()
}

/** Expects layout `name` to be the open one (its tab selected, or the picker's name). */
export async function expectOpenLayout(page: Page, name: string): Promise<void> {
  if (await page.getByTestId('layout-picker').isVisible()) {
    await expect(page.getByTestId('layout-picker')).toHaveAccessibleName(`Layout: ${name}`)
  } else {
    await expect(openLayoutTab(page)).toHaveText(name)
  }
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

/**
 * An unsaved edit to the list named `listName` made outside Edit list (as the
 * filter line's chips make them): its shared draft, with Edit list closed —
 * Edit list itself asks before it closes on an unsaved list.
 */
export async function editListDraft(page: Page, listName: string, changes: Record<string, unknown>): Promise<void> {
  await page.evaluate(async ({ name, patch }) => {
    const defs = (await import(/* @vite-ignore */ '/src/stores/list-definition-store.ts' as string)) as {
      useListDefinitionStore: { getState: () => { listDefinitions: Array<{ id: number; name: string }> } }
    }
    const drafts = (await import(/* @vite-ignore */ '/src/stores/list-draft-store.ts' as string)) as {
      useListDraftStore: { getState: () => { edit: (id: number, fn: (d: Record<string, unknown>) => Record<string, unknown>) => void } }
    }
    const def = defs.useListDefinitionStore.getState().listDefinitions.find((d) => d.name === name)
    if (!def) throw new Error(`no list “${name}”`)
    drafts.useListDraftStore.getState().edit(def.id, (d) => ({ ...d, ...patch }))
  }, { name: listName, patch: changes })
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
  Eisenhower: 'Tasks',
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
