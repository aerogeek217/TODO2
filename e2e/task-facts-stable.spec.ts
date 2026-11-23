import { expect, test, type Locator, type Page } from '@playwright/test'
import { box, type Box } from './fixtures/geometry'
import { taskRowByTitle } from './fixtures/seed'
import { pickInReview, seedWorkspace, wsRow, type WorkspaceSeed } from './fixtures/workspace'

/**
 * The task layout holds still while a field changes (E6): in the task editor
 * and the review card, a change to one fact — the due date (none, today, a
 * weekday, a numeric date in words, late), its repeat (the glyph after the
 * date), the priority toggles (the Urgent tint that a due date brings), the
 * status, a person or a tag added and removed, the footer's follow-up —
 * moves neither the header nor any fact cell, nor the band's own box, by
 * more than a pixel. Each cell's width is the band's to give
 * (`TaskDetails.module.css`), every priority toggle is the same width, a
 * date's two lines are always there, and the header's `Modified …` sits in a
 * box as wide as its longest words. The compact row: in the 1040px editor and
 * in a review card about 780px wide the six facts share one line.
 */

const TITLE = 'Steady task'
const LIST = 'l1'

const SEED: WorkspaceSeed = {
  people: [{ name: 'Aisha', color: '#c8743a' }, { name: 'Ben', color: '#6c9bd2' }],
  tags: [{ name: 'legal', color: '#d8a35a' }, { name: 'ops', color: '#7ec4bc' }],
  statuses: ['Waiting', 'Follow-up'],
  tasks: [{ title: TITLE, people: ['Aisha'], tags: ['legal'], dueInDays: 10 }],
  listDefinitions: [{ name: 'Everything', grouping: 'none', sort: 'manual' }],
  layouts: [{
    name: 'Main',
    columns: [{ id: 'c1', rows: [wsRow({ id: 'k1', tabs: [{ id: LIST, kind: 'lens', listDefIdx: 0 }] })] }],
  }],
}

const REVIEW_SEED: WorkspaceSeed = {
  ...SEED,
  layouts: [{
    name: 'Review',
    table: { areas: ['rv'], cells: [{ id: 'rv', tabs: [{ id: 'rv1', kind: 'review' }] }] },
  }],
}

/** Every box the change must leave where it was: the header's parts, the band and each fact cell. */
async function snapshot(header: Record<string, Locator>, host: Locator): Promise<Record<string, Box>> {
  const out: Record<string, Box> = {}
  for (const [name, loc] of Object.entries(header)) out[`header ${name}`] = await box(loc)
  out.band = await box(host.locator('[data-task-facts]'))
  for (const fact of await host.locator('[data-task-facts] [data-fact]').all()) {
    out[`fact ${await fact.getAttribute('data-fact')}`] = await box(fact)
  }
  return out
}

/**
 * Nothing moved or resized. With `taller`, a pill that needed another line may make the band and
 * the cells of its line taller (and push a later line down) — still nothing moves sideways, and the
 * header and the band's top stay.
 */
function expectSame(before: Record<string, Box>, after: Record<string, Box>, step: string, taller = false) {
  expect(Object.keys(after), `${step}: the same parts`).toEqual(Object.keys(before))
  for (const [name, b] of Object.entries(before)) {
    const a = after[name]!
    const keys = taller && name.startsWith('fact ') ? ['x', 'width'] as const
      : taller && name === 'band' ? ['x', 'y', 'width'] as const
        : ['x', 'y', 'width', 'height'] as const
    for (const k of keys) {
      expect(Math.abs(a[k] - b[k]), `${step}: ${name} ${k} ${b[k]} → ${a[k]}`).toBeLessThanOrEqual(1)
    }
  }
}

/** Animations under `el` done, then two frames: what the change draws has been laid out. */
async function settle(el: Locator) {
  await el.evaluate(async (node) => {
    await Promise.allSettled(node.getAnimations({ subtree: true }).map((a) => a.finished))
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
  })
}

/** Today + `days` as the date input's value (`YYYY-MM-DD`, local). */
async function dayValue(page: Page, days: number): Promise<string> {
  return page.evaluate((n) => {
    const d = new Date()
    d.setDate(d.getDate() + n)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  }, days)
}

/**
 * Sets the due date through the date's popover (its date input, ⏎ writing it and closing the
 * popover) — or, with `null`, clears it with the cell's × — and waits for it to land.
 */
async function setDue(page: Page, host: Locator, days: number | null) {
  const due = host.locator('[data-fact="due"]')
  if (days == null) {
    await due.getByRole('button', { name: 'Clear due date' }).click()
    await expect(due.getByRole('button', { name: 'Set due date' })).toBeVisible()
    return
  }
  const value = await dayValue(page, days)
  await due.getByRole('button', { name: /^(Due date:|Set due date)/ }).click()
  const popover = page.getByRole('dialog', { name: 'Due date' })
  const input = popover.locator('input[type="date"]')
  await input.fill(value)
  await input.press('Enter')
  await expect(popover).toBeHidden()
  const [y, m, d] = value.split('-').map(Number) as [number, number, number]
  const full = new Date(y, m - 1, d).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
  await expect(due.getByRole('button', { name: `Due date: ${full}` })).toBeVisible()
}

/** The Urgent toggle's mark colour against the urgent colour, both as the page computes them. */
async function urgentTinted(toggle: Locator): Promise<boolean> {
  return toggle.evaluate((el) => {
    const probe = document.createElement('span')
    probe.style.color = 'var(--color-marker-urgent)'
    el.appendChild(probe)
    const urgent = getComputedStyle(probe).color
    probe.remove()
    return getComputedStyle(el).color === urgent
  })
}

/** Runs each change on `host` and checks nothing moved after any of them. */
async function expectStillThroughChanges(page: Page, host: Locator, header: Record<string, Locator>, footer: Locator) {
  await settle(host)
  const base = await snapshot(header, host)
  const check = async (step: string, taller = false) => {
    await settle(host)
    expectSame(base, await snapshot(header, host), step, taller)
  }
  const facts = host.locator('[data-task-facts]')
  const priority = (name: string) => facts.locator('[data-fact="priority"]').getByRole('button', { name, exact: true })

  // The due date: a weekday's words, Today (the Urgent tint comes with it), late, a numeric date, none.
  for (const [days, step] of [[3, 'due in 3 days'], [0, 'due today'], [-40, 'due 40 days late'], [20, 'due in 20 days'], [null, 'no due date'], [10, 'due in 10 days']] as const) {
    await setDue(page, host, days)
    await check(step)
  }
  expect(await urgentTinted(priority('Urgent'))).toBe(false)
  await setDue(page, host, 0)
  await expect(priority('Urgent')).toHaveAttribute('data-urgent', 'date')
  await expect(priority('Urgent')).toHaveAttribute('aria-pressed', 'false')
  await expect.poll(() => urgentTinted(priority('Urgent'))).toBe(true)
  await check('the Urgent tint shows')

  // Its repeat, typed in the date's popover: the glyph comes and goes after the date.
  const due = facts.locator('[data-fact="due"]')
  const popover = page.getByRole('dialog', { name: 'Due date' })
  const repeat = popover.getByRole('textbox', { name: 'Repeat every' })
  for (const [value, name] of [['1w', /^Every \w{3}$/], ['3m', /^Every 3 months$/], ['', null]] as const) {
    await due.getByRole('button', { name: /^Due date:/ }).click()
    await repeat.fill(value)
    await repeat.press('Enter')
    await expect(popover).toBeHidden()
    if (name) await expect(due.getByRole('img')).toHaveAccessibleName(name)
    else await expect(due.getByRole('img')).toHaveCount(0)
    await check(`repeat ${value || 'none'}`)
  }

  // The priority toggles.
  for (const name of ['Focus', 'Urgent', 'Important']) {
    await priority(name).click()
    await expect(priority(name)).toHaveAttribute('aria-pressed', 'true')
    await check(`${name} on`)
    await priority(name).click()
    await expect(priority(name)).toHaveAttribute('aria-pressed', 'false')
    await check(`${name} off`)
  }

  // The status.
  const pill = facts.locator('[data-fact="status"]').getByRole('button', { name: /^Status:/ })
  for (const [item, name] of [['Follow-up', 'Follow-up'], ['Waiting', 'Waiting'], ['No Status', 'No status']]) {
    await pill.click()
    await page.getByRole('menu').getByText(item, { exact: true }).click()
    await expect(pill).toHaveAccessibleName(`Status: ${name}`)
    await check(`status ${name}`)
  }

  // A person added and removed; a tag removed and added.
  const people = facts.locator('[data-fact="people"]')
  await people.getByRole('button', { name: 'Add person' }).click()
  await page.getByRole('option', { name: /Ben/ }).click()
  await page.keyboard.press('Escape')
  await expect(people.getByRole('button', { name: 'Remove Ben' })).toBeVisible()
  await check('Ben added', true)
  await people.getByRole('button', { name: 'Remove Ben' }).click()
  await expect(people.getByRole('button', { name: 'Remove Ben' })).toHaveCount(0)
  await check('Ben removed')
  const tags = facts.locator('[data-fact="tags"]')
  await tags.getByRole('button', { name: 'Remove #legal' }).click()
  await expect(tags.getByRole('button', { name: 'Remove #legal' })).toHaveCount(0)
  await check('#legal removed')
  await tags.getByRole('button', { name: 'Add tag' }).click()
  await page.getByRole('option', { name: /legal/ }).click()
  await page.keyboard.press('Escape')
  await expect(tags.getByRole('button', { name: 'Remove #legal' })).toBeVisible()
  await check('#legal added', true)

  // The footer's next follow-up: a quick interval, then cleared.
  const next = footer.getByRole('textbox', { name: 'Next follow-up' })
  await footer.getByRole('button', { name: /^Follow up in 1 week/ }).click()
  await expect(next).not.toHaveValue('')
  await check('next follow-up in a week')
  await next.hover()
  await footer.getByRole('button', { name: 'Clear next follow-up' }).click()
  await expect(next).toHaveValue('')
  await page.mouse.move(2, 2)
  await check('next follow-up cleared')
}

test.describe('the task layout holds still while a field changes', () => {
  test.use({ viewport: { width: 1440, height: 900 } })

  test('the task editor: the header and every fact cell stay put', async ({ page }) => {
    await seedWorkspace(page, SEED)
    await taskRowByTitle(page, TITLE).locator(`span[data-task-title="${TITLE}"]`).dblclick()
    const dialog = page.getByRole('dialog', { name: 'Edit task' })
    await expect(dialog).toBeVisible()
    const header = {
      checkbox: dialog.getByRole('checkbox').first(),
      title: dialog.getByRole('textbox', { name: /title/i }).first(),
      created: dialog.locator('[data-task-meta]'),
      more: dialog.getByRole('button', { name: 'More actions' }),
      close: dialog.getByRole('button', { name: /^Close/ }).first(),
    }
    await expectStillThroughChanges(page, dialog, header, dialog.locator('[data-task-footer]'))
  })

  test('the review card: its title and every fact cell stay put', async ({ page }) => {
    await seedWorkspace(page, REVIEW_SEED)
    await pickInReview(page, 'rv1', 'Aisha')
    const widget = page.locator('[data-review-widget="rv1"]')
    await expect(widget.getByTestId('review-card-title')).toHaveValue(TITLE)
    const card = widget.locator('[data-review-card]')
    const header = {
      title: card.getByTestId('review-card-title'),
      checkbox: card.getByRole('checkbox').first(),
    }
    await expectStillThroughChanges(page, card, header, widget.locator('[data-review-footer]'))
  })
})

/** The tops of the band's cells: one value when the six share one line. */
async function factTops(host: Locator): Promise<number[]> {
  return host.locator('[data-task-facts] [data-fact]').evaluateAll((cells) => cells.map((c) => Math.round(c.getBoundingClientRect().top)))
}

test.describe('the compact facts row', () => {
  test('the 1040px editor: the six facts on one line, the band shorter than three lines of a cell', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await seedWorkspace(page, SEED)
    await taskRowByTitle(page, TITLE).locator(`span[data-task-title="${TITLE}"]`).dblclick()
    const dialog = page.getByRole('dialog', { name: 'Edit task' })
    await expect(dialog).toBeVisible()
    expect(await dialog.evaluate((el) => (el as HTMLElement).offsetWidth)).toBe(1040)
    await settle(dialog)
    const tops = await factTops(dialog)
    expect(tops).toHaveLength(6)
    expect(new Set(tops).size, `tops ${tops.join(', ')}`).toBe(1)
    // The label, the day and its words: about 92px.
    expect((await box(dialog.locator('[data-task-facts]'))).height).toBeLessThanOrEqual(96)
  })

  test('a review card about 780px wide: the six facts on one line', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await seedWorkspace(page, REVIEW_SEED)
    await pickInReview(page, 'rv1', 'Aisha')
    const card = page.locator('[data-review-widget="rv1"] [data-review-card]')
    await expect(card.getByTestId('review-card-title')).toHaveValue(TITLE)
    // Size the window so the card is about 780px wide (the queue and the gutters take the rest).
    for (let i = 0; i < 3; i++) {
      const width = (await box(card)).width
      if (Math.abs(width - 780) <= 4) break
      const viewport = page.viewportSize()!
      await page.setViewportSize({ width: Math.round(viewport.width + 780 - width), height: viewport.height })
      await settle(card)
    }
    expect(Math.abs((await box(card)).width - 780)).toBeLessThanOrEqual(4)
    await settle(card)
    const tops = await factTops(card)
    expect(tops).toHaveLength(6)
    expect(new Set(tops).size, `tops ${tops.join(', ')}`).toBe(1)
  })
})
