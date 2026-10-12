import { expect, type Locator, type Page } from '@playwright/test'

const DB_NAME = 'todo2'

export interface WsTabSeed {
  id: string
  kind: 'lens' | 'calendar' | 'notes' | 'status'
  /** Lens tabs: index into `listDefinitions`. */
  listDefIdx?: number
  /** Calendar tabs: date types shown (default both). */
  dateTypes?: { due: boolean; followup: boolean }
  /** Calendar tabs: view state. */
  view?: 'month' | 'week'
  offset?: number
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

export interface WsLayoutSeed {
  name: string
  columns: WsColumnSeed[]
}

export interface WorkspaceSeed {
  /** The first layout is opened. */
  layouts: WsLayoutSeed[]
  /** Names, or a name with initials / colour. */
  people?: Array<string | { name: string; initials?: string; color?: string }>
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
    maxTasks?: number
    limitMode?: 'hard' | 'scroll'
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
    /** Marker flags. */
    urgent?: boolean
    important?: boolean
    focus?: boolean
  }>
}

/** Mirrors `emptyPredicate()` in the list-definition store. */
export function emptyPredicate(): Record<string, unknown> {
  return {
    showCompleted: false,
    personIds: null,
    statusIds: null,
    searchText: '',
    dateField: 'deadline',
    dateRangeStart: null,
    dateRangeEnd: null,
    dateRangeIncludeNoDate: false,
    hasDeadline: null,
    hasFollowup: null,
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
  const payload = { ...seed, predicate: emptyPredicate() }
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
        pinnedToDashboard: false,
        ...(def.runtimeFilter ? { runtimeFilter: def.runtimeFilter } : {}),
        ...(def.maxTasks != null ? { maxTasks: def.maxTasks } : {}),
        ...(def.limitMode ? { limitMode: def.limitMode } : {}),
      }))
    }
    let taskOrder = 0
    for (const task of seed.tasks ?? []) {
      const day = (n: number) => new Date(now.getFullYear(), now.getMonth(), now.getDate() + n)
      const todoId = await add(tx.objectStore('todos'), {
        uid: crypto.randomUUID(),
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
        createdAt: now,
        modifiedAt: now,
        sortOrder: ++taskOrder,
      })
      for (const p of task.people ?? []) await add(tx.objectStore('todoPeople'), { todoId, personId: personIds.get(p) })
      for (const t of task.tags ?? []) await add(tx.objectStore('todoTags'), { todoId, tagId: tagIds.get(t) })
    }
    tx.objectStore('layouts').clear()
    let firstId: number | null = null
    for (const layout of seed.layouts) {
      const columns = layout.columns.map((col) => ({
        id: col.id,
        weight: col.weight ?? 1,
        cells: col.cells.map((cell) => ({
          id: cell.id,
          weight: cell.weight ?? 1,
          activeTabId: cell.activeTabId ?? cell.tabs[0]?.id,
          ...(cell.collapsed ? { collapsed: true } : {}),
          tabs: cell.tabs.map((tab) => {
            if (tab.kind === 'lens') {
              const listDefinitionId = tab.listDefIdx != null ? defIds[tab.listDefIdx] : undefined
              return { id: tab.id, kind: 'lens', config: listDefinitionId != null ? { listDefinitionId } : {} }
            }
            if (tab.kind === 'calendar') {
              const viewState = tab.view != null || tab.offset != null ? { view: tab.view ?? 'month', offset: tab.offset ?? 0 } : undefined
              return { id: tab.id, kind: 'calendar', config: { dateTypes: tab.dateTypes ?? { due: true, followup: true } }, ...(viewState ? { viewState } : {}) }
            }
            return { id: tab.id, kind: tab.kind, config: {} }
          }),
        })),
      }))
      const id = await add(tx.objectStore('layouts'), { name: layout.name, columns, createdAt: now, modifiedAt: now })
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
 * Drags a tab with trusted mouse events to (x, y), checking `during` (if
 * given) before releasing. Crosses dnd-kit's 5px activation distance first.
 */
export async function dragTab(
  page: Page,
  tab: Locator,
  to: { x: number; y: number },
  during?: () => Promise<void>,
): Promise<void> {
  const box = await tab.boundingBox()
  if (!box) throw new Error('dragTab: tab has no bounding box')
  const x0 = box.x + box.width / 2
  const y0 = box.y + box.height / 2
  await page.mouse.move(x0, y0)
  await page.mouse.down()
  await page.mouse.move(x0 + 8, y0 + 8, { steps: 2 })
  await page.mouse.move(to.x, to.y, { steps: 12 })
  if (during) await during()
  await page.mouse.up()
}

export function wsListWidget(page: Page, tabId: string): Locator {
  return page.locator(`[data-list-widget="${tabId}"]`)
}

/** The stored list definitions, read straight from IndexedDB. */
export async function readListDefinitions(page: Page): Promise<Array<Record<string, unknown>>> {
  return page.evaluate(async (db) => {
    const idb = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(db)
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
    const rows = await new Promise<Array<Record<string, unknown>>>((resolve, reject) => {
      const r = idb.transaction('listDefinitions').objectStore('listDefinitions').getAll()
      r.onsuccess = () => resolve(r.result as Array<Record<string, unknown>>)
      r.onerror = () => reject(r.error)
    })
    idb.close()
    return rows
  }, DB_NAME)
}

/** The stored manual list order (`listOrders` rows), read straight from IndexedDB. */
export async function readListOrders(page: Page): Promise<Array<{ listDefinitionId: number; todoId: number; rank: number }>> {
  return page.evaluate(async (db) => {
    const idb = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(db)
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
    const rows = await new Promise<Array<{ listDefinitionId: number; todoId: number; rank: number }>>((resolve, reject) => {
      const r = idb.transaction('listOrders').objectStore('listOrders').getAll()
      r.onsuccess = () => resolve(r.result as Array<{ listDefinitionId: number; todoId: number; rank: number }>)
      r.onerror = () => reject(r.error)
    })
    idb.close()
    return rows
  }, DB_NAME)
}

/**
 * Drags a list widget row by its left edge (the grip) with trusted mouse
 * events to viewport y `toY`, checking `during` (if given) before releasing.
 */
export async function dragRow(
  page: Page,
  row: Locator,
  toY: number,
  during?: () => Promise<void>,
): Promise<void> {
  const box = await row.boundingBox()
  if (!box) throw new Error('dragRow: row has no bounding box')
  const x = box.x + 10
  const y0 = box.y + box.height / 2
  await page.mouse.move(x, y0)
  await page.mouse.down()
  await page.mouse.move(x + 2, y0 + 8, { steps: 2 })
  await page.mouse.move(x + 4, toY, { steps: 12 })
  if (during) await during()
  await page.mouse.up()
}

/**
 * The Settings modal, opened with the top bar's gear unless it is already
 * open (e.g. from a `#/settings` deep link); optionally switched to a
 * section by its label.
 */
export async function openSettings(page: Page, section?: string): Promise<Locator> {
  const dialog = page.getByRole('dialog', { name: 'Settings', exact: true })
  if (!(await dialog.isVisible())) await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await expect(dialog).toBeVisible()
  if (section) {
    await dialog.getByRole('navigation', { name: 'Settings sections' }).getByRole('button', { name: section, exact: true }).click()
    await expect(dialog.getByRole('heading', { level: 2, name: section })).toBeVisible()
  }
  return dialog
}
