import { expect, test, type Page } from '@playwright/test'
import { seedCanvas } from './fixtures/seed'

/**
 * Locks in the visible-groups intersection rule + tier ordering for
 * `groupBy === 'people'` on the manual-filter `/list` path
 * (triage-2026-04-28 P6, item 1).
 *
 * Worked example from the plan's Decision 6:
 * - Filter people `[Alice, Bob]`, mode `include-orgs` (manual-filter default),
 *   group by people.
 * - Bob ∈ Acme; Alice is not.
 * - T1 direct {Alice, Charlie} → emits under Alice (direct).
 * - T2 direct {Charlie} + org Acme → emits under Bob (implicit) via
 *   `personFilterMode='include-orgs'` cross-axis path.
 * - Visible groups: Alice (top, direct), Bob (bottom, implicit-only). No
 *   Charlie group; T1 and T2 each appear exactly once.
 *
 * Pre-fix, ListView's `buildPeopleSections` only re-ordered (P5
 * `prioritizePersonIds`) without restricting — Charlie's group leaked through
 * even though the user filtered it out, and T2 stranded under an "Acme" org
 * section that the people-grouping path produces unconditionally when `orgs`
 * are passed without `filteredOrgIds`.
 */

const DB = 'todo2'

interface PostSeedOptions {
  personOrgs?: Array<{ person: string; org: string }>
  tasks?: Array<{ title: string; people?: string[]; orgs?: string[] }>
  /**
   * Names of people whose ids the favorited list def's predicate should carry
   * as `personIds`. Resolved to ids inside the seed transaction so the caller
   * doesn't have to round-trip.
   */
  filterDefName: string
  filterPeopleNames: string[]
}

/**
 * Resolves people/orgs by name to their IDB ids, writes person-org joins +
 * tasks + their join rows, and creates a favorited list def whose predicate
 * carries the resolved `personIds` and `grouping: 'people'`. Run after
 * `seedCanvas` and before `page.reload()` so a single reload picks up
 * everything.
 *
 * Clicking the favorited chip on `/list` triggers `applyDefinition`, which
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
        const lookupTx = idb.transaction(['people', 'orgs'], 'readonly')
        let people: Array<{ id: number; name: string }> = []
        let orgs: Array<{ id: number; name: string }> = []
        lookupTx.objectStore('people').getAll().onsuccess = (e) => {
          people = (e.target as IDBRequest).result as Array<{ id: number; name: string }>
        }
        lookupTx.objectStore('orgs').getAll().onsuccess = (e) => {
          orgs = (e.target as IDBRequest).result as Array<{ id: number; name: string }>
        }
        lookupTx.oncomplete = () => {
          const personIdByName = new Map(people.map((p) => [p.name, p.id]))
          const orgIdByName = new Map(orgs.map((o) => [o.name, o.id]))

          const filterPersonIds: number[] = []
          for (const name of seed.filterPeopleNames) {
            const id = personIdByName.get(name)
            if (id == null) { idb.close(); reject(new Error(`seed: missing person ${name}`)); return }
            filterPersonIds.push(id)
          }

          const writeTx = idb.transaction(
            ['todos', 'todoPeople', 'todoOrgs', 'personOrgs', 'listDefinitions'],
            'readwrite',
          )

          for (const link of seed.personOrgs ?? []) {
            const pid = personIdByName.get(link.person)
            const oid = orgIdByName.get(link.org)
            if (pid == null || oid == null) {
              idb.close(); reject(new Error(`seed: bad personOrg link ${link.person}/${link.org}`)); return
            }
            writeTx.objectStore('personOrgs').add({ personId: pid, orgId: oid })
          }

          const now = new Date()
          for (const task of seed.tasks ?? []) {
            const todoReq = writeTx.objectStore('todos').add({
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
              for (const orgName of task.orgs ?? []) {
                const oid = orgIdByName.get(orgName)
                if (oid == null) { reject(new Error(`seed: missing org ${orgName}`)); return }
                writeTx.objectStore('todoOrgs').add({ todoId, orgId: oid })
              }
            }
            todoReq.onerror = () => reject(todoReq.error)
          }

          writeTx.objectStore('listDefinitions').add({
            name: seed.filterDefName,
            sortOrder: 1,
            favorited: true,
            pinnedToDashboard: false,
            grouping: 'people',
            sort: 'manual',
            membership: {
              kind: 'custom',
              predicate: {
                showCompleted: false,
                showHiddenStatuses: false,
                personIds: filterPersonIds,
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

test.describe('ListView — visible-groups intersection (P6)', () => {
  test('filter [Alice, Bob] + group by people: Alice (direct) leads, Bob (implicit) trails, no Charlie', async ({ page }) => {
    await seedCanvas(page, {
      people: [{ name: 'Alice' }, { name: 'Bob' }, { name: 'Charlie' }],
      orgs: [{ name: 'Acme' }],
    })
    await seedAssignmentsAndListDef(page, {
      personOrgs: [{ person: 'Bob', org: 'Acme' }],
      tasks: [
        { title: 'T1 direct Alice and Charlie', people: ['Alice', 'Charlie'] },
        { title: 'T2 direct Charlie + org Acme', people: ['Charlie'], orgs: ['Acme'] },
      ],
      filterDefName: 'P6 grouping',
      filterPeopleNames: ['Alice', 'Bob'],
    })

    // Reload first so Dexie picks up the freshly-written list def + tasks (the
    // post-`seedCanvas` reload only covered the canvas-seed slice), then
    // switch to the `/list` route.
    await page.reload()
    await page.locator('.react-flow__viewport').first().waitFor({ state: 'visible' })
    await page.goto('/#/list')
    // Click the favorited list def chip — `applyDefinition` flips both the
    // filter (people=[Alice, Bob], mode=include-orgs) AND `listGroupBy='people'`.
    await page.getByRole('button', { name: 'P6 grouping' }).click()

    // SectionHeader renders `<span class="<hashed>label">{name}</span>`. Names
    // appear nowhere else as plain text on this surface (people pills inside
    // task rows render avatars / initials, not the full name), so an exact
    // text match resolves uniquely to the section header.
    const aliceHeader = page.getByText('Alice', { exact: true })
    const bobHeader = page.getByText('Bob', { exact: true })
    const charlieHeader = page.getByText('Charlie', { exact: true })

    // T1 / T2 task rows.
    const t1Row = page.locator('[data-todo-id]').filter({ hasText: 'T1 direct Alice and Charlie' })
    const t2Row = page.locator('[data-todo-id]').filter({ hasText: 'T2 direct Charlie + org Acme' })

    await expect(t1Row, 'T1 should appear exactly once').toHaveCount(1)
    await expect(t2Row, 'T2 should appear exactly once').toHaveCount(1)
    await expect(aliceHeader, 'Alice section visible').toHaveCount(1)
    await expect(bobHeader, 'Bob section visible (implicit-only)').toHaveCount(1)
    await expect(
      charlieHeader,
      'Charlie section must NOT appear — restrictToFilterSet drops non-filter person sections',
    ).toHaveCount(0)

    // Order: Alice's header sits above Bob's (direct tier first; implicit
    // tier at bottom of the person block). T1 lands between Alice's header
    // and Bob's; T2 lands below Bob's.
    const aliceY = (await aliceHeader.boundingBox())!.y
    const bobY = (await bobHeader.boundingBox())!.y
    const t1Y = (await t1Row.boundingBox())!.y
    const t2Y = (await t2Row.boundingBox())!.y
    expect(aliceY, 'Alice (direct) must lead Bob (implicit)').toBeLessThan(bobY)
    expect(t1Y).toBeGreaterThan(aliceY)
    expect(t1Y).toBeLessThan(bobY)
    expect(t2Y).toBeGreaterThan(bobY)
  })
})
