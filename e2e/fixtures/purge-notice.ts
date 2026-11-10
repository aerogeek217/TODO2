import { expect, type Locator, type Page } from '@playwright/test'

/**
 * The purge notice: completed tasks past the retention open no dialog at
 * launch — the storage pill (desktop) or the phone's status button shows
 * them, and the panel's section opens the purge dialog (Review…) or waits
 * the interval (Not now).
 */

/** The purge dialog, by its title (`Delete 1 old completed task?`, or any count). */
export function purgeDialog(page: Page, count?: number): Locator {
  const name = count == null ? /^Delete \d+ old completed tasks?\?$/ : `Delete ${count} old completed task${count === 1 ? '' : 's'}?`
  return page.getByRole('dialog', { name })
}

/** The notice's section, its panel opened from the pill (desktop) or the status button (phone). */
export async function openPurgeNotice(page: Page, { phone = false }: { phone?: boolean } = {}): Promise<Locator> {
  const trigger = phone ? page.getByTestId('sync-status-button') : page.getByTestId('storage-pill')
  const panel = phone ? page.getByTestId('sync-status-sheet') : page.getByTestId('storage-popover')
  const section = panel.locator('[data-warning="purge"]')
  // The notice lands once launch's read of the expired tasks does.
  await expect(trigger).toHaveAttribute('aria-label', /old completed|warnings/)
  if (!(await panel.isVisible())) await (phone ? trigger.tap() : trigger.click())
  await expect(section).toBeVisible()
  return section
}

/** Review… in the notice: the purge dialog opens. Returns it. */
export async function reviewPurge(page: Page, opts: { phone?: boolean; count?: number } = {}): Promise<Locator> {
  const section = await openPurgeNotice(page, opts)
  await section.getByRole('button', { name: 'Review…' }).click()
  const dialog = purgeDialog(page, opts.count)
  await expect(dialog).toBeVisible()
  return dialog
}

/** Not now in the notice: nothing deleted, the interval stamp written. Closes the panel if it is still open. */
export async function dismissPurgeNotice(page: Page, opts: { phone?: boolean } = {}): Promise<void> {
  const section = await openPurgeNotice(page, opts)
  await section.getByRole('button', { name: 'Not now' }).click()
  await expect(section).toBeHidden()
  await expect.poll(async () => page.evaluate(async () => {
    const mod = (await import(/* @vite-ignore */ '/src/stores/settings-store.ts' as string)) as { useSettingsStore: { getState: () => { purgePromptLastAt: Date | null } } }
    return mod.useSettingsStore.getState().purgePromptLastAt != null
  })).toBe(true)
  const panel = opts.phone ? page.getByTestId('sync-status-sheet') : page.getByTestId('storage-popover')
  if (await panel.isVisible()) await page.keyboard.press('Escape')
  await expect(panel).toBeHidden()
}
