import { expect, test, type Page } from '@playwright/test'
import { loadSavedList, seedCanvas } from './fixtures/seed'

/**
 * Locks in the visible-groups intersection rule for `groupBy === 'people'`
 * on the manual-filter `/list` path.
 *
 * - Filter people `[Alice, Bob]`, group by people.
 * - T1 {Alice, Charlie} → emits under Alice only; Charlie is outside the
 *   filter set, so no Charlie section appears.
 * - T2 {Bob}            → emits under Bob.
 * - T3 {Charlie}        → filtered out (no filtered person on it).
 * - Sections follow filter-set order: Alice, then Bob.
 *
 * Without the restriction, Charlie's group leaked through even though the
 * user filtered it out, and T1 rendered twice (once under Alice, once under
 * Charlie).
 */

const DB = 'todo2'

interface PostSeedOptions {
  tasks?: Array<{ title: string; people?: string[] }>
  /**
   * Names of people whose ids the list def's predicate should carry
   * as `personIds`. Resolved to ids inside the seed transaction so the caller
   * doesn't have to round-trip.
   */
  filterDefName: string
  filterPeopleNames: string[]
}

/**
 * Resolves people by name to their IDB ids, writes tasks + their person join
 * rows, and creates a list def whose predicate carries the resolved
 * `personIds` and `grouping: 'people'`. Run after `seedCanvas` and before
 * `page.reload()` so a single reload picks up everything.
 *
 * Loading it on `/list` triggers `applyDefinition`, which
 * calls `setAllFilters(predicateToCriteria(def.membership.predicate))` AND
 * `setListGroupBy('people')` — fully driving the surface under test in one
 * gesture, no manual filter-chip wiring required.
 */
async function seedAssignmentsAndListDef(page: Page, opts: PostSeedOptions): Promise<void> {
  await page.evaluate(async ({ db, seed }) => {
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open(db)
      req.onsuccess = () => {
        const idb = req.result
        const lookupTx = idb.transaction(['people'], 'readonly')
        let people: Array<{ id: number; name: string }> = []
        lookupTx.objectStore('people').getAll().onsuccess = (e) => {
          people = (e.target as IDBRequest).result as Array<{ id: number; name: string }>
        }
        lookupTx.oncomplete = () => {
          const personIdByName = new Map(people.map((p) => [p.name, p.id]))

          const filterPersonIds: number[] = []
          for (const name of seed.filterPeopleNames) {
            const id = personIdByName.get(name)
            if (id == null) { idb.close(); reject(new Error(`seed: missing person ${name}`)); return }
            filterPersonIds.push(id)
          }

          const writeTx = idb.transaction(['todos', 'todoPeople', 'listDefinitions'], 'readwrite')

          const now = new Date()
          for (const task of seed.tasks ?? []) {
            const todoReq = writeTx.objectStore('todos').add({
              uid: crypto.randomUUID(),
              title: task.title,
              isCompleted: false,
              createdAt: now,
              modifiedAt: now,
              sortOrder: 0,
            })
            todoReq.onsuccess = () => {
              const todoId = todoReq.result as number
              for (const personName of task.people ?? []) {
                const pid = personIdByName.get(personName)
                if (pid == null) { reject(new Error(`seed: missing person ${personName}`)); return }
                writeTx.objectStore('todoPeople').add({ todoId, personId: pid })
              }
            }
            todoReq.onerror = () => reject(todoReq.error)
          }

          writeTx.objectStore('listDefinitions').add({
            name: seed.filterDefName,
            sortOrder: 1,
            pinnedToDashboard: false,
            grouping: 'people',
            sort: 'manual',
            membership: {
              kind: 'custom',
              predicate: {
                showCompleted: false,
                personIds: filterPersonIds,
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
              },
            },
          })

          writeTx.oncomplete = () => { idb.close(); resolve() }
          writeTx.onerror = () => { idb.close(); reject(writeTx.error) }
        }
        lookupTx.onerror = () => { idb.close(); reject(lookupTx.error) }
      }
      req.onerror = () => reject(req.error)
    })
  }, { db: DB, seed: opts })
}

test.describe('ListView — visible-groups intersection', () => {
  test('filter [Alice, Bob] + group by people: Alice and Bob sections only, no Charlie', async ({ page }) => {
    await seedCanvas(page, {
      people: [{ name: 'Alice' }, { name: 'Bob' }, { name: 'Charlie' }],
    })
    await seedAssignmentsAndListDef(page, {
      tasks: [
        { title: 'T1 Alice and Charlie', people: ['Alice', 'Charlie'] },
        { title: 'T2 Bob only', people: ['Bob'] },
        { title: 'T3 Charlie only', people: ['Charlie'] },
      ],
      filterDefName: 'People grouping',
      filterPeopleNames: ['Alice', 'Bob'],
    })

    // Reload first so Dexie picks up the freshly-written list def + tasks (the
    // post-`seedCanvas` reload only covered the canvas-seed slice), then
    // switch to the `/list` route.
    await page.reload()
    await page.locator('.react-flow__viewport').first().waitFor({ state: 'visible' })
    await page.goto('/#/list')
    // Loading the list — `applyDefinition` flips both the filter
    // (people=[Alice, Bob]) AND `listGroupBy='people'`.
    await loadSavedList(page, 'People grouping')

    // SectionHeader renders `<span class="<hashed>label">{name}</span>`. Names
    // appear nowhere else as plain text on this surface (people pills inside
    // task rows render avatars / initials, not the full name), so an exact
    // text match resolves uniquely to the section header.
    const aliceHeader = page.getByText('Alice', { exact: true })
    const bobHeader = page.getByText('Bob', { exact: true })
    const charlieHeader = page.getByText('Charlie', { exact: true })

    const t1Row = page.locator('[data-todo-id]').filter({ hasText: 'T1 Alice and Charlie' })
    const t2Row = page.locator('[data-todo-id]').filter({ hasText: 'T2 Bob only' })
    const t3Row = page.locator('[data-todo-id]').filter({ hasText: 'T3 Charlie only' })

    await expect(t1Row, 'T1 should appear exactly once (under Alice)').toHaveCount(1)
    await expect(t2Row, 'T2 should appear exactly once (under Bob)').toHaveCount(1)
    await expect(t3Row, 'T3 is filtered out — no filtered person on it').toHaveCount(0)
    await expect(aliceHeader, 'Alice section visible').toHaveCount(1)
    await expect(bobHeader, 'Bob section visible').toHaveCount(1)
    await expect(
      charlieHeader,
      'Charlie section must NOT appear — restrictToFilterSet drops non-filter person sections',
    ).toHaveCount(0)

    // Order: Alice's header sits above Bob's (filter-set order). T1 lands
    // between Alice's header and Bob's; T2 lands below Bob's.
    const aliceY = (await aliceHeader.boundingBox())!.y
    const bobY = (await bobHeader.boundingBox())!.y
    const t1Y = (await t1Row.boundingBox())!.y
    const t2Y = (await t2Row.boundingBox())!.y
    expect(aliceY, 'Alice section must lead Bob').toBeLessThan(bobY)
    expect(t1Y).toBeGreaterThan(aliceY)
    expect(t1Y).toBeLessThan(bobY)
    expect(t2Y).toBeGreaterThan(bobY)
  })
})
