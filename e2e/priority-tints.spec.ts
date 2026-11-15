import { expect, test, type Locator, type Page } from '@playwright/test'
import { readStore } from './fixtures/db'
import { expectPeopleLoaded, filterField } from './fixtures/filters'
import { openListFilterEditor, openSettings, reviewField, seedWorkspace, wsListWidget, wsRow, type WorkspaceSeed } from './fixtures/workspace'

/**
 * A priority typed as a token is drawn in the priority's own color (cr34
 * T9): `/urgent`, `/important` and `/focus` in Quick Add (the field and its
 * chips), the notes editor, the top bar's filter field, a filter expression
 * field and the Review field's pills — each its own tint, drawn in the
 * `--color-marker-*` tokens; and a color set in Settings › Theme colors
 * reaches a typed token. The colors are computed styles through three
 * stylesheets and an inline override on `<html>`: a real browser's to say.
 */

const SEED: WorkspaceSeed = {
  people: [{ name: 'Anna', initials: 'AN' }],
  tasks: [{ title: 'Call the bank', urgent: true }, { title: 'Plan the offsite', important: true }, { title: 'Write it up', focus: true }],
  listDefinitions: [{ name: 'Everything' }],
  layouts: [{
    name: 'Main',
    columns: [
      { id: 'c1', rows: [wsRow({ id: 'k1', tabs: [{ id: 'list', kind: 'lens', listDefIdx: 0 }] })] },
      { id: 'c2', rows: [wsRow({ id: 'k2', tabs: [{ id: 'notes', kind: 'notes' }] }), wsRow({ id: 'k3', tabs: [{ id: 'rv', kind: 'review' }] })] },
    ],
  }],
}

/** Each priority's token, its tint, and the tokens that color its text and its fill. */
const PRIORITIES = [
  { token: '/urgent', tint: 'urgent', text: '--color-marker-urgent', fill: '--color-marker-urgent-bg' },
  { token: '/important', tint: 'important', text: '--color-marker-important', fill: '--color-marker-important-bg' },
  { token: '/focus', tint: 'focus', text: '--color-marker-focus-text', fill: '--color-marker-focus-bg' },
] as const

/** What `color: var(<token>)` computes to on the page. */
async function tokenColor(page: Page, token: string): Promise<string> {
  return page.evaluate((name) => {
    const probe = document.createElement('span')
    probe.style.color = `var(${name})`
    document.body.appendChild(probe)
    const color = getComputedStyle(probe).color
    probe.remove()
    return color
  }, token)
}

const computed = (el: Locator, prop: 'color' | 'backgroundColor') => el.evaluate((node, p) => getComputedStyle(node)[p], prop)

/** A color as sRGB bytes, whatever form the computed style gives it in. */
async function bytes(page: Page, color: string): Promise<number[]> {
  return page.evaluate((c) => {
    const ctx = document.createElement('canvas').getContext('2d')
    if (!ctx) throw new Error('no canvas')
    ctx.fillStyle = c
    ctx.fillRect(0, 0, 1, 1)
    return Array.from(ctx.getImageData(0, 0, 1, 1).data.slice(0, 3))
  }, color)
}

/**
 * In `scope`, each priority's token is one tinted span (`data-tint`), drawn
 * in the priority's text color over its fill — three different colors, none
 * of them the field's plain text color.
 */
async function expectPriorityTints(page: Page, scope: Locator, plain: Locator): Promise<void> {
  const colors: string[] = []
  for (const p of PRIORITIES) {
    const span = scope.locator(`[data-tint="${p.tint}"]`)
    await expect(span, `${p.token} is tinted ${p.tint}`).toHaveCount(1)
    await expect(span).toContainText(p.token.slice(1), { ignoreCase: true })
    const color = await computed(span, 'color')
    expect(color, `${p.token} text`).toBe(await tokenColor(page, p.text))
    expect(await computed(span, 'backgroundColor'), `${p.token} fill`).toBe(await tokenColor(page, p.fill))
    colors.push(color)
  }
  expect(new Set(colors).size, `three colors: ${colors.join(' · ')}`).toBe(3)
  expect(colors).not.toContain(await computed(plain, 'color'))
}

const quickAdd = (page: Page) => page.getByRole('dialog', { name: 'Quick add task' })

async function openQuickAdd(page: Page): Promise<Locator> {
  await expectPeopleLoaded(page)
  await page.keyboard.press('Control+Space')
  const input = quickAdd(page).getByPlaceholder('New task…')
  await expect(input).toBeFocused()
  return input
}

test('Quick Add: the typed tokens and the chips they make', async ({ page }) => {
  await seedWorkspace(page, SEED)
  const input = await openQuickAdd(page)
  await input.pressSequentially('Call /urgent /important /focus ')
  const mirror = quickAdd(page).getByTestId('quickadd-mirror')
  await expect(mirror.locator('[data-tint]')).toHaveText(['/urgent', '/important', '/focus'])
  await expectPriorityTints(page, mirror, mirror)
  // The chips row: a chip per priority, in the same colors.
  await expectPriorityTints(page, quickAdd(page).getByRole('group', { name: 'What the task gets' }), mirror)
})

test('the notes editor', async ({ page }) => {
  await seedWorkspace(page, SEED)
  const editor = page.getByRole('region', { name: 'Notes cell' }).locator('.cm-content')
  await editor.click()
  await page.keyboard.type('- Call /urgent /important /focus ')
  await expect(editor.locator('.cm-nlp-tint')).toHaveText(['/urgent', '/important', '/focus'])
  await expectPriorityTints(page, editor, editor.locator('.cm-line').first())
})

test('the top bar’s filter field: a token is in its priority’s color until a space makes it a chip', async ({ page }) => {
  await seedWorkspace(page, SEED)
  const field = filterField(page)
  const mirror = page.getByTestId('search-mirror')
  const colors: string[] = []
  for (const p of PRIORITIES) {
    await field.click()
    await field.pressSequentially(p.token)
    // The commands popup is open on the token (tinted as one being typed); closed, the token reads as what it sets.
    await field.press('Escape')
    const span = mirror.locator('[data-tint]')
    await expect(span).toHaveText([p.token])
    await expect(span).toHaveAttribute('data-tint', p.tint)
    const color = await computed(span, 'color')
    expect(color, `${p.token} text`).toBe(await tokenColor(page, p.text))
    expect(await computed(span, 'backgroundColor'), `${p.token} fill`).toBe(await tokenColor(page, p.fill))
    colors.push(color)
    await field.fill('')
  }
  expect(new Set(colors).size, `three colors: ${colors.join(' · ')}`).toBe(3)
})

test('a filter expression field (Edit list)', async ({ page }) => {
  await seedWorkspace(page, SEED)
  const editor = await openListFilterEditor(page, wsListWidget(page, 'list'))
  await editor.getByRole('radiogroup', { name: 'Filter mode' }).getByRole('radio', { name: 'Expression' }).click()
  const field = editor.getByRole('textbox', { name: 'Filter expression' })
  // A space after the last token: it is no longer the one being typed (tinted as such while its popup is open).
  await field.fill('/urgent or /important or /focus ')
  const mirror = editor.getByTestId('expression-field')
  await expect(mirror.locator('[data-tint]')).toHaveText(['/urgent', 'or', '/important', 'or', '/focus'])
  await expectPriorityTints(page, mirror, mirror.locator('[data-tint="operator"]').first())
})

test('the Review field: typed, then as pills at rest', async ({ page }) => {
  await seedWorkspace(page, SEED)
  const widget = page.locator('[data-review-widget="rv"]')
  const field = reviewField(page, 'rv')
  await field.click()
  await field.fill('/urgent or /important or /focus ')
  // Typed (a space after the last token, so none is the one being typed): the expression field's tints.
  await expect(widget.locator('[data-tint]:not([data-review-pill])')).toHaveText(['/urgent', 'or', '/important', 'or', '/focus'])
  await expectPriorityTints(page, widget, widget.locator('[data-tint="operator"]').first())
  // At rest (the field left: its text is written): a pill per term, each in its priority's color.
  await field.blur()
  const pills = widget.getByTestId('review-field-pills')
  await expect(pills.locator('[data-review-pill]')).toHaveCount(3)
  expect(await pills.locator('[data-review-pill]').evaluateAll((els) => els.map((el) => `${el.getAttribute('data-review-pill')}:${el.getAttribute('data-tint')}`)))
    .toEqual(['/urgent:urgent', '/important:important', '/focus:focus'])
  await expectPriorityTints(page, pills, pills.locator('[data-tint="operator"]').first())
})

test('a priority color set in Settings › Theme colors reaches a typed token, and stays after a reload', async ({ page }) => {
  await seedWorkspace(page, SEED)
  const before = await bytes(page, await tokenColor(page, '--color-marker-urgent'))
  const fillBefore = await tokenColor(page, '--color-marker-urgent-bg')
  const importantBefore = await tokenColor(page, '--color-marker-important')

  // Settings › Appearance › Theme colors: Urgent priority, for the theme on screen.
  const settings = await openSettings(page, 'Appearance')
  await settings.getByRole('button', { name: 'Customize colors…' }).click()
  const colors = page.getByRole('dialog', { name: /^Theme Colors/ })
  await colors.getByLabel('Urgent priority').fill('#0a84c8')
  await expect.poll(async () => bytes(page, await tokenColor(page, '--color-marker-urgent'))).toEqual([10, 132, 200])
  expect(before).not.toEqual([10, 132, 200])
  await page.keyboard.press('Escape')
  await expect(colors).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expect(settings).toHaveCount(0)

  const check = async () => {
    const input = await openQuickAdd(page)
    await input.pressSequentially('Call /urgent /important ')
    const mirror = quickAdd(page).getByTestId('quickadd-mirror')
    const urgent = mirror.locator('[data-tint="urgent"]')
    await expect(urgent).toHaveText('/urgent')
    // The token's text is the picked color; its fill follows it; Important keeps its own.
    expect(await bytes(page, await computed(urgent, 'color'))).toEqual([10, 132, 200])
    const fill = await computed(urgent, 'backgroundColor')
    expect(fill).toBe(await tokenColor(page, '--color-marker-urgent-bg'))
    expect(fill).not.toBe(fillBefore)
    expect(await computed(mirror.locator('[data-tint="important"]'), 'color')).toBe(importantBefore)
    // The chip too.
    const chip = quickAdd(page).getByRole('group', { name: 'What the task gets' }).locator('[data-tint="urgent"]')
    expect(await bytes(page, await computed(chip, 'color'))).toEqual([10, 132, 200])
    await input.fill('')
    await page.keyboard.press('Escape')
    await expect(quickAdd(page)).toHaveCount(0)
  }
  await check()

  // A task's ring is the same color: the token and the priority it sets agree.
  expect(await bytes(page, await tokenColor(page, '--color-marker-urgent'))).toEqual([10, 132, 200])

  // The top bar's filter field too.
  const field = filterField(page)
  await field.click()
  await field.pressSequentially('/urgent')
  await field.press('Escape')
  const token = page.getByTestId('search-mirror').locator('[data-tint="urgent"]')
  expect(await bytes(page, await computed(token, 'color'))).toEqual([10, 132, 200])
  await field.fill('')

  // Stored: a reload draws it again.
  await expect.poll(async () => (await readStore<{ key: string }>(page, 'settings')).some((r) => /^color\.(dark|light)\.urgent$/.test(r.key))).toBe(true)
  await page.reload()
  await page.locator('[data-ws-area]').waitFor({ state: 'visible' })
  await check()
})
