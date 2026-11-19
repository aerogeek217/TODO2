import { expect, test, type Locator, type Page } from '@playwright/test'
import { box, type Box } from './fixtures/geometry'
import { taskRowByTitle } from './fixtures/seed'
import { pickInReview, seedWorkspace, wsRow, type WorkspaceSeed } from './fixtures/workspace'

/**
 * The task layout holds still while a field changes (E6): in the task editor
 * and the review card, a change to one fact — the due date (none, today, a
 * weekday, a numeric date in words, late), its repeat, the priority toggles
 * (the Urgent clock that a due date brings), the status, a person or a tag
 * added and removed, the footer's follow-up — moves neither the header nor
 * any fact cell, nor the band's own box, by more than a pixel. Each cell's
 * width is the band's to give (`TaskDetails.module.css`), the Urgent toggle
 * keeps its clock's room, and the header's `Modified …` sits in a box as wide
 * as its longest words.
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

/** Sets the due date as the browser's picker does (the hidden date input's change), and waits for it to land. */
async function setDue(page: Page, host: Locator, days: number | null) {
  const input = host.locator('[data-fact="due"] input[type="date"]')
  const value = days == null ? '' : await dayValue(page, days)
  await input.evaluate((el, v) => {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    set.call(el, v)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  }, value)
  await expect(input).toHaveValue(value)
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

  // The due date: a weekday's words, Today (the Urgent clock comes with it), late, a numeric date, none.
  for (const [days, step] of [[3, 'due in 3 days'], [0, 'due today'], [-40, 'due 40 days late'], [20, 'due in 20 days'], [null, 'no due date'], [10, 'due in 10 days']] as const) {
    await setDue(page, host, days)
    await check(step)
  }
  await expect(priority('Urgent').locator('[data-urgent-hint]')).toHaveCount(0)
  await setDue(page, host, 0)
  await expect(priority('Urgent').locator('[data-urgent-hint]')).toBeVisible()
  await check('the Urgent clock shows')

  // Its repeat.
  const repeat = facts.getByRole('combobox', { name: 'Repeat' })
  for (const value of ['weekly', 'quarterly', '']) {
    await repeat.selectOption(value)
    await expect(repeat).toHaveValue(value)
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
