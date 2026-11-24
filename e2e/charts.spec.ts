import { expect, test } from '@playwright/test'
import { seedWorkspace } from './fixtures/workspace'

/** Created vs completed's day axis in a real layout. */

test.use({ viewport: { width: 1440, height: 900 } })

test('Created vs completed in a narrow cell labels every few days, today always, none colliding', async ({ page }) => {
  await seedWorkspace(page, {
    tasks: [{ title: 'Open one' }],
    layouts: [{ name: 'Trend', table: {
      areas: ['n t n2'],
      cells: [
        { id: 'n', tabs: [{ id: 'notes', kind: 'notes' }] },
        { id: 't', tabs: [{ id: 'trend', kind: 'trend', glance: { range: '14d' } }] },
        { id: 'n2', tabs: [{ id: 'notes2', kind: 'notes' }] },
      ],
      // About 220px at 1440: past the small face (180px), the chart's columns 10px.
      cols: [610, 220, 610],
    } }],
  })
  const axis = page.locator('[data-glance-section="trend"] [data-today="true"]').locator('..')
  await expect(axis.locator('span')).toHaveCount(14)
  await expect(axis.locator('span').last()).not.toBeEmpty()
  const labels = await axis.locator('span').evaluateAll((spans) => spans.map((s) => {
    const range = document.createRange()
    range.selectNodeContents(s)
    const b = range.getBoundingClientRect()
    return { text: s.textContent ?? '', left: b.left, right: b.right }
  }))
  const shown = labels.filter((l) => l.text !== '')
  // Today's label always; fewer than all fourteen; none reaching the next.
  expect(shown.length).toBeGreaterThan(1)
  expect(shown.length).toBeLessThan(14)
  for (let i = 1; i < shown.length; i++) expect(shown[i]!.left).toBeGreaterThan(shown[i - 1]!.right)
})
