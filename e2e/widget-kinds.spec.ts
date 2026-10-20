import { expect, test, type Locator, type Page } from '@playwright/test'
import { WIDGET_KINDS, widgetKindLabel, type WidgetKind } from '../src/models/workspace-layout'
import { seedWorkspace, wsCell, type WsLayoutSeed } from './fixtures/workspace'

/**
 * Every widget kind (from the one kind table) can be added, switched to and
 * closed on the desktop, and shows in the phone's column view. A list tab
 * whose list was deleted reads "(Deleted list)" in the tab strip's overflow
 * menu too.
 */

/** The list the list tabs show: the name Create new list… gives a layout's first list. */
const LIST = 'New list'

/** What a kind's body shows, to know it rendered. */
function body(cell: Locator, kind: WidgetKind): Locator {
  switch (kind) {
    case 'lens': return cell.locator('[data-list-widget]')
    case 'calendar': return cell.locator('[data-calendar-widget]')
    case 'notes': return cell.locator('.cm-content')
    case 'eisenhower': return cell.locator('[data-eisenhower]')
    case 'dashboard': return cell.locator('[data-dashboard]')
  }
}

/** A kind's tab title: a list tab shows its list. */
const title = (kind: WidgetKind) => (kind === 'lens' ? LIST : widgetKindLabel(kind))
/** The list picker's row for the list (`Team Add` / `Team Show`). */
const listOption = (page: Page) => page.getByRole('button', { name: new RegExp(`^${LIST} `) })
const tab = (page: Page, kind: WidgetKind) => page.getByRole('tab', { name: new RegExp(`^${title(kind)}`) })

test.describe('desktop', () => {
  test.use({ viewport: { width: 1440, height: 900 } })

  test('every kind can be added as a tab, switched to and closed', async ({ page }) => {
    // (A layout's lists are the ones it shows: the list tab makes its own.)
    await seedWorkspace(page, {
      tasks: [{ title: 'A task' }],
      layouts: [{ name: 'Blank', columns: [] }],
    })
    // The empty layout offers every kind, in the table's order.
    await expect(page.getByText('This layout is empty')).toBeVisible()
    for (const kind of WIDGET_KINDS) await expect(page.getByRole('button', { name: widgetKindLabel(kind), exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Notes', exact: true }).click()
    const cell = page.locator('[data-ws-cell]').first()
    await expect(body(cell, 'notes')).toBeVisible()

    // Add: every kind but Notes, from the add-tab menu (a list picks its list first: a new one here).
    for (const kind of WIDGET_KINDS.filter((k) => k !== 'notes')) {
      await page.getByRole('button', { name: 'Add widget as tab' }).click()
      const menu = page.getByRole('menu', { name: 'Add widget' })
      await expect(menu.getByRole('menuitem')).toHaveText(WIDGET_KINDS.map(widgetKindLabel))
      await menu.getByRole('menuitem', { name: widgetKindLabel(kind) }).click()
      if (kind === 'lens') await page.getByRole('button', { name: '+ Create new list…' }).click()
      await expect(tab(page, kind)).toHaveAttribute('aria-selected', 'true')
      await expect(body(cell, kind)).toBeVisible()
    }

    // Switch: the first tab (Notes) through every other kind and back, from its menu.
    let current: WidgetKind = 'notes'
    for (const kind of [...WIDGET_KINDS.filter((k) => k !== 'notes'), 'notes' as const]) {
      await tab(page, current).first().click()
      await tab(page, current).first().click({ button: 'right' })
      const menu = page.getByRole('menu', { name: 'Change widget' })
      await expect(menu.getByRole('menuitemradio', { name: widgetKindLabel(current) })).toHaveAttribute('aria-checked', 'true')
      await menu.getByRole('menuitemradio', { name: widgetKindLabel(kind) }).click()
      if (kind === 'lens') await listOption(page).click()
      current = kind
      await expect(body(cell, kind)).toBeVisible()
    }

    // Close: every tab, last one closes the cell.
    for (const kind of WIDGET_KINDS) {
      const t = tab(page, kind).first()
      await t.click()
      await t.getByRole('button', { name: `Close ${title(kind)}` }).click()
    }
    await expect(page.getByText('This layout is empty')).toBeVisible()
  })

  test('a list tab whose list was deleted reads “(Deleted list)” in the overflow menu', async ({ page }) => {
    const tabs = [{ id: 'gone', kind: 'lens' as const, listDefIdx: 1 }, ...WIDGET_KINDS.map((kind, i) => ({ id: `t${i}`, kind, ...(kind === 'lens' ? { listDefIdx: 0 } : {}) }))]
    await seedWorkspace(page, {
      listDefinitions: [{ name: LIST }, { name: 'Old list' }],
      layouts: [{
        name: 'Main',
        columns: [
          { id: 'c1', weight: 1, cells: [{ id: 'k1', tabs, activeTabId: 't4' }] },
          { id: 'c2', weight: 4, cells: [{ id: 'k2', tabs: [{ id: 'n', kind: 'notes' }] }] },
        ],
      }],
    })
    // The list goes (as with its layout's Save elsewhere): from the database and the store.
    await page.evaluate(async () => {
      const mod = (await import(/* @vite-ignore */ '/src/stores/list-definition-store.ts' as string)) as {
        useListDefinitionStore: { getState: () => { listDefinitions: Array<{ id: number; name: string }>; forgetLists: (ids: number[]) => void } }
      }
      const data = (await import(/* @vite-ignore */ '/src/data/database.ts' as string)) as { db: { listDefinitions: { delete: (id: number) => Promise<void> } } }
      const s = mod.useListDefinitionStore.getState()
      const old = s.listDefinitions.find((d) => d.name === 'Old list')
      if (old) {
        await data.db.listDefinitions.delete(old.id)
        s.forgetLists([old.id])
      }
    })
    const more = wsCell(page, 'k1').getByRole('button', { name: /more tabs$/ })
    await more.click()
    const menu = page.getByRole('menu', { name: 'More tabs' })
    await expect(menu.getByRole('menuitem', { name: '(Deleted list)' })).toBeVisible()
    await expect(menu.getByRole('menuitem', { name: 'List', exact: true })).toHaveCount(0)
  })

  test('the overflow menu names a list as its tab does: the unsaved name while it is being edited', async ({ page }) => {
    const tabs = [{ id: 'renamed', kind: 'lens' as const, listDefIdx: 1 }, ...WIDGET_KINDS.map((kind, i) => ({ id: `t${i}`, kind, ...(kind === 'lens' ? { listDefIdx: 0 } : {}) }))]
    await seedWorkspace(page, {
      listDefinitions: [{ name: LIST }, { name: 'Old name' }],
      layouts: [{
        name: 'Main',
        columns: [
          { id: 'c1', weight: 1, cells: [{ id: 'k1', tabs, activeTabId: 't4' }] },
          { id: 'c2', weight: 4, cells: [{ id: 'k2', tabs: [{ id: 'n', kind: 'notes' }] }] },
        ],
      }],
    })
    // An unsaved rename (what Edit list's name field writes).
    await page.evaluate(async () => {
      const defs = (await import(/* @vite-ignore */ '/src/stores/list-definition-store.ts' as string)) as {
        useListDefinitionStore: { getState: () => { listDefinitions: Array<{ id: number; name: string }> } }
      }
      const drafts = (await import(/* @vite-ignore */ '/src/stores/list-draft-store.ts' as string)) as {
        useListDraftStore: { getState: () => { edit: (id: number, fn: (d: { name: string }) => { name: string }) => void } }
      }
      const old = defs.useListDefinitionStore.getState().listDefinitions.find((d) => d.name === 'Old name')
      if (old) drafts.useListDraftStore.getState().edit(old.id, (d) => ({ ...d, name: 'New name' }))
    })
    await wsCell(page, 'k1').getByRole('button', { name: /more tabs$/ }).click()
    const menu = page.getByRole('menu', { name: 'More tabs' })
    await expect(menu.getByRole('menuitem', { name: 'New name' })).toBeVisible()
    await expect(menu.getByRole('menuitem', { name: 'Old name' })).toHaveCount(0)
  })
})

test.describe('phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })

  test('the column view shows every kind', async ({ page }) => {
    const layout: WsLayoutSeed = {
      name: 'Kinds',
      columns: WIDGET_KINDS.map((kind, i) => ({ id: `col${i}`, cells: [{ id: `cell${i}`, tabs: [{ id: `tab${i}`, kind, ...(kind === 'lens' ? { listDefIdx: 0 } : {}) }] }] })),
    }
    await seedWorkspace(page, { listDefinitions: [{ name: LIST }], tasks: [{ title: 'A task' }], layouts: [layout] })
    const strip = page.getByRole('tablist', { name: 'Columns' })
    for (const [i, kind] of WIDGET_KINDS.entries()) {
      await strip.getByRole('tab', { name: title(kind) }).tap()
      await expect(strip.getByRole('tab', { name: title(kind) })).toHaveAttribute('aria-selected', 'true')
      await expect(body(wsCell(page, `cell${i}`), kind)).toBeInViewport()
    }
  })
})
