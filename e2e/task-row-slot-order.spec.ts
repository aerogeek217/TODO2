import { expect, test } from '@playwright/test'
import { seedCanvasWithProjects, taskRowByTitle } from './fixtures/seed'

/**
 * Locks in the chip-slot ordering invariant on `TaskRow`. The four chip
 * slots (`# tags`, `@ people/orgs`, `date`, `status`) must appear in fixed
 * left-to-right order regardless of which fields are populated. Regression
 * for the case where status was set + date was empty: the empty-state date
 * calendar slot used to render after `<TaskPillBar>` (so after status),
 * inverting the visual order. Each slot now has a fixed JSX position with
 * populated and empty variants in the same slot.
 *
 * Empty triggers (`#` / `@` / calendar / status dot) carry `opacity: 0` but
 * still take up layout space, so reading their bounding rect gives a real
 * x-position even without hover.
 */

const DB = 'todo2'

test.describe('TaskRow chip slot order', () => {
  test('# / @ / date / status appear in fixed left-to-right order across populated/empty combos', async ({ page }) => {
    await seedCanvasWithProjects(page, {
      projects: [{
        name: 'Slots',
        tasks: ['empty row', 'date only', 'status only', 'tag and status'],
      }],
    })

    // Mutate the seeded todos to give each row a different combination of
    // status / date / tag, plus the supporting status + tag entities. The
    // helper only seeds title + project, so the rest goes via raw IDB here.
    await page.evaluate(async (db) => {
      await new Promise<void>((resolve, reject) => {
        const req = indexedDB.open(db)
        req.onsuccess = () => {
          const idb = req.result
          const tx = idb.transaction(['todos', 'statuses', 'tags', 'todoTags'], 'readwrite')

          const statusReq = tx.objectStore('statuses').add({
            name: 'Doing', color: '#3b82f6', icon: 'circle', sortOrder: 1,
          })
          const tagReq = tx.objectStore('tags').add({
            name: 'urgent', color: '#ef4444',
          })

          statusReq.onsuccess = () => {
            const statusId = statusReq.result as number
            tagReq.onsuccess = () => {
              const tagId = tagReq.result as number
              const allReq = tx.objectStore('todos').getAll()
              allReq.onsuccess = () => {
                const todos = allReq.result as Array<{ id: number; title: string }>
                const byTitle = (t: string) => {
                  const row = todos.find((x) => x.title === t)
                  if (!row) throw new Error(`seed: missing row "${t}"`)
                  return row.id
                }
                const dateOnlyId = byTitle('date only')
                const statusOnlyId = byTitle('status only')
                const tagAndStatusId = byTitle('tag and status')

                const todoStore = tx.objectStore('todos')
                // date only — set dueDate
                const r1 = todoStore.get(dateOnlyId)
                r1.onsuccess = () => {
                  const t = r1.result as Record<string, unknown>
                  t.dueDate = new Date()
                  todoStore.put(t)
                }
                // status only — set statusId
                const r2 = todoStore.get(statusOnlyId)
                r2.onsuccess = () => {
                  const t = r2.result as Record<string, unknown>
                  t.statusId = statusId
                  todoStore.put(t)
                }
                // tag and status — set statusId, then add a todoTags join
                const r3 = todoStore.get(tagAndStatusId)
                r3.onsuccess = () => {
                  const t = r3.result as Record<string, unknown>
                  t.statusId = statusId
                  todoStore.put(t)
                  tx.objectStore('todoTags').add({ todoId: tagAndStatusId, tagId })
                }
              }
            }
          }

          tx.oncomplete = () => { idb.close(); resolve() }
          tx.onerror = () => { idb.close(); reject(tx.error) }
          tx.onabort = () => { idb.close(); reject(tx.error ?? new Error('seed tx aborted')) }
        }
        req.onerror = () => reject(req.error)
      })
    }, DB)

    await page.reload()
    await page.locator('.react-flow__viewport').first().waitFor({ state: 'visible' })
    await taskRowByTitle(page, 'tag and status').waitFor({ state: 'visible' })

    const titles = ['empty row', 'date only', 'status only', 'tag and status']

    for (const title of titles) {
      const row = taskRowByTitle(page, title)
      await row.scrollIntoViewIfNeeded()

      const positions = await row.evaluate((r) => {
        const xOf = (el: Element | null): number | null =>
          el ? Math.round((el as HTMLElement).getBoundingClientRect().left) : null

        // Slot 1 — # tags. Empty: `Add tag` button. Populated: any `tagChip` button.
        const xTag = xOf(
          r.querySelector('button[aria-label="Add tag"]') ??
          r.querySelector('button[class*="tagChip"]'),
        )

        // Slot 2 — @ people/orgs. Empty: a button whose text is exactly "@".
        // Populated: a `peopleGroup` wrapper from TaskPillPeople.
        let slot2: Element | null = r.querySelector('[class*="peopleGroup"]')
        if (!slot2) {
          const buttons = Array.from(r.querySelectorAll('button'))
          slot2 = buttons.find((b) => b.textContent?.trim() === '@') ?? null
        }
        const xPeople = xOf(slot2)

        // Slot 3 — date. Empty: `dateStackEmpty` wrapper (calendar button).
        // Populated: `dateStack` wrapper from TaskPillDates (excluding the
        // empty variant via :not).
        const xDate = xOf(
          r.querySelector('[class*="dateStackEmpty"]') ??
          r.querySelector('[class*="dateStack"]:not([class*="dateStackEmpty"])'),
        )

        // Slot 4 — status. Always rendered in `statusWrapper`.
        const xStatus = xOf(r.querySelector('[class*="statusWrapper"]'))

        return { xTag, xPeople, xDate, xStatus }
      })

      expect(positions.xTag, `${title}: missing tag slot`).not.toBeNull()
      expect(positions.xPeople, `${title}: missing people slot`).not.toBeNull()
      expect(positions.xDate, `${title}: missing date slot`).not.toBeNull()
      expect(positions.xStatus, `${title}: missing status slot`).not.toBeNull()

      expect(positions.xTag!, `${title}: # should sit left of @`).toBeLessThan(positions.xPeople!)
      expect(positions.xPeople!, `${title}: @ should sit left of date`).toBeLessThan(positions.xDate!)
      expect(positions.xDate!, `${title}: date should sit left of status`).toBeLessThan(positions.xStatus!)
    }
  })
})
