import { expect, test, type Page } from '@playwright/test'
import { openSettings, seedWorkspace, type WorkspaceSeed } from './fixtures/workspace'
import { assignedNames, readStore } from './fixtures/db'

/**
 * Settings › People, statuses & tags › Unused people & tags: tick a person
 * and a tag that only a completed task has (Ignore completed tasks), Remove,
 * confirm — both are gone from Settings and from the top bar's pickers;
 * Undo brings them back, on their task again.
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

test.use({ viewport: { width: 1600, height: 900 } })

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

test('remove an unused person and tag, then Undo brings them back on their task', async ({ page }) => {
  await seedWorkspace(page, SEED)
  expect(await pickerNames(page, 'People')).toEqual(['@Ann', '@Bob', '@Cal'])

  const settings = await openSettings(page, 'Unused people & tags')
  const part = settings.getByTestId('unused-entities')
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

  await expect(people.getByRole('checkbox', { name: /^Ann/ })).toHaveCount(0)
  await expect(tags.getByRole('checkbox', { name: /^old/ })).toHaveCount(0)
  await expect(page.getByText('Remove 1 person and 1 tag', { exact: true })).toBeVisible()
  expect((await readStore<{ name: string }>(page, 'people')).map((p) => p.name).sort()).toEqual(['Bob', 'Cal'])
  expect(await assignedNames(page, 'Done task')).toEqual([])

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
