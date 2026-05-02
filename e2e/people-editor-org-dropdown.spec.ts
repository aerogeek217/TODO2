import { expect, test } from '@playwright/test'

const DB_NAME = 'todo2'

/**
 * Regression for triage-2026-05-01 P2: the org dropdown inside the People
 * editor was rendered as an inline `position:absolute` panel inside the
 * scrollable modal `.list` body, so a person row near the bottom of the
 * modal had its dropdown clipped by the body's `overflow-y: auto`. The
 * fix wraps `<ChipSelector>` in `<PortalDropdown>` like the existing four
 * task-row chip-picker consumers, so the dropdown portals to `<body>` and
 * the only clip boundary is the viewport (which PortalDropdown clamps for).
 */
test('people editor: org dropdown renders fully visible when person is near modal bottom', async ({ page }) => {
  await page.goto('/')
  await page.locator('.react-flow__viewport').first().waitFor({ state: 'visible' })

  // Seed many people + at least one org via raw IDB. We need enough people
  // that the modal's `.list` overflows; the regression is specifically about
  // the bottom-most row — that's where the inline `position:absolute` panel
  // would be clipped by the modal body's overflow.
  await page.evaluate(async ({ db, peopleCount }) => {
    return await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open(db)
      req.onsuccess = () => {
        const idb = req.result
        const tx = idb.transaction(['people', 'orgs'], 'readwrite')
        for (let i = 0; i < peopleCount; i++) {
          tx.objectStore('people').add({
            name: `Person ${String(i).padStart(2, '0')}`,
            initials: `P${i}`,
          })
        }
        tx.objectStore('orgs').add({ name: 'Acme', initials: 'AC', color: '#888888' })
        tx.objectStore('orgs').add({ name: 'Initech', initials: 'IN', color: '#666666' })
        tx.oncomplete = () => { idb.close(); resolve() }
        tx.onerror = () => { idb.close(); reject(tx.error) }
      }
      req.onerror = () => reject(req.error)
    })
  }, { db: DB_NAME, peopleCount: 25 })

  await page.goto('/#/settings')
  await page.getByRole('button', { name: /Manage People/ }).click()

  // Click "+ Add Person" — the add-mode edit row renders at the bottom of
  // the modal `.list`, which is exactly where the bug bites. The add row's
  // Orgs toggle is near the modal bottom and its dropdown previously clipped.
  await page.getByRole('button', { name: '+ Add Person' }).click()

  const orgToggle = page.getByRole('button', { name: 'Orgs', exact: true })
  await expect(orgToggle).toBeVisible()
  await orgToggle.scrollIntoViewIfNeeded()
  await orgToggle.click()

  // ChipSelector portals via PortalDropdown — assert the search input renders
  // and is fully visible inside the viewport.
  const searchInput = page.getByPlaceholder('Search orgs...')
  await expect(searchInput).toBeVisible()

  // Assert the panel's rect is fully inside the viewport. PortalDropdown
  // runs an initial unclamped pass + a clamp pass after `ResizeObserver`
  // measures the panel, so wrap in `toPass` to retry through that settle
  // (without a wait, the test races the second pass and reads the unclamped
  // bottom). This would have failed pre-fix because the dropdown was clipped
  // by `.list`'s `overflow-y: auto` regardless of when we measured.
  const viewport = page.viewportSize()
  if (!viewport) throw new Error('viewport size missing')

  await expect(async () => {
    const panelRect = await searchInput.evaluate((input) => {
      const panel = (input as HTMLElement).closest('[class*="orgDropdownPanel"]')
      if (!panel) return null
      const r = (panel as HTMLElement).getBoundingClientRect()
      return { top: r.top, bottom: r.bottom, left: r.left, right: r.right }
    })
    expect(panelRect).not.toBeNull()
    expect(panelRect!.bottom).toBeLessThanOrEqual(viewport.height)
    expect(panelRect!.top).toBeGreaterThanOrEqual(0)
    expect(panelRect!.right).toBeLessThanOrEqual(viewport.width)
    expect(panelRect!.left).toBeGreaterThanOrEqual(0)
  }).toPass({ timeout: 2000 })
})
