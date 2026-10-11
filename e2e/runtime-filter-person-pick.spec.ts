import { expect, test, type Page } from '@playwright/test'
import { listInsetByIndex, seedCanvas } from './fixtures/seed'

/**
 * Runtime person pick on a canvas list inset narrows the list to tasks
 * directly assigned to the picked person.
 *
 * The vitest suite covers the matcher branch directly; this spec covers the
 * full `RuntimeFilterPicker → ListDefinitionBody → buildDashboardLists →
 * matchesFilter` chain in real Chromium so a regression in any part of that
 * wire-up surfaces. (The `/list` runtime path is covered separately in
 * `runtime-filter-grouping.spec.ts`.)
 */

const DB = 'todo2'

interface AssignmentSeed {
  /** Tasks to insert into the active canvas (no project assignment needed). */
  tasks?: Array<{
    title: string
    /** Direct person assignments by name (resolved post-`seedCanvas`). */
    people?: string[]
  }>
}

/**
 * Adds tasks + their person assignment joins. Must run after `seedCanvas`
 * (which seeded people / list defs / inset) and before `page.reload()` so a
 * single reload picks up everything.
 */
async function seedAssignments(page: Page, opts: AssignmentSeed): Promise<void> {
  await page.evaluate(async ({ db, seed }) => {
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open(db)
      req.onsuccess = () => {
        const idb = req.result
        const lookupTx = idb.transaction(['people', 'canvases'], 'readonly')
        let people: Array<{ id: number; name: string }> = []
        let canvasId: number | undefined
        lookupTx.objectStore('people').getAll().onsuccess = (e) => {
          people = (e.target as IDBRequest).result as Array<{ id: number; name: string }>
        }
        lookupTx.objectStore('canvases').getAll().onsuccess = (e) => {
          const all = (e.target as IDBRequest).result as Array<{ id: number }>
          canvasId = all[0]?.id
        }
        lookupTx.oncomplete = () => {
          if (canvasId == null) {
            idb.close(); reject(new Error('seedAssignments: no canvas')); return
          }
          const personIdByName = new Map(people.map((p) => [p.name, p.id]))

          const writeTx = idb.transaction(['todos', 'todoPeople'], 'readwrite')
          const now = new Date()
          for (const task of seed.tasks ?? []) {
            const todoReq = writeTx.objectStore('todos').add({
              uid: crypto.randomUUID(),
              title: task.title,
              isCompleted: false,
              createdAt: now,
              modifiedAt: now,
              sortOrder: 0,
              canvasId: canvasId!,
            })
            todoReq.onsuccess = () => {
              const todoId = todoReq.result as number
              for (const personName of task.people ?? []) {
                const pid = personIdByName.get(personName)
                if (pid == null) {
                  reject(new Error(`seedAssignments: missing person ${personName}`)); return
                }
                writeTx.objectStore('todoPeople').add({ todoId, personId: pid })
              }
            }
            todoReq.onerror = () => reject(todoReq.error)
          }
          writeTx.oncomplete = () => { idb.close(); resolve() }
          writeTx.onerror = () => { idb.close(); reject(writeTx.error) }
        }
        lookupTx.onerror = () => { idb.close(); reject(lookupTx.error) }
      }
      req.onerror = () => reject(req.error)
    })
  }, { db: DB, seed: opts })
}

/** Mirrors `emptyPredicate()` from `src/stores/list-definition-store.ts`. */
function emptyPredicate(): Record<string, unknown> {
  return {
    showCompleted: false,
    personIds: null,
    projectIds: null,
    statusIds: null,
    searchText: '',
    dateField: 'deadline',
    dateRangeStart: null,
    dateRangeEnd: null,
    dateRangeIncludeNoDate: false,
    hasDeadline: null,
    hasFollowup: null,
    tags: null,
  }
}

test.describe('Runtime filter — list inset person pick', () => {
  test('runtime person pick shows the directly-assigned task and hides others', async ({ page }) => {
    await seedCanvas(page, {
      people: [{ name: 'Alice' }, { name: 'Bob' }],
      listDefinitions: [{
        name: 'Tasks for person',
        membership: { kind: 'custom', predicate: emptyPredicate() },
        runtimeFilter: { field: 'person' },
      }],
      listInsets: [{ listDefIdx: 0, x: 320, y: 200, width: 360, height: 320 }],
    })
    await seedAssignments(page, {
      tasks: [
        { title: 'Direct Alice task', people: ['Alice'] },
        { title: 'Bob only task', people: ['Bob'] },
        { title: 'Unassigned task' },
      ],
    })
    await page.reload()
    await page.locator('.react-flow__viewport').first().waitFor({ state: 'visible' })

    const inset = listInsetByIndex(page)
    await expect(inset).toBeVisible()

    // Pick Alice via the runtime filter picker.
    const input = page.locator('input[aria-label="Filter tasks by person"]')
    await expect(input).toBeVisible()
    await input.click()
    await page.getByRole('button', { name: 'Alice', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Remove Alice' })).toBeVisible()

    const aliceRow = inset.locator('[data-todo-id]').filter({ hasText: 'Direct Alice task' })
    const bobRow = inset.locator('[data-todo-id]').filter({ hasText: 'Bob only task' })
    const unassignedRow = inset.locator('[data-todo-id]').filter({ hasText: 'Unassigned task' })
    await expect(aliceRow, 'directly-assigned task should appear under runtime person filter').toHaveCount(1)
    await expect(bobRow, 'task assigned only to another person must NOT appear').toHaveCount(0)
    await expect(unassignedRow, 'unassigned task must NOT appear').toHaveCount(0)
  })
})
