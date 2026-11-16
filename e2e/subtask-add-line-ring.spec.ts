import { expect, test, type Locator } from '@playwright/test'
import { taskRowByTitle } from './fixtures/seed'
import { pickInReview, seedWorkspace, wsRow, type WorkspaceSeed } from './fixtures/workspace'

/**
 * The Subtasks section's + Add subtask line keeps its whole focus ring (the
 * one ring, `--focus-ring`: 4px outside the box) inside every scroller
 * around it — in the task editor and the review card, with no subtasks, a
 * few, and enough that the section scrolls (it scrolls inside past 260px):
 * its bottom edge was cut by the section's own scroller (user report,
 * 2026-11-16).
 */

const TITLE = 'Checklist task'
/** The focus ring's reach outside an element's box (`tokens.css`, `--focus-ring`). */
const RING_PX = 4

function seed(subtasks: number, review: boolean): WorkspaceSeed {
  return {
    people: [{ name: 'Aisha', color: '#c8743a' }],
    tasks: [{
      title: TITLE,
      people: ['Aisha'],
      subtasks: Array.from({ length: subtasks }, (_, i) => ({ title: `Step ${i + 1}`, done: i % 3 === 0 })),
    }],
    listDefinitions: [{ name: 'Everything', grouping: 'none', sort: 'manual' }],
    layouts: [review
      ? { name: 'Review', table: { areas: ['rv'], cells: [{ id: 'rv', tabs: [{ id: 'rv1', kind: 'review' }] }] } }
      : { name: 'Main', columns: [{ id: 'c1', rows: [wsRow({ id: 'k1', tabs: [{ id: 'l1', kind: 'lens', listDefIdx: 0 }] })] }] }],
  }
}

/**
 * How far the add line's ring reaches past each clipping ancestor's visible
 * box, side by side (px; 0 = inside), up to `host`.
 */
async function ringOverflow(input: Locator, host: Locator): Promise<Record<string, number>> {
  const hostHandle = await host.elementHandle()
  return input.evaluate((el, [stop, ring]) => {
    const r = el.getBoundingClientRect()
    const out: Record<string, number> = {}
    for (let a = el.parentElement; a && a !== stop; a = a.parentElement) {
      const cs = getComputedStyle(a)
      if (!/(auto|scroll|hidden|clip)/.test(`${cs.overflowX} ${cs.overflowY}`)) continue
      const b = a.getBoundingClientRect()
      const top = b.top + a.clientTop
      const left = b.left + a.clientLeft
      const name = `${a.tagName.toLowerCase()}.${a.className.toString().split(' ')[0] ?? ''}`
      out[name] = Math.max(0,
        Math.round(top - (r.top - ring)),
        Math.round(r.bottom + ring - (top + a.clientHeight)),
        Math.round(left - (r.left - ring)),
        Math.round(r.right + ring - (left + a.clientWidth)))
    }
    return out
  }, [hostHandle, RING_PX] as const)
}

async function expectRingShown(host: Locator, what: string) {
  const input = host.getByRole('textbox', { name: 'New subtask' })
  await input.focus()
  await expect(input).toBeFocused()
  await input.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
  const over = await ringOverflow(input, host)
  for (const [name, px] of Object.entries(over)) expect(px, `${what}: the ring past ${name}`).toBe(0)
}

test.use({ viewport: { width: 1440, height: 900 } })

for (const count of [0, 3, 14]) {
  test(`the task editor, ${count} subtasks: the add line's focus ring isn't cut`, async ({ page }) => {
    await seedWorkspace(page, seed(count, false))
    await taskRowByTitle(page, TITLE).locator(`span[data-task-title="${TITLE}"]`).dblclick()
    const dialog = page.getByRole('dialog', { name: 'Edit task' })
    await expect(dialog).toBeVisible()
    await expectRingShown(dialog, `editor, ${count}`)
  })

  test(`the review card, ${count} subtasks: the add line's focus ring isn't cut`, async ({ page }) => {
    await seedWorkspace(page, seed(count, true))
    await pickInReview(page, 'rv1', 'Aisha')
    const widget = page.locator('[data-review-widget="rv1"]')
    await expect(widget.getByTestId('review-card-title')).toHaveText(TITLE)
    await expectRingShown(widget.locator('[data-review-card]'), `review card, ${count}`)
  })
}
