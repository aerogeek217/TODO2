import { expect, test, type Page } from '@playwright/test'
import { openSettings, seedWorkspace, type WorkspaceSeed } from './fixtures/workspace'
import { assignedNames, readStore } from './fixtures/db'

/**
 * Settings › People, statuses & tags › Find unused… opens the Unused people
 * & tags dialog: tick a person and a tag that only a completed task has
 * (Ignore completed tasks), Remove, confirm — both are gone from the dialog
 * and from the top bar's pickers; Undo brings them back, on their task
 * again. The phone's Settings page reaches the same dialog.
 */

const SEED: WorkspaceSeed = {
  people: ['Ann', 'Bob', 'Cal'],
  tags: ['old', 'keep'],
  listDefinitions: [{ name: 'Team', predicate: { showCompleted: true } }],
  tasks: [
    { title: 'Open task', people: ['Bob'], tags: ['keep'] },
    { title: 'Done task', people: ['Ann'], tags: ['old'], isCompleted: true },
  ],
  layouts: [{ name: 'Main', columns: [{ id: 'c1', cells: [{ id: 'k1', tabs: [{ id: 't1', kind: 'lens', listDefIdx: 0 }] }] }] }],
}

/** The names a top-bar filter picker offers (its options, without None). */
async function pickerNames(page: Page, field: 'People' | 'Tags'): Promise<string[]> {
  await page.getByRole('button', { name: new RegExp(`^${field} filter`) }).click()
  const list = page.getByRole('listbox', { name: field })
  await expect(list).toBeVisible()
  const names = (await list.getByRole('option').allTextContents()).map((t) => t.trim()).filter((t) => t !== 'None')
  await page.keyboard.press('Escape')
  await expect(list).toHaveCount(0)
  return names
}

test.describe('desktop', () => {
  test.use({ viewport: { width: 1600, height: 900 } })

  test('remove an unused person and tag, then Undo brings them back on their task', async ({ page }) => {
    await seedWorkspace(page, SEED)
    expect(await pickerNames(page, 'People')).toEqual(['@Ann', '@Bob', '@Cal'])

    const settings = await openSettings(page, 'People, statuses & tags')
    const find = settings.getByRole('button', { name: 'Find unused…' })
    await find.click()
    const part = page.getByRole('dialog', { name: 'Unused people & tags' })
    await expect(part).toBeVisible()
    const people = part.getByRole('group', { name: 'People' })
    const tags = part.getByRole('group', { name: 'Tags' })
    await expect(people.getByRole('checkbox', { name: /^Cal/ })).toBeVisible()
    await expect(people.getByRole('checkbox', { name: /^Ann/ })).toHaveCount(0)
    await part.getByRole('checkbox', { name: 'Ignore completed tasks' }).check()
    await expect(people.getByRole('checkbox', { name: /^Ann/ })).toBeVisible()
    await expect(people.getByText('on 1 completed task')).toBeVisible()
    await expect(people.getByRole('checkbox', { name: /^Ann/ })).not.toBeChecked()

    await people.getByRole('checkbox', { name: /^Ann/ }).check()
    await tags.getByRole('checkbox', { name: /^old/ }).check()
    await part.getByRole('button', { name: 'Remove 2…' }).click()

    const confirm = page.getByRole('dialog', { name: 'Remove 1 person and 1 tag?' })
    await expect(confirm).toBeVisible()
    await expect(confirm.getByText('They’re removed from 1 completed task.')).toBeVisible()
    await expect(confirm.getByRole('button', { name: 'Cancel' })).toBeFocused()
    await confirm.getByRole('button', { name: 'Remove', exact: true }).click()
    await expect(confirm).toHaveCount(0)
    await expect(part).toBeVisible()

    await expect(people.getByRole('checkbox', { name: /^Ann/ })).toHaveCount(0)
    await expect(tags.getByRole('checkbox', { name: /^old/ })).toHaveCount(0)
    await expect(page.getByText('Remove 1 person and 1 tag', { exact: true })).toBeVisible()
    expect((await readStore<{ name: string }>(page, 'people')).map((p) => p.name).sort()).toEqual(['Bob', 'Cal'])
    expect(await assignedNames(page, 'Done task')).toEqual([])

    // Esc closes the dialog only, focus back on Find unused…; then Settings.
    await page.keyboard.press('Escape')
    await expect(part).toHaveCount(0)
    await expect(settings).toBeVisible()
    await expect(find).toBeFocused()
    await page.getByRole('button', { name: 'Close settings' }).click()
    await expect(settings).toHaveCount(0)
    expect(await pickerNames(page, 'People')).toEqual(['@Bob', '@Cal'])
    expect(await pickerNames(page, 'Tags')).toEqual(['#keep'])

    await page.keyboard.press('Control+z')
    await expect.poll(() => assignedNames(page, 'Done task')).toEqual(['Ann'])
    await expect.poll(() => assignedNames(page, 'Done task', 'tags')).toEqual(['old'])
    expect(await pickerNames(page, 'People')).toEqual(['@Ann', '@Bob', '@Cal'])
    expect(await pickerNames(page, 'Tags')).toEqual(['#keep', '#old'])
  })
})

test.describe('phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })

  test('the Settings page’s People, statuses & tags shows only Find unused…, whose dialog fits the screen and removes', async ({ page }) => {
    await seedWorkspace(page, SEED)
    await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('tab', { name: 'Settings' }).tap()
    await page.getByRole('button', { name: 'People, statuses & tags' }).tap()
    await expect(page.getByRole('heading', { level: 1, name: 'People, statuses & tags' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Manage people…' })).toHaveCount(0)

    await page.getByRole('button', { name: 'Find unused…' }).tap()
    const dialog = page.getByRole('dialog', { name: 'Unused people & tags' })
    await expect(dialog).toBeVisible()
    const b = await dialog.boundingBox()
    expect(b).not.toBeNull()
    expect(b!.x).toBeGreaterThanOrEqual(0)
    expect(b!.x + b!.width).toBeLessThanOrEqual(390)
    expect(b!.y + b!.height).toBeLessThanOrEqual(844)

    await dialog.getByRole('group', { name: 'People' }).getByRole('checkbox', { name: /^Cal/ }).check()
    await dialog.getByRole('button', { name: 'Remove 1…' }).tap()
    const confirm = page.getByRole('dialog', { name: 'Remove 1 person?' })
    await confirm.getByRole('button', { name: 'Remove', exact: true }).tap()
    await expect(confirm).toHaveCount(0)
    await expect(dialog.getByRole('group', { name: 'People' }).getByText('No unused people')).toBeVisible()
    expect((await readStore<{ name: string }>(page, 'people')).map((p) => p.name).sort()).toEqual(['Ann', 'Bob'])
    await dialog.getByRole('button', { name: '×' }).tap()
    await expect(dialog).toHaveCount(0)
  })
})
