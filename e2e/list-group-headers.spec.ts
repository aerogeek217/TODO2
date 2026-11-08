import { expect, test, type Locator, type Page } from '@playwright/test'
import { seedTaskList, seedWorkspace, type WorkspaceSeed, wsRow } from './fixtures/workspace'

/**
 * D25 A1 · breathing group headers, read from the rendered page: open space
 * above every group header but the first, the name 13px bold in the primary
 * text, an 8px swatch, the count in tabular figures, a 1px rule filling the
 * rest of the header line, and no hairline under the rows of a grouped list
 * (a flat list keeps its hairline). The list's header still sticks over its
 * scrolling group, at the height the top scroll-edge fade starts under.
 * The task dialog's groups follow it.
 */

test.use({ viewport: { width: 1100, height: 520 } })

/** Three people with six tasks each: enough rows for the list to scroll. */
const PEOPLE = ['Ann', 'Bob', 'Cy']
const TASKS = PEOPLE.flatMap((p) => Array.from({ length: 6 }, (_, i) => ({ title: `${p} task ${i + 1}`, people: [p] })))

const groups = (widget: Locator) => widget.locator('[data-list-group]')
const headerRow = (group: Locator) => group.locator(':scope > div').first()
const scroller = (widget: Locator) => widget.locator('[data-task-row-grid]').locator('..')

/** The computed `content` of every task row's `::after` under `root`. */
const rowAfterContents = (root: Locator) => root.locator('[data-todo-id]').evaluateAll((rows) =>
  rows.map((r) => getComputedStyle(r, '::after').content))

/** A custom property's value on the root, as the browser resolves it on a probe's background. */
async function tokenColor(page: Page, token: string): Promise<string> {
  return page.evaluate((t) => {
    const probe = document.createElement('div')
    probe.style.background = `var(${t})`
    document.body.append(probe)
    const color = getComputedStyle(probe).backgroundColor
    probe.remove()
    return color
  }, token)
}

/** The header's name / swatch / count / rule styles and its geometry. */
function headerLook(header: Locator) {
  return header.evaluate((el) => {
    const button = el.querySelector('button[aria-expanded]')
    const name = el.querySelector('[data-testid="list-group-name"]')
    if (!button || !name) throw new Error('no group header')
    const parts = Array.from(button.children)
    const swatch = parts[1]
    const count = name.nextElementSibling
    const rule = count?.nextElementSibling
    if (!swatch || !count || !rule) throw new Error('header parts missing')
    const b = button.getBoundingClientRect()
    const r = rule.getBoundingClientRect()
    const n = getComputedStyle(name)
    const c = getComputedStyle(count)
    return {
      nameSize: n.fontSize,
      nameWeight: n.fontWeight,
      nameColor: n.color,
      swatch: [swatch.getBoundingClientRect().width, swatch.getBoundingClientRect().height],
      countNumeric: c.fontVariantNumeric,
      countWeight: c.fontWeight,
      ruleHeight: r.height,
      ruleColor: getComputedStyle(rule).backgroundColor,
      ruleRightGap: b.right - r.right,
      ruleWidth: r.width,
      paddingRight: parseFloat(getComputedStyle(button).paddingRight),
    }
  })
}

test('a grouped list: 18px above every header but the first, A1 header type and rule, no row hairlines', async ({ page }) => {
  const widget = await seedTaskList(page, { people: PEOPLE, tasks: TASKS, list: { grouping: 'people', sort: 'title' } })
  const all = groups(widget)
  await expect(all).toHaveCount(3)

  // The space above a header: from the previous group's last row to the header's top.
  const gaps = await widget.evaluate((w) => {
    const gs = Array.from(w.querySelectorAll('[data-list-group]'))
    return gs.map((g, i) => {
      const header = g.firstElementChild
      if (!header) throw new Error('no header')
      const top = header.getBoundingClientRect().top
      if (i === 0) return top - (g.parentElement?.getBoundingClientRect().top ?? 0)
      const rows = gs[i - 1]?.querySelectorAll('[data-todo-id]')
      const last = rows?.[rows.length - 1]
      return top - (last?.getBoundingClientRect().bottom ?? 0)
    })
  })
  // The first sits under the body's 2px padding and the group's 4px; the rest 18px below the rows above.
  expect(gaps[0]).toBeCloseTo(6, 0)
  for (const gap of gaps.slice(1)) expect(gap).toBeCloseTo(18, 0)

  const look = await headerLook(headerRow(all.nth(1)))
  expect(look.nameSize).toBe('13px')
  expect(look.nameWeight).toBe('700')
  expect(look.nameColor).toBe(await tokenColor(page, '--color-text-primary'))
  expect(look.swatch).toEqual([8, 8])
  expect(look.countNumeric).toBe('tabular-nums')
  expect(look.countWeight).toBe('400')
  expect(look.ruleHeight).toBe(1)
  expect(look.ruleColor).toBe(await tokenColor(page, '--color-border'))
  // The rule runs to the header's end, short of the envelope's room in a People group.
  expect(look.ruleWidth).toBeGreaterThan(100)
  expect(look.ruleRightGap).toBeCloseTo(look.paddingRight, 0)
  expect(look.paddingRight).toBe(32)

  // No row draws its hairline.
  const contents = await rowAfterContents(widget)
  expect(contents.length).toBeGreaterThan(0)
  expect(new Set(contents)).toEqual(new Set(['none']))
})

test('a flat list keeps its row hairlines', async ({ page }) => {
  const widget = await seedTaskList(page, { people: PEOPLE, tasks: TASKS.slice(0, 4), list: { grouping: 'none', sort: 'title' } })
  await expect(widget.locator('[data-todo-id]')).toHaveCount(4)
  await expect(groups(widget)).toHaveCount(0)
  expect(new Set(await rowAfterContents(widget))).toEqual(new Set(['""']))
})

/** Each group header's hairline (its `::after`): opacity, colour, and its top against the header's bottom. */
const hairlines = (widget: Locator) => widget.locator('[data-list-group] > div:first-child').evaluateAll((headers) => headers.map((h) => {
  const cs = getComputedStyle(h, '::after')
  return { opacity: cs.opacity, color: cs.backgroundColor, height: cs.height, bottom: cs.bottom }
}))

test('the header still sticks over its scrolling group, as tall as the scroll fade’s inset; its hairline shows only while stuck', async ({ page }) => {
  const widget = await seedTaskList(page, { people: PEOPLE, tasks: TASKS, list: { grouping: 'people', sort: 'title' } })
  const scroll = scroller(widget)
  const second = headerRow(groups(widget).nth(1))
  await expect(second).toBeVisible()

  // At rest no header is stuck: the rule is the only line, no hairline under any header.
  await expect.poll(async () => (await hairlines(widget)).map((h) => h.opacity)).toEqual(['0', '0', '0'])

  // Scroll a few rows into the second group: its header stays at the top.
  const into = await scroll.evaluate((s) => {
    const header = s.querySelectorAll('[data-list-group]')[1]?.firstElementChild
    if (!header) throw new Error('no second header')
    return header.getBoundingClientRect().top - s.getBoundingClientRect().top + 60
  })
  await scroll.evaluate((s, by) => { s.scrollTop = by }, into)
  await expect.poll(() => scroll.evaluate((s) => s.scrollTop)).toBeGreaterThan(0)

  const stuck = await page.evaluate(() => {
    const s = document.querySelector('[data-list-widget] [data-task-row-grid]')?.parentElement
    const header = s?.querySelectorAll('[data-list-group]')[1]?.firstElementChild
    if (!s || !header) throw new Error('no scroller')
    const cs = getComputedStyle(header)
    return {
      offset: header.getBoundingClientRect().top - s.getBoundingClientRect().top,
      height: header.getBoundingClientRect().height,
      position: cs.position,
      background: cs.backgroundColor,
      shadow: cs.boxShadow,
      inset: getComputedStyle(s).getPropertyValue('--scroll-fade-inset').trim(),
      token: getComputedStyle(document.documentElement).getPropertyValue('--list-group-header-height').trim(),
    }
  })
  expect(stuck.position).toBe('sticky')
  expect(stuck.offset).toBeCloseTo(0, 0)
  expect(stuck.background).toBe(await tokenColor(page, '--color-surface'))
  expect(stuck.shadow).toBe('none')
  // Stuck, the second header draws its hairline (1px of the muted border, just under it); the third, at
  // rest below, doesn't. (The first, pushed out above with its group, still counts as stuck: off screen.)
  await expect.poll(async () => (await hairlines(widget)).slice(1).map((h) => h.opacity)).toEqual(['1', '0'])
  const line = (await hairlines(widget))[1]
  expect([line?.height, line?.bottom, line?.color]).toEqual(['1px', '-1px', await tokenColor(page, '--color-border-muted')])
  // The fade starts under the header: its inset is the header's height.
  expect(stuck.token).toBe('28px')
  expect(stuck.inset).toBe(stuck.token)
  expect(stuck.height).toBe(28)
  // A row scrolled under it is hidden behind it, not drawn over it.
  const covered = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('[data-list-group] > div')?.querySelector('[data-testid="list-group-name"]')?.textContent ?? null,
    await second.evaluate((h) => { const r = h.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } }))
  expect(covered).toBe('Bob')
})

const DASH: WorkspaceSeed = {
  tags: ['q4', 'home', 'ops'],
  tasks: [
    { title: 'Q4 one', tags: ['q4'] },
    { title: 'Q4 two', tags: ['q4'] },
    { title: 'Home one', tags: ['home'] },
    { title: 'Ops one', tags: ['ops'] },
  ],
  layouts: [{
    name: 'Dash',
    columns: [{ id: 'c1', rows: [wsRow({ id: 'k1', tabs: [{ id: 'dash', kind: 'tags' }] })] }],
  }],
}

/** For each group under `root`: the space above its header, its name's type and whether a rule follows the count. */
function groupLooks(root: Locator, groupSelector: string) {
  return root.evaluate((el, sel) => Array.from(el.querySelectorAll(sel)).map((g) => {
    const header = g.firstElementChild
    const name = header?.children[1]
    const count = header?.children[2]
    const rule = header?.children[3]
    if (!header || !name || !count || !rule) throw new Error('header parts missing')
    return {
      margin: getComputedStyle(g).marginTop,
      name: name.textContent,
      nameSize: getComputedStyle(name).fontSize,
      nameWeight: getComputedStyle(name).fontWeight,
      count: count.textContent,
      ruleHeight: rule.getBoundingClientRect().height,
      ruleGrows: rule.getBoundingClientRect().width > 40,
    }
  }), groupSelector)
}

test('the task dialog’s groups (a Tags count’s) take the same headers, rows without hairlines', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await seedWorkspace(page, DASH)
  const section = page.locator('[data-glance-section="tags"]')
  // The tag assignments load after the tasks.
  await expect(section.locator('[data-tag-row]').first()).toContainText('#q4')

  await section.getByTestId('glance-section-count').click()
  const dialog = page.locator('[data-task-dialog]')
  await expect(dialog.locator('[data-todo-id]')).toHaveCount(4)
  const dialogGroups = await groupLooks(dialog, '[data-task-dialog-group]')
  expect(dialogGroups.map((g) => [g.name, g.count, g.margin])).toEqual([['#q4', '2', '0px'], ['#home', '1', '18px'], ['#ops', '1', '18px']])
  for (const g of dialogGroups) {
    expect([g.nameSize, g.nameWeight, g.ruleHeight, g.ruleGrows]).toEqual(['13px', '700', 1, true])
  }
  expect(new Set(await rowAfterContents(dialog))).toEqual(new Set(['none']))
})

test('a phone keeps its 36px headers and drops the row hairlines too', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 })
  const widget = await seedTaskList(page, { people: PEOPLE, tasks: TASKS.slice(0, 8), list: { grouping: 'people', sort: 'title' } })
  await expect(groups(widget).first()).toBeVisible()
  const height = await groups(widget).first().locator(':scope > button[aria-expanded]').evaluate((b) => b.getBoundingClientRect().height)
  expect(height).toBe(36)
  expect(new Set(await rowAfterContents(widget))).toEqual(new Set(['none']))
})
