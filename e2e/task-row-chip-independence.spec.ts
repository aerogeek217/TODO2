import { expect, test, type Page } from '@playwright/test'
import { seedCanvasWithProjects, taskRowByTitle } from './fixtures/seed'

/**
 * Locks in chip-independence on `TaskRow` (triage-2026-04-28 P4).
 *
 * The reported bug ("person chip not showing up on task row until status
 * is set") was a TOCTOU race in `assignment-helpers.loadAssignments`,
 * not a render-time CSS adjacency rule. The fix (re-read the map after
 * the DB await, prefer optimistic writes over stale fetched data) lives
 * in `src/stores/assignment-helpers.ts`. This spec covers two angles:
 *
 * 1. **QuickAdd `@person` chip survives the load race** — the actual
 *    regression. Creating a task via QuickAdd with `@person` triggers
 *    `applyNlpMetadata` → `assignPerson` running in parallel with
 *    `CanvasPage`'s `loadAssignments` effect (which fires on every
 *    `todos` change). Pre-fix, the optimistic map entry was clobbered.
 *    Post-fix, the avatar must be visible immediately on the new row,
 *    with no reload.
 *
 * 2. **Static render independence** — the avatar chip renders whenever
 *    a person is assigned, regardless of whether a status is set; the
 *    status chip likewise renders independent of assignments. Cheap
 *    regression guard for any future render gating that creeps back in.
 */

const DB = 'todo2'

async function seedAlice(page: Page) {
  await page.evaluate(async (db) => {
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open(db)
      req.onsuccess = () => {
        const idb = req.result
        const tx = idb.transaction(['people'], 'readwrite')
        tx.objectStore('people').add({ name: 'Alice', initials: 'A' })
        tx.oncomplete = () => { idb.close(); resolve() }
        tx.onerror = () => { idb.close(); reject(tx.error) }
      }
      req.onerror = () => reject(req.error)
    })
  }, DB)
}

async function seedWorkingStatus(page: Page) {
  await page.evaluate(async (db) => {
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open(db)
      req.onsuccess = () => {
        const idb = req.result
        const tx = idb.transaction(['statuses'], 'readwrite')
        tx.objectStore('statuses').add({
          name: 'Working', icon: 'circle', color: '#4caf50', sortOrder: 1,
        })
        tx.oncomplete = () => { idb.close(); resolve() }
        tx.onerror = () => { idb.close(); reject(tx.error) }
      }
      req.onerror = () => reject(req.error)
    })
  }, DB)
}

test.describe('TaskRow chip independence', () => {
  test('QuickAdd @person chip is visible without setting status (race regression)', async ({ page }) => {
    await seedCanvasWithProjects(page, {
      projects: [{ name: 'Inbox', tasks: [] }],
    })
    await seedAlice(page)
    await page.reload()
    await page.locator('.react-flow__viewport').first().waitFor({ state: 'visible' })

    // Open QuickAdd via the FAB and submit a task with @Alice. The race
    // window is the few ms between `useTodoStore.add` resolving and
    // `applyNlpMetadata` finishing — `CanvasPage`'s `loadAssignments`
    // effect fires in that window on every `todos` change, and pre-fix
    // its post-fetch `setMap` clobbered the optimistic assign.
    await page.locator('button[title^="New task"]').click()
    const input = page.locator('input[placeholder="New task…"]')
    await input.waitFor({ state: 'visible' })
    await input.fill('Race regression @Alice')
    // Trailing space closes the autocomplete popup that intercepts Enter
    // for token-completion before the submit handler can see it.
    await input.press('Space')
    await input.press('Enter')

    const row = taskRowByTitle(page, 'Race regression')
    await row.waitFor({ state: 'visible' })

    // Avatar must be visible right after submit — no reload, no status set.
    const avatar = row.locator('[class*="peopleGroup"] [class*="avatar"]').first()
    await expect(avatar, 'Alice avatar should render immediately after QuickAdd submit').toBeVisible()
    await expect(avatar).toHaveText(/A/)

    // Empty `@` trigger must NOT be present when avatar is.
    await expect(
      row.locator('[class*="chipGroupEmpty"]'),
      'empty @ trigger should not render when person is assigned',
    ).toHaveCount(0)
  })

  test('avatar renders independently of status (no-status row)', async ({ page }) => {
    await seedCanvasWithProjects(page, {
      projects: [{ name: 'Inbox', tasks: ['person no status'] }],
    })
    await seedAlice(page)
    // Link Alice to the seeded task.
    await page.evaluate(async (db) => {
      await new Promise<void>((resolve, reject) => {
        const req = indexedDB.open(db)
        req.onsuccess = () => {
          const idb = req.result
          const tx = idb.transaction(['todos', 'people', 'todoPeople'], 'readwrite')
          let aliceId: number | undefined
          let todoId: number | undefined
          tx.objectStore('todos').getAll().onsuccess = (e) => {
            const all = (e.target as IDBRequest).result as Array<{ id: number; title: string }>
            todoId = all.find((t) => t.title === 'person no status')?.id
          }
          tx.objectStore('people').getAll().onsuccess = (e) => {
            const all = (e.target as IDBRequest).result as Array<{ id: number; name: string }>
            aliceId = all.find((p) => p.name === 'Alice')?.id
          }
          tx.oncomplete = () => {
            if (aliceId == null || todoId == null) {
              idb.close(); reject(new Error('seed: missing alice or todo'))
              return
            }
            const tx2 = idb.transaction(['todoPeople'], 'readwrite')
            tx2.objectStore('todoPeople').add({ todoId, personId: aliceId })
            tx2.oncomplete = () => { idb.close(); resolve() }
            tx2.onerror = () => { idb.close(); reject(tx2.error) }
          }
          tx.onerror = () => { idb.close(); reject(tx.error) }
        }
        req.onerror = () => reject(req.error)
      })
    }, DB)
    await page.reload()
    await page.locator('.react-flow__viewport').first().waitFor({ state: 'visible' })

    const row = taskRowByTitle(page, 'person no status')
    await row.waitFor({ state: 'visible' })
    const avatar = row.locator('[class*="peopleGroup"] [class*="avatar"]').first()
    await expect(avatar).toBeVisible()
    await expect(avatar).toHaveText(/A/)
    // Status indicator wrapper renders even when status is unset (the
    // empty dot is hover-revealed via CSS).
    await expect(row.locator('[class*="statusWrapper"]')).toHaveCount(1)
  })

  test('status renders independently of assignments (no-person row)', async ({ page }) => {
    await seedCanvasWithProjects(page, {
      projects: [{ name: 'Inbox', tasks: ['status no person'] }],
    })
    await seedWorkingStatus(page)
    await page.evaluate(async (db) => {
      await new Promise<void>((resolve, reject) => {
        const req = indexedDB.open(db)
        req.onsuccess = () => {
          const idb = req.result
          const tx = idb.transaction(['todos', 'statuses'], 'readwrite')
          let statusId: number | undefined
          let target: Record<string, unknown> & { id?: number; title?: string } | undefined
          tx.objectStore('statuses').getAll().onsuccess = (e) => {
            const all = (e.target as IDBRequest).result as Array<{ id: number; name: string }>
            statusId = all.find((s) => s.name === 'Working')?.id
          }
          tx.objectStore('todos').getAll().onsuccess = (e) => {
            const all = (e.target as IDBRequest).result as Array<Record<string, unknown> & { title: string }>
            target = all.find((t) => t.title === 'status no person')
          }
          tx.oncomplete = () => {
            if (statusId == null || !target) {
              idb.close(); reject(new Error('seed: status/todo missing'))
              return
            }
            const tx2 = idb.transaction(['todos'], 'readwrite')
            target.statusId = statusId
            tx2.objectStore('todos').put(target)
            tx2.oncomplete = () => { idb.close(); resolve() }
            tx2.onerror = () => { idb.close(); reject(tx2.error) }
          }
          tx.onerror = () => { idb.close(); reject(tx.error) }
        }
        req.onerror = () => reject(req.error)
      })
    }, DB)
    await page.reload()
    await page.locator('.react-flow__viewport').first().waitFor({ state: 'visible' })

    const row = taskRowByTitle(page, 'status no person')
    await row.waitFor({ state: 'visible' })
    const status = row.locator('[class*="statusWrapper"]')
    await expect(status, 'status indicator should render even without a person').toBeVisible()
    await expect(status.locator('[class*="statusButton"]')).toHaveAttribute('aria-label', /Working/)
    // No people group — only the empty `@` trigger should render.
    await expect(row.locator('[class*="peopleGroup"]')).toHaveCount(0)
    await expect(row.locator('[class*="chipGroupEmpty"]')).toHaveCount(1)
  })
})
