import { expect, test, type Locator, type Page } from '@playwright/test'
import { taskRowByTitle } from './fixtures/seed'
import { openSettings, seedWorkspace, wsTab, wsRow } from './fixtures/workspace'

/**
 * A list tab's badge in a real browser: an inactive tab counts too, its
 * capsule takes room from the title, the top bar's filters and Settings'
 * ranges change it, Edit list turns it off, and tabs folded into `+N` carry
 * theirs. A priority's row cues: the glow (one colour, a blend), hover
 * painting over it, the semibold title, and Settings' switches.
 */

const badge = (tab: Locator) => tab.locator('[data-tab-badge]')

const BADGE_SEED = {
  people: ['Ann'],
  listDefinitions: [{ name: 'Everything' }, { name: 'Ann quarterly planning review', people: ['Ann'] }],
  tasks: [
    { title: 'Overdue task', dueInDays: -2, people: ['Ann'] },
    { title: 'Due soon', dueInDays: 2, people: ['Ann'] },
    { title: 'Due later', dueInDays: 30, people: ['Ann'] },
    { title: 'Follow up today', followupInDays: 0, people: ['Ann'] },
    { title: 'Not Ann, due today', dueInDays: 0 },
    { title: 'Finished', dueInDays: -5, people: ['Ann'], isCompleted: true },
  ],
  layouts: [{
    name: 'Main',
    columns: [{ id: 'c1', rows: [wsRow({ id: 'k1', tabs: [{ id: 'all', kind: 'lens' as const, listDefIdx: 0 }, { id: 'ann', kind: 'lens' as const, listDefIdx: 1 }] })] }],
  }],
}

test.describe('tab badges', () => {
  test.use({ viewport: { width: 1200, height: 800 } })

  test('an inactive tab counts what it shows; its title says how; overdue is solid', async ({ page }) => {
    await seedWorkspace(page, BADGE_SEED)
    const ann = wsTab(page, 'ann')
    await expect(badge(ann).locator('span')).toHaveText(['2', '1'])
    await expect(badge(wsTab(page, 'all')).locator('span')).toHaveText(['3', '1'])
    await expect(ann).toHaveAttribute('title', /2 due: 1 overdue, 1 within 3 days\n1 follow-up: today/)

    const solid = await badge(ann).locator('span').first().evaluate((el) => getComputedStyle(el).backgroundColor)
    const tinted = await badge(ann).locator('span').nth(1).evaluate((el) => getComputedStyle(el).backgroundColor)
    expect(solid).toMatch(/^rgb\(/)
    expect(tinted).toMatch(/^(rgba\(|color\()/)
  })

  test('the capsule keeps its width while the title gives way', async ({ page }) => {
    await page.setViewportSize({ width: 420, height: 800 })
    await seedWorkspace(page, BADGE_SEED)
    const ann = wsTab(page, 'ann')
    await expect(badge(ann).locator('span')).toHaveText(['2', '1'])
    const title = ann.locator('[data-tab-title]')
    await expect.poll(() => title.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true)
    const [tab, capsule] = await Promise.all([ann.boundingBox(), badge(ann).boundingBox()])
    if (!tab || !capsule) throw new Error('no boxes')
    expect(capsule.x + capsule.width).toBeLessThanOrEqual(tab.x + tab.width)
    expect(capsule.height).toBe(14)
  })

  test('the top bar’s search narrows it; Settings’ ranges change or end it', async ({ page }) => {
    await seedWorkspace(page, BADGE_SEED)
    const ann = wsTab(page, 'ann')
    await expect(badge(ann).locator('span')).toHaveText(['2', '1'])

    await page.getByPlaceholder('Search…').fill('soon')
    await expect(badge(ann).locator('span')).toHaveText(['1'])
    await page.getByPlaceholder('Search…').fill('')
    await expect(badge(ann).locator('span')).toHaveText(['2', '1'])

    const settings = await openSettings(page, 'Tasks')
    await settings.getByRole('combobox', { name: 'Tab badges: due' }).selectOption('overdue')
    await expect(badge(ann).locator('span')).toHaveText(['1', '1'])
    await settings.getByRole('combobox', { name: 'Tab badges: due' }).selectOption('off')
    await settings.getByRole('combobox', { name: 'Tab badges: follow-up' }).selectOption('off')
    await expect(badge(ann)).toHaveCount(0)

    await page.reload()
    await expect(wsTab(page, 'ann')).toBeVisible()
    await expect(badge(wsTab(page, 'ann'))).toHaveCount(0)
  })

  test('Edit list turns a list’s badge off, or gives it its own ranges', async ({ page }) => {
    await seedWorkspace(page, BADGE_SEED)
    const ann = wsTab(page, 'ann')
    await expect(badge(ann).locator('span')).toHaveText(['2', '1'])

    await ann.click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Edit list…' }).click()
    const pickMode = async (name: string) => {
      await page.getByRole('button', { name: /^Tab badges/ }).click()
      await page.getByRole('menuitemradio', { name }).click()
    }
    await pickMode('Off for this list')
    await expect(badge(ann)).toHaveCount(0)
    await expect(badge(wsTab(page, 'all')).locator('span')).toHaveText(['3', '1'])

    await pickMode('Custom ranges')
    await page.getByRole('combobox', { name: 'Tab badges: due' }).selectOption('14')
    await page.getByRole('combobox', { name: 'Tab badges: follow-up' }).selectOption('off')
    await expect(badge(ann).locator('span')).toHaveText(['2'])
  })

  test('tabs folded into +N carry their badges into its menu', async ({ page }) => {
    await page.setViewportSize({ width: 340, height: 800 })
    await seedWorkspace(page, {
      ...BADGE_SEED,
      listDefinitions: [{ name: 'Everything one' }, { name: 'Everything two' }, { name: 'Everything three' }, { name: 'Everything four' }, { name: 'Everything five' }],
      layouts: [{
        name: 'Main',
        columns: [{ id: 'c1', rows: [wsRow({ id: 'k1', tabs: [0, 1, 2, 3, 4].map((i) => ({ id: `t${i}`, kind: 'lens' as const, listDefIdx: i })) })] }],
      }],
    })
    await page.getByRole('button', { name: /more tabs$/ }).click()
    await expect(page.getByRole('menu', { name: 'More tabs' }).locator('[data-tab-badge]').first()).toBeVisible()
  })
})

const CUE_SEED = {
  listDefinitions: [{ name: 'Everything' }],
  tasks: [
    { title: 'Plain' },
    { title: 'In focus', focus: true },
    { title: 'Urgent one', urgent: true },
    { title: 'Important one', important: true },
    { title: 'Both', urgent: true, important: true },
    { title: 'Done both', urgent: true, important: true, isCompleted: true },
  ],
  layouts: [{ name: 'Main', columns: [{ id: 'c1', rows: [wsRow({ id: 'k1', tabs: [{ id: 't1', kind: 'lens' as const, listDefIdx: 0 }] })] }] }],
}

/** The row itself, inside the fixture's wrapper: it holds the glow. */
const rowOf = (page: Page, title: string) => taskRowByTitle(page, title).locator('[data-todo-id]').first()
const backgroundImage = (row: Locator) => row.evaluate((el) => getComputedStyle(el).backgroundImage)
const titleWeight = (page: Page, title: string) => page.locator(`[data-task-title="${title}"]`).evaluate((el) => getComputedStyle(el).fontWeight)

test.describe('priority row cues', () => {
  test.use({ viewport: { width: 1200, height: 800 } })

  test('the default cues: Focus nothing, Urgent a glow, Important a glow and semibold, both a blend; the ring stays', async ({ page }) => {
    await seedWorkspace(page, CUE_SEED)
    await expect(taskRowByTitle(page, 'Plain')).toBeVisible()
    expect(await backgroundImage(rowOf(page, 'Plain'))).toBe('none')
    expect(await backgroundImage(rowOf(page, 'In focus'))).toBe('none')
    expect(await backgroundImage(rowOf(page, 'Urgent one'))).toContain('radial-gradient')
    expect(await backgroundImage(rowOf(page, 'Important one'))).toContain('radial-gradient')
    expect(await backgroundImage(rowOf(page, 'Both'))).toContain('linear-gradient')
    expect(await titleWeight(page, 'Important one')).toBe('600')
    expect(await titleWeight(page, 'Urgent one')).not.toBe('600')
    expect(await titleWeight(page, 'Both')).toBe('600')
    await expect(taskRowByTitle(page, 'Both').locator('[data-priority-ring="split"]')).toBeVisible()
  })

  test('hover paints over the glow', async ({ page }) => {
    await seedWorkspace(page, CUE_SEED)
    const row = rowOf(page, 'Urgent one')
    await expect(row).toBeVisible()
    await row.hover()
    await expect.poll(() => backgroundImage(row)).toBe('none')
  })

  test('Settings’ switches change the rows and last across a reload', async ({ page }) => {
    await seedWorkspace(page, CUE_SEED)
    const settings = await openSettings(page, 'Tasks')
    await settings.getByRole('switch', { name: 'Focus glow' }).click()
    await settings.getByRole('switch', { name: 'Important semibold' }).click()
    await expect.poll(() => backgroundImage(rowOf(page, 'In focus'))).toContain('radial-gradient')
    await expect.poll(() => titleWeight(page, 'Important one')).not.toBe('600')

    await page.reload()
    await expect(taskRowByTitle(page, 'In focus')).toBeVisible()
    expect(await backgroundImage(rowOf(page, 'In focus'))).toContain('radial-gradient')
    expect(await titleWeight(page, 'Important one')).not.toBe('600')
  })
})
