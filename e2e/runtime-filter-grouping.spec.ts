import { expect, test, type Page } from '@playwright/test'
import { seedCanvas } from './fixtures/seed'

/**
 * Locks in the runtime × groupBy cross-product on `/list`
 * (runtime-filter-grouping-cleanup-2026-04-29 P2).
 *
 * Background: P5 covered runtime × membership (`runtime-filter-direct-only`),
 * P6 covered manual filter × grouping (`list-view-person-filter-grouping`).
 * Neither covered runtime × grouping — that gap is why the original triage
 * P7 bug shipped. This spec drives the diagonal end-to-end:
 *
 * - Pick `Person` via the runtime "Prompt" + groupBy=people → only the
 *   picked person's section emits and only directly-assigned tasks render.
 * - Symmetric: pick `Org` + groupBy=org → only the picked org section,
 *   no inferred-via-person duplicates (runtime org pick hard-codes
 *   `direct-only` per P5).
 *
 * The favorited list def carries both `grouping` and `runtimeFilter` so
 * `applyDefinition` flips groupBy AND mounts the picker with one click —
 * mirrors the load path users actually exercise.
 *
 * JSDOM is unauthoritative: the picker's portaled panel rides
 * `usePopoverAnchor` (real-DOM `getBoundingClientRect`), and Dexie's
 * spread-merge into `useFilterStore` round-trip is what carries the
 * runtime pick into `effectiveFilters` and on into `restrictToPersonIds`.
 */

const DB = 'todo2'

interface TaskSeed {
  title: string
  people?: string[]
  orgs?: string[]
}

interface PostSeedOptions {
  personOrgs?: Array<{ person: string; org: string }>
  tasks?: TaskSeed[]
}

/**
 * Resolves people/orgs by name to their IDB ids, writes person-org join
 * rows, then writes tasks + their direct people/org join rows. Run after
 * `seedCanvas` (which seeded people / orgs / list defs) and before
 * `page.reload()` so a single reload picks up everything.
 */
async function seedAssignments(page: Page, opts: PostSeedOptions): Promise<void> {
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

          const writeTx = idb.transaction(
            ['todos', 'todoPeople', 'todoOrgs', 'personOrgs'],
            'readwrite',
          )
          for (const link of seed.personOrgs ?? []) {
            const pid = personIdByName.get(link.person)
            const oid = orgIdByName.get(link.org)
            if (pid == null || oid == null) {
              idb.close()
              reject(new Error(`seedAssignments: bad personOrg link ${link.person}/${link.org}`))
              return
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

/**
 * Reads the visible SectionHeader labels off the live DOM.
 *
 * Targeting section headers via `getByText` here is unreliable: the
 * RuntimeFilterPicker mounts the same person/org name in up to three
 * places — section header, picker chip, picker option button. Scoping by
 * CSS-module-hashed class names is brittle (the hash changes on every
 * Vite build).
 *
 * Walk the DOM instead. Two components on `/list` render a `▾` glyph:
 * `SectionHeader` (chevron is the FIRST element child of its parent and
 * has no `aria-hidden`) and `IconSelect` inside `SortGroupToolbar`
 * (chevron is the LAST child and carries `aria-hidden`). Filter on those
 * structural cues to isolate section headers, then return the next
 * non-numeric non-accent sibling text — that's the section label.
 */
async function visibleSectionLabels(page: Page): Promise<string[]> {
  return await page.evaluate(() => {
    const labels: string[] = []
    document.querySelectorAll('span').forEach((chev) => {
      if (chev.textContent?.trim() !== '▾') return
      if (chev.hasAttribute('aria-hidden')) return // skip IconSelect / WidgetHeader carets
      const parent = chev.parentElement
      if (!parent) return
      // SectionHeader's chevron is the FIRST element child; IconSelect's is the LAST.
      const firstChild = parent.firstElementChild
      if (firstChild !== chev) return
      const siblings = Array.from(parent.children).filter((c) => c.tagName === 'SPAN')
      for (const sp of siblings) {
        const t = sp.textContent?.trim() ?? ''
        if (t === '▾') continue          // chevron itself
        if (t === '') continue            // accent dot (no text)
        if (/^\d+$/.test(t)) continue     // count
        labels.push(t)
        break
      }
    })
    return labels
  })
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

test.describe('Runtime filter × groupBy diagonal (/list)', () => {
  test('runtime person pick + groupBy=people: only the picked person section emits with direct-only tasks', async ({ page }) => {
    // Seed: Alice, Bob, Charlie people. Acme org with Bob as a member (the
    // person-org join is irrelevant for the people diagonal but kept in to
    // mirror the symmetric org test seed). Three tasks:
    //   T1 = {Alice, Charlie} → emits under Alice when Alice is picked.
    //   T2 = {Bob, Charlie}   → emits under Bob when Bob is picked.
    //   T3 = {Charlie}        → control; never appears under either pick
    //                            (Charlie is never the runtime pick).
    // The favorited def carries grouping=people + runtimeFilter.field=person.
    // Clicking the favorite chip drives applyDefinition, which sets BOTH
    // listGroupBy AND runtimeFilterSpec in one call — that's the load path
    // we exercise. The runtime pick of a person hard-codes
    // personFilterMode='direct-only' (P5), so cross-axis emits stay
    // suppressed and the visible person sections narrow to the pick.
    await seedCanvas(page, {
      people: [{ name: 'Alice' }, { name: 'Bob' }, { name: 'Charlie' }],
      orgs: [{ name: 'Acme' }],
      listDefinitions: [{
        name: 'Runtime person grouping',
        favorited: true,
        membership: { kind: 'custom', predicate: emptyPredicate() },
        sort: 'manual',
        grouping: 'people',
        runtimeFilter: { field: 'person' },
      }],
    })
    await seedAssignments(page, {
      personOrgs: [{ person: 'Bob', org: 'Acme' }],
      tasks: [
        { title: 'T1 Alice and Charlie', people: ['Alice', 'Charlie'] },
        { title: 'T2 Bob and Charlie', people: ['Bob', 'Charlie'] },
        { title: 'T3 Charlie only', people: ['Charlie'] },
      ],
    })

    await page.reload()
    await page.locator('.react-flow__viewport').first().waitFor({ state: 'visible' })
    await page.goto('/#/list')
    await page.getByRole('button', { name: 'Runtime person grouping' }).click()

    // Picker mounts; pick Alice. `exact: true` is required because, between
    // picks, the runtime filter is briefly empty and every task surfaces —
    // the people-grouped legacy branch emits T2 under both Bob and Charlie,
    // and each `[role="button"]` draggable wrapper carries an aria-label
    // like "Mark complete T2 Bob and Charlie" that fuzzy-matches "Bob".
    // Anchoring on exact button text resolves to the picker option only.
    const personInput = page.locator('input[aria-label="Filter tasks by person"]')
    await expect(personInput).toBeVisible()
    await personInput.click()
    await page.getByRole('button', { name: 'Alice', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Remove Alice' })).toBeVisible()

    const t1Row = page.locator('[data-todo-id]').filter({ hasText: 'T1 Alice and Charlie' })
    const t2Row = page.locator('[data-todo-id]').filter({ hasText: 'T2 Bob and Charlie' })
    const t3Row = page.locator('[data-todo-id]').filter({ hasText: 'T3 Charlie only' })

    // Wait for T1 to land before reading section labels — applyDefinition
    // commits the runtime pick + groupBy in one tick, but Dexie's reactive
    // load fires off-microtask. T1 visibility implies the section pass ran.
    await expect(t1Row, 'T1 emits under Alice (direct)').toHaveCount(1)
    expect(
      await visibleSectionLabels(page),
      'only Alice section visible — restrict set narrows to the runtime pick',
    ).toEqual(['Alice'])
    await expect(t2Row, 'T2 absent (no Alice on it; runtime person is direct-only)').toHaveCount(0)
    await expect(t3Row, 'T3 absent (no Alice on it)').toHaveCount(0)

    // Flip the pick: clear Alice, pick Bob. Sections must mirror flip.
    await page.getByRole('button', { name: 'Remove Alice' }).click()
    await expect(page.getByRole('button', { name: 'Remove Alice' })).toHaveCount(0)
    await personInput.click()
    await page.getByRole('button', { name: 'Bob', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Remove Bob' })).toBeVisible()

    await expect(t2Row, 'T2 emits under Bob (direct)').toHaveCount(1)
    expect(
      await visibleSectionLabels(page),
      'only Bob section visible after flip',
    ).toEqual(['Bob'])
    await expect(t1Row, 'T1 absent (no Bob on it)').toHaveCount(0)
    await expect(t3Row, 'T3 absent (no Bob on it)').toHaveCount(0)
  })

  test('runtime org pick + groupBy=org: only the picked org section emits with direct-only tasks', async ({ page }) => {
    // Seed mirrors the people diagonal but on the org axis. Bob ∈ Acme.
    //   TO1 = orgs:[Acme]               → emits under Acme (direct).
    //   TO2 = people:[Bob], orgs:[]     → would emit via cross-axis if
    //                                     orgFilterMode were 'include-people',
    //                                     but the runtime org pick hard-codes
    //                                     'direct-only', so it drops out.
    //   TO3 = orgs:[]                   → control; no Acme on it, drops out.
    await seedCanvas(page, {
      people: [{ name: 'Alice' }, { name: 'Bob' }],
      orgs: [{ name: 'Acme' }, { name: 'Globex' }],
      listDefinitions: [{
        name: 'Runtime org grouping',
        favorited: true,
        membership: { kind: 'custom', predicate: emptyPredicate() },
        sort: 'manual',
        grouping: 'org',
        runtimeFilter: { field: 'org' },
      }],
    })
    await seedAssignments(page, {
      personOrgs: [{ person: 'Bob', org: 'Acme' }],
      tasks: [
        { title: 'TO1 Acme direct', orgs: ['Acme'] },
        { title: 'TO2 Bob only', people: ['Bob'] },
        { title: 'TO3 Globex direct', orgs: ['Globex'] },
      ],
    })

    await page.reload()
    await page.locator('.react-flow__viewport').first().waitFor({ state: 'visible' })
    await page.goto('/#/list')
    await page.getByRole('button', { name: 'Runtime org grouping' }).click()

    const orgInput = page.locator('input[aria-label="Filter tasks by org"]')
    await expect(orgInput).toBeVisible()
    await orgInput.click()
    await page.getByRole('button', { name: 'Acme', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Remove Acme' })).toBeVisible()

    const to1Row = page.locator('[data-todo-id]').filter({ hasText: 'TO1 Acme direct' })
    const to2Row = page.locator('[data-todo-id]').filter({ hasText: 'TO2 Bob only' })
    const to3Row = page.locator('[data-todo-id]').filter({ hasText: 'TO3 Globex direct' })

    await expect(to1Row, 'TO1 emits under Acme (direct)').toHaveCount(1)
    expect(
      await visibleSectionLabels(page),
      'only Acme section visible — Globex filtered out, no-Organization bucket suppressed in restrict mode',
    ).toEqual(['Acme'])
    await expect(
      to2Row,
      'TO2 absent — runtime org pick is direct-only, no inferred-via-person emit',
    ).toHaveCount(0)
    await expect(to3Row, 'TO3 absent (no Acme on it)').toHaveCount(0)
  })
})
