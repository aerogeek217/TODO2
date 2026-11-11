import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { readStore, writeStores } from './fixtures/db'
import { emptyPredicate, seedWorkspace, type WorkspaceSeed } from './fixtures/workspace'

/**
 * Created vs completed's name, filter and Show as (widget feedback 2C) in a
 * real browser: the three presentations at the medium and the large face
 * over a seeded history, a point opening its tasks, the days before the
 * history log began dashed and marked ≈, and the editor's Save / Undo.
 *
 * `TREND_SHOTS=<folder>` also writes a dark-theme screenshot of each
 * presentation at each face there.
 */

test.use({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' })

const SHOTS = process.env.TREND_SHOTS

/** Days from today, for the seed's `modifiedInDays` / `completedInDays`. */
const TASKS: NonNullable<WorkspaceSeed['tasks']> = [
  // Open since before the range.
  { title: 'Draft the Atlas brief', tags: ['Project: Atlas'], modifiedInDays: -40 },
  { title: 'Atlas vendor list', tags: ['Project: Atlas'], modifiedInDays: -38 },
  { title: 'Atlas budget', tags: ['Project: Atlas'], modifiedInDays: -35 },
  { title: 'Renew the domain', modifiedInDays: -33 },
  { title: 'Office plants', modifiedInDays: -31 },
  { title: 'Quarterly taxes', modifiedInDays: -30 },
  // Created inside the range.
  { title: 'Atlas kickoff deck', tags: ['Project: Atlas'], modifiedInDays: -12 },
  { title: 'Hire a designer', modifiedInDays: -9 },
  { title: 'Atlas risks', tags: ['Project: Atlas'], modifiedInDays: -6 },
  { title: 'Fix the printer', modifiedInDays: -3 },
  { title: 'Atlas timeline', tags: ['Project: Atlas'], modifiedInDays: -1 },
  // Completed inside the range (created before it).
  { title: 'Atlas scope', tags: ['Project: Atlas'], modifiedInDays: -30, completedInDays: -11 },
  { title: 'Book the venue', modifiedInDays: -30, completedInDays: -8 },
  { title: 'Atlas sponsor sign-off', tags: ['Project: Atlas'], modifiedInDays: -30, completedInDays: -7 },
  { title: 'Order badges', modifiedInDays: -30, completedInDays: -5 },
  { title: 'Atlas contract', tags: ['Project: Atlas'], modifiedInDays: -30, completedInDays: -2 },
  { title: 'Send the invoice', modifiedInDays: -30, completedInDays: -1 },
]

const SHOWS = ['bars', 'burndown', 'cumulative'] as const

/** Medium faces in the top row (a 160px row), large ones under it; the large ones count #Project: Atlas. */
function seed(atlasTagId: number): WorkspaceSeed {
  const atlas = { filter: { ...emptyPredicate(), expression: { kind: 'tag', id: atlasTagId } } }
  return {
    tags: ['Project: Atlas'],
    tasks: TASKS,
    layouts: [{ name: 'Trend', table: {
      areas: ['c-m-bars c-m-burndown c-m-cumulative', 'c-l-bars c-l-burndown c-l-cumulative'],
      rows: [{ px: 160 }, 1000],
      cells: SHOWS.flatMap((show) => [
        { id: `c-m-${show}`, tabs: [{ id: `m-${show}`, kind: 'trend', glance: { range: '14d', show } }] },
        { id: `c-l-${show}`, tabs: [{ id: `l-${show}`, kind: 'trend', glance: { range: '14d', show, name: 'Atlas', ...atlas } }] },
      ]).sort((a, b) => order(a.id) - order(b.id)),
    } }],
  }
}

/** The cells in the areas' reading order. */
function order(id: string): number {
  return ['c-m-bars', 'c-m-burndown', 'c-m-cumulative', 'c-l-bars', 'c-l-burndown', 'c-l-cumulative'].indexOf(id)
}

/**
 * Seeds the layout and a history: each task's `created` event at its
 * creation, `completed` at its completion; the history log H3 began five
 * days ago (so a tag filter's earlier days read ≈).
 */
async function seedHistory(page: Page): Promise<void> {
  // A fresh database: the one seeded tag is tag 1.
  await seedWorkspace(page, seed(1))
  const tags = await readStore<{ id: number; name: string }>(page, 'tags')
  expect(tags.find((t) => t.name === 'Project: Atlas')?.id).toBe(1)
  const todos = await readStore<{ id: number; createdAt: Date; completedAt?: Date }>(page, 'todos')
  const events = todos.flatMap((t) => [
    { todoId: t.id, type: 'created', fromValue: null, toValue: null, timestamp: new Date(t.createdAt).toISOString() },
    ...(t.completedAt ? [{ todoId: t.id, type: 'completed', fromValue: null, toValue: null, timestamp: new Date(t.completedAt).toISOString() }] : []),
  ])
  const since = new Date()
  since.setDate(since.getDate() - 5)
  await writeStores(page, {
    clear: ['todoEvents'],
    add: { todoEvents: events },
    put: { settings: [{ key: 'historyLogSince', value: since.toISOString() }] },
  })
  await page.reload()
  await page.locator('[data-ws-area]').waitFor({ state: 'visible' })
}

const widget = (page: Page, id: string) => page.locator(`[data-glance-tab="${id}"]`)
const dialog = (page: Page) => page.locator('[data-task-dialog]')

test('the three presentations at the medium and large face; a point opens its tasks; days before the log are ≈', async ({ page }) => {
  await seedHistory(page)
  for (const show of SHOWS) {
    await expect(widget(page, `m-${show}`)).toHaveAttribute('data-face', 'medium')
    await expect(widget(page, `l-${show}`)).toHaveAttribute('data-face', 'large')
    await expect(widget(page, `m-${show}`).locator(`[data-trend-show="${show}"]`)).toBeVisible()
    await expect(widget(page, `l-${show}`).locator(`[data-trend-show="${show}"]`)).toBeVisible()
  }
  // Every task: 11 open now (6 from before the range + 5 created in it), 12 at the start (the 6 completed in it were open then).
  // The medium face has no stats row: its line's first and last values are labelled, today's point says it.
  const burndown = widget(page, 'm-burndown')
  await expect(burndown.getByTestId('trend-open-now')).toHaveCount(0)
  await expect(burndown.locator('[data-trend-column="13"]')).toHaveAttribute('aria-label', /: 11 open now\. Show tasks$/)
  await expect(burndown.locator('svg text')).toContainText(['12', '11'])
  // No filter: every count exact.
  await expect(burndown.locator('polyline[data-approx="true"]')).toHaveCount(0)
  await expect(widget(page, 'l-bars').getByTestId('trend-approximate')).toHaveCount(1)
  // The large ones count #Project: Atlas — tags are exact only since the log began: ≈, the early days dashed.
  const atlas = widget(page, 'l-burndown')
  await expect(atlas.locator('[data-trend-head]')).toHaveText('Atlas')
  await expect(atlas.getByTestId('trend-approximate')).toHaveText(/^≈ before /)
  await expect(atlas.locator('[data-trend-line="open"] polyline[data-approx="true"]')).toHaveCount(1)
  await expect(atlas.getByTestId('trend-open-now')).toContainText('6')
  // Today's point opens the tasks open now.
  await atlas.locator('[data-trend-column="13"]').click()
  await expect(dialog(page).getByRole('heading')).toHaveText('Atlas · Open now')
  await expect(dialog(page).locator('[data-todo-id]')).toHaveCount(6)
  await page.keyboard.press('Escape')
  // A Cumulative point opens what its lines count through that day, in groups.
  await widget(page, 'l-cumulative').locator('[data-trend-column="13"]').click()
  await expect(dialog(page).getByRole('heading')).toHaveText('Atlas · Through today')
  await expect(dialog(page)).toContainText('Open at the start')
  await page.keyboard.press('Escape')
  // Bars before the log began are dimmed (≈).
  await expect(widget(page, 'l-bars').locator('[data-trend-column="0"]')).toHaveAttribute('data-approx', 'true')
  await expect(widget(page, 'l-bars').locator('[data-trend-column="13"]')).not.toHaveAttribute('data-approx', 'true')

  if (SHOTS) {
    mkdirSync(SHOTS, { recursive: true })
    await page.mouse.move(0, 0)
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
    await page.evaluate(async () => {
      await document.fonts.ready
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
    })
    for (const show of SHOWS) {
      await page.locator(`[data-ws-cell="c-m-${show}"]`).screenshot({ path: join(SHOTS, `${show}-medium.png`) })
      await page.locator(`[data-ws-cell="c-l-${show}"]`).screenshot({ path: join(SHOTS, `${show}-large.png`) })
    }
    await page.screenshot({ path: join(SHOTS, 'layout.png') })
  }
})

test('Edit chart…: Show as and the name draw live; Save is one undo step; Undo puts it back', async ({ page }) => {
  await seedHistory(page)
  const w = widget(page, 'm-bars')
  await w.locator('[data-trend-head]').click({ button: 'right' })
  await page.getByRole('menu', { name: 'Cell options' }).getByRole('menuitem', { name: 'Edit chart…' }).click()
  const editor = page.locator('[data-trend-editor="m-bars"]')
  await expect(editor).toBeVisible()
  await expect(editor.getByRole('textbox', { name: 'Name' })).toHaveValue('Created vs completed')
  await editor.getByRole('radio', { name: 'Cumulative' }).click()
  await expect(w.locator('[data-trend-show="cumulative"]')).toBeVisible()
  await editor.getByRole('textbox', { name: 'Name' }).fill('Everything')
  await expect(w.locator('[data-trend-head]')).toHaveText('Everything')
  await editor.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(editor).toHaveCount(0)
  await expect(page.getByText('Edited chart “Everything”')).toBeVisible()
  await page.keyboard.press('Control+z')
  await expect(w.locator('[data-trend-show="bars"]')).toBeVisible()
  await expect(w.locator('[data-trend-head]')).toHaveText('Created vs completed')
})
