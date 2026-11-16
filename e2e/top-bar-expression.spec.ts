import { expect, test, type Page } from '@playwright/test'
import { rowTitles } from './fixtures/seed'
import { seedWorkspace, wsListWidget, type WorkspaceSeed, wsRow } from './fixtures/workspace'
import { filterMenu, filterMenuRow, openFilterMenu } from './fixtures/filters'

/**
 * Feedback P2 (board Filter-B): the top bar's field takes a typed filter —
 * the list Expression grammar plus the search box's forms. Once the text
 * reads it filters every widget (the chips it can say become chips, the
 * rest is held as an expression beside them); a text that doesn't read
 * shows its error and changes nothing; Esc puts the text back. At rest each
 * term is a pill with its own ×; the field's × clears all, and the funnel at
 * the tray's left pauses the filter (feedback 2026-11-15) and resumes it.
 */

const SEED: WorkspaceSeed = {
  people: ['Priya Nair', 'Sam Ortiz'],
  tags: ['vendor', 'q4'],
  statuses: ['Waiting'],
  listDefinitions: [{ name: 'Everything', layoutIdx: 0 }],
  tasks: [
    { title: 'Priya vendor call', people: ['Priya Nair'], tags: ['vendor'] },
    { title: 'Sam vendor contract', people: ['Sam Ortiz'], tags: ['vendor'] },
    { title: 'Sam waiting on legal', people: ['Sam Ortiz'], tags: ['vendor'], status: 'Waiting' },
    { title: 'Priya q4 plan', people: ['Priya Nair'], tags: ['q4'] },
    { title: 'Nobody vendor intro', tags: ['vendor'] },
  ],
  layouts: [
    { name: 'Main', columns: [{ id: 'c1', rows: [wsRow({ id: 'k1', tabs: [{ id: 't1', kind: 'lens', listDefIdx: 0 }] })] }] },
  ],
}

const tray = (page: Page) => page.locator('header').getByRole('group', { name: 'Screen filters — apply to every widget' })
const field = (page: Page) => tray(page).getByRole('textbox', { name: 'Filter tasks' })
const pills = (page: Page) => tray(page).getByTestId('top-bar-pills')
const funnel = (page: Page) => tray(page).getByRole('button', { name: 'Pause the filter' })
const clear = (page: Page) => tray(page).getByRole('button', { name: 'Clear all filters' })
const counter = (page: Page) => tray(page).getByRole('button', { name: /tasks shown(, .+)?\. Show them$/ })
const error = (page: Page) => page.getByTestId('top-bar-filter-error')
const listTitles = (page: Page) => rowTitles(wsListWidget(page, 't1'))
const ALL = ['Priya vendor call', 'Sam vendor contract', 'Sam waiting on legal', 'Priya q4 plan', 'Nobody vendor intro']

/** The screen filter's chips and expression, from the store. */
const screenFilter = (page: Page) => page.evaluate(async () => {
  const mod = (await import(/* @vite-ignore */ '/src/stores/filter-store.ts' as string)) as {
    useFilterStore: { getState: () => { filters: { personIds: Set<number> | null; tags: Set<number> | null; expression?: unknown } } }
  }
  const f = mod.useFilterStore.getState().filters
  return { people: f.personIds?.size ?? 0, tags: f.tags?.size ?? 0, expression: f.expression != null }
})

test.use({ viewport: { width: 1440, height: 900 } })

test('an or expression narrows every list and the counter; at rest its terms are pills, each × takes one out; the field’s × clears', async ({ page }) => {
  await seedWorkspace(page, SEED)
  await expect.poll(() => listTitles(page)).toEqual(ALL)
  await expect(funnel(page)).toBeDisabled()
  await expect(field(page)).toHaveAttribute('placeholder', '@person #tag due fri')

  await field(page).click()
  await page.keyboard.type('#vendor and (@Priya or @Sam) and not !Waiting', { delay: 10 })
  await page.keyboard.press('Enter')
  await expect.poll(() => listTitles(page)).toEqual(['Priya vendor call', 'Sam vendor contract'])
  await expect(counter(page)).toHaveAccessibleName(/^2 of 5 open tasks shown/)
  // `(@Priya or @Sam)` and `not !Waiting` are chips too (People, Status is not); #vendor the Tags chip.
  expect(await screenFilter(page)).toEqual({ people: 2, tags: 1, expression: false })

  // At rest: a pill per term with its own ×; the funnel is red and live.
  await field(page).blur()
  await expect(pills(page)).toBeVisible()
  await expect(pills(page).locator('[data-top-bar-pill]')).toHaveText([/#vendor/, /@"Priya Nair"/, /@"Sam Ortiz"/, /!Waiting/])
  await expect(funnel(page)).toBeEnabled()

  await pills(page).getByRole('button', { name: 'Remove @"Sam Ortiz"' }).click()
  await expect.poll(() => listTitles(page)).toEqual(['Priya vendor call'])
  await pills(page).getByRole('button', { name: 'Remove !Waiting' }).click()
  await expect.poll(() => listTitles(page)).toEqual(['Priya vendor call'])

  await clear(page).click()
  await expect.poll(() => listTitles(page)).toEqual(ALL)
  await expect(pills(page)).toHaveCount(0)
  await expect(field(page)).toHaveValue('')
  await expect(funnel(page)).toBeDisabled()
  await expect(clear(page)).toHaveCount(0)
  await expect(counter(page)).toHaveCount(0)
})

test('the funnel pauses the filter: every list shows every task and the counter says paused; a click again narrows them; an edit resumes; the × clears', async ({ page }) => {
  await seedWorkspace(page, SEED)
  await expect.poll(() => listTitles(page)).toEqual(ALL)
  await field(page).click()
  await page.keyboard.type('#q4 or !Waiting', { delay: 10 })
  await page.keyboard.press('Enter')
  await field(page).blur()
  const narrowed = ['Sam waiting on legal', 'Priya q4 plan']
  await expect.poll(() => listTitles(page)).toEqual(narrowed)
  await expect(funnel(page)).toHaveAttribute('aria-pressed', 'false')

  // Paused: the filter stays (its pills dimmed and struck through), nothing applies it.
  await funnel(page).hover()
  await expect(page.getByRole('tooltip')).toHaveText('Pause the filter: show every task · click again to resume')
  await funnel(page).click()
  await expect(funnel(page)).toHaveAttribute('aria-pressed', 'true')
  await expect.poll(() => listTitles(page)).toEqual(ALL)
  await expect(counter(page)).toHaveAccessibleName('5 open tasks shown, the filter paused. Show them')
  await expect(counter(page)).toHaveText('5open · paused')
  await expect(tray(page)).not.toHaveAttribute('data-filtered')
  await expect(pills(page)).toHaveAttribute('data-paused', 'true')
  const pill = pills(page).locator('[data-top-bar-pill]').first().locator('span').first()
  expect(await pill.evaluate((el) => getComputedStyle(el).textDecorationLine)).toBe('line-through')
  expect(Number(await pills(page).evaluate((el) => getComputedStyle(el).opacity))).toBeCloseTo(0.55, 2)
  await page.mouse.move(0, 400)
  await funnel(page).hover()
  await expect(page.getByRole('tooltip')).toHaveText('Resume the filter')

  // Again: narrowed.
  await funnel(page).click()
  await expect(funnel(page)).toHaveAttribute('aria-pressed', 'false')
  await expect.poll(() => listTitles(page)).toEqual(narrowed)

  // Paused, an edit resumes it with the change: a pill's ×.
  await funnel(page).click()
  await expect.poll(() => listTitles(page)).toEqual(ALL)
  await pills(page).getByRole('button', { name: 'Remove !Waiting' }).click()
  await expect(funnel(page)).toHaveAttribute('aria-pressed', 'false')
  await expect.poll(() => listTitles(page)).toEqual(['Priya q4 plan'])

  // Paused, the × clears it all and ends the pause.
  await funnel(page).click()
  await expect.poll(() => listTitles(page)).toEqual(ALL)
  await clear(page).click()
  await expect(pills(page)).toHaveCount(0)
  await expect(funnel(page)).toBeDisabled()
  await expect(funnel(page)).not.toHaveAttribute('aria-pressed')
  await expect(clear(page)).toHaveCount(0)
  await expect.poll(() => listTitles(page)).toEqual(ALL)
})

test('what no chip says is held as an expression beside the chips, and composes with them', async ({ page }) => {
  await seedWorkspace(page, SEED)
  await expect.poll(() => listTitles(page)).toEqual(ALL)

  await field(page).click()
  await page.keyboard.type('@Priya or #q4 or !Waiting', { delay: 10 })
  await page.keyboard.press('Enter')
  await expect.poll(() => listTitles(page)).toEqual(['Priya vendor call', 'Sam waiting on legal', 'Priya q4 plan'])
  expect(await screenFilter(page)).toEqual({ people: 0, tags: 0, expression: true })

  // A chip from the Filter menu ANDs with it.
  await field(page).blur()
  await openFilterMenu(page)
  await filterMenuRow(page, 'Tags').click()
  await page.getByRole('option', { name: 'vendor' }).click()
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')
  await expect(filterMenu(page)).toHaveCount(0)
  await expect.poll(() => listTitles(page)).toEqual(['Priya vendor call', 'Sam waiting on legal'])
  // The field shows both: the chip first, then the expression.
  await expect(pills(page).locator('[data-top-bar-pill]')).toHaveText([/#vendor/, /@"Priya Nair"/, /#q4/, /!Waiting/])
})

test('a text that doesn’t read shows its error and keeps the last filter; Esc puts the text back', async ({ page }) => {
  await seedWorkspace(page, SEED)
  await expect.poll(() => listTitles(page)).toEqual(ALL)

  await field(page).click()
  await page.keyboard.type('#q4', { delay: 10 })
  await expect.poll(() => listTitles(page)).toEqual(['Priya q4 plan'])

  await page.keyboard.type(' or (@Sam', { delay: 10 })
  // The `@` popup first (no error while a name is being picked); Esc closes it.
  await expect(page.getByRole('listbox', { name: 'People' })).toBeVisible()
  await expect(error(page)).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expect(page.getByRole('listbox', { name: 'People' })).toHaveCount(0)
  await expect(error(page)).toBeVisible()
  await expect(error(page)).toContainText('Missing )')
  await expect(field(page)).toHaveAttribute('aria-invalid', 'true')
  // Nothing applied: the tasks keep the last filter that read.
  await page.waitForTimeout(600)
  await expect.poll(() => listTitles(page)).toEqual(['Priya q4 plan'])

  // Esc again puts the filter's text back.
  await page.keyboard.press('Escape')
  await expect(field(page)).toHaveValue('#q4')
  await expect(error(page)).toHaveCount(0)
  await expect.poll(() => listTitles(page)).toEqual(['Priya q4 plan'])
})

test('a text chips can say becomes chips: the Filter menu’s pickers show them checked', async ({ page }) => {
  await seedWorkspace(page, SEED)
  await expect.poll(() => listTitles(page)).toEqual(ALL)

  await field(page).click()
  await page.keyboard.type('@Priya @Sam #vendor', { delay: 10 })
  // ⏎ takes the popup's row for #vendor, then settles the text.
  await page.keyboard.press('Enter')
  await page.keyboard.press('Enter')
  // Side-by-side names of one kind or, as the box always made them.
  await expect(field(page)).toHaveValue('(@"Priya Nair" or @"Sam Ortiz") and #vendor')
  await expect.poll(() => listTitles(page)).toEqual(['Priya vendor call', 'Sam vendor contract', 'Sam waiting on legal'])
  expect(await screenFilter(page)).toEqual({ people: 2, tags: 1, expression: false })

  await field(page).blur()
  await openFilterMenu(page)
  await expect(filterMenuRow(page, 'People')).toHaveAccessibleName('People filter: Priya Nair or Sam Ortiz')
  await filterMenuRow(page, 'People').click()
  await expect(page.getByRole('option', { name: 'Priya Nair' })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByRole('option', { name: 'Sam Ortiz' })).toHaveAttribute('aria-selected', 'true')
})

test('the palette’s Pause / Resume Filter pauses and resumes it; with no filter the snackbar says so', async ({ page }) => {
  await seedWorkspace(page, SEED)
  await expect.poll(() => listTitles(page)).toEqual(ALL)
  const runPause = async () => {
    await page.keyboard.press('ControlOrMeta+k')
    await page.getByRole('combobox').fill('pause')
    await page.getByRole('option', { name: /Pause \/ Resume Filter/ }).click()
  }
  await runPause()
  await expect(page.getByText('No filter to pause.')).toBeVisible()

  await field(page).click()
  await page.keyboard.type('#q4', { delay: 10 })
  await page.keyboard.press('Enter')
  await field(page).blur()
  await expect.poll(() => listTitles(page)).toEqual(['Priya q4 plan'])
  await runPause()
  await expect(funnel(page)).toHaveAttribute('aria-pressed', 'true')
  await expect.poll(() => listTitles(page)).toEqual(ALL)
  await runPause()
  await expect(funnel(page)).toHaveAttribute('aria-pressed', 'false')
  await expect.poll(() => listTitles(page)).toEqual(['Priya q4 plan'])
})

/** Calls a filter-store action in the page. */
async function filterAction(page: Page, action: 'search' | 'pause', arg: string | boolean) {
  await page.evaluate(async ([action, arg]) => {
    const mod = (await import(/* @vite-ignore */ '/src/stores/filter-store.ts' as string)) as {
      useFilterStore: { getState: () => { setSearchText: (t: string) => void; setPaused: (p: boolean) => void } }
    }
    const store = mod.useFilterStore.getState()
    if (action === 'search') store.setSearchText(String(arg))
    else store.setPaused(arg === true)
  }, [action, arg] as const)
}

test.describe('phone', () => {
  test.use({ viewport: { width: 390, height: 800 }, hasTouch: true, isMobile: true })

  test('a paused filter says so on the top bar’s pill, and a tap resumes it', async ({ page }) => {
    await seedWorkspace(page, SEED)
    const pill = page.getByTestId('shown-of-total')
    await filterAction(page, 'search', 'vendor')
    await expect(pill).toHaveText(/^4 of 5/)
    await filterAction(page, 'pause', true)
    await expect(pill).toHaveText('5 open · paused · Resume')
    await expect(pill).toHaveAccessibleName('Filter paused: 5 open tasks shown. Resume the filter')
    await pill.tap()
    await expect(pill).toHaveText(/^4 of 5/)
  })
})
