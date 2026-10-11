import { expect, test } from '@playwright/test'
import { taskRowByTitle } from './fixtures/seed'
import { seedTaskList } from './fixtures/workspace'

/**
 * Locks in the chip-slot ordering invariant on `TaskRow`. The four chip
 * slots (`# tags`, `@ people`, `date`, `status`) must appear in fixed
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

test.describe('TaskRow chip slot order', () => {
  test('# / @ / date / status appear in fixed left-to-right order across populated/empty combos', async ({ page }) => {
    await seedTaskList(page, {
      statuses: ['Doing'],
      tags: ['urgent'],
      tasks: [
        { title: 'empty row' },
        { title: 'date only', dueInDays: 0 },
        { title: 'status only', status: 'Doing' },
        { title: 'tag and status', status: 'Doing', tags: ['urgent'] },
      ],
    })
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

        // Slot 2 — @ people. Empty: a button whose text is exactly "@".
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
