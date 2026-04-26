import type { Page, Locator } from '@playwright/test'

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

/** All task row wrappers across all projects on the canvas. */
export function taskRowWrappers(page: Page): Locator {
  return page.locator('[data-stl-row]')
}
