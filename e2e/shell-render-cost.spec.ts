import { expect, test } from '@playwright/test'
import { expectCounterLive, installRenderCounter, readRenderCounts, resetRenderCounts } from './fixtures/render-count'
import { seedWorkspace, wsListWidget, wsRow, wsTab, type WorkspaceSeed } from './fixtures/workspace'

/**
 * What the shell and the workspace page render when nothing a row shows
 * changed (cr34 M16 / P8), held without timing (render counts from a
 * stand-in React DevTools hook, `fixtures/render-count`):
 *
 * - a layout change elsewhere (a tab switched in another cell) renders the
 *   workspace page, but no task row's draggable: `DndContext`'s props stay
 *   the same objects (its sensors' options, `onDragEnd`), so dnd-kit's
 *   context doesn't change and its 100+ `useDraggable` consumers don't render;
 * - opening and closing the command palette, the shortcuts list and
 *   Settings renders neither the shell (`AppShell`) nor the workspace page:
 *   their open flags are read by small hosts (`App.tsx`).
 */

const ROWS = 24

const SEED: WorkspaceSeed = {
  tasks: Array.from({ length: ROWS }, (_, i) => ({ title: `Task ${i + 1}` })),
  listDefinitions: [{ name: 'Everything' }],
  layouts: [{
    name: 'Main',
    columns: [
      { id: 'a', rows: [wsRow({ id: 'ca', tabs: [{ id: 'plain', kind: 'lens', listDefIdx: 0 }] })] },
      { id: 'b', rows: [wsRow({ id: 'cb', tabs: [{ id: 'n1', kind: 'notes' }, { id: 'n2', kind: 'notes' }] })] },
    ],
  }],
}

const WATCHED = ['AppShell', 'WorkspacePage', 'WorkspaceView', 'TaskDraggable', 'TaskRow', 'TopBar']

test('a tab switched in another cell renders the page, but no row’s draggable', async ({ page }) => {
  await installRenderCounter(page, WATCHED)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await seedWorkspace(page, SEED)
  await expect(wsListWidget(page, 'plain').locator('[data-todo-id]')).toHaveCount(ROWS)
  await expectCounterLive(page, 'TaskDraggable')

  await resetRenderCounts(page)
  await wsTab(page, 'n2').click()
  await expect(wsTab(page, 'n2')).toHaveAttribute('aria-selected', 'true')
  const counts = await readRenderCounts(page)
  // The page did render (the layout changed): the check below means something.
  expect(counts.WorkspacePage).toBeGreaterThan(0)
  expect(counts.TaskDraggable).toBe(0)
  expect(counts.TaskRow).toBe(0)
})

test('the palette, the shortcuts list and Settings render neither the shell nor the workspace page', async ({ page }) => {
  await installRenderCounter(page, WATCHED)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await seedWorkspace(page, SEED)
  await expect(wsListWidget(page, 'plain').locator('[data-todo-id]')).toHaveCount(ROWS)
  await expectCounterLive(page, 'AppShell')
  await expectCounterLive(page, 'WorkspacePage')
  const palette = page.getByLabel('Command palette', { exact: true })
  const shortcuts = page.getByRole('dialog', { name: 'Keyboard Shortcuts' })
  const settings = page.getByRole('dialog', { name: 'Settings', exact: true })

  await resetRenderCounts(page)
  await page.keyboard.press('Control+k')
  await expect(palette).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(palette).toBeHidden()

  await page.keyboard.press('?')
  await expect(shortcuts).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(shortcuts).toBeHidden()

  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await expect(settings).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(settings).toBeHidden()

  const counts = await readRenderCounts(page)
  expect(counts.AppShell).toBe(0)
  expect(counts.WorkspacePage).toBe(0)
  expect(counts.TaskRow).toBe(0)
})
