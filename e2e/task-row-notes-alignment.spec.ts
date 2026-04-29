import { expect, test } from '@playwright/test'
import { seedCanvasWithProjects, taskRowByTitle } from './fixtures/seed'

/**
 * Locks in the notes-pill placement on `TaskRow` (triage-2026-04-28 P3).
 * The notes pill used to render between `titleBlock` and `progressChip`,
 * which left it stranded mid-row when only date+notes were set: the
 * invisible hover-reveal placeholders for tags / people sat between the
 * notes pill and the date pill, putting ~67 px of empty space between
 * them. The fix relocates the notes pill into the chip-group flex row
 * immediately before the date stack so the two pills cluster on the
 * right with the same gap as any two adjacent chips.
 *
 * JSDOM is not authoritative for this — `align-items: center` only
 * resolves to a real pixel `top` under a real layout engine, and the
 * gap between the notes pill and the date pill is the regression we
 * actually care about. Both reads happen in real Chromium.
 */

const DB = 'todo2'

test.describe('TaskRow notes pill alignment', () => {
  test('notes pill clusters with date pill in the chip-group row', async ({ page }) => {
    await seedCanvasWithProjects(page, {
      projects: [{ name: 'Notes', tasks: ['notes and date'] }],
    })

    await page.evaluate(async (db) => {
      await new Promise<void>((resolve, reject) => {
        const req = indexedDB.open(db)
        req.onsuccess = () => {
          const idb = req.result
          const tx = idb.transaction(['todos'], 'readwrite')
          const todos = tx.objectStore('todos')
          const all = todos.getAll()
          all.onsuccess = () => {
            const rows = all.result as Array<{ id: number; title: string }>
            const target = rows.find((r) => r.title === 'notes and date')
            if (!target) { reject(new Error('seed: missing "notes and date"')); return }
            const get = todos.get(target.id)
            get.onsuccess = () => {
              const t = get.result as Record<string, unknown>
              t.notes = 'pill alignment regression'
              t.dueDate = new Date()
              todos.put(t)
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
    const row = taskRowByTitle(page, 'notes and date')
    await row.waitFor({ state: 'visible' })

    const measurements = await row.evaluate((r) => {
      const rect = (sel: string): DOMRect | null => {
        const el = r.querySelector(sel)
        return el ? (el as HTMLElement).getBoundingClientRect() : null
      }
      const notes = rect('button[aria-label="Edit notes"]')
      const date = rect('[class*="dateStack"]:not([class*="dateStackEmpty"])')
      const status = rect('[class*="statusWrapper"]')
      return {
        notes: notes && { left: notes.left, right: notes.right, top: notes.top, height: notes.height },
        date: date && { left: date.left, right: date.right, top: date.top, height: date.height },
        status: status && { left: status.left, right: status.right, top: status.top, height: status.height },
      }
    })

    expect(measurements.notes, 'notes pill must render').not.toBeNull()
    expect(measurements.date, 'date pill must render').not.toBeNull()
    expect(measurements.status, 'status pill must render').not.toBeNull()

    const notes = measurements.notes!
    const date = measurements.date!
    const status = measurements.status!

    // Vertical alignment — same horizontal axis (centers within ~3 px of
    // each other accounts for the 16-vs-18 px chip heights centered in a
    // 28 px row).
    const notesCenter = notes.top + notes.height / 2
    const dateCenter = date.top + date.height / 2
    expect(
      Math.abs(notesCenter - dateCenter),
      'notes and date pill should share a vertical center',
    ).toBeLessThanOrEqual(3)

    // Horizontal clustering — notes immediately precedes date with a gap
    // matching the chip-group gap (`var(--space-1)` ≈ 4 px) plus the
    // row's own gap (`var(--space-4)` between flex children, ≈ 10 px).
    // Tolerate up to 14 px to cover both gaps.
    expect(notes.right, 'notes should sit left of date').toBeLessThan(date.left)
    expect(
      date.left - notes.right,
      'notes pill should cluster with date pill (no stranded gap)',
    ).toBeLessThanOrEqual(14)

    // Slot ordering: notes is between people and date, before status.
    expect(notes.left, 'notes should sit left of date').toBeLessThan(date.left)
    expect(date.right, 'date should sit left of status').toBeLessThan(status.left)
  })
})
