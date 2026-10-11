import type { Page, Locator } from '@playwright/test'
import { emptyPredicate } from './workspace'

const DB_NAME = 'todo2'

export interface ProjectSeed {
  name: string
  positionX?: number
  positionY?: number
  tasks?: string[]
}

export interface SeedOptions {
  projects: ProjectSeed[]
}

interface SerializableSeed {
  canvasId: number
  projects: Array<{ name: string; positionX: number; positionY: number; sortOrder: number }>
  tasksByProjectName: Record<string, string[]>
}

export interface FloatingNoteSeed {
  x: number
  y: number
  width: number
  height: number
}

export interface FloatingCalendarSeed {
  x: number
  y: number
  width: number
  height: number
  orientation?: 'vertical' | 'horizontal'
  weekOffset?: number
}

export interface FloatingStatusSeed {
  x: number
  y: number
  width: number
  height: number
}

export interface ListDefinitionSeed {
  name: string
  /** Membership shape passed straight to Dexie; defaults to a custom
   *  membership with an empty predicate, which surfaces every open todo. */
  membership?: { kind: string } & Record<string, unknown>
  sort?: { kind: string } & Record<string, unknown> | string
  grouping?: { kind: string } & Record<string, unknown> | string
  pinnedToDashboard?: boolean
  /** When set, the list def renders a `RuntimeFilterPicker` that narrows on
   *  the chosen field at render time. */
  runtimeFilter?: { field: 'person' | 'project' | 'status' | 'tag'; label?: string }
}

export interface PersonSeed {
  name: string
  initials?: string
  /** Optional hex color; omitted → the person renders with the neutral fill. */
  color?: string
}

export interface ListInsetSeed {
  /** Index into the `listDefinitions` array passed to `seedCanvas`. */
  listDefIdx: number
  x: number
  y: number
  width: number
  height: number
  isCollapsed?: boolean
}

export interface CanvasSeedOptions {
  floatingNotes?: FloatingNoteSeed[]
  floatingCalendars?: FloatingCalendarSeed[]
  floatingStatus?: FloatingStatusSeed[]
  listDefinitions?: ListDefinitionSeed[]
  listInsets?: ListInsetSeed[]
  people?: PersonSeed[]
  /** Serialized `RailsState` JSON value persisted under `settings.canvasRails`. */
  canvasRails?: unknown
}

/**
 * Seed a canvas with projects + tasks via raw IndexedDB. Assumes the app has
 * already booted at least once (Dexie has run all migrations and
 * `ensureDefault()` has created the first canvas).
 *
 * Workflow: navigate, wait for canvas, write rows, reload, wait for the
 * project name to render. Tests use a fresh browser context per run, so the
 * IDB is empty at the start of each test — no manual cleanup needed.
 */
export async function seedCanvasWithProjects(
  page: Page,
  options: SeedOptions,
): Promise<void> {
  await page.goto('/')
  await page.locator('.react-flow__viewport').first().waitFor({ state: 'visible' })

  const canvasId = await page.evaluate(async (db) => {
    return await new Promise<number>((resolve, reject) => {
      const req = indexedDB.open(db)
      req.onsuccess = () => {
        const idb = req.result
        const tx = idb.transaction(['canvases'], 'readonly')
        const store = tx.objectStore('canvases')
        const all = store.getAll()
        all.onsuccess = () => {
          const rows = all.result as Array<{ id: number }>
          const first = rows[0]
          if (!first) {
            reject(new Error('seed: no canvases — app did not run ensureDefault()'))
          } else {
            resolve(first.id)
          }
          idb.close()
        }
        all.onerror = () => { reject(all.error); idb.close() }
      }
      req.onerror = () => reject(req.error)
    })
  }, DB_NAME)

  const payload: SerializableSeed = {
    canvasId,
    projects: options.projects.map((p, i) => ({
      name: p.name,
      positionX: p.positionX ?? 100 + i * 360,
      positionY: p.positionY ?? 100,
      sortOrder: i + 1,
    })),
    tasksByProjectName: Object.fromEntries(
      options.projects.map((p) => [p.name, p.tasks ?? []]),
    ),
  }

  await page.evaluate(async ({ db, seed }) => {
    return await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open(db)
      req.onsuccess = () => {
        const idb = req.result
        const tx = idb.transaction(['projects', 'todos'], 'readwrite')
        const projectStore = tx.objectStore('projects')
        const todoStore = tx.objectStore('todos')

        // Add projects sequentially so we capture each id, then add tasks.
        let i = 0
        const now = new Date()
        const next = () => {
          if (i >= seed.projects.length) return
          const p = seed.projects[i]!
          const projectReq = projectStore.add({
            name: p.name,
            canvasId: seed.canvasId,
            positionX: p.positionX,
            positionY: p.positionY,
            isCollapsed: false,
            sortOrder: p.sortOrder,
            createdAt: now,
          })
          projectReq.onsuccess = () => {
            const pid = projectReq.result as number
            const tasks = seed.tasksByProjectName[p.name] ?? []
            tasks.forEach((title, ti) => {
              todoStore.add({
                uid: crypto.randomUUID(),
                title,
                isCompleted: false,
                createdAt: now,
                modifiedAt: now,
                sortOrder: ti + 1,
                canvasId: seed.canvasId,
                projectId: pid,
              })
            })
            i += 1
            next()
          }
          projectReq.onerror = () => reject(projectReq.error)
        }
        next()

        tx.oncomplete = () => { idb.close(); resolve() }
        tx.onerror = () => { idb.close(); reject(tx.error) }
        tx.onabort = () => { idb.close(); reject(tx.error ?? new Error('seed tx aborted')) }
      }
      req.onerror = () => reject(req.error)
    })
  }, { db: DB_NAME, seed: payload })

  await page.reload()
  await page.locator('.react-flow__viewport').first().waitFor({ state: 'visible' })
  for (const p of options.projects) {
    await projectNode(page, p.name).waitFor({ state: 'visible' })
  }
}

/** Locator for a project node by visible project name. */
/** On `/list`: loads a saved list through the toolbar's Load dialog. */
export async function loadSavedList(page: Page, name: string): Promise<void> {
  await page.getByTitle('Load a saved list').click()
  await page.locator('button[class*="selectorName"]', { hasText: name }).click()
}

export function projectNode(page: Page, name: string): Locator {
  return page.locator('.react-flow__node-project').filter({ hasText: name })
}

/** Locator for the currently mounted InsertTrigger input (only one is ever
 *  in `editing` mode at a time). */
export function activeInsertInput(page: Page): Locator {
  return page.locator('input[placeholder^="New task..."]')
}

/** Floating note nodes — used as a regression signal for the Enter-chain bug:
 *  if focus leaks back to body during the chain, typing `n` fires the global
 *  "new floating note" hotkey. Asserting `count === 0` after the chain proves
 *  every keystroke landed in an input. */
export function floatingNoteNodes(page: Page): Locator {
  return page.locator('.react-flow__node-floatingNote')
}

/** Locator for a task row wrapper by its visible title. SortableTaskList wraps
 *  every row with `[data-stl-row=<id>]`; the inner TaskRow also carries
 *  `data-todo-id`, so anchoring on `[data-stl-row]` keeps counts accurate
 *  (one element per task) and clicks bubble down to the inner row's onClick. */
export function taskRowByTitle(page: Page, title: string): Locator {
  return page.locator('[data-stl-row]').filter({ hasText: title })
}

/** Click a task row's title span to fire `onSelect`. Clicking the row wrapper's
 *  bbox center can land on a chip popover trigger (`#`/`@`/date/status), so callers that need selection must aim at the title text. The
 *  title span carries `title={todo.title}` for tooltip parity, which we use as
 *  a stable, propagation-stopping selector that only fires the row's onSelect. */
export async function selectTaskRowByTitle(page: Page, title: string): Promise<void> {
  await taskRowByTitle(page, title).locator(`span[title="${title}"]`).click()
}

/** All task row wrappers across all projects on the canvas. */
export function taskRowWrappers(page: Page): Locator {
  return page.locator('[data-stl-row]')
}

/**
 * Seed a canvas with floats / list-defs / list-insets / people / rails for the
 * canvas-coverage specs. Mirrors `seedCanvasWithProjects`'s lifecycle (navigate
 * → wait for canvas → write rows → reload → wait for visible widgets) but
 * targets the canvas widgets the rail-dock and WidgetKindMenu specs need.
 *
 * Each seed slice is optional. When `listInsets` is set, `listDefinitions`
 * must include the referenced indices — the helper resolves indices to ids
 * inside the seed transaction so caller doesn't need to round-trip.
 */
export async function seedCanvas(page: Page, opts: CanvasSeedOptions): Promise<void> {
  await page.goto('/')
  await page.locator('.react-flow__viewport').first().waitFor({ state: 'visible' })

  const canvasId = await page.evaluate(async (db) => {
    return await new Promise<number>((resolve, reject) => {
      const req = indexedDB.open(db)
      req.onsuccess = () => {
        const idb = req.result
        const tx = idb.transaction(['canvases'], 'readonly')
        const store = tx.objectStore('canvases')
        const all = store.getAll()
        all.onsuccess = () => {
          const rows = all.result as Array<{ id: number }>
          const first = rows[0]
          if (!first) reject(new Error('seed: no canvases — app did not run ensureDefault()'))
          else resolve(first.id)
          idb.close()
        }
        all.onerror = () => { reject(all.error); idb.close() }
      }
      req.onerror = () => reject(req.error)
    })
  }, DB_NAME)

  const payload = {
    canvasId,
    floatingNotes: opts.floatingNotes ?? [],
    floatingCalendars: opts.floatingCalendars ?? [],
    floatingStatus: opts.floatingStatus ?? [],
    listDefinitions: (opts.listDefinitions ?? []).map((d) => ({
      ...d,
      membership: d.membership ?? { kind: 'custom', predicate: emptyPredicate() },
    })),
    listInsets: opts.listInsets ?? [],
    people: opts.people ?? [],
    canvasRails: opts.canvasRails ?? null,
  }

  await page.evaluate(async ({ db, seed }) => {
    return await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open(db)
      req.onsuccess = () => {
        const idb = req.result
        const tables = [
          'floatingNotes', 'floatingCalendars', 'floatingStatus',
          'listDefinitions', 'listInsets', 'people', 'settings',
        ]
        const tx = idb.transaction(tables, 'readwrite')

        for (const note of seed.floatingNotes) {
          tx.objectStore('floatingNotes').add({ ...note, canvasId: seed.canvasId })
        }
        for (const cal of seed.floatingCalendars) {
          tx.objectStore('floatingCalendars').add({ ...cal, canvasId: seed.canvasId })
        }
        for (const st of seed.floatingStatus) {
          tx.objectStore('floatingStatus').add({ ...st, canvasId: seed.canvasId })
        }
        for (const person of seed.people) {
          const row: Record<string, unknown> = {
            name: person.name,
            initials: person.initials ?? person.name.slice(0, 2).toUpperCase(),
          }
          if (person.color) row.color = person.color
          tx.objectStore('people').add(row)
        }

        const defIds: number[] = new Array(seed.listDefinitions.length)
        let nextDef = 0
        const addNextDef = () => {
          if (nextDef >= seed.listDefinitions.length) { addInsets(); return }
          const def = seed.listDefinitions[nextDef]!
          const row: Record<string, unknown> = {
            name: def.name,
            sortOrder: nextDef + 1,
            membership: def.membership,
            sort: def.sort ?? 'deadline',
            grouping: def.grouping ?? 'none',
            pinnedToDashboard: def.pinnedToDashboard ?? false,
          }
          if (def.runtimeFilter) row.runtimeFilter = def.runtimeFilter
          const r = tx.objectStore('listDefinitions').add(row)
          r.onsuccess = () => {
            defIds[nextDef] = r.result as number
            nextDef += 1
            addNextDef()
          }
          r.onerror = () => reject(r.error)
        }
        const addInsets = () => {
          for (const inset of seed.listInsets) {
            const defId = defIds[inset.listDefIdx]
            if (defId == null) {
              reject(new Error(`seed: listInset references missing listDefIdx ${inset.listDefIdx}`))
              return
            }
            tx.objectStore('listInsets').add({
              canvasId: seed.canvasId,
              listDefinitionId: defId,
              x: inset.x,
              y: inset.y,
              width: inset.width,
              height: inset.height,
              isCollapsed: inset.isCollapsed ?? false,
            })
          }
          if (seed.canvasRails != null) {
            // Walk the canvasRails tree once def ids are resolved and rewrite
            // any `tab.listDefIdx: number` references into the resolved
            // `tab.listDefinitionId: number` so lens tabs reference real defs.
            // Without this rewrite, `popTabAtPosition` short-circuits (no
            // listDefinitionId → returns false → tab not removed).
            const rails = JSON.parse(JSON.stringify(seed.canvasRails)) as
              Record<string, { slots?: Array<{ tabs?: Array<Record<string, unknown>> }> } | null>
            for (const side of ['left', 'right', 'top', 'bottom']) {
              const rail = rails[side]
              if (!rail) continue
              for (const slot of rail.slots ?? []) {
                for (const tab of slot.tabs ?? []) {
                  const idx = tab.listDefIdx
                  if (typeof idx === 'number') {
                    const resolved = defIds[idx]
                    if (resolved == null) {
                      reject(new Error(`seed: rails tab references missing listDefIdx ${idx}`))
                      return
                    }
                    tab.listDefinitionId = resolved
                    delete tab.listDefIdx
                  }
                }
              }
            }
            tx.objectStore('settings').put({
              key: 'canvasRails',
              value: JSON.stringify(rails),
            })
          }
        }
        addNextDef()

        tx.oncomplete = () => { idb.close(); resolve() }
        tx.onerror = () => { idb.close(); reject(tx.error) }
        tx.onabort = () => { idb.close(); reject(tx.error ?? new Error('seed tx aborted')) }
      }
      req.onerror = () => reject(req.error)
    })
  }, { db: DB_NAME, seed: payload })

  await page.reload()
  await page.locator('.react-flow__viewport').first().waitFor({ state: 'visible' })
  if (opts.floatingNotes && opts.floatingNotes.length > 0) {
    await page.locator('.react-flow__node-floatingNote').first().waitFor({ state: 'visible' })
  }
  if (opts.floatingCalendars && opts.floatingCalendars.length > 0) {
    await page.locator('.react-flow__node-floatingCalendar').first().waitFor({ state: 'visible' })
  }
  if (opts.floatingStatus && opts.floatingStatus.length > 0) {
    await page.locator('.react-flow__node-floatingStatus').first().waitFor({ state: 'visible' })
  }
  if (opts.listInsets && opts.listInsets.length > 0) {
    await page.locator('.react-flow__node-listInset').first().waitFor({ state: 'visible' })
  }
  // Wait for the first persisted rail side (if any) so the test does not race
  // the canvas-rails-store hydration. `useDefaultRails`'s gate keeps the rails
  // store empty for a beat after mount; without the wait, drag tests can fire
  // their gesture before the tab pill exists in the DOM.
  if (opts.canvasRails != null && typeof opts.canvasRails === 'object') {
    const railsObj = opts.canvasRails as Record<string, unknown>
    const firstSide = (['left', 'right', 'top', 'bottom'] as const)
      .find((side) => railsObj[side] != null)
    if (firstSide) {
      await page.locator(`[data-rail-side="${firstSide}"]`).waitFor({ state: 'visible' })
    }
  }
}

/** Locator for a floating note widget on the canvas. */
export function floatingNoteByIndex(page: Page, idx = 0): Locator {
  return page.locator('.react-flow__node-floatingNote').nth(idx)
}

/** Locator for a list-inset widget on the canvas. */
export function listInsetByIndex(page: Page, idx = 0): Locator {
  return page.locator('.react-flow__node-listInset').nth(idx)
}

/** Locator for a rail container by its side. */
export function railBySide(page: Page, side: 'left' | 'right' | 'top' | 'bottom'): Locator {
  return page.locator(`[data-rail-side="${side}"]`)
}

/** All rendered slot drop targets on the canvas (`DraggableSlot` + `CollapsedSlotStub`). */
export function railSlotDropTargets(page: Page): Locator {
  return page.locator('[data-rails-drop-id^="rails:slot:"]')
}

/** Empty-side strip center sub-zone for a given rail side (renders only while a drag is active). */
export function emptySideCenter(page: Page, side: 'left' | 'right' | 'top' | 'bottom'): Locator {
  return page.locator(`[data-rails-drop-id="rails:empty-side:${side}"]`)
}

/**
 * Drag a Playwright locator's center-top region to a target point using
 * trusted CDP mouse events — required for React Flow's drag controller, which
 * does not honor untrusted PointerEvents synthesized via `dispatchEvent`.
 *
 * Splits the gesture into many `mouse.move` steps so RF emits position-change
 * frames with `dragging: true` (the float-dock lifecycle hook needs ≥1 such
 * frame to publish `floatDrag` to ui-store and unblock DockOverlay's strips).
 */
export async function dragWidgetTo(
  page: Page,
  source: Locator,
  target: { x: number; y: number },
  opts: { headerOffsetY?: number; steps?: number } = {},
): Promise<void> {
  const headerOffsetY = opts.headerOffsetY ?? 12
  const steps = opts.steps ?? 24
  const box = await source.boundingBox()
  if (!box) throw new Error('dragWidgetTo: source has no bounding box')
  const startX = box.x + box.width / 2
  const startY = box.y + headerOffsetY
  await page.mouse.move(startX, startY)
  await page.mouse.down()
  // Initial nudge so RF's drag-threshold passes immediately.
  await page.mouse.move(startX + 4, startY + 4, { steps: 2 })
  await page.mouse.move(target.x, target.y, { steps })
  await page.mouse.up()
  // Wait for React Flow's drag controller to clear `dragging:false`. RF
  // applies the `.dragging` className to the dragged node mid-drag and
  // removes it post-mouseup; the dock dispatch chain (publish floatDrag,
  // resolve target, apply reducer) fires inside that transition. Reading
  // its absence is the deterministic post-mouseup signal the prior 120 ms
  // timer was approximating.
  await page.waitForFunction(
    () => document.querySelector('.react-flow__node.dragging') === null,
    null,
    { timeout: 2000 },
  )
}

/** Locator for the WidgetKindMenu portal panel. */
export function widgetKindMenu(page: Page): Locator {
  return page.locator('[role="menu"][aria-label="Change widget"]')
}

/** Locator for the WKM "Change list" hover flyout panel. */
export function widgetKindMenuFlyout(page: Page): Locator {
  return page.locator('[role="menu"][aria-label="Change list"]')
}

/** Locator for a floating calendar widget on the canvas. */
export function floatingCalendarByIndex(page: Page, idx = 0): Locator {
  return page.locator('.react-flow__node-floatingCalendar').nth(idx)
}


/** Locator for a floating "open by status" widget on the canvas. */
export function floatingStatusByIndex(page: Page, idx = 0): Locator {
  return page.locator('.react-flow__node-floatingStatus').nth(idx)
}

/** Locator for a tab pill within a slot (TabStrip pill carries `data-tab-id`). */
export function tabPillByDataId(page: Page, tabId: string): Locator {
  return page.locator(`[role="tab"][data-tab-id="${tabId}"]`)
}

/**
 * Drag a Tab pill from a rail to a target point. Uses the same trusted CDP
 * gesture as `dragWidgetTo` but with the pill as the source — the dnd-kit
 * `PointerSensor` activation distance is 5 px, so the initial nudge crosses
 * the threshold and a multi-step move drags the pill across the viewport.
 */
export async function dragTabTo(
  page: Page,
  pill: Locator,
  target: { x: number; y: number },
  opts: { steps?: number } = {},
): Promise<void> {
  const steps = opts.steps ?? 24
  const box = await pill.boundingBox()
  if (!box) throw new Error('dragTabTo: pill has no bounding box')
  const startX = box.x + box.width / 2
  const startY = box.y + box.height / 2
  await page.mouse.move(startX, startY)
  await page.mouse.down()
  // Cross dnd-kit's 5 px PointerSensor activation distance.
  await page.mouse.move(startX + 6, startY + 6, { steps: 2 })
  await page.mouse.move(target.x, target.y, { steps })
  await page.mouse.up()
  // Wait for `useDndMonitor`'s `onDragEnd` to clear `tabDragActive`.
  // `CanvasView.tsx:831` writes `data-canvas-drop-active` on its wrapper
  // while a rails tab drag is over the canvas; the attribute is removed as
  // soon as `setTabDragActive(false)` fires inside the rails monitor's
  // `onDragEnd` chain (`popTabAtPosition` runs synchronously inside that
  // handler, so the attribute clear races with the dispatch end). Reading
  // the attribute's absence is the deterministic post-mouseup signal the
  // prior 150 ms timer was approximating. Falls through immediately if the
  // drag never entered the canvas zone (attribute was never set).
  await page.waitForFunction(
    () => document.querySelector('[data-canvas-drop-active]') === null,
    null,
    { timeout: 2000 },
  )
}
