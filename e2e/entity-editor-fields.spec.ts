import { expect, test } from '@playwright/test'
import { openSettings, seedWorkspace, wsRow, type WorkspaceSeed } from './fixtures/workspace'
import { box } from './fixtures/geometry'

/**
 * The people, status and tag editors' add / edit row: the name field is the
 * row's first line, the whole width (beside a status's icon and a person's
 * initials), the colors and Save / Cancel on the line under it. On one line
 * the swatches left the name a few characters wide. Real-browser: layout.
 */

const SEED: WorkspaceSeed = {
  listDefinitions: [{ name: 'All' }],
  people: ['Aisha Rahman'],
  tags: ['q4'],
  tasks: [{ title: 'Alpha' }],
  layouts: [{ name: 'Main', columns: [{ id: 'c1', rows: [wsRow({ id: 'k1', tabs: [{ id: 't1', kind: 'lens', listDefIdx: 0 }] })] }] }],
}

test.use({ viewport: { width: 1280, height: 900 } })

for (const [manage, add, name] of [
  ['Manage statuses…', '+ Add Status', 'Status name'],
  ['Manage tags…', '+ Add Tag', 'Tag name'],
  ['Manage people…', '+ Add Person', 'Name'],
] as const) {
  test(`${manage} — the name field takes the row's first line, the colors the next`, async ({ page }) => {
    await seedWorkspace(page, SEED)
    const settings = await openSettings(page, 'People, statuses & tags')
    await settings.getByRole('button', { name: manage }).click()
    await page.getByRole('button', { name: add }).click()
    const field = page.getByPlaceholder(name, { exact: true })
    await expect(field).toBeFocused()
    const row = field.locator('xpath=ancestor::*[contains(@class, "editRow")][1]')
    const [f, r] = [await box(field), await box(row)]
    expect(f.width).toBeGreaterThan(r.width * 0.7)
    const add2 = await box(page.getByRole('button', { name: 'Add', exact: true }))
    expect(add2.y).toBeGreaterThan(f.y + f.height - 1)
  })
}
