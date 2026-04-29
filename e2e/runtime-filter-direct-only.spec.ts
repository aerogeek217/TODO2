import { expect, test, type Page } from '@playwright/test'
import { listInsetByIndex, seedCanvas } from './fixtures/seed'

/**
 * Locks in `direct-only` semantics for runtime person/org picks
 * (triage-2026-04-28 P5).
 *
 * The runtime filter has no UI for the `personFilterMode` / `orgFilterMode`
 * toggles, so picking an entity must implicitly hard-code the matcher to
 * "direct assignment only" — equivalent to the user clicking the
 * "People only" / "Org only" radio in the manual filter UI. Pre-fix, the
 * default `'include-orgs'` mode bled through and a runtime person pick of
 * Alice would *also* surface tasks assigned to any org Alice belongs to,
 * which the picker has no way to reveal.
 *
 * The vitest suite covers the matcher branch directly; this spec covers the
 * full `RuntimeFilterPicker → ListDefinitionBody → buildDashboardLists →
 * matchesFilter` chain in real Chromium so a regression in any part of that
 * wire-up surfaces.
 */

const DB = 'todo2'

interface AssignmentSeed {
  /** Membership join: each person ↔ each org id in the list. */
  personOrgs?: Array<{ person: string; org: string }>
  /** Tasks to insert into the active canvas (no project assignment needed). */
  tasks?: Array<{
    title: string
    /** Direct person assignments by name (resolved post-`seedCanvas`). */
    people?: string[]
    /** Direct org assignments by name. */
    orgs?: string[]
  }>
}

/**
 * Adds person↔org join rows + tasks + their direct assignment joins. Must run
 * after `seedCanvas` (which seeded people / orgs / list defs / inset) and
 * before `page.reload()` so a single reload picks up everything.
 */
async function seedAssignments(page: Page, opts: AssignmentSeed): Promise<void> {
  await page.evaluate(async ({ db, seed }) => {
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open(db)
      req.onsuccess = () => {
        const idb = req.result
        const lookupTx = idb.transaction(['people', 'orgs', 'canvases'], 'readonly')
        let people: Array<{ id: number; name: string }> = []
        let orgs: Array<{ id: number; name: string }> = []
        let canvasId: number | undefined
        lookupTx.objectStore('people').getAll().onsuccess = (e) => {
          people = (e.target as IDBRequest).result as Array<{ id: number; name: string }>
        }
        lookupTx.objectStore('orgs').getAll().onsuccess = (e) => {
          orgs = (e.target as IDBRequest).result as Array<{ id: number; name: string }>
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
          const orgIdByName = new Map(orgs.map((o) => [o.name, o.id]))

          const writeTx = idb.transaction(['todos', 'todoPeople', 'todoOrgs', 'personOrgs'], 'readwrite')
          for (const link of seed.personOrgs ?? []) {
            const pid = personIdByName.get(link.person)
            const oid = orgIdByName.get(link.org)
            if (pid == null || oid == null) {
              idb.close(); reject(new Error(`seedAssignments: missing person or org for ${link.person}/${link.org}`)); return
            }
            writeTx.objectStore('personOrgs').add({ personId: pid, orgId: oid })
          }
          const now = new Date()
          let pendingTodos = seed.tasks?.length ?? 0
          if (pendingTodos === 0) {
            writeTx.oncomplete = () => { idb.close(); resolve() }
            writeTx.onerror = () => { idb.close(); reject(writeTx.error) }
            return
          }
          for (const task of seed.tasks ?? []) {
            const todoReq = writeTx.objectStore('todos').add({
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
              for (const orgName of task.orgs ?? []) {
                const oid = orgIdByName.get(orgName)
                if (oid == null) {
                  reject(new Error(`seedAssignments: missing org ${orgName}`)); return
                }
                writeTx.objectStore('todoOrgs').add({ todoId, orgId: oid })
              }
              pendingTodos -= 1
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
    showHiddenStatuses: false,
    personIds: null,
    personFilterMode: 'include-orgs',
    orgIds: null,
    orgFilterMode: 'include-people',
    projectIds: null,
    statusIds: null,
    searchText: '',
    dateField: 'date',
    dateRangeStart: null,
    dateRangeEnd: null,
    dateRangeIncludeNoDate: false,
    hasScheduled: null,
    hasDeadline: null,
    tags: null,
  }
}

test.describe('Runtime filter — direct-only mode', () => {
  test('runtime person pick excludes a task whose only person-membership is via an org', async ({ page }) => {
    // Alice ∈ Acme. T1 directly assigned to Alice; T2 directly assigned to Acme
    // (Alice is reachable via Acme membership). Picking Alice via the runtime
    // filter must surface T1 only — pre-fix the default `include-orgs` mode
    // would have pulled T2 in too via Alice → Acme → task.
    await seedCanvas(page, {
      people: [{ name: 'Alice' }],
      orgs: [{ name: 'Acme' }],
      listDefinitions: [{
        name: 'Tasks for person',
        membership: { kind: 'custom', predicate: emptyPredicate() },
        runtimeFilter: { field: 'person' },
      }],
      listInsets: [{ listDefIdx: 0, x: 320, y: 200, width: 360, height: 320 }],
    })
    await seedAssignments(page, {
      personOrgs: [{ person: 'Alice', org: 'Acme' }],
      tasks: [
        { title: 'Direct Alice task', people: ['Alice'] },
        { title: 'Org-only Acme task', orgs: ['Acme'] },
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
    await page.getByRole('button', { name: 'Alice' }).click()
    await expect(page.getByRole('button', { name: 'Remove Alice' })).toBeVisible()

    // Direct task is rendered; org-only task is suppressed.
    const directRow = inset.locator('[data-todo-id]').filter({ hasText: 'Direct Alice task' })
    const orgOnlyRow = inset.locator('[data-todo-id]').filter({ hasText: 'Org-only Acme task' })
    await expect(directRow, 'directly-assigned task should appear under runtime person filter').toHaveCount(1)
    await expect(orgOnlyRow, 'org-only task must NOT appear (runtime filter is implicit direct-only)').toHaveCount(0)
  })

  test('runtime org pick excludes a task whose only org-membership is via a person', async ({ page }) => {
    // Bob ∈ Acme. T1 directly assigned to Acme; T2 only to Bob (Acme reached
    // via membership). Picking Acme via the runtime filter must surface T1
    // only — pre-fix the default `include-people` mode would have pulled T2
    // in too via Acme → Bob → task.
    await seedCanvas(page, {
      people: [{ name: 'Bob' }],
      orgs: [{ name: 'Acme' }],
      listDefinitions: [{
        name: 'Tasks for org',
        membership: { kind: 'custom', predicate: emptyPredicate() },
        runtimeFilter: { field: 'org' },
      }],
      listInsets: [{ listDefIdx: 0, x: 320, y: 200, width: 360, height: 320 }],
    })
    await seedAssignments(page, {
      personOrgs: [{ person: 'Bob', org: 'Acme' }],
      tasks: [
        { title: 'Direct Acme task', orgs: ['Acme'] },
        { title: 'Person-only Bob task', people: ['Bob'] },
      ],
    })
    await page.reload()
    await page.locator('.react-flow__viewport').first().waitFor({ state: 'visible' })

    const inset = listInsetByIndex(page)
    await expect(inset).toBeVisible()

    const input = page.locator('input[aria-label="Filter tasks by org"]')
    await expect(input).toBeVisible()
    await input.click()
    await page.getByRole('button', { name: 'Acme' }).click()
    await expect(page.getByRole('button', { name: 'Remove Acme' })).toBeVisible()

    const directRow = inset.locator('[data-todo-id]').filter({ hasText: 'Direct Acme task' })
    const personOnlyRow = inset.locator('[data-todo-id]').filter({ hasText: 'Person-only Bob task' })
    await expect(directRow, 'directly-assigned org task should appear under runtime org filter').toHaveCount(1)
    await expect(personOnlyRow, 'person-only task must NOT appear (runtime filter is implicit direct-only)').toHaveCount(0)
  })
})
